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

  for (const capability of Object.keys(DESKTOP_INVOKE_CHANNELS)) {
    assert.match(preload, new RegExp(`DESKTOP_INVOKE_CHANNELS\\.${capability}\\b`), `preload forwards ${capability}`)
    if (capability !== 'getAppVersion') {
      assert.match(registrationSource, new RegExp(`DESKTOP_INVOKE_CHANNELS\\.${capability}\\b`), `main registers ${capability}`)
    }
  }

  for (const capability of Object.keys(DESKTOP_EVENT_CHANNELS)) {
    assert.match(preload, new RegExp(`DESKTOP_EVENT_CHANNELS\\.${capability}\\b`), `preload subscribes ${capability}`)
    assert.match(eventProducerSource, new RegExp(`DESKTOP_EVENT_CHANNELS\\.${capability}\\b`), `main emits ${capability}`)
  }

  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(['"](?:desktop|desktop-preferences|chat-workspace|app-updater):/)
  assert.doesNotMatch(registrationSource, /ipcMain\.handle\(['"](?:desktop|desktop-preferences|chat-workspace|app-updater):/)
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
