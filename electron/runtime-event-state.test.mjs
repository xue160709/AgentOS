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
  applyRuntimeEvents,
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
