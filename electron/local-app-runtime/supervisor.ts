/**
 * Runtime supervisor. 只有 Main 能调用这里的进程能力；renderer 只能通过
 * named Desktop Seam 传入 Runtime id 和受信定义，不能传 executable/args/env/URL。
 */

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import type {
  LocalAppDefinition,
  LocalAppRuntimeEvent,
  LocalAppRuntimeSnapshot,
  LocalAppRuntimeStatus,
  RuntimeStaticDeclaration,
} from '../../src/components/types'
import {
  findDetectedStaticArtifact,
  fingerprintRuntimeSource,
  fingerprintStaticSource,
  StaticArtifactStore,
  StaticPreviewRegistry,
  staticPreviewUrl,
  type StaticOutputValidation,
  validateStaticOutput,
} from './static'
import {
  RuntimeChildProcess,
  npmExecutable,
  runtimeBridgeExecutable,
  readableFailureReason,
  redactRuntimeLine,
  terminateNextDevLockOwners,
  type RuntimeChildExit,
  type RuntimeChildSpec,
} from './child-process'
import { isRecord, LOCAL_APP_RUNTIME_DEFAULTS, type RuntimeLogEntry } from './defaults'
import { allocateLoopbackPort, normalizeLoopbackUrl, parseLoopbackReadyUrl, probeLoopbackReady, waitWithAbort } from './loopback'
import { createRuntimeLivenessBridgeSource, runtimeDevCommandArgs } from './liveness-bridge'
import { RuntimeInspectionPass, type RuntimeDirectoryFacts } from './inspect'
import { RuntimeSnapshotTransitions } from './snapshot-state'
import { StaticBuildFence } from './static-build'
import {
  backupServerBundle,
  currentServerBuildRecord,
  discardServerBundleBackup,
  readServerBundleId,
  restoreServerBundle,
  serverBundleStale,
  ServerBuildRecordStore,
} from './server-bundle'

/** Narrow seams used by focused tests to pause the build validation phases. */
export type RuntimeStaticOutputValidator = (
  projectRoot: string,
  declaration: RuntimeStaticDeclaration,
  signal: AbortSignal,
) => Promise<StaticOutputValidation>

export type RuntimeStaticSourceFingerprinter = (
  projectRoot: string,
  declaration: RuntimeStaticDeclaration,
  signal: AbortSignal,
) => Promise<string>

export type RuntimeSupervisorOptions = {
  now?: () => number
  spawn?: typeof spawn
  fetch?: typeof globalThis.fetch
  allocatePort?: () => Promise<number>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  defaults?: Partial<typeof LOCAL_APP_RUNTIME_DEFAULTS>
  env?: NodeJS.ProcessEnv
  preparationDigests?: Map<string, string>
  /** Optional durable record under Electron userData. */
  preparationRecordPath?: string
  /** Static artifacts are private to the Main process and userData. */
  staticArtifactStore?: StaticArtifactStore
  staticPreviewRegistry?: StaticPreviewRegistry
  validateStaticOutput?: RuntimeStaticOutputValidator
  fingerprintStaticSource?: RuntimeStaticSourceFingerprinter
  /** Exact project-lock takeover used before starting a development runtime. */
  terminateConflictingDevProcesses?: (canonicalRoot: string) => Promise<number[]>
  userDataPath?: string
  onEvent?: (event: LocalAppRuntimeEvent) => void
}

/**
 * Start policy is kept inside Main so restoring a trusted tab can stay
 * spawn-free while a user-initiated first import may build its static
 * artifact immediately after trust is granted.
 */
export type RuntimeStartOptions = {
  autoBuild?: boolean
}

export type RuntimeBuildOptions = {
  /** Revalidated immediately before the atomic last-good pointer rename. */
  beforeCommit?: () => boolean
}

type ActiveRuntime = {
  definition: LocalAppDefinition
  snapshot: LocalAppRuntimeSnapshot
  child?: RuntimeChildProcess
  buildChild?: RuntimeChildProcess
  buildId?: string
  buildOperationId?: string
  buildController?: AbortController
  buildOperation?: Promise<LocalAppRuntimeSnapshot>
  buildPreSnapshot?: LocalAppRuntimeSnapshot
  operation?: Promise<LocalAppRuntimeSnapshot>
  /** In-flight rebuild of a served bundle (`C-RSM-502`); at most one. */
  serverUpdate?: Promise<LocalAppRuntimeSnapshot>
  controller: AbortController
  logs: RuntimeLogEntry[]
  consumerIds: Set<string>
}

export class LocalAppRuntimeSupervisor {
  private readonly now: () => number
  private readonly state: RuntimeSnapshotTransitions
  private readonly spawnProcess: typeof spawn
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly allocatePortImpl: () => Promise<number>
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly defaults: typeof LOCAL_APP_RUNTIME_DEFAULTS
  private readonly env: NodeJS.ProcessEnv
  private readonly preparationDigests: Map<string, string>
  private readonly preparationRecordPath?: string
  private readonly staticArtifactStore: StaticArtifactStore
  private readonly serverBuildRecords: ServerBuildRecordStore
  /** Source fingerprint an update last failed on; the same source is not retried automatically. */
  private readonly updateFailedFingerprints = new Map<string, string>()
  private readonly staticPreviewRegistry: StaticPreviewRegistry
  private readonly validateStaticOutputImpl: RuntimeStaticOutputValidator
  private readonly fingerprintStaticSourceImpl: RuntimeStaticSourceFingerprinter
  private readonly terminateConflictingDevProcesses: (canonicalRoot: string) => Promise<number[]>
  private preparationRecordLoaded = false
  private preparationRecordLoadPromise: Promise<void> | null = null
  private preparationRecordSavePromise: Promise<void> = Promise.resolve()
  private readonly onEvent?: (event: LocalAppRuntimeEvent) => void
  private readonly runtimes = new Map<string, ActiveRuntime>()
  private readonly generationByApp = new Map<string, number>()
  private readonly buildLocks = new Map<string, Promise<void>>()

  constructor(options: RuntimeSupervisorOptions = {}) {
    this.now = options.now ?? Date.now
    this.state = new RuntimeSnapshotTransitions(this.now)
    this.spawnProcess = options.spawn ?? spawn
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.allocatePortImpl = options.allocatePort ?? allocateLoopbackPort
    this.sleep = options.sleep ?? waitWithAbort
    this.defaults = { ...LOCAL_APP_RUNTIME_DEFAULTS, ...options.defaults, crashRetryDelaysMs: options.defaults?.crashRetryDelaysMs ?? LOCAL_APP_RUNTIME_DEFAULTS.crashRetryDelaysMs }
    this.env = options.env ?? process.env
    this.preparationDigests = options.preparationDigests ?? new Map()
    this.preparationRecordPath = options.preparationRecordPath
    this.staticArtifactStore = options.staticArtifactStore ?? new StaticArtifactStore(options.userDataPath ?? path.join(process.cwd(), '.agentos-runtime-data'), this.now)
    this.serverBuildRecords = new ServerBuildRecordStore(options.userDataPath ? path.join(options.userDataPath, 'local-app-server-builds.json') : undefined)
    this.staticPreviewRegistry = options.staticPreviewRegistry ?? new StaticPreviewRegistry()
    this.validateStaticOutputImpl = options.validateStaticOutput ?? ((projectRoot, declaration) => validateStaticOutput(projectRoot, declaration))
    this.fingerprintStaticSourceImpl = options.fingerprintStaticSource ?? ((projectRoot, declaration) => fingerprintStaticSource(projectRoot, declaration))
    this.terminateConflictingDevProcesses = options.terminateConflictingDevProcesses ?? terminateNextDevLockOwners
    this.onEvent = options.onEvent
  }

  snapshot(localAppId: string): LocalAppRuntimeSnapshot | null {
    return this.runtimes.get(localAppId)?.snapshot ?? null
  }

  attachConsumer(localAppId: string, consumerId: string): void {
    this.runtimes.get(localAppId)?.consumerIds.add(consumerId)
  }

  detachConsumer(localAppId: string, consumerId: string): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return Promise.resolve(null)
    runtime.consumerIds.delete(consumerId)
    if (runtime.consumerIds.size > 0) return Promise.resolve(runtime.snapshot)
    return this.stop(localAppId, 'last-consumer')
  }

  start(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string> = [],
    options: RuntimeStartOptions = {},
    pass: RuntimeInspectionPass = new RuntimeInspectionPass(),
  ): Promise<LocalAppRuntimeSnapshot> {
    const existing = this.runtimes.get(definition.id)
    const requestedConsumers = [...consumerIds]
    if (existing) {
      for (const consumerId of requestedConsumers) existing.consumerIds.add(consumerId)
    }
    // A mode transition may leave the stopped predecessor in the map while
    // its bounded teardown promise is still draining. Reuse that transition
    // instead of starting a second supervisor for the same definition id.
    if (existing?.snapshot.status === 'stopped' && existing.operation) return existing.operation
    if (!definition.mode && !definition.agentos) {
      if (existing?.operation || existing?.buildOperation) return existing.operation ?? existing.buildOperation!
      return this.detectModeAndStart(definition, requestedConsumers, options, pass)
    }
    if (definition.mode === 'static') {
      if (existing && existing.snapshot.mode === 'static' && existing.snapshot.status !== 'stopped') {
        if (existing.operation) return existing.operation
        if (existing.buildOperation) return existing.buildOperation
        return Promise.resolve(existing.snapshot)
      }
      if (existing) return this.transitionRuntime(existing, definition, () => this.startStaticTracked(definition, requestedConsumers, options, pass))
      return this.startStaticTracked(definition, requestedConsumers, options, pass)
    }
    if (existing?.snapshot.mode === 'static' && existing.snapshot.status !== 'stopped') {
      const developmentDefinition = definition.mode === 'development' ? definition : { ...definition, mode: 'development' as const }
      return this.transitionRuntime(existing, developmentDefinition, () => this.start(developmentDefinition, requestedConsumers, options, pass))
    }
    if (existing?.operation) return existing.operation
    if (existing?.snapshot.status === 'running' || existing?.snapshot.status === 'starting' || existing?.snapshot.status === 'preparing') {
      return Promise.resolve(existing.snapshot)
    }
    const runtime = this.createRuntime(definition, requestedConsumers, 'preparing', 'development')
    const operation = this.startRuntime(runtime, pass).finally(() => {
      if (runtime.operation === operation) runtime.operation = undefined
    })
    runtime.operation = operation
    return operation
  }

  private createRuntime(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    status: LocalAppRuntimeStatus,
    mode?: LocalAppRuntimeSnapshot['mode'],
  ): ActiveRuntime {
    const generation = (this.generationByApp.get(definition.id) ?? 0) + 1
    this.generationByApp.set(definition.id, generation)
    const runtime: ActiveRuntime = {
      definition,
      snapshot: this.state.created(definition.id, generation, status, mode),
      controller: new AbortController(),
      logs: [],
      consumerIds: new Set(consumerIds),
    }
    this.runtimes.set(definition.id, runtime)
    return runtime
  }

  private startStaticTracked(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeStartOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    const operation = this.startStatic(definition, consumerIds, options, pass)
    const created = this.runtimes.get(definition.id)
    if (!created) return operation
    const tracked = operation.finally(() => {
      if (created.operation === tracked) created.operation = undefined
    })
    created.operation = tracked
    return tracked
  }

  private transitionRuntime(
    existing: ActiveRuntime,
    definition: LocalAppDefinition,
    starter: () => Promise<LocalAppRuntimeSnapshot>,
  ): Promise<LocalAppRuntimeSnapshot> {
    const previousOperation = existing.operation
    const previousBuildOperation = existing.buildOperation
    let transition!: Promise<LocalAppRuntimeSnapshot>
    transition = (async () => {
      await this.stop(definition.id, 'user')
      await previousOperation?.catch(() => undefined)
      await previousBuildOperation?.catch(() => undefined)
      if (existing.operation === transition) existing.operation = undefined
      return starter()
    })()
    existing.operation = transition
    return transition.finally(() => {
      if (existing.operation === transition) existing.operation = undefined
    })
  }

  private async detectModeAndStart(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeStartOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    const inspection = await pass.inspectDefinition(definition)
    if (inspection.ok && inspection.mode === 'static') {
      return this.start({ ...definition, mode: 'static', agentos: inspection.agentos }, consumerIds, options, pass)
    }
    if (!inspection.ok && inspection.code === 'static-declaration-invalid') {
      // A legacy persisted definition may encounter a newly declared but
      // malformed `agentos` block. It must surface the strict parse failure;
      // silently falling back to npm run dev would bypass the static contract.
      return this.start({ ...definition, mode: 'static', agentos: undefined }, consumerIds, options, pass)
    }
    // Legacy definitions remain server-backed runtimes. Setting the explicit
    // mode avoids another inspection pass; the plan decides whether that means
    // the production server or the dev server.
    const serveScript = inspection.ok && inspection.servePlan.kind === 'production' ? 'start' as const : 'dev' as const
    return this.start({ ...definition, mode: 'development', serveScript }, consumerIds, options, pass)
  }

  /** Static restore is spawn-free unless this is the trusted first import. */
  private async startStatic(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeStartOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    const runtime = this.createRuntime(definition, consumerIds, 'build_required')
    const generation = runtime.snapshot.generation
    runtime.snapshot = this.state.staticInspecting(runtime.snapshot)
    const isActive = () => this.runtimes.get(definition.id) === runtime && !runtime.controller.signal.aborted
    const inspection = await pass.inspectDefinition(definition)
    if (!isActive()) return runtime.snapshot
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    if (inspection.mode !== 'static') return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    // A detected `buildable` directory has no output root until its first
    // build; serving still works from a previously committed artifact.
    const declaration = inspection.agentos ?? null
    if (!declaration && inspection.servePlan.kind !== 'buildable') {
      return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    }
    if (definition.trustStatus !== 'trusted') return this.fail(runtime, 'trust-required', '目录尚未获得信任', 'inspect')
    const artifact = await this.staticArtifactStore.loadLastGood(definition.id, inspection.canonicalRoot)
    if (!isActive()) return runtime.snapshot
    let current = artifact
    if (!current && declaration) {
      // `C-RSM-402` tier ①: an output directory that already exists on disk is
      // adopted as the artifact. Viewing must not require a build.
      try {
        await validateStaticOutput(inspection.canonicalRoot, declaration)
        if (!isActive()) return runtime.snapshot
        const fingerprint = await fingerprintStaticSource(inspection.canonicalRoot, declaration)
        if (!isActive()) return runtime.snapshot
        current = await this.staticArtifactStore.commit(
          definition.id,
          inspection.canonicalRoot,
          declaration,
          path.resolve(inspection.canonicalRoot, ...declaration.outputRoot.split('/')),
          fingerprint,
          runtime.controller.signal,
        )
      } catch {
        // An empty output cache is a normal first-run state. The renderer
        // exposes an explicit build action instead of starting a dev server.
        current = null
      }
    }
    if (!isActive()) return runtime.snapshot
    if (!current) {
      if (options.autoBuild !== false) {
        // Reuse the regular build queue and operation identity. This keeps
        // first import subject to the same cancellation, atomic pointer and
        // late-event guards as an explicit rebuild.
        return this.build(definition, consumerIds, {}, pass)
      }
      runtime.snapshot = this.state.buildRequired(runtime.snapshot)
      this.emit(runtime, 'status')
      return runtime.snapshot
    }
    if (!isActive()) return runtime.snapshot
    const token = this.staticPreviewRegistry.register(runtime.snapshot.runtimeId, generation, current)
    runtime.snapshot = this.state.staticReady(runtime.snapshot, {
      artifactId: current.artifactId,
      lastBuildAt: current.lastBuildAt,
      previewUrl: staticPreviewUrl(token),
    })
    this.emit(runtime, 'ready')
    // Stale detection must never delay the first paint, and it needs a known
    // output root; a just-built detected artifact is fresh by construction.
    if (declaration) void this.checkStaticStale(runtime, inspection.canonicalRoot, declaration, current)
    return runtime.snapshot
  }

  async stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return null
    runtime.controller.abort()
    runtime.buildController?.abort()
    if (runtime.snapshot.mode === 'static') this.staticPreviewRegistry.revokeRuntime(runtime.snapshot.runtimeId, runtime.snapshot.generation)
    const child = runtime.child
    const buildChild = runtime.buildChild
    runtime.snapshot = this.state.stopped(runtime.snapshot, { reason, logs: this.recentLogs(runtime) })
    this.emit(runtime, 'status')
    if (child) await child.terminate()
    if (buildChild) await buildChild.terminate()
    runtime.child = undefined
    runtime.buildChild = undefined
    runtime.operation = undefined
    runtime.buildOperation = undefined
    runtime.buildId = undefined
    runtime.buildOperationId = undefined
    runtime.buildController = undefined
    runtime.buildPreSnapshot = undefined
    // An interrupted server update restores its `.next` backup before the
    // stop is complete, so quitting never leaves a half-built bundle behind.
    await runtime.serverUpdate?.catch(() => undefined)
    return runtime.snapshot
  }

  async restart(definition: LocalAppDefinition, consumerIds?: Iterable<string>): Promise<LocalAppRuntimeSnapshot> {
    const preservedConsumers = consumerIds ?? this.runtimes.get(definition.id)?.consumerIds ?? []
    await this.stop(definition.id, 'user')
    return this.start(definition, preservedConsumers)
  }

  getStaticPreviewRegistry(): StaticPreviewRegistry {
    return this.staticPreviewRegistry
  }

  async build(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string> = [],
    options: RuntimeBuildOptions = {},
    pass: RuntimeInspectionPass = new RuntimeInspectionPass(),
  ): Promise<LocalAppRuntimeSnapshot> {
    const previous = this.buildLocks.get(definition.id) ?? Promise.resolve()
    const operation = previous.then(() => this.buildOnce(definition, consumerIds, options, pass))
    this.buildLocks.set(definition.id, operation.then(() => undefined, () => undefined))
    return operation
  }

  private async buildOnce(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeBuildOptions,
    pass: RuntimeInspectionPass,
  ): Promise<LocalAppRuntimeSnapshot> {
    if (!definition.mode) {
      const detected = await pass.inspectDefinition(definition)
      if (detected.ok && detected.mode === 'static') {
        return this.buildOnce({ ...definition, mode: 'static', agentos: detected.agentos }, consumerIds, options, pass)
      }
    }
    if (definition.mode !== 'static') {
      const existing = this.runtimes.get(definition.id)
      return existing?.snapshot ?? this.state.created(definition.id, 0, 'failed')
    }
    let runtime = this.runtimes.get(definition.id)
    if (!runtime || runtime.snapshot.status === 'stopped') {
      await this.start(definition, consumerIds, { autoBuild: false }, pass)
      runtime = this.runtimes.get(definition.id)
    }
    if (!runtime) throw new Error('static-runtime-missing')
    for (const consumerId of consumerIds) runtime.consumerIds.add(consumerId)
    if (runtime.buildOperation) return runtime.buildOperation
    const inspection = await pass.inspectDefinition(definition)
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    if (inspection.mode !== 'static') return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    if (!inspection.agentos && inspection.servePlan.kind !== 'buildable') {
      return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    }
    const buildId = `build-${this.now().toString(36)}-${randomBytes(6).toString('hex')}`
    const operationId = `op-${this.now().toString(36)}-${randomBytes(6).toString('hex')}`
    const buildController = new AbortController()
    runtime.buildPreSnapshot = { ...runtime.snapshot }
    runtime.buildId = buildId
    runtime.buildOperationId = operationId
    runtime.buildController = buildController
    runtime.snapshot = this.state.building(runtime.snapshot, { buildId, operationId })
    this.emit(runtime, 'status')
    const operation = this.runStaticBuild(runtime, inspection.canonicalRoot, inspection.agentos ?? null, buildId, operationId, buildController.signal, options)
      .finally(() => {
        if (runtime?.buildOperation === operation) {
          runtime.buildOperation = undefined
          runtime.buildChild = undefined
          runtime.buildController = undefined
          runtime.buildId = undefined
          runtime.buildOperationId = undefined
          runtime.buildPreSnapshot = undefined
          runtime.snapshot = this.state.buildIdentityCleared(runtime.snapshot)
        }
      })
      .then(() => runtime.snapshot)
    runtime.buildOperation = operation
    return operation
  }

  async cancelBuild(localAppId: string, buildId?: string): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime || !runtime.buildOperation) return runtime?.snapshot ?? null
    if (buildId && runtime.buildId !== buildId) return runtime.snapshot
    runtime.buildController?.abort()
    if (runtime.buildChild) await runtime.buildChild.terminate()
    return runtime.buildOperation.catch(() => runtime.snapshot)
  }

  private async runStaticBuild(
    runtime: ActiveRuntime,
    canonicalRoot: string,
    declared: RuntimeStaticDeclaration | null,
    buildId: string,
    operationId: string,
    signal: AbortSignal,
    options: RuntimeBuildOptions,
  ): Promise<LocalAppRuntimeSnapshot> {
    const fence = new StaticBuildFence({
      signal,
      ownsOperation: () => runtime.buildId === buildId && runtime.buildOperationId === operationId,
      onCancelled: () => {
        runtime.snapshot = this.state.restoredAfterCancel(
          runtime.snapshot,
          runtime.buildPreSnapshot ?? runtime.snapshot,
          this.recentLogs(runtime),
        )
        this.emit(runtime, 'status', { buildId, operationId })
      },
    })
    let child: RuntimeChildProcess
    try {
      child = this.spawnChild(runtime, {
        executable: npmExecutable(),
        args: ['run', 'build'],
        cwd: canonicalRoot,
        env: { NODE_ENV: 'production' },
      })
    } catch (error) {
      runtime.snapshot = this.state.buildFailed(runtime.snapshot, {
        errorCode: 'build-spawn-failed',
        detail: error instanceof Error ? error.message : '静态构建进程无法启动',
      })
      this.emit(runtime, 'status', { buildId, operationId })
      return runtime.snapshot
    }
    runtime.buildChild = child
    const exited = await fence.step(() => child.awaitExit({ signal }))
    if (!exited.ok) return runtime.snapshot
    const exit = exited.value
    if (exit.error || exit.code !== 0) {
      runtime.snapshot = this.state.buildFailed(runtime.snapshot, {
        errorCode: signal.aborted ? 'build-cancelled' : 'build-failed',
        detail: signal.aborted ? '静态构建已取消' : `静态构建失败 (${exit.error?.message ?? exit.code ?? exit.signal ?? 'unknown'})`,
        logs: this.recentLogs(runtime),
      })
      this.emit(runtime, 'exit', { detail: runtime.snapshot.detail, code: exit.code, signal: exit.signal ?? undefined })
      return runtime.snapshot
    }
    // `C-RSM-402` tier ②: without a declared output root, the build itself is
    // what reveals it. Detection runs once, after a successful build.
    let declaration = declared
    if (!declaration) {
      const detected = await fence.step(() => findDetectedStaticArtifact(canonicalRoot), { honorAbort: false })
      if (!detected.ok) return runtime.snapshot
      declaration = detected.value
      if (!declaration) {
        // Tier ③ → ②: the build produced a server bundle instead. Record the
        // source it was built from so later checks can tell it is current.
        await this.recordServerBuild(runtime.definition.id, canonicalRoot)
        runtime.snapshot = this.state.buildFailed(runtime.snapshot, {
          errorCode: 'build-produces-no-artifact',
          detail: '构建没有产出可直接打开的静态页面',
          logs: this.recentLogs(runtime),
        })
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
    }
    const committing = declaration
    try {
      if (!(await fence.step(() => this.validateStaticOutputImpl(canonicalRoot, committing, signal))).ok) return runtime.snapshot
      const outputRoot = path.resolve(canonicalRoot, ...committing.outputRoot.split('/'))
      const fingerprinted = await fence.step(() => this.fingerprintStaticSourceImpl(canonicalRoot, committing, signal))
      if (!fingerprinted.ok) return runtime.snapshot
      // `commit` returns only after the last-good pointer rename. That rename
      // is the non-cancellable persistence boundary: an abort in this narrow
      // window must publish the committed artifact, never roll memory back to
      // the previous pointer.
      const committed = await fence.step(
        () => this.staticArtifactStore.commit(runtime.definition.id, canonicalRoot, committing, outputRoot, fingerprinted.value, signal, options.beforeCommit),
        { honorAbort: false },
      )
      if (!committed.ok) return runtime.snapshot
      const artifact = committed.value
      // A successful commit is the generation boundary for Preview sessions;
      // revoke the previous token only after the new artifact is atomically
      // staged, so a failed/cancelled build still keeps the last-good session.
      this.staticPreviewRegistry.revokeRuntime(runtime.snapshot.runtimeId, runtime.snapshot.generation)
      const token = this.staticPreviewRegistry.register(runtime.snapshot.runtimeId, runtime.snapshot.generation, artifact)
      runtime.snapshot = this.state.staticReady(runtime.snapshot, {
        artifactId: artifact.artifactId,
        lastBuildAt: artifact.lastBuildAt,
        previewUrl: staticPreviewUrl(token),
        logs: this.recentLogs(runtime),
      })
      this.emit(runtime, 'ready', { buildId, operationId })
      return runtime.snapshot
    } catch (error) {
      if (fence.failure(error) !== 'failed') return runtime.snapshot
      runtime.snapshot = this.state.buildFailed(runtime.snapshot, {
        errorCode: 'static-output-invalid',
        detail: error instanceof Error ? error.message : '静态产物校验失败',
        logs: this.recentLogs(runtime),
      })
      this.emit(runtime, 'status', { buildId, operationId })
      return runtime.snapshot
    }
  }

  private async checkStaticStale(
    runtime: ActiveRuntime,
    canonicalRoot: string,
    declaration: RuntimeStaticDeclaration,
    artifact: { artifactId: string; sourceFingerprint?: string },
  ): Promise<void> {
    try {
      const fingerprint = await fingerprintStaticSource(canonicalRoot, declaration)
      if (this.runtimes.get(runtime.definition.id) !== runtime || runtime.controller.signal.aborted || runtime.snapshot.mode !== 'static' || runtime.snapshot.artifactId !== artifact.artifactId || runtime.snapshot.status === 'building' || runtime.snapshot.status === 'stopped') return
      if (artifact.sourceFingerprint && artifact.sourceFingerprint === fingerprint) return
      runtime.snapshot = this.state.staleArtifact(runtime.snapshot)
      this.emit(runtime, 'status')
    } catch {
      // Stale checking is advisory and must never make an otherwise usable
      // last-good artifact unavailable.
    }
  }

  /**
   * Whether the source changed since the artifact or bundle being shown was
   * built (`C-RSM-502`). Development runtimes never report stale: dev reloads
   * itself. A source that an update already failed on is not reported again
   * until it changes.
   */
  async sourceFreshness(localAppId: string): Promise<{ stale: boolean; fingerprint?: string }> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return { stale: false }
    try {
      const inspected = await new RuntimeInspectionPass().inspectDefinition(runtime.definition)
      if (!inspected.ok) return { stale: false }
      const root = inspected.canonicalRoot
      const failed = this.updateFailedFingerprints.get(localAppId)
      if (runtime.snapshot.mode === 'static') {
        if (!inspected.agentos || !runtime.snapshot.artifactId) return { stale: false }
        const artifact = await this.staticArtifactStore.loadLastGood(localAppId, root)
        if (!artifact?.sourceFingerprint) return { stale: false }
        const fingerprint = await fingerprintStaticSource(root, inspected.agentos)
        return { stale: fingerprint !== artifact.sourceFingerprint && fingerprint !== failed, fingerprint }
      }
      if (runtime.definition.serveScript !== 'start') return { stale: false }
      if (!await serverBundleStale(root, await this.serverBuildRecords.get(localAppId))) return { stale: false }
      const fingerprint = await fingerprintRuntimeSource(root)
      return { stale: fingerprint !== failed, fingerprint }
    } catch {
      // Freshness is advisory; an unreadable tree must not break viewing.
      return { stale: false }
    }
  }

  /** Remember (or clear) the source an automatic update failed on. */
  noteUpdateOutcome(localAppId: string, succeeded: boolean, fingerprint?: string): void {
    if (succeeded || !fingerprint) this.updateFailedFingerprints.delete(localAppId)
    else this.updateFailedFingerprints.set(localAppId, fingerprint)
  }

  /**
   * Rebuild a served bundle in place (`C-RSM-502`, design.md Revision 5 §4):
   * stop the server quietly, back up `.next`, build, then serve the new
   * bundle — or restore the backup and serve the previous one. The rendered
   * page stays up while building because the status remains `running`.
   */
  updateServer(localAppId: string): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return Promise.resolve(null)
    if (runtime.serverUpdate) return runtime.serverUpdate
    if (runtime.definition.serveScript !== 'start' || runtime.snapshot.status !== 'running') return Promise.resolve(runtime.snapshot)
    const operation = this.runServerUpdate(runtime).finally(() => {
      if (runtime.serverUpdate === operation) runtime.serverUpdate = undefined
    })
    runtime.serverUpdate = operation
    return operation
  }

  private async runServerUpdate(runtime: ActiveRuntime): Promise<LocalAppRuntimeSnapshot> {
    const inspected = await new RuntimeInspectionPass().inspectDefinition(runtime.definition)
    if (!inspected.ok) return runtime.snapshot
    const root = inspected.canonicalRoot
    const isActive = () => this.runtimes.get(runtime.definition.id) === runtime && !runtime.controller.signal.aborted
    runtime.snapshot = this.state.serverUpdating(runtime.snapshot)
    this.emit(runtime, 'status')
    // Detach before terminating so the exit is not treated as a crash.
    const server = runtime.child
    runtime.child = undefined
    if (server) await server.terminate()
    const backup = await backupServerBundle(root)
    let succeeded = false
    let failure = '构建失败'
    try {
      const build = this.spawnChild(runtime, { executable: npmExecutable(), args: ['run', 'build'], cwd: root, env: { NODE_ENV: 'production' } })
      runtime.buildChild = build
      const exit = await build.awaitExit({ signal: runtime.controller.signal })
      if (runtime.buildChild === build) runtime.buildChild = undefined
      succeeded = !exit.error && exit.code === 0 && Boolean(await readServerBundleId(root))
      if (!succeeded) failure = exit.error?.message ?? this.latestReadableReason(runtime) ?? `构建失败 (${exit.code ?? exit.signal ?? 'unknown'})`
    } catch (error) {
      failure = error instanceof Error ? error.message : failure
    }
    if (!isActive()) {
      await restoreServerBundle(root, backup).catch(() => undefined)
      return runtime.snapshot
    }
    if (succeeded) {
      await discardServerBundleBackup(backup).catch(() => undefined)
      await this.recordServerBuild(runtime.definition.id, root)
    } else {
      await restoreServerBundle(root, backup).catch(() => undefined)
    }
    const served = await this.startRuntime(runtime, new RuntimeInspectionPass())
    if (!isActive()) return runtime.snapshot
    if (served.status !== 'running') {
      // Neither bundle would serve: this is now a start failure, not an update.
      runtime.snapshot = { ...runtime.snapshot, buildStatus: 'ready' }
      this.emit(runtime, 'status')
      return runtime.snapshot
    }
    runtime.snapshot = succeeded ? this.state.serverUpdated(runtime.snapshot) : this.state.serverUpdateFailed(runtime.snapshot, failure)
    this.emit(runtime, 'status')
    return runtime.snapshot
  }

  private async recordServerBuild(definitionId: string, canonicalRoot: string): Promise<void> {
    try {
      const record = await currentServerBuildRecord(canonicalRoot, this.now())
      if (record) await this.serverBuildRecords.set(definitionId, record)
    } catch {
      // Without a record the mtime rule still applies; never fail the build over it.
    }
  }

  async stopAll(reason: LocalAppRuntimeSnapshot['stopReason'] = 'app-quit', timeoutMs = this.defaults.quitCleanupTimeoutMs): Promise<void> {
    const work = Promise.all([...this.runtimes.keys()].map((id) => this.stop(id, reason))).then(() => undefined)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, timeoutMs)
        }),
      ])
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    }
  }

  /** Every Runtime child goes through the same supervised shape. */
  private spawnChild(runtime: ActiveRuntime, spec: Omit<RuntimeChildSpec, 'onLine'>): RuntimeChildProcess {
    return RuntimeChildProcess.run(
      { ...spec, onLine: (stream, chunk) => this.captureLog(runtime, stream, chunk) },
      {
        spawn: this.spawnProcess,
        hostEnv: this.env,
        termTimeoutMs: this.defaults.termTimeoutMs,
        killTimeoutMs: this.defaults.killTimeoutMs,
      },
    )
  }

  private async startRuntime(runtime: ActiveRuntime, pass: RuntimeInspectionPass): Promise<LocalAppRuntimeSnapshot> {
    const { definition } = runtime
    await this.loadPreparationRecord()
    const inspected = await pass.inspectDefinition(definition)
    if (!inspected.ok) return this.fail(runtime, inspected.code, inspected.message, 'inspect')
    if (definition.trustStatus !== 'trusted') return this.fail(runtime, 'trust-required', '目录尚未获得信任', 'inspect')

    try {
      await this.prepareDependencies(runtime, inspected)
      if (runtime.controller.signal.aborted) return runtime.snapshot
      const terminatedPids = await this.terminateConflictingDevProcesses(inspected.canonicalRoot)
      if (runtime.controller.signal.aborted) return runtime.snapshot
      if (terminatedPids.length > 0) {
        this.captureLog(runtime, 'stdout', `已接管开发模式：停止旧开发进程 ${terminatedPids.join(', ')}`)
      }
      runtime.snapshot = this.state.starting(runtime.snapshot, this.recentLogs(runtime))
      this.emit(runtime, 'status')
      let lastError = 'readiness_timeout'
      let lastDetail: string | undefined
      for (let attempt = 0; attempt < this.defaults.maxPortAttempts; attempt += 1) {
        if (runtime.controller.signal.aborted) return runtime.snapshot
        const port = await this.allocatePortImpl()
        if (runtime.controller.signal.aborted) return runtime.snapshot
        for (let crashAttempt = 0; crashAttempt <= this.defaults.crashRetryCount; crashAttempt += 1) {
          if (runtime.controller.signal.aborted) return runtime.snapshot
          runtime.snapshot = this.state.attempt(runtime.snapshot, port)
          const child = this.spawnNpm(runtime, inspected.canonicalRoot, port)
          runtime.child = child
          const ready = await this.waitForReadiness(runtime, child, port)
          if (ready) {
            runtime.snapshot = this.state.running(runtime.snapshot, { readyUrl: ready, port, logs: this.recentLogs(runtime) })
            this.emit(runtime, 'ready')
            return runtime.snapshot
          }
          lastError = runtime.snapshot.errorCode ?? lastError
          lastDetail = runtime.snapshot.detail ?? lastDetail
          await child.terminate()
          runtime.child = undefined
          if (lastError !== 'process-exited' || crashAttempt >= this.defaults.crashRetryCount) break
          const delay = this.defaults.crashRetryDelaysMs[Math.min(crashAttempt, this.defaults.crashRetryDelaysMs.length - 1)] ?? 0
          await this.sleep(delay, runtime.controller.signal).catch(() => undefined)
        }
      }
      if (lastError === 'process-exited') {
        return this.fail(runtime, lastError, lastDetail ?? this.latestReadableReason(runtime) ?? '开发服务进程提前退出', 'start')
      }
      return this.fail(runtime, lastError, '开发服务未在 loopback 地址就绪', 'readiness')
    } catch (error) {
      if (runtime.controller.signal.aborted) return runtime.snapshot
      return this.fail(runtime, 'runtime-error', error instanceof Error ? error.message : '运行时启动失败', runtime.snapshot.phase ?? 'start')
    }
  }

  private async prepareDependencies(runtime: ActiveRuntime, inspected: RuntimeDirectoryFacts): Promise<void> {
    const lockKey = inspected.canonicalRoot
    const nodeModules = inspected.nodeModulesPresent
    const knownLockDigest = this.preparationDigests.get(lockKey)
    const needsPrepare = inspected.hasLockfile
      // 缺少持久 preparation record 时保守重跑 npm ci，即使 node_modules
      // 仍在磁盘上，也不能把未知依赖状态当成已验证状态。
      ? !nodeModules || knownLockDigest === undefined || knownLockDigest !== inspected.lockDigest
      : !nodeModules
    if (!needsPrepare) return
    runtime.snapshot = this.state.preparing(runtime.snapshot)
    this.emit(runtime, 'status')
    const port = await this.allocatePortImpl()
    if (runtime.controller.signal.aborted) return
    const child = this.spawnChild(runtime, {
      executable: npmExecutable(),
      args: inspected.hasLockfile ? ['ci'] : ['install'],
      cwd: inspected.canonicalRoot,
      env: { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
    })
    runtime.child = child
    let exit: RuntimeChildExit
    try {
      exit = await child.awaitExit({ timeoutMs: this.defaults.prepareTimeoutMs })
    } finally {
      if (runtime.child === child) runtime.child = undefined
    }
    if (exit.timedOut) throw new Error('dependency preparation timeout')
    if (exit.error) throw exit.error
    if (runtime.controller.signal.aborted) return
    if (exit.code !== 0) throw new Error(`dependency preparation exited ${exit.code ?? exit.signal ?? 'unknown'}`)
    if (inspected.hasLockfile && inspected.lockDigest) {
      this.preparationDigests.set(lockKey, inspected.lockDigest)
      await this.savePreparationRecord()
    }
  }

  private async loadPreparationRecord(): Promise<void> {
    if (this.preparationRecordLoaded) return this.preparationRecordLoadPromise ?? Promise.resolve()
    this.preparationRecordLoaded = true
    this.preparationRecordLoadPromise = (async () => {
      if (!this.preparationRecordPath) return
      try {
        const parsed = JSON.parse(await readFile(this.preparationRecordPath, 'utf8')) as unknown
        if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) return
        for (const [key, value] of Object.entries(parsed.entries)) {
          if (typeof key !== 'string' || !isRecord(value) || typeof value.lockDigest !== 'string') continue
          this.preparationDigests.set(key, value.lockDigest)
        }
      } catch {
        // First run, an interrupted write, or a malformed record is treated as
        // an empty cache. The next successful npm ci repairs it atomically.
      }
    })()
    return this.preparationRecordLoadPromise
  }

  private async savePreparationRecord(): Promise<void> {
    if (!this.preparationRecordPath) return
    this.preparationRecordSavePromise = this.preparationRecordSavePromise.catch(() => undefined).then(async () => {
      const entries: Record<string, { canonicalRoot: string; lockDigest: string; savedAt: number }> = {}
      for (const [canonicalRoot, lockDigest] of this.preparationDigests.entries()) {
        if (!lockDigest) continue
        entries[canonicalRoot] = { canonicalRoot, lockDigest, savedAt: this.now() }
      }
      const record = JSON.stringify({ version: 1, entries })
      const temporaryPath = `${this.preparationRecordPath}.tmp-${process.pid}-${Date.now().toString(36)}`
      await mkdir(path.dirname(this.preparationRecordPath!), { recursive: true })
      try {
        await writeFile(temporaryPath, `${record}\n`, 'utf8')
        await rename(temporaryPath, this.preparationRecordPath!)
      } finally {
        await unlink(temporaryPath).catch(() => undefined)
      }
    })
    return this.preparationRecordSavePromise
  }

  private spawnNpm(runtime: ActiveRuntime, cwd: string, port: number): RuntimeChildProcess {
    // `C-RSM-402` tier ②/④: the same supervised bridge runs either the
    // production server or the dev server. Only the fixed script and NODE_ENV
    // differ, and the dev-only Turbopack retry never applies to `start`.
    const production = runtime.definition.serveScript === 'start'
    const npmArgs = production ? ['run', 'start'] : runtimeDevCommandArgs(runtime.logs)
    const child = this.spawnChild(runtime, {
      executable: runtimeBridgeExecutable(),
      args: ['-e', createRuntimeLivenessBridgeSource(this.defaults.termTimeoutMs, this.defaults.killTimeoutMs, npmArgs)],
      cwd,
      env: { PORT: String(port), HOST: '127.0.0.1', NODE_ENV: production ? 'production' : 'development' },
      ipc: true,
    })
    runtime.snapshot = this.state.spawned(runtime.snapshot, port)
    child.onceError((error) => {
      if (runtime.child !== child || runtime.controller.signal.aborted) return
      const detail = `开发服务桥接器错误 (${error instanceof Error ? error.message : String(error)})`
      runtime.snapshot = this.state.processExited(runtime.snapshot, detail)
      this.emit(runtime, 'exit', { detail })
    })
    child.onceExit((code, signal) => {
      if (runtime.child !== child || runtime.controller.signal.aborted) return
      runtime.child = undefined
      const exitDetail = `${runtime.definition.serveScript === 'start' ? '页面服务' : '开发服务'}退出 (${code ?? signal ?? 'unknown'})${this.latestReadableReason(runtime) ? `：${this.latestReadableReason(runtime)}` : ''}`
      runtime.snapshot = this.state.processExited(runtime.snapshot, exitDetail)
      this.emit(runtime, 'exit', { code, signal: signal ?? undefined, detail: exitDetail })
      if (runtime.snapshot.status !== 'running') return
      // A server that was already ready can still crash later. Reuse the
      // current generation while applying the same bounded retry policy;
      // stop/restart aborts this operation and prevents an automatic relaunch.
      if (runtime.operation) return
      const recovery = this.recoverAfterCrash(runtime)
      const operation = recovery.finally(() => {
        if (runtime.operation === operation) runtime.operation = undefined
      })
      runtime.operation = operation
    })
    return child
  }

  private async recoverAfterCrash(runtime: ActiveRuntime): Promise<LocalAppRuntimeSnapshot> {
    const { definition } = runtime
    // A crash recovery is a new operation: it must see the directory as it is
    // now, not as the start that spawned the dead process saw it.
    const inspected = await new RuntimeInspectionPass().inspectDefinition(definition)
    if (!inspected.ok) return this.fail(runtime, inspected.code, inspected.message, 'inspect')
    for (let attempt = 0; attempt < this.defaults.crashRetryCount; attempt += 1) {
      if (runtime.controller.signal.aborted) return runtime.snapshot
      runtime.snapshot = this.state.restarting(runtime.snapshot, attempt + 1)
      this.emit(runtime, 'status')
      const port = await this.allocatePortImpl()
      if (runtime.controller.signal.aborted) return runtime.snapshot
      const child = this.spawnNpm(runtime, inspected.canonicalRoot, port)
      runtime.child = child
      const ready = await this.waitForReadiness(runtime, child, port)
      if (ready) {
        runtime.snapshot = this.state.running(runtime.snapshot, { readyUrl: ready, port, logs: this.recentLogs(runtime) })
        this.emit(runtime, 'ready')
        return runtime.snapshot
      }
      await child.terminate()
      if (runtime.child === child) runtime.child = undefined
      if (runtime.snapshot.errorCode !== 'process-exited') break
      if (attempt + 1 >= this.defaults.crashRetryCount) break
      const delay = this.defaults.crashRetryDelaysMs[Math.min(attempt, this.defaults.crashRetryDelaysMs.length - 1)] ?? 0
      await this.sleep(delay, runtime.controller.signal).catch(() => undefined)
    }
    const errorCode = runtime.snapshot.errorCode ?? 'process-exited'
    const detail = errorCode === 'process-exited'
      ? runtime.snapshot.detail ?? this.latestReadableReason(runtime) ?? '开发服务崩溃后重试失败'
      : '开发服务崩溃后重试失败'
    return this.fail(runtime, errorCode, detail, errorCode === 'process-exited' ? 'start' : 'readiness')
  }

  private captureLog(runtime: ActiveRuntime, stream: 'stdout' | 'stderr', chunk: string): void {
    for (const line of String(chunk).split(/\r?\n/)) {
      const redacted = redactRuntimeLine(line, this.defaults.logLineLimit)
      if (!redacted) continue
      runtime.logs.push({ stream, line: redacted, timestamp: this.now() })
      while (runtime.logs.length > this.defaults.logBufferLines) runtime.logs.shift()
      const readyUrl = parseLoopbackReadyUrl(redacted)
      if (readyUrl) runtime.snapshot = this.state.readyUrlObserved(runtime.snapshot, readyUrl)
      this.emit(runtime, 'log', { stream, line: redacted })
    }
  }

  private async waitForReadiness(runtime: ActiveRuntime, child: RuntimeChildProcess, port: number): Promise<string | null> {
    const deadline = this.now() + this.defaults.readinessTimeoutMs
    let candidate: string | null = null
    while (this.now() < deadline && !runtime.controller.signal.aborted) {
      const { exitCode, signalCode } = child.process
      const processExited = (exitCode !== undefined && exitCode !== null) || (signalCode !== undefined && signalCode !== null)
      if (runtime.snapshot.errorCode === 'process-exited' || processExited) {
        const detail = runtime.snapshot.detail
          ?? `进程提前退出 (${exitCode ?? signalCode ?? 'unknown'})${this.latestReadableReason(runtime) ? `：${this.latestReadableReason(runtime)}` : ''}`
        runtime.snapshot = this.state.processExited(runtime.snapshot, detail)
        return null
      }
      candidate = runtime.snapshot.readyUrl ?? candidate
      if (!candidate) {
        candidate = normalizeLoopbackUrl(`http://127.0.0.1:${port}/`)
      }
      if (candidate && await probeLoopbackReady(candidate, { fetch: this.fetchImpl, timeoutMs: this.defaults.probeTimeoutMs, signal: runtime.controller.signal })) return candidate
      await this.sleep(this.defaults.probeIntervalMs, runtime.controller.signal).catch(() => undefined)
    }
    runtime.snapshot = this.state.readinessTimedOut(runtime.snapshot)
    return null
  }

  private fail(runtime: ActiveRuntime, errorCode: string, detail: string, phase: LocalAppRuntimeSnapshot['phase']): LocalAppRuntimeSnapshot {
    runtime.snapshot = this.state.failed(runtime.snapshot, { errorCode, detail, phase, logs: this.recentLogs(runtime) })
    this.emit(runtime, 'status')
    return runtime.snapshot
  }

  private recentLogs(runtime: ActiveRuntime): string[] {
    return runtime.logs.slice(-this.defaults.logBufferLines).map((entry) => `[${entry.stream}] ${entry.line}`)
  }

  private latestReadableReason(runtime: ActiveRuntime): string | undefined {
    return readableFailureReason(runtime.logs)
  }

  private emit(runtime: ActiveRuntime, type: LocalAppRuntimeEvent['type'], detail: Partial<LocalAppRuntimeEvent> = {}): void {
    this.onEvent?.({
      type,
      localAppId: runtime.snapshot.localAppId,
      runtimeId: runtime.snapshot.runtimeId,
      generation: runtime.snapshot.generation,
      status: runtime.snapshot.status,
      mode: runtime.snapshot.mode,
      buildStatus: runtime.snapshot.buildStatus,
      artifactId: runtime.snapshot.artifactId,
      buildId: runtime.snapshot.buildId,
      operationId: runtime.snapshot.operationId,
      stale: runtime.snapshot.stale,
      lastBuildAt: runtime.snapshot.lastBuildAt,
      previewUrl: runtime.snapshot.previewUrl,
      readyUrl: runtime.snapshot.readyUrl,
      port: runtime.snapshot.port,
      phase: runtime.snapshot.phase,
      errorCode: runtime.snapshot.errorCode,
      detail: runtime.snapshot.detail,
      timestamp: this.now(),
      ...detail,
      runtimeDefinitionId: runtime.snapshot.runtimeDefinitionId ?? runtime.snapshot.localAppId ?? '',
    })
  }
}
