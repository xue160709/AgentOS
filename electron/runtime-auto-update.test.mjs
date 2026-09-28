import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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

const serverBundle = loadTsModule(resolve(testDir, './local-app-runtime/server-bundle.ts'))
const runtime = loadTsModule(resolve(testDir, './local-app-runtime/index.ts'))

const OLD = new Date('2026-01-01T00:00:00Z')
const BUILT = new Date('2026-01-15T00:00:00Z')
const NEWER = new Date('2026-02-01T00:00:00Z')

/** A Next-like SSR project that already has a server bundle. */
function serverProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-auto-update-'))
  mkdirSync(resolve(root, 'node_modules'))
  mkdirSync(resolve(root, 'src'))
  mkdirSync(resolve(root, '.next'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'd', build: 'b', start: 's' } }))
  writeFileSync(resolve(root, 'src/page.tsx'), 'export default "v1"')
  writeFileSync(resolve(root, '.next/BUILD_ID'), 'build-1')
  for (const file of ['package.json', 'src/page.tsx']) utimesSync(resolve(root, file), OLD, OLD)
  utimesSync(resolve(root, '.next/BUILD_ID'), BUILT, BUILT)
  return root
}

function editSource(root, text, at = NEWER) {
  writeFileSync(resolve(root, 'src/page.tsx'), text)
  utimesSync(resolve(root, 'src/page.tsx'), at, at)
}

test('a server bundle is stale only when source is newer than what built it', async () => {
  const root = serverProject()
  try {
    assert.equal(await serverBundle.serverBundleStale(root), false, 'bundle written after the source')
    editSource(root, 'export default "v2"')
    assert.equal(await serverBundle.serverBundleStale(root), true, 'mtime rule without a record')
    const record = await serverBundle.currentServerBuildRecord(root, 1)
    assert.equal(await serverBundle.serverBundleStale(root, record), false, 'a matching record compares fingerprints')
    editSource(root, 'export default "v3"', new Date('2026-03-01T00:00:00Z'))
    assert.equal(await serverBundle.serverBundleStale(root, record), true)
    rmSync(resolve(root, '.next'), { recursive: true })
    assert.equal(await serverBundle.serverBundleStale(root, record), null, 'no bundle, nothing to compare')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * Fake npm: `start` prints a loopback URL; `build` runs `onBuild` (which may
 * rewrite `.next`) and exits with its return code.
 */
function createManager(root, onBuild, extra = {}) {
  const userData = mkdtempSync(resolve(tmpdir(), 'agentos-auto-update-data-'))
  const spawns = []
  const manager = new runtime.LocalAppRuntimeManager({
    ...extra,
    userDataPath: userData,
    allocatePort: async () => 45720,
    fetch: async () => ({ status: 200 }),
    defaults: { readinessTimeoutMs: 300, probeIntervalMs: 1, probeTimeoutMs: 10, termTimeoutMs: 20, killTimeoutMs: 20 },
    spawn: (_executable, args) => {
      const joined = args.join(' ')
      const kind = args[1] === 'build' ? 'build' : /\["run","start"\]/.test(joined) ? 'start' : 'other'
      spawns.push(kind)
      const child = new EventEmitter()
      child.pid = 999800 - spawns.length
      child.exitCode = null
      child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}; child.stderr.setEncoding = () => {}
      queueMicrotask(() => {
        if (kind === 'build') {
          const code = onBuild()
          if (code === null) return // hangs until terminated
          if (code !== 0) child.stderr.emit('data', 'Error: Type error in src/page.tsx\n}\n')
          child.exitCode = code
          child.emit('exit', code, null)
        } else {
          child.stdout.emit('data', 'ready at http://127.0.0.1:45720/')
        }
      })
      return child
    },
  })
  const definition = {
    id: 'auto-update-test', name: 'SSR fixture', rootPath: root, canonicalRoot: root,
    packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] },
    trustStatus: 'trusted', autoStart: true, createdAt: 1, updatedAt: 1,
  }
  manager.register(definition)
  return { manager, spawns, userData, id: definition.id }
}

test('a stale server bundle is rebuilt in place and served again (C-RSM-502)', async () => {
  const root = serverProject()
  const { manager, spawns, userData, id } = createManager(root, () => {
    writeFileSync(resolve(root, '.next/BUILD_ID'), 'build-2')
    return 0
  })
  try {
    const started = await manager.start(id, 'tab:view')
    assert.equal(started.status, 'running')
    assert.deepEqual(spawns, ['start'], 'a fresh bundle is served without building')
    assert.equal((await manager.updateToLatest(id)).buildStatus, undefined, 'nothing to do while fresh')
    assert.deepEqual(spawns, ['start'])

    editSource(root, 'export default "v2"')
    const updated = await manager.updateToLatest(id)
    assert.equal(updated.status, 'running')
    assert.equal(updated.buildStatus, 'ready')
    assert.ok(updated.generation > started.generation, 'a rebuilt bundle is a new instance, so its Preview is recreated')
    assert.notEqual(updated.runtimeId, started.runtimeId)
    assert.deepEqual(spawns, ['start', 'build', 'start'])
    assert.equal(readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8'), 'build-2')
    assert.equal(existsSync(resolve(root, '.next.agentos-backup')), false, 'backup discarded after success')
    const records = JSON.parse(readFileSync(resolve(userData, 'local-app-server-builds.json'), 'utf8'))
    assert.equal(records[id].buildId, 'build-2')

    await manager.updateToLatest(id)
    assert.deepEqual(spawns, ['start', 'build', 'start'], 'the recorded build is current')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a failed server update restores the previous bundle and does not retry the same source (DI-RSM-503)', async () => {
  const root = serverProject()
  let builds = 0
  const { manager, spawns, userData, id } = createManager(root, () => {
    builds += 1
    // `next build` wipes `.next` before failing.
    rmSync(resolve(root, '.next'), { recursive: true, force: true })
    mkdirSync(resolve(root, '.next'))
    return 1
  })
  try {
    await manager.start(id, 'tab:view')
    editSource(root, 'export default "broken"')
    const failed = await manager.updateToLatest(id)
    assert.equal(failed.status, 'running', 'the previous bundle serves again')
    assert.equal(failed.buildStatus, 'build_failed')
    assert.equal(failed.errorCode, 'update-failed')
    assert.match(failed.detail, /Type error/)
    assert.equal(readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8'), 'build-1', 'backup restored')
    assert.deepEqual(spawns, ['start', 'build', 'start'])

    await manager.updateToLatest(id)
    assert.equal(builds, 1, 'the same failing source is not rebuilt automatically')
    await manager.updateToLatest(id, { force: true })
    assert.equal(builds, 2, 'an explicit retry always rebuilds')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('stopping during a server update restores the previous bundle (DI-RSM-503)', async () => {
  const root = serverProject()
  const { manager, spawns, userData, id } = createManager(root, () => {
    rmSync(resolve(root, '.next'), { recursive: true, force: true })
    mkdirSync(resolve(root, '.next'))
    return null
  })
  try {
    await manager.start(id, 'tab:view')
    editSource(root, 'export default "v2"')
    const updating = manager.updateToLatest(id)
    for (let i = 0; i < 200 && !spawns.includes('build'); i += 1) await new Promise((r) => setTimeout(r, 5))
    assert.ok(spawns.includes('build'), 'the build started')
    await manager.stop(id, 'user')
    await updating
    assert.equal(readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8'), 'build-1', 'backup restored on cancel')
    assert.equal(existsSync(resolve(root, '.next.agentos-backup')), false)
    assert.equal(spawns.filter((kind) => kind === 'start').length, 1, 'a stopped runtime is not restarted')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a stale static artifact is rebuilt automatically instead of only flagged (C-RSM-502)', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-auto-update-static-'))
  mkdirSync(resolve(root, 'node_modules'))
  mkdirSync(resolve(root, 'src'))
  mkdirSync(resolve(root, 'out'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'd', build: 'b' } }))
  writeFileSync(resolve(root, 'src/page.tsx'), 'v1')
  writeFileSync(resolve(root, 'out/index.html'), '<h1>v1</h1>')
  const { manager, spawns, userData, id } = createManager(root, () => {
    writeFileSync(resolve(root, 'out/index.html'), '<h1>v2</h1>')
    return 0
  })
  try {
    const started = await manager.start(id, 'tab:view')
    assert.equal(started.mode, 'static')
    assert.ok(started.artifactId, 'the existing out/ is adopted without building')
    await manager.updateToLatest(id)
    assert.deepEqual(spawns, [], 'fresh artifact, nothing to build')
    editSource(root, 'v2', new Date(Date.now() + 60_000))
    const rebuilt = await manager.updateToLatest(id)
    assert.deepEqual(spawns, ['build'])
    assert.equal(rebuilt.buildStatus, 'ready')
    assert.notEqual(rebuilt.artifactId, started.artifactId)
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('refresh starts through the serve ladder when nothing is viewable, and force-rebuilds when it is (C-RSM-501)', async () => {
  const root = serverProject()
  const { manager, spawns, userData, id } = createManager(root, () => {
    writeFileSync(resolve(root, '.next/BUILD_ID'), 'build-2')
    return 0
  })
  try {
    const started = await manager.refresh(id)
    assert.equal(started.status, 'running')
    assert.deepEqual(spawns, ['start'], 'not viewable yet: the ladder serves the existing bundle')
    const rebuilt = await manager.refresh(id)
    assert.equal(rebuilt.status, 'running')
    assert.deepEqual(spawns, ['start', 'build', 'start'], 'viewable: an explicit refresh rebuilds even without source changes')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

// `DI-RSM-501`: no entry decides static versus server on its own.
test('build, update and new-workbench entries never hardcode static mode', () => {
  const main = readFileSync(resolve(testDir, 'main.ts'), 'utf8')
  const buildHandler = main.slice(main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.buildRuntime'), main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.cancelRuntimeBuild'))
  assert.match(buildHandler, /localAppRuntimeManager\.refresh\(id\)/)
  assert.doesNotMatch(buildHandler, /mode: 'static'/)
  assert.doesNotMatch(buildHandler, /static-runtime-required/)
  const appShell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  const createFlow = appShell.slice(appShell.indexOf("window.desktop.startRuntime(result.definition.id, 'user'"), appShell.indexOf("window.desktop.startRuntime(result.definition.id, 'user'") + 600)
  assert.doesNotMatch(createFlow, /buildRuntime/, 'a user start already builds when it must')
})

test('a static project that stops exporting pages is served as a server after its rebuild (③→②)', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'agentos-auto-update-to-server-'))
  mkdirSync(resolve(root, 'node_modules'))
  mkdirSync(resolve(root, 'src'))
  mkdirSync(resolve(root, 'out'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts: { dev: 'd', build: 'b', start: 's' } }))
  writeFileSync(resolve(root, 'src/page.tsx'), 'v1')
  writeFileSync(resolve(root, 'out/index.html'), '<h1>v1</h1>')
  const { manager, spawns, userData, id } = createManager(root, () => {
    rmSync(resolve(root, 'out'), { recursive: true, force: true })
    mkdirSync(resolve(root, '.next'), { recursive: true })
    writeFileSync(resolve(root, '.next/BUILD_ID'), 'ssr-1')
    return 0
  })
  try {
    assert.equal((await manager.start(id, 'tab:view')).mode, 'static')
    editSource(root, 'v2', new Date(Date.now() + 60_000))
    const served = await manager.updateToLatest(id)
    assert.deepEqual(spawns, ['build', 'start'])
    assert.equal(served.status, 'running')
    assert.equal(served.mode, 'development')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('an outdated server bundle is rebuilt before it is served, not pulled away after (C-RSM-503)', async () => {
  const root = serverProject()
  editSource(root, 'export default "v2"')
  const { manager, spawns, userData, id } = createManager(root, () => {
    writeFileSync(resolve(root, '.next/BUILD_ID'), 'build-2')
    return 0
  }, { autoUpdate: true })
  try {
    const started = await manager.start(id, 'tab:view')
    assert.equal(started.status, 'running')
    assert.equal(started.buildStatus, 'ready')
    assert.deepEqual(spawns, ['build', 'start'], 'build first, then serve once')
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(spawns, ['build', 'start'], 'the post-start check finds it current')
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a failed rebuild before start serves the previous bundle and is not repeated on the next start', async () => {
  const root = serverProject()
  editSource(root, 'export default "broken"')
  let builds = 0
  const { manager, spawns, userData, id } = createManager(root, () => {
    builds += 1
    rmSync(resolve(root, '.next'), { recursive: true, force: true })
    mkdirSync(resolve(root, '.next'))
    return 1
  }, { autoUpdate: true })
  try {
    const started = await manager.start(id, 'tab:view')
    assert.equal(started.status, 'running')
    assert.equal(started.buildStatus, 'build_failed')
    assert.equal(started.errorCode, 'update-failed')
    assert.equal(readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8'), 'build-1')
    await manager.restart(id)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(builds, 1, 'the same failing source is not rebuilt on restart')
    assert.equal(spawns.filter((kind) => kind === 'start').length, 2)
  } finally {
    await manager.stopAll('app-quit')
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})
