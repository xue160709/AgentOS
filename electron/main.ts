/**
 * Electron 主进程入口：BrowserWindow、托盘、IPC 与 Claude Agent。
 * Electron main entry: window lifecycle, tray menu, IPC bridges, and Claude Agent runner.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, safeStorage, session, shell, Tray, WebContentsView } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
  AgentWebSearchProviderTestResult,
} from '../src/desktop-types'
import { ensureAgentModeFiles, getAgentModeStatus, setAgentModeState } from './agent-mode-files'
import { AgentModeSettingsStore, getDefaultWebSearchSettings, normalizeAgentMcpServers, normalizeWebSearchSettings } from './agent-mode-settings-store'
import { discoverAgentContext, searchAgentKnowledge } from './agent-context'
import { ClaudeAgentRunner } from './claude-agent-runner'
import { createClaudeChatWebContentsSink } from './claude-chat-web-contents-sink'
import { ClaudeChatEventMultiplexer } from './claude-chat-event-multiplexer'
import { createProjectChatProductionComposition, projectChatBrokerV2Enabled } from './project-chat-composition'
import { ProjectChatBroker } from './project-chat-broker'
import { RendererCapabilityRegistry, ProjectChatPermissionService, createProjectChatCapabilityBroadcaster, createProjectChatIpcRouter } from './project-chat-ipc'
import { createProjectChatBrokerRunnerAdapter, createProjectChatScopedReadCollaborator, createRuntimeChatScopedReadCollaborator } from './project-chat-runtime-services'
import { ProjectChatPresenceRegistry } from './project-chat-presence'
import { ProjectChatWindowManager } from './project-chat-window-manager'
import { ProjectChatViewStateStore } from './project-chat-view-state-store'
import { RuntimePreviewLayoutStore } from './runtime-preview-layout-store'
import { AgentOSDeepLinkQueue, parseAgentOSDeepLink } from './agentos-deep-link'
import { AgentOSTicketClient, createDeadlineBoundAgentOSTicketTransport, type AgentOSTicketTransport } from './agentos-ticket-client'
import { AgentOSExternalTaskService } from './agentos-external-task'
import { WebsiteBindingStore } from './website-binding-store'
import { ExternalTaskReceiptStore } from './external-task-receipt-store'
import { AgentOSPairingService } from './agentos-pairing'
import { probeMcpServer } from './claude-agent-runner/mcp-probe'
import { buildMcpExecutableEnv } from './claude-agent-runner/mcp'
import { testWebSearchProviderSettings } from './claude-agent-runner/web-search'
import { ClaudeAgentSettingsStore } from './claude-agent-settings'
import { ChatWorkspaceStore } from './chat-workspace-store'
import { migrateAttachmentThumbnails, shrinkAttachmentThumbnail } from './chat-attachment-thumbnail'
import { ChatWorkspaceCoordinator } from './chat-workspace-coordinator'
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
import {
  LocalAppRuntimeManager,
  LocalAppTrustStore,
  RuntimeEditRuntimeBridge,
  inspectLocalAppDirectory,
  canonicalizeLocalAppRoot,
  isContainedInProject,
  projectRuntimeRoot,
} from './local-app-runtime/index'
import { LocalAppPreviewManager } from './local-app-runtime/preview'
import type { PreviewSessionSnapshot, StaticPreviewSessionRegistrar } from './local-app-runtime/preview'
import type { AgentOSPairingResponse } from '../src/project-chat-contract'
import { fingerprintStaticSource, resolveStaticRequest, STATIC_PREVIEW_SCHEME } from './local-app-runtime/static'
import type { StaticPreviewRegistry } from './local-app-runtime/static'
import { RuntimeEditCoordinator } from './runtime-edit-coordinator'
import { RuntimeChatBroker } from './runtime-chat-broker'
import { RuntimeDevelopmentCoordinator } from './runtime-development-coordinator'
import { canonicalizeProspectiveProjectRuntimeRoot, RuntimeDevelopmentRuntimeBridge } from './runtime-development-runtime-bridge'
import { RuntimeDevelopmentThreadStore } from './runtime-development-thread-store'
import { RuntimeDevelopmentViewStateStore } from './runtime-development-view-state-store'
import { RuntimeDevelopmentWindowManager } from './runtime-development-window-manager'
import { createRuntimeChatCapabilityBroadcaster, createRuntimeChatIpcRouter } from './runtime-chat-ipc'
import { ProjectRuntimePlacementTracker } from './project-runtime-placement'
import type { Session } from 'electron'
import type { ChatWorkspaceState, RuntimeDefinition, RuntimeEvent, RuntimeSnapshot, WorkspaceTab } from '../src/components/types'
import type { LocalAppDefinition, LocalAppRuntimeSnapshot } from '../src/components/types'
import type { LocalAppDefinitionResult, LocalAppPreviewResult, LocalAppRelocationResult, RuntimeCreationResult, WorkspaceTabResult, WorkspaceTabCloseResult } from '../src/desktop-api'
import {
  parseRuntimeScopeId,
  projectRuntimeScopeId,
  workspaceRuntimeScopeId,
  type OpenRuntimeDevelopmentResult,
  type ResolvedRuntimeChatScope,
  type RuntimeDevelopmentResult,
  type RuntimeDevelopmentThread,
  type RuntimeDevelopmentTarget,
  type RuntimeRootLease,
  type RuntimeScopeId,
} from '../src/runtime-development-contract'
import { withNextWorkspaceRevision, workspaceRevisionOf } from '../src/workspace-snapshot-resolution'
import {
  applyWorkspaceCommand,
  parseWorkspaceCommand,
  workspaceCommandApplied,
  type WorkspaceCommandResult,
} from '../src/workspace-commands'
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
  ChatHistorySearchItem,
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
// Finder/Dock 启动的 release 版只继承 /usr/bin:/bin:/usr/sbin:/sbin；补上 node/npm 常见安装目录，
// 否则 Runtime 的 npm 子进程会 spawn ENOENT。
if (process.platform !== 'win32') {
  const executablePath = buildMcpExecutableEnv(process.env).PATH
  if (executablePath) process.env.PATH = executablePath
}
installSafeStdStreamHandlers()

// 🚧 使用 process.env['KEY'] 避免被 vite:define 内联；见 Vite 2.x 插件行为 /
// 🚧 Use bracket notation so vite:define does not replace env keys (Vite@2.x plugin behavior).
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const APP_NAME = 'AgentOS'
// Read exactly once in Main. Renderer and persisted preferences have no say in this switch.
const PROJECT_CHAT_BROKER_V2_ENABLED = projectChatBrokerV2Enabled(process.env)

// Must be declared before app.ready. Renderer pages never receive a path or
// command; the opaque host is resolved only by this Main-owned registry.
protocol.registerSchemesAsPrivileged([
  { scheme: STATIC_PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } },
  { scheme: 'agentos', privileges: { standard: true, secure: true } },
])

const TRAY_LOCALE_BUNDLE = { zh, en } as const
type TrayLocale = keyof typeof TRAY_LOCALE_BUNDLE

let win: BrowserWindow | null
let tray: Tray | null = null
let isQuitting = false
let currentTrayLocale: TrayLocale = 'zh'
let claudeAgentRunner: ClaudeAgentRunner | null = null
let claudeChatEventMultiplexer: ClaudeChatEventMultiplexer | null = null
let projectChatBroker: ProjectChatBroker | null = null
let projectChatCompositionDispose: (() => void) | null = null
let runtimeDevelopmentCoordinator: RuntimeDevelopmentCoordinator | null = null
let runtimeDevelopmentRuntimeBridge: RuntimeDevelopmentRuntimeBridge | null = null
let runtimeDevelopmentThreadStore: RuntimeDevelopmentThreadStore | null = null
let runtimeDevelopmentWindowManager: RuntimeDevelopmentWindowManager | null = null
let runtimeDevelopmentBroker: RuntimeChatBroker | null = null
let claudeAgentSettingsStore: ClaudeAgentSettingsStore | null = null
let agentModeSettingsStore: AgentModeSettingsStore | null = null
let chatWorkspaceStore: ChatWorkspaceStore | null = null
let chatWorkspaceCoordinator: ChatWorkspaceCoordinator | null = null
let desktopPreferencesStore: DesktopPreferencesStore | null = null
let runtimePreviewLayoutStore: RuntimePreviewLayoutStore | null = null
let taskHomePluginManager: TaskHomePluginManager | null = null
let speechRecognitionService: MacSpeechRecognitionService | null = null
let claudeSettingsOperationChain: Promise<void> = Promise.resolve()
let localAppRuntimeManager: LocalAppRuntimeManager | null = null
let runtimeEditCoordinator: RuntimeEditCoordinator | null = null
let runtimeEditRuntimeBridge: RuntimeEditRuntimeBridge | null = null
let projectRuntimePlacementTracker: ProjectRuntimePlacementTracker | null = null
let localAppTrustStore: LocalAppTrustStore | null = null
let localAppPreviewManager: LocalAppPreviewManager | null = null
let localAppQuitCleanup: Promise<void> | null = null
let staticPreviewSessionRegistrar: StaticPreviewSessionRegistrar | null = null
const agentOSDeepLinkQueue = new AgentOSDeepLinkQueue()
let agentOSExternalTaskService: AgentOSExternalTaskService | null = null
let websiteBindingStore: WebsiteBindingStore | null = null
let agentOSPairingService: AgentOSPairingService | null = null
let externalTaskWindowHooks: { beforeCreate(projectId: string): Promise<{ exists: boolean; idle: boolean }>; accepted(projectId: string, threadId: string, receivedAt: number, before: unknown): Promise<void> } | null = null

type ProjectRuntimeHostRegistration = {
  projectId: string
  mountId: string
  canonicalRoot: string
  runtimeDefinitionId: string
}

const projectRuntimeHosts = new Map<string, ProjectRuntimeHostRegistration>()
const projectRuntimeMountIds = new Map<string, string>()
const runtimeDevelopmentConflictTokens = new Map<string, { senderWebContentsId: number; runtimeScopeId: RuntimeScopeId; expiresAt: number }>()
const runtimeDevelopmentRouteGenerations = new Map<RuntimeScopeId, number>()

async function staticPreviewResponse(
  request: { url: string; method: string },
  registry: StaticPreviewRegistry,
  expectedHost?: string,
): Promise<Response> {
  if (expectedHost) {
    let requestHost: string
    try { requestHost = new URL(request.url).hostname.toLowerCase() } catch { return new Response('invalid-url', { status: 400 }) }
    if (requestHost !== expectedHost) return new Response('cross-runtime', { status: 403 })
  }
  const resolved = await resolveStaticRequest(request.url, request.method, registry)
  if (!resolved.ok) return new Response(resolved.reason, { status: resolved.status })
  let body: Uint8Array | null = null
  if (request.method.toUpperCase() !== 'HEAD') {
    try { body = await fs.readFile(resolved.filePath) } catch { return new Response('missing', { status: 404 }) }
  }
  return new Response(body as unknown as BodyInit | null, {
    status: 200,
    headers: {
      'content-type': resolved.contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function projectRuntimeConsumerId(host: Pick<ProjectRuntimeHostRegistration, 'projectId' | 'mountId'>): string {
  return `project-home:${host.projectId}:${host.mountId}`
}

function registeredProjectRuntimeHost(projectId: string, mountId: string, runtimeDefinitionId: string, canonicalRoot?: string): ProjectRuntimeHostRegistration | null {
  const host = projectRuntimeHosts.get(projectId)
  if (!host || host.mountId !== mountId || host.runtimeDefinitionId !== runtimeDefinitionId) return null
  if (canonicalRoot && host.canonicalRoot !== canonicalRoot) return null
  return host
}

async function registerProjectRuntimeHost(host: ProjectRuntimeHostRegistration): Promise<void> {
  const previous = projectRuntimeHosts.get(host.projectId)
  if (previous && (previous.mountId !== host.mountId || previous.runtimeDefinitionId !== host.runtimeDefinitionId || previous.canonicalRoot !== host.canonicalRoot)) {
    const previousConsumerId = projectRuntimeConsumerId(previous)
    projectRuntimeHosts.delete(previous.projectId)
    await localAppPreviewManager?.closeForTab(previousConsumerId).catch(() => undefined)
    await localAppRuntimeManager?.release(previous.runtimeDefinitionId, previousConsumerId).catch(() => undefined)
  }
  projectRuntimeHosts.set(host.projectId, host)
}

async function clearProjectRuntimeHost(projectId: string): Promise<void> {
  const host = projectRuntimeHosts.get(projectId)
  if (!host) return
  projectRuntimeHosts.delete(projectId)
  const consumerId = projectRuntimeConsumerId(host)
  await localAppPreviewManager?.closeForTab(consumerId).catch(() => undefined)
  await localAppRuntimeManager?.release(host.runtimeDefinitionId, consumerId).catch(() => undefined)
}

async function releaseRegisteredProjectRuntimeHost(runtimeDefinitionId: string, consumerId: string): Promise<RuntimeSnapshot | null> {
  await localAppPreviewManager?.closeForTab(consumerId).catch(() => undefined)
  const host = [...projectRuntimeHosts.values()].find((candidate) => candidate.runtimeDefinitionId === runtimeDefinitionId && projectRuntimeConsumerId(candidate) === consumerId)
  if (!host) return localAppRuntimeManager?.release(runtimeDefinitionId, consumerId) ?? null
  projectRuntimeHosts.delete(host.projectId)
  return localAppRuntimeManager?.release(runtimeDefinitionId, consumerId) ?? null
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

/** 与 VITE 开发服务器一致：打包产物无开发菜单 / Matches Vite dev server; packaged builds omit dev menu */
const isDevRuntime = Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged
process.env.AGENTOS_DEV_RUNTIME = isDevRuntime ? '1' : '0'

app.setName(APP_NAME)
// Packaging declares the same scheme; this keeps development launches routable.
app.setAsDefaultProtocolClient('agentos')

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

  const previewWindow = win
  localAppPreviewManager = new LocalAppPreviewManager({
    window: previewWindow,
    createView: ({ webPreferences }) => new WebContentsView({ webPreferences }),
    registerStaticPreviewSession: (session, previewUrl) => {
      if (!staticPreviewSessionRegistrar) throw new Error('static-preview-session-handler-unavailable')
      return staticPreviewSessionRegistrar(session, previewUrl)
    },
    onEvent: (snapshot) => {
      // Preview 状态通过 runtime event seam 复用；不把预览对象写入 workspace snapshot。
      // Preview health is not process health. Keep the managed runtime status
      // separate while forwarding loading/ready/degraded/failed transitions.
      sendRuntimeEvent({
        type: 'status',
        runtimeDefinitionId: snapshot.localAppId,
        runtimeId: snapshot.runtimeId,
        generation: snapshot.generation,
        status: 'running',
        previewStatus: snapshot.status,
        detail: snapshot.detail,
        phase: 'preview',
        timestamp: Date.now(),
      })
    },
    onNavigationState: (state) => {
      if (!previewWindow.isDestroyed()) previewWindow.webContents.send(DESKTOP_EVENT_CHANNELS.onRuntimePreviewNavigationState, state)
    },
    onAgentOSDeepLink: enqueueAgentOSPreviewDeepLink,
  })

  attachExternalLinkHandlers(win.webContents)

  claudeChatEventMultiplexer = new ClaudeChatEventMultiplexer()
  claudeAgentRunner = new ClaudeAgentRunner(
    claudeChatEventMultiplexer,
    process.env.APP_ROOT,
    (modelPick) => getClaudeAgentSettingsStore().resolve(modelPick),
    (rootPath) => getAgentModeSettingsStore().resolve(rootPath),
    async () => {
      const result = await getAgentModeSettingsStore().getGlobalWebSearchSettings()
      return result.ok ? result.settings : getDefaultWebSearchSettings()
    },
    () => normalizeUiLocale(getDesktopPreferencesStore().read().locale),
    () => undefined,
  )

  taskHomePluginManager = new TaskHomePluginManager({
    getRunPort: taskHomeRunPort,
    getWorkspace: () => chatWorkspaceStore?.read() ?? null,
    emitTaskEvent: sendTaskHomePluginEvent,
  })
  if (PROJECT_CHAT_BROKER_V2_ENABLED) {
    installProjectChatProductionComposition()
  } else {
    claudeChatEventMultiplexer.setSinks([
      createClaudeChatWebContentsSink(win.webContents),
      { publish: (event) => taskHomePluginManager?.handleClaudeEvent(event) },
    ])
  }
  void taskHomePluginManager.refreshFromWorkspace()

  win.on('close', (event) => {
    // 关闭按钮只隐藏到菜单栏；Cmd+Q / 托盘右键退出才会真正退出 /
    // Close hides to the menu bar; only Cmd+Q or tray Quit exits.
    if (isQuitting) return
    event.preventDefault()
    win?.hide()
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
    void agentOSPairingService?.cancelAll()
    projectChatCompositionDispose?.()
    projectChatCompositionDispose = null
    speechRecognitionService?.dispose()
    claudeAgentRunner = null
    claudeChatEventMultiplexer = null
    projectChatBroker = null
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

/**
 * 一次性迁移：把历史上写进 dataUrl 的原图压成缩略图。
 * Workspaces written before the thumbnail policy stored full-resolution images
 * in `dataUrl`, which every workspace read, write, and broker snapshot then
 * copied. Shrink them once at startup; an already-compliant workspace performs
 * no write.
 */
async function runAttachmentThumbnailMigration(): Promise<void> {
  const store = chatWorkspaceStore
  if (!store) return
  try {
    await runChatWorkspaceOperation(async () => {
      const current = store.read()
      if (!current) return
      const migrated = migrateAttachmentThumbnails(current)
      if (!migrated.changed) return
      await store.save(migrated.state)
      console.info('[attachments] thumbnail migration', {
        shrunk: migrated.shrunkCount,
        bytesSaved: migrated.bytesSaved,
      })
    })
  } catch (error) {
    // A failed migration must never block startup; it retries next launch.
    console.warn('[attachments] thumbnail migration failed', error)
  }
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

function getRuntimePreviewLayoutStore() {
  return runtimePreviewLayoutStore ??= new RuntimePreviewLayoutStore({ userDataPath: app.getPath('userData') })
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
  if (!chatWorkspaceCoordinator) throw new Error('Chat workspace coordinator is not ready.')
  return chatWorkspaceCoordinator.runExclusive(operation)
}

function nextWorkspaceProjectId(projects: readonly { id: string }[]): string {
  const existing = new Set(projects.map((project) => project.id))
  let id = ''
  do {
    id = `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  } while (existing.has(id))
  return id
}

/** A memory-only Main network partition; no renderer can use this session. */
function createAgentOSTicketTransport(): AgentOSTicketTransport {
  const ticketSession = session.fromPartition('agentos-ticket-v1')
  return createDeadlineBoundAgentOSTicketTransport((input) => net.request({ method: input.method, url: input.url, headers: input.headers, session: ticketSession, redirect: input.redirect, credentials: input.credentials }))
}

function enqueueAgentOSDeepLink(raw: unknown): void {
  const parsed = parseAgentOSDeepLink(raw)
  if (!parsed.ok) return
  if (!agentOSDeepLinkQueue.enqueue(parsed.value)) return
  void drainAgentOSDeepLinks()
}

/**
 * Preview has no preload or IPC capability. Its only allowed protocol handoff
 * is guarded by the exact active PreviewSession/runtime generation before and
 * after the synchronous shared parser/queue call.
 */
function enqueueAgentOSPreviewDeepLink(raw: string, preview: PreviewSessionSnapshot): void {
  if (!isCurrentPreviewSession(preview)) return
  enqueueAgentOSDeepLink(raw)
  // Queue insertion is synchronous; this postcondition prevents any future
  // work in this seam from observing a destroyed or replacement generation.
  if (!isCurrentPreviewSession(preview)) return
}

function isCurrentPreviewSession(preview: PreviewSessionSnapshot): boolean {
  const current = localAppPreviewManager?.get(preview.previewId)
  return current === preview && current.runtimeId === preview.runtimeId && current.generation === preview.generation && current.status !== 'closed'
}

async function drainAgentOSDeepLinks(): Promise<void> {
  const service = agentOSExternalTaskService
  if (!service) return
  for (const link of agentOSDeepLinkQueue.drain()) {
    if (link.action === 'task') await service.handle(link)
    if (link.action === 'pair') await agentOSPairingService?.enqueue(link)
  }
}

function initializeAgentOSExternalTasks(): void {
  if (!projectChatBroker || agentOSExternalTaskService) return
  const userDataPath = app.getPath('userData')
  agentOSExternalTaskService = new AgentOSExternalTaskService({
    bindings: websiteBindingStore ??= new WebsiteBindingStore({ userDataPath, safeStorage }),
    receipts: new ExternalTaskReceiptStore({ userDataPath }),
    tickets: new AgentOSTicketClient(createAgentOSTicketTransport()), broker: projectChatBroker,
    beforeCreate: ({ projectId }) => externalTaskWindowHooks?.beforeCreate(projectId),
    accepted: ({ projectId, threadId, receivedAt, before }) => externalTaskWindowHooks?.accepted(projectId, threadId, receivedAt, before),
  })
  agentOSPairingService ??= new AgentOSPairingService({
    tickets: new AgentOSTicketClient(createAgentOSTicketTransport()), bindings: websiteBindingStore,
    projects: async () => chatWorkspaceStore?.read()?.projects.map((project) => ({ id: project.id, pathMissing: project.pathMissing })) ?? [],
    publish: (pairing) => {
      if (pairing) showMainWindow()
      if (win && !win.isDestroyed()) win.webContents.send('project-chat:event', { type: 'agentos-pairing', pairing })
    },
  })
  void drainAgentOSDeepLinks()
}

/** Main supplies real Electron primitives; the composition transaction owns all enabled wiring. */
function installProjectChatProductionComposition(): void {
  if (!PROJECT_CHAT_BROKER_V2_ENABLED || !win || !claudeAgentRunner || !chatWorkspaceStore || !claudeChatEventMultiplexer || projectChatBroker) return
  const mainWindow = win; const runner = claudeAgentRunner; const workspace = chatWorkspaceStore
  const capabilities = new RendererCapabilityRegistry(); const presence = new ProjectChatPresenceRegistry()
  const runtimeDeliver = (webContentsId: number, event: import('../src/runtime-development-contract').RuntimeChatEvent) => {
    const target = BrowserWindow.getAllWindows().map((item) => item.webContents).find((contents) => contents.id === webContentsId)
    if (target && !target.isDestroyed()) target.send('runtime-chat:event', event)
  }
  const broadcaster = createProjectChatCapabilityBroadcaster(capabilities, (webContentsId, event) => {
    const target = BrowserWindow.getAllWindows().map((item) => item.webContents).find((contents) => contents.id === webContentsId)
    if (target && !target.isDestroyed()) target.send('project-chat:event', event)
  })
  const broker = new ProjectChatBroker({
    store: workspace,
    runner: createProjectChatBrokerRunnerAdapter(runner),
    runExclusive: (operation) => runChatWorkspaceOperation(async () => operation()),
    permissionMode: () => getDesktopPreferencesStore().read().chatPermissionMode ?? 'auto',
    promptOwnerCandidates: (input) => presence.ownerCandidates(input),
    broadcast: broadcaster,
    runtimeEditCoordinator: runtimeEditCoordinator ?? undefined,
    runtimeEditEligible: (projectId) => readProjectRuntimeDefinition(projectId) !== null,
    onProjectRunStarting: (projectId, projectRoot) => projectRuntimePlacementTracker?.beforeRun(projectId, projectRoot),
    onProjectRunTerminal: async (projectId, projectRoot) => {
      await projectRuntimePlacementTracker?.afterRun(projectId, projectRoot)
      sendProjectFilesChanged({ rootPath: projectRoot })
    },
  })
  const runtimeStore = new RuntimeDevelopmentThreadStore(app.getPath('userData'))
  runtimeDevelopmentThreadStore = runtimeStore
  let runtimeBridge: RuntimeDevelopmentRuntimeBridge | null = null
  const runtimeCoordinator = new RuntimeDevelopmentCoordinator({
    fingerprint: (runtimeScopeId) => runtimeBridge?.fingerprint(runtimeScopeId) ?? Promise.reject(new Error('runtime-development-bridge-unavailable')),
    intent: (intent) => runtimeBridge?.handle(intent),
    onSnapshot: (snapshot) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_EVENT_CHANNELS.onRuntimeDevelopmentEvent, { type: 'snapshot', snapshot })
      }
      for (const capability of capabilities.runtimeRecipientsFor(snapshot)) {
        runtimeDeliver(capability.webContentsId, { type: 'development', runtimeScopeId: snapshot.runtimeScopeId, routeGeneration: snapshot.routeGeneration, developmentGeneration: snapshot.developmentGeneration, snapshot })
      }
    },
  })
  runtimeDevelopmentCoordinator = runtimeCoordinator
  const runtimeBroadcaster = createRuntimeChatCapabilityBroadcaster(capabilities, runtimeDeliver)
  const runtimeBroker = new RuntimeChatBroker({
    core: broker.core, store: runtimeStore, resolveScope: resolveRuntimeChatScope,
    permissionMode: () => getDesktopPreferencesStore().read().chatPermissionMode ?? 'auto',
    broadcast: runtimeBroadcaster, promptOwnerCandidates: (input) => presence.runtimeOwnerCandidates(input),
    developmentCoordinator: runtimeCoordinator,
  })
  runtimeDevelopmentBroker = runtimeBroker
  runtimeBridge = new RuntimeDevelopmentRuntimeBridge({
    coordinator: runtimeCoordinator, manager: localAppRuntimeManager!, resolveDefinition: (runtimeScopeId) => {
      const definitionId = resolveRuntimeChatScope(runtimeScopeId)?.runtimeDefinitionId
      return definitionId ? readRuntimeDefinition(definitionId) : null
    }, runner, runtimeBroker,
    isAuthorityCurrent: (authority) => {
      const resolved = resolveRuntimeChatScope(authority.runtimeScopeId)
      return Boolean(resolved && resolved.routeGeneration === authority.routeGeneration && resolved.developmentGeneration === authority.developmentGeneration)
    },
    resolveProspectiveRoot: async (runtimeScopeId) => {
      const parsed = parseRuntimeScopeId(runtimeScopeId)
      const state = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
      const project = parsed?.kind === 'project' ? state?.projects.find((item) => item.id === parsed.projectId) : undefined
      if (!project || project.pathMissing) throw new Error('runtime-project-path-missing')
      // Main fresh-reads the Project and canonicalizes its parent directory;
      // renderer DTOs never carry a root or a path alias.
      return canonicalizeProspectiveProjectRuntimeRoot(project.path)
    },
  })
  runtimeDevelopmentRuntimeBridge = runtimeBridge
  const scopedRead = createProjectChatScopedReadCollaborator({
    workspace, settings: getClaudeAgentSettingsStore(), runner, discoverAgentContext, searchProjectFiles: async (rootPath, query) => searchProjectFiles(rootPath, query),
    pickAttachments: async (allowImages) => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] }); return result.canceled ? { attachments: [], skipped: [] } : readChatAttachments(result.filePaths, allowImages) },
    readAttachments: readChatAttachments, realpath: (input) => fs.realpath(input),
  })
  const rendererEntry = VITE_DEV_SERVER_URL ?? pathToFileURL(path.join(RENDERER_DIST, 'index.html')).toString()
  const viewStateStore = new ProjectChatViewStateStore({ userDataPath: app.getPath('userData') })
  const runtimeViewStateStore = new RuntimeDevelopmentViewStateStore({
    userDataPath: app.getPath('userData'),
    threadBelongsToScope: (runtimeScopeId, threadId) => runtimeStore.read().runtimeDevelopmentThreads.some((thread) => thread.runtimeScopeId === runtimeScopeId && thread.id === threadId),
  })
  const runtimeWindowManager = new RuntimeDevelopmentWindowManager({
    createWindow: (options) => new BrowserWindow(options), rendererEntry, preloadPath: path.join(__dirname, 'preload.mjs'), capabilities, viewStateStore: runtimeViewStateStore,
    prepare: async (runtimeScopeId) => {
      const resolved = resolveRuntimeChatScope(runtimeScopeId)
      if (!resolved) throw new Error('runtime-scope-unavailable')
      let current = runtimeCoordinator.snapshot(runtimeScopeId)
      if (current && current.routeGeneration !== resolved.routeGeneration) current = runtimeCoordinator.invalidateRoute(runtimeScopeId, resolved.routeGeneration) ?? undefined
      const definitionExists = Boolean(resolved.runtimeDefinitionId && readRuntimeDefinition(resolved.runtimeDefinitionId))
      const identity = runtimeWindowIdentity(runtimeScopeId)
      return {
        context: { runtimeScopeId, ...identity, scopeAvailable: resolved.available !== false },
        authority: { runtimeScopeId, routeGeneration: current?.routeGeneration ?? resolved.routeGeneration, developmentGeneration: current?.developmentGeneration ?? resolved.developmentGeneration },
        // Tombstones always create a fresh read-only projection. Reentering an
        // old closed session would otherwise try to reacquire its removed root.
        action: resolved.available === false && !definitionExists
          ? 'open'
          : current ? (current.canReopen || current.phase === 'closed' ? 'reenter' : 'reuse-session') : 'open',
      }
    },
    activate: async (preparation) => {
      if (preparation.action === 'reenter') return runtimeBridge!.reenter(preparation.authority.runtimeScopeId)
      if (preparation.action === 'reuse-session') return runtimeCoordinator.snapshot(preparation.authority.runtimeScopeId) ?? null
      const resolved = resolveRuntimeChatScope(preparation.authority.runtimeScopeId)
      if (!resolved) return null
      if (!resolved.runtimeDefinitionId && parseRuntimeScopeId(preparation.authority.runtimeScopeId)?.kind === 'project') return runtimeBridge!.open(preparation.authority)
      if (!resolved.runtimeDefinitionId) {
        runtimeCoordinator.open({ ...preparation.authority, entryFingerprint: '', saveCapability: 'unavailable' })
        runtimeCoordinator.failOpening(preparation.authority, 'runtime-root-missing', 'Runtime 已移除；历史对话仍可查看。')
        return runtimeCoordinator.snapshot(preparation.authority.runtimeScopeId) ?? null
      }
      if (!readRuntimeDefinition(resolved.runtimeDefinitionId)) {
        runtimeCoordinator.open({ ...preparation.authority, runtimeDefinitionId: resolved.runtimeDefinitionId, entryFingerprint: '', saveCapability: 'unavailable' })
        runtimeCoordinator.failOpening(preparation.authority, 'runtime-root-missing', 'Runtime 已移除；历史对话仍可查看。')
        return runtimeCoordinator.snapshot(preparation.authority.runtimeScopeId) ?? null
      }
      if (resolved.available === false) {
        runtimeCoordinator.open({ ...preparation.authority, runtimeDefinitionId: resolved.runtimeDefinitionId, entryFingerprint: '', saveCapability: 'unavailable' })
        runtimeCoordinator.failOpening(preparation.authority, 'runtime-trust-required', '此 Runtime 尚未获得目录权限。')
        return runtimeCoordinator.snapshot(preparation.authority.runtimeScopeId) ?? null
      }
      return runtimeBridge!.open(preparation.authority)
    },
    requestExit: (authority) => { runtimeCoordinator.requestExit(authority) },
    onActivated: (webContentsId, snapshot) => runtimeDeliver(webContentsId, { type: 'development', runtimeScopeId: snapshot.runtimeScopeId, routeGeneration: snapshot.routeGeneration, developmentGeneration: snapshot.developmentGeneration, snapshot }),
    onCapabilityRegistered: (capability) => { presence.register(capability); void runtimeBroker.refreshPromptOwners(capability.runtimeScopeId) },
    onWindowState: (webContentsId, state) => { presence.setWindowState(webContentsId, state); const capability = capabilities.get(webContentsId); if (capability?.kind === 'runtime-development') void runtimeBroker.refreshPromptOwners(capability.runtimeScopeId) },
    onWindowCleanup: (webContentsId) => { presence.unregister(webContentsId); void runtimeBroker.onWebContentsUnavailable(webContentsId); capabilities.unregister(webContentsId) },
  })
  runtimeDevelopmentWindowManager = runtimeWindowManager
  const composition = createProjectChatProductionComposition({
    multiplexer: claudeChatEventMultiplexer,
    legacySinks: [createClaudeChatWebContentsSink(mainWindow.webContents), { publish: (event) => taskHomePluginManager?.handleClaudeEvent(event as never) }],
    broker, taskHomeSink: { publish: (event) => taskHomePluginManager?.handleClaudeEvent(event as never) }, capabilities, presence, mainWindow,
    registrar: { handle: (channel, handler) => ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown), removeHandler: (channel) => ipcMain.removeHandler(channel) },
    createCollaborator: (lifecycle) => {
      const manager = new ProjectChatWindowManager({
        createWindow: (options) => new BrowserWindow(options), rendererEntry, preloadPath: path.join(__dirname, 'preload.mjs'), capabilities,
        routeGenerationOf: (projectId) => broker.routeGenerationOf(projectId), viewStateStore,
        resolveProjectName: (projectId) => workspace.read()?.projects.find((project) => project.id === projectId)?.name ?? projectId,
        onWebContentsUnavailable: (webContentsId) => { void broker.onWebContentsUnavailable(webContentsId) },
        onCapabilityRegistered: lifecycle.onCapabilityRegistered, onWindowState: lifecycle.onWindowState, onWindowCleanup: lifecycle.onWindowCleanup,
      })
      externalTaskWindowHooks = {
        beforeCreate: async (projectId) => {
          const existing = manager.get(projectId)
          if (!existing || existing.isDestroyed()) return { exists: false, idle: true }
          const [view, snapshot] = await Promise.all([viewStateStore.get(projectId), broker.getSnapshot(projectId)])
          await broker.refreshExternalUnread(projectId, view.externalTaskSeenAt)
          const active = snapshot.ok && snapshot.value.runs.some((run) => !['succeeded', 'failed', 'cancelled'].includes(run.phase))
          const prompt = snapshot.ok && snapshot.value.pendingPrompts.length > 0
          return { exists: true, idle: !view.draft && !active && !prompt }
        },
        accepted: async (projectId, threadId, receivedAt, before) => {
          const eligible = !before || (typeof before === 'object' && before !== null && (before as { idle?: boolean }).idle)
          if (!eligible) return
          await manager.open(projectId)
          await viewStateStore.save({ projectId, patch: { selectedThreadId: threadId, externalTaskSeenAt: receivedAt } })
          await broker.refreshExternalUnread(projectId, receivedAt)
        },
      }
      return {
        openProjectWindow: async (projectId: string) => { await manager.open(projectId); return { ok: true as const, value: undefined } },
        startProjectRuntimeChat: async (projectId: string) => {
          const copy = (normalizeUiLocale(getDesktopPreferencesStore().read().locale) === 'zh' ? zh : en).runtime
          const created = await broker.createThread({ projectId, title: copy.createWithAgent, source: 'app-command' })
          if (!created.ok) return created
          const threadId = created.value.threadId
          await viewStateStore.save({ projectId, patch: { selectedThreadId: threadId, draft: '' } })
          const projectWindow = await manager.open(projectId)
          const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === projectWindow.webContents.id)
          target?.webContents.send('project-chat:event', { type: 'select-thread', projectId, threadId })
          const submitted = await broker.submitRun({ projectId, threadId, text: copy.createPrompt }, { projectRuntimePrompt: true })
          if (!submitted.ok) return submitted
          return { ok: true as const, value: { threadId, requestId: submitted.value.requestId } }
        },
        // Revision 3 keeps the legacy IPC callable for rollback compatibility,
        // but no current entry may synthesize or open a backing Project.
        openWorkspaceTabProjectChat: async () => ({ ok: false as const, error: { code: 'invalid-argument' as const, message: 'Workspace Runtime uses its dedicated development window.', retryable: false } }),
        openProjectPreview: async (projectId: string) => {
          const snapshot = await broker.getSnapshot(projectId)
          if (!snapshot.ok) return snapshot
          if (snapshot.value.project.pathMissing) return { ok: false as const, error: { code: 'project-path-missing' as const, message: 'Project path is unavailable.', retryable: false } }
          showMainWindow()
          mainWindow.webContents.send('project-chat:event', { type: 'open-project-preview', projectId })
          return { ok: true as const, value: undefined }
        },
        openProjectPathRecovery: async (projectId: string) => {
          const snapshot = await broker.getSnapshot(projectId)
          if (!snapshot.ok) return snapshot
          showMainWindow(); mainWindow.webContents.send('project-chat:event', { type: 'open-project-path-recovery', projectId })
          return { ok: true as const, value: undefined }
        },
        getWindowViewState: async (projectId: string) => ({ ok: true as const, value: await viewStateStore.get(projectId) }),
        saveWindowViewState: async (input: { projectId: string; patch: Parameters<typeof viewStateStore.save>[0]['patch'] }) => ({ ok: true as const, value: await viewStateStore.save(input) }),
        listWebsiteBindings: async () => ({ ok: true as const, value: await (websiteBindingStore ??= new WebsiteBindingStore({ userDataPath: app.getPath('userData'), safeStorage })).list() }),
        revokeWebsiteBinding: async (bindingId: string) => {
          const result = await (websiteBindingStore ??= new WebsiteBindingStore({ userDataPath: app.getPath('userData'), safeStorage })).revoke(bindingId)
          return result.ok ? { ok: true as const, value: undefined } : { ok: false as const, error: { code: result.error.code, message: 'Unable to revoke website binding.', retryable: false } }
        },
        respondToWebsitePairing: async (input: AgentOSPairingResponse) => {
          const result = await agentOSPairingService?.respond(input)
          return result?.status === 'accepted' ? { ok: true as const, value: undefined } : { ok: false as const, error: { code: 'internal-error' as const, message: 'Pairing was rejected.', retryable: false } }
        },
      }
    },
    createHandlers: (collaborator) => createProjectChatIpcRouter({ broker, capabilities, rendererEntries: [rendererEntry], permissionService: new ProjectChatPermissionService(getDesktopPreferencesStore()), scopedRead, presence, collaborator }).handlers,
  })
  const runtimeScopedRead = createRuntimeChatScopedReadCollaborator({
    runtimeWorkspace: runtimeStore, resolveScope: resolveRuntimeChatScope, settings: getClaudeAgentSettingsStore(), runner,
    discoverAgentContext, searchProjectFiles: async (rootPath, query) => searchProjectFiles(rootPath, query),
    pickAttachments: async (allowImages) => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] }); return result.canceled ? { attachments: [], skipped: [] } : readChatAttachments(result.filePaths, allowImages) },
    readAttachments: readChatAttachments, realpath: (input) => fs.realpath(input),
  })
  const runtimeRouter = createRuntimeChatIpcRouter({
    broker: runtimeBroker, capabilities, rendererEntries: [rendererEntry], scopedRead: runtimeScopedRead,
    window: {
      getWindowContext: async (webContentsId) => {
        const capability = capabilities.get(webContentsId); const context = runtimeWindowManager.contextFor(webContentsId)
        if (!context || capability?.kind !== 'runtime-development' || context.runtimeScopeId !== capability.runtimeScopeId) return { ok: false, error: { code: 'sender-not-authorized', message: 'Sender is not authorized.', retryable: false } }
        const resolved = resolveRuntimeChatScope(capability.runtimeScopeId)
        return { ok: true, value: { ...context, scopeAvailable: resolved?.available !== false, development: runtimeCoordinator.snapshot(capability.runtimeScopeId) } }
      },
      getWindowViewState: async (runtimeScopeId) => ({ ok: true, value: await runtimeViewStateStore.get(runtimeScopeId) }),
      saveWindowViewState: async (runtimeScopeId, input) => ({ ok: true, value: await runtimeWindowManager.saveViewState(runtimeScopeId, input) }),
      reportPresenceSelection: (webContentsId, runtimeScopeId, input) => {
        if (input.selectedThreadId && !runtimeStore.read().runtimeDevelopmentThreads.some((thread) => thread.runtimeScopeId === runtimeScopeId && thread.id === input.selectedThreadId)) return { ok: false, error: { code: 'thread-not-found', message: 'Thread not found.', retryable: false } }
        return presence.reportRuntimeSelection(webContentsId, input)
      },
    },
  })
  const runtimeChannels: string[] = []
  try {
    for (const [channel, handler] of Object.entries(runtimeRouter.handlers)) { ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown); runtimeChannels.push(channel) }
  } catch (error) {
    for (const channel of runtimeChannels.reverse()) ipcMain.removeHandler(channel)
    runtimeWindowManager.dispose(); runtimeBridge.dispose(); runtimeDevelopmentRuntimeBridge = null; runtimeBroker.dispose(); runtimeCoordinator.dispose(); composition.dispose()
    throw error
  }
  projectChatBroker = composition.broker
  projectChatCompositionDispose = () => {
    for (const channel of runtimeChannels.splice(0).reverse()) ipcMain.removeHandler(channel)
    runtimeWindowManager.dispose(); runtimeBridge?.dispose(); runtimeDevelopmentRuntimeBridge = null; runtimeBroker.dispose(); runtimeCoordinator.dispose(); composition.dispose()
    runtimeDevelopmentWindowManager = null; runtimeDevelopmentCoordinator = null; runtimeDevelopmentThreadStore = null; runtimeDevelopmentBroker = null
  }
}

function taskHomeRunPort() {
  const broker = projectChatBroker
  if (PROJECT_CHAT_BROKER_V2_ENABLED && broker) {
    return {
      async ensureThread(input: { projectId: string; threadId: string; title: string; purpose: 'task-run'; homePluginSlug: string }) { const result = await broker.ensureManagedThread(input); if (!result.ok) throw new Error(result.error.code) },
      async submit(input: Parameters<ProjectChatBroker['submitManagedRun']>[0]) { const result = await broker.submitManagedRun(input); if (!result.ok) throw new Error(result.error.code); return result.value },
      async cancel(input: { projectId: string; threadId: string; requestId: string }) { const result = await broker.cancelManagedRun(input); if (!result.ok) throw new Error(result.error.code) },
    }
  }
  const runner = claudeAgentRunner
  if (!runner) return null
  return {
    async ensureThread() {},
    async submit(input: { text: string; threadId: string; promptMode: 'home-plugin-task-run'; agentModeSettingsOverride: { enabled: true; todoEnabled: boolean } }) { return runner.submit({ text: input.text, threadId: input.threadId, promptMode: input.promptMode, agentModeSettingsOverride: input.agentModeSettingsOverride }) },
    async cancel(input: { requestId: string }) { await runner.cancel(input.requestId) },
  }
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

      await localAppRuntimeManager?.stopAll('user')
      await localAppPreviewManager?.closeAll()
      projectRuntimeHosts.clear()

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

function sendRuntimeEvent(event: RuntimeEvent): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(DESKTOP_EVENT_CHANNELS.onRuntimeEvent, event)
}

function readRuntimeDefinition(runtimeDefinitionId: string): RuntimeDefinition | null {
  const state = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
  return state?.runtimeDefinitions.find((definition) => definition.id === runtimeDefinitionId) ?? null
}

function readProjectRuntimeDefinition(projectId: string): RuntimeDefinition | null {
  const state = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
  const project = state?.projects.find((item) => item.id === projectId)
  if (!project || project.pathMissing) return null
  const runtimeRoot = projectRuntimeRoot(project.path)
  return state?.runtimeDefinitions.find((definition) =>
    definition.owner.kind === 'project' &&
    definition.owner.projectId === project.id &&
    definition.trustStatus === 'trusted' &&
    path.resolve(definition.rootPath) === runtimeRoot
  ) ?? null
}

function resolveRuntimeChatScope(runtimeScopeId: RuntimeScopeId): ResolvedRuntimeChatScope | null {
  const parsed = parseRuntimeScopeId(runtimeScopeId)
  const state = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
  if (!parsed || !state) return null
  const previous = runtimeDevelopmentCoordinator?.snapshot(runtimeScopeId)
  if (parsed.kind === 'project') {
    const project = state.projects.find((item) => item.id === parsed.projectId)
    if (!project || project.pathMissing || !project.path.trim()) {
      const historical = runtimeDevelopmentThreadStore?.read().runtimeDevelopmentThreads.find((thread) => thread.runtimeScopeId === runtimeScopeId)
      if (!historical?.chatState.cwd?.trim()) return null
      const routeGeneration = runtimeRouteGeneration(runtimeScopeId, historical.updatedAt)
      return {
        runtimeScopeId,
        runtimeDefinitionId: historical.runtimeDefinitionId,
        runtimeOwner: { kind: 'project', projectId: parsed.projectId },
        cwd: historical.chatState.cwd,
        runtimeRoot: projectRuntimeRoot(historical.chatState.cwd),
        routeGeneration,
        developmentGeneration: previous?.routeGeneration === routeGeneration ? previous.developmentGeneration : 1,
        available: false,
      }
    }
    const definition = state.runtimeDefinitions.find((item) => item.owner.kind === 'project' && item.owner.projectId === project.id && path.resolve(item.rootPath) === projectRuntimeRoot(project.path))
    const routeGeneration = runtimeRouteGeneration(runtimeScopeId, definition?.updatedAt ?? project.updatedAt)
    const canonicalRoot = definition?.canonicalRoot ?? definition?.rootPath
    const awaitingDefinitionBinding = Boolean(definition && runtimeDevelopmentRuntimeBridge?.hasProspectiveLease(runtimeScopeId))
    return {
      runtimeScopeId, runtimeDefinitionId: definition?.id, runtimeOwner: { kind: 'project', projectId: project.id }, cwd: project.path,
      runtimeRoot: projectRuntimeRoot(project.path), routeGeneration,
      developmentGeneration: previous?.routeGeneration === routeGeneration ? previous.developmentGeneration : 1,
      // Missing .agentos is a valid Project creation scope. Once a definition
      // exists, its Main-owned trust fact remains mandatory.
      available: definition
        ? !awaitingDefinitionBinding && definition.trustStatus === 'trusted' && Boolean(canonicalRoot && localAppTrustStore?.isTrusted(canonicalRoot))
        : true,
    }
  }
  const definition = state.runtimeDefinitions.find((item) => item.id === parsed.runtimeDefinitionId && item.owner.kind === 'workspace')
  const historical = definition ? undefined : runtimeDevelopmentThreadStore?.read().runtimeDevelopmentThreads.find((thread) => thread.runtimeScopeId === runtimeScopeId)
  const root = definition?.rootPath ?? historical?.chatState.cwd
  if (!root) return null
  const routeGeneration = runtimeRouteGeneration(runtimeScopeId, definition?.updatedAt ?? historical?.updatedAt ?? 1)
  const canonicalRoot = definition?.canonicalRoot ?? definition?.rootPath
  return {
    runtimeScopeId, runtimeDefinitionId: parsed.runtimeDefinitionId, runtimeOwner: { kind: 'workspace' }, cwd: root, runtimeRoot: root,
    routeGeneration, developmentGeneration: previous?.routeGeneration === routeGeneration ? previous.developmentGeneration : 1,
    available: Boolean(definition && definition.trustStatus === 'trusted' && canonicalRoot && localAppTrustStore?.isTrusted(canonicalRoot)),
  }
}

function generationOf(value: number): number { return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.isFinite(value) ? value : 1))) }

function runtimeRouteGeneration(runtimeScopeId: RuntimeScopeId, durableSeed: number): number {
  return Math.max(generationOf(durableSeed), runtimeDevelopmentRouteGenerations.get(runtimeScopeId) ?? 0)
}

function invalidateRuntimeDevelopmentRoute(runtimeScopeId: RuntimeScopeId, durableSeed = 0): number {
  const current = runtimeDevelopmentCoordinator?.snapshot(runtimeScopeId)
  const next = Math.max(generationOf(durableSeed), runtimeDevelopmentRouteGenerations.get(runtimeScopeId) ?? 0, current?.routeGeneration ?? 0) + 1
  runtimeDevelopmentRouteGenerations.set(runtimeScopeId, next)
  runtimeDevelopmentCoordinator?.invalidateRoute(runtimeScopeId, next)
  if (current) {
    // Route invalidation first disables submit synchronously, then releases the
    // exact old token. A late release cannot affect a rebound/new-generation lease.
    void runtimeDevelopmentRuntimeBridge?.invalidate({
      runtimeScopeId,
      routeGeneration: current.routeGeneration,
      developmentGeneration: current.developmentGeneration,
    })
  }
  return next
}

function runtimeDevelopmentBusy(runtimeScopeId: RuntimeScopeId): boolean {
  return runtimeDevelopmentCoordinator?.hasActiveSession(runtimeScopeId) ?? false
}

function runtimeWindowIdentity(runtimeScopeId: RuntimeScopeId): { runtimeName: string; ownerLabel: string } {
  const parsed = parseRuntimeScopeId(runtimeScopeId)
  const state = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
  if (!parsed || !state) return { runtimeName: 'Runtime', ownerLabel: '未知归属' }
  if (parsed.kind === 'project') {
    const project = state.projects.find((item) => item.id === parsed.projectId)
    const definition = state.runtimeDefinitions.find((item) => item.owner.kind === 'project' && item.owner.projectId === parsed.projectId)
    return { runtimeName: definition?.name ?? project?.name ?? 'Runtime', ownerLabel: `项目 · ${project?.name ?? parsed.projectId}` }
  }
  const definition = state.runtimeDefinitions.find((item) => item.id === parsed.runtimeDefinitionId)
  return { runtimeName: definition?.name ?? 'Runtime（已移除）', ownerLabel: '工作台' }
}

function resolveRuntimeDevelopmentTarget(raw: unknown, freshState?: ChatWorkspaceState | null): { target: RuntimeDevelopmentTarget; runtimeScopeId: RuntimeScopeId; uninitialized: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const target = raw as Record<string, unknown>
  if (target.kind === 'project-runtime' && Object.keys(target).length === 3 && typeof target.projectId === 'string' && target.projectId.trim() && typeof target.mountId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(target.mountId.trim())) {
    const projectId = target.projectId.trim(); const mountId = target.mountId.trim()
    const state = freshState ?? chatWorkspaceStore?.read(); const project = state?.projects.find((item) => item.id === projectId)
    if (!project || project.pathMissing) return null
    const definition = state?.runtimeDefinitions.find((item) => item.owner.kind === 'project' && item.owner.projectId === projectId && path.resolve(item.rootPath) === projectRuntimeRoot(project.path))
    const registered = definition ? registeredProjectRuntimeHost(projectId, mountId, definition.id) : null
    if ((definition && !registered) || projectRuntimeMountIds.get(projectId) !== mountId) return null
    return { target: { kind: 'project-runtime', projectId, mountId }, runtimeScopeId: projectRuntimeScopeId(projectId), uninitialized: !definition }
  }
  if (target.kind === 'workspace-runtime' && Object.keys(target).length === 2 && typeof target.workspaceTabId === 'string' && target.workspaceTabId.trim()) {
    const workspaceTabId = target.workspaceTabId.trim(); const state = freshState ?? chatWorkspaceStore?.read()
    const tab = state?.workspaceTabs.find((item) => item.id === workspaceTabId); const definition = tab ? state?.runtimeDefinitions.find((item) => item.id === tab.runtimeDefinitionId) : undefined
    if (!tab || !definition || definition.owner.kind !== 'workspace') return null
    return { target: { kind: 'workspace-runtime', workspaceTabId }, runtimeScopeId: workspaceRuntimeScopeId(definition.id), uninitialized: false }
  }
  return null
}

function runtimeDevelopmentFailure(code: Exclude<import('../src/runtime-development-contract').RuntimeDevelopmentErrorCode, 'runtime-development-conflict'>, message: string, retryable = false): OpenRuntimeDevelopmentResult {
  return { ok: false, error: { code, message, retryable } }
}

function mintRuntimeRootConflict(senderWebContentsId: number, lease: RuntimeRootLease) {
  const conflictToken = randomUUID()
  const conflictIdentity = runtimeWindowIdentity(lease.runtimeScopeId)
  runtimeDevelopmentConflictTokens.set(conflictToken, { senderWebContentsId, runtimeScopeId: lease.runtimeScopeId, expiresAt: Date.now() + 60_000 })
  return {
    conflictToken,
    conflictingRuntimeName: conflictIdentity.runtimeName,
    conflictingOwnerKind: parseRuntimeScopeId(lease.runtimeScopeId)?.kind ?? 'workspace',
  }
}

function runtimeDevelopmentConflict(senderWebContentsId: number, lease: RuntimeRootLease): OpenRuntimeDevelopmentResult {
  console.error('[runtime-development/ipc] fail', { operation: 'open', code: 'runtime-development-conflict' })
  return {
    ok: false,
    error: {
      code: 'runtime-development-conflict',
      message: 'Another Runtime is modifying the same directory.',
      retryable: false,
      ...mintRuntimeRootConflict(senderWebContentsId, lease),
    },
  }
}

/**
 * `T4.7`: a browse-path start that loses the root race must reach the renderer
 * as the same explicit conflict the development action already shows, instead
 * of a swallowed error that leaves the card silently stopped.
 */
function runtimeRootConflictError(senderWebContentsId: number, lease: RuntimeRootLease): Error {
  console.error('[runtime/ipc] fail', { operation: 'start', code: 'runtime-root-conflict' })
  return new Error(JSON.stringify({ code: 'runtime-root-conflict', ...mintRuntimeRootConflict(senderWebContentsId, lease) }))
}

function conflictingRuntimeRootLease(error: unknown): RuntimeRootLease | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; conflictingLease?: unknown }
  return candidate.code === 'runtime-development-conflict' && candidate.conflictingLease && typeof candidate.conflictingLease === 'object'
    ? candidate.conflictingLease as RuntimeRootLease
    : null
}

async function submitControlledRuntimeCreationPrompt(
  runtimeScopeId: RuntimeScopeId,
  snapshot: import('../src/runtime-development-contract').RuntimeDevelopmentSnapshot,
): Promise<boolean> {
  const broker = runtimeDevelopmentBroker
  const store = runtimeDevelopmentThreadStore
  const manager = runtimeDevelopmentWindowManager
  if (!broker || !store || !manager || !snapshot.canSubmit) return false
  const authority = {
    runtimeScopeId,
    routeGeneration: snapshot.routeGeneration,
    developmentGeneration: snapshot.developmentGeneration,
  }
  const copy = (normalizeUiLocale(getDesktopPreferencesStore().read().locale) === 'zh' ? zh : en).runtime
  let thread: RuntimeDevelopmentThread | undefined = store.read().runtimeDevelopmentThreads
    .filter((candidate) => candidate.runtimeScopeId === runtimeScopeId && !candidate.archivedAt)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (!thread) {
    const created = await broker.createThread(authority, { title: copy.createWithAgent })
    if (!created.ok) return false
    thread = store.read().runtimeDevelopmentThreads.find((candidate) => candidate.id === created.value.threadId)
  }
  if (!thread) return false
  await manager.saveViewState(runtimeScopeId, { patch: { selectedThreadId: thread.id, draft: '' } })
  // A repeated click focuses the same durable creation conversation and never
  // submits a second controlled prompt after the first accepted message.
  if (thread.chatState.items.some((item) => item.type === 'message' && item.role === 'user')) return true
  const submitted = await broker.submitRun(authority, { threadId: thread.id, text: copy.createPrompt })
  return submitted.ok
}

async function assertRuntimeTrust(definition: RuntimeDefinition): Promise<string> {
  const canonicalRoot = await canonicalizeLocalAppRoot(definition.rootPath).catch(() => {
    throw new Error('local-app-path-missing')
  })
  await localAppTrustStore?.load()
  if (!localAppTrustStore?.isTrusted(canonicalRoot)) throw new Error('local-app-trust-required')
  return canonicalRoot
}

async function bindProspectiveProjectRuntimeDefinition(definition: RuntimeDefinition): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (definition.owner.kind !== 'project' || !runtimeDevelopmentRuntimeBridge) return { ok: true }
  const runtimeScopeId = projectRuntimeScopeId(definition.owner.projectId)
  try {
    await runtimeDevelopmentRuntimeBridge.bindDefinition(runtimeScopeId, definition)
    return { ok: true }
  } catch (error) {
    const current = runtimeDevelopmentCoordinator?.snapshot(runtimeScopeId)
    if (current) {
      // Disable submit before dropping the prospective token. The conflicting
      // owner remains untouched and no Runtime process is stopped or adopted.
      invalidateRuntimeDevelopmentRoute(runtimeScopeId, definition.updatedAt)
      await runtimeDevelopmentRuntimeBridge.abort(current)
    }
    const conflict = conflictingRuntimeRootLease(error)
    console.error('[runtime-development/bridge] fail', { operation: 'bind-definition', code: conflict ? 'runtime-development-conflict' : 'runtime-root-missing' })
    return conflict
      ? { ok: false, code: 'runtime-development-conflict', message: '该目录正在由另一 Runtime 修改。' }
      : { ok: false, code: 'runtime-root-missing', message: 'Runtime 目录重新校验失败。' }
  }
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

async function prepareForAppQuit(): Promise<void> {
  if (localAppQuitCleanup) return localAppQuitCleanup
  isQuitting = true
  runtimeDevelopmentCoordinator?.setQuitting()
  runtimeDevelopmentConflictTokens.clear()
  localAppQuitCleanup = (async () => {
    // Mid-run deltas are staged in memory; commit them before the process goes
    // away so an in-flight transcript is not lost on quit.
    await chatWorkspaceStore?.flushPending().catch(() => undefined)
    speechRecognitionService?.dispose()
    disposeProjectFileWatchers()
    await Promise.race([
      Promise.all([
        localAppPreviewManager?.closeAll() ?? Promise.resolve(),
        runtimeDevelopmentRuntimeBridge?.releaseProspectiveLeases() ?? Promise.resolve(),
        localAppRuntimeManager?.stopAll('app-quit') ?? Promise.resolve(),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
    projectRuntimeHosts.clear()
    tray?.destroy()
    tray = null
  })()
  return localAppQuitCleanup
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
  for (const argument of process.argv) enqueueAgentOSDeepLink(argument)
  app.on('open-url', (event, url) => {
    event.preventDefault()
    enqueueAgentOSDeepLink(url)
  })
  app.on('second-instance', (_event, argv) => {
    for (const argument of argv) enqueueAgentOSDeepLink(argument)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.on('window-all-closed', () => {
    if (!isQuitting) return
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

  app.on('before-quit', (event) => {
    void agentOSPairingService?.cancelAll()
    if (localAppQuitCleanup) return
    event.preventDefault()
    void prepareForAppQuit().finally(() => app.quit())
  })

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
    chatWorkspaceCoordinator = new ChatWorkspaceCoordinator()
    void runAttachmentThumbnailMigration()
    localAppTrustStore = new LocalAppTrustStore(userDataPath)
    localAppRuntimeManager = new LocalAppRuntimeManager({
      preparationRecordPath: path.join(userDataPath, 'local-app-preparation.json'),
      userDataPath,
      autoUpdate: true,
      onEvent: (event) => {
        const runtimeDefinitionId = event.runtimeDefinitionId
        if (!runtimeDefinitionId) return
        sendRuntimeEvent({
          type: event.type,
          runtimeDefinitionId,
          runtimeId: event.runtimeId,
          generation: event.generation,
          status: event.status,
          mode: event.mode,
          buildStatus: event.buildStatus,
          artifactId: event.artifactId,
          buildId: event.buildId,
          operationId: event.operationId,
          stale: event.stale,
          lastBuildAt: event.lastBuildAt,
          previewUrl: event.previewUrl,
          readyUrl: event.readyUrl,
          port: event.port,
          stream: event.stream,
          line: event.line,
          code: event.code,
          signal: event.signal,
          detail: event.detail,
          phase: event.phase,
          errorCode: event.errorCode,
          previewStatus: event.previewStatus,
          timestamp: event.timestamp,
        })
      },
    })
    runtimeEditCoordinator = new RuntimeEditCoordinator({
      fingerprint: async (projectId) => {
        const definition = readProjectRuntimeDefinition(projectId)
        if (!definition) throw new Error('project-runtime-unavailable')
        const inspected = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
        if (!inspected.ok || inspected.mode !== 'static' || !inspected.agentos) throw new Error('static-runtime-unavailable')
        return fingerprintStaticSource(inspected.canonicalRoot, inspected.agentos)
      },
      intent: async (intent) => {
        await runtimeEditRuntimeBridge?.handle(intent)
      },
      onSnapshot: (snapshot) => { queueMicrotask(() => projectChatBroker?.broadcastProjectSnapshot(snapshot.projectId)) },
    })
    projectRuntimePlacementTracker = new ProjectRuntimePlacementTracker()
    runtimeEditRuntimeBridge = new RuntimeEditRuntimeBridge({ coordinator: runtimeEditCoordinator, manager: localAppRuntimeManager, resolveDefinition: readProjectRuntimeDefinition })
    const staticRegistry = localAppRuntimeManager.getStaticPreviewRegistry()
    const staticSessionHosts = new WeakMap<Session, string>()
    const staticSessionRegistrations = new WeakMap<Session, Promise<void>>()
    staticPreviewSessionRegistrar = async (session, previewUrl) => {
      let expectedHost: string
      try {
        const url = new URL(previewUrl)
        expectedHost = url.hostname.toLowerCase()
        if (url.protocol !== `${STATIC_PREVIEW_SCHEME}:` || !/^[a-f0-9]{48}$/.test(expectedHost)) throw new Error('static-preview-host-invalid')
      } catch (error) {
        throw error instanceof Error ? error : new Error('static-preview-host-invalid')
      }
      staticSessionHosts.set(session, expectedHost)
      const previous = staticSessionRegistrations.get(session) ?? Promise.resolve()
      const registration = previous.then(async () => {
        staticSessionHosts.set(session, expectedHost)
        if (await session.protocol.isProtocolHandled(STATIC_PREVIEW_SCHEME)) return
        await session.protocol.handle(STATIC_PREVIEW_SCHEME, (request) => {
          const allowedHost = staticSessionHosts.get(session)
          return staticPreviewResponse(request, staticRegistry, allowedHost)
        })
      })
      staticSessionRegistrations.set(session, registration.catch(() => undefined))
      await registration
    }
    void localAppTrustStore.load()
    applyLoginItemSettingsOnStartup(getDesktopPreferencesStore().read())
    currentTrayLocale = normalizeUiLocale(getDesktopPreferencesStore().read().locale)
    configureProjectContentEvents(sendProjectFilesChanged)

    // --- IPC handlers / IPC 注册 ---

    registerAppUpdaterIpc(() => win, { beforeQuitAndInstall: prepareForAppQuit })

    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openRuntimeDevelopment, async (event, rawTarget: unknown): Promise<OpenRuntimeDevelopmentResult> => {
      console.info('[runtime-development/ipc] enter', { operation: 'open' })
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== event.sender.mainFrame) return runtimeDevelopmentFailure('runtime-scope-stale', '当前窗口无权打开 Runtime 开发。')
      // Renderer only names the page object. Main fresh-reads its owner/host
      // under the workspace lock before resolving the stable Runtime scope.
      const resolvedTarget = await runChatWorkspaceOperation(async () => resolveRuntimeDevelopmentTarget(rawTarget, getChatWorkspaceStore().read()))
      if (!resolvedTarget || !runtimeDevelopmentWindowManager || !runtimeDevelopmentRuntimeBridge || !localAppRuntimeManager) return runtimeDevelopmentFailure('runtime-scope-stale', 'Runtime 归属已变化，请刷新后重试。')
      const scope = resolveRuntimeChatScope(resolvedTarget.runtimeScopeId)
      if (!scope) return runtimeDevelopmentFailure('runtime-root-missing', 'Runtime 路径不可用，请检查后重试。')
      const authority = {
        runtimeScopeId: resolvedTarget.runtimeScopeId,
        routeGeneration: scope.routeGeneration,
        developmentGeneration: scope.developmentGeneration,
      }
      if (resolvedTarget.uninitialized) {
        try {
          await runtimeDevelopmentRuntimeBridge.acquireProspective(authority)
        } catch (error) {
          const conflictingLease = conflictingRuntimeRootLease(error)
          if (conflictingLease) return runtimeDevelopmentConflict(event.sender.id, conflictingLease)
          console.error('[runtime-development/ipc] fail', { operation: 'open', code: 'runtime-root-missing' })
          return runtimeDevelopmentFailure('runtime-root-missing', 'Runtime 路径不可用，请检查后重试。')
        }
      }
      const definition = scope.runtimeDefinitionId ? readRuntimeDefinition(scope.runtimeDefinitionId) : null
      const currentLease = localAppRuntimeManager.getRootExecutionRegistry().getByRoot(definition?.canonicalRoot ?? scope.runtimeRoot)
      if (currentLease && currentLease.runtimeScopeId !== resolvedTarget.runtimeScopeId) {
        return runtimeDevelopmentConflict(event.sender.id, currentLease)
      }
      try {
        const opened = await runtimeDevelopmentWindowManager.open(resolvedTarget.runtimeScopeId)
        const development = opened.context.development
        const developmentGeneration = development?.developmentGeneration ?? resolveRuntimeChatScope(resolvedTarget.runtimeScopeId)?.developmentGeneration ?? 1
        if (resolvedTarget.uninitialized && (!development || !(await submitControlledRuntimeCreationPrompt(resolvedTarget.runtimeScopeId, development)))) {
          await runtimeDevelopmentWindowManager.close(resolvedTarget.runtimeScopeId)
          await runtimeDevelopmentRuntimeBridge.abort(authority)
          console.error('[runtime-development/ipc] fail', { operation: 'controlled-create', code: 'runtime-development-busy' })
          return runtimeDevelopmentFailure('runtime-development-busy', '创建请求暂未提交，请在开发窗口中重试。', true)
        }
        console.info('[runtime-development/ipc] success', { operation: 'open', scopeKind: parseRuntimeScopeId(resolvedTarget.runtimeScopeId)?.kind })
        return { ok: true, value: { runtimeScopeId: resolvedTarget.runtimeScopeId, developmentGeneration } }
      } catch (error) {
        if (resolvedTarget.uninitialized) await runtimeDevelopmentRuntimeBridge.abort(authority)
        const conflictingLease = conflictingRuntimeRootLease(error)
        if (conflictingLease) return runtimeDevelopmentConflict(event.sender.id, conflictingLease)
        // load/runtime 错误可能包含本地路径；默认日志只保留固定错误码。
        console.error('[runtime-development/ipc] fail', { operation: 'open', code: 'runtime-window-open-failed' })
        return runtimeDevelopmentFailure('runtime-live-preview-unavailable', 'Runtime 开发窗口暂时无法打开，请重试。', true)
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.focusRuntimeDevelopmentConflict, async (event, rawToken: unknown): Promise<RuntimeDevelopmentResult<void>> => {
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== event.sender.mainFrame || typeof rawToken !== 'string') return { ok: false, error: { code: 'runtime-scope-stale', message: '切换凭证无效。', retryable: false } }
      const conflict = runtimeDevelopmentConflictTokens.get(rawToken); runtimeDevelopmentConflictTokens.delete(rawToken)
      if (!conflict || conflict.senderWebContentsId !== event.sender.id || conflict.expiresAt < Date.now()) return { ok: false, error: { code: 'runtime-scope-stale', message: '切换凭证已过期。', retryable: false } }
      showMainWindow()
      const target = runtimeDevelopmentWindowManager?.get(conflict.runtimeScopeId)
      if (!target || target.isDestroyed()) return { ok: false, error: { code: 'runtime-scope-stale', message: '正在修改的 Runtime 窗口已关闭。', retryable: true } }
      target.show(); target.focus()
      return { ok: true, value: undefined }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.endRuntimeDevelopment, async (event, rawTarget: unknown): Promise<RuntimeDevelopmentResult<void>> => {
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: { code: 'runtime-scope-stale', message: '当前窗口无权结束 Runtime 开发。', retryable: false } }
      const resolvedTarget = await runChatWorkspaceOperation(async () => resolveRuntimeDevelopmentTarget(rawTarget, getChatWorkspaceStore().read()))
      if (!resolvedTarget || !runtimeDevelopmentCoordinator) return { ok: false, error: { code: 'runtime-scope-stale', message: 'Runtime 归属已变化，请刷新后重试。', retryable: false } }
      const closedWindow = await runtimeDevelopmentWindowManager?.close(resolvedTarget.runtimeScopeId)
      if (!closedWindow) {
        const snapshot = runtimeDevelopmentCoordinator.snapshot(resolvedTarget.runtimeScopeId)
        if (snapshot) runtimeDevelopmentCoordinator.requestExit({ runtimeScopeId: snapshot.runtimeScopeId, routeGeneration: snapshot.routeGeneration, developmentGeneration: snapshot.developmentGeneration })
      }
      return { ok: true, value: undefined }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openRuntimeDevelopmentThread, async (event, rawThreadId: unknown): Promise<RuntimeDevelopmentResult<void>> => {
      if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== event.sender.mainFrame || typeof rawThreadId !== 'string' || !rawThreadId.trim()) {
        return { ok: false, error: { code: 'runtime-scope-stale', message: 'Runtime 对话不可用。', retryable: false } }
      }
      const thread = runtimeDevelopmentThreadStore?.read().runtimeDevelopmentThreads.find((candidate) => candidate.id === rawThreadId.trim())
      if (!thread || !runtimeDevelopmentWindowManager || !resolveRuntimeChatScope(thread.runtimeScopeId)) {
        return { ok: false, error: { code: 'runtime-root-missing', message: 'Runtime 已移除或路径不可用。', retryable: false } }
      }
      await runtimeDevelopmentWindowManager.saveViewState(thread.runtimeScopeId, { patch: { selectedThreadId: thread.id } })
      try {
        const existing = runtimeDevelopmentWindowManager.get(thread.runtimeScopeId)
        if (existing && !existing.isDestroyed()) {
          const browserWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === existing.webContents.id)
          browserWindow?.webContents.reload()
          existing.show(); existing.focus()
          return { ok: true, value: undefined }
        }
        await runtimeDevelopmentWindowManager.open(thread.runtimeScopeId)
        return { ok: true, value: undefined }
      } catch {
        return { ok: false, error: { code: 'runtime-live-preview-unavailable', message: 'Runtime 开发窗口暂时无法打开，请重试。', retryable: true } }
      }
    })

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
      const { projectId: _rendererProjectId, projectRuntimePrompt: _rendererRuntimePrompt, ...safePayload } = payload
      return getClaudeAgentRunner().submit(safePayload)
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
    // `FIX-WS-01`: the only durable writer for project lifecycle and workspace
    // preferences. The renderer submits intents; Main derives durable content
    // from its own store, saves under the revision gate and verifies by readback.
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.applyWorkspaceCommand, async (event, rawCommand: unknown, rawExpectedRevision: unknown): Promise<WorkspaceCommandResult> => {
      if (!isAuthorizedMainWindowInvoke(event)) return { ok: false, code: 'invalid-command', message: '调用来源未授权' }
      const parsed = parseWorkspaceCommand(rawCommand)
      if (!parsed.ok) return parsed
      const command = parsed.command
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision)
        ? Math.max(0, Math.floor(rawExpectedRevision))
        : undefined
      try {
        return await runChatWorkspaceOperation(async (): Promise<WorkspaceCommandResult> => {
          const current = getChatWorkspaceStore().read()
          if (!current) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好，请重试' }
          if (expectedRevision !== undefined && workspaceRevisionOf(current) !== expectedRevision) {
            return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重试' }
          }
          const applied = applyWorkspaceCommand(current, command, {
            now: Date.now(),
            createProjectId: () => nextWorkspaceProjectId(current.projects),
          })
          if (!applied.ok) return applied
          if (!applied.changed) return { ok: true, workspace: current, projectId: applied.projectId }
          const destructiveProjectId = command.type === 'project.remove' || command.type === 'project.relocate'
            ? command.projectId
            : undefined
          const projectRuntimeDefinition = destructiveProjectId
            ? current.runtimeDefinitions.find((definition) => definition.owner.kind === 'project' && definition.owner.projectId === destructiveProjectId)
            : undefined
          if (destructiveProjectId && runtimeDevelopmentBusy(projectRuntimeScopeId(destructiveProjectId))) {
            return { ok: false, code: 'workspace-conflict', message: 'Runtime 正在修改，请先结束修改后再移除或更换项目目录' }
          }
          if (projectRuntimeDefinition) {
            // Root ownership changes stop the bounded process tree before the
            // durable owner/path mutation. A failed stop leaves workspace data intact.
            await localAppPreviewManager?.closeForLocalApp(projectRuntimeDefinition.id)
            const beforeStop = localAppRuntimeManager?.get(projectRuntimeDefinition.id)
            const stopped = await localAppRuntimeManager?.stop(projectRuntimeDefinition.id, 'user')
            if (beforeStop && (!stopped || stopped.status !== 'stopped')) {
              return { ok: false, code: 'workspace-save-failed', message: 'Runtime 未能安全停止，项目未更改' }
            }
          }
          const proposed = withNextWorkspaceRevision(applied.state, workspaceRevisionOf(current))
          try {
            await getChatWorkspaceStore().save(proposed)
            const persisted = getChatWorkspaceStore().read()
            if (
              !persisted ||
              workspaceRevisionOf(persisted) !== workspaceRevisionOf(proposed) ||
              !workspaceCommandApplied(persisted, command, applied.projectId)
            ) {
              throw new Error('workspace-command-readback-failed')
            }
            void taskHomePluginManager?.refreshFromWorkspace(persisted)
            if (destructiveProjectId) {
              await clearProjectRuntimeHost(destructiveProjectId)
              invalidateRuntimeDevelopmentRoute(projectRuntimeScopeId(destructiveProjectId), persisted.projects.find((project) => project.id === destructiveProjectId)?.updatedAt ?? 0)
            }
            return { ok: true, workspace: persisted, projectId: applied.projectId }
          } catch {
            return { ok: false, code: 'workspace-save-failed', message: '工作区保存失败，请重试' }
          }
        })
      } catch {
        return { ok: false, code: 'workspace-save-failed', message: '工作区保存失败，请重试' }
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getRuntimePreviewLayout, (event, rawProjectId: unknown) => {
      if (!isAuthorizedMainWindowInvoke(event) || typeof rawProjectId !== 'string') throw new Error('runtime-preview-layout-not-authorized')
      return getRuntimePreviewLayoutStore().get(rawProjectId)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.saveRuntimePreviewLayout, (event, rawProjectId: unknown, rawSize: unknown) => {
      if (!isAuthorizedMainWindowInvoke(event) || typeof rawProjectId !== 'string' || !isRecord(rawSize)) throw new Error('runtime-preview-layout-not-authorized')
      return getRuntimePreviewLayoutStore().save(rawProjectId, rawSize as { width: number; height: number })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.resetRuntimePreviewLayout, (event, rawProjectId: unknown) => {
      if (!isAuthorizedMainWindowInvoke(event) || typeof rawProjectId !== 'string') throw new Error('runtime-preview-layout-not-authorized')
      return getRuntimePreviewLayoutStore().reset(rawProjectId)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.inspectRuntimeDirectory, async (_event, rawRoot: unknown) => {
      if (typeof rawRoot !== 'string') {
        return { ok: false, rootPath: '', code: 'invalid-root', message: 'Runtime 目录无效' }
      }
      return inspectLocalAppDirectory(rawRoot)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.createWorkspaceTab, async (_event, rawRoot: unknown, rawExpectedRevision: unknown, rawTitle: unknown): Promise<RuntimeCreationResult> => {
      if (typeof rawRoot !== 'string' || !rawRoot.trim()) return { ok: false, code: 'invalid-root', message: 'Runtime 目录无效' }
      if (typeof rawTitle !== 'string' || rawTitle.trim().length < 1 || rawTitle.trim().length > 64) {
        return { ok: false, code: 'invalid-title', message: '标题需为 1–64 个字符' }
      }
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision)
        ? Math.max(0, Math.floor(rawExpectedRevision))
        : undefined
      const inspected = await inspectLocalAppDirectory(rawRoot)
      if (!inspected.ok) return { ok: false, code: inspected.code, message: inspected.message }
      if (!localAppTrustStore || !localAppRuntimeManager) return { ok: false, code: 'runtime-unavailable', message: 'Runtime 服务暂不可用，请重试' }
      const trustStore = localAppTrustStore
      const runtimeManager = localAppRuntimeManager
      try {
        const committed = await runChatWorkspaceOperation(async (): Promise<RuntimeCreationResult> => {
          const current = getChatWorkspaceStore().read()
          if (!current) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好，请重试' }
          if (expectedRevision !== undefined && workspaceRevisionOf(current) !== expectedRevision) {
            return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重新打开 Runtime' }
          }
          const now = Date.now()
          const existingDefinition = current.runtimeDefinitions.find((item) =>
            item.owner.kind === 'workspace' && (item.canonicalRoot ?? item.rootPath) === inspected.canonicalRoot,
          )
          const definition: RuntimeDefinition = existingDefinition
            ? { ...existingDefinition, name: inspected.name, rootPath: inspected.rootPath, canonicalRoot: inspected.canonicalRoot, mode: inspected.mode, agentos: inspected.agentos, trustStatus: 'trusted', updatedAt: now }
            : {
                id: `runtime-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                owner: { kind: 'workspace' },
                name: inspected.name,
                rootPath: inspected.rootPath,
                canonicalRoot: inspected.canonicalRoot,
                packageManager: 'npm',
                devCommand: { executable: 'npm', args: ['run', 'dev'] },
                mode: inspected.mode,
                agentos: inspected.agentos,
                trustStatus: 'trusted',
                autoStart: true,
                createdAt: now,
                updatedAt: now,
              }
          const tabIds = new Set(current.workspaceTabs.map((item) => item.id))
          const tabIdBase = `workspace-tab-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          let tabId = tabIdBase
          let tabCollision = 1
          while (tabIds.has(tabId)) tabId = `${tabIdBase}-${tabCollision++}`
          const tab: WorkspaceTab = { id: tabId, runtimeDefinitionId: definition.id, title: rawTitle.trim(), createdAt: now, updatedAt: now }
          const proposed = withNextWorkspaceRevision({
            ...current,
            runtimeDefinitions: [definition, ...current.runtimeDefinitions.filter((item) => item.id !== definition.id)],
            workspaceTabs: [tab, ...current.workspaceTabs],
            activeThreadId: '',
            activeWorkspaceTabId: tab.id,
          }, workspaceRevisionOf(current))
          await trustStore.load()
          const wasTrusted = current.runtimeDefinitions.some((item) => (item.canonicalRoot ?? item.rootPath) === inspected.canonicalRoot && item.trustStatus === 'trusted') || trustStore.isTrusted(inspected.canonicalRoot)
          try {
            await trustStore.grant(inspected.canonicalRoot)
            await getChatWorkspaceStore().save(proposed)
            const persisted = getChatWorkspaceStore().read()
            const persistedDefinition = persisted?.runtimeDefinitions.find((item) => item.id === definition.id)
            const persistedTab = persisted?.workspaceTabs.find((item) => item.id === tab.id && item.runtimeDefinitionId === definition.id)
            if (!persisted || !persistedDefinition || !persistedTab || persisted.activeWorkspaceTabId !== tab.id || persisted.activeProjectId !== current.activeProjectId) throw new Error('runtime-workspace-tab-readback-failed')
          } catch {
            if (!wasTrusted) await trustStore.revoke(inspected.canonicalRoot).catch(() => undefined)
            return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
          }
          const persisted = getChatWorkspaceStore().read() ?? proposed
          const persistedDefinition = persisted.runtimeDefinitions.find((item) => item.id === definition.id) ?? definition
          const persistedTab = persisted.workspaceTabs.find((item) => item.id === tab.id) ?? tab
          return { ok: true, workspace: persisted, definition: persistedDefinition, tab: persistedTab }
        })
        if (!committed.ok) return committed
        runtimeManager.register(committed.definition)
        return committed
      } catch {
        return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.openWorkspaceTab, async (_event, rawRuntimeDefinitionId: unknown, rawExpectedRevision: unknown): Promise<WorkspaceTabResult> => {
      if (typeof rawRuntimeDefinitionId !== 'string' || !rawRuntimeDefinitionId.trim() || rawRuntimeDefinitionId.length > 200) return { ok: false, code: 'invalid-id', message: 'Runtime 标识无效' }
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision) ? Math.max(0, Math.floor(rawExpectedRevision)) : undefined
      if (!localAppTrustStore || !localAppRuntimeManager) return { ok: false, code: 'runtime-unavailable', message: 'Runtime 服务暂不可用，请重试' }
      const trustStore = localAppTrustStore
      const runtimeManager = localAppRuntimeManager
      try {
        const committed = await runChatWorkspaceOperation(async (): Promise<WorkspaceTabResult> => {
          const current = getChatWorkspaceStore().read()
          if (!current) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好，请重试' }
          if (expectedRevision !== undefined && workspaceRevisionOf(current) !== expectedRevision) return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重新打开 Runtime' }
          const definition = current.runtimeDefinitions.find((item) => item.id === rawRuntimeDefinitionId.trim())
          if (!definition) return { ok: false, code: 'definition-missing', message: 'Runtime 不存在' }
          if (definition.owner.kind !== 'workspace') return { ok: false, code: 'owner-mismatch', message: '项目 Runtime 不能打开为 Workspace Tab' }
          await trustStore.load()
          const canonicalRoot = await canonicalizeLocalAppRoot(definition.rootPath).catch(() => null)
          if (!canonicalRoot || !trustStore.isTrusted(canonicalRoot) || definition.trustStatus !== 'trusted') return { ok: false, code: 'trust-required', message: '该 Runtime 尚未获得目录授权，请重新绑定' }
          const now = Date.now()
          const tabIds = new Set(current.workspaceTabs.map((item) => item.id))
          const tabIdBase = `workspace-tab-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          let tabId = tabIdBase
          let tabCollision = 1
          while (tabIds.has(tabId)) tabId = `${tabIdBase}-${tabCollision++}`
          const tab: WorkspaceTab = { id: tabId, runtimeDefinitionId: definition.id, title: definition.name, createdAt: now, updatedAt: now }
          const proposed = withNextWorkspaceRevision({ ...current, workspaceTabs: [tab, ...current.workspaceTabs], activeThreadId: '', activeWorkspaceTabId: tab.id }, workspaceRevisionOf(current))
          try {
            await getChatWorkspaceStore().save(proposed)
            const persisted = getChatWorkspaceStore().read()
            const persistedDefinition = persisted?.runtimeDefinitions.find((item) => item.id === definition.id)
            const persistedTab = persisted?.workspaceTabs.find((item) => item.id === tab.id && item.runtimeDefinitionId === definition.id)
            if (!persisted || !persistedDefinition || !persistedTab || persisted.activeWorkspaceTabId !== tab.id || persisted.activeProjectId !== current.activeProjectId) throw new Error('runtime-workspace-tab-readback-failed')
            return { ok: true, workspace: persisted, definition: persistedDefinition, tab: persistedTab }
          } catch {
            return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
          }
        })
        if (!committed.ok) return committed
        runtimeManager.register(committed.definition)
        return committed
      } catch {
        return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.closeWorkspaceTab, async (_event, rawTabId: unknown, rawExpectedRevision: unknown): Promise<WorkspaceTabCloseResult> => {
      if (typeof rawTabId !== 'string' || !rawTabId.trim() || rawTabId.length > 200) return { ok: false, code: 'invalid-id', message: 'Workspace Tab 标识无效' }
      const tabId = rawTabId.trim()
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision) ? Math.max(0, Math.floor(rawExpectedRevision)) : undefined
      try {
        const committed = await runChatWorkspaceOperation(async (): Promise<WorkspaceTabCloseResult> => {
          const current = getChatWorkspaceStore().read()
          if (!current) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好，请重试' }
          if (expectedRevision !== undefined && workspaceRevisionOf(current) !== expectedRevision) return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重试' }
          const index = current.workspaceTabs.findIndex((item) => item.id === tabId)
          if (index < 0) return { ok: false, code: 'tab-missing', message: 'Workspace Tab 不存在或已关闭' }
          const closingTab = current.workspaceTabs[index]
          const workspaceTabs = current.workspaceTabs.filter((item) => item.id !== tabId)
          const activeWorkspaceTabId = current.activeWorkspaceTabId === tabId ? workspaceTabs[Math.min(index, workspaceTabs.length - 1)]?.id ?? '' : current.activeWorkspaceTabId
          const proposed = withNextWorkspaceRevision({ ...current, workspaceTabs, activeWorkspaceTabId }, workspaceRevisionOf(current))
          try {
            await getChatWorkspaceStore().save(proposed)
            const persisted = getChatWorkspaceStore().read()
            if (!persisted || persisted.workspaceTabs.some((item) => item.id === tabId) || persisted.activeWorkspaceTabId !== activeWorkspaceTabId || workspaceRevisionOf(persisted) !== workspaceRevisionOf(proposed)) throw new Error('runtime-workspace-tab-close-readback-failed')
            return { ok: true, workspace: persisted, tabId, runtimeDefinitionId: closingTab.runtimeDefinitionId, runtime: null }
          } catch {
            return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
          }
        })
        if (!committed.ok) return committed
        const warnings: string[] = []
        try { await localAppPreviewManager?.closeForTab(committed.tabId) } catch { warnings.push('Runtime 预览关闭失败，可重试') }
        let runtime: RuntimeSnapshot | null = null
        try { runtime = await localAppRuntimeManager?.release(committed.runtimeDefinitionId, `tab:${committed.tabId}`) ?? null } catch { warnings.push('Runtime 消费者释放失败，可重试') }
        return { ok: true, workspace: committed.workspace, tabId: committed.tabId, runtimeDefinitionId: committed.runtimeDefinitionId, runtime, warning: warnings.length > 0 ? warnings.join('；') : undefined }
      } catch {
        return { ok: false, code: 'workspace-save-failed', message: 'Runtime 工作区保存失败，请重试' }
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.renameWorkspaceTab, async (_event, rawTabId: unknown, rawTitle: unknown, rawExpectedRevision: unknown): Promise<WorkspaceTabResult> => {
      if (typeof rawTabId !== 'string' || !rawTabId.trim()) return { ok: false, code: 'invalid-id', message: 'Workspace Tab 标识无效' }
      if (typeof rawTitle !== 'string' || rawTitle.trim().length < 1 || rawTitle.trim().length > 64) {
        return { ok: false, code: 'invalid-title', message: '标题需为 1–64 个字符' }
      }
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision)
        ? Math.max(0, Math.floor(rawExpectedRevision))
        : undefined
      const tabId = rawTabId.trim()
      const title = rawTitle.trim()
      try {
        return await runChatWorkspaceOperation(async (): Promise<WorkspaceTabResult> => {
          const current = getChatWorkspaceStore().read()
          if (!current) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好，请重试' }
          if (expectedRevision !== undefined && workspaceRevisionOf(current) !== expectedRevision) {
            return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重试' }
          }
          const existing = current.workspaceTabs.find((tab) => tab.id === tabId)
          if (!existing) return { ok: false, code: 'tab-missing', message: 'Workspace Tab 不存在或已关闭' }
          const proposed = withNextWorkspaceRevision({
            ...current,
            workspaceTabs: current.workspaceTabs.map((tab) => tab.id === tabId ? { ...tab, title, updatedAt: Date.now() } : tab),
          }, workspaceRevisionOf(current))
          await getChatWorkspaceStore().save(proposed)
          const persisted = getChatWorkspaceStore().read()
          const tab = persisted?.workspaceTabs.find((item) => item.id === tabId)
          const definition = persisted?.runtimeDefinitions.find((item) => item.id === existing.runtimeDefinitionId)
          if (!persisted || !tab || tab.title !== title || !definition) throw new Error('workspace-tab-rename-readback-failed')
          return { ok: true, workspace: persisted, definition, tab }
        })
      } catch {
        return { ok: false, code: 'workspace-save-failed', message: 'Workspace Tab 保存失败，请重试' }
      }
    })
    const resolveProjectRuntime = async (projectId: unknown, mountId: unknown, trust: boolean): Promise<{ ok: true; status: 'not_initialized' | 'ready' | 'trust_required'; projectId: string; mountId: string; runtimeRoot: string; misplacedRuntime?: boolean; definition?: LocalAppDefinition; runtime: LocalAppRuntimeSnapshot | null } | { ok: false; code: string; message: string }> => {
      if (typeof projectId !== 'string' || !projectId.trim()) return { ok: false, code: 'invalid-project', message: '项目无效' }
      const normalizedMountId = typeof mountId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(mountId.trim()) ? mountId.trim() : ''
      if (!normalizedMountId) return { ok: false, code: 'invalid-mount', message: 'Runtime 挂载标识无效' }
      const state = getChatWorkspaceStore().current() ?? getChatWorkspaceStore().read()
      const project = state?.projects.find((item) => item.id === projectId.trim())
      if (!state || !project) return { ok: false, code: 'project-missing', message: '项目不存在' }
      projectRuntimeMountIds.set(project.id, normalizedMountId)
      if (project.pathMissing) {
        await clearProjectRuntimeHost(project.id)
        return { ok: false, code: 'project-path-missing', message: '项目路径不存在' }
      }
      const runtimeRoot = projectRuntimeRoot(project.path)
      const inspected = await inspectLocalAppDirectory(runtimeRoot)
      if (!inspected.ok && inspected.code === 'path-missing') {
        await clearProjectRuntimeHost(project.id)
        return { ok: true, status: 'not_initialized', projectId: project.id, mountId: normalizedMountId, runtimeRoot, misplacedRuntime: projectRuntimePlacementTracker?.hasWarning(project.id) || undefined, runtime: null }
      }
      if (!inspected.ok) {
        await clearProjectRuntimeHost(project.id)
        return { ok: false, code: inspected.code, message: inspected.message }
      }
      const projectRealRoot = await fs.realpath(project.path).catch(() => null)
      if (!projectRealRoot || !isContainedInProject(projectRealRoot, inspected.canonicalRoot)) {
        await clearProjectRuntimeHost(project.id)
        return { ok: false, code: 'runtime-root-escape', message: '项目 Runtime 目录不能通过符号链接指向项目外部' }
      }
      projectRuntimePlacementTracker?.clear(project.id)
      const latestState = getChatWorkspaceStore().current()
      const latestProject = latestState?.projects.find((item) => item.id === project.id)
      if (!latestState || !latestProject || latestProject.path !== project.path) return { ok: false, code: 'stale-project', message: '项目已切换，请重试' }
      const currentState = latestState
      const existing = currentState.runtimeDefinitions.find((item) => item.owner.kind === 'project' && item.owner.projectId === project.id)
      await localAppTrustStore?.load()
      const existingMatchesRoot = Boolean(existing && path.resolve(existing.rootPath) === runtimeRoot && existing.canonicalRoot === inspected.canonicalRoot)
      const trusted = existingMatchesRoot && existing?.trustStatus === 'trusted' && localAppTrustStore?.isTrusted(inspected.canonicalRoot) === true
      if (existing && !existingMatchesRoot) await clearProjectRuntimeHost(project.id)
      if (!trust || trusted) {
        if (trusted && existing) {
          const bound = await bindProspectiveProjectRuntimeDefinition(existing)
          if (!bound.ok) return bound
          localAppRuntimeManager?.register(existing)
          await registerProjectRuntimeHost({ projectId: project.id, mountId: normalizedMountId, canonicalRoot: inspected.canonicalRoot, runtimeDefinitionId: existing.id })
          // This directory may already be served by another definition (a
          // Workspace Tab on the same root). Borrowing is spawn-free: it only
          // attaches this page to the instance that is already running, so the
          // page shows it instead of reporting a stopped Runtime.
          try {
            await localAppRuntimeManager?.borrowSharedRoot(existing.id, projectRuntimeConsumerId({ projectId: project.id, mountId: normalizedMountId }))
          } catch { /* borrowing is best effort; the page can still start its own */ }
          return { ok: true, status: 'ready', projectId: project.id, mountId: normalizedMountId, runtimeRoot, definition: existing, runtime: localAppRuntimeManager?.get(existing.id) ?? null }
        }
        if (existingMatchesRoot && existing) {
          await registerProjectRuntimeHost({ projectId: project.id, mountId: normalizedMountId, canonicalRoot: inspected.canonicalRoot, runtimeDefinitionId: existing.id })
        }
        return { ok: true, status: 'trust_required', projectId: project.id, mountId: normalizedMountId, runtimeRoot, definition: existingMatchesRoot ? existing : undefined, runtime: existingMatchesRoot && existing ? localAppRuntimeManager?.get(existing.id) ?? null : null }
      }
      const wasTrusted = localAppTrustStore?.isTrusted(inspected.canonicalRoot) === true
      try {
        await localAppTrustStore?.grant(inspected.canonicalRoot)
        const committed = await runChatWorkspaceOperation(async () => {
          const lockedState = getChatWorkspaceStore().read()
          const lockedProject = lockedState?.projects.find((item) => item.id === project.id)
          if (!lockedState || !lockedProject || lockedProject.path !== project.path) return { ok: false as const, code: 'stale-project', message: '项目已切换，请重试' }
          const lockedExisting = lockedState.runtimeDefinitions.find((item) => item.owner.kind === 'project' && item.owner.projectId === project.id)
          const now = Date.now()
          const definition: LocalAppDefinition = lockedExisting
            ? { ...lockedExisting, rootPath: inspected.rootPath, canonicalRoot: inspected.canonicalRoot, name: lockedExisting.name || lockedProject.name, mode: inspected.mode, agentos: inspected.agentos, trustStatus: 'trusted', updatedAt: now }
            : {
                id: `runtime-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                owner: { kind: 'project', projectId: project.id },
                name: lockedProject.name || inspected.name,
                rootPath: inspected.rootPath,
                canonicalRoot: inspected.canonicalRoot,
                packageManager: 'npm',
                devCommand: { executable: 'npm', args: ['run', 'dev'] },
                mode: inspected.mode,
                agentos: inspected.agentos,
                trustStatus: 'trusted',
                autoStart: false,
                createdAt: now,
                updatedAt: now,
              }
          const proposed = withNextWorkspaceRevision({
            ...lockedState,
            runtimeDefinitions: [definition, ...lockedState.runtimeDefinitions.filter((item) => item.id !== definition.id)],
          }, workspaceRevisionOf(lockedState))
          await getChatWorkspaceStore().save(proposed)
          const persisted = getChatWorkspaceStore().read()
          const savedDefinition = persisted?.runtimeDefinitions.find((item) => item.id === definition.id)
          if (!persisted || !savedDefinition || savedDefinition.trustStatus !== 'trusted') throw new Error('project-runtime-readback-failed')
          return { ok: true as const, definition: savedDefinition }
        })
        if (!committed.ok) {
          if (!wasTrusted) await localAppTrustStore?.revoke(inspected.canonicalRoot).catch(() => undefined)
          return committed
        }
        const bound = await bindProspectiveProjectRuntimeDefinition(committed.definition)
        if (!bound.ok) return bound
        localAppRuntimeManager?.register(committed.definition)
        await registerProjectRuntimeHost({ projectId: project.id, mountId: normalizedMountId, canonicalRoot: inspected.canonicalRoot, runtimeDefinitionId: committed.definition.id })
        return { ok: true, status: 'ready', projectId: project.id, mountId: normalizedMountId, runtimeRoot, definition: committed.definition, runtime: localAppRuntimeManager?.get(committed.definition.id) ?? null }
      } catch {
        if (!wasTrusted) await localAppTrustStore?.revoke(inspected.canonicalRoot).catch(() => undefined)
        return { ok: false, code: 'workspace-save-failed', message: 'Runtime 信任保存失败，请重试' }
      }
    }
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.ensureProjectRuntime, (_event, projectId: unknown, mountId: unknown) => resolveProjectRuntime(projectId, mountId, false))
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.trustProjectRuntime, (_event, projectId: unknown, mountId: unknown) => resolveProjectRuntime(projectId, mountId, true))
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.trustRuntimeDirectory, async (_event, rawRoot: unknown): Promise<LocalAppDefinitionResult> => {
      if (typeof rawRoot !== 'string' || !rawRoot.trim()) return { ok: false, code: 'invalid-root', message: 'Runtime 目录无效' }
      const inspected = await inspectLocalAppDirectory(rawRoot)
      if (!inspected.ok) return { ok: false, code: inspected.code, message: inspected.message }
      await localAppTrustStore?.grant(inspected.canonicalRoot)
      const now = Date.now()
      const definition: LocalAppDefinition = {
        id: `runtime-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        owner: { kind: 'workspace' },
        name: inspected.name,
        rootPath: inspected.rootPath,
        canonicalRoot: inspected.canonicalRoot,
        packageManager: 'npm',
        devCommand: { executable: 'npm', args: ['run', 'dev'] },
        mode: inspected.mode,
        agentos: inspected.agentos,
        trustStatus: 'trusted',
        autoStart: true,
        createdAt: now,
        updatedAt: now,
      }
      localAppRuntimeManager?.register(definition)
      return { ok: true, definition }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.relocateRuntime, async (_event, rawId: unknown, rawRoot: unknown, rawExpectedRevision: unknown): Promise<LocalAppRelocationResult> => {
      if (typeof rawId !== 'string' || !rawId.trim()) return { ok: false, code: 'invalid-id', message: 'Runtime 标识无效' }
      if (typeof rawRoot !== 'string' || !rawRoot.trim()) return { ok: false, code: 'invalid-root', message: 'Runtime 目录无效' }
      const relocatingScope = workspaceRuntimeScopeId(rawId.trim())
      if (runtimeDevelopmentBusy(relocatingScope)) {
        return { ok: false, code: 'runtime-development-busy', message: 'Runtime 正在修改，请先结束修改后再更换目录' }
      }
      const expectedRevision = typeof rawExpectedRevision === 'number' && Number.isFinite(rawExpectedRevision)
        ? Math.max(0, Math.floor(rawExpectedRevision))
        : undefined
      const inspected = await inspectLocalAppDirectory(rawRoot)
      if (!inspected.ok) return { ok: false, code: inspected.code, message: inspected.message }
      if (!localAppTrustStore || !localAppRuntimeManager) return { ok: false, code: 'runtime-unavailable', message: 'Runtime 服务暂不可用，请重试' }
      const trustStore = localAppTrustStore
      const runtimeManager = localAppRuntimeManager
      const committed = await runChatWorkspaceOperation(async (): Promise<
        | { ok: false; code: string; message: string }
        | { ok: true; workspace: import('../src/components/types').ChatWorkspaceState; definition: LocalAppDefinition; oldCanonicalRoot: string; newCanonicalRoot: string; revokeOldRoot: boolean }
      > => {
        const state = getChatWorkspaceStore().read()
        if (!state) return { ok: false, code: 'workspace-unavailable', message: '工作区尚未准备好' }
        if (expectedRevision !== undefined && workspaceRevisionOf(state) !== expectedRevision) {
          return { ok: false, code: 'workspace-conflict', message: '工作区已更新，请重新打开 Runtime' }
        }
        const current = state.runtimeDefinitions.find((definition) => definition.id === rawId)
        if (!current) return { ok: false, code: 'definition-missing', message: 'Runtime 不存在' }
        if (current.owner.kind !== 'workspace') return { ok: false, code: 'owner-mismatch', message: '项目 Runtime 目录由项目固定管理，不能重定位' }
        const oldCanonicalRoot = current.canonicalRoot ?? current.rootPath
        const now = Date.now()
        const nextDefinition: LocalAppDefinition = {
          ...current,
          rootPath: inspected.rootPath,
          canonicalRoot: inspected.canonicalRoot,
          name: inspected.name,
          mode: inspected.mode,
          agentos: inspected.agentos,
          trustStatus: 'trusted',
          updatedAt: now,
        }
        const nextState = withNextWorkspaceRevision({
          ...state,
          runtimeDefinitions: state.runtimeDefinitions.map((definition) => definition.id === rawId ? nextDefinition : definition),
          workspaceTabs: state.workspaceTabs.map((tab) => tab.runtimeDefinitionId === rawId ? { ...tab, title: nextDefinition.name, updatedAt: now } : tab),
        }, workspaceRevisionOf(state))
        await trustStore.load()
        const wasTrustedNewRoot = state.runtimeDefinitions.some((item) =>
          (item.canonicalRoot ?? item.rootPath) === inspected.canonicalRoot && item.trustStatus === 'trusted',
        ) || trustStore.isTrusted(inspected.canonicalRoot)
        const previousRuntime = runtimeManager.get(rawId)
        const shouldRestoreRuntime = Boolean(previousRuntime && ['preparing', 'starting', 'running', 'degraded', 'ready', 'stale', 'build_required', 'build_failed'].includes(previousRuntime.status))
        let oldStopped = false
        let stopAttempted = false
        let newTrustGranted = false
        const restoreOldRuntime = async () => {
          if (!shouldRestoreRuntime) return
          runtimeManager.register(current)
          for (const tab of state.workspaceTabs.filter((item) => item.runtimeDefinitionId === rawId)) {
            await runtimeManager.start(rawId, `tab:${tab.id}`)
          }
        }
        try {
          // Stop the old native view/process before the durable root switch.
          // A failure leaves the authoritative workspace untouched.
          await localAppPreviewManager?.closeForLocalApp(rawId)
          stopAttempted = true
          const stopped = await runtimeManager.stop(rawId, 'user')
          if (previousRuntime && (!stopped || stopped.status !== 'stopped')) throw new Error('old-runtime-stop-failed')
          oldStopped = true
          await trustStore.grant(inspected.canonicalRoot)
          newTrustGranted = true
          await getChatWorkspaceStore().save(nextState)
          const persisted = getChatWorkspaceStore().read()
          if (!persisted || !persisted.runtimeDefinitions.some((item) => item.id === rawId && (item.canonicalRoot ?? item.rootPath) === inspected.canonicalRoot)) {
            throw new Error('local-app-relocation-readback-missing')
          }
          const revokeOldRoot = oldCanonicalRoot !== inspected.canonicalRoot && !persisted.runtimeDefinitions.some((item) =>
            item.id !== rawId && item.trustStatus === 'trusted' && (item.canonicalRoot ?? item.rootPath) === oldCanonicalRoot,
          )
          return { ok: true, workspace: persisted, definition: nextDefinition, oldCanonicalRoot, newCanonicalRoot: inspected.canonicalRoot, revokeOldRoot }
        } catch (error) {
          if (newTrustGranted && !wasTrustedNewRoot) await trustStore.revoke(inspected.canonicalRoot).catch(() => undefined)
          if (oldStopped || stopAttempted) {
            try {
              await restoreOldRuntime()
            } catch {
              return { ok: false, code: 'relocation-recovery-failed', message: 'Runtime 切换失败，旧运行时恢复失败，请重试' }
            }
          }
          const code = error instanceof Error && error.message === 'old-runtime-stop-failed' ? 'old-runtime-stop-failed' : 'workspace-save-failed'
          const message = code === 'old-runtime-stop-failed'
            ? '旧 Runtime 预览或运行时停止失败，未切换目录，请重试'
            : 'Runtime 状态保存失败，已保留旧目录并恢复运行时，请重试'
          return { ok: false, code, message }
        }
      })
      if (!committed.ok) return committed
      invalidateRuntimeDevelopmentRoute(relocatingScope, committed.definition.updatedAt)

      // Only after the new state is durable do we register/start the new
      // definition. Old-root trust is revoked last and is retained on a
      // start failure so the durable state remains recoverable.
      const warnings: string[] = []
      runtimeManager.register(committed.definition)
      let runtime: LocalAppRuntimeSnapshot | null = null
      try {
        for (const tab of committed.workspace.workspaceTabs.filter((item) => item.runtimeDefinitionId === rawId)) {
          runtime = await runtimeManager.start(rawId, `tab:${tab.id}`)
        }
        if (runtime && !['running', 'degraded', 'ready', 'stale', 'build_required', 'build_failed'].includes(runtime.status)) {
          warnings.push('新目录运行时尚未就绪，可重试')
        } else if (committed.revokeOldRoot) {
          try { await trustStore.revoke(committed.oldCanonicalRoot) } catch { warnings.push('旧目录授权撤销失败，可在设置中重试') }
        }
      } catch {
        warnings.push('新目录运行时启动失败，可重试；旧目录授权暂保留')
      }
      return { ok: true, workspace: committed.workspace, definition: committed.definition, runtime, warning: warnings.length > 0 ? warnings.join('；') : undefined }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.revokeRuntimeTrust, async (_event, rawRoot: unknown) => {
      if (typeof rawRoot !== 'string' || !rawRoot.trim()) return
      const canonicalRoot = await canonicalizeLocalAppRoot(rawRoot).catch(() => rawRoot.trim())
      const state = chatWorkspaceStore?.read()
      const affected = (state?.runtimeDefinitions ?? []).filter((definition) => (definition.canonicalRoot ?? definition.rootPath) === canonicalRoot)
      if (affected.some((definition) => runtimeDevelopmentBusy(definition.owner.kind === 'project' ? projectRuntimeScopeId(definition.owner.projectId) : workspaceRuntimeScopeId(definition.id)))) {
        throw new Error('runtime-development-busy')
      }
      // Fence every owner by stopping its bounded process tree; only then is
      // the shared canonical-root authorization removed.
      for (const definition of affected) {
        await localAppPreviewManager?.closeForLocalApp(definition.id)
        await localAppRuntimeManager?.stop(definition.id, 'user')
      }
      await localAppTrustStore?.revoke(canonicalRoot)
      for (const definition of affected) {
        const runtimeScopeId = definition.owner.kind === 'project'
          ? projectRuntimeScopeId(definition.owner.projectId)
          : workspaceRuntimeScopeId(definition.id)
        invalidateRuntimeDevelopmentRoute(runtimeScopeId, definition.updatedAt)
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getRuntime, async (_event, rawId: unknown) => {
      if (typeof rawId !== 'string' || !rawId.trim()) return null
      const definition = readRuntimeDefinition(rawId)
      const current = localAppRuntimeManager?.get(rawId)
      if (current || !definition) return current ?? null
      const inspected = await inspectLocalAppDirectory(definition.rootPath)
      if (!inspected.ok && inspected.code === 'path-missing') {
        return {
          runtimeDefinitionId: definition.id,
          runtimeId: 'none',
          generation: 0,
          status: 'path_missing',
          restartAttempt: 0,
          updatedAt: Date.now(),
          phase: 'inspect',
          errorCode: inspected.code,
          detail: inspected.message,
          logs: [],
        } satisfies LocalAppRuntimeSnapshot
      }
      return null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.startRuntime, async (event, rawId: unknown, rawCause: unknown, rawConsumerId: unknown) => {
      if (typeof rawId !== 'string' || !rawId.trim()) throw new Error('runtime-definition-id-invalid')
      const definition = readRuntimeDefinition(rawId.trim())
      if (!definition) throw new Error('runtime-definition-missing')
      await assertRuntimeTrust(definition)
      if (!localAppRuntimeManager) throw new Error('local-app-runtime-unavailable')
      localAppRuntimeManager.register(definition)
      const requestedConsumer = typeof rawConsumerId === 'string' && rawConsumerId.trim().length > 0 && rawConsumerId.length <= 200
        ? rawConsumerId.trim()
        : `tab:${rawId.trim()}`
      const consumerId = requestedConsumer.startsWith('tab:') || requestedConsumer.startsWith('project-home:') ? requestedConsumer : `tab:${requestedConsumer}`
      if (consumerId.startsWith('project-home:')) {
        const host = [...projectRuntimeHosts.values()].find((candidate) => projectRuntimeConsumerId(candidate) === consumerId)
        if (!host || host.runtimeDefinitionId !== rawId.trim() || definition.owner.kind !== 'project' || definition.owner.projectId !== host.projectId) throw new Error('project-runtime-host-stale')
      } else {
        const workspaceTabId = consumerId.slice('tab:'.length)
        const tab = (chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read())?.workspaceTabs.find((item) => item.id === workspaceTabId)
        if (definition.owner.kind !== 'workspace' || !tab || tab.runtimeDefinitionId !== definition.id) throw new Error('workspace-runtime-owner-mismatch')
      }
      // Restore is deliberately spawn-free. A user opening a newly trusted
      // static project is allowed to trigger its first fixed build here;
      // subsequent opens reuse the last-good artifact without spawning.
      const cause = rawCause === 'restore' ? 'restore' : 'user'
      try {
        return await localAppRuntimeManager.start(rawId.trim(), consumerId, { autoBuild: cause !== 'restore' })
      } catch (error) {
        const conflictingLease = conflictingRuntimeRootLease(error)
        throw conflictingLease ? runtimeRootConflictError(event.sender.id, conflictingLease) : error
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.stopRuntime, async (_event, rawId: unknown, rawReason: unknown) => {
      if (typeof rawId !== 'string' || !rawId.trim()) return null
      const reason = rawReason === 'last-consumer' || rawReason === 'app-quit' ? rawReason : 'user'
      await localAppPreviewManager?.closeForLocalApp(rawId.trim())
      return localAppRuntimeManager?.stop(rawId.trim(), reason) ?? null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.releaseRuntime, async (_event, rawId: unknown, rawConsumerId: unknown) => {
      if (typeof rawId !== 'string' || !rawId.trim() || typeof rawConsumerId !== 'string' || !rawConsumerId.trim()) return null
      const rawConsumer = rawConsumerId.trim()
      const consumerId = rawConsumer.startsWith('tab:') || rawConsumer.startsWith('project-home:') ? rawConsumer : `tab:${rawConsumer}`
      if (consumerId.startsWith('project-home:')) {
        return releaseRegisteredProjectRuntimeHost(rawId.trim(), consumerId)
      }
      await localAppPreviewManager?.closeForTab(rawConsumer.startsWith('tab:') ? rawConsumer.slice(4) : rawConsumer)
      return localAppRuntimeManager?.release(rawId.trim(), consumerId) ?? null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.restartRuntime, async (_event, rawId: unknown) => {
      if (typeof rawId !== 'string' || !rawId.trim()) throw new Error('runtime-definition-id-invalid')
      const definition = readRuntimeDefinition(rawId.trim())
      if (!definition) throw new Error('runtime-definition-missing')
      await assertRuntimeTrust(definition)
      if (!localAppRuntimeManager) throw new Error('local-app-runtime-unavailable')
      localAppRuntimeManager.register(definition)
      await localAppPreviewManager?.closeForLocalApp(rawId.trim())
      return localAppRuntimeManager.restart(rawId.trim())
    })
    // `C-RSM-503`: ↻ and the failed-update retry. Never builds a runtime that
    // is not already viewable; the start path owns first builds.
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.updateRuntime, async (_event, rawId: unknown, rawOptions: unknown) => {
      if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId.trim())) return null
      const id = rawId.trim()
      const definition = readRuntimeDefinition(id)
      if (!definition || !localAppRuntimeManager) return null
      await assertRuntimeTrust(definition)
      const force = typeof rawOptions === 'object' && rawOptions !== null && (rawOptions as { force?: unknown }).force === true
      return localAppRuntimeManager.updateToLatest(id, { force })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.buildRuntime, async (event, rawId: unknown) => {
      if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId.trim())) return { ok: false, code: 'invalid-id', message: 'Runtime 标识无效' }
      const id = rawId.trim()
      const definition = readRuntimeDefinition(id)
      if (!definition) return { ok: false, code: 'runtime-definition-missing', message: 'Runtime 不存在' }
      const inspected = await inspectLocalAppDirectory(definition.rootPath, definition.serveOverride)
      if (!inspected.ok) return { ok: false, code: inspected.code, message: inspected.message }
      // `C-RSM-402` tier ②: a directory that can build an openable page is
      // buildable even before any declaration exists.
      if (inspected.servePlan.kind !== 'artifact' && inspected.servePlan.kind !== 'buildable') {
        return { ok: false, code: 'static-runtime-required', message: '这个页面需要保持运行才能查看，无法生成已保存预览' }
      }
      await assertRuntimeTrust(definition)
      if (!localAppRuntimeManager) return { ok: false, code: 'runtime-unavailable', message: 'Runtime 服务暂不可用，请重试' }
      const staticDefinition: RuntimeDefinition = { ...definition, mode: 'static', agentos: inspected.agentos }
      const currentRuntime = localAppRuntimeManager.get(id)
      const isStaticRuntime = currentRuntime?.mode === 'static' || currentRuntime?.buildStatus !== undefined
      // A static build keeps the existing last-good artifact and Preview alive
      // while npm runs. Only an explicit development runtime needs stopping
      // before the static build can claim the same definition id.
      if (currentRuntime && !isStaticRuntime) {
        await localAppPreviewManager?.closeForLocalApp(id)
        await localAppRuntimeManager.stop(id, 'user')
      }
      localAppRuntimeManager.register(staticDefinition)
      try {
        const runtime = await localAppRuntimeManager.build(id)
        if (runtime.buildStatus === 'build_failed') {
          return {
            ok: false,
            code: runtime.errorCode ?? 'build-failed',
            message: runtime.detail ?? '静态构建失败',
            runtime,
          }
        }
        return { ok: true, runtime }
      } catch (error) {
        // `T4.7`: losing the same-root race is not a build failure. Hand the
        // browsing surface the occupant's identity and a switch token.
        const conflictingLease = conflictingRuntimeRootLease(error)
        if (conflictingLease) {
          return {
            ok: false,
            code: 'runtime-development-conflict',
            message: '该目录正在由另一个 Runtime 使用。',
            runtime: localAppRuntimeManager.get(id) ?? undefined,
            conflict: mintRuntimeRootConflict(event.sender.id, conflictingLease),
          }
        }
        return { ok: false, code: 'build-failed', message: error instanceof Error ? error.message : '静态构建失败', runtime: localAppRuntimeManager.get(id) ?? undefined }
      }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.cancelRuntimeBuild, async (_event, rawId: unknown, rawBuildId: unknown) => {
      if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId.trim())) return null
      const buildId = typeof rawBuildId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(rawBuildId) ? rawBuildId : undefined
      return localAppRuntimeManager?.cancelBuild(rawId.trim(), buildId) ?? null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.setRuntimeServeOverride, async (_event, rawId: unknown, rawOverride: unknown): Promise<RuntimeSnapshot | null> => {
      if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId.trim())) throw new Error('runtime-definition-id-invalid')
      if (rawOverride !== null && rawOverride !== 'artifact' && rawOverride !== 'server') throw new Error('runtime-serve-override-invalid')
      const id = rawId.trim()
      const serveOverride = rawOverride ?? undefined
      // `C-RSM-404`: the user's explicit choice is durable and outranks
      // detection. Persist first, then re-serve under the new plan.
      const committed = await runChatWorkspaceOperation(async () => {
        const state = getChatWorkspaceStore().read()
        const current = state?.runtimeDefinitions.find((item) => item.id === id)
        if (!state || !current) return null
        const next: RuntimeDefinition = { ...current, serveOverride, updatedAt: Date.now() }
        const proposed = withNextWorkspaceRevision({
          ...state,
          runtimeDefinitions: state.runtimeDefinitions.map((item) => (item.id === id ? next : item)),
        }, workspaceRevisionOf(state))
        await getChatWorkspaceStore().save(proposed)
        const persisted = getChatWorkspaceStore().read()
        const saved = persisted?.runtimeDefinitions.find((item) => item.id === id)
        if (!saved || saved.serveOverride !== serveOverride) throw new Error('runtime-serve-override-readback-failed')
        return saved
      })
      if (!committed || !localAppRuntimeManager) return null
      await localAppPreviewManager?.closeForLocalApp(id)
      await localAppRuntimeManager.stop(id, 'user')
      localAppRuntimeManager.register(committed)
      return localAppRuntimeManager.start(id, undefined, { autoBuild: true })
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.startRuntimeDevelopment, async (_event, rawId: unknown, rawConsumerId: unknown) => {
      if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId.trim())) throw new Error('runtime-definition-id-invalid')
      const id = rawId.trim()
      const definition = readRuntimeDefinition(id)
      if (!definition) throw new Error('runtime-definition-missing')
      await assertRuntimeTrust(definition)
      if (!localAppRuntimeManager) throw new Error('local-app-runtime-unavailable')
      await localAppPreviewManager?.closeForLocalApp(id)
      await localAppRuntimeManager.stop(id, 'user')
      // The explicit development action is the only path that may opt a
      // static definition into the existing npm run dev supervisor.
      const developmentDefinition: RuntimeDefinition = { ...definition, mode: 'development', agentos: undefined, serveScript: 'dev' }
      localAppRuntimeManager.register(developmentDefinition)
      const requestedConsumer = typeof rawConsumerId === 'string' && rawConsumerId.trim() && rawConsumerId.length <= 200 ? rawConsumerId.trim() : `tab:${id}`
      const consumerId = requestedConsumer.startsWith('project-home:') || requestedConsumer.startsWith('tab:') ? requestedConsumer : `tab:${requestedConsumer}`
      if (consumerId.startsWith('project-home:')) {
        const host = [...projectRuntimeHosts.values()].find((candidate) => projectRuntimeConsumerId(candidate) === consumerId && candidate.runtimeDefinitionId === id)
        if (!host || definition.owner.kind !== 'project' || definition.owner.projectId !== host.projectId) throw new Error('project-runtime-host-stale')
      } else {
        const workspaceTabId = consumerId.slice('tab:'.length)
        const tab = (chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read())?.workspaceTabs.find((item) => item.id === workspaceTabId)
        if (definition.owner.kind !== 'workspace' || !tab || tab.runtimeDefinitionId !== id) throw new Error('workspace-runtime-owner-mismatch')
      }
      return localAppRuntimeManager.start(id, consumerId)
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.createRuntimePreview, async (_event, rawHostOrTabId: unknown, rawAppId?: unknown): Promise<LocalAppPreviewResult> => {
      const host = isRecord(rawHostOrTabId) && (rawHostOrTabId.kind === 'workspace-tab' || rawHostOrTabId.kind === 'project-home')
        ? rawHostOrTabId
        : null
      const isProjectHost = host?.kind === 'project-home'
      const projectHost = isProjectHost && host && typeof host.projectId === 'string' && host.projectId.trim() && typeof host.mountId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(host.mountId.trim())
        ? { projectId: host.projectId.trim(), mountId: host.mountId.trim() }
        : null
      const rawTabId = host
        ? isProjectHost && projectHost ? projectRuntimeConsumerId(projectHost) : String(host.workspaceTabId)
        : rawHostOrTabId
      const rawRuntimeDefinitionId = host ? host.runtimeDefinitionId : rawAppId
      if (typeof rawTabId !== 'string' || typeof rawRuntimeDefinitionId !== 'string') return { ok: false, message: 'Runtime 预览视图无效' }
      if (isProjectHost && !projectHost) return { ok: false, message: 'Runtime 挂载视图已失效' }
      const authoritativeBefore = chatWorkspaceStore?.current() ?? chatWorkspaceStore?.read()
      const tab = !isProjectHost ? authoritativeBefore?.workspaceTabs.find((item) => item.id === rawTabId) : undefined
      const project = isProjectHost && projectHost
        ? authoritativeBefore?.projects.find((item) => item.id === projectHost.projectId)
        : undefined
      const definition = authoritativeBefore?.runtimeDefinitions.find((item) => item.id === rawRuntimeDefinitionId)
      const projectRootMatches = Boolean(
        project &&
        definition &&
        definition.owner.kind === 'project' &&
        definition.owner.projectId === project.id &&
        path.resolve(definition.rootPath) === projectRuntimeRoot(project.path)
      )
      const registeredHost = isProjectHost && projectHost && definition
        ? registeredProjectRuntimeHost(projectHost.projectId, projectHost.mountId, rawRuntimeDefinitionId, definition.canonicalRoot ?? path.resolve(definition.rootPath))
        : null
      const workspaceOwnerMatches = Boolean(definition?.owner.kind === 'workspace')
      if (isProjectHost ? (!projectRootMatches || !registeredHost) : (!tab || tab.runtimeDefinitionId !== rawRuntimeDefinitionId || !workspaceOwnerMatches)) {
        return { ok: false, message: 'Runtime 预览视图不存在' }
      }
      const runtime = localAppRuntimeManager?.get(rawRuntimeDefinitionId)
      if (!runtime?.readyUrl && !runtime?.previewUrl) return { ok: false, message: '运行时尚未就绪' }
      if (!localAppPreviewManager) return { ok: false, message: '预览窗口不可用' }
      const previewId = `preview-${rawTabId}-${runtime.generation}`
      const existing = localAppPreviewManager.getForTab(rawTabId)
      if (existing && existing.previewId !== previewId) await localAppPreviewManager.closeForTab(rawTabId)
      // Publish the native view immediately. Loading completion/failure is
      // delivered through the Runtime event stream, so this IPC cannot hang
      // behind a page that never finishes loading.
      const snapshot = await localAppPreviewManager.create(
        previewId,
        rawTabId,
        rawRuntimeDefinitionId,
        runtime,
        { waitForLoad: false },
      )
      const authoritative = chatWorkspaceStore?.current()
      const currentTab = !isProjectHost ? authoritative?.workspaceTabs.find((item) => item.id === rawTabId) : undefined
      const currentProject = isProjectHost && projectHost ? authoritative?.projects.find((item) => item.id === projectHost.projectId) : undefined
      const currentDefinition = authoritative?.runtimeDefinitions.find((item) => item.id === rawRuntimeDefinitionId)
      const currentRuntime = localAppRuntimeManager?.get(rawRuntimeDefinitionId)
      const sessionStillCurrent = localAppPreviewManager.isCurrent(previewId, snapshot)
      const runtimeStillCurrent = currentRuntime?.runtimeId === runtime.runtimeId && currentRuntime.generation === runtime.generation
      const hostStillCurrent = isProjectHost && projectHost
        ? Boolean(currentProject && currentDefinition && currentDefinition.owner.kind === 'project' && currentDefinition.owner.projectId === currentProject.id && path.resolve(currentDefinition.rootPath) === projectRuntimeRoot(currentProject.path) && registeredProjectRuntimeHost(projectHost.projectId, projectHost.mountId, rawRuntimeDefinitionId, currentDefinition.canonicalRoot ?? path.resolve(currentDefinition.rootPath)))
        : Boolean(currentTab && currentTab.runtimeDefinitionId === rawRuntimeDefinitionId && currentDefinition?.owner.kind === 'workspace')
      if (!sessionStillCurrent || !hostStillCurrent || !runtimeStillCurrent) {
        await localAppPreviewManager.closeIfCurrent(previewId, snapshot)
        return { ok: false, message: 'Runtime 视图已失效，请重试' }
      }
      if (snapshot.status === 'ready' || snapshot.status === 'loading') {
        return { ok: true, previewId, status: snapshot.status, detail: snapshot.detail }
      }
      return { ok: false, message: snapshot.detail ?? '预览加载失败' }
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.getRuntimePreviewNavigationState, (_event, rawPreviewId: unknown) => {
      return typeof rawPreviewId === 'string' ? localAppPreviewManager?.getNavigationState(rawPreviewId) ?? null : null
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.setRuntimePreviewBounds, (_event, rawPreviewId: unknown, rawBounds: unknown) => {
      if (typeof rawPreviewId !== 'string' || !isRecord(rawBounds)) return false
      const bounds = {
        x: typeof rawBounds.x === 'number' ? rawBounds.x : NaN,
        y: typeof rawBounds.y === 'number' ? rawBounds.y : NaN,
        width: typeof rawBounds.width === 'number' ? rawBounds.width : NaN,
        height: typeof rawBounds.height === 'number' ? rawBounds.height : NaN,
      }
      return localAppPreviewManager?.setBounds(rawPreviewId, bounds) ?? false
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.setRuntimePreviewVisible, (_event, rawPreviewId: unknown, visible: unknown) => {
      return typeof rawPreviewId === 'string' && typeof visible === 'boolean'
        ? localAppPreviewManager?.setVisible(rawPreviewId, visible) ?? false
        : false
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.navigateRuntimePreview, (_event, rawPreviewId: unknown, direction: unknown) => {
      return typeof rawPreviewId === 'string' && (direction === 'back' || direction === 'forward')
        ? localAppPreviewManager?.navigate(rawPreviewId, direction) ?? false
        : false
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.reloadRuntimePreview, (_event, rawPreviewId: unknown) => {
      return typeof rawPreviewId === 'string' ? localAppPreviewManager?.reload(rawPreviewId) ?? false : false
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.closeRuntimePreview, (_event, rawPreviewId: unknown) => {
      return typeof rawPreviewId === 'string' ? localAppPreviewManager?.close(rawPreviewId) ?? false : false
    })
    ipcMain.handle(DESKTOP_INVOKE_CHANNELS.clearChatWorkspaceData, () => {
      return runChatWorkspaceOperation(async () => {
        await clearChatWorkspaceData(userDataPath)
        await getRuntimePreviewLayoutStore().clear()
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
        const normalizedProjectId = typeof projectId === 'string' ? projectId : ''
        const normalizedQuery = typeof query === 'string' ? query : ''
        const ordinary = getChatWorkspaceStore().searchChatHistory(normalizedProjectId, normalizedQuery, normalizedOptions)
        if (!ordinary.ok) return ordinary
        const runtime = runtimeDevelopmentThreadStore?.search(
          normalizedQuery,
          {
            includeArchived: normalizedOptions.includeArchived,
            limit: normalizedOptions.limit,
            runtimeScopeId: normalizedProjectId ? projectRuntimeScopeId(normalizedProjectId) : undefined,
          },
          (runtimeScopeId) => runtimeWindowIdentity(runtimeScopeId).runtimeName,
        )
        const runtimeItems: ChatHistorySearchItem[] = runtime?.ok ? runtime.items.map((item) => ({
          id: item.id,
          documentKind: 'thread',
          projectId: item.projectId ?? '',
          threadId: item.threadId,
          threadTitle: item.threadTitle,
          title: item.threadTitle,
          subtitle: item.subtitle,
          snippet: item.snippet,
          body: item.snippet,
          updatedAt: item.updatedAt,
          archivedAt: item.archivedAt,
          score: item.score,
          metadata: item.metadata,
        })) : []
        const limit = Math.max(1, Math.min(100, Math.floor(normalizedOptions.limit ?? 50)))
        return { ok: true, projectId: normalizedProjectId, items: [...ordinary.items, ...runtimeItems].sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt).slice(0, limit) }
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
    ipcMain.handle(
      DESKTOP_INVOKE_CHANNELS.testGlobalWebSearchProvider,
      async (_event, payload: unknown): Promise<AgentWebSearchProviderTestResult> => {
        const settings = normalizeWebSearchSettings(isRecord(payload) ? payload : {})
        return testWebSearchProviderSettings(settings, process.env)
      },
    )
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
    initializeAgentOSExternalTasks()
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
        // `base64` carries the full image to the Agent and is dropped before the
        // workspace is persisted; `dataUrl` is the durable UI thumbnail.
        attachments.push({
          id: createAttachmentId(attachments.length),
          kind: 'image',
          name,
          path: resolvedPath,
          mimeType: imageMimeType,
          size: stat.size,
          base64,
          dataUrl: shrinkAttachmentThumbnail(`data:${imageMimeType};base64,${base64}`),
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

function isAuthorizedMainWindowInvoke(event: Electron.IpcMainInvokeEvent): boolean {
  return Boolean(win && !win.isDestroyed() && event.sender.id === win.webContents.id && event.senderFrame === event.sender.mainFrame)
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
