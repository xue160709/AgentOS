import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

test('Omni intent resolver runs Claude SDK in side-effect-free mode', () => {
  const main = read('electron/main.ts')
  const start = main.indexOf('async function resolveOmniIntent')
  const end = main.indexOf('function openMacApplication')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const source = main.slice(start, end)

  assert.match(source, /query\(\{/)
  assert.match(source, /allowedTools:\s*\[\]/)
  assert.match(source, /tools:\s*\[\]/)
  assert.match(source, /mcpServers:\s*\{\}/)
  assert.match(source, /settingSources:\s*\[\]/)
  assert.match(source, /skills:\s*\[\]/)
  assert.match(source, /maxTurns:\s*1/)
  assert.match(source, /abortController/)
  assert.match(source, /buildSdkEnv\(config\)/)
  assert.match(source, /summarizeSdkEnvForLog\(sdkEnv\)/)
  assert.doesNotMatch(source, /safeConsole(?:Info|Warn|Error)\([\s\S]{0,240}(?:apiKey|authToken)/)
})

test('system.openApp uses argument-vector open without shell interpolation', () => {
  const main = read('electron/main.ts')
  const start = main.indexOf('function openMacApplication')
  const end = main.indexOf('function submitVoiceCommand')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const source = main.slice(start, end)

  assert.match(source, /spawn\('\/usr\/bin\/open',\s*\['-a',\s*appName\]/)
  assert.match(source, /shell:\s*false/)
  assert.doesNotMatch(source, /\bexec\(/)
  assert.doesNotMatch(source, /\bshell\.open/)
})

test('system.openUrl routes Google page commands through openExternal', () => {
  const actions = read('src/multimodal/actions.ts')
  const config = read('src/multimodal/config.ts')
  const runtime = read('src/multimodal/AgentOsMultimodal.tsx')
  const main = read('electron/main.ts')

  assert.match(actions, /id:\s*'system\.openUrl'/)
  assert.match(config, /id:\s*'system\.openUrl\.google'/)
  assert.match(config, /https:\/\/www\.google\.com/)
  assert.match(config, /'system\.openUrl'/)
  assert.match(config, /For system\.openUrl/)
  assert.match(runtime, /useActionExecutor\(systemOpenUrlAction/)
  assert.match(runtime, /window\.desktop\.openExternal/)
  assert.match(runtime, /function normalizeExternalUrl/)
  assert.match(runtime, /Google 页面/)
  assert.match(main, /DESKTOP_INVOKE_CHANNELS\.openExternal/)
  assert.match(main, /isExternalHttpUrl\(rawUrl\)/)
})

test('Voice command window has isolated route, shortcut, and request/result IPC', () => {
  const main = read('electron/main.ts')
  const preload = read('electron/preload.ts')
  const voiceHtml = read('voice.html')
  const voiceRenderer = read('src/voice-main.tsx')
  const runtime = read('src/multimodal/AgentOsMultimodal.tsx')
  const appShell = read('src/components/AppShell.tsx')
  const style = read('src/style.css')
  const viteConfig = read('vite.config.ts')

  assert.match(main, /VOICE_COMMAND_SHORTCUT\s*=\s*'Option\+Space'/)
  assert.match(main, /loadURL\(`\$\{VITE_DEV_SERVER_URL\.replace\(\/\\\/\$\/,\s*''\)\}\/voice\.html`\)/)
  assert.match(main, /loadFile\(path\.join\(RENDERER_DIST,\s*'voice\.html'\)\)/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandRequest/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandResponse/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandResult/)
  assert.doesNotMatch(main, /voiceCommandWindow\.on\('blur'/)
  assert.match(main, /target\.show\(\)/)
  assert.match(preload, /onVoiceCommandRequest/)
  assert.match(preload, /onVoiceCommandResponse/)
  assert.match(preload, /onVoiceCommandResult/)
  assert.match(voiceHtml, /src="\/src\/voice-main\.tsx"/)
  assert.match(voiceRenderer, /consumer:\s*'voice-command'/)
  assert.match(voiceRenderer, /respondVoiceCommand/)
  assert.match(voiceRenderer, /import '\.\/style\.css'/)
  assert.match(voiceRenderer, /className="chat-composer voice-command-composer"/)
  assert.match(voiceRenderer, /className="chat-input"/)
  assert.match(voiceRenderer, /data-testid="voice-window-start"/)
  assert.match(voiceRenderer, /data-testid="voice-window-submit"/)
  assert.match(voiceRenderer, /data-testid="voice-window-final-input"/)
  assert.match(voiceRenderer, /data-testid="voice-window-confirm-card"/)
  assert.match(voiceRenderer, /data-testid="voice-window-clarify-list"/)
  assert.match(runtime, /return null/)
  assert.doesNotMatch(runtime, /omni-command-shell/)
  assert.match(appShell, /style=\{\{\s*display:\s*'contents'\s*\}\}/)
  assert.match(style, /#app\s*>\s*\[data-mm-root\]\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/)
  assert.match(style, /\.multimodal-page-root\s*\{[\s\S]*display:\s*contents;/)
  assert.match(viteConfig, /voice:\s*path\.resolve\(__dirname,\s*'voice\.html'\)/)
})

test('Speech recognition routes events to the active consumer window only', () => {
  const speechRecognition = read('electron/speech-recognition.ts')

  assert.match(speechRecognition, /activeConsumerWindowId:\s*number \| null/)
  assert.match(speechRecognition, /activeConsumer:\s*SpeechRecognitionConsumer \| null/)
  assert.match(speechRecognition, /BrowserWindow\.fromId\(this\.activeConsumerWindowId\)/)
  assert.match(speechRecognition, /isAuthorizedConsumer\(targetWindow\)/)
  assert.match(speechRecognition, /targetWindow\.id === this\.activeConsumerWindowId/)
  assert.match(speechRecognition, /this\.activeConsumer = options\.consumer \?\? 'composer'/)
  assert.match(speechRecognition, /this\.activeConsumerWindowId = null/)
})
