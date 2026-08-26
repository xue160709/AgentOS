import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    const restored = await supervisor.start(definition)
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
