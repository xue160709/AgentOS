import { LOCAL_APP_RUNTIME_DEFAULTS, type RuntimeLogEntry } from './defaults'

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

export function createRuntimeLivenessBridgeSource(termTimeoutMs: number, killTimeoutMs: number, npmArgs: readonly string[]): string {
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
