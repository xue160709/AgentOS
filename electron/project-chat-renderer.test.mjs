import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadWorkspaceSession(cache = new Map()) {
  const modulePath = resolve(testDir, '../src/components/workspace-session.ts')
  const cached = cache.get(modulePath)
  if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: modulePath,
  })
  const module = { exports: {} }
  cache.set(modulePath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(modulePath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadWorkspaceSessionModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function loadWorkspaceSessionModule(modulePath, cache) {
  const cached = cache.get(modulePath)
  if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: modulePath,
  })
  const module = { exports: {} }
  cache.set(modulePath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(modulePath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadWorkspaceSessionModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function snapshot(sequence, generation = 1) {
  return {
    projectId: 'project-1', project: { id: 'project-1', name: 'Project', pathMissing: false }, workspaceRevision: sequence,
    sequence, routeGeneration: generation, threads: [], runs: [], pendingPrompts: [], permissionMode: 'auto', unreadExternalTaskCount: 0,
  }
}

test('renderer snapshot controller discards duplicates and stale generations, and detects gaps', () => {
  const { ProjectChatSnapshotController } = loadWorkspaceSession()
  const controller = new ProjectChatSnapshotController()
  controller.adopt(snapshot(10, 2))
  assert.equal(controller.accept({ type: 'snapshot', projectId: 'project-1', sequence: 10, routeGeneration: 2, workspaceRevision: 10, snapshot: snapshot(10, 2) }), 'discarded')
  assert.equal(controller.accept({ type: 'snapshot', projectId: 'project-1', sequence: 9, routeGeneration: 2, workspaceRevision: 9, snapshot: snapshot(9, 2) }), 'discarded')
  assert.equal(controller.accept({ type: 'snapshot', projectId: 'project-1', sequence: 11, routeGeneration: 1, workspaceRevision: 11, snapshot: snapshot(11, 1) }), 'discarded')
  assert.equal(controller.accept({ type: 'snapshot', projectId: 'project-1', sequence: 12, routeGeneration: 2, workspaceRevision: 12, snapshot: snapshot(12, 2) }), 'gap')
  assert.equal(controller.accept({ type: 'snapshot', projectId: 'project-1', sequence: 11, routeGeneration: 2, workspaceRevision: 11, snapshot: snapshot(11, 2) }), 'accepted')
})

test('main Chat routes broker mode through Project Chat APIs and stops renderer workspace saves', () => {
  const chatPage = readFileSync(resolve(testDir, '../src/components/chat/ChatPage.tsx'), 'utf8')
  const appShell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  assert.match(chatPage, /if \(projectChatEnabled\) \{[\s\S]*?api\.submitRun/)
  assert.match(chatPage, /activePrompt\?\.isOwnedByCaller/)
  assert.match(chatPage, /当前对话正在处理中，请等待完成后再发送。/)
  assert.doesNotMatch(chatPage, /saveChatWorkspace|persistChatWorkspaceState/)
  assert.match(appShell, /if \(projectChatEnabled\) return\s+workspaceSession\.stage/)
  assert.match(appShell, /initializePermissionMode\(legacy\)/)
})

test('Project window reuses the snapshot Chat surface while persisting only local selected thread and draft', () => {
  const projectWindow = readFileSync(resolve(testDir, '../src/components/chat/ProjectChatWindowPage.tsx'), 'utf8')
  const chatPage = readFileSync(resolve(testDir, '../src/components/chat/ChatPage.tsx'), 'utf8')
  const appShell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  assert.match(projectWindow, /ProjectChatSnapshotController/)
  assert.match(projectWindow, /saveWindowViewState/)
  assert.match(projectWindow, /reportPresenceSelection/)
  assert.match(projectWindow, /<ChatPage/)
  assert.match(projectWindow, /项目专属 Chat/)
  assert.match(projectWindow, /新建对话/)
  assert.match(projectWindow, /setCreatingNewThread\(true\)/)
  assert.match(projectWindow, /setNewThreadModelPick\(pick\)/)
  assert.doesNotMatch(projectWindow, /new WorkspaceSession|applyProjectChatSnapshot/)
  assert.match(chatPage, /projectWindow\?: \{ draft: string; onDraftChange/)
  assert.match(chatPage, /if \(projectChatEnabled\)/) // public project bridge remains the branch owner
  assert.match(chatPage, /creatingThread \? newThreadModelPick \?\? currentModelPickRef\.current/)
  assert.match(appShell, /打开项目 Chat 窗口/)
  assert.match(appShell, /openProjectWindow\(activeProject\.id\)/)
})
