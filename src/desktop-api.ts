import type {
  AgentContextResult,
  AgentKnowledgeSearchOptions,
  AgentKnowledgeSearchProject,
  AgentKnowledgeSearchResult,
  ChatHistorySearchOptions,
  ChatHistorySearchResult,
  ClaudeChatAttachmentPickerResult,
  ProjectFileSearchResult,
} from './claude-chat-types'
import type {
  ChatWorkspaceState,
  FileTreeResult,
  LocalAppDefinition,
  LocalAppRuntimeEvent,
  LocalAppRuntimeSnapshot,
  RuntimeDefinition,
  RuntimeEvent,
  RuntimeServeOverride,
  RuntimeSnapshot,
  RuntimeStaticDeclaration,
  WorkspaceTab,
  ProjectFilePreviewResult,
} from './components/types'
import type { WorkspaceCommand, WorkspaceCommandResult } from './workspace-commands'
import type {
  OpenRuntimeDevelopmentResult,
  RuntimeDevelopmentMainEvent,
  RuntimeDevelopmentResult,
  RuntimeDevelopmentTarget,
} from './runtime-development-contract'
import type {
  AgentModeFilesResult,
  AgentMcpGlobalSettings,
  AgentMcpGlobalSettingsResult,
  AgentMcpServerConfig,
  AgentMcpServerProbeResult,
  AgentWebSearchSettings,
  AgentWebSearchProviderTestResult,
  AgentWebSearchSettingsResult,
  AgentModeProjectSettings,
  AgentModeSettingsResult,
  AgentModeStatusResult,
  AgentProjectDocumentsResult,
  LocalAppInspectResult,
  AppUpdaterState,
  AppUiLocale,
  DesktopPreferences,
  HomePluginDeleteResult,
  HomePluginLayoutSaveResult,
  HomePluginOrderSaveResult,
  HomePluginRunOptions,
  HomePluginRunResult,
  HomePluginTaskConfig,
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
} from './desktop-types'

export type LocalAppDefinitionResult =
  | { ok: true; definition: LocalAppDefinition }
  | { ok: false; message: string; code?: string }

export type LocalAppRelocationResult =
  | {
      ok: true
      workspace: ChatWorkspaceState
      definition: LocalAppDefinition
      runtime: LocalAppRuntimeSnapshot | null
      warning?: string
    }
  | { ok: false; message: string; code?: string }

export type LocalAppCreationResult =
  | {
      ok: true
      workspace: ChatWorkspaceState
      definition: LocalAppDefinition
      tab: import('./components/types').LocalAppTab
    }
  | { ok: false; message: string; code?: string }

export type LocalAppOpenTabResult =
  | {
      ok: true
      workspace: ChatWorkspaceState
      definition: LocalAppDefinition
      tab: import('./components/types').LocalAppTab
    }
  | { ok: false; message: string; code?: string }

export type LocalAppCloseTabResult =
  | {
      ok: true
      workspace: ChatWorkspaceState
      tabId: string
      localAppId: string
      runtimeDefinitionId?: string
      runtime: LocalAppRuntimeSnapshot | null
      warning?: string
    }
  | { ok: false; message: string; code?: string }

export type LocalAppPreviewResult =
  | { ok: true; previewId: string; status: 'creating' | 'loading' | 'ready' | 'failed' | 'closed' | 'degraded'; detail?: string }
  | { ok: false; message: string }

export type RuntimeInspectResult =
  | (Extract<LocalAppInspectResult, { ok: true }> & { mode: 'development' | 'static'; agentos?: RuntimeStaticDeclaration })
  | (Extract<LocalAppInspectResult, { ok: false }> & { code: Extract<Extract<LocalAppInspectResult, { ok: false }>['code'], string> | 'static-declaration-invalid' })
export type RuntimeDefinitionResult =
  | { ok: true; definition: RuntimeDefinition }
  | { ok: false; message: string; code?: string }
export type RuntimeCreationResult =
  | { ok: true; workspace: ChatWorkspaceState; definition: RuntimeDefinition; tab: WorkspaceTab }
  | { ok: false; message: string; code?: string }
export type WorkspaceTabResult = RuntimeCreationResult
export type RuntimeRelocationResult = LocalAppRelocationResult
export type WorkspaceTabCloseResult =
  | { ok: true; workspace: ChatWorkspaceState; tabId: string; runtimeDefinitionId: string; runtime: RuntimeSnapshot | null; warning?: string }
  | { ok: false; message: string; code?: string }
export type RuntimePreviewHost =
  | { kind: 'workspace-tab'; workspaceTabId: string; runtimeDefinitionId: string }
  | { kind: 'project-home'; projectId: string; mountId: string; runtimeDefinitionId: string }
export type RuntimePreviewResult = LocalAppPreviewResult
export type RuntimePreviewNavigationState = { previewId: string; canGoBack: boolean; canGoForward: boolean }
export type RuntimePreviewLayoutSize = { width: number; height: number }
export type RuntimePreviewLayout = { projectId: string; width?: number; height: number; updatedAt: number }
export type ProjectRuntimeResult =
  | { ok: true; status: 'not_initialized' | 'ready' | 'trust_required'; projectId: string; mountId: string; runtimeRoot: string; misplacedRuntime?: boolean; definition?: RuntimeDefinition; runtime: RuntimeSnapshot | null }
  | { ok: false; message: string; code?: string }

/** Same-root conflict facts a browsing surface can render and act on. */
export type RuntimeRootConflictInfo = {
  conflictToken: string
  conflictingRuntimeName: string
  conflictingOwnerKind: 'project' | 'workspace'
}

export type RuntimeBuildResult =
  | { ok: true; runtime: RuntimeSnapshot }
  | { ok: false; message: string; code?: string; runtime?: RuntimeSnapshot; conflict?: RuntimeRootConflictInfo }

export type DesktopAPI = {
  platform: NodeJS.Platform
  isDevRuntime?: boolean
  windowEffects?: {
    macVibrancy: boolean
    windowsTitlebarOverlay: boolean
  }
  pickProjectDirectory?: () => Promise<string | null>
  pickChatAttachments?: (options?: { allowImages?: boolean }) => Promise<ClaudeChatAttachmentPickerResult>
  readChatAttachments?: (
    filePaths: string[],
    options?: { allowImages?: boolean },
  ) => Promise<ClaudeChatAttachmentPickerResult>
  listProjectFiles?: (rootPath: string) => Promise<FileTreeResult>
  watchProjectFiles?: (rootPath: string) => Promise<ProjectFileWatchResult>
  unwatchProjectFiles?: (rootPath: string) => Promise<void>
  onProjectFilesChanged?: (handler: (event: ProjectFilesChangedEvent) => void) => () => void
  readProjectFile?: (rootPath: string, filePath: string) => Promise<ProjectFilePreviewResult>
  searchProjectFiles?: (rootPath: string, query: string) => Promise<ProjectFileSearchResult>
  searchChatHistory?: (
    projectId: string,
    query: string,
    options?: ChatHistorySearchOptions,
  ) => Promise<ChatHistorySearchResult>
  searchAgentKnowledge?: (
    projects: AgentKnowledgeSearchProject[],
    query: string,
    options?: AgentKnowledgeSearchOptions,
  ) => Promise<AgentKnowledgeSearchResult>
  listAgentContext?: (rootPath: string) => Promise<AgentContextResult>
  validateProjectPaths?: (projectPaths: string[]) => Promise<Record<string, boolean>>
  pathExistsUnderProject?: (rootPath: string, relativePath: string) => Promise<boolean>
  runHomePlugin?: (rootPath: string, options?: HomePluginRunOptions) => Promise<HomePluginRunResult>
  saveHomePluginOrder?: (rootPath: string, order: string[]) => Promise<HomePluginOrderSaveResult>
  saveHomePluginLayout?: (
    rootPath: string,
    order: string[],
    cards: Array<{ slug: string; preferredSize: import('./desktop-types').HomePluginCardSize }>,
  ) => Promise<HomePluginLayoutSaveResult>
  deleteHomePlugin?: (rootPath: string, slug: string) => Promise<HomePluginDeleteResult>
  saveTaskHomePlugin?: (
    rootPath: string,
    payload: Omit<HomePluginTaskConfig, 'version' | 'slug' | 'createdAt' | 'updatedAt'> & {
      slug?: string
    },
  ) => Promise<HomePluginTaskSaveResult>
  getTaskHomePlugin?: (rootPath: string, slug: string) => Promise<HomePluginTaskReadResult>
  runTaskHomePlugin?: (rootPath: string, slug: string) => Promise<HomePluginTaskRunResult>
  stopTaskHomePlugin?: (rootPath: string, slug: string) => Promise<HomePluginTaskStopResult>
  getAgentModeStatus?: (rootPath: string, locale?: AppUiLocale) => Promise<AgentModeStatusResult>
  ensureAgentModeFiles?: (rootPath: string, locale?: AppUiLocale) => Promise<AgentModeFilesResult>
  setAgentModeState?: (
    rootPath: string,
    partial: Partial<Pick<AgentModeProjectSettings, 'enabled' | 'todoEnabled'>>,
    locale?: AppUiLocale,
  ) => Promise<AgentModeStatusResult>
  getAgentModeSettings?: (rootPath: string) => Promise<AgentModeSettingsResult>
  getGlobalMcpSettings?: () => Promise<AgentMcpGlobalSettingsResult>
  saveGlobalMcpSettings?: (settings: Partial<AgentMcpGlobalSettings>) => Promise<AgentMcpGlobalSettingsResult>
  testGlobalMcpServer?: (server: AgentMcpServerConfig) => Promise<AgentMcpServerProbeResult>
  getGlobalWebSearchSettings?: () => Promise<AgentWebSearchSettingsResult>
  saveGlobalWebSearchSettings?: (settings: Partial<AgentWebSearchSettings>) => Promise<AgentWebSearchSettingsResult>
  testGlobalWebSearchProvider?: (settings: Partial<AgentWebSearchSettings>) => Promise<AgentWebSearchProviderTestResult>
  saveAgentModeSettings?: (
    rootPath: string,
    payload: Partial<
      Pick<
        AgentModeProjectSettings,
        | 'user'
        | 'identity'
        | 'projectModelPick'
        | 'skillModelOverrides'
        | 'mcpServers'
        | 'mcpServerOverrides'
        | 'mcpToolPolicies'
      >
    >,
  ) => Promise<AgentModeSettingsResult>
  readAgentProjectDocuments?: (rootPath: string) => Promise<AgentProjectDocumentsResult>
  saveAgentProjectDocuments?: (
    rootPath: string,
    files: Record<string, string>,
  ) => Promise<AgentProjectDocumentsResult>
  listProjectContext?: (rootPath: string) => Promise<ProjectContextResult>
  saveProjectContextInstructions?: (
    rootPath: string,
    instructions: string,
  ) => Promise<ProjectContextResult>
  addProjectContextEntries?: (
    rootPath: string,
    mode: ProjectContextAddMode,
  ) => Promise<ProjectContextAddResult>
  removeProjectContextEntry?: (
    rootPath: string,
    relativePath: string,
  ) => Promise<ProjectContextResult>
  getChatWorkspace?: () => Promise<ChatWorkspaceState | null>
  saveChatWorkspace?: (state: ChatWorkspaceState) => Promise<ChatWorkspaceState>
  /**
   * Main-owned durable workspace intents (`FIX-WS-01`). The renderer never
   * sends snapshot content here; Main derives durable state from its own store
   * and returns the persisted, readback-verified workspace.
   */
  applyWorkspaceCommand?: (command: WorkspaceCommand, expectedRevision?: number) => Promise<WorkspaceCommandResult>
  inspectLocalAppDirectory?: (rootPath: string) => Promise<LocalAppInspectResult>
  trustLocalAppDirectory?: (rootPath: string) => Promise<LocalAppDefinitionResult>
  createLocalApp?: (rootPath: string, expectedRevision?: number, title?: string) => Promise<LocalAppCreationResult>
  openLocalAppTab?: (localAppId: string, expectedRevision?: number) => Promise<LocalAppOpenTabResult>
  closeLocalAppTab?: (tabId: string, expectedRevision?: number) => Promise<LocalAppCloseTabResult>
  relocateLocalApp?: (localAppId: string, rootPath: string, expectedRevision?: number) => Promise<LocalAppRelocationResult>
  revokeLocalAppTrust?: (canonicalRoot: string) => Promise<void>
  getLocalAppRuntime?: (localAppId: string) => Promise<LocalAppRuntimeSnapshot | null>
  startLocalAppRuntime?: (localAppId: string, cause?: 'user' | 'restore', consumerId?: string) => Promise<LocalAppRuntimeSnapshot>
  stopLocalAppRuntime?: (localAppId: string, reason?: 'user' | 'last-consumer' | 'app-quit') => Promise<LocalAppRuntimeSnapshot | null>
  releaseLocalAppRuntime?: (localAppId: string, consumerId: string) => Promise<LocalAppRuntimeSnapshot | null>
  restartLocalAppRuntime?: (localAppId: string) => Promise<LocalAppRuntimeSnapshot>
  buildLocalAppRuntime?: (localAppId: string) => Promise<RuntimeBuildResult>
  cancelLocalAppRuntimeBuild?: (localAppId: string, buildId?: string) => Promise<LocalAppRuntimeSnapshot | null>
  createLocalAppPreview?: (tabId: string, localAppId: string) => Promise<LocalAppPreviewResult>
  setLocalAppPreviewBounds?: (previewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  setLocalAppPreviewVisible?: (previewId: string, visible: boolean) => Promise<boolean>
  reloadLocalAppPreview?: (previewId: string) => Promise<boolean>
  closeLocalAppPreview?: (previewId: string) => Promise<boolean>
  onLocalAppRuntimeEvent?: (handler: (event: LocalAppRuntimeEvent) => void) => () => void
  inspectRuntimeDirectory?: (rootPath: string) => Promise<RuntimeInspectResult>
  trustRuntimeDirectory?: (rootPath: string) => Promise<RuntimeDefinitionResult>
  createWorkspaceTab?: (rootPath: string, expectedRevision?: number, title?: string) => Promise<RuntimeCreationResult>
  openWorkspaceTab?: (runtimeDefinitionId: string, expectedRevision?: number) => Promise<WorkspaceTabResult>
  closeWorkspaceTab?: (tabId: string, expectedRevision?: number) => Promise<WorkspaceTabCloseResult>
  renameWorkspaceTab?: (tabId: string, title: string, expectedRevision?: number) => Promise<WorkspaceTabResult>
  relocateRuntime?: (runtimeDefinitionId: string, rootPath: string, expectedRevision?: number) => Promise<LocalAppRelocationResult>
  revokeRuntimeTrust?: (canonicalRoot: string) => Promise<void>
  getRuntime?: (runtimeDefinitionId: string) => Promise<RuntimeSnapshot | null>
  startRuntime?: (runtimeDefinitionId: string, cause?: 'user' | 'restore', consumerId?: string) => Promise<RuntimeSnapshot>
  stopRuntime?: (runtimeDefinitionId: string, reason?: 'user' | 'last-consumer' | 'app-quit') => Promise<RuntimeSnapshot | null>
  releaseRuntime?: (runtimeDefinitionId: string, consumerId: string) => Promise<RuntimeSnapshot | null>
  restartRuntime?: (runtimeDefinitionId: string) => Promise<RuntimeSnapshot>
  /** Bring the viewed page up to date with its source; `force` retries even when unchanged. */
  updateRuntime?: (runtimeDefinitionId: string, options?: { force?: boolean }) => Promise<RuntimeSnapshot | null>
  /** Explicit user action; Main derives the fixed npm run build command. */
  buildRuntime?: (runtimeDefinitionId: string) => Promise<RuntimeBuildResult>
  cancelRuntimeBuild?: (runtimeDefinitionId: string, buildId?: string) => Promise<RuntimeSnapshot | null>
  /** Explicit opt-in development mode for static definitions. */
  setRuntimeServeOverride?: (
    runtimeDefinitionId: string,
    serveOverride: RuntimeServeOverride | null,
  ) => Promise<RuntimeSnapshot | null>
  startRuntimeDevelopment?: (runtimeDefinitionId: string, consumerId?: string) => Promise<RuntimeSnapshot>
  openRuntimeDevelopment?: (target: RuntimeDevelopmentTarget) => Promise<OpenRuntimeDevelopmentResult>
  focusRuntimeDevelopmentConflict?: (conflictToken: string) => Promise<RuntimeDevelopmentResult<void>>
  endRuntimeDevelopment?: (target: RuntimeDevelopmentTarget) => Promise<RuntimeDevelopmentResult<void>>
  openRuntimeDevelopmentThread?: (threadId: string) => Promise<RuntimeDevelopmentResult<void>>
  createRuntimePreview?: (host: RuntimePreviewHost) => Promise<RuntimePreviewResult>
  getRuntimePreviewLayout?: (projectId: string) => Promise<RuntimePreviewLayout>
  saveRuntimePreviewLayout?: (projectId: string, size: RuntimePreviewLayoutSize) => Promise<RuntimePreviewLayout>
  resetRuntimePreviewLayout?: (projectId: string) => Promise<RuntimePreviewLayout>
  getRuntimePreviewNavigationState?: (previewId: string) => Promise<RuntimePreviewNavigationState | null>
  setRuntimePreviewBounds?: (previewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  setRuntimePreviewVisible?: (previewId: string, visible: boolean) => Promise<boolean>
  navigateRuntimePreview?: (previewId: string, direction: 'back' | 'forward') => Promise<boolean>
  reloadRuntimePreview?: (previewId: string) => Promise<boolean>
  closeRuntimePreview?: (previewId: string) => Promise<boolean>
  onRuntimePreviewNavigationState?: (handler: (state: RuntimePreviewNavigationState) => void) => () => void
  onRuntimeEvent?: (handler: (event: RuntimeEvent) => void) => () => void
  onRuntimeDevelopmentEvent?: (handler: (event: RuntimeDevelopmentMainEvent) => void) => () => void
  ensureProjectRuntime?: (projectId: string, mountId: string) => Promise<ProjectRuntimeResult>
  trustProjectRuntime?: (projectId: string, mountId: string) => Promise<ProjectRuntimeResult>
  clearChatWorkspaceData?: () => Promise<void>
  clearClaudeAgentSettings?: () => Promise<void>
  quitApp?: () => Promise<void>
  showItemInFolder?: (targetPath: string) => Promise<void>
  openPath?: (targetPath: string) => Promise<void>
  openExternal?: (url: string) => Promise<void>
  copyPngToClipboard?: (dataUrl: string) => Promise<boolean>
  copySvgToClipboard?: (svg: string) => Promise<boolean>
  getSpeechRecognitionStatus?: () => Promise<SpeechRecognitionSnapshot>
  startSpeechRecognition?: (options?: {
    locale?: string
    requiresOnDevice?: boolean
  }) => Promise<SpeechRecognitionCommandResult>
  stopSpeechRecognition?: () => Promise<SpeechRecognitionCommandResult>
  cancelSpeechRecognition?: () => Promise<SpeechRecognitionCommandResult>
  onSpeechRecognitionEvent?: (handler: (event: SpeechRecognitionEvent) => void) => () => void
  getDesktopPreferences?: () => Promise<DesktopPreferences>
  setDesktopPreferences?: (partial: Partial<DesktopPreferences>) => Promise<DesktopPreferences>
  syncTrayLocale?: (locale: AppUiLocale) => Promise<void>
  onTrayMenuAction?: (handler: (action: TrayMenuAction) => void) => () => void
  onHomePluginTaskEvent?: (handler: (event: HomePluginTaskEvent) => void) => () => void
  getAppVersion?: () => Promise<string>
  getAppUpdaterState?: () => Promise<AppUpdaterState>
  checkForAppUpdates?: () => Promise<AppUpdaterState>
  downloadAppUpdate?: () => Promise<AppUpdaterState>
  quitAndInstallAppUpdate?: () => Promise<void>
  onAppUpdaterState?: (handler: (state: AppUpdaterState) => void) => () => void
}
