import { RuntimeBuildCommitFenceRejectedError } from './static'

export type BuildStepOutcome<T> = { ok: true; value: T } | { ok: false }

export type BuildFailureKind = 'abandoned' | 'cancelled' | 'failed'

/**
 * One static build operation's ownership and cancellation fence.
 *
 * A build runs several awaited steps (npm, output detection, validation,
 * fingerprint, commit) and after every one of them two things can have
 * happened: a newer build took the Runtime over, or the user cancelled this
 * one. `runStaticBuild` used to restate that pair of checks — plus the
 * restore-and-emit that follows a cancellation — after every step. The
 * protocol lives here now, so a step only describes its own work and the
 * caller reads one outcome.
 *
 * Ownership always outranks cancellation: a build that no longer owns the
 * Runtime must not touch its snapshot at all, not even to report the cancel.
 */
export class StaticBuildFence {
  constructor(private readonly options: {
    signal: AbortSignal
    /** Still the Runtime's current build operation (buildId + operationId). */
    ownsOperation: () => boolean
    /** Restore the pre-build snapshot and publish it. */
    onCancelled: () => void
  }) {}

  get aborted(): boolean {
    return this.options.signal.aborted
  }

  /**
   * Run one cancellable step. `honorAbort: false` is for the steps whose own
   * result must be published even under a late abort (output detection runs
   * before anything is at stake; the commit is past the atomic rename).
   */
  async step<T>(run: () => Promise<T>, options: { honorAbort?: boolean } = {}): Promise<BuildStepOutcome<T>> {
    const value = await run()
    if (!this.options.ownsOperation()) return { ok: false }
    if (options.honorAbort !== false && this.options.signal.aborted) {
      this.options.onCancelled()
      return { ok: false }
    }
    return { ok: true, value }
  }

  /**
   * Classify a thrown step. A rejected commit fence and an abort both restore
   * last-good; anything else is a real build failure the caller reports.
   */
  failure(error: unknown): BuildFailureKind {
    if (!this.options.ownsOperation()) return 'abandoned'
    if (error instanceof RuntimeBuildCommitFenceRejectedError || this.options.signal.aborted) {
      this.options.onCancelled()
      return 'cancelled'
    }
    return 'failed'
  }
}
