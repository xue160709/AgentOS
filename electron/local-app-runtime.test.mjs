import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { once } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

const runtime = loadTsModule(resolve(testDir, './local-app-runtime/index.ts'))

function definition(rootPath) {
  return {
    id: 'local-app-test', name: 'Fixture', rootPath, canonicalRoot: rootPath,
    packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] },
    trustStatus: 'trusted', autoStart: true, createdAt: 1, updatedAt: 1,
  }
}

test('Next Turbopack config conflict retries through the scoped webpack compatibility switch', () => {
  assert.deepEqual(runtime.runtimeDevCommandArgs([]), ['run', 'dev'])
  assert.deepEqual(runtime.runtimeDevCommandArgs([
    { stream: 'stdout', line: 'empty turbopack config in your Next config file', timestamp: 1 },
  ]), ['run', 'dev'])
  assert.deepEqual(runtime.runtimeDevCommandArgs([
    { stream: 'stderr', line: "empty turbopack config in your Next config file (e.g. `turbopack: {}`).", timestamp: 1 },
  ]), ['run', 'dev', '--', '--webpack'])
})

test('Project Runtime root is derived from the project and rejects a canonical symlink escape', () => {
  const projectRoot = mkdtempSync(`${tmpdir()}/project-runtime-root-`)
  const outsideRoot = mkdtempSync(`${tmpdir()}/project-runtime-outside-`)
  const runtimeLink = resolve(projectRoot, '.agentos')
  symlinkSync(outsideRoot, runtimeLink, 'dir')

  assert.equal(runtime.projectRuntimeRoot(projectRoot), runtimeLink)
  assert.equal(runtime.isContainedInProject(realpathSync(projectRoot), realpathSync(runtimeLink)), false)
  const canonicalProjectRoot = realpathSync(projectRoot)
  assert.equal(runtime.isContainedInProject(canonicalProjectRoot, resolve(canonicalProjectRoot, '.agentos-real')), true)
})

async function waitForPath(path, { present = true, timeoutMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path) === present) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(existsSync(path), present, `${present ? 'expected' : 'expected no'} path: ${path}`)
}

function readPid(path) {
  const value = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
  assert.ok(Number.isInteger(value) && value > 0, `expected PID evidence at ${path}`)
  return value
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(isPidAlive(pid), false, `expected PID to exit: ${pid}`)
}

async function waitForChildExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    let timer
    const finish = () => {
      if (timer) clearTimeout(timer)
      child.removeListener('exit', finish)
      resolve()
    }
    timer = setTimeout(finish, timeoutMs)
    child.once('exit', finish)
  })
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'expected child to exit')
}

async function cleanupOwnedRuntimeFixture(supervisor, bridgeChildren, ownedPids) {
  await supervisor.stopAll('app-quit').catch(() => undefined)
  for (const child of bridgeChildren) {
    await runtime.terminateProcessTree(child, 500, 500).catch(() => undefined)
    await waitForChildExit(child, 1_500).catch(() => undefined)
  }
  for (const pid of ownedPids) {
    if (!isPidAlive(pid)) continue
    try { process.kill(pid, 'SIGTERM') } catch { /* already stopped */ }
  }
  for (const pid of ownedPids) {
    await waitForPidGone(pid, 1_000).catch(async () => {
      try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
      await waitForPidGone(pid, 1_000)
    })
  }
}

function writeOwnedProcessFixture(root) {
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({
    name: 'runtime-bridge-fixture',
    scripts: { dev: 'node server.mjs owned' },
  }))
  writeFileSync(resolve(root, 'server.mjs'), `
import fs from 'node:fs'
import path from 'node:path'

const role = process.argv[2] || 'owned'
const pidPath = path.join(process.cwd(), '.' + role + '-pid')
const lockPath = path.join(process.cwd(), '.' + role + '-lock')
const parentPidPath = path.join(process.cwd(), '.' + role + '-parent-pid')
let stopping = false
function cleanup() {
  try { fs.unlinkSync(lockPath) } catch {}
  try { fs.unlinkSync(pidPath) } catch {}
  try { fs.unlinkSync(parentPidPath) } catch {}
}
function stop() {
  if (stopping) return
  stopping = true
  cleanup()
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
process.once('SIGHUP', stop)
process.once('exit', cleanup)
fs.writeFileSync(pidPath, String(process.pid) + '\\n')
fs.writeFileSync(lockPath, 'held\\n')
fs.writeFileSync(parentPidPath, String(process.ppid) + '\\n')
setInterval(() => {}, 1000)
`)
}

async function cleanupChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit').catch(() => undefined)
}

test('Local App runtime accepts only loopback readiness URLs and filters env', () => {
  assert.equal(runtime.normalizeLoopbackUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/')
  assert.equal(runtime.normalizeLoopbackUrl('http://0.0.0.0:5173/'), null)
  assert.equal(runtime.parseLoopbackReadyUrl('ready at http://localhost:43123/docs'), 'http://localhost:43123/docs')
  const env = runtime.buildAllowedRuntimeEnv({ PATH: '/bin', HOME: '/tmp', npm_config_user_agent: 'secret', API_TOKEN: 'secret' })
  assert.deepEqual(env, { PATH: '/bin', HOME: '/tmp' })
})

test('Local App inspect validates package and lock/node_modules facts without running code', () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node server.js' } }))
  writeFileSync(resolve(root, 'package-lock.json'), '{}')
  return runtime.inspectLocalAppDirectory(root).then((result) => {
    assert.equal(result.ok, true)
    assert.equal(result.hasLockfile, true)
    assert.equal(result.nodeModulesPresent, true)
    return runtime.inspectLocalAppDirectory(resolve(root, 'missing'))
  }).then((missing) => assert.equal(missing.code, 'path-missing'))
})

test('Runtime supervisor starts with dynamic port, emits scoped events, and stops idempotently', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  const events = []
  const children = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 43217,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (executable, args, options) => {
      const child = new EventEmitter()
      child.pid = 999999
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}
      child.stderr.setEncoding = () => {}
      children.push({ executable, args, options, child })
      queueMicrotask(() => child.stdout.emit('data', 'ready: http://127.0.0.1:43217/'))
      return child
    },
    onEvent: (event) => events.push(event),
  })
  const first = await supervisor.start(definition(root))
  assert.equal(first.status, 'running')
  assert.equal(first.port, 43217)
  assert.equal(children.at(-1).args[0], '-e')
  assert.match(children.at(-1).args[1], /npmExecutable.*run.*dev/s)
  assert.equal(children.at(-1).options.shell, false)
  assert.deepEqual(children.at(-1).options.stdio, ['ignore', 'pipe', 'pipe', 'ipc'])
  assert.ok(events.every((event) => event.localAppId && event.runtimeId && Number.isInteger(event.generation) && event.timestamp))
  const stopped = await supervisor.stop('local-app-test', 'user')
  assert.equal(stopped.status, 'stopped')
  assert.equal((await supervisor.stop('local-app-test', 'user')).status, 'stopped')
})

test('Runtime supervisor fails bounded readiness without treating a live process as running', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  let ports = 0
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45000 + ports++,
    fetch: async () => ({ status: 503 }),
    defaults: { readinessTimeoutMs: 10, probeIntervalMs: 1, probeTimeoutMs: 2, maxPortAttempts: 3 },
    spawn: () => {
      const child = new EventEmitter()
      child.pid = 999998; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      return child
    },
  })
  const failed = await supervisor.start(definition(root))
  assert.equal(failed.status, 'failed')
  assert.notEqual(failed.status, 'running')
  assert.ok(ports <= 3)
})

test('Early bridge/child exit keeps process-exited at start phase and never signals an exited PID', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-exit-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  const children = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45090,
    fetch: async () => ({ status: 503 }),
    defaults: { readinessTimeoutMs: 500, probeIntervalMs: 1, probeTimeoutMs: 2, maxPortAttempts: 1, crashRetryCount: 0 },
    spawn: (executable, args, options) => {
      const child = new EventEmitter()
      child.pid = 999991
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      children.push({ executable, args, options, child })
      queueMicrotask(() => {
        child.stderr.emit('data', 'EADDRINUSE: existing dev lock held by another process\n')
        child.exitCode = 42
        child.emit('exit', 42, null)
      })
      return child
    },
  })
  const originalKill = process.kill
  let signalCalls = 0
  process.kill = (...args) => {
    signalCalls += 1
    return originalKill(...args)
  }
  try {
    const failed = await supervisor.start(definition(root))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.errorCode, 'process-exited')
    assert.equal(failed.phase, 'start')
    assert.match(failed.detail, /42|EADDRINUSE|lock/i)
    assert.equal(signalCalls, 0)
    assert.equal(children[0].args[0], '-e')
  } finally {
    process.kill = originalKill
  }
})

test('IPC disconnect only cleans the bridge-owned npm subtree and leaves an external same-directory process alive', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-bridge-`)
  writeOwnedProcessFixture(root)
  const external = spawn(process.execPath, ['server.mjs', 'external'], { cwd: root, stdio: 'ignore' })
  const bridgeChildren = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45120,
    fetch: async () => ({ status: 503 }),
    defaults: { readinessTimeoutMs: 5_000, probeIntervalMs: 5, probeTimeoutMs: 2, maxPortAttempts: 1, crashRetryCount: 0, termTimeoutMs: 3_000, killTimeoutMs: 1_000 },
    spawn: (executable, args, options) => {
      const child = spawn(executable, args, options)
      bridgeChildren.push(child)
      return child
    },
  })
  const ownedPidPath = resolve(root, '.owned-pid')
  const externalPidPath = resolve(root, '.external-pid')
  const externalLockPath = resolve(root, '.external-lock')
  const ownedParentPidPath = resolve(root, '.owned-parent-pid')
  const ownedPids = []
  try {
    await waitForPath(externalPidPath)
    const startPromise = supervisor.start(definition(root))
    await waitForPath(ownedPidPath)
    await waitForPath(ownedParentPidPath)
    ownedPids.push(readPid(ownedPidPath), readPid(ownedParentPidPath))
    assert.equal(bridgeChildren.length, 1)
    assert.equal(bridgeChildren[0].connected, true)
    bridgeChildren[0].disconnect()
    const failed = await startPromise
    assert.equal(failed.errorCode, 'process-exited')
    assert.equal(failed.phase, 'start')
    await Promise.all(ownedPids.map((pid) => waitForPidGone(pid)))
    await waitForChildExit(bridgeChildren[0])
    assert.equal(existsSync(externalLockPath), true)
    assert.doesNotThrow(() => process.kill(external.pid, 0))
  } finally {
    await cleanupOwnedRuntimeFixture(supervisor, bridgeChildren, ownedPids)
    await cleanupChild(external)
    rmSync(root, { recursive: true, force: true })
  }
})

test('development takeover terminates only the process holding this project Next lock', {
  skip: process.platform === 'win32' || spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error ? 'lsof unavailable' : false,
}, async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-next-lock-`)
  const lockDir = resolve(root, '.next', 'dev')
  const lockPath = resolve(lockDir, 'lock')
  mkdirSync(lockDir, { recursive: true })
  writeFileSync(lockPath, '')
  const lockOwner = spawn(process.execPath, ['-e', `require('node:fs').openSync(${JSON.stringify(lockPath)}, 'r'); setInterval(() => {}, 1000)`], { stdio: 'ignore' })
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: root, stdio: 'ignore' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const terminated = await runtime.terminateNextDevLockOwners(root)
    assert.deepEqual(terminated, [lockOwner.pid])
    await waitForPidGone(lockOwner.pid)
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  } finally {
    await cleanupChild(lockOwner)
    await cleanupChild(unrelated)
    rmSync(root, { recursive: true, force: true })
  }
})

test('Normal stop, stopAll, and repeated stop release the bridge-owned subtree', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-stop-`)
  writeOwnedProcessFixture(root)
  const bridgeChildren = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45130,
    fetch: async () => ({ status: 503 }),
    defaults: { readinessTimeoutMs: 5_000, probeIntervalMs: 5, probeTimeoutMs: 2, maxPortAttempts: 1, crashRetryCount: 0, termTimeoutMs: 3_000, killTimeoutMs: 1_000 },
    spawn: (executable, args, options) => {
      const child = spawn(executable, args, options)
      bridgeChildren.push(child)
      return child
    },
  })
  const app = definition(root)
  const ownedPidPath = resolve(root, '.owned-pid')
  const ownedParentPidPath = resolve(root, '.owned-parent-pid')
  const ownedPids = []
  try {
    const startPromise = supervisor.start(app)
    await waitForPath(ownedPidPath)
    await waitForPath(ownedParentPidPath)
    ownedPids.push(readPid(ownedPidPath), readPid(ownedParentPidPath))
    assert.equal(bridgeChildren.length, 1)
    const stopped = await supervisor.stop(app.id, 'user')
    assert.equal(stopped.status, 'stopped')
    assert.equal((await supervisor.stop(app.id, 'user')).status, 'stopped')
    await startPromise
    await Promise.all(ownedPids.map((pid) => waitForPidGone(pid)))
    await waitForChildExit(bridgeChildren[0])
    await supervisor.stopAll('app-quit')
    await supervisor.stopAll('app-quit')
  } finally {
    await cleanupOwnedRuntimeFixture(supervisor, bridgeChildren, ownedPids)
    rmSync(root, { recursive: true, force: true })
  }
})

test('Runtime manager restart preserves every consumer until the last release', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  let spawnCount = 0
  const manager = new runtime.LocalAppRuntimeManager({
    allocatePort: async () => 45150 + spawnCount,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: () => {
      spawnCount += 1
      const child = new EventEmitter()
      child.pid = 999990 - spawnCount; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => child.stdout.emit('data', `ready at http://127.0.0.1:${45149 + spawnCount}/`))
      return child
    },
  })
  const app = definition(root)
  manager.register(app)
  const first = await manager.start(app.id, 'tab-a')
  await manager.start(app.id, 'tab-b')
  const restarted = await manager.restart(app.id)
  assert.equal(restarted.status, 'running')
  assert.notEqual(restarted.runtimeId, first.runtimeId)
  assert.equal((await manager.release(app.id, 'tab-a')).status, 'running')
  assert.equal((await manager.release(app.id, 'tab-b')).status, 'stopped')
})

test('Runtime manager definition root change stops old process and starts with new cwd', async () => {
  const root1 = mkdtempSync(`${tmpdir()}/local-app-runtime-root1-`)
  const root2 = mkdtempSync(`${tmpdir()}/local-app-runtime-root2-`)
  mkdirSync(resolve(root1, 'node_modules')); mkdirSync(resolve(root2, 'node_modules'))
  writeFileSync(resolve(root1, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  writeFileSync(resolve(root2, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    allocatePort: async () => 45170 + spawns.length,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (executable, args, options) => {
      const child = new EventEmitter()
      child.pid = 999980 - spawns.length; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      spawns.push({ args, cwd: options.cwd })
      const port = 45170 + spawns.length - 1
      queueMicrotask(() => child.stdout.emit('data', `ready at http://127.0.0.1:${port}/`))
      return child
    },
  })
  const firstDefinition = definition(root1)
  manager.register(firstDefinition)
  const first = await manager.start(firstDefinition.id, 'tab-a')
  const secondDefinition = { ...firstDefinition, rootPath: root2, canonicalRoot: root2, updatedAt: 2 }
  manager.register(secondDefinition)
  const second = await manager.start(secondDefinition.id, 'tab-b')
  assert.equal(second.status, 'running')
  assert.notEqual(second.runtimeId, first.runtimeId)
  assert.equal(spawns.at(-1).cwd, realpathSync(root2))
  assert.equal((await manager.release(secondDefinition.id, 'tab-a')).status, 'running')
  assert.equal((await manager.release(secondDefinition.id, 'tab-b')).status, 'stopped')
})

test('Runtime preparation digest persists across supervisor instances and reruns ci after lock change', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-prep-`)
  const userData = mkdtempSync(`${tmpdir()}/local-app-runtime-userdata-`)
  const recordPath = resolve(userData, 'local-app-preparation.json')
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  writeFileSync(resolve(root, 'package-lock.json'), '{"lockfileVersion":3}')
  const calls = []
  const makeSupervisor = () => new runtime.LocalAppRuntimeSupervisor({
    preparationRecordPath: recordPath,
    allocatePort: async () => 45190 + calls.length,
    fetch: async () => ({ status: 200 }),
    defaults: { prepareTimeoutMs: 1000, readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (executable, args, options) => {
      const child = new EventEmitter()
      child.pid = 999970 - calls.length; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      calls.push({ args: [...args], cwd: options.cwd })
      queueMicrotask(() => {
        if (args[0] === 'ci') {
          mkdirSync(resolve(root, 'node_modules'), { recursive: true })
          child.emit('exit', 0, null)
        } else {
          child.stdout.emit('data', `ready at http://127.0.0.1:${45189 + calls.length}/`)
        }
      })
      return child
    },
  })
  const app = definition(root)
  const firstSupervisor = makeSupervisor()
  const first = await firstSupervisor.start(app)
  assert.equal(first.status, 'running')
  await firstSupervisor.stop(app.id)
  const secondSupervisor = makeSupervisor()
  const second = await secondSupervisor.start(app)
  assert.equal(second.status, 'running')
  await secondSupervisor.stop(app.id)
  assert.deepEqual(calls.map((call) => call.args[0]), ['ci', '-e', '-e'])
  writeFileSync(resolve(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}')
  const thirdSupervisor = makeSupervisor()
  const third = await thirdSupervisor.start(app)
  assert.equal(third.status, 'running')
  assert.equal(calls.at(-2).args[0], 'ci')
  await thirdSupervisor.stop(app.id)
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  const canonicalRoot = realpathSync(root)
  assert.equal(record.entries[canonicalRoot].canonicalRoot, canonicalRoot)
  assert.ok(record.entries[canonicalRoot].lockDigest)
})

test('Runtime conservatively runs npm ci when lock digest record is missing despite node_modules', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-missing-record-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  writeFileSync(resolve(root, 'package-lock.json'), '{}')
  const calls = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45250 + calls.length,
    fetch: async () => ({ status: 200 }),
    defaults: { prepareTimeoutMs: 1000, readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (executable, args, options) => {
      const child = new EventEmitter()
      child.pid = 999960 - calls.length; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      calls.push({ args: [...args], cwd: options.cwd })
      queueMicrotask(() => {
        if (args[0] === 'ci') child.emit('exit', 0, null)
        else child.stdout.emit('data', 'ready at http://127.0.0.1:45251/')
      })
      return child
    },
  })
  const started = await supervisor.start(definition(root))
  assert.equal(started.status, 'running')
  assert.equal(calls[0].args[0], 'ci')
  await supervisor.stop(started.localAppId, 'user')
})

test('Runtime manager deduplicates the same canonical root and stops after the last consumer releases', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  let spawnCount = 0
  const manager = new runtime.LocalAppRuntimeManager({
    allocatePort: async () => 45200,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: () => {
      spawnCount += 1
      const child = new EventEmitter()
      child.pid = 999997; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => child.stdout.emit('data', 'ready at http://127.0.0.1:45200/'))
      return child
    },
  })
  const first = definition(root)
  const second = { ...first, id: 'local-app-alias' }
  manager.register(first)
  manager.register(second)
  const runningA = await manager.start(first.id, 'tab:tab-a')
  const runningB = await manager.start(second.id, 'project-home:project-1:mount-1')
  assert.equal(runningA.runtimeId, runningB.runtimeId)
  assert.equal(spawnCount, 1)
  assert.equal((await manager.release(first.id, 'tab:tab-a')).status, 'running')
  assert.equal((await manager.release(second.id, 'project-home:project-1:mount-1')).status, 'stopped')
})

test('Runtime stop invalidates the generation before a later start', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45300,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: () => {
      const child = new EventEmitter()
      child.pid = 999996; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => child.stdout.emit('data', 'ready at http://127.0.0.1:45300/'))
      return child
    },
  })
  const first = await supervisor.start(definition(root))
  await supervisor.stop(first.localAppId, 'user')
  const second = await supervisor.start(definition(root))
  assert.equal(second.status, 'running')
  assert.equal(second.generation, first.generation + 1)
  assert.notEqual(second.runtimeId, first.runtimeId)
  await supervisor.stop(second.localAppId, 'user')
})

test('Development to static transition stops the old supervisor before replacing the runtime map', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-mode-transition-dev-static-`)
  const userData = mkdtempSync(`${tmpdir()}/local-app-mode-transition-dev-static-data-`)
  mkdirSync(resolve(root, 'node_modules'))
  mkdirSync(resolve(root, 'out'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  writeFileSync(resolve(root, 'out', 'index.html'), '<h1>static</h1>')
  const children = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    allocatePort: async () => 45500,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: () => {
      const child = new EventEmitter()
      child.pid = 999999
      child.exitCode = null
      child.signalCode = null
      child.connected = true
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      child.send = (message) => {
        child.shutdownMessage = message
        child.connected = false
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit', 0, null))
      }
      child.kill = () => { child.exitCode = 0; return true }
      children.push(child)
      queueMicrotask(() => child.stdout.emit('data', 'ready at http://127.0.0.1:45500/'))
      return child
    },
  })
  const devDefinition = definition(root)
  try {
    const dev = await supervisor.start(devDefinition)
    assert.equal(dev.mode, 'development')
    assert.equal(children.length, 1)
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'fixture', build: 'fixture-build' },
      agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'out', entryFile: 'index.html' },
    }))
    const staticDefinition = { ...devDefinition, mode: 'static', agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'out', entryFile: 'index.html' } }
    const restored = await supervisor.start(staticDefinition)
    assert.equal(restored.mode, 'static')
    assert.equal(restored.status, 'ready')
    assert.equal(children[0].shutdownMessage?.type, 'runtime-shutdown')
    assert.equal(children.filter((child) => child.exitCode === null).length, 0)
    assert.equal(children.length, 1, 'static restore must not spawn a dev child')
  } finally {
    await supervisor.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('Static to development transition revokes the active preview without deleting the artifact', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-mode-transition-static-dev-`)
  const userData = mkdtempSync(`${tmpdir()}/local-app-mode-transition-static-dev-data-`)
  mkdirSync(resolve(root, 'node_modules'))
  mkdirSync(resolve(root, 'out'), { recursive: true })
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({
    scripts: { dev: 'fixture', build: 'fixture-build' },
    agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'out', entryFile: 'index.html' },
  }))
  writeFileSync(resolve(root, 'out', 'index.html'), '<h1>static</h1>')
  const children = []
  const spawnDev = () => {
    const child = new EventEmitter()
    child.pid = 999998
    child.exitCode = null
    child.signalCode = null
    child.connected = true
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
    child.send = (message) => {
      child.shutdownMessage = message
      child.connected = false
      child.exitCode = 0
      queueMicrotask(() => child.emit('exit', 0, null))
    }
    child.kill = () => { child.exitCode = 0; return true }
    children.push(child)
    queueMicrotask(() => child.stdout.emit('data', 'ready at http://127.0.0.1:45510/'))
    return child
  }
  const staticDefinition = { ...definition(root), mode: 'static', agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'out', entryFile: 'index.html' } }
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    allocatePort: async () => 45510,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: spawnDev,
  })
  try {
    const staticSnapshot = await supervisor.start(staticDefinition)
    assert.equal(staticSnapshot.status, 'ready')
    const staticArtifactId = staticSnapshot.artifactId
    const devSnapshot = await supervisor.start({ ...staticDefinition, mode: 'development' })
    assert.equal(devSnapshot.mode, 'development')
    assert.equal(devSnapshot.status, 'running')
    assert.equal(children.length, 1)
    assert.equal(supervisor.getStaticPreviewRegistry().resolve(new URL(staticSnapshot.previewUrl).hostname), null)
    assert.equal(children.filter((child) => child.exitCode === null).length, 1)
    await supervisor.stop(staticDefinition.id, 'user')
    assert.equal(children.filter((child) => child.exitCode === null).length, 0)

    const restoring = new runtime.LocalAppRuntimeSupervisor({ userDataPath: userData, spawn: () => { throw new Error('static restore must not spawn') } })
    const restored = await restoring.start(staticDefinition)
    assert.equal(restored.status, 'ready')
    assert.equal(restored.artifactId, staticArtifactId)
    await restoring.stop(staticDefinition.id, 'user')
  } finally {
    await supervisor.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('Controlled fixture runs through npm run dev, dynamic readiness, and bounded stop cleanup', async () => {
  const fixtureSource = resolve(testDir, '../test-fixtures/local-app-runtime')
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-fixture-`)
  for (const file of ['package.json', 'package-lock.json', 'server.mjs']) {
    copyFileSync(resolve(fixtureSource, file), resolve(root, file))
  }
  const app = definition(root)
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    defaults: {
      prepareTimeoutMs: 15_000,
      readinessTimeoutMs: 8_000,
      probeIntervalMs: 25,
      probeTimeoutMs: 500,
      termTimeoutMs: 1_000,
      killTimeoutMs: 500,
    },
  })
  try {
    const running = await supervisor.start(app)
    assert.equal(running.status, 'running', JSON.stringify(running))
    assert.match(running.readyUrl, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\//)
    const response = await fetch(running.readyUrl)
    assert.equal(response.status, 200)
    const stopped = await supervisor.stop(app.id, 'user')
    assert.equal(stopped.status, 'stopped')
  } finally {
    await supervisor.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
  }
})

test('Controlled fixture fail mode reports a stable stderr error and exits non-zero', () => {
  const fixtureSource = resolve(testDir, '../test-fixtures/local-app-runtime')
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-fail-fixture-`)
  copyFileSync(resolve(fixtureSource, 'server.mjs'), resolve(root, 'server.mjs'))
  writeFileSync(resolve(root, '.fixture-mode'), 'fail\n')
  try {
    const result = spawnSync(process.execPath, ['server.mjs'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Local App Runtime fixture mode=fail: intentional startup failure/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Controlled fixture slow mode stays alive without listening and exits cleanly on SIGTERM', async () => {
  const fixtureSource = resolve(testDir, '../test-fixtures/local-app-runtime')
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-slow-fixture-`)
  copyFileSync(resolve(fixtureSource, 'server.mjs'), resolve(root, 'server.mjs'))
  writeFileSync(resolve(root, '.fixture-mode'), 'slow\n')
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(child.exitCode, null)
    child.kill('SIGTERM')
    const [code, signal] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(signal, null)
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit').catch(() => undefined)
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('Controlled fixture default page exposes bridge and Preview security controls without external resources', () => {
  const source = readFileSync(resolve(testDir, '../test-fixtures/local-app-runtime/server.mjs'), 'utf8')
  for (const selector of [
    'fixture-window-desktop',
    'fixture-window-require',
    'fixture-window-process',
    'fixture-window-open',
    'fixture-top-navigation',
    'fixture-geolocation',
  ]) {
    assert.match(source, new RegExp(`data-testid="${selector}"`))
  }
  assert.match(source, /typeof window\.desktop/)
  assert.match(source, /typeof window\.require/)
  assert.match(source, /typeof window\.process/)
  assert.match(source, /window\.open\('https:\/\/example\.com'/)
  assert.match(source, /window\.location\.assign\('https:\/\/example\.com'/)
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/)
  assert.doesNotMatch(source, /<script\s+src=/i)
  assert.doesNotMatch(source, /<img\s+[^>]*src=/i)
})

test('Running-process crash uses bounded recovery without changing generation', async () => {
  const root = mkdtempSync(`${tmpdir()}/local-app-runtime-`)
  mkdirSync(resolve(root, 'node_modules'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'fixture' } }))
  const children = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    allocatePort: async () => 45400 + children.length,
    fetch: async () => ({ status: 200 }),
    sleep: async () => {},
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10, crashRetryCount: 2, crashRetryDelaysMs: [0, 0] },
    spawn: () => {
      const child = new EventEmitter()
      child.pid = 999995 - children.length; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      children.push(child)
      queueMicrotask(() => child.stdout.emit('data', `ready at http://127.0.0.1:${45400 + children.length - 1}/`))
      return child
    },
  })
  const first = await supervisor.start(definition(root))
  children[0].emit('exit', 1, null)
  await new Promise((resolve) => setTimeout(resolve, 10))
  const recovered = supervisor.snapshot(first.localAppId)
  assert.equal(recovered.status, 'running')
  assert.equal(recovered.generation, first.generation)
  assert.equal(children.length, 2)
  await supervisor.stop(first.localAppId, 'user')
})
