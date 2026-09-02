/**
 * Renderer-side submitter for Main-owned workspace commands (`FIX-WS-01`).
 *
 * The renderer owns no durable workspace state here: it sends an intent, and
 * adopts the readback-verified snapshot Main returns.  Selection (`active*`)
 * stays renderer-owned, so an adopted snapshot never moves the user's current
 * project/thread unless the command itself was about that.
 */

import type { ChatWorkspaceState, ProjectHomeViewMode, WorkspaceMetadataState } from './types'
import type { WorkspaceCommand, WorkspaceCommandResult } from '../workspace-commands'

export const WORKSPACE_PREFERENCES_DEBOUNCE_MS = 300

export type WorkspacePreferencesPatch = {
  sidebarCollapsed?: boolean
  collapsedProjectIds?: string[]
  projectHomeViewModes?: Record<string, ProjectHomeViewMode>
}

export type WorkspaceCommandClientOptions = {
  invoke: (command: WorkspaceCommand, expectedRevision?: number) => Promise<WorkspaceCommandResult>
  /** Authoritative fresh read used once when a command hits `workspace-conflict`. */
  refresh?: () => Promise<ChatWorkspaceState | null>
  /** 只用于取 `workspaceRevision`；壳层持有的是元数据投影。 */
  getWorkspace: () => WorkspaceMetadataState | null
  adopt: (workspace: ChatWorkspaceState, options: { preserveSelection: boolean }) => void
  onError: (message: string) => void
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancelScheduled?: (handle: unknown) => void
  debounceMs?: number
}

export type WorkspaceCommandOutcome =
  | { ok: true; workspace: ChatWorkspaceState; projectId?: string }
  | { ok: false; code: string; message: string }

/**
 * Adopt an authoritative snapshot while keeping renderer-owned selection.
 * `preserveSelection` is false only when the command intentionally moves it
 * (creating a project, or removing the project currently selected).
 */
export function adoptAuthoritativeWorkspace<S extends WorkspaceMetadataState>(
  current: WorkspaceMetadataState,
  next: S,
  options: { preserveSelection: boolean },
): S {
  if (!options.preserveSelection) return next
  // An empty thread/tab id is the project home: a deliberate renderer-owned
  // selection, not a missing one. Main is never told when the user leaves a
  // Workspace Tab, so treating empty as "no opinion" would let its stale
  // `activeWorkspaceTabId` pull the project home back into the workbench.
  const projectStillExists = next.projects.some((project) => project.id === current.activeProjectId)
  const threadStillExists = current.activeThreadId
    ? next.threads.some((thread) => thread.id === current.activeThreadId)
    : true
  const tabStillExists = current.activeWorkspaceTabId
    ? next.workspaceTabs.some((tab) => tab.id === current.activeWorkspaceTabId)
    : true
  const activeWorkspaceTabId = tabStillExists ? current.activeWorkspaceTabId : next.activeWorkspaceTabId
  return {
    ...next,
    activeProjectId: projectStillExists ? current.activeProjectId : next.activeProjectId,
    activeThreadId: threadStillExists ? current.activeThreadId : next.activeThreadId,
    activeWorkspaceTabId,
    activeLocalAppTabId: activeWorkspaceTabId,
  } as S
}

function mergePreferencePatch(
  base: WorkspacePreferencesPatch | null,
  patch: WorkspacePreferencesPatch,
): WorkspacePreferencesPatch {
  const next: WorkspacePreferencesPatch = { ...(base ?? {}) }
  if (patch.sidebarCollapsed !== undefined) next.sidebarCollapsed = patch.sidebarCollapsed
  if (patch.collapsedProjectIds !== undefined) next.collapsedProjectIds = [...patch.collapsedProjectIds]
  if (patch.projectHomeViewModes !== undefined) {
    next.projectHomeViewModes = { ...(next.projectHomeViewModes ?? {}), ...patch.projectHomeViewModes }
  }
  return next
}

export class WorkspaceCommandClient {
  private readonly options: WorkspaceCommandClientOptions
  private readonly schedule: (callback: () => void, delayMs: number) => unknown
  private readonly cancelScheduled: (handle: unknown) => void
  private readonly debounceMs: number
  private pendingPreferences: WorkspacePreferencesPatch | null = null
  private preferencesHandle: unknown
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: WorkspaceCommandClientOptions) {
    this.options = options
    this.schedule = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
    this.cancelScheduled = options.cancelScheduled ?? ((handle) => globalThis.clearTimeout(handle as never))
    this.debounceMs = options.debounceMs ?? WORKSPACE_PREFERENCES_DEBOUNCE_MS
  }

  /** Serialized so two quick clicks cannot race on the same stale revision. */
  submit(
    command: WorkspaceCommand,
    options: { preserveSelection?: boolean } = {},
  ): Promise<WorkspaceCommandOutcome> {
    const run = () => this.execute(command, options.preserveSelection !== false)
    const next = this.tail.then(run, run)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }

  /** Preferences are high-frequency UI toggles; merge them into one command. */
  queuePreferences(patch: WorkspacePreferencesPatch): void {
    this.pendingPreferences = mergePreferencePatch(this.pendingPreferences, patch)
    if (this.preferencesHandle !== undefined) this.cancelScheduled(this.preferencesHandle)
    this.preferencesHandle = this.schedule(() => {
      this.preferencesHandle = undefined
      void this.flushPreferences()
    }, this.debounceMs)
  }

  flushPreferences(): Promise<void> {
    if (this.preferencesHandle !== undefined) {
      this.cancelScheduled(this.preferencesHandle)
      this.preferencesHandle = undefined
    }
    const patch = this.pendingPreferences
    this.pendingPreferences = null
    if (!patch) return Promise.resolve()
    return this.submit({ type: 'preferences.set', ...patch }).then(() => undefined)
  }

  dispose(): void {
    if (this.preferencesHandle !== undefined) {
      this.cancelScheduled(this.preferencesHandle)
      this.preferencesHandle = undefined
    }
  }

  private async execute(command: WorkspaceCommand, preserveSelection: boolean): Promise<WorkspaceCommandOutcome> {
    const first = await this.invokeOnce(command)
    if (first.ok) {
      this.options.adopt(first.workspace, { preserveSelection })
      return { ok: true, workspace: first.workspace, projectId: first.projectId }
    }
    if (first.code !== 'workspace-conflict') {
      this.options.onError(first.message)
      return first
    }
    // Exactly one fresh-read retry. A second conflict is reported, never looped.
    const refreshed = await this.options.refresh?.().catch(() => null)
    if (refreshed) this.options.adopt(refreshed, { preserveSelection: true })
    const second = await this.invokeOnce(command)
    if (second.ok) {
      this.options.adopt(second.workspace, { preserveSelection })
      return { ok: true, workspace: second.workspace, projectId: second.projectId }
    }
    this.options.onError(second.message)
    return second
  }

  private async invokeOnce(command: WorkspaceCommand): Promise<WorkspaceCommandOutcome> {
    const workspace = this.options.getWorkspace()
    try {
      const result = await this.options.invoke(command, workspace?.workspaceRevision)
      if (result.ok) return { ok: true, workspace: result.workspace, projectId: result.projectId }
      return { ok: false, code: result.code, message: result.message }
    } catch (error) {
      return {
        ok: false,
        code: 'workspace-save-failed',
        message: error instanceof Error && error.message ? error.message : 'workspace-command-failed',
      }
    }
  }
}
