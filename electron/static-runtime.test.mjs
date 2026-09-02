import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports
  const source = require('node:fs').readFileSync(resolvedPath, 'utf8')
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

const staticRuntime = loadTsModule(resolve(testDir, './local-app-runtime/static.ts'))
const runtime = loadTsModule(resolve(testDir, './local-app-runtime/index.ts'))

function staticDeclaration(overrides = {}) {
  return { mode: 'static', buildCommand: 'npm run build', outputRoot: 'out', entryFile: 'index.html', ...overrides }
}

function staticDefinition(rootPath) {
  return {
    id: 'static-runtime-test', name: 'Static fixture', rootPath, canonicalRoot: rootPath,
    packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] },
    mode: 'static', agentos: staticDeclaration(), trustStatus: 'trusted', autoStart: true,
    createdAt: 1, updatedAt: 1,
  }
}

test('static declaration accepts only the fixed build command and safe relative paths', () => {
  assert.equal(staticRuntime.parseAgentOSStaticDeclaration({ scripts: { dev: 'node dev.mjs' } }).ok, true)
  assert.equal(staticRuntime.parseAgentOSStaticDeclaration({ agentos: staticDeclaration() }).declaration.outputRoot, 'out')
  for (const value of ['/out', '../out', 'out/../x', 'out\\x', 'out\0x', 'C:/out']) {
    assert.equal(staticRuntime.isSafeStaticRelativePath(value), false, value)
  }
  assert.equal(staticRuntime.parseAgentOSStaticDeclaration({ agentos: staticDeclaration({ buildCommand: 'npm run build && touch pwned' }) }).ok, false)
})

test('a malformed newly declared static block cannot fall back to the legacy dev spawn', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-invalid-'))
  const calls = []
  mkdirSync(project, { recursive: true })
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ scripts: { dev: 'node dev.mjs' }, agentos: staticDeclaration({ outputRoot: '../out' }) }))
  const supervisor = new runtime.LocalAppRuntimeSupervisor({ spawn: (...args) => { calls.push(args); throw new Error('unexpected-spawn') } })
  const legacyDefinition = { ...staticDefinition(project), mode: undefined, agentos: undefined }
  const snapshot = await supervisor.start(legacyDefinition)
  assert.equal(snapshot.errorCode, 'static-declaration-invalid')
  assert.equal(calls.length, 0)
  rmSync(project, { recursive: true, force: true })
})

test('same-root static last-good previews remain independent while realtime/build execution is leased', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-static-root-lease-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-root-lease-data-'))
  mkdirSync(resolve(root, 'node_modules'), { recursive: true })
  mkdirSync(resolve(root, 'out'), { recursive: true })
  writeFileSync(resolve(root, 'out', 'index.html'), '<h1>last-good</h1>')
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({
    scripts: { dev: 'fixture-dev', build: 'fixture-build' },
    agentos: staticDeclaration(),
  }))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45670,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (_executable, args) => {
      const child = new EventEmitter()
      child.pid = 999930 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}
      child.stderr.setEncoding = () => {}
      spawns.push([...args])
      queueMicrotask(() => {
        if (args[1] === 'build') {
          child.exitCode = 0
          child.emit('exit', 0, null)
        } else {
          child.stdout.emit('data', 'ready at http://127.0.0.1:45670/')
        }
      })
      return child
    },
  })
  const development = { ...staticDefinition(root), id: 'definition-development', mode: 'development', agentos: undefined, serveScript: 'dev' }
  const staticPeer = { ...staticDefinition(root), id: 'definition-static-peer' }
  manager.register(development)
  manager.register(staticPeer)
  try {
    const live = await manager.start(development.id, 'tab:live')
    const preview = await manager.start(staticPeer.id, 'tab:static', { autoBuild: false })
    assert.equal(live.status, 'running')
    assert.equal(preview.status, 'ready')
    assert.ok(preview.artifactId)
    assert.equal(manager.getRootExecutionRegistry().leases().length, 1)
    assert.equal(manager.getRootExecutionRegistry().leases()[0].runtimeDefinitionId, development.id)
    assert.equal(spawns.length, 1, 'opening a static last-good preview must not spawn or acquire another lease')

    await assert.rejects(manager.build(staticPeer.id), (error) => error?.code === 'runtime-development-conflict')
    assert.equal(spawns.length, 1, 'conflicting build must have zero process side effect')
    assert.equal(manager.get(staticPeer.id).artifactId, preview.artifactId)

    await manager.release(development.id, 'tab:live')
    const built = await manager.build(staticPeer.id)
    assert.equal(built.status, 'ready')
    assert.equal(built.runtimeDefinitionId, staticPeer.id)
    assert.equal(spawns.length, 2)
    assert.equal(manager.getRootExecutionRegistry().leases().length, 0)
  } finally {
    await manager.stopAll('app-quit').catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('static protocol resolution is GET/HEAD only and rejects traversal, cross-host and symlink escape', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-static-preview-'))
  const artifactRoot = resolve(root, 'artifact')
  const outside = resolve(root, 'outside.html')
  mkdirSync(resolve(artifactRoot, 'docs'), { recursive: true })
  mkdirSync(resolve(artifactRoot, 'route'), { recursive: true })
  writeFileSync(resolve(artifactRoot, 'index.html'), '<h1>home</h1>')
  writeFileSync(resolve(artifactRoot, 'docs', 'index.html'), '<h1>docs</h1>')
  writeFileSync(resolve(artifactRoot, 'route', 'index.html'), '<h1>route</h1>')
  writeFileSync(resolve(artifactRoot, 'asset.js'), 'console.log("asset")')
  writeFileSync(outside, 'outside')
  try { symlinkSync(outside, resolve(artifactRoot, 'escape.html')) } catch { /* Windows may not allow symlinks in CI. */ }
  const artifact = { artifactId: 'a1', rootPath: artifactRoot, entryFile: 'index.html', lastBuildAt: 1 }
  const registry = new staticRuntime.StaticPreviewRegistry()
  const token = registry.register('runtime-1', 1, artifact)
  const otherToken = registry.register('runtime-2', 1, artifact)
  const base = staticRuntime.staticPreviewUrl(token)
  assert.equal((await staticRuntime.resolveStaticRequest(base, 'GET', registry)).ok, true)
  assert.equal((await staticRuntime.resolveStaticRequest(`${base}docs/`, 'GET', registry)).ok, true)
  assert.equal((await staticRuntime.resolveStaticRequest(`${base}route`, 'GET', registry)).filePath, realpathSync(resolve(artifactRoot, 'route', 'index.html')))
  assert.equal((await staticRuntime.resolveStaticRequest(`${base}route/`, 'GET', registry)).filePath, realpathSync(resolve(artifactRoot, 'route', 'index.html')))
  assert.equal((await staticRuntime.resolveStaticRequest(`${base}asset.js`, 'GET', registry)).filePath, realpathSync(resolve(artifactRoot, 'asset.js')))
  assert.equal((await staticRuntime.resolveStaticRequest(base, 'HEAD', registry)).ok, true)
  assert.equal((await staticRuntime.resolveStaticRequest(base, 'POST', registry)).status, 405)
  assert.equal((await staticRuntime.resolveStaticRequest(`${base}%2e%2e/outside.html`, 'GET', registry)).ok, false)
  assert.equal((await staticRuntime.resolveStaticRequest(`${staticRuntime.STATIC_PREVIEW_SCHEME}://deadbeef/`, 'GET', registry)).ok, false)
  const sessionHost = new URL(base).hostname
  const sessionHandler = async (requestUrl) => {
    if (new URL(requestUrl).hostname !== sessionHost) return { ok: false, status: 403, reason: 'cross-runtime' }
    return staticRuntime.resolveStaticRequest(requestUrl, 'GET', registry)
  }
  assert.equal((await sessionHandler(staticRuntime.staticPreviewUrl(token))).ok, true)
  assert.equal((await sessionHandler(staticRuntime.staticPreviewUrl(otherToken))).status, 403)
  if (existsSync(resolve(artifactRoot, 'escape.html'))) {
    assert.equal((await staticRuntime.resolveStaticRequest(`${base}escape.html`, 'GET', registry)).ok, false)
  }
  rmSync(root, { recursive: true, force: true })
})

class FakeBuildChild extends EventEmitter {
  constructor() {
    super()
    this.pid = undefined
    this.exitCode = null
    this.signalCode = null
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('static restore imports out without spawning and successful build uses npm run build only', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-runtime-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-user-data-'))
  mkdirSync(resolve(project, 'out'), { recursive: true })
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
  writeFileSync(resolve(project, 'out', 'index.html'), '<h1>fixture</h1>')
  const calls = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    now: () => 100,
    spawn: (...args) => {
      calls.push(args)
      const child = new FakeBuildChild()
      setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
      return child
    },
  })
  const definition = staticDefinition(project)
  const restored = await supervisor.start(definition)
  assert.equal(calls.length, 0)
  assert.equal(restored.mode, 'static')
  assert.equal(restored.buildStatus, 'ready')
  const built = await supervisor.build(definition)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][1], ['run', 'build'])
  assert.equal(calls[0][2].shell, false)
  assert.equal(calls[0][2].detached, process.platform !== 'win32')
  assert.equal(built.buildStatus, 'ready')
  assert.ok(built.artifactId)
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('trusted first static import automatically builds once and opens the committed artifact', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-first-import-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-first-import-data-'))
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
  const calls = []
  const events = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    spawn: (executable, args, options) => {
      calls.push({ executable, args, options })
      mkdirSync(resolve(options.cwd, 'out'), { recursive: true })
      writeFileSync(resolve(options.cwd, 'out', 'index.html'), '<h1>first import</h1>')
      const child = new FakeBuildChild()
      setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
      return child
    },
    onEvent: (event) => events.push(event),
  })
  const started = await supervisor.start(staticDefinition(project))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['run', 'build'])
  assert.equal(started.status, 'ready')
  assert.equal(started.buildStatus, 'ready')
  assert.ok(started.artifactId)
  assert.ok(started.previewUrl)
  assert.ok(events.some((event) => event.status === 'building' && event.buildStatus === 'building'))
  await supervisor.stop(started.runtimeDefinitionId, 'user')
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('automatic first static build failure stays build_failed and never starts development mode', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-first-failure-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-first-failure-data-'))
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs', dev: 'node dev.mjs' }, agentos: staticDeclaration() }))
  const calls = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    spawn: (executable, args, options) => {
      calls.push({ executable, args, options })
      const child = new FakeBuildChild()
      setImmediate(() => { child.exitCode = 1; child.emit('exit', 1, null); child.emit('close', 1, null) })
      return child
    },
  })
  const failed = await supervisor.start(staticDefinition(project))
  assert.equal(failed.status, 'build_failed')
  assert.equal(failed.buildStatus, 'build_failed')
  assert.equal(failed.previewUrl, undefined)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['run', 'build'])
  await supervisor.stop(failed.runtimeDefinitionId, 'user')
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('failed or cancelled builds retain the last-good artifact and ignore late events', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-rollback-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-rollback-data-'))
  mkdirSync(resolve(project, 'out'), { recursive: true })
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
  writeFileSync(resolve(project, 'out', 'index.html'), '<h1>old</h1>')
  const children = []
  const supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    spawn: () => {
      const child = new FakeBuildChild()
      children.push(child)
      if (children.length === 1) setImmediate(() => { child.exitCode = 1; child.emit('exit', 1, null); child.emit('close', 1, null) })
      return child
    },
  })
  const definition = staticDefinition(project)
  const restored = await supervisor.start(definition)
  const failed = await supervisor.build(definition)
  assert.equal(failed.buildStatus, 'build_failed')
  assert.equal(failed.artifactId, restored.artifactId)
  const secondBuild = supervisor.build(definition)
  for (let attempt = 0; attempt < 20 && children.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve))
  const building = supervisor.snapshot(definition.id)
  assert.equal(building.buildStatus, 'building')
  assert.equal(building.previewUrl, restored.previewUrl)
  const cancelled = await supervisor.cancelBuild(definition.id, building.buildId)
  assert.equal(cancelled?.artifactId, restored.artifactId)
  assert.equal(cancelled?.buildStatus, 'ready')
  children.at(-1)?.emit('exit', 0, null)
  assert.equal(supervisor.snapshot(definition.id)?.artifactId, restored.artifactId)
  await secondBuild.catch(() => undefined)
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('cancelling after the child exits during validation restores last-good or build-required', async () => {
  const cases = [
    { name: 'last-good', withOutput: true, expectedStatus: 'ready' },
    { name: 'empty-cache', withOutput: false, expectedStatus: 'build_required' },
  ]
  for (const scenario of cases) {
    const project = mkdtempSync(resolve(tmpdir(), `agentos-static-cancel-validation-${scenario.name}-`))
    const userData = mkdtempSync(resolve(tmpdir(), `agentos-static-cancel-validation-data-${scenario.name}-`))
    if (scenario.withOutput) mkdirSync(resolve(project, 'out'), { recursive: true })
    writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
    if (scenario.withOutput) writeFileSync(resolve(project, 'out', 'index.html'), '<h1>old</h1>')
    const entered = deferred()
    const release = deferred()
    const supervisor = new runtime.LocalAppRuntimeSupervisor({
      userDataPath: userData,
      spawn: () => {
        const child = new FakeBuildChild()
        setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
        return child
      },
      validateStaticOutput: async (root, declaration) => {
        entered.resolve()
        await release.promise
        return staticRuntime.validateStaticOutput(root, declaration)
      },
    })
    const definition = staticDefinition(project)
    const restored = await supervisor.start(definition, [], { autoBuild: false })
    const buildPromise = supervisor.build(definition)
    await entered.promise
    const building = supervisor.snapshot(definition.id)
    assert.equal(building.status, 'building')
    const cancelPromise = supervisor.cancelBuild(definition.id, building.buildId)
    release.resolve()
    const cancelled = await cancelPromise
    assert.equal(cancelled.status, scenario.expectedStatus)
    assert.equal(cancelled.buildStatus, scenario.expectedStatus)
    assert.equal(cancelled.errorCode, 'build-cancelled')
    assert.equal(cancelled.buildId, undefined)
    assert.equal(cancelled.operationId, undefined)
    if (scenario.withOutput) {
      assert.equal(cancelled.artifactId, restored.artifactId)
      assert.equal(cancelled.previewUrl, restored.previewUrl)
    } else {
      assert.equal(cancelled.artifactId, undefined)
      assert.equal(cancelled.previewUrl, undefined)
    }
    assert.equal((await buildPromise).status, scenario.expectedStatus)
    assert.notEqual(supervisor.snapshot(definition.id).status, 'building')
    rmSync(project, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('cancelling during fingerprint or commit cannot leave a building snapshot', async () => {
  const phases = ['fingerprint', 'commit']
  for (const phase of phases) {
    const project = mkdtempSync(resolve(tmpdir(), `agentos-static-cancel-${phase}-`))
    const userData = mkdtempSync(resolve(tmpdir(), `agentos-static-cancel-${phase}-data-`))
    mkdirSync(resolve(project, 'out'), { recursive: true })
    writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
    writeFileSync(resolve(project, 'out', 'index.html'), '<h1>old</h1>')
    const entered = deferred()
    const release = deferred()
    let pauseCommit = false
    const store = new (class extends staticRuntime.StaticArtifactStore {
      async commit(...args) {
        if (pauseCommit) {
          entered.resolve()
          await release.promise
        }
        return super.commit(...args)
      }
    })(userData)
    const supervisor = new runtime.LocalAppRuntimeSupervisor({
      userDataPath: userData,
      staticArtifactStore: store,
      spawn: () => {
        const child = new FakeBuildChild()
        setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
        return child
      },
      fingerprintStaticSource: async (root, declaration) => {
        if (phase === 'fingerprint') {
          entered.resolve()
          await release.promise
        }
        return staticRuntime.fingerprintStaticSource(root, declaration)
      },
    })
    const definition = staticDefinition(project)
    const restored = await supervisor.start(definition)
    pauseCommit = true
    const buildPromise = supervisor.build(definition)
    await entered.promise
    const building = supervisor.snapshot(definition.id)
    assert.equal(building.status, 'building')
    const cancelPromise = supervisor.cancelBuild(definition.id, building.buildId)
    release.resolve()
    const cancelled = await cancelPromise
    assert.equal(cancelled.status, 'ready')
    assert.equal(cancelled.buildStatus, 'ready')
    assert.equal(cancelled.artifactId, restored.artifactId)
    assert.equal(cancelled.previewUrl, restored.previewUrl)
    assert.equal(cancelled.buildId, undefined)
    assert.equal(cancelled.operationId, undefined)
    assert.equal((await buildPromise).status, 'ready')
    assert.notEqual(supervisor.snapshot(definition.id).status, 'building')
    rmSync(project, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('cancelling a stale build restores stale state and its last-good preview', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-cancel-stale-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-cancel-stale-data-'))
  mkdirSync(resolve(project, 'out'), { recursive: true })
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
  writeFileSync(resolve(project, 'out', 'index.html'), '<h1>old</h1>')
  writeFileSync(resolve(project, 'source.txt'), 'before')
  const definition = staticDefinition(project)
  const firstSupervisor = new runtime.LocalAppRuntimeSupervisor({ userDataPath: userData })
  const first = await firstSupervisor.start(definition)
  writeFileSync(resolve(project, 'source.txt'), 'after')
  const supervisor = new runtime.LocalAppRuntimeSupervisor({ userDataPath: userData, spawn: () => {
    const child = new FakeBuildChild()
    setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
    return child
  } })
  const stale = await supervisor.start(definition)
  for (let attempt = 0; attempt < 50 && supervisor.snapshot(definition.id).status !== 'stale'; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(supervisor.snapshot(definition.id).status, 'stale')
  const entered = deferred()
  const release = deferred()
  // A second supervisor is intentionally constructed with the phase seam so
  // the stale pre-build state is deterministic and can be cancelled before
  // the commit boundary.
  const cancellable = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    spawn: () => {
      const child = new FakeBuildChild()
      setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
      return child
    },
    fingerprintStaticSource: async (root, declaration) => {
      entered.resolve()
      await release.promise
      return staticRuntime.fingerprintStaticSource(root, declaration)
    },
  })
  // Persist the stale detection result by using the same artifact cache and
  // let this supervisor independently restore it before the build begins.
  const staleAgain = await cancellable.start(definition)
  for (let attempt = 0; attempt < 50 && cancellable.snapshot(definition.id).status !== 'stale'; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(staleAgain.artifactId, first.artifactId)
  assert.equal(cancellable.snapshot(definition.id).status, 'stale')
  const staleBeforeBuild = { ...cancellable.snapshot(definition.id) }
  const buildPromise = cancellable.build(definition)
  await entered.promise
  const building = cancellable.snapshot(definition.id)
  assert.equal(building.status, 'building')
  const cancelPromise = cancellable.cancelBuild(definition.id, building.buildId)
  release.resolve()
  const cancelled = await cancelPromise
  assert.equal(cancelled.status, 'stale')
  assert.equal(cancelled.buildStatus, 'stale')
  assert.equal(cancelled.stale, true)
  assert.equal(cancelled.artifactId, first.artifactId)
  assert.equal(cancelled.previewUrl, staleBeforeBuild.previewUrl)
  assert.equal((await buildPromise).status, 'stale')
  await firstSupervisor.stop(definition.id, 'user')
  await supervisor.stop(definition.id, 'user')
  await cancellable.stop(definition.id, 'user')
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('pointer commit remains success when cancellation arrives after the atomic rename', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-commit-boundary-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-commit-boundary-data-'))
  mkdirSync(resolve(project, 'out'), { recursive: true })
  writeFileSync(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'node build.mjs' }, agentos: staticDeclaration() }))
  writeFileSync(resolve(project, 'out', 'index.html'), '<h1>new</h1>')
  let supervisor
  let cancelAfterCommit
  let cancellation
  const store = new (class extends staticRuntime.StaticArtifactStore {
    async commit(...args) {
      const artifact = await super.commit(...args)
      cancelAfterCommit?.()
      return artifact
    }
  })(userData)
  supervisor = new runtime.LocalAppRuntimeSupervisor({
    userDataPath: userData,
    staticArtifactStore: store,
    spawn: () => {
      const child = new FakeBuildChild()
      setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
      return child
    },
  })
  const definition = staticDefinition(project)
  const restored = await supervisor.start(definition)
  cancelAfterCommit = () => {
    const building = supervisor.snapshot(definition.id)
    cancellation = supervisor.cancelBuild(definition.id, building.buildId)
  }
  const built = await supervisor.build(definition)
  assert.ok(cancellation)
  await cancellation
  assert.equal(built.status, 'ready')
  assert.equal(built.buildStatus, 'ready')
  assert.notEqual(built.artifactId, restored.artifactId)
  assert.notEqual(built.previewUrl, restored.previewUrl)
  const onDisk = await store.loadLastGood(definition.id, realpathSync(project))
  assert.equal(onDisk.artifactId, built.artifactId)
  assert.equal(supervisor.snapshot(definition.id).artifactId, onDisk.artifactId)
  await supervisor.stop(definition.id, 'user')
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('atomic last-good pointer is unchanged when the development transaction fence rejects commit', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-commit-fence-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-commit-fence-data-'))
  const output = resolve(project, 'out')
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'index.html'), '<h1>first</h1>')
  const store = new staticRuntime.StaticArtifactStore(userData, (() => { let now = 10; return () => ++now })())
  const declaration = staticDeclaration()
  const first = await store.commit('runtime', project, declaration, output, 'first')
  writeFileSync(resolve(output, 'index.html'), '<h1>stale second</h1>')
  await assert.rejects(() => store.commit('runtime', project, declaration, output, 'second', undefined, () => false), /runtime-build-commit-fence-rejected/)
  const lastGood = await store.loadLastGood('runtime', project)
  assert.equal(lastGood.artifactId, first.artifactId)
  assert.equal(lastGood.sourceFingerprint, 'first')
  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('commit keeps only the pointed artifact on disk and loadLastGood reclaims orphans', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-prune-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-prune-data-'))
  const output = resolve(project, 'out')
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'index.html'), '<h1>first</h1>')
  const store = new staticRuntime.StaticArtifactStore(userData, (() => { let now = 10; return () => ++now })())
  const declaration = staticDeclaration()
  const first = await store.commit('runtime', project, declaration, output, 'first')
  const artifactsDir = dirname(first.rootPath)
  const listArtifacts = () => readdirSync(artifactsDir).sort()

  // A second successful commit removes the first copy; only the new pointer target survives.
  writeFileSync(resolve(output, 'index.html'), '<h1>second</h1>')
  const second = await store.commit('runtime', project, declaration, output, 'second')
  assert.notEqual(second.artifactId, first.artifactId)
  assert.deepEqual(listArtifacts(), [second.artifactId])
  assert.equal(readFileSync(resolve(second.rootPath, 'index.html'), 'utf8'), '<h1>second</h1>')

  // A rejected commit must not prune: the fence fires before the pointer rename.
  writeFileSync(resolve(output, 'index.html'), '<h1>rejected</h1>')
  await assert.rejects(() => store.commit('runtime', project, declaration, output, 'third', undefined, () => false), /runtime-build-commit-fence-rejected/)
  assert.deepEqual(listArtifacts(), [second.artifactId])

  // Orphans left by earlier versions, plus a foreign staging directory, are handled on load:
  // well-formed artifact ids go, `.staging-*` and the pointed artifact stay.
  mkdirSync(resolve(artifactsDir, 'old1-1-aaaaaaaaaaaa', 'books'), { recursive: true })
  writeFileSync(resolve(artifactsDir, 'old1-1-aaaaaaaaaaaa', 'books', 'big.pdf'), 'x')
  mkdirSync(resolve(artifactsDir, 'old2-1-bbbbbbbbbbbb'), { recursive: true })
  mkdirSync(resolve(artifactsDir, '.staging-other'), { recursive: true })
  const loaded = await store.loadLastGood('runtime', project)
  assert.equal(loaded.artifactId, second.artifactId)
  assert.deepEqual(listArtifacts(), ['.staging-other', second.artifactId])

  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('pruning re-reads the pointer so a stale caller cannot delete the live artifact', async () => {
  const project = mkdtempSync(resolve(tmpdir(), 'agentos-static-prune-race-'))
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-static-prune-race-data-'))
  const output = resolve(project, 'out')
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'index.html'), '<h1>live</h1>')
  const store = new staticRuntime.StaticArtifactStore(userData, (() => { let now = 10; return () => ++now })())
  const live = await store.commit('runtime', project, staticDeclaration(), output, 'live')
  const artifactsDir = dirname(live.rootPath)
  const runtimePath = dirname(artifactsDir)

  // Two leftovers, and a caller that still believes `stale` is the pointer target.
  mkdirSync(resolve(artifactsDir, 'stale-1-aaaaaaaaaaaa'), { recursive: true })
  mkdirSync(resolve(artifactsDir, 'other-1-bbbbbbbbbbbb'), { recursive: true })
  await store.pruneArtifacts(runtimePath, 'stale-1-aaaaaaaaaaaa')

  // The live pointer target survives even though the caller never named it.
  assert.deepEqual(readdirSync(artifactsDir).sort(), ['stale-1-aaaaaaaaaaaa', live.artifactId].sort())
  assert.equal((await store.loadLastGood('runtime', project)).artifactId, live.artifactId)

  rmSync(project, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

// --- Revision 4: serve-plan detection (`ATDD-RSM-401`–`403`) ---

function servePlanFixture(files = {}, packageJson = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-serve-plan-'))
  mkdirSync(resolve(root, 'node_modules'), { recursive: true })
  writeFileSync(resolve(root, 'package.json'), JSON.stringify(packageJson))
  for (const [relativePath, contents] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, relativePath)), { recursive: true })
    writeFileSync(resolve(root, relativePath), contents)
  }
  return root
}

test('serve plan detection follows the frozen order and never invents a path', async () => {
  const declared = servePlanFixture({ 'out/index.html': '<h1>a</h1>' }, { scripts: { dev: 'd', build: 'b' }, agentos: staticDeclaration() })
  const detectedOut = servePlanFixture({ 'out/index.html': '<h1>a</h1>' }, { scripts: { dev: 'd', build: 'b' } })
  const detectedDist = servePlanFixture({ 'dist/index.html': '<h1>a</h1>' }, { scripts: { dev: 'd' } })
  const detectedBuild = servePlanFixture({ 'build/index.html': '<h1>a</h1>' }, {})
  const buildable = servePlanFixture({}, { scripts: { dev: 'd', build: 'b' } })
  const developmentOnly = servePlanFixture({}, { scripts: { dev: 'd' } })
  const unsupported = servePlanFixture({}, { scripts: { lint: 'l' } })
  try {
    const plan = async (root, hasBuildScript, hasDevScript, declaration, hasStartScript = false) =>
      staticRuntime.detectRuntimeServePlan({ canonicalRoot: realpathSync(root), declaration, hasBuildScript, hasStartScript, hasDevScript })

    assert.deepEqual(await plan(declared, true, true, staticDeclaration()), { kind: 'artifact', declaration: staticDeclaration(), source: 'declaration' })
    assert.equal((await plan(detectedOut, true, true)).source, 'detected')
    assert.equal((await plan(detectedOut, true, true)).declaration.outputRoot, 'out')
    assert.equal((await plan(detectedDist, false, true)).declaration.outputRoot, 'dist')
    assert.equal((await plan(detectedBuild, false, false)).declaration.outputRoot, 'build')
    assert.deepEqual(await plan(buildable, true, true), { kind: 'buildable', source: 'detected' })
    assert.deepEqual(await plan(developmentOnly, false, true), { kind: 'development', reason: 'no-build-script' })
    assert.deepEqual(await plan(unsupported, false, false), { kind: 'unsupported', reason: 'no-runnable-script' })

    // A declaration whose entry does not exist yet still outranks detection.
    const declaredMissing = await plan(buildable, true, true, staticDeclaration())
    assert.equal(declaredMissing.kind, 'buildable')
    assert.equal(declaredMissing.source, 'declaration')
  } finally {
    for (const root of [declared, detectedOut, detectedDist, detectedBuild, buildable, developmentOnly, unsupported]) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('detected output roots stay inside the Runtime and a user override outranks detection', async () => {
  const outside = mkdtempSync(resolve(tmpdir(), 'agentos-serve-plan-outside-'))
  writeFileSync(resolve(outside, 'index.html'), '<h1>escape</h1>')
  const root = servePlanFixture({}, { scripts: { dev: 'd', build: 'b' } })
  try {
    symlinkSync(realpathSync(outside), resolve(root, 'out'))
    // A symlinked output directory escapes the Runtime and must not be adopted.
    assert.equal(await staticRuntime.findDetectedStaticArtifact(realpathSync(root)), null)

    const detected = { kind: 'artifact', declaration: staticDeclaration(), source: 'detected' }
    const devOnly = { hasBuildScript: true, hasStartScript: false, hasDevScript: true }
    const withStart = { hasBuildScript: true, hasStartScript: true, hasDevScript: true }
    // "Keep it running" is the user's choice; start vs dev stays detection's.
    assert.deepEqual(staticRuntime.applyServeOverride(detected, 'server', devOnly), { kind: 'development', reason: 'no-build-script' })
    assert.deepEqual(staticRuntime.applyServeOverride(detected, 'server', withStart), { kind: 'production', reason: 'server-bundle-present' })
    assert.deepEqual(staticRuntime.applyServeOverride(detected, 'artifact', withStart), detected)
    assert.deepEqual(staticRuntime.applyServeOverride(detected, undefined, withStart), detected)
    const unsupported = { kind: 'unsupported', reason: 'no-runnable-script' }
    assert.deepEqual(staticRuntime.applyServeOverride(unsupported, 'server', withStart), unsupported)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('an existing output directory is served without spawning, building or leasing the root', async () => {
  const root = servePlanFixture({ 'out/index.html': '<h1>imported</h1>' }, { scripts: { dev: 'fixture-dev', build: 'fixture-build' } })
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-serve-plan-adopt-data-'))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45680,
    fetch: async () => ({ status: 200 }),
    spawn: (_executable, args) => { spawns.push([...args]); throw new Error('serve tier ① must not spawn') },
  })
  // No declaration block anywhere: this is the imported-project shape.
  const definition = { ...staticDefinition(root), mode: undefined, agentos: undefined }
  manager.register(definition)
  try {
    const snapshot = await manager.start(definition.id, 'tab:view')
    assert.equal(snapshot.mode, 'static')
    assert.equal(snapshot.status, 'ready')
    assert.ok(snapshot.artifactId)
    assert.deepEqual(spawns, [])
    assert.equal(manager.getRootExecutionRegistry().leases().length, 0)
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a buildable directory builds once, adopts the produced output and never guesses another command', async () => {
  const root = servePlanFixture({}, { scripts: { dev: 'fixture-dev', build: 'fixture-build' } })
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-serve-plan-build-data-'))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45681,
    fetch: async () => ({ status: 200 }),
    spawn: (_executable, args) => {
      spawns.push([...args])
      const child = new EventEmitter()
      child.pid = 999940 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => {
        // The build is what reveals the output root, and it is not `out`.
        mkdirSync(resolve(root, 'dist'), { recursive: true })
        writeFileSync(resolve(root, 'dist', 'index.html'), '<h1>built</h1>')
        child.exitCode = 0
        child.emit('exit', 0, null)
      })
      return child
    },
  })
  const definition = { ...staticDefinition(root), mode: undefined, agentos: undefined }
  manager.register(definition)
  try {
    const snapshot = await manager.start(definition.id, 'tab:view')
    assert.equal(snapshot.status, 'ready')
    assert.ok(snapshot.artifactId)
    assert.deepEqual(spawns, [['run', 'build']], 'only the fixed build command may run')
    assert.equal(manager.getRootExecutionRegistry().leases().length, 0, 'the build lease is released')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a build that produces no openable page falls back to the dev service instead of failing', async () => {
  const root = servePlanFixture({}, { scripts: { dev: 'fixture-dev', build: 'fixture-build' } })
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-serve-plan-fallback-data-'))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45682,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 200, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (_executable, args) => {
      spawns.push([...args])
      const child = new EventEmitter()
      child.pid = 999950 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => {
        // A server-rendered build writes `.next` only: nothing openable.
        if (args[1] === 'build') { child.exitCode = 0; child.emit('exit', 0, null) }
        else child.stdout.emit('data', 'ready at http://127.0.0.1:45682/')
      })
      return child
    },
  })
  const definition = { ...staticDefinition(root), mode: undefined, agentos: undefined }
  manager.register(definition)
  try {
    const snapshot = await manager.start(definition.id, 'tab:view')
    assert.equal(snapshot.status, 'running')
    assert.equal(snapshot.mode, 'development')
    assert.equal(spawns.length, 2)
    assert.deepEqual(spawns[0], ['run', 'build'])
    // The dev service always runs through the supervised bridge, never a guess.
    assert.match(spawns[1].join(' '), /\["run","dev"\]/)
    assert.equal(manager.getRootExecutionRegistry().leases().length, 1, 'the dev fallback still holds the root lease')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

// --- Revision 4 amendment: production serve tier (`ATDD-RSM-408`) ---

test('an existing server bundle is started as production without rebuilding', async () => {
  const root = servePlanFixture({ '.next/BUILD_ID': 'abc123' }, { scripts: { dev: 'fixture-dev', build: 'fixture-build', start: 'fixture-start' } })
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-serve-production-data-'))
  const spawns = []
  const env = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45690,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 200, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (_executable, args, options) => {
      spawns.push([...args])
      env.push(options?.env?.NODE_ENV)
      const child = new EventEmitter()
      child.pid = 999960 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => child.stdout.emit('data', 'ready at http://127.0.0.1:45690/'))
      return child
    },
  })
  const definition = { ...staticDefinition(root), mode: undefined, agentos: undefined }
  manager.register(definition)
  try {
    const snapshot = await manager.start(definition.id, 'tab:view')
    assert.equal(snapshot.status, 'running')
    assert.equal(spawns.length, 1, 'an existing server bundle must not trigger a build')
    assert.match(spawns[0].join(' '), /\["run","start"\]/)
    assert.equal(env[0], 'production')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a build with no static output prefers the production server over the dev server', async () => {
  const root = servePlanFixture({}, { scripts: { dev: 'fixture-dev', build: 'fixture-build', start: 'fixture-start' } })
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-serve-production-fallback-'))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    userDataPath: userData,
    allocatePort: async () => 45691,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 200, probeIntervalMs: 1, probeTimeoutMs: 10 },
    spawn: (_executable, args) => {
      spawns.push([...args])
      const child = new EventEmitter()
      child.pid = 999970 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => {
        // A server-rendered build writes no openable page.
        if (args[1] === 'build') { child.exitCode = 0; child.emit('exit', 0, null) }
        else child.stdout.emit('data', 'ready at http://127.0.0.1:45691/')
      })
      return child
    },
  })
  const definition = { ...staticDefinition(root), mode: undefined, agentos: undefined }
  manager.register(definition)
  try {
    const snapshot = await manager.start(definition.id, 'tab:view')
    assert.equal(snapshot.status, 'running')
    assert.equal(spawns.length, 2)
    assert.deepEqual(spawns[0], ['run', 'build'])
    assert.match(spawns[1].join(' '), /\["run","start"\]/)
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('an editing session still forces the dev server and a static artifact still wins over a server bundle', async () => {
  const both = servePlanFixture({ 'out/index.html': '<h1>static</h1>', '.next/BUILD_ID': 'abc123' }, { scripts: { dev: 'd', build: 'b', start: 's' } })
  const serverOnly = servePlanFixture({ '.next/BUILD_ID': 'abc123' }, { scripts: { dev: 'd', build: 'b', start: 's' } })
  try {
    const scripts = { hasBuildScript: true, hasStartScript: true, hasDevScript: true }
    const staticFirst = await staticRuntime.detectRuntimeServePlan({ canonicalRoot: realpathSync(both), ...scripts })
    assert.equal(staticFirst.kind, 'artifact', 'zero-process serving outranks a server bundle')
    const production = await staticRuntime.detectRuntimeServePlan({ canonicalRoot: realpathSync(serverOnly), ...scripts })
    assert.deepEqual(production, { kind: 'production', reason: 'server-bundle-present' })
    // No start script: the same directory can only be kept alive by dev.
    const devOnly = await staticRuntime.detectRuntimeServePlan({ canonicalRoot: realpathSync(serverOnly), hasBuildScript: false, hasStartScript: false, hasDevScript: true })
    assert.deepEqual(devOnly, { kind: 'development', reason: 'no-build-script' })
  } finally {
    rmSync(both, { recursive: true, force: true })
    rmSync(serverOnly, { recursive: true, force: true })
  }
})
