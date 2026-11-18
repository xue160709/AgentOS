import type { ClaudeChatEvent } from './claude-chat-types'
import type {
  ChatActivityItem, ChatContextCompactionItem, ChatFileDiffItem, ChatMessageItem, ChatState,
  ChatTaskItem, ChatTaskState, ChatThinkingItem, ChatToolItem, TranscriptItem,
} from './components/types'

export type ChatRunEventFoldContext = { now?: number; requestStartedAt?: number; assistantMessageId?: string; fallbackModel?: string; stoppedBody?: string }
export type ProjectChatFoldState = { chatState: ChatState; terminalRequestIds: readonly string[] }
const isTerminal = (event: ClaudeChatEvent): event is Extract<ClaudeChatEvent, { type: 'result' | 'error' | 'cancelled' }> => event.type === 'result' || event.type === 'error' || event.type === 'cancelled'

/** Folds an event only after its caller has resolved the target project/run/thread. */
export function reduceProjectChatEvent(state: ProjectChatFoldState, event: ClaudeChatEvent, context: ChatRunEventFoldContext = {}): ProjectChatFoldState {
  if (state.terminalRequestIds.includes(event.requestId)) return state
  const chatState = foldChatRunEvent(state.chatState, event, context)
  return isTerminal(event) ? { chatState, terminalRequestIds: [...state.terminalRequestIds, event.requestId] } : { ...state, chatState }
}

export function foldChatRunEvent(prev: ChatState, event: ClaudeChatEvent, context: ChatRunEventFoldContext = {}): ChatState {
  const now = context.now ?? Date.now(), started = context.requestStartedAt ?? now
  if (event.type === 'session_start') return { ...prev, sessionId: event.sessionId, model: event.model || context.fallbackModel || prev.model, cwd: event.cwd }
  if (event.type === 'assistant_delta') {
    const existing = prev.items.findIndex((item) => item.type === 'message' && item.id === event.messageId)
    if (existing >= 0) { const item = prev.items[existing] as ChatMessageItem; return { ...prev, items: replaceAt(prev.items, existing, { ...item, content: item.content + event.text, status: 'streaming', startedAt: item.startedAt ?? started }) } }
    const pending = prev.items.findIndex((item) => item.type === 'message' && item.id === context.assistantMessageId && item.role === 'assistant')
    if (pending >= 0) { const item = prev.items[pending] as ChatMessageItem; return { ...prev, items: replaceAt(prev.items, pending, { ...item, id: event.messageId, content: item.content + event.text, status: 'streaming', startedAt: item.startedAt ?? started }) } }
    if (!event.text) return prev
    return { ...prev, items: [...prev.items, { type: 'message', id: event.messageId, role: 'assistant', content: event.text, status: 'streaming', createdAt: started, startedAt: started }] }
  }
  if (event.type === 'thinking_start' || event.type === 'thinking_delta' || event.type === 'thinking_done') return foldThinking(prev, event)
  if (event.type === 'tool_start' || event.type === 'tool_update' || event.type === 'tool_done') return foldTool(prev, event)
  if (event.type === 'task_create') return applyTaskCreateEvent(prev, event, now)
  if (event.type === 'task_update') return applyTaskUpdateEvent(prev, event, now)
  if (event.type === 'task_list') return applyTaskListEvent(prev, event, now)
  if (event.type === 'agent_activity') return foldActivity(prev, event)
  if (event.type === 'context_compaction') return foldCompaction(prev, event, now)
  if (event.type === 'file_diff') return foldDiff(prev, event)
  if (event.type === 'file_rewind_result') return foldRewind(prev, event)
  if (event.type === 'result') return { ...prev, sessionId: event.sessionId, items: completeAssistantMessage(prev.items, event.requestId, context.assistantMessageId, event.result, 'done', started, now) }
  if (event.type === 'error') { const shouldClearSession = event.code === 'sdk_error' && event.message.includes('No conversation found with session ID'); return { ...prev, sessionId: shouldClearSession ? undefined : prev.sessionId, items: completeAssistantMessage(prev.items, event.requestId, context.assistantMessageId, event.message, 'error', started, now) } }
  if (event.type === 'cancelled') return { ...prev, items: completeAssistantMessage(prev.items, event.requestId, context.assistantMessageId, context.stoppedBody ?? '', 'cancelled', started, now) }
  return prev
}

function foldThinking(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'thinking_start' | 'thinking_delta' | 'thinking_done' }>): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'thinking' && item.thinkingId === event.thinkingId)
  if (event.type === 'thinking_done') { if (index < 0) return prev; const item = prev.items[index] as ChatThinkingItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, requestId: item.requestId ?? event.requestId, status: 'done' }) } }
  if (index >= 0) { const item = prev.items[index] as ChatThinkingItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, requestId: item.requestId ?? event.requestId, content: event.type === 'thinking_delta' ? item.content + event.text : item.content, status: 'running' }) } }
  return { ...prev, items: [...prev.items, { type: 'thinking', id: event.thinkingId, requestId: event.requestId, thinkingId: event.thinkingId, title: event.type === 'thinking_start' ? event.title : 'Think', content: event.type === 'thinking_delta' ? event.text : '', status: 'running' }] }
}

function foldTool(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'tool_start' | 'tool_update' | 'tool_done' }>): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'tool' && item.toolUseId === event.toolUseId)
  if (event.type === 'tool_start') {
    if (index >= 0) { const item = prev.items[index] as ChatToolItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, requestId: item.requestId ?? event.requestId, inputPreview: event.inputPreview || item.inputPreview, status: 'running' }) } }
    return { ...prev, items: [...prev.items, { type: 'tool', id: `tool-${event.toolUseId}`, requestId: event.requestId, toolUseId: event.toolUseId, name: event.name, inputPreview: event.inputPreview, status: 'running' }] }
  }
  if (index < 0) return prev
  const item = prev.items[index] as ChatToolItem
  return { ...prev, items: replaceAt(prev.items, index, event.type === 'tool_update' ? { ...item, requestId: item.requestId ?? event.requestId, inputPreview: event.inputPreview ?? item.inputPreview, detail: event.detail ?? item.detail } : { ...item, requestId: item.requestId ?? event.requestId, status: event.status, detail: event.detail ?? item.detail }) }
}

function foldActivity(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'agent_activity' }>): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'activity' && item.id === event.activityId)
  if (index >= 0) { const item = prev.items[index] as ChatActivityItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, requestId: item.requestId ?? event.requestId, title: event.title, status: event.status, detail: event.detail, preview: event.preview ?? item.preview }) } }
  return { ...prev, items: [...prev.items, { type: 'activity', id: event.activityId, requestId: event.requestId, title: event.title, status: event.status, detail: event.detail, preview: event.preview }] }
}

function foldCompaction(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'context_compaction' }>, now: number): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'context_compaction' && item.id === event.compactionId)
  if (index >= 0) { const item = prev.items[index] as ChatContextCompactionItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, requestId: item.requestId ?? event.requestId, status: event.status, trigger: event.trigger ?? item.trigger, preTokens: event.preTokens ?? item.preTokens, postTokens: event.postTokens ?? item.postTokens, durationMs: event.durationMs ?? item.durationMs, preservedMessageCount: event.preservedMessageCount ?? item.preservedMessageCount, summary: event.summary ?? item.summary, error: event.error ?? item.error, updatedAt: now }) } }
  return { ...prev, items: [...prev.items, { type: 'context_compaction', id: event.compactionId, requestId: event.requestId, status: event.status, trigger: event.trigger ?? 'unknown', preTokens: event.preTokens, postTokens: event.postTokens, durationMs: event.durationMs, preservedMessageCount: event.preservedMessageCount, summary: event.summary, error: event.error, createdAt: now, updatedAt: now }] }
}

function foldDiff(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'file_diff' }>): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'file_diff' && item.changeSetId === event.changeSetId)
  if (index >= 0) { const item = prev.items[index] as ChatFileDiffItem; return { ...prev, items: replaceAt(prev.items, index, { ...item, threadId: item.threadId ?? event.threadId, checkpointId: event.checkpointId ?? item.checkpointId, files: mergeDiffFiles(item.files, event.files), status: item.status === 'reverted' ? item.status : 'captured', detail: undefined }) } }
  return { ...prev, items: [...prev.items, { type: 'file_diff', id: event.changeSetId, requestId: event.requestId, threadId: event.threadId, changeSetId: event.changeSetId, checkpointId: event.checkpointId, files: event.files, status: 'captured' }] }
}

function foldRewind(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'file_rewind_result' }>): ChatState {
  const index = prev.items.findIndex((item) => item.type === 'file_diff' && (!event.changeSetId || item.changeSetId === event.changeSetId))
  if (index < 0) return prev
  const item = prev.items[index] as ChatFileDiffItem
  return { ...prev, items: replaceAt(prev.items, index, { ...item, status: event.status === 'reverted' ? 'reverted' : 'error', detail: event.detail ?? item.detail }) }
}

function completeAssistantMessage(items: TranscriptItem[], requestId: string, assistantMessageId: string | undefined, fallbackContent: string, status: ChatMessageItem['status'], startedAt: number, completedAt: number): TranscriptItem[] {
  const expectedId = `assistant-${requestId}`; let found = false
  const mapped = items.map((item): TranscriptItem => { if (item.type !== 'message' || item.role !== 'assistant' || (item.id !== expectedId && item.id !== assistantMessageId)) return item; found = true; const itemStartedAt = item.startedAt ?? startedAt; return { ...item, content: !item.content.trim() ? fallbackContent : item.content, status, startedAt: itemStartedAt, completedAt, durationMs: Math.max(0, completedAt - itemStartedAt) } })
  return found || !fallbackContent.trim() ? mapped : [...mapped, { type: 'message', id: expectedId, role: 'assistant', content: fallbackContent, status, createdAt: startedAt, startedAt, completedAt, durationMs: Math.max(0, completedAt - startedAt) }]
}

function applyTaskCreateEvent(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'task_create' }>, now: number): ChatState {
  const tasks = taskStateForRequest(prev, event.requestId, true, now), taskId = event.taskId || `pending:${event.toolUseId}`, index = tasks.items.findIndex((task) => task.id === taskId || task.toolUseId === event.toolUseId), current = index >= 0 ? tasks.items[index] : undefined
  const next: ChatTaskItem = { id: taskId, toolUseId: event.toolUseId, subject: event.subject || current?.subject || taskId, description: event.description ?? current?.description, activeForm: event.activeForm ?? current?.activeForm, status: current?.status ?? 'pending', owner: current?.owner, blocks: current?.blocks, blockedBy: current?.blockedBy, metadata: event.metadata ?? current?.metadata, createdAt: current?.createdAt ?? now, updatedAt: now, order: current?.order ?? tasks.items.length }
  const items = index >= 0 ? replaceAt(tasks.items, index, next) : [...tasks.items, next]; return { ...prev, tasks: { ...tasks, updatedAt: now, items: sortTasks(items) } }
}

function applyTaskUpdateEvent(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'task_update' }>, now: number): ChatState {
  const tasks = taskStateForRequest(prev, event.requestId, false, now), index = tasks.items.findIndex((task) => task.id === event.taskId), current = index >= 0 ? tasks.items[index] : undefined
  const next: ChatTaskItem = { id: event.taskId, toolUseId: current?.toolUseId ?? event.toolUseId, subject: event.subject ?? current?.subject ?? event.taskId, description: event.description ?? current?.description, activeForm: event.activeForm ?? current?.activeForm, status: event.status ?? current?.status ?? 'pending', owner: event.owner ?? current?.owner, blocks: mergeStringLists(current?.blocks, event.blocks), blockedBy: mergeStringLists(current?.blockedBy, event.blockedBy), metadata: event.metadata ?? current?.metadata, createdAt: current?.createdAt ?? now, updatedAt: now, order: current?.order ?? tasks.items.length }
  const items = index >= 0 ? replaceAt(tasks.items, index, next) : [...tasks.items, next]; return { ...prev, tasks: { ...tasks, updatedAt: now, items: sortTasks(items) } }
}

function applyTaskListEvent(prev: ChatState, event: Extract<ClaudeChatEvent, { type: 'task_list' }>, now: number): ChatState {
  const existing = prev.tasks?.requestId === event.requestId ? prev.tasks.items : [], byId = new Map(existing.map((task) => [task.id, task]))
  const items = event.tasks.map((task, index): ChatTaskItem => { const current = byId.get(task.taskId); return { id: task.taskId, toolUseId: current?.toolUseId, subject: task.subject, description: task.description ?? current?.description, activeForm: task.activeForm ?? current?.activeForm, status: task.status ?? current?.status ?? 'pending', owner: task.owner ?? current?.owner, blocks: task.blocks ?? current?.blocks, blockedBy: task.blockedBy ?? current?.blockedBy, metadata: task.metadata ?? current?.metadata, createdAt: current?.createdAt ?? now, updatedAt: now, order: current?.order ?? index } })
  return { ...prev, tasks: { requestId: event.requestId, updatedAt: now, items: sortTasks(items) } }
}

function taskStateForRequest(prev: ChatState, requestId: string, resetOnNewRequest: boolean, now: number): ChatTaskState { if (!prev.tasks || (resetOnNewRequest && prev.tasks.requestId && prev.tasks.requestId !== requestId)) return { requestId, updatedAt: now, items: [] }; return { ...prev.tasks, requestId, items: [...prev.tasks.items] } }
function replaceAt<T>(items: T[], index: number, item: T): T[] { const next = [...items]; next[index] = item; return next }
function mergeStringLists(current: string[] | undefined, incoming: string[] | undefined): string[] | undefined { return !incoming || incoming.length === 0 ? current : [...new Set([...(current ?? []), ...incoming])] }
function sortTasks(items: ChatTaskItem[]): ChatTaskItem[] { return [...items].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt) }
function mergeDiffFiles(existing: ChatFileDiffItem['files'], incoming: ChatFileDiffItem['files']): ChatFileDiffItem['files'] { const next = [...existing]; for (const file of incoming) { const index = next.findIndex((candidate) => candidate.path === file.path); if (index < 0) { next.push(file); continue }; const previous = next[index]; next[index] = { ...previous, status: previous.status === 'added' ? previous.status : file.status, additions: previous.additions + file.additions, deletions: previous.deletions + file.deletions, hunks: [...previous.hunks, ...file.hunks], truncated: previous.truncated || file.truncated || undefined } }; return next }
