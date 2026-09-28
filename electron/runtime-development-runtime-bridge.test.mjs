import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
function load(modulePath, cache = new Map()) {
  const file = resolve(modulePath); const cached = cache.get(file); if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file })
  const module = { exports: {} }; cache.set(file, module)
  Function('exports', 'module', 'require', outputText)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(file), `${specifier}.ts`)) ? load(resolve(dirname(file), `${specifier}.ts`), cache) : require(specifier))
  return module.exports
}

const staticDeclaration = { mode: 'static', buildCommand: 'npm run build', outputRoot: 'dist', entryFile: 'index.html' }
const definition = { id: 'runtime', rootPath: '/runtime', canonicalRoot: '/runtime', trustStatus: 'trusted', owner: { kind: 'workspace' }, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } }
const authority = { runtimeScopeId: 'workspace:runtime', routeGeneration: 2, developmentGeneration: 3 }

function harness({ inspected, buildSnapshot, canCommit = true, startError, buildError, definitionValue = definition, resolveProspectiveRoot, currentSnapshot } = {}) {
  const { RuntimeDevelopmentRuntimeBridge } = load(resolve(testDir, './runtime-development-runtime-bridge.ts'))
  const { RuntimeRootExecutionRegistry } = load(resolve(testDir, './runtime-root-execution-registry.ts'))
  const rootExecutionRegistry = new RuntimeRootExecutionRegistry()
  const registeredDefinitions = new Map(definitionValue ? [[definitionValue.id, definitionValue]] : [])
  const calls = []; const completions = []
  const coordinator = {
    open: (input) => { calls.push(['open', input]); return { ...input, phase: 'opening' } },
    ready: (input) => { calls.push(['ready', input]); return true },
    failOpening: (input, code, message) => { calls.push(['fail-opening', input, code, message]); return true },
    snapshot: () => ({ ...authority, runtimeDefinitionId: 'runtime', phase: 'saving' }),
    canCommit: (fence) => { calls.push(['can-commit', fence]); return canCommit },
    completeSave: (fence, result) => { completions.push([fence, result]); return true },
    reenter: () => null,
  }
  const manager = {
    register: (value) => { registeredDefinitions.set(value.id, value); calls.push(['register', value]) },
    start: async (id, consumer, options) => { calls.push(['start', id, consumer, options]); if (startError) throw startError; return { status: 'running', mode: 'development' } },
    release: async (id, consumer) => { calls.push(['release', id, consumer]); return null },
    build: async (id, consumer, options) => { calls.push(['build', id, consumer]); if (buildError) throw buildError; calls.push(['guard-result', await options.beforeCommit()]); return buildSnapshot ?? { status: 'ready', mode: 'static', buildStatus: 'ready' } },
    cancelBuild: async (id) => { calls.push(['cancel', id]); return null },
    get: (id) => { calls.push(['get', id]); return currentSnapshot ?? null },
    restart: async (id) => { calls.push(['restart', id]); return { status: 'running', mode: 'development' } },
    acquireDevelopmentLease: async (id) => {
      calls.push(['acquire-lease', id]); const value = registeredDefinitions.get(id)
      if (!value) throw new Error('missing-definition')
      const acquired = await rootExecutionRegistry.acquire({ canonicalRoot: value.canonicalRoot ?? value.rootPath, runtimeDefinitionId: id, runtimeScopeId: value.owner.kind === 'project' ? `project:${value.owner.projectId}` : `workspace:${id}`, kind: 'development', generation: 1 })
      if (!acquired.ok) throw Object.assign(new Error(acquired.error.code), acquired.error)
      return acquired.lease
    },
    releaseDevelopmentLease: async (id, lease) => { calls.push(['release-lease', id]); if (lease) await rootExecutionRegistry.release(lease) },
    getRootExecutionRegistry: () => rootExecutionRegistry,
  }
  const bridge = new RuntimeDevelopmentRuntimeBridge({ coordinator, manager, resolveDefinition: () => definitionValue, resolveProspectiveRoot, inspect: async () => inspected ?? { ok: true, rootPath: '/runtime', canonicalRoot: '/runtime', name: 'runtime', hasLockfile: false, nodeModulesPresent: true, hasDevScript: false, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } }, fingerprint: async () => 'entry' })
  return { bridge, calls, completions, rootExecutionRegistry, manager }
}

async function captureBridgeLogs(run) {
  const logs = []
  const originalLog = console.log; const originalError = console.error
  console.log = (...args) => logs.push(args)
  console.error = (...args) => logs.push(args)
  try { await run() } finally { console.log = originalLog; console.error = originalError }
  return logs
}

test('static-only open acquires a development root lease without spawning or guessing a command', async () => {
  const h = harness()
  const snapshot = await h.bridge.open(authority)
  assert.equal(snapshot.phase, 'saving')
  assert.deepEqual(h.calls.map((call) => call[0]), ['open', 'register', 'acquire-lease', 'ready'])
  assert.equal(h.calls.find((call) => call[0] === 'register')[1].agentos.buildCommand, 'npm run build')
})

test('live-capable static open runs only the declared dev service under a session consumer', async () => {
  const h = harness({ inspected: { ok: true, rootPath: '/runtime', canonicalRoot: '/runtime', name: 'runtime', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } } })
  await h.bridge.open(authority)
  const registered = h.calls.find((call) => call[0] === 'register')[1]
  assert.equal(registered.mode, 'development'); assert.equal(registered.agentos, undefined)
  assert.match(h.calls.find((call) => call[0] === 'start')[2], /^runtime-development:workspace:runtime:2:3$/)
})

test('save revalidates the full coordinator fence immediately before atomic commit', async () => {
  const h = harness()
  const fence = { ...authority, operationId: 'save-1', type: 'save' }
  await h.bridge.handle(fence)
  assert.deepEqual(h.calls.filter((call) => call[0] === 'guard-result'), [['guard-result', true]])
  assert.deepEqual(h.completions, [[fence, 'saved']])
})

test('stale save guard cannot publish or close a newer generation', async () => {
  const h = harness({ canCommit: false })
  const fence = { ...authority, operationId: 'old-save', type: 'save' }
  await h.bridge.handle(fence)
  assert.equal(h.calls.some((call) => call[0] === 'build'), false)
  assert.deepEqual(h.completions, [])
})

test('build failure reports preview_update_failed input while preserving manager-owned last-good', async () => {
  const h = harness({ buildSnapshot: { status: 'build_failed', mode: 'static', buildStatus: 'build_failed', artifactId: 'last-good' } })
  const fence = { ...authority, operationId: 'save-1', type: 'save' }
  await h.bridge.handle(fence)
  assert.deepEqual(h.completions, [[fence, 'build-failed']])
})

test('duplicate close releases a static-only root lease once', async () => {
  const h = harness(); await h.bridge.open(authority)
  const closed = { ...authority, operationId: 'close-1', type: 'closed', retainRuntimeService: false }
  await h.bridge.handle(closed); await h.bridge.handle(closed)
  assert.equal(h.calls.filter((call) => call[0] === 'release-lease').length, 1)
})

test('development-only close releases only the session consumer so a Tab consumer may remain', async () => {
  const h = harness({ inspected: { ok: true, rootPath: '/runtime', canonicalRoot: '/runtime', name: 'runtime', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'development', servePlan: { kind: 'development', reason: 'no-build-script' } } })
  await h.bridge.open(authority)
  await h.bridge.handle({ ...authority, operationId: 'close-retain', type: 'closed', retainRuntimeService: true })
  const consumer = 'runtime-development:workspace:runtime:2:3'
  assert.deepEqual(h.calls.filter((call) => call[0] === 'release'), [['release', 'runtime', consumer]])
  assert.equal(h.calls.some((call) => call[0] === 'release-lease'), false)
})

test('uninitialized Project holds a canonical prospective lease before the session becomes live and releases it once', async () => {
  const projectAuthority = { runtimeScopeId: 'project:project-a', routeGeneration: 7, developmentGeneration: 1 }
  const h = harness({ definitionValue: null, resolveProspectiveRoot: async () => '/canonical/project/.agentos', inspected: { ok: true, rootPath: '/canonical/project/.agentos', canonicalRoot: '/canonical/project/.agentos', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: false, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } } })
  const snapshot = await h.bridge.open(projectAuthority)
  const lease = h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos')
  assert.equal(lease.runtimeScopeId, projectAuthority.runtimeScopeId)
  assert.equal(lease.runtimeDefinitionId, 'prospective:project:project-a')
  assert.deepEqual(h.calls.map((call) => call[0]), ['open', 'ready'])
  assert.equal(snapshot.phase, 'saving')

  const closed = { ...projectAuthority, operationId: 'close-project', type: 'closed', retainRuntimeService: false }
  await h.bridge.handle(closed); await h.bridge.handle(closed)
  assert.equal(h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos'), null)
})

test('controlled-creation abort and quit cleanup are idempotent, while an old authority cannot release the renewed holder', async () => {
  const first = { runtimeScopeId: 'project:project-a', routeGeneration: 7, developmentGeneration: 1 }
  const renewed = { ...first, developmentGeneration: 2 }
  const h = harness({ definitionValue: null, resolveProspectiveRoot: async () => '/canonical/project/.agentos' })
  await h.bridge.acquireProspective(first)
  await h.bridge.acquireProspective(renewed)
  await h.bridge.abort(first)
  assert.equal(h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos').runtimeScopeId, renewed.runtimeScopeId)
  await h.bridge.releaseProspectiveLeases(); await h.bridge.releaseProspectiveLeases()
  assert.equal(h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos'), null)
})

test('Workspace-first conflict rejects prospective Project open before coordinator/session or process work', async () => {
  const h = harness({ definitionValue: null, resolveProspectiveRoot: async () => '/canonical/shared/.agentos' })
  const workspace = await h.rootExecutionRegistry.acquire({ canonicalRoot: '/canonical/shared/.agentos', runtimeDefinitionId: 'workspace-runtime', runtimeScopeId: 'workspace:workspace-runtime', kind: 'development', generation: 1 })
  assert.equal(workspace.ok, true)
  await assert.rejects(
    () => h.bridge.open({ runtimeScopeId: 'project:project-a', routeGeneration: 1, developmentGeneration: 1 }),
    (error) => error.code === 'runtime-development-conflict' && error.conflictingLease.leaseId === workspace.lease.leaseId,
  )
  assert.equal(h.calls.some((call) => call[0] === 'open'), false)
  assert.equal(h.rootExecutionRegistry.leases().length, 1)
})

test('Project-first prospective lease makes Workspace activation return conflict without spawning', async () => {
  const h = harness()
  const project = await h.rootExecutionRegistry.acquire({ canonicalRoot: '/runtime', runtimeDefinitionId: 'prospective:project:project-a', runtimeScopeId: 'project:project-a', kind: 'development', generation: 1 })
  assert.equal(project.ok, true)
  await assert.rejects(
    () => h.bridge.open(authority),
    (error) => error.code === 'runtime-development-conflict' && error.conflictingLease.leaseId === project.lease.leaseId,
  )
  assert.equal(h.calls.some((call) => call[0] === 'start'), false)
  assert.equal(h.rootExecutionRegistry.getByRoot('/runtime').leaseId, project.lease.leaseId)
})

test('Definition binding atomically replaces the prospective token and lets the manager adopt the new lease', async () => {
  const projectAuthority = { runtimeScopeId: 'project:project-a', routeGeneration: 4, developmentGeneration: 1 }
  const h = harness({ definitionValue: null, resolveProspectiveRoot: async () => '/canonical/project/.agentos', inspected: { ok: true, rootPath: '/canonical/project/.agentos', canonicalRoot: '/canonical/project/.agentos', name: 'project', hasLockfile: false, nodeModulesPresent: true, hasDevScript: false, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } } })
  await h.bridge.open(projectAuthority)
  const prospective = h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos')
  const projectDefinition = { ...definition, id: 'project-definition', rootPath: '/canonical/project/.agentos', canonicalRoot: '/canonical/project/.agentos', owner: { kind: 'project', projectId: 'project-a' } }
  const bound = await h.bridge.bindDefinition(projectAuthority.runtimeScopeId, projectDefinition)
  assert.equal(bound.runtimeDefinitionId, projectDefinition.id)
  assert.notEqual(bound.leaseId, prospective.leaseId)
  assert.equal(h.bridge.isDefinitionBound(projectAuthority.runtimeScopeId, projectDefinition.id), true)
  assert.equal((await h.rootExecutionRegistry.release(prospective)).released, false, 'old token must not release the rebound lease')
  assert.equal(h.rootExecutionRegistry.getByRoot('/canonical/project/.agentos').leaseId, bound.leaseId)
  assert.deepEqual(h.calls.filter((call) => call[0] === 'acquire-lease'), [['acquire-lease', projectDefinition.id]])
})

test('prospective Project root canonicalizes a symlinked parent realpath before appending .agentos', async (t) => {
  const { canonicalizeProspectiveProjectRuntimeRoot } = load(resolve(testDir, './runtime-development-runtime-bridge.ts'))
  const fixture = await mkdtemp(join(tmpdir(), 'agentos-prospective-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const realProject = join(fixture, 'real-project'); const aliasProject = join(fixture, 'alias-project')
  await mkdir(realProject)
  await symlink(realProject, aliasProject, 'dir')
  assert.equal(await canonicalizeProspectiveProjectRuntimeRoot(aliasProject), await canonicalizeProspectiveProjectRuntimeRoot(realProject))
})

test('late close from an old generation cannot release the reopened generation lease', async () => {
  const h = harness(); await h.bridge.open(authority)
  const next = { ...authority, developmentGeneration: 4 }
  await h.bridge.open(next)
  await h.bridge.handle({ ...authority, operationId: 'old-close', type: 'closed', retainRuntimeService: false })
  assert.equal(h.calls.filter((call) => call[0] === 'release-lease').length, 0)
  await h.bridge.handle({ ...next, operationId: 'new-close', type: 'closed', retainRuntimeService: false })
  assert.equal(h.calls.filter((call) => call[0] === 'release-lease').length, 1)
})

test('thrown errors are reduced to fixed redacted log codes without path, command, token, or user content', async () => {
  const sensitive = '/Users/alice/private/runtime npm run build --token=secret-token user prompt text'
  const liveInspection = { ok: true, rootPath: '/runtime', canonicalRoot: '/runtime', name: 'runtime', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, mode: 'static', agentos: staticDeclaration, servePlan: { kind: 'artifact', declaration: staticDeclaration, source: 'declaration' } }
  const open = harness({ inspected: liveInspection, startError: new Error(sensitive) })
  const openLogs = await captureBridgeLogs(() => open.bridge.open(authority))
  assert.equal(open.calls.find((call) => call[0] === 'fail-opening')[2], 'runtime-live-preview-unavailable')
  assert.equal(open.calls.find((call) => call[0] === 'fail-opening')[3], '实时效果暂不可用，源码和对话仍保留。')

  const save = harness({ buildError: new Error(sensitive) })
  const fence = { ...authority, operationId: 'save-redaction', type: 'save' }
  const saveLogs = await captureBridgeLogs(() => save.bridge.handle(fence))
  assert.deepEqual(save.completions, [[fence, 'build-failed']])

  const logs = [...openLogs, ...saveLogs]
  assert.equal(JSON.stringify(logs).includes(sensitive), false)
  assert.equal(JSON.stringify(logs).includes('/Users/alice/private'), false)
  assert.equal(JSON.stringify(logs).includes('secret-token'), false)
  for (const [tag, payload] of logs) {
    assert.equal(tag, '[runtime-development/bridge]')
    assert.deepEqual(Object.keys(payload).sort(), ['code', 'operation', 'scopeKind'])
    assert.match(payload.code, /^runtime-[a-z-]+$/)
  }
  assert.deepEqual(openLogs.at(-1)[1], { operation: 'open', scopeKind: 'workspace', code: 'runtime-live-preview-unavailable' })
  assert.deepEqual(saveLogs.at(-1)[1], { operation: 'save', scopeKind: 'workspace', code: 'runtime-build-failed' })
})

// `C-RSM-501/503`: a served bundle is rebuilt by returning to the serve ladder
// once the AI session that ran it as `npm run dev` closes.
const productionInspected = { ok: true, rootPath: '/runtime', canonicalRoot: '/runtime', name: 'runtime', hasLockfile: false, nodeModulesPresent: true, hasDevScript: true, hasBuildScript: true, hasStartScript: true, mode: 'development', servePlan: { kind: 'production', reason: 'server-bundle-present' } }

test('a server-bundle session closes by restarting the viewer through the serve ladder', async () => {
  const h = harness({ inspected: productionInspected, currentSnapshot: { status: 'running', mode: 'development' } })
  const opened = await h.bridge.open(authority)
  assert.equal(h.calls.find((call) => call[0] === 'register' && call[1].serveScript === 'dev') !== undefined, true, 'the session runs dev')
  assert.ok(opened)
  await h.bridge.handle({ ...authority, operationId: 'close-server', type: 'closed', retainRuntimeService: true })
  assert.deepEqual(h.calls.filter((call) => call[0] === 'restart'), [['restart', 'runtime']])
  const restored = h.calls.filter((call) => call[0] === 'register').at(-1)[1]
  assert.equal(restored.serveScript, undefined, 'the dev override does not survive the session')
})

test('a dev-only session close and a late close never restart the viewer', async () => {
  const devOnly = harness({ inspected: { ...productionInspected, hasBuildScript: false, hasStartScript: false, servePlan: { kind: 'development', reason: 'no-build-script' } }, currentSnapshot: { status: 'running', mode: 'development' } })
  await devOnly.bridge.open(authority)
  await devOnly.bridge.handle({ ...authority, operationId: 'close-dev', type: 'closed', retainRuntimeService: true })
  assert.equal(devOnly.calls.some((call) => call[0] === 'restart'), false)

  const late = harness({ inspected: productionInspected, currentSnapshot: { status: 'running', mode: 'development' } })
  await late.bridge.open(authority)
  await late.bridge.open({ ...authority, developmentGeneration: 4 })
  await late.bridge.handle({ ...authority, operationId: 'old-close', type: 'closed', retainRuntimeService: true })
  assert.equal(late.calls.some((call) => call[0] === 'restart'), false, 'an old generation close is fenced')
})

test('a save whose build produces no page serves the bundle instead of failing', async () => {
  const buildable = { ...productionInspected, mode: 'static', agentos: undefined, servePlan: { kind: 'buildable', source: 'detected' } }
  const h = harness({ inspected: buildable, buildSnapshot: { status: 'build_failed', mode: 'static', buildStatus: 'build_failed', errorCode: 'build-produces-no-artifact' } })
  await h.bridge.open(authority)
  await h.bridge.handle({ ...authority, operationId: 'save-1', type: 'save' })
  assert.ok(h.calls.some((call) => call[0] === 'start' && call[3]?.autoBuild === true), 'falls back to the serve ladder')
  assert.equal(h.completions.at(-1)[1], 'saved')
})
