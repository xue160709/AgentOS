import fs from 'node:fs/promises'
import path from 'node:path'
import type { LocalAppDefinition, LocalAppRuntimeSnapshot } from '../src/components/types'
import type {
  RuntimeDevelopmentOperationFence,
  RuntimeDevelopmentSnapshot,
  RuntimeRootLease,
  RuntimeScopeId,
} from '../src/runtime-development-contract'
import {
  RuntimeDevelopmentCoordinator,
  type RuntimeDevelopmentAuthority,
  type RuntimeDevelopmentIntent,
} from './runtime-development-coordinator'
import type { RuntimeEditRunnerHook } from './runtime-edit-coordinator'
import {
  inspectLocalAppDirectory,
  type LocalAppInspectResult,
  type RuntimeBuildOptions,
} from './local-app-runtime/index'
import { fingerprintRuntimeSource } from './local-app-runtime/static'
import type { RuntimeRootExecutionRegistry } from './runtime-root-execution-registry'

type RuntimeDevelopmentManager = {
  register(definition: LocalAppDefinition): void
  start(localAppId: string, consumerId?: string, options?: { autoBuild?: boolean }): Promise<LocalAppRuntimeSnapshot>
  restart(localAppId: string): Promise<LocalAppRuntimeSnapshot>
  get(localAppId: string): LocalAppRuntimeSnapshot | null
  release(localAppId: string, consumerId: string): Promise<LocalAppRuntimeSnapshot | null>
  build(localAppId: string, consumerId?: string, options?: RuntimeBuildOptions): Promise<LocalAppRuntimeSnapshot>
  cancelBuild(localAppId: string, buildId?: string): Promise<LocalAppRuntimeSnapshot | null>
  acquireDevelopmentLease(localAppId: string): Promise<RuntimeRootLease>
  releaseDevelopmentLease(localAppId: string, expectedLease?: RuntimeRootLease): Promise<void>
  getRootExecutionRegistry(): RuntimeRootExecutionRegistry
}

export type RuntimeDevelopmentRuntimeBridgeOptions = {
  coordinator: RuntimeDevelopmentCoordinator
  manager: RuntimeDevelopmentManager
  resolveDefinition(runtimeScopeId: RuntimeScopeId): LocalAppDefinition | null
  inspect?: (rootPath: string) => Promise<LocalAppInspectResult>
  fingerprint?: (rootPath: string, outputRoot?: string) => Promise<string>
  runner?: { addRuntimeEditHook(hook: RuntimeEditRunnerHook): () => void }
  runtimeBroker?: { rebaseDevelopmentGeneration(runtimeScopeId: RuntimeScopeId, routeGeneration: number, fromGeneration: number, toGeneration: number): void }
  isAuthorityCurrent?: (authority: RuntimeDevelopmentAuthority) => boolean
  resolveProspectiveRoot?: (runtimeScopeId: RuntimeScopeId) => Promise<string>
  onSnapshot?: (snapshot: RuntimeDevelopmentSnapshot) => void
}

type RuntimeDevelopmentBridgeLogCode =
  | 'runtime-open-enter'
  | 'runtime-open-succeeded'
  | 'runtime-root-missing'
  | 'runtime-root-conflict'
  | 'runtime-live-preview-unavailable'
  | 'runtime-save-enter'
  | 'runtime-save-succeeded'
  | 'runtime-build-failed'
  | 'runtime-save-aborted'
  | 'runtime-save-served'
  | 'runtime-restore-viewing-failed'

/**
 * Adapts coordinator intents to the existing Runtime state machine. It never
 * selects commands: inspection supplies the fixed declaration and build() owns
 * process, validation, artifact staging and atomic last-good publication.
 */
export class RuntimeDevelopmentRuntimeBridge {
  private readonly inspect: (rootPath: string) => Promise<LocalAppInspectResult>
  private readonly fingerprintSource: (rootPath: string, outputRoot?: string) => Promise<string>
  private readonly rootExecutionRegistry: RuntimeRootExecutionRegistry
  private readonly developmentConsumers = new Map<RuntimeScopeId, {
    definitionId: string
    consumerId: string
    leaseOnly: boolean
    prospective: boolean
    rootLease?: RuntimeRootLease
    routeGeneration: number
    developmentGeneration: number
  }>()
  private readonly openOperations = new Map<RuntimeScopeId, symbol>()
  private readonly saveFences = new Map<RuntimeScopeId, RuntimeDevelopmentOperationFence>()
  private readonly removeRunnerHook?: () => void

  constructor(private readonly options: RuntimeDevelopmentRuntimeBridgeOptions) {
    this.inspect = options.inspect ?? inspectLocalAppDirectory
    this.fingerprintSource = options.fingerprint ?? fingerprintRuntimeSource
    this.rootExecutionRegistry = options.manager.getRootExecutionRegistry()
    this.removeRunnerHook = options.runner?.addRuntimeEditHook(options.coordinator)
  }

  async fingerprint(runtimeScopeId: RuntimeScopeId): Promise<string> {
    const definition = this.options.resolveDefinition(runtimeScopeId)
    if (!definition) {
      const consumer = this.developmentConsumers.get(runtimeScopeId)
      if (!consumer?.prospective || !consumer.rootLease) throw new Error('runtime-definition-missing')
      return this.fingerprintSource(consumer.rootLease.canonicalRoot).catch(() => 'prospective-root-missing')
    }
    const inspected = await this.inspect(definition.rootPath)
    if (!inspected.ok) throw new Error(inspected.code)
    return this.fingerprintSource(inspected.canonicalRoot, inspected.agentos?.outputRoot)
  }

  async open(authority: RuntimeDevelopmentAuthority): Promise<RuntimeDevelopmentSnapshot | null> {
    logBridge('info', 'open', authority.runtimeScopeId, 'runtime-open-enter')
    const openOperation = Symbol(authority.runtimeScopeId)
    this.openOperations.set(authority.runtimeScopeId, openOperation)
    const definition = this.options.resolveDefinition(authority.runtimeScopeId)
    if (!definition) return this.openProspective(authority, openOperation)
    const inspected = await this.inspect(definition.rootPath)
    if (!this.isOpenCurrent(authority, openOperation)) return null
    if (!inspected.ok) {
      this.options.coordinator.open({ ...authority, runtimeDefinitionId: definition.id, entryFingerprint: '', saveCapability: 'unavailable' })
      this.options.coordinator.failOpening(authority, inspected.code === 'path-missing' ? 'runtime-root-missing' : 'runtime-live-preview-unavailable')
      logBridge('error', 'open', authority.runtimeScopeId, inspected.code === 'path-missing' ? 'runtime-root-missing' : 'runtime-live-preview-unavailable')
      return this.options.coordinator.snapshot(authority.runtimeScopeId) ?? null
    }
    // `T4.5`: the serve plan decides whether this Runtime can end a session by
    // saving a preview, not the presence of a declaration block.
    const saveCapability = inspected.servePlan.kind === 'artifact' || inspected.servePlan.kind === 'buildable'
      ? 'static'
      : inspected.servePlan.kind === 'production' && inspected.hasBuildScript
        ? 'server'
        : inspected.hasDevScript ? 'development-only' : 'unavailable'
    const entryFingerprint = await this.fingerprintSource(inspected.canonicalRoot, inspected.agentos?.outputRoot)
    if (!this.isOpenCurrent(authority, openOperation)) return null
    this.options.coordinator.open({ ...authority, runtimeDefinitionId: definition.id, entryFingerprint, saveCapability })
    const consumerId = developmentConsumerId(authority)
    try {
      if (inspected.hasDevScript) {
        // `serveOverride` is what outranks detection (`C-RSM-404`); without it
        // a statically servable Runtime would keep serving its artifact here.
        const developmentDefinition: LocalAppDefinition = { ...definition, canonicalRoot: inspected.canonicalRoot, mode: 'development', agentos: undefined, serveScript: 'dev' }
        this.options.manager.register(developmentDefinition)
        await this.options.manager.start(definition.id, consumerId, { autoBuild: false })
        if (!this.isOpenCurrent(authority, openOperation)) {
          await this.options.manager.release(definition.id, consumerId)
          return null
        }
        this.developmentConsumers.set(authority.runtimeScopeId, { definitionId: definition.id, consumerId, leaseOnly: false, prospective: false, routeGeneration: authority.routeGeneration, developmentGeneration: authority.developmentGeneration })
      } else {
        this.options.manager.register({ ...definition, canonicalRoot: inspected.canonicalRoot, mode: inspected.mode, agentos: inspected.agentos })
        const rootLease = await this.options.manager.acquireDevelopmentLease(definition.id)
        if (!this.isOpenCurrent(authority, openOperation)) {
          await this.options.manager.releaseDevelopmentLease(definition.id, rootLease)
          return null
        }
        this.developmentConsumers.set(authority.runtimeScopeId, { definitionId: definition.id, consumerId, leaseOnly: true, prospective: false, rootLease, routeGeneration: authority.routeGeneration, developmentGeneration: authority.developmentGeneration })
      }
      this.options.coordinator.ready(authority)
      logBridge('info', 'open', authority.runtimeScopeId, 'runtime-open-succeeded')
    } catch (error) {
      const conflictingLease = conflictLeaseFromError(error)
      if (conflictingLease) {
        this.options.coordinator.failOpening(authority, 'runtime-development-conflict', '该目录正在由另一 Runtime 修改。')
        logBridge('error', 'open', authority.runtimeScopeId, 'runtime-root-conflict')
        throw rootLeaseError('runtime-development-conflict', conflictingLease)
      }
      this.options.coordinator.failOpening(authority, 'runtime-live-preview-unavailable', '实时效果暂不可用，源码和对话仍保留。')
      logBridge('error', 'open', authority.runtimeScopeId, 'runtime-live-preview-unavailable')
    }
    return this.options.coordinator.snapshot(authority.runtimeScopeId) ?? null
  }

  async handle(intent: RuntimeDevelopmentIntent): Promise<void> {
    if (intent.type === 'cancel-save') {
      if (!sameFence(this.saveFences.get(intent.runtimeScopeId), intent)) return
      const definition = this.options.resolveDefinition(intent.runtimeScopeId)
      if (definition) await this.options.manager.cancelBuild(definition.id)
      return
    }
    if (intent.type === 'closed') {
      // Only the close that actually ended this session may restore viewing;
      // a late or duplicate close must not restart a newer session's server.
      if (await this.releaseDevelopment(intent.runtimeScopeId, intent)) await this.restoreViewing(intent.runtimeScopeId)
      return
    }
    await this.save(intent)
  }

  async reenter(runtimeScopeId: RuntimeScopeId): Promise<RuntimeDevelopmentSnapshot | null> {
    const previous = this.options.coordinator.snapshot(runtimeScopeId)
    const snapshot = this.options.coordinator.reenter(runtimeScopeId)
    if (!snapshot || !previous) return snapshot
    this.options.runtimeBroker?.rebaseDevelopmentGeneration(runtimeScopeId, snapshot.routeGeneration, previous.developmentGeneration, snapshot.developmentGeneration)
    const current = this.developmentConsumers.get(runtimeScopeId)
    if (current?.prospective) {
      // The same prospective token remains held while the window generation is
      // renewed; an old close callback is fenced by the updated authority.
      current.routeGeneration = snapshot.routeGeneration
      current.developmentGeneration = snapshot.developmentGeneration
      current.consumerId = developmentConsumerId(snapshot)
      return snapshot
    }
    await this.options.manager.cancelBuild(previous.runtimeDefinitionId ?? '')
    await this.releaseDevelopment(runtimeScopeId, previous)
    return this.open({ runtimeScopeId, routeGeneration: snapshot.routeGeneration, developmentGeneration: snapshot.developmentGeneration })
  }

  /** Main calls this before creating a window or submitting the controlled creation prompt. */
  async acquireProspective(authority: RuntimeDevelopmentAuthority): Promise<RuntimeRootLease> {
    const resolveRoot = this.options.resolveProspectiveRoot
    if (!resolveRoot) throw new Error('runtime-prospective-root-unavailable')
    const canonicalRoot = await resolveRoot(authority.runtimeScopeId)
    const current = this.developmentConsumers.get(authority.runtimeScopeId)
    if (current && !current.prospective) {
      if (current.rootLease) return current.rootLease
      throw new Error('runtime-definition-lease-active')
    }
    const prospectiveDefinitionId = prospectiveRuntimeDefinitionId(authority.runtimeScopeId)
    const result = await this.rootExecutionRegistry.acquire({
      canonicalRoot,
      runtimeDefinitionId: prospectiveDefinitionId,
      runtimeScopeId: authority.runtimeScopeId,
      kind: 'development',
      // Registry generation is a lease-token fence, not the window generation.
      // Keeping the prospective token at generation 1 lets the manager adopt it
      // without releasing the root when the first Definition appears.
      generation: 1,
    })
    if (!result.ok) throw rootLeaseError(result.error.code, result.error.conflictingLease)
    this.developmentConsumers.set(authority.runtimeScopeId, {
      definitionId: prospectiveDefinitionId,
      consumerId: developmentConsumerId(authority),
      leaseOnly: true,
      prospective: true,
      rootLease: result.lease,
      routeGeneration: authority.routeGeneration,
      developmentGeneration: authority.developmentGeneration,
    })
    return result.lease
  }

  /**
   * Re-inspects the new Definition and atomically replaces the prospective
   * token. The manager then adopts that exact token without a release window.
   */
  async bindDefinition(runtimeScopeId: RuntimeScopeId, definition: LocalAppDefinition): Promise<RuntimeRootLease | null> {
    const consumer = this.developmentConsumers.get(runtimeScopeId)
    if (!consumer?.prospective || !consumer.rootLease) return null
    const inspected = await this.inspect(definition.rootPath)
    if (!inspected.ok) throw new Error(inspected.code)
    const rebound = await this.rootExecutionRegistry.rebindDevelopmentLease(consumer.rootLease, {
      canonicalRoot: inspected.canonicalRoot,
      runtimeDefinitionId: definition.id,
      runtimeScopeId,
      kind: 'development',
      generation: consumer.rootLease.generation,
    })
    if (!rebound.ok) {
      if (rebound.error.code === 'runtime-development-conflict') throw rootLeaseError(rebound.error.code, rebound.error.conflictingLease)
      throw new Error(rebound.error.code)
    }
    const boundDefinition = { ...definition, canonicalRoot: inspected.canonicalRoot }
    consumer.definitionId = definition.id
    consumer.prospective = false
    consumer.rootLease = rebound.lease
    this.options.manager.register(boundDefinition)
    // acquireDevelopmentLease reuses the rebound token and records it in the
    // existing manager, so future build/stop paths keep their single owner.
    consumer.rootLease = await this.options.manager.acquireDevelopmentLease(definition.id)
    return consumer.rootLease
  }

  isDefinitionBound(runtimeScopeId: RuntimeScopeId, definitionId: string): boolean {
    const consumer = this.developmentConsumers.get(runtimeScopeId)
    return Boolean(consumer && !consumer.prospective && consumer.definitionId === definitionId && consumer.rootLease)
  }

  hasProspectiveLease(runtimeScopeId: RuntimeScopeId): boolean {
    return this.developmentConsumers.get(runtimeScopeId)?.prospective === true
  }

  async abort(authority: RuntimeDevelopmentAuthority): Promise<void> {
    this.openOperations.delete(authority.runtimeScopeId)
    await this.releaseDevelopment(authority.runtimeScopeId, authority)
  }

  async invalidate(authority: RuntimeDevelopmentAuthority): Promise<void> {
    this.openOperations.delete(authority.runtimeScopeId)
    await this.releaseDevelopment(authority.runtimeScopeId, authority)
  }

  async releaseProspectiveLeases(): Promise<void> {
    const pending = [...this.developmentConsumers.entries()]
      .filter(([, consumer]) => consumer.prospective)
      .map(async ([runtimeScopeId, consumer]) => {
        if (this.developmentConsumers.get(runtimeScopeId)?.rootLease?.leaseId !== consumer.rootLease?.leaseId) return
        this.developmentConsumers.delete(runtimeScopeId)
        if (consumer.rootLease) await this.rootExecutionRegistry.release(consumer.rootLease)
      })
    await Promise.all(pending)
  }

  dispose(): void {
    this.removeRunnerHook?.()
    void this.releaseProspectiveLeases()
  }

  private async openProspective(authority: RuntimeDevelopmentAuthority, openOperation: symbol): Promise<RuntimeDevelopmentSnapshot | null> {
    const lease = await this.acquireProspective(authority)
    if (!this.isOpenCurrent(authority, openOperation)) {
      await this.releaseDevelopment(authority.runtimeScopeId, authority)
      return null
    }
    const entryFingerprint = await this.fingerprintSource(lease.canonicalRoot).catch(() => 'prospective-root-missing')
    if (!this.isOpenCurrent(authority, openOperation)) {
      await this.releaseDevelopment(authority.runtimeScopeId, authority)
      return null
    }
    this.options.coordinator.open({ ...authority, entryFingerprint, saveCapability: 'unavailable' })
    this.options.coordinator.ready(authority)
    logBridge('info', 'open', authority.runtimeScopeId, 'runtime-open-succeeded')
    return this.options.coordinator.snapshot(authority.runtimeScopeId) ?? null
  }

  private async save(fence: RuntimeDevelopmentOperationFence): Promise<void> {
    if (!this.options.coordinator.canCommit(fence)) return
    logBridge('info', 'save', fence.runtimeScopeId, 'runtime-save-enter')
    const definition = this.options.resolveDefinition(fence.runtimeScopeId)
    if (!definition || definition.id !== this.options.coordinator.snapshot(fence.runtimeScopeId)?.runtimeDefinitionId) {
      this.options.coordinator.completeSave(fence, 'aborted')
      return
    }
    const inspected = await this.inspect(definition.rootPath)
    if (!this.options.coordinator.canCommit(fence)) return
    if (!inspected.ok || inspected.mode !== 'static') {
      this.options.coordinator.completeSave(fence, 'aborted')
      return
    }
    this.options.manager.register({ ...definition, canonicalRoot: inspected.canonicalRoot, mode: 'static', agentos: inspected.agentos })
    this.saveFences.set(fence.runtimeScopeId, fence)
    let snapshot: LocalAppRuntimeSnapshot
    try {
      snapshot = await this.options.manager.build(definition.id, undefined, {
        beforeCommit: () => this.options.coordinator.canCommit(fence),
      })
    } catch {
      if (sameFence(this.saveFences.get(fence.runtimeScopeId), fence)) this.saveFences.delete(fence.runtimeScopeId)
      const remainsCurrent = this.options.coordinator.canCommit(fence)
      this.options.coordinator.completeSave(fence, remainsCurrent ? 'build-failed' : 'aborted')
      logBridge('error', 'save', fence.runtimeScopeId, remainsCurrent ? 'runtime-build-failed' : 'runtime-save-aborted')
      return
    }
    if (sameFence(this.saveFences.get(fence.runtimeScopeId), fence)) this.saveFences.delete(fence.runtimeScopeId)
    if (!this.options.coordinator.canCommit(fence)) {
      this.options.coordinator.completeSave(fence, 'aborted')
      return
    }
    // Tier ③ → ②: the edited source builds a server bundle, not a page.
    // Serve it instead of reporting a failed save (`C-RSM-501`).
    if (snapshot.errorCode === 'build-produces-no-artifact') {
      this.options.manager.register({ ...definition, canonicalRoot: inspected.canonicalRoot })
      snapshot = await this.options.manager.start(definition.id, undefined, { autoBuild: true })
      const served = snapshot.status === 'running'
      this.options.coordinator.completeSave(fence, served ? 'saved' : 'build-failed')
      logBridge(served ? 'info' : 'error', 'save', fence.runtimeScopeId, served ? 'runtime-save-served' : 'runtime-build-failed')
      return
    }
    const succeeded = snapshot.mode === 'static' && snapshot.buildStatus === 'ready' && snapshot.status === 'ready'
    this.options.coordinator.completeSave(fence, succeeded ? 'saved' : 'build-failed')
    logBridge(succeeded ? 'info' : 'error', 'save', fence.runtimeScopeId, succeeded ? 'runtime-save-succeeded' : 'runtime-build-failed')
  }

  /**
   * A session runs the Runtime's own definition as `npm run dev`. Once it
   * closes, whoever is still viewing must get the serve ladder's choice back
   * (`C-RSM-501`) — for a served bundle that restart is also the freshness
   * checkpoint that rebuilds the AI's edits (`C-RSM-503`).
   */
  private async restoreViewing(runtimeScopeId: RuntimeScopeId): Promise<void> {
    const definition = this.options.resolveDefinition(runtimeScopeId)
    if (!definition) return
    const inspected = await this.inspect(definition.rootPath)
    if (!inspected.ok) return
    this.options.manager.register({ ...definition, canonicalRoot: inspected.canonicalRoot })
    const current = this.options.manager.get(definition.id)
    if (!current || current.mode !== 'development' || !['running', 'starting', 'degraded'].includes(current.status)) return
    if (inspected.servePlan.kind === 'development') return
    try {
      await this.options.manager.restart(definition.id)
    } catch {
      logBridge('error', 'close', runtimeScopeId, 'runtime-restore-viewing-failed')
    }
  }

  /** True only when this call ended the session it names. */
  private async releaseDevelopment(runtimeScopeId: RuntimeScopeId, authority?: Pick<RuntimeDevelopmentAuthority, 'routeGeneration' | 'developmentGeneration'>): Promise<boolean> {
    const consumer = this.developmentConsumers.get(runtimeScopeId)
    if (!consumer) return false
    if (authority && (consumer.routeGeneration !== authority.routeGeneration || consumer.developmentGeneration !== authority.developmentGeneration)) return false
    this.developmentConsumers.delete(runtimeScopeId)
    if (consumer.prospective) {
      if (consumer.rootLease) await this.rootExecutionRegistry.release(consumer.rootLease)
    } else if (consumer.leaseOnly) await this.options.manager.releaseDevelopmentLease(consumer.definitionId, consumer.rootLease)
    else await this.options.manager.release(consumer.definitionId, consumer.consumerId)
    return true
  }

  private isOpenCurrent(authority: RuntimeDevelopmentAuthority, operation: symbol): boolean {
    return this.openOperations.get(authority.runtimeScopeId) === operation && (this.options.isAuthorityCurrent?.(authority) ?? true)
  }
}

export async function canonicalizeProspectiveProjectRuntimeRoot(
  projectPath: string,
  realpath: (input: string) => Promise<string> = fs.realpath,
): Promise<string> {
  const trimmed = projectPath.trim()
  if (!trimmed || trimmed.includes('\0')) throw new Error('runtime-project-path-invalid')
  return path.join(await realpath(trimmed), '.agentos')
}

function prospectiveRuntimeDefinitionId(runtimeScopeId: RuntimeScopeId): string {
  return `prospective:${runtimeScopeId}`
}

function rootLeaseError(code: string, conflictingLease: RuntimeRootLease): Error {
  return Object.assign(new Error(code), { code, conflictingLease })
}

function conflictLeaseFromError(error: unknown): RuntimeRootLease | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; conflictingLease?: unknown }
  return candidate.code === 'runtime-development-conflict' && candidate.conflictingLease && typeof candidate.conflictingLease === 'object'
    ? candidate.conflictingLease as RuntimeRootLease
    : null
}

function developmentConsumerId(authority: RuntimeDevelopmentAuthority): string {
  return `runtime-development:${authority.runtimeScopeId}:${authority.routeGeneration}:${authority.developmentGeneration}`
}

function sameFence(left: RuntimeDevelopmentOperationFence | undefined, right: RuntimeDevelopmentOperationFence): boolean {
  return Boolean(left && left.runtimeScopeId === right.runtimeScopeId && left.routeGeneration === right.routeGeneration && left.developmentGeneration === right.developmentGeneration && left.operationId === right.operationId)
}

function scopeKind(runtimeScopeId: RuntimeScopeId): 'project' | 'workspace' {
  return runtimeScopeId.startsWith('project:') ? 'project' : 'workspace'
}

function logBridge(level: 'info' | 'error', operation: 'open' | 'save' | 'close', runtimeScopeId: RuntimeScopeId, code: RuntimeDevelopmentBridgeLogCode): void {
  // 异常对象可能含 root、命令、用户内容或 credential；运行日志只写固定枚举字段。
  const payload = { operation, scopeKind: scopeKind(runtimeScopeId), code }
  if (level === 'error') console.error('[runtime-development/bridge]', payload)
  else console.log('[runtime-development/bridge]', payload)
}
