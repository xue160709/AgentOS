import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ClaudeChatEvent, ClaudePermissionMode } from '../src/claude-chat-types'
import {
  normalizeProjectChatRelativePath,
  projectChatError,
  type ProjectChatResult,
  type RewindProjectFileDiffResult,
} from '../src/project-chat-contract'
import {
  parseRuntimeScopeId,
  runtimeOwnerMatchesScope,
  type AnswerRuntimeChatPromptInput,
  type CancelRuntimeChatRunInput,
  type CreateRuntimeChatThreadInput,
  type EditAndSubmitRuntimeChatRunInput,
  type ForkRuntimeChatThreadInput,
  type ResolvedRuntimeChatScope,
  type RuntimeChatAuthority,
  type RuntimeChatDiffInput,
  type RuntimeChatInternalEvent,
  type RuntimeChatInternalSnapshot,
  type RuntimeChatOwnedPromptSnapshot,
  type RuntimeChatRunSnapshot,
  type RuntimeChatThreadInput,
  type RuntimeChatThreadSnapshot,
  type RuntimeDevelopmentThread,
  type RuntimeDevelopmentWorkspace,
  type RuntimeScopeId,
  type SetRuntimeChatThreadModelInput,
  type SetRuntimeChatThreadPinnedInput,
  type SubmitRuntimeChatRunInput,
} from '../src/runtime-development-contract'
import { ChatBrokerCore, type ChatBrokerPrompt, type ChatBrokerRequestRoute, type ChatBrokerRun } from './chat-broker-core'
import { projectChatTranscriptItem } from './project-chat-broker'
import type { RuntimeDevelopmentCoordinator, RuntimeDevelopmentAuthority } from './runtime-development-coordinator'

export type RuntimeChatStore = {
  read(): RuntimeDevelopmentWorkspace
  save(input: unknown, expectedRevision?: number): Promise<RuntimeDevelopmentWorkspace>
}

export type RuntimeChatBrokerOptions = {
  core: ChatBrokerCore
  store: RuntimeChatStore
  resolveScope(runtimeScopeId: RuntimeScopeId): ResolvedRuntimeChatScope | null
  now?: () => number
  createId?: (prefix: string) => string
  permissionMode?: () => ClaudePermissionMode
  broadcast?: (event: RuntimeChatInternalEvent) => void
  promptOwnerCandidates?: (input: { runtimeScopeId: RuntimeScopeId; threadId: string; routeGeneration: number; developmentGeneration: number }) => number[]
  developmentCoordinator?: Pick<RuntimeDevelopmentCoordinator, 'canSubmit' | 'registerSubmittingRun' | 'registerAcceptedRun' | 'rollbackSubmittedRun' | 'markPromptWaiting' | 'markPromptResolved' | 'markRunTerminal'>
  onAccepted?: (route: ChatBrokerRequestRoute, requestId: string, permissionMode: string) => void | Promise<void>
  onTerminal?: (route: ChatBrokerRequestRoute, requestId: string, phase: 'succeeded' | 'failed' | 'cancelled') => void | Promise<void>
}

type RuntimeAuthorityResult = { ok: true; scope: ResolvedRuntimeChatScope } | { ok: false; error: ReturnType<typeof projectChatError> }

/** Runtime facade 只操作 R3-01 collection；Project workspace 永远不是它的 fallback。 */
export class RuntimeChatBroker {
  private readonly now: () => number
  private readonly createId: (prefix: string) => string
  private readonly permissionMode: () => ClaudePermissionMode
  private readonly broadcast: (event: RuntimeChatInternalEvent) => void
  private readonly sequences = new Map<RuntimeScopeId, number>()
  private readonly developmentGenerations = new Map<RuntimeScopeId, number>()
  private readonly unregisterCoreFacade: () => void

  constructor(private readonly options: RuntimeChatBrokerOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`)
    this.permissionMode = options.permissionMode ?? (() => 'auto')
    this.broadcast = options.broadcast ?? (() => undefined)
    this.unregisterCoreFacade = options.core.registerFacade('runtime', {
      readThread: (scopeId, threadId) => {
        const thread = this.thread(this.options.store.read(), scopeId as RuntimeScopeId, threadId)
        return thread ? { chatState: thread.chatState } : null
      },
      saveThreadChatState: async (scopeId, threadId, chatState, updatedAt) => {
        const state = this.options.store.read()
        const thread = this.thread(state, scopeId as RuntimeScopeId, threadId)
        if (!thread) return false
        await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id === thread.id ? { ...candidate, updatedAt, chatState } : candidate) }, state.runtimeThreadRevision)
        return true
      },
      broadcast: (scopeId) => this.broadcastSnapshot(scopeId as RuntimeScopeId),
      isRouteCurrent: (route) => {
        const resolved = this.resolve(route.scopeId as RuntimeScopeId)
        return Boolean(resolved && resolved.routeGeneration === route.routeGeneration && resolved.developmentGeneration === route.developmentGeneration)
      },
      promptOwnerCandidates: (route) => this.options.promptOwnerCandidates?.({ runtimeScopeId: route.scopeId as RuntimeScopeId, threadId: route.threadId, routeGeneration: route.routeGeneration, developmentGeneration: route.developmentGeneration }) ?? [],
      filterEvent: (route, event) => this.filterRuntimeEvent(route, event),
      onSubmitting: (route, pendingRequestId, permissionMode) => options.developmentCoordinator?.registerSubmittingRun?.({ ...runtimeAuthority(route), pendingRequestId, permissionMode }) ?? true,
      onAccepted: async (route, requestId, permissionMode, pendingRequestId) => {
        const registered = options.developmentCoordinator?.registerAcceptedRun({ ...runtimeAuthority(route), pendingRequestId, requestId, permissionMode }) ?? true
        if (!registered) return false
        await options.onAccepted?.(route, requestId, permissionMode)
        return true
      },
      onSubmitRejected: (_route, pendingRequestId, acceptedRequestId) => { options.developmentCoordinator?.rollbackSubmittedRun?.({ pendingRequestId, acceptedRequestId }) },
      onPromptWaiting: (route, requestId, promptId) => { options.developmentCoordinator?.markPromptWaiting({ ...runtimeAuthority(route), requestId, promptId }) },
      onPromptResolved: (route, requestId, promptId) => { options.developmentCoordinator?.markPromptResolved({ ...runtimeAuthority(route), requestId, promptId }) },
      onTerminal: async (route, requestId, phase) => {
        options.developmentCoordinator?.markRunTerminal({ ...runtimeAuthority(route), requestId, phase })
        await options.onTerminal?.(route, requestId, phase)
      },
    })
  }

  /** 仅注销 Runtime facade；共享 Core/Runner 与 Project facade 不受影响。 */
  dispose(): void { this.unregisterCoreFacade() }

  routeGenerationOf(runtimeScopeId: RuntimeScopeId): number {
    const resolved = this.resolve(runtimeScopeId)
    return resolved?.routeGeneration ?? this.options.core.routeGenerationOf('runtime', runtimeScopeId)
  }

  developmentGenerationOf(runtimeScopeId: RuntimeScopeId): number {
    return this.resolve(runtimeScopeId)?.developmentGeneration ?? this.developmentGenerations.get(runtimeScopeId) ?? 0
  }

  rebaseDevelopmentGeneration(runtimeScopeId: RuntimeScopeId, routeGeneration: number, fromGeneration: number, toGeneration: number): void {
    this.options.core.rebaseDevelopmentGeneration('runtime', runtimeScopeId, routeGeneration, fromGeneration, toGeneration)
    this.developmentGenerations.set(runtimeScopeId, toGeneration)
  }

  getSnapshot(authority: RuntimeChatAuthority): Promise<ProjectChatResult<RuntimeChatInternalSnapshot>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, false)
      if (!authorized.ok) return authorized
      return { ok: true, value: this.snapshot(authority.runtimeScopeId, authorized.scope) }
    })
  }

  createThread(authority: RuntimeChatAuthority, input: CreateRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
      const title = input.title.trim(); if (!title) return this.fail('invalid-argument', 'Thread title is required.')
      const state = this.options.store.read(); const now = this.now()
      const thread: RuntimeDevelopmentThread = {
        id: this.createId('runtime-thread'), purpose: 'runtime-development', runtimeScopeId: authority.runtimeScopeId,
        runtimeDefinitionId: authorized.scope.runtimeDefinitionId, runtimeOwner: authorized.scope.runtimeOwner,
        title, createdAt: now, updatedAt: now, creationSource: { kind: 'user' }, chatState: { model: 'Claude Agent', cwd: authorized.scope.cwd, items: [] },
      }
      const saved = await this.options.store.save({ ...state, runtimeDevelopmentThreads: [thread, ...state.runtimeDevelopmentThreads] }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId)
      return { ok: true, value: { threadId: thread.id, runtimeThreadRevision: saved.runtimeThreadRevision } }
    })
  }

  submitRun(authority: RuntimeChatAuthority, input: SubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>> {
    return this.options.core.enqueue(() => this.submit(authority, input))
  }

  forkThread(authority: RuntimeChatAuthority, input: ForkRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread) return this.fail('thread-not-found', 'Thread not found.')
      const index = thread.chatState.items.findIndex((item) => item.type === 'message' && item.id === input.messageId)
      if (index < 0) return this.fail('invalid-argument', 'Message was not found.')
      const now = this.now(); const fork: RuntimeDevelopmentThread = { ...thread, id: this.createId('runtime-thread'), createdAt: now, updatedAt: now, pinnedAt: undefined, archivedAt: undefined, creationSource: { kind: 'user' }, chatState: { ...thread.chatState, sessionId: undefined, items: structuredClone(thread.chatState.items.slice(0, index + 1)) } }
      const saved = await this.options.store.save({ ...state, runtimeDevelopmentThreads: [fork, ...state.runtimeDevelopmentThreads] }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId)
      return { ok: true, value: { threadId: fork.id, runtimeThreadRevision: saved.runtimeThreadRevision } }
    })
  }

  editAndSubmitRun(authority: RuntimeChatAuthority, input: EditAndSubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      if (this.busy(authority.runtimeScopeId, thread.id)) return this.fail('thread-busy', 'Thread already has an active run.')
      const index = thread.chatState.items.findIndex((item) => item.type === 'message' && item.role === 'user' && item.id === input.messageId)
      const text = input.text.trim(); if (index < 0 || !text) return this.fail('invalid-argument', 'User message is invalid.')
      try { await this.options.core.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') }
      const now = this.now(); const items = thread.chatState.items.slice(0, index + 1); const message = items[index]
      if (message.type !== 'message') return this.fail('invalid-argument', 'User message is invalid.')
      items[index] = { ...message, content: text, status: 'done', completedAt: now }
      const modelPick = input.modelPick ?? thread.chatState.modelPick
      const edited = { ...thread, updatedAt: now, chatState: { ...thread.chatState, sessionId: undefined, model: modelPick?.anthropicModel ?? thread.chatState.model, modelPick, items } }
      await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id === thread.id ? edited : candidate) }, state.runtimeThreadRevision)
      return this.submitAccepted(authority, authorized.scope, edited, text, undefined, undefined, now)
    })
  }

  archiveThread(authority: RuntimeChatAuthority, input: RuntimeChatThreadInput): Promise<ProjectChatResult<void>> { return this.mutateThread(authority, input, (thread, now) => ({ ...thread, archivedAt: now, updatedAt: now }), true) }
  setThreadPinned(authority: RuntimeChatAuthority, input: SetRuntimeChatThreadPinnedInput): Promise<ProjectChatResult<void>> { return this.mutateThread(authority, input, (thread, now) => ({ ...thread, pinnedAt: input.pinned ? now : undefined, updatedAt: now })) }

  setThreadModel(authority: RuntimeChatAuthority, input: SetRuntimeChatThreadModelInput): Promise<ProjectChatResult<void>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      if (this.busy(authority.runtimeScopeId, thread.id)) return this.fail('thread-busy', 'Thread already has an active run.')
      if (sameModel(thread.chatState.modelPick, input.modelPick)) return { ok: true, value: undefined }
      try { await this.options.core.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') }
      const now = this.now(); await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id === thread.id ? { ...candidate, updatedAt: now, chatState: { ...candidate.chatState, model: input.modelPick.anthropicModel, modelPick: input.modelPick, sessionId: undefined } } : candidate) }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId); return { ok: true, value: undefined }
    })
  }

  markFileDiffReviewed(authority: RuntimeChatAuthority, input: RuntimeChatDiffInput): Promise<ProjectChatResult<void>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, false); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      const found = thread.chatState.items.some((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId)
      if (!found) return this.fail('invalid-argument', 'File diff was not found.')
      const now = this.now(); await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id !== thread.id ? candidate : { ...candidate, updatedAt: now, chatState: { ...candidate.chatState, items: candidate.chatState.items.map((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId ? { ...item, status: 'reviewed', detail: undefined } : item) } }) }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId); return { ok: true, value: undefined }
    })
  }

  rewindFileDiff(authority: RuntimeChatAuthority, input: RuntimeChatDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      if (this.busy(authority.runtimeScopeId, thread.id)) return this.fail('thread-busy', 'Thread already has an active run.')
      const diff = thread.chatState.items.find((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId)
      if (!diff || diff.type !== 'file_diff' || !diff.checkpointId?.trim()) return this.fail('invalid-argument', 'File diff was not found.')
      if (diff.status === 'reverted') return { ok: true, value: { changeSetId: input.changeSetId, status: 'reverted' } }
      let ok = false
      try { ok = (await this.options.core.rewindFiles({ requestId: diff.requestId, threadId: thread.id, modelPick: thread.chatState.modelPick, changeSetId: diff.changeSetId, checkpointId: diff.checkpointId, cwd: authorized.scope.cwd, sessionId: thread.chatState.sessionId })).ok } catch { return this.fail('internal-error', 'Unable to rewind file changes.') }
      const status = ok ? 'reverted' as const : 'error' as const; const detail = ok ? undefined : 'Unable to rewind file changes.'; const now = this.now()
      await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id !== thread.id ? candidate : { ...candidate, updatedAt: now, chatState: { ...candidate.chatState, items: candidate.chatState.items.map((item) => item.type === 'file_diff' && item.changeSetId === input.changeSetId ? { ...item, status, detail } : item) } }) }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId); return { ok: true, value: { changeSetId: input.changeSetId, status, ...(detail ? { detail } : {}) } }
    })
  }

  cancelRun(authority: RuntimeChatAuthority, input: CancelRuntimeChatRunInput): Promise<ProjectChatResult<void>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, false); if (!authorized.ok) return authorized
      const cancelled = await this.options.core.cancel({ scopeKind: 'runtime', scopeId: authority.runtimeScopeId, threadId: input.threadId, requestId: input.requestId, routeGeneration: authority.routeGeneration })
      return cancelled ? { ok: true, value: undefined } : this.fail('request-not-found', 'Run request not found.')
    })
  }

  answerPrompt(authority: RuntimeChatAuthority, input: AnswerRuntimeChatPromptInput): Promise<ProjectChatResult<void>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, false); if (!authorized.ok) return authorized
      if (input.response.permissionRequestId !== input.promptId) return this.fail('invalid-argument', 'Prompt response does not match the prompt.')
      const result = await this.options.core.answerPrompt({ scopeKind: 'runtime', scopeId: authority.runtimeScopeId, threadId: input.threadId, requestId: input.requestId, promptId: input.promptId, routeGeneration: authority.routeGeneration, developmentGeneration: authority.developmentGeneration, response: input.response, ownerWebContentsId: authority.ownerWebContentsId })
      if (result === 'stale') return this.fail('runtime-scope-stale', 'Runtime scope is stale.', true)
      if (result === 'not-found' || result === 'not-owned') return this.fail('prompt-not-owned', 'Prompt is no longer available.')
      return result === 'failed' ? this.fail('internal-error', 'Unable to answer the prompt.') : { ok: true, value: undefined }
    })
  }

  refreshPromptOwners(runtimeScopeId?: RuntimeScopeId): Promise<void> { return this.options.core.refreshPromptOwners('runtime', runtimeScopeId) }
  onWebContentsUnavailable(webContentsId: number): Promise<void> { return this.options.core.refreshPromptOwners('runtime', undefined, webContentsId) }
  idle(): Promise<void> { return this.options.core.idle() }

  private async submit(authority: RuntimeChatAuthority, input: SubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>> {
    const authorized = this.authorize(authority, true); if (!authorized.ok) return authorized
    if (this.options.developmentCoordinator && !this.options.developmentCoordinator.canSubmit(authority)) return this.fail('thread-busy', 'Runtime development is ending.', true)
    const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
    if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
    if (!input.text.trim() && !input.attachments?.length) return this.fail('invalid-argument', 'Run text is required.')
    if (this.busy(authority.runtimeScopeId, thread.id)) return this.fail('thread-busy', 'Thread already has an active run.')
    const modelChanged = input.modelPick !== undefined && !sameModel(thread.chatState.modelPick, input.modelPick)
    if (modelChanged) { try { await this.options.core.resetThread(thread.id) } catch { return this.fail('internal-error', 'Unable to reset the thread.') } }
    const now = this.now(); const attachments = input.attachments?.map((item) => ({ ...item, path: '' }))
    const message = { type: 'message' as const, id: this.createId('user'), role: 'user' as const, content: input.text, status: 'done' as const, createdAt: now, completedAt: now, attachments }
    const title = !thread.chatState.items.some((item) => item.type === 'message' && item.role === 'user') && (thread.title === '新对话' || thread.title === 'New thread') ? derivedTitle(input.text) ?? thread.title : thread.title
    const persisted = { ...thread, title, updatedAt: now, chatState: { ...thread.chatState, cwd: authorized.scope.cwd, ...(modelChanged ? { sessionId: undefined, model: input.modelPick!.anthropicModel, modelPick: input.modelPick } : {}), items: [...thread.chatState.items, message] } }
    await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id === thread.id ? persisted : candidate) }, state.runtimeThreadRevision)
    return this.submitAccepted(authority, authorized.scope, persisted, input.text, attachments, input.handoffContext, now)
  }

  private async submitAccepted(authority: RuntimeChatAuthority, scope: ResolvedRuntimeChatScope, thread: RuntimeDevelopmentThread, text: string, attachments: SubmitRuntimeChatRunInput['attachments'], handoffContext: string | undefined, now: number): Promise<ProjectChatResult<{ requestId: string }>> {
    const pending = this.createId('pending-run'); const permissionMode = this.permissionMode()
    try {
      const submitted = await this.options.core.submit({ scopeKind: 'runtime', scopeId: authority.runtimeScopeId, threadId: thread.id, routeGeneration: scope.routeGeneration, developmentGeneration: scope.developmentGeneration, startedAt: now }, { text, attachments: attachments?.map((item) => ({ ...item, path: '' })), threadId: thread.id, modelPick: thread.chatState.modelPick, handoffContext, sessionId: thread.chatState.sessionId, cwd: scope.cwd, projectId: scope.runtimeOwner.kind === 'project' ? scope.runtimeOwner.projectId : undefined, projectRuntimePrompt: scope.runtimeOwner.kind === 'project', permissionMode, runtimeRoot: scope.runtimeRoot }, pending)
      this.broadcastSnapshot(authority.runtimeScopeId); return { ok: true, value: { requestId: submitted.requestId } }
    } catch {
      const state = this.options.store.read(); const failedAt = this.now()
      await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id !== thread.id ? candidate : { ...candidate, updatedAt: failedAt, chatState: { ...candidate.chatState, items: [...candidate.chatState.items, { type: 'message', id: `assistant-${pending}`, role: 'assistant', content: 'Unable to submit the run.', status: 'error', createdAt: now, startedAt: now, completedAt: failedAt, durationMs: Math.max(0, failedAt - now) }] } }) }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId); return this.fail('sdk-submit-failed', 'Unable to submit the run.')
    }
  }

  private mutateThread(authority: RuntimeChatAuthority, input: RuntimeChatThreadInput, mutate: (thread: RuntimeDevelopmentThread, now: number) => RuntimeDevelopmentThread, requireIdle = false): Promise<ProjectChatResult<void>> {
    return this.options.core.enqueue(async () => {
      const authorized = this.authorize(authority, false); if (!authorized.ok) return authorized
      const state = this.options.store.read(); const thread = this.thread(state, authority.runtimeScopeId, input.threadId)
      if (!thread || thread.archivedAt) return this.fail('thread-not-found', 'Thread not found.')
      if (requireIdle && this.busy(authority.runtimeScopeId, thread.id)) return this.fail('thread-busy', 'Thread already has an active run.')
      const next = mutate(thread, this.now())
      await this.options.store.save({ ...state, runtimeDevelopmentThreads: state.runtimeDevelopmentThreads.map((candidate) => candidate.id === thread.id ? next : candidate) }, state.runtimeThreadRevision)
      this.broadcastSnapshot(authority.runtimeScopeId); return { ok: true, value: undefined }
    })
  }

  private authorize(authority: RuntimeChatAuthority, requireAvailable: boolean): RuntimeAuthorityResult {
    const scope = this.resolve(authority.runtimeScopeId)
    if (!scope) return { ok: false, error: projectChatError('runtime-scope-unavailable', 'Runtime is unavailable.', !requireAvailable) }
    if (scope.routeGeneration !== authority.routeGeneration || scope.developmentGeneration !== authority.developmentGeneration) return { ok: false, error: projectChatError('runtime-scope-stale', 'Runtime scope is stale.', true) }
    if (!validScopeRoot(scope)) return { ok: false, error: projectChatError('runtime-root-invalid', 'Runtime root is invalid.') }
    if (requireAvailable && scope.available === false) return { ok: false, error: projectChatError('runtime-scope-unavailable', 'Runtime is unavailable.') }
    return { ok: true, scope }
  }

  private resolve(runtimeScopeId: RuntimeScopeId): ResolvedRuntimeChatScope | null {
    const resolved = this.options.resolveScope(runtimeScopeId)
    if (!resolved || resolved.runtimeScopeId !== runtimeScopeId || !runtimeOwnerMatchesScope(runtimeScopeId, resolved.runtimeOwner, resolved.runtimeDefinitionId)) return null
    this.options.core.adoptRouteGeneration('runtime', runtimeScopeId, resolved.routeGeneration)
    this.developmentGenerations.set(runtimeScopeId, resolved.developmentGeneration)
    return resolved
  }

  private thread(state: RuntimeDevelopmentWorkspace, runtimeScopeId: RuntimeScopeId, threadId: string): RuntimeDevelopmentThread | undefined {
    return state.runtimeDevelopmentThreads.find((candidate) => candidate.id === threadId && candidate.runtimeScopeId === runtimeScopeId)
  }

  private busy(runtimeScopeId: RuntimeScopeId, threadId: string): boolean {
    return this.options.core.hasActiveRun('runtime', runtimeScopeId, threadId) || this.options.core.hasCurrentPrompt('runtime', runtimeScopeId, threadId)
  }

  private snapshot(runtimeScopeId: RuntimeScopeId, resolved: ResolvedRuntimeChatScope): RuntimeChatInternalSnapshot {
    const state = this.options.store.read(); const sequence = this.sequences.get(runtimeScopeId) ?? 0
    return { runtimeScopeId, runtimeThreadRevision: state.runtimeThreadRevision, sequence, routeGeneration: resolved.routeGeneration, developmentGeneration: resolved.developmentGeneration, scopeAvailable: resolved.available !== false, threads: state.runtimeDevelopmentThreads.filter((thread) => thread.runtimeScopeId === runtimeScopeId).map(runtimeThreadSnapshot), runs: this.options.core.runSnapshots('runtime', runtimeScopeId).map(runtimeRunSnapshot), pendingPrompts: this.options.core.promptSnapshots('runtime', runtimeScopeId).map(runtimePromptSnapshot), permissionMode: this.permissionMode() }
  }

  private broadcastSnapshot(runtimeScopeId: RuntimeScopeId): void {
    const resolved = this.resolve(runtimeScopeId); if (!resolved) return
    const sequence = (this.sequences.get(runtimeScopeId) ?? 0) + 1; this.sequences.set(runtimeScopeId, sequence)
    const snapshot = this.snapshot(runtimeScopeId, resolved); this.broadcast({ type: 'snapshot', runtimeScopeId, sequence, routeGeneration: resolved.routeGeneration, developmentGeneration: resolved.developmentGeneration, runtimeThreadRevision: snapshot.runtimeThreadRevision, snapshot: { ...snapshot, sequence } })
  }

  private filterRuntimeEvent(route: ChatBrokerRequestRoute, event: ClaudeChatEvent): ClaudeChatEvent | null {
    if (event.type !== 'file_diff') return event
    const scope = this.resolve(route.scopeId as RuntimeScopeId); if (!scope) return null
    const files = event.files.filter((file) => relativeFileWithin(scope.cwd, scope.runtimeRoot, file.relativePath))
    if (files.length !== event.files.length) console.warn('[runtime-chat] diff-outside-root-rejected', { rejectedCount: event.files.length - files.length })
    return files.length ? { ...event, files } : null
  }

  private fail(code: Parameters<typeof projectChatError>[0], message: string, retryable = false): ProjectChatResult<never> { return { ok: false, error: projectChatError(code, message, retryable) } }
}

function validScopeRoot(scope: ResolvedRuntimeChatScope): boolean {
  const parsed = parseRuntimeScopeId(scope.runtimeScopeId); if (!parsed || !scope.cwd.trim() || !scope.runtimeRoot.trim()) return false
  const cwd = path.resolve(scope.cwd); const root = path.resolve(scope.runtimeRoot)
  return parsed.kind === 'project' ? root === path.join(cwd, '.agentos') : root === cwd
}

function runtimeAuthority(route: ChatBrokerRequestRoute): RuntimeDevelopmentAuthority {
  return { runtimeScopeId: route.scopeId as RuntimeScopeId, routeGeneration: route.routeGeneration, developmentGeneration: route.developmentGeneration }
}

function relativeFileWithin(cwd: string, runtimeRoot: string, relativePath: string): boolean {
  const normalized = normalizeProjectChatRelativePath(relativePath); if (!normalized) return false
  const target = path.resolve(cwd, ...normalized.split('/')); const root = path.resolve(runtimeRoot); const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function runtimeThreadSnapshot(thread: RuntimeDevelopmentThread): RuntimeChatThreadSnapshot {
  return { id: thread.id, runtimeScopeId: thread.runtimeScopeId, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, pinnedAt: thread.pinnedAt, archivedAt: thread.archivedAt, chatState: { model: thread.chatState.model, modelPick: thread.chatState.modelPick, items: thread.chatState.items.map(projectChatTranscriptItem) } }
}

function runtimeRunSnapshot(run: ChatBrokerRun): RuntimeChatRunSnapshot {
  return { runtimeScopeId: run.scopeId as RuntimeScopeId, threadId: run.threadId, requestId: run.requestId, phase: run.phase, routeGeneration: run.routeGeneration, developmentGeneration: run.developmentGeneration, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error }
}

function runtimePromptSnapshot(prompt: ChatBrokerPrompt): RuntimeChatOwnedPromptSnapshot {
  return { runtimeScopeId: prompt.scopeId as RuntimeScopeId, threadId: prompt.threadId, requestId: prompt.requestId, promptId: prompt.promptId, kind: prompt.kind, createdAt: prompt.createdAt, payload: prompt.payload, ownerWebContentsId: prompt.ownerWebContentsId }
}

function sameModel(left: { providerId: string; anthropicModel: string } | undefined, right: { providerId: string; anthropicModel: string } | undefined): boolean { return left?.providerId === right?.providerId && left?.anthropicModel === right?.anthropicModel }
function derivedTitle(text: string): string | null { const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean); return first ? (first.length > 34 ? `${first.slice(0, 34)}...` : first) : null }
