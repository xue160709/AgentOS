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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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

const client = loadTsModule(resolve(testDir, '../src/components/workspace-command-client.ts'))
const intents = loadTsModule(resolve(testDir, '../src/components/project-chat-thread-intents.ts'))

function workspace(overrides = {}) {
  return {
    workspaceRevision: 7,
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [{ id: 'project-1', name: 'One', path: '/one', createdAt: 1, updatedAt: 1 }],
    threads: [{ id: 'thread-1', projectId: 'project-1', title: 'Chat', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'm', items: [] } }],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1'] },
    runtimeDefinitions: [],
    workspaceTabs: [],
    activeWorkspaceTabId: '',
    projectHomeViewModes: {},
    localAppDefinitions: [],
    localAppTabs: [],
    activeLocalAppTabId: '',
    ...overrides,
  }
}

function createHarness(options = {}) {
  const timers = []
  const errors = []
  const adopted = []
  let current = options.workspace ?? workspace()
  const invocations = []
  const instance = new client.WorkspaceCommandClient({
    invoke: async (command, expectedRevision) => {
      invocations.push({ command, expectedRevision })
      return options.invoke ? options.invoke(command, expectedRevision, invocations.length) : { ok: true, workspace: current }
    },
    refresh: async () => (options.refresh ? options.refresh() : current),
    getWorkspace: () => current,
    adopt: (next, adoptOptions) => {
      adopted.push({ next, adoptOptions })
      current = client.adoptAuthoritativeWorkspace(current, next, adoptOptions)
    },
    onError: (message) => errors.push(message),
    schedule: (callback, delayMs) => { const entry = { callback, delayMs }; timers.push(entry); return entry },
    cancelScheduled: (handle) => { const index = timers.indexOf(handle); if (index >= 0) timers.splice(index, 1) },
  })
  return {
    instance,
    errors,
    adopted,
    invocations,
    timers,
    current: () => current,
    runTimers: () => { const pending = timers.splice(0, timers.length); pending.forEach((entry) => entry.callback()) },
  }
}

// --- Selection stays renderer-owned ---

test('adoptAuthoritativeWorkspace keeps the current selection by default', () => {
  const current = workspace({ activeProjectId: 'project-1', activeThreadId: 'thread-1' })
  const next = workspace({ activeProjectId: 'project-9', activeThreadId: 'thread-9', projects: [...current.projects, { id: 'project-9', name: 'Nine', path: '/9', createdAt: 9, updatedAt: 9 }], threads: current.threads })
  const merged = client.adoptAuthoritativeWorkspace(current, next, { preserveSelection: true })
  assert.equal(merged.activeProjectId, 'project-1')
  assert.equal(merged.activeThreadId, 'thread-1')
})

test('adoptAuthoritativeWorkspace falls back when the selection disappeared', () => {
  const current = workspace({ activeProjectId: 'project-gone', activeThreadId: 'thread-gone' })
  const next = workspace({ activeProjectId: 'project-1', activeThreadId: 'thread-1' })
  const merged = client.adoptAuthoritativeWorkspace(current, next, { preserveSelection: true })
  assert.equal(merged.activeProjectId, 'project-1')
  assert.equal(merged.activeThreadId, 'thread-1')
})

test('adoptAuthoritativeWorkspace keeps the project home instead of Main stale Workspace Tab', () => {
  const tab = { id: 'tab-1', runtimeDefinitionId: 'runtime-1', title: 'Workbench', createdAt: 1, updatedAt: 1 }
  // Project home: empty thread/tab ids are a selection, not a missing value.
  const current = workspace({ activeThreadId: '', activeWorkspaceTabId: '', workspaceTabs: [tab] })
  // Main still records the Workspace Tab the user opened earlier; selection is
  // renderer-owned in broker mode, so Main is never told the user left it.
  const next = workspace({ activeThreadId: 'thread-1', activeWorkspaceTabId: 'tab-1', workspaceTabs: [tab] })
  const merged = client.adoptAuthoritativeWorkspace(current, next, { preserveSelection: true })
  assert.equal(merged.activeWorkspaceTabId, '')
  assert.equal(merged.activeLocalAppTabId, '')
  assert.equal(merged.activeThreadId, '')
})

test('adoptAuthoritativeWorkspace takes Main selection when the command owns it', () => {
  const current = workspace()
  const next = workspace({ activeProjectId: 'project-new', projects: [{ id: 'project-new', name: 'New', path: '/new', createdAt: 2, updatedAt: 2 }], threads: [] })
  const merged = client.adoptAuthoritativeWorkspace(current, next, { preserveSelection: false })
  assert.equal(merged.activeProjectId, 'project-new')
})

// --- Submission, revision gate and single retry ---

test('submit sends the current revision and adopts the returned workspace', async () => {
  const harness = createHarness()
  const result = await harness.instance.submit({ type: 'project.setPinned', projectId: 'project-1', pinned: true })
  assert.equal(result.ok, true)
  assert.equal(harness.invocations[0].expectedRevision, 7)
  assert.equal(harness.adopted.length, 1)
})

test('workspace-conflict triggers exactly one fresh-read retry', async () => {
  let calls = 0
  const harness = createHarness({
    invoke: async () => {
      calls += 1
      return calls === 1
        ? { ok: false, code: 'workspace-conflict', message: 'conflict' }
        : { ok: true, workspace: workspace({ workspaceRevision: 9 }) }
    },
  })
  const result = await harness.instance.submit({ type: 'project.remove', projectId: 'project-1' })
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  assert.deepEqual(harness.errors, [])
})

test('a second conflict is reported and never loops', async () => {
  let calls = 0
  const harness = createHarness({
    invoke: async () => { calls += 1; return { ok: false, code: 'workspace-conflict', message: 'conflict' } },
  })
  const result = await harness.instance.submit({ type: 'project.remove', projectId: 'project-1' })
  assert.equal(result.ok, false)
  assert.equal(calls, 2)
  assert.deepEqual(harness.errors, ['conflict'])
})

test('non-conflict failures surface once and do not retry', async () => {
  let calls = 0
  const harness = createHarness({
    invoke: async () => { calls += 1; return { ok: false, code: 'project-missing', message: '项目不存在' } },
  })
  const result = await harness.instance.submit({ type: 'project.remove', projectId: 'ghost' })
  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  assert.deepEqual(harness.errors, ['项目不存在'])
})

test('submissions are serialized so two clicks cannot share a stale revision', async () => {
  const order = []
  const harness = createHarness({
    invoke: async (command) => {
      order.push(`start:${command.projectId}`)
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1))
      order.push(`end:${command.projectId}`)
      return { ok: true, workspace: workspace() }
    },
  })
  await Promise.all([
    harness.instance.submit({ type: 'project.setPinned', projectId: 'a', pinned: true }),
    harness.instance.submit({ type: 'project.setPinned', projectId: 'b', pinned: true }),
  ])
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'])
})

// --- Debounced preferences ---

test('queued preference toggles collapse into one command', async () => {
  const harness = createHarness()
  harness.instance.queuePreferences({ sidebarCollapsed: true })
  harness.instance.queuePreferences({ sidebarCollapsed: false })
  harness.instance.queuePreferences({ projectHomeViewModes: { 'project-1': 'runtime' } })
  assert.equal(harness.invocations.length, 0, 'nothing is sent before the debounce fires')
  harness.runTimers()
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  assert.equal(harness.invocations.length, 1)
  assert.deepEqual(harness.invocations[0].command, {
    type: 'preferences.set',
    sidebarCollapsed: false,
    projectHomeViewModes: { 'project-1': 'runtime' },
  })
})

test('flushPreferences sends the pending patch without waiting for the timer', async () => {
  const harness = createHarness()
  harness.instance.queuePreferences({ sidebarCollapsed: true })
  await harness.instance.flushPreferences()
  assert.equal(harness.invocations.length, 1)
  assert.equal(harness.timers.length, 0, 'the pending timer must be cancelled')
})

test('dispose cancels the debounce without sending', async () => {
  const harness = createHarness()
  harness.instance.queuePreferences({ sidebarCollapsed: true })
  harness.instance.dispose()
  harness.runTimers()
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  assert.equal(harness.invocations.length, 0)
})

// --- Thread intents (FIX-CHAT-01) ---

function snapshot(overrides = {}) {
  return {
    projectId: 'project-1',
    project: { id: 'project-1', name: 'One', pathMissing: false },
    workspaceRevision: 7,
    sequence: 1,
    routeGeneration: 3,
    threads: [],
    runs: [],
    pendingPrompts: [],
    permissionMode: 'auto',
    unreadExternalTaskCount: 0,
    ...overrides,
  }
}

test('isProjectThreadBusy reads snapshot facts for every thread purpose', () => {
  assert.equal(intents.isProjectThreadBusy(snapshot(), 'thread-1'), false)
  assert.equal(intents.isProjectThreadBusy(snapshot({ runs: [{ threadId: 'thread-1', phase: 'running' }] }), 'thread-1'), true)
  assert.equal(intents.isProjectThreadBusy(snapshot({ runs: [{ threadId: 'thread-1', phase: 'succeeded' }] }), 'thread-1'), false)
  assert.equal(intents.isProjectThreadBusy(snapshot({ pendingPrompts: [{ threadId: 'thread-1' }] }), 'thread-1'), true)
  assert.equal(intents.isProjectThreadBusy(undefined, 'thread-1'), false)
})

function createIntentHarness(options = {}) {
  const errors = []
  const busy = []
  const calls = []
  const api = {
    archiveThread: async (input) => { calls.push({ kind: 'archive', input }); return options.archiveResult ? options.archiveResult(calls.length) : { ok: true } },
    setThreadPinned: async (input) => { calls.push({ kind: 'pin', input }); return { ok: true } },
  }
  const instance = new intents.ProjectChatThreadIntentClient({
    api: () => api,
    getSnapshot: () => options.snapshot,
    refreshSnapshot: async () => options.refreshed ?? options.snapshot ?? null,
    onError: (message) => errors.push(message),
    onBusy: (threadId) => busy.push(threadId),
  })
  return { instance, errors, busy, calls }
}

test('archive uses the target project generation and refuses a busy thread', async () => {
  const busyHarness = createIntentHarness({ snapshot: snapshot({ runs: [{ threadId: 'thread-1', phase: 'running' }] }) })
  assert.equal(await busyHarness.instance.archive('project-1', 'thread-1'), false)
  assert.deepEqual(busyHarness.busy, ['thread-1'])
  assert.equal(busyHarness.calls.length, 0, 'a busy thread must not reach Main')

  const idleHarness = createIntentHarness({ snapshot: snapshot() })
  assert.equal(await idleHarness.instance.archive('project-1', 'thread-1'), true)
  assert.deepEqual(idleHarness.calls[0].input, { projectId: 'project-1', threadId: 'thread-1', routeGeneration: 3 })
})

test('pin sends an explicit boolean and is not blocked by a busy thread', async () => {
  const harness = createIntentHarness({ snapshot: snapshot({ runs: [{ threadId: 'thread-1', phase: 'running' }] }) })
  assert.equal(await harness.instance.setPinned('project-1', 'thread-1', true), true)
  assert.deepEqual(harness.calls[0].input, { projectId: 'project-1', threadId: 'thread-1', pinned: true, routeGeneration: 3 })
})

test('stale-revision retries once against a fresh snapshot', async () => {
  const harness = createIntentHarness({
    snapshot: snapshot({ routeGeneration: 3 }),
    refreshed: snapshot({ routeGeneration: 4 }),
    archiveResult: (call) => (call === 1 ? { ok: false, error: { code: 'stale-revision', message: 'stale' } } : { ok: true }),
  })
  assert.equal(await harness.instance.archive('project-1', 'thread-1'), true)
  assert.equal(harness.calls.length, 2)
  assert.equal(harness.calls[1].input.routeGeneration, 4)
  assert.deepEqual(harness.errors, [])
})

test('a failing archive is reported and returns false', async () => {
  const harness = createIntentHarness({
    snapshot: snapshot(),
    archiveResult: () => ({ ok: false, error: { code: 'thread-busy', message: '当前对话正在处理中' } }),
  })
  assert.equal(await harness.instance.archive('project-1', 'thread-1'), false)
  assert.deepEqual(harness.errors, ['当前对话正在处理中'])
})
