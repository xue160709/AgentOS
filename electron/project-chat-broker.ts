import type {
  ClaudeChatEvent,
  ClaudeChatSubmitPayload,
  ClaudeFileRewindPayload,
  ClaudeFileRewindResult,
  ClaudePermissionMode,
  ClaudePermissionResponsePayload,
} from '../src/claude-chat-types'
import { randomUUID } from 'node:crypto'
import {
  projectChatError,
  normalizeProjectChatRelativePath,
  projectChatBasename,
  type AnswerProjectPromptInput,
  type ArchiveProjectThreadInput,
  type CancelProjectRunInput,
  type ClaudeChatEventSink,
  type CreateProjectThreadInput,
  type CreateProjectThreadResult,
  type EditAndSubmitProjectRunInput,
  type ForkProjectThreadInput,
  type MarkProjectFileDiffReviewedInput,
  type RewindProjectFileDiffInput,
  type RewindProjectFileDiffResult,
  type ProjectChatInternalEvent,
  type ProjectChatInternalSnapshot,
  type ProjectChatPromptPayload,
  type ProjectChatOwnedPromptSnapshot,
  type ProjectChatResult,
  type ProjectChatRunSnapshot,
  type ProjectChatAttachment,
  type ProjectChatThreadSnapshot,
  type ProjectChatTranscriptItem,
  type SubmitProjectRunInput,
  type SubmitProjectRunResult,
  type SetProjectThreadModelInput,
  type SetProjectThreadPinnedInput,
} from '../src/project-chat-contract'
import { foldChatRunEvent } from '../src/project-chat-reducer'
import type { ChatWorkspaceState, ProjectThreadCreationSource, WorkspaceThread } from '../src/components/types'
import type { RuntimeEditCoordinator, RuntimeEditRunnerHook } from './runtime-edit-coordinator'

export type ProjectChatBrokerStore = {
  read(): ChatWorkspaceState | null
  save(state: ChatWorkspaceState): Promise<ChatWorkspaceState>
}

export type ProjectChatBrokerRunner = {
  submit(payload: ClaudeChatSubmitPayload): { requestId: string } | Promise<{ requestId: string }>
  cancel(requestId?: string): Promise<void>
  answerPermissionRequest(payload: ClaudePermissionResponsePayload): Promise<void>
  resetThread(threadId: string): Promise<void>
  rewindFiles(payload: ClaudeFileRewindPayload): Promise<ClaudeFileRewindResult>
  setRuntimeEditHook?(hook?: RuntimeEditRunnerHook): void
}

/** Main-internal authority only; never crosses the renderer seam. */
export type ProjectChatManagedRunInput = {
  projectId: string
  threadId: string
  title: string
  purpose: 'task-run'
  homePluginSlug: string
  text: string
  promptMode: 'home-plugin-task-run'
  agentModeSettingsOverride: { enabled: true; todoEnabled: boolean }
}

/** Main-derived request context; renderer DTOs cannot opt into Runtime prompting. */
export type ProjectChatRunContext = { projectRuntimePrompt?: boolean }

export type ProjectChatBrokerOptions = {
  store: ProjectChatBrokerStore
  runner: ProjectChatBrokerRunner
  now?: () => number
  createId?: (prefix: string) => string
  broadcast?: (event: ProjectChatInternalEvent) => void
  permissionMode?: () => ClaudePermissionMode
  /** Production injects Main's workspace coordinator; tests may use the local queue. */
  runExclusive?: <T>(operation: () => Promise<T> | T) => Promise<T>
  promptOwnerCandidates?: (input: { projectId: string; threadId: string; routeGeneration: number }) => number[]
  runtimeEditCoordinator?: RuntimeEditCoordinator
  runtimeEditEligible?: (projectId: string) => boolean
  onProjectRunStarting?: (projectId: string, projectRoot: string) => Promise<void> | void
  onProjectRunTerminal?: (projectId: string, projectRoot: string) => Promise<void> | void
}

type RequestRoute = { projectId: string; threadId: string; routeGeneration: number; assistantMessageId?: string }
type PromptOwnerRegistry = Map<string, number[]>

export class ProjectChatBroker implements ClaudeChatEventSink {
  private operationChain: Promise<void> = Promise.resolve()
  private externalOperation: Promise<void> = Promise.resolve()
  private readonly runs = new Map<string, ProjectChatRunSnapshot>()
  private readonly requestRoutes = new Map<string, RequestRoute>()
  private readonly prompts = new Map<string, ProjectChatOwnedPromptSnapshot>()
  private readonly promptOwners: PromptOwnerRegistry = new Map()
  private readonly sequences = new Map<string, number>()
  private readonly routeGenerations = new Map<string, number>()
  private readonly unknownRequestCounts = new Map<string, number>()
  private readonly externalSeenAt = new Map<string, number>()
  private readonly now: () => number
  private readonly createId: (prefix: string) => string
  private readonly broadcast: (event: ProjectChatInternalEvent) => void
  private readonly permissionMode: () => ClaudePermissionMode

  constructor(private readonly options: ProjectChatBrokerOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`)
    this.broadcast = options.broadcast ?? (() => undefined)
    this.permissionMode = options.permissionMode ?? (() => 'auto')
    options.runner.setRuntimeEditHook?.(options.runtimeEditCoordinator)
  }

  async getSnapshot(projectId: string): Promise<ProjectChatResult<ProjectChatInternalSnapshot>> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      if (!state?.projects.some((project) => project.id === projectId)) return this.fail('project-not-found', 'Project not found.')
      return { ok: true, value: this.snapshot(state, projectId) }
    })
  }

  /** View-state remains durable; this only refreshes the safe recipient projection without a workspace write. */
  async refreshExternalUnread(projectId: string, seenAt: number): Promise<void> {
    return this.enqueue(async () => {
      this.externalSeenAt.set(projectId, Number.isFinite(seenAt) ? seenAt : 0)
      const state = this.options.store.read(); if (state?.projects.some((project) => project.id === projectId)) this.broadcastSnapshot(state, projectId)
    })
  }

  createThread(input: CreateProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      const project = state?.projects.find((candidate) => candidate.id === input.projectId)
      if (!state || !project) return this.fail('project-not-found', 'Project not found.')
      if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
      const title = input.title.trim()
      if (!title) return this.fail('invalid-argument', 'Thread title is required.')
      const source = this.creationSourceFor(input)
      if (!source) return this.fail('invalid-argument', 'Website thread source requires binding metadata.')
      const now = this.now()
      const thread: WorkspaceThread = {
        id: this.createId('thread'), projectId: project.id, title, createdAt: now, updatedAt: now,
        creationSource: source, chatState: { model: 'Claude Agent', items: [] },
      }
      const saved = await this.saveMutation({ ...state, projects: state.projects.map((item) => item.id === project.id ? { ...item, updatedAt: now } : item), threads: [thread, ...state.threads] })
      this.broadcastSnapshot(saved, project.id)
      return { ok: true, value: { threadId: thread.id, workspaceRevision: saved.workspaceRevision } }
    })
  }

  ensureManagedThread(input: Pick<ProjectChatManagedRunInput, 'projectId' | 'threadId' | 'title' | 'purpose' | 'homePluginSlug'>): Promise<ProjectChatResult<void>> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      const project = state?.projects.find((candidate) => candidate.id === input.projectId)
      if (!state || !project) return this.fail('project-not-found', 'Project not found.')
      const existing = state.threads.find((candidate) => candidate.id === input.threadId)
      if (existing) {
        if (existing.projectId !== input.projectId || existing.purpose !== 'task-run' || existing.homePluginSlug !== input.homePluginSlug) return this.fail('thread-not-found', 'Thread not found.')
        return { ok: true, value: undefined }
      }
      if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
      const now = this.now()
      const thread: WorkspaceThread = { id: input.threadId, projectId: project.id, title: input.title, purpose: input.purpose, homePluginSlug: input.homePluginSlug, createdAt: now, updatedAt: now, creationSource: { kind: 'user' }, chatState: { model: 'Claude Agent', items: [] } }
      const saved = await this.saveMutation({ ...state, projects: state.projects.map((item) => item.id === project.id ? { ...item, updatedAt: now } : item), threads: [thread, ...state.threads] })
      this.broadcastSnapshot(saved, project.id)
      return { ok: true, value: undefined }
    })
  }

  submitManagedRun(input: ProjectChatManagedRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      const project = state?.projects.find((candidate) => candidate.id === input.projectId)
      const thread = state?.threads.find((candidate) => candidate.id === input.threadId && candidate.projectId === input.projectId)
      if (!state || !project) return this.fail('project-not-found', 'Project not found.')
      if (!thread || thread.archivedAt || thread.purpose !== 'task-run' || thread.homePluginSlug !== input.homePluginSlug) return this.fail('thread-not-found', 'Thread not found.')
      if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
      if (!input.text.trim()) return this.fail('invalid-argument', 'Run text is required.')
      if (this.hasActiveRun(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')
      const now = this.now(); const pendingRequestId = this.createId('pending-run'); const routeGeneration = this.routeGenerationOf(input.projectId)
      const userMessage = { type: 'message' as const, id: this.createId('user'), role: 'user' as const, content: input.text, status: 'done' as const, createdAt: now, completedAt: now }
      const persistedThread = { ...thread, updatedAt: now, chatState: { ...thread.chatState, items: [...thread.chatState.items, userMessage] } }
      const saved = await this.saveMutation({ ...state, threads: state.threads.map((candidate) => candidate.id === thread.id ? persistedThread : candidate) })
      const run: ProjectChatRunSnapshot = { projectId: input.projectId, threadId: input.threadId, requestId: pendingRequestId, phase: 'submitting', routeGeneration, startedAt: now }
      this.runs.set(pendingRequestId, run); const permissionMode = this.permissionMode()
      try {
        await this.options.onProjectRunStarting?.(project.id, project.path)
        const submitted = await this.options.runner.submit({ text: input.text, projectId: project.id, threadId: input.threadId, modelPick: persistedThread.chatState.modelPick, sessionId: persistedThread.chatState.sessionId, cwd: project.path, permissionMode, promptMode: input.promptMode, agentModeSettingsOverride: input.agentModeSettingsOverride })
        this.runs.delete(pendingRequestId); this.runs.set(submitted.requestId, { ...run, requestId: submitted.requestId, phase: 'running' }); this.requestRoutes.set(submitted.requestId, { projectId: input.projectId, threadId: input.threadId, routeGeneration }); this.registerRuntimeAccepted(input.projectId, submitted.requestId, permissionMode); this.broadcastSnapshot(saved, input.projectId, permissionMode)
        return { ok: true, value: { requestId: submitted.requestId } }
      } catch {
        await this.options.onProjectRunTerminal?.(project.id, project.path)
        const failed: ProjectChatRunSnapshot = { ...run, phase: 'failed', finishedAt: this.now(), error: projectChatError('sdk-submit-failed', 'Unable to submit the run.') }
        this.runs.set(pendingRequestId, failed); const failureSaved = await this.saveMutation(this.appendFailedRun(saved, input.threadId, failed)); this.broadcastSnapshot(failureSaved, input.projectId, permissionMode)
        return this.fail('sdk-submit-failed', 'Unable to submit the run.')
      }
    })
  }

  cancelManagedRun(input: { projectId: string; threadId: string; requestId: string }): Promise<ProjectChatResult<void>> {
    return this.enqueue(async () => {
      const route = this.requestRoutes.get(input.requestId)
      if (!route || route.projectId !== input.projectId || route.threadId !== input.threadId) return this.fail('request-not-found', 'Run request not found.')
      await this.options.runner.cancel(input.requestId)
      return { ok: true, value: undefined }
    })
  }

  submitRun(input: SubmitProjectRunInput, context: ProjectChatRunContext = {}): Promise<ProjectChatResult<SubmitProjectRunResult>> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      const project = state?.projects.find((candidate) => candidate.id === input.projectId)
      const thread = state?.threads.find((candidate) => candidate.id === input.threadId && candidate.projectId === input.projectId)
      if (!state || !project) return this.fail('project-not-found', 'Project not found.')
      if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      if (!input.text.trim() && !(input.attachments?.length)) return this.fail('invalid-argument', 'Run text is required.')
      if (this.hasActiveRun(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')

      const modelChanged = input.modelPick !== undefined && !sameModelPick(thread.chatState.modelPick, input.modelPick)
      if (modelChanged) {
        try { await this.options.runner.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') }
      }

      const now = this.now()
      const pendingRequestId = this.createId('pending-run')
      const routeGeneration = this.routeGenerationOf(input.projectId)
      const runnerAttachments = toRunnerAttachments(input.attachments)
      const userMessage = {
        type: 'message' as const, id: this.createId('user'), role: 'user' as const, content: input.text,
        status: 'done' as const, createdAt: now, completedAt: now, attachments: runnerAttachments,
      }
      const priorHasUserMessage = thread.chatState.items.some((item) => item.type === 'message' && item.role === 'user')
      const title = !priorHasUserMessage && (thread.title === '新对话' || thread.title === 'New thread') ? derivedThreadTitle(input.text) ?? thread.title : thread.title
      const persistedThread = { ...thread, title, updatedAt: now, chatState: { ...thread.chatState, ...(modelChanged ? { sessionId: undefined, model: input.modelPick!.anthropicModel, modelPick: input.modelPick } : {}), items: [...thread.chatState.items, userMessage] } }
      const saved = await this.saveMutation({ ...state, threads: state.threads.map((candidate) => candidate.id === thread.id ? persistedThread : candidate) })
      const run: ProjectChatRunSnapshot = { projectId: input.projectId, threadId: input.threadId, requestId: pendingRequestId, phase: 'submitting', routeGeneration, startedAt: now }
      this.runs.set(pendingRequestId, run)
      const permissionMode = this.permissionMode()

      try {
        await this.options.onProjectRunStarting?.(project.id, project.path)
        const submitted = await this.options.runner.submit({
          text: input.text, attachments: runnerAttachments, threadId: input.threadId,
          modelPick: persistedThread.chatState.modelPick, handoffContext: input.handoffContext,
          sessionId: persistedThread.chatState.sessionId, cwd: project.path, projectId: project.id,
          projectRuntimePrompt: context.projectRuntimePrompt === true, permissionMode,
        })
        this.runs.delete(pendingRequestId)
        const accepted: ProjectChatRunSnapshot = { ...run, requestId: submitted.requestId, phase: 'running' }
        this.runs.set(submitted.requestId, accepted)
        this.requestRoutes.set(submitted.requestId, { projectId: input.projectId, threadId: input.threadId, routeGeneration })
        this.registerRuntimeAccepted(input.projectId, submitted.requestId, permissionMode)
        this.broadcastSnapshot(saved, input.projectId, permissionMode)
        return { ok: true, value: { requestId: submitted.requestId } }
      } catch {
        await this.options.onProjectRunTerminal?.(project.id, project.path)
        const failed: ProjectChatRunSnapshot = { ...run, phase: 'failed', finishedAt: this.now(), error: projectChatError('sdk-submit-failed', 'Unable to submit the run.') }
        this.runs.set(pendingRequestId, failed)
        const failure = this.appendFailedRun(saved, input.threadId, failed)
        const failureSaved = await this.saveMutation(failure)
        this.broadcastSnapshot(failureSaved, input.projectId, permissionMode)
        return this.fail('sdk-submit-failed', 'Unable to submit the run.')
      }
    })
  }

  forkThread(input: ForkProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>> {
    return this.enqueue(async () => {
      const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId)
      const stale = this.commandFence(input); if (stale) return stale
      if (!state || !project) return this.fail('project-not-found', 'Project not found.')
      if (!thread) return this.fail('thread-not-found', 'Thread not found.')
      const index = thread.chatState.items.findIndex((item) => item.type === 'message' && item.id === input.messageId)
      if (index < 0) return this.fail('invalid-argument', 'Message was not found.')
      const now = this.now(); const fork: WorkspaceThread = { id: this.createId('thread'), projectId: thread.projectId, title: thread.title, createdAt: now, updatedAt: now, creationSource: { kind: 'user' }, chatState: { model: thread.chatState.model, modelPick: thread.chatState.modelPick, items: structuredClone(thread.chatState.items.slice(0, index + 1)) } }
      const saved = await this.saveMutation({ ...state, projects: state.projects.map((item) => item.id === thread.projectId ? { ...item, updatedAt: now } : item), threads: [fork, ...state.threads] }); this.broadcastSnapshot(saved, input.projectId)
      return { ok: true, value: { threadId: fork.id, workspaceRevision: saved.workspaceRevision } }
    })
  }

  editAndSubmitRun(input: EditAndSubmitProjectRunInput, context: ProjectChatRunContext = {}): Promise<ProjectChatResult<SubmitProjectRunResult>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
    if (this.hasActiveRun(input.projectId, input.threadId) || this.hasCurrentPrompt(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')
    const index = thread.chatState.items.findIndex((item) => item.type === 'message' && item.role === 'user' && item.id === input.messageId); const text = input.text.trim()
    if (index < 0 || !text) return this.fail('invalid-argument', 'User message is invalid.')
    try { await this.options.runner.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') }
    const now = this.now(); const items = thread.chatState.items.slice(0, index + 1); const message = items[index] as Extract<typeof items[number], { type: 'message' }>; items[index] = { ...message, content: text, status: 'done', completedAt: now }
    const pick = input.modelPick ?? thread.chatState.modelPick; const edited = { ...thread, updatedAt: now, chatState: { ...thread.chatState, sessionId: undefined, model: pick?.anthropicModel ?? thread.chatState.model, modelPick: pick, items } }; const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id === thread.id ? edited : item) })
    const pendingRequestId = this.createId('pending-run'); const routeGeneration = this.routeGenerationOf(input.projectId); const run: ProjectChatRunSnapshot = { projectId: input.projectId, threadId: input.threadId, requestId: pendingRequestId, phase: 'submitting', routeGeneration, startedAt: now }; this.runs.set(pendingRequestId, run); const permissionMode = this.permissionMode()
    try {
      await this.options.onProjectRunStarting?.(project.id, project.path)
      const submitted = await this.options.runner.submit({ text, attachments: undefined, threadId: thread.id, modelPick: edited.chatState.modelPick, sessionId: undefined, cwd: project.path, projectId: project.id, projectRuntimePrompt: context.projectRuntimePrompt === true, permissionMode }); this.runs.delete(pendingRequestId); this.runs.set(submitted.requestId, { ...run, requestId: submitted.requestId, phase: 'running' }); this.requestRoutes.set(submitted.requestId, { projectId: input.projectId, threadId: thread.id, routeGeneration }); this.registerRuntimeAccepted(input.projectId, submitted.requestId, permissionMode); this.broadcastSnapshot(saved, input.projectId, permissionMode); return { ok: true, value: { requestId: submitted.requestId } }
    } catch {
      await this.options.onProjectRunTerminal?.(project.id, project.path)
      const failed: ProjectChatRunSnapshot = { ...run, phase: 'failed', finishedAt: this.now(), error: projectChatError('sdk-submit-failed', 'Unable to submit the run.') }; this.runs.set(pendingRequestId, failed); const failureSaved = await this.saveMutation(this.appendFailedRun(saved, thread.id, failed)); this.broadcastSnapshot(failureSaved, input.projectId, permissionMode); return this.fail('sdk-submit-failed', 'Unable to submit the run.')
    }
  }) }

  archiveThread(input: ArchiveProjectThreadInput): Promise<ProjectChatResult<void>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    if (this.hasActiveRun(input.projectId, input.threadId) || this.hasCurrentPrompt(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')
    const now = this.now(); const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id === thread.id ? { ...item, archivedAt: now, updatedAt: now } : item) }); this.broadcastSnapshot(saved, input.projectId); return { ok: true, value: undefined }
  }) }

  setThreadPinned(input: SetProjectThreadPinnedInput): Promise<ProjectChatResult<void>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread) return this.fail('thread-not-found', 'Thread not found.')
    if ((thread.pinnedAt !== undefined) === input.pinned) return { ok: true, value: undefined }
    const now = this.now(); const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id === thread.id ? { ...item, pinnedAt: input.pinned ? now : undefined, updatedAt: now } : item) }); this.broadcastSnapshot(saved, input.projectId); return { ok: true, value: undefined }
  }) }

  setThreadModel(input: SetProjectThreadModelInput): Promise<ProjectChatResult<void>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    if (this.hasActiveRun(input.projectId, input.threadId) || this.hasCurrentPrompt(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')
    if (sameModelPick(thread.chatState.modelPick, input.modelPick)) return { ok: true, value: undefined }
    try { await this.options.runner.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') }
    const now = this.now(); const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id === thread.id ? { ...item, updatedAt: now, chatState: { ...item.chatState, model: input.modelPick.anthropicModel, modelPick: input.modelPick, sessionId: undefined } } : item) }); this.broadcastSnapshot(saved, input.projectId); return { ok: true, value: undefined }
  }) }

  markFileDiffReviewed(input: MarkProjectFileDiffReviewedInput): Promise<ProjectChatResult<void>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    const index = thread.chatState.items.findIndex((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId)
    if (index < 0) return this.fail('invalid-argument', 'File diff was not found.')
    const now = this.now(); const items = [...thread.chatState.items]; const diff = items[index] as Extract<typeof items[number], { type: 'file_diff' }>; items[index] = { ...diff, status: 'reviewed', detail: undefined }; const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id === thread.id ? { ...item, updatedAt: now, chatState: { ...item.chatState, items } } : item) }); this.broadcastSnapshot(saved, input.projectId); return { ok: true, value: undefined }
  }) }

  rewindFileDiff(input: RewindProjectFileDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>> { return this.enqueue(async () => {
    const state = this.options.store.read(); const project = state?.projects.find((item) => item.id === input.projectId); const thread = state?.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId); const stale = this.commandFence(input); if (stale) return stale
    if (!state || !project) return this.fail('project-not-found', 'Project not found.')
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    if (project.pathMissing || !project.path.trim()) return this.fail('project-path-missing', 'Project path is missing.')
    if (this.hasActiveRun(input.projectId, input.threadId) || this.hasCurrentPrompt(input.projectId, input.threadId)) return this.fail('thread-busy', 'Thread already has an active run.')
    const diff = thread.chatState.items.find((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId)
    if (!diff || diff.type !== 'file_diff' || !diff.checkpointId?.trim()) return this.fail('invalid-argument', 'File diff was not found.')
    if (diff.status === 'reverted') return { ok: true, value: { changeSetId: input.changeSetId, status: 'reverted' } }
    let result: ClaudeFileRewindResult
    try {
      result = await this.options.runner.rewindFiles({ requestId: diff.requestId, threadId: thread.id, modelPick: thread.chatState.modelPick, changeSetId: diff.changeSetId, checkpointId: diff.checkpointId, cwd: project.path, sessionId: thread.chatState.sessionId })
    } catch { return this.fail('internal-error', 'Unable to rewind file changes.') }
    const status: RewindProjectFileDiffResult['status'] = result.ok ? 'reverted' : 'error'
    const detail = result.ok ? undefined : 'Unable to rewind file changes.'
    const now = this.now(); const saved = await this.saveMutation({ ...state, threads: state.threads.map((item) => item.id !== thread.id ? item : { ...item, updatedAt: now, chatState: { ...item.chatState, items: item.chatState.items.map((candidate) => candidate.type === 'file_diff' && candidate.changeSetId === input.changeSetId ? { ...candidate, status, detail } : candidate) } }) })
    this.broadcastSnapshot(saved, input.projectId)
    return { ok: true, value: { changeSetId: input.changeSetId, status, ...(detail ? { detail } : {}) } }
  }) }

  cancelRun(input: CancelProjectRunInput): Promise<ProjectChatResult<void>> {
    return this.enqueue(async () => {
      const route = this.requestRoutes.get(input.requestId)
      if (!route || route.projectId !== input.projectId || route.threadId !== input.threadId) return this.fail('request-not-found', 'Run request not found.')
      if (route.routeGeneration !== input.routeGeneration || route.routeGeneration !== this.routeGenerationOf(input.projectId)) return this.fail('stale-revision', 'Route generation is stale.', true)
      await this.options.runner.cancel(input.requestId)
      return { ok: true, value: undefined }
    })
  }

  answerPrompt(input: AnswerProjectPromptInput, ownerWebContentsId?: number): Promise<ProjectChatResult<void>> {
    return this.enqueue(async () => {
      if (input.response.permissionRequestId !== input.promptId) return this.fail('invalid-argument', 'Prompt response does not match the prompt.')
      const prompt = this.prompts.get(input.promptId)
      if (!prompt || prompt.projectId !== input.projectId || prompt.threadId !== input.threadId || prompt.requestId !== input.requestId) return this.fail('prompt-not-owned', 'Prompt is no longer available.')
      const route = this.requestRoutes.get(input.requestId)
      if (route?.routeGeneration !== input.routeGeneration || this.routeGenerationOf(input.projectId) !== input.routeGeneration) return this.fail('stale-revision', 'Route generation is stale.', true)
      if (prompt.ownerWebContentsId === undefined || prompt.ownerWebContentsId !== ownerWebContentsId) return this.fail('prompt-not-owned', 'Prompt is owned by another window.')
      try {
        await this.options.runner.answerPermissionRequest(input.response)
      } catch {
        return this.fail('internal-error', 'Unable to answer the prompt.')
      }
      this.prompts.delete(input.promptId)
      this.promptOwners.delete(input.promptId)
      const run = this.runs.get(input.requestId)
      if (run && !isTerminal(run.phase)) this.runs.set(input.requestId, { ...run, phase: 'running' })
      const state = this.options.store.read()
      if (state) this.broadcastSnapshot(state, input.projectId)
      return { ok: true, value: undefined }
    })
  }

  publish(event: ClaudeChatEvent): void {
    void this.enqueue(() => this.foldPublishedEvent(event)).catch(() => undefined)
  }

  async idle(): Promise<void> { await (this.options.runExclusive ? this.externalOperation : this.operationChain) }
  /** Emits fresh snapshots without changing durable workspace revision. */
  broadcastAllSnapshots(permissionMode: ClaudePermissionMode): Promise<void> {
    return this.enqueue(async () => {
      const state = this.options.store.read()
      if (!state) return
      for (const project of state.projects) this.broadcastSnapshot(state, project.id, permissionMode)
    })
  }
  unknownRequestCount(projectId?: string): number { return projectId ? this.unknownRequestCounts.get(projectId) ?? 0 : [...this.unknownRequestCounts.values()].reduce((total, count) => total + count, 0) }
  routeGenerationOf(projectId: string): number { return this.routeGenerations.get(projectId) ?? 1 }
  advanceRouteGeneration(projectId: string): number { const next = this.routeGenerationOf(projectId) + 1; this.routeGenerations.set(projectId, next); return next }

  setPromptOwnerCandidates(promptId: string, webContentsIds: number[]): ProjectChatOwnedPromptSnapshot | null {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return null
    const owners = [...new Set(webContentsIds.filter((id) => Number.isInteger(id) && id > 0))]
    this.promptOwners.set(promptId, owners)
    const next = { ...prompt, ownerWebContentsId: owners[0] }
    this.prompts.set(promptId, next)
    return next
  }

  reassignPromptOwner(promptId: string, unavailableWebContentsId: number): ProjectChatOwnedPromptSnapshot | null {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return null
    const owners = (this.promptOwners.get(promptId) ?? []).filter((owner) => owner !== unavailableWebContentsId)
    this.promptOwners.set(promptId, owners)
    const next = { ...prompt, ownerWebContentsId: owners[0] }
    this.prompts.set(promptId, next)
    return next
  }

  refreshPromptOwners(projectId?: string): Promise<void> { return this.enqueue(async () => { await this.refreshPromptOwnersInternal(projectId) }) }
  /** Ephemeral Main projection only: no workspace write or revision increment. */
  broadcastProjectSnapshot(projectId: string): void {
    const state = this.options.store.read()
    if (state?.projects.some((project) => project.id === projectId)) this.broadcastSnapshot(state, projectId)
  }
  onWebContentsUnavailable(webContentsId: number): Promise<void> { return this.enqueue(async () => { await this.refreshPromptOwnersInternal(undefined, webContentsId) }) }

  private async foldPublishedEvent(event: ClaudeChatEvent): Promise<void> {
    const route = this.requestRoutes.get(event.requestId)
    if (!route) { this.unknownRequestCounts.set('unknown', this.unknownRequestCount('unknown') + 1); return }
    if (route.routeGeneration !== this.routeGenerationOf(route.projectId)) return
    const run = this.runs.get(event.requestId)
    if (!run || isTerminal(run.phase)) return
    const state = this.options.store.read()
    const thread = state?.threads.find((candidate) => candidate.id === route.threadId && candidate.projectId === route.projectId)
    if (!state || !thread) return
    if (event.type === 'ask_user_question' || event.type === 'permission_request') {
      const prompt = this.promptFromEvent(route, event)
      const candidates = this.promptCandidates(prompt).candidates
      this.promptOwners.set(prompt.promptId, candidates)
      if (candidates[0] !== undefined) prompt.ownerWebContentsId = candidates[0]
      this.prompts.set(prompt.promptId, prompt)
      this.runs.set(event.requestId, { ...run, phase: event.type === 'ask_user_question' ? 'waiting_answer' : 'waiting_permission' })
      this.broadcastSnapshot(state, route.projectId)
      return
    }
    const now = this.now()
    const chatState = foldChatRunEvent(thread.chatState, event, { now, assistantMessageId: route.assistantMessageId, requestStartedAt: run.startedAt })
    if (event.type === 'assistant_delta') route.assistantMessageId = event.messageId
    const saved = await this.saveMutation({ ...state, threads: state.threads.map((candidate) => candidate.id === thread.id ? { ...candidate, updatedAt: now, chatState } : candidate) })
    if (event.type === 'result' || event.type === 'error' || event.type === 'cancelled') {
      this.runs.set(event.requestId, {
        ...run,
        phase: event.type === 'result' ? 'succeeded' : event.type === 'error' ? 'failed' : 'cancelled',
        finishedAt: now,
        error: event.type === 'error' ? projectChatError('internal-error', 'Run failed.') : undefined,
      })
      this.options.runtimeEditCoordinator?.markRunTerminal(event.requestId, event.type === 'result' ? 'succeeded' : event.type === 'error' ? 'failed' : 'cancelled')
      const routeProject = state.projects.find((project) => project.id === route.projectId)
      if (routeProject) await this.options.onProjectRunTerminal?.(route.projectId, routeProject.path)
      for (const [promptId, prompt] of this.prompts) if (prompt.requestId === event.requestId) { this.prompts.delete(promptId); this.promptOwners.delete(promptId) }
    }
    this.broadcastSnapshot(saved, route.projectId)
  }

  private promptFromEvent(route: RequestRoute, event: Extract<ClaudeChatEvent, { type: 'ask_user_question' | 'permission_request' }>): ProjectChatOwnedPromptSnapshot {
    const payload: ProjectChatPromptPayload = event.type === 'permission_request'
      ? { kind: 'permission', permissionRequestId: event.permissionRequestId, toolUseId: event.toolUseId, toolName: event.toolName, title: event.title, displayName: event.displayName, description: event.description, inputPreview: event.inputPreview }
      : { kind: 'question', permissionRequestId: event.permissionRequestId, toolUseId: event.toolUseId, questions: event.questions }
    return { projectId: route.projectId, threadId: route.threadId, requestId: event.requestId, promptId: event.permissionRequestId, kind: payload.kind, createdAt: this.now(), payload }
  }

  private promptCandidates(prompt: ProjectChatOwnedPromptSnapshot, unavailable?: number): { resolved: boolean; candidates: number[] } {
    try { return { resolved: true, candidates: [...new Set((this.options.promptOwnerCandidates?.({ projectId: prompt.projectId, threadId: prompt.threadId, routeGeneration: this.routeGenerationOf(prompt.projectId) }) ?? []).filter((id) => Number.isInteger(id) && id > 0 && id !== unavailable))] } } catch { return { resolved: false, candidates: [] } }
  }

  private async refreshPromptOwnersInternal(projectId?: string, unavailable?: number): Promise<void> {
    const changed = new Set<string>()
    for (const [promptId, prompt] of this.prompts) {
      if (projectId && prompt.projectId !== projectId) continue
      const route = this.requestRoutes.get(prompt.requestId)
      if (!route || route.routeGeneration !== this.routeGenerationOf(prompt.projectId)) continue
      const resolved = this.promptCandidates(prompt, unavailable)
      const owner = prompt.ownerWebContentsId
      if (!resolved.resolved) {
        if (unavailable === undefined || owner !== unavailable) continue
        this.promptOwners.set(promptId, (this.promptOwners.get(promptId) ?? []).filter((id) => id !== unavailable))
        this.prompts.set(promptId, { ...prompt, ownerWebContentsId: undefined })
        changed.add(prompt.projectId)
        continue
      }
      const candidates = resolved.candidates
      const nextOwner = owner !== undefined && candidates.includes(owner) ? owner : candidates[0]
      this.promptOwners.set(promptId, candidates)
      if (nextOwner !== owner) { this.prompts.set(promptId, { ...prompt, ownerWebContentsId: nextOwner }); changed.add(prompt.projectId) }
    }
    if (!changed.size) return
    const state = this.options.store.read()
    if (state) for (const id of changed) this.broadcastSnapshot(state, id)
  }

  private snapshot(state: ChatWorkspaceState, projectId: string, permissionMode = this.permissionMode()): ProjectChatInternalSnapshot {
    const routeGeneration = this.routeGenerationOf(projectId)
    const project = state.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error('project-chat-project-missing')
    return {
      projectId, project: { id: project.id, name: project.name, pathMissing: project.pathMissing === true },
      workspaceRevision: state.workspaceRevision, sequence: this.sequences.get(projectId) ?? 0, routeGeneration,
      threads: state.threads.filter((thread) => thread.projectId === projectId).map(projectThreadSnapshot),
      runs: [...this.runs.values()].filter((run) => run.projectId === projectId && run.routeGeneration === routeGeneration),
      pendingPrompts: [...this.prompts.values()].filter((prompt) => {
        const route = this.requestRoutes.get(prompt.requestId)
        return prompt.projectId === projectId && route?.routeGeneration === routeGeneration
      }),
      permissionMode, ...this.externalUnread(state, projectId),
      ...(this.options.runtimeEditCoordinator?.snapshot(projectId) ? { runtimeEdit: this.options.runtimeEditCoordinator.snapshot(projectId) } : {}),
    }
  }

  private externalUnread(state: ChatWorkspaceState, projectId: string): { unreadExternalTaskCount: number; latestUnreadExternalThreadId?: string } {
    const seenAt = this.externalSeenAt.get(projectId) ?? 0
    const unread = state.threads.filter((thread): thread is WorkspaceThread & { creationSource: Extract<ProjectThreadCreationSource, { kind: 'website' }> } => thread.projectId === projectId && thread.creationSource.kind === 'website' && thread.creationSource.receivedAt > seenAt).sort((a, b) => b.creationSource.receivedAt - a.creationSource.receivedAt)
    return unread.length ? { unreadExternalTaskCount: unread.length, latestUnreadExternalThreadId: unread[0].id } : { unreadExternalTaskCount: 0 }
  }

  private broadcastSnapshot(state: ChatWorkspaceState, projectId: string, permissionMode?: ClaudePermissionMode): void {
    const sequence = (this.sequences.get(projectId) ?? 0) + 1
    this.sequences.set(projectId, sequence)
    const snapshot = this.snapshot(state, projectId, permissionMode)
    this.broadcast({ type: 'snapshot', projectId, sequence, routeGeneration: snapshot.routeGeneration, workspaceRevision: snapshot.workspaceRevision, snapshot: { ...snapshot, sequence } })
  }
  private registerRuntimeAccepted(projectId: string, requestId: string, permissionMode: ClaudePermissionMode): void {
    if (this.options.runtimeEditEligible && !this.options.runtimeEditEligible(projectId)) return
    this.options.runtimeEditCoordinator?.registerAcceptedRun({ projectId, requestId, permissionMode })
  }

  private async saveMutation(state: ChatWorkspaceState): Promise<ChatWorkspaceState> {
    return this.options.store.save({ ...state, workspaceRevision: state.workspaceRevision + 1 })
  }

  private appendFailedRun(state: ChatWorkspaceState, threadId: string, run: ProjectChatRunSnapshot): ChatWorkspaceState {
    return { ...state, threads: state.threads.map((thread) => thread.id !== threadId ? thread : { ...thread, updatedAt: run.finishedAt ?? run.startedAt, chatState: { ...thread.chatState, items: [...thread.chatState.items, { type: 'message', id: `assistant-${run.requestId}`, role: 'assistant', content: run.error?.message ?? 'Unable to submit the run.', status: 'error', createdAt: run.startedAt, startedAt: run.startedAt, completedAt: run.finishedAt, durationMs: Math.max(0, (run.finishedAt ?? run.startedAt) - run.startedAt) }] } }) }
  }

  private hasActiveRun(projectId: string, threadId: string): boolean {
    const routeGeneration = this.routeGenerationOf(projectId)
    return [...this.runs.values()].some((run) => run.projectId === projectId && run.threadId === threadId && run.routeGeneration === routeGeneration && !isTerminal(run.phase))
  }
  private hasCurrentPrompt(projectId: string, threadId: string): boolean {
    const generation = this.routeGenerationOf(projectId)
    return [...this.prompts.values()].some((prompt) => {
      const route = this.requestRoutes.get(prompt.requestId)
      return prompt.projectId === projectId && prompt.threadId === threadId && route?.routeGeneration === generation
    })
  }
  private commandFence(input: { projectId: string; routeGeneration: number }): ProjectChatResult<never> | null {
    return input.routeGeneration === this.routeGenerationOf(input.projectId) ? null : this.fail('stale-revision', 'Route generation is stale.', true)
  }
  private creationSourceFor(input: CreateProjectThreadInput): ProjectThreadCreationSource | null {
    if (input.source === 'user') return { kind: 'user' }
    if (input.source === 'app-command') return { kind: 'app-command' }
    if (input.source !== 'website') return null
    if (!input.bindingId.trim() || !Number.isFinite(input.receivedAt) || !input.idempotencyKey.trim()) return null
    return { kind: 'website', bindingId: input.bindingId.trim(), receivedAt: input.receivedAt }
  }
  private fail(code: Parameters<typeof projectChatError>[0], message: string, retryable = false): ProjectChatResult<never> { return { ok: false, error: projectChatError(code, message, retryable) } }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.options.runExclusive) {
      const next = this.options.runExclusive(operation)
      this.externalOperation = next.then(() => undefined, () => undefined)
      return next
    }
    const next = this.operationChain.then(() => Promise.resolve().then(operation), () => Promise.resolve().then(operation))
    this.operationChain = next.then(() => undefined, () => undefined)
    return next
  }
}

function isTerminal(phase: ProjectChatRunSnapshot['phase']): boolean { return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled' }
function sameModelPick(left: { providerId: string; anthropicModel: string } | undefined, right: { providerId: string; anthropicModel: string } | undefined): boolean { return left?.providerId === right?.providerId && left?.anthropicModel === right?.anthropicModel }
function derivedThreadTitle(text: string): string | null { const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean); return first ? (first.length > 34 ? `${first.slice(0, 34)}...` : first) : null }

function toRunnerAttachments(attachments?: ProjectChatAttachment[]): ClaudeChatSubmitPayload['attachments'] {
  return attachments?.map((attachment) => ({ ...attachment, path: '' }))
}

/** Explicit durable-thread projection; snapshots never expose internal thread/chat state. */
function projectThreadSnapshot(thread: WorkspaceThread): ProjectChatThreadSnapshot {
  const tasks = thread.chatState.tasks
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    purpose: thread.purpose,
    homePluginSlug: thread.homePluginSlug,
    skillCommand: thread.skillCommand,
    skillTitle: thread.skillTitle,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinnedAt: thread.pinnedAt,
    archivedAt: thread.archivedAt,
    chatState: {
      model: thread.chatState.model,
      modelPick: thread.chatState.modelPick ? { providerId: thread.chatState.modelPick.providerId, anthropicModel: thread.chatState.modelPick.anthropicModel } : undefined,
      tasks: tasks ? {
        updatedAt: tasks.updatedAt,
        items: tasks.items.map((item) => ({ id: item.id, toolUseId: item.toolUseId, subject: item.subject, description: item.description, activeForm: item.activeForm, status: item.status, owner: item.owner, blocks: item.blocks ? [...item.blocks] : undefined, blockedBy: item.blockedBy ? [...item.blockedBy] : undefined, createdAt: item.createdAt, updatedAt: item.updatedAt, order: item.order })),
      } : undefined,
      items: thread.chatState.items.map(projectTranscriptItem),
    },
  }
}

function projectTranscriptItem(item: WorkspaceThread['chatState']['items'][number]): ProjectChatTranscriptItem {
  switch (item.type) {
    case 'message':
      return { type: 'message', id: item.id, role: item.role, content: item.content, status: item.status, createdAt: item.createdAt, startedAt: item.startedAt, completedAt: item.completedAt, durationMs: item.durationMs, attachments: item.attachments?.map((attachment) => ({ id: attachment.id, kind: attachment.kind, name: projectChatBasename(attachment.name) ?? 'Attachment', mimeType: attachment.mimeType, size: attachment.size, preview: attachment.preview, dataUrl: attachment.dataUrl })) }
    case 'tool':
      return { type: 'tool', id: item.id, toolUseId: item.toolUseId, name: item.name, inputPreview: item.inputPreview, status: item.status, detail: item.detail }
    case 'thinking':
      return { type: 'thinking', id: item.id, thinkingId: item.thinkingId, title: item.title, content: item.content, status: item.status }
    case 'activity':
      return { type: 'activity', id: item.id, title: item.title, status: item.status, detail: item.detail, preview: item.preview }
    case 'context_compaction':
      return { type: 'context_compaction', id: item.id, status: item.status, trigger: item.trigger, preTokens: item.preTokens, postTokens: item.postTokens, durationMs: item.durationMs, preservedMessageCount: item.preservedMessageCount, summary: item.summary, error: item.error, createdAt: item.createdAt, updatedAt: item.updatedAt }
    case 'file_diff':
      return { type: 'file_diff', id: item.id, changeSetId: item.changeSetId, files: item.files.flatMap((file) => {
        const relativePath = normalizeProjectChatRelativePath(file.relativePath)
        return relativePath ? [{ relativePath, status: file.status, additions: file.additions, deletions: file.deletions, hunks: file.hunks.map((hunk) => ({ oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines, lines: hunk.lines.map((line) => ({ kind: line.kind, content: line.content, oldLineNumber: line.oldLineNumber, newLineNumber: line.newLineNumber })) })), truncated: file.truncated }] : []
      }), status: item.status, detail: item.detail }
  }
}
