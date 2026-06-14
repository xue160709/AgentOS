import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadWorkspaceSession() {
  const modulePath = resolve(testDir, '../src/components/workspace-session.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
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
  const session = new WorkspaceSession({
    load: async () => createState(),
    save: async (state) => {
      saved.push(state)
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
    scheduled,
    cancelled,
    setNow(value) {
      now = value
    },
  }
}

test('Workspace Session interface owns active selection and thread lifecycle invariants', () => {
  const harness = createHarness()
  let state = createState()

  harness.setNow(200)
  state = harness.session.addThread(state, {
    id: 'thread-2',
    projectId: 'project-2',
    title: 'Second',
    chatState: { model: 'Claude Agent', items: [] },
  })
  assert.equal(state.activeProjectId, 'project-2')
  assert.equal(state.activeThreadId, 'thread-2')
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

  harness.scheduled[1].callback()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.saved.length, 1)
  assert.equal(harness.saved[0].activeProjectId, 'project-2')
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
