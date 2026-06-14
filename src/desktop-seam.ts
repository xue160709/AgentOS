/**
 * Desktop Seam contract: the named renderer capabilities and their IPC channels.
 */

import type { DesktopAPI } from './desktop-api'

type DesktopStaticCapability = Extract<keyof DesktopAPI, 'platform' | 'isDevRuntime' | 'windowEffects'>
type DesktopCallableCapability = Exclude<keyof DesktopAPI, DesktopStaticCapability>
type DesktopEventCapability = Extract<DesktopCallableCapability, `on${string}`>
type DesktopInvokeCapability = Exclude<DesktopCallableCapability, DesktopEventCapability>

export const DESKTOP_STATIC_CAPABILITIES = [
  'platform',
  'isDevRuntime',
  'windowEffects',
] as const satisfies readonly DesktopStaticCapability[]

export const DESKTOP_INVOKE_CHANNELS = {
  pickProjectDirectory: 'desktop:pick-project-directory',
  pickChatAttachments: 'desktop:pick-chat-attachments',
  readChatAttachments: 'desktop:read-chat-attachments',
  listProjectFiles: 'desktop:list-project-files',
  watchProjectFiles: 'desktop:watch-project-files',
  unwatchProjectFiles: 'desktop:unwatch-project-files',
  readProjectFile: 'desktop:read-project-file',
  searchProjectFiles: 'desktop:search-project-files',
  searchChatHistory: 'desktop:search-chat-history',
  searchAgentKnowledge: 'desktop:search-agent-knowledge',
  listAgentContext: 'desktop:list-agent-context',
  validateProjectPaths: 'desktop:validate-project-paths',
  pathExistsUnderProject: 'desktop:path-exists-under-project',
  runHomePlugin: 'desktop:run-home-plugin',
  saveHomePluginOrder: 'desktop:save-home-plugin-order',
  saveHomePluginLayout: 'desktop:save-home-plugin-layout',
  deleteHomePlugin: 'desktop:delete-home-plugin',
  saveTaskHomePlugin: 'desktop:save-task-home-plugin',
  getTaskHomePlugin: 'desktop:get-task-home-plugin',
  runTaskHomePlugin: 'desktop:run-task-home-plugin',
  stopTaskHomePlugin: 'desktop:stop-task-home-plugin',
  getAgentModeStatus: 'desktop:get-agent-mode-status',
  ensureAgentModeFiles: 'desktop:ensure-agent-mode-files',
  setAgentModeState: 'desktop:set-agent-mode-state',
  getAgentModeSettings: 'desktop:get-agent-mode-settings',
  saveAgentModeSettings: 'desktop:save-agent-mode-settings',
  readAgentProjectDocuments: 'desktop:read-agent-project-documents',
  saveAgentProjectDocuments: 'desktop:save-agent-project-documents',
  listProjectContext: 'desktop:list-project-context',
  saveProjectContextInstructions: 'desktop:save-project-context-instructions',
  addProjectContextEntries: 'desktop:add-project-context-entries',
  removeProjectContextEntry: 'desktop:remove-project-context-entry',
  getChatWorkspace: 'chat-workspace:get',
  saveChatWorkspace: 'chat-workspace:save',
  clearChatWorkspaceData: 'desktop:clear-chat-workspace-data',
  clearClaudeAgentSettings: 'desktop:clear-claude-agent-settings-data',
  quitApp: 'desktop:quit',
  showItemInFolder: 'desktop:show-item-in-folder',
  openPath: 'desktop:open-path',
  openExternal: 'desktop:open-external',
  copyPngToClipboard: 'desktop:copy-png-to-clipboard',
  copySvgToClipboard: 'desktop:copy-svg-to-clipboard',
  getSpeechRecognitionStatus: 'desktop:speech-recognition:get-status',
  startSpeechRecognition: 'desktop:speech-recognition:start',
  stopSpeechRecognition: 'desktop:speech-recognition:stop',
  cancelSpeechRecognition: 'desktop:speech-recognition:cancel',
  getDesktopPreferences: 'desktop-preferences:get',
  setDesktopPreferences: 'desktop-preferences:set',
  syncTrayLocale: 'desktop:sync-tray-locale',
  getAppVersion: 'app-updater:get-state',
  getAppUpdaterState: 'app-updater:get-state',
  checkForAppUpdates: 'app-updater:check',
  downloadAppUpdate: 'app-updater:download',
  quitAndInstallAppUpdate: 'app-updater:quit-and-install',
} as const satisfies Record<DesktopInvokeCapability, string>

export const DESKTOP_EVENT_CHANNELS = {
  onProjectFilesChanged: 'desktop:project-files-changed',
  onSpeechRecognitionEvent: 'desktop:speech-recognition-event',
  onTrayMenuAction: 'desktop:tray-action',
  onHomePluginTaskEvent: 'desktop:task-home-plugin-event',
  onAppUpdaterState: 'app-updater:event',
} as const satisfies Record<DesktopEventCapability, string>

export const DESKTOP_SEAM_CAPABILITIES = [
  ...DESKTOP_STATIC_CAPABILITIES,
  ...Object.keys(DESKTOP_INVOKE_CHANNELS),
  ...Object.keys(DESKTOP_EVENT_CHANNELS),
] as const
