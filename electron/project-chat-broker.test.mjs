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
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function workspace(threads = []) {
  return {
    workspaceRevision: 0, activeProjectId: 'project-1', activeThreadId: '',
    projects: [{ id: 'project-1', name: 'Project', path: '/project', createdAt: 1, updatedAt: 1 }],
    threads, sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1'] },
    runtimeDefinitions: [], workspaceTabs: [], activeWorkspaceTabId: '', projectHomeViewModes: {},
    localAppDefinitions: [], localAppTabs: [], activeLocalAppTabId: '',
  }
}

function makeHarness(initial = workspace(), options = {}) {
  const { ProjectChatBroker } = loadTsModule(resolve(testDir, './project-chat-broker.ts'))
  let state = initial
  let now = 100
  let id = 0
  const broadcasts = []
  const runner = {
    submitted: [], cancelled: [], responses: [], resets: [], rewinds: [], fail: false, answerFails: false, resetFails: false, rewindFails: false, rewindResult: { ok: true },
    submit(payload) { this.submitted.push(payload); if (this.fail) throw new Error('SDK unavailable'); return { requestId: `request-${this.submitted.length}` } },
    async cancel(requestId) { this.cancelled.push(requestId) },
    async answerPermissionRequest(response) { if (this.answerFails) throw new Error('SDK response unavailable'); this.responses.push(response) },
    async resetThread(threadId) { if (this.resetFails) throw new Error('SDK reset unavailable'); this.resets.push(threadId) },
    async rewindFiles(payload) { if (this.rewindFails) throw new Error('SDK rewind unavailable'); this.rewinds.push(payload); return { ...this.rewindResult, changeSetId: payload.changeSetId } },
    setRuntimeEditHook(hook) { this.runtimeEditHook = hook },
  }
  const store = options.store ?? { read: () => state, save: async (next) => { state = next; return state } }
  const broker = new ProjectChatBroker({
    store, runner, now: options.now ?? (() => ++now), createId: options.createId ?? ((prefix) => `${prefix}-${++id}`),
    broadcast: (event) => broadcasts.push(event), permissionMode: options.permissionMode, runExclusive: options.runExclusive, promptOwnerCandidates: options.promptOwnerCandidates, runtimeEditCoordinator: options.runtimeEditCoordinator,
  })
  return { broker, runner, broadcasts, state: () => state }
}

async function createThread(harness, title) {
  const result = await harness.broker.createThread({ projectId: 'project-1', title, source: 'user' })
  assert.equal(result.ok, true)
  return result.value.threadId
}

test('external unread cursor rebuilds from durable website receivedAt and rebroadcasts without a save', async () => {
  const threads = [
    { id: 'website-old', projectId: 'project-1', title: 'Old', createdAt: 1, updatedAt: 1, creationSource: { kind: 'website', bindingId: 'bnd_x', receivedAt: 10 }, chatState: { model: 'Claude', items: [] } },
    { id: 'website-new', projectId: 'project-1', title: 'New', createdAt: 1, updatedAt: 1, creationSource: { kind: 'website', bindingId: 'bnd_y', receivedAt: 20 }, chatState: { model: 'Claude', items: [] } },
  ]; let saves = 0; const initial = workspace(threads); const harness = makeHarness(initial, { store: { read: () => initial, save: async () => { saves++; return initial } } })
  await harness.broker.refreshExternalUnread('project-1', 10); const snapshot = (await harness.broker.getSnapshot('project-1')).value
  assert.equal(snapshot.unreadExternalTaskCount, 1); assert.equal(snapshot.latestUnreadExternalThreadId, 'website-new'); assert.equal(saves, 0); assert.equal(initial.workspaceRevision, 0)
})

test('broker serializes concurrent mutations and advances durable revisions', async () => {
  const harness = makeHarness()
  const results = await Promise.all([createThread(harness, 'One'), createThread(harness, 'Two')])
  assert.equal(new Set(results).size, 2)
  assert.equal(harness.state().threads.length, 2)
  assert.equal(harness.state().workspaceRevision, 2)
})

test('broker external scheduler takes the shared lock before its first read in both cross-writer orders', async () => {
  const { ChatWorkspaceCoordinator } = loadTsModule(resolve(testDir, './chat-workspace-coordinator.ts'))
  const coordinator = new ChatWorkspaceCoordinator()
  let state = workspace(); let reads = 0; let release; const order = []; const scheduled = []
  const store = { read: () => { reads += 1; order.push('broker:read'); return state }, save: async (next) => { order.push('broker:save'); state = next; return state } }
  const harness = makeHarness(state, { store, runExclusive: (operation) => { scheduled.push('broker'); return coordinator.runExclusive(operation) } })
  const mainFirst = coordinator.runExclusive(async () => {
    await new Promise((resolve) => { release = resolve })
    state = { ...state, workspaceRevision: state.workspaceRevision + 1, runtimeDefinitions: [{ id: 'runtime', name: 'Runtime' }] }
  })
  await Promise.resolve()
  const snapshot = harness.broker.getSnapshot('project-1')
  const created = harness.broker.createThread({ projectId: 'project-1', title: 'Broker thread', source: 'user' })
  let brokerIdle = false; void harness.broker.idle().then(() => { brokerIdle = true })
  await Promise.resolve()
  assert.equal(reads, 0, 'broker has not read before Main releases the shared coordinator')
  assert.equal(brokerIdle, false, 'idle waits for externally submitted work')
  release(); await mainFirst; assert.equal((await snapshot).ok, true); await created
  assert.equal(state.workspaceRevision, 2); assert.equal(state.runtimeDefinitions[0].id, 'runtime'); assert.equal(state.threads.length, 1)

  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: state.threads[0].id, text: 'scheduled submit' })
  harness.broker.publish({ type: 'result', requestId: submitted.value.requestId, sessionId: 'session', result: 'done' })
  await harness.broker.idle(); await harness.broker.broadcastAllSnapshots('auto')
  assert.ok(scheduled.length >= 5, 'getSnapshot/create/submit/publish/broadcast each enter the external scheduler')

  order.length = 0
  const brokerFirst = harness.broker.setThreadPinned({ projectId: 'project-1', threadId: state.threads[0].id, pinned: true, routeGeneration: 1 })
  const mainAfter = coordinator.runExclusive(() => { order.push('main:mutation'); state = { ...state, workspaceRevision: state.workspaceRevision + 1, sidebarPrefs: { ...state.sidebarPrefs, collapsed: true } } })
  await brokerFirst; await mainAfter; await coordinator.idle(); await harness.broker.idle()
  assert.deepEqual(order, ['broker:read', 'broker:save', 'main:mutation'], 'broker submission reaches the shared FIFO before a later Main operation')
  assert.equal(state.workspaceRevision, 6); assert.equal(state.sidebarPrefs.collapsed, true); assert.ok(state.threads[0].pinnedAt !== undefined)
  assert.ok(harness.broadcasts.length > 0, 'broker broadcasts after its committed state')
})

test('broker projects the minimal project summary without exposing its path', async () => {
  const normal = makeHarness()
  const normalSnapshot = await normal.broker.getSnapshot('project-1')
  assert.deepEqual(normalSnapshot.value.project, { id: 'project-1', name: 'Project', pathMissing: false })
  assert.equal(Object.prototype.hasOwnProperty.call(normalSnapshot.value.project, 'path'), false)

  const missingPath = workspace()
  missingPath.projects[0].pathMissing = true
  const unavailable = await makeHarness(missingPath).broker.getSnapshot('project-1')
  assert.deepEqual(unavailable.value.project, { id: 'project-1', name: 'Project', pathMissing: true })
  const removed = await normal.broker.getSnapshot('removed-project')
  assert.equal(removed.ok, false)
  assert.equal(removed.error.code, 'project-not-found')
})

test('broker projects durable threads through one redacted snapshot projector for reads and broadcasts', async () => {
  const sentinel = '/private/project-secret binding-secret session-secret checkpoint-secret request-secret metadata-secret'
  const thread = {
    id: 'thread-1', projectId: 'project-1', title: 'Thread', purpose: 'skill-run', homePluginSlug: 'plugin', skillPath: sentinel, skillCommand: '/run', skillTitle: 'Run', createdAt: 1, updatedAt: 2, creationSource: { kind: 'website', bindingId: sentinel, receivedAt: 3 },
    chatState: {
      model: 'Claude', modelPick: { providerId: 'provider', anthropicModel: 'model' }, sessionId: sentinel, cwd: sentinel,
      tasks: { requestId: sentinel, updatedAt: 4, items: [{ id: 'task', toolUseId: 'tool', subject: 'Task', status: 'pending', metadata: { sentinel }, createdAt: 4, updatedAt: 4, order: 1 }] },
      items: [
        { type: 'message', id: 'message', role: 'user', content: 'visible', status: 'done', attachments: [{ id: 'attachment', kind: 'text', name: 'C:\\private\\note.md', path: sentinel, mimeType: 'text/markdown', size: 7, preview: 'visible' }] },
        { type: 'file_diff', id: 'diff', requestId: sentinel, threadId: 'thread-1', changeSetId: 'change', checkpointId: sentinel, status: 'captured', files: [{ path: sentinel, relativePath: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, hunks: [] }, { path: sentinel, relativePath: 'C:\\private\\secret.ts', status: 'modified', additions: 1, deletions: 0, hunks: [] }] },
      ],
    },
  }
  const harness = makeHarness(workspace([thread]))
  const read = await harness.broker.getSnapshot('project-1')
  await harness.broker.broadcastAllSnapshots('auto')
  const broadcast = harness.broadcasts.at(-1).snapshot
  assert.deepEqual(broadcast.threads, read.value.threads, 'broadcast shares the read snapshot projector')
  const projected = read.value.threads[0]
  assert.equal(Object.hasOwn(projected, 'creationSource'), false)
  assert.equal(Object.hasOwn(projected.chatState, 'sessionId'), false)
  assert.equal(Object.hasOwn(projected.chatState, 'cwd'), false)
  assert.equal(Object.hasOwn(projected.chatState.tasks, 'requestId'), false)
  assert.equal(Object.hasOwn(projected.chatState.tasks.items[0], 'metadata'), false)
  assert.equal(Object.hasOwn(projected.chatState.items[0].attachments[0], 'path'), false)
  assert.equal(Object.hasOwn(projected.chatState.items[1], 'checkpointId'), false)
  assert.equal(Object.hasOwn(projected.chatState.items[1].files[0], 'path'), false)
  const serialized = JSON.stringify({ read: read.value, broadcast })
  assert.equal(serialized.includes(sentinel), false)
  assert.equal(serialized.includes('C:\\private'), false)
  assert.equal(projected.chatState.items[0].attachments[0].name, 'note.md')
  assert.equal(projected.chatState.items[1].files[0].relativePath, 'src/a.ts')
})

test('broker owns fork, archive, pin, model, review, and edit-resubmit mutations', async () => {
  const source = {
    id: 'thread-source', projectId: 'project-1', title: 'New thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'website', bindingId: 'secret', receivedAt: 1 },
    chatState: { model: 'Claude', modelPick: { providerId: 'p', anthropicModel: 'm' }, sessionId: 'session', cwd: '/secret', tasks: { requestId: 'request', updatedAt: 1, items: [] }, items: [
      { type: 'message', id: 'user-1', role: 'user', content: 'first', status: 'done' },
      { type: 'message', id: 'assistant-1', role: 'assistant', content: 'answer', status: 'done' },
      { type: 'file_diff', id: 'diff-1', requestId: 'request', changeSetId: 'change-1', checkpointId: 'checkpoint', files: [], status: 'captured', detail: 'pending' },
    ] },
  }
  const harness = makeHarness(workspace([source]))
  const fork = await harness.broker.forkThread({ projectId: 'project-1', threadId: source.id, messageId: 'user-1', routeGeneration: 1 })
  assert.equal(fork.ok, true)
  const forked = harness.state().threads.find((thread) => thread.id === fork.value.threadId)
  assert.deepEqual(forked.creationSource, { kind: 'user' })
  assert.equal(forked.chatState.items.length, 1)
  assert.equal(forked.chatState.sessionId, undefined)
  assert.equal(forked.chatState.tasks, undefined)
  const reviewed = await harness.broker.markFileDiffReviewed({ projectId: 'project-1', threadId: source.id, changeSetId: 'change-1', routeGeneration: 1 })
  assert.equal(reviewed.ok, true)
  assert.equal(harness.state().threads.find((thread) => thread.id === source.id).chatState.items.at(-1).status, 'reviewed')
  const revisionBeforePin = harness.state().workspaceRevision
  await harness.broker.setThreadPinned({ projectId: 'project-1', threadId: source.id, pinned: true, routeGeneration: 1 })
  const pinnedRevision = harness.state().workspaceRevision
  await harness.broker.setThreadPinned({ projectId: 'project-1', threadId: source.id, pinned: true, routeGeneration: 1 })
  assert.equal(pinnedRevision, revisionBeforePin + 1)
  assert.equal(harness.state().workspaceRevision, pinnedRevision)
  const model = await harness.broker.setThreadModel({ projectId: 'project-1', threadId: source.id, modelPick: { providerId: 'new', anthropicModel: 'new-model' }, routeGeneration: 1 })
  assert.equal(model.ok, true)
  assert.equal(harness.state().threads.find((thread) => thread.id === source.id).chatState.sessionId, undefined)
  const edited = await harness.broker.editAndSubmitRun({ projectId: 'project-1', threadId: source.id, messageId: 'user-1', text: ' edited ', routeGeneration: 1 })
  assert.equal(edited.ok, true)
  const editedThread = harness.state().threads.find((thread) => thread.id === source.id)
  assert.deepEqual(editedThread.chatState.items.filter((item) => item.type === 'message' && item.role === 'user').map((item) => item.content), ['edited'])
  const busyArchive = await harness.broker.archiveThread({ projectId: 'project-1', threadId: source.id, routeGeneration: 1 })
  assert.equal(busyArchive.error.code, 'thread-busy')
  assert.deepEqual(harness.runner.cancelled, [])
  harness.broker.publish({ type: 'result', requestId: edited.value.requestId, sessionId: 'new', result: 'done' }); await harness.broker.idle()
  const archived = await harness.broker.archiveThread({ projectId: 'project-1', threadId: source.id, routeGeneration: 1 })
  assert.equal(archived.ok, true)
  for (const result of [
    await harness.broker.submitRun({ projectId: 'project-1', threadId: source.id, text: 'no' }),
    await harness.broker.setThreadModel({ projectId: 'project-1', threadId: source.id, modelPick: { providerId: 'x', anthropicModel: 'x' }, routeGeneration: 1 }),
  ]) assert.equal(result.error.code, 'thread-not-found')
})

test('broker resolves prompt owners through presence candidates and failsover without durable writes', async () => {
  let candidates = [7, 9]
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [] } }
  const harness = makeHarness(workspace([thread]), { promptOwnerCandidates: () => candidates })
  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'needs approval' })
  harness.broker.publish({ type: 'permission_request', requestId: submitted.value.requestId, permissionRequestId: 'prompt-1', toolUseId: 'tool', toolName: 'Write', title: 'Write', displayName: 'Write', description: 'write' })
  await harness.broker.idle()
  const secondThread = await createThread(harness, 'Second')
  const secondRun = await harness.broker.submitRun({ projectId: 'project-1', threadId: secondThread, text: 'also needs approval' })
  harness.broker.publish({ type: 'permission_request', requestId: secondRun.value.requestId, permissionRequestId: 'prompt-2', toolUseId: 'tool', toolName: 'Write', title: 'Write', displayName: 'Write', description: 'write' })
  await harness.broker.idle()
  let snapshot = await harness.broker.getSnapshot('project-1')
  assert.deepEqual(snapshot.value.pendingPrompts.map((prompt) => prompt.ownerWebContentsId), [7, 7])
  const revision = harness.state().workspaceRevision; const broadcasts = harness.broadcasts.length
  candidates = [9, 7]; await harness.broker.refreshPromptOwners('project-1')
  snapshot = await harness.broker.getSnapshot('project-1')
  assert.equal(snapshot.value.pendingPrompts[0].ownerWebContentsId, 7, 'a still-eligible owner is not stolen by focus ordering')
  assert.equal(harness.state().workspaceRevision, revision); assert.equal(harness.broadcasts.length, broadcasts)
  candidates = [9]; await harness.broker.onWebContentsUnavailable(7)
  snapshot = await harness.broker.getSnapshot('project-1')
  assert.deepEqual(snapshot.value.pendingPrompts.map((prompt) => prompt.ownerWebContentsId), [9, 9], 'one unavailable window fails over every pending prompt it owned')
  assert.equal(harness.state().workspaceRevision, revision); assert.equal(harness.broadcasts.length, broadcasts + 1)
  const late = await harness.broker.answerPrompt({ projectId: 'project-1', threadId: thread.id, requestId: submitted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'prompt-1', behavior: 'allow' } }, 7)
  assert.equal(late.error.code, 'prompt-not-owned')

  const unavailable = makeHarness(workspace([structuredClone(thread)]), { promptOwnerCandidates: () => { throw new Error('presence unavailable') } })
  const unavailableRun = await unavailable.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'still pending' })
  unavailable.broker.publish({ type: 'permission_request', requestId: unavailableRun.value.requestId, permissionRequestId: 'prompt-none', toolUseId: 'tool', toolName: 'Write', title: 'Write', displayName: 'Write', description: 'write' }); await unavailable.broker.idle()
  const pending = await unavailable.broker.getSnapshot('project-1')
  assert.equal(pending.value.pendingPrompts[0].ownerWebContentsId, undefined, 'resolver failure keeps an unowned pending prompt')
})

test('broker rewinds only from durable diff state and folds exactly one safe result', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', sessionId: 'durable-session', modelPick: { providerId: 'provider', anthropicModel: 'model' }, items: [] } }
  const harness = makeHarness(workspace([thread]))
  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'make change' })
  harness.broker.publish({ type: 'file_diff', requestId: submitted.value.requestId, changeSetId: 'change-1', checkpointId: 'checkpoint-1', files: [] })
  harness.broker.publish({ type: 'result', requestId: submitted.value.requestId, sessionId: 'fresh-session', result: 'done' })
  await harness.broker.idle()
  const beforeRevision = harness.state().workspaceRevision; const beforeBroadcasts = harness.broadcasts.length
  const rewound = await harness.broker.rewindFileDiff({ projectId: 'project-1', threadId: thread.id, changeSetId: 'change-1', routeGeneration: 1 })
  assert.deepEqual(rewound, { ok: true, value: { changeSetId: 'change-1', status: 'reverted' } })
  assert.deepEqual(harness.runner.rewinds, [{ requestId: submitted.value.requestId, threadId: thread.id, modelPick: { providerId: 'provider', anthropicModel: 'model' }, changeSetId: 'change-1', checkpointId: 'checkpoint-1', cwd: '/project', sessionId: 'fresh-session' }])
  assert.equal(harness.state().workspaceRevision, beforeRevision + 1); assert.equal(harness.broadcasts.length, beforeBroadcasts + 1)
  const noOpRevision = harness.state().workspaceRevision; await harness.broker.rewindFileDiff({ projectId: 'project-1', threadId: thread.id, changeSetId: 'change-1', routeGeneration: 1 })
  assert.equal(harness.runner.rewinds.length, 1); assert.equal(harness.state().workspaceRevision, noOpRevision)
  harness.broker.publish({ type: 'file_rewind_result', requestId: submitted.value.requestId, changeSetId: 'change-1', status: 'error', detail: 'late' }); await harness.broker.idle()
  assert.equal(harness.state().workspaceRevision, noOpRevision, 'terminal run ignores late runner rewind event')

  const errorThread = structuredClone(harness.state().threads[0]); errorThread.chatState.items = errorThread.chatState.items.map((item) => item.type === 'file_diff' ? { ...item, changeSetId: 'change-2', status: 'captured' } : item)
  const errorHarness = makeHarness(workspace([errorThread])); errorHarness.runner.rewindResult = { ok: false, message: '/private/secret' }
  const failed = await errorHarness.broker.rewindFileDiff({ projectId: 'project-1', threadId: thread.id, changeSetId: 'change-2', routeGeneration: 1 })
  assert.deepEqual(failed, { ok: true, value: { changeSetId: 'change-2', status: 'error', detail: 'Unable to rewind file changes.' } })
  assert.equal(JSON.stringify(errorHarness.state()).includes('/private/secret'), false)
  const throwHarness = makeHarness(workspace([structuredClone(errorThread)])); throwHarness.runner.rewindFails = true
  const revision = throwHarness.state().workspaceRevision; const broadcasts = throwHarness.broadcasts.length
  const thrown = await throwHarness.broker.rewindFileDiff({ projectId: 'project-1', threadId: thread.id, changeSetId: 'change-2', routeGeneration: 1 })
  assert.equal(thrown.error.code, 'internal-error'); assert.equal(throwHarness.state().workspaceRevision, revision); assert.equal(throwHarness.broadcasts.length, broadcasts)
})

test('explicit pin remains idempotent when its timestamp is zero', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [] } }
  const harness = makeHarness(workspace([thread]), { now: () => 0 })
  await harness.broker.setThreadPinned({ projectId: 'project-1', threadId: thread.id, pinned: true, routeGeneration: 1 })
  const revision = harness.state().workspaceRevision
  await harness.broker.setThreadPinned({ projectId: 'project-1', threadId: thread.id, pinned: true, routeGeneration: 1 })
  assert.equal(harness.state().workspaceRevision, revision)
})

test('broker rejects a second active submit without cancelling and permits another thread', async () => {
  const harness = makeHarness()
  const first = await createThread(harness, 'One')
  const second = await createThread(harness, 'Two')
  const accepted = await harness.broker.submitRun({ projectId: 'project-1', threadId: first, text: 'first' })
  const busy = await harness.broker.submitRun({ projectId: 'project-1', threadId: first, text: 'second' })
  const parallel = await harness.broker.submitRun({ projectId: 'project-1', threadId: second, text: 'parallel' })
  assert.equal(accepted.ok, true)
  assert.deepEqual(busy, { ok: false, error: { code: 'thread-busy', message: 'Thread already has an active run.', retryable: false } })
  assert.equal(parallel.ok, true)
  assert.equal(harness.runner.submitted.length, 2)
  assert.deepEqual(harness.runner.cancelled, [])
})

test('broker routes only registered requests, fences terminal events, and counts unknown requests', async () => {
  const harness = makeHarness()
  const first = await createThread(harness, 'One')
  const second = await createThread(harness, 'Two')
  const firstRun = await harness.broker.submitRun({ projectId: 'project-1', threadId: first, text: 'first' })
  const secondRun = await harness.broker.submitRun({ projectId: 'project-1', threadId: second, text: 'second' })
  harness.broker.publish({ type: 'assistant_delta', requestId: 'unknown', messageId: 'unknown-message', text: 'ignored' })
  harness.broker.publish({ type: 'assistant_delta', requestId: firstRun.value.requestId, messageId: 'message-1', text: 'one' })
  harness.broker.publish({ type: 'assistant_delta', requestId: secondRun.value.requestId, messageId: 'message-2', text: 'two' })
  await harness.broker.idle()
  assert.equal(harness.broker.unknownRequestCount(), 1)
  assert.equal(harness.state().threads.find((thread) => thread.id === first).chatState.items.at(-1).content, 'one')
  assert.equal(harness.state().threads.find((thread) => thread.id === second).chatState.items.at(-1).content, 'two')
  const broadcastsBeforeLate = harness.broadcasts.length
  harness.broker.publish({ type: 'result', requestId: firstRun.value.requestId, sessionId: 'session-1', result: 'done' })
  await harness.broker.idle()
  harness.broker.publish({ type: 'assistant_delta', requestId: firstRun.value.requestId, messageId: 'message-1', text: ' late' })
  await harness.broker.idle()
  const assistant = harness.state().threads.find((thread) => thread.id === first).chatState.items.at(-1)
  assert.equal(assistant.content, 'one')
  assert.equal(assistant.status, 'done')
  assert.ok(harness.broadcasts.length > broadcastsBeforeLate)
  harness.broker.advanceRouteGeneration('project-1')
  const revisionBeforeStaleEvent = harness.state().workspaceRevision
  harness.broker.publish({ type: 'assistant_delta', requestId: secondRun.value.requestId, messageId: 'message-2', text: ' stale' })
  await harness.broker.idle()
  assert.equal(harness.state().workspaceRevision, revisionBeforeStaleEvent)
})

test('broker keeps a visible failed thread, does not restore live runs, and preserves prompt state when answering fails', async () => {
  const harness = makeHarness()
  const threadId = await createThread(harness, 'One')
  harness.runner.fail = true
  const failed = await harness.broker.submitRun({ projectId: 'project-1', threadId, text: 'will fail' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'sdk-submit-failed')
  assert.equal(harness.state().threads.find((thread) => thread.id === threadId).chatState.items.at(-1).status, 'error')
  const restarted = makeHarness(harness.state())
  const snapshot = await restarted.broker.getSnapshot('project-1')
  assert.equal(snapshot.ok, true)
  assert.deepEqual(snapshot.value.runs, [])

  harness.runner.fail = false
  const accepted = await harness.broker.submitRun({ projectId: 'project-1', threadId, text: 'ask' })
  harness.broker.publish({ type: 'permission_request', requestId: accepted.value.requestId, permissionRequestId: 'prompt-1', toolUseId: 'tool-1', toolName: 'Write', title: 'Write', displayName: 'Write', description: '', inputPreview: '{}' })
  await harness.broker.idle()
  const mismatchedPrompt = await harness.broker.answerPrompt({ projectId: 'project-1', threadId, requestId: accepted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'other-prompt', behavior: 'allow' } }, 9)
  assert.equal(mismatchedPrompt.ok, false)
  assert.equal(mismatchedPrompt.error.code, 'invalid-argument')
  assert.equal(harness.runner.responses.length, 0)
  const unowned = await harness.broker.answerPrompt({ projectId: 'project-1', threadId, requestId: accepted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'prompt-1', behavior: 'allow' } }, 9)
  assert.equal(unowned.ok, false)
  assert.equal(unowned.error.code, 'prompt-not-owned')
  const owned = harness.broker.setPromptOwnerCandidates('prompt-1', [9, 7])
  assert.equal(owned.ownerWebContentsId, 9)
  const denied = await harness.broker.answerPrompt({ projectId: 'project-1', threadId, requestId: accepted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'prompt-1', behavior: 'allow' } }, 7)
  assert.equal(denied.ok, false)
  assert.equal(harness.broker.reassignPromptOwner('prompt-1', 9).ownerWebContentsId, 7)
  harness.runner.answerFails = true
  const responseFailure = await harness.broker.answerPrompt({ projectId: 'project-1', threadId, requestId: accepted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'prompt-1', behavior: 'allow' } }, 7)
  assert.deepEqual(responseFailure, { ok: false, error: { code: 'internal-error', message: 'Unable to answer the prompt.', retryable: false } })
  const waiting = await harness.broker.getSnapshot('project-1')
  assert.equal(waiting.value.pendingPrompts[0].ownerWebContentsId, 7)
  assert.equal(waiting.value.runs.find((run) => run.requestId === accepted.value.requestId).phase, 'waiting_permission')
  harness.runner.answerFails = false
  const answered = await harness.broker.answerPrompt({ projectId: 'project-1', threadId, requestId: accepted.value.requestId, promptId: 'prompt-1', routeGeneration: 1, response: { permissionRequestId: 'prompt-1', behavior: 'allow' } }, 7)
  assert.equal(answered.ok, true)
  assert.equal(harness.runner.responses.length, 1)
})

test('broker persists website source and submits only durable runner authority fields', async () => {
  let permissionReads = 0
  const durableThread = {
    id: 'thread-durable', projectId: 'project-1', title: 'Durable', createdAt: 1, updatedAt: 1,
    creationSource: { kind: 'user' },
    chatState: { model: 'Claude Agent', sessionId: 'session-durable', cwd: '/thread-must-not-win', modelPick: { providerId: 'durable-provider', anthropicModel: 'durable-model' }, items: [] },
  }
  const harness = makeHarness(workspace([durableThread]), { permissionMode: () => { permissionReads += 1; return 'plan' } })
  const website = await harness.broker.createThread({ projectId: 'project-1', title: 'From website', source: 'website', idempotencyKey: 'receipt-1', bindingId: 'binding-1', receivedAt: 55 })
  assert.equal(website.ok, true)
  assert.deepEqual(harness.state().threads[0].creationSource, { kind: 'website', bindingId: 'binding-1', receivedAt: 55 })
  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: durableThread.id, text: 'durable payload', attachments: [{ id: 'attachment', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 7, text: 'content' }], modelPick: { providerId: 'explicit-provider', anthropicModel: 'explicit-model' }, handoffContext: 'handoff' })
  assert.equal(submitted.ok, true)
  assert.deepEqual(harness.runner.submitted[0], {
    text: 'durable payload', attachments: [{ id: 'attachment', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 7, text: 'content', path: '' }], threadId: durableThread.id,
    modelPick: { providerId: 'explicit-provider', anthropicModel: 'explicit-model' }, handoffContext: 'handoff',
    sessionId: undefined, cwd: '/project', projectId: 'project-1', projectRuntimePrompt: false, permissionMode: 'plan',
  })
  assert.deepEqual(harness.runner.resets, [durableThread.id])
  assert.equal(permissionReads, 2, 'one create snapshot read plus one submit capture')
  harness.broker.advanceRouteGeneration('project-1')
  const fallback = await harness.broker.submitRun({ projectId: 'project-1', threadId: durableThread.id, text: 'fallback model' })
  assert.equal(fallback.ok, true)
  assert.deepEqual(harness.runner.submitted[1].modelPick, { providerId: 'explicit-provider', anthropicModel: 'explicit-model' })
  assert.equal(permissionReads, 3, 'each submit captures permission mode exactly once')
})

test('broker fences old generations while allowing a same-thread replacement run', async () => {
  const harness = makeHarness()
  const threadId = await createThread(harness, 'One')
  const oldRun = await harness.broker.submitRun({ projectId: 'project-1', threadId, text: 'old' })
  harness.broker.publish({ type: 'permission_request', requestId: oldRun.value.requestId, permissionRequestId: 'old-prompt', toolUseId: 'tool-1', toolName: 'Write', title: 'Write', displayName: 'Write', description: '', inputPreview: '{}' })
  await harness.broker.idle()
  const oldGeneration = harness.broker.advanceRouteGeneration('project-1') - 1
  const afterAdvance = await harness.broker.getSnapshot('project-1')
  assert.deepEqual(afterAdvance.value.runs, [])
  assert.deepEqual(afterAdvance.value.pendingPrompts, [])
  const replacement = await harness.broker.submitRun({ projectId: 'project-1', threadId, text: 'replacement' })
  assert.equal(replacement.ok, true)
  const staleCancel = await harness.broker.cancelRun({ projectId: 'project-1', threadId, requestId: oldRun.value.requestId, routeGeneration: oldGeneration })
  assert.equal(staleCancel.ok, false)
  assert.equal(staleCancel.error.code, 'stale-revision')
  harness.broker.publish({ type: 'assistant_delta', requestId: oldRun.value.requestId, messageId: 'old-message', text: 'ignored' })
  await harness.broker.idle()
  assert.equal(harness.state().threads.find((thread) => thread.id === threadId).chatState.items.some((item) => item.type === 'message' && item.content.includes('ignored')), false)
})

test('stale-generation prompts do not keep edit, archive, or model mutations busy', async () => {
  const base = () => ({ id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', modelPick: { providerId: 'p', anthropicModel: 'm' }, items: [{ type: 'message', id: 'user-1', role: 'user', content: 'old', status: 'done' }] } })
  for (const command of [
    (broker) => broker.editAndSubmitRun({ projectId: 'project-1', threadId: 'thread-1', messageId: 'user-1', text: 'new', routeGeneration: 2 }),
    (broker) => broker.archiveThread({ projectId: 'project-1', threadId: 'thread-1', routeGeneration: 2 }),
    (broker) => broker.setThreadModel({ projectId: 'project-1', threadId: 'thread-1', modelPick: { providerId: 'next', anthropicModel: 'next' }, routeGeneration: 2 }),
  ]) {
    const harness = makeHarness(workspace([base()]))
    const run = await harness.broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text: 'waiting' })
    harness.broker.publish({ type: 'permission_request', requestId: run.value.requestId, permissionRequestId: 'prompt', toolUseId: 'tool', toolName: 'Write', title: 'Write', displayName: 'Write', description: '', inputPreview: '{}' })
    await harness.broker.idle()
    harness.broker.advanceRouteGeneration('project-1')
    const result = await command(harness.broker)
    assert.equal(result.ok, true)
  }
})

test('thread mutations enforce durable ownership, allow archived forks, and fence stale routes', async () => {
  const orphan = { id: 'orphan', projectId: 'gone', title: 'Gone', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [{ type: 'message', id: 'user', role: 'user', content: 'x', status: 'done' }] } }
  const harness = makeHarness({ ...workspace([orphan]), projects: [] })
  const orphanCommands = [
    harness.broker.forkThread({ projectId: 'gone', threadId: 'orphan', messageId: 'user', routeGeneration: 1 }),
    harness.broker.archiveThread({ projectId: 'gone', threadId: 'orphan', routeGeneration: 1 }),
    harness.broker.setThreadPinned({ projectId: 'gone', threadId: 'orphan', pinned: true, routeGeneration: 1 }),
    harness.broker.setThreadModel({ projectId: 'gone', threadId: 'orphan', modelPick: { providerId: 'p', anthropicModel: 'm' }, routeGeneration: 1 }),
    harness.broker.markFileDiffReviewed({ projectId: 'gone', threadId: 'orphan', changeSetId: 'missing', routeGeneration: 1 }),
  ]
  for (const result of await Promise.all(orphanCommands)) assert.equal(result.error.code, 'project-not-found')

  const archived = { ...orphan, projectId: 'project-1', id: 'archived', archivedAt: 2 }
  const archivedHarness = makeHarness(workspace([archived]))
  const fork = await archivedHarness.broker.forkThread({ projectId: 'project-1', threadId: 'archived', messageId: 'user', routeGeneration: 1 })
  assert.equal(fork.ok, true)
  const forked = archivedHarness.state().threads.find((thread) => thread.id === fork.value.threadId)
  assert.equal(forked.title, archived.title)
  assert.deepEqual(forked.chatState.modelPick, undefined)
  assert.equal(forked.chatState.sessionId, undefined)
  assert.equal(forked.chatState.items.length, 1)
  assert.equal(archivedHarness.state().projects[0].updatedAt, forked.updatedAt)

  const revision = archivedHarness.state().workspaceRevision; const broadcasts = archivedHarness.broadcasts.length
  archivedHarness.broker.advanceRouteGeneration('project-1')
  for (const result of await Promise.all([
    archivedHarness.broker.forkThread({ projectId: 'project-1', threadId: 'archived', messageId: 'user', routeGeneration: 1 }),
    archivedHarness.broker.editAndSubmitRun({ projectId: 'project-1', threadId: 'archived', messageId: 'user', text: 'x', routeGeneration: 1 }),
    archivedHarness.broker.archiveThread({ projectId: 'project-1', threadId: 'archived', routeGeneration: 1 }),
    archivedHarness.broker.setThreadPinned({ projectId: 'project-1', threadId: 'archived', pinned: true, routeGeneration: 1 }),
    archivedHarness.broker.setThreadModel({ projectId: 'project-1', threadId: 'archived', modelPick: { providerId: 'x', anthropicModel: 'x' }, routeGeneration: 1 }),
    archivedHarness.broker.markFileDiffReviewed({ projectId: 'project-1', threadId: 'archived', changeSetId: 'x', routeGeneration: 1 }),
  ])) assert.equal(result.error.code, 'stale-revision')
  assert.equal(archivedHarness.state().workspaceRevision, revision)
  assert.equal(archivedHarness.broadcasts.length, broadcasts)
})

test('edit reset is atomic and submit failure retains only the edited transcript plus a visible failure', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', sessionId: 'old-session', modelPick: { providerId: 'p', anthropicModel: 'm' }, items: [{ type: 'message', id: 'user', role: 'user', content: 'before', status: 'done' }, { type: 'message', id: 'assistant', role: 'assistant', content: 'after', status: 'done' }] } }
  const harness = makeHarness(workspace([thread])); harness.runner.fail = true
  const failed = await harness.broker.editAndSubmitRun({ projectId: 'project-1', threadId: 'thread-1', messageId: 'user', text: ' after edit ', routeGeneration: 1 })
  assert.equal(failed.error.code, 'sdk-submit-failed')
  const messages = harness.state().threads[0].chatState.items.filter((item) => item.type === 'message')
  assert.deepEqual(messages.map((item) => item.content), ['after edit', 'Unable to submit the run.'])
  assert.equal(messages.filter((item) => item.role === 'user').length, 1)
  assert.equal(messages.at(-1).status, 'error')
  const atomic = makeHarness(workspace([thread])); atomic.runner.resetFails = true
  const revision = atomic.state().workspaceRevision
  const result = await atomic.broker.editAndSubmitRun({ projectId: 'project-1', threadId: 'thread-1', messageId: 'user', text: 'no save', routeGeneration: 1 })
  assert.equal(result.error.code, 'internal-error'); assert.equal(atomic.state().workspaceRevision, revision); assert.equal(atomic.runner.submitted.length, 0); assert.equal(atomic.broadcasts.length, 0)
})

test('model reset and explicit submit reset are atomic while same model is a true no-op', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', sessionId: 'old-session', modelPick: { providerId: 'p', anthropicModel: 'm' }, items: [] } }
  for (const command of [
    (broker) => broker.setThreadModel({ projectId: 'project-1', threadId: 'thread-1', modelPick: { providerId: 'next', anthropicModel: 'next' }, routeGeneration: 1 }),
    (broker) => broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text: 'submit', modelPick: { providerId: 'next', anthropicModel: 'next' } }),
  ]) {
    const harness = makeHarness(workspace([structuredClone(thread)])); harness.runner.resetFails = true
    const result = await command(harness.broker)
    assert.equal(result.error.code, 'internal-error'); assert.equal(harness.state().workspaceRevision, 0); assert.equal(harness.runner.submitted.length, 0); assert.equal(harness.broadcasts.length, 0)
  }
  const same = makeHarness(workspace([structuredClone(thread)]))
  const result = await same.broker.setThreadModel({ projectId: 'project-1', threadId: 'thread-1', modelPick: { providerId: 'p', anthropicModel: 'm' }, routeGeneration: 1 })
  assert.equal(result.ok, true); assert.equal(same.runner.resets.length, 0); assert.equal(same.state().workspaceRevision, 0); assert.equal(same.broadcasts.length, 0)
})

test('submit derives titles only for an untouched default thread', async () => {
  const makeThread = (title, items = []) => ({ id: 'thread-1', projectId: 'project-1', title, createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items } })
  for (const [title, text, expected] of [
    ['新对话', '中文标题', '中文标题'], ['New thread', '\n English title\nsecond', 'English title'],
    ['New thread', 'x'.repeat(34), 'x'.repeat(34)], ['New thread', 'y'.repeat(35), `${'y'.repeat(34)}...`],
  ]) {
    const harness = makeHarness(workspace([makeThread(title)])); await harness.broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text })
    assert.equal(harness.state().threads[0].title, expected)
  }
  const prior = makeHarness(workspace([makeThread('New thread', [{ type: 'message', id: 'old', role: 'user', content: 'old', status: 'done' }])]))
  await prior.broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text: 'new' }); assert.equal(prior.state().threads[0].title, 'New thread')
  const attachmentOnly = makeHarness(workspace([makeThread('New thread')]))
  await attachmentOnly.broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text: '', attachments: [{ id: 'a', kind: 'text', name: 'a.txt', mimeType: 'text/plain', size: 1, text: 'x' }] })
  assert.equal(attachmentOnly.state().threads[0].title, 'New thread')
})

test('concurrent thread mutations retain both updates and missing diff review is a no-op', async () => {
  const makeThread = (id) => ({ id, projectId: 'project-1', title: id, createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [] } })
  const harness = makeHarness(workspace([makeThread('one'), makeThread('two')]))
  await Promise.all([
    harness.broker.setThreadPinned({ projectId: 'project-1', threadId: 'one', pinned: true, routeGeneration: 1 }),
    harness.broker.setThreadPinned({ projectId: 'project-1', threadId: 'two', pinned: true, routeGeneration: 1 }),
  ])
  assert.equal(harness.state().workspaceRevision, 2)
  assert.ok(harness.state().threads.every((thread) => thread.pinnedAt !== undefined))
  const revision = harness.state().workspaceRevision; const broadcasts = harness.broadcasts.length
  const missing = await harness.broker.markFileDiffReviewed({ projectId: 'project-1', threadId: 'one', changeSetId: 'absent', routeGeneration: 1 })
  assert.equal(missing.error.code, 'invalid-argument'); assert.equal(harness.state().workspaceRevision, revision); assert.equal(harness.broadcasts.length, broadcasts)
})

test('broker queues snapshots behind saves, uses collision-resistant default ids, and rejects missing paths', async () => {
  const { ProjectChatBroker } = loadTsModule(resolve(testDir, './project-chat-broker.ts'))
  let state = workspace()
  let releaseSave
  let saveStarted
  const saveStartedPromise = new Promise((resolve) => { saveStarted = resolve })
  const delayedStore = {
    read: () => state,
    save: (next) => new Promise((resolve) => { saveStarted(); releaseSave = () => { state = next; resolve(next) } }),
  }
  const runner = { submit: () => ({ requestId: 'request-1' }), cancel: async () => {}, answerPermissionRequest: async () => {}, resetThread: async () => {}, rewindFiles: async () => ({ ok: true }) }
  const broker = new ProjectChatBroker({ store: delayedStore, runner, now: () => 100 })
  const creating = broker.createThread({ projectId: 'project-1', title: 'Delayed', source: 'user' })
  await saveStartedPromise
  const snapshot = broker.getSnapshot('project-1')
  let snapshotResolved = false
  void snapshot.then(() => { snapshotResolved = true })
  await Promise.resolve()
  assert.equal(snapshotResolved, false)
  releaseSave()
  await creating
  const afterSave = await snapshot
  assert.equal(afterSave.value.workspaceRevision, 1)
  assert.equal(afterSave.value.threads.length, 1)

  const ids = new Set()
  const idBroker = new ProjectChatBroker({ store: { read: () => state, save: async (next) => next }, runner, now: () => 100 })
  const first = await idBroker.createThread({ projectId: 'project-1', title: 'One', source: 'user' })
  const second = await idBroker.createThread({ projectId: 'project-1', title: 'Two', source: 'user' })
  ids.add(first.value.threadId)
  ids.add(second.value.threadId)
  assert.equal(ids.size, 2)

  const missingPath = workspace()
  missingPath.projects[0].pathMissing = true
  const missing = makeHarness(missingPath)
  const createRejected = await missing.broker.createThread({ projectId: 'project-1', title: 'No path', source: 'user' })
  assert.equal(createRejected.error.code, 'project-path-missing')
  const emptyPath = workspace([{ id: 'thread-1', projectId: 'project-1', title: 'One', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude Agent', items: [] } }])
  emptyPath.projects[0].path = ' '
  const empty = makeHarness(emptyPath)
  const submitRejected = await empty.broker.submitRun({ projectId: 'project-1', threadId: 'thread-1', text: 'No path' })
  assert.equal(submitRejected.error.code, 'project-path-missing')
})

test('broker maps accepted and terminal runs into the RuntimeEditCoordinator snapshot', async () => {
  const { RuntimeEditCoordinator } = loadTsModule(resolve(testDir, './runtime-edit-coordinator.ts'))
  const coordinator = new RuntimeEditCoordinator({ fingerprint: async () => 'fingerprint' })
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [] } }
  const harness = makeHarness(workspace([thread]), { runtimeEditCoordinator: coordinator })
  assert.equal(harness.runner.runtimeEditHook, coordinator)
  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'write it' })
  let snapshot = await harness.broker.getSnapshot('project-1')
  assert.equal(snapshot.value.runtimeEdit.potentialRunCount, 1)
  harness.runner.runtimeEditHook.beforeTool({ requestId: submitted.value.requestId, toolUseId: 'edit-1', toolName: 'Edit' })
  harness.runner.runtimeEditHook.afterTool({ requestId: submitted.value.requestId, toolUseId: 'edit-1', toolName: 'Edit', succeeded: true, hasProjectDiff: true })
  harness.broker.publish({ type: 'result', requestId: submitted.value.requestId, sessionId: 'session', result: 'done' })
  await harness.broker.idle()
  snapshot = await harness.broker.getSnapshot('project-1')
  assert.deepEqual(snapshot.value.runtimeEdit && {
    potentialRunCount: snapshot.value.runtimeEdit.potentialRunCount,
    activeAgentLeaseCount: snapshot.value.runtimeEdit.activeAgentLeaseCount,
    successfulMutationCount: snapshot.value.runtimeEdit.successfulMutationCount,
  }, { potentialRunCount: 0, activeAgentLeaseCount: 0, successfulMutationCount: 1 })

  const plan = makeHarness(workspace([structuredClone(thread)]), { runtimeEditCoordinator: new RuntimeEditCoordinator({ fingerprint: async () => 'fingerprint' }), permissionMode: () => 'plan' })
  await plan.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'plan only' })
  const plannedSnapshot = await plan.broker.getSnapshot('project-1')
  assert.equal(plannedSnapshot.value.runtimeEdit, undefined)
})

test('broker supplies the authoritative projectId alongside the project-root cwd', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [] } }
  const harness = makeHarness(workspace([thread]))
  const submitted = await harness.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'create a Runtime page' })
  assert.equal(submitted.ok, true)
  assert.equal(harness.runner.submitted[0].projectId, 'project-1')
  assert.equal(harness.runner.submitted[0].cwd, '/project')
})

test('broker emits the Runtime prompt flag only from Main-derived run context', async () => {
  const thread = { id: 'thread-1', projectId: 'project-1', title: 'Thread', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', items: [{ type: 'message', id: 'user-1', role: 'user', content: 'old', status: 'done' }] } }
  const harness = makeHarness(workspace([thread]))
  const ordinary = await harness.broker.submitRun({ projectId: 'project-1', threadId: thread.id, text: 'ordinary' })
  assert.equal(ordinary.ok, true)
  assert.equal(harness.runner.submitted[0].projectRuntimePrompt, false)
  harness.broker.publish({ type: 'result', requestId: ordinary.value.requestId, sessionId: 'ordinary-session', result: 'done' })
  await harness.broker.idle()

  const edited = await harness.broker.editAndSubmitRun({ projectId: 'project-1', threadId: thread.id, messageId: 'user-1', text: 'runtime edit', routeGeneration: 1 }, { projectRuntimePrompt: true })
  assert.equal(edited.ok, true)
  assert.equal(harness.runner.submitted[1].projectRuntimePrompt, true)

  const managed = makeHarness()
  assert.equal((await managed.broker.ensureManagedThread({ projectId: 'project-1', threadId: 'managed-1', title: 'Managed', purpose: 'task-run', homePluginSlug: 'home' })).ok, true)
  assert.equal((await managed.broker.submitManagedRun({ projectId: 'project-1', threadId: 'managed-1', title: 'Managed', purpose: 'task-run', homePluginSlug: 'home', text: 'managed', promptMode: 'home-plugin-task-run', agentModeSettingsOverride: { enabled: true, todoEnabled: true } })).ok, true)
  assert.equal(managed.runner.submitted[0].projectRuntimePrompt, undefined)
})

test('ephemeral runtime-edit rebroadcast fresh-reads without saving or advancing workspace revision', () => {
  const { RuntimeEditCoordinator } = loadTsModule(resolve(testDir, './runtime-edit-coordinator.ts'))
  let saves = 0
  const initial = workspace()
  const coordinator = new RuntimeEditCoordinator({ fingerprint: async () => 'same' })
  const harness = makeHarness(initial, { runtimeEditCoordinator: coordinator, store: { read: () => initial, save: async (next) => { saves += 1; return next } } })
  coordinator.registerAcceptedRun({ projectId: 'project-1', requestId: 'request-1', permissionMode: 'auto' })
  harness.broker.broadcastProjectSnapshot('project-1')
  assert.equal(saves, 0)
  assert.equal(harness.broadcasts.at(-1).workspaceRevision, 0)
  assert.equal(harness.broadcasts.at(-1).snapshot.runtimeEdit.potentialRunCount, 1)
})
