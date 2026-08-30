import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url); const ts = require('typescript'); const root = dirname(fileURLToPath(import.meta.url))
function load(file, cache = new Map()) { const target = resolve(file); if (cache.has(target)) return cache.get(target).exports; const module = { exports: {} }; cache.set(target, module); const out = ts.transpileModule(readFileSync(target, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: target }).outputText; Function('exports', 'module', 'require', out)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(target), `${specifier}.ts`)) ? load(resolve(dirname(target), `${specifier}.ts`), cache) : require(specifier)); return module.exports }

class FakeWindow {
  constructor(id, loadError, loadGate) { this.destroyed = false; this.loadError = loadError; this.loadGate = loadGate; this.listeners = new Map(); this.webListeners = new Map(); this.webContents = { id, on: (event, listener) => this.webListeners.set(event, listener) } }
  on(event, listener) { const values = this.listeners.get(event) ?? []; values.push(listener); this.listeners.set(event, values) }
  emit(event, value) { for (const listener of this.listeners.get(event) ?? []) listener(value) }
  async loadURL(url) { this.url = url; if (this.loadGate) await this.loadGate; if (this.loadError) throw this.loadError }
  show() { this.shows = (this.shows ?? 0) + 1 } focus() { this.focuses = (this.focuses ?? 0) + 1 }
  isDestroyed() { return this.destroyed } isVisible() { return true } isFocused() { return true }
  getBounds() { return { x: 1, y: 2, width: 900, height: 700 } }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); this.webListeners.get('destroyed')?.() }
}

function harness({ failLoad = false, activateGeneration = 4, loadGate } = {}) {
  const { RuntimeDevelopmentWindowManager } = load(resolve(root, 'runtime-development-window-manager.ts')); const windows = []; const calls = []; const caps = new Map()
  const capabilities = { registerRuntimeDevelopmentWindow: (id, scope, routeGeneration, developmentGeneration) => { const capability = { kind: 'runtime-development', webContentsId: id, runtimeScopeId: scope, routeGeneration, developmentGeneration }; caps.set(id, capability); calls.push(`cap:${id}:${developmentGeneration}`); return capability }, unregister: (id) => { caps.delete(id); calls.push(`unregister:${id}`) } }
  const store = { state: new Map(), get: async (scope) => ({ schemaVersion: 1, runtimeScopeId: scope, draft: '', updatedAt: 0 }), resolveBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }), save: async (scope, input) => { calls.push(`save:${scope}`); return { schemaVersion: 1, runtimeScopeId: scope, draft: input.patch.draft ?? '', bounds: input.patch.bounds, updatedAt: 1 } }, flush: async () => { calls.push('flush') } }
  const manager = new RuntimeDevelopmentWindowManager({
    createWindow: (options) => { const window = new FakeWindow(windows.length + 10, failLoad ? new Error('load-failed') : null, loadGate); window.options = options; windows.push(window); return window }, rendererEntry: 'http://renderer.test/index.html', preloadPath: '/preload.mjs', capabilities, viewStateStore: store,
    prepare: async (scope) => ({ context: { runtimeScopeId: scope, runtimeName: scope === 'workspace:a' ? 'Alpha' : 'Beta', ownerLabel: '工作台', scopeAvailable: true }, authority: { runtimeScopeId: scope, routeGeneration: 2, developmentGeneration: 3 }, action: 'open' }),
    activate: async (preparation) => { calls.push('activate'); return { runtimeScopeId: preparation.authority.runtimeScopeId, routeGeneration: 2, developmentGeneration: activateGeneration, phase: 'live', activeRunCount: 0, activeAgentLeaseCount: 0, waitingPromptCount: 0, hasChanges: false, canSubmit: true, canReopen: false, canEnd: true, exitRequested: false, autoSaveAttempted: false } },
    requestExit: (authority) => calls.push(`exit:${authority.runtimeScopeId}:${authority.developmentGeneration}`), onCapabilityRegistered: (capability) => calls.push(`presence:${capability.webContentsId}:${capability.developmentGeneration}`), onWindowState: () => {}, onWindowCleanup: (id) => { calls.push(`cleanup:${id}`); capabilities.unregister(id) },
  })
  return { manager, windows, calls, caps }
}

test('same scope focuses one window while different scopes stay independent', async () => {
  const h = harness(); const first = await h.manager.open('workspace:a'); const duplicate = await h.manager.open('workspace:a'); const other = await h.manager.open('workspace:b')
  assert.equal(first.window, duplicate.window); assert.notEqual(first.window, other.window); assert.equal(h.windows.length, 2)
  assert.equal(first.window.options.webPreferences.additionalArguments[0], '--agentos-window-kind=runtime-development')
  assert.match(first.window.options.title, /Alpha.*工作台.*Runtime 开发/)
  assert.equal(new URL(first.window.url).searchParams.get('runtimeScopeId'), 'workspace:a')
  assert.equal(h.caps.get(first.window.webContents.id).developmentGeneration, 4, 'capability is refreshed after activation/reenter')
})

test('native close synchronously requests one exit, then flushes, destroys and cleanup never emits another exit', async () => {
  const h = harness(); const { window } = await h.manager.open('workspace:a'); let prevented = 0
  window.emit('close', { preventDefault: () => { prevented += 1 } }); window.emit('close', { preventDefault: () => { prevented += 1 } })
  assert.equal(h.calls.filter((value) => value.startsWith('exit:')).length, 1); assert.equal(h.calls.findIndex((value) => value.startsWith('exit:')) < h.calls.findIndex((value) => value.startsWith('save:')), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(window.destroyed, true); assert.equal(h.calls.filter((value) => value.startsWith('cleanup:')).length, 1); assert.equal(prevented, 2)
})

test('load failure releases capability, presence/window reference and never creates an exit intent', async () => {
  const h = harness({ failLoad: true }); await assert.rejects(() => h.manager.open('workspace:a'), /load-failed/)
  assert.equal(h.manager.get('workspace:a'), undefined); assert.equal(h.caps.size, 0); assert.equal(h.calls.some((value) => value.startsWith('exit:')), false); assert.equal(h.calls.filter((value) => value.startsWith('cleanup:')).length, 1)
})

test('close during load fences the late activation callback by window identity and generation', async () => {
  let releaseLoad; const gate = new Promise((resolve) => { releaseLoad = resolve }); const h = harness({ loadGate: gate })
  const opening = h.manager.open('workspace:a'); await new Promise((resolve) => setImmediate(resolve)); const window = h.windows[0]
  window.emit('close', { preventDefault() {} }); releaseLoad()
  await assert.rejects(opening, /stale-before-activation/); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.calls.includes('activate'), false); assert.equal(h.calls.filter((value) => value.startsWith('exit:')).length, 1); assert.equal(h.manager.get('workspace:a'), undefined)
})
