import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath,
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

function loadIpc() { return loadTsModule(resolve(testDir, './project-chat-ipc.ts')) }

function loadPreloadProfile(argv) {
  const exposed = []
  const electron = {
    contextBridge: { exposeInMainWorld: (name) => exposed.push(name) },
    ipcRenderer: { invoke: () => Promise.resolve(), on: () => {}, off: () => {} },
  }
  const cache = new Map()
  const load = (modulePath) => {
    const resolvedPath = resolve(modulePath)
    const cached = cache.get(resolvedPath)
    if (cached) return cached.exports
    const { outputText } = ts.transpileModule(readFileSync(resolvedPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath,
    })
    const module = { exports: {} }
    cache.set(resolvedPath, module)
    const localRequire = (specifier) => {
      if (specifier === 'electron') return electron
      if (specifier.startsWith('.')) {
        const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
        if (existsSync(candidate)) return load(candidate)
      }
      return require(specifier)
    }
    Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
    return module.exports
  }
  const originalArgv = process.argv
  try {
    process.argv = argv
    const exports = load(resolve(testDir, './preload.ts'))
    return { exposed, exports }
  } finally { process.argv = originalArgv }
}

function event(webContentsId, url = 'http://renderer.test/index.html?project=ignored#hash', subframe = false) {
  const mainFrame = { url }
  return { sender: { id: webContentsId, mainFrame }, senderFrame: subframe ? { url } : mainFrame }
}

function ok(value) { return { ok: true, value } }

function makeBroker(overrides = {}) {
  const broker = {
    calls: [],
    routeGenerationOf: (projectId) => projectId === 'project-1' ? 3 : 1,
    getSnapshot: async (projectId) => ok({
      projectId,
      project: { id: projectId, name: 'Project', pathMissing: false },
      workspaceRevision: 1,
      sequence: 4,
      routeGeneration: broker.routeGenerationOf(projectId),
      threads: [],
      runs: [],
      pendingPrompts: [],
      permissionMode: 'auto',
      unreadExternalTaskCount: 0,
    }),
    createThread: async (input) => { broker.calls.push(['create', input]); return ok({ threadId: input.title, workspaceRevision: 1 }) },
    submitRun: async (input) => { broker.calls.push(['submit', input]); return ok({ requestId: 'request-1' }) },
    forkThread: async (input) => { broker.calls.push(['fork', input]); return ok({ threadId: 'fork-1', workspaceRevision: 1 }) },
    editAndSubmitRun: async (input) => { broker.calls.push(['edit', input]); return ok({ requestId: 'request-2' }) },
    archiveThread: async (input) => { broker.calls.push(['archive', input]); return ok(undefined) },
    setThreadPinned: async (input) => { broker.calls.push(['pin', input]); return ok(undefined) },
    setThreadModel: async (input) => { broker.calls.push(['model', input]); return ok(undefined) },
    markFileDiffReviewed: async (input) => { broker.calls.push(['review', input]); return ok(undefined) },
    rewindFileDiff: async (input) => { broker.calls.push(['rewind', input]); return ok({ changeSetId: input.changeSetId, status: 'reverted' }) },
    cancelRun: async (input) => ok(undefined),
    answerPrompt: async (input, ownerWebContentsId) => { broker.calls.push(['answer', input, ownerWebContentsId]); return ok(undefined) },
    broadcastAllSnapshots: async (mode) => { broker.calls.push(['broadcast', mode]) },
    refreshExternalUnread: async (projectId, seenAt) => { broker.calls.push(['external-seen', projectId, seenAt]) },
    refreshPromptOwners: async () => {}, onWebContentsUnavailable: async () => {},
    ...overrides,
  }
  return broker
}

function makeHarness({ broker: suppliedBroker, capabilities: suppliedCapabilities, permissionService: suppliedPermissionService, scopedRead, presence, collaborator } = {}) {
  const { RendererCapabilityRegistry, ProjectChatPermissionService, createProjectChatIpcRouter } = loadIpc()
  const capabilities = suppliedCapabilities ?? new RendererCapabilityRegistry()
  const broker = suppliedBroker ?? makeBroker()
  const saved = []
  const permissionService = suppliedPermissionService ?? new ProjectChatPermissionService({
    readChatPermissionModeState: () => ({ kind: 'missing' }),
    save: (partial) => { saved.push(partial); return { closeToTray: false, openAtLogin: false, eyeComfortMode: false, ...partial } },
  })
  const router = createProjectChatIpcRouter({ broker, capabilities, rendererEntries: ['http://renderer.test/index.html'], permissionService, scopedRead, presence, collaborator })
  return { router, capabilities, broker, saved }
}

test('openProjectPreview is a fixed-project capability with zero collaborator calls for invalid senders', async () => {
  const calls = []
  const harness = makeHarness({ collaborator: { openProjectPreview: async (projectId) => { calls.push(projectId); return ok(undefined) } } })
  harness.capabilities.registerMainWindow(1)
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  harness.capabilities.registerProjectWindow(8, 'project-1', 2)
  for (const [sender, projectId] of [[event(99), 'project-1'], [event(1, 'http://renderer.test/index.html', true), 'project-1'], [event(1, 'http://renderer.test/other.html'), 'project-1'], [event(7), 'project-2'], [event(8), 'project-1']]) {
    const result = await harness.router.openProjectPreview(sender, projectId)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'sender-not-authorized')
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(await harness.router.openProjectPreview(event(7), 'project-1'), ok(undefined))
  assert.deepEqual(calls, ['project-1'])
})

test('Workspace Tab Chat is main-window-only and forwards only its opaque tab id', async () => {
  const calls = []
  const harness = makeHarness({ collaborator: { openWorkspaceTabProjectChat: async (tabId) => { calls.push(tabId); return ok(undefined) } } })
  harness.capabilities.registerMainWindow(1)
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  for (const sender of [event(99), event(1, 'http://renderer.test/index.html', true), event(1, 'http://renderer.test/other.html'), event(7)]) {
    const result = await harness.router.openWorkspaceTabProjectChat(sender, 'tab-home')
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'sender-not-authorized')
  }
  assert.deepEqual(calls, [])
  assert.equal((await harness.router.openWorkspaceTabProjectChat(event(1), 'tab-home')).ok, true)
  assert.deepEqual(calls, ['tab-home'])
  const invalid = await harness.router.openWorkspaceTabProjectChat(event(1), { workspaceTabId: 'tab-home', projectId: 'forged', path: '/forged' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'invalid-argument')
  assert.deepEqual(calls, ['tab-home'])
})

test('Project Chat IPC rejects unknown, subframe, wrong document, wrong project, and stale capability generation', async () => {
  const harness = makeHarness()
  harness.capabilities.registerMainWindow(1)
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  harness.capabilities.registerProjectWindow(8, 'project-1', 2)

  for (const input of [
    [event(99), 'project-1'],
    [event(1, 'http://renderer.test/index.html', true), 'project-1'],
    [event(1, 'http://renderer.test/other.html'), 'project-1'],
    [event(7), 'project-2'],
    [event(8), 'project-1'],
  ]) {
    const result = await harness.router.getSnapshot(input[0], input[1])
    assert.deepEqual(result, { ok: false, error: { code: 'sender-not-authorized', message: 'Sender is not authorized.', retryable: false } })
  }

  const queryCannotChangeProject = await harness.router.getSnapshot(event(7, 'http://renderer.test/index.html?project=project-2#anything'), 'project-2')
  assert.equal(queryCannotChangeProject.error.code, 'sender-not-authorized')
  assert.equal((await harness.router.getSnapshot(event(7), 'project-1')).ok, true)
  assert.equal(harness.capabilities.get(99), undefined, 'Preview or unknown contents never has a Chat capability')
})

test('A Preview sender is denied by every project-chat invoke channel', async () => {
  const harness = makeHarness()
  const previewSender = event(99, 'http://127.0.0.1:3001/')
  for (const [channel, handler] of Object.entries(harness.router.handlers)) {
    const result = await handler(previewSender, { projectId: 'project-1' })
    assert.equal(result.ok, false, channel)
    assert.equal(result.error.code, 'sender-not-authorized', channel)
  }
  assert.deepEqual(harness.broker.calls, [])
})

test('Project Chat IPC whitelists broker inputs and passes the authorized owner id', async () => {
  const harness = makeHarness()
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const websiteAttempt = await harness.router.createThread(event(7), {
    projectId: 'project-1', title: 'Forged website thread', source: 'website', bindingId: 'forged', receivedAt: 1, idempotencyKey: 'forged',
  })
  assert.equal(websiteAttempt.ok, false)
  assert.equal(websiteAttempt.error.code, 'sender-not-authorized')
  assert.equal(harness.broker.calls.filter(([name]) => name === 'create').length, 0, 'renderer website input never reaches the broker')
  const submitted = await harness.router.submitRun(event(7), {
    projectId: 'project-1', threadId: 'thread-1', text: 'hello',
    modelPick: { providerId: 'provider', anthropicModel: 'model' }, handoffContext: 'handoff',
    cwd: '/attacker', sessionId: 'attacker-session', permissionMode: 'bypassPermissions', unexpected: true,
  })
  assert.equal(submitted.ok, true)
  assert.deepEqual(harness.broker.calls[0], ['submit', {
    projectId: 'project-1', threadId: 'thread-1', text: 'hello', attachments: undefined,
    modelPick: { providerId: 'provider', anthropicModel: 'model' }, handoffContext: 'handoff',
  }])

  const answered = await harness.router.answerPrompt(event(7), {
    projectId: 'project-1', threadId: 'thread-1', requestId: 'request-1', promptId: 'prompt-1', routeGeneration: 3,
    response: { permissionRequestId: 'prompt-1', behavior: 'allow' }, ownerWebContentsId: 99,
  })
  assert.equal(answered.ok, true)
  assert.equal(harness.broker.calls[1][2], 7)
  const mismatched = await harness.router.answerPrompt(event(7), {
    projectId: 'project-1', threadId: 'thread-1', requestId: 'request-1', promptId: 'prompt-1', routeGeneration: 3,
    response: { permissionRequestId: 'other-prompt', behavior: 'allow' },
  })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.error.code, 'invalid-argument')
  assert.equal(harness.broker.calls.filter(([name]) => name === 'answer').length, 1, 'mismatched prompt response never reaches the runner seam')
})

test('Project Chat IPC binds presence and rewind to the authorized capability and frozen DTOs', async () => {
  const reports = []
  const harness = makeHarness({ presence: { reportSelection: (webContentsId, input) => { reports.push([webContentsId, input]); return ok(undefined) } } })
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  harness.capabilities.registerProjectWindow(8, 'project-1', 2)
  const selected = await harness.router.reportPresenceSelection(event(7), { projectId: 'project-1', selectedThreadId: 'thread-1' })
  assert.equal(selected.ok, true); assert.deepEqual(reports, [[7, { projectId: 'project-1', selectedThreadId: 'thread-1' }]])
  const forgedPresence = await harness.router.reportPresenceSelection(event(7), { projectId: 'project-1', selectedThreadId: 'thread-1', visible: true, focused: true, webContentsId: 99, kind: 'main-window', routeGeneration: 99 })
  assert.equal(forgedPresence.error.code, 'invalid-argument')
  const wrongPresence = await harness.router.reportPresenceSelection(event(7), { projectId: 'project-2', visible: true })
  assert.equal(wrongPresence.error.code, 'sender-not-authorized')
  const stalePresence = await harness.router.reportPresenceSelection(event(8), { projectId: 'project-1', selectedThreadId: 'thread-1' })
  assert.equal(stalePresence.error.code, 'sender-not-authorized')

  for (const denied of [event(99), event(7, 'http://renderer.test/index.html', true), event(7, 'http://renderer.test/other.html')]) {
    const result = await harness.router.rewindFileDiff(denied, { projectId: 'project-1', threadId: 'thread-1', changeSetId: 'change-1', routeGeneration: 3 })
    assert.equal(result.error.code, 'sender-not-authorized')
  }
  const stale = await harness.router.rewindFileDiff(event(7), { projectId: 'project-1', threadId: 'thread-1', changeSetId: 'change-1', routeGeneration: 2 })
  assert.equal(stale.error.code, 'sender-not-authorized')
  const forgedRewind = await harness.router.rewindFileDiff(event(7), { projectId: 'project-1', threadId: 'thread-1', changeSetId: 'change-1', routeGeneration: 3, requestId: 'forged', checkpointId: 'forged', cwd: '/forged', sessionId: 'forged', modelPick: { providerId: 'x', anthropicModel: 'x' } })
  assert.equal(forgedRewind.error.code, 'invalid-argument')
  assert.equal(harness.broker.calls.filter(([name]) => name === 'rewind').length, 0)
  const rewound = await harness.router.rewindFileDiff(event(7), { projectId: 'project-1', threadId: 'thread-1', changeSetId: 'change-1', routeGeneration: 3 })
  assert.equal(rewound.ok, true)
  assert.deepEqual(harness.broker.calls.at(-1), ['rewind', { projectId: 'project-1', threadId: 'thread-1', changeSetId: 'change-1', routeGeneration: 3 }])
})

test('Project Chat permission initialization persists once, normalizes invalid state, and broadcasts without a workspace mutation', async () => {
  const { DesktopPreferencesStore } = loadTsModule(resolve(testDir, './desktop-preferences-store.ts'))
  const { ProjectChatPermissionService } = loadIpc()
  const userData = await mkdtemp(join(tmpdir(), 'agentos-project-chat-permission-'))
  try {
    const store = new DesktopPreferencesStore(userData)
    const harness = makeHarness({ permissionService: new ProjectChatPermissionService(store) })
    harness.capabilities.registerMainWindow(1)
    harness.capabilities.registerProjectWindow(7, 'project-1', 3)

    const initialized = await harness.router.initializePermissionMode(event(1), 'plan')
    assert.deepEqual(initialized, ok('plan'))
    assert.equal(store.read().chatPermissionMode, 'plan')
    assert.deepEqual(harness.broker.calls, [['broadcast', 'plan']])

    const repeated = await harness.router.initializePermissionMode(event(1), 'bypassPermissions')
    assert.deepEqual(repeated, ok('plan'))
    assert.deepEqual(harness.broker.calls, [['broadcast', 'plan']], 'legacy cannot overwrite a durable mode')

    const projectWindow = await harness.router.initializePermissionMode(event(7), 'auto')
    assert.equal(projectWindow.error.code, 'sender-not-authorized')
    harness.capabilities.unregister(1)
    const oldMain = await harness.router.initializePermissionMode(event(1), 'auto')
    assert.equal(oldMain.error.code, 'sender-not-authorized')

    writeFileSync(join(userData, 'desktop-preferences.json'), JSON.stringify({ chatPermissionMode: 'not-a-mode' }))
    const repairedService = new ProjectChatPermissionService(new DesktopPreferencesStore(userData))
    const repaired = repairedService.initialize('plan')
    assert.deepEqual(repaired, { mode: 'auto', persisted: true })
    assert.equal(new DesktopPreferencesStore(userData).read().chatPermissionMode, 'auto')
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('Project Chat permission updates route identical snapshots only to eligible capabilities', async () => {
  const { RendererCapabilityRegistry, ProjectChatPermissionService, createProjectChatCapabilityBroadcaster } = loadIpc()
  const capabilities = new RendererCapabilityRegistry()
  capabilities.registerMainWindow(1)
  capabilities.registerProjectWindow(7, 'project-1', 3)
  capabilities.registerProjectWindow(8, 'project-1', 2)
  capabilities.registerProjectWindow(9, 'project-2', 1)
  const delivered = []
  const publish = createProjectChatCapabilityBroadcaster(capabilities, (webContentsId, event) => delivered.push([webContentsId, event]))
  const broker = makeBroker({
    broadcastAllSnapshots: async (mode) => publish({
      type: 'snapshot', projectId: 'project-1', sequence: 4, routeGeneration: 3, workspaceRevision: 12,
      snapshot: {
        projectId: 'project-1', project: { id: 'project-1', name: 'Project', pathMissing: false }, workspaceRevision: 12,
        sequence: 4, routeGeneration: 3, threads: [], runs: [], pendingPrompts: [], permissionMode: mode, unreadExternalTaskCount: 0,
      },
    }),
  })
  const harness = makeHarness({ broker, capabilities, permissionService: new ProjectChatPermissionService({ readChatPermissionModeState: () => ({ kind: 'valid', value: 'auto' }), save: () => ({}) }) })
  const changed = await harness.router.setPermissionMode(event(7), 'acceptEdits')
  assert.deepEqual(changed, ok('acceptEdits'))
  assert.deepEqual(delivered.map(([id, item]) => [id, item.snapshot.permissionMode]), [[1, 'acceptEdits'], [7, 'acceptEdits']])
  assert.equal(delivered[0][1].workspaceRevision, 12, 'permission broadcast does not advance workspace revision')
  const stale = await harness.router.setPermissionMode(event(8), 'plan')
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'sender-not-authorized')
})

test('Project Chat ownership projection is recipient-specific and never serializes owner identities', async () => {
  const { RendererCapabilityRegistry, ProjectChatPermissionService, createProjectChatCapabilityBroadcaster, createProjectChatIpcRouter } = loadIpc()
  const capabilities = new RendererCapabilityRegistry()
  capabilities.registerMainWindow(1)
  capabilities.registerProjectWindow(7, 'project-1', 3)
  const rawSnapshot = {
    projectId: 'project-1', project: { id: 'project-1', name: 'Project', pathMissing: false }, workspaceRevision: 12,
    sequence: 4, routeGeneration: 3, threads: [], runs: [], permissionMode: 'auto', unreadExternalTaskCount: 0,
    pendingPrompts: [{
      projectId: 'project-1', threadId: 'thread-1', requestId: 'request-1', promptId: 'prompt-1', kind: 'permission', createdAt: 1,
      ownerWebContentsId: 7,
      payload: { kind: 'permission', permissionRequestId: 'prompt-1', toolUseId: 'tool-1', toolName: 'Bash', title: 'Permission', displayName: 'Bash', description: 'Run command', inputPreview: 'pwd' },
    }],
  }
  const broker = makeBroker({ getSnapshot: async () => ok(rawSnapshot) })
  const router = createProjectChatIpcRouter({
    broker, capabilities, rendererEntries: ['http://renderer.test/index.html'],
    permissionService: new ProjectChatPermissionService({ readChatPermissionModeState: () => ({ kind: 'valid', value: 'auto' }), save: () => ({}) }),
  })
  const owner = await router.getSnapshot(event(7), 'project-1')
  const observer = await router.getSnapshot(event(1), 'project-1')
  assert.equal(owner.value.pendingPrompts[0].isOwnedByCaller, true)
  assert.equal(observer.value.pendingPrompts[0].isOwnedByCaller, false)
  assert.equal(JSON.stringify(owner.value).includes('ownerWebContentsId'), false)
  assert.equal(JSON.stringify(observer.value).includes('ownerWebContentsId'), false)

  const delivered = []
  const broadcast = createProjectChatCapabilityBroadcaster(capabilities, (webContentsId, item) => delivered.push([webContentsId, item]))
  broadcast({ type: 'snapshot', projectId: 'project-1', sequence: 4, routeGeneration: 3, workspaceRevision: 12, snapshot: rawSnapshot })
  assert.deepEqual(delivered.map(([id, item]) => [id, item.snapshot.pendingPrompts[0].isOwnedByCaller]), [[1, false], [7, true]])
  assert.equal(delivered.every(([, item]) => !JSON.stringify(item).includes('ownerWebContentsId')), true)
})

test('unimplemented collaborators and thrown broker operations resolve to redacted errors', async () => {
  const harness = makeHarness({ broker: makeBroker({ getSnapshot: async () => { throw new Error('/private/secret prompt') } }) })
  harness.capabilities.registerMainWindow(1)
  const unavailable = await harness.router.openProjectWindow(event(1), 'project-1')
  assert.deepEqual(unavailable, { ok: false, error: { code: 'internal-error', message: 'Project Chat operation is unavailable.', retryable: false } })
  const thrown = await harness.router.getSnapshot(event(1), 'project-1')
  assert.deepEqual(thrown, { ok: false, error: { code: 'internal-error', message: 'Project Chat is temporarily unavailable.', retryable: false } })
  const scoped = makeHarness({ scopedRead: { getAgentContext: async () => { throw new Error('/private/secret') } } })
  scoped.capabilities.registerProjectWindow(7, 'project-1', 3)
  const missing = await scoped.router.getModelCatalog(event(7))
  assert.deepEqual(missing, { ok: false, error: { code: 'internal-error', message: 'Project Chat operation is unavailable.', retryable: false } })
  const scopedThrow = await scoped.router.getAgentContext(event(7), 'project-1')
  assert.deepEqual(scopedThrow, { ok: false, error: { code: 'internal-error', message: 'Project Chat is temporarily unavailable.', retryable: false } })
})

test('Website Binding management is available only to the registered main window', async () => {
  const { RendererCapabilityRegistry, ProjectChatPermissionService, createProjectChatIpcRouter } = loadIpc()
  const capabilities = new RendererCapabilityRegistry()
  capabilities.registerMainWindow(1)
  capabilities.registerProjectWindow(7, 'project-1', 3)
  capabilities.registerProjectWindow(8, 'project-1', 2)
  const collaboratorCalls = []
  const router = createProjectChatIpcRouter({
    broker: makeBroker(), capabilities, rendererEntries: ['http://renderer.test/index.html'],
    permissionService: new ProjectChatPermissionService({ readChatPermissionModeState: () => ({ kind: 'missing' }), save: () => ({}) }),
    collaborator: {
      listWebsiteBindings: async () => { collaboratorCalls.push('list'); return ok([]) },
      revokeWebsiteBinding: async (bindingId) => { collaboratorCalls.push(['revoke', bindingId]); return ok(undefined) },
      respondToWebsitePairing: async (input) => { collaboratorCalls.push(['pair', input.pairingId]); return ok(undefined) },
    },
  })

  assert.deepEqual(await router.listWebsiteBindings(event(1)), ok([]))
  assert.deepEqual(await router.revokeWebsiteBinding(event(1), 'binding-1'), ok(undefined))
  assert.deepEqual(await router.respondToWebsitePairing(event(1), { pairingId: 'pair-1', action: 'reject' }), ok(undefined))
  for (const denied of [
    router.listWebsiteBindings(event(7)),
    router.revokeWebsiteBinding(event(7), 'binding-2'),
    router.listWebsiteBindings(event(8)),
    router.revokeWebsiteBinding(event(99), 'binding-3'),
    router.respondToWebsitePairing(event(7), { pairingId: 'pair-1', action: 'reject' }),
  ]) {
    const result = await denied
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'sender-not-authorized')
  }
  assert.deepEqual(collaboratorCalls, ['list', ['revoke', 'binding-1'], ['pair', 'pair-1']])
})

test('Project Chat channels and preload adapter remain exhaustive and centralized', () => {
  const { PROJECT_CHAT_EVENT_CHANNELS, PROJECT_CHAT_INVOKE_CHANNELS } = loadTsModule(resolve(testDir, '../src/project-chat-ipc-seam.ts'))
  assert.deepEqual(Object.keys(PROJECT_CHAT_INVOKE_CHANNELS), [
    'getSnapshot', 'createThread', 'submitRun', 'forkThread', 'editAndSubmitRun', 'archiveThread', 'setThreadPinned', 'setThreadModel', 'markFileDiffReviewed', 'rewindFileDiff', 'cancelRun', 'answerPrompt', 'reportPresenceSelection', 'openProjectWindow', 'openWorkspaceTabProjectChat', 'openProjectPreview', 'openProjectPathRecovery', 'getWindowViewState', 'saveWindowViewState', 'markExternalTasksSeen', 'listWebsiteBindings', 'revokeWebsiteBinding', 'respondToWebsitePairing', 'initializePermissionMode', 'setPermissionMode', 'getModelCatalog', 'getAgentContext', 'searchProjectFiles', 'pickAttachments', 'readProjectAttachments', 'getThreadStatus',
  ])
  assert.deepEqual(Object.keys(PROJECT_CHAT_EVENT_CHANNELS), ['onEvent'])
  const preload = readFileSync(resolve(testDir, './preload.ts'), 'utf8')
  const environment = readFileSync(resolve(testDir, './electron-env.d.ts'), 'utf8')
  for (const key of Object.keys(PROJECT_CHAT_INVOKE_CHANNELS)) assert.match(preload, new RegExp(`PROJECT_CHAT_INVOKE_CHANNELS\\.${key}\\b`))
  assert.match(preload, /PROJECT_CHAT_EVENT_CHANNELS\.onEvent/)
  assert.match(preload, /exposeInMainWorld\('projectChat', projectChatAdapter\)/)
  assert.match(environment, /projectChat\?: ProjectChatAPI/)
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(['"]project-chat:/)
})

test('external unread cursor is project-scoped, validated, and does not persist workspace state', async () => {
  const { router, broker, capabilities } = makeHarness(); capabilities.registerProjectWindow(7, 'project-1', 3)
  assert.deepEqual(await router.markExternalTasksSeen(event(7), 'project-1', 42), ok(undefined))
  assert.deepEqual(broker.calls.at(-1), ['external-seen', 'project-1', 42])
  for (const pending of [router.markExternalTasksSeen(event(7), 'project-2', 42), router.markExternalTasksSeen(event(1, 'http://renderer.test/index.html', true), 'project-1', 42), router.markExternalTasksSeen(event(1), 'project-1', '42')]) {
    const result = await pending; assert.equal(result.ok, false)
  }
})

test('path recovery is limited to the fixed project window capability', async () => {
  const calls = []; const { router, capabilities } = makeHarness({ collaborator: { openProjectPathRecovery: async (projectId) => { calls.push(projectId); return ok(undefined) } } }); capabilities.registerProjectWindow(7, 'project-1', 3)
  assert.deepEqual(await router.openProjectPathRecovery(event(7), 'project-1'), ok(undefined)); assert.deepEqual(calls, ['project-1'])
  for (const pending of [router.openProjectPathRecovery(event(7), 'project-2'), router.openProjectPathRecovery(event(7, 'http://renderer.test/index.html', true), 'project-1'), router.openProjectPathRecovery(event(99), 'project-1')]) {
    const result = await pending; assert.equal(result.ok, false); assert.equal(result.error.code, 'sender-not-authorized')
  }
  assert.deepEqual(calls, ['project-1'])
})

test('preload profile is controlled only by the exact Main additionalArgument', () => {
  const main = loadPreloadProfile(['electron', 'app'])
  assert.deepEqual(main.exposed, ['desktop', 'claudeChat', 'projectChat'])
  const project = loadPreloadProfile(['electron', 'app', '--agentos-window-kind=project-chat'])
  assert.deepEqual(project.exposed, ['projectChat'])
  assert.equal(project.exports.isProjectChatWindowProfile(['app', '--agentos-window-kind=project-chat?query']), false)
  assert.equal(project.exports.isProjectChatWindowProfile(['app', 'https://renderer.test/?window-kind=project-chat#x']), false)
})

test('scoped read capabilities authorize every method and project windows retain their fixed project', async () => {
  const harness = makeHarness({ scopedRead: {
    getModelCatalog: async () => ({ activeProviderId: 'p', activeAnthropicModel: 'm', providers: [] }),
    getAgentContext: async () => ({ skills: [], agents: [] }), searchProjectFiles: async () => [],
    pickAttachments: async () => ({ attachments: [], skipped: [] }), readProjectAttachments: async () => ({ attachments: [], skipped: [] }),
    getThreadStatus: async () => ({ threadId: 't', active: false, reportedModel: 'm', permissionMode: 'auto', tools: [], skills: [], slashCommands: [], agents: [] }),
  } })
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  harness.capabilities.registerProjectWindow(8, 'project-1', 2)
  const operations = [
    () => harness.router.getModelCatalog(event(99)),
    () => harness.router.getAgentContext(event(7), 'project-2'),
    () => harness.router.searchProjectFiles(event(7), { projectId: 'project-2', query: 'x' }),
    () => harness.router.pickAttachments(event(8), {}),
    () => harness.router.readProjectAttachments(event(7), { projectId: 'project-2', relativePaths: ['a.md'] }),
    () => harness.router.getThreadStatus(event(7, 'http://renderer.test/other.html'), { projectId: 'project-1', threadId: 't' }),
    () => harness.router.getAgentContext(event(7, undefined, true), 'project-1'),
  ]
  for (const operation of operations) {
    const result = await operation()
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'sender-not-authorized')
  }
})

test('thread mutation router prioritizes wrong-project authorization over malformed fields', async () => {
  const harness = makeHarness()
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  for (const invoke of [
    () => harness.router.forkThread(event(7), { projectId: 'project-2', threadId: '', messageId: '', routeGeneration: 3 }),
    () => harness.router.editAndSubmitRun(event(7), { projectId: 'project-2', threadId: '', messageId: '', text: 1, routeGeneration: 3 }),
    () => harness.router.archiveThread(event(7), { projectId: 'project-2', threadId: '', routeGeneration: 3 }),
    () => harness.router.setThreadPinned(event(7), { projectId: 'project-2', threadId: '', pinned: 'yes', routeGeneration: 3 }),
    () => harness.router.setThreadModel(event(7), { projectId: 'project-2', threadId: '', modelPick: {}, routeGeneration: 3 }),
    () => harness.router.markFileDiffReviewed(event(7), { projectId: 'project-2', threadId: '', changeSetId: '', routeGeneration: 3 }),
  ]) {
    const result = await invoke()
    assert.equal(result.error.code, 'sender-not-authorized')
  }
  assert.equal(harness.broker.calls.length, 0)
})

test('each thread mutation rejects every invalid renderer capability before calling the broker', async () => {
  const commands = [
    ['forkThread', { projectId: 'project-1', threadId: 'thread', messageId: 'message', routeGeneration: 3 }],
    ['editAndSubmitRun', { projectId: 'project-1', threadId: 'thread', messageId: 'message', text: 'edit', routeGeneration: 3 }],
    ['archiveThread', { projectId: 'project-1', threadId: 'thread', routeGeneration: 3 }],
    ['setThreadPinned', { projectId: 'project-1', threadId: 'thread', pinned: true, routeGeneration: 3 }],
    ['setThreadModel', { projectId: 'project-1', threadId: 'thread', modelPick: { providerId: 'p', anthropicModel: 'm' }, routeGeneration: 3 }],
    ['markFileDiffReviewed', { projectId: 'project-1', threadId: 'thread', changeSetId: 'change', routeGeneration: 3 }],
  ]
  for (const [name, raw] of commands) {
    for (const [sender, payload] of [
      [event(99), raw],
      [event(7, 'http://renderer.test/index.html', true), raw],
      [event(7, 'http://renderer.test/other.html'), raw],
      [event(7), { ...raw, projectId: 'other-project' }],
      [event(8), raw],
    ]) {
      const harness = makeHarness(); harness.capabilities.registerProjectWindow(7, 'project-1', 3); harness.capabilities.registerProjectWindow(8, 'project-1', 2)
      const result = await harness.router[name](sender, payload)
      assert.equal(result.error.code, 'sender-not-authorized', name)
      assert.equal(harness.broker.calls.length, 0, name)
    }
  }
})

test('thread mutation router drops forged durable thread fields and forwards only frozen DTOs', async () => {
  const harness = makeHarness(); harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const forged = { items: [{ content: 'secret' }], title: 'attacker', sessionId: 'session', cwd: '/private', path: '/private', chatState: { sessionId: 'x' } }
  await harness.router.forkThread(event(7), { projectId: 'project-1', threadId: 'thread', messageId: 'message', routeGeneration: 3, ...forged })
  await harness.router.editAndSubmitRun(event(7), { projectId: 'project-1', threadId: 'thread', messageId: 'message', text: 'edit', routeGeneration: 3, ...forged })
  await harness.router.archiveThread(event(7), { projectId: 'project-1', threadId: 'thread', routeGeneration: 3, ...forged })
  await harness.router.setThreadPinned(event(7), { projectId: 'project-1', threadId: 'thread', pinned: true, routeGeneration: 3, ...forged })
  await harness.router.setThreadModel(event(7), { projectId: 'project-1', threadId: 'thread', modelPick: { providerId: 'p', anthropicModel: 'm' }, routeGeneration: 3, ...forged })
  await harness.router.markFileDiffReviewed(event(7), { projectId: 'project-1', threadId: 'thread', changeSetId: 'change', routeGeneration: 3, ...forged })
  for (const [, input] of harness.broker.calls) assert.equal(JSON.stringify(input).includes('/private'), false)
  assert.deepEqual(harness.broker.calls.map(([name, input]) => [name, Object.keys(input).sort()]), [
    ['fork', ['messageId', 'projectId', 'routeGeneration', 'threadId']], ['edit', ['messageId', 'projectId', 'routeGeneration', 'text', 'threadId']],
    ['archive', ['projectId', 'routeGeneration', 'threadId']], ['pin', ['pinned', 'projectId', 'routeGeneration', 'threadId']],
    ['model', ['modelPick', 'projectId', 'routeGeneration', 'threadId']], ['review', ['changeSetId', 'projectId', 'routeGeneration', 'threadId']],
  ])
})

test('scoped collaborator outputs are field-projected and do not leak credentials or paths', async () => {
  const secret = '/private/secret apiKey=token baseUrl=https://credential.test rootPath=/root cwd=/cwd sessionId=session'
  const harness = makeHarness({ scopedRead: {
    getModelCatalog: async () => ({ activeProviderId: 'provider', activeAnthropicModel: 'model', providers: [{ id: 'provider', name: 'Provider', model: 'model', modelSupportsImages: true, defaultHaikuModel: 'h', defaultHaikuSupportsImages: false, defaultOpusModel: 'o', defaultOpusSupportsImages: false, defaultSonnetModel: 's', defaultSonnetSupportsImages: true, apiKey: secret, baseUrl: secret }], authToken: secret }),
    getAgentContext: async () => ({ skills: [{ kind: 'skill', name: 'skill', command: '/skill', title: 'Skill', description: 'safe', argumentHint: '', relativePath: '.claude/skills/x', scope: 'project', source: 'claude', native: false, path: secret, rootPath: secret }], agents: [{ kind: 'agent', name: 'agent', description: 'safe', relativePath: '.claude/agents/a', scope: 'project', source: 'claude', native: false, tools: [], path: secret }] }),
    searchProjectFiles: async () => [{ label: 'file', relativePath: 'src/a.ts', type: 'file', path: secret, rootPath: secret }],
    pickAttachments: async () => ({ attachments: [{ id: 'text', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 999, text: 'safe', path: secret }], skipped: [{ name: `${secret}/bad`, reason: secret, path: secret }] }),
    readProjectAttachments: async () => ({ attachments: [], skipped: [] }),
    getThreadStatus: async () => ({ threadId: 'thread', active: false, reportedModel: 'model', permissionMode: 'auto', tools: [], skills: [], slashCommands: [], agents: [], cwd: secret, sessionId: secret, baseUrl: secret, endpointHost: secret, apiKeySource: secret }),
  } })
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const results = await Promise.all([
    harness.router.getModelCatalog(event(7)), harness.router.getAgentContext(event(7), 'project-1'),
    harness.router.searchProjectFiles(event(7), { projectId: 'project-1', query: 'a' }),
    harness.router.pickAttachments(event(7), { allowImages: true }), harness.router.getThreadStatus(event(7), { projectId: 'project-1', threadId: 'thread' }),
  ])
  for (const result of results) assert.equal(result.ok, true)
  const serialized = JSON.stringify(results)
  for (const leaked of ['apiKey', 'token', 'baseUrl', 'rootPath', '/private/secret', 'cwd', 'sessionId', 'endpointHost']) assert.equal(serialized.includes(leaked), false)
  assert.deepEqual(results[3].value, { attachments: [{ id: 'text', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 4, text: 'safe' }], skipped: [{ name: 'bad', reason: 'Attachment is unavailable.' }] })
})

test('attachment submit remeasures actual content and rejects invalid content before the broker', async () => {
  const harness = makeHarness()
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
  const valid = await harness.router.submitRun(event(7), { projectId: 'project-1', threadId: 'thread', text: '', attachments: [
    { id: 'text', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 999999, text: 'hello', path: '/attacker/path' },
    { id: 'image', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 0, base64: png, path: '/attacker/image' },
  ] })
  assert.equal(valid.ok, true)
  assert.deepEqual(harness.broker.calls[0][1].attachments, [
    { id: 'text', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 5, text: 'hello' },
    { id: 'image', kind: 'image', name: 'image.png', mimeType: 'image/png', size: 8, base64: png },
  ])
  const oversizedText = 'a'.repeat(512 * 1024 + 1)
  const oversizedImage = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(5 * 1024 * 1024)]).toString('base64')
  const totalImage = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4 * 1024 * 1024)]).toString('base64')
  const preDecodeTooLarge = 'A'.repeat(4 * Math.ceil((5 * 1024 * 1024) / 3) + 4)
  const invalids = [
    [{ id: 'bad', kind: 'image', name: 'bad.png', mimeType: 'image/png', size: 1, base64: 'not base64' }],
    [{ id: 'bad', kind: 'text', name: 'bad.md', mimeType: 'image/png', size: 1, text: 'x' }],
    Array.from({ length: 9 }, (_, index) => ({ id: String(index), kind: 'text', name: `${index}.txt`, mimeType: 'text/plain', size: 0, text: 'x' })),
    [{ id: 'large-text', kind: 'text', name: 'large.txt', mimeType: 'text/plain', size: 1, text: oversizedText }],
    [{ id: 'large-image', kind: 'image', name: 'large.png', mimeType: 'image/png', size: 1, base64: oversizedImage }],
    [{ id: 'decode-limit', kind: 'image', name: 'decode.png', mimeType: 'image/png', size: 1, base64: preDecodeTooLarge }],
    Array.from({ length: 6 }, (_, index) => ({ id: String(index), kind: 'image', name: `${index}.png`, mimeType: 'image/png', size: 1, base64: totalImage })),
    [{ id: 'x'.repeat(257), kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 1, text: 'x' }],
    [{ id: 'long-name', kind: 'text', name: `${'x'.repeat(252)}.txt`, mimeType: 'text/plain', size: 1, text: 'x' }],
    [{ id: 'preview', kind: 'text', name: 'note.md', mimeType: 'text/markdown', size: 1, text: 'x', preview: 'x'.repeat(161) }],
  ]
  for (const attachments of invalids) {
    const result = await harness.router.submitRun(event(7), { projectId: 'project-1', threadId: 'thread', text: '', attachments })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-argument')
  }
  assert.equal(harness.broker.calls.filter(([name]) => name === 'submit').length, 1)
})

test('scoped project paths and thread status are rejected when collaborator output escapes its scope', async () => {
  const sentinel = 'C:\\private\\secret'
  const harness = makeHarness({ scopedRead: {
    getAgentContext: async () => ({ skills: [{ kind: 'skill', name: 'x', command: '/x', title: 'x', description: 'x', argumentHint: '', relativePath: `${sentinel}\\x`, scope: 'project', source: 'claude', native: false }], agents: [] }),
    searchProjectFiles: async () => [{ label: 'x', relativePath: '../secret', type: 'file' }],
    getThreadStatus: async () => ({ threadId: 'other-thread', active: false, reportedModel: 'm', permissionMode: 'auto', tools: [], skills: [], slashCommands: [], agents: [], cwd: sentinel }),
  } })
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const results = await Promise.all([
    harness.router.getAgentContext(event(7), 'project-1'),
    harness.router.searchProjectFiles(event(7), { projectId: 'project-1', query: 'x' }),
    harness.router.getThreadStatus(event(7), { projectId: 'project-1', threadId: 'expected-thread' }),
  ])
  for (const result of results) {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'internal-error')
    assert.equal(JSON.stringify(result).includes(sentinel), false)
  }
})

test('attachment readers normalize only safe relative paths and filter collaborator selections', async () => {
  const calls = []
  const harness = makeHarness({ scopedRead: {
    readProjectAttachments: async (input) => { calls.push(input); return { attachments: [{ id: 'bad', kind: 'image', name: 'bad.png', mimeType: 'image/png', size: 1, base64: 'bad', path: '/secret' }], skipped: [{ name: '/secret/file', reason: '/secret', path: '/secret' }] } },
  } })
  harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  for (const relativePaths of [[], [''], ['/etc/passwd'], ['C:\\secret.txt'], ['\\\\server\\share'], ['a/../b'], ['a\\..\\b'], ['a\0b'], Array.from({ length: 9 }, () => 'a.md')]) {
    const result = await harness.router.readProjectAttachments(event(7), { projectId: 'project-1', relativePaths })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-argument')
  }
  assert.equal(calls.length, 0)
  const safe = await harness.router.readProjectAttachments(event(7), { projectId: 'project-1', relativePaths: ['docs//./guide.md', 'src\\a.txt'], allowImages: false })
  assert.equal(safe.ok, true)
  assert.deepEqual(calls, [{ projectId: 'project-1', relativePaths: ['docs/guide.md', 'src/a.txt'], allowImages: false }])
  assert.deepEqual(safe.value, { attachments: [], skipped: [{ name: 'bad.png', reason: 'Attachment is unavailable.' }, { name: 'file', reason: 'Attachment is unavailable.' }] })
  const picker = await harness.router.pickAttachments(event(7), { allowImages: true, path: '/attacker' })
  assert.equal(picker.ok, false)
  assert.equal(picker.error.code, 'invalid-argument')
})

test('real scoped runtime services remain router-projected and map service failures to redacted errors', async () => {
  const { createProjectChatScopedReadCollaborator } = loadTsModule(resolve(testDir, './project-chat-runtime-services.ts'))
  const state = { projects: [{ id: 'project-1', name: 'P', path: '/project', createdAt: 1, updatedAt: 1 }], threads: [] }
  const service = createProjectChatScopedReadCollaborator({
    workspace: { read: () => state },
    settings: { getSnapshot: () => ({ settings: { configSource: 'settings', activeProviderId: 'p', activeAnthropicModel: 'm', providers: [{ id: 'p', name: 'P', model: 'm', modelSupportsImages: false, defaultHaikuModel: '', defaultHaikuSupportsImages: false, defaultOpusModel: '', defaultOpusSupportsImages: false, defaultSonnetModel: '', defaultSonnetSupportsImages: false, apiKey: 'credential-secret', authToken: 'token', baseUrl: 'https://secret', apiKeyUrl: 'https://secret', authMode: 'apiKey' }] }, env: { hasApiKey: true, hasAuthToken: false, baseUrl: 'env-secret', model: 'env', supportsImages: false, defaultHaikuModel: '', defaultOpusModel: '', defaultSonnetModel: '' } }) },
    runner: { getStatus: async () => ({}) }, discoverAgentContext: async () => { throw new Error('/private/raw failure') }, searchProjectFiles: async () => ({ ok: false, rootPath: '/private/search-root', message: '/private/search failure' }), pickAttachments: async () => ({ attachments: [], skipped: [] }), readAttachments: async () => ({ attachments: [], skipped: [] }), realpath: async (value) => value,
  })
  const harness = makeHarness({ scopedRead: service }); harness.capabilities.registerProjectWindow(7, 'project-1', 3)
  const catalog = await harness.router.getModelCatalog(event(7)); assert.equal(catalog.ok, true); assert.equal(JSON.stringify(catalog).includes('secret'), false)
  const context = await harness.router.getAgentContext(event(7), 'project-1'); assert.equal(context.ok, false); assert.equal(context.error.code, 'internal-error'); assert.equal(JSON.stringify(context).includes('/private'), false)
  const search = await harness.router.searchProjectFiles(event(7), { projectId: 'project-1', query: 'x' }); assert.equal(search.ok, false); assert.equal(search.error.code, 'internal-error'); assert.equal(JSON.stringify(search).includes('/private'), false)
})
