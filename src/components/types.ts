/**
 * 应用壳与聊天工作区的 UI 侧类型（线程、侧栏、文件树等）。
 * UI-side types for app shell and chat workspace (threads, sidebar, file tree).
 */

import type {
  AgentContextSlashItem,
  ChatModelPick,
  ClaudeChatAttachmentKind,
  ClaudeContextCompactionStatus,
  ClaudeContextCompactionTrigger,
  ClaudeFileChangeSetStatus,
  ClaudeFileDiffFile,
  ProjectFileSearchItem,
} from '../claude-chat-types'

/** 顶部主导航视图 / Primary shell view id */
export type AppViewId = 'home' | 'docs' | 'settings'

/** Runtime directory trust state / Runtime 目录信任状态 */
export type RuntimeTrustStatus = 'trusted' | 'revoked'

/** Static build declaration read from package.json.agentos. */
export type RuntimeStaticDeclaration = {
  mode: 'static'
  buildCommand: 'npm run build'
  outputRoot: string
  entryFile: string
}

export type RuntimeMode = 'development' | 'static'
/**
 * Explicit "view this Runtime as…" choice; overrides automatic detection.
 * `server` only means "keep it running"; production vs development stays
 * detection's call.
 */
export type RuntimeServeOverride = 'artifact' | 'server'
/** Forced serve script for one run; never persisted. */
export type RuntimeServeScript = 'dev' | 'start'
export type RuntimeBuildStatus = 'ready' | 'stale' | 'build_required' | 'building' | 'build_failed' | 'idle'

/** Durable product-domain ownership; legacy definitions migrate to workspace. */
export type RuntimeOwner =
  | { kind: 'project'; projectId: string }
  | { kind: 'workspace' }

/** Durable Runtime definition / Runtime 持久化定义 */
export type RuntimeDefinition = {
  id: string
  owner: RuntimeOwner
  name: string
  rootPath: string
  canonicalRoot?: string
  packageManager: 'npm'
  devCommand: { executable: 'npm'; args: ['run', 'dev'] }
  /** Omitted on legacy definitions; omission keeps the existing dev mode. */
  mode?: RuntimeMode
  /** Main-validated package.json.agentos declaration for static projects. */
  agentos?: RuntimeStaticDeclaration
  /**
   * Explicit user choice of how this Runtime is viewed (`C-RSM-404`).
   * Detection never overwrites it; absence means "decide automatically".
   */
  serveOverride?: RuntimeServeOverride
  /**
   * Runtime-only: forces one run onto a fixed npm script (an AI editing
   * session needs `dev`). Never persisted, never read from the store.
   */
  serveScript?: RuntimeServeScript
  trustStatus: RuntimeTrustStatus
  autoStart: boolean
  createdAt: number
  updatedAt: number
}

/** User-facing Workspace Tab; independent from chat threads / 用户侧 Workspace Tab 视图入口 */
export type WorkspaceTab = {
  id: string
  runtimeDefinitionId: string
  /** @deprecated Revision 2 compatibility only; new Workspace Runtime entries never write or follow this link. */
  projectId?: string
  title: string
  createdAt: number
  updatedAt: number
  /** @deprecated Read-only compatibility for Revision 1 snapshots/components. */
  localAppId?: string
}

export type RuntimeStatus =
  | 'ready'
  | 'stale'
  | 'build_required'
  | 'building'
  | 'build_failed'
  | 'development'
  | 'preparing'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'failed'
  | 'path_missing'
  | 'stopped'

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'degraded' | 'failed' | 'closed'

export type RuntimeSnapshot = {
  runtimeDefinitionId: string
  runtimeId: string
  generation: number
  status: RuntimeStatus
  mode?: RuntimeMode
  buildStatus?: RuntimeBuildStatus
  artifactId?: string
  buildId?: string
  operationId?: string
  stale?: boolean
  lastBuildAt?: number
  /** Main-generated static scheme URL; never a filesystem path. */
  previewUrl?: string
  readyUrl?: string
  port?: number
  restartAttempt: number
  startedAt?: number
  updatedAt: number
  stopReason?: 'user' | 'last-consumer' | 'app-quit' | 'crash' | 'error'
  phase?: 'inspect' | 'prepare' | 'start' | 'build' | 'readiness' | 'preview' | 'stop'
  errorCode?: string
  detail?: string
  logs?: string[]
  /** Preview state is kept separate from the managed process state. */
  previewStatus?: PreviewStatus
  /** @deprecated Read-only compatibility for Revision 1 event payloads. */
  localAppId?: string
}

export type RuntimeEvent = {
  type: 'snapshot' | 'status' | 'log' | 'ready' | 'exit'
  runtimeDefinitionId: string
  runtimeId: string
  generation: number
  status: RuntimeStatus
  mode?: RuntimeMode
  buildStatus?: RuntimeBuildStatus
  artifactId?: string
  buildId?: string
  operationId?: string
  stale?: boolean
  lastBuildAt?: number
  previewUrl?: string
  readyUrl?: string
  port?: number
  stream?: 'stdout' | 'stderr'
  line?: string
  code?: number | null
  signal?: string | null
  detail?: string
  phase?: RuntimeSnapshot['phase']
  errorCode?: string
  previewStatus?: PreviewStatus
  timestamp: number
  /** @deprecated Read-only compatibility for Revision 1 event payloads. */
  localAppId?: string
}

/**
 * Compatibility aliases are intentionally kept type-only while the physical
 * electron/local-app-runtime implementation is migrated.  Durable writes
 * are normalized to the neutral fields above.
 */
/** @deprecated Use RuntimeDefinition. */
export type LocalAppDefinition = RuntimeDefinition
/** @deprecated Use WorkspaceTab. */
export type LocalAppTab = WorkspaceTab
/** @deprecated Use RuntimeSnapshot. */
export type LocalAppRuntimeSnapshot = RuntimeSnapshot
/** @deprecated Use RuntimeEvent. */
export type LocalAppRuntimeEvent = RuntimeEvent
/** @deprecated Use RuntimeStatus. */
export type LocalAppRuntimeStatus = RuntimeStatus
/** @deprecated Use PreviewStatus. */
export type LocalAppPreviewStatus = PreviewStatus

/** Project-home page preference; deliberately not part of Runtime state. */
export type ProjectHomeViewMode = 'overview' | 'runtime'

/** 设置页侧栏路由 `#settings/<id>` / Settings sidebar route fragment `#settings/<id>` */
export type SettingsCategoryId = 'general' | 'search' | 'mcp' | 'skills' | 'updates' | 'agent' | 'website-bindings' | 'developer'

/** Agent Mode 首页模态设置页签 / Agent Mode home modal settings panel id */
export type AgentSettingsPanelId = 'project' | 'context' | 'mcp' | 'general' | 'card-order' | 'skills'

/** 消息气泡渲染状态 / Chat bubble render status */
export type MessageStatus = 'done' | 'streaming' | 'error' | 'cancelled'

/** 工具调用卡片状态 / Tool call row status */
export type ToolStatus = 'running' | 'done' | 'error' | 'denied'

/** 思考链折叠块状态 / Thinking block status */
export type ThinkingStatus = 'running' | 'done'

/** Agent 活动条状态 / Agent activity chip status */
export type ActivityStatus = 'running' | 'done' | 'error' | 'info'

/** 会话内 Agent 运行状态 / In-thread agent run status */
export type ThreadRunStatus = 'running' | 'waiting' | 'asking'

/** 会话中的一条用户或助手消息 / Transcript user or assistant message */
export type ChatMessageItem = {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  attachments?: ChatMessageAttachment[]
}

/** 会话消息携带的附件快照 / Attachment snapshot embedded in a transcript message */
export type ChatMessageAttachment = {
  id: string
  kind: ClaudeChatAttachmentKind
  name: string
  path: string
  mimeType: string
  size: number
  preview?: string
  dataUrl?: string
}

/** 工具调用条目 / Tool invocation transcript row */
export type ChatToolItem = {
  type: 'tool'
  id: string
  requestId?: string
  toolUseId: string
  name: string
  inputPreview: string
  status: ToolStatus
  detail?: string
}

/** 思考过程条目 / Thinking transcript row */
export type ChatThinkingItem = {
  type: 'thinking'
  id: string
  requestId?: string
  thinkingId: string
  title: string
  content: string
  status: ThinkingStatus
}

/** Agent 活动条目 / Agent activity transcript row */
export type ChatActivityItem = {
  type: 'activity'
  id: string
  requestId?: string
  title: string
  status: ActivityStatus
  detail?: string
  preview?: string
}

/** 会话压缩边界条目 / Context compaction boundary embedded in the transcript */
export type ChatContextCompactionItem = {
  type: 'context_compaction'
  id: string
  requestId?: string
  status: ClaudeContextCompactionStatus
  trigger: ClaudeContextCompactionTrigger
  preTokens?: number
  postTokens?: number
  durationMs?: number
  preservedMessageCount?: number
  summary?: string
  error?: string
  createdAt?: number
  updatedAt?: number
}

/** 会话中的文件 diff 卡片 / File diff card embedded in the transcript */
export type ChatFileDiffItem = {
  type: 'file_diff'
  id: string
  requestId: string
  threadId?: string
  changeSetId: string
  checkpointId?: string
  files: ClaudeFileDiffFile[]
  status: ClaudeFileChangeSetStatus
  detail?: string
}

export type ChatTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** 当前线程内由 Claude Task 工具维护的任务项 / Task item tracked from Claude Task tools */
export type ChatTaskItem = {
  id: string
  toolUseId?: string
  subject: string
  description?: string
  activeForm?: string
  status: ChatTaskStatus
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
  order: number
}

/** 线程级任务清单快照 / Thread-scoped task list snapshot */
export type ChatTaskState = {
  requestId?: string
  updatedAt: number
  items: ChatTaskItem[]
}

/** 对话时间轴联合类型 / Union of rows shown in the transcript timeline */
export type TranscriptItem =
  | ChatMessageItem
  | ChatToolItem
  | ChatThinkingItem
  | ChatActivityItem
  | ChatContextCompactionItem
  | ChatFileDiffItem

/** 单线程内的聊天 UI 状态快照 / Per-thread chat UI state snapshot */
export type ChatState = {
  sessionId?: string
  model: string
  modelPick?: ChatModelPick
  cwd?: string
  tasks?: ChatTaskState
  items: TranscriptItem[]
}

/** 工作区中的项目卡片 / Workspace project card metadata */
export type WorkspaceProject = {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
  /** 置顶权重：越大越靠前（持久化）/ Pin rank: larger sorts higher (persisted) */
  pinnedAt?: number
  /** 运行时标记：本地路径不可达（不持久化）/ Runtime-only flag when local path is unreachable */
  pathMissing?: boolean
}

/** 侧栏折叠偏好（与置顶同属工作区持久化）/ Sidebar collapse prefs co-persisted with pins */
export type WorkspaceSidebarPrefs = {
  /** 整条侧栏是否收起 / Whether entire sidebar rail is collapsed */
  collapsed: boolean
  /** 在侧栏内折叠对话列表的项目 id / Project ids whose thread lists are collapsed */
  collapsedProjectIds: string[]
  /** 侧栏项目的手动顺序；为空时按置顶和添加时间降序 / Manual project order; empty falls back to pins + created time desc */
  projectOrderIds: string[]
}

/** 工作区对话线程 / Workspace chat thread */
export type ProjectThreadCreationSource =
  | { kind: 'user' }
  | { kind: 'app-command' }
  | { kind: 'website'; bindingId: string; receivedAt: number }

/** Project 与 Runtime 开发对话共用的持久字段；scope 身份由各自子类型补充。 */
export type ChatThreadBase = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 置顶权重：越大越靠前（持久化）/ Pin rank: larger sorts higher (persisted) */
  pinnedAt?: number
  archivedAt?: number
  creationSource: ProjectThreadCreationSource
  chatState: ChatState
}

export type WorkspaceThread = ChatThreadBase & {
  projectId: string
  /** 特殊线程用途，例如项目首页插件定制 / Special thread purpose, such as project home customization */
  purpose?: 'home-plugin-customization' | 'home-plugin-card-customization' | 'task-run' | 'skill-run'
  /** 关联的 Home Plugin 目录名；用于单卡片修改线程 / Bound Home Plugin slug for card customization threads */
  homePluginSlug?: string
  /** Skill 运行线程的来源元数据 / Source metadata for Skill-run threads */
  skillPath?: string
  skillCommand?: string
  skillTitle?: string
}

/** 新建线程时的瞬时行为；不进入持久化线程数据。 / Ephemeral behavior for creating a thread. */
export type CreateWorkspaceThreadOptions = {
  activate?: boolean
  title?: string
}

/** 追踪单次 Agent 请求的运行状态 / Tracks one in-flight agent request */
export type ThreadRunState = {
  requestId: string
  status: ThreadRunStatus
  startedAt?: number
  updatedAt: number
}

/** 会话任务已完成但尚未查看的侧栏提示 / Sidebar notice for a completed task that has not been viewed */
export type ThreadCompletionState = {
  completedAt: number
}

/** 文件树节点（递归）/ Recursive file tree node */
export type FileTreeNode = {
  name: string
  path: string
  relativePath: string
  type: 'directory' | 'file'
  children?: FileTreeNode[]
}

/** 读取项目文件树的结果 / Result of loading a project file tree */
export type FileTreeResult =
  | {
      ok: true
      rootPath: string
      rootName: string
      nodes: FileTreeNode[]
      truncated: boolean
    }
  | {
      ok: false
      rootPath: string
      message: string
    }

export type ProjectFilePreviewKind = 'markdown' | 'json' | 'text' | 'image'

/** 项目内文件预览结果 / Project-scoped file preview payload */
export type ProjectFilePreviewResult =
  | {
      ok: true
      rootPath: string
      path: string
      relativePath: string
      name: string
      kind: ProjectFilePreviewKind
      mimeType: string
      size: number
      content?: string
      dataUrl?: string
    }
  | {
      ok: false
      rootPath: string
      path: string
      relativePath?: string
      name?: string
      message: string
    }

/** 完整聊天工作区状态（活动项目/线程与列表）/ Full chat workspace snapshot */
export type ChatWorkspaceState = {
  /** 工作区逻辑修订号，用于跨 adapter 判断快照新旧 / Logical workspace revision for adapter freshness */
  workspaceRevision: number
  activeProjectId: string
  activeThreadId: string
  projects: WorkspaceProject[]
  threads: WorkspaceThread[]
  sidebarPrefs: WorkspaceSidebarPrefs
  /** Runtime definitions/tabs are durable UX state; process facts stay in Main memory. */
  runtimeDefinitions: RuntimeDefinition[]
  workspaceTabs: WorkspaceTab[]
  activeWorkspaceTabId: string
  /** Last page-level view selected for each project home. */
  projectHomeViewModes: Record<string, ProjectHomeViewMode>
  /** @deprecated Compatibility view over the neutral fields; not persisted by new snapshots. */
  localAppDefinitions: LocalAppDefinition[]
  /** @deprecated Compatibility view over the neutral fields; not persisted by new snapshots. */
  localAppTabs: LocalAppTab[]
  /** @deprecated Compatibility view over the neutral fields; not persisted by new snapshots. */
  activeLocalAppTabId: string
  /** Snapshot metadata shared by JSON and SQLite adapters. */
  workspaceSchemaVersion?: number
  snapshotComplete?: boolean
}

/** 某项目的技能列表加载状态 / Loaded slash skills for one project */
export type ProjectSkillListState = {
  path: string
  loading: boolean
  loaded: boolean
  skills: AgentContextSlashItem[]
  message?: string
}

/** 侧栏中选中的技能条目 / Skill entry selected in sidebar */
export type SelectedProjectSkill = Pick<
  AgentContextSlashItem,
  'title' | 'description' | 'path' | 'relativePath' | 'argumentHint'
> & {
  projectId: string
}

/** 可执行的项目 Skill 快照 / Executable project Skill snapshot */
export type ProjectSkillRunRequest = Pick<
  AgentContextSlashItem,
  'title' | 'command' | 'description' | 'path' | 'relativePath'
> & {
  modelPick?: ChatModelPick
}

/** 搜索结果类型 / Search result category */
export type AppSearchResultKind =
  | 'agent'
  | 'chat'
  | 'command'
  | 'directory'
  | 'file'
  | 'home-plugin'
  | 'memory'
  | 'message'
  | 'skill'
  | 'task'

/** 搜索范围筛选 / Search scope filter */
export type AppSearchScope = 'all' | 'chats' | 'files' | 'memory' | 'messages' | 'skills' | 'tasks'

/** 搜索结果高亮范围 / Search result highlight range */
export type AppSearchHighlightRange = {
  field: 'subtitle' | 'title'
  ranges: Array<[number, number]>
}

/** 搜索结果基础数据；具体 UI 可附加原始 item / Base search result payload; UI may attach source item */
export type AppSearchResult = {
  id: string
  kind: AppSearchResultKind
  projectId: string
  title: string
  subtitle?: string
  path?: string
  threadId?: string
  score: number
  updatedAt?: number
  highlights?: AppSearchHighlightRange[]
}

/** 文件搜索结果在 App 级搜索中的来源 / File result source used by app-level search */
export type AppSearchFileSource = ProjectFileSearchItem
