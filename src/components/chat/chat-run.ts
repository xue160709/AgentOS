/**
 * Chat Run lifecycle module: request ownership, run state, event folding, and cleanup.
 */

import type { ClaudeChatEvent } from '../../claude-chat-types'
import {
  foldChatRunEvent as foldProjectChatRunEvent,
  type ChatRunEventFoldContext,
} from '../../project-chat-reducer'
import type {
  ChatMessageItem,
  ChatState,
  ThreadRunState,
} from '../types'

export type ChatRunPrompt =
  | Extract<ClaudeChatEvent, { type: 'ask_user_question' }>
  | Extract<ClaudeChatEvent, { type: 'permission_request' }>

export type ChatRunTerminal =
  | { kind: 'result' }
  | { kind: 'error'; code: string }
  | { kind: 'cancelled' }

export type ChatRunTransition = {
  threadId: string
  updateState?: (prev: ChatState) => ChatState
  runState?: ThreadRunState | null
  clearCompletion?: boolean
  markCompleted?: boolean
  prompt?: ChatRunPrompt
  removePromptsForRequest?: string
  terminal?: ChatRunTerminal
  flush?: boolean
  scrollToBottom?: boolean
}

export type ChatRunSubmission = {
  pendingRequestId: string
  startedAt: number
  runState: ThreadRunState
}

export type ChatRunSubmitTransport = () => Promise<{ requestId: string }>

export type ChatRunSubmitInput = {
  threadId: string
  text: string
  attachments?: ChatMessageItem['attachments']
  model?: string
  modelPick?: ChatState['modelPick']
  clearSession?: boolean
  reuseUserMessageId?: boolean
  bridgeUnavailableBody: string
  submit?: ChatRunSubmitTransport
}

export type ChatRunSubmitAttempt = {
  startedAt: number
  startTransition: ChatRunTransition
  result: Promise<ChatRunSubmitResult>
}

export type ChatRunSubmitResult =
  | {
      status: 'accepted'
      requestId: string
      transition: ChatRunTransition
    }
  | {
      status: 'bridge_unavailable'
      transition: ChatRunTransition
    }
  | {
      status: 'failed'
      error: unknown
      missingSession: boolean
      transition: ChatRunTransition
    }

export type ChatRunOptions = {
  now?: () => number
  random?: () => number
  schedule?: (callback: () => void, delayMs: number) => void
}

export type ChatRunEventContext = {
  activeThreadId: string
  fallbackModel?: string
  stoppedBody?: string
}

/**
 * Deep module for one renderer's Chat Run lifecycle.
 *
 * The interface accepts lifecycle facts; the implementation hides request maps,
 * pending-to-real request races, event ordering, run state, and cleanup.
 */
export class ChatRun {
  private runStates: Record<string, ThreadRunState> = {}
  private readonly requestThreadIds = new Map<string, string>()
  private readonly requestAssistantMessageIds = new Map<string, string>()
  private readonly requestStartedAt = new Map<string, number>()
  private readonly finishedRequestIds = new Set<string>()
  private readonly now: () => number
  private readonly random: () => number
  private readonly schedule: (callback: () => void, delayMs: number) => void

  constructor(options: ChatRunOptions = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.schedule = options.schedule ?? ((callback, delayMs) => {
      setTimeout(callback, delayMs)
    })
  }

  syncRunStates(states: Record<string, ThreadRunState>): void {
    this.runStates = states
  }

  isThreadRunning(threadId: string): boolean {
    return Boolean(this.runStates[threadId])
  }

  runStateForThread(threadId: string): ThreadRunState | undefined {
    return this.runStates[threadId]
  }

  threadIdForRequest(requestId: string, fallback = ''): string {
    return this.requestThreadIds.get(requestId) ?? fallback
  }

  submit(input: ChatRunSubmitInput): ChatRunSubmitAttempt | null {
    const submission = this.beginSubmission(input.threadId)
    if (!submission) return null

    const startTransition: ChatRunTransition = {
      threadId: input.threadId,
      clearCompletion: true,
      runState: submission.runState,
      scrollToBottom: true,
      updateState: (prev) =>
        applyChatRunSubmitStart(prev, input, {
          startedAt: submission.startedAt,
          userMessageId: this.nextUserMessageId(submission.startedAt),
        }),
    }

    return {
      startedAt: submission.startedAt,
      startTransition,
      result: this.finishSubmission(input, submission),
    }
  }

  beginSubmission(threadId: string): ChatRunSubmission | null {
    if (this.isThreadRunning(threadId)) return null
    const startedAt = this.now()
    const pendingRequestId = `pending-${startedAt.toString(36)}-${this.random().toString(36).slice(2, 8)}`
    this.requestThreadIds.set(pendingRequestId, threadId)
    this.requestStartedAt.set(pendingRequestId, startedAt)
    const runState = this.setRunState(threadId, {
      requestId: pendingRequestId,
      status: 'running',
      startedAt,
      updatedAt: startedAt,
    })
    return { pendingRequestId, startedAt, runState }
  }

  acceptSubmission(
    threadId: string,
    pendingRequestId: string,
    requestId: string,
    startedAt: number,
  ): ThreadRunState | null | undefined {
    this.requestThreadIds.delete(pendingRequestId)
    this.requestStartedAt.delete(pendingRequestId)

    if (this.finishedRequestIds.delete(requestId)) {
      this.cleanupRequest(requestId)
      const current = this.runStates[threadId]
      if (current && (current.requestId === requestId || current.requestId === pendingRequestId)) {
        this.setRunState(threadId, null)
        return null
      }
      return undefined
    }

    this.requestThreadIds.set(requestId, threadId)
    this.requestAssistantMessageIds.set(requestId, `assistant-${requestId}`)
    this.requestStartedAt.set(requestId, startedAt)
    const runState = this.setRunState(threadId, {
      requestId,
      status: 'running',
      startedAt,
      updatedAt: this.now(),
    })
    return runState
  }

  rejectSubmission(threadId: string, pendingRequestId: string): ThreadRunState | null | undefined {
    this.requestThreadIds.delete(pendingRequestId)
    this.requestStartedAt.delete(pendingRequestId)
    const current = this.runStates[threadId]
    if (!current || current.requestId === pendingRequestId) {
      this.setRunState(threadId, null)
      return null
    }
    return undefined
  }

  resumeAfterPrompt(requestId: string, fallbackThreadId: string): ChatRunTransition {
    const threadId = this.threadIdForRequest(requestId, fallbackThreadId)
    const current = this.runStates[threadId]
    const transition: ChatRunTransition = { threadId }
    if (current?.requestId === requestId && (current.status === 'asking' || current.status === 'waiting')) {
      transition.runState = this.setRunState(threadId, {
        ...current,
        status: 'running',
        updatedAt: this.now(),
      })
    }
    return transition
  }

  handleEvent(event: ClaudeChatEvent, context: ChatRunEventContext): ChatRunTransition {
    const knownRequest = this.requestThreadIds.has(event.requestId)
    const resolvedThreadId = event.threadId ?? this.requestThreadIds.get(event.requestId)
    if (!resolvedThreadId && isUnsafeOrphanEvent(event)) {
      return { threadId: '' }
    }
    const threadId = resolvedThreadId ?? context.activeThreadId
    this.requestThreadIds.set(event.requestId, threadId)

    const transition: ChatRunTransition = { threadId }
    const now = this.now()

    if (event.type === 'session_start') {
      this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      transition.updateState = (prev) =>
        foldProjectChatRunEvent(prev, event, { fallbackModel: context.fallbackModel, now })
      return transition
    }

    if (event.type === 'assistant_delta') {
      this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      const assistantMessageId = this.requestAssistantMessageIds.get(event.requestId)
      const requestStartedAt = this.requestStartedAt.get(event.requestId) ?? now
      transition.updateState = (prev) =>
        foldProjectChatRunEvent(prev, event, { assistantMessageId, requestStartedAt, now })
      this.requestAssistantMessageIds.set(event.requestId, event.messageId)
      return transition
    }

    if (
      event.type === 'thinking_start' ||
      event.type === 'thinking_delta' ||
      event.type === 'tool_start' ||
      event.type === 'task_create' ||
      event.type === 'task_update' ||
      event.type === 'task_list' ||
      event.type === 'file_diff'
    ) {
      this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      transition.updateState = (prev) => foldProjectChatRunEvent(prev, event, { now })
      return transition
    }

    if (
      event.type === 'thinking_done' ||
      event.type === 'tool_update' ||
      event.type === 'tool_done' ||
      event.type === 'file_rewind_result'
    ) {
      transition.updateState = (prev) => foldProjectChatRunEvent(prev, event, { now })
      return transition
    }

    if (event.type === 'ask_user_question' || event.type === 'permission_request') {
      this.attachRunningState(
        transition,
        threadId,
        event.requestId,
        event.type === 'ask_user_question' ? 'asking' : 'waiting',
        now,
      )
      transition.prompt = event
      return transition
    }

    if (event.type === 'agent_activity') {
      if (event.status === 'running') {
        this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      }
      transition.updateState = (prev) => foldProjectChatRunEvent(prev, event, { now })
      return transition
    }

    if (event.type === 'context_compaction') {
      if (event.status === 'running') {
        this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      }
      transition.updateState = (prev) => foldProjectChatRunEvent(prev, event, { now })
      return transition
    }

    if (event.type === 'result' || event.type === 'error' || event.type === 'cancelled') {
      const requestStartedAt = this.requestStartedAt.get(event.requestId) ?? now
      const assistantMessageId = this.requestAssistantMessageIds.get(event.requestId)
      transition.updateState = (prev) =>
        foldProjectChatRunEvent(prev, event, {
          assistantMessageId,
          requestStartedAt,
          now,
          stoppedBody: context.stoppedBody,
        })
      transition.flush = true
      transition.scrollToBottom = event.type !== 'result'
      transition.terminal =
        event.type === 'result'
          ? { kind: 'result' }
          : event.type === 'error'
            ? { kind: 'error', code: event.code }
            : { kind: 'cancelled' }
      transition.markCompleted = event.type === 'result'
      transition.removePromptsForRequest = event.requestId
      this.finishRequest(transition, event.requestId, !knownRequest)
      return transition
    }

    return transition
  }

  private attachRunningState(
    transition: ChatRunTransition,
    threadId: string,
    requestId: string,
    status: ThreadRunState['status'],
    now: number,
  ): void {
    transition.clearCompletion = true
    this.requestThreadIds.set(requestId, threadId)
    const current = this.runStates[threadId]
    if (current && current.requestId !== requestId && !isPendingRequestId(current.requestId)) return
    if (current?.requestId === requestId && current.status === 'asking' && status === 'running') return
    if (current?.requestId === requestId && current.status === status) return
    const startedAt = current?.startedAt ?? this.requestStartedAt.get(requestId) ?? now
    this.requestStartedAt.set(requestId, startedAt)
    transition.runState = this.setRunState(threadId, {
      requestId,
      status,
      startedAt,
      updatedAt: now,
    })
  }

  private finishRequest(
    transition: ChatRunTransition,
    requestId: string,
    clearPendingRun: boolean,
  ): void {
    let threadId = this.requestThreadIds.get(requestId) ?? transition.threadId
    if (!threadId) {
      threadId =
        Object.entries(this.runStates).find(([, state]) => state.requestId === requestId)?.[0] ??
        ''
      transition.threadId = threadId
    }

    this.finishedRequestIds.add(requestId)
    this.schedule(() => this.finishedRequestIds.delete(requestId), 30_000)
    this.cleanupRequest(requestId)

    if (!threadId) return
    const current = this.runStates[threadId]
    if (
      !current ||
      current.requestId === requestId ||
      (clearPendingRun && isPendingRequestId(current.requestId))
    ) {
      transition.runState = this.setRunState(threadId, null)
    }
  }

  private cleanupRequest(requestId: string): void {
    this.requestAssistantMessageIds.delete(requestId)
    this.requestStartedAt.delete(requestId)
    this.requestThreadIds.delete(requestId)
  }

  private async finishSubmission(
    input: ChatRunSubmitInput,
    submission: ChatRunSubmission,
  ): Promise<ChatRunSubmitResult> {
    if (!input.submit) {
      return this.failSubmission(input, submission, input.bridgeUnavailableBody, 'bridge_unavailable')
    }

    try {
      const { requestId } = await input.submit()
      const runState = this.acceptSubmission(
        input.threadId,
        submission.pendingRequestId,
        requestId,
        submission.startedAt,
      )
      const transition: ChatRunTransition = { threadId: input.threadId }
      if (runState !== undefined) transition.runState = runState
      return { status: 'accepted', requestId, transition }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.failSubmission(input, submission, message, 'failed', error)
    }
  }

  private failSubmission(
    input: ChatRunSubmitInput,
    submission: ChatRunSubmission,
    message: string,
    status: 'bridge_unavailable',
  ): ChatRunSubmitResult
  private failSubmission(
    input: ChatRunSubmitInput,
    submission: ChatRunSubmission,
    message: string,
    status: 'failed',
    error: unknown,
  ): ChatRunSubmitResult
  private failSubmission(
    input: ChatRunSubmitInput,
    submission: ChatRunSubmission,
    message: string,
    status: 'bridge_unavailable' | 'failed',
    error?: unknown,
  ): ChatRunSubmitResult {
    const completedAt = this.now()
    const missingSession = isMissingSessionMessage(message)
    const runState = this.rejectSubmission(input.threadId, submission.pendingRequestId)
    const transition: ChatRunTransition = {
      threadId: input.threadId,
      scrollToBottom: true,
      updateState: (prev) =>
        appendAssistantErrorMessage(prev, {
          id: this.nextAssistantErrorId(completedAt),
          content: message,
          createdAt: submission.startedAt,
          completedAt,
          clearSession: missingSession,
        }),
    }
    if (runState !== undefined) transition.runState = runState
    if (status === 'bridge_unavailable') return { status, transition }
    return { status, error, missingSession, transition }
  }

  private nextUserMessageId(startedAt: number): string {
    return `user-${startedAt.toString(36)}-${this.random().toString(36).slice(2, 8)}`
  }

  private nextAssistantErrorId(completedAt: number): string {
    return `assistant-error-${completedAt.toString(36)}-${this.random().toString(36).slice(2, 8)}`
  }

  private setRunState(threadId: string, state: ThreadRunState): ThreadRunState
  private setRunState(threadId: string, state: null): null
  private setRunState(threadId: string, state: ThreadRunState | null): ThreadRunState | null {
    if (state) {
      this.runStates = { ...this.runStates, [threadId]: state }
      return state
    }
    if (this.runStates[threadId]) {
      const next = { ...this.runStates }
      delete next[threadId]
      this.runStates = next
    }
    return null
  }
}

function applyChatRunSubmitStart(
  prev: ChatState,
  input: ChatRunSubmitInput,
  context: { startedAt: number; userMessageId: string },
): ChatState {
  const nextState: ChatState = {
    ...prev,
    model: input.model ?? prev.model,
    modelPick: input.modelPick ?? prev.modelPick,
    sessionId: input.clearSession ? undefined : prev.sessionId,
  }

  if (input.reuseUserMessageId) return nextState

  const message: ChatMessageItem = {
    type: 'message',
    id: context.userMessageId,
    role: 'user',
    content: input.text,
    status: 'done',
    createdAt: context.startedAt,
    completedAt: context.startedAt,
    attachments: input.attachments,
  }

  return {
    ...nextState,
    items: [...nextState.items, message],
  }
}

function appendAssistantErrorMessage(
  prev: ChatState,
  input: {
    id: string
    content: string
    createdAt: number
    completedAt: number
    clearSession: boolean
  },
): ChatState {
  return {
    ...prev,
    sessionId: input.clearSession ? undefined : prev.sessionId,
    items: [
      ...prev.items,
      {
        type: 'message',
        id: input.id,
        role: 'assistant',
        content: input.content,
        status: 'error',
        createdAt: input.createdAt,
        startedAt: input.createdAt,
        completedAt: input.completedAt,
        durationMs: Math.max(0, input.completedAt - input.createdAt),
      },
    ],
  }
}

export function foldChatRunEventLegacy(
  prev: ChatState,
  event: ClaudeChatEvent,
  context: ChatRunEventFoldContext = {},
): ChatState {
  return foldProjectChatRunEvent(prev, event, context)
}

function isPendingRequestId(requestId: string): boolean {
  return requestId.startsWith('pending-')
}

function isUnsafeOrphanEvent(event: ClaudeChatEvent): boolean {
  return (
    event.type === 'result' ||
    event.type === 'error' ||
    event.type === 'cancelled' ||
    event.type === 'file_rewind_result'
  )
}

function isMissingSessionMessage(message: string): boolean {
  return message.includes('No conversation found with session ID')
}
