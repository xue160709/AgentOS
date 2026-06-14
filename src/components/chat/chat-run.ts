/**
 * Chat Run lifecycle module: request ownership, run state, event folding, and cleanup.
 */

import type { ClaudeChatEvent } from '../../claude-chat-types'
import type {
  ChatActivityItem,
  ChatFileDiffItem,
  ChatMessageItem,
  ChatState,
  ChatTaskItem,
  ChatTaskState,
  ChatThinkingItem,
  ChatToolItem,
  ThreadRunState,
  TranscriptItem,
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
    if (current?.requestId === requestId && current.status === 'asking') {
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
    const threadId =
      event.threadId ??
      this.requestThreadIds.get(event.requestId) ??
      context.activeThreadId
    this.requestThreadIds.set(event.requestId, threadId)

    const transition: ChatRunTransition = { threadId }
    const now = this.now()

    if (event.type === 'session_start') {
      this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      transition.updateState = (prev) =>
        foldChatRunEvent(prev, event, { fallbackModel: context.fallbackModel, now })
      return transition
    }

    if (event.type === 'assistant_delta') {
      this.attachRunningState(transition, threadId, event.requestId, 'running', now)
      const assistantMessageId = this.requestAssistantMessageIds.get(event.requestId)
      const requestStartedAt = this.requestStartedAt.get(event.requestId) ?? now
      transition.updateState = (prev) =>
        foldChatRunEvent(prev, event, { assistantMessageId, requestStartedAt, now })
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
      transition.updateState = (prev) => foldChatRunEvent(prev, event, { now })
      return transition
    }

    if (
      event.type === 'thinking_done' ||
      event.type === 'tool_update' ||
      event.type === 'tool_done' ||
      event.type === 'file_rewind_result'
    ) {
      transition.updateState = (prev) => foldChatRunEvent(prev, event, { now })
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
      transition.updateState = (prev) => foldChatRunEvent(prev, event, { now })
      return transition
    }

    if (event.type === 'result' || event.type === 'error' || event.type === 'cancelled') {
      const requestStartedAt = this.requestStartedAt.get(event.requestId) ?? now
      const assistantMessageId = this.requestAssistantMessageIds.get(event.requestId)
      transition.updateState = (prev) =>
        foldChatRunEvent(prev, event, {
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

type ChatRunEventFoldContext = {
  now?: number
  requestStartedAt?: number
  assistantMessageId?: string
  fallbackModel?: string
  stoppedBody?: string
}

function foldChatRunEvent(
  prev: ChatState,
  event: ClaudeChatEvent,
  context: ChatRunEventFoldContext = {},
): ChatState {
  const now = context.now ?? Date.now()
  const requestStartedAt = context.requestStartedAt ?? now

  if (event.type === 'session_start') {
    return {
      ...prev,
      sessionId: event.sessionId,
      model: event.model || context.fallbackModel || prev.model,
      cwd: event.cwd,
    }
  }

  if (event.type === 'assistant_delta') {
    const messageId = event.messageId
    const existingIndex = prev.items.findIndex((item) => item.type === 'message' && item.id === messageId)
    if (existingIndex >= 0) {
      const item = prev.items[existingIndex] as ChatMessageItem
      return {
        ...prev,
        items: replaceAt(prev.items, existingIndex, {
          ...item,
          content: item.content + event.text,
          status: 'streaming',
          startedAt: item.startedAt ?? requestStartedAt,
        }),
      }
    }

    const pendingIndex = prev.items.findIndex(
      (item) =>
        item.type === 'message' &&
        item.id === context.assistantMessageId &&
        item.role === 'assistant',
    )
    if (pendingIndex >= 0) {
      const item = prev.items[pendingIndex] as ChatMessageItem
      return {
        ...prev,
        items: replaceAt(prev.items, pendingIndex, {
          ...item,
          id: messageId,
          content: item.content + event.text,
          status: 'streaming',
          startedAt: item.startedAt ?? requestStartedAt,
        }),
      }
    }

    if (!event.text) return prev
    const message: ChatMessageItem = {
      type: 'message',
      id: messageId,
      role: 'assistant',
      content: event.text,
      status: 'streaming',
      createdAt: requestStartedAt,
      startedAt: requestStartedAt,
    }
    return { ...prev, items: [...prev.items, message] }
  }

  if (event.type === 'thinking_start') {
    const index = prev.items.findIndex(
      (item) => item.type === 'thinking' && item.thinkingId === event.thinkingId,
    )
    if (index >= 0) {
      const item = prev.items[index] as ChatThinkingItem
      return {
        ...prev,
        items: replaceAt(prev.items, index, {
          ...item,
          requestId: item.requestId ?? event.requestId,
          status: 'running',
        }),
      }
    }
    const row: ChatThinkingItem = {
      type: 'thinking',
      id: event.thinkingId,
      requestId: event.requestId,
      thinkingId: event.thinkingId,
      title: event.title,
      content: '',
      status: 'running',
    }
    return { ...prev, items: [...prev.items, row] }
  }

  if (event.type === 'thinking_delta') {
    const index = prev.items.findIndex(
      (item) => item.type === 'thinking' && item.thinkingId === event.thinkingId,
    )
    if (index >= 0) {
      const item = prev.items[index] as ChatThinkingItem
      return {
        ...prev,
        items: replaceAt(prev.items, index, {
          ...item,
          requestId: item.requestId ?? event.requestId,
          content: item.content + event.text,
          status: 'running',
        }),
      }
    }
    const row: ChatThinkingItem = {
      type: 'thinking',
      id: event.thinkingId,
      requestId: event.requestId,
      thinkingId: event.thinkingId,
      title: 'Think',
      content: event.text,
      status: 'running',
    }
    return { ...prev, items: [...prev.items, row] }
  }

  if (event.type === 'thinking_done') {
    const index = prev.items.findIndex(
      (item) => item.type === 'thinking' && item.thinkingId === event.thinkingId,
    )
    if (index < 0) return prev
    const item = prev.items[index] as ChatThinkingItem
    return {
      ...prev,
      items: replaceAt(prev.items, index, {
        ...item,
        requestId: item.requestId ?? event.requestId,
        status: 'done',
      }),
    }
  }

  if (event.type === 'tool_start') {
    const index = prev.items.findIndex(
      (item) => item.type === 'tool' && item.toolUseId === event.toolUseId,
    )
    if (index >= 0) {
      const item = prev.items[index] as ChatToolItem
      return {
        ...prev,
        items: replaceAt(prev.items, index, {
          ...item,
          requestId: item.requestId ?? event.requestId,
          inputPreview: event.inputPreview || item.inputPreview,
          status: 'running',
        }),
      }
    }
    const row: ChatToolItem = {
      type: 'tool',
      id: `tool-${event.toolUseId}`,
      requestId: event.requestId,
      toolUseId: event.toolUseId,
      name: event.name,
      inputPreview: event.inputPreview,
      status: 'running',
    }
    return { ...prev, items: [...prev.items, row] }
  }

  if (event.type === 'tool_update') {
    const index = prev.items.findIndex(
      (item) => item.type === 'tool' && item.toolUseId === event.toolUseId,
    )
    if (index < 0) return prev
    const item = prev.items[index] as ChatToolItem
    return {
      ...prev,
      items: replaceAt(prev.items, index, {
        ...item,
        requestId: item.requestId ?? event.requestId,
        inputPreview: event.inputPreview ?? item.inputPreview,
        detail: event.detail ?? item.detail,
      }),
    }
  }

  if (event.type === 'tool_done') {
    const index = prev.items.findIndex(
      (item) => item.type === 'tool' && item.toolUseId === event.toolUseId,
    )
    if (index < 0) return prev
    const item = prev.items[index] as ChatToolItem
    return {
      ...prev,
      items: replaceAt(prev.items, index, {
        ...item,
        requestId: item.requestId ?? event.requestId,
        status: event.status,
        detail: event.detail ?? item.detail,
      }),
    }
  }

  if (event.type === 'task_create') return applyTaskCreateEvent(prev, event, now)
  if (event.type === 'task_update') return applyTaskUpdateEvent(prev, event, now)
  if (event.type === 'task_list') return applyTaskListEvent(prev, event, now)

  if (event.type === 'agent_activity') {
    const index = prev.items.findIndex(
      (item) => item.type === 'activity' && item.id === event.activityId,
    )
    if (index >= 0) {
      const item = prev.items[index] as ChatActivityItem
      return {
        ...prev,
        items: replaceAt(prev.items, index, {
          ...item,
          requestId: item.requestId ?? event.requestId,
          title: event.title,
          status: event.status,
          detail: event.detail,
          preview: event.preview,
        }),
      }
    }
    const row: ChatActivityItem = {
      type: 'activity',
      id: event.activityId,
      requestId: event.requestId,
      title: event.title,
      status: event.status,
      detail: event.detail,
      preview: event.preview,
    }
    return { ...prev, items: [...prev.items, row] }
  }

  if (event.type === 'file_diff') {
    const index = prev.items.findIndex(
      (item) => item.type === 'file_diff' && item.changeSetId === event.changeSetId,
    )
    if (index >= 0) {
      const item = prev.items[index] as ChatFileDiffItem
      return {
        ...prev,
        items: replaceAt(prev.items, index, {
          ...item,
          checkpointId: event.checkpointId ?? item.checkpointId,
          files: mergeDiffFiles(item.files, event.files),
          status: item.status === 'reverted' ? item.status : 'captured',
          detail: undefined,
        }),
      }
    }
    const row: ChatFileDiffItem = {
      type: 'file_diff',
      id: event.changeSetId,
      requestId: event.requestId,
      changeSetId: event.changeSetId,
      checkpointId: event.checkpointId,
      files: event.files,
      status: 'captured',
    }
    return { ...prev, items: [...prev.items, row] }
  }

  if (event.type === 'file_rewind_result') {
    const index = prev.items.findIndex(
      (item) =>
        item.type === 'file_diff' &&
        (!event.changeSetId || item.changeSetId === event.changeSetId),
    )
    if (index < 0) return prev
    const item = prev.items[index] as ChatFileDiffItem
    return {
      ...prev,
      items: replaceAt(prev.items, index, {
        ...item,
        status: event.status === 'reverted' ? 'reverted' : 'error',
        detail: event.detail ?? item.detail,
      }),
    }
  }

  if (event.type === 'result') {
    const items = completeAssistantMessage(
      prev.items,
      event.requestId,
      context.assistantMessageId,
      event.result,
      'done',
      requestStartedAt,
      now,
    )
    return { ...prev, sessionId: event.sessionId, items }
  }

  if (event.type === 'error') {
    const items = completeAssistantMessage(
      prev.items,
      event.requestId,
      context.assistantMessageId,
      event.message,
      'error',
      requestStartedAt,
      now,
    )
    const shouldClearSession =
      event.code === 'sdk_error' &&
      event.message.includes('No conversation found with session ID')
    return {
      ...prev,
      sessionId: shouldClearSession ? undefined : prev.sessionId,
      items,
    }
  }

  if (event.type === 'cancelled') {
    const items = completeAssistantMessage(
      prev.items,
      event.requestId,
      context.assistantMessageId,
      context.stoppedBody ?? '',
      'cancelled',
      requestStartedAt,
      now,
    )
    return { ...prev, items }
  }

  return prev
}

function completeAssistantMessage(
  items: TranscriptItem[],
  requestId: string,
  assistantMessageId: string | undefined,
  fallbackContent: string,
  status: ChatMessageItem['status'],
  requestStartedAt: number,
  completedAt: number,
): TranscriptItem[] {
  const expectedId = `assistant-${requestId}`
  let found = false
  const mapped = items.map((item): TranscriptItem => {
    if (item.type !== 'message' || item.role !== 'assistant') return item
    if (item.id !== expectedId && item.id !== assistantMessageId) return item
    found = true
    const content = !item.content.trim() ? fallbackContent : item.content
    const startedAt = item.startedAt ?? requestStartedAt
    return {
      ...item,
      content,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
    }
  })
  if (found || !fallbackContent.trim()) return mapped
  return [
    ...mapped,
    {
      type: 'message',
      id: expectedId,
      role: 'assistant',
      content: fallbackContent,
      status,
      createdAt: requestStartedAt,
      startedAt: requestStartedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - requestStartedAt),
    },
  ]
}

function applyTaskCreateEvent(
  prev: ChatState,
  event: Extract<ClaudeChatEvent, { type: 'task_create' }>,
  now: number,
): ChatState {
  const tasks = taskStateForRequest(prev, event.requestId, true, now)
  const taskId = event.taskId || `pending:${event.toolUseId}`
  const index = tasks.items.findIndex(
    (task) => task.id === taskId || task.toolUseId === event.toolUseId,
  )
  const current = index >= 0 ? tasks.items[index] : undefined
  const nextTask: ChatTaskItem = {
    id: taskId,
    toolUseId: event.toolUseId,
    subject: event.subject || current?.subject || taskId,
    description: event.description ?? current?.description,
    activeForm: event.activeForm ?? current?.activeForm,
    status: current?.status ?? 'pending',
    owner: current?.owner,
    blocks: current?.blocks,
    blockedBy: current?.blockedBy,
    metadata: event.metadata ?? current?.metadata,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    order: current?.order ?? tasks.items.length,
  }
  const items = index >= 0 ? replaceAt(tasks.items, index, nextTask) : [...tasks.items, nextTask]
  return { ...prev, tasks: { ...tasks, updatedAt: now, items: sortTasks(items) } }
}

function applyTaskUpdateEvent(
  prev: ChatState,
  event: Extract<ClaudeChatEvent, { type: 'task_update' }>,
  now: number,
): ChatState {
  const tasks = taskStateForRequest(prev, event.requestId, false, now)
  const index = tasks.items.findIndex((task) => task.id === event.taskId)
  const current = index >= 0 ? tasks.items[index] : undefined
  const nextTask: ChatTaskItem = {
    id: event.taskId,
    toolUseId: current?.toolUseId ?? event.toolUseId,
    subject: event.subject ?? current?.subject ?? event.taskId,
    description: event.description ?? current?.description,
    activeForm: event.activeForm ?? current?.activeForm,
    status: event.status ?? current?.status ?? 'pending',
    owner: event.owner ?? current?.owner,
    blocks: mergeStringLists(current?.blocks, event.blocks),
    blockedBy: mergeStringLists(current?.blockedBy, event.blockedBy),
    metadata: event.metadata ?? current?.metadata,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    order: current?.order ?? tasks.items.length,
  }
  const items = index >= 0 ? replaceAt(tasks.items, index, nextTask) : [...tasks.items, nextTask]
  return { ...prev, tasks: { ...tasks, updatedAt: now, items: sortTasks(items) } }
}

function applyTaskListEvent(
  prev: ChatState,
  event: Extract<ClaudeChatEvent, { type: 'task_list' }>,
  now: number,
): ChatState {
  const existing = prev.tasks?.requestId === event.requestId ? prev.tasks.items : []
  const existingById = new Map(existing.map((task) => [task.id, task]))
  const items = event.tasks.map((task, index): ChatTaskItem => {
    const current = existingById.get(task.taskId)
    return {
      id: task.taskId,
      toolUseId: current?.toolUseId,
      subject: task.subject,
      description: task.description ?? current?.description,
      activeForm: task.activeForm ?? current?.activeForm,
      status: task.status ?? current?.status ?? 'pending',
      owner: task.owner ?? current?.owner,
      blocks: task.blocks ?? current?.blocks,
      blockedBy: task.blockedBy ?? current?.blockedBy,
      metadata: task.metadata ?? current?.metadata,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      order: current?.order ?? index,
    }
  })
  return {
    ...prev,
    tasks: { requestId: event.requestId, updatedAt: now, items: sortTasks(items) },
  }
}

function taskStateForRequest(
  prev: ChatState,
  requestId: string,
  resetOnNewRequest: boolean,
  now: number,
): ChatTaskState {
  if (!prev.tasks) return { requestId, updatedAt: now, items: [] }
  if (
    resetOnNewRequest &&
    prev.tasks.requestId &&
    prev.tasks.requestId !== requestId
  ) {
    return { requestId, updatedAt: now, items: [] }
  }
  return { ...prev.tasks, requestId, items: [...prev.tasks.items] }
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  const next = [...items]
  next[index] = item
  return next
}

function mergeStringLists(
  current: string[] | undefined,
  incoming: string[] | undefined,
): string[] | undefined {
  if (!incoming || incoming.length === 0) return current
  return [...new Set([...(current ?? []), ...incoming])]
}

function sortTasks(items: ChatTaskItem[]): ChatTaskItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

function mergeDiffFiles(
  existing: ChatFileDiffItem['files'],
  incoming: ChatFileDiffItem['files'],
): ChatFileDiffItem['files'] {
  const next = [...existing]
  for (const file of incoming) {
    const index = next.findIndex((candidate) => candidate.path === file.path)
    if (index < 0) {
      next.push(file)
      continue
    }
    const previous = next[index]
    next[index] = {
      ...previous,
      status: previous.status === 'added' ? previous.status : file.status,
      additions: previous.additions + file.additions,
      deletions: previous.deletions + file.deletions,
      hunks: [...previous.hunks, ...file.hunks],
      truncated: previous.truncated || file.truncated || undefined,
    }
  }
  return next
}

function isPendingRequestId(requestId: string): boolean {
  return requestId.startsWith('pending-')
}
