import type {
  ChatThreadBase,
  ProjectThreadCreationSource,
  RuntimeOwner,
} from './components/types'
import type { ChatModelPick, ClaudePermissionMode, ClaudePermissionResponsePayload } from './claude-chat-types'
import type {
  ProjectChatAgentContext,
  ProjectChatAttachment,
  ProjectChatAttachmentSelection,
  ProjectChatFileSearchItem,
  ProjectChatModelCatalog,
  ProjectChatPromptSnapshot,
  ProjectChatResult,
  ProjectChatThreadStatus,
  ProjectChatTranscriptItem,
  RewindProjectFileDiffResult,
} from './project-chat-contract'

export type ProjectRuntimeScopeId = `project:${string}`
export type WorkspaceRuntimeScopeId = `workspace:${string}`
export type RuntimeScopeId = ProjectRuntimeScopeId | WorkspaceRuntimeScopeId
export type RuntimeScopeKind = 'project' | 'workspace'

export type RuntimeDevelopmentPhase =
  | 'opening'
  | 'live'
  | 'exit_requested'
  | 'needs_attention'
  | 'saving'
  | 'closed'
  | 'preview_update_failed'

export type RuntimeDevelopmentErrorCode =
  | 'runtime-development-conflict'
  | 'runtime-development-busy'
  | 'runtime-scope-stale'
  | 'runtime-root-missing'
  | 'runtime-trust-required'
  | 'runtime-live-preview-unavailable'
  | 'runtime-save-unavailable'
  | 'runtime-save-timeout'
  | 'runtime-build-failed'

export type RuntimeDevelopmentSaveCapability = 'static' | 'development-only' | 'unavailable'

export type RuntimeDevelopmentSnapshot = {
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  routeGeneration: number
  developmentGeneration: number
  phase: RuntimeDevelopmentPhase
  activeRunCount: number
  activeAgentLeaseCount: number
  waitingPromptCount: number
  hasChanges: boolean
  canSubmit: boolean
  canReopen: boolean
  canEnd: boolean
  exitRequested: boolean
  autoSaveAttempted: boolean
  userMessage?: string
  errorCode?: RuntimeDevelopmentErrorCode
}

/** Main-only fence carried through settle/build callbacks; never accepted from renderer payloads. */
export type RuntimeDevelopmentOperationFence = {
  runtimeScopeId: RuntimeScopeId
  routeGeneration: number
  developmentGeneration: number
  operationId: string
}

export type RuntimeRootLeaseKind = 'development' | 'build'
export type RuntimeRootLeaseState = 'active' | 'stopping' | 'stop_failed'

/** canonicalRoot 只用于 Main 侧排他执行；产品身份始终由 scope/definition 提供。 */
export type RuntimeRootLease = {
  leaseId: string
  canonicalRoot: string
  runtimeDefinitionId: string
  runtimeScopeId: RuntimeScopeId
  kind: RuntimeRootLeaseKind
  generation: number
  state: RuntimeRootLeaseState
  failureCode?: 'transition-stop-failed' | 'stop-failed'
}

export type RuntimeRootLeaseRequest = {
  canonicalRoot: string
  runtimeDefinitionId: string
  runtimeScopeId: RuntimeScopeId
  kind: RuntimeRootLeaseKind
  generation: number
}

export type RuntimeRootLeaseAcquireResult =
  | { ok: true; lease: RuntimeRootLease; reused: boolean }
  | {
      ok: false
      error: {
        code: 'runtime-development-conflict' | 'runtime-root-stopping' | 'runtime-root-stop-failed' | 'runtime-root-transition-required' | 'runtime-root-stale-generation'
        conflictingLease: RuntimeRootLease
      }
    }

export type RuntimeRootLeaseReleaseResult =
  | { ok: true; released: boolean; lease?: RuntimeRootLease }
  | { ok: false; error: { code: 'runtime-root-stop-failed'; lease: RuntimeRootLease; cause: unknown } }

export type ParsedRuntimeScopeId =
  | { kind: 'project'; projectId: string; runtimeScopeId: ProjectRuntimeScopeId }
  | { kind: 'workspace'; runtimeDefinitionId: string; runtimeScopeId: WorkspaceRuntimeScopeId }

export type RuntimeDevelopmentCreationSource = Extract<
  ProjectThreadCreationSource,
  { kind: 'user' | 'app-command' }>

export type RuntimeDevelopmentThread = Omit<ChatThreadBase, 'creationSource'> & {
  purpose: 'runtime-development'
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  runtimeOwner: RuntimeOwner
  creationSource: RuntimeDevelopmentCreationSource
}

/** Main fresh-read 的执行 authority；renderer 不能构造或覆盖路径与 generation。 */
export type ResolvedRuntimeChatScope = {
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  runtimeOwner: RuntimeOwner
  cwd: string
  runtimeRoot: string
  routeGeneration: number
  developmentGeneration: number
  /** Definition 删除后的 Main tombstone 仍可授权历史只读，但禁止 create/submit。 */
  available?: boolean
}

export type RuntimeChatThreadSnapshot = {
  id: string
  runtimeScopeId: RuntimeScopeId
  title: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
  archivedAt?: number
  chatState: { model: string; modelPick?: ChatModelPick; items: ProjectChatTranscriptItem[] }
}

export type RuntimeChatRunSnapshot = {
  runtimeScopeId: RuntimeScopeId
  threadId: string
  requestId: string
  phase: 'submitting' | 'running' | 'waiting_permission' | 'waiting_answer' | 'succeeded' | 'failed' | 'cancelled'
  routeGeneration: number
  developmentGeneration: number
  startedAt: number
  finishedAt?: number
  error?: { code: string; message: string; retryable: boolean }
}

export type RuntimeChatPromptSnapshot = Omit<ProjectChatPromptSnapshot, 'projectId'> & { runtimeScopeId: RuntimeScopeId }
export type RuntimeChatOwnedPromptSnapshot = Omit<RuntimeChatPromptSnapshot, 'isOwnedByCaller'> & { ownerWebContentsId?: number }

export type RuntimeChatSnapshot = {
  runtimeScopeId: RuntimeScopeId
  runtimeThreadRevision: number
  sequence: number
  routeGeneration: number
  developmentGeneration: number
  scopeAvailable: boolean
  threads: RuntimeChatThreadSnapshot[]
  runs: RuntimeChatRunSnapshot[]
  pendingPrompts: RuntimeChatPromptSnapshot[]
  permissionMode: ClaudePermissionMode
}

export type RuntimeChatInternalSnapshot = Omit<RuntimeChatSnapshot, 'pendingPrompts'> & { pendingPrompts: RuntimeChatOwnedPromptSnapshot[] }
export type RuntimeChatInternalEvent = { type: 'snapshot'; runtimeScopeId: RuntimeScopeId; sequence: number; routeGeneration: number; developmentGeneration: number; runtimeThreadRevision: number; snapshot: RuntimeChatInternalSnapshot }
export type RuntimeChatEvent =
  | (Omit<RuntimeChatInternalEvent, 'snapshot'> & { snapshot: RuntimeChatSnapshot })
  | { type: 'development'; runtimeScopeId: RuntimeScopeId; routeGeneration: number; developmentGeneration: number; snapshot: RuntimeDevelopmentSnapshot }

export type RuntimeDevelopmentWindowViewState = {
  schemaVersion: 1
  runtimeScopeId: RuntimeScopeId
  selectedThreadId?: string
  draft: string
  bounds?: { x?: number; y?: number; width: number; height: number }
  updatedAt: number
}

export type SaveRuntimeDevelopmentWindowViewStateInput = {
  patch: Partial<Pick<RuntimeDevelopmentWindowViewState, 'selectedThreadId' | 'draft' | 'bounds'>>
}

export type RuntimeDevelopmentWindowContext = {
  runtimeScopeId: RuntimeScopeId
  runtimeName: string
  ownerLabel: string
  scopeAvailable: boolean
  development?: RuntimeDevelopmentSnapshot
}

export type ReportRuntimeChatPresenceInput = { selectedThreadId?: string }

// Runtime 窗口 DTO 只携带 scope 内标识；scope/root/generation 全由 capability 与 Main resolver 注入。
export type CreateRuntimeChatThreadInput = { title: string }
export type SubmitRuntimeChatRunInput = { threadId: string; text: string; attachments?: ProjectChatAttachment[]; modelPick?: ChatModelPick; handoffContext?: string }
export type ForkRuntimeChatThreadInput = { threadId: string; messageId: string }
export type EditAndSubmitRuntimeChatRunInput = { threadId: string; messageId: string; text: string; modelPick?: ChatModelPick }
export type RuntimeChatThreadInput = { threadId: string }
export type SetRuntimeChatThreadPinnedInput = RuntimeChatThreadInput & { pinned: boolean }
export type SetRuntimeChatThreadModelInput = RuntimeChatThreadInput & { modelPick: ChatModelPick }
export type RuntimeChatDiffInput = RuntimeChatThreadInput & { changeSetId: string }
export type CancelRuntimeChatRunInput = RuntimeChatThreadInput & { requestId: string }
export type AnswerRuntimeChatPromptInput = CancelRuntimeChatRunInput & { promptId: string; response: ClaudePermissionResponsePayload }
export type SearchRuntimeChatFilesInput = { query: string }
export type ReadRuntimeChatAttachmentsInput = { relativePaths: string[]; allowImages?: boolean }
export type RuntimeChatAuthority = { runtimeScopeId: RuntimeScopeId; routeGeneration: number; developmentGeneration: number; ownerWebContentsId?: number }

export type RuntimeChatAPI = {
  getSnapshot(): Promise<ProjectChatResult<RuntimeChatSnapshot>>
  createThread(input: CreateRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>>
  submitRun(input: SubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>>
  forkThread(input: ForkRuntimeChatThreadInput): Promise<ProjectChatResult<{ threadId: string; runtimeThreadRevision: number }>>
  editAndSubmitRun(input: EditAndSubmitRuntimeChatRunInput): Promise<ProjectChatResult<{ requestId: string }>>
  archiveThread(input: RuntimeChatThreadInput): Promise<ProjectChatResult<void>>
  setThreadPinned(input: SetRuntimeChatThreadPinnedInput): Promise<ProjectChatResult<void>>
  setThreadModel(input: SetRuntimeChatThreadModelInput): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(input: RuntimeChatDiffInput): Promise<ProjectChatResult<void>>
  rewindFileDiff(input: RuntimeChatDiffInput): Promise<ProjectChatResult<RewindProjectFileDiffResult>>
  cancelRun(input: CancelRuntimeChatRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(input: AnswerRuntimeChatPromptInput): Promise<ProjectChatResult<void>>
  getModelCatalog(): Promise<ProjectChatResult<ProjectChatModelCatalog>>
  getAgentContext(): Promise<ProjectChatResult<ProjectChatAgentContext>>
  searchFiles(input: SearchRuntimeChatFilesInput): Promise<ProjectChatResult<ProjectChatFileSearchItem[]>>
  pickAttachments(options?: { allowImages?: boolean }): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  readAttachments(input: ReadRuntimeChatAttachmentsInput): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  getThreadStatus(input: RuntimeChatThreadInput): Promise<ProjectChatResult<ProjectChatThreadStatus>>
  getWindowContext(): Promise<ProjectChatResult<RuntimeDevelopmentWindowContext>>
  getWindowViewState(): Promise<ProjectChatResult<RuntimeDevelopmentWindowViewState>>
  saveWindowViewState(input: SaveRuntimeDevelopmentWindowViewStateInput): Promise<ProjectChatResult<RuntimeDevelopmentWindowViewState>>
  reportPresenceSelection(input: ReportRuntimeChatPresenceInput): Promise<ProjectChatResult<void>>
  onEvent(handler: (event: RuntimeChatEvent) => void): () => void
}

export type RuntimeDevelopmentTarget =
  | { kind: 'project-runtime'; projectId: string; mountId: string }
  | { kind: 'workspace-runtime'; workspaceTabId: string }

export type RuntimeDevelopmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: RuntimeDevelopmentErrorCode; message: string; retryable: boolean } }

export type OpenRuntimeDevelopmentResult =
  | { ok: true; value: { runtimeScopeId: RuntimeScopeId; developmentGeneration: number } }
  | {
      ok: false
      error:
        | { code: 'runtime-development-conflict'; message: string; retryable: false; conflictToken: string; conflictingRuntimeName: string; conflictingOwnerKind: RuntimeScopeKind }
        | { code: Exclude<RuntimeDevelopmentErrorCode, 'runtime-development-conflict'>; message: string; retryable: boolean }
    }

export type RuntimeDevelopmentMainAPI = {
  openRuntimeDevelopment(target: RuntimeDevelopmentTarget): Promise<OpenRuntimeDevelopmentResult>
  focusRuntimeDevelopmentConflict(conflictToken: string): Promise<RuntimeDevelopmentResult<void>>
  endRuntimeDevelopment(target: RuntimeDevelopmentTarget): Promise<RuntimeDevelopmentResult<void>>
  openRuntimeDevelopmentThread(threadId: string): Promise<RuntimeDevelopmentResult<void>>
}

/** Main-window projection; renderer stores it by scope but never derives phase from Runtime/Run state. */
export type RuntimeDevelopmentMainEvent = {
  type: 'snapshot'
  snapshot: RuntimeDevelopmentSnapshot
}

export const RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION = 1 as const

export type RuntimeDevelopmentWorkspace = {
  schemaVersion: typeof RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION
  runtimeThreadRevision: number
  runtimeDevelopmentThreads: RuntimeDevelopmentThread[]
}

export type RuntimeDevelopmentSearchItem = {
  id: string
  scopeKind: 'runtime-development'
  runtimeScopeId: RuntimeScopeId
  ownerKind: RuntimeScopeKind
  name: string
  runtimeDefinitionId?: string
  projectId?: string
  threadId: string
  threadTitle: string
  subtitle: string
  snippet: string
  updatedAt: number
  archivedAt?: number
  score: number
  metadata: {
    scopeKind: 'runtime-development'
    runtimeScopeId: RuntimeScopeId
    ownerKind: RuntimeScopeKind
    name: string
    runtimeDefinitionId?: string
    projectId?: string
    purpose: 'runtime-development'
  }
}

export type RuntimeDevelopmentSearchOptions = {
  includeArchived?: boolean
  limit?: number
  runtimeScopeId?: RuntimeScopeId
}

export type RuntimeDevelopmentSearchResult =
  | { ok: true; items: RuntimeDevelopmentSearchItem[] }
  | { ok: false; message: string }

export function projectRuntimeScopeId(projectId: string): ProjectRuntimeScopeId {
  const normalized = normalizeRuntimeScopeSegment(projectId)
  if (!normalized) throw new Error('invalid-project-runtime-scope')
  return `project:${normalized}`
}

export function workspaceRuntimeScopeId(runtimeDefinitionId: string): WorkspaceRuntimeScopeId {
  const normalized = normalizeRuntimeScopeSegment(runtimeDefinitionId)
  if (!normalized) throw new Error('invalid-workspace-runtime-scope')
  return `workspace:${normalized}`
}

export function parseRuntimeScopeId(value: unknown): ParsedRuntimeScopeId | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('project:')) {
    const projectId = normalizeRuntimeScopeSegment(value.slice('project:'.length))
    return projectId ? { kind: 'project', projectId, runtimeScopeId: `project:${projectId}` } : null
  }
  if (value.startsWith('workspace:')) {
    const runtimeDefinitionId = normalizeRuntimeScopeSegment(value.slice('workspace:'.length))
    return runtimeDefinitionId
      ? { kind: 'workspace', runtimeDefinitionId, runtimeScopeId: `workspace:${runtimeDefinitionId}` }
      : null
  }
  return null
}

export function runtimeOwnerMatchesScope(
  runtimeScopeId: RuntimeScopeId,
  runtimeOwner: RuntimeOwner,
  runtimeDefinitionId?: string,
): boolean {
  const parsed = parseRuntimeScopeId(runtimeScopeId)
  if (!parsed) return false
  if (parsed.kind === 'project') {
    return runtimeOwner.kind === 'project' && runtimeOwner.projectId === parsed.projectId
  }
  return runtimeOwner.kind === 'workspace' && runtimeDefinitionId === parsed.runtimeDefinitionId
}

function normalizeRuntimeScopeSegment(value: string): string | null {
  const normalized = value.trim()
  if (!normalized || normalized.includes('\0') || normalized.includes(':')) return null
  return normalized
}
