/**
 * Renderer-side submitter for Main-owned thread intents (`FIX-CHAT-01`).
 *
 * The main-window sidebar used to archive/pin through the renderer
 * `WorkspaceSession`.  With Project Chat enabled that write never reaches Main
 * and is rolled back by the next broker snapshot, so both actions now go
 * through the broker and the renderer waits for the broadcast.
 */

import type { ProjectChatAPI, ProjectChatSnapshot } from '../project-chat-contract'

/**
 * Project Chat availability. `probing` means the seam exists but has not
 * answered yet — it must never fall back to the legacy durable writer.
 */
export type ProjectChatReadiness = 'probing' | 'enabled' | 'legacy'

const TERMINAL_RUN_PHASES = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * Busy is a snapshot fact, not a thread purpose. Normal, `task-run` and
 * `skill-run` threads are treated identically.
 */
export function isProjectThreadBusy(snapshot: ProjectChatSnapshot | undefined, threadId: string): boolean {
  if (!snapshot) return false
  if (snapshot.runs.some((run) => run.threadId === threadId && !TERMINAL_RUN_PHASES.has(run.phase))) return true
  return snapshot.pendingPrompts.some((prompt) => prompt.threadId === threadId)
}

export type ProjectChatThreadIntentOptions = {
  api: () => ProjectChatAPI | undefined
  getSnapshot: (projectId: string) => ProjectChatSnapshot | undefined
  refreshSnapshot: (projectId: string) => Promise<ProjectChatSnapshot | null>
  onError: (message: string) => void
  onBusy: (threadId: string) => void
}

export class ProjectChatThreadIntentClient {
  private readonly options: ProjectChatThreadIntentOptions
  private readonly pending = new Set<string>()

  constructor(options: ProjectChatThreadIntentOptions) {
    this.options = options
  }

  isPending(threadId: string): boolean {
    return this.pending.has(threadId)
  }

  archive(projectId: string, threadId: string): Promise<boolean> {
    return this.run(`archive:${threadId}`, threadId, async (snapshot) => {
      const api = this.options.api()
      if (!api) return { ok: false, error: { code: 'internal-error', message: 'Project Chat 不可用' } }
      return api.archiveThread({ projectId, threadId, routeGeneration: snapshot.routeGeneration })
    }, projectId, { blockWhenBusy: true })
  }

  setPinned(projectId: string, threadId: string, pinned: boolean): Promise<boolean> {
    return this.run(`pin:${threadId}`, threadId, async (snapshot) => {
      const api = this.options.api()
      if (!api) return { ok: false, error: { code: 'internal-error', message: 'Project Chat 不可用' } }
      return api.setThreadPinned({ projectId, threadId, pinned, routeGeneration: snapshot.routeGeneration })
    }, projectId, { blockWhenBusy: false })
  }

  private async run(
    fenceKey: string,
    threadId: string,
    submit: (snapshot: ProjectChatSnapshot) => Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>,
    projectId: string,
    options: { blockWhenBusy: boolean },
  ): Promise<boolean> {
    // One in-flight intent per thread and action: the context menu, the trash
    // button and the pin button must not stack on the same stale generation.
    if (this.pending.has(fenceKey)) return false
    this.pending.add(fenceKey)
    try {
      // The target project's own generation — never the active project's.
      let snapshot = this.options.getSnapshot(projectId) ?? (await this.options.refreshSnapshot(projectId).catch(() => null)) ?? undefined
      if (!snapshot) {
        this.options.onError('无法获取该项目的会话状态，请重试')
        return false
      }
      if (options.blockWhenBusy && isProjectThreadBusy(snapshot, threadId)) {
        this.options.onBusy(threadId)
        return false
      }
      let result = await submit(snapshot)
      if (!result.ok && result.error.code === 'stale-revision') {
        // Exactly one fresh-read retry; a second failure is reported.
        const refreshed = await this.options.refreshSnapshot(projectId).catch(() => null)
        if (!refreshed) {
          this.options.onError(result.error.message)
          return false
        }
        snapshot = refreshed
        if (options.blockWhenBusy && isProjectThreadBusy(snapshot, threadId)) {
          this.options.onBusy(threadId)
          return false
        }
        result = await submit(snapshot)
      }
      if (!result.ok) {
        this.options.onError(result.error.message)
        return false
      }
      return true
    } finally {
      this.pending.delete(fenceKey)
    }
  }
}
