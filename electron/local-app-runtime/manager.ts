import type {
  LocalAppDefinition,
  LocalAppRuntimeEvent,
  LocalAppRuntimeSnapshot,
  LocalAppRuntimeStatus,
} from '../../src/components/types'
import type { RuntimeRootLease } from '../../src/runtime-development-contract'
import { RuntimeRootExecutionRegistry } from '../runtime-root-execution-registry'
import { serverServePlan, type StaticPreviewRegistry } from './static'
import { RuntimeInspectionPass, canonicalizeLocalAppRoot, servedRuntimeDefinition } from './inspect'
import { RuntimeLeaseBook } from './lease-book'
import {
  LocalAppRuntimeSupervisor,
  type RuntimeBuildOptions,
  type RuntimeStartOptions,
  type RuntimeSupervisorOptions,
} from './supervisor'

export type RuntimeManagerOptions = RuntimeSupervisorOptions & {
  rootExecutionRegistry?: RuntimeRootExecutionRegistry
  /**
   * Check source freshness after every start and update automatically
   * (`C-RSM-502/503`). Main enables it; tests opt in explicitly so a
   * background check never races their spawn assertions.
   */
  autoUpdate?: boolean
}

/**
 * A live-enough process for a second definition to borrow. Anything else
 * (failed, stopped, building) leaves the root free for a real start.
 */
const SHAREABLE_ROOT_STATUSES: ReadonlySet<LocalAppRuntimeStatus> = new Set(['preparing', 'starting', 'running', 'degraded'])

/**
 * One definition borrowing another definition's process on the same root.
 * The borrower owns no lease and no process; it owns only its own consumers
 * and a stable projected identity so every id-keyed path (events, previews,
 * renderer state) keeps working under the borrower's own definition id.
 */
type SharedRootJoin = {
  holderDefinitionId: string
  holderRuntimeId: string
  runtimeId: string
  generation: number
  consumerIds: Set<string>
}

function sharedRootRuntimeId(definitionId: string, generation: number): string {
  return `shared-${definitionId}-${generation}`
}

function sharedRootSnapshotEvent(snapshot: LocalAppRuntimeSnapshot, timestamp: number): LocalAppRuntimeEvent {
  return {
    type: 'snapshot',
    runtimeDefinitionId: snapshot.runtimeDefinitionId,
    localAppId: snapshot.runtimeDefinitionId,
    runtimeId: snapshot.runtimeId,
    generation: snapshot.generation,
    status: snapshot.status,
    mode: snapshot.mode,
    readyUrl: snapshot.readyUrl,
    previewUrl: snapshot.previewUrl,
    port: snapshot.port,
    phase: snapshot.phase,
    errorCode: snapshot.errorCode,
    detail: snapshot.detail,
    sharedRootRuntime: snapshot.sharedRootRuntime,
    timestamp,
  }
}

export class LocalAppRuntimeManager {
  private readonly supervisor: LocalAppRuntimeSupervisor
  private readonly rootExecutionRegistry: RuntimeRootExecutionRegistry
  private readonly leases: RuntimeLeaseBook
  private readonly definitions = new Map<string, LocalAppDefinition>()
  private readonly consumers = new Map<string, Set<string>>()
  private readonly pendingDefinitionStops = new Map<string, Promise<void>>()
  private readonly buildOperations = new Map<string, Promise<LocalAppRuntimeSnapshot>>()
  private readonly updateOperations = new Map<string, Promise<LocalAppRuntimeSnapshot | null>>()
  private readonly autoUpdate: boolean
  private readonly listeners = new Set<(event: LocalAppRuntimeEvent) => void>()
  private readonly sharedRootJoins = new Map<string, SharedRootJoin>()
  private readonly lastProjectedGeneration = new Map<string, number>()
  private readonly now: () => number
  private readonly externalOnEvent?: (event: LocalAppRuntimeEvent) => void

  constructor(options: RuntimeManagerOptions = {}) {
    this.rootExecutionRegistry = options.rootExecutionRegistry ?? new RuntimeRootExecutionRegistry()
    this.leases = new RuntimeLeaseBook(this.rootExecutionRegistry)
    this.now = options.now ?? Date.now
    this.externalOnEvent = options.onEvent
    this.autoUpdate = options.autoUpdate === true
    this.supervisor = new LocalAppRuntimeSupervisor({
      ...options,
      onEvent: (event) => {
        this.deliverEvent(event)
        this.deliverSharedRootProjections(event)
      },
    })
  }

  onEvent(listener: (event: LocalAppRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(definition: LocalAppDefinition): void {
    const previousDefinition = this.definitions.get(definition.id)
    const previousRoot = previousDefinition && (previousDefinition.canonicalRoot ?? previousDefinition.rootPath)
    const nextRoot = definition.canonicalRoot ?? definition.rootPath
    if (previousDefinition && previousRoot !== nextRoot) {
      // A definition id is durable identity. A root change must never allow
      // start() to reuse the old process; defer the bounded stop until the
      // caller starts the replacement definition.
      const pending = this.sharedRootJoins.has(definition.id)
        // A borrowed Runtime owns neither lease nor process: leaving is the stop.
        ? this.leaveSharedRoot(definition.id).then(() => undefined)
        : this.leases.stopAndRelease(definition.id, () => this.supervisor.stop(definition.id, 'user'))
      this.pendingDefinitionStops.set(definition.id, pending)
    }
    this.definitions.set(definition.id, definition)
  }

  get(localAppId: string): LocalAppRuntimeSnapshot | null {
    const join = this.sharedRootJoins.get(localAppId)
    const holder = join ? this.supervisor.snapshot(join.holderDefinitionId) : null
    if (join && holder) return this.projectSharedSnapshot(localAppId, join, holder)
    return this.supervisor.snapshot(localAppId)
  }

  async start(
    localAppId: string,
    consumerId?: string,
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const snapshot = await this.startServed(localAppId, consumerId, options)
    // `C-RSM-503`: every start (restore, reopen, restart, new) is a freshness
    // checkpoint. It runs after the page is already viewable, never before.
    if (this.autoUpdate && !this.sharedRootJoins.has(localAppId)) void this.updateToLatest(localAppId).catch(() => undefined)
    return snapshot
  }

  /**
   * Bring what the user is viewing up to date with its source
   * (`C-RSM-502`). Without `force` it only acts when the source changed and
   * an update has not already failed on that source; `force` is the explicit
   * retry. Static runtimes rebuild through the regular build; served bundles
   * are rebuilt in place. Development runtimes need nothing.
   */
  updateToLatest(localAppId: string, options: { force?: boolean } = {}): Promise<LocalAppRuntimeSnapshot | null> {
    const existing = this.updateOperations.get(localAppId)
    if (existing) return existing
    const operation = this.runUpdate(localAppId, options.force === true).finally(() => {
      if (this.updateOperations.get(localAppId) === operation) this.updateOperations.delete(localAppId)
    })
    this.updateOperations.set(localAppId, operation)
    return operation
  }

  private async runUpdate(localAppId: string, force: boolean): Promise<LocalAppRuntimeSnapshot | null> {
    if (this.sharedRootJoins.has(localAppId)) return this.get(localAppId)
    const snapshot = this.supervisor.snapshot(localAppId)
    if (!snapshot) return null
    const isStatic = snapshot.mode === 'static'
    const viewable = isStatic ? Boolean(snapshot.artifactId) && snapshot.status !== 'stopped' : snapshot.status === 'running'
    if (!viewable || this.buildOperations.has(localAppId)) return snapshot
    const freshness = await this.supervisor.sourceFreshness(localAppId)
    if (!force && !freshness.stale) return snapshot
    if (isStatic) {
      const built = await this.build(localAppId)
      this.supervisor.noteUpdateOutcome(localAppId, built.buildStatus !== 'build_failed' && built.status !== 'failed', freshness.fingerprint)
      return built
    }
    const updated = await this.supervisor.updateServer(localAppId)
    if (updated) this.supervisor.noteUpdateOutcome(localAppId, updated.status === 'running' && updated.errorCode !== 'update-failed', freshness.fingerprint)
    return updated
  }

  private async startServed(
    localAppId: string,
    consumerId?: string,
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const definition = this.definitions.get(localAppId)
    if (!definition) throw new Error('local-app-definition-missing')
    if (definition.trustStatus !== 'trusted') throw new Error('local-app-trust-required')
    const pendingStop = this.pendingDefinitionStops.get(localAppId)
    if (pendingStop) {
      this.pendingDefinitionStops.delete(localAppId)
      await pendingStop
    }

    // `T4.6`: a persisted `mode` can be stale (it was written before detection
    // existed). Re-inspect on every start; only an explicit user override is
    // allowed to outrank what the directory says today. The whole start shares
    // this one pass, so the Supervisor sees the same facts without reading the
    // directory again.
    const pass = new RuntimeInspectionPass()
    const inspected = await pass.inspectDefinition(definition)
    const served = inspected.ok ? servedRuntimeDefinition(definition, inspected) : definition
    const isDevelopment = served.mode === 'development'
    if (isDevelopment) {
      // The root stays a single execution mutex. A second definition pointed
      // at the same directory (a Workspace Tab and the owning project's
      // Runtime page) borrows the live instance as one more consumer instead
      // of failing the whole start with a root conflict.
      const shared = await this.joinSharedRoot(served, consumerId)
      if (shared) return shared
      await this.leases.acquire(served, 'development')
    } else {
      await this.leaveSharedRoot(localAppId)
    }

    const consumers = this.consumers.get(localAppId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(localAppId, consumers)
    for (const id of consumers) this.supervisor.attachConsumer(localAppId, id)

    // 静态 Preview 本身不占 lease；首次缺少 last-good 时再由 build() 单独取得瞬时 build lease。
    if (!isDevelopment) await this.leases.stopAndReleaseIfHeld(localAppId, () => this.supervisor.stop(localAppId, 'user'), 'development')
    try {
      const snapshot = await this.supervisor.start(served, consumers, isDevelopment ? options : { ...options, autoBuild: false }, pass)
      if (isDevelopment && snapshot.status !== 'running' && snapshot.status !== 'starting' && snapshot.status !== 'preparing') {
        await this.leases.stopAndReleaseIfHeld(localAppId, () => this.supervisor.stop(localAppId, 'error'))
      }
      // `C-RSM-402` tier ③: a directory whose build produces no openable page is
      // served by keeping `npm run dev` running instead. The fallback is not a
      // failure, and a Runtime already known to be in tier ③ must not be asked
      // to build again before it can be served.
      const serveAsServer = () => {
        if (!inspected.ok) return null
        const fallback = serverServePlan(inspected, 'build-produces-no-artifact')
        if (fallback.kind !== 'production' && fallback.kind !== 'development') return null
        return this.startDevelopment(
          localAppId,
          { ...served, mode: 'development' as const, agentos: undefined, serveScript: fallback.kind === 'production' ? 'start' : 'dev' },
          consumerId,
          options,
          pass,
        )
      }
      if (!isDevelopment && snapshot.errorCode === 'build-produces-no-artifact') {
        const fallback = serveAsServer()
        if (fallback) return fallback
      }
      if (!isDevelopment && options.autoBuild !== false && snapshot.mode === 'static' && snapshot.buildStatus === 'build_required') {
        const built = await this.build(localAppId, consumerId, {}, pass)
        if (built.errorCode === 'build-produces-no-artifact') {
          const fallback = serveAsServer()
          if (fallback) return fallback
        }
        return built
      }
      return snapshot
    } catch (error) {
      if (isDevelopment) await this.leases.stopAndReleaseIfHeld(localAppId, () => this.supervisor.stop(localAppId, 'error')).catch(() => undefined)
      throw error
    }
  }

  /**
   * Serve tier ③: keep `npm run dev` running because this directory cannot
   * produce an openable page. It takes the development lease like any other
   * dev runtime, so same-root exclusion still holds.
   */
  private async startDevelopment(
    localAppId: string,
    definition: LocalAppDefinition,
    consumerId: string | undefined,
    options: RuntimeStartOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    const shared = await this.joinSharedRoot(definition, consumerId)
    if (shared) return shared
    await this.leases.acquire(definition, 'development')
    const consumers = this.consumers.get(localAppId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(localAppId, consumers)
    try {
      const snapshot = await this.supervisor.start(definition, consumers, options, pass)
      if (snapshot.status !== 'running' && snapshot.status !== 'starting' && snapshot.status !== 'preparing') {
        await this.leases.stopAndReleaseIfHeld(localAppId, () => this.supervisor.stop(localAppId, 'error'))
      }
      return snapshot
    } catch (error) {
      await this.leases.stopAndReleaseIfHeld(localAppId, () => this.supervisor.stop(localAppId, 'error')).catch(() => undefined)
      throw error
    }
  }

  async stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    // Stopping a borrowed Runtime means leaving it: this definition owns no
    // process, so the holder and every other viewer keep running.
    const left = await this.leaveSharedRoot(localAppId, reason)
    if (left) return left
    let snapshot: LocalAppRuntimeSnapshot | null = this.supervisor.snapshot(localAppId)
    await this.leases.stopAndRelease(localAppId, async () => {
      snapshot = await this.supervisor.stop(localAppId, reason)
    })
    return snapshot
  }

  restart(localAppId: string): Promise<LocalAppRuntimeSnapshot> {
    const join = this.sharedRootJoins.get(localAppId)
    if (join) return this.restartSharedRoot(localAppId, join)
    const definition = this.definitions.get(localAppId)
    if (!definition) return Promise.reject(new Error('local-app-definition-missing'))
    const consumers = this.consumers.get(localAppId) ?? new Set<string>()
    return this.stop(localAppId, 'user').then(() => this.start(localAppId, undefined, { autoBuild: true })).then((snapshot) => {
      for (const consumerId of consumers) this.supervisor.attachConsumer(localAppId, consumerId)
      return snapshot
    })
  }

  build(
    localAppId: string,
    consumerId?: string,
    options: RuntimeBuildOptions = {},
    pass: RuntimeInspectionPass = new RuntimeInspectionPass(),
  ): Promise<LocalAppRuntimeSnapshot> {
    const existingOperation = this.buildOperations.get(localAppId)
    if (existingOperation) {
      if (options.beforeCommit) return Promise.reject(new Error('runtime-build-already-active'))
      return existingOperation
    }
    const definition = this.definitions.get(localAppId)
    if (!definition) return Promise.reject(new Error('local-app-definition-missing'))
    if (definition.trustStatus !== 'trusted') return Promise.reject(new Error('local-app-trust-required'))
    const operation = this.buildWithExecutionLease(definition, consumerId, options, pass).finally(() => {
      if (this.buildOperations.get(localAppId) === operation) this.buildOperations.delete(localAppId)
    })
    this.buildOperations.set(localAppId, operation)
    return operation
  }

  cancelBuild(localAppId: string, buildId?: string): Promise<LocalAppRuntimeSnapshot | null> {
    return this.supervisor.cancelBuild(localAppId, buildId)
  }

  getStaticPreviewRegistry(): StaticPreviewRegistry {
    return this.supervisor.getStaticPreviewRegistry()
  }

  async release(localAppId: string, consumerId: string): Promise<LocalAppRuntimeSnapshot | null> {
    const join = this.sharedRootJoins.get(localAppId)
    if (join) return this.releaseSharedRoot(localAppId, join, consumerId)
    const consumers = this.consumers.get(localAppId)
    if (!consumers?.delete(consumerId)) return this.supervisor.snapshot(localAppId)
    if (consumers.size > 0) return this.supervisor.detachConsumer(localAppId, consumerId)
    let snapshot: LocalAppRuntimeSnapshot | null = this.supervisor.snapshot(localAppId)
    await this.leases.stopAndRelease(localAppId, async () => {
      snapshot = await this.supervisor.detachConsumer(localAppId, consumerId)
    })
    return snapshot
  }

  async stopAll(reason: LocalAppRuntimeSnapshot['stopReason'] = 'app-quit'): Promise<void> {
    const failures: unknown[] = []
    for (const definitionId of this.definitions.keys()) {
      try { await this.stop(definitionId, reason) } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw failures[0]
  }

  /**
   * Spawn-free borrow of a live same-root Runtime. A surface that only wants
   * to show a directory that is already being served calls this instead of
   * `start`: it never launches a process, and returns null when there is
   * nothing to borrow.
   */
  async borrowSharedRoot(localAppId: string, consumerId?: string): Promise<LocalAppRuntimeSnapshot | null> {
    const definition = this.definitions.get(localAppId)
    if (!definition || definition.trustStatus !== 'trusted') return null
    return this.joinSharedRoot(definition, consumerId)
  }

  getRootExecutionRegistry(): RuntimeRootExecutionRegistry {
    return this.rootExecutionRegistry
  }

  /** Static-only edit sessions still hold the root mutex without spawning a dev process. */
  async acquireDevelopmentLease(localAppId: string): Promise<RuntimeRootLease> {
    const definition = this.definitions.get(localAppId)
    if (!definition) throw new Error('local-app-definition-missing')
    return this.leases.acquire(definition, 'development')
  }

  async releaseDevelopmentLease(localAppId: string, expectedLease?: RuntimeRootLease): Promise<void> {
    return this.leases.releaseIfHeld(localAppId, 'development', expectedLease)
  }

  private async buildWithExecutionLease(
    definition: LocalAppDefinition,
    consumerId: string | undefined,
    options: RuntimeBuildOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    const consumers = this.consumers.get(definition.id) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(definition.id, consumers)
    const buildLease = this.leases.held(definition.id)?.kind === 'development'
      ? await this.leases.transitionToBuild(definition.id, () => this.supervisor.stop(definition.id, 'user'))
      : await this.leases.acquire(definition, 'build')
    try {
      return await this.supervisor.build(definition, consumers, options, pass)
    } finally {
      await this.leases.releaseQuietly(definition.id, buildLease)
    }
  }

  /**
   * Borrow the live Runtime that already holds this root's development lease.
   * Returns null when nothing is borrowable, leaving the caller on the normal
   * acquire-and-spawn path (and dropping any stale join first).
   */
  private async joinSharedRoot(definition: LocalAppDefinition, consumerId?: string): Promise<LocalAppRuntimeSnapshot | null> {
    let canonicalRoot = definition.canonicalRoot ?? definition.rootPath
    try {
      canonicalRoot = await canonicalizeLocalAppRoot(canonicalRoot)
    } catch {
      await this.leaveSharedRoot(definition.id)
      return null
    }
    const lease = this.rootExecutionRegistry.getByRoot(canonicalRoot)
    const holderId = lease && lease.kind === 'development' && lease.state === 'active' && lease.runtimeDefinitionId !== definition.id
      ? lease.runtimeDefinitionId
      : undefined
    const holder = holderId ? this.supervisor.snapshot(holderId) : null
    if (!holderId || !holder || !SHAREABLE_ROOT_STATUSES.has(holder.status)) {
      await this.leaveSharedRoot(definition.id)
      return null
    }
    if (this.sharedRootJoins.get(definition.id)?.holderDefinitionId !== holderId) await this.leaveSharedRoot(definition.id)
    const join = this.sharedRootJoins.get(definition.id) ?? this.createSharedRootJoin(definition.id, holderId, holder.runtimeId)
    this.sharedRootJoins.set(definition.id, join)
    // The borrowed consumer is accounted under the holder, so the holder's own
    // release path cannot stop a process this definition is still showing.
    const holderConsumers = this.consumers.get(holderId) ?? new Set<string>()
    if (consumerId) {
      holderConsumers.add(consumerId)
      join.consumerIds.add(consumerId)
    }
    this.consumers.set(holderId, holderConsumers)
    for (const id of holderConsumers) this.supervisor.attachConsumer(holderId, id)
    const snapshot = this.projectSharedSnapshot(definition.id, join, this.supervisor.snapshot(holderId) ?? holder)
    this.deliverEvent(sharedRootSnapshotEvent(snapshot, this.now()))
    return snapshot
  }

  private createSharedRootJoin(definitionId: string, holderDefinitionId: string, holderRuntimeId: string): SharedRootJoin {
    const generation = this.nextProjectedGeneration(definitionId)
    return {
      holderDefinitionId,
      holderRuntimeId,
      runtimeId: sharedRootRuntimeId(definitionId, generation),
      generation,
      consumerIds: new Set<string>(),
    }
  }

  /** Projected generations only ever move forward for a given definition. */
  private nextProjectedGeneration(definitionId: string): number {
    const previous = Math.max(
      this.lastProjectedGeneration.get(definitionId) ?? 0,
      this.supervisor.snapshot(definitionId)?.generation ?? 0,
    )
    const generation = previous + 1
    this.lastProjectedGeneration.set(definitionId, generation)
    return generation
  }

  /** A new holder process must reach the borrower as a new runtime identity. */
  private syncSharedGeneration(definitionId: string, join: SharedRootJoin, holderRuntimeId: string): void {
    if (!holderRuntimeId || join.holderRuntimeId === holderRuntimeId) return
    join.holderRuntimeId = holderRuntimeId
    join.generation = this.nextProjectedGeneration(definitionId)
    join.runtimeId = sharedRootRuntimeId(definitionId, join.generation)
  }

  private projectSharedSnapshot(definitionId: string, join: SharedRootJoin, holder: LocalAppRuntimeSnapshot): LocalAppRuntimeSnapshot {
    this.syncSharedGeneration(definitionId, join, holder.runtimeId)
    return {
      ...holder,
      runtimeDefinitionId: definitionId,
      localAppId: definitionId,
      runtimeId: join.runtimeId,
      generation: join.generation,
      sharedRootRuntime: this.sharedRootRuntimeRef(join),
    }
  }

  private sharedRootRuntimeRef(join: SharedRootJoin): { runtimeDefinitionId: string; name: string } {
    const holder = this.definitions.get(join.holderDefinitionId)
    return { runtimeDefinitionId: join.holderDefinitionId, name: holder?.name.trim() || join.holderDefinitionId }
  }

  private deliverEvent(event: LocalAppRuntimeEvent): void {
    this.externalOnEvent?.(event)
    for (const listener of this.listeners) listener(event)
  }

  /** Every holder event is republished under each borrower's own identity. */
  private deliverSharedRootProjections(event: LocalAppRuntimeEvent): void {
    const holderId = event.runtimeDefinitionId || event.localAppId
    if (!holderId) return
    for (const [definitionId, join] of this.sharedRootJoins) {
      if (join.holderDefinitionId !== holderId) continue
      this.syncSharedGeneration(definitionId, join, event.runtimeId)
      this.deliverEvent({
        ...event,
        runtimeDefinitionId: definitionId,
        localAppId: definitionId,
        runtimeId: join.runtimeId,
        generation: join.generation,
        sharedRootRuntime: this.sharedRootRuntimeRef(join),
      })
    }
  }

  private async leaveSharedRoot(
    definitionId: string,
    reason: LocalAppRuntimeSnapshot['stopReason'] = 'user',
  ): Promise<LocalAppRuntimeSnapshot | null> {
    const join = this.sharedRootJoins.get(definitionId)
    if (!join) return null
    this.sharedRootJoins.delete(definitionId)
    const holder = this.supervisor.snapshot(join.holderDefinitionId)
    for (const consumerId of [...join.consumerIds]) {
      join.consumerIds.delete(consumerId)
      await this.release(join.holderDefinitionId, consumerId).catch(() => undefined)
    }
    const snapshot: LocalAppRuntimeSnapshot = {
      runtimeDefinitionId: definitionId,
      localAppId: definitionId,
      runtimeId: join.runtimeId,
      generation: join.generation,
      status: 'stopped',
      mode: holder?.mode,
      restartAttempt: 0,
      stopReason: reason,
      updatedAt: this.now(),
      logs: [],
    }
    this.deliverEvent(sharedRootSnapshotEvent(snapshot, this.now()))
    return snapshot
  }

  private async releaseSharedRoot(definitionId: string, join: SharedRootJoin, consumerId: string): Promise<LocalAppRuntimeSnapshot | null> {
    if (!join.consumerIds.delete(consumerId)) {
      const current = this.supervisor.snapshot(join.holderDefinitionId)
      return current ? this.projectSharedSnapshot(definitionId, join, current) : null
    }
    const holder = await this.release(join.holderDefinitionId, consumerId)
    if (join.consumerIds.size === 0) return this.leaveSharedRoot(definitionId, 'last-consumer')
    return holder ? this.projectSharedSnapshot(definitionId, join, holder) : null
  }

  /** Restarting a borrowed Runtime restarts the one process every viewer shows. */
  private async restartSharedRoot(definitionId: string, join: SharedRootJoin): Promise<LocalAppRuntimeSnapshot> {
    const holder = await this.restart(join.holderDefinitionId)
    const current = this.sharedRootJoins.get(definitionId)
    return current ? this.projectSharedSnapshot(definitionId, current, holder) : holder
  }
}
