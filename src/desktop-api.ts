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
import type { ChatWorkspaceState, FileTreeResult, ProjectFilePreviewResult } from './components/types'
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
  OmniIntentResolveResult,
  SpeechRecognitionCommandResult,
  SpeechRecognitionConsumer,
  SpeechRecognitionEvent,
  SpeechRecognitionSnapshot,
  SystemOpenAppResult,
  TrayMenuAction,
  VoiceCommandExecutionResult,
  VoiceCommandResponseRequest,
  VoiceCommandRequestEvent,
  VoiceCommandSubmitRequest,
  VoiceCommandSubmitResult,
} from './desktop-types'

export type DesktopAPI = {
  platform: NodeJS.Platform
  isDevRuntime?: boolean
  windowEffects?: {
    macVibrancy: boolean
    windowsAcrylic: boolean
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
  clearChatWorkspaceData?: () => Promise<void>
  clearClaudeAgentSettings?: () => Promise<void>
  quitApp?: () => Promise<void>
  showItemInFolder?: (targetPath: string) => Promise<void>
  openPath?: (targetPath: string) => Promise<void>
  openExternal?: (url: string) => Promise<void>
  resolveOmniIntent?: (payload: { utterance: string; prompt: string }) => Promise<OmniIntentResolveResult>
  openApp?: (appName: string) => Promise<SystemOpenAppResult>
  copyPngToClipboard?: (dataUrl: string) => Promise<boolean>
  copySvgToClipboard?: (svg: string) => Promise<boolean>
  getSpeechRecognitionStatus?: () => Promise<SpeechRecognitionSnapshot>
  startSpeechRecognition?: (options?: {
    locale?: string
    requiresOnDevice?: boolean
    consumer?: SpeechRecognitionConsumer
  }) => Promise<SpeechRecognitionCommandResult>
  stopSpeechRecognition?: () => Promise<SpeechRecognitionCommandResult>
  cancelSpeechRecognition?: () => Promise<SpeechRecognitionCommandResult>
  onSpeechRecognitionEvent?: (handler: (event: SpeechRecognitionEvent) => void) => () => void
  submitVoiceCommand?: (request: VoiceCommandSubmitRequest | string) => Promise<VoiceCommandSubmitResult>
  respondVoiceCommand?: (response: VoiceCommandResponseRequest) => Promise<VoiceCommandSubmitResult>
  sendVoiceCommandResult?: (result: VoiceCommandExecutionResult) => Promise<void>
  onVoiceCommandRequest?: (handler: (event: VoiceCommandRequestEvent) => void) => () => void
  onVoiceCommandResponse?: (handler: (event: VoiceCommandResponseRequest) => void) => () => void
  onVoiceCommandResult?: (handler: (event: VoiceCommandExecutionResult) => void) => () => void
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
