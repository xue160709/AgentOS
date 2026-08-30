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
  ClaudeChatAPI,
} from '../src/claude-chat-types'
import type { DesktopAPI, LocalAppCloseTabResult, LocalAppCreationResult, LocalAppDefinitionResult, LocalAppOpenTabResult, LocalAppPreviewResult, LocalAppRelocationResult, ProjectRuntimeResult, RuntimeCreationResult, RuntimeDefinitionResult, RuntimeInspectResult, RuntimePreviewHost, RuntimePreviewLayout, RuntimePreviewLayoutSize, RuntimePreviewNavigationState, RuntimePreviewResult, WorkspaceTabCloseResult, WorkspaceTabResult } from '../src/desktop-api'
import type { LocalAppRuntimeEvent, LocalAppRuntimeSnapshot, RuntimeEvent, RuntimeSnapshot } from '../src/components/types'
import type { WorkspaceCommand, WorkspaceCommandResult } from '../src/workspace-commands'
import { DESKTOP_EVENT_CHANNELS, DESKTOP_INVOKE_CHANNELS } from '../src/desktop-seam'
import {
  type AnswerProjectPromptInput,
  type ArchiveProjectThreadInput,
  type CancelProjectRunInput,
  type CreateProjectThreadInput,
  type EditAndSubmitProjectRunInput,
  type ForkProjectThreadInput,
  type MarkProjectFileDiffReviewedInput,
  type RewindProjectFileDiffInput,
  type ReportProjectChatPresenceInput,
  type SaveProjectChatWindowViewStateInput,
  type SubmitProjectRunInput,
  type SetProjectThreadModelInput,
  type SetProjectThreadPinnedInput,
  type ProjectChatAPI,
  type ProjectChatClientEvent,
  type GetProjectChatThreadStatusInput,
  type ReadProjectChatAttachmentsInput,
  type SearchProjectChatFilesInput,
} from '../src/project-chat-contract'
import { PROJECT_CHAT_EVENT_CHANNELS, PROJECT_CHAT_INVOKE_CHANNELS } from '../src/project-chat-ipc-seam'
import {
  type RuntimeChatAPI,
  type RuntimeChatEvent,
  type RuntimeDevelopmentMainEvent,
} from '../src/runtime-development-contract'
import { RUNTIME_CHAT_INVOKE_CHANNELS } from './runtime-chat-ipc'

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
  applyWorkspaceCommand(command: WorkspaceCommand, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.applyWorkspaceCommand, command, expectedRevision) as Promise<WorkspaceCommandResult>
  },
  inspectLocalAppDirectory(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.inspectLocalAppDirectory, rootPath)
  },
  trustLocalAppDirectory(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.trustLocalAppDirectory, rootPath) as Promise<LocalAppDefinitionResult>
  },
  createLocalApp(rootPath: string, expectedRevision?: number, title?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.createLocalApp, rootPath, expectedRevision, title) as Promise<LocalAppCreationResult>
  },
  openLocalAppTab(localAppId: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openLocalAppTab, localAppId, expectedRevision) as Promise<LocalAppOpenTabResult>
  },
  closeLocalAppTab(tabId: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.closeLocalAppTab, tabId, expectedRevision) as Promise<LocalAppCloseTabResult>
  },
  relocateLocalApp(localAppId: string, rootPath: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.relocateLocalApp, localAppId, rootPath, expectedRevision) as Promise<LocalAppRelocationResult>
  },
  revokeLocalAppTrust(canonicalRoot: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.revokeLocalAppTrust, canonicalRoot) as Promise<void>
  },
  getLocalAppRuntime(localAppId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getLocalAppRuntime, localAppId) as Promise<LocalAppRuntimeSnapshot | null>
  },
  startLocalAppRuntime(localAppId: string, cause?: 'user' | 'restore', consumerId?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.startLocalAppRuntime, localAppId, cause, consumerId) as Promise<LocalAppRuntimeSnapshot>
  },
  stopLocalAppRuntime(localAppId: string, reason?: 'user' | 'last-consumer' | 'app-quit') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.stopLocalAppRuntime, localAppId, reason) as Promise<LocalAppRuntimeSnapshot | null>
  },
  releaseLocalAppRuntime(localAppId: string, consumerId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.releaseLocalAppRuntime, localAppId, consumerId) as Promise<LocalAppRuntimeSnapshot | null>
  },
  restartLocalAppRuntime(localAppId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.restartLocalAppRuntime, localAppId) as Promise<LocalAppRuntimeSnapshot>
  },
  buildLocalAppRuntime(localAppId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.buildLocalAppRuntime, localAppId)
  },
  cancelLocalAppRuntimeBuild(localAppId: string, buildId?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.cancelLocalAppRuntimeBuild, localAppId, buildId) as Promise<LocalAppRuntimeSnapshot | null>
  },
  createLocalAppPreview(tabId: string, localAppId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.createLocalAppPreview, tabId, localAppId) as Promise<LocalAppPreviewResult>
  },
  setLocalAppPreviewBounds(previewId: string, bounds: { x: number; y: number; width: number; height: number }) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setLocalAppPreviewBounds, previewId, bounds) as Promise<boolean>
  },
  setLocalAppPreviewVisible(previewId: string, visible: boolean) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setLocalAppPreviewVisible, previewId, visible) as Promise<boolean>
  },
  reloadLocalAppPreview(previewId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.reloadLocalAppPreview, previewId) as Promise<boolean>
  },
  closeLocalAppPreview(previewId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.closeLocalAppPreview, previewId) as Promise<boolean>
  },
  onLocalAppRuntimeEvent(handler: (event: LocalAppRuntimeEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: LocalAppRuntimeEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onLocalAppRuntimeEvent, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onLocalAppRuntimeEvent, listener)
  },
  inspectRuntimeDirectory(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.inspectRuntimeDirectory, rootPath) as Promise<RuntimeInspectResult>
  },
  trustRuntimeDirectory(rootPath: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.trustRuntimeDirectory, rootPath) as Promise<RuntimeDefinitionResult>
  },
  createWorkspaceTab(rootPath: string, expectedRevision?: number, title?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.createWorkspaceTab, rootPath, expectedRevision, title) as Promise<RuntimeCreationResult>
  },
  openWorkspaceTab(runtimeDefinitionId: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openWorkspaceTab, runtimeDefinitionId, expectedRevision) as Promise<WorkspaceTabResult>
  },
  closeWorkspaceTab(tabId: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.closeWorkspaceTab, tabId, expectedRevision) as Promise<WorkspaceTabCloseResult>
  },
  renameWorkspaceTab(tabId: string, title: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.renameWorkspaceTab, tabId, title, expectedRevision) as Promise<WorkspaceTabResult>
  },
  relocateRuntime(runtimeDefinitionId: string, rootPath: string, expectedRevision?: number) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.relocateRuntime, runtimeDefinitionId, rootPath, expectedRevision) as Promise<LocalAppRelocationResult>
  },
  revokeRuntimeTrust(canonicalRoot: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.revokeRuntimeTrust, canonicalRoot) as Promise<void>
  },
  getRuntime(runtimeDefinitionId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getRuntime, runtimeDefinitionId) as Promise<RuntimeSnapshot | null>
  },
  startRuntime(runtimeDefinitionId: string, cause?: 'user' | 'restore', consumerId?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.startRuntime, runtimeDefinitionId, cause, consumerId) as Promise<RuntimeSnapshot>
  },
  stopRuntime(runtimeDefinitionId: string, reason?: 'user' | 'last-consumer' | 'app-quit') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.stopRuntime, runtimeDefinitionId, reason) as Promise<RuntimeSnapshot | null>
  },
  releaseRuntime(runtimeDefinitionId: string, consumerId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.releaseRuntime, runtimeDefinitionId, consumerId) as Promise<RuntimeSnapshot | null>
  },
  restartRuntime(runtimeDefinitionId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.restartRuntime, runtimeDefinitionId) as Promise<RuntimeSnapshot>
  },
  buildRuntime(runtimeDefinitionId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.buildRuntime, runtimeDefinitionId)
  },
  cancelRuntimeBuild(runtimeDefinitionId: string, buildId?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.cancelRuntimeBuild, runtimeDefinitionId, buildId) as Promise<RuntimeSnapshot | null>
  },
  setRuntimeServeOverride(runtimeDefinitionId: string, serveOverride: 'artifact' | 'server' | null) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setRuntimeServeOverride, runtimeDefinitionId, serveOverride) as Promise<RuntimeSnapshot | null>
  },
  startRuntimeDevelopment(runtimeDefinitionId: string, consumerId?: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.startRuntimeDevelopment, runtimeDefinitionId, consumerId) as Promise<RuntimeSnapshot>
  },
  openRuntimeDevelopment(target) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openRuntimeDevelopment, target)
  },
  focusRuntimeDevelopmentConflict(conflictToken: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.focusRuntimeDevelopmentConflict, conflictToken)
  },
  endRuntimeDevelopment(target) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.endRuntimeDevelopment, target)
  },
  openRuntimeDevelopmentThread(threadId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.openRuntimeDevelopmentThread, threadId)
  },
  createRuntimePreview(host: RuntimePreviewHost) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.createRuntimePreview, host) as Promise<RuntimePreviewResult>
  },
  getRuntimePreviewLayout(projectId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getRuntimePreviewLayout, projectId) as Promise<RuntimePreviewLayout>
  },
  saveRuntimePreviewLayout(projectId: string, size: RuntimePreviewLayoutSize) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.saveRuntimePreviewLayout, projectId, size) as Promise<RuntimePreviewLayout>
  },
  resetRuntimePreviewLayout(projectId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.resetRuntimePreviewLayout, projectId) as Promise<RuntimePreviewLayout>
  },
  getRuntimePreviewNavigationState(previewId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.getRuntimePreviewNavigationState, previewId) as Promise<RuntimePreviewNavigationState | null>
  },
  setRuntimePreviewBounds(previewId: string, bounds: { x: number; y: number; width: number; height: number }) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setRuntimePreviewBounds, previewId, bounds) as Promise<boolean>
  },
  setRuntimePreviewVisible(previewId: string, visible: boolean) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.setRuntimePreviewVisible, previewId, visible) as Promise<boolean>
  },
  navigateRuntimePreview(previewId: string, direction: 'back' | 'forward') {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.navigateRuntimePreview, previewId, direction) as Promise<boolean>
  },
  reloadRuntimePreview(previewId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.reloadRuntimePreview, previewId) as Promise<boolean>
  },
  closeRuntimePreview(previewId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.closeRuntimePreview, previewId) as Promise<boolean>
  },
  onRuntimePreviewNavigationState(handler: (state: RuntimePreviewNavigationState) => void) {
    const listener = (_event: IpcRendererEvent, state: RuntimePreviewNavigationState) => handler(state)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onRuntimePreviewNavigationState, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onRuntimePreviewNavigationState, listener)
  },
  onRuntimeEvent(handler: (event: RuntimeEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: RuntimeEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onRuntimeEvent, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onRuntimeEvent, listener)
  },
  onRuntimeDevelopmentEvent(handler: (event: RuntimeDevelopmentMainEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: RuntimeDevelopmentMainEvent) => handler(event)
    ipcRenderer.on(DESKTOP_EVENT_CHANNELS.onRuntimeDevelopmentEvent, listener)
    return () => ipcRenderer.off(DESKTOP_EVENT_CHANNELS.onRuntimeDevelopmentEvent, listener)
  },
  ensureProjectRuntime(projectId: string, mountId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.ensureProjectRuntime, projectId, mountId) as Promise<ProjectRuntimeResult>
  },
  trustProjectRuntime(projectId: string, mountId: string) {
    return ipcRenderer.invoke(DESKTOP_INVOKE_CHANNELS.trustProjectRuntime, projectId, mountId) as Promise<ProjectRuntimeResult>
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

// --- Claude chat IPC / Claude 聊天 IPC ---

const claudeChatAdapter: ClaudeChatAPI = {
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
}

// Disabled Project Chat v2 bridge. M0-05 is responsible for enabling callers/handlers.
const projectChatAdapter: ProjectChatAPI = {
  getSnapshot(projectId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.getSnapshot, projectId)
  },
  createThread(input: CreateProjectThreadInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.createThread, input)
  },
  submitRun(input: SubmitProjectRunInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.submitRun, input)
  },
  forkThread(input: ForkProjectThreadInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.forkThread, input) },
  editAndSubmitRun(input: EditAndSubmitProjectRunInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.editAndSubmitRun, input) },
  archiveThread(input: ArchiveProjectThreadInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.archiveThread, input) },
  setThreadPinned(input: SetProjectThreadPinnedInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.setThreadPinned, input) },
  setThreadModel(input: SetProjectThreadModelInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.setThreadModel, input) },
  markFileDiffReviewed(input: MarkProjectFileDiffReviewedInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.markFileDiffReviewed, input) },
  rewindFileDiff(input: RewindProjectFileDiffInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.rewindFileDiff, input) },
  cancelRun(input: CancelProjectRunInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.cancelRun, input)
  },
  answerPrompt(input: AnswerProjectPromptInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.answerPrompt, input)
  },
  reportPresenceSelection(input: ReportProjectChatPresenceInput) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.reportPresenceSelection, input) },
  openProjectWindow(projectId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.openProjectWindow, projectId)
  },
  startProjectRuntimeChat(projectId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.startProjectRuntimeChat, projectId)
  },
  openWorkspaceTabProjectChat(workspaceTabId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.openWorkspaceTabProjectChat, workspaceTabId)
  },
  openProjectPreview(projectId: string) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.openProjectPreview, projectId) },
  openProjectPathRecovery(projectId: string) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.openProjectPathRecovery, projectId) },
  getWindowViewState(projectId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.getWindowViewState, projectId)
  },
  saveWindowViewState(input: SaveProjectChatWindowViewStateInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.saveWindowViewState, input)
  },
  markExternalTasksSeen(projectId: string, seenAt: number) { return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.markExternalTasksSeen, { projectId, seenAt }) },
  listWebsiteBindings() {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.listWebsiteBindings)
  },
  revokeWebsiteBinding(bindingId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.revokeWebsiteBinding, bindingId)
  },
  respondToWebsitePairing(input) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.respondToWebsitePairing, input)
  },
  initializePermissionMode(legacyMode) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.initializePermissionMode, legacyMode)
  },
  setPermissionMode(mode) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.setPermissionMode, mode)
  },
  getModelCatalog() {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.getModelCatalog)
  },
  getAgentContext(projectId: string) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.getAgentContext, projectId)
  },
  searchProjectFiles(input: SearchProjectChatFilesInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.searchProjectFiles, input)
  },
  pickAttachments(options?: { allowImages?: boolean }) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.pickAttachments, options)
  },
  readProjectAttachments(input: ReadProjectChatAttachmentsInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.readProjectAttachments, input)
  },
  getThreadStatus(input: GetProjectChatThreadStatusInput) {
    return ipcRenderer.invoke(PROJECT_CHAT_INVOKE_CHANNELS.getThreadStatus, input)
  },
  onEvent(handler: (event: ProjectChatClientEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: ProjectChatClientEvent) => handler(event)
    ipcRenderer.on(PROJECT_CHAT_EVENT_CHANNELS.onEvent, listener)
    return () => ipcRenderer.off(PROJECT_CHAT_EVENT_CHANNELS.onEvent, listener)
  },
}

const runtimeChatAdapter: RuntimeChatAPI = {
  getSnapshot: () => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getSnapshot),
  createThread: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.createThread, input),
  submitRun: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.submitRun, input),
  forkThread: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.forkThread, input),
  editAndSubmitRun: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.editAndSubmitRun, input),
  archiveThread: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.archiveThread, input),
  setThreadPinned: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.setThreadPinned, input),
  setThreadModel: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.setThreadModel, input),
  markFileDiffReviewed: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.markFileDiffReviewed, input),
  rewindFileDiff: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.rewindFileDiff, input),
  cancelRun: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.cancelRun, input),
  answerPrompt: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.answerPrompt, input),
  getModelCatalog: () => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getModelCatalog),
  getAgentContext: () => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getAgentContext),
  searchFiles: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.searchFiles, input),
  pickAttachments: (options) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.pickAttachments, options),
  readAttachments: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.readAttachments, input),
  getThreadStatus: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getThreadStatus, input),
  getWindowContext: () => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getWindowContext),
  getWindowViewState: () => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.getWindowViewState),
  saveWindowViewState: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.saveWindowViewState, input),
  reportPresenceSelection: (input) => ipcRenderer.invoke(RUNTIME_CHAT_INVOKE_CHANNELS.reportPresenceSelection, input),
  onEvent(handler: (event: RuntimeChatEvent) => void) {
    const listener = (_event: IpcRendererEvent, event: RuntimeChatEvent) => handler(event)
    ipcRenderer.on('runtime-chat:event', listener)
    return () => ipcRenderer.off('runtime-chat:event', listener)
  },
}

/** Only Main-controlled BrowserWindow additionalArguments select this profile. */
export function isProjectChatWindowProfile(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--agentos-window-kind=project-chat')
}

export function isRuntimeDevelopmentWindowProfile(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--agentos-window-kind=runtime-development')
}

if (isRuntimeDevelopmentWindowProfile()) {
  // Runtime 开发窗口只能访问 capability-scoped Runtime Chat；不暴露 desktop、Project 或 Node/path API。
  contextBridge.exposeInMainWorld('runtimeChat', runtimeChatAdapter)
} else if (isProjectChatWindowProfile()) {
  contextBridge.exposeInMainWorld('projectChat', projectChatAdapter)
} else {
  contextBridge.exposeInMainWorld('desktop', desktopAdapter)
  contextBridge.exposeInMainWorld('claudeChat', claudeChatAdapter)
  contextBridge.exposeInMainWorld('projectChat', projectChatAdapter)
}
