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
