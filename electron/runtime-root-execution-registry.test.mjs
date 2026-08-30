import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath) {
  const source = require('node:fs').readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

const { RuntimeRootExecutionRegistry } = loadTsModule(resolve(testDir, './runtime-root-execution-registry.ts'))

function request(overrides = {}) {
  return {
    canonicalRoot: resolve(testDir, '../.runtime-root-fixture'),
    runtimeDefinitionId: 'definition-a',
    runtimeScopeId: 'workspace:definition-a',
    kind: 'development',
    generation: 1,
    ...overrides,
  }
}

test('acquire -> active -> atomic development/build transition -> release is fenced and idempotent', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const acquired = await registry.acquire(request())
  assert.equal(acquired.ok, true)
  assert.equal(acquired.lease.state, 'active')

  const duplicate = await registry.acquire(request())
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.reused, true)
  assert.equal(duplicate.lease.leaseId, acquired.lease.leaseId)

  let stops = 0
  const transitioned = await registry.transitionDevelopmentToBuild(acquired.lease, async () => { stops += 1 })
  assert.equal(transitioned.ok, true)
  assert.equal(transitioned.lease.kind, 'build')
  assert.notEqual(transitioned.lease.leaseId, acquired.lease.leaseId)
  assert.equal(stops, 1)

  const staleDevelopmentRelease = await registry.release(acquired.lease)
  assert.deepEqual({ ok: staleDevelopmentRelease.ok, released: staleDevelopmentRelease.released }, { ok: true, released: false })
  assert.equal(registry.getByRoot(request().canonicalRoot).leaseId, transitioned.lease.leaseId)
  assert.equal((await registry.release(transitioned.lease)).released, true)
  assert.equal((await registry.release(transitioned.lease)).released, false)
  assert.equal(registry.leases().length, 0)
})

test('same root different Definition conflicts without invoking process callbacks or changing owner', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const first = await registry.acquire(request())
  let processSideEffects = 0
  const conflict = await registry.acquire(request({
    runtimeDefinitionId: 'definition-b',
    runtimeScopeId: 'project:project-b',
  }))
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'runtime-development-conflict')
  assert.equal(conflict.error.conflictingLease.runtimeDefinitionId, 'definition-a')
  assert.equal(processSideEffects, 0)
  assert.equal(registry.getByRoot(request().canonicalRoot).leaseId, first.lease.leaseId)

  const stopped = await registry.stopAndRelease(first.lease, async () => { processSideEffects += 1 })
  assert.equal(stopped.ok, true)
  assert.equal(processSideEffects, 1)
})

test('new generation renews the same owner and stale generation/lease cannot release it', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const first = await registry.acquire(request({ generation: 3 }))
  const renewed = await registry.acquire(request({ generation: 4 }))
  assert.equal(renewed.ok, true)
  assert.notEqual(renewed.lease.leaseId, first.lease.leaseId)

  const staleAcquire = await registry.acquire(request({ generation: 3 }))
  assert.equal(staleAcquire.ok, false)
  assert.equal(staleAcquire.error.code, 'runtime-root-stale-generation')
  assert.equal((await registry.release(first.lease)).released, false)
  assert.equal(registry.getByRoot(request().canonicalRoot).generation, 4)
})

test('prospective Project lease atomically rebinds to the first Definition and fences the old token', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const prospective = await registry.acquire(request({ runtimeDefinitionId: 'prospective:project:project-a', runtimeScopeId: 'project:project-a' }))
  assert.equal(prospective.ok, true)
  const rebound = await registry.rebindDevelopmentLease(prospective.lease, request({ runtimeDefinitionId: 'definition-project-a', runtimeScopeId: 'project:project-a' }))
  assert.equal(rebound.ok, true)
  assert.notEqual(rebound.lease.leaseId, prospective.lease.leaseId)
  assert.equal(rebound.lease.runtimeDefinitionId, 'definition-project-a')
  assert.equal((await registry.release(prospective.lease)).released, false)
  assert.equal(registry.getByRoot(request().canonicalRoot).leaseId, rebound.lease.leaseId)
})

test('rebind conflict keeps both owners and never drops the prospective source lock', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const prospectiveRoot = resolve(testDir, '../.prospective-root-fixture')
  const canonicalDefinitionRoot = resolve(testDir, '../.canonical-definition-root-fixture')
  const prospective = await registry.acquire(request({ canonicalRoot: prospectiveRoot, runtimeDefinitionId: 'prospective:project:project-a', runtimeScopeId: 'project:project-a' }))
  const workspace = await registry.acquire(request({ canonicalRoot: canonicalDefinitionRoot, runtimeDefinitionId: 'workspace-owner', runtimeScopeId: 'workspace:workspace-owner' }))
  assert.equal(prospective.ok, true); assert.equal(workspace.ok, true)
  const rebound = await registry.rebindDevelopmentLease(prospective.lease, request({ canonicalRoot: canonicalDefinitionRoot, runtimeDefinitionId: 'definition-project-a', runtimeScopeId: 'project:project-a' }))
  assert.equal(rebound.ok, false)
  assert.equal(rebound.error.code, 'runtime-development-conflict')
  assert.equal(registry.getByRoot(prospectiveRoot).leaseId, prospective.lease.leaseId)
  assert.equal(registry.getByRoot(canonicalDefinitionRoot).leaseId, workspace.lease.leaseId)
})

test('transition failure keeps an explicit stop_failed development lease and last owner', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const acquired = await registry.acquire(request())
  const failure = new Error('bounded-stop-failed')
  const transitioned = await registry.transitionDevelopmentToBuild(acquired.lease, async () => { throw failure })
  assert.equal(transitioned.ok, false)
  assert.equal(transitioned.error.code, 'runtime-root-transition-failed')
  assert.equal(transitioned.error.cause, failure)
  assert.equal(transitioned.error.lease.kind, 'development')
  assert.equal(transitioned.error.lease.state, 'stop_failed')
  assert.equal(transitioned.error.lease.failureCode, 'transition-stop-failed')

  const conflict = await registry.acquire(request({ runtimeDefinitionId: 'definition-b', runtimeScopeId: 'workspace:definition-b' }))
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.conflictingLease.runtimeDefinitionId, 'definition-a')
})

test('stop failure retains the lease; a fenced retry can release it exactly once', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const acquired = await registry.acquire(request())
  const failed = await registry.stopAndRelease(acquired.lease, async () => { throw new Error('stop-failed') })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.lease.state, 'stop_failed')
  assert.equal(registry.leases().length, 1)
  const blockedRestart = await registry.acquire(request())
  assert.equal(blockedRestart.ok, false)
  assert.equal(blockedRestart.error.code, 'runtime-root-stop-failed')

  const retried = await registry.stopAndRelease(acquired.lease, async () => undefined)
  assert.equal(retried.ok, true)
  assert.equal(retried.released, true)
  assert.equal((await registry.stopAndRelease(acquired.lease, async () => { throw new Error('must-not-run') })).released, false)
})

test('development lease does not require a process and still excludes build/development by another Definition', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const staticOnlyDevelopment = await registry.acquire(request({ runtimeScopeId: 'project:uninitialized-project' }))
  assert.equal(staticOnlyDevelopment.ok, true)
  const buildConflict = await registry.acquire(request({
    runtimeDefinitionId: 'definition-b',
    runtimeScopeId: 'workspace:definition-b',
    kind: 'build',
  }))
  assert.equal(buildConflict.ok, false)
  assert.equal(buildConflict.error.code, 'runtime-development-conflict')
  assert.equal((await registry.release(staticOnlyDevelopment.lease)).released, true)
})

test('bounded teardown publishes stopping before process completion and releases only after it settles', async () => {
  const registry = new RuntimeRootExecutionRegistry()
  const acquired = await registry.acquire(request())
  let finishStop
  const stop = registry.stopAndRelease(acquired.lease, () => new Promise((resolve) => { finishStop = resolve }))
  await Promise.resolve()
  assert.equal(registry.getByRoot(request().canonicalRoot).state, 'stopping')
  const queuedAcquire = registry.acquire(request({ generation: 2 }))
  let queuedSettled = false
  void queuedAcquire.finally(() => { queuedSettled = true })
  await Promise.resolve()
  assert.equal(queuedSettled, false)
  finishStop()
  const result = await stop
  assert.equal(result.ok, true)
  assert.equal(result.released, true)
  const next = await queuedAcquire
  assert.equal(next.ok, true)
  assert.equal(next.lease.generation, 2)
  assert.equal(registry.getByRoot(request().canonicalRoot).state, 'active')
  await registry.release(next.lease)
})
