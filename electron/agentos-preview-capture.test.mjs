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
  const { outputText } = ts.transpileModule(readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: resolvedPath,
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

function previewHarness(onAgentOSDeepLink) {
  const preview = loadTsModule(resolve(testDir, './local-app-runtime/preview.ts'))
  const views = []
  const manager = new preview.LocalAppPreviewManager({
    window: { contentView: { addChildView: () => undefined, removeChildView: () => undefined } },
    createView: () => {
      const contents = new EventEmitter()
      contents.setWindowOpenHandler = (handler) => { contents.windowOpenHandler = handler }
      contents.loadURL = async () => undefined
      contents.reload = async () => undefined
      contents.close = () => undefined
      contents.session = { setPermissionRequestHandler: () => undefined }
      const view = { webContents: contents, setBounds: () => undefined, setVisible: () => undefined }
      views.push(contents)
      return view
    },
    onAgentOSDeepLink,
  })
  return { manager, views }
}

function deepLink(action, requestId) {
  return `agentos://v1/${action}?origin=${encodeURIComponent('https://example.com/')}&request_id=${requestId}`
}

test('Preview captures only valid AgentOS links through the shared parser/queue and never navigates or opens them', async () => {
  const protocol = loadTsModule(resolve(testDir, './agentos-deep-link.ts'))
  const queued = new protocol.AgentOSDeepLinkQueue()
  const captured = []
  const { manager, views } = previewHarness((rawUrl, session) => {
    const parsed = protocol.parseAgentOSDeepLink(rawUrl)
    if (parsed.ok && queued.enqueue(parsed.value)) captured.push({ link: parsed.value, generation: session.generation })
  })
  await manager.create('preview-agentos', 'tab-1', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })

  const pair = deepLink('pair', 'p'.repeat(16))
  const task = deepLink('task', 't'.repeat(16))
  let prevented = 0
  const navigation = { preventDefault: () => { prevented += 1 } }
  views[0].emit('will-navigate', navigation, pair)
  views[0].emit('will-redirect', navigation, pair)
  assert.deepEqual(views[0].windowOpenHandler({ url: task }), { action: 'deny' })
  assert.deepEqual(views[0].windowOpenHandler({ url: task }), { action: 'deny' })

  for (const invalid of [
    'agentos://v1/unknown?origin=https%3A%2F%2Fexample.com%2F&request_id=xxxxxxxxxxxxxxxx',
    `agentos://v1/task?origin=${encodeURIComponent('https://example.com/')}&request_id=${'x'.repeat(2_100)}`,
  ]) views[0].emit('will-navigate', navigation, invalid)
  views[0].emit('will-navigate', navigation, 'https://example.com/')

  assert.equal(prevented, 5, 'every agentos target and external navigation is blocked')
  assert.deepEqual(captured, [
    { link: { action: 'pair', origin: 'https://example.com', requestId: 'p'.repeat(16) }, generation: 1 },
    { link: { action: 'task', origin: 'https://example.com', requestId: 't'.repeat(16) }, generation: 1 },
  ])
  assert.deepEqual(queued.drain(), captured.map(({ link }) => link))
})

test('Destroyed or replaced Preview generations cannot capture AgentOS links', async () => {
  const captured = []
  const { manager, views } = previewHarness((rawUrl, session) => captured.push({ rawUrl, generation: session.generation }))
  const task = deepLink('task', 't'.repeat(16))
  await manager.create('preview-generation', 'tab-1', 'local-app-1', { runtimeId: 'runtime-1', generation: 1, readyUrl: 'http://127.0.0.1:3001/' })
  await manager.create('preview-generation', 'tab-1', 'local-app-1', { runtimeId: 'runtime-2', generation: 2, readyUrl: 'http://127.0.0.1:3002/' })

  let stalePrevented = false
  views[0].emit('will-navigate', { preventDefault: () => { stalePrevented = true } }, task)
  assert.equal(stalePrevented, true)
  assert.deepEqual(captured, [])

  await manager.close('preview-generation')
  let closedPrevented = false
  views[1].emit('will-navigate', { preventDefault: () => { closedPrevented = true } }, task)
  assert.equal(closedPrevented, true)
  assert.deepEqual(captured, [])
})

test('Main binds the Preview seam to the existing AgentOS parser/queue without adding a Preview bridge', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  const preview = readFileSync(resolve(testDir, './local-app-runtime/preview.ts'), 'utf8')
  assert.match(main, /onAgentOSDeepLink:\s*enqueueAgentOSPreviewDeepLink/)
  assert.match(main, /enqueueAgentOSDeepLink\(raw\)/)
  assert.match(main, /current\.runtimeId === preview\.runtimeId && current\.generation === preview\.generation/)
  assert.match(preview, /preload:\s*undefined/)
  assert.doesNotMatch(preview, /contextBridge|ipcRenderer|capability token/i)
})
