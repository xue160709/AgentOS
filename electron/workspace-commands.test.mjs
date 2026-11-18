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

const commands = loadTsModule(resolve(testDir, '../src/workspace-commands.ts'))
const resolution = loadTsModule(resolve(testDir, '../src/workspace-snapshot-resolution.ts'))

function createState(overrides = {}) {
  return {
    workspaceRevision: 4,
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [
      { id: 'project-1', name: 'One', path: '/one', createdAt: 1, updatedAt: 1 },
      { id: 'project-2', name: 'Two', path: '/two', createdAt: 2, updatedAt: 2 },
    ],
    threads: [
      { id: 'thread-1', projectId: 'project-1', title: 'Chat', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude Agent', items: [] } },
      { id: 'thread-2', projectId: 'project-2', title: 'Chat 2', createdAt: 2, updatedAt: 2, creationSource: { kind: 'user' }, chatState: { model: 'Claude Agent', items: [] } },
    ],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1', 'project-2'] },
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

const context = { now: 1_000, createProjectId: () => 'project-new' }

// --- ATDD-WS-204: the command surface cannot carry snapshot payloads ---

test('parseWorkspaceCommand rejects snapshot payloads and unknown keys', () => {
  for (const bad of [
    { type: 'project.create', name: 'x', path: '/x', threads: [] },
    { type: 'project.create', name: 'x', path: '/x', projects: [] },
    { type: 'project.create', id: 'project-evil', name: 'x', path: '/x' },
    { type: 'project.remove', projectId: 'project-1', chatState: {} },
    { type: 'preferences.set', sidebarCollapsed: true, workspaceRevision: 99 },
    { type: 'project.setPinned', projectId: 'project-1', pinned: 'yes' },
    { type: 'project.reorder', projectId: 'a', targetProjectId: 'b', position: 'middle' },
    { type: 'workspace.replace' },
    'project.create',
    null,
  ]) {
    const parsed = commands.parseWorkspaceCommand(bad)
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(bad)}`)
    assert.equal(parsed.code, 'invalid-command')
  }
})

test('parseWorkspaceCommand accepts and normalizes valid commands', () => {
  const created = commands.parseWorkspaceCommand({ type: 'project.create', name: '  Demo  ', path: ' /tmp/demo ' })
  assert.equal(created.ok, true)
  assert.deepEqual(created.command, { type: 'project.create', name: 'Demo', path: '/tmp/demo' })

  const prefs = commands.parseWorkspaceCommand({
    type: 'preferences.set',
    collapsedProjectIds: ['project-1', 'project-1'],
    projectHomeViewModes: { 'project-1': 'runtime' },
  })
  assert.equal(prefs.ok, true)
  assert.deepEqual(prefs.command.collapsedProjectIds, ['project-1'])

  assert.equal(commands.parseWorkspaceCommand({ type: 'preferences.set' }).ok, false)
})

// --- ATDD-WS-202: project lifecycle ---

test('project.create adds a Main-generated project and selects it', () => {
  const applied = commands.applyWorkspaceCommand(createState(), { type: 'project.create', name: 'Demo', path: '/tmp/demo' }, context)
  assert.equal(applied.ok, true)
  assert.equal(applied.changed, true)
  assert.equal(applied.projectId, 'project-new')
  assert.equal(applied.state.projects[0].id, 'project-new')
  assert.equal(applied.state.activeProjectId, 'project-new')
  assert.equal(applied.state.activeThreadId, '')
  assert.equal(applied.state.sidebarPrefs.projectOrderIds[0], 'project-new')
  assert.equal(commands.workspaceCommandApplied(applied.state, { type: 'project.create', name: 'Demo', path: '/tmp/demo' }, 'project-new'), true)
})

test('project.remove drops the project, its threads and project-owned runtimes', () => {
  const state = createState({
    runtimeDefinitions: [
      { id: 'runtime-1', owner: { kind: 'project', projectId: 'project-2' }, name: 'r', rootPath: '/two/.agentos', packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] }, trustStatus: 'trusted', autoStart: false, createdAt: 1, updatedAt: 1 },
      { id: 'runtime-2', owner: { kind: 'workspace' }, name: 'w', rootPath: '/w', packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] }, trustStatus: 'trusted', autoStart: false, createdAt: 1, updatedAt: 1 },
    ],
  })
  const applied = commands.applyWorkspaceCommand(state, { type: 'project.remove', projectId: 'project-2' }, context)
  assert.equal(applied.ok, true)
  assert.equal(applied.state.projects.some((project) => project.id === 'project-2'), false)
  assert.equal(applied.state.threads.some((thread) => thread.projectId === 'project-2'), false)
  assert.deepEqual(applied.state.runtimeDefinitions.map((item) => item.id), ['runtime-2'])
})

test('project.remove refuses the last project and an unknown project', () => {
  const single = createState({ projects: [{ id: 'project-1', name: 'One', path: '/one', createdAt: 1, updatedAt: 1 }] })
  const last = commands.applyWorkspaceCommand(single, { type: 'project.remove', projectId: 'project-1' }, context)
  assert.equal(last.ok, false)
  assert.equal(last.code, 'project-last-remaining')

  const missing = commands.applyWorkspaceCommand(createState(), { type: 'project.remove', projectId: 'nope' }, context)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'project-missing')
})

test('project.relocate clears pathMissing and keeps other projects untouched', () => {
  const state = createState()
  state.projects[1].pathMissing = true
  const applied = commands.applyWorkspaceCommand(state, { type: 'project.relocate', projectId: 'project-2', path: '/moved' }, context)
  assert.equal(applied.ok, true)
  assert.equal(applied.state.projects[1].path, '/moved')
  assert.equal(applied.state.projects[1].pathMissing, undefined)
  assert.equal(applied.state.projects[0].path, '/one')
})

test('project.setPinned is an explicit target value and is idempotent', () => {
  const first = commands.applyWorkspaceCommand(createState(), { type: 'project.setPinned', projectId: 'project-2', pinned: true }, context)
  assert.equal(first.ok, true)
  assert.equal(first.changed, true)
  assert.equal(first.state.sidebarPrefs.projectOrderIds[0], 'project-2')

  const again = commands.applyWorkspaceCommand(first.state, { type: 'project.setPinned', projectId: 'project-2', pinned: true }, context)
  assert.equal(again.ok, true)
  assert.equal(again.changed, false, 'repeating the same target value must not rewrite state')
})

test('project.reorder moves a project before or after another', () => {
  const applied = commands.applyWorkspaceCommand(createState(), { type: 'project.reorder', projectId: 'project-2', targetProjectId: 'project-1', position: 'before' }, context)
  assert.equal(applied.ok, true)
  assert.deepEqual(applied.state.sidebarPrefs.projectOrderIds, ['project-2', 'project-1'])
  assert.equal(commands.workspaceCommandApplied(applied.state, { type: 'project.reorder', projectId: 'project-2', targetProjectId: 'project-1', position: 'before' }), true)
})

// --- ATDD-WS-203: preferences ---

test('preferences.set applies a partial patch and keeps untouched fields', () => {
  const state = createState({ sidebarPrefs: { collapsed: false, collapsedProjectIds: ['project-1'], projectOrderIds: ['project-1', 'project-2'] } })
  const applied = commands.applyWorkspaceCommand(state, { type: 'preferences.set', sidebarCollapsed: true }, context)
  assert.equal(applied.ok, true)
  assert.equal(applied.state.sidebarPrefs.collapsed, true)
  assert.deepEqual(applied.state.sidebarPrefs.collapsedProjectIds, ['project-1'], 'untouched field must survive')
})

test('preferences.set drops ids for projects that no longer exist', () => {
  const applied = commands.applyWorkspaceCommand(createState(), {
    type: 'preferences.set',
    collapsedProjectIds: ['project-1', 'ghost'],
    projectHomeViewModes: { 'project-2': 'runtime', ghost: 'runtime' },
  }, context)
  assert.equal(applied.ok, true)
  assert.deepEqual(applied.state.sidebarPrefs.collapsedProjectIds, ['project-1'])
  assert.deepEqual(applied.state.projectHomeViewModes, { 'project-2': 'runtime' })
})

// --- Main handler semantics: revision gate + readback ---

function createStore(initial) {
  let current = initial
  return {
    read: () => current,
    save: async (state) => { current = state; return current },
    corrupt(mutator) { current = mutator(current) },
  }
}

async function runCommandHandler(store, rawCommand, expectedRevision, options = {}) {
  const parsed = commands.parseWorkspaceCommand(rawCommand)
  if (!parsed.ok) return parsed
  const current = store.read()
  if (!current) return { ok: false, code: 'workspace-unavailable', message: 'unavailable' }
  if (expectedRevision !== undefined && resolution.workspaceRevisionOf(current) !== expectedRevision) {
    return { ok: false, code: 'workspace-conflict', message: 'conflict' }
  }
  const applied = commands.applyWorkspaceCommand(current, parsed.command, { now: 1_000, createProjectId: () => 'project-new' })
  if (!applied.ok) return applied
  if (!applied.changed) return { ok: true, workspace: current, projectId: applied.projectId }
  const proposed = resolution.withNextWorkspaceRevision(applied.state, resolution.workspaceRevisionOf(current))
  await store.save(proposed)
  if (options.corruptAfterSave) store.corrupt(options.corruptAfterSave)
  const persisted = store.read()
  if (
    !persisted ||
    resolution.workspaceRevisionOf(persisted) !== resolution.workspaceRevisionOf(proposed) ||
    !commands.workspaceCommandApplied(persisted, parsed.command, applied.projectId)
  ) {
    return { ok: false, code: 'workspace-save-failed', message: 'readback failed' }
  }
  return { ok: true, workspace: persisted, projectId: applied.projectId }
}

test('handler bumps revision and returns the readback-verified workspace', async () => {
  const store = createStore(createState())
  const result = await runCommandHandler(store, { type: 'project.create', name: 'Demo', path: '/tmp/demo' }, 4)
  assert.equal(result.ok, true)
  assert.equal(result.projectId, 'project-new')
  assert.equal(result.workspace.workspaceRevision > 4, true)
  assert.equal(store.read().projects.some((project) => project.id === 'project-new'), true)
})

test('handler rejects a stale expectedRevision without writing', async () => {
  const store = createStore(createState())
  const result = await runCommandHandler(store, { type: 'project.remove', projectId: 'project-2' }, 3)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'workspace-conflict')
  assert.equal(store.read().projects.length, 2)
})

test('handler reports a failed readback instead of claiming success', async () => {
  const store = createStore(createState())
  const result = await runCommandHandler(store, { type: 'project.relocate', projectId: 'project-2', path: '/moved' }, 4, {
    corruptAfterSave: (state) => ({ ...state, projects: state.projects.map((project) => project.id === 'project-2' ? { ...project, path: '/one' } : project) }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'workspace-save-failed')
})

test('handler is a no-op write when the command changes nothing', async () => {
  const store = createStore(createState())
  const before = store.read()
  const result = await runCommandHandler(store, { type: 'project.setPinned', projectId: 'project-2', pinned: false }, 4)
  assert.equal(result.ok, true)
  assert.equal(store.read(), before, 'unchanged commands must not bump the revision')
})
