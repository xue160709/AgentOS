import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadWorkspaceSession() {
  return loadTsModule(resolve(testDir, '../src/components/workspace-session.ts'))
}

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

function createState() {
  return {
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [
      { id: 'project-1', name: 'One', path: '/one', createdAt: 1, updatedAt: 1 },
      { id: 'project-2', name: 'Two', path: '/two', createdAt: 2, updatedAt: 2 },
    ],
    threads: [
      {
        id: 'thread-1',
        projectId: 'project-1',
        title: 'New chat',
        createdAt: 1,
        updatedAt: 1,
        chatState: { model: 'Claude Agent', items: [] },
      },
    ],
    sidebarPrefs: {
      collapsed: false,
      collapsedProjectIds: [],
      projectOrderIds: ['project-1', 'project-2'],
    },
  }
}

function createHarness() {
  const { WorkspaceSession } = loadWorkspaceSession()
  let now = 100
  const scheduled = []
  const cancelled = []
  const saved = []
  const savedImmediately = []
  const session = new WorkspaceSession({
    load: async () => createState(),
    save: async (state) => {
      saved.push(state)
    },
    saveImmediately: (state) => {
      savedImmediately.push(state)
    },
    now: () => now,
    schedule: (callback, delayMs) => {
      const handle = { callback, delayMs }
      scheduled.push(handle)
      return handle
    },
    cancelScheduled: (handle) => {
      cancelled.push(handle)
    },
  })
  return {
    session,
    saved,
    savedImmediately,
    scheduled,
    cancelled,
    setNow(value) {
      now = value
    },
  }
}

test('Workspace Session interface owns active selection and thread lifecycle invariants', () => {
  const harness = createHarness()
  let state = { ...createState(), activeWorkspaceTabId: 'workspace-tab-1', activeLocalAppTabId: 'workspace-tab-1' }

  harness.setNow(200)
  state = harness.session.addThread(state, {
    id: 'thread-2',
    projectId: 'project-2',
    title: 'Second',
    chatState: { model: 'Claude Agent', items: [] },
  })
  assert.equal(state.activeProjectId, 'project-2')
  assert.equal(state.activeThreadId, 'thread-2')
  assert.equal(state.activeWorkspaceTabId, '')
  assert.equal(state.activeLocalAppTabId, '')
  assert.equal(state.projects[1].updatedAt, 200)

  harness.setNow(300)
  state = harness.session.archiveThread(state, 'thread-2')
  assert.equal(state.activeProjectId, 'project-2')
  assert.equal(state.activeThreadId, '')
  assert.equal(state.threads[0].archivedAt, 300)

  state = harness.session.selectThread(state, 'thread-1')
  assert.deepEqual(harness.session.active(state), {
    project: state.projects[0],
    thread: state.threads[1],
  })
})

test('selecting a Workspace Tab clears the previous thread and survives active restore', () => {
  const harness = createHarness()
  const runtimeDefinition = {
    id: 'runtime-1',
    name: 'Runtime One',
    rootPath: '/runtime-one',
    packageManager: 'npm',
    devCommand: { executable: 'npm', args: ['run', 'dev'] },
    trustStatus: 'trusted',
    autoStart: true,
    createdAt: 1,
    updatedAt: 1,
  }
  const workspaceTab = {
    id: 'workspace-tab-1',
    runtimeDefinitionId: runtimeDefinition.id,
    title: 'Runtime One',
    createdAt: 1,
    updatedAt: 1,
  }
  const state = {
    ...createState(),
    runtimeDefinitions: [runtimeDefinition],
    workspaceTabs: [workspaceTab],
    activeWorkspaceTabId: '',
  }

  const selected = harness.session.selectWorkspaceTab(state, workspaceTab.id)

  assert.equal(selected.activeThreadId, '')
  assert.equal(selected.activeWorkspaceTabId, workspaceTab.id)
  assert.deepEqual(harness.session.active(selected), {
    project: selected.projects[0],
    thread: undefined,
    runtimeDefinition,
    workspaceTab,
    localAppDefinition: runtimeDefinition,
    localAppTab: workspaceTab,
  })
})

test('Workspace Session restore owns active project and latest visible thread fallback', () => {
  const harness = createHarness()
  const state = {
    ...createState(),
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [
      { id: 'project-1', name: 'One', path: '/one', pathMissing: true, createdAt: 1, updatedAt: 1 },
      { id: 'project-2', name: 'Two', path: '/two', createdAt: 2, updatedAt: 2 },
    ],
    threads: [
      {
        id: 'thread-1',
        projectId: 'project-1',
        title: 'Old active',
        createdAt: 1,
        updatedAt: 10,
        chatState: { model: 'Claude Agent', items: [] },
      },
      {
        id: 'thread-2',
        projectId: 'project-2',
        title: 'Older fallback',
        createdAt: 2,
        updatedAt: 20,
        chatState: { model: 'Claude Agent', items: [] },
      },
      {
        id: 'thread-3',
        projectId: 'project-2',
        title: 'Newest fallback',
        createdAt: 3,
        updatedAt: 30,
        chatState: { model: 'Claude Agent', items: [] },
      },
      {
        id: 'thread-4',
        projectId: 'project-2',
        title: 'Archived newer',
        createdAt: 4,
        updatedAt: 40,
        archivedAt: 50,
        chatState: { model: 'Claude Agent', items: [] },
      },
    ],
  }

  const restored = harness.session.restore(state)
  assert.equal(restored.activeProjectId, 'project-2')
  assert.equal(restored.activeThreadId, 'thread-3')
  assert.deepEqual(harness.session.active(state), {
    project: restored.projects[1],
    thread: restored.threads[2],
  })
})

test('Workspace Session restore preserves an explicit project-home selection', () => {
  const harness = createHarness()
  const state = {
    ...createState(),
    activeProjectId: 'project-1',
    activeThreadId: '',
    projects: [
      { id: 'project-1', name: 'One', path: '/one', pathMissing: true, createdAt: 1, updatedAt: 1 },
      { id: 'project-2', name: 'Two', path: '/two', createdAt: 2, updatedAt: 2 },
    ],
    threads: [
      {
        id: 'thread-2',
        projectId: 'project-2',
        title: 'Fallback thread',
        createdAt: 2,
        updatedAt: 20,
        chatState: { model: 'Claude Agent', items: [] },
      },
    ],
  }

  const restored = harness.session.restore(state)
  assert.equal(restored.activeProjectId, 'project-2')
  assert.equal(restored.activeThreadId, '')
})

test('Workspace Session load restores adapter snapshots before exposing them', async () => {
  const { WorkspaceSession } = loadWorkspaceSession()
  const session = new WorkspaceSession({
    load: async () => ({
      ...createState(),
      activeProjectId: 'missing-project',
      activeThreadId: 'missing-thread',
    }),
    save: async () => {},
  })

  const loaded = await session.load()
  assert.equal(loaded.activeProjectId, 'project-1')
  assert.equal(loaded.activeThreadId, 'thread-1')
})

test('Workspace Session interface keeps project removal, ordering, and relocation local', () => {
  const harness = createHarness()
  let state = createState()

  harness.setNow(400)
  state = harness.session.toggleProjectPinned(state, 'project-2')
  assert.equal(state.projects[1].pinnedAt, 400)
  assert.deepEqual(state.sidebarPrefs.projectOrderIds, ['project-2', 'project-1'])

  state = harness.session.relocateProject(state, 'project-2', '/relocated')
  assert.equal(state.projects[1].path, '/relocated')

  state = harness.session.removeProject(state, 'project-1')
  assert.equal(state.activeProjectId, 'project-2')
  assert.equal(state.activeThreadId, '')
  assert.deepEqual(state.threads, [])
  assert.deepEqual(state.sidebarPrefs.projectOrderIds, ['project-2'])
})

test('Workspace Session interface serializes debounced saves and retains the newest snapshot', async () => {
  const harness = createHarness()
  const first = createState()
  const second = harness.session.selectProject(first, 'project-2')

  harness.session.stage(first)
  harness.session.stage(second)
  assert.equal(harness.scheduled.length, 2)
  assert.equal(harness.cancelled.length, 1)
  assert.equal(harness.scheduled[1].delayMs, 750)
  assert.deepEqual(harness.savedImmediately.map((state) => state.activeProjectId), ['project-1', 'project-2'])
  assert.deepEqual(harness.savedImmediately.map((state) => state.workspaceRevision), [1, 2])

  harness.scheduled[1].callback()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.saved.length, 1)
  assert.equal(harness.saved[0].activeProjectId, 'project-2')
  assert.equal(harness.saved[0].workspaceRevision, 2)
})

test('Workspace Session explicit flush propagates save failure and retries the same pending snapshot', async () => {
  const { WorkspaceSession } = loadWorkspaceSession()
  const attempts = []
  let fail = true
  const session = new WorkspaceSession({
    load: async () => createState(),
    save: async (state) => {
      attempts.push(state)
      if (fail) throw new Error('workspace-save-rejected')
    },
    schedule: () => ({}),
    cancelScheduled: () => {},
  })
  const state = createState()
  session.stage(state)
  await assert.rejects(session.flush(), /workspace-save-rejected/)
  assert.equal(attempts.length, 1)
  fail = false
  await session.flush()
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1].workspaceRevision, attempts[0].workspaceRevision)
})

test('Renderer persistence propagates Main save rejection instead of treating localStorage mirror as success', async () => {
  const { persistChatWorkspaceState } = loadTsModule(resolve(testDir, '../src/chat-workspace-persistence.ts'))
  const previousWindow = globalThis.window
  globalThis.window = {
    desktop: {
      saveChatWorkspace: async () => { throw new Error('main-save-rejected') },
    },
  }
  try {
    await assert.rejects(persistChatWorkspaceState(createState()), /main-save-rejected/)
  } finally {
    globalThis.window = previousWindow
  }
})

test('Workspace Session immediate durable save ignores runtime-only pathMissing changes', async () => {
  const harness = createHarness()
  const first = createState()
  const runtimeOnly = {
    ...first,
    projects: first.projects.map((project, index) =>
      index === 0 ? { ...project, pathMissing: true } : project,
    ),
  }

  harness.session.stage(first)
  harness.session.stage(runtimeOnly)
  assert.equal(harness.savedImmediately.length, 1)
  assert.equal(harness.scheduled.length, 1)
  assert.equal(harness.savedImmediately[0].workspaceRevision, 1)
})

test('Workspace Session close drains a newer snapshot queued during an in-flight save', async () => {
  const { WorkspaceSession } = loadWorkspaceSession()
  let releaseFirstSave
  const saved = []
  const session = new WorkspaceSession({
    load: async () => createState(),
    save: async (state) => {
      saved.push(state.activeProjectId)
      if (saved.length === 1) {
        await new Promise((resolve) => {
          releaseFirstSave = resolve
        })
      }
    },
    schedule: () => ({}),
    cancelScheduled: () => {},
  })
  const first = createState()
  const second = session.selectProject(first, 'project-2')

  session.stage(first)
  const firstFlush = session.flush()
  session.stage(second)
  const close = session.close()
  releaseFirstSave()
  await firstFlush
  await close

  assert.deepEqual(saved, ['project-1', 'project-2'])
})

test('Workspace Session remains reusable after StrictMode-style cleanup flush', async () => {
  const harness = createHarness()
  const first = createState()
  const second = harness.session.selectProject(first, 'project-2')

  harness.session.stage(first)
  // AppShell effect cleanup is a flush boundary, not permanent disposal: a
  // retained session is staged again when StrictMode remounts the shell.
  await harness.session.close()
  harness.session.stage(second)
  await harness.session.flush()

  assert.deepEqual(harness.saved.map((state) => state.activeProjectId), ['project-1', 'project-2'])
  assert.equal(harness.saved[1].workspaceRevision, 2)
})

test('Workspace Session clear suppresses the replacement empty snapshot', async () => {
  const harness = createHarness()
  const empty = {
    activeProjectId: '',
    activeThreadId: '',
    projects: [],
    threads: [],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: [] },
  }

  harness.session.stage(createState())
  harness.session.clear()
  harness.session.stage(empty)
  await harness.session.flush()
  assert.equal(harness.saved.length, 0)
})

test('Workspace Session interface merges background task threads by project path', () => {
  const harness = createHarness()
  const state = harness.session.ensureTaskRunThread(createState(), {
    projectPath: '/two/',
    slug: 'daily-report',
    title: '执行日报',
    thread: {
      id: 'task-thread',
      projectId: 'missing-project',
      createdAt: 90,
      updatedAt: 95,
    },
  })

  const thread = state.threads[0]
  assert.equal(thread.id, 'task-thread')
  assert.equal(thread.projectId, 'project-2')
  assert.equal(thread.purpose, 'task-run')
  assert.equal(thread.homePluginSlug, 'daily-report')
})

test('Workspace Session can add a background thread without changing the active selection', () => {
  const harness = createHarness()
  const state = harness.session.addThread(createState(), {
    id: 'thread-background',
    projectId: 'project-2',
    title: '后台 Agent 任务',
    chatState: { model: 'Claude Agent', items: [] },
    activate: false,
  })

  assert.equal(state.activeProjectId, 'project-1')
  assert.equal(state.activeThreadId, 'thread-1')
  assert.equal(state.threads[0].id, 'thread-background')
  assert.equal(state.threads[0].projectId, 'project-2')
})

test('Workspace normalization preserves a local-app-only snapshot and drops dangling local tabs', () => {
  const { normalizeChatWorkspaceState } = loadTsModule(resolve(testDir, '../src/chat-workspace-persistence.ts'))
  const normalized = normalizeChatWorkspaceState({
    workspaceRevision: 4,
    activeProjectId: '',
    activeThreadId: '',
    projects: [],
    threads: [],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: [] },
    localAppDefinitions: [{
      id: 'local-1', name: 'Fixture', rootPath: '/fixture', canonicalRoot: '/fixture',
      packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] },
      trustStatus: 'trusted', autoStart: true, createdAt: 1, updatedAt: 2,
    }],
    localAppTabs: [
      { id: 'tab-1', localAppId: 'local-1', title: 'Fixture', createdAt: 1, updatedAt: 2 },
      { id: 'dangling', localAppId: 'missing', title: 'Bad', createdAt: 1, updatedAt: 2 },
    ],
    activeLocalAppTabId: 'tab-1',
  })
  assert.equal(normalized.localAppDefinitions.length, 1)
  assert.deepEqual(normalized.localAppTabs.map((tab) => tab.id), ['tab-1'])
  assert.equal(normalized.activeLocalAppTabId, 'tab-1')
  assert.equal(normalized.projects.length, 0)

  const untrusted = normalizeChatWorkspaceState({
    ...normalized,
    runtimeDefinitions: [{ ...normalized.runtimeDefinitions[0], trustStatus: 'unexpected', autoStart: 'yes' }],
  })
  assert.equal(untrusted.runtimeDefinitions[0].trustStatus, 'revoked')
  assert.equal(untrusted.runtimeDefinitions[0].autoStart, false)

  const degraded = normalizeChatWorkspaceState({
    ...createState(),
    runtimeDefinitions: { invalid: true },
    workspaceTabs: 'invalid',
    activeWorkspaceTabId: 42,
  })
  assert.equal(degraded.projects.length, 2)
  assert.deepEqual(degraded.runtimeDefinitions, [])
  assert.deepEqual(degraded.workspaceTabs, [])
  assert.equal(degraded.activeWorkspaceTabId, '')
})
