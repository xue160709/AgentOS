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
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (specifier === 'node:path') return { default: require('node:path') }
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function bridgeHarness(inspected) {
  const { RuntimeEditRuntimeBridge } = loadTsModule(resolve(testDir, './local-app-runtime/index.ts'))
  const calls = []
  const manager = {
    register: (definition) => calls.push(['register', definition]),
    start: async (id, consumer) => { calls.push(['start', id, consumer]); return {} },
    release: async (id, consumer) => { calls.push(['release', id, consumer]); return null },
    build: async (id) => { calls.push(['build', id]); return {} },
    cancelBuild: async (id) => { calls.push(['cancel', id]); return null },
  }
  const coordinator = {
    beginBuild: (projectId, generation) => { calls.push(['begin', projectId, generation]); return 'build-operation' },
    completeBuild: (projectId, generation, operationId) => { calls.push(['complete', projectId, generation, operationId]); return true },
  }
  const definition = { id: 'runtime-1', rootPath: '/project', canonicalRoot: '/project', trustStatus: 'trusted', mode: 'static', agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'dist', entryFile: 'index.html' } }
  return { calls, bridge: new RuntimeEditRuntimeBridge({ coordinator, manager, resolveDefinition: () => definition, inspect: async () => inspected }) }
}

test('Runtime edit bridge switches a static workbench to a clean dev runtime and scopes it to the edit lease', async () => {
  const staticWithDev = bridgeHarness({ ok: true, rootPath: '/project', canonicalRoot: '/project', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'static', agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'dist', entryFile: 'index.html' } })
  await staticWithDev.bridge.handle({ type: 'agent-lease-acquired', projectId: 'project-1', requestId: 'run-1', toolUseId: 'tool-1', editGeneration: 1 })
  await staticWithDev.bridge.handle({ type: 'agent-lease-released', projectId: 'project-1', requestId: 'run-1', toolUseId: 'tool-1', editGeneration: 1 })
  assert.equal(staticWithDev.calls[0][0], 'register')
  assert.equal(staticWithDev.calls[0][1].mode, 'development')
  assert.equal(staticWithDev.calls[0][1].agentos, undefined)
  assert.deepEqual(staticWithDev.calls.slice(1), [
    ['start', 'runtime-1', 'runtime-edit:project-1:run-1:tool-1'],
    ['release', 'runtime-1', 'runtime-edit:project-1:run-1:tool-1'],
  ])

  const development = bridgeHarness({ ok: true, rootPath: '/project', canonicalRoot: '/project', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'development' })
  await development.bridge.handle({ type: 'agent-lease-acquired', projectId: 'project-1', requestId: 'run-1', toolUseId: 'tool-1', editGeneration: 1 })
  await development.bridge.handle({ type: 'agent-lease-released', projectId: 'project-1', requestId: 'run-1', toolUseId: 'tool-1', editGeneration: 1 })
  assert.equal(development.calls[0][0], 'register')
  assert.equal(development.calls[0][1].mode, 'development')
  assert.deepEqual(development.calls.slice(1), [
    ['start', 'runtime-1', 'runtime-edit:project-1:run-1:tool-1'],
    ['release', 'runtime-1', 'runtime-edit:project-1:run-1:tool-1'],
  ])
})

test('Runtime edit bridge runs exactly the fixed static build at settle and never guesses for development-only or static-only live preview', async () => {
  const staticOnly = bridgeHarness({ ok: true, rootPath: '/project', canonicalRoot: '/project', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: false, mode: 'static', agentos: { mode: 'static', buildCommand: 'npm run build', outputRoot: 'dist', entryFile: 'index.html' } })
  await staticOnly.bridge.handle({ type: 'agent-lease-acquired', projectId: 'project-1', requestId: 'run-1', toolUseId: 'tool-1', editGeneration: 1 })
  assert.deepEqual(staticOnly.calls, [])
  await staticOnly.bridge.handle({ type: 'settle', projectId: 'project-1', editGeneration: 1, operationId: 'settle-1' })
  assert.deepEqual(staticOnly.calls.map((call) => call[0]), ['begin', 'register', 'build', 'complete'])

  const developmentOnly = bridgeHarness({ ok: true, rootPath: '/project', canonicalRoot: '/project', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'development' })
  await developmentOnly.bridge.handle({ type: 'settle', projectId: 'project-1', editGeneration: 1, operationId: 'settle-1' })
  assert.deepEqual(developmentOnly.calls, [])
})

test('a new potential writer fences an in-flight Runtime build without selecting a build command', async () => {
  const { bridge, calls } = bridgeHarness({ ok: false, rootPath: '/project', code: 'dev-script-missing', message: 'missing' })
  await bridge.handle({ type: 'potential-run-registered', projectId: 'project-1', requestId: 'run-2', editGeneration: 2 })
  assert.deepEqual(calls, [['cancel', 'runtime-1']])
})
