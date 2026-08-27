import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: resolvedPath })
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

const preview = loadTsModule(resolve(testDir, './local-app-runtime/preview.ts'))

test('Preview navigation is limited to the current loopback origin', () => {
  assert.equal(preview.isAllowedPreviewNavigation('http://127.0.0.1:3001/path', 'http://127.0.0.1:3001'), true)
  assert.equal(preview.isAllowedPreviewNavigation('https://example.com/', 'http://127.0.0.1:3001'), false)
  assert.equal(preview.isAllowedPreviewNavigation('http://127.0.0.1:3002/', 'http://127.0.0.1:3001'), false)
  const token = 'a'.repeat(48)
  assert.equal(preview.isAllowedPreviewNavigation(`agentos-static://${token}/route`, `agentos-static://${token}/`), true)
  assert.equal(preview.isAllowedPreviewNavigation(`agentos-static://${'b'.repeat(48)}/route`, `agentos-static://${token}/`), false)
  assert.equal(preview.isAllowedPreviewNavigation('https://example.com/route', `agentos-static://${token}/`), false)
})

test('Preview manager creates a sandboxed view and rejects external windows/navigation', async () => {
  const views = []
  const partitions = []
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = (handler) => { contents.windowOpenHandler = handler }
  contents.loadURL = async () => undefined
  contents.reload = async () => undefined
  contents.close = () => undefined
  contents.session = { setPermissionRequestHandler: (handler) => { contents.permissionHandler = handler } }
  const view = { webContents: contents, setBounds: (bounds) => { view.bounds = bounds }, setVisible: (value) => { view.visible = value } }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: (value) => views.push(value), removeChildView: () => undefined } },
    createView: (options) => { view.options = options; partitions.push(options.webPreferences.partition); return view },
  })
  const snapshot = await manager.create('preview-1', 'tab-1', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  assert.equal(snapshot.status, 'ready')
  assert.equal(view.options.webPreferences.nodeIntegration, false)
  assert.equal(view.options.webPreferences.contextIsolation, true)
  assert.equal(view.options.webPreferences.sandbox, true)
  assert.equal(view.options.webPreferences.preload, undefined)
  assert.match(view.options.webPreferences.partition, /^local-app-/)
  assert.match(view.options.webPreferences.partition, /local-app-1-tab-1-preview-1-1/)
  assert.doesNotMatch(view.options.webPreferences.partition, /^persist:/)
  assert.deepEqual(contents.windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' })
  assert.equal(preview.isAllowedPreviewNavigation('https://example.com/', 'http://127.0.0.1:3001'), false)
  assert.equal(views.length, 1)
  await manager.create('preview-2', 'tab-2', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  assert.notEqual(partitions[0], partitions[1])
  await manager.close('preview-1')
  assert.equal(manager.get('preview-1'), null)
})

test('Static Preview registers its partition handler before load and pins the opaque host', async () => {
  const tokenA = 'a'.repeat(48)
  const tokenB = 'b'.repeat(48)
  const order = []
  let handler
  const session = {
    protocol: {
      isProtocolHandled: async () => { order.push('is-handled'); return false },
      handle: async (_scheme, callback) => { order.push('handle'); handler = callback },
    },
    setPermissionRequestHandler: () => undefined,
  }
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = async () => {
    order.push('load')
    assert.equal(typeof handler, 'function')
    assert.equal((await handler({ url: `agentos-static://${tokenB}/`, method: 'GET' })).status, 403)
    assert.equal((await handler({ url: `agentos-static://${tokenA}/`, method: 'GET' })).status, 200)
  }
  contents.close = () => undefined
  contents.session = session
  const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => view,
    registerStaticPreviewSession: async (currentSession, previewUrl) => {
      order.push('register')
      assert.equal(currentSession, session)
      const allowedHost = new URL(previewUrl).hostname
      if (await currentSession.protocol.isProtocolHandled('agentos-static')) return
      await currentSession.protocol.handle('agentos-static', async (request) => {
        return new URL(request.url).hostname === allowedHost ? { status: 200 } : { status: 403 }
      })
    },
  })
  const snapshot = await manager.create('preview-static-session', 'tab-static', 'local-app-static', {
    runtimeId: 'runtime-static', generation: 1, previewUrl: `agentos-static://${tokenA}/`,
  })
  assert.equal(snapshot.status, 'ready')
  assert.deepEqual(order, ['register', 'is-handled', 'handle', 'load'])
  let prevented = false
  contents.emit('will-navigate', { preventDefault: () => { prevented = true } }, `agentos-static://${tokenA}/route`)
  assert.equal(prevented, false)
  contents.emit('will-navigate', { preventDefault: () => { prevented = true } }, `agentos-static://${tokenB}/route`)
  assert.equal(prevented, true)
  contents.emit('will-navigate', { preventDefault: () => { prevented = true } }, 'https://example.com/route')
  assert.equal(prevented, true)
})

test('Preview manager reuses the same tab session and closes it by tab without touching Runtime', async () => {
  let createCount = 0
  let closeCount = 0
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = async () => undefined
  contents.close = () => { closeCount += 1 }
  contents.session = { setPermissionRequestHandler: () => undefined }
  const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => { createCount += 1; return view },
  })
  const first = await manager.create('preview-reuse', 'tab-reuse', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  const second = await manager.create('preview-reuse', 'tab-reuse', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  assert.equal(second, first)
  assert.equal(createCount, 1)
  await manager.closeForTab('tab-reuse')
  assert.equal(manager.get('preview-reuse'), null)
  assert.equal(closeCount, 1)
})

test('Preview navigation moves only when browser history allows it', async () => {
  let backCount = 0
  let forwardCount = 0
  let canGoBack = false
  let canGoForward = true
  const navigationStates = []
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = async () => undefined
  contents.close = () => undefined
  contents.canGoBack = () => canGoBack
  contents.canGoForward = () => canGoForward
  contents.goBack = () => { backCount += 1 }
  contents.goForward = () => { forwardCount += 1 }
  contents.session = { setPermissionRequestHandler: () => undefined }
  const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => view,
    onNavigationState: (state) => navigationStates.push(state),
  })
  await manager.create('preview-history', 'tab-history', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  assert.equal(manager.navigate('preview-history', 'back'), false)
  assert.equal(manager.navigate('preview-history', 'forward'), true)
  canGoBack = true
  canGoForward = false
  contents.emit('did-navigate-in-page')
  assert.deepEqual(navigationStates.at(-1), { previewId: 'preview-history', canGoBack: true, canGoForward: false })
  assert.equal(manager.navigate('preview-history', 'back'), true)
  assert.equal(manager.navigate('preview-history', 'forward'), false)
  assert.equal(backCount, 1)
  assert.equal(forwardCount, 1)
})

test('Preview reload reports loading then ready and clears degraded state', async () => {
  const events = []
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = async () => undefined
  contents.reload = async () => {
    contents.emit('did-start-loading')
    contents.emit('did-finish-load')
  }
  contents.close = () => undefined
  contents.session = { setPermissionRequestHandler: () => undefined }
  const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => view,
    onEvent: (snapshot) => events.push({ status: snapshot.status, generation: snapshot.generation }),
  })
  await manager.create('preview-reload', 'tab-1', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  events.length = 0
  contents.emit('did-fail-load', {}, -2, 'temporary HMR disconnect')
  assert.equal(manager.get('preview-reload').status, 'degraded')
  assert.equal(await manager.reload('preview-reload'), true)
  assert.deepEqual(events.map((event) => event.status), ['degraded', 'loading', 'ready'])
  assert.equal(manager.get('preview-reload').status, 'ready')
})

test('Preview bounds conversion clamps invalid viewport coordinates', () => {
  assert.deepEqual(preview.previewBoundsFromRect({ left: -10, top: 12, width: 320, height: 180 }), { x: 0, y: 12, width: 320, height: 180 })
  assert.deepEqual(preview.previewBoundsFromRect({ left: Number.NaN, top: Number.POSITIVE_INFINITY, width: -1, height: 0 }), { x: 0, y: 0, width: 0, height: 0 })
})

test('Preview callbacks from an old generation cannot overwrite a replacement', async () => {
  const events = []
  const views = []
  const contentsFor = () => {
    const contents = new EventEmitter()
    contents.setWindowOpenHandler = () => undefined
    contents.loadURL = async () => undefined
    contents.reload = async () => undefined
    contents.close = () => undefined
    contents.session = { setPermissionRequestHandler: () => undefined }
    return contents
  }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => {
      const contents = contentsFor()
      const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
      views.push({ view, contents })
      return view
    },
    onEvent: (snapshot) => events.push(snapshot),
  })
  await manager.create('preview-generation', 'tab-1', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  await manager.create('preview-generation', 'tab-1', 'local-app-1', { runtimeId: 'runtime-2', generation: 2, readyUrl: 'http://127.0.0.1:3002/' })
  const before = events.length
  views[0].contents.emit('did-fail-load', {}, -2, 'old generation failed')
  assert.equal(manager.get('preview-generation').generation, 2)
  assert.equal(events.length, before)
})

test('Preview reload rejection from a replaced session cannot mark the active session failed', async () => {
  const views = []
  let rejectReload
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => {
      const contents = new EventEmitter()
      contents.setWindowOpenHandler = () => undefined
      contents.loadURL = async () => undefined
      contents.reload = () => new Promise((_, reject) => { rejectReload = reject })
      contents.close = () => undefined
      contents.session = { setPermissionRequestHandler: () => undefined }
      const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
      views.push({ view, contents })
      return view
    },
  })
  await manager.create('preview-stale-reload', 'tab-a', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  const pending = manager.reload('preview-stale-reload')
  await manager.create('preview-stale-reload', 'tab-b', 'local-app-1', { runtimeId: 'runtime-2', generation: 2, readyUrl: 'http://127.0.0.1:3002/' })
  rejectReload(new Error('old session failed'))
  assert.equal(await pending, false)
  assert.equal(manager.get('preview-stale-reload').generation, 2)
  assert.equal(manager.get('preview-stale-reload').status, 'ready')
})

test('Closing a tab while create is loading leaves no delayed Preview session', async () => {
  let resolveLoad
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = () => new Promise((resolve) => { resolveLoad = resolve })
  contents.close = () => undefined
  contents.session = { setPermissionRequestHandler: () => undefined }
  const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => view,
  })
  const pending = manager.create('preview-delayed-close', 'tab-delayed', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  await new Promise((resolve) => setImmediate(resolve))
  await manager.closeForTab('tab-delayed')
  resolveLoad()
  await pending
  assert.equal(manager.get('preview-delayed-close'), null)
})

test('Preview can publish loading immediately and reports readiness asynchronously', async () => {
  let resolveLoad
  const events = []
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = () => new Promise((resolve) => { resolveLoad = resolve })
  contents.close = () => undefined
  contents.stop = () => undefined
  contents.session = { setPermissionRequestHandler: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => ({ webContents: contents, setBounds: () => undefined, setVisible: () => undefined }),
    onEvent: (snapshot) => events.push(snapshot.status),
  })

  const snapshot = await manager.create(
    'preview-background',
    'tab-background',
    'local-app-1',
    { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' },
    { waitForLoad: false },
  )
  assert.equal(snapshot.status, 'loading')
  resolveLoad()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(manager.get('preview-background').status, 'ready')
  assert.equal(manager.isCurrent('preview-background', snapshot), true)
  assert.deepEqual(events, ['loading', 'ready'])
})

test('Preview load timeout becomes a recoverable failed state', async () => {
  let stopped = false
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = () => undefined
  contents.loadURL = () => new Promise(() => undefined)
  contents.close = () => undefined
  contents.stop = () => { stopped = true }
  contents.session = { setPermissionRequestHandler: () => undefined }
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => ({ webContents: contents, setBounds: () => undefined, setVisible: () => undefined }),
    loadTimeoutMs: 5,
  })

  const snapshot = await manager.create('preview-timeout', 'tab-timeout', 'local-app-1', {
    runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/',
  })
  assert.equal(snapshot.status, 'failed')
  assert.match(snapshot.detail, /超时/)
  assert.equal(stopped, true)
})
