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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath,
  })
  const module = { exports: {} }; cache.set(resolvedPath, module)
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

function state({ projects = [], tabs = [{ id: 'tab-home', runtimeDefinitionId: 'runtime-home', title: 'Homepage', createdAt: 1, updatedAt: 1 }] } = {}) {
  return {
    workspaceRevision: 1, activeProjectId: 'test1', activeThreadId: '', projects, threads: [],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: [] },
    runtimeDefinitions: [{ id: 'runtime-home', name: 'Homepage Runtime', rootPath: '/work/homepage', canonicalRoot: '/work/homepage', packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] }, trustStatus: 'trusted', autoStart: true, createdAt: 1, updatedAt: 1 }],
    workspaceTabs: tabs, activeWorkspaceTabId: 'tab-home', projectHomeViewModes: {}, localAppDefinitions: [], localAppTabs: [], activeLocalAppTabId: 'tab-home',
  }
}

function ensure(input) {
  const { ensureWorkspaceTabProject } = loadTsModule(resolve(testDir, './workspace-tab-project.ts'))
  return ensureWorkspaceTabProject({ workspace: state(input), workspaceTabId: 'tab-home', canonicalRoot: '/work/homepage', now: 10, createProjectId: () => 'homepage-project' })
}

function loadOpener() { return loadTsModule(resolve(testDir, './workspace-tab-project-chat.ts')) }

test('Workspace tab Project binding reuses the unique matching path and repairs stale links', () => {
  const resolved = ensure({ projects: [
    { id: 'test1', name: 'Test', path: '/work/test1', createdAt: 1, updatedAt: 1 },
    { id: 'homepage', name: 'Homepage', path: '/work/homepage/', createdAt: 1, updatedAt: 1 },
  ], tabs: [{ id: 'tab-home', runtimeDefinitionId: 'runtime-home', projectId: 'test1', title: 'Homepage', createdAt: 1, updatedAt: 1 }] })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.project.id, 'homepage')
  assert.equal(resolved.workspace.workspaceTabs[0].projectId, 'homepage')
  assert.equal(resolved.workspace.projects.length, 2)
})

test('Workspace tab Project binding creates once and the next tab with the same root reuses it', () => {
  const first = ensure({})
  assert.equal(first.ok, true)
  assert.equal(first.project.id, 'homepage-project')
  assert.equal(first.workspace.projects.length, 1)
  const secondTab = { id: 'tab-home-2', runtimeDefinitionId: 'runtime-home', title: 'Homepage second view', createdAt: 2, updatedAt: 2 }
  const { ensureWorkspaceTabProject } = loadTsModule(resolve(testDir, './workspace-tab-project.ts'))
  const second = ensureWorkspaceTabProject({ workspace: { ...first.workspace, workspaceTabs: [...first.workspace.workspaceTabs, secondTab] }, workspaceTabId: 'tab-home-2', canonicalRoot: '/work/homepage', now: 11, createProjectId: () => 'should-not-create' })
  assert.equal(second.ok, true)
  assert.equal(second.project.id, 'homepage-project')
  assert.equal(second.workspace.projects.length, 1)
  assert.equal(second.workspace.workspaceTabs.find((tab) => tab.id === 'tab-home-2').projectId, 'homepage-project')
})

test('Workspace tab Project binding refuses ambiguous duplicate durable paths', () => {
  const resolved = ensure({ projects: [
    { id: 'a', name: 'A', path: '/work/homepage', createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'B', path: '/work/homepage', createdAt: 1, updatedAt: 1 },
  ] })
  assert.equal(resolved.ok, false)
  assert.equal(resolved.code, 'workspace-tab-project-ambiguous')
})

test('Workspace Tab Chat opens the canonical backing Project, never the previously active Project', async () => {
  const { openWorkspaceTabProjectChat } = loadOpener()
  let durable = state({ projects: [{ id: 'test1', name: 'Test', path: '/work/test1', createdAt: 1, updatedAt: 1 }] })
  const opened = []
  const result = await openWorkspaceTabProjectChat('tab-home', {
    store: { read: () => durable, save: async (next) => { durable = next; return next } },
    canonicalizePath: async (value) => value,
    createProjectId: () => 'homepage-project', now: () => 10,
    openProjectWindow: async (projectId) => { opened.push(projectId) },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(opened, ['homepage-project'])
  assert.equal(durable.workspaceTabs[0].projectId, 'homepage-project')
  assert.equal(durable.activeProjectId, 'test1', 'the operation must not use activeProjectId as authority')
})

test('Workspace Tab Chat reuses an existing path match and does not open after save/readback failure', async () => {
  const { openWorkspaceTabProjectChat } = loadOpener()
  let durable = state({ projects: [{ id: 'homepage', name: 'Homepage', path: '/work/homepage', createdAt: 1, updatedAt: 1 }] })
  const opened = []
  const reused = await openWorkspaceTabProjectChat('tab-home', {
    store: { read: () => durable, save: async (next) => { durable = next; return next } },
    canonicalizePath: async (value) => value,
    createProjectId: () => 'unexpected', now: () => 10,
    openProjectWindow: async (projectId) => { opened.push(projectId) },
  })
  assert.equal(reused.ok, true)
  assert.deepEqual(opened, ['homepage'])

  const original = state()
  const failed = await openWorkspaceTabProjectChat('tab-home', {
    store: { read: () => original, save: async () => { throw new Error('disk full') } },
    canonicalizePath: async (value) => value,
    createProjectId: () => 'homepage-project', now: () => 10,
    openProjectWindow: async (projectId) => { opened.push(projectId) },
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'internal-error')
  assert.deepEqual(opened, ['homepage'], 'a failed link is never followed by window open')
})

test('Revision 3 Workspace entries preserve legacy helpers but make the backing Project path unreachable', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  const shell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  const types = readFileSync(resolve(testDir, '../src/components/types.ts'), 'utf8')
  const createStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.createWorkspaceTab')
  const createEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openWorkspaceTab', createStart)
  const openEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.closeWorkspaceTab', createEnd)
  const entryHandlers = main.slice(createStart, openEnd)
  assert.ok(createStart >= 0 && createEnd > createStart && openEnd > createEnd)
  assert.doesNotMatch(entryHandlers, /ensureWorkspaceTabProject|projectId:\s*linked|activeProjectId:\s*linked/)
  assert.match(entryHandlers, /persisted\.activeProjectId !== current\.activeProjectId/)
  assert.doesNotMatch(shell, /openWorkspaceTabProjectChat|startLocalAppDevelopment/)
  assert.doesNotMatch(shell, /workspaceSession\.selectWorkspaceTab/)
  assert.match(shell, /activeWorkspaceTabId: tabId, activeLocalAppTabId: tabId, activeThreadId: ''/)
  assert.match(main, /openWorkspaceTabProjectChat: async \(\) => \(\{ ok: false/)
  assert.match(types, /@deprecated Revision 2 compatibility only; new Workspace Runtime entries never write or follow this link/)
})
