import type {
  ChatModelPick,
  ClaudeAskUserQuestion,
  ClaudeChatEvent,
  ClaudeAgentStatusContextUsage,
  ClaudeContextCompactionStatus,
  ClaudeContextCompactionTrigger,
  ClaudeFileChangeSetStatus,
  ClaudeFileDiffFileStatus,
  ClaudeFileDiffHunk,
  ClaudePermissionMode,
  ClaudePermissionResponsePayload,
} from './claude-chat-types'
export type { ProjectThreadCreationSource } from './components/types'
export type { ChatThreadBase } from './components/types'
export type {
  RuntimeDevelopmentThread,
  RuntimeDevelopmentWorkspace,
  RuntimeScopeId,
} from './runtime-development-contract'

export type ProjectChatErrorCode =
  | 'invalid-argument'
  | 'sender-not-authorized'
  | 'project-not-found'
  | 'project-path-missing'
  | 'thread-not-found'
  | 'thread-busy'
  | 'stale-revision'
  | 'request-not-found'
  | 'prompt-not-owned'
  | 'binding-not-found'
  | 'binding-revoked'
  | 'binding-conflict'
  | 'credential-rejected'
  | 'ticket-invalid'
  | 'ticket-expired'
  | 'ticket-consumed'
  | 'ticket-fetch-failed'
  | 'idempotency-conflict'
  | 'invalid-deep-link'
  | 'unsupported-version'
  | 'receipt-failed'
  | 'credential-storage-unavailable'
  | 'sdk-submit-failed'
  | 'runtime-scope-unavailable'
  | 'runtime-scope-stale'
  | 'runtime-root-invalid'
  | 'internal-error'

export type ProjectChatError = { code: ProjectChatErrorCode; message: string; retryable: boolean }
export type ProjectChatResult<T> = { ok: true; value: T } | { ok: false; error: ProjectChatError }

export function projectChatError(
  code: ProjectChatErrorCode,
  message: string,
  retryable = false,
): ProjectChatError {
  return { code, message, retryable }
}

/** Cross-platform renderer-safe project-relative path normalization. */
export function normalizeProjectChatRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.includes('\0')) return null
  const path = raw.trim().replaceAll('\\', '/')
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null
  const segments = path.split('/')
  if (segments.some((segment) => segment === '..')) return null
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/')
  return normalized || null
}

/** Attachment display names never preserve a directory component. */
export function projectChatBasename(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.includes('\0')) return null
  const name = raw.replaceAll('\\', '/').split('/').at(-1)?.trim()
  return name && name !== '.' && name !== '..' ? name : null
}

export type ProjectChatRunPhase =
  | 'submitting'
  | 'running'
  | 'waiting_permission'
  | 'waiting_answer'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type ProjectChatRunSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  phase: ProjectChatRunPhase
  routeGeneration: number
  startedAt: number
  finishedAt?: number
  error?: ProjectChatError
  finalResult?: string
}

export type ProjectChatPromptPayload =
  | {
      kind: 'permission'
      permissionRequestId: string
      toolUseId: string
      toolName: string
      title: string
      displayName: string
      description: string
      inputPreview: string
    }
  | {
      kind: 'question'
      permissionRequestId: string
      toolUseId: string
      questions: ClaudeAskUserQuestion[]
    }

export type ProjectChatPromptSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  kind: ProjectChatPromptPayload['kind']
  createdAt: number
  payload: ProjectChatPromptPayload
  /** Recipient-specific Main projection; renderer never receives an owner identity. */
  isOwnedByCaller: boolean
}

/** Main-only prompt record. Never send this type through preload or IPC. */
export type ProjectChatOwnedPromptSnapshot = Omit<ProjectChatPromptSnapshot, 'isOwnedByCaller'> & {
  ownerWebContentsId?: number
}

export type ProjectChatProjectSnapshot = {
  id: string
  name: string
  pathMissing: boolean
}

/** Main-memory edit aggregation only; it contains no filesystem or Runtime details. */
export type ProjectChatRuntimeEditSnapshot = {
  projectId: string
  editGeneration: number
  potentialRunCount: number
  activeAgentLeaseCount: number
  successfulMutationCount: number
  failedOrCancelledAfterMutation: boolean
  manualLeaseCount: number
  manualStopFence: boolean
  settleOperationId?: string
  buildOperationId?: string
}

export type ProjectChatMessageAttachment = {
  id: string
  kind: 'text' | 'image'
  name: string
  mimeType: string
  size: number
  preview?: string
  dataUrl?: string
}
export type ProjectChatTaskItem = {
  id: string
  toolUseId?: string
  subject: string
  description?: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  createdAt: number
  updatedAt: number
  order: number
}
export type ProjectChatTaskState = { updatedAt: number; items: ProjectChatTaskItem[] }
export type ProjectChatFileDiffFile = {
  relativePath: string
  status: ClaudeFileDiffFileStatus
  additions: number
  deletions: number
  hunks: ClaudeFileDiffHunk[]
  truncated?: boolean
}
export type ProjectChatTranscriptItem =
  | { type: 'message'; id: string; role: 'user' | 'assistant'; content: string; status: 'done' | 'streaming' | 'error' | 'cancelled'; createdAt?: number; startedAt?: number; completedAt?: number; durationMs?: number; attachments?: ProjectChatMessageAttachment[] }
  | { type: 'tool'; id: string; toolUseId: string; name: string; inputPreview: string; status: 'running' | 'done' | 'error' | 'denied'; detail?: string }
  | { type: 'thinking'; id: string; thinkingId: string; title: string; content: string; status: 'running' | 'done' }
  | { type: 'activity'; id: string; title: string; status: 'running' | 'done' | 'error' | 'info'; detail?: string; preview?: string }
  | { type: 'context_compaction'; id: string; status: ClaudeContextCompactionStatus; trigger: ClaudeContextCompactionTrigger; preTokens?: number; postTokens?: number; durationMs?: number; preservedMessageCount?: number; summary?: string; error?: string; createdAt?: number; updatedAt?: number }
  | { type: 'file_diff'; id: string; changeSetId: string; files: ProjectChatFileDiffFile[]; status: ClaudeFileChangeSetStatus; detail?: string }
export type ProjectChatThreadSnapshot = {
  id: string
  projectId: string
  title: string
  purpose?: 'home-plugin-customization' | 'home-plugin-card-customization' | 'task-run' | 'skill-run'
  homePluginSlug?: string
  skillCommand?: string
  skillTitle?: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
  archivedAt?: number
  chatState: { model: string; modelPick?: ChatModelPick; tasks?: ProjectChatTaskState; items: ProjectChatTranscriptItem[] }
}

export type ProjectChatSnapshot = {
  projectId: string
  project: ProjectChatProjectSnapshot
  workspaceRevision: number
  sequence: number
  routeGeneration: number
  threads: ProjectChatThreadSnapshot[]
  runs: ProjectChatRunSnapshot[]
  pendingPrompts: ProjectChatPromptSnapshot[]
  permissionMode: ClaudePermissionMode
  unreadExternalTaskCount: number
  latestUnreadExternalThreadId?: string
  runtimeEdit?: ProjectChatRuntimeEditSnapshot
}

/** Main-only snapshot before recipient-specific ownership projection. */
export type ProjectChatInternalSnapshot = Omit<ProjectChatSnapshot, 'pendingPrompts'> & {
  pendingPrompts: ProjectChatOwnedPromptSnapshot[]
}

export type ProjectChatEvent = {
  type: 'snapshot'
  projectId: string
  sequence: number
  routeGeneration: number
  workspaceRevision: number
  snapshot: ProjectChatSnapshot
}
export type ProjectChatPreviewNavigationEvent = { type: 'open-project-preview'; projectId: string }
export type ProjectChatPathRecoveryEvent = { type: 'open-project-path-recovery'; projectId: string }
export type ProjectChatSelectThreadEvent = { type: 'select-thread'; projectId: string; threadId: string }
export type AgentOSPairingPrompt = { pairingId: string; displayName: string; origin: string; expiresAt: number }
export type AgentOSPairingResponse = { pairingId: string; action: 'accept'; projectId: string } | { pairingId: string; action: 'reject' }
export type ProjectChatPairingEvent = { type: 'agentos-pairing'; pairing: AgentOSPairingPrompt | null }
export type ProjectChatClientEvent = ProjectChatEvent | ProjectChatPreviewNavigationEvent | ProjectChatPathRecoveryEvent | ProjectChatSelectThreadEvent | ProjectChatPairingEvent

/** Main-only event. The IPC broadcaster must project it per recipient first. */
export type ProjectChatInternalEvent = Omit<ProjectChatEvent, 'snapshot'> & {
  snapshot: ProjectChatInternalSnapshot
}

export type CreateProjectThreadInput =
  | { projectId: string; title: string; source: 'user' | 'app-command' }
  | { projectId: string; title: string; source: 'website'; idempotencyKey: string; bindingId: string; receivedAt: number }
export type CreateProjectThreadResult = { threadId: string; workspaceRevision: number }
export type SubmitProjectRunInput = {
  projectId: string
  threadId: string
  text: string
  attachments?: ProjectChatAttachment[]
  modelPick?: ChatModelPick
  handoffContext?: string
}
export type SubmitProjectRunResult = { requestId: string }
export type StartProjectRuntimeChatResult = { threadId: string; requestId: string }
export type ForkProjectThreadInput = { projectId: string; threadId: string; messageId: string; routeGeneration: number }
export type EditAndSubmitProjectRunInput = { projectId: string; threadId: string; messageId: string; text: string; modelPick?: ChatModelPick; routeGeneration: number }
export type ArchiveProjectThreadInput = { projectId: string; threadId: string; routeGeneration: number }
export type SetProjectThreadPinnedInput = { projectId: string; threadId: string; pinned: boolean; routeGeneration: number }
export type SetProjectThreadModelInput = { projectId: string; threadId: string; modelPick: ChatModelPick; routeGeneration: number }
export type MarkProjectFileDiffReviewedInput = { projectId: string; threadId: string; changeSetId: string; routeGeneration: number }
export type RewindProjectFileDiffInput = { projectId: string; threadId: string; changeSetId: string; routeGeneration: number }
export type RewindProjectFileDiffResult = { changeSetId: string; status: 'reverted' | 'error'; detail?: string }
export type CancelProjectRunInput = {
  projectId: string
  threadId: string
  requestId: string
  routeGeneration: number
}
export type AnswerProjectPromptInput = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  routeGeneration: number
  response: ClaudePermissionResponsePayload
}
export type ReportProjectChatPresenceInput = { projectId: string; selectedThreadId?: string }
export type ProjectChatWindowViewState = {
  schemaVersion: 1
  projectId: string
  selectedThreadId?: string
  draft: string
  externalTaskSeenAt: number
  bounds?: { x?: number; y?: number; width: number; height: number }
  updatedAt: number
}
export type SaveProjectChatWindowViewStateInput = {
  projectId: string
  patch: Partial<Pick<ProjectChatWindowViewState, 'selectedThreadId' | 'draft' | 'externalTaskSeenAt' | 'bounds'>>
}
export type WebsiteBindingRecord = {
  schemaVersion: 1
  bindingId: string
  origin: string
  displayName: string
  projectId: string
  credentialCiphertext: string
  status: 'active' | 'revoked'
  createdAt: number
  revokedAt?: number
}
export type WebsiteBindingPublic = Omit<WebsiteBindingRecord, 'credentialCiphertext'>

export type ProjectChatModelProvider = {
  id: string
  name: string
  model: string
  modelSupportsImages: boolean
  defaultHaikuModel: string
  defaultHaikuSupportsImages: boolean
  defaultOpusModel: string
  defaultOpusSupportsImages: boolean
  defaultSonnetModel: string
  defaultSonnetSupportsImages: boolean
}
export type ProjectChatModelCatalog = {
  activeProviderId: string
  activeAnthropicModel: string
  providers: ProjectChatModelProvider[]
}
export type ProjectChatAgentContext = {
  skills: Array<{
    kind: 'skill' | 'command'
    name: string
    command: string
    title: string
    description: string
    argumentHint: string
    relativePath: string
    scope: 'user' | 'project'
    source: 'claude' | 'agent' | 'agents' | 'cursor'
    native: boolean
  }>
  agents: Array<{
    kind: 'agent'
    name: string
    description: string
    relativePath: string
    scope: 'user' | 'project'
    source: 'claude' | 'agent' | 'agents' | 'cursor'
    native: boolean
    model?: string
    tools: string[]
  }>
}
export type SearchProjectChatFilesInput = { projectId: string; query: string }
export type ProjectChatFileSearchItem = { label: string; relativePath: string; type: 'directory' | 'file' }
export type ProjectChatAttachment = {
  id: string
  kind: 'text' | 'image'
  name: string
  mimeType: string
  size: number
  text?: string
  base64?: string
  preview?: string
  dataUrl?: string
}
export type ProjectChatAttachmentSelection = {
  attachments: ProjectChatAttachment[]
  skipped: Array<{ name: string; reason: string }>
}
export type ReadProjectChatAttachmentsInput = {
  projectId: string
  relativePaths: string[]
  allowImages?: boolean
}
export type GetProjectChatThreadStatusInput = { projectId: string; threadId: string }
export type ProjectChatThreadStatus = {
  threadId: string
  active: boolean
  requestId?: string
  reportedModel: string
  permissionMode: string
  tools: string[]
  skills: string[]
  slashCommands: string[]
  agents: string[]
  contextUsage?: ClaudeAgentStatusContextUsage
  lastError?: string
  updatedAt?: number
}

export type ProjectChatAPI = {
  getSnapshot(projectId: string): Promise<ProjectChatResult<ProjectChatSnapshot>>
  createThread(input: CreateProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  submitRun(input: SubmitProjectRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>>
  forkThread(input: ForkProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  editAndSubmitRun(input: EditAndSubmitProjectRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>>
  archiveThread(input: ArchiveProjectThreadInput): Promise<ProjectChatResult<void>>
  setThreadPinned(input: SetProjectThreadPinnedInput): Promise<ProjectChatResult<void>>
  setThreadModel(input: SetProjectThreadModelInput): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(input: MarkProjectFileDiffReviewedInput): Promise<ProjectChatResult<void>>
  rewindFileDiff(input: RewindProjectFileDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>>
  cancelRun(input: CancelProjectRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(input: AnswerProjectPromptInput): Promise<ProjectChatResult<void>>
  reportPresenceSelection(input: ReportProjectChatPresenceInput): Promise<ProjectChatResult<void>>
  openProjectWindow(projectId: string): Promise<ProjectChatResult<void>>
  /** Main-only orchestration: opens the dedicated project Chat and submits a Runtime-scoped run. */
  startProjectRuntimeChat(projectId: string): Promise<ProjectChatResult<StartProjectRuntimeChatResult>>
  /** Main resolves the durable WorkspaceTab backing Project; renderer sends only this opaque id. */
  openWorkspaceTabProjectChat(workspaceTabId: string): Promise<ProjectChatResult<void>>
  openProjectPreview(projectId: string): Promise<ProjectChatResult<void>>
  openProjectPathRecovery(projectId: string): Promise<ProjectChatResult<void>>
  getWindowViewState(projectId: string): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  saveWindowViewState(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  markExternalTasksSeen(projectId: string, seenAt: number): Promise<ProjectChatResult<void>>
  listWebsiteBindings(): Promise<ProjectChatResult<WebsiteBindingPublic[]>>
  revokeWebsiteBinding(bindingId: string): Promise<ProjectChatResult<void>>
  respondToWebsitePairing(input: AgentOSPairingResponse): Promise<ProjectChatResult<void>>
  initializePermissionMode(legacyMode?: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  setPermissionMode(mode: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  getModelCatalog(): Promise<ProjectChatResult<ProjectChatModelCatalog>>
  getAgentContext(projectId: string): Promise<ProjectChatResult<ProjectChatAgentContext>>
  searchProjectFiles(input: SearchProjectChatFilesInput): Promise<ProjectChatResult<ProjectChatFileSearchItem[]>>
  pickAttachments(options?: { allowImages?: boolean }): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  readProjectAttachments(input: ReadProjectChatAttachmentsInput): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  getThreadStatus(input: GetProjectChatThreadStatusInput): Promise<ProjectChatResult<ProjectChatThreadStatus>>
  onEvent(handler: (event: ProjectChatClientEvent) => void): () => void
}

export interface ClaudeChatEventSink { publish(event: ClaudeChatEvent): void }

type IsExactly<Actual, Expected> =
  (<Type>() => Type extends Actual ? 1 : 2) extends
  (<Type>() => Type extends Expected ? 1 : 2)
    ? (<Type>() => Type extends Expected ? 1 : 2) extends (<Type>() => Type extends Actual ? 1 : 2)
      ? true
      : false
    : false
type Assert<Type extends true> = Type

/** Compile-time DTO fixture: changing a frozen field fails `npm run typecheck`. */
export type ProjectChatContractTypeFixtures = [
  Assert<IsExactly<ProjectChatPromptPayload, {
    kind: 'permission'
    permissionRequestId: string
    toolUseId: string
    toolName: string
    title: string
    displayName: string
    description: string
    inputPreview: string
  } | {
    kind: 'question'
    permissionRequestId: string
    toolUseId: string
    questions: ClaudeAskUserQuestion[]
  }>>,
  Assert<IsExactly<CancelProjectRunInput, { projectId: string; threadId: string; requestId: string; routeGeneration: number }>>,
  Assert<IsExactly<RewindProjectFileDiffInput, { projectId: string; threadId: string; changeSetId: string; routeGeneration: number }>>,
  Assert<IsExactly<RewindProjectFileDiffResult, { changeSetId: string; status: 'reverted' | 'error'; detail?: string }>>,
  Assert<IsExactly<ReportProjectChatPresenceInput, { projectId: string; selectedThreadId?: string }>>,
  Assert<IsExactly<AnswerProjectPromptInput, { projectId: string; threadId: string; requestId: string; promptId: string; routeGeneration: number; response: ClaudePermissionResponsePayload }>>,
  Assert<IsExactly<CreateProjectThreadInput,
    | { projectId: string; title: string; source: 'user' | 'app-command' }
    | { projectId: string; title: string; source: 'website'; idempotencyKey: string; bindingId: string; receivedAt: number }
  >>,
  Assert<IsExactly<ProjectChatProjectSnapshot, { id: string; name: string; pathMissing: boolean }>>,
  Assert<IsExactly<ProjectChatWindowViewState, { schemaVersion: 1; projectId: string; selectedThreadId?: string; draft: string; externalTaskSeenAt: number; bounds?: { x?: number; y?: number; width: number; height: number }; updatedAt: number }>>,
  Assert<IsExactly<SaveProjectChatWindowViewStateInput, { projectId: string; patch: Partial<Pick<ProjectChatWindowViewState, 'selectedThreadId' | 'draft' | 'externalTaskSeenAt' | 'bounds'>> }>>,
  Assert<IsExactly<WebsiteBindingPublic, { schemaVersion: 1; bindingId: string; origin: string; displayName: string; projectId: string; status: 'active' | 'revoked'; createdAt: number; revokedAt?: number }>>,
  Assert<IsExactly<ProjectChatAttachment, { id: string; kind: 'text' | 'image'; name: string; mimeType: string; size: number; text?: string; base64?: string; preview?: string; dataUrl?: string }>>,
  Assert<IsExactly<ReadProjectChatAttachmentsInput, { projectId: string; relativePaths: string[]; allowImages?: boolean }>>,
  Assert<IsExactly<GetProjectChatThreadStatusInput, { projectId: string; threadId: string }>>,
]
