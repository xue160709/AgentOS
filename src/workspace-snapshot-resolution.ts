/**
 * Workspace snapshot resolution owns freshness, completeness and revision rules.
 * It is shared by renderer localStorage and Electron disk adapters.
 */

import type { ChatWorkspaceState, TranscriptItem } from './components/types'

export const CHAT_WORKSPACE_SAVED_AT_FIELD = 'savedAt'
export const CHAT_WORKSPACE_REVISION_FIELD = 'workspaceRevision'

export type ChatWorkspaceSnapshot = {
  state: ChatWorkspaceState
  savedAt?: number
  revision?: number
  source?: string
}

export function resolveChatWorkspaceSnapshot(
  snapshots: Array<ChatWorkspaceSnapshot | null | undefined>,
): ChatWorkspaceSnapshot | null {
  let best: ChatWorkspaceSnapshot | null = null

  for (const snapshot of snapshots) {
    if (!snapshot) continue
    if (!best || compareChatWorkspaceSnapshots(snapshot, best) >= 0) {
      best = snapshot
    }
  }

  return best
}

export function compareChatWorkspaceSnapshots(
  left: ChatWorkspaceSnapshot,
  right: ChatWorkspaceSnapshot,
): number {
  const leftEmpty = isEmptyWorkspaceSnapshot(left.state)
  const rightEmpty = isEmptyWorkspaceSnapshot(right.state)

  if (leftEmpty !== rightEmpty) {
    const clock = compareSnapshotClock(left, right)
    if (clock !== 0 && hasPersistedFreshness(leftEmpty ? left : right)) return clock
    return leftEmpty ? -1 : 1
  }

  const clock = compareSnapshotClock(left, right)
  if (clock !== 0) return clock

  return chatWorkspaceSnapshotCompleteness(left.state) - chatWorkspaceSnapshotCompleteness(right.state)
}

export function chatWorkspaceSnapshotFreshness(snapshot: ChatWorkspaceSnapshot): number {
  return Math.max(snapshot.savedAt ?? 0, chatWorkspaceStateMaxUpdatedAt(snapshot.state))
}

export function readWorkspaceSavedAt(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  return toOptionalFiniteNumber(value[CHAT_WORKSPACE_SAVED_AT_FIELD])
}

export function readWorkspaceRevision(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  return toOptionalFiniteRevision(value[CHAT_WORKSPACE_REVISION_FIELD])
}

export function workspaceRevisionOf(state: ChatWorkspaceState): number {
  return toFiniteRevision(state.workspaceRevision)
}

export function workspaceSnapshotRevision(snapshot: ChatWorkspaceSnapshot): number | undefined {
  return snapshot.revision ?? readWorkspaceRevision(snapshot.state)
}

export function withWorkspaceRevision(state: ChatWorkspaceState, revision: number): ChatWorkspaceState {
  return {
    ...state,
    workspaceRevision: Math.max(0, Math.floor(revision)),
  }
}

export function withNextWorkspaceRevision(state: ChatWorkspaceState, floor = 0): ChatWorkspaceState {
  return withWorkspaceRevision(state, Math.max(workspaceRevisionOf(state), floor) + 1)
}

export function workspaceDurableFingerprint(state: ChatWorkspaceState): string {
  const { workspaceRevision: _workspaceRevision, ...withoutRevision } = state
  return JSON.stringify(withoutRevision)
}

function compareSnapshotClock(left: ChatWorkspaceSnapshot, right: ChatWorkspaceSnapshot): number {
  const leftRevision = workspaceSnapshotRevision(left)
  const rightRevision = workspaceSnapshotRevision(right)
  if (
    leftRevision !== undefined &&
    rightRevision !== undefined &&
    leftRevision !== rightRevision
  ) {
    return leftRevision - rightRevision
  }

  return chatWorkspaceSnapshotFreshness(left) - chatWorkspaceSnapshotFreshness(right)
}

function hasPersistedFreshness(snapshot: ChatWorkspaceSnapshot): boolean {
  return workspaceSnapshotRevision(snapshot) !== undefined || snapshot.savedAt !== undefined
}

function chatWorkspaceStateMaxUpdatedAt(state: ChatWorkspaceState): number {
  let max = 0
  for (const project of state.projects) {
    max = Math.max(max, project.createdAt, project.updatedAt, project.pinnedAt ?? 0)
  }
  for (const thread of state.threads) {
    max = Math.max(max, thread.createdAt, thread.updatedAt, thread.pinnedAt ?? 0, thread.archivedAt ?? 0)
    for (const item of thread.chatState.items) {
      max = Math.max(max, transcriptItemTimestamp(item))
    }
    max = Math.max(max, thread.chatState.tasks?.updatedAt ?? 0)
  }
  return max
}

function transcriptItemTimestamp(item: TranscriptItem): number {
  if (item.type === 'message') {
    return Math.max(item.createdAt ?? 0, item.startedAt ?? 0, item.completedAt ?? 0)
  }
  if (item.type === 'context_compaction') {
    return Math.max(item.createdAt ?? 0, item.updatedAt ?? 0)
  }
  return 0
}

function chatWorkspaceSnapshotCompleteness(state: ChatWorkspaceState): number {
  const transcriptItems = state.threads.reduce((sum, thread) => sum + thread.chatState.items.length, 0)
  return state.projects.length * 10_000 + state.threads.length * 100 + transcriptItems
}

function isEmptyWorkspaceSnapshot(state: ChatWorkspaceState): boolean {
  return state.projects.length === 0 && state.threads.length === 0
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toOptionalFiniteRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function toFiniteRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
