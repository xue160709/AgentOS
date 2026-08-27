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

class FakeClock {
  constructor() { this.value = 0; this.nextId = 0; this.tasks = new Map() }
  now = () => this.value
  set = (callback, delay) => { const id = ++this.nextId; this.tasks.set(id, { at: this.value + delay, callback }); return id }
  clear = (id) => this.tasks.delete(id)
  async flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
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

function makeCoordinator({ fingerprint = () => 'same', intent } = {}) {
  const { RuntimeEditCoordinator } = loadTsModule(resolve(testDir, './runtime-edit-coordinator.ts'))
  const clock = new FakeClock()
  const intents = []
  const coordinator = new RuntimeEditCoordinator({
    now: clock.now, setTimer: clock.set, clearTimer: clock.clear,
    fingerprint: async (projectId) => fingerprint(projectId, clock.value),
    intent: async (event) => { intents.push(event); await intent?.(event) },
    createOperationId: (() => { let id = 0; return () => `operation-${++id}` })(),
  })
  return { coordinator, clock, intents }
}

test('read/search/explain and plan runs never acquire a lease or emit Runtime work', async () => {
  const { coordinator, clock, intents } = makeCoordinator()
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'plan', permissionMode: 'plan' })
  coordinator.beforeTool({ requestId: 'plan', toolUseId: 'read', toolName: 'Read' })
  coordinator.afterTool({ requestId: 'plan', toolUseId: 'search', toolName: 'Grep', succeeded: true, hasProjectDiff: false })
  coordinator.markRunTerminal('plan', 'succeeded')
  await clock.advance(31_000)
  assert.equal(coordinator.snapshot('project'), undefined)
  assert.deepEqual(intents, [])
})

test('the three explicit write tools acquire before execution and release on failure without mutation', () => {
  const { coordinator, intents } = makeCoordinator()
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'write-run', permissionMode: 'auto' })
  for (const [index, toolName] of ['Edit', 'Write', 'NotebookEdit'].entries()) {
    const toolUseId = `tool-${index}`
    coordinator.beforeTool({ requestId: 'write-run', toolUseId, toolName })
    assert.equal(coordinator.snapshot('project').activeAgentLeaseCount, 1)
    coordinator.afterTool({ requestId: 'write-run', toolUseId, toolName, succeeded: false, hasProjectDiff: false })
    assert.equal(coordinator.snapshot('project').activeAgentLeaseCount, 0)
  }
  coordinator.markRunTerminal('write-run', 'failed')
  const snapshot = coordinator.snapshot('project')
  assert.equal(snapshot.successfulMutationCount, 0)
  assert.equal(snapshot.failedOrCancelledAfterMutation, false)
  assert.deepEqual(intents.filter((event) => event.type === 'agent-lease-acquired').map((event) => event.toolUseId), ['tool-0', 'tool-1', 'tool-2'])
})

test('Bash-like text is irrelevant; only a successful project diff becomes a mutation and settles once', async () => {
  const { coordinator, clock, intents } = makeCoordinator()
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'run', permissionMode: 'auto' })
  coordinator.afterTool({ requestId: 'run', toolUseId: 'bash', toolName: 'Bash', succeeded: true, hasProjectDiff: false })
  assert.equal(coordinator.snapshot('project').successfulMutationCount, 0)
  coordinator.afterTool({ requestId: 'run', toolUseId: 'structured', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  coordinator.markRunTerminal('run', 'succeeded')
  await clock.flush()
  await clock.advance(1_500)
  assert.equal(intents.filter((event) => event.type === 'settle').length, 1)
  assert.equal(coordinator.snapshot('project').successfulMutationCount, 1)
})

test('file-diff evidence ignores Bash text and rejects structured diffs outside the project root', () => {
  const { fileDiffFromPostToolUse } = loadTsModule(resolve(testDir, './claude-agent-runner/file-diff.ts'))
  assert.equal(fileDiffFromPostToolUse({ tool_name: 'Bash', tool_input: { command: 'sed -i "s/a/b/" src/a.ts > log' }, tool_response: { stdout: 'changed' } }, '/project'), undefined)
  const inside = fileDiffFromPostToolUse({ tool_name: 'McpTool', tool_response: { filePath: '/project/src/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } }, '/project')
  assert.equal(inside.relativePath, 'src/a.ts')
  assert.equal(fileDiffFromPostToolUse({ tool_name: 'McpTool', tool_response: { filePath: '/outside/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } }, '/project'), undefined)
})

test('all potential runs must be terminal before settle starts', async () => {
  const { coordinator, clock, intents } = makeCoordinator()
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'one', permissionMode: 'auto' })
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'two', permissionMode: 'auto' })
  coordinator.afterTool({ requestId: 'one', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  coordinator.markRunTerminal('one', 'succeeded')
  await clock.flush()
  await clock.advance(2_000)
  assert.equal(intents.filter((event) => event.type === 'settle').length, 0)
  coordinator.markRunTerminal('two', 'succeeded')
  await clock.flush()
  await clock.advance(1_500)
  assert.equal(intents.filter((event) => event.type === 'settle').length, 1)
})

test('a new potential run fences an old settle result and only the latest generation settles', async () => {
  let resolveFirst
  const firstSettled = new Promise((resolve) => { resolveFirst = resolve })
  const { coordinator, clock, intents } = makeCoordinator({ intent: (event) => event.type === 'settle' && event.editGeneration === 1 ? firstSettled : undefined })
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'one', permissionMode: 'auto' })
  coordinator.afterTool({ requestId: 'one', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  coordinator.markRunTerminal('one', 'succeeded')
  await clock.flush()
  await clock.advance(1_500)
  assert.equal(intents.filter((event) => event.type === 'settle').length, 1)
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'two', permissionMode: 'auto' })
  assert.equal(coordinator.snapshot('project').editGeneration, 2)
  resolveFirst(); await clock.flush()
  coordinator.markRunTerminal('two', 'succeeded')
  await clock.flush()
  await clock.advance(1_500)
  assert.deepEqual(intents.filter((event) => event.type === 'settle').map((event) => event.editGeneration), [1, 2])
})

test('a build operation is generation-fenced when a later potential run arrives', async () => {
  const { coordinator, clock } = makeCoordinator()
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'one', permissionMode: 'auto' })
  coordinator.afterTool({ requestId: 'one', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  coordinator.markRunTerminal('one', 'succeeded')
  await clock.flush(); await clock.advance(1_500); await clock.flush()
  const buildOperationId = coordinator.beginBuild('project', 1)
  assert.ok(buildOperationId)
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'two', permissionMode: 'auto' })
  assert.equal(coordinator.completeBuild('project', 1, buildOperationId), false)
  assert.equal(coordinator.snapshot('project').editGeneration, 2)
})

test('failed/cancelled after a mutation disables auto-build, while manual stop fences automatic settle until explicit recovery', async () => {
  const failed = makeCoordinator()
  failed.coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'bad', permissionMode: 'auto' })
  failed.coordinator.afterTool({ requestId: 'bad', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  failed.coordinator.markRunTerminal('bad', 'cancelled')
  await failed.clock.advance(31_000)
  assert.equal(failed.coordinator.snapshot('project').failedOrCancelledAfterMutation, true)
  assert.equal(failed.intents.filter((event) => event.type === 'no-auto-build').length, 1)
  assert.equal(failed.intents.filter((event) => event.type === 'settle').length, 0)

  const manual = makeCoordinator()
  manual.coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'good', permissionMode: 'auto' })
  manual.coordinator.afterTool({ requestId: 'good', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  manual.coordinator.setManualStopFence('project', true)
  manual.coordinator.markRunTerminal('good', 'succeeded')
  await manual.clock.advance(2_000)
  assert.equal(manual.intents.filter((event) => event.type === 'settle').length, 0)
  manual.coordinator.setManualStopFence('project', false)
  await manual.clock.flush()
  await manual.clock.advance(1_500)
  assert.equal(manual.intents.filter((event) => event.type === 'settle').length, 1)
})

test('a changing fingerprint times out after thirty seconds without a build intent', async () => {
  const { coordinator, clock, intents } = makeCoordinator({ fingerprint: (_projectId, now) => `fingerprint-${now}` })
  coordinator.registerAcceptedRun({ projectId: 'project', requestId: 'run', permissionMode: 'auto' })
  coordinator.afterTool({ requestId: 'run', toolUseId: 'diff', toolName: 'McpTool', succeeded: true, hasProjectDiff: true })
  coordinator.markRunTerminal('run', 'succeeded')
  await clock.flush()
  await clock.advance(30_000)
  assert.equal(intents.filter((event) => event.type === 'settle').length, 0)
  assert.equal(intents.filter((event) => event.type === 'settle-timeout').length, 1)
})
