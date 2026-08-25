/**
 * Local App runtime supervisor. 只有 Main 能调用这里的进程能力；renderer 只能通过
 * named Desktop Seam 传入 Local App id 和受信定义，不能传 executable/args/env/URL。
 */

import { createHash } from 'node:crypto'
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
} from '../../src/components/types'

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
  onEvent?: (event: LocalAppRuntimeEvent) => void
}

type RuntimeProcess = ChildProcess & { pid: number }

type ActiveRuntime = {
  definition: LocalAppDefinition
  snapshot: LocalAppRuntimeSnapshot
  process?: RuntimeProcess
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
    const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : undefined
    if (!scripts || typeof scripts.dev !== 'string' || !scripts.dev.trim()) {
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
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'path-missing' : 'invalid-root'
    return { ok: false, rootPath, code, message: code === 'path-missing' ? 'Runtime 目录不存在' : 'Runtime 目录不可用' }
  }
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
  private preparationRecordLoaded = false
  private preparationRecordLoadPromise: Promise<void> | null = null
  private preparationRecordSavePromise: Promise<void> = Promise.resolve()
  private readonly onEvent?: (event: LocalAppRuntimeEvent) => void
  private readonly runtimes = new Map<string, ActiveRuntime>()
  private readonly generationByApp = new Map<string, number>()

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

  start(definition: LocalAppDefinition, consumerIds: Iterable<string> = []): Promise<LocalAppRuntimeSnapshot> {
    const existing = this.runtimes.get(definition.id)
    if (existing?.operation) return existing.operation
    if (existing?.snapshot.status === 'running' || existing?.snapshot.status === 'starting' || existing?.snapshot.status === 'preparing') {
      return Promise.resolve(existing.snapshot)
    }
    const generation = (this.generationByApp.get(definition.id) ?? 0) + 1
    this.generationByApp.set(definition.id, generation)
    const runtime: ActiveRuntime = {
      definition,
      snapshot: this.createSnapshot(definition.id, generation, 'preparing'),
      controller: new AbortController(),
      logs: [],
      consumerIds: new Set(consumerIds),
    }
    this.runtimes.set(definition.id, runtime)
    const operation = this.startRuntime(runtime).finally(() => {
      if (runtime.operation === operation) runtime.operation = undefined
    })
    runtime.operation = operation
    return operation
  }

  async stop(localAppId: string, reason: LocalAppRuntimeSnapshot['stopReason'] = 'user'): Promise<LocalAppRuntimeSnapshot | null> {
    const runtime = this.runtimes.get(localAppId)
    if (!runtime) return null
    runtime.controller.abort()
    const process = runtime.process
    runtime.snapshot = { ...runtime.snapshot, status: 'stopped', stopReason: reason, updatedAt: this.now(), readyUrl: undefined, port: undefined, logs: this.recentLogs(runtime) }
    this.emit(runtime, 'status')
    if (process) await terminateProcessTree(process, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
    runtime.process = undefined
    runtime.operation = undefined
    return runtime.snapshot
  }

  async restart(definition: LocalAppDefinition, consumerIds?: Iterable<string>): Promise<LocalAppRuntimeSnapshot> {
    const preservedConsumers = consumerIds ?? this.runtimes.get(definition.id)?.consumerIds ?? []
    await this.stop(definition.id, 'user')
    return this.start(definition, preservedConsumers)
  }

  async stopAll(reason: LocalAppRuntimeSnapshot['stopReason'] = 'app-quit', timeoutMs = this.defaults.quitCleanupTimeoutMs): Promise<void> {
    const work = Promise.all([...this.runtimes.keys()].map((id) => this.stop(id, reason))).then(() => undefined)
    await Promise.race([work, waitWithAbort(timeoutMs).catch(() => undefined)])
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
      runtime.snapshot = { ...runtime.snapshot, status: 'starting', phase: 'start', updatedAt: this.now(), logs: this.recentLogs(runtime) }
      this.emit(runtime, 'status')
      let lastError = 'readiness_timeout'
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
          await terminateProcessTree(process, this.defaults.termTimeoutMs, this.defaults.killTimeoutMs)
          runtime.process = undefined
          if (lastError !== 'process-exited' || crashAttempt >= this.defaults.crashRetryCount) break
          const delay = this.defaults.crashRetryDelaysMs[Math.min(crashAttempt, this.defaults.crashRetryDelaysMs.length - 1)] ?? 0
          await this.sleep(delay, runtime.controller.signal).catch(() => undefined)
        }
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
    const child = this.spawnProcess(npmExecutable(), ['run', 'dev'], {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...buildAllowedRuntimeEnv(this.env), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as RuntimeProcess
    runtime.snapshot = { ...runtime.snapshot, startedAt: this.now(), port, updatedAt: this.now() }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.captureLog(runtime, 'stdout', chunk))
    child.stderr?.on('data', (chunk: string) => this.captureLog(runtime, 'stderr', chunk))
    child.once('exit', (code, signal) => {
      if (runtime.process !== child || runtime.controller.signal.aborted) return
      runtime.process = undefined
      const exitDetail = `开发服务退出 (${code ?? signal ?? 'unknown'})`
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
    return this.fail(runtime, runtime.snapshot.errorCode ?? 'process-exited', '开发服务崩溃后重试失败', 'readiness')
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
      if (runtime.snapshot.errorCode === 'process-exited' || process.exitCode !== null || process.signalCode !== null) {
        runtime.snapshot = { ...runtime.snapshot, errorCode: 'process-exited', detail: `进程提前退出 (${process.exitCode ?? process.signalCode ?? 'unknown'})`, updatedAt: this.now() }
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

  private emit(runtime: ActiveRuntime, type: LocalAppRuntimeEvent['type'], detail: Partial<LocalAppRuntimeEvent> = {}): void {
    this.onEvent?.({
      type,
      localAppId: runtime.snapshot.localAppId,
      runtimeId: runtime.snapshot.runtimeId,
      generation: runtime.snapshot.generation,
      status: runtime.snapshot.status,
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

  async start(localAppId: string, consumerId?: string): Promise<LocalAppRuntimeSnapshot> {
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
    return this.supervisor.start(ownerDefinition, consumers)
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
  const normalized = (definition.canonicalRoot ?? definition.rootPath).replace(/\\/g, '/').replace(/\/+$/, '')
  const comparable = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return `${comparable}|npm run dev`
}

export async function terminateProcessTree(
  child: { pid?: number | null; killed?: boolean; kill?: (signal?: NodeJS.Signals | number) => boolean },
  termTimeoutMs = LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs,
  killTimeoutMs = LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs,
): Promise<void> {
  const pid = child.pid
  if (!pid || pid <= 0) return
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    await waitChildExit(taskkill, termTimeoutMs + killTimeoutMs)
    return
  }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already stopped */ } }
  if (await waitForPidExit(pid, termTimeoutMs)) return
  try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ } }
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
