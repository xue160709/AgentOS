import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolved = resolve(modulePath)
  const cached = cache.get(resolved)
  if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolved,
  })
  const module = { exports: {} }
  cache.set(resolved, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolved), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

class FakeWindow {
  constructor(id, load) {
    this.webContents = { id, on: (event, listener) => { this.webListeners.set(event, listener) } }
    this.load = load
    this.listeners = new Map()
    this.webListeners = new Map()
    this.bounds = { x: 12, y: 34, width: 800, height: 600 }
    this.destroyed = false
    this.showCount = 0
    this.focusCount = 0
    this.destroyCount = 0
  }
  on(event, listener) { this.listeners.set(event, listener) }
  async loadURL(url) { this.url = url; return this.load?.(url) }
  show() { this.showCount += 1 }
  focus() { this.focusCount += 1 }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyCount += 1; this.destroyed = true }
  getBounds() { return this.bounds }
  emit(event) { this.listeners.get(event)?.() }
  emitDestroyed() { this.webListeners.get('destroyed')?.() }
}

class FakeTimer {
  constructor() { this.tasks = [] }
  set(callback, delayMs) { const task = { callback, delayMs }; this.tasks.push(task); return task }
  clear(handle) { this.tasks = this.tasks.filter((task) => task !== handle) }
  fire() { const tasks = [...this.tasks]; this.tasks = []; for (const task of tasks) task.callback() }
}

function stateStore() {
  const saves = []
  return {
    saves,
    get: async () => ({ schemaVersion: 1, projectId: 'ignored', draft: '', externalTaskSeenAt: 0, updatedAt: 0 }),
    resolveBounds: () => ({ x: 100, y: 80, width: 1024, height: 760 }),
    save: async (input) => { saves.push(input); return { schemaVersion: 1, ...input.patch, projectId: input.projectId, draft: input.patch.draft ?? '', externalTaskSeenAt: input.patch.externalTaskSeenAt ?? 0, updatedAt: 1 } },
  }
}

test('Project Chat window manager reuses same project windows and registers a fixed secure capability before load', async () => {
  const { RendererCapabilityRegistry } = loadTsModule(resolve(testDir, './project-chat-ipc.ts'))
  const { ProjectChatWindowManager } = loadTsModule(resolve(testDir, './project-chat-window-manager.ts'))
  const registry = new RendererCapabilityRegistry()
  const windows = []
  const store = stateStore()
  const manager = new ProjectChatWindowManager({
    createWindow: (options) => {
      const window = new FakeWindow(windows.length + 10, (url) => {
        assert.equal(registry.get(window.webContents.id)?.projectId, new URL(url).searchParams.get('projectId'))
      })
      window.options = options
      windows.push(window)
      return window
    },
    rendererEntry: 'http://renderer.test/index.html?attacker=1', preloadPath: '/main-controlled/preload.mjs', capabilities: registry,
    routeGenerationOf: () => 4, viewStateStore: store, resolveProjectName: () => 'Project', onWebContentsUnavailable: () => {},
  })
  const first = await manager.open('project-1')
  const duplicate = await manager.open('project-1')
  const secondProject = await manager.open('project-2')
  assert.strictEqual(first, duplicate)
  assert.equal(windows.length, 2)
  assert.equal(first.showCount, 1)
  assert.equal(first.focusCount, 1)
  assert.equal(registry.get(10).routeGeneration, 4)
  assert.equal(registry.get(11).projectId, 'project-2')
  assert.deepEqual(first.options.webPreferences, {
    preload: '/main-controlled/preload.mjs', contextIsolation: true, nodeIntegration: false, sandbox: true,
    additionalArguments: ['--agentos-window-kind=project-chat'],
  })
  const url = new URL(first.url)
  assert.equal(url.searchParams.get('window-kind'), 'project-chat')
  assert.equal(url.searchParams.get('projectId'), 'project-1')
  assert.equal(first.options.title, 'Project · Chat · AgentOS')
  assert.notEqual(secondProject, first)
})

test('Project Chat window cleanup and debounce flush are idempotent without cancelling any run', async () => {
  const { RendererCapabilityRegistry } = loadTsModule(resolve(testDir, './project-chat-ipc.ts'))
  const { ProjectChatWindowManager } = loadTsModule(resolve(testDir, './project-chat-window-manager.ts'))
  const registry = new RendererCapabilityRegistry()
  const timer = new FakeTimer()
  const store = stateStore()
  const unavailable = []
  const window = new FakeWindow(21)
  const manager = new ProjectChatWindowManager({
    createWindow: () => window, rendererEntry: 'http://renderer.test/index.html', preloadPath: '/preload', capabilities: registry,
    routeGenerationOf: () => 1, viewStateStore: store, timer, onWebContentsUnavailable: (id) => unavailable.push(id),
  })
  await manager.open('project-1')
  manager.queueViewState('project-1', { draft: 'kept' })
  assert.equal(timer.tasks[0].delayMs, 300)
  window.emit('blur')
  await manager.flushViewState('project-1')
  assert.equal(store.saves.some((input) => input.patch.draft === 'kept'), true)
  window.emit('close')
  window.emit('closed')
  window.emitDestroyed()
  await Promise.resolve()
  assert.equal(registry.get(21), undefined)
  assert.deepEqual(unavailable, [21])
  assert.equal(manager.get('project-1'), undefined)
  assert.equal(store.saves.some((input) => input.patch.bounds?.width === 800), true, 'close flushes current bounds')
})

test('Project Chat window load failure destroys the failed window and cleans once without lifecycle timeouts', async () => {
  const { RendererCapabilityRegistry } = loadTsModule(resolve(testDir, './project-chat-ipc.ts'))
  const { ProjectChatWindowManager } = loadTsModule(resolve(testDir, './project-chat-window-manager.ts'))
  const registry = new RendererCapabilityRegistry()
  const unavailable = []
  const window = new FakeWindow(31, async () => { throw new Error('load failed') })
  const manager = new ProjectChatWindowManager({
    createWindow: () => window, rendererEntry: 'http://renderer.test/index.html', preloadPath: '/preload', capabilities: registry,
    routeGenerationOf: () => 1, viewStateStore: stateStore(), onWebContentsUnavailable: (id) => unavailable.push(id),
  })
  await assert.rejects(() => manager.open('project-1'), /load failed/)
  window.emitDestroyed()
  window.emit('closed')
  assert.equal(window.destroyCount, 1)
  assert.equal(registry.get(31), undefined)
  assert.deepEqual(unavailable, [31])
})

test('Project Chat window capability registration failure destroys the untracked window once', async () => {
  const { ProjectChatWindowManager } = loadTsModule(resolve(testDir, './project-chat-window-manager.ts'))
  const unavailable = []
  const window = new FakeWindow(32)
  const capabilities = {
    registerProjectWindow: () => undefined,
    unregister: () => {},
  }
  const manager = new ProjectChatWindowManager({
    createWindow: () => window, rendererEntry: 'http://renderer.test/index.html', preloadPath: '/preload', capabilities,
    routeGenerationOf: () => 1, viewStateStore: stateStore(), onWebContentsUnavailable: (id) => unavailable.push(id),
  })
  await assert.rejects(() => manager.open('project-1'), /capability-invalid/)
  window.emit('closed')
  window.emitDestroyed()
  assert.equal(window.destroyCount, 1)
  assert.deepEqual(unavailable, [32])
})

test('Project window forwards capability and leaves ordered cleanup to composition', async () => {
  const { RendererCapabilityRegistry } = loadTsModule(resolve(testDir, './project-chat-ipc.ts'))
  const { ProjectChatWindowManager } = loadTsModule(resolve(testDir, './project-chat-window-manager.ts'))
  const calls = []; const window = new FakeWindow(41)
  const manager = new ProjectChatWindowManager({
    createWindow: () => window, rendererEntry: 'http://renderer.test/index.html', preloadPath: '/preload', capabilities: new RendererCapabilityRegistry(), routeGenerationOf: () => 1, viewStateStore: stateStore(),
    onWebContentsUnavailable: () => calls.push('legacy'), onCapabilityRegistered: (capability) => calls.push(`register:${capability.webContentsId}`), onWindowCleanup: (id) => calls.push(`cleanup:${id}`),
  })
  await manager.open('project-1'); window.emit('closed'); window.emitDestroyed()
  assert.deepEqual(calls, ['register:41', 'cleanup:41'])
})

test('M0-05F keeps Project Chat renderer entry separated from the Main composition flag', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  assert.match(main, /PROJECT_CHAT_BROKER_V2_ENABLED/)
  const entry = readFileSync(resolve(testDir, '../src/main.tsx'), 'utf8')
  assert.match(entry, /window-kind'\) === 'project-chat'/)
  assert.match(entry, /ProjectChatWindowPage/)
  assert.match(entry, /<AppShell \/>/)
})
