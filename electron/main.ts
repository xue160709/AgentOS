/**
 * Electron 主进程入口：BrowserWindow、托盘、IPC 与 Claude Agent。
 * Electron main entry: window lifecycle, tray menu, IPC bridges, and Claude Agent runner.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import zh from '../src/locales/zh.json'
import en from '../src/locales/en.json'
import { DESKTOP_EVENT_CHANNELS, DESKTOP_INVOKE_CHANNELS } from '../src/desktop-seam'
import type {
  AgentProjectDocumentsResult,
  AgentModeProjectSettings,
  AgentMcpServerProbeResult,
  AppUiLocale,
  DesktopPreferences,
  HomePluginRunOptions,
  HomePluginTaskEvent,
  ProjectContextAddMode,
  ProjectContextAddResult,
  ProjectContextEntry,
  ProjectContextSkippedEntry,
  ProjectContextResult,
} from '../src/desktop-types'
import { ensureAgentModeFiles, getAgentModeStatus, setAgentModeState } from './agent-mode-files'
import { AgentModeSettingsStore, getDefaultWebSearchSettings, normalizeAgentMcpServers } from './agent-mode-settings-store'
import { discoverAgentContext, searchAgentKnowledge } from './agent-context'
import { ClaudeAgentRunner } from './claude-agent-runner'
import { probeMcpServer } from './claude-agent-runner/mcp-probe'
import { ClaudeAgentSettingsStore } from './claude-agent-settings'
import { ChatWorkspaceStore } from './chat-workspace-store'
import { DesktopPreferencesStore } from './desktop-preferences-store'
import { loadMainProcessEnv } from './env-loader'
import { deleteProjectHomePlugin, runProjectHomePlugin, saveProjectHomePluginLayout, saveProjectHomePluginOrder } from './home-plugin-runner'
import { installSafeStdStreamHandlers } from './safe-console'
import { TaskHomePluginManager } from './task-home-plugin-manager'
import { normalizeUiLocale } from './ui-locale'
import { appUpdaterService, registerAppUpdaterIpc } from './app-updater'
import { installAboutPanel } from './about-panel'
import { installApplicationMenu } from './app-menu'
import { MacSpeechRecognitionService } from './speech-recognition'
import { formatProjectPathError, resolveProjectPath, validateProjectPaths } from './project-path'
import {
  configureProjectContentEvents,
  disposeProjectFileWatchers,
  pathExistsUnderProject,
  readProjectFilePreview,
  readProjectFileTree,
  searchProjectFiles,
  unwatchProjectFiles,
  watchProjectFiles,
} from './project-content'
import { getMainWindowBackgroundColor, getMainWindowChromeOptions } from './window-chrome'
import type {
  ActiveChatPickPayload,
  ClaudeChatAttachment,
  ClaudeChatAttachmentPickerResult,
  ClaudeAgentModelProvider,
  ClaudeAgentStatusRequest,
  ClaudeAgentSettings,
  ClaudeChatSubmitPayload,
  ClaudeFileRewindPayload,
  ChatHistorySearchOptions,
  ChatHistorySearchResult,
  AgentKnowledgeSearchOptions,
  AgentKnowledgeSearchKind,
  AgentKnowledgeSearchProject,
  AgentKnowledgeSearchResult,
  ClaudePermissionResponsePayload,
} from '../src/claude-chat-types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 构建产物目录示意 / Built output layout (for orientation when reading paths)
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')
loadMainProcessEnv(process.env.APP_ROOT)
installSafeStdStreamHandlers()

// 🚧 使用 process.env['KEY'] 避免被 vite:define 内联；见 Vite 2.x 插件行为 /
// 🚧 Use bracket notation so vite:define does not replace env keys (Vite@2.x plugin behavior).
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const APP_NAME = 'AgentOS'

const TRAY_LOCALE_BUNDLE = { zh, en } as const
type TrayLocale = keyof typeof TRAY_LOCALE_BUNDLE

let win: BrowserWindow | null
let tray: Tray | null = null
let isQuitting = false
let currentTrayLocale: TrayLocale = 'zh'
let claudeAgentRunner: ClaudeAgentRunner | null = null
let claudeAgentSettingsStore: ClaudeAgentSettingsStore | null = null
let agentModeSettingsStore: AgentModeSettingsStore | null = null
let chatWorkspaceStore: ChatWorkspaceStore | null = null
let desktopPreferencesStore: DesktopPreferencesStore | null = null
let taskHomePluginManager: TaskHomePluginManager | null = null
let speechRecognitionService: MacSpeechRecognitionService | null = null
let chatWorkspaceOperationChain: Promise<void> = Promise.resolve()
let claudeSettingsOperationChain: Promise<void> = Promise.resolve()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

/** 与 VITE 开发服务器一致：打包产物无开发菜单 / Matches Vite dev server; packaged builds omit dev menu */
const isDevRuntime = Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged
process.env.AGENTOS_DEV_RUNTIME = isDevRuntime ? '1' : '0'

app.setName(APP_NAME)

const CHAT_ATTACHMENT_MAX_FILES = 8
const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 512 * 1024
const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 24 * 1024 * 1024
const CLIPBOARD_PNG_MAX_DATA_URL_LENGTH = 25_000_000
const CLIPBOARD_SVG_MAX_CHARS = 4_000_000
const CLIPBOARD_SVG_MAX_DIMENSION = 4096
const AGENT_PROJECT_DOCUMENT_NAMES = ['AGENTS.md', 'SOUL.md', 'GOAL.md'] as const
const AGENT_PROJECT_DOCUMENT_MAX_CHARS = 512_000
const PROJECT_CONTEXT_DIR_NAME = 'Context'
const PROJECT_CONTEXT_INSTRUCTIONS_FILE = 'CONTEXT.md'
const PROJECT_CONTEXT_INSTRUCTIONS_MAX_CHARS = 512_000
const CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
const CHAT_TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const CHAT_IMAGE_MEDIA_TYPES = new Map<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'>([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

// --- Window, tray & branding / 窗口、托盘与 Dock ---

function getWindowBackgroundColor() {
  return getMainWindowBackgroundColor(nativeTheme.shouldUseDarkColors)
}

function getAppIconPath() {
  return path.join(process.env.VITE_PUBLIC, 'app-icon.png')
}

function applyDockBranding() {
  app.setName(APP_NAME)
  if (process.platform !== 'darwin' || !app.dock) return
  const dockImage = nativeImage.createFromPath(getAppIconPath())
  if (!dockImage.isEmpty()) {
    app.dock.setIcon(dockImage)
  }
}

function isExternalHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isAppNavigationUrl(url: string): boolean {
  if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return true
  if (url.startsWith('file://')) {
    try {
      const normalized = path.normalize(fileURLToPath(url))
      return normalized.startsWith(path.normalize(RENDERER_DIST))
    } catch {
      return false
    }
  }
  return false
}

function attachExternalLinkHandlers(contents: Electron.WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isAppNavigationUrl(url) && isExternalHttpUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const windowBackgroundColor = getWindowBackgroundColor()

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: isMac ? '#00000000' : windowBackgroundColor,
    icon: getAppIconPath(),
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      devTools: isDevRuntime,
    },
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 13 },
          /** 仅透明区域透出系统 material；右侧工作区用不透明白底盖住 */
          transparent: true,
          vibrancy: 'under-window' as const,
          backgroundColor: '#00000000',
        }
      : {}),
    ...getMainWindowChromeOptions(process.platform, nativeTheme.shouldUseDarkColors),
  })

  attachExternalLinkHandlers(win.webContents)

  claudeAgentRunner = new ClaudeAgentRunner(
    win.webContents,
    process.env.APP_ROOT,
    (modelPick) => getClaudeAgentSettingsStore().resolve(modelPick),
    (rootPath) => getAgentModeSettingsStore().resolve(rootPath),
    async () => {
      const result = await getAgentModeSettingsStore().getGlobalWebSearchSettings()
      return result.ok ? result.settings : getDefaultWebSearchSettings()
    },
    () => normalizeUiLocale(getDesktopPreferencesStore().read().locale),
    (event) => taskHomePluginManager?.handleClaudeEvent(event),
  )

  taskHomePluginManager = new TaskHomePluginManager({
    getRunner: () => claudeAgentRunner,
    getWorkspace: () => chatWorkspaceStore?.read() ?? null,
    emitTaskEvent: sendTaskHomePluginEvent,
  })
  void taskHomePluginManager.refreshFromWorkspace()

  win.on('close', (event) => {
    if (isQuitting) return
    const prefs = desktopPreferencesStore?.read() ?? { closeToTray: false, openAtLogin: false, locale: 'zh' }
    if (prefs.closeToTray) {
      event.preventDefault()
      win?.hide()
    }
  })

  if (!isMac) {
    const syncBackgroundColor = () => {
      win?.setBackgroundColor(getWindowBackgroundColor())
    }
    nativeTheme.on('updated', syncBackgroundColor)
    win.on('closed', () => {
      nativeTheme.off('updated', syncBackgroundColor)
    })
  }

  win.on('closed', () => {
    speechRecognitionService?.dispose()
    claudeAgentRunner = null
    taskHomePluginManager = null
    speechRecognitionService = null
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // 生产环境从磁盘加载打包后的 index.html（非直连 dist 根路径）/
    // Production: load packaged `index.html` from disk (not the dev-server URL).
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function getClaudeAgentRunner() {
  if (!claudeAgentRunner) {
    throw new Error('Claude Agent runner is not ready.')
  }
  return claudeAgentRunner
}

function getClaudeAgentSettingsStore() {
  if (!claudeAgentSettingsStore) {
    throw new Error('Claude Agent settings store is not ready.')
  }
  return claudeAgentSettingsStore
}

function getAgentModeSettingsStore() {
  if (!agentModeSettingsStore) {
    throw new Error('Agent Mode settings store is not ready.')
  }
  return agentModeSettingsStore
}

function getChatWorkspaceStore() {
  if (!chatWorkspaceStore) {
    throw new Error('Chat workspace store is not ready.')
  }
  return chatWorkspaceStore
}

function getDesktopPreferencesStore() {
  if (!desktopPreferencesStore) {
    throw new Error('Desktop preferences store is not ready.')
  }
  return desktopPreferencesStore
}

function getTaskHomePluginManager() {
  if (!taskHomePluginManager) {
    throw new Error('Task home plugin manager is not ready.')
  }
  return taskHomePluginManager
}

function getSpeechRecognitionService() {
  if (!speechRecognitionService) {
    speechRecognitionService = new MacSpeechRecognitionService(() => win)
  }
  return speechRecognitionService
}

function runChatWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = chatWorkspaceOperationChain.then(operation, operation)
  chatWorkspaceOperationChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function runClaudeSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = claudeSettingsOperationChain.then(operation, operation)
  claudeSettingsOperationChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function clearChatWorkspaceData(userDataPath: string): Promise<void> {
  try {
    await claudeAgentRunner?.cancel()
  } catch {
    /* ignore */
  }

  await removeWorkspaceArtifacts(userDataPath)
  await taskHomePluginManager?.refreshFromWorkspace()
}

async function clearClaudeAgentSettingsData(userDataPath: string): Promise<void> {
  await removeIfExists(path.join(userDataPath, 'claude-agent-settings.json'))
}

async function removeWorkspaceArtifacts(userDataPath: string): Promise<void> {
  await Promise.all([
    removeIfExists(path.join(userDataPath, 'chat-workspace.json')),
    removeIfExists(path.join(userDataPath, 'chat-workspace.sqlite')),
    removeIfExists(path.join(userDataPath, 'chat-workspace.sqlite-wal')),
    removeIfExists(path.join(userDataPath, 'chat-workspace.sqlite-shm')),
    removeIfExists(path.join(userDataPath, 'chat-workspace.sqlite-journal')),
    removeIfExists(path.join(userDataPath, 'chat-sessions')),
  ])
}

async function removeIfExists(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function sendTaskHomePluginEvent(event: HomePluginTaskEvent): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(DESKTOP_EVENT_CHANNELS.onHomePluginTaskEvent, event)
}

function sendProjectFilesChanged(event: { rootPath: string; relativePath?: string }): void {
  const windows = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed())
  for (const targetWindow of windows) {
    targetWindow.webContents.send(DESKTOP_EVENT_CHANNELS.onProjectFilesChanged, event)
  }
}

function resolveAgentModeIpcLocale(raw: unknown): AppUiLocale {
  if (raw === 'zh' || raw === 'en') return raw
  return normalizeUiLocale(getDesktopPreferencesStore().read().locale)
}

function trayMenuLabel(locale: TrayLocale, key: 'newThread' | 'openProject' | 'quit'): string {
  const tray = TRAY_LOCALE_BUNDLE[locale].tray as Record<string, string> | undefined
  const value = tray?.[key]
  return typeof value === 'string' ? value : key
}

function getTrayImage() {
  const iconName = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-icon.png'
  const iconPath = path.join(process.env.VITE_PUBLIC, iconName)
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(process.env.APP_ROOT ?? '', 'public', iconName))
  }
  if (!image.isEmpty() && process.platform === 'darwin') {
    image.setTemplateImage(true)
  }
  /** macOS：托盘图为空时用系统模板图兜底，避免菜单栏“看不见”。 */
  if (image.isEmpty() && process.platform === 'darwin') {
    try {
      image = nativeImage.createFromNamedImage('NSImageNameBookmarksTemplate', [18, 18])
      image.setTemplateImage(true)
    } catch {
      /* ignore */
    }
  }
  /** 其它平台仍为空时用 16×16 纯色 PNG，避免 `new Tray` 无图标 */
  if (image.isEmpty()) {
    image = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYCMg/BOMrgMERYA5KquhnSuCqmRBwBZ9A/TsQ5TAAAAAElFTkSuQmCC',
    )
  }
  return image
}

function showMainWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function buildTrayContextMenu() {
  const locale = currentTrayLocale
  return Menu.buildFromTemplate([
    {
      label: trayMenuLabel(locale, 'newThread'),
      click: () => {
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
          win.webContents.send(DESKTOP_EVENT_CHANNELS.onTrayMenuAction, 'new-thread')
        }
      },
    },
    {
      label: trayMenuLabel(locale, 'openProject'),
      click: () => {
        if (win && !win.isDestroyed()) {
          win.show()
          win.focus()
          win.webContents.send(DESKTOP_EVENT_CHANNELS.onTrayMenuAction, 'open-project')
        }
      },
    },
    { type: 'separator' },
    {
      label: trayMenuLabel(locale, 'quit'),
      click: () => {
        app.quit()
      },
    },
  ])
}

function ensureTray() {
  if (!win || win.isDestroyed()) return
  if (!tray) {
    tray = new Tray(getTrayImage())
    const name = app.getName()
    tray.setToolTip(name)
    tray.on('click', () => {
      showMainWindow()
    })
    tray.on('right-click', () => {
      tray?.popUpContextMenu(buildTrayContextMenu())
    })
  }
}

function prepareForAppQuit() {
  isQuitting = true
  speechRecognitionService?.dispose()
  disposeProjectFileWatchers()
  tray?.destroy()
  tray = null
}

function applyLoginItemSettingsFromPrefs(prefs: DesktopPreferences) {
  app.setLoginItemSettings({
    openAtLogin: prefs.openAtLogin,
    path: process.execPath,
  })
}

function applyLoginItemSettingsOnStartup(prefs: DesktopPreferences) {
  if (!prefs.openAtLogin) return
  applyLoginItemSettingsFromPrefs(prefs)
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.on('window-all-closed', () => {
    if (isQuitting) {
      app.quit()
      win = null
      return
    }
    const prefs = desktopPreferencesStore?.read() ?? { closeToTray: false, openAtLogin: false, locale: 'zh' }
    if (prefs.closeToTray) return
    app.quit()
    win = null
  })

  app.on('activate', () => {
    if (win && !win.isDestroyed()) {
      win.show()
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      ensureTray()
    }
  })

  app.on('before-quit', prepareForAppQuit)

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'system'
    installAboutPanel()
    installApplicationMenu({ isDev: isDevRuntime })
    applyDockBranding()
    const userDataPath = app.getPath('userData')
    desktopPreferencesStore = new DesktopPreferencesStore(userDataPath)
    claudeAgentSettingsStore = new ClaudeAgentSettingsStore(userDataPath, {
      allowEnvConfigSource: isDevRuntime,
    })
    agentModeSettingsStore = new AgentModeSettingsStore(userDataPath)
    chatWorkspaceStore = new ChatWorkspaceStore(userDataPath)
    applyLoginItemSettingsOnStartup(getDesktopPreferencesStore().read())
    currentTrayLocale = normalizeUiLocale(getDesktopPreferencesStore().read().locale)
    configureProjectContentEvents(sendProjectFilesChanged)

    // --- IPC handlers / IPC 注册 ---

    registerAppUpdaterIpc(() => win, { beforeQuitAndInstall: prepareForAppQuit })

    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getDesktopPreferences, () => {
      return getDesktopPreferencesStore().read()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.setDesktopPreferences, (_event, partial: Partial<DesktopPreferences>) => {
      const next = getDesktopPreferencesStore().save(partial)
      if (Object.prototype.hasOwnProperty.call(partial, 'openAtLogin')) {
        applyLoginItemSettingsFromPrefs(next)
      }
      ensureTray()
      return next
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.syncTrayLocale, (_event, raw: unknown) => {
      if (raw === 'zh' || raw === 'en') {
        currentTrayLocale = raw
        ensureTray()
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.copyPngToClipboard, (_event, dataUrl: unknown) => {
      if (
        typeof dataUrl !== 'string' ||
        !/^data:image\/png;base64,/i.test(dataUrl) ||
        dataUrl.length > CLIPBOARD_PNG_MAX_DATA_URL_LENGTH
      ) {
        return false
      }
      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.copySvgToClipboard, async (_event, svg: unknown) => {
      if (typeof svg !== 'string' || !svg.trim().startsWith('<svg') || svg.length > CLIPBOARD_SVG_MAX_CHARS) {
        return false
      }
      return copySvgToClipboard(svg)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getSpeechRecognitionStatus, () => {
      return getSpeechRecognitionService().getSnapshot()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.startSpeechRecognition, (_event, rawOptions: unknown) => {
      const options = isRecord(rawOptions)
        ? {
            locale: typeof rawOptions.locale === 'string' ? rawOptions.locale : undefined,
            requiresOnDevice: rawOptions.requiresOnDevice === false ? false : true,
          }
        : undefined
      return getSpeechRecognitionService().start(options)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.stopSpeechRecognition, () => {
      return getSpeechRecognitionService().stop()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.cancelSpeechRecognition, () => {
      return getSpeechRecognitionService().cancel()
    })
    ipcMain.handle('claude-chat:submit', (_event, payload: ClaudeChatSubmitPayload) => {
      return getClaudeAgentRunner().submit(payload)
    })
    ipcMain.handle('claude-chat:cancel', (_event, requestId?: string) => {
      return getClaudeAgentRunner().cancel(requestId)
    })
    ipcMain.handle('claude-chat:new-thread', (_event, threadId?: string) => {
      return getClaudeAgentRunner().newThread(threadId)
    })
    ipcMain.handle('claude-chat:get-status', (_event, payload?: ClaudeAgentStatusRequest) => {
      return getClaudeAgentRunner().getStatus(payload)
    })
    ipcMain.handle('claude-chat:answer-permission-request', (_event, payload: ClaudePermissionResponsePayload) => {
      return getClaudeAgentRunner().answerPermissionRequest(payload)
    })
    ipcMain.handle('claude-chat:rewind-files', (_event, payload: ClaudeFileRewindPayload) => {
      return getClaudeAgentRunner().rewindFiles(payload)
    })
    ipcMain.handle('claude-agent-settings:get', () => {
      return getClaudeAgentSettingsStore().getSnapshot()
    })
    ipcMain.handle('claude-agent-settings:save', (_event, settings: ClaudeAgentSettings) => {
      return runClaudeSettingsOperation(async () => getClaudeAgentSettingsStore().save(settings))
    })
    ipcMain.handle('claude-agent-settings:test-provider', (_event, provider: ClaudeAgentModelProvider) => {
      return getClaudeAgentSettingsStore().testProvider(provider)
    })
    ipcMain.handle('claude-agent-settings:set-active-chat-pick', (_event, payload: ActiveChatPickPayload) => {
      return runClaudeSettingsOperation(async () => getClaudeAgentSettingsStore().setActiveChatPick(payload))
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getChatWorkspace, () => {
      return getChatWorkspaceStore().read()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveChatWorkspace, (_event, state: unknown) => {
      return runChatWorkspaceOperation(async () => {
        const saved = await getChatWorkspaceStore().save(state)
        void taskHomePluginManager?.refreshFromWorkspace(saved)
        return saved
      })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.clearChatWorkspaceData, () => {
      return runChatWorkspaceOperation(async () => {
        await clearChatWorkspaceData(userDataPath)
      })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.clearClaudeAgentSettings, () => {
      return runClaudeSettingsOperation(async () => {
        await clearClaudeAgentSettingsData(userDataPath)
      })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.pickProjectDirectory, async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? win
      if (!parent) return null
      const result = await dialog.showOpenDialog(parent, {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择项目文件夹',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.pickChatAttachments, async (_event, rawOptions: unknown) => {
      const parent = BrowserWindow.getFocusedWindow() ?? win
      if (!parent) {
        return { ok: false, message: '当前窗口不可用' } satisfies ClaudeChatAttachmentPickerResult
      }
      const allowImages = isRecord(rawOptions) ? rawOptions.allowImages === true : false
      const extensions = allowImages ? ['md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'] : ['md', 'markdown', 'txt']
      const result = await dialog.showOpenDialog(parent, {
        properties: ['openFile', 'multiSelections'],
        title: allowImages ? '添加 Markdown、文本或图片' : '添加 Markdown 或文本',
        filters: [
          {
            name: allowImages ? 'Markdown, Text, Images' : 'Markdown, Text',
            extensions,
          },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, attachments: [], skipped: [] } satisfies ClaudeChatAttachmentPickerResult
      }
      return readChatAttachments(result.filePaths, allowImages)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.readChatAttachments, async (_event, rawFilePaths: unknown, rawOptions: unknown) => {
      if (!Array.isArray(rawFilePaths)) {
        return { ok: false, message: '附件路径无效' } satisfies ClaudeChatAttachmentPickerResult
      }
      const filePaths = rawFilePaths.filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
      const allowImages = isRecord(rawOptions) ? rawOptions.allowImages === true : false
      return readChatAttachments(filePaths, allowImages)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.listProjectFiles, (_event, rootPath: string) => {
      return readProjectFileTree(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.watchProjectFiles, async (_event, rootPath: string) => {
      return watchProjectFiles(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.unwatchProjectFiles, async (_event, rootPath: string) => {
      return unwatchProjectFiles(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.readProjectFile, (_event, rootPath: unknown, filePath: unknown) => {
      return readProjectFilePreview(rootPath, filePath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.validateProjectPaths, async (_event, paths: unknown) => {
      if (!Array.isArray(paths)) return {}
      return validateProjectPaths(paths.filter((path): path is string => typeof path === 'string'))
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.searchProjectFiles, (_event, rootPath: string, query: string) => {
      return searchProjectFiles(rootPath, query)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.searchChatHistory, (_event, projectId: unknown, query: unknown, options: unknown) => {
      const normalizedOptions: ChatHistorySearchOptions = isRecord(options)
        ? {
            includeArchived: options.includeArchived === true,
            limit: typeof options.limit === 'number' ? options.limit : undefined,
          }
        : {}
      return runChatWorkspaceOperation(async (): Promise<ChatHistorySearchResult> => {
        return getChatWorkspaceStore().searchChatHistory(
          typeof projectId === 'string' ? projectId : '',
          typeof query === 'string' ? query : '',
          normalizedOptions,
        )
      })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.listAgentContext, (_event, rootPath: string) => {
      return discoverAgentContext(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.searchAgentKnowledge, (_event, projects: unknown, query: unknown, options: unknown) => {
      const normalizedProjects: AgentKnowledgeSearchProject[] = Array.isArray(projects)
        ? projects.flatMap((project): AgentKnowledgeSearchProject[] => {
            if (!isRecord(project)) return []
            const id = typeof project.id === 'string' ? project.id : ''
            const name = typeof project.name === 'string' ? project.name : ''
            const projectPath = typeof project.path === 'string' ? project.path : ''
            return id && projectPath ? [{ id, name: name || id, path: projectPath }] : []
          })
        : []
      const normalizedOptions: AgentKnowledgeSearchOptions = isRecord(options)
        ? {
            limit: typeof options.limit === 'number' ? options.limit : undefined,
            recentDays: typeof options.recentDays === 'number' ? options.recentDays : undefined,
            kinds: Array.isArray(options.kinds) ? options.kinds.filter(isAgentKnowledgeSearchKind) : undefined,
          }
        : {}
      return searchAgentKnowledge(normalizedProjects, typeof query === 'string' ? query : '', normalizedOptions) satisfies Promise<AgentKnowledgeSearchResult>
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.pathExistsUnderProject, async (_event, rootPath: unknown, relativePath: unknown) => {
      return pathExistsUnderProject(rootPath, relativePath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.runHomePlugin, (_event, rootPath: string, options?: HomePluginRunOptions) => {
      return runProjectHomePlugin(rootPath, options)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveHomePluginOrder, (_event, rootPath: string, order: unknown) => {
      return saveProjectHomePluginOrder(rootPath, order)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveHomePluginLayout, (_event, rootPath: string, order: unknown, cards: unknown) => {
      return saveProjectHomePluginLayout(rootPath, order, cards)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.deleteHomePlugin, async (_event, rootPath: string, slug: unknown) => {
      if (typeof slug === 'string') {
        try {
          await taskHomePluginManager?.prepareDeleteTask(rootPath, slug)
        } catch {
          /* deletion below returns the user-facing path error */
        }
      }
      const result = await deleteProjectHomePlugin(rootPath, slug)
      if (result.ok) void taskHomePluginManager?.refreshFromWorkspace()
      return result
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveTaskHomePlugin, (_event, rootPath: string, payload: unknown) => {
      return getTaskHomePluginManager().saveTask(rootPath, payload as Parameters<TaskHomePluginManager['saveTask']>[1])
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getTaskHomePlugin, (_event, rootPath: string, slug: string) => {
      return getTaskHomePluginManager().readTask(rootPath, slug)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.runTaskHomePlugin, (_event, rootPath: string, slug: string) => {
      return getTaskHomePluginManager().startTask(rootPath, slug)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.stopTaskHomePlugin, (_event, rootPath: string, slug: string) => {
      return getTaskHomePluginManager().stopTask(rootPath, slug)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getAgentModeStatus, (_event, rootPath: string, rawLocale?: unknown) => {
      return getAgentModeStatus(rootPath, getAgentModeSettingsStore(), resolveAgentModeIpcLocale(rawLocale))
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.ensureAgentModeFiles, (_event, rootPath: string, rawLocale?: unknown) => {
      return ensureAgentModeFiles(rootPath, getAgentModeSettingsStore(), resolveAgentModeIpcLocale(rawLocale))
    })
    ipcMain.handle(
      DESKTOP_INVOKE_CHANNELS.setAgentModeState,
      (_event, rootPath: string, partial: Partial<AgentModeProjectSettings>, rawLocale?: unknown) => {
        return setAgentModeState(rootPath, partial, getAgentModeSettingsStore(), resolveAgentModeIpcLocale(rawLocale))
      },
    )
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getAgentModeSettings, (_event, rootPath: string) => {
      return getAgentModeSettingsStore().getResult(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getGlobalMcpSettings, () => {
      return getAgentModeSettingsStore().getGlobalMcpSettings()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveGlobalMcpSettings, (_event, payload: unknown) => {
      return getAgentModeSettingsStore().saveGlobalMcpSettings(isRecord(payload) ? payload : {})
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.testGlobalMcpServer, async (_event, payload: unknown): Promise<AgentMcpServerProbeResult> => {
      const [server] = normalizeAgentMcpServers([payload])
      if (!server) {
        return { ok: false, message: 'MCP 服务配置无效' }
      }
      const result = await probeMcpServer(server)
      if (result.snapshot) {
        const saved = await getAgentModeSettingsStore().saveGlobalMcpProbeSnapshot(result.snapshot)
        if (!saved.ok && result.ok) {
          return { ok: false, snapshot: result.snapshot, message: saved.message }
        }
      }
      return result
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getGlobalWebSearchSettings, () => {
      return getAgentModeSettingsStore().getGlobalWebSearchSettings()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveGlobalWebSearchSettings, (_event, payload: unknown) => {
      return getAgentModeSettingsStore().saveGlobalWebSearchSettings(isRecord(payload) ? payload : {})
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveAgentModeSettings, (_event, rootPath: string, payload: Partial<AgentModeProjectSettings>) => {
      return getAgentModeSettingsStore().saveSettings(rootPath, payload)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.readAgentProjectDocuments, (_event, rootPath: string) => {
      return readAgentProjectDocuments(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveAgentProjectDocuments, (_event, rootPath: string, files: unknown) => {
      return saveAgentProjectDocuments(rootPath, files)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.listProjectContext, (_event, rootPath: string) => {
      return readProjectContext(rootPath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveProjectContextInstructions, (_event, rootPath: string, instructions: unknown) => {
      return saveProjectContextInstructions(rootPath, instructions)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.addProjectContextEntries, (_event, rootPath: string, rawMode: unknown) => {
      return pickAndAddProjectContextEntries(rootPath, rawMode)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.removeProjectContextEntry, (_event, rootPath: string, relativePath: unknown) => {
      return removeProjectContextEntry(rootPath, relativePath)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.quitApp, () => {
      app.quit()
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.showItemInFolder, (_event, rawPath: unknown) => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) return
      const resolved = resolveProjectPath(rawPath)
      shell.showItemInFolder(resolved)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openPath, async (_event, rawPath: unknown) => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) return
      const resolved = resolveProjectPath(rawPath)
      const message = await shell.openPath(resolved)
      if (message) throw new Error(message)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openExternal, async (_event, rawUrl: unknown) => {
      if (typeof rawUrl !== 'string' || !isExternalHttpUrl(rawUrl)) return
      await shell.openExternal(rawUrl)
    })
    createWindow()
    ensureTray()
    appUpdaterService.scheduleUpdateChecks()
  })
} else {
  app.quit()
}

// --- Attachment ingest & file tree / 附件读取与文件树 ---

async function readChatAttachments(filePaths: string[], allowImages: boolean): Promise<ClaudeChatAttachmentPickerResult> {
  const attachments: ClaudeChatAttachment[] = []
  const skipped: Array<{ name: string; path: string; reason: string }> = []
  const selected = filePaths.slice(0, CHAT_ATTACHMENT_MAX_FILES)
  let acceptedBytes = 0

  if (filePaths.length > CHAT_ATTACHMENT_MAX_FILES) {
    for (const filePath of filePaths.slice(CHAT_ATTACHMENT_MAX_FILES)) {
      skipped.push({
        name: path.basename(filePath),
        path: filePath,
        reason: `一次最多添加 ${CHAT_ATTACHMENT_MAX_FILES} 个文件`,
      })
    }
  }

  for (const filePath of selected) {
    const resolvedPath = path.resolve(filePath)
    const name = path.basename(resolvedPath)
    const extension = path.extname(name).toLowerCase()
    const imageMimeType = CHAT_IMAGE_MEDIA_TYPES.get(extension)
    const isTextAttachment = CHAT_TEXT_EXTENSIONS.has(extension)

    if (!isTextAttachment && !imageMimeType) {
      skipped.push({ name, path: resolvedPath, reason: '仅支持 MD、TXT、PNG、JPG、GIF、WEBP' })
      continue
    }

    if (imageMimeType && !allowImages) {
      skipped.push({ name, path: resolvedPath, reason: '当前模型未开启图片输入' })
      continue
    }

    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) {
        skipped.push({ name, path: resolvedPath, reason: '只能添加文件' })
        continue
      }

      if (isTextAttachment) {
        if (stat.size > CHAT_TEXT_ATTACHMENT_MAX_BYTES) {
          skipped.push({ name, path: resolvedPath, reason: '文本文件超过 512KB' })
          continue
        }
        if (acceptedBytes + stat.size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
          skipped.push({ name, path: resolvedPath, reason: '附件总大小超过 24MB' })
          continue
        }
        const text = await fs.readFile(resolvedPath, 'utf8')
        acceptedBytes += stat.size
        attachments.push({
          id: createAttachmentId(attachments.length),
          kind: 'text',
          name,
          path: resolvedPath,
          mimeType: extension === '.md' || extension === '.markdown' ? 'text/markdown' : 'text/plain',
          size: stat.size,
          text,
          preview: firstPreviewLine(text),
        })
        continue
      }

      if (imageMimeType) {
        if (stat.size > CHAT_IMAGE_ATTACHMENT_MAX_BYTES) {
          skipped.push({ name, path: resolvedPath, reason: '图片超过 5MB' })
          continue
        }
        if (acceptedBytes + stat.size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
          skipped.push({ name, path: resolvedPath, reason: '附件总大小超过 24MB' })
          continue
        }
        const data = await fs.readFile(resolvedPath)
        acceptedBytes += stat.size
        const base64 = data.toString('base64')
        const image = nativeImage.createFromBuffer(data)
        const imageSize = image.isEmpty() ? undefined : image.getSize()
        const dimensions =
          imageSize && imageSize.width > 0 && imageSize.height > 0 ? `${imageSize.width} x ${imageSize.height}` : ''
        attachments.push({
          id: createAttachmentId(attachments.length),
          kind: 'image',
          name,
          path: resolvedPath,
          mimeType: imageMimeType,
          size: stat.size,
          base64,
          dataUrl: `data:${imageMimeType};base64,${base64}`,
          preview: dimensions,
        })
      }
    } catch (error) {
      skipped.push({
        name,
        path: resolvedPath,
        reason: error instanceof Error ? error.message : '读取失败',
      })
    }
  }

  return { ok: true, attachments, skipped }
}

function createAttachmentId(index: number): string {
  return `attachment-${Date.now()}-${index}`
}

function firstPreviewLine(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  const firstLine = normalized.split('\n').find((line) => line.trim())?.trim() ?? ''
  if (!firstLine) return ''
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
}

async function readAgentProjectDocuments(rootPath: string): Promise<AgentProjectDocumentsResult> {
  const root = resolveProjectPath(rootPath)
  try {
    const rootStat = await fs.stat(root)
    if (!rootStat.isDirectory()) return { ok: false, rootPath: root, message: '当前项目路径不是文件夹' }
    const files = Object.fromEntries(
      await Promise.all(
        AGENT_PROJECT_DOCUMENT_NAMES.map(async (name) => {
          const filePath = path.join(root, name)
          try {
            const stat = await fs.stat(filePath)
            if (!stat.isFile()) return [name, ''] as const
            if (stat.size > AGENT_PROJECT_DOCUMENT_MAX_CHARS * 4) {
              return [name, ''] as const
            }
            const content = await fs.readFile(filePath, 'utf8')
            return [name, content.slice(0, AGENT_PROJECT_DOCUMENT_MAX_CHARS)] as const
          } catch (error) {
            if (isNodeError(error) && error.code === 'ENOENT') return [name, ''] as const
            throw error
          }
        }),
      ),
    ) as Record<(typeof AGENT_PROJECT_DOCUMENT_NAMES)[number], string>
    return { ok: true, rootPath: root, files }
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function saveAgentProjectDocuments(rootPath: string, rawFiles: unknown): Promise<AgentProjectDocumentsResult> {
  const root = resolveProjectPath(rootPath)
  if (!isRecord(rawFiles)) {
    return { ok: false, rootPath: root, message: '文件内容无效' }
  }
  try {
    const rootStat = await fs.stat(root)
    if (!rootStat.isDirectory()) return { ok: false, rootPath: root, message: '当前项目路径不是文件夹' }
    for (const name of AGENT_PROJECT_DOCUMENT_NAMES) {
      const content = typeof rawFiles[name] === 'string' ? rawFiles[name] : ''
      if (content.length > AGENT_PROJECT_DOCUMENT_MAX_CHARS) {
        return { ok: false, rootPath: root, message: `${name} 内容超过长度限制` }
      }
      await fs.writeFile(path.join(root, name), content, 'utf8')
    }
    return readAgentProjectDocuments(root)
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function readProjectContext(rootPath: string): Promise<ProjectContextResult> {
  const root = resolveProjectPath(rootPath)
  try {
    const rootStat = await fs.stat(root)
    if (!rootStat.isDirectory()) return { ok: false, rootPath: root, message: '当前项目路径不是文件夹' }

    const contextPath = path.join(root, PROJECT_CONTEXT_DIR_NAME)
    const contextStat = await lstatIfExists(contextPath)
    if (!contextStat) {
      return {
        ok: true,
        rootPath: root,
        contextPath,
        contextMode: 'local',
        readOnly: false,
        instructions: '',
        entries: [],
      }
    }
    if (contextStat.isSymbolicLink()) {
      const targetStat = await fs.stat(contextPath)
      if (!targetStat.isDirectory()) {
        return {
          ok: false,
          rootPath: root,
          message: `${PROJECT_CONTEXT_DIR_NAME} 引用的原位置不是文件夹`,
        }
      }
      return {
        ok: true,
        rootPath: root,
        contextPath,
        contextMode: 'reference',
        contextTargetPath: await fs.realpath(contextPath),
        readOnly: true,
        instructions: await readProjectContextInstructions(contextPath),
        entries: await readProjectContextEntries(root, contextPath),
      }
    }
    if (!contextStat.isDirectory()) {
      return {
        ok: false,
        rootPath: root,
        message: `${PROJECT_CONTEXT_DIR_NAME} 必须是当前项目内的真实文件夹`,
      }
    }

    return {
      ok: true,
      rootPath: root,
      contextPath,
      contextMode: 'local',
      readOnly: false,
      instructions: await readProjectContextInstructions(contextPath),
      entries: await readProjectContextEntries(root, contextPath),
    }
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function saveProjectContextInstructions(rootPath: string, rawInstructions: unknown): Promise<ProjectContextResult> {
  const root = resolveProjectPath(rootPath)
  if (typeof rawInstructions !== 'string') {
    return { ok: false, rootPath: root, message: '上下文说明无效' }
  }
  if (rawInstructions.length > PROJECT_CONTEXT_INSTRUCTIONS_MAX_CHARS) {
    return { ok: false, rootPath: root, message: `${PROJECT_CONTEXT_INSTRUCTIONS_FILE} 内容超过长度限制` }
  }

  try {
    const contextPath = await ensureProjectContextDirectory(root)
    await fs.writeFile(path.join(contextPath, PROJECT_CONTEXT_INSTRUCTIONS_FILE), rawInstructions, 'utf8')
    return readProjectContext(root)
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function pickAndAddProjectContextEntries(rootPath: string, rawMode: unknown): Promise<ProjectContextAddResult> {
  const root = resolveProjectPath(rootPath)
  const mode = normalizeProjectContextAddMode(rawMode)
  const parent = BrowserWindow.getFocusedWindow() ?? win
  if (!parent) return { ok: false, rootPath: root, message: '当前窗口不可用' }

  const result = await dialog.showOpenDialog(parent, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    title: mode === 'reference' ? '引用原位置到上下文' : '复制到项目上下文',
  })
  if (result.canceled || result.filePaths.length === 0) {
    return projectContextAddResultFromContext(await readProjectContext(root), [], [])
  }

  return addProjectContextEntries(root, result.filePaths, mode)
}

async function addProjectContextEntries(
  rootPath: string,
  sourcePaths: string[],
  mode: ProjectContextAddMode,
): Promise<ProjectContextAddResult> {
  const root = resolveProjectPath(rootPath)
  const addedPaths = new Set<string>()
  const skipped: ProjectContextSkippedEntry[] = []

  try {
    const contextPath = await ensureProjectContextDirectory(root)
    const [rootRealPath, contextRealPath] = await Promise.all([fs.realpath(root), fs.realpath(contextPath)])

    for (const rawSourcePath of sourcePaths) {
      const sourcePath = resolveProjectPath(rawSourcePath)
      const sourceName = path.basename(sourcePath) || sourcePath
      try {
        const sourceStat = await fs.stat(sourcePath)
        if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
          skipped.push({ name: sourceName, path: sourcePath, reason: '仅支持文件或文件夹' })
          continue
        }

        const sourceRealPath = await fs.realpath(sourcePath)
        if (isSameOrInsidePath(contextRealPath, sourceRealPath)) {
          skipped.push({ name: sourceName, path: sourcePath, reason: '已经在 Context 文件夹中' })
          continue
        }
        if (sourceStat.isDirectory() && isSameOrInsidePath(sourceRealPath, rootRealPath)) {
          skipped.push({ name: sourceName, path: sourcePath, reason: '不能添加当前项目或它的上级目录' })
          continue
        }
        if (sourceName === PROJECT_CONTEXT_INSTRUCTIONS_FILE) {
          skipped.push({ name: sourceName, path: sourcePath, reason: `${PROJECT_CONTEXT_INSTRUCTIONS_FILE} 用于保存上下文说明` })
          continue
        }

        const destinationPath = await nextAvailableContextEntryPath(contextPath, sourceName)
        if (mode === 'reference') {
          await fs.symlink(sourceRealPath, destinationPath, projectContextSymlinkType(sourceStat))
        } else if (sourceStat.isDirectory()) {
          await fs.cp(sourceRealPath, destinationPath, {
            recursive: true,
            force: false,
            errorOnExist: true,
            dereference: true,
          })
        } else {
          await fs.copyFile(sourceRealPath, destinationPath)
        }
        addedPaths.add(path.resolve(destinationPath))
      } catch (error) {
        skipped.push({
          name: sourceName,
          path: sourcePath,
          reason: error instanceof Error ? error.message : '添加失败',
        })
      }
    }

    const context = await readProjectContext(root)
    return projectContextAddResultFromContext(
      context,
      context.ok ? context.entries.filter((entry) => addedPaths.has(path.resolve(entry.path))) : [],
      skipped,
    )
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function removeProjectContextEntry(rootPath: string, rawRelativePath: unknown): Promise<ProjectContextResult> {
  const root = resolveProjectPath(rootPath)
  if (typeof rawRelativePath !== 'string') {
    return { ok: false, rootPath: root, message: '上下文路径无效' }
  }

  try {
    const contextPath = await ensureProjectContextDirectory(root)
    const relativePath = normalizeRelativePath(rawRelativePath)
    const prefix = `${PROJECT_CONTEXT_DIR_NAME}/`
    const entryName = relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath
    if (
      !entryName ||
      entryName === PROJECT_CONTEXT_INSTRUCTIONS_FILE ||
      entryName.split('/').some((segment) => !segment || segment === '..')
    ) {
      return { ok: false, rootPath: root, message: '上下文路径无效' }
    }
    if (entryName.includes('/')) {
      return { ok: false, rootPath: root, message: '只能移除 Context 下的一级文件或文件夹' }
    }

    const targetPath = path.join(contextPath, entryName)
    const contextRealPath = await fs.realpath(contextPath)
    const targetParent = path.dirname(path.resolve(targetPath))
    if (!isSameOrInsidePath(contextRealPath, targetParent)) {
      return { ok: false, rootPath: root, message: '上下文路径无效' }
    }

    await fs.rm(targetPath, { recursive: true, force: true })
    return readProjectContext(root)
  } catch (error) {
    return { ok: false, rootPath: root, message: formatProjectPathError(error) }
  }
}

async function ensureProjectContextDirectory(rootPath: string): Promise<string> {
  const root = resolveProjectPath(rootPath)
  const rootStat = await fs.stat(root)
  if (!rootStat.isDirectory()) throw new Error('当前项目路径不是文件夹')

  const contextPath = path.join(root, PROJECT_CONTEXT_DIR_NAME)
  const contextStat = await lstatIfExists(contextPath)
  if (!contextStat) {
    await fs.mkdir(contextPath, { recursive: true })
    return contextPath
  }
  if (contextStat.isSymbolicLink() || !contextStat.isDirectory()) {
    throw new Error(`${PROJECT_CONTEXT_DIR_NAME} 是外部文件夹引用，设置里只能读取，不能添加、移除或写入内容。请在原位置管理。`)
  }
  return contextPath
}

async function readProjectContextInstructions(contextPath: string): Promise<string> {
  const filePath = path.join(contextPath, PROJECT_CONTEXT_INSTRUCTIONS_FILE)
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return ''
    if (stat.size > PROJECT_CONTEXT_INSTRUCTIONS_MAX_CHARS * 4) return ''
    const content = await fs.readFile(filePath, 'utf8')
    return content.slice(0, PROJECT_CONTEXT_INSTRUCTIONS_MAX_CHARS)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return ''
    throw error
  }
}

async function readProjectContextEntries(rootPath: string, contextPath: string): Promise<ProjectContextEntry[]> {
  const entries = await fs.readdir(contextPath, { withFileTypes: true })
  const items = await Promise.all(
    entries
      .filter((entry) => entry.name !== PROJECT_CONTEXT_INSTRUCTIONS_FILE)
      .map((entry) => createProjectContextEntry(rootPath, contextPath, entry.name)),
  )
  return items.sort(
    (a, b) =>
      Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

async function createProjectContextEntry(
  rootPath: string,
  contextPath: string,
  name: string,
): Promise<ProjectContextEntry> {
  const entryPath = path.join(contextPath, name)
  const lstat = await fs.lstat(entryPath)
  const relativePath = normalizeRelativePath(path.relative(rootPath, entryPath))

  if (!lstat.isSymbolicLink()) {
    return {
      name,
      path: entryPath,
      relativePath,
      mode: 'local',
      kind: projectContextEntryKind(lstat),
      size: lstat.isFile() ? lstat.size : undefined,
      updatedAt: lstat.mtimeMs,
    }
  }

  const rawTarget = await fs.readlink(entryPath).catch(() => '')
  const targetPath = rawTarget ? path.resolve(contextPath, rawTarget) : undefined
  const targetStat = await fs.stat(entryPath).catch(() => null)
  return {
    name,
    path: entryPath,
    relativePath,
    mode: 'reference',
    kind: targetStat ? projectContextEntryKind(targetStat) : 'other',
    targetPath,
    targetMissing: !targetStat,
    size: targetStat?.isFile() ? targetStat.size : undefined,
    updatedAt: targetStat?.mtimeMs ?? lstat.mtimeMs,
  }
}

async function lstatIfExists(targetPath: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(targetPath)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function projectContextAddResultFromContext(
  context: ProjectContextResult,
  added: ProjectContextEntry[],
  skipped: ProjectContextSkippedEntry[],
): ProjectContextAddResult {
  if (!context.ok) return context
  return {
    ...context,
    added,
    skipped,
  }
}

async function nextAvailableContextEntryPath(contextPath: string, preferredName: string): Promise<string> {
  const parsed = path.parse(preferredName)
  const baseName = parsed.name || preferredName
  const extension = parsed.ext
  let candidate = path.join(contextPath, preferredName)
  let index = 2
  while (await lstatIfExists(candidate)) {
    candidate = path.join(contextPath, `${baseName} ${index}${extension}`)
    index += 1
  }
  return candidate
}

function normalizeProjectContextAddMode(value: unknown): ProjectContextAddMode {
  return value === 'copy' ? 'copy' : 'reference'
}

function projectContextSymlinkType(stat: import('node:fs').Stats): 'file' | 'dir' | 'junction' {
  if (!stat.isDirectory()) return 'file'
  return process.platform === 'win32' ? 'junction' : 'dir'
}

function projectContextEntryKind(stat: import('node:fs').Stats): ProjectContextEntry['kind'] {
  if (stat.isDirectory()) return 'directory'
  if (stat.isFile()) return 'file'
  return 'other'
}

function isSameOrInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAgentKnowledgeSearchKind(value: unknown): value is AgentKnowledgeSearchKind {
  return value === 'agent' || value === 'command' || value === 'home-plugin' || value === 'memory' || value === 'skill' || value === 'task'
}

async function copySvgToClipboard(svg: string): Promise<boolean> {
  const size = readSvgClipboardSize(svg)
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  const renderWindow = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    resizable: false,
    backgroundColor: '#ffffff',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    await renderWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildSvgClipboardHtml(svgDataUrl, size.width, size.height))}`,
    )
    const ready = await waitForSvgClipboardRender(renderWindow)
    if (!ready) return false

    await delay(80)
    const image = await renderWindow.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height })
    if (image.isEmpty()) return false
    clipboard.writeImage(image)
    return true
  } catch {
    return false
  } finally {
    if (!renderWindow.isDestroyed()) renderWindow.destroy()
  }
}

function buildSvgClipboardHtml(svgDataUrl: string, width: number, height: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#fff;}
img{display:block;width:${width}px;height:${height}px;object-fit:contain;background:#fff;}
</style>
</head>
<body>
<img id="svg-source" src="${svgDataUrl}" alt="">
<script>
const img = document.getElementById('svg-source');
window.__svgClipboardReady = img.complete && img.naturalWidth > 0;
window.__svgClipboardFailed = false;
img.onload = () => { window.__svgClipboardReady = true; };
img.onerror = () => { window.__svgClipboardFailed = true; };
</script>
</body>
</html>`
}

async function waitForSvgClipboardRender(renderWindow: BrowserWindow): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 2500) {
    const status = (await renderWindow.webContents.executeJavaScript(
      `({
        ready: Boolean(window.__svgClipboardReady),
        failed: Boolean(window.__svgClipboardFailed),
        naturalWidth: document.getElementById('svg-source')?.naturalWidth || 0
      })`,
      true,
    )) as { ready?: boolean; failed?: boolean; naturalWidth?: number }
    if (status.ready && (status.naturalWidth ?? 0) > 0) return true
    if (status.failed) return false
    await delay(50)
  }
  return false
}

function readSvgClipboardSize(svg: string): { width: number; height: number } {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? ''
  const width = parseSvgClipboardDimension(readSvgAttribute(svgTag, 'width'))
  const height = parseSvgClipboardDimension(readSvgAttribute(svgTag, 'height'))
  const viewBox = readSvgAttribute(svgTag, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)

  return {
    width: clampSvgClipboardDimension(width || (Number.isFinite(viewBox?.[2]) ? viewBox?.[2] : 920)),
    height: clampSvgClipboardDimension(height || (Number.isFinite(viewBox?.[3]) ? viewBox?.[3] : 320)),
  }
}

function readSvgAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
}

function parseSvgClipboardDimension(value: string): number {
  const trimmed = value.trim()
  if (!trimmed || trimmed.endsWith('%')) return 0
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function clampSvgClipboardDimension(value: number | undefined): number {
  const normalized = Number.isFinite(value) && value && value > 0 ? value : 1
  return Math.min(Math.max(1, Math.ceil(normalized)), CLIPBOARD_SVG_MAX_DIMENSION)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).filter(Boolean).join('/')
}
