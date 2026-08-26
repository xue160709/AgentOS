import type { RuntimeEvent, RuntimeSnapshot } from './types'

export const RUNTIME_EVENT_BATCH_WINDOW_MS = 75
export const MAX_RUNTIME_LOG_LINES = 160
export const MAX_QUEUED_RUNTIME_LOG_EVENTS = 160

export type RuntimeStateMap = Record<string, RuntimeSnapshot>

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
