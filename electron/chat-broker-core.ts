import type {
  ClaudeChatEvent,
  ClaudeChatSubmitPayload,
  ClaudeFileRewindPayload,
  ClaudeFileRewindResult,
  ClaudePermissionResponsePayload,
} from '../src/claude-chat-types'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { ChatState } from '../src/components/types'
import { foldChatRunEvent } from '../src/project-chat-reducer'
import {
  projectChatError,
  type ProjectChatPromptPayload,
  type ProjectChatRunPhase,
} from '../src/project-chat-contract'

export type ChatBrokerScopeKind = 'project' | 'runtime'

/** Main 在调用 Runner 前冻结的唯一事件路由；renderer 不能提供其中任何 authority 字段。 */
export type ChatBrokerRequestRoute = Readonly<{
  scopeKind: ChatBrokerScopeKind
  scopeId: string
  threadId: string
  routeGeneration: number
  developmentGeneration: number
  startedAt: number
}>

export type ChatBrokerRun = ChatBrokerRequestRoute & {
  requestId: string
  phase: ProjectChatRunPhase
  finishedAt?: number
  error?: ReturnType<typeof projectChatError>
  /** SDK's final answer, kept separate from the accumulated streaming transcript. */
  finalResult?: string
}

export type ChatBrokerPrompt = ChatBrokerRequestRoute & {
  requestId: string
  promptId: string
  kind: ProjectChatPromptPayload['kind']
  createdAt: number
  payload: ProjectChatPromptPayload
  ownerWebContentsId?: number
}

export type ChatBrokerRunnerSubmitPayload = ClaudeChatSubmitPayload & {
  /** Main-only Runtime mutation fence; never exposed through renderer DTOs. */
  runtimeRoot?: string
}

export type ChatBrokerRunner = {
  submit(payload: ChatBrokerRunnerSubmitPayload): { requestId: string } | Promise<{ requestId: string }>
  cancel(requestId?: string): Promise<void>
  answerPermissionRequest(payload: ClaudePermissionResponsePayload): Promise<void>
  resetThread(threadId: string): Promise<void>
  rewindFiles(payload: ClaudeFileRewindPayload): Promise<ClaudeFileRewindResult>
}

export type ChatBrokerThreadRecord = { chatState: ChatState }

export type ChatBrokerFacadeAdapter = {
  readThread(scopeId: string, threadId: string): ChatBrokerThreadRecord | null | Promise<ChatBrokerThreadRecord | null>
  /**
   * `options.durable === false` marks a mid-run streaming write: the facade may
   * keep it in memory and defer the disk write. Terminal events are durable.
   */
  saveThreadChatState(scopeId: string, threadId: string, chatState: ChatState, updatedAt: number, options?: { durable?: boolean }): Promise<boolean>
  broadcast(scopeId: string): void | Promise<void>
  isRouteCurrent(route: ChatBrokerRequestRoute): boolean | Promise<boolean>
  promptOwnerCandidates?(route: ChatBrokerRequestRoute): number[]
  filterEvent?(route: ChatBrokerRequestRoute, event: ClaudeChatEvent): ClaudeChatEvent | null
  onSubmitting?(route: ChatBrokerRequestRoute, pendingRequestId: string, permissionMode: string): boolean | Promise<boolean>
  onAccepted?(route: ChatBrokerRequestRoute, requestId: string, permissionMode: string, pendingRequestId: string): boolean | void | Promise<boolean | void>
  onSubmitRejected?(route: ChatBrokerRequestRoute, pendingRequestId: string, acceptedRequestId?: string): void | Promise<void>
  onPromptWaiting?(route: ChatBrokerRequestRoute, requestId: string, promptId: string): void | Promise<void>
  onPromptResolved?(route: ChatBrokerRequestRoute, requestId: string, promptId: string): void | Promise<void>
  onTerminal?(route: ChatBrokerRequestRoute, requestId: string, phase: 'succeeded' | 'failed' | 'cancelled'): void | Promise<void>
}

export type ChatBrokerCoreOptions = {
  runner: ChatBrokerRunner
  now?: () => number
  runExclusive?: <T>(operation: () => Promise<T> | T) => Promise<T>
}

type MutableRoute = ChatBrokerRequestRoute & { assistantMessageId?: string }

/**
 * Main-owned 单一聊天引擎。Facade 只负责各自 scope 的读取/投影；队列、Runner、route、
 * prompt 与 reducer 均只有这一份，防止 Project/Runtime 之间形成两个事实源。
 */
export class ChatBrokerCore {
  private operationChain: Promise<void> = Promise.resolve()
  private externalOperation: Promise<void> = Promise.resolve()
  private readonly adapters = new Map<ChatBrokerScopeKind, { token: symbol; adapter: ChatBrokerFacadeAdapter }>()
  private readonly runs = new Map<string, ChatBrokerRun>()
  private readonly routes = new Map<string, MutableRoute>()
  private readonly prompts = new Map<string, ChatBrokerPrompt>()
  private readonly promptOwners = new Map<string, number[]>()
  private readonly routeGenerations = new Map<string, number>()
  private unknownRequests = 0
  private readonly now: () => number

  constructor(private readonly options: ChatBrokerCoreOptions) {
    this.now = options.now ?? Date.now
  }

  registerFacade(scopeKind: ChatBrokerScopeKind, adapter: ChatBrokerFacadeAdapter): () => void {
    if (this.adapters.has(scopeKind)) throw new Error(`chat-broker-facade-already-registered:${scopeKind}`)
    const token = Symbol(scopeKind)
    this.adapters.set(scopeKind, { token, adapter })
    return () => {
      const registered = this.adapters.get(scopeKind)
      if (registered?.token === token) this.adapters.delete(scopeKind)
    }
  }

  enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.options.runExclusive) {
      const next = this.options.runExclusive(operation)
      this.externalOperation = next.then(() => undefined, () => undefined)
      return next
    }
    const next = this.operationChain.then(() => Promise.resolve().then(operation), () => Promise.resolve().then(operation))
    this.operationChain = next.then(() => undefined, () => undefined)
    return next
  }

  async idle(): Promise<void> {
    await (this.options.runExclusive ? this.externalOperation : this.operationChain)
  }

  routeGenerationOf(scopeKind: ChatBrokerScopeKind, scopeId: string): number {
    return this.routeGenerations.get(scopeKey(scopeKind, scopeId)) ?? 1
  }

  adoptRouteGeneration(scopeKind: ChatBrokerScopeKind, scopeId: string, generation: number): number {
    if (!Number.isSafeInteger(generation) || generation < 1) return this.routeGenerationOf(scopeKind, scopeId)
    this.routeGenerations.set(scopeKey(scopeKind, scopeId), generation)
    return generation
  }

  advanceRouteGeneration(scopeKind: ChatBrokerScopeKind, scopeId: string): number {
    return this.adoptRouteGeneration(scopeKind, scopeId, this.routeGenerationOf(scopeKind, scopeId) + 1)
  }

  /** Reopen transfers still-active Runtime runs/prompts, while save/build callbacks keep their old operation fence. */
  rebaseDevelopmentGeneration(scopeKind: ChatBrokerScopeKind, scopeId: string, routeGeneration: number, fromGeneration: number, toGeneration: number): void {
    if (!Number.isSafeInteger(toGeneration) || toGeneration <= fromGeneration) return
    for (const [requestId, route] of this.routes) {
      if (route.scopeKind === scopeKind && route.scopeId === scopeId && route.routeGeneration === routeGeneration && route.developmentGeneration === fromGeneration) {
        this.routes.set(requestId, { ...route, developmentGeneration: toGeneration })
      }
    }
    for (const [requestId, run] of this.runs) {
      if (run.scopeKind === scopeKind && run.scopeId === scopeId && run.routeGeneration === routeGeneration && run.developmentGeneration === fromGeneration && !isTerminal(run.phase)) {
        this.runs.set(requestId, { ...run, developmentGeneration: toGeneration })
      }
    }
    for (const [promptId, prompt] of this.prompts) {
      if (prompt.scopeKind === scopeKind && prompt.scopeId === scopeId && prompt.routeGeneration === routeGeneration && prompt.developmentGeneration === fromGeneration) {
        this.prompts.set(promptId, { ...prompt, developmentGeneration: toGeneration })
      }
    }
  }

  hasActiveRun(scopeKind: ChatBrokerScopeKind, scopeId: string, threadId: string): boolean {
    const generation = this.routeGenerationOf(scopeKind, scopeId)
    return [...this.runs.values()].some((run) => run.scopeKind === scopeKind && run.scopeId === scopeId && run.threadId === threadId && run.routeGeneration === generation && !isTerminal(run.phase))
  }

  hasCurrentPrompt(scopeKind: ChatBrokerScopeKind, scopeId: string, threadId: string): boolean {
    const generation = this.routeGenerationOf(scopeKind, scopeId)
    return [...this.prompts.values()].some((prompt) => prompt.scopeKind === scopeKind && prompt.scopeId === scopeId && prompt.threadId === threadId && prompt.routeGeneration === generation)
  }

  runSnapshots(scopeKind: ChatBrokerScopeKind, scopeId: string): ChatBrokerRun[] {
    const generation = this.routeGenerationOf(scopeKind, scopeId)
    return [...this.runs.values()].filter((run) => run.scopeKind === scopeKind && run.scopeId === scopeId && run.routeGeneration === generation)
  }

  promptSnapshots(scopeKind: ChatBrokerScopeKind, scopeId: string): ChatBrokerPrompt[] {
    const generation = this.routeGenerationOf(scopeKind, scopeId)
    return [...this.prompts.values()].filter((prompt) => prompt.scopeKind === scopeKind && prompt.scopeId === scopeId && prompt.routeGeneration === generation)
  }

  async submit(routeInput: ChatBrokerRequestRoute, payload: ChatBrokerRunnerSubmitPayload, pendingRequestId: string): Promise<{ requestId: string }> {
    const route = Object.freeze({ ...routeInput })
    const pending: ChatBrokerRun = { ...route, requestId: pendingRequestId, phase: 'submitting' }
    const adapter = this.adapter(route.scopeKind)
    const permissionMode = payload.permissionMode ?? 'auto'
    let submittingRegistered = false
    let acceptedRequestId: string | undefined
    this.runs.set(pendingRequestId, pending)
    try {
      // Runtime potential writer 必须先进入 coordinator authority，exit 才不会越过 submit 窗口。
      if (adapter?.onSubmitting) {
        if (!(await adapter.onSubmitting(route, pendingRequestId, permissionMode))) throw new Error('chat-broker-submitting-route-rejected')
        submittingRegistered = true
      }
      const submitted = await this.options.runner.submit(payload)
      if (!submitted.requestId?.trim()) throw new Error('runner-request-id-invalid')
      acceptedRequestId = submitted.requestId
      this.runs.delete(pendingRequestId)
      this.runs.set(submitted.requestId, { ...route, requestId: submitted.requestId, phase: 'running' })
      this.routes.set(submitted.requestId, { ...route })
      const accepted = await adapter?.onAccepted?.(route, submitted.requestId, permissionMode, pendingRequestId)
      if (accepted === false) throw new Error('chat-broker-accepted-route-rejected')
      return { requestId: submitted.requestId }
    } catch (error) {
      if (acceptedRequestId) {
        // 无 coordinator route 的 accepted writer 不得继续产生 mutation；先撤销事件路由，再立即发 cancel。
        this.routes.delete(acceptedRequestId)
        this.runs.delete(acceptedRequestId)
        try {
          void this.options.runner.cancel(acceptedRequestId).catch(() => {
            console.error('[chat-broker/core] accepted-run-cancel-failed', { scopeKind: route.scopeKind, code: 'accepted-run-cancel-failed' })
          })
        } catch {
          console.error('[chat-broker/core] accepted-run-cancel-failed', { scopeKind: route.scopeKind, code: 'accepted-run-cancel-failed' })
        }
      }
      if (submittingRegistered) {
        try {
          await adapter?.onSubmitRejected?.(route, pendingRequestId, acceptedRequestId)
        } catch {
          console.error('[chat-broker/core] submit-authority-rollback-failed', { scopeKind: route.scopeKind, code: 'submit-authority-rollback-failed' })
        }
      }
      if (adapter?.onSubmitRejected) {
        this.runs.delete(pendingRequestId)
      } else {
        // Project facade 未采用 Runtime authority hook，保持原有失败 snapshot 语义。
        this.runs.set(pendingRequestId, {
          ...pending,
          phase: 'failed',
          finishedAt: this.now(),
          error: projectChatError('sdk-submit-failed', 'Unable to submit the run.'),
        })
      }
      throw error
    }
  }

  async cancel(route: Pick<ChatBrokerRequestRoute, 'scopeKind' | 'scopeId' | 'threadId' | 'routeGeneration'> & { requestId: string }): Promise<boolean> {
    const registered = this.routes.get(route.requestId)
    if (!registered || registered.scopeKind !== route.scopeKind || registered.scopeId !== route.scopeId || registered.threadId !== route.threadId || registered.routeGeneration !== route.routeGeneration) return false
    await this.options.runner.cancel(route.requestId)
    return true
  }

  resetThread(threadId: string): Promise<void> {
    return this.options.runner.resetThread(threadId)
  }

  rewindFiles(payload: ClaudeFileRewindPayload): Promise<ClaudeFileRewindResult> {
    return this.options.runner.rewindFiles(payload)
  }

  async answerPrompt(input: {
    scopeKind: ChatBrokerScopeKind
    scopeId: string
    threadId: string
    requestId: string
    promptId: string
    routeGeneration: number
    developmentGeneration: number
    response: ClaudePermissionResponsePayload
    ownerWebContentsId?: number
  }): Promise<'ok' | 'not-found' | 'stale' | 'not-owned' | 'failed'> {
    const prompt = this.prompts.get(input.promptId)
    if (!prompt || prompt.scopeKind !== input.scopeKind || prompt.scopeId !== input.scopeId || prompt.threadId !== input.threadId || prompt.requestId !== input.requestId) return 'not-found'
    if (prompt.routeGeneration !== input.routeGeneration || prompt.developmentGeneration !== input.developmentGeneration || this.routeGenerationOf(input.scopeKind, input.scopeId) !== input.routeGeneration) return 'stale'
    if (prompt.ownerWebContentsId === undefined || prompt.ownerWebContentsId !== input.ownerWebContentsId) return 'not-owned'
    try {
      await this.options.runner.answerPermissionRequest(input.response)
    } catch {
      return 'failed'
    }
    this.prompts.delete(input.promptId)
    this.promptOwners.delete(input.promptId)
    const run = this.runs.get(input.requestId)
    if (run && !isTerminal(run.phase)) this.runs.set(input.requestId, { ...run, phase: 'running' })
    await this.adapter(input.scopeKind)?.onPromptResolved?.(prompt, input.requestId, input.promptId)
    await this.adapter(input.scopeKind)?.broadcast(input.scopeId)
    return 'ok'
  }

  publish(event: ClaudeChatEvent): void {
    void this.enqueue(() => this.foldPublishedEvent(event)).catch(() => undefined)
  }

  unknownRequestCount(): number { return this.unknownRequests }

  setPromptOwnerCandidates(promptId: string, webContentsIds: number[]): ChatBrokerPrompt | null {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return null
    const owners = validOwners(webContentsIds)
    this.promptOwners.set(promptId, owners)
    const next = { ...prompt, ownerWebContentsId: owners[0] }
    this.prompts.set(promptId, next)
    return next
  }

  reassignPromptOwner(promptId: string, unavailableWebContentsId: number): ChatBrokerPrompt | null {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return null
    const owners = (this.promptOwners.get(promptId) ?? []).filter((owner) => owner !== unavailableWebContentsId)
    this.promptOwners.set(promptId, owners)
    const next = { ...prompt, ownerWebContentsId: owners[0] }
    this.prompts.set(promptId, next)
    return next
  }

  refreshPromptOwners(scopeKind?: ChatBrokerScopeKind, scopeId?: string, unavailable?: number): Promise<void> {
    return this.enqueue(async () => {
      const changed = new Set<string>()
      for (const [promptId, prompt] of this.prompts) {
        if (scopeKind && prompt.scopeKind !== scopeKind) continue
        if (scopeId && prompt.scopeId !== scopeId) continue
        const adapter = this.adapter(prompt.scopeKind)
        if (!adapter || !(await adapter.isRouteCurrent(prompt))) continue
        let candidates: number[]
        let resolved = true
        try { candidates = validOwners(adapter.promptOwnerCandidates?.(prompt) ?? []).filter((id) => id !== unavailable) } catch { candidates = []; resolved = false }
        const owner = prompt.ownerWebContentsId
        if (!resolved) {
          if (unavailable === undefined || owner !== unavailable) continue
          this.promptOwners.set(promptId, (this.promptOwners.get(promptId) ?? []).filter((id) => id !== unavailable))
          this.prompts.set(promptId, { ...prompt, ownerWebContentsId: undefined })
          changed.add(scopeKey(prompt.scopeKind, prompt.scopeId))
          continue
        }
        const nextOwner = owner !== undefined && candidates.includes(owner) ? owner : candidates[0]
        this.promptOwners.set(promptId, candidates)
        if (nextOwner !== owner) {
          this.prompts.set(promptId, { ...prompt, ownerWebContentsId: nextOwner })
          changed.add(scopeKey(prompt.scopeKind, prompt.scopeId))
        }
      }
      for (const key of changed) {
        const parsed = parseScopeKey(key)
        if (parsed) await this.adapter(parsed.scopeKind)?.broadcast(parsed.scopeId)
      }
    })
  }

  private adapter(scopeKind: ChatBrokerScopeKind): ChatBrokerFacadeAdapter | undefined {
    return this.adapters.get(scopeKind)?.adapter
  }

  private async foldPublishedEvent(rawEvent: ClaudeChatEvent): Promise<void> {
    const route = this.routes.get(rawEvent.requestId)
    if (!route) { this.unknownRequests += 1; return }
    if (route.routeGeneration !== this.routeGenerationOf(route.scopeKind, route.scopeId)) return
    const run = this.runs.get(rawEvent.requestId)
    if (!run || isTerminal(run.phase)) return
    const adapter = this.adapter(route.scopeKind)
    if (!adapter || !(await adapter.isRouteCurrent(route))) return
    const event = adapter.filterEvent ? adapter.filterEvent(route, rawEvent) : rawEvent
    if (!event) return
    const thread = await adapter.readThread(route.scopeId, route.threadId)
    if (!thread) return

    if (event.type === 'ask_user_question' || event.type === 'permission_request') {
      const prompt = this.promptFromEvent(route, event)
      let candidates: number[] = []
      try { candidates = validOwners(adapter.promptOwnerCandidates?.(route) ?? []) } catch { candidates = [] }
      this.promptOwners.set(prompt.promptId, candidates)
      this.prompts.set(prompt.promptId, { ...prompt, ownerWebContentsId: candidates[0] })
      this.runs.set(event.requestId, { ...run, phase: event.type === 'ask_user_question' ? 'waiting_answer' : 'waiting_permission' })
      await adapter.onPromptWaiting?.(route, event.requestId, prompt.promptId)
      await adapter.broadcast(route.scopeId)
      return
    }

    const now = this.now()
    const chatState = foldChatRunEvent(thread.chatState, event, { now, assistantMessageId: route.assistantMessageId, requestStartedAt: run.startedAt })
    if (event.type === 'assistant_delta') route.assistantMessageId = event.messageId
    const terminalEvent = event.type === 'result' || event.type === 'error' || event.type === 'cancelled'
    if (!(await adapter.saveThreadChatState(route.scopeId, route.threadId, chatState, now, { durable: terminalEvent }))) return

    if (terminalEvent) {
      const phase = event.type === 'result' ? 'succeeded' : event.type === 'error' ? 'failed' : 'cancelled'
      this.runs.set(event.requestId, {
        ...run,
        phase,
        finishedAt: now,
        ...(event.type === 'result' ? { finalResult: event.result } : {}),
        error: event.type === 'error' ? projectChatError('internal-error', 'Run failed.') : undefined,
      })
      for (const [promptId, prompt] of this.prompts) {
        if (prompt.requestId !== event.requestId) continue
        this.prompts.delete(promptId)
        this.promptOwners.delete(promptId)
        await adapter.onPromptResolved?.(prompt, event.requestId, promptId)
      }
      await adapter.onTerminal?.(route, event.requestId, phase)
    }
    await adapter.broadcast(route.scopeId)
  }

  private promptFromEvent(route: ChatBrokerRequestRoute, event: Extract<ClaudeChatEvent, { type: 'ask_user_question' | 'permission_request' }>): ChatBrokerPrompt {
    const payload: ProjectChatPromptPayload = event.type === 'permission_request'
      ? { kind: 'permission', permissionRequestId: event.permissionRequestId, toolUseId: event.toolUseId, toolName: event.toolName, title: event.title, displayName: event.displayName, description: event.description, inputPreview: event.inputPreview }
      : { kind: 'question', permissionRequestId: event.permissionRequestId, toolUseId: event.toolUseId, questions: event.questions }
    return { ...route, requestId: event.requestId, promptId: event.permissionRequestId, kind: payload.kind, createdAt: this.now(), payload }
  }
}

function isTerminal(phase: ProjectChatRunPhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled'
}

function validOwners(values: number[]): number[] {
  return [...new Set(values.filter((id) => Number.isInteger(id) && id > 0))]
}

function scopeKey(scopeKind: ChatBrokerScopeKind, scopeId: string): string {
  return `${scopeKind}\0${scopeId}`
}

function parseScopeKey(value: string): { scopeKind: ChatBrokerScopeKind; scopeId: string } | null {
  const separator = value.indexOf('\0')
  if (separator < 0) return null
  const scopeKind = value.slice(0, separator)
  return scopeKind === 'project' || scopeKind === 'runtime' ? { scopeKind, scopeId: value.slice(separator + 1) } : null
}

function isReliableMutationTool(toolName: string): boolean {
  return toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit'
}

export async function runtimeMutationTargetAllowed(runtimeRoot: string, toolName: string, input: Record<string, unknown>, cwd = runtimeRoot): Promise<boolean> {
  if (!isReliableMutationTool(toolName)) return true
  const rawTarget = toolName === 'NotebookEdit' ? input.notebook_path : input.file_path
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) return false
  try {
    const root = await canonicalPotentialPath(path.resolve(runtimeRoot))
    const target = await canonicalPotentialPath(path.isAbsolute(rawTarget) ? path.resolve(rawTarget) : path.resolve(cwd, rawTarget))
    const relative = path.relative(root, target)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

/** 对尚未创建的文件向上寻找最近 realpath，避免 symlink parent 绕出 Runtime root。 */
async function canonicalPotentialPath(target: string): Promise<string> {
  let cursor = target
  const missing: string[] = []
  while (true) {
    try {
      const base = await realpath(cursor)
      return path.join(base, ...missing.reverse())
    } catch {
      const parent = path.dirname(cursor)
      if (parent === cursor) throw new Error('runtime-path-unresolvable')
      missing.push(path.basename(cursor))
      cursor = parent
    }
  }
}
