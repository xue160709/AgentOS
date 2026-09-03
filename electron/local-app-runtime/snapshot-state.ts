import type { LocalAppRuntimeSnapshot, LocalAppRuntimeStatus } from '../../src/components/types'

/**
 * Every state a Runtime snapshot can move to, named once.
 *
 * The supervisor used to spread a fresh snapshot object at each of ~26 call
 * sites, so the rules that hold a snapshot together — `status` and
 * `buildStatus` always agreeing, a stopped Runtime dropping its readyUrl,
 * previewUrl and port, a new attempt clearing the previous errorCode — were
 * remembered separately in a dozen methods. They live here instead: the
 * supervisor names a transition, this module decides what the snapshot looks
 * like afterwards.
 *
 * Every transition is a pure function of the previous snapshot plus the
 * transition's own facts, so the whole state machine is assertable without a
 * process, a directory or a clock.
 */
export class RuntimeSnapshotTransitions {
  constructor(private readonly now: () => number) {}

  created(
    localAppId: string,
    generation: number,
    status: LocalAppRuntimeStatus,
    mode?: LocalAppRuntimeSnapshot['mode'],
  ): LocalAppRuntimeSnapshot {
    return {
      runtimeDefinitionId: localAppId,
      localAppId,
      runtimeId: `runtime-${localAppId}-${generation}-${this.now().toString(36)}`,
      generation,
      status,
      restartAttempt: 0,
      updatedAt: this.now(),
      logs: [],
      ...(mode ? { mode } : {}),
    }
  }

  /** A static Runtime before its directory has been read. */
  staticInspecting(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, mode: 'static', buildStatus: 'build_required', phase: 'inspect' }
  }

  /** No last-good artifact yet; the surface offers an explicit build. */
  buildRequired(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, status: 'build_required', mode: 'static', buildStatus: 'build_required', updatedAt: this.now() }
  }

  building(snapshot: LocalAppRuntimeSnapshot, build: { buildId: string; operationId: string }): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'building',
      mode: 'static',
      buildStatus: 'building',
      buildId: build.buildId,
      operationId: build.operationId,
      phase: 'build',
      errorCode: undefined,
      detail: undefined,
      updatedAt: this.now(),
    }
  }

  /** The build operation is over; its identity must not linger on the snapshot. */
  buildIdentityCleared(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, buildId: undefined, operationId: undefined }
  }

  staticReady(
    snapshot: LocalAppRuntimeSnapshot,
    artifact: { artifactId: string; lastBuildAt: number; previewUrl: string; logs?: string[] },
  ): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'ready',
      mode: 'static',
      buildStatus: 'ready',
      artifactId: artifact.artifactId,
      lastBuildAt: artifact.lastBuildAt,
      previewUrl: artifact.previewUrl,
      stale: false,
      errorCode: undefined,
      detail: undefined,
      phase: 'readiness',
      updatedAt: this.now(),
      ...(artifact.logs ? { logs: artifact.logs } : {}),
    }
  }

  /** The last-good artifact still opens, but its source has moved on. */
  staleArtifact(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, status: 'stale', buildStatus: 'stale', stale: true, updatedAt: this.now() }
  }

  buildFailed(
    snapshot: LocalAppRuntimeSnapshot,
    failure: { errorCode: string; detail: string; logs?: string[] },
  ): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'build_failed',
      buildStatus: 'build_failed',
      errorCode: failure.errorCode,
      detail: failure.detail,
      updatedAt: this.now(),
      ...(failure.logs ? { logs: failure.logs } : {}),
    }
  }

  /**
   * A cancelled build never downgrades what the user can already open: the
   * pre-build snapshot decides whether this returns to ready, stale, or
   * build_required.
   */
  restoredAfterCancel(
    snapshot: LocalAppRuntimeSnapshot,
    previous: LocalAppRuntimeSnapshot,
    logs: string[],
  ): LocalAppRuntimeSnapshot {
    const hasLastGood = Boolean(previous.artifactId && previous.previewUrl)
    const restoreStale = previous.status === 'stale' && previous.buildStatus === 'stale'
    const restoreStatus = restoreStale ? 'stale' : hasLastGood ? 'ready' : 'build_required'
    return {
      ...snapshot,
      status: restoreStatus,
      mode: previous.mode ?? 'static',
      buildStatus: restoreStatus,
      stale: restoreStale ? previous.stale : hasLastGood ? false : undefined,
      artifactId: previous.artifactId,
      previewUrl: previous.previewUrl,
      readyUrl: previous.readyUrl,
      lastBuildAt: previous.lastBuildAt,
      phase: previous.phase,
      errorCode: 'build-cancelled',
      detail: '静态构建已取消',
      updatedAt: this.now(),
      logs,
    }
  }

  preparing(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, status: 'preparing', phase: 'prepare', updatedAt: this.now() }
  }

  starting(snapshot: LocalAppRuntimeSnapshot, logs: string[]): LocalAppRuntimeSnapshot {
    return { ...snapshot, status: 'starting', phase: 'start', updatedAt: this.now(), logs }
  }

  /** A fresh port attempt starts from a clean error. */
  attempt(snapshot: LocalAppRuntimeSnapshot, port: number): LocalAppRuntimeSnapshot {
    return { ...snapshot, errorCode: undefined, detail: undefined, port, updatedAt: this.now() }
  }

  spawned(snapshot: LocalAppRuntimeSnapshot, port: number): LocalAppRuntimeSnapshot {
    return { ...snapshot, startedAt: this.now(), port, updatedAt: this.now() }
  }

  running(
    snapshot: LocalAppRuntimeSnapshot,
    served: { readyUrl: string; port: number; logs: string[] },
  ): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'running',
      phase: 'readiness',
      readyUrl: served.readyUrl,
      port: served.port,
      startedAt: snapshot.startedAt ?? this.now(),
      updatedAt: this.now(),
      logs: served.logs,
    }
  }

  /** A bounded crash retry reuses the generation and counts the attempt. */
  restarting(snapshot: LocalAppRuntimeSnapshot, restartAttempt: number): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'starting',
      phase: 'start',
      restartAttempt,
      errorCode: undefined,
      detail: undefined,
      updatedAt: this.now(),
    }
  }

  /** The dev server printed its own loopback URL; prefer it over the guess. */
  readyUrlObserved(snapshot: LocalAppRuntimeSnapshot, readyUrl: string): LocalAppRuntimeSnapshot {
    return { ...snapshot, readyUrl, updatedAt: this.now() }
  }

  processExited(snapshot: LocalAppRuntimeSnapshot, detail: string): LocalAppRuntimeSnapshot {
    return { ...snapshot, errorCode: 'process-exited', detail, updatedAt: this.now() }
  }

  /** An already recorded exit outranks a readiness timeout. */
  readinessTimedOut(snapshot: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    return { ...snapshot, errorCode: snapshot.errorCode ?? 'readiness_timeout', updatedAt: this.now() }
  }

  failed(
    snapshot: LocalAppRuntimeSnapshot,
    failure: { errorCode: string; detail: string; phase: LocalAppRuntimeSnapshot['phase']; logs: string[] },
  ): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: failure.errorCode === 'path-missing' ? 'path_missing' : 'failed',
      phase: failure.phase,
      errorCode: failure.errorCode,
      detail: failure.detail,
      updatedAt: this.now(),
      logs: failure.logs,
    }
  }

  /** Stopping drops everything that only makes sense while a process serves. */
  stopped(
    snapshot: LocalAppRuntimeSnapshot,
    stop: { reason: LocalAppRuntimeSnapshot['stopReason']; logs: string[] },
  ): LocalAppRuntimeSnapshot {
    return {
      ...snapshot,
      status: 'stopped',
      stopReason: stop.reason,
      updatedAt: this.now(),
      readyUrl: undefined,
      previewUrl: undefined,
      port: undefined,
      logs: stop.logs,
    }
  }
}
