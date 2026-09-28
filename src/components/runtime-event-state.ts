import type { RuntimeEvent, RuntimeSnapshot } from './types'
import type { ProjectChatRuntimeEditSnapshot } from '../project-chat-contract'
import type { RuntimeDevelopmentErrorCode, RuntimeDevelopmentSnapshot } from '../runtime-development-contract'

export const RUNTIME_EVENT_BATCH_WINDOW_MS = 75
export const MAX_RUNTIME_LOG_LINES = 160
export const MAX_QUEUED_RUNTIME_LOG_EVENTS = 160

export type RuntimeStateMap = Record<string, RuntimeSnapshot>

/**
 * Whether a Preview can be shown for this snapshot. Main may record the dev
 * server's own URL while the Runtime is still `starting`, so readiness must be
 * derived from status as well as the URL — the caller re-creates the Preview
 * when this flips, not when the URL changes.
 */
export function runtimePreviewReady(runtime?: RuntimeSnapshot | null): boolean {
  if (!runtime) return false
  if (runtime.mode === 'static') {
    return runtime.status !== 'stopped'
      && Boolean(runtime.previewUrl)
      && ['ready', 'stale', 'building', 'build_failed'].includes(runtime.buildStatus ?? runtime.status)
  }
  return runtime.status === 'running' && Boolean(runtime.readyUrl)
}

/**
 * Snapshots reach the renderer both as events and as IPC replies, so an older
 * snapshot of the same Runtime instance can arrive after a newer one. Reject
 * older generations, a different instance within the same generation, and
 * an earlier `updatedAt` of the same instance.
 */
export function isStaleRuntimeSnapshot(previous: RuntimeSnapshot | undefined, incoming: RuntimeSnapshot): boolean {
  if (!previous) return false
  if (incoming.generation < previous.generation) return true
  if (incoming.generation > previous.generation) return false
  if (incoming.runtimeId !== previous.runtimeId) return true
  return incoming.updatedAt < previous.updatedAt
}
export type RuntimeDevelopmentStateMap = Record<string, RuntimeDevelopmentSnapshot>

/**
 * One shared, user-facing projection of Main's edit-session snapshot.
 * Copy is localized by the caller: these strings reach both the workbench
 * toolbar and the project window, so they must not be hardcoded here.
 */
export function runtimeEditStatus(
  t: (path: string, params?: Record<string, string | number>) => string,
  edit?: ProjectChatRuntimeEditSnapshot,
): { message: string; alert?: true; busy?: true } | null {
  if (!edit) return null
  if (edit.failedOrCancelledAfterMutation) return { message: t('runtime.editFailed'), alert: true }
  if (edit.buildOperationId || edit.settleOperationId) return { message: t('runtime.editSaving'), busy: true }
  if (edit.activeAgentLeaseCount > 0) {
    return { message: t('runtime.editActive', { n: Math.max(1, edit.potentialRunCount) }), busy: true }
  }
  return null
}

export type RuntimeDevelopmentUiState = {
  message: string
  alert?: true
  busy?: true
  action: 'open' | 'end'
  actionLabel: string
  actionDisabled: boolean
}

export type RuntimeServeUiState = {
  message: string
  alert?: true
  busy?: true
  /** Primary Runtime-side action this state offers, if any. */
  action?: 'start' | 'update' | 'retry'
  actionLabel?: string
}

/**
 * The Runtime's own state, kept separate from the development session state
 * (`C-RSM-407`). A card shows both: "how this page is served right now" and
 * "what the AI session is doing". Neither may replace the other.
 */
export function runtimeServeStatus(
  t: (path: string, params?: Record<string, string | number>) => string,
  runtime?: RuntimeSnapshot | null,
): RuntimeServeUiState {
  const status = runtime?.status ?? 'stopped'
  if (!runtime || status === 'stopped') {
    return { message: t('runtime.serveStopped'), action: 'start', actionLabel: t('runtime.startRuntime') }
  }
  if (status === 'path_missing') return { message: t('runtime.runtimePathMissing'), alert: true }
  if (status === 'failed') {
    return { message: t('runtime.runtimeFailed'), alert: true, action: 'retry', actionLabel: t('runtime.startRuntime') }
  }
  if (runtime.mode === 'static') {
    const buildStatus = runtime.buildStatus ?? 'idle'
    if (buildStatus === 'building') return { message: t('runtime.serveBuilding'), busy: true }
    // `C-RSM-402` tier ③ reached through an explicit build: the page simply
    // cannot have a saved preview, so say that instead of calling it a failure.
    if (runtime.errorCode === 'build-produces-no-artifact') {
      return { message: t('runtime.serveDevelopment'), action: 'start', actionLabel: t('runtime.startRuntime') }
    }
    if (buildStatus === 'build_failed') {
      // With no last-good artifact there is no previous version to keep showing.
      return { message: t(runtime.artifactId ? 'runtime.serveBuildFailed' : 'runtime.serveBuildFailedFirst'), alert: true, action: 'retry', actionLabel: t('runtime.updatePreview') }
    }
    if (buildStatus === 'build_required') {
      return { message: t('runtime.serveNotGenerated'), action: 'update', actionLabel: t('runtime.updatePreview') }
    }
    return runtime.stale
      ? { message: t('runtime.serveArtifactStale'), action: 'update', actionLabel: t('runtime.updatePreview') }
      : { message: t('runtime.serveArtifact') }
  }
  if (status === 'degraded') return { message: t('runtime.runtimeDegraded'), alert: true }
  if (status === 'running') {
    // A borrowed Runtime is running, but not by this definition: say whose
    // instance it is instead of implying this view owns the process.
    return runtime.sharedRootRuntime
      ? { message: t('runtime.serveShared', { name: runtime.sharedRootRuntime.name }) }
      : { message: t('runtime.serveDevelopment') }
  }
  return { message: t('runtime.serveDevelopmentStarting'), busy: true }
}

/**
 * Main's RuntimeDevelopmentSnapshot is the sole phase authority. Components
 * may localize this projection but must not combine Runtime/Run state to guess
 * whether development is active, saving, stale, or waiting for attention.
 */
export function runtimeDevelopmentStatus(
  t: (path: string, params?: Record<string, string | number>) => string,
  snapshot?: RuntimeDevelopmentSnapshot,
): RuntimeDevelopmentUiState {
  if (!snapshot) {
    return { message: t('runtime.developmentIdle'), action: 'open', actionLabel: t('runtime.modifyWithAi'), actionDisabled: false }
  }
  const action = snapshot.canEnd ? 'end' : 'open'
  const actionLabel = t(action === 'end' ? 'runtime.endModification' : 'runtime.modifyWithAi')
  const actionDisabled = action === 'end' ? !snapshot.canEnd : snapshot.phase === 'saving' && !snapshot.canReopen
  if (snapshot.errorCode) {
    return { message: t(runtimeDevelopmentErrorMessageKey(snapshot.errorCode)), alert: true, action, actionLabel, actionDisabled }
  }
  if (snapshot.phase === 'opening') return { message: t('runtime.developmentOpening'), busy: true, action, actionLabel, actionDisabled }
  if (snapshot.phase === 'live') {
    return { message: snapshot.activeRunCount > 0 ? t('runtime.developmentEditing') : t('runtime.developmentLive'), busy: snapshot.activeRunCount > 0 ? true : undefined, action, actionLabel, actionDisabled }
  }
  if (snapshot.phase === 'exit_requested') return { message: snapshot.activeRunCount > 0 ? t('runtime.developmentFinishing') : t('runtime.developmentEnding'), busy: true, action, actionLabel, actionDisabled }
  if (snapshot.phase === 'saving') return { message: t('runtime.developmentSaving'), busy: true, action, actionLabel, actionDisabled }
  if (snapshot.phase === 'needs_attention') return { message: snapshot.waitingPromptCount > 0 ? t('runtime.developmentNeedsConfirmation') : t('runtime.developmentNeedsAttention'), alert: true, action, actionLabel, actionDisabled }
  if (snapshot.phase === 'preview_update_failed') return { message: t('runtime.developmentPreviewFailed'), alert: true, action, actionLabel, actionDisabled }
  return { message: t('runtime.developmentEnded'), action, actionLabel, actionDisabled }
}

function runtimeDevelopmentErrorMessageKey(code: RuntimeDevelopmentErrorCode): string {
  const keys: Record<RuntimeDevelopmentErrorCode, string> = {
    'runtime-development-conflict': 'runtime.developmentConflict',
    'runtime-development-busy': 'runtime.developmentBusy',
    'runtime-scope-stale': 'runtime.developmentStale',
    'runtime-root-missing': 'runtime.developmentRootMissing',
    'runtime-trust-required': 'runtime.developmentTrustRequired',
    'runtime-live-preview-unavailable': 'runtime.developmentLiveUnavailable',
    'runtime-save-unavailable': 'runtime.developmentSaveUnavailable',
    'runtime-save-timeout': 'runtime.developmentSaveTimeout',
    'runtime-build-failed': 'runtime.developmentPreviewFailed',
  }
  return keys[code]
}

/** Route + development generation fence for main-window late events. */
export function applyRuntimeDevelopmentSnapshot(
  current: RuntimeDevelopmentStateMap,
  incoming: RuntimeDevelopmentSnapshot,
): RuntimeDevelopmentStateMap {
  const previous = current[incoming.runtimeScopeId]
  if (previous && incoming.routeGeneration < previous.routeGeneration) return current
  if (previous && incoming.routeGeneration === previous.routeGeneration && incoming.developmentGeneration < previous.developmentGeneration) return current
  return { ...current, [incoming.runtimeScopeId]: incoming }
}

/**
 * Runtime log events are high-frequency and do not need to make the shell
 * render synchronously. All other events carry a state transition and must be
 * committed immediately by the batcher.
 */
export function isPureRuntimeLogEvent(event: RuntimeEvent): boolean {
  return event.type === 'log' && event.line !== undefined
}

/**
 * Apply one event while retaining the existing runtime identity/generation
 * guard and keeping preview health separate from the managed process state.
 */
export function applyRuntimeEvent(current: RuntimeStateMap, event: RuntimeEvent): RuntimeStateMap {
  const runtimeDefinitionId = event.runtimeDefinitionId
  if (!runtimeDefinitionId) return current

  const previous = current[runtimeDefinitionId]
  if (previous && event.generation < previous.generation) return current
  if (previous && event.runtimeId !== previous.runtimeId && event.generation === previous.generation) return current

  const next: RuntimeSnapshot = {
    runtimeDefinitionId,
    runtimeId: event.runtimeId,
    generation: event.generation,
    // Preview failures are view-level health and must not turn a live
    // managed process into a runtime failure.
    status: event.phase === 'preview' ? previous?.status ?? 'running' : event.status,
    mode: event.mode ?? previous?.mode,
    buildStatus: event.buildStatus ?? previous?.buildStatus,
    artifactId: event.artifactId ?? previous?.artifactId,
    buildId: event.buildId ?? previous?.buildId,
    operationId: event.operationId ?? previous?.operationId,
    stale: event.stale ?? previous?.stale,
    lastBuildAt: event.lastBuildAt ?? previous?.lastBuildAt,
    previewUrl: event.previewUrl ?? previous?.previewUrl,
    readyUrl: event.readyUrl ?? previous?.readyUrl,
    port: event.port ?? previous?.port,
    restartAttempt: previous?.restartAttempt ?? 0,
    startedAt: previous?.startedAt,
    updatedAt: event.timestamp,
    phase: event.phase ?? previous?.phase,
    errorCode: event.errorCode ?? previous?.errorCode,
    detail: event.detail ?? previous?.detail,
    previewStatus: event.phase === 'preview' ? event.previewStatus : previous?.previewStatus,
    // Sharing is a property of the event's own runtime identity: never
    // inherited, so leaving a shared root clears the label immediately.
    sharedRootRuntime: event.sharedRootRuntime,
    logs: event.line !== undefined
      ? [...(previous?.logs ?? []).slice(-(MAX_RUNTIME_LOG_LINES - 1)), `[${event.stream ?? 'runtime'}] ${event.line}`]
      : previous?.logs,
  }

  return { ...current, [runtimeDefinitionId]: next }
}

/** Apply a batch in arrival order so queued logs cannot overtake a status event. */
export function applyRuntimeEvents(current: RuntimeStateMap, events: readonly RuntimeEvent[]): RuntimeStateMap {
  let next = current
  for (const event of events) next = applyRuntimeEvent(next, event)
  return next
}

type RuntimeEventTimer = ReturnType<typeof setTimeout>

type RuntimeEventBatcherOptions = {
  commit: (events: RuntimeEvent[]) => void
  schedule?: (callback: () => void, delayMs: number) => RuntimeEventTimer
  cancel?: (timer: RuntimeEventTimer) => void
  windowMs?: number
}

/**
 * Small renderer-side queue for runtime events. Status transitions flush the
 * pending log queue synchronously in the same commit, preserving event order.
 */
export class RuntimeEventBatcher {
  private readonly commit: (events: RuntimeEvent[]) => void
  private readonly schedule: (callback: () => void, delayMs: number) => RuntimeEventTimer
  private readonly cancel: (timer: RuntimeEventTimer) => void
  private readonly windowMs: number
  private queuedLogs: RuntimeEvent[] = []
  private timer: RuntimeEventTimer | undefined
  private disposed = false

  constructor(options: RuntimeEventBatcherOptions) {
    this.commit = options.commit
    this.schedule = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
    this.cancel = options.cancel ?? ((timer) => globalThis.clearTimeout(timer))
    this.windowMs = options.windowMs ?? RUNTIME_EVENT_BATCH_WINDOW_MS
  }

  handle(event: RuntimeEvent): void {
    if (this.disposed) return

    if (isPureRuntimeLogEvent(event)) {
      this.queuedLogs.push(event)
      if (this.queuedLogs.length > MAX_QUEUED_RUNTIME_LOG_EVENTS) {
        this.queuedLogs.splice(0, this.queuedLogs.length - MAX_QUEUED_RUNTIME_LOG_EVENTS)
      }
      if (this.timer === undefined) {
        this.timer = this.schedule(() => this.flush(), this.windowMs)
      }
      return
    }

    // A state transition is latency-sensitive. Include queued logs in the
    // same ordered commit and cancel the delayed timer before committing.
    this.commitPending(event)
  }

  flush(): void {
    if (this.disposed) return
    this.commitPending()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) {
      this.cancel(this.timer)
      this.timer = undefined
    }
    this.queuedLogs = []
  }

  private commitPending(nextEvent?: RuntimeEvent): void {
    if (this.disposed) return
    if (this.timer !== undefined) {
      this.cancel(this.timer)
      this.timer = undefined
    }

    const events = this.queuedLogs
    this.queuedLogs = []
    if (nextEvent) events.push(nextEvent)
    if (events.length > 0) this.commit(events)
  }
}
