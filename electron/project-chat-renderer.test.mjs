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
  assert.match(chatPage, /if \(projectChatEnabled\) \{[\s\S]*?chatBridge\.submitRun/)
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
  assert.match(chatPage, /modelRowForPick\(modelMenuRows, requestedPick\)/)
  assert.match(appShell, /openRuntimeDevelopment\?\.\(target\)/)
  assert.match(appShell, /endRuntimeDevelopment\?\.\(target\)/)
  assert.match(appShell, /kind: 'workspace-runtime', workspaceTabId: activeWorkspaceTab\.id/)
  assert.match(appShell, /kind: 'project-runtime', projectId: activeProject\.id, mountId: projectRuntimeState\.mountId/)
  assert.doesNotMatch(appShell, /openWorkspaceTabProjectChat|startProjectRuntimeChat|startLocalAppDevelopment/)
  assert.doesNotMatch(appShell, /chatRef\.current\?\.submitPromptInNewThread/)
})

test('Runtime development window uses only the Runtime Chat profile and keeps query identity non-authoritative', () => {
  const preload = readFileSync(resolve(testDir, './preload.ts'), 'utf8')
  const runtimePage = readFileSync(resolve(testDir, '../src/components/chat/RuntimeDevelopmentWindowPage.tsx'), 'utf8')
  const rendererMain = readFileSync(resolve(testDir, '../src/main.tsx'), 'utf8')
  const manager = readFileSync(resolve(testDir, './runtime-development-window-manager.ts'), 'utf8')
  assert.match(preload, /isRuntimeDevelopmentWindowProfile\(\)[\s\S]{0,260}exposeInMainWorld\('runtimeChat', runtimeChatAdapter\)/)
  assert.match(preload, /if \(isRuntimeDevelopmentWindowProfile\(\)\)[\s\S]*?else if \(isProjectChatWindowProfile\(\)\)/)
  assert.doesNotMatch(runtimePage, /window\.desktop|window\.projectChat|rootPath|runtimeRoot|projectId/)
  assert.match(runtimePage, /runtimeChatApi\(\)\?\.reportPresenceSelection/)
  assert.match(rendererMain, /runtimeDevelopmentWindow \? <RuntimeDevelopmentWindowPage/)
  assert.match(manager, /Main 注册的 webContents capability 才是 authority/) // query is display routing only
  assert.match(manager, /private nativeClose[\s\S]{0,420}this\.beginClose\(entry\)[\s\S]{0,180}this\.flush\(entry\)/)
  assert.match(manager, /private beginClose[\s\S]{0,220}this\.options\.requestExit\(entry\.authority\)/)
  assert.match(runtimePage, /useI18n\(\)/)
  assert.match(runtimePage, /aria-busy=\{pageBusy\}/)
  assert.match(runtimePage, /role=\{development\?\.errorCode[\s\S]{0,180}'alert' : 'status'\}/)
  assert.match(runtimePage, /aria-live="polite"/)
  assert.doesNotMatch(runtimePage, /\.error\.message|error\.stack|readyUrl|previewUrl/)
})

test('Runtime development window reuses the main-window Chat surface instead of hand-rolling one', () => {
  const runtimePage = readFileSync(resolve(testDir, '../src/components/chat/RuntimeDevelopmentWindowPage.tsx'), 'utf8')
  const projectWindow = readFileSync(resolve(testDir, '../src/components/chat/ProjectChatWindowPage.tsx'), 'utf8')
  const bridge = readFileSync(resolve(testDir, '../src/components/chat/chat-bridge.ts'), 'utf8')
  const adapter = readFileSync(resolve(testDir, '../src/components/chat/runtime-chat-adapter.ts'), 'utf8')
  const chatPage = readFileSync(resolve(testDir, '../src/components/chat/ChatPage.tsx'), 'utf8')

  // 两个独立窗口共用同一套 Chat 组件树与窗口外壳样式。
  for (const page of [runtimePage, projectWindow]) {
    assert.match(page, /import \{ ChatPage \} from '\.\/ChatPage'/)
    assert.match(page, /<ChatPage/)
    assert.match(page, /import '\.\/chat-window\.css'/)
    assert.match(page, /className="chat-window chat-window--ready"/)
  }
  assert.match(runtimePage, /chatBridge=\{chatBridge\}/)
  assert.match(runtimePage, /createRuntimeChatBridge\(\)/)
  assert.match(runtimePage, /submitBlockedReason=\{submitBlockedReason\}/)
  // Runtime 页面不再自绘 transcript / composer。
  assert.doesNotMatch(runtimePage, /<textarea|runtime-development-window__/)

  // scope 身份只在 bridge 与 adapter 里绑定；ChatPage 只发 scope 内标识。
  assert.match(bridge, /createProjectChatBridge/)
  assert.doesNotMatch(chatPage, /window\.projectChat/)
  assert.match(chatPage, /chatBridge\?: ChatBridge/)
  assert.match(chatPage, /injectedChatBridge \?\? \(projectChatEnabled \? createProjectChatBridge/)
  assert.match(adapter, /runtimeScopeId/)
  assert.doesNotMatch(adapter, /window\.desktop|window\.projectChat/)
})

test('Runtime rollback gates every allowlisted development entry while preserving ordinary Project Chat', () => {
  const shell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  const workspace = readFileSync(resolve(testDir, '../src/components/AppShellWorkspace.tsx'), 'utf8')
  const runtimeWorkspace = readFileSync(resolve(testDir, '../src/components/RuntimeWorkspace.tsx'), 'utf8')
  const projectHome = readFileSync(resolve(testDir, '../src/components/chat/ProjectHomeRuntimeView.tsx'), 'utf8')
  assert.match(shell, /const runtimeDevelopmentEnabled = projectChatReadiness === 'enabled'/)
  assert.match(shell, /if \(!runtimeDevelopmentEnabled\) return/)
  assert.match(shell, /onOpenRuntimeDevelopmentThread=\{runtimeDevelopmentEnabled/)
  assert.match(workspace, /onDevelopmentAction=\{onRuntimeDevelopmentAction\}/)
  assert.match(runtimeWorkspace, /\{onDevelopmentAction \? <>/)
  assert.match(projectHome, /controller\.onDevelopmentAction \? <button/)
  assert.match(projectHome, /controller\.onCreate \? <button/)
  assert.match(shell, /const projectChatEnabled = projectChatReadiness !== 'legacy'/)
})

test('uninitialized Project Runtime is Main-derived and lease-gated before window creation or controlled submit', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  const contract = readFileSync(resolve(testDir, '../src/runtime-development-contract.ts'), 'utf8')
  assert.match(contract, /\| \{ kind: 'project-runtime'; projectId: string; mountId: string \}/)
  assert.doesNotMatch(contract, /project-runtime';[^\n]*(root|path)/i)
  assert.match(main, /canonicalizeProspectiveProjectRuntimeRoot\(project\.path\)/)
  const openStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openRuntimeDevelopment')
  const openEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.focusRuntimeDevelopmentConflict', openStart)
  const open = main.slice(openStart, openEnd)
  assert.ok(open.indexOf('acquireProspective(authority)') < open.indexOf('runtimeDevelopmentWindowManager.open'), 'prospective lease must precede BrowserWindow open')
  assert.ok(open.indexOf('acquireProspective(authority)') < open.indexOf('submitControlledRuntimeCreationPrompt'), 'prospective lease must precede controlled submit')
  assert.match(open, /runtimeDevelopmentWindowManager\.close[\s\S]{0,180}runtimeDevelopmentRuntimeBridge\.abort\(authority\)/)
  assert.match(main, /invalidateRuntimeDevelopmentRoute[\s\S]{0,700}runtimeDevelopmentRuntimeBridge\?\.invalidate/)
  assert.match(main, /prepareForAppQuit[\s\S]{0,700}releaseProspectiveLeases/)
  assert.match(main, /bindProspectiveProjectRuntimeDefinition\(committed\.definition\)/)
})

test('destructive Runtime ownership changes are busy-fenced, stop before mutation, and invalidate old routes', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  assert.match(main, /runtimeDevelopmentBusy\(projectRuntimeScopeId\(destructiveProjectId\)\)/)
  assert.match(main, /runtime-development-busy/)
  assert.match(main, /invalidateRuntimeDevelopmentRoute\(/)
  const revokeStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.revokeRuntimeTrust')
  const revokeEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getRuntime', revokeStart + 6)
  const revoke = main.slice(revokeStart, revokeEnd > revokeStart ? revokeEnd : undefined)
  assert.ok(revoke.indexOf('localAppRuntimeManager?.stop') < revoke.indexOf('localAppTrustStore?.revoke'), 'trust must remain durable until every bounded stop succeeds')
  const workspaceStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.applyWorkspaceCommand')
  const workspaceEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getRuntimePreviewLayout', workspaceStart + 6)
  const workspaceCommand = main.slice(workspaceStart, workspaceEnd > workspaceStart ? workspaceEnd : undefined)
  assert.ok(workspaceCommand.indexOf('localAppRuntimeManager?.stop') < workspaceCommand.indexOf('getChatWorkspaceStore().save(proposed)'), 'remove/relocate must stop before durable owner/path mutation')
  assert.match(main, /const historical = runtimeDevelopmentThreadStore\?\.read\(\)\.runtimeDevelopmentThreads\.find/)
  assert.match(main, /available: false/)
})

test('global search marks Runtime history and opens it through the Main thread resolver', () => {
  const main = readFileSync(resolve(testDir, './main.ts'), 'utf8')
  const search = readFileSync(resolve(testDir, '../src/components/AppSearchModal.tsx'), 'utf8')
  const shell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  assert.match(main, /runtimeDevelopmentThreadStore\?\.search\(/)
  assert.match(main, /metadata: item\.metadata/)
  assert.match(main, /DESKTOP_INVOKE_CHANNELS\.openRuntimeDevelopmentThread/)
  assert.match(main, /runtimeDevelopmentThreadStore\?\.read\(\)\.runtimeDevelopmentThreads\.find/)
  assert.match(search, /metadata\.scopeKind === 'runtime-development'/)
  assert.match(search, /onOpenRuntimeDevelopmentThread\?\.\(hit\.message\.threadId\)/)
  assert.match(shell, /openRuntimeDevelopmentThread\?\.\(threadId\)/)
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
