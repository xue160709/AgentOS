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
