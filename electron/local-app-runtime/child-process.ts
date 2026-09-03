import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { LOCAL_APP_RUNTIME_DEFAULTS } from './defaults'
import { waitWithAbort } from './loopback'

export type RuntimeProcess = ChildProcess & { pid: number }

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

export function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

export function runtimeBridgeExecutable(): string {
  // In regular Node tests/processes, execPath is the exact interpreter that
  // loaded this module.  Electron's execPath is the Electron binary rather
  // than a Node CLI, so prefer the interpreter npm exposes when available and
  // otherwise resolve the host's `node` from PATH (npm itself requires it).
  if (process.versions.electron) return process.env.npm_node_execpath ?? 'node'
  return process.execPath
}

/**
 * How one supervised child ended. Nothing here rejects: an error, a timeout
 * and an abort are outcomes the caller decides about, not exceptions it has
 * to guess at.
 */
export type RuntimeChildExit = {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
  timedOut?: true
  aborted?: true
}

export type RuntimeChildSpec = {
  executable: string
  args: readonly string[]
  cwd: string
  /** Merged on top of the host allowlist; nothing else reaches the child. */
  env?: Record<string, string>
  /** Only the liveness bridge owns an IPC channel back to Main. */
  ipc?: boolean
  onLine?: (stream: 'stdout' | 'stderr', chunk: string) => void
}

export type RuntimeChildOptions = {
  spawn?: typeof spawn
  hostEnv?: NodeJS.ProcessEnv
  termTimeoutMs?: number
  killTimeoutMs?: number
}

/**
 * One supervised npm child. It owns the whole protocol every Runtime spawn
 * used to repeat: the env allowlist, the fixed stdio/detached shape, line
 * capture, one settle-once exit semantics, and bounded termination. Callers
 * state what to run and read a single exit result.
 */
export class RuntimeChildProcess {
  private readonly termTimeoutMs: number
  private readonly killTimeoutMs: number

  private constructor(readonly process: RuntimeProcess, options: RuntimeChildOptions) {
    this.termTimeoutMs = options.termTimeoutMs ?? LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs
    this.killTimeoutMs = options.killTimeoutMs ?? LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs
  }

  /** Spawn now. A spawn failure propagates exactly as `spawn` reports it. */
  static run(spec: RuntimeChildSpec, options: RuntimeChildOptions = {}): RuntimeChildProcess {
    const child = (options.spawn ?? spawn)(spec.executable, [...spec.args], {
      cwd: spec.cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: { ...buildAllowedRuntimeEnv(options.hostEnv ?? process.env), ...spec.env },
      stdio: spec.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    }) as RuntimeProcess
    const handle = new RuntimeChildProcess(child, options)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    if (spec.onLine) {
      const onLine = spec.onLine
      child.stdout?.on('data', (chunk: string) => onLine('stdout', chunk))
      child.stderr?.on('data', (chunk: string) => onLine('stderr', chunk))
    }
    return handle
  }

  onceError(listener: (error: unknown) => void): void {
    this.process.once('error', listener)
  }

  onceExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.process.once('exit', listener)
  }

  /**
   * Settle on the first of error / exit / close, or on the caller's abort or
   * timeout. Abort and timeout terminate the process tree before settling, so
   * an abandoned operation never leaves an npm subtree behind.
   */
  awaitExit(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RuntimeChildExit> {
    const child = this.process
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: RuntimeChildExit) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const stopThenFinish = (result: RuntimeChildExit) => {
        void this.terminate().finally(() => finish(result))
      }
      const onAbort = () => stopThenFinish({ code: null, signal: 'SIGTERM', aborted: true })
      child.once('error', (error) => finish({ code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) }))
      child.once('exit', (code, childSignal) => finish({ code, signal: childSignal }))
      child.once('close', (code, childSignal) => finish({ code, signal: childSignal }))
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => stopThenFinish({ code: null, signal: 'SIGTERM', timedOut: true }), options.timeoutMs)
      }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  terminate(): Promise<void> {
    return terminateProcessTree(this.process, this.termTimeoutMs, this.killTimeoutMs)
  }
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
  termTimeoutMs: number = LOCAL_APP_RUNTIME_DEFAULTS.termTimeoutMs,
  killTimeoutMs: number = LOCAL_APP_RUNTIME_DEFAULTS.killTimeoutMs,
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
