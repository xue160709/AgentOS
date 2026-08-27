/**
 * Local App runtime supervisor. 只有 Main 能调用这里的进程能力；renderer 只能通过
 * named Desktop Seam 传入 Local App id 和受信定义，不能传 executable/args/env/URL。
 */

import { createHash, randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, realpath, stat, rename, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import type {
  LocalAppDefinition,
  LocalAppRuntimeEvent,
  LocalAppRuntimeSnapshot,
  LocalAppRuntimeStatus,
  RuntimeStaticDeclaration,
} from '../../src/components/types'
import {
  fingerprintStaticSource,
  parseAgentOSStaticDeclaration,
  StaticArtifactStore,
  StaticPreviewRegistry,
  staticPreviewUrl,
  type StaticOutputValidation,
  validateStaticOutput,
} from './static'
import type { RuntimeEditCoordinator, RuntimeEditIntent } from '../runtime-edit-coordinator'

export const LOCAL_APP_RUNTIME_DEFAULTS = {
  prepareTimeoutMs: 120_000,
  readinessTimeoutMs: 60_000,
  probeIntervalMs: 250,
  probeTimeoutMs: 1_000,
  maxPortAttempts: 3,
  crashRetryCount: 3,
  crashRetryDelaysMs: [1_000, 2_000, 4_000],
  termTimeoutMs: 3_000,
  killTimeoutMs: 2_000,
  quitCleanupTimeoutMs: 5_000,
  logLineLimit: 2_000,
  logBufferLines: 160,
} as const

export type LocalAppInspectFailureCode =
  | 'invalid-root'
  | 'path-missing'
  | 'package-json-missing'
  | 'package-json-invalid'
  | 'dev-script-missing'
  | 'static-declaration-invalid'

export type LocalAppInspectResult =
  | {
      ok: true
      rootPath: string
      canonicalRoot: string
      name: string
      hasLockfile: boolean
      lockfilePath?: string
      lockDigest?: string
      nodeModulesPresent: boolean
      /** The only reliable signal that a temporary edit-time dev Runtime is supported. */
      hasDevScript: boolean
      mode: 'development' | 'static'
      agentos?: RuntimeStaticDeclaration
    }
  | {
      ok: false
      rootPath: string
      code: LocalAppInspectFailureCode
      message: string
    }

export type RuntimeLogEntry = {
  stream: 'stdout' | 'stderr'
  line: string
  timestamp: number
}

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

type RuntimeProcess = ChildProcess & { pid: number }

/**
 * The runtime child must have a liveness edge back to Electron.  A detached
 * `npm run dev` process otherwise survives an Electron crash and can retain a
 * framework lock file indefinitely.  Keep the bridge inline so packaged builds
 * do not need to discover a helper file next to the app bundle.
 *
 * The bridge only ever signals the npm process it spawned (and that process's
 * own POSIX process group).  It deliberately does not inspect cwd, ports,
 * locks, or the system process table.
 */
const RUNTIME_LIVENESS_BRIDGE_SOURCE = String.raw`
'use strict'

const { spawn } = require('node:child_process')

const TERM_TIMEOUT_MS = __TERM_TIMEOUT_MS__
const KILL_TIMEOUT_MS = __KILL_TIMEOUT_MS__
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmArgs = __NPM_ARGS__

let child
let closing = false

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function childIsAlive(value) {
  return Boolean(value && value.exitCode === null && value.signalCode === null)
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await delay(25)
  }
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

async function terminateOwnedChild(value) {
  const pid = value && value.pid
  // exitCode/signalCode are the ownership guard.  Once Node has observed the
  // child exit, never send a signal to its old PID (it may have been reused).
  if (!pid || pid <= 0 || !childIsAlive(value)) return

  if (process.platform === 'win32') {
    const graceful = spawn('taskkill', ['/pid', String(pid), '/T'], { shell: false, stdio: 'ignore' })
    await waitForChild(graceful, TERM_TIMEOUT_MS)
    if (!childIsAlive(value)) return
    const force = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    await waitForChild(force, KILL_TIMEOUT_MS)
    return
  }

  let groupSignalSent = false
  if (childIsAlive(value)) {
    try {
      process.kill(-pid, 'SIGTERM')
      groupSignalSent = true
    } catch {
      // A detached child should have its own group.  The direct-PID fallback
      // is still scoped by the live ChildProcess ownership proof.
      if (childIsAlive(value)) {
        try { process.kill(pid, 'SIGTERM') } catch { /* already stopped */ }
      }
    }
  }
  if (await waitForExit(pid, TERM_TIMEOUT_MS)) return
  if (!childIsAlive(value)) return
  if (groupSignalSent) {
    try { process.kill(-pid, 'SIGKILL') } catch {
      if (childIsAlive(value)) {
        try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
      }
    }
  } else if (childIsAlive(value)) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
  }
  await waitForExit(pid, KILL_TIMEOUT_MS)
}

function waitForChild(value, timeoutMs) {
  if (!value || value.exitCode !== null || value.signalCode !== null) return Promise.resolve()
  return Promise.race([
    new Promise((resolve) => value.once('exit', resolve)),
    delay(timeoutMs),
  ]).then(() => undefined)
}

function disconnectParent() {
  if (!process.connected) return
  try { process.disconnect() } catch { /* parent is already gone */ }
}

function finish(code) {
  if (!closing) closing = true
  process.exitCode = typeof code === 'number' ? code : 1
  disconnectParent()
}

async function closeAndExit(code) {
  if (closing) return
  closing = true
  await terminateOwnedChild(child)
  finish(code)
}

process.once('disconnect', () => { void closeAndExit(0) })
process.once('message', (message) => {
  if (message && message.type === 'runtime-shutdown') void closeAndExit(0)
})
process.once('SIGTERM', () => { void closeAndExit(0) })
process.once('SIGINT', () => { void closeAndExit(0) })
process.once('uncaughtException', (error) => {
  try { process.stderr.write('Runtime bridge error: ' + (error && error.stack ? error.stack : String(error)) + '\\n') } catch { /* best effort */ }
  void closeAndExit(1)
})
process.once('unhandledRejection', (reason) => {
  try { process.stderr.write('Runtime bridge rejection: ' + String(reason) + '\\n') } catch { /* best effort */ }
  void closeAndExit(1)
})

try {
  child = spawn(npmExecutable, npmArgs, {
    cwd: process.cwd(),
    shell: false,
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (child.stdout) child.stdout.pipe(process.stdout)
  if (child.stderr) child.stderr.pipe(process.stderr)
  child.once('error', (error) => {
    try { process.stderr.write('Runtime bridge child error: ' + (error && error.message ? error.message : String(error)) + '\\n') } catch { /* best effort */ }
    void closeAndExit(1)
  })
  child.once('close', (code, signal) => {
    if (closing) {
      finish(typeof code === 'number' ? code : 0)
      return
    }
    finish(typeof code === 'number' ? code : (signal ? 1 : 0))
  })
} catch (error) {
  try { process.stderr.write('Runtime bridge spawn error: ' + String(error) + '\\n') } catch { /* best effort */ }
  void closeAndExit(1)
}
`

function createRuntimeLivenessBridgeSource(termTimeoutMs: number, killTimeoutMs: number, npmArgs: readonly string[]): string {
  const safeTermTimeout = Number.isFinite(termTimeoutMs) && termTimeoutMs >= 0 ? Math.floor(termTimeoutMs) : LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs
  const safeKillTimeout = Number.isFinite(killTimeoutMs) && killTimeoutMs >= 0 ? Math.floor(killTimeoutMs) : LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs
  return RUNTIME_LIVENESS_BRIDGE_SOURCE
    .replace('__TERM_TIMEOUT_MS__', String(safeTermTimeout))
    .replace('__KILL_TIMEOUT_MS__', String(safeKillTimeout))
    .replace('__NPM_ARGS__', JSON.stringify(npmArgs))
}

const NEXT_TURBOPACK_CONFIG_CONFLICT = /empty turbopack config in your Next config file/i

/**
 * Next 16 enables Turbopack by default and exits when an older project has a
 * custom webpack config but no Turbopack config. Retry only that recognized
 * compatibility failure with Next's documented webpack CLI switch. Other
 * frameworks and arbitrary startup failures keep their original command.
 */
export function runtimeDevCommandArgs(logs: readonly RuntimeLogEntry[]): string[] {
  return logs.some((entry) => entry.stream === 'stderr' && NEXT_TURBOPACK_CONFIG_CONFLICT.test(entry.line))
    ? ['run', 'dev', '--', '--webpack']
    : ['run', 'dev']
}

type ActiveRuntime = {
  definition: LocalAppDefinition
  snapshot: LocalAppRuntimeSnapshot
  process?: RuntimeProcess
  buildProcess?: RuntimeProcess
  buildId?: string
  buildOperationId?: string
  buildController?: AbortController
  buildOperation?: Promise<LocalAppRuntimeSnapshot>
  buildPreSnapshot?: LocalAppRuntimeSnapshot
  operation?: Promise<LocalAppRuntimeSnapshot>
  controller: AbortController
  logs: RuntimeLogEntry[]
  consumerIds: Set<string>
}

export function redactRuntimeLine(value: string, limit = LOCAL_APP_RUNTIME_DEFAULTS.logLineLimit): string {
  let line = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]+/g, ' ').trim()
  line = line.replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]')
  line = line.replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
  if (line.length > limit) line = `${line.slice(0, limit)}…`
  return line
}

/** 只继承产品合同明确允许的宿主变量，拒绝 npm_config_* 与凭据变量。 */
export function buildAllowedRuntimeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP',
    'SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
    'LANG', 'LC_ALL',
  ])
  const result = {} as NodeJS.ProcessEnv
  for (const key of allowed) {
    const value = source[key]
    if (typeof value === 'string') result[key] = value
  }
  return result
}

export function normalizeLoopbackUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const host = url.hostname.toLowerCase()
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') return null
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function parseLoopbackReadyUrl(line: string): string | null {
  const matches = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)(?:[^\s)'"`]*)?/gi) ?? []
  for (const match of matches) {
    const normalized = normalizeLoopbackUrl(match)
    if (normalized) return normalized
  }
  return null
}

export async function canonicalizeLocalAppRoot(rootPath: string): Promise<string> {
  const trimmed = rootPath.trim()
  if (!trimmed) throw new Error('invalid-root')
  return realpath(trimmed)
}

export async function inspectLocalAppDirectory(rootPath: string): Promise<LocalAppInspectResult> {
  const requested = rootPath.trim()
  if (!requested) return { ok: false, rootPath, code: 'invalid-root', message: 'Runtime 目录为空' }
  try {
    const canonicalRoot = await canonicalizeLocalAppRoot(requested)
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) return { ok: false, rootPath, code: 'invalid-root', message: '目标不是文件夹' }
    const packagePath = path.join(canonicalRoot, 'package.json')
    let packageJson: unknown
    try {
      packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as unknown
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'package-json-missing' : 'package-json-invalid'
      return { ok: false, rootPath, code, message: code === 'package-json-missing' ? '缺少 package.json' : 'package.json 无法解析' }
    }
    const staticDeclaration = parseAgentOSStaticDeclaration(packageJson)
    if (!staticDeclaration.ok) return { ok: false, rootPath, code: staticDeclaration.code, message: staticDeclaration.message }
    const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : undefined
    if (!staticDeclaration.declaration && (!scripts || typeof scripts.dev !== 'string' || !scripts.dev.trim())) {
      return { ok: false, rootPath, code: 'dev-script-missing', message: 'package.json 缺少 dev 脚本' }
    }
    const lockfilePath = path.join(canonicalRoot, 'package-lock.json')
    const hasLockfile = existsSync(lockfilePath)
    const lockDigest = hasLockfile ? await digestFile(lockfilePath) : undefined
    return {
      ok: true,
      rootPath: requested,
      canonicalRoot,
      name: isRecord(packageJson) && typeof packageJson.name === 'string' && packageJson.name.trim()
        ? packageJson.name.trim()
        : path.basename(canonicalRoot),
      hasLockfile,
      lockfilePath: hasLockfile ? lockfilePath : undefined,
      lockDigest,
      nodeModulesPresent: existsSync(path.join(canonicalRoot, 'node_modules')),
      hasDevScript: Boolean(scripts && typeof scripts.dev === 'string' && scripts.dev.trim()),
      mode: staticDeclaration.declaration ? 'static' : 'development',
      agentos: staticDeclaration.declaration,
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'path-missing' : 'invalid-root'
    return { ok: false, rootPath, code, message: code === 'path-missing' ? 'Runtime 目录不存在' : 'Runtime 目录不可用' }
  }
}

/**
 * Narrow adapter from Agent edit facts to the Revision 5 Runtime. It owns no
 * edit/session state: the coordinator remains the generation fence, while the
 * Runtime remains the sole owner of dev processes, builds and last-good.
 */
export class RuntimeEditRuntimeBridge {
  private readonly activeDevelopmentConsumers = new Set<string>()

  constructor(private readonly options: {
    coordinator: Pick<RuntimeEditCoordinator, 'beginBuild' | 'completeBuild'>
    manager: Pick<LocalAppRuntimeManager, 'register' | 'start' | 'release' | 'build' | 'cancelBuild' | 'stopOwnedDevelopmentRuntimes'>
    resolveDefinition: (projectId: string) => LocalAppDefinition | null
    inspect?: (rootPath: string) => Promise<LocalAppInspectResult>
  }) {}

  async handle(intent: RuntimeEditIntent): Promise<void> {
    if (intent.type === 'potential-run-registered') {
      // A new potential writer invalidates a currently settling generation.
      // Cancelling is bounded by the Runtime; a later build is started only by
      // the coordinator's newest settle intent.
      const definition = this.options.resolveDefinition(intent.projectId)
      if (definition) await this.options.manager.cancelBuild(definition.id)
      return
    }
    if (intent.type === 'agent-lease-acquired') {
      await this.startTemporaryDevelopment(intent.projectId, editConsumerId(intent.projectId, intent.requestId, intent.toolUseId))
      return
    }
    if (intent.type === 'agent-lease-released') {
      await this.releaseTemporaryDevelopment(intent.projectId, editConsumerId(intent.projectId, intent.requestId, intent.toolUseId))
      return
    }
    if (intent.type !== 'settle') return

    const definition = this.options.resolveDefinition(intent.projectId)
    if (!definition) return
    const inspected = await (this.options.inspect ?? inspectLocalAppDirectory)(definition.rootPath)
    // Development-only, static-less and invalid declarations are deliberately
    // no-ops. There is no command inference path here.
    if (!inspected.ok || inspected.mode !== 'static' || !inspected.agentos) return
    const operationId = this.options.coordinator.beginBuild(intent.projectId, intent.editGeneration)
    if (!operationId) return
    try {
      this.options.manager.register({ ...definition, mode: 'static', agentos: inspected.agentos })
      await this.options.manager.build(definition.id)
    } finally {
      this.options.coordinator.completeBuild(intent.projectId, intent.editGeneration, operationId)
    }
  }

  private async startTemporaryDevelopment(projectId: string, consumerId: string): Promise<void> {
    const definition = this.options.resolveDefinition(projectId)
    if (!definition) return
    const inspected = await (this.options.inspect ?? inspectLocalAppDirectory)(definition.rootPath)
    // Editing a static workbench intentionally transitions it to its declared
    // npm development script so the page can update live. Static projects
    // without a dev script remain on their last-good artifact.
    if (!inspected.ok || (inspected.mode === 'static' && !inspected.hasDevScript)) return
    if (inspected.mode === 'static') {
      // Another workbench may already own npm run dev for this project under a
      // different durable definition. Stop that AgentOS-owned instance before
      // registering the temporary development definition.
      await this.options.manager.stopOwnedDevelopmentRuntimes(inspected.canonicalRoot)
    }
    const developmentDefinition: LocalAppDefinition = inspected.mode === 'static'
      ? { ...definition, mode: 'development', agentos: undefined }
      : { ...definition, mode: 'development' }
    this.options.manager.register(developmentDefinition)
    await this.options.manager.start(definition.id, consumerId)
    this.activeDevelopmentConsumers.add(consumerId)
  }

  private async releaseTemporaryDevelopment(projectId: string, consumerId: string): Promise<void> {
    if (!this.activeDevelopmentConsumers.delete(consumerId)) return
    const definition = this.options.resolveDefinition(projectId)
    if (!definition) return
    await this.options.manager.release(definition.id, consumerId)
  }
}

function editConsumerId(projectId: string, requestId: string, toolUseId: string): string {
  return `runtime-edit:${projectId}:${requestId}:${toolUseId}`
}

export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('dynamic-port-unavailable'))
      })
    })
  })
}

export async function probeLoopbackReady(
  readyUrl: string,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const normalized = normalizeLoopbackUrl(readyUrl)
  if (!normalized) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_APP_RUNTIME_DEFAULTS.probeTimeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await (options.fetch ?? globalThis.fetch)(normalized, { redirect: 'manual', signal: controller.signal })
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const finish = () => {
      clearTimeout(timer)
      cleanup()
      resolve()
    }
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class LocalAppRuntimeSupervisor {
  private readonly now: () => number
  private readonly spawnProcess: typeof spawn
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly allocatePortImpl: () => Promise<number>
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly defaults: typeof LOCAL_APP_RUNTIME_DEFAULTS
  private readonly env: NodeJS.ProcessEnv
  private readonly preparationDigests: Map<string, string>
  private readonly preparationRecordPath?: string
  private readonly staticArtifactStore: StaticArtifactStore
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
    this.spawnProcess = options.spawn ?? spawn
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.allocatePortImpl = options.allocatePort ?? allocateLoopbackPort
    this.sleep = options.sleep ?? waitWithAbort
    this.defaults = { ...LOCAL_APP_RUNTIME_DEFAULTS, ...options.defaults, crashRetryDelaysMs: options.defaults?.crashRetryDelaysMs ?? LOCAL_APP_RUNTIME_DEFAULTS.crashRetryDelaysMs }
    this.env = options.env ?? process.env
    this.preparationDigests = options.preparationDigests ?? new Map()
    this.preparationRecordPath = options.preparationRecordPath
    this.staticArtifactStore = options.staticArtifactStore ?? new StaticArtifactStore(options.userDataPath ?? path.join(process.cwd(), '.agentos-runtime-data'), this.now)
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
      return this.detectModeAndStart(definition, requestedConsumers, options)
    }
    if (definition.mode === 'static') {
      if (existing && existing.snapshot.mode === 'static' && existing.snapshot.status !== 'stopped') {
        if (existing.operation) return existing.operation
        if (existing.buildOperation) return existing.buildOperation
        return Promise.resolve(existing.snapshot)
      }
      if (existing) return this.transitionRuntime(existing, definition, () => this.startStaticTracked(definition, requestedConsumers, options))
      return this.startStaticTracked(definition, requestedConsumers, options)
    }
    if (existing?.snapshot.mode === 'static' && existing.snapshot.status !== 'stopped') {
      const developmentDefinition = definition.mode === 'development' ? definition : { ...definition, mode: 'development' as const }
      return this.transitionRuntime(existing, developmentDefinition, () => this.start(developmentDefinition, requestedConsumers, options))
    }
    if (existing?.operation) return existing.operation
    if (existing?.snapshot.status === 'running' || existing?.snapshot.status === 'starting' || existing?.snapshot.status === 'preparing') {
      return Promise.resolve(existing.snapshot)
    }
    const generation = (this.generationByApp.get(definition.id) ?? 0) + 1
    this.generationByApp.set(definition.id, generation)
    const runtime: ActiveRuntime = {
      definition,
      snapshot: { ...this.createSnapshot(definition.id, generation, 'preparing'), mode: 'development' },
      controller: new AbortController(),
      logs: [],
      consumerIds: new Set(requestedConsumers),
    }
    this.runtimes.set(definition.id, runtime)
    const operation = this.startRuntime(runtime).finally(() => {
      if (runtime.operation === operation) runtime.operation = undefined
    })
    runtime.operation = operation
    return operation
  }

  private startStaticTracked(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const operation = this.startStatic(definition, consumerIds, options)
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
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const inspection = await inspectLocalAppDirectory(definition.rootPath)
    if (inspection.ok && inspection.mode === 'static' && inspection.agentos) {
      return this.start({ ...definition, mode: 'static', agentos: inspection.agentos }, consumerIds, options)
    }
    if (!inspection.ok && inspection.code === 'static-declaration-invalid') {
      // A legacy persisted definition may encounter a newly declared but
      // malformed `agentos` block. It must surface the strict parse failure;
      // silently falling back to npm run dev would bypass the static contract.
      return this.start({ ...definition, mode: 'static', agentos: undefined }, consumerIds, options)
    }
    // Legacy definitions remain development runtimes. Setting the explicit
    // mode avoids another inspection pass and preserves old npm run dev flow.
    return this.start({ ...definition, mode: 'development' }, consumerIds, options)
  }

  /** Static restore is spawn-free unless this is the trusted first import. */
  private async startStatic(
    definition: LocalAppDefinition,
    consumerIds: Iterable<string>,
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const generation = (this.generationByApp.get(definition.id) ?? 0) + 1
    this.generationByApp.set(definition.id, generation)
    const runtime: ActiveRuntime = {
      definition,
      snapshot: this.createSnapshot(definition.id, generation, 'build_required'),
      controller: new AbortController(),
      logs: [],
      consumerIds: new Set(consumerIds),
    }
    runtime.snapshot = { ...runtime.snapshot, mode: 'static', buildStatus: 'build_required', phase: 'inspect' }
    this.runtimes.set(definition.id, runtime)
    const isActive = () => this.runtimes.get(definition.id) === runtime && !runtime.controller.signal.aborted
    const inspection = await inspectLocalAppDirectory(definition.rootPath)
    if (!isActive()) return runtime.snapshot
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    if (inspection.mode !== 'static' || !inspection.agentos) return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    if (definition.trustStatus !== 'trusted') return this.fail(runtime, 'trust-required', '目录尚未获得信任', 'inspect')
    const artifact = await this.staticArtifactStore.loadLastGood(definition.id, inspection.canonicalRoot)
    if (!isActive()) return runtime.snapshot
    let current = artifact
    if (!current) {
      try {
        await validateStaticOutput(inspection.canonicalRoot, inspection.agentos)
        if (!isActive()) return runtime.snapshot
        const fingerprint = await fingerprintStaticSource(inspection.canonicalRoot, inspection.agentos)
        if (!isActive()) return runtime.snapshot
        current = await this.staticArtifactStore.commit(
          definition.id,
          inspection.canonicalRoot,
          inspection.agentos,
          path.resolve(inspection.canonicalRoot, ...inspection.agentos.outputRoot.split('/')),
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
        return this.build(definition, consumerIds)
      }
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'build_required',
        mode: 'static',
        buildStatus: 'build_required',
        updatedAt: this.now(),
      }
      this.emit(runtime, 'status')
      return runtime.snapshot
    }
    if (!isActive()) return runtime.snapshot
    const token = this.staticPreviewRegistry.register(runtime.snapshot.runtimeId, generation, current)
    runtime.snapshot = {
      ...runtime.snapshot,
      status: 'ready',
      mode: 'static',
      buildStatus: 'ready',
      artifactId: current.artifactId,
      lastBuildAt: current.lastBuildAt,
      previewUrl: staticPreviewUrl(token),
      stale: false,
      phase: 'readiness',
      updatedAt: this.now(),
    }
    this.emit(runtime, 'ready')
    // Stale detection must never delay the first paint.
    void this.checkStaticStale(runtime, inspection.canonicalRoot, inspection.agentos, current)
    return runtime.snapshot
  }

  async stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return null
    runtime.controller.abort()
    runtime.buildController?.abort()
    if (runtime.snapshot.mode === 'static') this.staticPreviewRegistry.revokeRuntime(runtime.snapshot.runtimeId, runtime.snapshot.generation)
    const process = runtime.process
    const buildProcess = runtime.buildProcess
    runtime.snapshot = {
      ...runtime.snapshot,
      status: 'stopped',
      stopReason: reason,
      updatedAt: this.now(),
      readyUrl: undefined,
      previewUrl: undefined,
      port: undefined,
      logs: this.recentLogs(runtime),
    }
    this.emit(runtime, 'status')
    if (process) await terminateProcessTree(process, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
    if (buildProcess) await terminateProcessTree(buildProcess, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
    runtime.process = undefined
    runtime.buildProcess = undefined
    runtime.operation = undefined
    runtime.buildOperation = undefined
    runtime.buildId = undefined
    runtime.buildOperationId = undefined
    runtime.buildController = undefined
    runtime.buildPreSnapshot = undefined
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

  async build(definition: LocalAppDefinition, consumerIds: Iterable<string> = []): Promise<LocalAppRuntimeSnapshot> {
    const previous = this.buildLocks.get(definition.id) ?? Promise.resolve()
    const operation = previous.then(() => this.buildOnce(definition, consumerIds))
    this.buildLocks.set(definition.id, operation.then(() => undefined, () => undefined))
    return operation
  }

  private async buildOnce(definition: LocalAppDefinition, consumerIds: Iterable<string> = []): Promise<LocalAppRuntimeSnapshot> {
    if (!definition.mode && !definition.agentos) {
      const inspection = await inspectLocalAppDirectory(definition.rootPath)
      if (inspection.ok && inspection.mode === 'static' && inspection.agentos) {
        return this.buildOnce({ ...definition, mode: 'static', agentos: inspection.agentos }, consumerIds)
      }
    }
    if (definition.mode !== 'static' || !definition.agentos) {
      const existing = this.runtimes.get(definition.id)
      return existing?.snapshot ?? this.createSnapshot(definition.id, 0, 'failed')
    }
    let runtime = this.runtimes.get(definition.id)
    if (!runtime || runtime.snapshot.status === 'stopped') {
      await this.start(definition, consumerIds, { autoBuild: false })
      runtime = this.runtimes.get(definition.id)
    }
    if (!runtime) throw new Error('static-runtime-missing')
    for (const consumerId of consumerIds) runtime.consumerIds.add(consumerId)
    if (runtime.buildOperation) return runtime.buildOperation
    const inspection = await inspectLocalAppDirectory(definition.rootPath)
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    if (inspection.mode !== 'static' || !inspection.agentos) return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    const buildId = `build-${this.now().toString(36)}-${randomBytes(6).toString('hex')}`
    const operationId = `op-${this.now().toString(36)}-${randomBytes(6).toString('hex')}`
    const buildController = new AbortController()
    const previous = runtime.snapshot
    runtime.buildPreSnapshot = { ...previous }
    runtime.buildId = buildId
    runtime.buildOperationId = operationId
    runtime.buildController = buildController
    runtime.snapshot = {
      ...previous,
      status: 'building',
      mode: 'static',
      buildStatus: 'building',
      buildId,
      operationId,
      phase: 'build' as LocalAppRuntimeSnapshot['phase'],
      errorCode: undefined,
      detail: undefined,
      updatedAt: this.now(),
    }
    this.emit(runtime, 'status')
    const operation = this.runStaticBuild(runtime, inspection.canonicalRoot, inspection.agentos, buildId, operationId, buildController.signal)
      .finally(() => {
        if (runtime?.buildOperation === operation) {
          runtime.buildOperation = undefined
          runtime.buildProcess = undefined
          runtime.buildController = undefined
          runtime.buildId = undefined
          runtime.buildOperationId = undefined
          runtime.buildPreSnapshot = undefined
          runtime.snapshot = { ...runtime.snapshot, buildId: undefined, operationId: undefined }
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
    if (runtime.buildProcess) await terminateProcessTree(runtime.buildProcess, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
    return runtime.buildOperation.catch(() => runtime.snapshot)
  }

  private async runStaticBuild(
    runtime: ActiveRuntime,
    canonicalRoot: string,
    declaration: RuntimeStaticDeclaration,
    buildId: string,
    operationId: string,
    signal: AbortSignal,
  ): Promise<LocalAppRuntimeSnapshot> {
    let child: RuntimeProcess
    try {
      child = this.spawnProcess(npmExecutable(), ['run', 'build'], {
        cwd: canonicalRoot,
        shell: false,
        detached: process.platform !== 'win32',
        env: { ...buildAllowedRuntimeEnv(this.env), NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as RuntimeProcess
    } catch (error) {
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'build_failed',
        buildStatus: 'build_failed',
        errorCode: 'build-spawn-failed',
        detail: error instanceof Error ? error.message : '静态构建进程无法启动',
        updatedAt: this.now(),
      }
      this.emit(runtime, 'status', { buildId, operationId })
      return runtime.snapshot
    }
    runtime.buildProcess = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.captureLog(runtime, 'stdout', chunk))
    child.stderr?.on('data', (chunk: string) => this.captureLog(runtime, 'stderr', chunk))
    const exit = await this.waitForBuildExit(child, signal)
    const operationStillOwnsRuntime = () => runtime.buildId === buildId && runtime.buildOperationId === operationId
    if (!operationStillOwnsRuntime()) return runtime.snapshot
    if (signal.aborted) {
      this.restoreStaticBuildAfterCancellation(runtime)
      this.emit(runtime, 'status', { buildId, operationId })
      return runtime.snapshot
    }
    if (exit.error || exit.code !== 0) {
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'build_failed',
        buildStatus: 'build_failed',
        errorCode: signal.aborted ? 'build-cancelled' : 'build-failed',
        detail: signal.aborted ? '静态构建已取消' : `静态构建失败 (${exit.code ?? exit.signal ?? 'unknown'})`,
        updatedAt: this.now(),
        logs: this.recentLogs(runtime),
      }
      this.emit(runtime, 'exit', { detail: runtime.snapshot.detail, code: exit.code, signal: exit.signal ?? undefined })
      return runtime.snapshot
    }
    try {
      await this.validateStaticOutputImpl(canonicalRoot, declaration, signal)
      if (!operationStillOwnsRuntime()) return runtime.snapshot
      if (signal.aborted) {
        this.restoreStaticBuildAfterCancellation(runtime)
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
      const outputRoot = path.resolve(canonicalRoot, ...declaration.outputRoot.split('/'))
      const fingerprint = await this.fingerprintStaticSourceImpl(canonicalRoot, declaration, signal)
      if (!operationStillOwnsRuntime()) return runtime.snapshot
      if (signal.aborted) {
        this.restoreStaticBuildAfterCancellation(runtime)
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
      const artifact = await this.staticArtifactStore.commit(runtime.definition.id, canonicalRoot, declaration, outputRoot, fingerprint, signal)
      if (!operationStillOwnsRuntime()) return runtime.snapshot
      // `commit` returns only after the last-good pointer rename. That rename
      // is the non-cancellable persistence boundary: an abort in this narrow
      // window must publish the committed artifact, never roll memory back to
      // the previous pointer.
      // A successful commit is the generation boundary for Preview sessions;
      // revoke the previous token only after the new artifact is atomically
      // staged, so a failed/cancelled build still keeps the last-good session.
      this.staticPreviewRegistry.revokeRuntime(runtime.snapshot.runtimeId, runtime.snapshot.generation)
      const token = this.staticPreviewRegistry.register(runtime.snapshot.runtimeId, runtime.snapshot.generation, artifact)
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'ready',
        buildStatus: 'ready',
        artifactId: artifact.artifactId,
        lastBuildAt: artifact.lastBuildAt,
        previewUrl: staticPreviewUrl(token),
        stale: false,
        errorCode: undefined,
        detail: undefined,
        phase: 'readiness',
        updatedAt: this.now(),
        logs: this.recentLogs(runtime),
      }
      this.emit(runtime, 'ready', { buildId, operationId })
      return runtime.snapshot
    } catch (error) {
      if (!operationStillOwnsRuntime()) return runtime.snapshot
      if (signal.aborted) {
        this.restoreStaticBuildAfterCancellation(runtime)
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'build_failed',
        buildStatus: 'build_failed',
        errorCode: 'static-output-invalid',
        detail: error instanceof Error ? error.message : '静态产物校验失败',
        updatedAt: this.now(),
        logs: this.recentLogs(runtime),
      }
      this.emit(runtime, 'status', { buildId, operationId })
      return runtime.snapshot
    }
  }

  private waitForBuildExit(
    child: RuntimeProcess,
    signal: AbortSignal,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: { code: number | null; signal: NodeJS.Signals | null; error?: Error }) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const onAbort = () => {
        void terminateProcessTree(child, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs).finally(() => finish({ code: null, signal: 'SIGTERM' }))
      }
      child.once('error', (error) => finish({ code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) }))
      child.once('exit', (code, childSignal) => finish({ code, signal: childSignal }))
      child.once('close', (code, childSignal) => finish({ code, signal: childSignal }))
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private restoreStaticBuildAfterCancellation(runtime: ActiveRuntime): LocalAppRuntimeSnapshot {
    const previous = runtime.buildPreSnapshot ?? runtime.snapshot
    const hasLastGood = Boolean(previous.artifactId && previous.previewUrl)
    const restoreStale = previous.status === 'stale' && previous.buildStatus === 'stale'
    const restoreStatus = restoreStale ? 'stale' : hasLastGood ? 'ready' : 'build_required'
    runtime.snapshot = {
      ...runtime.snapshot,
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
      logs: this.recentLogs(runtime),
    }
    return runtime.snapshot
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
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'stale',
        buildStatus: 'stale',
        stale: true,
        updatedAt: this.now(),
      }
      this.emit(runtime, 'status')
    } catch {
      // Stale checking is advisory and must never make an otherwise usable
      // last-good artifact unavailable.
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

  private createSnapshot(localAppId: string, generation: number, status: LocalAppRuntimeStatus): LocalAppRuntimeSnapshot {
    return { runtimeDefinitionId: localAppId, localAppId, runtimeId: `runtime-${localAppId}-${generation}-${this.now().toString(36)}`, generation, status, restartAttempt: 0, updatedAt: this.now(), logs: [] }
  }

  private async startRuntime(runtime: ActiveRuntime): Promise<LocalAppRuntimeSnapshot> {
    const { definition } = runtime
    await this.loadPreparationRecord()
    const inspected = await inspectLocalAppDirectory(definition.rootPath)
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
      runtime.snapshot = { ...runtime.snapshot, status: 'starting', phase: 'start', updatedAt: this.now(), logs: this.recentLogs(runtime) }
      this.emit(runtime, 'status')
      let lastError = 'readiness_timeout'
      let lastDetail: string | undefined
      for (let attempt = 0; attempt < this.defaults.maxPortAttempts; attempt += 1) {
        if (runtime.controller.signal.aborted) return runtime.snapshot
        const port = await this.allocatePortImpl()
        if (runtime.controller.signal.aborted) return runtime.snapshot
        for (let crashAttempt = 0; crashAttempt <= this.defaults.crashRetryCount; crashAttempt += 1) {
          if (runtime.controller.signal.aborted) return runtime.snapshot
          runtime.snapshot = { ...runtime.snapshot, errorCode: undefined, detail: undefined, port, updatedAt: this.now() }
          const process = this.spawnNpm(runtime, inspected.canonicalRoot, port)
          runtime.process = process
          const ready = await this.waitForReadiness(runtime, process, port)
          if (ready) {
            runtime.snapshot = { ...runtime.snapshot, status: 'running', phase: 'readiness', readyUrl: ready, port, startedAt: runtime.snapshot.startedAt ?? this.now(), updatedAt: this.now(), logs: this.recentLogs(runtime) }
            this.emit(runtime, 'ready')
            return runtime.snapshot
          }
          lastError = runtime.snapshot.errorCode ?? lastError
          lastDetail = runtime.snapshot.detail ?? lastDetail
          await terminateProcessTree(process, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
          runtime.process = undefined
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

  private async prepareDependencies(runtime: ActiveRuntime, inspected: Extract<LocalAppInspectResult, { ok: true }>): Promise<void> {
    const lockKey = inspected.canonicalRoot
    const nodeModules = inspected.nodeModulesPresent
    const knownLockDigest = this.preparationDigests.get(lockKey)
    const needsPrepare = inspected.hasLockfile
      // 缺少持久 preparation record 时保守重跑 npm ci，即使 node_modules
      // 仍在磁盘上，也不能把未知依赖状态当成已验证状态。
      ? !nodeModules || knownLockDigest === undefined || knownLockDigest !== inspected.lockDigest
      : !nodeModules
    if (!needsPrepare) return
    runtime.snapshot = { ...runtime.snapshot, status: 'preparing', phase: 'prepare', updatedAt: this.now() }
    this.emit(runtime, 'status')
    const port = await this.allocatePortImpl()
    if (runtime.controller.signal.aborted) return
    const executable = npmExecutable()
    const args = inspected.hasLockfile ? ['ci'] : ['install']
    const child = this.spawnProcess(executable, args, {
      cwd: inspected.canonicalRoot,
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...buildAllowedRuntimeEnv(this.env), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as RuntimeProcess
    runtime.process = child
    let exit: { code: number | null; signal: NodeJS.Signals | null }
    try {
      exit = await this.waitForChild(child, runtime, this.defaults.prepareTimeoutMs)
    } finally {
      if (runtime.process === child) runtime.process = undefined
    }
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

  private spawnNpm(runtime: ActiveRuntime, cwd: string, port: number): RuntimeProcess {
    const npmArgs = runtimeDevCommandArgs(runtime.logs)
    const child = this.spawnProcess(runtimeBridgeExecutable(), ['-e', createRuntimeLivenessBridgeSource(this.defaults.termTimeoutMs, this.defaults.killTimeoutMs, npmArgs)], {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...buildAllowedRuntimeEnv(this.env), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }) as RuntimeProcess
    runtime.snapshot = { ...runtime.snapshot, startedAt: this.now(), port, updatedAt: this.now() }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.captureLog(runtime, 'stdout', chunk))
    child.stderr?.on('data', (chunk: string) => this.captureLog(runtime, 'stderr', chunk))
    child.once('error', (error) => {
      if (runtime.process !== child || runtime.controller.signal.aborted) return
      const detail = `开发服务桥接器错误 (${error instanceof Error ? error.message : String(error)})`
      runtime.snapshot = { ...runtime.snapshot, errorCode: 'process-exited', detail, updatedAt: this.now() }
      this.emit(runtime, 'exit', { detail })
    })
    child.once('exit', (code, signal) => {
      if (runtime.process !== child || runtime.controller.signal.aborted) return
      runtime.process = undefined
      const exitDetail = `开发服务退出 (${code ?? signal ?? 'unknown'})${this.latestReadableReason(runtime) ? `：${this.latestReadableReason(runtime)}` : ''}`
      runtime.snapshot = { ...runtime.snapshot, errorCode: 'process-exited', detail: exitDetail, updatedAt: this.now() }
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
    let inspected: Extract<LocalAppInspectResult, { ok: true }>
    const inspection = await inspectLocalAppDirectory(definition.rootPath)
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    inspected = inspection
    for (let attempt = 0; attempt < this.defaults.crashRetryCount; attempt += 1) {
      if (runtime.controller.signal.aborted) return runtime.snapshot
      runtime.snapshot = {
        ...runtime.snapshot,
        status: 'starting',
        phase: 'start',
        restartAttempt: attempt + 1,
        errorCode: undefined,
        detail: undefined,
        updatedAt: this.now(),
      }
      this.emit(runtime, 'status')
      const port = await this.allocatePortImpl()
      if (runtime.controller.signal.aborted) return runtime.snapshot
      const process = this.spawnNpm(runtime, inspected.canonicalRoot, port)
      runtime.process = process
      const ready = await this.waitForReadiness(runtime, process, port)
      if (ready) {
        runtime.snapshot = {
          ...runtime.snapshot,
          status: 'running',
          phase: 'readiness',
          readyUrl: ready,
          port,
          updatedAt: this.now(),
          logs: this.recentLogs(runtime),
        }
        this.emit(runtime, 'ready')
        return runtime.snapshot
      }
      await terminateProcessTree(process, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
      if (runtime.process === process) runtime.process = undefined
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
      const redacted = redactRuntimeLine(line)
      if (!redacted) continue
      runtime.logs.push({ stream, line: redacted, timestamp: this.now() })
      while (runtime.logs.length > this.defaults.logBufferLines) runtime.logs.shift()
      const readyUrl = parseLoopbackReadyUrl(redacted)
      if (readyUrl) runtime.snapshot = { ...runtime.snapshot, readyUrl, updatedAt: this.now() }
      this.emit(runtime, 'log', { stream, line: redacted })
    }
  }

  private async waitForReadiness(runtime: ActiveRuntime, process: RuntimeProcess, port: number): Promise<string | null> {
    const deadline = this.now() + this.defaults.readinessTimeoutMs
    let candidate: string | null = null
    while (this.now() < deadline && !runtime.controller.signal.aborted) {
      const processExited = (process.exitCode !== undefined && process.exitCode !== null)
        || (process.signalCode !== undefined && process.signalCode !== null)
      if (runtime.snapshot.errorCode === 'process-exited' || processExited) {
        const detail = runtime.snapshot.detail
          ?? `进程提前退出 (${process.exitCode ?? process.signalCode ?? 'unknown'})${this.latestReadableReason(runtime) ? `：${this.latestReadableReason(runtime)}` : ''}`
        runtime.snapshot = { ...runtime.snapshot, errorCode: 'process-exited', detail, updatedAt: this.now() }
        return null
      }
      candidate = runtime.snapshot.readyUrl ?? candidate
      if (!candidate) {
        candidate = normalizeLoopbackUrl(`http://127.0.0.1:${port}/`)
      }
      if (candidate && await probeLoopbackReady(candidate, { fetch: this.fetchImpl, timeoutMs: this.defaults.probeTimeoutMs, signal: runtime.controller.signal })) return candidate
      await this.sleep(this.defaults.probeIntervalMs, runtime.controller.signal).catch(() => undefined)
    }
    runtime.snapshot = { ...runtime.snapshot, errorCode: runtime.snapshot.errorCode ?? 'readiness_timeout', updatedAt: this.now() }
    return null
  }

  private async waitForChild(child: RuntimeProcess, runtime: ActiveRuntime, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        void terminateProcessTree(child, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs).finally(() => reject(new Error('dependency preparation timeout')))
      }, timeoutMs)
      child.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, signal })
      })
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => this.captureLog(runtime, 'stdout', chunk))
      child.stderr?.on('data', (chunk: string) => this.captureLog(runtime, 'stderr', chunk))
    })
  }

  private fail(runtime: ActiveRuntime, errorCode: string, detail: string, phase: LocalAppRuntimeSnapshot['phase']): LocalAppRuntimeSnapshot {
    runtime.snapshot = { ...runtime.snapshot, status: errorCode === 'path-missing' ? 'path_missing' : 'failed', phase, errorCode, detail, updatedAt: this.now(), logs: this.recentLogs(runtime) }
    this.emit(runtime, 'status')
    return runtime.snapshot
  }

  private recentLogs(runtime: ActiveRuntime): string[] {
    return runtime.logs.slice(-this.defaults.logBufferLines).map((entry) => `[${entry.stream}] ${entry.line}`)
  }

  private latestReadableReason(runtime: ActiveRuntime): string | undefined {
    const latest = runtime.logs.at(-1)
    return latest ? `[${latest.stream}] ${latest.line}` : undefined
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

export class LocalAppRuntimeManager {
  private readonly supervisor: LocalAppRuntimeSupervisor
  private readonly definitions = new Map<string, LocalAppDefinition>()
  private readonly ownerByDedupeKey = new Map<string, string>()
  private readonly dedupeKeyByApp = new Map<string, string>()
  private readonly consumers = new Map<string, Set<string>>()
  private readonly pendingDefinitionStops = new Map<string, Promise<LocalAppRuntimeSnapshot | null>>()
  private readonly listeners = new Set<(event: LocalAppRuntimeEvent) => void>()

  constructor(options: RuntimeSupervisorOptions = {}) {
    this.supervisor = new LocalAppRuntimeSupervisor({
      ...options,
      onEvent: (event) => {
        options.onEvent?.(event)
        for (const listener of this.listeners) listener(event)
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
      const pending = this.supervisor.stop(definition.id, 'user')
      this.pendingDefinitionStops.set(definition.id, pending)
    }
    const previousKey = this.dedupeKeyByApp.get(definition.id)
    if (previousKey && this.ownerByDedupeKey.get(previousKey) === definition.id) {
      this.ownerByDedupeKey.delete(previousKey)
    }
    this.definitions.set(definition.id, definition)
    const key = runtimeDedupeKey(definition)
    if (!this.ownerByDedupeKey.has(key)) this.ownerByDedupeKey.set(key, definition.id)
    this.dedupeKeyByApp.set(definition.id, key)
  }

  get(localAppId: string): LocalAppRuntimeSnapshot | null {
    return this.supervisor.snapshot(this.ownerId(localAppId))
  }

  async start(
    localAppId: string,
    consumerId?: string,
    options: RuntimeStartOptions = {},
  ): Promise<LocalAppRuntimeSnapshot> {
    const definition = this.definitions.get(localAppId)
    if (!definition) throw new Error('local-app-definition-missing')
    if (definition.trustStatus !== 'trusted') throw new Error('local-app-trust-required')
    const ownerId = this.ownerId(localAppId)
    const ownerDefinition = this.definitions.get(ownerId) ?? definition
    const consumers = this.consumers.get(ownerId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(ownerId, consumers)
    for (const id of consumers) this.supervisor.attachConsumer(ownerId, id)
    const pendingStop = this.pendingDefinitionStops.get(ownerId)
    if (pendingStop) {
      this.pendingDefinitionStops.delete(ownerId)
      await pendingStop
    }
    return this.supervisor.start(ownerDefinition, consumers, options)
  }

  stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    return this.supervisor.stop(this.ownerId(localAppId), reason)
  }

  restart(localAppId: string): Promise<LocalAppRuntimeSnapshot> {
    const definition = this.definitions.get(localAppId)
    if (!definition) return Promise.reject(new Error('local-app-definition-missing'))
    const ownerId = this.ownerId(localAppId)
    const consumers = this.consumers.get(ownerId) ?? new Set<string>()
    return this.supervisor.restart(this.definitions.get(ownerId) ?? definition, consumers)
  }

  build(localAppId: string, consumerId?: string): Promise<LocalAppRuntimeSnapshot> {
    const definition = this.definitions.get(localAppId)
    if (!definition) return Promise.reject(new Error('local-app-definition-missing'))
    if (definition.trustStatus !== 'trusted') return Promise.reject(new Error('local-app-trust-required'))
    const ownerId = this.ownerId(localAppId)
    const ownerDefinition = this.definitions.get(ownerId) ?? definition
    const consumers = this.consumers.get(ownerId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(ownerId, consumers)
    return this.supervisor.build(ownerDefinition, consumers)
  }

  cancelBuild(localAppId: string, buildId?: string): Promise<LocalAppRuntimeSnapshot | null> {
    return this.supervisor.cancelBuild(this.ownerId(localAppId), buildId)
  }

  /** Stop only AgentOS-owned development processes for the same project root. */
  async stopOwnedDevelopmentRuntimes(rootPath: string): Promise<void> {
    const comparableRoot = runtimeComparableRoot(rootPath)
    const ownerIds = new Set<string>()
    for (const [definitionId, definition] of this.definitions) {
      if (runtimeComparableRoot(definition.canonicalRoot ?? definition.rootPath) !== comparableRoot) continue
      const ownerId = this.ownerId(definitionId)
      const snapshot = this.supervisor.snapshot(ownerId)
      if (snapshot?.mode === 'development' && snapshot.status !== 'stopped') ownerIds.add(ownerId)
    }
    await Promise.all([...ownerIds].map((ownerId) => this.supervisor.stop(ownerId, 'user')))
  }

  getStaticPreviewRegistry(): StaticPreviewRegistry {
    return this.supervisor.getStaticPreviewRegistry()
  }

  async release(localAppId: string, consumerId: string): Promise<LocalAppRuntimeSnapshot | null> {
    const ownerId = this.ownerId(localAppId)
    const consumers = this.consumers.get(ownerId)
    consumers?.delete(consumerId)
    return this.supervisor.detachConsumer(ownerId, consumerId)
  }

  async stopAll(reason: LocalAppRuntimeSnapshot['stopReason'] = 'app-quit'): Promise<void> {
    await this.supervisor.stopAll(reason)
  }

  private ownerId(localAppId: string): string {
    const definition = this.definitions.get(localAppId)
    return definition ? this.ownerByDedupeKey.get(runtimeDedupeKey(definition)) ?? localAppId : localAppId
  }
}

function runtimeDedupeKey(definition: LocalAppDefinition): string {
  const comparable = runtimeComparableRoot(definition.canonicalRoot ?? definition.rootPath)
  return definition.mode === 'static'
    ? `${comparable}|static|${definition.agentos?.outputRoot ?? ''}|${definition.agentos?.entryFile ?? ''}`
    : `${comparable}|npm run dev`
}

function runtimeComparableRoot(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Next.js keeps an exclusive project lock while `next dev` is alive. If an
 * earlier terminal, IDE, or AgentOS process still owns that exact lock, the
 * replacement exits with code 1. Resolve only the PIDs holding this project's
 * lock; never scan or kill processes merely because their cwd/command matches.
 */
export async function terminateNextDevLockOwners(canonicalRoot: string): Promise<number[]> {
  if (process.platform === 'win32') return []
  const lockPath = path.join(canonicalRoot, '.next', 'dev', 'lock')
  if (!existsSync(lockPath)) return []
  const pids = await openFileOwnerPids(lockPath)
  const terminated: number[] = []
  for (const pid of pids) {
    if (pid <= 0 || pid === process.pid) continue
    try { process.kill(pid, 'SIGTERM') } catch { continue }
    if (!await waitForPidExit(pid, LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* process exited after the timeout */ }
      await waitForPidExit(pid, LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs)
    }
    terminated.push(pid)
  }
  return terminated
}

async function openFileOwnerPids(filePath: string): Promise<number[]> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn('lsof', ['-t', filePath], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve([...new Set(output.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))])
    }
    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM') } catch { /* lsof already exited */ }
      finish()
    }, 1_000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { output += chunk })
    child.once('error', finish)
    child.once('exit', finish)
  })
}

export async function terminateProcessTree(
  child: { pid?: number | null; killed?: boolean; connected?: boolean; exitCode?: number | null; signalCode?: NodeJS.Signals | null; send?: ChildProcess['send']; kill?: (signal?: NodeJS.Signals | number) => boolean },
  termTimeoutMs = LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs,
  killTimeoutMs = LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs,
): Promise<void> {
  const pid = child.pid
  if (!pid || pid <= 0) return
  // A ChildProcess that has already emitted exit must never be addressed by
  // its old PID.  The PID may have been reused by an unrelated process.
  const childIsAlive = () => (child.exitCode === undefined || child.exitCode === null)
    && (child.signalCode === undefined || child.signalCode === null)
  if (!childIsAlive()) return

  // The liveness bridge has an IPC channel and owns a second, detached npm
  // process group. Ask it to shut down over that ownership channel first, so
  // it can finish the child cleanup before exiting. Signals remain a bounded
  // fallback for an unresponsive bridge.
  if (child.connected === true && child.send && child.kill) {
    try { child.send({ type: 'runtime-shutdown' }) } catch { /* bridge is already stopping */ }
    if (await waitForPidExit(pid, termTimeoutMs + killTimeoutMs)) return
    if (!childIsAlive()) return
    try { child.kill('SIGTERM') } catch { /* already stopped */ }
    if (await waitForPidExit(pid, termTimeoutMs)) return
    if (!childIsAlive()) return
    try { child.kill('SIGKILL') } catch { /* already stopped */ }
    await waitForPidExit(pid, killTimeoutMs)
    return
  }

  if (process.platform === 'win32') {
    if (!childIsAlive()) return
    const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    await waitChildExit(taskkill, termTimeoutMs + killTimeoutMs)
    return
  }
  if (!childIsAlive()) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    if (childIsAlive()) {
      try { process.kill(pid, 'SIGTERM') } catch { /* already stopped */ }
    }
  }
  if (await waitForPidExit(pid, termTimeoutMs)) return
  if (!childIsAlive()) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    if (childIsAlive()) {
      try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
    }
  }
  await waitForPidExit(pid, killTimeoutMs)
}

// Neutral Revision 2 exports. The physical directory remains for safe
// migration, while new callers use Runtime terminology.
export { LocalAppRuntimeManager as RuntimeManager }
export { LocalAppTrustStore as RuntimeTrustStore }
export { inspectLocalAppDirectory as inspectRuntimeDirectory }
export { canonicalizeLocalAppRoot as canonicalizeRuntimeRoot }

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch { return true }
    await waitWithAbort(50).catch(() => undefined)
  }
  try { process.kill(pid, 0); return false } catch { return true }
}

async function waitChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    waitWithAbort(timeoutMs).catch(() => undefined),
  ])
}

function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runtimeBridgeExecutable(): string {
  // In regular Node tests/processes, execPath is the exact interpreter that
  // loaded this module.  Electron's execPath is the Electron binary rather
  // than a Node CLI, so prefer the interpreter npm exposes when available and
  // otherwise resolve the host's `node` from PATH (npm itself requires it).
  if (process.versions.electron) return process.env.npm_node_execpath ?? 'node'
  return process.execPath
}

async function digestFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

export class LocalAppTrustStore {
  private readonly filePath: string
  private grants = new Map<string, { canonicalRoot: string; grantedAt: number; trustStatus: 'trusted' | 'revoked'; revokedAt?: number }>()
  private loaded = false

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'local-app-trust.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const value of raw) {
        if (!isRecord(value) || typeof value.canonicalRoot !== 'string') continue
        if (value.trustStatus !== 'trusted' && value.trustStatus !== 'revoked') continue
        this.grants.set(value.canonicalRoot, {
          canonicalRoot: value.canonicalRoot,
          grantedAt: typeof value.grantedAt === 'number' ? value.grantedAt : Date.now(),
          trustStatus: value.trustStatus,
          revokedAt: typeof value.revokedAt === 'number' ? value.revokedAt : undefined,
        })
      }
    } catch { /* first run or malformed store: treat as empty */ }
  }

  isTrusted(canonicalRoot: string): boolean {
    return this.grants.get(canonicalRoot)?.trustStatus === 'trusted'
  }

  async grant(canonicalRoot: string): Promise<void> {
    await this.load()
    this.grants.set(canonicalRoot, { canonicalRoot, grantedAt: Date.now(), trustStatus: 'trusted' })
    await this.save()
  }

  async revoke(canonicalRoot: string): Promise<void> {
    await this.load()
    const current = this.grants.get(canonicalRoot)
    this.grants.set(canonicalRoot, { canonicalRoot, grantedAt: current?.grantedAt ?? Date.now(), trustStatus: 'revoked', revokedAt: Date.now() })
    await this.save()
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify([...this.grants.values()], null, 2)}\n`, 'utf8')
  }
}
