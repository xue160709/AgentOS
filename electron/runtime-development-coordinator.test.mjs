import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function load(modulePath, cache = new Map()) {
  const file = resolve(modulePath); const cached = cache.get(file); if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file })
  const module = { exports: {} }; cache.set(file, module)
  Function('exports', 'module', 'require', outputText)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(file), `${specifier}.ts`)) ? load(resolve(dirname(file), `${specifier}.ts`), cache) : require(specifier))
  return module.exports
}

class FakeClock {
  constructor() { this.value = 0; this.next = 0; this.tasks = new Map() }
  now = () => this.value
  set = (callback, delay) => { const id = ++this.next; this.tasks.set(id, { at: this.value + delay, callback }); return id }
  clear = (id) => this.tasks.delete(id)
  async flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
  async advance(ms) {
    const end = this.value + ms
    while (true) {
      const due = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.tasks.delete(due[0]); this.value = due[1].at; due[1].callback(); await this.flush()
    }
    this.value = end; await this.flush()
  }
}

const authority = (developmentGeneration = 1) => ({ runtimeScopeId: 'workspace:runtime', routeGeneration: 4, developmentGeneration })

function harness({ fingerprint = () => 'entry', saveCapability = 'static' } = {}) {
  const { RuntimeDevelopmentCoordinator } = load(resolve(testDir, './runtime-development-coordinator.ts'))
  const clock = new FakeClock(); const intents = []; const snapshots = []; let operation = 0
  const coordinator = new RuntimeDevelopmentCoordinator({
    now: clock.now, setTimer: clock.set, clearTimer: clock.clear,
    fingerprint: async () => fingerprint(clock.value),
    intent: (intent) => { intents.push(intent) },
    createOperationId: () => `operation-${++operation}`,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })
  coordinator.open({ ...authority(), runtimeDefinitionId: 'runtime', entryFingerprint: 'entry', saveCapability })
  coordinator.ready(authority())
  return { coordinator, clock, intents, snapshots }
}

function accept(coordinator, requestId, generation = 1, permissionMode = 'auto') {
  assert.equal(coordinator.registerAcceptedRun({ ...authority(generation), requestId, permissionMode }), true)
}

function submitPending(coordinator, pendingRequestId, generation = 1, permissionMode = 'auto') {
  assert.equal(coordinator.registerSubmittingRun({ ...authority(generation), pendingRequestId, permissionMode }), true)
}

function mutate(coordinator, requestId, toolUseId = 'tool') {
  coordinator.beforeTool({ requestId, toolUseId, toolName: 'Write' })
  coordinator.afterTool({ requestId, toolUseId, toolName: 'Write', succeeded: true, hasProjectDiff: true })
}

test('multiple live rounds never build; active Run survives close and double exit is idempotent', async () => {
  const h = harness({ fingerprint: () => 'changed' })
  accept(h.coordinator, 'one'); mutate(h.coordinator, 'one'); h.coordinator.markRunTerminal({ ...authority(), requestId: 'one', phase: 'succeeded' })
  await h.clock.advance(5_000)
  accept(h.coordinator, 'two')
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 0)
  const firstExit = h.coordinator.requestExit(authority()); const secondExit = h.coordinator.requestExit(authority())
  assert.equal(firstExit.phase, 'exit_requested'); assert.equal(secondExit.phase, 'exit_requested')
  assert.equal(h.coordinator.canSubmit(authority()), false)
  assert.equal(h.coordinator.snapshot('workspace:runtime').activeRunCount, 1)
  h.coordinator.markRunTerminal({ ...authority(), requestId: 'two', phase: 'succeeded' })
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'saving')
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 1)
})

test('submitting authority linearizes exit with accepted in both same-tick orders', () => {
  const exitFirst = harness()
  submitPending(exitFirst.coordinator, 'pending-exit-first')
  exitFirst.coordinator.requestExit(authority())
  assert.equal(exitFirst.coordinator.snapshot('workspace:runtime').activeRunCount, 1)
  assert.equal(exitFirst.coordinator.registerAcceptedRun({ ...authority(), pendingRequestId: 'pending-exit-first', requestId: 'accepted-exit-first', permissionMode: 'auto' }), true)
  assert.equal(exitFirst.coordinator.snapshot('workspace:runtime').activeRunCount, 1)
  assert.equal(exitFirst.coordinator.markRunTerminal({ ...authority(), requestId: 'accepted-exit-first', phase: 'succeeded' }), true)

  const acceptedFirst = harness()
  submitPending(acceptedFirst.coordinator, 'pending-accepted-first')
  assert.equal(acceptedFirst.coordinator.registerAcceptedRun({ ...authority(), pendingRequestId: 'pending-accepted-first', requestId: 'accepted-first', permissionMode: 'auto' }), true)
  acceptedFirst.coordinator.requestExit(authority())
  assert.equal(acceptedFirst.coordinator.snapshot('workspace:runtime').activeRunCount, 1)
  assert.equal(acceptedFirst.coordinator.markRunTerminal({ ...authority(), requestId: 'accepted-first', phase: 'succeeded' }), true)
})

test('submit rejection removes pending authority and lets exit settle without saving', async () => {
  const h = harness()
  submitPending(h.coordinator, 'pending-rejected')
  h.coordinator.requestExit(authority())
  assert.equal(h.coordinator.rollbackSubmittedRun({ pendingRequestId: 'pending-rejected' }), true)
  assert.equal(h.coordinator.snapshot('workspace:runtime').activeRunCount, 0)
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'closed')
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 0)
  assert.equal(h.intents.filter((item) => item.type === 'closed').length, 1)
})

test('generation change rejects accepted binding and pending rollback does not leak authority', () => {
  const h = harness()
  submitPending(h.coordinator, 'pending-stale')
  const reopened = h.coordinator.reenter('workspace:runtime')
  assert.equal(reopened.developmentGeneration, 2)
  assert.equal(h.coordinator.registerAcceptedRun({ ...authority(), pendingRequestId: 'pending-stale', requestId: 'orphan', permissionMode: 'auto' }), false)
  assert.equal(h.coordinator.rollbackSubmittedRun({ pendingRequestId: 'pending-stale', acceptedRequestId: 'orphan' }), true)
  assert.equal(h.coordinator.snapshot('workspace:runtime').activeRunCount, 0)
  assert.equal(h.coordinator.markRunTerminal({ ...authority(2), requestId: 'orphan', phase: 'succeeded' }), false)
})

test('no source change closes without build; duplicate terminal and lease release remain harmless', async () => {
  const h = harness()
  accept(h.coordinator, 'read', 1, 'plan')
  h.coordinator.requestExit(authority())
  assert.equal(h.coordinator.markRunTerminal({ ...authority(), requestId: 'read', phase: 'succeeded' }), true)
  assert.equal(h.coordinator.markRunTerminal({ ...authority(), requestId: 'read', phase: 'succeeded' }), false)
  h.coordinator.afterTool({ requestId: 'read', toolUseId: 'late', toolName: 'Write', succeeded: true, hasProjectDiff: true })
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'closed')
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 0)
  assert.equal(h.intents.filter((item) => item.type === 'closed').length, 1)
})

test('waiting prompt blocks exit until resolved and remains visible as needs_attention', async () => {
  const h = harness()
  accept(h.coordinator, 'run')
  h.coordinator.markPromptWaiting({ ...authority(), requestId: 'run', promptId: 'prompt' })
  h.coordinator.requestExit(authority())
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'needs_attention')
  await h.clock.advance(2_000); assert.equal(h.intents.length, 0)
  h.coordinator.markPromptResolved({ ...authority(), requestId: 'run', promptId: 'prompt' })
  h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' })
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'closed')
})

test('waiting prompt reenter transfers the active Run to the new development generation', () => {
  const h = harness()
  accept(h.coordinator, 'run')
  h.coordinator.markPromptWaiting({ ...authority(), requestId: 'run', promptId: 'prompt' })
  h.coordinator.requestExit(authority())
  const reopened = h.coordinator.reenter('workspace:runtime')
  assert.equal(reopened.developmentGeneration, 2)
  assert.equal(reopened.waitingPromptCount, 1)
  assert.equal(h.coordinator.markPromptResolved({ ...authority(2), requestId: 'run', promptId: 'prompt' }), true)
  assert.equal(h.coordinator.markRunTerminal({ ...authority(2), requestId: 'run', phase: 'succeeded' }), true)
  assert.equal(h.coordinator.snapshot('workspace:runtime').activeRunCount, 0)
})

test('failed-with-mutation blocks save while failed-without-mutation preserves another successful change', async () => {
  const blocked = harness({ fingerprint: () => 'changed' })
  accept(blocked.coordinator, 'bad'); mutate(blocked.coordinator, 'bad'); blocked.coordinator.requestExit(authority())
  blocked.coordinator.markRunTerminal({ ...authority(), requestId: 'bad', phase: 'failed' })
  await blocked.clock.advance(30_000)
  assert.equal(blocked.coordinator.snapshot('workspace:runtime').phase, 'needs_attention')
  assert.equal(blocked.intents.filter((item) => item.type === 'save').length, 0)

  const allowed = harness({ fingerprint: () => 'changed' })
  accept(allowed.coordinator, 'good'); accept(allowed.coordinator, 'failed')
  mutate(allowed.coordinator, 'good')
  allowed.coordinator.markRunTerminal({ ...authority(), requestId: 'good', phase: 'succeeded' })
  allowed.coordinator.requestExit(authority())
  allowed.coordinator.markRunTerminal({ ...authority(), requestId: 'failed', phase: 'failed' })
  await allowed.clock.flush()
  await allowed.clock.advance(1_500)
  assert.equal(allowed.coordinator.snapshot('workspace:runtime').phase, 'saving')
  assert.equal(allowed.intents.filter((item) => item.type === 'save').length, 1)
})

test('changing fingerprint reaches the 30s total timeout and explicit retry creates one new attempt', async () => {
  const h = harness({ fingerprint: (now) => `changed-${now}` })
  accept(h.coordinator, 'run'); mutate(h.coordinator, 'run'); h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' }); h.coordinator.requestExit(authority())
  await h.clock.advance(30_000)
  assert.equal(h.coordinator.snapshot('workspace:runtime').errorCode, 'runtime-save-timeout')
  const retried = h.coordinator.retrySave('workspace:runtime')
  assert.equal(retried.developmentGeneration, 2)
  assert.equal(retried.autoSaveAttempted, false)
})

test('reenter during save invalidates the old operation and late completion cannot close the new session', async () => {
  const h = harness({ fingerprint: () => 'changed' })
  accept(h.coordinator, 'run'); mutate(h.coordinator, 'run'); h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' }); h.coordinator.requestExit(authority())
  await h.clock.flush()
  await h.clock.advance(1_500)
  const save = h.intents.find((item) => item.type === 'save'); assert.ok(save)
  const reopened = h.coordinator.reenter('workspace:runtime')
  assert.equal(reopened.developmentGeneration, 2); assert.equal(reopened.phase, 'live')
  assert.equal(h.coordinator.completeSave(save, 'saved'), false)
  assert.equal(h.coordinator.canCommit(save), false)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'live')
})

test('build failure keeps attention and a manual retry is generation-fenced', async () => {
  const h = harness({ fingerprint: () => 'changed' })
  accept(h.coordinator, 'run'); mutate(h.coordinator, 'run'); h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' }); h.coordinator.requestExit(authority())
  await h.clock.flush()
  await h.clock.advance(1_500)
  const save = h.intents.find((item) => item.type === 'save')
  assert.equal(h.coordinator.completeSave(save, 'build-failed'), true)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'preview_update_failed')
  const retry = h.coordinator.retrySave('workspace:runtime')
  assert.equal(retry.developmentGeneration, 2)
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 2)
})

test('app quit fence cancels pending save authority and never starts settle/build', async () => {
  const h = harness({ fingerprint: () => 'changed' })
  accept(h.coordinator, 'run'); mutate(h.coordinator, 'run'); h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' })
  h.coordinator.setQuitting(); h.coordinator.requestExit(authority())
  await h.clock.advance(31_000)
  assert.equal(h.intents.filter((item) => item.type === 'save').length, 0)
  assert.equal(h.coordinator.canSubmit(authority()), false)
})

test('destructive lifecycle guard stays busy until the development session is fully closed', async () => {
  const h = harness()
  assert.equal(h.coordinator.hasActiveSession('workspace:runtime'), true)
  accept(h.coordinator, 'run')
  h.coordinator.markPromptWaiting({ ...authority(), requestId: 'run', promptId: 'prompt' })
  h.coordinator.requestExit(authority())
  assert.equal(h.coordinator.hasActiveSession('workspace:runtime'), true)
  h.coordinator.markPromptResolved({ ...authority(), requestId: 'run', promptId: 'prompt' })
  h.coordinator.markRunTerminal({ ...authority(), requestId: 'run', phase: 'succeeded' })
  await h.clock.flush()
  await h.clock.advance(1_500)
  assert.equal(h.coordinator.snapshot('workspace:runtime').phase, 'closed')
  assert.equal(h.coordinator.hasActiveSession('workspace:runtime'), false)
})

test('intent rejection logs only a fixed code and never copies path, command, stack, token, or user text', async () => {
  const sensitive = '/Users/alice/private npm run build --token=secret user prompt text\nstack trace'
  const { RuntimeDevelopmentCoordinator } = load(resolve(testDir, './runtime-development-coordinator.ts'))
  const clock = new FakeClock()
  const logs = []
  const originalError = console.error
  console.error = (...args) => logs.push(args)
  try {
    const coordinator = new RuntimeDevelopmentCoordinator({
      now: clock.now, setTimer: clock.set, clearTimer: clock.clear,
      fingerprint: async () => 'entry',
      intent: async () => { throw new Error(sensitive) },
      createOperationId: () => 'operation-redacted',
      onSnapshot: () => undefined,
    })
    coordinator.open({ ...authority(), runtimeDefinitionId: 'runtime', entryFingerprint: 'entry', saveCapability: 'static' })
    coordinator.ready(authority())
    coordinator.requestExit(authority())
    await clock.flush()
    await clock.advance(1_500)
    await clock.flush()
  } finally {
    console.error = originalError
  }
  assert.equal(logs.length, 1)
  assert.equal(JSON.stringify(logs).includes(sensitive), false)
  assert.equal(JSON.stringify(logs).includes('/Users/alice/private'), false)
  assert.equal(JSON.stringify(logs).includes('secret'), false)
  assert.deepEqual(logs[0], [
    '[runtime-development/coordinator] intent-failed',
    { type: 'closed', scopeKind: 'workspace', code: 'runtime-development-intent-failed' },
  ])
})
