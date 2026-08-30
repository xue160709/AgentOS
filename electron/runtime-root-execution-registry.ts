import { randomBytes } from 'node:crypto'
import * as path from 'node:path'
import type {
  RuntimeRootLease,
  RuntimeRootLeaseAcquireResult,
  RuntimeRootLeaseReleaseResult,
  RuntimeRootLeaseRequest,
} from '../src/runtime-development-contract'

export type RuntimeRootLeaseTransitionResult =
  | { ok: true; lease: RuntimeRootLease; reused: boolean }
  | {
      ok: false
      error:
        | { code: 'runtime-root-lease-stale'; currentLease?: RuntimeRootLease }
        | { code: 'runtime-root-transition-failed'; lease: RuntimeRootLease; cause: unknown }
    }

export type RuntimeRootLeaseRebindResult =
  | { ok: true; lease: RuntimeRootLease; reused: boolean }
  | {
      ok: false
      error:
        | { code: 'runtime-root-lease-stale'; currentLease?: RuntimeRootLease }
        | { code: 'runtime-development-conflict'; conflictingLease: RuntimeRootLease }
    }

function cloneLease(lease: RuntimeRootLease): RuntimeRootLease {
  return { ...lease }
}

function comparableCanonicalRoot(canonicalRoot: string): string {
  const trimmed = canonicalRoot.trim()
  if (!trimmed || trimmed.includes('\0')) throw new Error('runtime-root-invalid')
  const normalized = path.resolve(trimmed).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function assertRequest(request: RuntimeRootLeaseRequest): void {
  if (!request.runtimeDefinitionId.trim()) throw new Error('runtime-definition-id-invalid')
  if (!request.runtimeScopeId.trim()) throw new Error('runtime-scope-id-invalid')
  if (!Number.isSafeInteger(request.generation) || request.generation < 0) throw new Error('runtime-generation-invalid')
}

/**
 * Main-owned execution mutex. It owns no Runtime process or artifact state;
 * callbacks let the existing supervisor perform bounded teardown exactly once.
 */
export class RuntimeRootExecutionRegistry {
  private readonly leaseByRoot = new Map<string, RuntimeRootLease>()
  private queue: Promise<void> = Promise.resolve()
  private nonce = 0

  acquire(request: RuntimeRootLeaseRequest): Promise<RuntimeRootLeaseAcquireResult> {
    return this.serialize(() => {
      assertRequest(request)
      const rootKey = comparableCanonicalRoot(request.canonicalRoot)
      const current = this.leaseByRoot.get(rootKey)
      if (!current) {
        const lease = this.createLease({ ...request, canonicalRoot: rootKey })
        this.leaseByRoot.set(rootKey, lease)
        return { ok: true, lease: cloneLease(lease), reused: false }
      }

      if (current.runtimeDefinitionId !== request.runtimeDefinitionId || current.runtimeScopeId !== request.runtimeScopeId) {
        return {
          ok: false,
          error: { code: 'runtime-development-conflict', conflictingLease: cloneLease(current) },
        }
      }
      if (current.state === 'stopping') {
        return { ok: false, error: { code: 'runtime-root-stopping', conflictingLease: cloneLease(current) } }
      }
      if (current.state === 'stop_failed') {
        return { ok: false, error: { code: 'runtime-root-stop-failed', conflictingLease: cloneLease(current) } }
      }
      if (request.kind !== current.kind) {
        return { ok: false, error: { code: 'runtime-root-transition-required', conflictingLease: cloneLease(current) } }
      }
      if (request.generation < current.generation) {
        return { ok: false, error: { code: 'runtime-root-stale-generation', conflictingLease: cloneLease(current) } }
      }
      if (request.generation === current.generation) {
        return { ok: true, lease: cloneLease(current), reused: true }
      }

      // 同一 owner 的新 generation 换发 token；旧 callback 之后只能得到 stale。
      const renewed = this.createLease({ ...request, canonicalRoot: rootKey })
      this.leaseByRoot.set(rootKey, renewed)
      return { ok: true, lease: cloneLease(renewed), reused: false }
    })
  }

  transitionDevelopmentToBuild(
    expected: RuntimeRootLease,
    stopOwnedDevelopment: () => Promise<unknown>,
  ): Promise<RuntimeRootLeaseTransitionResult> {
    return this.serialize(async () => {
      const current = this.currentExpected(expected)
      if (!current) return { ok: false, error: { code: 'runtime-root-lease-stale', currentLease: this.currentFor(expected) } }
      if (current.kind === 'build') return { ok: true, lease: cloneLease(current), reused: true }
      current.state = 'stopping'
      current.failureCode = undefined
      try {
        await stopOwnedDevelopment()
      } catch (cause) {
        current.state = 'stop_failed'
        current.failureCode = 'transition-stop-failed'
        return { ok: false, error: { code: 'runtime-root-transition-failed', lease: cloneLease(current), cause } }
      }
      const buildLease = this.createLease({
        canonicalRoot: current.canonicalRoot,
        runtimeDefinitionId: current.runtimeDefinitionId,
        runtimeScopeId: current.runtimeScopeId,
        kind: 'build',
        generation: current.generation,
      })
      this.leaseByRoot.set(current.canonicalRoot, buildLease)
      return { ok: true, lease: cloneLease(buildLease), reused: false }
    })
  }

  /**
   * Atomically replaces a prospective Project lease with its inspected
   * Definition/root. The old token is fenced immediately, while a conflict on
   * the newly canonicalized root leaves the prospective lease intact.
   */
  rebindDevelopmentLease(
    expected: RuntimeRootLease,
    request: RuntimeRootLeaseRequest,
  ): Promise<RuntimeRootLeaseRebindResult> {
    return this.serialize(() => {
      assertRequest(request)
      const current = this.currentExpected(expected)
      if (!current || current.kind !== 'development' || request.kind !== 'development' || current.runtimeScopeId !== request.runtimeScopeId) {
        return { ok: false, error: { code: 'runtime-root-lease-stale', currentLease: this.currentFor(expected) } }
      }
      const targetRoot = comparableCanonicalRoot(request.canonicalRoot)
      if (
        current.canonicalRoot === targetRoot
        && current.runtimeDefinitionId === request.runtimeDefinitionId
        && current.generation === request.generation
      ) {
        return { ok: true, lease: cloneLease(current), reused: true }
      }
      const target = this.leaseByRoot.get(targetRoot)
      if (target && target.leaseId !== current.leaseId) {
        return { ok: false, error: { code: 'runtime-development-conflict', conflictingLease: cloneLease(target) } }
      }

      const rebound = this.createLease({ ...request, canonicalRoot: targetRoot })
      // The serialized mutation has no observable unlocked state: publish the
      // new key/token before removing the old key owned by this exact token.
      this.leaseByRoot.set(targetRoot, rebound)
      if (current.canonicalRoot !== targetRoot && this.leaseByRoot.get(current.canonicalRoot)?.leaseId === current.leaseId) {
        this.leaseByRoot.delete(current.canonicalRoot)
      }
      return { ok: true, lease: cloneLease(rebound), reused: false }
    })
  }

  release(expected: RuntimeRootLease): Promise<RuntimeRootLeaseReleaseResult> {
    return this.serialize(() => {
      const current = this.currentExpected(expected)
      if (!current) return { ok: true, released: false, lease: this.currentFor(expected) }
      this.leaseByRoot.delete(current.canonicalRoot)
      return { ok: true, released: true, lease: cloneLease(current) }
    })
  }

  stopAndRelease(
    expected: RuntimeRootLease,
    stopOwnedProcessTree: () => Promise<unknown>,
  ): Promise<RuntimeRootLeaseReleaseResult> {
    return this.serialize(async () => {
      const current = this.currentExpected(expected)
      if (!current) return { ok: true, released: false, lease: this.currentFor(expected) }
      current.state = 'stopping'
      current.failureCode = undefined
      try {
        await stopOwnedProcessTree()
      } catch (cause) {
        current.state = 'stop_failed'
        current.failureCode = 'stop-failed'
        return { ok: false, error: { code: 'runtime-root-stop-failed', lease: cloneLease(current), cause } }
      }
      this.leaseByRoot.delete(current.canonicalRoot)
      return { ok: true, released: true, lease: cloneLease(current) }
    })
  }

  getByRoot(canonicalRoot: string): RuntimeRootLease | null {
    const current = this.leaseByRoot.get(comparableCanonicalRoot(canonicalRoot))
    return current ? cloneLease(current) : null
  }

  leases(): RuntimeRootLease[] {
    return [...this.leaseByRoot.values()].map(cloneLease)
  }

  private currentExpected(expected: RuntimeRootLease): RuntimeRootLease | null {
    const current = this.leaseByRoot.get(comparableCanonicalRoot(expected.canonicalRoot))
    if (!current) return null
    return current.leaseId === expected.leaseId
      && current.runtimeDefinitionId === expected.runtimeDefinitionId
      && current.runtimeScopeId === expected.runtimeScopeId
      && current.generation === expected.generation
      ? current
      : null
  }

  private currentFor(expected: RuntimeRootLease): RuntimeRootLease | undefined {
    const current = this.leaseByRoot.get(comparableCanonicalRoot(expected.canonicalRoot))
    return current ? cloneLease(current) : undefined
  }

  private createLease(request: RuntimeRootLeaseRequest): RuntimeRootLease {
    this.nonce += 1
    return {
      ...request,
      leaseId: `runtime-root-${this.nonce.toString(36)}-${randomBytes(6).toString('hex')}`,
      state: 'active',
    }
  }

  private serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
