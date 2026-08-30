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
  // `FIX-CHAT-01`: probing is not legacy, so only an explicit legacy readiness
  // may reach the Revision 1 durable writer.
  assert.match(appShell, /if \(projectChatReadiness !== 'legacy'\) return\s+workspaceSession\.stage/)
  assert.match(appShell, /initializePermissionMode\(legacy\)/)
})

test('main sidebar routes thread and workspace mutations to Main-owned intents', () => {
  const appShell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')

  // FIX-WS-01: project lifecycle and preferences are Main commands, never
  // renderer reducers, and they are not branched on Project Chat readiness.
  assert.doesNotMatch(
    appShell,
    /workspaceSession\.(addProject|removeProject|relocateProject|toggleProjectPinned|reorderProject|toggleSidebar|toggleProjectCollapsed|setProjectHomeViewMode)\b/,
  )
  for (const type of ['project.create', 'project.remove', 'project.relocate', 'project.setPinned', 'project.reorder']) {
    assert.ok(appShell.includes(`type: '${type}'`), `missing workspace command ${type}`)
  }
  assert.match(appShell, /workspaceCommandClient\.queuePreferences\(/)
  assert.doesNotMatch(appShell, /saveChatWorkspace\(/)

  // FIX-CHAT-01: archive/pin go through the broker, and the legacy stop/cancel
  // path is only reachable in explicit legacy mode.
  assert.match(appShell, /threadIntentClient\.archive\(/)
  assert.match(appShell, /threadIntentClient\.setPinned\(/)
  const archiveStart = appShell.indexOf('const archiveThread = useCallback')
  const archiveEnd = appShell.indexOf('const isThreadBusy = useCallback', archiveStart)
  assert.ok(archiveStart >= 0 && archiveEnd > archiveStart)
  const archive = appShell.slice(archiveStart, archiveEnd)
  assert.ok(
    archive.indexOf("projectChatReadinessRef.current === 'legacy'") < archive.indexOf('claudeChat.cancel'),
    'implicit cancel must live inside the legacy branch only',
  )
  assert.ok(
    archive.indexOf("projectChatReadinessRef.current === 'legacy'") < archive.indexOf('stopTaskHomePlugin'),
    'implicit task stop must live inside the legacy branch only',
  )
  assert.match(archive, /if \(wasActive\) goHome\(\)/)
})

test('Project window reuses the snapshot Chat surface while persisting only local selected thread and draft', () => {
  const projectWindow = readFileSync(resolve(testDir, '../src/components/chat/ProjectChatWindowPage.tsx'), 'utf8')
  const chatPage = readFileSync(resolve(testDir, '../src/components/chat/ChatPage.tsx'), 'utf8')
  const appShell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  assert.match(projectWindow, /ProjectChatSnapshotController/)
  assert.match(projectWindow, /saveWindowViewState/)
  assert.match(projectWindow, /reportPresenceSelection/)
  assert.match(projectWindow, /<ChatPage/)
  assert.doesNotMatch(projectWindow, /openProjectPreview|projectChatWindow\.viewWorkbench/)
  assert.match(projectWindow, /projectChatWindow\.newThread/)
  assert.match(projectWindow, /setCreatingNewThread\(true\)/)
  assert.match(projectWindow, /setNewThreadModelPick\(pick\)/)
  assert.match(projectWindow, /event\.type === 'select-thread'[\s\S]{0,280}setSelectedThreadId\(event\.threadId\)/)
  assert.doesNotMatch(projectWindow, /new WorkspaceSession|applyProjectChatSnapshot/)
  assert.match(chatPage, /projectWindow\?: \{ draft: string; onDraftChange/)
  assert.match(chatPage, /if \(projectChatEnabled\)/) // public project bridge remains the branch owner
  assert.match(chatPage, /creatingThread \? newThreadModelPick \?\? currentModelPickRef\.current/)
  assert.match(appShell, /onOpenRuntimeChatWindow/)
  assert.match(appShell, /openWorkspaceTabProjectChat\(activeWorkspaceTab\.id\)/)
  assert.match(appShell, /window\.projectChat\?\.startProjectRuntimeChat\(activeProject\.id\)/)
  assert.doesNotMatch(appShell, /chatRef\.current\?\.submitPromptInNewThread/)
})

test('Project Chat enables broker-owned rewind without exposing durable checkpoints', () => {
  const chatPage = readFileSync(resolve(testDir, '../src/components/chat/ChatPage.tsx'), 'utf8')
  const threadView = readFileSync(resolve(testDir, '../src/components/chat/ChatThreadView.tsx'), 'utf8')
  const transcript = readFileSync(resolve(testDir, '../src/components/chat/Transcript.tsx'), 'utf8')
  const projectWindow = readFileSync(resolve(testDir, '../src/components/chat/ProjectChatWindowPage.tsx'), 'utf8')
  const contract = readFileSync(resolve(testDir, '../src/project-chat-contract.ts'), 'utf8')

  assert.match(chatPage, /rewindUsesBrokerLookup=\{projectChatEnabled\}/)
  assert.match(threadView, /rewindUsesBrokerLookup=\{rewindUsesBrokerLookup\}/)
  assert.match(transcript, /item\.status !== 'reverted' && \(rewindUsesBrokerLookup \|\| item\.checkpointId\)/)
  assert.match(projectWindow, /if \(item\.type === 'file_diff'\) return \{ \.\.\.item, requestId: '', files:/)
  assert.match(contract, /RewindProjectFileDiffInput = \{ projectId: string; threadId: string; changeSetId: string; routeGeneration: number \}/)
  assert.doesNotMatch(contract, /RewindProjectFileDiffInput = \{[^}]*checkpointId/)
})
