/** Injectable Runtime Chat IPC seam. R3-02 deliberately does not register it in main.ts. */
import type { ChatModelPick } from '../src/claude-chat-types'
import {
  normalizeProjectChatRelativePath,
  projectChatBasename,
  projectChatError,
  type ProjectChatAgentContext,
  type ProjectChatAttachment,
  type ProjectChatAttachmentSelection,
  type ProjectChatFileSearchItem,
  type ProjectChatModelCatalog,
  type ProjectChatResult,
  type ProjectChatThreadStatus,
  type RewindProjectFileDiffResult,
} from '../src/project-chat-contract'
import {
  parseRuntimeScopeId,
  type AnswerRuntimeChatPromptInput,
  type CancelRuntimeChatRunInput,
  type CreateRuntimeChatThreadInput,
  type EditAndSubmitRuntimeChatRunInput,
  type ForkRuntimeChatThreadInput,
  type ReadRuntimeChatAttachmentsInput,
  type RuntimeChatAuthority,
  type RuntimeChatDiffInput,
  type RuntimeChatEvent,
  type RuntimeChatInternalEvent,
  type RuntimeChatInternalSnapshot,
  type RuntimeChatSnapshot,
  type RuntimeChatThreadInput,
  type RuntimeDevelopmentWindowContext,
  type RuntimeDevelopmentWindowViewState,
  type SaveRuntimeDevelopmentWindowViewStateInput,
  type ReportRuntimeChatPresenceInput,
  type RuntimeScopeId,
  type SearchRuntimeChatFilesInput,
  type SetRuntimeChatThreadModelInput,
  type SetRuntimeChatThreadPinnedInput,
  type SubmitRuntimeChatRunInput,
} from '../src/runtime-development-contract'
import { RendererCapabilityRegistry, type ProjectChatIpcEvent, type RuntimeDevelopmentCapability } from './project-chat-ipc'

export const RUNTIME_CHAT_INVOKE_CHANNELS = {
  getSnapshot: 'runtime-chat:get-snapshot', createThread: 'runtime-chat:create-thread', submitRun: 'runtime-chat:submit-run',
  forkThread: 'runtime-chat:fork-thread', editAndSubmitRun: 'runtime-chat:edit-and-submit-run', archiveThread: 'runtime-chat:archive-thread',
  setThreadPinned: 'runtime-chat:set-thread-pinned', setThreadModel: 'runtime-chat:set-thread-model', markFileDiffReviewed: 'runtime-chat:mark-file-diff-reviewed',
  rewindFileDiff: 'runtime-chat:rewind-file-diff', cancelRun: 'runtime-chat:cancel-run', answerPrompt: 'runtime-chat:answer-prompt',
  getModelCatalog: 'runtime-chat:get-model-catalog', getAgentContext: 'runtime-chat:get-agent-context', searchFiles: 'runtime-chat:search-files',
  pickAttachments: 'runtime-chat:pick-attachments', readAttachments: 'runtime-chat:read-attachments', getThreadStatus: 'runtime-chat:get-thread-status',
  getWindowContext: 'runtime-chat:get-window-context', getWindowViewState: 'runtime-chat:get-window-view-state', saveWindowViewState: 'runtime-chat:save-window-view-state',
  reportPresenceSelection: 'runtime-chat:report-presence-selection',
} as const

export type RuntimeChatBrokerPort = {
  getSnapshot(authority: RuntimeChatAuthority): Promise<ProjectChatResult<RuntimeChatInternalSnapshot>>
  createThread(authority: RuntimeChatAuthority, input: CreateRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>>
  submitRun(authority: RuntimeChatAuthority, input: SubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>>
  forkThread(authority: RuntimeChatAuthority, input: ForkRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>>
  editAndSubmitRun(authority: RuntimeChatAuthority, input: EditAndSubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>>
  archiveThread(authority: RuntimeChatAuthority, input: RuntimeChatThreadInput): Promise<ProjectChatResult<void>>
  setThreadPinned(authority: RuntimeChatAuthority, input: SetRuntimeChatThreadPinnedInput): Promise<ProjectChatResult<void>>
  setThreadModel(authority: RuntimeChatAuthority, input: SetRuntimeChatThreadModelInput): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(authority: RuntimeChatAuthority, input: RuntimeChatDiffInput): Promise<ProjectChatResult<void>>
  rewindFileDiff(authority: RuntimeChatAuthority, input: RuntimeChatDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>>
  cancelRun(authority: RuntimeChatAuthority, input: CancelRuntimeChatRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(authority: RuntimeChatAuthority, input: AnswerRuntimeChatPromptInput): Promise<ProjectChatResult<void>>
  routeGenerationOf(runtimeScopeId: RuntimeScopeId): number
  developmentGenerationOf(runtimeScopeId: RuntimeScopeId): number
}

export type RuntimeChatScopedReadCollaborator = {
  getModelCatalog?(): Promise<unknown>
  getAgentContext?(runtimeScopeId: RuntimeScopeId): Promise<unknown>
  searchFiles?(runtimeScopeId: RuntimeScopeId, input: SearchRuntimeChatFilesInput): Promise<unknown>
  pickAttachments?(options?: { allowImages?: boolean }): Promise<unknown>
  readAttachments?(runtimeScopeId: RuntimeScopeId, input: ReadRuntimeChatAttachmentsInput): Promise<unknown>
  getThreadStatus?(runtimeScopeId: RuntimeScopeId, input: RuntimeChatThreadInput): Promise<unknown>
}

export type RuntimeChatWindowCollaborator = {
  getWindowContext(webContentsId: number): Promise<ProjectChatResult<RuntimeDevelopmentWindowContext>>
  getWindowViewState(runtimeScopeId: RuntimeScopeId): Promise<ProjectChatResult<RuntimeDevelopmentWindowViewState>>
  saveWindowViewState(runtimeScopeId: RuntimeScopeId, input: SaveRuntimeDevelopmentWindowViewStateInput): Promise<ProjectChatResult<RuntimeDevelopmentWindowViewState>>
  reportPresenceSelection(webContentsId: number, runtimeScopeId: RuntimeScopeId, input: ReportRuntimeChatPresenceInput): ProjectChatResult<void>
}

export type RuntimeChatIpcRouterOptions = { broker: RuntimeChatBrokerPort; capabilities: RendererCapabilityRegistry; rendererEntries: readonly string[]; scopedRead?: RuntimeChatScopedReadCollaborator; window?: RuntimeChatWindowCollaborator }

export function createRuntimeChatCapabilityBroadcaster(capabilities: RendererCapabilityRegistry, deliver: (webContentsId: number, event: RuntimeChatEvent) => void): (event: RuntimeChatInternalEvent) => void {
  return (event) => {
    for (const capability of capabilities.runtimeRecipientsFor(event)) deliver(capability.webContentsId, runtimeEventForRecipient(event, capability.webContentsId))
  }
}

export function runtimeSnapshotForRecipient(snapshot: RuntimeChatInternalSnapshot, recipientWebContentsId: number): RuntimeChatSnapshot {
  return { ...snapshot, pendingPrompts: snapshot.pendingPrompts.map(({ ownerWebContentsId, ...prompt }) => ({ ...prompt, isOwnedByCaller: ownerWebContentsId === recipientWebContentsId })) }
}

function runtimeEventForRecipient(event: RuntimeChatInternalEvent, recipientWebContentsId: number): RuntimeChatEvent {
  return { ...event, snapshot: runtimeSnapshotForRecipient(event.snapshot, recipientWebContentsId) }
}

export function createRuntimeChatIpcRouter(options: RuntimeChatIpcRouterOptions) {
  const entries = new Set(options.rendererEntries.map(rendererEntryKey).filter((item): item is string => item !== null))
  const authorize = (event: ProjectChatIpcEvent): ProjectChatResult<RuntimeDevelopmentCapability> => {
    const id = event.sender?.id
    if (!isPositiveInteger(id) || event.senderFrame === undefined || event.senderFrame !== event.sender?.mainFrame || !entries.has(rendererEntryKey(event.senderFrame.url) ?? '')) { console.error('[runtime-chat/ipc] fail', { operation: 'authorize', code: 'sender-not-authorized' }); return fail('sender-not-authorized', 'Sender is not authorized.') }
    const capability = options.capabilities.get(id)
    if (capability?.kind !== 'runtime-development') { console.error('[runtime-chat/ipc] fail', { operation: 'authorize', code: 'sender-not-authorized' }); return fail('sender-not-authorized', 'Sender is not authorized.') }
    if (capability.routeGeneration !== options.broker.routeGenerationOf(capability.runtimeScopeId) || capability.developmentGeneration !== options.broker.developmentGenerationOf(capability.runtimeScopeId)) { console.error('[runtime-chat/ipc] fail', { operation: 'authorize', scopeKind: parseRuntimeScopeId(capability.runtimeScopeId)?.kind ?? 'invalid', code: 'sender-not-authorized' }); return fail('sender-not-authorized', 'Sender is not authorized.') }
    return { ok: true, value: capability }
  }
  const authority = (capability: RuntimeDevelopmentCapability): RuntimeChatAuthority => ({ runtimeScopeId: capability.runtimeScopeId, routeGeneration: capability.routeGeneration, developmentGeneration: capability.developmentGeneration, ownerWebContentsId: capability.webContentsId })
  const call = async <T>(operation: string, capability: RuntimeDevelopmentCapability, action: () => Promise<ProjectChatResult<T>>): Promise<ProjectChatResult<T>> => {
    const scopeKind = parseRuntimeScopeId(capability.runtimeScopeId)?.kind ?? 'invalid'
    console.info('[runtime-chat/ipc] enter', { operation, scopeKind })
    try {
      const result = await action()
      if (result.ok) console.info('[runtime-chat/ipc] success', { operation, scopeKind })
      else console.error('[runtime-chat/ipc] fail', { operation, scopeKind, code: result.error.code })
      return result
    } catch {
      console.error('[runtime-chat/ipc] fail', { operation, scopeKind, code: 'internal-error' })
      return fail('internal-error', 'Runtime Chat is temporarily unavailable.')
    }
  }
  const route = async <T, Input>(event: ProjectChatIpcEvent, raw: unknown, parse: (raw: unknown) => Input | null, operation: string, action: (capability: RuntimeDevelopmentCapability, input: Input) => Promise<ProjectChatResult<T>>): Promise<ProjectChatResult<T>> => {
    const authorized = authorize(event); if (!authorized.ok) return authorized
    const input = parse(raw); if (!input) { console.error('[runtime-chat/ipc] fail', { operation, scopeKind: parseRuntimeScopeId(authorized.value.runtimeScopeId)?.kind ?? 'invalid', code: 'invalid-argument' }); return fail('invalid-argument', 'Runtime Chat command input is invalid.') }
    return call(operation, authorized.value, () => action(authorized.value, input))
  }
  const scoped = options.scopedRead

  const router = {
    async getSnapshot(event: ProjectChatIpcEvent, raw?: unknown): Promise<ProjectChatResult<RuntimeChatSnapshot>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      if (raw !== undefined) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('getSnapshot', authorized.value, async () => {
        const result = await options.broker.getSnapshot(authority(authorized.value))
        return result.ok ? { ok: true, value: runtimeSnapshotForRecipient(result.value, authorized.value.webContentsId) } : result
      })
    },
    createThread: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, createThreadInput, 'createThread', (cap, input) => options.broker.createThread(authority(cap), input)),
    submitRun: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, submitRunInput, 'submitRun', (cap, input) => options.broker.submitRun(authority(cap), input)),
    forkThread: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, forkThreadInput, 'forkThread', (cap, input) => options.broker.forkThread(authority(cap), input)),
    editAndSubmitRun: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, editRunInput, 'editAndSubmitRun', (cap, input) => options.broker.editAndSubmitRun(authority(cap), input)),
    archiveThread: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, threadInput, 'archiveThread', (cap, input) => options.broker.archiveThread(authority(cap), input)),
    setThreadPinned: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, pinnedInput, 'setThreadPinned', (cap, input) => options.broker.setThreadPinned(authority(cap), input)),
    setThreadModel: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, modelInput, 'setThreadModel', (cap, input) => options.broker.setThreadModel(authority(cap), input)),
    markFileDiffReviewed: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, diffInput, 'markFileDiffReviewed', (cap, input) => options.broker.markFileDiffReviewed(authority(cap), input)),
    rewindFileDiff: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, diffInput, 'rewindFileDiff', (cap, input) => options.broker.rewindFileDiff(authority(cap), input)),
    cancelRun: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, cancelInput, 'cancelRun', (cap, input) => options.broker.cancelRun(authority(cap), input)),
    answerPrompt: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, answerInput, 'answerPrompt', (cap, input) => options.broker.answerPrompt(authority(cap), input)),
    async getModelCatalog(event: ProjectChatIpcEvent, raw?: unknown): Promise<ProjectChatResult<ProjectChatModelCatalog>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      if (raw !== undefined || !scoped?.getModelCatalog) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('getModelCatalog', authorized.value, async () => projectModelCatalog(await scoped.getModelCatalog!()))
    },
    async getAgentContext(event: ProjectChatIpcEvent, raw?: unknown): Promise<ProjectChatResult<ProjectChatAgentContext>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      if (raw !== undefined || !scoped?.getAgentContext) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('getAgentContext', authorized.value, async () => projectAgentContext(await scoped.getAgentContext!(authorized.value.runtimeScopeId)))
    },
    searchFiles: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, searchInput, 'searchFiles', async (cap, input) => scoped?.searchFiles ? projectFiles(await scoped.searchFiles(cap.runtimeScopeId, input)) : fail('internal-error', 'Runtime Chat operation is unavailable.')),
    async pickAttachments(event: ProjectChatIpcEvent, raw: unknown): Promise<ProjectChatResult<ProjectChatAttachmentSelection>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      const input = attachmentOptions(raw); if (!input || !scoped?.pickAttachments) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('pickAttachments', authorized.value, async () => projectAttachments(await scoped.pickAttachments!(input)))
    },
    readAttachments: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, readAttachmentsInput, 'readAttachments', async (cap, input) => scoped?.readAttachments ? projectAttachments(await scoped.readAttachments(cap.runtimeScopeId, input)) : fail('internal-error', 'Runtime Chat operation is unavailable.')),
    getThreadStatus: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, threadInput, 'getThreadStatus', async (cap, input) => scoped?.getThreadStatus ? projectThreadStatus(await scoped.getThreadStatus(cap.runtimeScopeId, input), input.threadId) : fail('internal-error', 'Runtime Chat operation is unavailable.')),
    async getWindowContext(event: ProjectChatIpcEvent, raw?: unknown): Promise<ProjectChatResult<RuntimeDevelopmentWindowContext>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      if (raw !== undefined || !options.window) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('getWindowContext', authorized.value, () => options.window!.getWindowContext(authorized.value.webContentsId))
    },
    async getWindowViewState(event: ProjectChatIpcEvent, raw?: unknown): Promise<ProjectChatResult<RuntimeDevelopmentWindowViewState>> {
      const authorized = authorize(event); if (!authorized.ok) return authorized
      if (raw !== undefined || !options.window) return fail('invalid-argument', 'Runtime Chat command input is invalid.')
      return call('getWindowViewState', authorized.value, () => options.window!.getWindowViewState(authorized.value.runtimeScopeId))
    },
    saveWindowViewState: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, saveViewStateInput, 'saveWindowViewState', (cap, input) => options.window ? options.window.saveWindowViewState(cap.runtimeScopeId, input) : Promise.resolve(fail('internal-error', 'Runtime Chat operation is unavailable.'))),
    reportPresenceSelection: (event: ProjectChatIpcEvent, raw: unknown) => route(event, raw, presenceInput, 'reportPresenceSelection', async (cap, input) => options.window ? options.window.reportPresenceSelection(cap.webContentsId, cap.runtimeScopeId, input) : fail('internal-error', 'Runtime Chat operation is unavailable.')),
  }

  const handlers: Record<string, (event: ProjectChatIpcEvent, payload?: unknown) => Promise<ProjectChatResult<unknown>>> = {
    [RUNTIME_CHAT_INVOKE_CHANNELS.getSnapshot]: (event, payload) => router.getSnapshot(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.createThread]: (event, payload) => router.createThread(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.submitRun]: (event, payload) => router.submitRun(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.forkThread]: (event, payload) => router.forkThread(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.editAndSubmitRun]: (event, payload) => router.editAndSubmitRun(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.archiveThread]: (event, payload) => router.archiveThread(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.setThreadPinned]: (event, payload) => router.setThreadPinned(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.setThreadModel]: (event, payload) => router.setThreadModel(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.markFileDiffReviewed]: (event, payload) => router.markFileDiffReviewed(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.rewindFileDiff]: (event, payload) => router.rewindFileDiff(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.cancelRun]: (event, payload) => router.cancelRun(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.answerPrompt]: (event, payload) => router.answerPrompt(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.getModelCatalog]: (event, payload) => router.getModelCatalog(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.getAgentContext]: (event, payload) => router.getAgentContext(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.searchFiles]: (event, payload) => router.searchFiles(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.pickAttachments]: (event, payload) => router.pickAttachments(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.readAttachments]: (event, payload) => router.readAttachments(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.getThreadStatus]: (event, payload) => router.getThreadStatus(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.getWindowContext]: (event, payload) => router.getWindowContext(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.getWindowViewState]: (event, payload) => router.getWindowViewState(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.saveWindowViewState]: (event, payload) => router.saveWindowViewState(event, payload),
    [RUNTIME_CHAT_INVOKE_CHANNELS.reportPresenceSelection]: (event, payload) => router.reportPresenceSelection(event, payload),
  }
  return { ...router, handlers }
}

function createThreadInput(raw: unknown): CreateRuntimeChatThreadInput | null { return exact(raw, ['title']) && string(raw.title) ? { title: raw.title } : null }
function threadInput(raw: unknown): RuntimeChatThreadInput | null { return exact(raw, ['threadId']) && string(raw.threadId) ? { threadId: raw.threadId } : null }
function forkThreadInput(raw: unknown): ForkRuntimeChatThreadInput | null { return exact(raw, ['threadId', 'messageId']) && string(raw.threadId) && string(raw.messageId) ? { threadId: raw.threadId, messageId: raw.messageId } : null }
function submitRunInput(raw: unknown): SubmitRuntimeChatRunInput | null {
  if (!exactOptional(raw, ['threadId', 'text'], ['attachments', 'modelPick', 'handoffContext']) || !string(raw.threadId) || typeof raw.text !== 'string') return null
  const modelPick = raw.modelPick === undefined ? undefined : chatModelPick(raw.modelPick); if (raw.modelPick !== undefined && !modelPick) return null
  const attachments = raw.attachments === undefined ? undefined : chatAttachments(raw.attachments); if (raw.attachments !== undefined && !attachments) return null
  if (raw.handoffContext !== undefined && typeof raw.handoffContext !== 'string') return null
  return { threadId: raw.threadId, text: raw.text, ...(attachments ? { attachments } : {}), ...(modelPick ? { modelPick } : {}), ...(typeof raw.handoffContext === 'string' ? { handoffContext: raw.handoffContext } : {}) }
}
function editRunInput(raw: unknown): EditAndSubmitRuntimeChatRunInput | null { if (!exactOptional(raw, ['threadId', 'messageId', 'text'], ['modelPick']) || !string(raw.threadId) || !string(raw.messageId) || typeof raw.text !== 'string') return null; const modelPick = raw.modelPick === undefined ? undefined : chatModelPick(raw.modelPick); return raw.modelPick !== undefined && !modelPick ? null : { threadId: raw.threadId, messageId: raw.messageId, text: raw.text, ...(modelPick ? { modelPick } : {}) } }
function pinnedInput(raw: unknown): SetRuntimeChatThreadPinnedInput | null { return exact(raw, ['threadId', 'pinned']) && string(raw.threadId) && typeof raw.pinned === 'boolean' ? { threadId: raw.threadId, pinned: raw.pinned } : null }
function modelInput(raw: unknown): SetRuntimeChatThreadModelInput | null { const modelPick = record(raw) ? chatModelPick(raw.modelPick) : null; return exact(raw, ['threadId', 'modelPick']) && string(raw.threadId) && modelPick ? { threadId: raw.threadId, modelPick } : null }
function diffInput(raw: unknown): RuntimeChatDiffInput | null { return exact(raw, ['threadId', 'changeSetId']) && string(raw.threadId) && string(raw.changeSetId) ? { threadId: raw.threadId, changeSetId: raw.changeSetId } : null }
function cancelInput(raw: unknown): CancelRuntimeChatRunInput | null { return exact(raw, ['threadId', 'requestId']) && string(raw.threadId) && string(raw.requestId) ? { threadId: raw.threadId, requestId: raw.requestId } : null }
function answerInput(raw: unknown): AnswerRuntimeChatPromptInput | null { if (!exact(raw, ['threadId', 'requestId', 'promptId', 'response']) || !string(raw.threadId) || !string(raw.requestId) || !string(raw.promptId) || !record(raw.response) || raw.response.permissionRequestId !== raw.promptId || (raw.response.behavior !== 'allow' && raw.response.behavior !== 'deny')) return null; return { threadId: raw.threadId, requestId: raw.requestId, promptId: raw.promptId, response: raw.response as AnswerRuntimeChatPromptInput['response'] } }
function searchInput(raw: unknown): SearchRuntimeChatFilesInput | null { return exact(raw, ['query']) && typeof raw.query === 'string' ? { query: raw.query } : null }
function attachmentOptions(raw: unknown): { allowImages?: boolean } | null { return raw === undefined ? {} : exactOptional(raw, [], ['allowImages']) && (raw.allowImages === undefined || typeof raw.allowImages === 'boolean') ? { allowImages: raw.allowImages as boolean | undefined } : null }
function readAttachmentsInput(raw: unknown): ReadRuntimeChatAttachmentsInput | null { if (!exactOptional(raw, ['relativePaths'], ['allowImages']) || !Array.isArray(raw.relativePaths) || !raw.relativePaths.every(string) || (raw.allowImages !== undefined && typeof raw.allowImages !== 'boolean')) return null; return { relativePaths: raw.relativePaths, allowImages: raw.allowImages as boolean | undefined } }
function saveViewStateInput(raw: unknown): SaveRuntimeDevelopmentWindowViewStateInput | null { if (!exact(raw, ['patch']) || !record(raw.patch) || Object.keys(raw.patch).some((key) => !['selectedThreadId', 'draft', 'bounds'].includes(key))) return null; const patch = raw.patch; if (patch.selectedThreadId !== undefined && typeof patch.selectedThreadId !== 'string') return null; if (patch.draft !== undefined && typeof patch.draft !== 'string') return null; if (patch.bounds !== undefined && (!record(patch.bounds) || typeof patch.bounds.width !== 'number' || typeof patch.bounds.height !== 'number' || (patch.bounds.x !== undefined && typeof patch.bounds.x !== 'number') || (patch.bounds.y !== undefined && typeof patch.bounds.y !== 'number'))) return null; return { patch: patch as SaveRuntimeDevelopmentWindowViewStateInput['patch'] } }
function presenceInput(raw: unknown): ReportRuntimeChatPresenceInput | null { return exactOptional(raw, [], ['selectedThreadId']) && (raw.selectedThreadId === undefined || typeof raw.selectedThreadId === 'string') ? { selectedThreadId: raw.selectedThreadId as string | undefined } : null }

function chatModelPick(raw: unknown): ChatModelPick | null { return exact(raw, ['providerId', 'anthropicModel']) && string(raw.providerId) && string(raw.anthropicModel) ? { providerId: raw.providerId, anthropicModel: raw.anthropicModel } : null }
function chatAttachments(raw: unknown): ProjectChatAttachment[] | null { if (!Array.isArray(raw) || raw.length > 8) return null; const items = raw.map(chatAttachment); return items.some((item) => item === null) ? null : items as ProjectChatAttachment[] }
function chatAttachment(raw: unknown): ProjectChatAttachment | null { if (!record(raw) || !string(raw.id) || (raw.kind !== 'text' && raw.kind !== 'image') || !string(raw.name) || !string(raw.mimeType) || typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size < 0) return null; const allowed = raw.kind === 'text' ? ['id', 'kind', 'name', 'mimeType', 'size', 'text', 'preview'] : ['id', 'kind', 'name', 'mimeType', 'size', 'base64', 'preview', 'dataUrl']; if (Object.keys(raw).some((key) => !allowed.includes(key))) return null; return raw as ProjectChatAttachment }

function projectModelCatalog(raw: unknown): ProjectChatResult<ProjectChatModelCatalog> { if (!record(raw) || !string(raw.activeProviderId) || !string(raw.activeAnthropicModel) || !Array.isArray(raw.providers)) return fail('internal-error', 'Runtime Chat operation is unavailable.'); const providers = raw.providers.flatMap((item) => record(item) && string(item.id) && string(item.name) && string(item.model) && typeof item.modelSupportsImages === 'boolean' && string(item.defaultHaikuModel) && typeof item.defaultHaikuSupportsImages === 'boolean' && string(item.defaultOpusModel) && typeof item.defaultOpusSupportsImages === 'boolean' && string(item.defaultSonnetModel) && typeof item.defaultSonnetSupportsImages === 'boolean' ? [{ id: item.id, name: item.name, model: item.model, modelSupportsImages: item.modelSupportsImages, defaultHaikuModel: item.defaultHaikuModel, defaultHaikuSupportsImages: item.defaultHaikuSupportsImages, defaultOpusModel: item.defaultOpusModel, defaultOpusSupportsImages: item.defaultOpusSupportsImages, defaultSonnetModel: item.defaultSonnetModel, defaultSonnetSupportsImages: item.defaultSonnetSupportsImages }] : []); return providers.length === raw.providers.length ? { ok: true, value: { activeProviderId: raw.activeProviderId, activeAnthropicModel: raw.activeAnthropicModel, providers } } : fail('internal-error', 'Runtime Chat operation is unavailable.') }
function projectAgentContext(raw: unknown): ProjectChatResult<ProjectChatAgentContext> {
  if (!record(raw) || !Array.isArray(raw.skills) || !Array.isArray(raw.agents)) return fail('internal-error', 'Runtime Chat operation is unavailable.')
  const skills: ProjectChatAgentContext['skills'] = raw.skills.flatMap((item) => {
    if (!record(item) || (item.kind !== 'skill' && item.kind !== 'command') || !string(item.name) || typeof item.command !== 'string' || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.argumentHint !== 'string' || (item.scope !== 'user' && item.scope !== 'project') || !agentSource(item.source) || typeof item.native !== 'boolean') return []
    const relativePath = normalizeProjectChatRelativePath(item.relativePath); return relativePath ? [{ kind: item.kind, name: item.name, command: item.command, title: item.title, description: item.description, argumentHint: item.argumentHint, relativePath, scope: item.scope, source: item.source, native: item.native }] : []
  })
  const agents: ProjectChatAgentContext['agents'] = raw.agents.flatMap((item) => {
    if (!record(item) || item.kind !== 'agent' || !string(item.name) || typeof item.description !== 'string' || (item.scope !== 'user' && item.scope !== 'project') || !agentSource(item.source) || typeof item.native !== 'boolean' || !Array.isArray(item.tools) || !item.tools.every((tool) => typeof tool === 'string')) return []
    const relativePath = normalizeProjectChatRelativePath(item.relativePath); return relativePath ? [{ kind: 'agent', name: item.name, description: item.description, relativePath, scope: item.scope, source: item.source, native: item.native, ...(typeof item.model === 'string' ? { model: item.model } : {}), tools: item.tools as string[] }] : []
  })
  return skills.length === raw.skills.length && agents.length === raw.agents.length ? { ok: true, value: { skills, agents } } : fail('internal-error', 'Runtime Chat operation is unavailable.')
}
function projectFiles(raw: unknown): ProjectChatResult<ProjectChatFileSearchItem[]> { const values = record(raw) && raw.ok === true && Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : null; if (!values) return fail('internal-error', 'Runtime Chat operation is unavailable.'); const items: ProjectChatFileSearchItem[] = values.flatMap((item) => { if (!record(item) || !string(item.label) || (item.type !== 'file' && item.type !== 'directory')) return []; const relativePath = normalizeProjectChatRelativePath(item.relativePath); return relativePath ? [{ label: item.label, relativePath, type: item.type }] : [] }); return items.length === values.length ? { ok: true, value: items } : fail('internal-error', 'Runtime Chat operation is unavailable.') }
function projectAttachments(raw: unknown): ProjectChatResult<ProjectChatAttachmentSelection> { if (!record(raw) || !Array.isArray(raw.attachments) || !Array.isArray(raw.skipped)) return fail('internal-error', 'Runtime Chat operation is unavailable.'); const attachments = chatAttachments(raw.attachments); if (!attachments) return fail('internal-error', 'Runtime Chat operation is unavailable.'); const skipped = raw.skipped.map((item) => ({ name: record(item) ? projectChatBasename(item.name) ?? 'Attachment' : 'Attachment', reason: 'Attachment is unavailable.' })); return { ok: true, value: { attachments, skipped } } }
function projectThreadStatus(raw: unknown, threadId: string): ProjectChatResult<ProjectChatThreadStatus> { if (!record(raw) || raw.threadId !== threadId || typeof raw.active !== 'boolean') return fail('internal-error', 'Runtime Chat operation is unavailable.'); const requestId = typeof raw.requestId === 'string' ? raw.requestId : undefined; const reportedModel = typeof raw.reportedModel === 'string' ? raw.reportedModel : ''; const permissionMode = typeof raw.permissionMode === 'string' ? raw.permissionMode : ''; return { ok: true, value: { threadId, active: raw.active, requestId, reportedModel, permissionMode, tools: strings(raw.tools), skills: strings(raw.skills), slashCommands: strings(raw.slashCommands), agents: strings(raw.agents) } } }

function fail(code: Parameters<typeof projectChatError>[0], message: string): ProjectChatResult<never> { return { ok: false, error: projectChatError(code, message) } }
function rendererEntryKey(raw: unknown): string | null { if (typeof raw !== 'string') return null; try { const url = new URL(raw); return url.protocol === 'file:' ? `${url.protocol}//${url.host}${url.pathname}` : `${url.protocol}//${url.host}${url.pathname}` } catch { return null } }
function record(raw: unknown): raw is Record<string, unknown> { return raw !== null && typeof raw === 'object' && !Array.isArray(raw) }
function string(raw: unknown): raw is string { return typeof raw === 'string' && raw.trim().length > 0 }
function strings(raw: unknown): string[] { return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [] }
function agentSource(raw: unknown): raw is 'claude' | 'agent' | 'agents' | 'cursor' { return raw === 'claude' || raw === 'agent' || raw === 'agents' || raw === 'cursor' }
function exact(raw: unknown, keys: string[]): raw is Record<string, unknown> { return record(raw) && Object.keys(raw).length === keys.length && keys.every((key) => key in raw) }
function exactOptional(raw: unknown, required: string[], optional: string[]): raw is Record<string, unknown> { return record(raw) && required.every((key) => key in raw) && Object.keys(raw).every((key) => required.includes(key) || optional.includes(key)) }
function isPositiveInteger(raw: unknown): raw is number { return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 }
