import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const OMNI_MANUAL_READINESS_SCENARIOS = [
  {
    id: 'desktop.close-to-tray',
    acceptanceFile: 'prd/desktop-shell-settings-release/acceptance.md',
    heading: '场景：启用 close-to-tray',
    checklistLabel: '`desktop-shell-settings-release` / 启用 close-to-tray',
    sourceChecks: [
      { file: 'electron/main.ts', pattern: /prefs\.closeToTray[\s\S]{0,120}event\.preventDefault\(\)[\s\S]{0,80}win\?\.hide\(\)/ },
      { file: 'electron/main.ts', pattern: /app\.on\('window-all-closed'[\s\S]{0,220}prefs\.closeToTray\) return/ },
      { file: 'src/components/setting/ProjectSkillsSettingsPage.tsx', pattern: /setDesktopPreferences\?\.\(\{ closeToTray: next \}\)/ },
    ],
  },
  {
    id: 'desktop.speech-authorized',
    acceptanceFile: 'prd/desktop-shell-settings-release/acceptance.md',
    heading: '场景：用户开始语音输入',
    checklistLabel: '`desktop-shell-settings-release` / 用户开始语音输入',
    sourceChecks: [
      { file: 'electron/main.ts', pattern: /DESKTOP_INVOKE_CHANNELS\.startSpeechRecognition/ },
      { file: 'src/components/chat/ChatPage.tsx', pattern: /startSpeechRecognition\?\.\(\{ requiresOnDevice: true \}\)/ },
      { file: 'src/components/chat/ChatPage.tsx', pattern: /setInputValue\(nextValue\)[\s\S]{0,120}setComposerSelection/ },
    ],
  },
  {
    id: 'desktop.speech-denied',
    acceptanceFile: 'prd/desktop-shell-settings-release/acceptance.md',
    heading: '场景：用户拒绝语音权限',
    checklistLabel: '`desktop-shell-settings-release` / 用户拒绝语音权限',
    sourceChecks: [
      { file: 'src/components/chat/ChatPage.tsx', pattern: /code === 'speech_denied'/ },
      { file: 'src/components/chat/ChatPage.tsx', pattern: /chat\.voiceSpeechDenied/ },
      { file: 'electron/speech-recognition.ts', pattern: /emitError\(/ },
    ],
  },
  {
    id: 'multimodal.live-sdk-fallback',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：规则未命中时由 SDK 解析执行',
    checklistLabel: '`multimodal-voice-control` / 规则未命中时由 SDK 解析执行',
    sourceChecks: [
      { file: 'electron/main.ts', pattern: /\[omni-intent\] start/ },
      { file: 'electron/main.ts', pattern: /\[omni-intent\] done/ },
      { file: 'electron/main.ts', pattern: /allowedTools:\s*\[\]/ },
      { file: 'src/multimodal/config.ts', pattern: /createLlmResolver/ },
    ],
  },
  {
    id: 'multimodal.voice-shortcut-command',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：快捷键唤起悬浮窗并完成一次语音命令',
    checklistLabel: '`multimodal-voice-control` / 快捷键唤起悬浮窗并完成一次语音命令',
    sourceChecks: [
      { file: 'electron/main.ts', pattern: /VOICE_COMMAND_SHORTCUT\s*=\s*'Option\+Space'/ },
      { file: 'electron/main.ts', pattern: /globalShortcut\.register\(VOICE_COMMAND_SHORTCUT,\s*toggleVoiceCommandWindow\)/ },
      { file: 'src/voice-main.tsx', pattern: /data-testid="voice-window-start"/ },
      { file: 'src/voice-main.tsx', pattern: /data-testid="voice-window-result"/ },
    ],
  },
  {
    id: 'multimodal.voice-permission-denied',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：语音权限拒绝',
    checklistLabel: '`multimodal-voice-control` / 语音权限拒绝',
    sourceChecks: [
      { file: 'src/voice-state.ts', pattern: /event\.code === 'speech_denied'/ },
      { file: 'src/voice-state.ts', pattern: /permissionHint/ },
      { file: 'src/voice-main.tsx', pattern: /data-testid="voice-window-permission-hint"/ },
    ],
  },
  {
    id: 'multimodal.helper-exit-recovery',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：helper 进程异常退出可恢复',
    checklistLabel: '`multimodal-voice-control` / helper 进程异常退出可恢复',
    sourceChecks: [
      { file: 'electron/speech-recognition.ts', pattern: /helper_exited/ },
      { file: 'src/voice-state.ts', pattern: /helper_exited/ },
      { file: 'electron/omni-intent-voice.test.mjs', pattern: /helper_exited/ },
    ],
  },
  {
    id: 'multimodal.open-safari',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：打开常用应用',
    checklistLabel: '`multimodal-voice-control` / 打开常用应用',
    sourceChecks: [
      { file: 'electron/main.ts', pattern: /spawn\('\/usr\/bin\/open',\s*\['-a',\s*appName\]/ },
      { file: 'electron/main.ts', pattern: /shell:\s*false/ },
      { file: 'src/multimodal/AgentOsMultimodal.tsx', pattern: /useActionExecutor\(systemOpenAppAction/ },
    ],
  },
  {
    id: 'multimodal.open-google',
    acceptanceFile: 'prd/multimodal-voice-control/acceptance.md',
    heading: '场景：打开 Google 页面',
    checklistLabel: '`multimodal-voice-control` / 打开 Google 页面',
    sourceChecks: [
      { file: 'src/multimodal/actions.ts', pattern: /id:\s*'system\.openUrl'/ },
      { file: 'src/multimodal/AgentOsMultimodal.tsx', pattern: /normalizeExternalUrl/ },
      { file: 'src/multimodal/AgentOsMultimodal.tsx', pattern: /https:\/\/www\.google\.com\// },
      { file: 'electron/main.ts', pattern: /isExternalHttpUrl\(rawUrl\)/ },
    ],
  },
]

export function auditOmniManualReadiness(root = resolve(import.meta.dirname, '..')) {
  const checklist = read(root, 'TESTING_CHECKLIST.md')
  const results = OMNI_MANUAL_READINESS_SCENARIOS.map((scenario) => {
    const acceptance = read(root, scenario.acceptanceFile)
    const errors = [
      ...checkText(`${scenario.acceptanceFile}:${scenario.heading}`, acceptance, [
        scenario.heading,
        '⚠️ 跳过',
        '用户本地验证步骤',
        '证据:',
      ]),
      ...checkChecklistRow(`TESTING_CHECKLIST.md:${scenario.checklistLabel}`, checklist, scenario.checklistLabel),
      ...scenario.sourceChecks.flatMap((sourceCheck) => {
        const source = read(root, sourceCheck.file)
        return sourceCheck.pattern.test(source)
          ? []
          : [`${sourceCheck.file}: missing ${String(sourceCheck.pattern)}`]
      }),
    ]
    return {
      id: scenario.id,
      ok: errors.length === 0,
      errors,
      checklistLabel: scenario.checklistLabel,
      sourceCheckCount: scenario.sourceChecks.length,
    }
  })
  const failures = results.filter((result) => !result.ok)
  return {
    scenarioCount: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  }
}

function checkText(label, source, fragments) {
  return fragments
    .filter((fragment) => !source.includes(fragment))
    .map((fragment) => `${label}: missing ${JSON.stringify(fragment)}`)
}

function checkChecklistRow(label, source, checklistLabel) {
  const row = source.split(/\r?\n/).find((line) => line.includes(checklistLabel))
  if (!row) return [`${label}: missing ${JSON.stringify(checklistLabel)}`]
  const columns = row.split('|').map((column) => column.trim()).filter(Boolean)
  const errors = []
  if (columns.length < 3) errors.push(`${label}: checklist row should include reason and local manual steps`)
  if (!/真实|live Provider|默认浏览器副作用/.test(columns[1] ?? '')) {
    errors.push(`${label}: checklist reason should explain the real-environment dependency`)
  }
  if (!(columns[2] ?? '').trim()) errors.push(`${label}: checklist row missing local manual steps`)
  return errors
}

function read(root, relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = auditOmniManualReadiness()
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) {
    process.exitCode = 1
  }
}
