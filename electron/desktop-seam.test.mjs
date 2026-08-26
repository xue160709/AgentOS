import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = resolve(import.meta.dirname, '..')

function loadDesktopSeamContract() {
  const modulePath = resolve(root, 'src/desktop-seam.ts')
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

test('Desktop seam exposes only named adapters to the renderer', () => {
  const preload = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8')
  const windowTypes = readFileSync(resolve(root, 'electron/electron-env.d.ts'), 'utf8')

  assert.doesNotMatch(preload, /exposeInMainWorld\(['"]ipcRenderer['"]/)
  assert.doesNotMatch(windowTypes, /\bipcRenderer\s*:/)
  assert.match(preload, /satisfies DesktopAPI/)
  assert.match(windowTypes, /desktop\?: DesktopAPI/)
})

test('Desktop interface does not leak generic IPC primitives', () => {
  const desktopInterface = readFileSync(resolve(root, 'src/desktop-api.ts'), 'utf8')

  assert.doesNotMatch(desktopInterface, /^\s*(invoke|send|on|off)\??\s*:/m)
  assert.match(desktopInterface, /export type DesktopAPI/)
})

test('Desktop seam contract drives preload forwarding and main registration', () => {
  const {
    DESKTOP_EVENT_CHANNELS,
    DESKTOP_INVOKE_CHANNELS,
    DESKTOP_STATIC_CAPABILITIES,
  } = loadDesktopSeamContract()
  const preload = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8')
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const appUpdater = readFileSync(resolve(root, 'electron/app-updater.ts'), 'utf8')
  const speechRecognition = readFileSync(resolve(root, 'electron/speech-recognition.ts'), 'utf8')
  const registrationSource = `${main}\n${appUpdater}`
  const eventProducerSource = `${main}\n${appUpdater}\n${speechRecognition}`

  assert.deepEqual(DESKTOP_STATIC_CAPABILITIES, ['platform', 'isDevRuntime', 'windowEffects'])
  assert.equal(DESKTOP_INVOKE_CHANNELS.getAppVersion, DESKTOP_INVOKE_CHANNELS.getAppUpdaterState)
  assert.equal(DESKTOP_INVOKE_CHANNELS.createWorkspaceTab, 'desktop:workspace-tab:create')
  assert.equal(DESKTOP_INVOKE_CHANNELS.openWorkspaceTab, 'desktop:workspace-tab:open')
  assert.equal(DESKTOP_INVOKE_CHANNELS.closeWorkspaceTab, 'desktop:workspace-tab:close')

  for (const capability of Object.keys(DESKTOP_INVOKE_CHANNELS)) {
    assert.match(preload, new RegExp(`DESKTOP_INVOKE_CHANNELS\\.${capability}\\b`), `preload forwards ${capability}`)
    if (capability !== 'getAppVersion' && !['inspectLocalAppDirectory', 'trustLocalAppDirectory', 'createLocalApp', 'openLocalAppTab', 'closeLocalAppTab', 'relocateLocalApp', 'revokeLocalAppTrust', 'getLocalAppRuntime', 'startLocalAppRuntime', 'stopLocalAppRuntime', 'releaseLocalAppRuntime', 'restartLocalAppRuntime', 'buildLocalAppRuntime', 'cancelLocalAppRuntimeBuild', 'createLocalAppPreview', 'setLocalAppPreviewBounds', 'setLocalAppPreviewVisible', 'reloadLocalAppPreview', 'closeLocalAppPreview', 'inspectRuntimeDirectory', 'trustRuntimeDirectory', 'createWorkspaceTab', 'openWorkspaceTab', 'closeWorkspaceTab', 'renameWorkspaceTab', 'relocateRuntime', 'revokeRuntimeTrust', 'getRuntime', 'startRuntime', 'stopRuntime', 'releaseRuntime', 'restartRuntime', 'buildRuntime', 'cancelRuntimeBuild', 'startRuntimeDevelopment', 'createRuntimePreview', 'setRuntimePreviewBounds', 'setRuntimePreviewVisible', 'reloadRuntimePreview', 'closeRuntimePreview', 'ensureProjectRuntime', 'trustProjectRuntime'].includes(capability)) {
      assert.match(registrationSource, new RegExp(`DESKTOP_INVOKE_CHANNELS\\.${capability}\\b`), `main registers ${capability}`)
    }
  }

  for (const capability of Object.keys(DESKTOP_EVENT_CHANNELS)) {
    assert.match(preload, new RegExp(`DESKTOP_EVENT_CHANNELS\\.${capability}\\b`), `preload subscribes ${capability}`)
    if (!['onRuntimeEvent', 'onLocalAppRuntimeEvent'].includes(capability)) assert.match(eventProducerSource, new RegExp(`DESKTOP_EVENT_CHANNELS\\.${capability}\\b`), `main emits ${capability}`)
  }

  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(['"](?:desktop|desktop-preferences|chat-workspace|app-updater):/)
  assert.doesNotMatch(registrationSource, /ipcMain\.handle\(['"](?:desktop|desktop-preferences|chat-workspace|app-updater):/)
})

test('Static build keeps last-good Preview alive and cancellation uses the build seam', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const buildStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.buildRuntime')
  const buildEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.cancelRuntimeBuild', buildStart)
  assert.ok(buildStart >= 0 && buildEnd > buildStart)
  const buildHandler = main.slice(buildStart, buildEnd)
  const stopGuard = buildHandler.indexOf('if (currentRuntime && !isStaticRuntime)')
  assert.ok(stopGuard >= 0)
  assert.ok(stopGuard < buildHandler.indexOf('closeForLocalApp(id)'))
  assert.ok(stopGuard < buildHandler.indexOf("localAppRuntimeManager.stop(id, 'user')"))
  assert.doesNotMatch(main, /protocol\.handle\(STATIC_PREVIEW_SCHEME, \(request\) => staticPreviewResponse\(request, staticRegistry\)\)/)
  assert.match(buildHandler, /runtime\.buildStatus === 'build_failed'/)

  const runtime = readFileSync(resolve(root, 'electron/local-app-runtime/index.ts'), 'utf8')
  assert.match(runtime, /detached: process\.platform !== 'win32'/)
  const workspace = readFileSync(resolve(root, 'src/components/RuntimeWorkspace.tsx'), 'utf8')
  assert.match(workspace, /runtime-cancel-build/)
  assert.match(workspace, /onCancelBuild \?\? onStop/)
  const projectHome = readFileSync(resolve(root, 'src/components/chat/ProjectHomeRuntimeView.tsx'), 'utf8')
  assert.match(projectHome, /project-runtime-cancel-build/)
  assert.match(projectHome, /onCancelBuild \?\? controller\.onStop/)
  const preview = readFileSync(resolve(root, 'src/components/RuntimePreview.tsx'), 'utf8')
  assert.match(preview, /'building', 'build_failed'/)
  assert.doesNotMatch(preview, /runtime\?\.buildStatus, runtime\?\.mode/)
})

test('Local App Tab close is Main-authoritative and releases side effects only after readback', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const start = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.closeWorkspaceTab')
  const end = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.trustRuntimeDirectory', start)
  assert.ok(start >= 0 && end > start)
  const handler = main.slice(start, end)
  assert.match(handler, /runChatWorkspaceOperation/)
  assert.match(handler, /rawExpectedRevision/)
  assert.match(handler, /activeWorkspaceTabId/)
  assert.match(handler, /persisted\.workspaceTabs\.some\(\(item\) => item\.id === tabId\)/)
  assert.ok(handler.indexOf('await getChatWorkspaceStore().save(proposed)') < handler.indexOf('const persisted = getChatWorkspaceStore().read()'))
  assert.ok(handler.indexOf('const persisted = getChatWorkspaceStore().read()') < handler.indexOf('await localAppPreviewManager?.closeForTab'))
  assert.ok(handler.indexOf('await localAppPreviewManager?.closeForTab') < handler.indexOf('localAppRuntimeManager?.release'))
  assert.match(handler, /localAppRuntimeManager\?\.release\(committed\.runtimeDefinitionId, `tab:\$\{committed\.tabId\}`\)/)
  assert.match(handler, /code: 'workspace-save-failed'/)
  const saveFailure = handler.slice(handler.indexOf("code: 'workspace-save-failed'"), handler.indexOf('if (!committed.ok)'))
  assert.doesNotMatch(saveFailure, /closeForTab|\.release\(/)

  const appShell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8')
  const closeStart = appShell.indexOf('const closeLocalAppTab')
  const closeEnd = appShell.indexOf('const renameLocalAppTab', closeStart)
  const closeFlow = appShell.slice(closeStart, closeEnd)
  assert.ok(closeFlow.indexOf('await workspaceSession.flush()') < closeFlow.indexOf('await window.desktop.getChatWorkspace()'))
  assert.ok(closeFlow.indexOf('await window.desktop.getChatWorkspace()') < closeFlow.indexOf('window.desktop.closeWorkspaceTab('))
  assert.ok(closeFlow.indexOf('window.desktop.closeWorkspaceTab(') < closeFlow.indexOf('flushSync(() => setChatWorkspace(result.workspace))'))
  assert.ok(closeFlow.indexOf('flushSync(() => setChatWorkspace(result.workspace))') < closeFlow.indexOf('persistChatWorkspaceStateToLocalStorage(result.workspace)'))
  assert.doesNotMatch(closeFlow, /releaseLocalAppRuntime/)
  const cleanupStart = appShell.indexOf('// --- Autosave through Workspace Session')
  const cleanupEnd = appShell.indexOf('// --- Routing helper', cleanupStart)
  assert.match(appShell.slice(cleanupStart, cleanupEnd), /workspaceSession\.flush\(\)\.catch/)
  assert.doesNotMatch(appShell.slice(cleanupStart, cleanupEnd), /workspaceSession\.close\(\)/)
})

test('Local App chooser opens existing tabs through the authoritative Main commit before Runtime attach', () => {
  const appShell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8')
  const openFlowStart = appShell.indexOf('const openExistingLocalApp')
  const openFlowEnd = appShell.indexOf('const stopLocalApp', openFlowStart)
  const openFlow = appShell.slice(openFlowStart, openFlowEnd)
  assert.ok(openFlow.indexOf('await workspaceSession.flush()') < openFlow.indexOf('await window.desktop.getChatWorkspace()'))
  assert.ok(openFlow.indexOf('await window.desktop.getChatWorkspace()') < openFlow.indexOf('window.desktop.openWorkspaceTab('))
  assert.ok(openFlow.indexOf('setChatWorkspace(result.workspace)') < openFlow.indexOf('startLocalApp(result.definition.id'))
  assert.match(appShell, /await setActiveLocalAppPreviewVisible\(false\)[\s\S]{0,120}setLocalAppChooserOpen\(true\)/)
  assert.doesNotMatch(appShell, /onChooseNew=\{\(\) => \{ setLocalAppChooserOpen\(false\); void inspectLocalApp\(\) \}\}/)
  const preview = readFileSync(resolve(root, 'src/components/RuntimePreview.tsx'), 'utf8')
  assert.match(preview, /setRuntimePreviewVisible\?\.\(previewId, false\)/)
  assert.match(preview, /closeRuntimePreview\?\.\(previewId\)/)
  assert.match(appShell, /const ensureTrustedProjectRuntime/)
  assert.match(appShell, /const openProjectRuntimeTab[\s\S]{0,500}ensureTrustedProjectRuntime\(\)/)
  const projectHomeRuntime = readFileSync(resolve(root, 'src/components/chat/ProjectHomeRuntimeView.tsx'), 'utf8')
  assert.doesNotMatch(projectHomeRuntime, /data-testid="project-runtime-open-tab"[^>]*disabled=\{!definition\}/)
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  assert.match(main, /closeForLocalApp\(rawId\.trim\(\)\)[\s\S]{0,120}localAppRuntimeManager\?\.stop\(rawId/)
  assert.match(main, /closeForTab\([\s\S]{0,120}localAppRuntimeManager\?\.release\(rawId\.trim\(\), consumerId/)
  assert.match(main, /if \(!host\) return localAppRuntimeManager\?\.release\(runtimeDefinitionId, consumerId\)/)
  const localWorkspace = readFileSync(resolve(root, 'src/components/LocalAppWorkspace.tsx'), 'utf8')
  assert.match(localWorkspace, /!showToolbar \? <span className="sr-only"/)
  assert.doesNotMatch(localWorkspace, /!showToolbar \? <div className="local-app-runtime-summary"/)
})

test('Local App creation keeps durable commit before runtime start in Main', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const start = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.createWorkspaceTab')
  const end = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.trustRuntimeDirectory', start)
  assert.ok(start >= 0 && end > start)
  const handler = main.slice(start, end)
  assert.ok(handler.indexOf('localAppTrustStore') < handler.indexOf('getChatWorkspaceStore().save(proposed)'))
  assert.ok(handler.indexOf('getChatWorkspaceStore().save(proposed)') < handler.indexOf('runtimeManager.register(committed.definition)'))
  assert.doesNotMatch(handler, /runtimeManager\.start\(/)
  assert.match(handler, /getChatWorkspaceStore\(\)\.read\(\)/)
  assert.match(handler, /const wasTrusted =/)
  assert.match(handler, /if \(!wasTrusted\) await trustStore\.revoke/)
  assert.match(handler, /const tabIds = new Set\(current\.workspaceTabs\.map/)
  assert.match(handler, /typeof rawTitle !== 'string' \|\| rawTitle\.trim\(\)\.length < 1 \|\| rawTitle\.trim\(\)\.length > 64/)
  assert.match(handler, /title: rawTitle\.trim\(\)/)
  assert.match(handler, /while \(tabIds\.has\(tabId\)\)/)
  assert.doesNotMatch(handler, /id: `\$\{definition\.id\}-tab`/)
  const appShell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8')
  const createFlow = appShell.slice(appShell.indexOf('const trustAndCreateLocalApp'), appShell.indexOf('const startLocalApp', appShell.indexOf('const trustAndCreateLocalApp')))
  assert.ok(createFlow.indexOf('await workspaceSession.flush()') >= 0)
  assert.ok(createFlow.indexOf('await workspaceSession.flush()') < createFlow.indexOf('await window.desktop.getChatWorkspace()'))
  assert.ok(createFlow.indexOf('await window.desktop.getChatWorkspace()') < createFlow.indexOf('window.desktop.createWorkspaceTab('))
  assert.match(createFlow, /catch \(error\)[\s\S]{0,260}setLocalAppDialogError\(message\)[\s\S]{0,80}return/)
  const successBranch = appShell.slice(appShell.indexOf('if (!result.ok)'), appShell.indexOf('} finally {', appShell.indexOf('if (!result.ok)')))
  assert.ok(successBranch.indexOf('setChatWorkspace(result.workspace)') < successBranch.indexOf('startRuntime(result.definition.id'))
})

test('Local App relocation gates the Main revision after renderer flush and returns authoritative workspace', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const mainStart = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.relocateRuntime')
  const mainEnd = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.revokeRuntimeTrust', mainStart)
  const handler = main.slice(mainStart, mainEnd)
  assert.match(handler, /rawExpectedRevision/)
  assert.ok(handler.indexOf('getChatWorkspaceStore().read()') < handler.indexOf('getChatWorkspaceStore().save(nextState)'))
  assert.ok(handler.indexOf('closeForLocalApp') < handler.indexOf('getChatWorkspaceStore().save(nextState)'))
  assert.ok(handler.indexOf('runtimeManager.stop(rawId') < handler.indexOf('getChatWorkspaceStore().save(nextState)'))
  assert.match(handler, /old-runtime-stop-failed/)
  assert.match(handler, /restoreOldRuntime/)
  assert.match(handler, /relocation-recovery-failed/)
  assert.ok(main.indexOf('getChatWorkspaceStore().save(nextState)') < main.indexOf('runtimeManager.register(committed.definition)', mainStart))
  assert.match(handler, /workspace: persisted/)
  assert.match(handler, /wasTrustedNewRoot/)
  assert.match(handler, /item\.id !== rawId[\s\S]{0,180}oldCanonicalRoot/)
  const appShell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8')
  const start = appShell.indexOf('const relocateLocalApp')
  const end = appShell.indexOf('useEffect(() => {', start)
  const flow = appShell.slice(start, end)
  assert.ok(flow.indexOf('await workspaceSession.flush()') < flow.indexOf('await window.desktop.getChatWorkspace()'))
  assert.ok(flow.indexOf('await window.desktop.getChatWorkspace()') < flow.indexOf('window.desktop.relocateRuntime('))
  assert.match(flow, /setChatWorkspace\(result\.workspace\)/)
})

test('Main Preview creation revalidates the authoritative tab and Runtime after native loading', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const start = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.createRuntimePreview')
  const end = main.indexOf('ipcMain.handle(DESKTOP_INVOKE_CHANNELS.setRuntimePreviewBounds', start)
  const handler = main.slice(start, end)
  assert.ok(handler.indexOf('await localAppPreviewManager.create(') < handler.indexOf('const authoritative = chatWorkspaceStore?.read()'))
  assert.ok(handler.indexOf('const authoritative = chatWorkspaceStore?.read()') < handler.indexOf('closeIfCurrent'))
  assert.match(handler, /currentTab\.runtimeDefinitionId === rawRuntimeDefinitionId/)
  assert.match(handler, /currentRuntime\.generation === runtime\.generation/)
  assert.match(handler, /registeredProjectRuntimeHost\(projectHost\.projectId, projectHost\.mountId/)
  assert.match(handler, /mountId/)
  assert.match(main, /projectRuntimeHosts = new Map/)
  const previewEvent = main.slice(main.indexOf('localAppPreviewManager = new LocalAppPreviewManager'), main.indexOf('attachExternalLinkHandlers'))
  assert.doesNotMatch(previewEvent, /localAppId:/)
  const appShell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8')
  const runtimeEventState = readFileSync(resolve(root, 'src/components/runtime-event-state.ts'), 'utf8')
  assert.match(appShell, /new RuntimeEventBatcher\(/)
  assert.match(runtimeEventState, /const runtimeDefinitionId = event\.runtimeDefinitionId\n/)
  assert.doesNotMatch(runtimeEventState.slice(runtimeEventState.indexOf('const next: RuntimeSnapshot'), runtimeEventState.indexOf('return \{ \.\.\.current, \[runtimeDefinitionId\]')),
    /localAppId:/)
})

test('Web search settings expose provider test seam and UI status hooks', () => {
  const desktopApi = readFileSync(resolve(root, 'src/desktop-api.ts'), 'utf8')
  const preload = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8')
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const settingsPage = readFileSync(resolve(root, 'src/components/setting/ClaudeAgentSettingsPage.tsx'), 'utf8')

  assert.match(desktopApi, /testGlobalWebSearchProvider\?:/)
  assert.match(preload, /DESKTOP_INVOKE_CHANNELS\.testGlobalWebSearchProvider/)
  assert.match(main, /DESKTOP_INVOKE_CHANNELS\.testGlobalWebSearchProvider/)
  assert.match(settingsPage, /data-testid="web-search-provider-test"/)
  assert.match(settingsPage, /data-testid="web-search-provider-test-status"/)
  assert.match(settingsPage, /data-testid="web-search-key-status"/)
})

test('Global MCP settings distinguish auto-test busy state from saving copy', () => {
  const settingsPage = readFileSync(resolve(root, 'src/components/setting/ClaudeAgentSettingsPage.tsx'), 'utf8')
  const zhLocale = readFileSync(resolve(root, 'src/locales/zh.json'), 'utf8')
  const enLocale = readFileSync(resolve(root, 'src/locales/en.json'), 'utf8')

  assert.match(settingsPage, /type GlobalMcpOperation = 'idle' \| 'saving' \| 'testing'/)
  assert.match(settingsPage, /setGlobalMcpOperation\('testing'\)[\s\S]{0,120}setGlobalMcpStatus\(t\('settings\.mcp\.testing/)
  assert.match(
    settingsPage,
    /operation === 'saving' \? t\('settings\.mcp\.saving'\) : t\('settings\.mcp\.save'\)/,
  )
  assert.doesNotMatch(
    settingsPage,
    /saving \? t\('settings\.mcp\.saving'\) : t\('settings\.mcp\.save'\)/,
  )
  assert.match(zhLocale, /"savingShort": "保存中"/)
  assert.match(enLocale, /"savingShort": "Saving"/)
})

test('Project MCP settings separate testing from saving and ignore stale async results', () => {
  const projectHomeSurface = readFileSync(resolve(root, 'src/components/chat/ProjectHomeSurface.tsx'), 'utf8')
  const panelStart = projectHomeSurface.indexOf('function McpSettingsPanel')
  const panelEnd = projectHomeSurface.indexOf('function CardOrderSettingsPanel')
  const modalStart = projectHomeSurface.indexOf('function AgentSettingsModal')
  const saveStart = projectHomeSurface.indexOf('const saveMcpSettings = async () =>')
  const refreshStart = projectHomeSurface.indexOf('const refreshProjectMcpProbeStatus = useCallback')
  assert.notEqual(panelStart, -1)
  assert.notEqual(panelEnd, -1)
  assert.notEqual(modalStart, -1)
  assert.notEqual(saveStart, -1)
  assert.notEqual(refreshStart, -1)
  const mcpPanel = projectHomeSurface.slice(panelStart, panelEnd)
  const agentSettingsModal = projectHomeSurface.slice(modalStart, panelStart)
  const saveMcpSettings = projectHomeSurface.slice(saveStart, refreshStart)

  assert.match(projectHomeSurface, /type ProjectMcpOperation = 'idle' \| 'saving' \| 'testing'/)
  assert.match(
    projectHomeSurface,
    /const \[mcpSettingsOperation, setMcpSettingsOperation\] = useState<ProjectMcpOperation>\('idle'\)/,
  )
  assert.match(projectHomeSurface, /agentSettingsLoadSeqRef\.current \+= 1/)
  assert.match(
    projectHomeSurface,
    /const isCurrentRequest = \(\) => agentSettingsLoadSeqRef\.current === requestSeq && projectPathRef\.current === requestProjectPath/,
  )
  assert.match(projectHomeSurface, /if \(!isCurrentRequest\(\)\) return[\s\S]{0,80}if \(!result\.ok\)/)
  assert.match(saveMcpSettings, /projectMcpProbeSeqRef\.current \+= 1/)
  assert.ok(saveMcpSettings.includes("setMcpSettingsOperation((operation) => (operation === 'testing' ? 'idle' : operation))"))
  assert.ok(saveMcpSettings.includes("setMcpSettingsOperation('saving')"))
  assert.match(
    projectHomeSurface,
    /setMcpSettingsOperation\('testing'\)[\s\S]{0,120}setMcpSettingsStatus\(t\('workspace\.agentSettingsMcpTestingEnabled'/,
  )
  assert.match(
    projectHomeSurface,
    /projectMcpProbeSeqRef\.current === requestSeq &&[\s\S]{0,120}agentSettingsPanelRef\.current === 'mcp'/,
  )
  assert.match(projectHomeSurface, /if \(projectPathRef\.current !== requestProjectPath\) return/)

  assert.match(mcpPanel, /operation: ProjectMcpOperation/)
  assert.match(mcpPanel, /const saving = operation === 'saving'/)
  assert.match(mcpPanel, /const testing = operation === 'testing'/)
  assert.match(mcpPanel, /disabled=\{saving \|\| testing\} onClick=\{onRefreshStatus\}/)
  assert.match(mcpPanel, /SaveFeedback status=\{status\} dirty=\{isDirty\} saving=\{saving\} busy=\{saving \|\| testing\}/)
  assert.doesNotMatch(mcpPanel, /saving: boolean/)
  assert.doesNotMatch(agentSettingsModal, /mcpSettingsSaving/)
})
