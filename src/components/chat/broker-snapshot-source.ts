/**
 * Broker 快照的外部 store seam。
 *
 * Broker 每条 delta 都会重发整份快照（sequence 变了，`runs`/`pendingPrompts` 通常没变）。
 * 把快照放进外部 store 并让 `ChatPage` 只订阅它真正渲染的片段，一次回答期间
 * `ChatPage` 与其中的 `Composer` 就不会重渲染。
 */

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ChatBrokerPrompt, ChatBrokerSnapshot } from './chat-bridge'

/** ChatPage 消费的只读接口；主窗口与聊天子窗口各自提供实现。 */
export type ChatBrokerSnapshotSource = {
  get: (scopeId: string) => ChatBrokerSnapshot | undefined
  subscribe: (scopeId: string, listener: () => void) => () => void
}

export class BrokerSnapshotStore<T extends ChatBrokerSnapshot> implements ChatBrokerSnapshotSource {
  private readonly snapshots = new Map<string, T>()
  private readonly listeners = new Map<string, Set<() => void>>()

  get(scopeId: string): T | undefined {
    return this.snapshots.get(scopeId)
  }

  set(scopeId: string, snapshot: T): void {
    this.snapshots.set(scopeId, snapshot)
    this.notify(scopeId)
  }

  delete(scopeId: string): void {
    if (!this.snapshots.delete(scopeId)) return
    this.notify(scopeId)
  }

  clear(): void {
    const scopeIds = [...this.snapshots.keys()]
    this.snapshots.clear()
    for (const scopeId of scopeIds) this.notify(scopeId)
  }

  subscribe(scopeId: string, listener: () => void): () => void {
    let bucket = this.listeners.get(scopeId)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(scopeId, bucket)
    }
    bucket.add(listener)
    return () => {
      const current = this.listeners.get(scopeId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(scopeId)
    }
  }

  private notify(scopeId: string): void {
    const bucket = this.listeners.get(scopeId)
    if (!bucket) return
    for (const listener of [...bucket]) listener()
  }
}

/** 聊天子窗口用：把本地 state 里的快照包装成同一个 seam，避免 ChatPage 出现两条读取路径。 */
export function useBrokerSnapshotSource(scopeId: string, snapshot: ChatBrokerSnapshot | undefined): ChatBrokerSnapshotSource {
  const storeRef = useRef<BrokerSnapshotStore<ChatBrokerSnapshot> | null>(null)
  if (!storeRef.current) storeRef.current = new BrokerSnapshotStore()
  const store = storeRef.current
  useLayoutEffect(() => {
    if (snapshot) store.set(scopeId, snapshot)
    else store.delete(scopeId)
  }, [scopeId, snapshot, store])
  return store
}

/**
 * 订阅快照的派生片段。选择器结果相等时不触发渲染——这正是把「每 delta 一次渲染」
 * 压到 0 的地方，因为 `permissionMode`、待处理提示等在一次回答里不变。
 */
export function useBrokerSnapshotSelector<T>(
  source: ChatBrokerSnapshotSource | undefined,
  scopeId: string,
  selector: (snapshot: ChatBrokerSnapshot | undefined) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const isEqualRef = useRef(isEqual)
  isEqualRef.current = isEqual
  const cacheRef = useRef<{ source: ChatBrokerSnapshot | undefined; value: T } | null>(null)

  const subscribe = useCallback(
    (listener: () => void) => (source ? source.subscribe(scopeId, listener) : () => {}),
    [scopeId, source],
  )
  const getSnapshot = useCallback(() => {
    const current = source?.get(scopeId)
    const cache = cacheRef.current
    if (cache && cache.source === current) return cache.value
    const next = selectorRef.current(current)
    if (cache && isEqualRef.current(cache.value, next)) {
      cacheRef.current = { source: current, value: cache.value }
      return cache.value
    }
    cacheRef.current = { source: current, value: next }
    return next
  }, [scopeId, source])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 待处理提示按身份比较：数组每次重建，但内容通常没变。 */
export function samePrompt(a: ChatBrokerPrompt | undefined, b: ChatBrokerPrompt | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.promptId === b.promptId &&
    a.requestId === b.requestId &&
    a.threadId === b.threadId &&
    a.isOwnedByCaller === b.isOwnedByCaller &&
    a.payload === b.payload
  )
}
