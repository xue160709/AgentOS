import type { LocalAppDefinition } from '../../src/components/types'
import type { RuntimeRootLease, RuntimeRootLeaseAcquireResult, RuntimeScopeId } from '../../src/runtime-development-contract'
import type { RuntimeRootExecutionRegistry } from '../runtime-root-execution-registry'
import { canonicalizeLocalAppRoot } from './inspect'

/**
 * Which execution lease each Runtime definition currently holds.
 *
 * `RuntimeRootExecutionRegistry` owns the root mutex itself; this book owns
 * the one question the Manager kept re-answering at every call site: does this
 * definition still hold the lease I am about to release? The compare-by-leaseId
 * rule, the per-definition generation clock and the "a newer lease already
 * replaced mine" case are decided here once, so a caller states an intent
 * (acquire, release, stop and release, transition to build) and nothing else.
 */
export class RuntimeLeaseBook {
  private readonly leaseByDefinition = new Map<string, RuntimeRootLease>()
  private readonly generationByDefinition = new Map<string, number>()
  private readonly pendingGeneration = new Map<string, number>()

  constructor(private readonly registry: RuntimeRootExecutionRegistry) {}

  held(definitionId: string): RuntimeRootLease | undefined {
    return this.leaseByDefinition.get(definitionId)
  }

  async acquire(definition: LocalAppDefinition, kind: RuntimeRootLease['kind']): Promise<RuntimeRootLease> {
    const current = this.leaseByDefinition.get(definition.id)
    let generation = current?.generation ?? this.pendingGeneration.get(definition.id)
    if (generation === undefined) {
      generation = (this.generationByDefinition.get(definition.id) ?? 0) + 1
      this.generationByDefinition.set(definition.id, generation)
      this.pendingGeneration.set(definition.id, generation)
    }
    // Every caller must key the lease on the same string. A definition can
    // still carry a pre-realpath root, and a lease taken under `/var/...`
    // would not exclude one taken under `/private/var/...`.
    let canonicalRoot = definition.canonicalRoot ?? definition.rootPath
    try {
      canonicalRoot = await canonicalizeLocalAppRoot(canonicalRoot)
    } catch {
      // A vanished directory fails later with its own error code.
    }
    const result = await this.registry.acquire({
      canonicalRoot,
      runtimeDefinitionId: definition.id,
      runtimeScopeId: runtimeScopeForDefinition(definition),
      kind,
      generation,
    })
    if (!result.ok) throw runtimeRootAcquireError(result)
    this.pendingGeneration.delete(definition.id)
    this.leaseByDefinition.set(definition.id, result.lease)
    return result.lease
  }

  /** Stop this definition, releasing its lease first when it holds one. */
  async stopAndRelease(definitionId: string, stop: () => Promise<unknown>): Promise<void> {
    const lease = this.leaseByDefinition.get(definitionId)
    if (!lease) {
      await stop()
      return
    }
    const result = await this.registry.stopAndRelease(lease, stop)
    if (!result.ok) throw result.error.cause
    this.forgetIfCurrent(definitionId, lease)
  }

  /** Same, but a definition that holds no matching lease is left untouched. */
  async stopAndReleaseIfHeld(
    definitionId: string,
    stop: () => Promise<unknown>,
    kind?: RuntimeRootLease['kind'],
  ): Promise<void> {
    const lease = this.leaseByDefinition.get(definitionId)
    if (!lease || (kind && lease.kind !== kind)) return
    const result = await this.registry.stopAndRelease(lease, stop)
    if (!result.ok) throw result.error.cause
    this.forgetIfCurrent(definitionId, lease)
  }

  /** Release without stopping: the caller keeps whatever it was running. */
  async releaseIfHeld(definitionId: string, kind?: RuntimeRootLease['kind'], expected?: RuntimeRootLease): Promise<void> {
    const lease = expected ?? this.leaseByDefinition.get(definitionId)
    if (!lease || (kind && lease.kind !== kind)) return
    await this.release(definitionId, lease)
  }

  async release(definitionId: string, lease: RuntimeRootLease): Promise<void> {
    const result = await this.registry.release(lease)
    if (!result.ok) throw result.error.cause
    this.forgetIfCurrent(definitionId, lease)
  }

  /** Best-effort release used where a failed release must not mask the result. */
  async releaseQuietly(definitionId: string, lease: RuntimeRootLease): Promise<void> {
    const result = await this.registry.release(lease)
    if (result.ok) this.forgetIfCurrent(definitionId, lease)
  }

  /**
   * A build needs the root exclusively. An in-flight development lease is
   * transitioned rather than dropped, so the root is never momentarily free.
   */
  async transitionToBuild(definitionId: string, stopDevelopment: () => Promise<unknown>): Promise<RuntimeRootLease> {
    const developmentLease = this.leaseByDefinition.get(definitionId)
    if (developmentLease?.kind !== 'development') throw new Error('runtime-root-development-lease-missing')
    const transition = await this.registry.transitionDevelopmentToBuild(developmentLease, stopDevelopment)
    if (!transition.ok) {
      throw transition.error.code === 'runtime-root-transition-failed'
        ? transition.error.cause
        : new Error(transition.error.code)
    }
    this.leaseByDefinition.set(definitionId, transition.lease)
    return transition.lease
  }

  /** A lease that was already replaced by a newer one must not be forgotten. */
  private forgetIfCurrent(definitionId: string, lease: RuntimeRootLease): void {
    if (this.leaseByDefinition.get(definitionId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(definitionId)
  }
}

export function runtimeScopeForDefinition(definition: LocalAppDefinition): RuntimeScopeId {
  return definition.owner?.kind === 'project'
    ? `project:${definition.owner.projectId}`
    : `workspace:${definition.id}`
}

function runtimeRootAcquireError(result: Extract<RuntimeRootLeaseAcquireResult, { ok: false }>): Error {
  const error = new Error(result.error.code)
  Object.assign(error, { code: result.error.code, conflictingLease: result.error.conflictingLease })
  return error
}
