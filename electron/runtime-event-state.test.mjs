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

  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
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

const {
  applyRuntimeDevelopmentSnapshot,
  applyRuntimeEvents,
  isStaleRuntimeSnapshot,
  runtimeDevelopmentStatus,
  runtimePreviewReady,
  runtimeWorkbenchState,
  runtimeNeedsTroubleshooting,
  runtimeServeStatus,
  RuntimeEventBatcher,
} = loadTsModule(resolve(testDir, '../src/components/runtime-event-state.ts'))

function event(overrides = {}) {
  return {
    type: 'log',
    runtimeDefinitionId: 'runtime-a',
    runtimeId: 'process-a',
    generation: 1,
    status: 'running',
    stream: 'stdout',
    line: 'line',
    timestamp: 1,
    ...overrides,
  }
}

function createBatcher() {
  const timers = []
  const commits = []
  const batcher = new RuntimeEventBatcher({
    commit: (events) => commits.push(events),
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false }
      timers.push(timer)
      return timer
    },
    cancel: (timer) => {
      timer.cancelled = true
    },
  })
  return { batcher, timers, commits }
}

test('batches log bursts and applies a maximum of 160 lines per runtime', () => {
  const { batcher, timers, commits } = createBatcher()
  for (let index = 0; index < 162; index += 1) {
    batcher.handle(event({ line: `line-${index}`, timestamp: index }))
  }

  assert.equal(commits.length, 0)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delayMs, 75)

  timers[0].callback()
  assert.equal(commits.length, 1)
  assert.equal(commits[0].length, 160)
  const state = applyRuntimeEvents({}, commits[0])
  assert.equal(state['runtime-a'].logs.length, 160)
  assert.equal(state['runtime-a'].logs[0], '[stdout] line-2')
  assert.equal(state['runtime-a'].logs.at(-1), '[stdout] line-161')
})

test('bounds the pending queue during an extreme log flood', () => {
  const { batcher, timers, commits } = createBatcher()
  for (let index = 0; index < 10_000; index += 1) {
    batcher.handle(event({ line: `flood-${index}`, timestamp: index }))
  }

  assert.equal(timers.length, 1)
  timers[0].callback()
  assert.equal(commits.length, 1)
  assert.equal(commits[0].length, 160)

  const state = applyRuntimeEvents({}, commits[0])
  assert.equal(state['runtime-a'].logs[0], '[stdout] flood-9840')
  assert.equal(state['runtime-a'].logs.at(-1), '[stdout] flood-9999')
})

test('drops stale generations and isolates logs by runtime identity', () => {
  const current = applyRuntimeEvents({}, [event({ line: 'new', generation: 2, timestamp: 2 })])
  const next = applyRuntimeEvents(current, [event({ line: 'old', generation: 1, timestamp: 3 })])
  assert.strictEqual(next, current)

  const isolated = applyRuntimeEvents(next, [event({
    runtimeDefinitionId: 'runtime-b',
    runtimeId: 'process-b',
    line: 'other-runtime',
    timestamp: 4,
  })])
  assert.deepEqual(isolated['runtime-a'].logs, ['[stdout] new'])
  assert.deepEqual(isolated['runtime-b'].logs, ['[stdout] other-runtime'])
})

test('commits a status event immediately after queued logs in arrival order', () => {
  const { batcher, timers, commits } = createBatcher()
  batcher.handle(event({ line: 'before-ready', timestamp: 1 }))
  batcher.handle(event({
    type: 'ready',
    line: undefined,
    status: 'running',
    readyUrl: 'http://localhost:4173',
    timestamp: 2,
  }))

  assert.equal(commits.length, 1)
  assert.equal(commits[0].length, 2)
  assert.equal(commits[0][0].line, 'before-ready')
  assert.equal(commits[0][1].type, 'ready')
  assert.equal(timers[0].cancelled, true)
  const state = applyRuntimeEvents({}, commits[0])
  assert.equal(state['runtime-a'].readyUrl, 'http://localhost:4173')
  assert.deepEqual(state['runtime-a'].logs, ['[stdout] before-ready'])
})

test('dispose cancels delayed work and ignores events after unmount', () => {
  const { batcher, timers, commits } = createBatcher()
  batcher.handle(event())
  batcher.dispose()
  timers[0].callback()
  batcher.handle(event({ type: 'ready', line: undefined }))
  assert.equal(timers[0].cancelled, true)
  assert.equal(commits.length, 0)
})

function development(overrides = {}) {
  return {
    runtimeScopeId: 'workspace:runtime-a', runtimeDefinitionId: 'runtime-a', routeGeneration: 1,
    developmentGeneration: 1, phase: 'live', activeRunCount: 0, activeAgentLeaseCount: 0,
    waitingPromptCount: 0, hasChanges: false, canSubmit: true, canReopen: false, canEnd: true,
    exitRequested: false, autoSaveAttempted: false, ...overrides,
  }
}

const t = (key) => key

test('main-window development snapshots fence late route and development generations', () => {
  const current = applyRuntimeDevelopmentSnapshot({}, development({ routeGeneration: 2, developmentGeneration: 3, phase: 'saving' }))
  assert.strictEqual(applyRuntimeDevelopmentSnapshot(current, development({ routeGeneration: 1, developmentGeneration: 99 })), current)
  assert.strictEqual(applyRuntimeDevelopmentSnapshot(current, development({ routeGeneration: 2, developmentGeneration: 2 })), current)
  const next = applyRuntimeDevelopmentSnapshot(current, development({ routeGeneration: 2, developmentGeneration: 4, phase: 'live' }))
  assert.equal(next['workspace:runtime-a'].developmentGeneration, 4)
  assert.equal(next['workspace:runtime-a'].phase, 'live')
})

test('development action and copy come only from the Main snapshot', () => {
  const idle = runtimeDevelopmentStatus(t)
  assert.equal(idle.action, 'open')
  assert.equal(idle.actionLabel, 'runtime.modifyWithAi')
  const live = runtimeDevelopmentStatus(t, development({ activeRunCount: 1 }))
  assert.equal(live.action, 'end')
  assert.equal(live.actionLabel, 'runtime.endModification')
  assert.equal(live.message, 'runtime.developmentEditing')
  const developmentOnlyClosed = runtimeDevelopmentStatus(t, development({ phase: 'closed', canSubmit: false, canEnd: false, exitRequested: true, userMessage: 'npm run build at /secret:4173' }))
  assert.equal(developmentOnlyClosed.message, 'runtime.developmentEnded')
  assert.doesNotMatch(developmentOnlyClosed.message, /npm|\/secret|4173/)
})

// `C-RSM-506` / Paintpoints F14: Main records the dev server's own URL while
// the Runtime is still `starting`; the preview must still open on `running`.
test('preview readiness flips on running even when readyUrl arrived earlier', () => {
  const base = { runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 1, restartAttempt: 0, updatedAt: 1, mode: 'development', readyUrl: 'http://localhost:3031/' }
  assert.equal(runtimePreviewReady({ ...base, status: 'starting' }), false)
  assert.equal(runtimePreviewReady({ ...base, status: 'running' }), true)
  assert.equal(runtimePreviewReady({ ...base, status: 'running', readyUrl: undefined }), false)
  const staticBase = { ...base, mode: 'static', readyUrl: undefined, previewUrl: 'agentos-static://p/' }
  assert.equal(runtimePreviewReady({ ...staticBase, status: 'ready', buildStatus: 'ready' }), true)
  assert.equal(runtimePreviewReady({ ...staticBase, status: 'build_failed', buildStatus: 'build_failed' }), true)
  assert.equal(runtimePreviewReady({ ...staticBase, status: 'stopped' }), false)
  assert.equal(runtimePreviewReady(null), false)
})

// A reply carrying an older snapshot of the same Runtime instance must not
// overwrite a newer event (seen as a renderer stuck on `starting` after restore).
test('an older snapshot of the same runtime instance is stale', () => {
  const previous = { runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 2, status: 'running', restartAttempt: 0, updatedAt: 200 }
  assert.equal(isStaleRuntimeSnapshot(previous, { ...previous, status: 'starting', updatedAt: 150 }), true)
  assert.equal(isStaleRuntimeSnapshot(previous, { ...previous, status: 'degraded', updatedAt: 250 }), false)
  assert.equal(isStaleRuntimeSnapshot(previous, { ...previous, generation: 1, updatedAt: 999 }), true)
  assert.equal(isStaleRuntimeSnapshot(previous, { ...previous, runtimeId: 'other', updatedAt: 999 }), true)
  assert.equal(isStaleRuntimeSnapshot(previous, { ...previous, generation: 3, runtimeId: 'next', updatedAt: 10 }), false)
  assert.equal(isStaleRuntimeSnapshot(undefined, previous), false)
})

test('RuntimePreview re-creates the Preview when readiness flips, not only when the URL changes', () => {
  const source = readFileSync(resolve(testDir, '../src/components/RuntimePreview.tsx'), 'utf8')
  assert.match(source, /const previewReady = runtimePreviewReady\(runtime\)/)
  assert.match(source, /runtime\?\.mode, previewReady\]\)/, 'the create effect must depend on previewReady')
})

// Paintpoints F2: a first build failure has no previous version to keep showing.
test('build failure copy only claims a previous version when one exists', () => {
  const failed = { runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 1, restartAttempt: 0, updatedAt: 1, mode: 'static', status: 'build_failed', buildStatus: 'build_failed' }
  assert.equal(runtimeServeStatus(t, failed).message, 'runtime.serveBuildFailedFirst')
  assert.equal(runtimeServeStatus(t, { ...failed, artifactId: 'a1', previewUrl: 'agentos-static://p/' }).message, 'runtime.serveBuildFailed')
})

// `C-RSM-504/505/506`: normal states carry no actions; abnormal ones do.
test('workbench state separates viewing, updating and failures without mechanism vocabulary', () => {
  const base = { runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 1, restartAttempt: 0, updatedAt: 1 }
  const server = { ...base, mode: 'development', readyUrl: 'http://localhost:3030/' }
  assert.deepEqual(runtimeWorkbenchState({ ...server, status: 'running' }), { kind: 'viewing' })
  assert.deepEqual(runtimeWorkbenchState({ ...server, status: 'running', buildStatus: 'building' }), { kind: 'updating', pageVisible: true })
  assert.deepEqual(runtimeWorkbenchState({ ...server, status: 'starting', buildStatus: 'building' }), { kind: 'updating', pageVisible: false })
  assert.deepEqual(runtimeWorkbenchState({ ...server, status: 'running', buildStatus: 'build_failed', detail: 'Type error' }), { kind: 'update-failed', reason: 'Type error' })
  assert.deepEqual(runtimeWorkbenchState({ ...server, status: 'running', buildStatus: 'ready' }), { kind: 'viewing' }, 'a finished update is plain viewing')
  assert.deepEqual(runtimeWorkbenchState({ ...base, mode: 'development', status: 'failed', detail: '端口 3030 已被其他程序占用' }), { kind: 'open-failed', reason: '端口 3030 已被其他程序占用' })
  assert.deepEqual(runtimeWorkbenchState({ ...base, mode: 'static', status: 'building', buildStatus: 'building' }), { kind: 'preparing', firstBuild: true })
  assert.deepEqual(runtimeWorkbenchState({ ...base, mode: 'static', status: 'build_required', buildStatus: 'build_required' }), { kind: 'not-ready' })
  assert.deepEqual(runtimeWorkbenchState({ ...base, status: 'path_missing' }), { kind: 'path-missing' })
  assert.equal(runtimeNeedsTroubleshooting({ ...server, status: 'running' }), false)
  assert.equal(runtimeNeedsTroubleshooting({ ...server, status: 'running', buildStatus: 'building' }), false)
  assert.equal(runtimeNeedsTroubleshooting({ ...base, status: 'failed' }), true)
  assert.equal(runtimeNeedsTroubleshooting({ ...server, status: 'running', buildStatus: 'build_failed' }), true)
})

// Walkthrough 3 findings: a failed start that is then stopped keeps its reason;
// a static build that falls to a server is still preparing; a new generation
// does not inherit the previous one's failure.
test('workbench keeps the failure reason, treats ③→② as preparing, and does not inherit across generations', () => {
  const base = { runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 1, restartAttempt: 0, updatedAt: 1 }
  assert.deepEqual(runtimeWorkbenchState({ ...base, status: 'stopped', stopReason: 'error', detail: '端口 3030 已被其他程序占用' }), { kind: 'open-failed', reason: '端口 3030 已被其他程序占用' })
  assert.deepEqual(runtimeWorkbenchState({ ...base, status: 'stopped', stopReason: 'user' }), { kind: 'stopped' })
  assert.deepEqual(runtimeWorkbenchState({ ...base, mode: 'static', status: 'build_failed', buildStatus: 'build_failed', errorCode: 'build-produces-no-artifact' }), { kind: 'preparing', firstBuild: false })
  const failed = applyRuntimeEvents({}, [{ type: 'status', runtimeDefinitionId: 'r', runtimeId: 'rt-1', generation: 1, status: 'failed', errorCode: 'process-exited', detail: 'old reason', buildStatus: 'build_failed', timestamp: 1 }])
  const next = applyRuntimeEvents(failed, [{ type: 'status', runtimeDefinitionId: 'r', runtimeId: 'rt-2', generation: 2, status: 'preparing', timestamp: 2 }])
  assert.equal(next.r.detail, undefined)
  assert.equal(next.r.errorCode, undefined)
  assert.equal(next.r.buildStatus, undefined)
})

// Walkthrough 4: the reason must survive through the event path, where a
// failed start arrives as `failed` and then `stopped` within a millisecond.
test('a failed start stopped right after still reads as open-failed through events', () => {
  const events = [
    { type: 'status', runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 2, status: 'failed', errorCode: 'process-exited', detail: '端口 3030 已被其他程序占用', timestamp: 10 },
    { type: 'status', runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 2, status: 'stopped', stopReason: 'error', errorCode: 'process-exited', detail: '端口 3030 已被其他程序占用', timestamp: 11 },
  ]
  const state = applyRuntimeEvents({}, events)
  assert.deepEqual(runtimeWorkbenchState(state.r), { kind: 'open-failed', reason: '端口 3030 已被其他程序占用' })
  const main = readFileSync(resolve(testDir, 'main.ts'), 'utf8')
  assert.match(main, /stopReason: event\.stopReason,/, 'Main forwards stopReason to the renderer')
  const supervisor = readFileSync(resolve(testDir, 'local-app-runtime/supervisor.ts'), 'utf8')
  assert.match(supervisor, /stopReason: runtime\.snapshot\.status === 'stopped'/)
  const fallback = applyRuntimeEvents({}, [{ type: 'status', runtimeDefinitionId: 'r', runtimeId: 'rt', generation: 1, status: 'stopped', stopReason: 'user', mode: 'static', errorCode: 'build-produces-no-artifact', timestamp: 1 }])
  assert.equal(runtimeWorkbenchState(fallback.r).kind, 'preparing', 'the ③→② hand-off never flashes 已停止')
})
