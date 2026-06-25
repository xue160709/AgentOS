/**
 * 预加载脚本：`contextBridge` 暴露受约束的 `desktop` 与 `claudeChat`。
 * Preload bridge exposing constrained `desktop` and `claudeChat` adapters.
 */

import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron'
import type {
  AppUpdaterState,
  DesktopPreferences,
  HomePluginDeleteResult,
  HomePluginTaskEvent,
  HomePluginTaskReadResult,
  HomePluginTaskRunResult,
  HomePluginTaskSaveResult,
  HomePluginTaskStopResult,
  ProjectContextAddMode,
  ProjectContextAddResult,
  ProjectContextResult,
  ProjectFilesChangedEvent,
  ProjectFileWatchResult,
  SpeechRecognitionCommandResult,
  SpeechRecognitionEvent,
  SpeechRecognitionSnapshot,
  TrayMenuAction,
} from '../src/desktop-types'
import type {
  ActiveChatPickPayload,
  ClaudeAgentSettings,
  ClaudeAgentStatusRequest,
  ClaudeAgentStatusSnapshot,
  ClaudeChatEvent,
  ClaudeChatEventHandler,
  ClaudeFileRewindPayload,
  ClaudePermissionResponsePayload,
  ClaudeChatSubmitPayload,
  ChatHistorySearchOptions,
  ChatHistorySearchResult,
  AgentKnowledgeSearchOptions,
  AgentKnowledgeSearchProject,
  AgentKnowledgeSearchResult,
  ClaudeChatAttachmentPickerResult,
} from '../src/claude-chat-types'
import type { DesktopAPI } from '../src/desktop-api'
import { DESKTOP_EVENT_CHANNELS, DESKTOP_INVOKE_CHANNELS } from '../src/desktop-seam'

const CLAUDE_CHAT_EVENT_CHANNEL = 'claude-chat:event'

// --- Desktop bridge / 桌面通用 API ---

const desktopAdapter = {
  platform: process.platform,
  isDevRuntime: process.env.AGENTOS_DEV_RUNTIME === '1' || Boolean(process.env.VITE_DEV_SERVER_URL),
  windowEffects: {
    macVibrancy: process.platform === 'darwin',
    windowsTitlebarOverlay: process.platform === 'win32',
  },
  pickProjectDirectory() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.pickProjectDirectory) as Promise<string | null>
  },
  pickChatAttachments(options?: { allowImages?: boolean }) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.pickChatAttachments, options) as Promise<ClaudeChatAttachmentPickerResult>
  },
  readChatAttachments(filePaths: string[], options?: { allowImages?: boolean }) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.readChatAttachments, filePaths, options) as Promise<ClaudeChatAttachmentPickerResult>
  },
  listProjectFiles(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.listProjectFiles, rootPath)
  },
  watchProjectFiles(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.watchProjectFiles, rootPath) as Promise<ProjectFileWatchResult>
  },
  unwatchProjectFiles(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.unwatchProjectFiles, rootPath) as Promise<void>
  },
  onProjectFilesChanged(handler: (event: ProjectFilesChangedEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: ProjectFilesChangedEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onProjectFilesChanged, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onProjectFilesChanged, listener)
  },
  readProjectFile(rootPath: string, filePath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.readProjectFile, rootPath, filePath)
  },
  searchProjectFiles(rootPath: string, query: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.searchProjectFiles, rootPath, query)
  },
  searchChatHistory(projectId: string, query: string, options?: ChatHistorySearchOptions) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.searchChatHistory, projectId, query, options) as Promise<ChatHistorySearchResult>
  },
  searchAgentKnowledge(projects: AgentKnowledgeSearchProject[], query: string, options?: AgentKnowledgeSearchOptions) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.searchAgentKnowledge, projects, query, options) as Promise<AgentKnowledgeSearchResult>
  },
  listAgentContext(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.listAgentContext, rootPath)
  },
  validateProjectPaths(projectPaths: string[]) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.validateProjectPaths, projectPaths) as Promise<Record<string, boolean>>
  },
  pathExistsUnderProject(rootPath: string, relativePath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.pathExistsUnderProject, rootPath, relativePath) as Promise<boolean>
  },
  runHomePlugin(rootPath: string, options?: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.runHomePlugin, rootPath, options)
  },
  saveHomePluginOrder(rootPath: string, order: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveHomePluginOrder, rootPath, order)
  },
  saveHomePluginLayout(rootPath: string, order: unknown, cards: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveHomePluginLayout, rootPath, order, cards)
  },
  deleteHomePlugin(rootPath: string, slug: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.deleteHomePlugin, rootPath, slug) as Promise<HomePluginDeleteResult>
  },
  saveTaskHomePlugin(rootPath: string, payload: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveTaskHomePlugin, rootPath, payload) as Promise<HomePluginTaskSaveResult>
  },
  getTaskHomePlugin(rootPath: string, slug: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getTaskHomePlugin, rootPath, slug) as Promise<HomePluginTaskReadResult>
  },
  runTaskHomePlugin(rootPath: string, slug: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.runTaskHomePlugin, rootPath, slug) as Promise<HomePluginTaskRunResult>
  },
  stopTaskHomePlugin(rootPath: string, slug: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.stopTaskHomePlugin, rootPath, slug) as Promise<HomePluginTaskStopResult>
  },
  getAgentModeStatus(rootPath: string, locale?: 'zh' | 'en') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getAgentModeStatus, rootPath, locale)
  },
  ensureAgentModeFiles(rootPath: string, locale?: 'zh' | 'en') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.ensureAgentModeFiles, rootPath, locale)
  },
  setAgentModeState(rootPath: string, partial: unknown, locale?: 'zh' | 'en') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setAgentModeState, rootPath, partial, locale)
  },
  getAgentModeSettings(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getAgentModeSettings, rootPath)
  },
  getGlobalMcpSettings() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getGlobalMcpSettings)
  },
  saveGlobalMcpSettings(settings: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveGlobalMcpSettings, settings)
  },
  testGlobalMcpServer(server: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.testGlobalMcpServer, server)
  },
  getGlobalWebSearchSettings() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getGlobalWebSearchSettings)
  },
  saveGlobalWebSearchSettings(settings: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveGlobalWebSearchSettings, settings)
  },
  testGlobalWebSearchProvider(settings: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.testGlobalWebSearchProvider, settings)
  },
  saveAgentModeSettings(rootPath: string, payload: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveAgentModeSettings, rootPath, payload)
  },
  readAgentProjectDocuments(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.readAgentProjectDocuments, rootPath)
  },
  saveAgentProjectDocuments(rootPath: string, files: Record<string, string>) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveAgentProjectDocuments, rootPath, files)
  },
  listProjectContext(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.listProjectContext, rootPath) as Promise<ProjectContextResult>
  },
  saveProjectContextInstructions(rootPath: string, instructions: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveProjectContextInstructions, rootPath, instructions) as Promise<ProjectContextResult>
  },
  addProjectContextEntries(rootPath: string, mode: ProjectContextAddMode) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.addProjectContextEntries, rootPath, mode) as Promise<ProjectContextAddResult>
  },
  removeProjectContextEntry(rootPath: string, relativePath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.removeProjectContextEntry, rootPath, relativePath) as Promise<ProjectContextResult>
  },
  getChatWorkspace() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getChatWorkspace)
  },
  saveChatWorkspace(state: unknown) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveChatWorkspace, state)
  },
  clearChatWorkspaceData() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.clearChatWorkspaceData) as Promise<void>
  },
  clearClaudeAgentSettings() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.clearClaudeAgentSettings) as Promise<void>
  },
  quitApp() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.quitApp) as Promise<void>
  },
  showItemInFolder(targetPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.showItemInFolder, targetPath) as Promise<void>
  },
  openPath(targetPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openPath, targetPath) as Promise<void>
  },
  openExternal(url: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openExternal, url) as Promise<void>
  },
  getDesktopPreferences() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getDesktopPreferences) as Promise<DesktopPreferences>
  },
  setDesktopPreferences(partial: Partial<DesktopPreferences>) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setDesktopPreferences, partial) as Promise<DesktopPreferences>
  },
  syncTrayLocale(locale: 'zh' | 'en') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.syncTrayLocale, locale) as Promise<void>
  },
  copyPngToClipboard(dataUrl: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.copyPngToClipboard, dataUrl) as Promise<boolean>
  },
  copySvgToClipboard(svg: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.copySvgToClipboard, svg) as Promise<boolean>
  },
  getSpeechRecognitionStatus() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getSpeechRecognitionStatus) as Promise<SpeechRecognitionSnapshot>
  },
  startSpeechRecognition(options?: { locale?: string; requiresOnDevice?: boolean }) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.startSpeechRecognition, options) as Promise<SpeechRecognitionCommandResult>
  },
  stopSpeechRecognition() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.stopSpeechRecognition) as Promise<SpeechRecognitionCommandResult>
  },
  cancelSpeechRecognition() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.cancelSpeechRecognition) as Promise<SpeechRecognitionCommandResult>
  },
  onSpeechRecognitionEvent(handler: (event: SpeechRecognitionEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: SpeechRecognitionEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onSpeechRecognitionEvent, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onSpeechRecognitionEvent, listener)
  },
  onTrayMenuAction(handler: (action: TrayMenuAction) => void) {
    const listener = (_event: IpcRendererEvent, raw: unknown) => {
      if (raw === 'new-thread') handler('new-thread')
      else if (raw === 'open-project') handler('open-project')
    }
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onTrayMenuAction, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onTrayMenuAction, listener)
  },
  onHomePluginTaskEvent(handler: (event: HomePluginTaskEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: HomePluginTaskEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onHomePluginTaskEvent, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onHomePluginTaskEvent, listener)
  },
  getAppVersion() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getAppVersion).then((state: AppUpdaterState) => state.currentVersion)
  },
  getAppUpdaterState() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getAppUpdaterState) as Promise<AppUpdaterState>
  },
  checkForAppUpdates() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.checkForAppUpdates) as Promise<AppUpdaterState>
  },
  downloadAppUpdate() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.downloadAppUpdate) as Promise<AppUpdaterState>
  },
  quitAndInstallAppUpdate() {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.quitAndInstallAppUpdate) as Promise<void>
  },
  onAppUpdaterState(handler: (state: AppUpdaterState) => void) {
    const listener = (_event: IpcRendererEvent, state: AppUpdaterState) => handler(state)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onAppUpdaterState, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onAppUpdaterState, listener)
  },
} satisfies DesktopAPI

contextBridge.exposeInMainWorld('desktop', desktopAdapter)

// --- Claude chat IPC / Claude 聊天 IPC ---

contextBridge.exposeInMainWorld('claudeChat', {
  submit(payload: ClaudeChatSubmitPayload) {
    return ipcRenderer.invoke('claude-chat:submit', payload)
  },
  cancel(requestId?: string) {
    return ipcRenderer.invoke('claude-chat:cancel', requestId)
  },
  newThread(threadId?: string) {
    return ipcRenderer.invoke('claude-chat:new-thread', threadId)
  },
  getStatus(payload?: ClaudeAgentStatusRequest) {
    return ipcRenderer.invoke('claude-chat:get-status', payload) as Promise<ClaudeAgentStatusSnapshot>
  },
  answerPermissionRequest(payload: ClaudePermissionResponsePayload) {
    return ipcRenderer.invoke('claude-chat:answer-permission-request', payload)
  },
  rewindFiles(payload: ClaudeFileRewindPayload) {
    return ipcRenderer.invoke('claude-chat:rewind-files', payload)
  },
  getSettings() {
    return ipcRenderer.invoke('claude-agent-settings:get')
  },
  saveSettings(settings: ClaudeAgentSettings) {
    return ipcRenderer.invoke('claude-agent-settings:save', settings)
  },
  testProvider(provider: ClaudeAgentSettings['providers'][number]) {
    return ipcRenderer.invoke('claude-agent-settings:test-provider', provider)
  },
  setActiveChatPick(payload: ActiveChatPickPayload) {
    return ipcRenderer.invoke('claude-agent-settings:set-active-chat-pick', payload)
  },
  onEvent(handler: ClaudeChatEventHandler) {
    const listener = (_event: IpcRendererEvent, event: ClaudeChatEvent) => handler(event)
    ipcRenderer.on(CLAUDE_CHAT_EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(CLAUDE_CHAT_EVENT_CHANNEL, listener)
  },
})
