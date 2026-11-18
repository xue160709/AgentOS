/**
 * Disabled, injectable Project Chat IPC seam. This module deliberately does
 * not import ipcMain or register any production handler; M0-05 owns cutover.
 */

import type {
  ChatModelPick,
  ClaudePermissionMode,
  ClaudePermissionResponsePayload,
} from '../src/claude-chat-types'
import { Buffer } from 'node:buffer'
import {
  projectChatError,
  normalizeProjectChatRelativePath,
  projectChatBasename,
  type AnswerProjectPromptInput,
  type ArchiveProjectThreadInput,
  type CancelProjectRunInput,
  type CreateProjectThreadInput,
  type CreateProjectThreadResult,
  type EditAndSubmitProjectRunInput,
  type ForkProjectThreadInput,
  type MarkProjectFileDiffReviewedInput,
  type RewindProjectFileDiffInput,
  type RewindProjectFileDiffResult,
  type ReportProjectChatPresenceInput,
  type ProjectChatEvent,
  type ProjectChatInternalEvent,
  type ProjectChatInternalSnapshot,
  type ProjectChatAgentContext,
  type ProjectChatAttachment,
  type ProjectChatAttachmentSelection,
  type ProjectChatFileSearchItem,
  type ProjectChatModelCatalog,
  type ProjectChatThreadStatus,
  type ProjectChatResult,
  type ProjectChatSnapshot,
  type ProjectChatWindowViewState,
  type SaveProjectChatWindowViewStateInput,
  type SearchProjectChatFilesInput,
  type ReadProjectChatAttachmentsInput,
  type GetProjectChatThreadStatusInput,
  type SubmitProjectRunInput,
  type SubmitProjectRunResult,
  type StartProjectRuntimeChatResult,
  type SetProjectThreadModelInput,
  type SetProjectThreadPinnedInput,
  type WebsiteBindingPublic,
  type AgentOSPairingResponse,
} from '../src/project-chat-contract'
import type { ProjectChatRunContext } from './project-chat-broker'
import { parseRuntimeScopeId, type RuntimeScopeId } from '../src/runtime-development-contract'
import { PROJECT_CHAT_INVOKE_CHANNELS } from '../src/project-chat-ipc-seam'
import {
  DesktopPreferencesStore,
} from './desktop-preferences-store'

export type RendererCapability =
  | { kind: 'main-window'; webContentsId: number }
  | { kind: 'project-chat-window'; webContentsId: number; projectId: string; routeGeneration: number }

export type RuntimeDevelopmentCapability = { kind: 'runtime-development'; webContentsId: number; runtimeScopeId: RuntimeScopeId; routeGeneration: number; developmentGeneration: number }
export type RegisteredRendererCapability = RendererCapability | RuntimeDevelopmentCapability

export type ProjectChatIpcEvent = {
  sender?: { id?: number; mainFrame?: unknown }
  senderFrame?: { url?: string }
}

export class RendererCapabilityRegistry {
  private readonly capabilities = new Map<number, RegisteredRendererCapability>()

  registerMainWindow(webContentsId: number): RendererCapability | null {
    if (!isWebContentsId(webContentsId)) return null
    const capability: RendererCapability = { kind: 'main-window', webContentsId }
    this.capabilities.set(webContentsId, capability)
    return capability
  }

  registerProjectWindow(webContentsId: number, projectId: string, routeGeneration: number): RendererCapability | null {
    if (!isWebContentsId(webContentsId) || !isNonEmptyString(projectId) || !isGeneration(routeGeneration)) return null
    const capability: RendererCapability = { kind: 'project-chat-window', webContentsId, projectId: projectId.trim(), routeGeneration }
    this.capabilities.set(webContentsId, capability)
    return capability
  }

  registerRuntimeDevelopmentWindow(webContentsId: number, runtimeScopeId: RuntimeScopeId, routeGeneration: number, developmentGeneration: number): RuntimeDevelopmentCapability | null {
    if (!isWebContentsId(webContentsId) || !parseRuntimeScopeId(runtimeScopeId) || !isGeneration(routeGeneration) || !isGeneration(developmentGeneration)) return null
    const capability: RuntimeDevelopmentCapability = { kind: 'runtime-development', webContentsId, runtimeScopeId, routeGeneration, developmentGeneration }
    this.capabilities.set(webContentsId, capability)
    return capability
  }

  unregister(webContentsId: number): void { this.capabilities.delete(webContentsId) }
  get(webContentsId: number): RegisteredRendererCapability | undefined { return this.capabilities.get(webContentsId) }

  recipientsFor(event: Pick<ProjectChatInternalEvent, 'projectId' | 'routeGeneration'>): RendererCapability[] {
    return [...this.capabilities.values()].filter((capability): capability is RendererCapability =>
      capability.kind === 'main-window' ||
      (capability.kind === 'project-chat-window' && capability.projectId === event.projectId && capability.routeGeneration === event.routeGeneration),
    )
  }

  runtimeRecipientsFor(input: { runtimeScopeId: RuntimeScopeId; routeGeneration: number; developmentGeneration: number }): RuntimeDevelopmentCapability[] {
    return [...this.capabilities.values()].filter((capability): capability is RuntimeDevelopmentCapability => capability.kind === 'runtime-development' && capability.runtimeScopeId === input.runtimeScopeId && capability.routeGeneration === input.routeGeneration && capability.developmentGeneration === input.developmentGeneration)
  }
}

export type ProjectChatBrokerPort = {
  getSnapshot(projectId: string): Promise<ProjectChatResult<ProjectChatInternalSnapshot>>
  createThread(input: CreateProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  submitRun(input: SubmitProjectRunInput, context?: ProjectChatRunContext): Promise<ProjectChatResult<SubmitProjectRunResult>>
  forkThread(input: ForkProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  editAndSubmitRun(input: EditAndSubmitProjectRunInput, context?: ProjectChatRunContext): Promise<ProjectChatResult<SubmitProjectRunResult>>
  archiveThread(input: ArchiveProjectThreadInput): Promise<ProjectChatResult<void>>
  setThreadPinned(input: SetProjectThreadPinnedInput): Promise<ProjectChatResult<void>>
  setThreadModel(input: SetProjectThreadModelInput): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(input: MarkProjectFileDiffReviewedInput): Promise<ProjectChatResult<void>>
  rewindFileDiff(input: RewindProjectFileDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>>
  cancelRun(input: CancelProjectRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(input: AnswerProjectPromptInput, ownerWebContentsId?: number): Promise<ProjectChatResult<void>>
  refreshPromptOwners(projectId?: string): Promise<void>
  onWebContentsUnavailable(webContentsId: number): Promise<void>
  routeGenerationOf(projectId: string): number
  broadcastAllSnapshots(permissionMode: ClaudePermissionMode): Promise<void>
  refreshExternalUnread(projectId: string, seenAt: number): Promise<void>
}

export type ProjectChatWindowCollaborator = {
  openProjectWindow?(projectId: string): Promise<ProjectChatResult<void>>
  startProjectRuntimeChat?(projectId: string): Promise<ProjectChatResult<StartProjectRuntimeChatResult>>
  openWorkspaceTabProjectChat?(workspaceTabId: string): Promise<ProjectChatResult<void>>
  openProjectPreview?(projectId: string): Promise<ProjectChatResult<void>>
  openProjectPathRecovery?(projectId: string): Promise<ProjectChatResult<void>>
  getWindowViewState?(projectId: string): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  saveWindowViewState?(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  listWebsiteBindings?(): Promise<ProjectChatResult<WebsiteBindingPublic[]>>
  revokeWebsiteBinding?(bindingId: string): Promise<ProjectChatResult<void>>
  respondToWebsitePairing?(input: AgentOSPairingResponse): Promise<ProjectChatResult<void>>
}

/** Deliberately injected only: M0-05A does not implement filesystem/settings/dialog access. */
export type ProjectChatScopedReadCollaborator = {
  getModelCatalog?(): Promise<unknown>
  getAgentContext?(projectId: string): Promise<unknown>
  searchProjectFiles?(input: SearchProjectChatFilesInput): Promise<unknown>
  pickAttachments?(options?: { allowImages?: boolean }): Promise<unknown>
  readProjectAttachments?(input: ReadProjectChatAttachmentsInput): Promise<unknown>
  getThreadStatus?(input: GetProjectChatThreadStatusInput): Promise<unknown>
}

export type ProjectChatPresenceCollaborator = {
  reportSelection(webContentsId: number, input: ReportProjectChatPresenceInput): ProjectChatResult<void>
}

export type ProjectChatPermissionStore = Pick<DesktopPreferencesStore, 'readChatPermissionModeState' | 'save'>

export class ProjectChatPermissionService {
  constructor(private readonly store: ProjectChatPermissionStore) {}

  initialize(legacyMode: unknown): { mode: ClaudePermissionMode; persisted: boolean } {
    const stored = this.store.readChatPermissionModeState()
    if (stored.kind === 'valid') return { mode: stored.value, persisted: false }
    const mode = stored.kind === 'invalid' ? 'auto' : isClaudePermissionMode(legacyMode) ? legacyMode : 'auto'
    this.store.save({ chatPermissionMode: mode })
    return { mode, persisted: true }
  }

  set(mode: unknown): ProjectChatResult<ClaudePermissionMode> {
    if (!isClaudePermissionMode(mode)) return fail('invalid-argument', 'Permission mode is invalid.')
    this.store.save({ chatPermissionMode: mode })
    return { ok: true, value: mode }
  }
}

export type ProjectChatIpcRouterOptions = {
  broker: ProjectChatBrokerPort
  capabilities: RendererCapabilityRegistry
  rendererEntries: readonly string[]
  permissionService: ProjectChatPermissionService
  collaborator?: ProjectChatWindowCollaborator
  scopedRead?: ProjectChatScopedReadCollaborator
  presence?: ProjectChatPresenceCollaborator
}

export type ProjectChatIpcRouter = {
  getSnapshot(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<ProjectChatSnapshot>>
  createThread(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<CreateProjectThreadResult>>
  submitRun(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<SubmitProjectRunResult>>
  forkThread(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<CreateProjectThreadResult>>
  editAndSubmitRun(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<SubmitProjectRunResult>>
  archiveThread(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  setThreadPinned(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  setThreadModel(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  rewindFileDiff(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<RewindProjectFileDiffResult>>
  cancelRun(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  answerPrompt(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  reportPresenceSelection(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  openProjectWindow(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<void>>
  startProjectRuntimeChat(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<StartProjectRuntimeChatResult>>
  openWorkspaceTabProjectChat(event: ProjectChatIpcEvent, workspaceTabId: unknown): Promise<ProjectChatResult<void>>
  openProjectPreview(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<void>>
  openProjectPathRecovery(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<void>>
  getWindowViewState(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  saveWindowViewState(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  markExternalTasksSeen(event: ProjectChatIpcEvent, projectId: unknown, seenAt: unknown): Promise<ProjectChatResult<void>>
  listWebsiteBindings(event: ProjectChatIpcEvent): Promise<ProjectChatResult<WebsiteBindingPublic[]>>
  revokeWebsiteBinding(event: ProjectChatIpcEvent, bindingId: unknown): Promise<ProjectChatResult<void>>
  respondToWebsitePairing(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<void>>
  initializePermissionMode(event: ProjectChatIpcEvent, legacyMode: unknown): Promise<ProjectChatResult<ClaudePermissionMode>>
  setPermissionMode(event: ProjectChatIpcEvent, mode: unknown): Promise<ProjectChatResult<ClaudePermissionMode>>
  getModelCatalog(event: ProjectChatIpcEvent): Promise<ProjectChatResult<ProjectChatModelCatalog>>
  getAgentContext(event: ProjectChatIpcEvent, projectId: unknown): Promise<ProjectChatResult<ProjectChatAgentContext>>
  searchProjectFiles(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<ProjectChatFileSearchItem[]>>
  pickAttachments(event: ProjectChatIpcEvent, options: unknown): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  readProjectAttachments(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  getThreadStatus(event: ProjectChatIpcEvent, input: unknown): Promise<ProjectChatResult<ProjectChatThreadStatus>>
  handlers: Record<string, (event: ProjectChatIpcEvent, payload?: unknown) => Promise<ProjectChatResult<unknown>>>
}

export function createProjectChatCapabilityBroadcaster(
  capabilities: RendererCapabilityRegistry,
  deliver: (webContentsId: number, event: ProjectChatEvent) => void,
): (event: ProjectChatInternalEvent) => void {
  return (event) => {
    for (const capability of capabilities.recipientsFor(event)) {
      deliver(capability.webContentsId, projectEventForRecipient(event, capability.webContentsId))
    }
  }
}

/** Projects Main-only owner identities into a recipient-safe renderer snapshot. */
export function projectSnapshotForRecipient(
  snapshot: ProjectChatInternalSnapshot,
  recipientWebContentsId: number,
): ProjectChatSnapshot {
  return {
    projectId: snapshot.projectId,
    project: snapshot.project,
    workspaceRevision: snapshot.workspaceRevision,
    sequence: snapshot.sequence,
    routeGeneration: snapshot.routeGeneration,
    threads: snapshot.threads,
    runs: snapshot.runs,
    pendingPrompts: snapshot.pendingPrompts.map((prompt) => ({
      projectId: prompt.projectId,
      threadId: prompt.threadId,
      requestId: prompt.requestId,
      promptId: prompt.promptId,
      kind: prompt.kind,
      createdAt: prompt.createdAt,
      payload: prompt.payload,
      isOwnedByCaller: prompt.ownerWebContentsId === recipientWebContentsId,
    })),
    permissionMode: snapshot.permissionMode,
    unreadExternalTaskCount: snapshot.unreadExternalTaskCount,
    ...(snapshot.runtimeEdit ? { runtimeEdit: snapshot.runtimeEdit } : {}),
  }
}

function projectEventForRecipient(event: ProjectChatInternalEvent, recipientWebContentsId: number): ProjectChatEvent {
  return {
    type: 'snapshot',
    projectId: event.projectId,
    sequence: event.sequence,
    routeGeneration: event.routeGeneration,
    workspaceRevision: event.workspaceRevision,
    snapshot: projectSnapshotForRecipient(event.snapshot, recipientWebContentsId),
  }
}

export function createProjectChatIpcRouter(options: ProjectChatIpcRouterOptions): ProjectChatIpcRouter {
  const entryAllowlist = new Set(options.rendererEntries.map(rendererEntryKey).filter((entry): entry is string => entry !== null))
  const authorize = (event: ProjectChatIpcEvent, projectId?: string): ProjectChatResult<RendererCapability> => {
    const webContentsId = event.sender?.id
    if (!isWebContentsId(webContentsId) || event.senderFrame === undefined || event.senderFrame !== event.sender?.mainFrame) return fail('sender-not-authorized', 'Sender is not authorized.')
    if (!entryAllowlist.has(rendererEntryKey(event.senderFrame.url) ?? '')) return fail('sender-not-authorized', 'Sender is not authorized.')
    const capability = options.capabilities.get(webContentsId)
    if (!capability) return fail('sender-not-authorized', 'Sender is not authorized.')
    if (capability.kind === 'runtime-development') return fail('sender-not-authorized', 'Sender is not authorized.')
    if (capability.kind === 'project-chat-window') {
      if (capability.routeGeneration !== options.broker.routeGenerationOf(capability.projectId)) return fail('sender-not-authorized', 'Sender is not authorized.')
      if (projectId !== undefined && capability.projectId !== projectId) return fail('sender-not-authorized', 'Sender is not authorized.')
    }
    return { ok: true, value: capability }
  }
  const authorizeMain = (event: ProjectChatIpcEvent): ProjectChatResult<RendererCapability> => {
    const result = authorize(event)
    return result.ok && result.value.kind !== 'main-window' ? fail('sender-not-authorized', 'Sender is not authorized.') : result
  }
  const call = async <T>(operation: () => Promise<ProjectChatResult<T>>): Promise<ProjectChatResult<T>> => {
    try { return await operation() } catch { return fail('internal-error', 'Project Chat is temporarily unavailable.') }
  }
  const unimplemented = <T>(): ProjectChatResult<T> => fail('internal-error', 'Project Chat operation is unavailable.')
  const routeCommand = async <T, Input extends { projectId: string }>(
    event: ProjectChatIpcEvent,
    raw: unknown,
    parse: (value: unknown) => Input | null,
    operation: (input: Input, capability: RendererCapability) => Promise<ProjectChatResult<T>>,
  ): Promise<ProjectChatResult<T>> => {
    const capability = authorize(event, recordProjectId(raw) ?? undefined)
    if (!capability.ok) return capability
    const input = parse(raw)
    if (!input) return fail('invalid-argument', 'Project Chat command input is invalid.')
    if (capability.value.kind === 'project-chat-window' && 'routeGeneration' in input && input.routeGeneration !== capability.value.routeGeneration) return fail('sender-not-authorized', 'Sender is not authorized.')
    return call(() => operation(input, capability.value))
  }

  const router = {
    async getSnapshot(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => projectResultForRecipient(await options.broker.getSnapshot(projectId), capability.value.webContentsId))
    },
    async createThread(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      // Website source is Main-internal after ticket validation; renderer IPC cannot mint it.
      if (isRecord(raw) && raw.source === 'website') return fail('sender-not-authorized', 'Sender is not authorized.')
      const input = createThreadInput(raw)
      if (!input) return fail('invalid-argument', 'Thread input is invalid.')
      return call(() => options.broker.createThread(input))
    },
    async submitRun(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      const input = submitRunInput(raw)
      if (!input) return fail('invalid-argument', 'Run input is invalid.')
      return call(() => options.broker.submitRun(input, { projectRuntimePrompt: capability.value.kind === 'project-chat-window' }))
    },
    async forkThread(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, forkThreadInput, (input) => options.broker.forkThread(input)) },
    async editAndSubmitRun(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, editAndSubmitInput, (input, capability) => options.broker.editAndSubmitRun(input, { projectRuntimePrompt: capability.kind === 'project-chat-window' })) },
    async archiveThread(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, archiveThreadInput, (input) => options.broker.archiveThread(input)) },
    async setThreadPinned(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, setPinnedInput, (input) => options.broker.setThreadPinned(input)) },
    async setThreadModel(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, setModelInput, (input) => options.broker.setThreadModel(input)) },
    async markFileDiffReviewed(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, markDiffReviewedInput, (input) => options.broker.markFileDiffReviewed(input)) },
    async rewindFileDiff(event: ProjectChatIpcEvent, raw: unknown) { return routeCommand(event, raw, rewindFileDiffInput, (input) => options.broker.rewindFileDiff(input)) },
    async cancelRun(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      const input = cancelRunInput(raw)
      if (!input) return fail('invalid-argument', 'Cancel input is invalid.')
      return call(() => options.broker.cancelRun(input))
    },
    async answerPrompt(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      const input = answerPromptInput(raw)
      if (!input) return fail('invalid-argument', 'Prompt input is invalid.')
      return call(() => options.broker.answerPrompt(input, capability.value.webContentsId))
    },
    async reportPresenceSelection(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      const input = presenceSelectionInput(raw)
      if (!input) return fail('invalid-argument', 'Presence input is invalid.')
      return call(async () => options.presence ? options.presence.reportSelection(capability.value.webContentsId, input) : unimplemented<void>())
    },
    async openProjectWindow(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.collaborator?.openProjectWindow ? await options.collaborator.openProjectWindow(projectId) : unimplemented<void>())
    },
    async startProjectRuntimeChat(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      const projectId = validString(rawProjectId)
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.collaborator?.startProjectRuntimeChat
        ? await options.collaborator.startProjectRuntimeChat(projectId)
        : unimplemented<StartProjectRuntimeChatResult>())
    },
    async openWorkspaceTabProjectChat(event: ProjectChatIpcEvent, rawWorkspaceTabId: unknown) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      const workspaceTabId = validString(rawWorkspaceTabId)
      if (!workspaceTabId) return fail('invalid-argument', 'Workspace Tab id is required.')
      return call(async () => options.collaborator?.openWorkspaceTabProjectChat
        ? await options.collaborator.openWorkspaceTabProjectChat(workspaceTabId)
        : unimplemented<void>())
    },
    async openProjectPreview(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.collaborator?.openProjectPreview ? await options.collaborator.openProjectPreview(projectId) : unimplemented<void>())
    },
    async openProjectPathRecovery(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId); const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.collaborator?.openProjectPathRecovery ? await options.collaborator.openProjectPathRecovery(projectId) : unimplemented<void>())
    },
    async getWindowViewState(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.collaborator?.getWindowViewState ? await options.collaborator.getWindowViewState(projectId) : unimplemented<ProjectChatWindowViewState>())
    },
    async saveWindowViewState(event: ProjectChatIpcEvent, raw: unknown) {
      const projectId = recordProjectId(raw)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      const input = saveWindowViewStateInput(raw)
      if (!input) return fail('invalid-argument', 'Window state input is invalid.')
      return call(async () => options.collaborator?.saveWindowViewState ? await options.collaborator.saveWindowViewState(input) : unimplemented<ProjectChatWindowViewState>())
    },
    async markExternalTasksSeen(event: ProjectChatIpcEvent, rawProjectId: unknown, rawSeenAt: unknown) {
      const projectId = validString(rawProjectId); const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId || !isFiniteNumber(rawSeenAt)) return fail('invalid-argument', 'External task cursor is invalid.')
      return call(async () => { await options.broker.refreshExternalUnread(projectId, rawSeenAt); return { ok: true as const, value: undefined } })
    },
    async listWebsiteBindings(event: ProjectChatIpcEvent) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      return call(async () => options.collaborator?.listWebsiteBindings ? await options.collaborator.listWebsiteBindings() : unimplemented<WebsiteBindingPublic[]>())
    },
    async revokeWebsiteBinding(event: ProjectChatIpcEvent, rawBindingId: unknown) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      const bindingId = validString(rawBindingId)
      if (!bindingId) return fail('invalid-argument', 'Binding id is required.')
      return call(async () => options.collaborator?.revokeWebsiteBinding ? await options.collaborator.revokeWebsiteBinding(bindingId) : unimplemented<void>())
    },
    async respondToWebsitePairing(event: ProjectChatIpcEvent, raw: unknown) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      const input = pairingResponseInput(raw)
      if (!input) return fail('invalid-argument', 'Pairing response is invalid.')
      return call(async () => options.collaborator?.respondToWebsitePairing ? await options.collaborator.respondToWebsitePairing(input) : unimplemented<void>())
    },
    async initializePermissionMode(event: ProjectChatIpcEvent, legacyMode: unknown) {
      const capability = authorizeMain(event)
      if (!capability.ok) return capability
      return call(async () => {
        const initialized = options.permissionService.initialize(legacyMode)
        if (initialized.persisted) await options.broker.broadcastAllSnapshots(initialized.mode)
        return { ok: true, value: initialized.mode }
      })
    },
    async setPermissionMode(event: ProjectChatIpcEvent, mode: unknown) {
      const capability = authorize(event)
      if (!capability.ok) return capability
      return call(async () => {
        const saved = options.permissionService.set(mode)
        if (!saved.ok) return saved
        await options.broker.broadcastAllSnapshots(saved.value)
        return saved
      })
    },
    async getModelCatalog(event: ProjectChatIpcEvent) {
      const capability = authorize(event)
      if (!capability.ok) return capability
      return call(async () => options.scopedRead?.getModelCatalog
        ? projectModelCatalog(await options.scopedRead.getModelCatalog()) ?? unimplemented<ProjectChatModelCatalog>()
        : unimplemented<ProjectChatModelCatalog>())
    },
    async getAgentContext(event: ProjectChatIpcEvent, rawProjectId: unknown) {
      const projectId = validString(rawProjectId)
      const capability = authorize(event, projectId ?? undefined)
      if (!capability.ok) return capability
      if (!projectId) return fail('invalid-argument', 'Project id is required.')
      return call(async () => options.scopedRead?.getAgentContext
        ? projectAgentContext(await options.scopedRead.getAgentContext(projectId)) ?? unimplemented<ProjectChatAgentContext>()
        : unimplemented<ProjectChatAgentContext>())
    },
    async searchProjectFiles(event: ProjectChatIpcEvent, raw: unknown) {
      const input = searchProjectFilesInput(raw)
      const capability = authorize(event, input?.projectId)
      if (!capability.ok) return capability
      if (!input) return fail('invalid-argument', 'File search input is invalid.')
      return call(async () => options.scopedRead?.searchProjectFiles
        ? projectFileSearchItems(await options.scopedRead.searchProjectFiles(input)) ?? unimplemented<ProjectChatFileSearchItem[]>()
        : unimplemented<ProjectChatFileSearchItem[]>())
    },
    async pickAttachments(event: ProjectChatIpcEvent, raw: unknown) {
      const capability = authorize(event)
      if (!capability.ok) return capability
      const pickerOptions = pickerInput(raw)
      if (pickerOptions === null) return fail('invalid-argument', 'Attachment picker input is invalid.')
      return call(async () => options.scopedRead?.pickAttachments
        ? projectAttachmentSelection(await options.scopedRead.pickAttachments(pickerOptions)) ?? unimplemented<ProjectChatAttachmentSelection>()
        : unimplemented<ProjectChatAttachmentSelection>())
    },
    async readProjectAttachments(event: ProjectChatIpcEvent, raw: unknown) {
      const input = readProjectAttachmentsInput(raw)
      const capability = authorize(event, input?.projectId)
      if (!capability.ok) return capability
      if (!input) return fail('invalid-argument', 'Attachment paths are invalid.')
      return call(async () => options.scopedRead?.readProjectAttachments
        ? projectAttachmentSelection(await options.scopedRead.readProjectAttachments(input)) ?? unimplemented<ProjectChatAttachmentSelection>()
        : unimplemented<ProjectChatAttachmentSelection>())
    },
    async getThreadStatus(event: ProjectChatIpcEvent, raw: unknown) {
      const input = threadStatusInput(raw)
      const capability = authorize(event, input?.projectId)
      if (!capability.ok) return capability
      if (!input) return fail('invalid-argument', 'Thread status input is invalid.')
      return call(async () => options.scopedRead?.getThreadStatus
        ? projectThreadStatus(await options.scopedRead.getThreadStatus(input), input.threadId) ?? unimplemented<ProjectChatThreadStatus>()
        : unimplemented<ProjectChatThreadStatus>())
    },
  }

  const handlers: ProjectChatIpcRouter['handlers'] = {
    [PROJECT_CHAT_INVOKE_CHANNELS.getSnapshot]: (event, payload) => router.getSnapshot(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.createThread]: (event, payload) => router.createThread(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.submitRun]: (event, payload) => router.submitRun(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.forkThread]: (event, payload) => router.forkThread(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.editAndSubmitRun]: (event, payload) => router.editAndSubmitRun(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.archiveThread]: (event, payload) => router.archiveThread(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.setThreadPinned]: (event, payload) => router.setThreadPinned(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.setThreadModel]: (event, payload) => router.setThreadModel(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.markFileDiffReviewed]: (event, payload) => router.markFileDiffReviewed(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.rewindFileDiff]: (event, payload) => router.rewindFileDiff(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.cancelRun]: (event, payload) => router.cancelRun(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.answerPrompt]: (event, payload) => router.answerPrompt(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.reportPresenceSelection]: (event, payload) => router.reportPresenceSelection(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.openProjectWindow]: (event, payload) => router.openProjectWindow(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.startProjectRuntimeChat]: (event, payload) => router.startProjectRuntimeChat(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.openWorkspaceTabProjectChat]: (event, payload) => router.openWorkspaceTabProjectChat(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.openProjectPreview]: (event, payload) => router.openProjectPreview(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.openProjectPathRecovery]: (event, payload) => router.openProjectPathRecovery(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.getWindowViewState]: (event, payload) => router.getWindowViewState(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.saveWindowViewState]: (event, payload) => router.saveWindowViewState(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.markExternalTasksSeen]: (event, payload) => isRecord(payload) ? router.markExternalTasksSeen(event, payload.projectId, payload.seenAt) : router.markExternalTasksSeen(event, undefined, undefined),
    [PROJECT_CHAT_INVOKE_CHANNELS.listWebsiteBindings]: (event) => router.listWebsiteBindings(event),
    [PROJECT_CHAT_INVOKE_CHANNELS.revokeWebsiteBinding]: (event, payload) => router.revokeWebsiteBinding(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.respondToWebsitePairing]: (event, payload) => router.respondToWebsitePairing(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.initializePermissionMode]: (event, payload) => router.initializePermissionMode(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.setPermissionMode]: (event, payload) => router.setPermissionMode(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.getModelCatalog]: (event) => router.getModelCatalog(event),
    [PROJECT_CHAT_INVOKE_CHANNELS.getAgentContext]: (event, payload) => router.getAgentContext(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.searchProjectFiles]: (event, payload) => router.searchProjectFiles(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.pickAttachments]: (event, payload) => router.pickAttachments(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.readProjectAttachments]: (event, payload) => router.readProjectAttachments(event, payload),
    [PROJECT_CHAT_INVOKE_CHANNELS.getThreadStatus]: (event, payload) => router.getThreadStatus(event, payload),
  }
  return { ...router, handlers }
}

function createThreadInput(raw: unknown): CreateProjectThreadInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const title = validString(raw.title)
  if (!projectId || !title) return null
  if (raw.source === 'user' || raw.source === 'app-command') {
    if (raw.purpose !== undefined && (raw.source !== 'user' || raw.purpose !== 'home-plugin-card-customization' || raw.skill !== undefined)) return null
    if (raw.skill === undefined) return { projectId, title, source: raw.source, ...(raw.purpose ? { purpose: 'home-plugin-card-customization' as const } : {}) }
    if (raw.source !== 'user' || !isRecord(raw.skill)) return null
    const path = validString(raw.skill.path)
    const command = validString(raw.skill.command)
    const skillTitle = validString(raw.skill.title)
    if (!path || !command || !skillTitle) return null
    return { projectId, title, source: raw.source, skill: { path, command, title: skillTitle } }
  }
  if (raw.source !== 'website') return null
  const idempotencyKey = validString(raw.idempotencyKey)
  const bindingId = validString(raw.bindingId)
  if (!idempotencyKey || !bindingId || !isFiniteNumber(raw.receivedAt)) return null
  return { projectId, title, source: 'website', idempotencyKey, bindingId, receivedAt: raw.receivedAt }
}

function submitRunInput(raw: unknown): SubmitProjectRunInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const threadId = validString(raw.threadId)
  if (!projectId || !threadId || typeof raw.text !== 'string') return null
  let attachments: ProjectChatAttachment[] | undefined
  if (raw.attachments !== undefined) {
    const parsedAttachments = chatAttachments(raw.attachments)
    if (!parsedAttachments) return null
    attachments = parsedAttachments
  }
  let modelPick: ChatModelPick | undefined
  if (raw.modelPick !== undefined) {
    const parsedModelPick = chatModelPick(raw.modelPick)
    if (!parsedModelPick) return null
    modelPick = parsedModelPick
  }
  if (raw.handoffContext !== undefined && typeof raw.handoffContext !== 'string') return null
  return { projectId, threadId, text: raw.text, attachments, modelPick, handoffContext: raw.handoffContext as string | undefined }
}

function cancelRunInput(raw: unknown): CancelProjectRunInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const threadId = validString(raw.threadId)
  const requestId = validString(raw.requestId)
  if (!projectId || !threadId || !requestId || !isGeneration(raw.routeGeneration)) return null
  return { projectId, threadId, requestId, routeGeneration: raw.routeGeneration }
}

function commandBase(raw: unknown): { projectId: string; threadId: string; routeGeneration: number } | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const threadId = validString(raw.threadId)
  return projectId && threadId && isGeneration(raw.routeGeneration) ? { projectId, threadId, routeGeneration: raw.routeGeneration } : null
}
function forkThreadInput(raw: unknown): ForkProjectThreadInput | null { const base = commandBase(raw); const messageId = isRecord(raw) ? validString(raw.messageId) : null; return base && messageId ? { ...base, messageId } : null }
function editAndSubmitInput(raw: unknown): EditAndSubmitProjectRunInput | null {
  const base = commandBase(raw); const messageId = isRecord(raw) ? validString(raw.messageId) : null
  if (!base || !messageId || !isRecord(raw) || typeof raw.text !== 'string') return null
  if (raw.modelPick !== undefined && !chatModelPick(raw.modelPick)) return null
  return { ...base, messageId, text: raw.text, ...(raw.modelPick === undefined ? {} : { modelPick: chatModelPick(raw.modelPick)! }) }
}
function archiveThreadInput(raw: unknown): ArchiveProjectThreadInput | null { return commandBase(raw) }
function setPinnedInput(raw: unknown): SetProjectThreadPinnedInput | null { const base = commandBase(raw); return base && isRecord(raw) && typeof raw.pinned === 'boolean' ? { ...base, pinned: raw.pinned } : null }
function setModelInput(raw: unknown): SetProjectThreadModelInput | null { const base = commandBase(raw); const modelPick = isRecord(raw) ? chatModelPick(raw.modelPick) : null; return base && modelPick ? { ...base, modelPick } : null }
function markDiffReviewedInput(raw: unknown): MarkProjectFileDiffReviewedInput | null { const base = commandBase(raw); const changeSetId = isRecord(raw) ? validString(raw.changeSetId) : null; return base && changeSetId ? { ...base, changeSetId } : null }
function rewindFileDiffInput(raw: unknown): RewindProjectFileDiffInput | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !['projectId', 'threadId', 'changeSetId', 'routeGeneration'].includes(key))) return null
  const base = commandBase(raw); const changeSetId = validString(raw.changeSetId)
  return base && changeSetId ? { ...base, changeSetId } : null
}

function presenceSelectionInput(raw: unknown): ReportProjectChatPresenceInput | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'projectId' && key !== 'selectedThreadId')) return null
  const projectId = validString(raw.projectId)
  if (!projectId || (raw.selectedThreadId !== undefined && !validString(raw.selectedThreadId))) return null
  return { projectId, ...(raw.selectedThreadId === undefined ? {} : { selectedThreadId: validString(raw.selectedThreadId)! }) }
}

function answerPromptInput(raw: unknown): AnswerProjectPromptInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const threadId = validString(raw.threadId)
  const requestId = validString(raw.requestId)
  const promptId = validString(raw.promptId)
  const response = permissionResponse(raw.response)
  if (!projectId || !threadId || !requestId || !promptId || !response || response.permissionRequestId !== promptId || !isGeneration(raw.routeGeneration)) return null
  return { projectId, threadId, requestId, promptId, routeGeneration: raw.routeGeneration, response }
}

function saveWindowViewStateInput(raw: unknown): SaveProjectChatWindowViewStateInput | null {
  if (!isRecord(raw) || !isRecord(raw.patch)) return null
  const projectId = validString(raw.projectId)
  if (!projectId) return null
  const patch: SaveProjectChatWindowViewStateInput['patch'] = {}
  if (raw.patch.selectedThreadId !== undefined) {
    const selectedThreadId = validString(raw.patch.selectedThreadId)
    if (!selectedThreadId) return null
    patch.selectedThreadId = selectedThreadId
  }
  if (raw.patch.draft !== undefined) {
    if (typeof raw.patch.draft !== 'string') return null
    patch.draft = raw.patch.draft
  }
  if (raw.patch.externalTaskSeenAt !== undefined) {
    if (!isFiniteNumber(raw.patch.externalTaskSeenAt)) return null
    patch.externalTaskSeenAt = raw.patch.externalTaskSeenAt
  }
  if (raw.patch.bounds !== undefined) {
    const bounds = windowBounds(raw.patch.bounds)
    if (!bounds) return null
    patch.bounds = bounds
  }
  return { projectId, patch }
}

const MAX_ATTACHMENTS = 8
const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024
const MAX_ATTACHMENT_ID_LENGTH = 256
const MAX_ATTACHMENT_NAME_LENGTH = 255
const MAX_ATTACHMENT_PREVIEW_LENGTH = 160
const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_ATTACHMENT_BYTES / 3)

function chatAttachments(raw: unknown): ProjectChatAttachment[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null
  const attachments: ProjectChatAttachment[] = []
  let totalBytes = 0
  for (const item of raw) {
    const parsed = projectAttachment(item)
    if (!parsed || totalBytes + parsed.bytes > MAX_TOTAL_ATTACHMENT_BYTES) return null
    totalBytes += parsed.bytes
    attachments.push(parsed.attachment)
  }
  return attachments
}

function searchProjectFilesInput(raw: unknown): SearchProjectChatFilesInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  return projectId && typeof raw.query === 'string' ? { projectId, query: raw.query } : null
}

function pickerInput(raw: unknown): { allowImages?: boolean } | undefined | null {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'allowImages')) return null
  if (raw.allowImages !== undefined && typeof raw.allowImages !== 'boolean') return null
  return raw.allowImages === undefined ? {} : { allowImages: raw.allowImages }
}

function readProjectAttachmentsInput(raw: unknown): ReadProjectChatAttachmentsInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  if (!projectId || !Array.isArray(raw.relativePaths) || raw.relativePaths.length === 0 || raw.relativePaths.length > 8) return null
  if (raw.allowImages !== undefined && typeof raw.allowImages !== 'boolean') return null
  const relativePaths = raw.relativePaths.map(normalizeProjectChatRelativePath)
  if (relativePaths.some((relativePath) => relativePath === null)) return null
  return { projectId, relativePaths: relativePaths as string[], ...(raw.allowImages === undefined ? {} : { allowImages: raw.allowImages }) }
}

function threadStatusInput(raw: unknown): GetProjectChatThreadStatusInput | null {
  if (!isRecord(raw)) return null
  const projectId = validString(raw.projectId)
  const threadId = validString(raw.threadId)
  return projectId && threadId ? { projectId, threadId } : null
}

function projectModelCatalog(raw: unknown): ProjectChatResult<ProjectChatModelCatalog> | null {
  if (!isRecord(raw) || !isString(raw.activeProviderId) || !isString(raw.activeAnthropicModel) || !Array.isArray(raw.providers)) return null
  const providers = raw.providers.map(projectModelProvider)
  return providers.every((provider) => provider !== null) ? { ok: true, value: { activeProviderId: raw.activeProviderId, activeAnthropicModel: raw.activeAnthropicModel, providers: providers as ProjectChatModelCatalog['providers'] } } : null
}

function projectModelProvider(raw: unknown): ProjectChatModelCatalog['providers'][number] | null {
  if (!isRecord(raw) || !isString(raw.id) || !isString(raw.name) || !isString(raw.model) || !isBoolean(raw.modelSupportsImages) || !isString(raw.defaultHaikuModel) || !isBoolean(raw.defaultHaikuSupportsImages) || !isString(raw.defaultOpusModel) || !isBoolean(raw.defaultOpusSupportsImages) || !isString(raw.defaultSonnetModel) || !isBoolean(raw.defaultSonnetSupportsImages)) return null
  return { id: raw.id, name: raw.name, model: raw.model, modelSupportsImages: raw.modelSupportsImages, defaultHaikuModel: raw.defaultHaikuModel, defaultHaikuSupportsImages: raw.defaultHaikuSupportsImages, defaultOpusModel: raw.defaultOpusModel, defaultOpusSupportsImages: raw.defaultOpusSupportsImages, defaultSonnetModel: raw.defaultSonnetModel, defaultSonnetSupportsImages: raw.defaultSonnetSupportsImages }
}

function projectAgentContext(raw: unknown): ProjectChatResult<ProjectChatAgentContext> | null {
  if (!isRecord(raw) || !Array.isArray(raw.skills) || !Array.isArray(raw.agents)) return null
  const skills = raw.skills.map(projectSkill)
  const agents = raw.agents.map(projectAgent)
  return skills.every((item) => item !== null) && agents.every((item) => item !== null) ? { ok: true, value: { skills: skills as ProjectChatAgentContext['skills'], agents: agents as ProjectChatAgentContext['agents'] } } : null
}

function projectSkill(raw: unknown): ProjectChatAgentContext['skills'][number] | null {
  if (!isRecord(raw) || (raw.kind !== 'skill' && raw.kind !== 'command') || !isString(raw.name) || !isString(raw.command) || !isString(raw.title) || !isString(raw.description) || !isString(raw.argumentHint) || !isString(raw.relativePath) || (raw.scope !== 'user' && raw.scope !== 'project') || !isSource(raw.source) || !isBoolean(raw.native)) return null
  const relativePath = normalizeProjectChatRelativePath(raw.relativePath)
  return relativePath ? { kind: raw.kind, name: raw.name, command: raw.command, title: raw.title, description: raw.description, argumentHint: raw.argumentHint, relativePath, scope: raw.scope, source: raw.source, native: raw.native } : null
}

function projectAgent(raw: unknown): ProjectChatAgentContext['agents'][number] | null {
  if (!isRecord(raw) || raw.kind !== 'agent' || !isString(raw.name) || !isString(raw.description) || !isString(raw.relativePath) || (raw.scope !== 'user' && raw.scope !== 'project') || !isSource(raw.source) || !isBoolean(raw.native) || !stringArray(raw.tools) || (raw.model !== undefined && !isString(raw.model))) return null
  const relativePath = normalizeProjectChatRelativePath(raw.relativePath)
  return relativePath ? { kind: 'agent', name: raw.name, description: raw.description, relativePath, scope: raw.scope, source: raw.source, native: raw.native, ...(raw.model === undefined ? {} : { model: raw.model }), tools: raw.tools } : null
}

function projectFileSearchItems(raw: unknown): ProjectChatResult<ProjectChatFileSearchItem[]> | null {
  if (!Array.isArray(raw)) return null
  const items = raw.map((item) => {
    if (!isRecord(item) || !isString(item.label) || !isString(item.relativePath) || (item.type !== 'file' && item.type !== 'directory')) return null
    const relativePath = normalizeProjectChatRelativePath(item.relativePath)
    return relativePath ? { label: item.label, relativePath, type: item.type } : null
  })
  return items.every((item) => item !== null) ? { ok: true, value: items as ProjectChatFileSearchItem[] } : null
}

function projectAttachmentSelection(raw: unknown): ProjectChatResult<ProjectChatAttachmentSelection> | null {
  if (!isRecord(raw) || !Array.isArray(raw.attachments) || !Array.isArray(raw.skipped)) return null
  const attachments: ProjectChatAttachment[] = []
  const skipped: ProjectChatAttachmentSelection['skipped'] = []
  let totalBytes = 0
  for (const rawAttachment of raw.attachments) {
    const parsed = projectAttachment(rawAttachment)
    if (!parsed || attachments.length >= MAX_ATTACHMENTS || totalBytes + parsed.bytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      skipped.push({ name: safeAttachmentName(rawAttachment), reason: 'Attachment is unavailable.' })
      continue
    }
    totalBytes += parsed.bytes
    attachments.push(parsed.attachment)
  }
  for (const rawSkipped of raw.skipped) skipped.push({ name: safeAttachmentName(rawSkipped), reason: 'Attachment is unavailable.' })
  return { ok: true, value: { attachments, skipped } }
}

function projectAttachment(raw: unknown): { attachment: ProjectChatAttachment; bytes: number } | null {
  if (!isRecord(raw) || (raw.kind !== 'text' && raw.kind !== 'image') || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.mimeType) || raw.id.trim().length > MAX_ATTACHMENT_ID_LENGTH) return null
  const name = projectChatBasename(raw.name)
  if (!name || name.length > MAX_ATTACHMENT_NAME_LENGTH) return null
  const mimeType = raw.mimeType.trim().toLowerCase()
  if ((raw.preview !== undefined && (!isString(raw.preview) || raw.preview.length > MAX_ATTACHMENT_PREVIEW_LENGTH)) || (raw.dataUrl !== undefined && !isString(raw.dataUrl))) return null
  if (raw.kind === 'text') {
    if (!isTextAttachment(name, mimeType) || !isString(raw.text) || raw.base64 !== undefined || raw.dataUrl !== undefined) return null
    if (raw.text.length > MAX_TEXT_ATTACHMENT_BYTES) return null
    const bytes = Buffer.byteLength(raw.text, 'utf8')
    if (bytes > MAX_TEXT_ATTACHMENT_BYTES) return null
    return { attachment: { id: raw.id.trim(), kind: 'text', name, mimeType, size: bytes, text: raw.text, ...(raw.preview === undefined ? {} : { preview: raw.preview }) }, bytes }
  }
  if (!isImageAttachment(name, mimeType) || raw.text !== undefined || !isString(raw.base64) || raw.base64.length > MAX_IMAGE_BASE64_LENGTH) return null
  const content = decodeStrictBase64(raw.base64)
  if (!content || content.byteLength > MAX_IMAGE_ATTACHMENT_BYTES || !matchesImageMime(content, mimeType)) return null
  if (raw.dataUrl !== undefined && raw.dataUrl !== `data:${mimeType};base64,${raw.base64}`) return null
  return { attachment: { id: raw.id.trim(), kind: 'image', name, mimeType, size: content.byteLength, base64: raw.base64, ...(raw.preview === undefined ? {} : { preview: raw.preview }), ...(raw.dataUrl === undefined ? {} : { dataUrl: raw.dataUrl }) }, bytes: content.byteLength }
}

function isTextAttachment(name: string, mimeType: string): boolean {
  return ['text/markdown', 'text/x-markdown', 'text/plain'].includes(mimeType) && /\.(md|markdown|txt)$/i.test(name)
}

function isImageAttachment(name: string, mimeType: string): boolean {
  return (mimeType === 'image/png' && /\.png$/i.test(name)) ||
    (mimeType === 'image/jpeg' && /\.(jpg|jpeg)$/i.test(name)) ||
    (mimeType === 'image/gif' && /\.gif$/i.test(name)) ||
    (mimeType === 'image/webp' && /\.webp$/i.test(name))
}

function decodeStrictBase64(raw: string): Buffer | null {
  if (!raw || raw.length % 4 !== 0) return null
  const paddingStart = raw.indexOf('=')
  const contentLength = paddingStart === -1 ? raw.length : paddingStart
  if (paddingStart !== -1 && (paddingStart < raw.length - 2 || !/^={1,2}$/.test(raw.slice(paddingStart)))) return null
  for (let index = 0; index < contentLength; index += 1) {
    const code = raw.charCodeAt(index)
    const alphanumeric = code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
    if (!alphanumeric && code !== 43 && code !== 47) return null
  }
  const decoded = Buffer.from(raw, 'base64')
  return decoded.toString('base64') === raw ? decoded : null
}

function matchesImageMime(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8
  if (mimeType === 'image/gif') return bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a'
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

function safeAttachmentName(raw: unknown): string {
  return isRecord(raw) ? projectChatBasename(raw.name) ?? 'Attachment' : 'Attachment'
}

function projectThreadStatus(raw: unknown, expectedThreadId: string): ProjectChatResult<ProjectChatThreadStatus> | null {
  if (!isRecord(raw) || !isString(raw.threadId) || raw.threadId !== expectedThreadId || !isBoolean(raw.active) || !isString(raw.reportedModel) || !isString(raw.permissionMode) || !stringArray(raw.tools) || !stringArray(raw.skills) || !stringArray(raw.slashCommands) || !stringArray(raw.agents) || (raw.requestId !== undefined && !isString(raw.requestId)) || (raw.lastError !== undefined && !isString(raw.lastError)) || (raw.updatedAt !== undefined && !isFiniteNumber(raw.updatedAt))) return null
  const base = { threadId: raw.threadId, active: raw.active, ...(raw.requestId === undefined ? {} : { requestId: raw.requestId }), reportedModel: raw.reportedModel, permissionMode: raw.permissionMode, tools: raw.tools, skills: raw.skills, slashCommands: raw.slashCommands, agents: raw.agents, ...(raw.lastError === undefined ? {} : { lastError: raw.lastError }), ...(raw.updatedAt === undefined ? {} : { updatedAt: raw.updatedAt }) }
  if (raw.contextUsage === undefined) return { ok: true, value: base }
  const contextUsage = projectContextUsage(raw.contextUsage)
  return contextUsage ? { ok: true, value: { ...base, contextUsage } } : null
}

function projectContextUsage(raw: unknown): NonNullable<ProjectChatThreadStatus['contextUsage']> | null {
  if (!isRecord(raw) || !isString(raw.model) || !isFiniteNumber(raw.totalTokens) || !isFiniteNumber(raw.maxTokens) || !isFiniteNumber(raw.rawMaxTokens) || !isFiniteNumber(raw.percentage) || !isBoolean(raw.isAutoCompactEnabled) || !Array.isArray(raw.categories)) return null
  const categories = raw.categories.map((item) => isRecord(item) && isString(item.name) && isFiniteNumber(item.tokens) && isString(item.color) && (item.isDeferred === undefined || isBoolean(item.isDeferred)) ? { name: item.name, tokens: item.tokens, color: item.color, ...(item.isDeferred === undefined ? {} : { isDeferred: item.isDeferred }) } : null)
  if (!categories.every((item) => item !== null)) return null
  const commandUsage = projectCommandUsage(raw.slashCommands)
  const skillUsage = projectSkillUsage(raw.skills)
  const apiUsage = projectApiUsage(raw.apiUsage)
  if ((raw.slashCommands !== undefined && !commandUsage) || (raw.skills !== undefined && !skillUsage) || (raw.apiUsage !== undefined && !apiUsage) || (raw.autoCompactThreshold !== undefined && !isFiniteNumber(raw.autoCompactThreshold))) return null
  const optional: Partial<NonNullable<ProjectChatThreadStatus['contextUsage']>> = {}
  if (raw.autoCompactThreshold !== undefined) optional.autoCompactThreshold = raw.autoCompactThreshold
  if (commandUsage) optional.slashCommands = commandUsage
  if (skillUsage) optional.skills = skillUsage
  if (apiUsage) optional.apiUsage = apiUsage
  return { model: raw.model, totalTokens: raw.totalTokens, maxTokens: raw.maxTokens, rawMaxTokens: raw.rawMaxTokens, percentage: raw.percentage, isAutoCompactEnabled: raw.isAutoCompactEnabled, categories: categories as NonNullable<ProjectChatThreadStatus['contextUsage']>['categories'], ...optional }
}

function projectCommandUsage(raw: unknown): { totalCommands: number; includedCommands: number; tokens: number } | null | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || !isFiniteNumber(raw.totalCommands) || !isFiniteNumber(raw.includedCommands) || !isFiniteNumber(raw.tokens)) return null
  return { totalCommands: raw.totalCommands, includedCommands: raw.includedCommands, tokens: raw.tokens }
}

function projectSkillUsage(raw: unknown): { totalSkills: number; includedSkills: number; tokens: number } | null | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || !isFiniteNumber(raw.totalSkills) || !isFiniteNumber(raw.includedSkills) || !isFiniteNumber(raw.tokens)) return null
  return { totalSkills: raw.totalSkills, includedSkills: raw.includedSkills, tokens: raw.tokens }
}

function projectApiUsage(raw: unknown): { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } | null | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || !isFiniteNumber(raw.inputTokens) || !isFiniteNumber(raw.outputTokens) || !isFiniteNumber(raw.cacheCreationInputTokens) || !isFiniteNumber(raw.cacheReadInputTokens)) return null
  return { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens, cacheCreationInputTokens: raw.cacheCreationInputTokens, cacheReadInputTokens: raw.cacheReadInputTokens }
}

function isString(raw: unknown): raw is string { return typeof raw === 'string' }
function isBoolean(raw: unknown): raw is boolean { return typeof raw === 'boolean' }
function stringArray(raw: unknown): raw is string[] { return Array.isArray(raw) && raw.every(isString) }
function isSource(raw: unknown): raw is 'claude' | 'agent' | 'agents' | 'cursor' { return raw === 'claude' || raw === 'agent' || raw === 'agents' || raw === 'cursor' }

function chatModelPick(raw: unknown): ChatModelPick | null {
  if (!isRecord(raw)) return null
  const providerId = validString(raw.providerId)
  const anthropicModel = validString(raw.anthropicModel)
  return providerId && anthropicModel ? { providerId, anthropicModel } : null
}

function permissionResponse(raw: unknown): ClaudePermissionResponsePayload | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.permissionRequestId)) return null
  if (raw.behavior === 'allow') {
    if (raw.updatedInput !== undefined && !isRecord(raw.updatedInput)) return null
    return { permissionRequestId: raw.permissionRequestId.trim(), behavior: 'allow', ...(raw.updatedInput ? { updatedInput: raw.updatedInput } : {}) }
  }
  if (raw.behavior === 'deny') {
    if (raw.message !== undefined && typeof raw.message !== 'string') return null
    return { permissionRequestId: raw.permissionRequestId.trim(), behavior: 'deny', ...(raw.message !== undefined ? { message: raw.message } : {}) }
  }
  return null
}

function windowBounds(raw: unknown): { x?: number; y?: number; width: number; height: number } | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return null
  if (raw.x !== undefined && !isFiniteNumber(raw.x)) return null
  if (raw.y !== undefined && !isFiniteNumber(raw.y)) return null
  return { ...(raw.x !== undefined ? { x: raw.x } : {}), ...(raw.y !== undefined ? { y: raw.y } : {}), width: raw.width, height: raw.height }
}

function rendererEntryKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    if (url.username || url.password) return null
    return `${url.origin}${url.pathname}`
  } catch { return null }
}

function recordProjectId(raw: unknown): string | null { return isRecord(raw) ? validString(raw.projectId) : null }
function pairingResponseInput(raw: unknown): AgentOSPairingResponse | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.pairingId)) return null
  if (raw.action === 'reject') return { pairingId: raw.pairingId.trim(), action: 'reject' }
  return raw.action === 'accept' && isNonEmptyString(raw.projectId) ? { pairingId: raw.pairingId.trim(), action: 'accept', projectId: raw.projectId.trim() } : null
}
function validString(raw: unknown): string | null { return isNonEmptyString(raw) ? raw.trim() : null }
function isNonEmptyString(raw: unknown): raw is string { return typeof raw === 'string' && raw.trim().length > 0 }
function isFiniteNumber(raw: unknown): raw is number { return typeof raw === 'number' && Number.isFinite(raw) }
function isGeneration(raw: unknown): raw is number { return isFiniteNumber(raw) && Number.isInteger(raw) && raw > 0 }
function isWebContentsId(raw: unknown): raw is number { return isGeneration(raw) }
function isRecord(raw: unknown): raw is Record<string, unknown> { return typeof raw === 'object' && raw !== null && !Array.isArray(raw) }
function isClaudePermissionMode(raw: unknown): raw is ClaudePermissionMode { return raw === 'plan' || raw === 'auto' || raw === 'default' || raw === 'acceptEdits' || raw === 'bypassPermissions' }
function projectResultForRecipient(
  result: ProjectChatResult<ProjectChatInternalSnapshot>,
  recipientWebContentsId: number,
): ProjectChatResult<ProjectChatSnapshot> {
  return result.ok
    ? { ok: true, value: projectSnapshotForRecipient(result.value, recipientWebContentsId) }
    : result
}
function fail<T = never>(code: Parameters<typeof projectChatError>[0], message: string): ProjectChatResult<T> { return { ok: false, error: projectChatError(code, message) } }
