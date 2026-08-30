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
  RuntimeServeOverride,
  RuntimeServeScript,
  RuntimeStaticDeclaration,
} from '../../src/components/types'
import type { RuntimeRootLease, RuntimeRootLeaseAcquireResult, RuntimeScopeId } from '../../src/runtime-development-contract'
import {
  applyServeOverride,
  detectRuntimeServePlan,
  findDetectedStaticArtifact,
  fingerprintStaticSource,
  serverServePlan,
  parseAgentOSStaticDeclaration,
  type RuntimeServePlan,
  RuntimeBuildCommitFenceRejectedError,
  StaticArtifactStore,
  StaticPreviewRegistry,
  staticPreviewUrl,
  type StaticOutputValidation,
  validateStaticOutput,
} from './static'
import type { RuntimeEditCoordinator, RuntimeEditIntent } from '../runtime-edit-coordinator'
import { RuntimeRootExecutionRegistry } from '../runtime-root-execution-registry'

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

export const PROJECT_AGENTOS_RUNTIME_DIRECTORY = '.agentos'

/** Main-owned lexical location for a project's embedded Runtime. */
export function projectRuntimeRoot(projectPath: string): string {
  return path.join(path.resolve(projectPath), PROJECT_AGENTOS_RUNTIME_DIRECTORY)
}

/** Reject a canonical .agentos directory that escapes through a symlink. */
export function isContainedInProject(projectRealRoot: string, canonicalRoot: string): boolean {
  const projectRoot = path.resolve(projectRealRoot)
  const runtimeRoot = path.resolve(canonicalRoot)
  return runtimeRoot === projectRoot || runtimeRoot.startsWith(`${projectRoot}${path.sep}`)
}

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
      hasBuildScript: boolean
      hasStartScript: boolean
      mode: 'development' | 'static'
      agentos?: RuntimeStaticDeclaration
      /** How this directory can be viewed today (`C-RSM-402`). */
      servePlan: RuntimeServePlan
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

export type RuntimeManagerOptions = RuntimeSupervisorOptions & {
  rootExecutionRegistry?: RuntimeRootExecutionRegistry
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

export async function inspectLocalAppDirectory(
  rootPath: string,
  serveOverride?: RuntimeServeOverride,
): Promise<LocalAppInspectResult> {
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
    const hasDevScript = Boolean(scripts && typeof scripts.dev === 'string' && scripts.dev.trim())
    const hasBuildScript = Boolean(scripts && typeof scripts.build === 'string' && scripts.build.trim())
    const hasStartScript = Boolean(scripts && typeof scripts.start === 'string' && scripts.start.trim())
    // `C-RSM-401`: how a Runtime is viewed comes from directory facts, not from
    // the project declaring itself. A missing dev script is only fatal when the
    // directory offers no other way to be served.
    const servePlan = applyServeOverride(
      await detectRuntimeServePlan({
        canonicalRoot,
        declaration: staticDeclaration.declaration,
        hasBuildScript,
        hasStartScript,
        hasDevScript,
      }),
      serveOverride,
      { hasBuildScript, hasStartScript, hasDevScript },
    )
    if (servePlan.kind === 'unsupported') {
      return { ok: false, rootPath, code: 'dev-script-missing', message: 'package.json 缺少可用的 dev 或 build 脚本' }
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
      hasDevScript,
      hasBuildScript,
      hasStartScript,
      // `mode` and `agentos` stay the shape every existing caller reads; they
      // are now derived from the serve plan instead of from the declaration
      // alone, so a detected artifact serves exactly like a declared one.
      mode: servePlan.kind === 'development' || servePlan.kind === 'production' ? 'development' : 'static',
      agentos: servePlan.kind === 'artifact' || servePlan.kind === 'buildable' ? servePlan.declaration : undefined,
      servePlan,
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
    manager: Pick<LocalAppRuntimeManager, 'register' | 'start' | 'release' | 'build' | 'cancelBuild'>
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
    const developmentDefinition: LocalAppDefinition = inspected.mode === 'static'
      ? { ...definition, mode: 'development', agentos: undefined, serveScript: 'dev' }
      : { ...definition, mode: 'development', serveScript: 'dev' }
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
    const inspection = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
    if (inspection.ok && inspection.mode === 'static') {
      return this.start({ ...definition, mode: 'static', agentos: inspection.agentos }, consumerIds, options)
    }
    if (!inspection.ok && inspection.code === 'static-declaration-invalid') {
      // A legacy persisted definition may encounter a newly declared but
      // malformed `agentos` block. It must surface the strict parse failure;
      // silently falling back to npm run dev would bypass the static contract.
      return this.start({ ...definition, mode: 'static', agentos: undefined }, consumerIds, options)
    }
    // Legacy definitions remain server-backed runtimes. Setting the explicit
    // mode avoids another inspection pass; the plan decides whether that means
    // the production server or the dev server.
    const serveScript = inspection.ok && inspection.servePlan.kind === 'production' ? 'start' as const : 'dev' as const
    return this.start({ ...definition, mode: 'development', serveScript }, consumerIds, options)
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

  async build(definition: LocalAppDefinition, consumerIds: Iterable<string> = [], options: RuntimeBuildOptions = {}): Promise<LocalAppRuntimeSnapshot> {
    const previous = this.buildLocks.get(definition.id) ?? Promise.resolve()
    const operation = previous.then(() => this.buildOnce(definition, consumerIds, options))
    this.buildLocks.set(definition.id, operation.then(() => undefined, () => undefined))
    return operation
  }

  private async buildOnce(definition: LocalAppDefinition, consumerIds: Iterable<string> = [], options: RuntimeBuildOptions = {}): Promise<LocalAppRuntimeSnapshot> {
    if (!definition.mode) {
      const inspection = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
      if (inspection.ok && inspection.mode === 'static') {
        return this.buildOnce({ ...definition, mode: 'static', agentos: inspection.agentos }, consumerIds, options)
      }
    }
    if (definition.mode !== 'static') {
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
    const inspection = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
    if (!inspection.ok) return this.fail(runtime, inspection.code, inspection.message, 'inspect')
    if (inspection.mode !== 'static') return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    if (!inspection.agentos && inspection.servePlan.kind !== 'buildable') {
      return this.fail(runtime, 'static-declaration-invalid', 'Runtime 声明不是静态模式', 'inspect')
    }
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
    const operation = this.runStaticBuild(runtime, inspection.canonicalRoot, inspection.agentos ?? null, buildId, operationId, buildController.signal, options)
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
    declared: RuntimeStaticDeclaration | null,
    buildId: string,
    operationId: string,
    signal: AbortSignal,
    options: RuntimeBuildOptions,
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
    // `C-RSM-402` tier ②: without a declared output root, the build itself is
    // what reveals it. Detection runs once, after a successful build.
    let declaration = declared
    if (!declaration) {
      declaration = await findDetectedStaticArtifact(canonicalRoot)
      if (!operationStillOwnsRuntime()) return runtime.snapshot
      if (!declaration) {
        runtime.snapshot = {
          ...runtime.snapshot,
          status: 'build_failed',
          buildStatus: 'build_failed',
          errorCode: 'build-produces-no-artifact',
          detail: '构建没有产出可直接打开的静态页面',
          updatedAt: this.now(),
          logs: this.recentLogs(runtime),
        }
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
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
      const artifact = await this.staticArtifactStore.commit(runtime.definition.id, canonicalRoot, declaration, outputRoot, fingerprint, signal, options.beforeCommit)
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
      if (error instanceof RuntimeBuildCommitFenceRejectedError) {
        this.restoreStaticBuildAfterCancellation(runtime)
        this.emit(runtime, 'status', { buildId, operationId })
        return runtime.snapshot
      }
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
    // `C-RSM-402` tier ②/④: the same supervised bridge runs either the
    // production server or the dev server. Only the fixed script and NODE_ENV
    // differ, and the dev-only Turbopack retry never applies to `start`.
    const production = runtime.definition.serveScript === 'start'
    const npmArgs = production ? ['run', 'start'] : runtimeDevCommandArgs(runtime.logs)
    const child = this.spawnProcess(runtimeBridgeExecutable(), ['-e', createRuntimeLivenessBridgeSource(this.defaults.termTimeoutMs, this.defaults.killTimeoutMs, npmArgs)], {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: {
        ...buildAllowedRuntimeEnv(this.env),
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: production ? 'production' : 'development',
      },
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
  private readonly definitions = new Map<string, LocalAppDefinition>()
  private readonly consumers = new Map<string, Set<string>>()
  private readonly leaseByDefinition = new Map<string, RuntimeRootLease>()
  private readonly leaseGenerationByDefinition = new Map<string, number>()
  private readonly pendingLeaseGeneration = new Map<string, number>()
  private readonly pendingDefinitionStops = new Map<string, Promise<void>>()
  private readonly buildOperations = new Map<string, Promise<LocalAppRuntimeSnapshot>>()
  private readonly listeners = new Set<(event: LocalAppRuntimeEvent) => void>()
  private readonly sharedRootJoins = new Map<string, SharedRootJoin>()
  private readonly lastProjectedGeneration = new Map<string, number>()
  private readonly now: () => number
  private readonly externalOnEvent?: (event: LocalAppRuntimeEvent) => void

  constructor(options: RuntimeManagerOptions = {}) {
    this.rootExecutionRegistry = options.rootExecutionRegistry ?? new RuntimeRootExecutionRegistry()
    this.now = options.now ?? Date.now
    this.externalOnEvent = options.onEvent
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
      const existingLease = this.leaseByDefinition.get(definition.id)
      const pending = this.sharedRootJoins.has(definition.id)
        // A borrowed Runtime owns neither lease nor process: leaving is the stop.
        ? this.leaveSharedRoot(definition.id).then(() => undefined)
        : existingLease
        ? this.rootExecutionRegistry.stopAndRelease(existingLease, () => this.supervisor.stop(definition.id, 'user')).then((result) => {
            if (!result.ok) throw result.error.cause
            if (this.leaseByDefinition.get(definition.id)?.leaseId === existingLease.leaseId) this.leaseByDefinition.delete(definition.id)
          })
        : this.supervisor.stop(definition.id, 'user').then(() => undefined)
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
    // allowed to outrank what the directory says today.
    const inspected = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
    const effectiveDefinition = inspected?.ok
      ? {
          ...definition,
          mode: inspected.mode,
          agentos: inspected.agentos,
          canonicalRoot: inspected.canonicalRoot,
        }
      : definition
    // A forced script (an AI editing session) wins; otherwise the plan decides
    // whether keeping this Runtime running means `start` or `dev`.
    const plan = inspected.ok ? inspected.servePlan : null
    const serveScript: RuntimeServeScript | undefined = definition.serveScript
      ?? (plan?.kind === 'production' ? 'start' : plan?.kind === 'development' ? 'dev' : undefined)
    const servedDefinition = serveScript
      ? { ...effectiveDefinition, mode: 'development' as const, agentos: undefined, serveScript }
      : effectiveDefinition
    const isDevelopment = servedDefinition.mode === 'development'
    if (isDevelopment) {
      // The root stays a single execution mutex. A second definition pointed
      // at the same directory (a Workspace Tab and the owning project's
      // Runtime page) borrows the live instance as one more consumer instead
      // of failing the whole start with a root conflict.
      const shared = await this.joinSharedRoot(servedDefinition, consumerId)
      if (shared) return shared
      await this.acquireExecutionLease(servedDefinition, 'development')
    } else {
      await this.leaveSharedRoot(localAppId)
    }

    const consumers = this.consumers.get(localAppId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(localAppId, consumers)
    for (const id of consumers) this.supervisor.attachConsumer(localAppId, id)

    if (!isDevelopment) await this.releaseDevelopmentLeaseBeforeStaticStart(localAppId)
    try {
      // 静态 Preview 本身不占 lease；首次缺少 last-good 时再由 build() 单独取得瞬时 build lease。
      const snapshot = await this.supervisor.start(servedDefinition, consumers, isDevelopment ? options : { ...options, autoBuild: false })
      if (isDevelopment && snapshot.status !== 'running' && snapshot.status !== 'starting' && snapshot.status !== 'preparing') {
        await this.stopAndReleaseExecutionLease(localAppId, () => this.supervisor.stop(localAppId, 'error'))
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
          { ...effectiveDefinition, mode: 'development' as const, agentos: undefined, serveScript: fallback.kind === 'production' ? 'start' : 'dev' },
          consumerId,
          options,
        )
      }
      if (!isDevelopment && snapshot.errorCode === 'build-produces-no-artifact') {
        const served = serveAsServer()
        if (served) return served
      }
      if (!isDevelopment && options.autoBuild !== false && snapshot.mode === 'static' && snapshot.buildStatus === 'build_required') {
        const built = await this.build(localAppId, consumerId)
        if (built.errorCode === 'build-produces-no-artifact') {
          const served = serveAsServer()
          if (served) return served
        }
        return built
      }
      return snapshot
    } catch (error) {
      if (isDevelopment) await this.stopAndReleaseExecutionLease(localAppId, () => this.supervisor.stop(localAppId, 'error')).catch(() => undefined)
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
  ): Promise<LocalAppRuntimeSnapshot> {
    const shared = await this.joinSharedRoot(definition, consumerId)
    if (shared) return shared
    await this.acquireExecutionLease(definition, 'development')
    const consumers = this.consumers.get(localAppId) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(localAppId, consumers)
    try {
      const snapshot = await this.supervisor.start(definition, consumers, options)
      if (snapshot.status !== 'running' && snapshot.status !== 'starting' && snapshot.status !== 'preparing') {
        await this.stopAndReleaseExecutionLease(localAppId, () => this.supervisor.stop(localAppId, 'error'))
      }
      return snapshot
    } catch (error) {
      await this.stopAndReleaseExecutionLease(localAppId, () => this.supervisor.stop(localAppId, 'error')).catch(() => undefined)
      throw error
    }
  }

  async stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    // Stopping a borrowed Runtime means leaving it: this definition owns no
    // process, so the holder and every other viewer keep running.
    const left = await this.leaveSharedRoot(localAppId, reason)
    if (left) return left
    const lease = this.leaseByDefinition.get(localAppId)
    if (!lease) return this.supervisor.stop(localAppId, reason)
    let snapshot: LocalAppRuntimeSnapshot | null = this.supervisor.snapshot(localAppId)
    const result = await this.rootExecutionRegistry.stopAndRelease(lease, async () => {
      snapshot = await this.supervisor.stop(localAppId, reason)
    })
    if (!result.ok) throw result.error.cause
    if (this.leaseByDefinition.get(localAppId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(localAppId)
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

  build(localAppId: string, consumerId?: string, options: RuntimeBuildOptions = {}): Promise<LocalAppRuntimeSnapshot> {
    const existingOperation = this.buildOperations.get(localAppId)
    if (existingOperation) {
      if (options.beforeCommit) return Promise.reject(new Error('runtime-build-already-active'))
      return existingOperation
    }
    const definition = this.definitions.get(localAppId)
    if (!definition) return Promise.reject(new Error('local-app-definition-missing'))
    if (definition.trustStatus !== 'trusted') return Promise.reject(new Error('local-app-trust-required'))
    const operation = this.buildWithExecutionLease(definition, consumerId, options).finally(() => {
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
    const lease = this.leaseByDefinition.get(localAppId)
    if (!lease) return this.supervisor.detachConsumer(localAppId, consumerId)
    let snapshot: LocalAppRuntimeSnapshot | null = this.supervisor.snapshot(localAppId)
    const result = await this.rootExecutionRegistry.stopAndRelease(lease, async () => {
      snapshot = await this.supervisor.detachConsumer(localAppId, consumerId)
    })
    if (!result.ok) throw result.error.cause
    if (this.leaseByDefinition.get(localAppId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(localAppId)
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
    return this.acquireExecutionLease(definition, 'development')
  }

  async releaseDevelopmentLease(localAppId: string, expectedLease?: RuntimeRootLease): Promise<void> {
    const lease = expectedLease ?? this.leaseByDefinition.get(localAppId)
    if (!lease || lease.kind !== 'development') return
    const result = await this.rootExecutionRegistry.release(lease)
    if (!result.ok) throw result.error.cause
    if (this.leaseByDefinition.get(localAppId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(localAppId)
  }

  private async buildWithExecutionLease(definition: LocalAppDefinition, consumerId?: string, options: RuntimeBuildOptions = {}): Promise<LocalAppRuntimeSnapshot> {
    const consumers = this.consumers.get(definition.id) ?? new Set<string>()
    if (consumerId) consumers.add(consumerId)
    this.consumers.set(definition.id, consumers)
    let buildLease: RuntimeRootLease
    const developmentLease = this.leaseByDefinition.get(definition.id)
    if (developmentLease?.kind === 'development') {
      const transition = await this.rootExecutionRegistry.transitionDevelopmentToBuild(
        developmentLease,
        () => this.supervisor.stop(definition.id, 'user'),
      )
      if (!transition.ok) {
        throw transition.error.code === 'runtime-root-transition-failed'
          ? transition.error.cause
          : new Error(transition.error.code)
      }
      buildLease = transition.lease
      this.leaseByDefinition.set(definition.id, buildLease)
    } else {
      buildLease = await this.acquireExecutionLease(definition, 'build')
    }
    try {
      return await this.supervisor.build(definition, consumers, options)
    } finally {
      const released = await this.rootExecutionRegistry.release(buildLease)
      if (released.ok && this.leaseByDefinition.get(definition.id)?.leaseId === buildLease.leaseId) {
        this.leaseByDefinition.delete(definition.id)
      }
    }
  }

  private async acquireExecutionLease(definition: LocalAppDefinition, kind: RuntimeRootLease['kind']): Promise<RuntimeRootLease> {
    const current = this.leaseByDefinition.get(definition.id)
    let generation = current?.generation ?? this.pendingLeaseGeneration.get(definition.id)
    if (generation === undefined) {
      generation = (this.leaseGenerationByDefinition.get(definition.id) ?? 0) + 1
      this.leaseGenerationByDefinition.set(definition.id, generation)
      this.pendingLeaseGeneration.set(definition.id, generation)
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
    const result = await this.rootExecutionRegistry.acquire({
      canonicalRoot,
      runtimeDefinitionId: definition.id,
      runtimeScopeId: runtimeScopeForDefinition(definition),
      kind,
      generation,
    })
    if (!result.ok) throw runtimeRootAcquireError(result)
    this.pendingLeaseGeneration.delete(definition.id)
    this.leaseByDefinition.set(definition.id, result.lease)
    return result.lease
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

  private async releaseDevelopmentLeaseBeforeStaticStart(definitionId: string): Promise<void> {
    const lease = this.leaseByDefinition.get(definitionId)
    if (!lease || lease.kind !== 'development') return
    const result = await this.rootExecutionRegistry.stopAndRelease(lease, () => this.supervisor.stop(definitionId, 'user'))
    if (!result.ok) throw result.error.cause
    if (this.leaseByDefinition.get(definitionId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(definitionId)
  }

  private async stopAndReleaseExecutionLease(definitionId: string, stop: () => Promise<unknown>): Promise<void> {
    const lease = this.leaseByDefinition.get(definitionId)
    if (!lease) return
    const result = await this.rootExecutionRegistry.stopAndRelease(lease, stop)
    if (!result.ok) throw result.error.cause
    if (this.leaseByDefinition.get(definitionId)?.leaseId === lease.leaseId) this.leaseByDefinition.delete(definitionId)
  }
}

function runtimeScopeForDefinition(definition: LocalAppDefinition): RuntimeScopeId {
  return definition.owner?.kind === 'project'
    ? `project:${definition.owner.projectId}`
    : `workspace:${definition.id}`
}

function runtimeRootAcquireError(result: Extract<RuntimeRootLeaseAcquireResult, { ok: false }>): Error {
  const error = new Error(result.error.code)
  Object.assign(error, { code: result.error.code, conflictingLease: result.error.conflictingLease })
  return error
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
