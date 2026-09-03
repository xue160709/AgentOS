type Counts = Record<string, number>

declare global {
  interface Window {
    __perfCounts?: Counts
    __perfEnabled?: boolean
  }
}

export function bumpRenderCount(type: unknown): void {
  if (!window.__perfEnabled) return
  if (typeof type !== 'function') return
  const named = type as { displayName?: string; name?: string }
  const name = named.displayName || named.name
  if (!name) return
  const counts = (window.__perfCounts ??= {})
  counts[name] = (counts[name] ?? 0) + 1
}
