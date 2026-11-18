/**
 * 渲染进程的线程对话内容外部 store。
 *
 * 每条流式 delta 只写入这里并唤醒订阅了该 threadId 的组件；AppShell 的 React state
 * 只保留工作区元数据（见 `WorkspaceMetadataState`），因此侧栏与输入框在一次回答期间
 * 不再重渲染。磁盘格式不变：落盘前由 `hydrateWorkspaceChatStates()` 组装回
 * `ChatWorkspaceState`。
 */

import { useCallback, useDebugValue, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ChatState, ChatWorkspaceState, ThreadMetadata, WorkspaceMetadataState, WorkspaceThread } from '../types'

/** 未知线程的稳定空值：必须是单例，`useSyncExternalStore` 依赖 getSnapshot 的引用稳定。 */
export const EMPTY_CHAT_STATE: ChatState = Object.freeze({ model: 'Claude Agent', items: Object.freeze([]) as unknown as ChatState['items'] })

export type ThreadChatStateUpdate = ChatState | ((previous: ChatState) => ChatState)

export type ThreadChatStateEntry = { threadId: string; chatState: ChatState }

export class ThreadChatStateStore {
  private readonly states = new Map<string, ChatState>()
  /** threadId → 归属作用域（project id 或 runtime scope id），用于整批替换时回收。 */
  private readonly scopes = new Map<string, string>()
  private readonly threadListeners = new Map<string, Set<() => void>>()
  private readonly listeners = new Set<() => void>()

  /** 已知的对话内容；未知线程返回 undefined。 */
  peek(threadId: string): ChatState | undefined {
    return this.states.get(threadId)
  }

  /** 渲染读取口：未知线程返回稳定空值，绝不返回新对象。 */
  read(threadId: string | undefined): ChatState {
    if (!threadId) return EMPTY_CHAT_STATE
    return this.states.get(threadId) ?? EMPTY_CHAT_STATE
  }

  has(threadId: string): boolean {
    return this.states.has(threadId)
  }

  subscribeThread(threadId: string | undefined, listener: () => void): () => void {
    if (!threadId) return () => {}
    let bucket = this.threadListeners.get(threadId)
    if (!bucket) {
      bucket = new Set()
      this.threadListeners.set(threadId, bucket)
    }
    bucket.add(listener)
    return () => {
      const current = this.threadListeners.get(threadId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.threadListeners.delete(threadId)
    }
  }

  /** 任意线程变化都会触发；legacy 落盘路径用它驱动 staging。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(threadId: string, update: ThreadChatStateUpdate, scopeId?: string): void {
    const previous = this.states.get(threadId) ?? EMPTY_CHAT_STATE
    const next = typeof update === 'function' ? update(previous) : update
    if (scopeId) this.scopes.set(threadId, scopeId)
    if (next === previous) return
    this.states.set(threadId, next)
    this.notify([threadId])
  }

  remove(threadId: string): void {
    if (!this.states.delete(threadId)) {
      this.scopes.delete(threadId)
      return
    }
    this.scopes.delete(threadId)
    this.notify([threadId])
  }

  /**
   * 用一个作用域（项目 / runtime scope）的完整线程列表整批替换。
   * 未出现在 entries 里的旧线程会被回收，避免归档线程无限堆积。
   */
  replaceScope(scopeId: string, entries: readonly ThreadChatStateEntry[]): void {
    const changed: string[] = []
    const incoming = new Set<string>()
    for (const entry of entries) {
      incoming.add(entry.threadId)
      this.scopes.set(entry.threadId, scopeId)
      const previous = this.states.get(entry.threadId)
      if (previous === entry.chatState) continue
      this.states.set(entry.threadId, entry.chatState)
      changed.push(entry.threadId)
    }
    for (const [threadId, owner] of this.scopes) {
      if (owner !== scopeId || incoming.has(threadId)) continue
      this.scopes.delete(threadId)
      if (this.states.delete(threadId)) changed.push(threadId)
    }
    this.notify(changed)
  }

  /** 整体重置（工作区载入 / 清空）。 */
  reset(entries: readonly ThreadChatStateEntry[]): void {
    const changed = new Set<string>(this.states.keys())
    this.states.clear()
    this.scopes.clear()
    for (const entry of entries) {
      this.states.set(entry.threadId, entry.chatState)
      changed.add(entry.threadId)
    }
    this.notify([...changed])
  }

  private notify(changed: readonly string[]): void {
    if (changed.length === 0) return
    for (const threadId of changed) {
      const bucket = this.threadListeners.get(threadId)
      if (!bucket) continue
      for (const listener of [...bucket]) listener()
    }
    for (const listener of [...this.listeners]) listener()
  }
}

/** 每个渲染进程窗口一份；主窗口与聊天子窗口各自独立。 */
export const threadChatStore = new ThreadChatStateStore()

/**
 * 把一份完整工作区拆成「元数据 + store」。主进程权威快照、磁盘载入结果都要经过它，
 * 之后 AppShell 状态里就不存在任何对话内容。
 */
export function adoptWorkspaceChatStates(
  state: ChatWorkspaceState,
  store: ThreadChatStateStore = threadChatStore,
): WorkspaceMetadataState {
  store.reset(state.threads.map((thread) => ({ threadId: thread.id, chatState: thread.chatState })))
  return { ...state, threads: state.threads.map(toThreadMetadata) }
}

/** 落盘方向：把 store 里的对话内容装回线程，得到可持久化的 `ChatWorkspaceState`。 */
export function hydrateWorkspaceChatStates(
  state: WorkspaceMetadataState,
  store: ThreadChatStateStore = threadChatStore,
): ChatWorkspaceState {
  return {
    ...state,
    threads: state.threads.map((thread) => ({ ...thread, chatState: store.read(thread.id) })),
  }
}

export function toThreadMetadata(thread: ThreadMetadata | WorkspaceThread): ThreadMetadata {
  const { chatState: _chatState, ...metadata } = thread as WorkspaceThread
  return metadata
}

// --- React 绑定 / React bindings ---

/** 订阅单条线程的完整对话内容；只有该线程变化时才唤醒。 */
export function useThreadChatState(
  threadId: string | undefined,
  store: ThreadChatStateStore = threadChatStore,
): ChatState {
  const subscribe = useCallback((listener: () => void) => store.subscribeThread(threadId, listener), [store, threadId])
  const getSnapshot = useCallback(() => store.read(threadId), [store, threadId])
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useDebugValue(threadId)
  return value
}

/**
 * 订阅线程对话内容的派生片段。选择器结果相等时不触发渲染，
 * 这是「流式期间 Composer 不重渲染」的关键：`hasMessages` / `sessionId` 这类值在一次回答里不变。
 */
export function useThreadChatSelector<T>(
  threadId: string | undefined,
  selector: (chatState: ChatState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  store: ThreadChatStateStore = threadChatStore,
): T {
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const isEqualRef = useRef(isEqual)
  isEqualRef.current = isEqual
  const cacheRef = useRef<{ source: ChatState; value: T } | null>(null)

  const subscribe = useCallback((listener: () => void) => store.subscribeThread(threadId, listener), [store, threadId])
  const getSnapshot = useCallback(() => {
    const source = store.read(threadId)
    const cache = cacheRef.current
    if (cache && cache.source === source) return cache.value
    const next = selectorRef.current(source)
    if (cache && isEqualRef.current(cache.value, next)) {
      cacheRef.current = { source, value: cache.value }
      return cache.value
    }
    cacheRef.current = { source, value: next }
    return next
  }, [store, threadId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 聊天子窗口用：把本地持有的线程列表投影进 store，
 * 这样 `ChatPage` 在任何宿主下都只从一个地方读取对话内容。
 */
export function usePublishedThreadChatStates(
  scopeId: string,
  threads: readonly WorkspaceThread[],
  store: ThreadChatStateStore = threadChatStore,
): void {
  useLayoutEffect(() => {
    store.replaceScope(scopeId, threads.map((thread) => ({ threadId: thread.id, chatState: thread.chatState })))
  }, [scopeId, store, threads])
}
