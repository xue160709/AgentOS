/** Named IPC channels for the disabled Project Chat bridge seam. */

import type { ProjectChatAPI } from './project-chat-contract'

type ProjectChatInvokeCapability = Exclude<keyof ProjectChatAPI, 'onEvent'>
type ProjectChatEventCapability = Extract<keyof ProjectChatAPI, 'onEvent'>

export const PROJECT_CHAT_INVOKE_CHANNELS = {
  getSnapshot: 'project-chat:get-snapshot',
  createThread: 'project-chat:create-thread',
  submitRun: 'project-chat:submit-run',
  forkThread: 'project-chat:fork-thread',
  editAndSubmitRun: 'project-chat:edit-and-submit-run',
  archiveThread: 'project-chat:archive-thread',
  setThreadPinned: 'project-chat:set-thread-pinned',
  setThreadModel: 'project-chat:set-thread-model',
  markFileDiffReviewed: 'project-chat:mark-file-diff-reviewed',
  rewindFileDiff: 'project-chat:rewind-file-diff',
  cancelRun: 'project-chat:cancel-run',
  answerPrompt: 'project-chat:answer-prompt',
  reportPresenceSelection: 'project-chat:report-presence-selection',
  openProjectWindow: 'project-chat:open-project-window',
  startProjectRuntimeChat: 'project-chat:start-project-runtime-chat',
  openWorkspaceTabProjectChat: 'project-chat:open-workspace-tab-project-chat',
  openProjectPreview: 'project-chat:open-project-preview',
  openProjectPathRecovery: 'project-chat:open-project-path-recovery',
  getWindowViewState: 'project-chat:get-window-view-state',
  saveWindowViewState: 'project-chat:save-window-view-state',
  markExternalTasksSeen: 'project-chat:mark-external-tasks-seen',
  listWebsiteBindings: 'project-chat:list-website-bindings',
  revokeWebsiteBinding: 'project-chat:revoke-website-binding',
  respondToWebsitePairing: 'project-chat:respond-website-pairing',
  initializePermissionMode: 'project-chat:initialize-permission-mode',
  setPermissionMode: 'project-chat:set-permission-mode',
  getModelCatalog: 'project-chat:get-model-catalog',
  getAgentContext: 'project-chat:get-agent-context',
  searchProjectFiles: 'project-chat:search-project-files',
  pickAttachments: 'project-chat:pick-attachments',
  readProjectAttachments: 'project-chat:read-project-attachments',
  getThreadStatus: 'project-chat:get-thread-status',
} as const satisfies Record<ProjectChatInvokeCapability, string>

export const PROJECT_CHAT_EVENT_CHANNELS = {
  onEvent: 'project-chat:event',
} as const satisfies Record<ProjectChatEventCapability, string>
