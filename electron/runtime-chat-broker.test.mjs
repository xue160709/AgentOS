import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

function projectWorkspace() { return { workspaceRevision: 0, activeProjectId: 'p1', activeThreadId: '', projects: [{ id: 'p1', name: 'Project', path: '/projects/p1', createdAt: 1, updatedAt: 1 }], threads: [], sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['p1'] }, runtimeDefinitions: [], workspaceTabs: [], activeWorkspaceTabId: '', projectHomeViewModes: {}, localAppDefinitions: [], localAppTabs: [], activeLocalAppTabId: '' } }
function runtimeWorkspace(threads = []) { return { schemaVersion: 1, runtimeThreadRevision: 0, runtimeDevelopmentThreads: threads } }
function scope(runtimeScopeId, overrides = {}) { const project = runtimeScopeId.startsWith('project:'); return { runtimeScopeId, runtimeDefinitionId: project ? 'rd-project' : runtimeScopeId.slice('workspace:'.length), runtimeOwner: project ? { kind: 'project', projectId: runtimeScopeId.slice('project:'.length) } : { kind: 'workspace' }, cwd: project ? `/projects/${runtimeScopeId.slice('project:'.length)}` : `/runtimes/${runtimeScopeId.slice('workspace:'.length)}`, runtimeRoot: project ? `/projects/${runtimeScopeId.slice('project:'.length)}/.agentos` : `/runtimes/${runtimeScopeId.slice('workspace:'.length)}`, routeGeneration: 3, developmentGeneration: 7, ...overrides } }
function authority(runtimeScopeId, overrides = {}) { return { runtimeScopeId, routeGeneration: 3, developmentGeneration: 7, ownerWebContentsId: 50, ...overrides } }

function deferred() {
  let resolve; let reject
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

class FakeClock {
  constructor() { this.value = 0; this.next = 0; this.tasks = new Map() }
  now = () => this.value
  set = (callback, delay) => { const id = ++this.next; this.tasks.set(id, { at: this.value + delay, callback }); return id }
  clear = (id) => this.tasks.delete(id)
  async flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve() }
  async advance(ms) {
    const end = this.value + ms
    while (true) {
      const due = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((left, right) => left[1].at - right[1].at)[0]
      if (!due) break
      this.tasks.delete(due[0]); this.value = due[1].at; due[1].callback(); await this.flush()
    }
    this.value = end; await this.flush()
  }
}

function harness(options = {}) {
  const { ChatBrokerCore } = load(resolve(testDir, './chat-broker-core.ts'))
  const { ProjectChatBroker } = load(resolve(testDir, './project-chat-broker.ts'))
  const { RuntimeChatBroker } = load(resolve(testDir, './runtime-chat-broker.ts'))
  let projects = projectWorkspace(); let runtimes = runtimeWorkspace(); let id = 0
  const resolved = new Map([['project:p1', scope('project:p1')], ['workspace:w1', scope('workspace:w1')], ['workspace:w2', scope('workspace:w2')]])
  const runner = { submitted: [], cancelled: [], reset: [], rewound: [], submit(payload) { this.submitted.push(payload); return options.runnerSubmit?.(payload, this) ?? { requestId: `request-${this.submitted.length}` } }, async cancel(id) { this.cancelled.push(id) }, async answerPermissionRequest() {}, async resetThread(id) { this.reset.push(id) }, async rewindFiles(payload) { this.rewound.push(payload); return { ok: true, changeSetId: payload.changeSetId } }, setRuntimeEditHook() {} }
  const core = new ChatBrokerCore({ runner, now: (() => { let now = 100; return () => ++now })() })
  const project = new ProjectChatBroker({ core, runner, store: { read: () => projects, save: async (next) => (projects = next) }, createId: (prefix) => `${prefix}-${++id}` })
  const events = []
  const runtime = new RuntimeChatBroker({ core, runner, store: { read: () => runtimes, save: async (next, expected) => { assert.equal(expected, runtimes.runtimeThreadRevision); runtimes = { schemaVersion: 1, runtimeThreadRevision: runtimes.runtimeThreadRevision + 1, runtimeDevelopmentThreads: next.runtimeDevelopmentThreads }; return runtimes } }, resolveScope: (id) => resolved.get(id) ?? null, createId: (prefix) => `${prefix}-${++id}`, broadcast: (event) => events.push(event), promptOwnerCandidates: () => [50], developmentCoordinator: options.developmentCoordinator })
  return { core, project, runtime, runner, events, resolved, projects: () => projects, runtimes: () => runtimes }
}

test('Runtime facade registers only the development coordinator and rejects submit after exit', async () => {
  const lifecycle = []; let accepting = true
  const developmentCoordinator = {
    canSubmit: () => accepting,
    registerAcceptedRun: (input) => { lifecycle.push(['accepted', input]); return true },
    markPromptWaiting: (input) => { lifecycle.push(['waiting', input]); return true },
    markPromptResolved: (input) => { lifecycle.push(['resolved', input]); return true },
    markRunTerminal: (input) => { lifecycle.push(['terminal', input]); return true },
  }
  const h = harness({ developmentCoordinator })
  const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Runtime only' })
  const submitted = await h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'change' })
  assert.equal(lifecycle[0][0], 'accepted')
  assert.equal(lifecycle[0][1].developmentGeneration, 7)
  h.core.publish({ type: 'permission_request', requestId: submitted.value.requestId, permissionRequestId: 'prompt-1', toolUseId: 'tool-1', toolName: 'Write' }); await h.core.idle()
  assert.equal(lifecycle.some(([kind]) => kind === 'waiting'), true)
  h.core.publish({ type: 'cancelled', requestId: submitted.value.requestId }); await h.core.idle()
  assert.equal(lifecycle.some(([kind]) => kind === 'resolved'), true)
  assert.equal(lifecycle.some(([kind]) => kind === 'terminal'), true)
  accepting = false
  const rejected = await h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'too late' })
  assert.equal(rejected.error.code, 'thread-busy')
  assert.equal(h.runner.submitted.length, 1)

  const projectThread = await h.project.createThread({ projectId: 'p1', title: 'Project', source: 'user' })
  const projectSubmit = await h.project.submitRun({ projectId: 'p1', threadId: projectThread.value.threadId, text: 'ordinary project prompt' })
  assert.equal(projectSubmit.ok, true)
  assert.equal(lifecycle.filter(([kind]) => kind === 'accepted').length, 1, 'Project submit never enters Runtime coordinator authority')
})

test('delayed Runner is owned before exit and settles exactly once after accepted mutation terminal', async () => {
  const delayed = deferred(); const intents = []; const clock = new FakeClock(); let operation = 0
  const { RuntimeDevelopmentCoordinator } = load(resolve(testDir, './runtime-development-coordinator.ts'))
  const coordinator = new RuntimeDevelopmentCoordinator({
    now: clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    fingerprint: async () => 'changed',
    intent: (intent) => { intents.push(intent) },
    createOperationId: () => `operation-${++operation}`,
  })
  coordinator.open({ ...authority('workspace:w1'), runtimeDefinitionId: 'w1', entryFingerprint: 'entry', saveCapability: 'static' })
  coordinator.ready(authority('workspace:w1'))
  const h = harness({ developmentCoordinator: coordinator, runnerSubmit: () => delayed.promise })
  const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Delayed' })
  const submitting = h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'change' })
  for (let index = 0; index < 8 && h.runner.submitted.length === 0; index += 1) await Promise.resolve()
  assert.equal(h.runner.submitted.length, 1)
  assert.equal(coordinator.snapshot('workspace:w1').activeRunCount, 1)
  coordinator.requestExit(authority('workspace:w1'))
  assert.equal(coordinator.snapshot('workspace:w1').phase, 'exit_requested')
  assert.equal(intents.length, 0, 'pending Runner acceptance blocks settle/save')
  await clock.advance(31_000)
  assert.equal(coordinator.snapshot('workspace:w1').phase, 'exit_requested', 'submit latency is not charged to the settle timeout')
  assert.equal(intents.length, 0, 'delayed acceptance still cannot settle/save')

  delayed.resolve({ requestId: 'accepted-delayed' })
  const accepted = await submitting
  assert.equal(accepted.ok, true)
  coordinator.beforeTool({ requestId: 'accepted-delayed', toolUseId: 'write', toolName: 'Write' })
  coordinator.afterTool({ requestId: 'accepted-delayed', toolUseId: 'write', toolName: 'Write', succeeded: true, hasProjectDiff: true })
  h.core.publish({ type: 'result', requestId: 'accepted-delayed', sessionId: 'session', result: 'ok' })
  await h.core.idle()
  await clock.flush()
  await clock.advance(1_500)
  const save = intents.find((item) => item.type === 'save')
  assert.ok(save)
  assert.equal(intents.filter((item) => item.type === 'save').length, 1)
  assert.equal(coordinator.completeSave(save, 'saved'), true)
  h.core.publish({ type: 'result', requestId: 'accepted-delayed', sessionId: 'late', result: 'late' })
  await h.core.idle()
  assert.equal(intents.filter((item) => item.type === 'save').length, 1)
  assert.equal(intents.filter((item) => item.type === 'closed').length, 1)
})

test('Runner rejection clears submitting authority and never saves a failed partial run', async () => {
  const delayed = deferred(); const intents = []; const clock = new FakeClock()
  const { RuntimeDevelopmentCoordinator } = load(resolve(testDir, './runtime-development-coordinator.ts'))
  const coordinator = new RuntimeDevelopmentCoordinator({ now: clock.now, setTimer: clock.set, clearTimer: clock.clear, fingerprint: async () => 'entry', intent: (intent) => { intents.push(intent) } })
  coordinator.open({ ...authority('workspace:w1'), runtimeDefinitionId: 'w1', entryFingerprint: 'entry', saveCapability: 'static' })
  coordinator.ready(authority('workspace:w1'))
  const h = harness({ developmentCoordinator: coordinator, runnerSubmit: () => delayed.promise })
  const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Rejected' })
  const submitting = h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'fails' })
  for (let index = 0; index < 8 && h.runner.submitted.length === 0; index += 1) await Promise.resolve()
  coordinator.requestExit(authority('workspace:w1'))
  delayed.reject(new Error('submit rejected'))
  const rejected = await submitting
  assert.equal(rejected.error.code, 'sdk-submit-failed')
  assert.equal(coordinator.snapshot('workspace:w1').activeRunCount, 0)
  await clock.flush()
  await clock.advance(1_500)
  assert.equal(coordinator.snapshot('workspace:w1').phase, 'closed')
  assert.equal(intents.filter((item) => item.type === 'save').length, 0)
  assert.equal(intents.filter((item) => item.type === 'closed').length, 1)
})

test('accepted registration failure cancels the orphan Runner and preserves the generation fence', async () => {
  const delayed = deferred()
  const { RuntimeDevelopmentCoordinator } = load(resolve(testDir, './runtime-development-coordinator.ts'))
  const coordinator = new RuntimeDevelopmentCoordinator({ fingerprint: async () => 'entry' })
  coordinator.open({ ...authority('workspace:w1'), runtimeDefinitionId: 'w1', entryFingerprint: 'entry', saveCapability: 'static' })
  coordinator.ready(authority('workspace:w1'))
  const h = harness({ developmentCoordinator: coordinator, runnerSubmit: () => delayed.promise })
  const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Fence' })
  const submitting = h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'stale acceptance' })
  for (let index = 0; index < 8 && h.runner.submitted.length === 0; index += 1) await Promise.resolve()
  assert.equal(coordinator.reenter('workspace:w1').developmentGeneration, 8)
  h.resolved.set('workspace:w1', scope('workspace:w1', { developmentGeneration: 8 }))
  delayed.resolve({ requestId: 'orphan-run' })
  const rejected = await submitting
  assert.equal(rejected.error.code, 'sdk-submit-failed')
  assert.deepEqual(h.runner.cancelled, ['orphan-run'])
  assert.equal(coordinator.snapshot('workspace:w1').activeRunCount, 0)
  h.core.publish({ type: 'assistant_delta', requestId: 'orphan-run', messageId: 'late', text: 'must not persist' })
  await h.core.idle()
  assert.equal(JSON.stringify(h.runtimes()).includes('must not persist'), false)
})

test('reenter rebases an owned waiting prompt to the new development generation', async () => {
  const h = harness()
  const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Prompt' })
  const submitted = await h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'ask' })
  h.core.publish({ type: 'permission_request', requestId: submitted.value.requestId, permissionRequestId: 'prompt-reenter', toolUseId: 'tool', toolName: 'Write' }); await h.core.idle()
  h.resolved.set('workspace:w1', scope('workspace:w1', { developmentGeneration: 8 }))
  h.runtime.rebaseDevelopmentGeneration('workspace:w1', 3, 7, 8)
  const answered = await h.runtime.answerPrompt(authority('workspace:w1', { developmentGeneration: 8 }), { threadId: created.value.threadId, requestId: submitted.value.requestId, promptId: 'prompt-reenter', response: { permissionRequestId: 'prompt-reenter', behavior: 'allow' } })
  assert.equal(answered.ok, true)
  assert.equal((await h.runtime.getSnapshot(authority('workspace:w1', { developmentGeneration: 8 }))).value.pendingPrompts.length, 0)
})

test('Project and Runtime facades share one core while keeping durable collections partitioned', async () => {
  const h = harness(); const created = await h.runtime.createThread(authority('project:p1'), { title: 'New thread' }); assert.equal(created.ok, true)
  const submitted = await h.runtime.submitRun(authority('project:p1'), { threadId: created.value.threadId, text: 'update runtime' }); assert.equal(submitted.ok, true)
  assert.equal(h.runner.submitted[0].cwd, '/projects/p1'); assert.equal(h.runner.submitted[0].runtimeRoot, '/projects/p1/.agentos'); assert.equal(h.runner.submitted[0].projectRuntimePrompt, true)
  assert.equal(h.projects().threads.length, 0); assert.equal((await h.project.getSnapshot('p1')).value.threads.length, 0)
  h.core.publish({ type: 'assistant_delta', requestId: submitted.value.requestId, messageId: 'assistant-1', text: 'done' }); h.core.publish({ type: 'result', requestId: submitted.value.requestId, sessionId: 'session-1', result: 'done' }); await h.core.idle()
  const runtimeThread = h.runtimes().runtimeDevelopmentThreads[0]; assert.equal(runtimeThread.chatState.sessionId, 'session-1'); assert.equal(runtimeThread.chatState.items.filter((item) => item.role === 'assistant').length, 1)
  assert.equal(h.projects().threads.length, 0, 'Runtime events never enter the Project collection')
})

test('Runtime scope authority rejects cross-scope threads, stale generations, and invalid roots', async () => {
  const h = harness(); const one = await h.runtime.createThread(authority('workspace:w1'), { title: 'One' }); const two = await h.runtime.createThread(authority('workspace:w2'), { title: 'Two' })
  assert.equal((await h.runtime.submitRun(authority('workspace:w1'), { threadId: two.value.threadId, text: 'spoof' })).error.code, 'thread-not-found')
  assert.equal((await h.runtime.submitRun(authority('workspace:w1', { routeGeneration: 2 }), { threadId: one.value.threadId, text: 'stale' })).error.code, 'runtime-scope-stale')
  h.resolved.set('workspace:w1', scope('workspace:w1', { runtimeRoot: '/outside' }))
  assert.equal((await h.runtime.submitRun(authority('workspace:w1'), { threadId: one.value.threadId, text: 'escape' })).error.code, 'runtime-root-invalid')
  assert.equal(h.runner.submitted.length, 0)
})

test('accepted route freezes both generations and late or terminal events cannot cross the fence', async () => {
  const h = harness(); const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'Thread' }); const submitted = await h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'first' })
  h.resolved.set('workspace:w1', scope('workspace:w1', { routeGeneration: 4, developmentGeneration: 8 }))
  h.core.publish({ type: 'assistant_delta', requestId: submitted.value.requestId, messageId: 'late', text: 'must drop' }); await h.core.idle()
  assert.equal(JSON.stringify(h.runtimes()).includes('must drop'), false)
  h.resolved.set('workspace:w1', scope('workspace:w1'))
  const second = await h.runtime.createThread(authority('workspace:w1'), { title: 'Second' }); const accepted = await h.runtime.submitRun(authority('workspace:w1'), { threadId: second.value.threadId, text: 'second' })
  h.core.publish({ type: 'result', requestId: accepted.value.requestId, sessionId: 's2', result: 'ok' }); await h.core.idle(); h.core.publish({ type: 'assistant_delta', requestId: accepted.value.requestId, messageId: 'late-2', text: 'after terminal' }); await h.core.idle()
  assert.equal(JSON.stringify(h.runtimes()).includes('after terminal'), false)
})

test('Runtime file diff keeps only reliable files inside runtimeRoot', async () => {
  const h = harness(); const created = await h.runtime.createThread(authority('project:p1'), { title: 'Diff' }); const submitted = await h.runtime.submitRun(authority('project:p1'), { threadId: created.value.threadId, text: 'change' })
  h.core.publish({ type: 'file_diff', requestId: submitted.value.requestId, changeSetId: 'c1', checkpointId: 'cp1', files: [{ relativePath: '.agentos/index.ts', status: 'modified', additions: 1, deletions: 0, hunks: [] }, { relativePath: 'secret.txt', status: 'modified', additions: 1, deletions: 0, hunks: [] }] }); await h.core.idle()
  const diff = h.runtimes().runtimeDevelopmentThreads[0].chatState.items.find((item) => item.type === 'file_diff')
  assert.deepEqual(diff.files.map((file) => file.relativePath), ['.agentos/index.ts'])
})

test('removed Runtime remains readable and archivable but cannot create or submit', async () => {
  const h = harness(); const created = await h.runtime.createThread(authority('workspace:w1'), { title: 'History' }); h.resolved.set('workspace:w1', scope('workspace:w1', { available: false }))
  const snapshot = await h.runtime.getSnapshot(authority('workspace:w1')); assert.equal(snapshot.ok, true); assert.equal(snapshot.value.scopeAvailable, false); assert.equal(snapshot.value.threads.length, 1)
  assert.equal((await h.runtime.createThread(authority('workspace:w1'), { title: 'No' })).error.code, 'runtime-scope-unavailable')
  assert.equal((await h.runtime.submitRun(authority('workspace:w1'), { threadId: created.value.threadId, text: 'No' })).error.code, 'runtime-scope-unavailable')
  assert.equal((await h.runtime.archiveThread(authority('workspace:w1'), { threadId: created.value.threadId })).ok, true)
})

test('disposing one facade only unregisters that facade and never disposes the shared runner', async () => {
  const h = harness(); h.runtime.dispose()
  const created = await h.project.createThread({ projectId: 'p1', title: 'Project survives', source: 'user' }); assert.equal(created.ok, true)
  const { RuntimeChatBroker } = load(resolve(testDir, './runtime-chat-broker.ts'))
  let state = runtimeWorkspace(); const replacement = new RuntimeChatBroker({ core: h.core, store: { read: () => state, save: async (next) => (state = { schemaVersion: 1, runtimeThreadRevision: state.runtimeThreadRevision + 1, runtimeDevelopmentThreads: next.runtimeDevelopmentThreads }) }, resolveScope: (id) => h.resolved.get(id) ?? null })
  assert.equal((await replacement.createThread(authority('workspace:w1'), { title: 'Runtime returns' })).ok, true); replacement.dispose()
})

test('Runner mutation fence rejects traversal and symlink escapes without treating Bash as OS sandboxed', async () => {
  const { runtimeMutationTargetAllowed } = load(resolve(testDir, './chat-broker-core.ts'))
  const root = await mkdtemp(join(tmpdir(), 'runtime-root-')); const outside = await mkdtemp(join(tmpdir(), 'runtime-outside-'))
  try {
    await mkdir(join(root, 'src')); await symlink(outside, join(root, 'linked-outside'))
    assert.equal(await runtimeMutationTargetAllowed(root, 'Write', { file_path: join(root, 'src', 'new.ts') }), true)
    assert.equal(await runtimeMutationTargetAllowed(root, 'Edit', { file_path: join(outside, 'secret.ts') }), false)
    assert.equal(await runtimeMutationTargetAllowed(root, 'NotebookEdit', { notebook_path: '../escape.ipynb' }), false)
    assert.equal(await runtimeMutationTargetAllowed(root, 'Write', { file_path: join(root, 'linked-outside', 'escape.ts') }), false)
    assert.equal(await runtimeMutationTargetAllowed(root, 'Bash', { command: 'anything' }), true, 'Bash remains governed by app-global permission, not a claimed OS sandbox')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
