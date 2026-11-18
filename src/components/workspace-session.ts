import type { ChatModelPick } from '../claude-chat-types'
import type { ProjectChatClientEvent, ProjectChatSnapshot, ProjectChatThreadSnapshot, ProjectChatTranscriptItem } from '../project-chat-contract'
import type {
  ChatState,
  ChatWorkspaceState,
  RuntimeDefinition,
  ThreadMetadata,
  WorkspaceTab,
  TranscriptItem,
  WorkspaceMetadataState,
  WorkspaceProject,
  ProjectThreadCreationSource,
  WorkspaceThread,
} from './types'
import { stripRuntimeProjectFields } from '../project-path'
import {
  withWorkspaceRevision,
  workspaceDurableFingerprint,
  workspaceRevisionOf,
} from '../workspace-snapshot-resolution'
import {
  createWorkspaceProject,
  relocateWorkspaceProject,
  removeWorkspaceProject,
  reorderWorkspaceProject,
  setWorkspaceProjectPinned,
} from '../workspace-commands'

export type WorkspaceSessionOptions = {
  load: () => Promise<ChatWorkspaceState>
  save: (state: ChatWorkspaceState) => Promise<void>
  saveImmediately?: (state: ChatWorkspaceState) => void | Promise<void>
  onSaveError?: (error: unknown, state: ChatWorkspaceState) => void
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancelScheduled?: (handle: unknown) => void
  saveDebounceMs?: number
}

export type WorkspaceSessionActive<TThread extends ThreadMetadata = WorkspaceThread> = {
  project?: WorkspaceProject
  thread?: TThread
  runtimeDefinition?: RuntimeDefinition
  workspaceTab?: WorkspaceTab
  /** @deprecated Use runtimeDefinition/workspaceTab. */
  localAppDefinition?: RuntimeDefinition
  /** @deprecated Use workspaceTab. */
  localAppTab?: WorkspaceTab
}

export type AddWorkspaceThreadInput = {
  id: string
  projectId: string
  title: string
  /** 省略时线程只进入元数据；对话内容由 `ThreadChatStateStore` 单独持有。 */
  chatState?: ChatState
  purpose?: WorkspaceThread['purpose']
  homePluginSlug?: string
  skillPath?: string
  skillCommand?: string
  skillTitle?: string
  creationSource?: ProjectThreadCreationSource
  createdAt?: number
  activate?: boolean
}

export type AddWorkspaceProjectInput = {
  id: string
  name: string
  path: string
  createdAt?: number
}

export type AddRuntimeInput = {
  definition: RuntimeDefinition
  tab?: WorkspaceTab
  activate?: boolean
}

export type EnsureTaskRunThreadInput = {
  projectPath: string
  slug: string
  title: string
  thread: {
    id: string
    projectId: string
    title?: string
    createdAt?: number
    updatedAt?: number
  }
}

const DEFAULT_SAVE_DEBOUNCE_MS = 750

/**
 * Renderer-only snapshot ordering seam. Durable Chat state stays in Main;
 * this controller only accepts a complete broker projection or requests a
 * fresh one when an event sequence has a gap.
 */
export class ProjectChatSnapshotController {
  private readonly snapshots = new Map<string, ProjectChatSnapshot>()
  private readonly cursors = new Map<string, { sequence: number; routeGeneration: number; workspaceRevision: number }>()

  adopt(snapshot: ProjectChatSnapshot): void {
    this.snapshots.set(snapshot.projectId, snapshot)
    this.cursors.set(snapshot.projectId, {
      sequence: snapshot.sequence,
      routeGeneration: snapshot.routeGeneration,
      workspaceRevision: snapshot.workspaceRevision,
    })
  }

  accept(event: ProjectChatClientEvent): 'accepted' | 'gap' | 'discarded' {
    if (event.type !== 'snapshot') return 'discarded'
    const cursor = this.cursors.get(event.projectId)
    if (!cursor) {
      this.adopt(event.snapshot)
      return 'accepted'
    }
    if (event.routeGeneration !== cursor.routeGeneration || event.sequence <= cursor.sequence) return 'discarded'
    if (event.sequence !== cursor.sequence + 1) return 'gap'
    this.adopt(event.snapshot)
    return 'accepted'
  }

  snapshot(projectId: string): ProjectChatSnapshot | undefined { return this.snapshots.get(projectId) }
}

/** 结构化写入口：由 `ThreadChatStateStore` 实现，这里只依赖形状以免壳层 store 反向依赖会话层。 */
export type ThreadChatStateSink = {
  replaceScope(scopeId: string, entries: readonly { threadId: string; chatState: ChatState }[]): void
}

export type ApplyProjectChatSnapshotOptions = {
  /** 提供时对话内容写进 store，返回的线程只剩元数据。 */
  store?: ThreadChatStateSink
  /**
   * 运行中每条 delta 都会把 `thread.updatedAt` 往前推一格。提交它会重渲染整棵壳层树，
   * 却不可能改变排序——该线程在用户消息那一刻已经排到最前。开启后仅时间戳变化的快照
   * 保留原状态对象；终止快照里 run 不再活跃，精确时间戳照常落地。
   */
  deferTimestampOnlyUpdates?: boolean
}

/** Applies a redacted broker projection without using it as a writable workspace snapshot. */
export function applyProjectChatSnapshot<S extends WorkspaceMetadataState>(
  state: S,
  snapshot: ProjectChatSnapshot,
  options: ApplyProjectChatSnapshotOptions = {},
): S {
  const existingProject = state.projects.find((project) => project.id === snapshot.projectId)
  if (!existingProject) return state
  const project = {
    ...existingProject,
    name: snapshot.project.name,
    pathMissing: snapshot.project.pathMissing || undefined,
  }
  const projectedThreads = snapshot.threads.map(projectChatThreadToWorkspaceThread)
  options.store?.replaceScope(
    snapshot.projectId,
    projectedThreads.map((thread) => ({ threadId: thread.id, chatState: thread.chatState })),
  )
  const nextThreads = options.store
    ? projectedThreads.map(({ chatState: _chatState, ...metadata }) => metadata)
    : projectedThreads
  if (
    options.deferTimestampOnlyUpdates &&
    sameProjectionExceptTimestamps(state, snapshot.projectId, existingProject, project, nextThreads)
  ) {
    return state
  }
  return {
    ...state,
    workspaceRevision: Math.max(state.workspaceRevision, snapshot.workspaceRevision),
    projects: state.projects.map((candidate) => candidate.id === snapshot.projectId ? project : candidate),
    threads: [...state.threads.filter((thread) => thread.projectId !== snapshot.projectId), ...nextThreads],
  } as S
}

/** 只忽略 `updatedAt` 与 workspaceRevision；标题、置顶、归档、增删线程都算真实变化。 */
function sameProjectionExceptTimestamps(
  state: WorkspaceMetadataState,
  projectId: string,
  previousProject: WorkspaceProject,
  nextProject: WorkspaceProject,
  nextThreads: readonly ThreadMetadata[],
): boolean {
  if (
    previousProject.name !== nextProject.name ||
    previousProject.path !== nextProject.path ||
    previousProject.pinnedAt !== nextProject.pinnedAt ||
    previousProject.pathMissing !== nextProject.pathMissing
  ) {
    return false
  }
  const previousThreads = state.threads.filter((thread) => thread.projectId === projectId)
  if (previousThreads.length !== nextThreads.length) return false
  for (let index = 0; index < nextThreads.length; index += 1) {
    const previous = previousThreads[index]
    const next = nextThreads[index]
    if (
      previous.id !== next.id ||
      previous.title !== next.title ||
      previous.purpose !== next.purpose ||
      previous.homePluginSlug !== next.homePluginSlug ||
      previous.skillCommand !== next.skillCommand ||
      previous.skillTitle !== next.skillTitle ||
      previous.createdAt !== next.createdAt ||
      previous.pinnedAt !== next.pinnedAt ||
      previous.archivedAt !== next.archivedAt
    ) {
      return false
    }
  }
  return true
}

function projectChatThreadToWorkspaceThread(thread: ProjectChatThreadSnapshot): WorkspaceThread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    purpose: thread.purpose,
    homePluginSlug: thread.homePluginSlug,
    skillCommand: thread.skillCommand,
    skillTitle: thread.skillTitle,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinnedAt: thread.pinnedAt,
    archivedAt: thread.archivedAt,
    creationSource: { kind: 'user' },
    chatState: {
      model: thread.chatState.model,
      modelPick: thread.chatState.modelPick,
      tasks: thread.chatState.tasks,
      items: thread.chatState.items.map(projectChatTranscriptToWorkspaceItem),
    },
  }
}

function projectChatTranscriptToWorkspaceItem(item: ProjectChatTranscriptItem): TranscriptItem {
  if (item.type === 'message') {
    return {
      ...item,
      attachments: item.attachments?.map((attachment) => ({ ...attachment, path: '' })),
    }
  }
  if (item.type === 'file_diff') {
    return {
      ...item,
      requestId: '',
      files: item.files.map((file) => ({
        path: file.relativePath,
        relativePath: file.relativePath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        hunks: file.hunks,
        truncated: file.truncated,
      })),
    }
  }
  return item
}

export function restoreWorkspaceSessionState<S extends WorkspaceMetadataState>(state: S): S {
  if (state.projects.length === 0) {
    return { ...state, activeProjectId: '', activeThreadId: '' } as S
  }

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId)
  const project =
    activeProject && !activeProject.pathMissing
      ? activeProject
      : state.projects.find((candidate) => !candidate.pathMissing) ??
        activeProject ??
        state.projects[0]

  if (!project) {
    return { ...state, activeProjectId: '', activeThreadId: '' } as S
  }

  const requestedProjectHome = state.activeThreadId === ''
  const activeThread = requestedProjectHome
    ? undefined
    : state.threads.find(
        (thread) =>
          thread.id === state.activeThreadId &&
          thread.projectId === project.id &&
          !thread.archivedAt,
      ) ?? latestVisibleThread(state, project.id)

  const activeThreadId = requestedProjectHome ? '' : activeThread?.id ?? ''
  return withActiveWorkspaceTab({
    ...state,
    activeProjectId: project.id,
    activeThreadId,
  }, activeThreadId ? '' : state.activeWorkspaceTabId)
}

export class WorkspaceSession {
  private readonly loadState: WorkspaceSessionOptions['load']
  private readonly saveState: WorkspaceSessionOptions['save']
  private readonly saveImmediateState: NonNullable<WorkspaceSessionOptions['saveImmediately']>
  private readonly onSaveError?: WorkspaceSessionOptions['onSaveError']
  private readonly now: () => number
  private readonly schedule: NonNullable<WorkspaceSessionOptions['schedule']>
  private readonly cancelScheduled: NonNullable<WorkspaceSessionOptions['cancelScheduled']>
  private readonly saveDebounceMs: number
  private saveHandle: unknown
  private flushPromise: Promise<void> | null = null
  private pendingSave: ChatWorkspaceState | null = null
  private lastDurableFingerprint = ''
  private revisionFloor = 0
  private cleared = false

  constructor(options: WorkspaceSessionOptions) {
    this.loadState = options.load
    this.saveState = options.save
    this.saveImmediateState = options.saveImmediately ?? (() => {})
    this.onSaveError = options.onSaveError
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancelScheduled = options.cancelScheduled ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.saveDebounceMs = options.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS
  }

  async load(): Promise<ChatWorkspaceState> {
    const restored = this.restore(await this.loadState())
    this.revisionFloor = Math.max(this.revisionFloor, workspaceRevisionOf(restored))
    return restored
  }

  restore<S extends WorkspaceMetadataState>(state: S): S {
    return restoreWorkspaceSessionState(state)
  }

  active<S extends WorkspaceMetadataState>(state: S): WorkspaceSessionActive<S['threads'][number]> {
    const restored = this.restore(state)
    const project = restored.projects.find((item) => item.id === restored.activeProjectId)
    const workspaceTab = restored.workspaceTabs?.find((item) => item.id === restored.activeWorkspaceTabId)
    const runtimeDefinition = workspaceTab
      ? restored.runtimeDefinitions?.find((item) => item.id === workspaceTab.runtimeDefinitionId)
      : undefined
    if (!project) {
      return runtimeDefinition || workspaceTab
        ? { runtimeDefinition, workspaceTab, localAppDefinition: runtimeDefinition, localAppTab: workspaceTab }
        : {}
    }

    const thread = restored.activeThreadId
      ? restored.threads.find(
          (thread) =>
            thread.id === restored.activeThreadId &&
            thread.projectId === project.id &&
            !thread.archivedAt,
        )
      : undefined
    return runtimeDefinition || workspaceTab
      ? { project, thread, runtimeDefinition, workspaceTab, localAppDefinition: runtimeDefinition, localAppTab: workspaceTab }
      : { project, thread }
  }

  stage(state: ChatWorkspaceState): void {
    if (this.cleared && isEmptyWorkspace(state)) return
    const durableState = this.prepareDurableSave(state)
    if (!durableState) return
    this.cleared = false
    this.pendingSave = durableState
    void Promise.resolve(this.saveImmediateState(durableState)).catch((error) => {
      this.onSaveError?.(error, durableState)
    })
    this.cancelSaveTimer()
    this.saveHandle = this.schedule(() => {
      this.saveHandle = undefined
      void this.flush().catch((error) => {
        this.onSaveError?.(error, this.pendingSave ?? durableState)
      })
    }, this.saveDebounceMs)
  }

  clear(): void {
    this.cleared = true
    this.pendingSave = null
    this.cancelSaveTimer()
  }

  flush(): Promise<void> {
    this.cancelSaveTimer()
    if (this.flushPromise) return this.flushPromise
    this.flushPromise = this.drainPendingSaves().finally(() => {
      this.flushPromise = null
    })
    return this.flushPromise
  }

  async close(): Promise<void> {
    // AppShell's effect cleanup also runs during React StrictMode's probe
    // mount.  A WorkspaceSession is retained by the shell and may be reused
    // immediately afterwards, so cleanup is deliberately a repeatable flush,
    // not disposal of the session's write queue.
    this.cancelSaveTimer()
    await this.flush()
  }

  /** 仅供仍持有完整 `ChatWorkspaceState` 的调用方；壳层改由 `ThreadChatStateStore` 承接。 */
  updateThreadChatState(
    state: ChatWorkspaceState,
    threadId: string,
    update: ChatState | ((previous: ChatState) => ChatState),
  ): ChatWorkspaceState {
    const timestamp = this.now()
    let projectId = ''
    const threads = state.threads.map((thread) => {
      if (thread.id !== threadId) return thread
      projectId = thread.projectId
      return {
        ...thread,
        updatedAt: timestamp,
        chatState: typeof update === 'function' ? update(thread.chatState) : update,
      }
    })
    if (!projectId) return state
    return {
      ...state,
      projects: touchProject(state.projects, projectId, timestamp),
      threads,
    }
  }

  selectThread<S extends WorkspaceMetadataState>(state: S, threadId: string): S {
    const thread = state.threads.find((item) => item.id === threadId && !item.archivedAt)
    if (!thread) return state
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: thread.projectId,
      activeThreadId: thread.id,
    }, '')
  }

  selectProject<S extends WorkspaceMetadataState>(state: S, projectId: string): S {
    if (!state.projects.some((project) => project.id === projectId)) return state
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: projectId,
      activeThreadId: '',
    }, '')
  }

  addThread<S extends WorkspaceMetadataState>(state: S, input: AddWorkspaceThreadInput): S {
    if (!state.projects.some((project) => project.id === input.projectId)) return state
    if (state.threads.some((thread) => thread.id === input.id)) return state
    const timestamp = input.createdAt ?? this.now()
    const thread: ThreadMetadata & { chatState?: ChatState } = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      purpose: input.purpose,
      homePluginSlug: input.homePluginSlug,
      skillPath: input.skillPath,
      skillCommand: input.skillCommand,
      skillTitle: input.skillTitle,
      createdAt: timestamp,
      updatedAt: timestamp,
      creationSource: input.creationSource ?? { kind: 'user' },
      ...(input.chatState ? { chatState: input.chatState } : {}),
    }
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: input.activate === false ? state.activeProjectId : input.projectId,
      activeThreadId: input.activate === false ? state.activeThreadId : input.id,
      projects: touchProject(state.projects, input.projectId, timestamp),
      threads: [thread, ...state.threads],
    } as S, input.activate === false ? state.activeWorkspaceTabId : '')
  }

  forkThread<S extends WorkspaceMetadataState>(
    state: S,
    input: {
      id: string
      projectId: string
      title: string
      items: TranscriptItem[]
      model?: string
      modelPick?: ChatModelPick
      createdAt?: number
    },
  ): S {
    const project = state.projects.find((item) => item.id === input.projectId)
    if (!project) return state
    return this.addThread(state, {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      createdAt: input.createdAt,
      chatState: {
        model: input.model ?? 'Claude Agent',
        modelPick: input.modelPick,
        cwd: project.path,
        items: input.items,
      },
    })
  }

  archiveThread<S extends WorkspaceMetadataState>(state: S, threadId: string): S {
    const current = state.threads.find((thread) => thread.id === threadId)
    if (!current || current.archivedAt) return state
    const timestamp = this.now()
    const threads = state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, archivedAt: timestamp, updatedAt: timestamp } : thread,
    )
    if (state.activeThreadId !== threadId) return { ...state, threads } as S

    const nextState = { ...state, threads } as S
    const nextActive = latestVisibleThread(nextState, current.projectId)
    return {
      ...nextState,
      activeProjectId: current.projectId,
      activeThreadId: nextActive?.id ?? '',
    } as S
  }

  addProject<S extends WorkspaceMetadataState>(state: S, input: AddWorkspaceProjectInput): S {
    // Shared with the Main-owned `project.create` command so both writers agree.
    return createWorkspaceProject(input, state, input.createdAt ?? this.now())
  }

  /** Add a trusted definition and its first view atomically after user confirmation. */
  addRuntime<S extends WorkspaceMetadataState>(state: S, input: AddRuntimeInput): S {
    if (input.definition.owner?.kind === 'project') return state
    if (state.runtimeDefinitions.some((item) => item.id === input.definition.id)) return state
    const timestamp = input.definition.createdAt || this.now()
    const definition = {
      ...input.definition,
      createdAt: timestamp,
      updatedAt: input.definition.updatedAt || timestamp,
      packageManager: 'npm' as const,
      devCommand: { executable: 'npm' as const, args: ['run', 'dev'] as ['run', 'dev'] },
    }
    const tab = input.tab ?? {
      id: `${definition.id}-tab`,
      runtimeDefinitionId: definition.id,
      title: definition.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (state.workspaceTabs.some((item) => item.id === tab.id)) return state
    return withActiveWorkspaceTab({
      ...state,
      runtimeDefinitions: [definition, ...state.runtimeDefinitions],
      workspaceTabs: [tab, ...state.workspaceTabs],
    } as S, input.activate === false ? state.activeWorkspaceTabId : tab.id)
  }

  addWorkspaceTab<S extends WorkspaceMetadataState>(state: S, tab: WorkspaceTab, activate = true): S {
    if (!state.runtimeDefinitions.some((item) => item.id === tab.runtimeDefinitionId && item.owner?.kind !== 'project')) return state
    if (state.workspaceTabs.some((item) => item.id === tab.id)) return state
    return withActiveWorkspaceTab({
      ...state,
      workspaceTabs: [tab, ...state.workspaceTabs],
    } as S, activate ? tab.id : state.activeWorkspaceTabId)
  }

  selectWorkspaceTab<S extends WorkspaceMetadataState>(state: S, tabId: string): S {
    const tab = state.workspaceTabs.find((item) => item.id === tabId)
    if (!tab) return state
    // This is renderer selection ergonomics only. Main remains the durable
    // authority when opening a tab's Project Chat.
    const backedProject = tab.projectId ? state.projects.find((project) => project.id === tab.projectId) : undefined
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: backedProject?.id ?? state.activeProjectId,
      activeThreadId: '',
    }, tabId)
  }

  closeWorkspaceTab<S extends WorkspaceMetadataState>(state: S, tabId: string): S {
    const index = state.workspaceTabs.findIndex((item) => item.id === tabId)
    if (index < 0) return state
    const tabs = state.workspaceTabs.filter((item) => item.id !== tabId)
    if (state.activeWorkspaceTabId !== tabId) return { ...state, workspaceTabs: tabs } as S
    const fallback = tabs[Math.min(index, tabs.length - 1)]
    return withActiveWorkspaceTab({ ...state, workspaceTabs: tabs } as S, fallback?.id ?? '')
  }

  removeRuntime<S extends WorkspaceMetadataState>(state: S, runtimeDefinitionId: string): S {
    if (!state.runtimeDefinitions.some((item) => item.id === runtimeDefinitionId)) return state
    const removedTabIds = new Set(state.workspaceTabs.filter((item) => item.runtimeDefinitionId === runtimeDefinitionId).map((item) => item.id))
    const tabs = state.workspaceTabs.filter((item) => item.runtimeDefinitionId !== runtimeDefinitionId)
    const activeTabId = removedTabIds.has(state.activeWorkspaceTabId)
      ? tabs[0]?.id ?? ''
      : state.activeWorkspaceTabId
    return withActiveWorkspaceTab({
      ...state,
      runtimeDefinitions: state.runtimeDefinitions.filter((item) => item.id !== runtimeDefinitionId),
      workspaceTabs: tabs,
    } as S, activeTabId)
  }

  renameWorkspaceTab<S extends WorkspaceMetadataState>(state: S, tabId: string, title: string): S {
    const nextTitle = title.trim()
    if (nextTitle.length < 1 || nextTitle.length > 64) return state
    if (!state.workspaceTabs.some((item) => item.id === tabId)) return state
    return {
      ...state,
      workspaceTabs: state.workspaceTabs.map((tab) => tab.id === tabId ? { ...tab, title: nextTitle, updatedAt: this.now() } : tab),
    } as S
  }

  setProjectHomeViewMode<S extends WorkspaceMetadataState>(state: S, projectId: string, mode: 'overview' | 'runtime'): S {
    if (!state.projects.some((project) => project.id === projectId)) return state
    return { ...state, projectHomeViewModes: { ...state.projectHomeViewModes, [projectId]: mode } } as S
  }

  /** @deprecated Compatibility wrappers for the Revision 1 renderer. */
  selectLocalAppTab<S extends WorkspaceMetadataState>(state: S, tabId: string): S {
    return this.selectWorkspaceTab(state, tabId)
  }

  /** @deprecated Compatibility wrappers for the Revision 1 renderer. */
  removeLocalApp<S extends WorkspaceMetadataState>(state: S, runtimeDefinitionId: string): S {
    return this.removeRuntime(state, runtimeDefinitionId)
  }

  removeProject<S extends WorkspaceMetadataState>(state: S, projectId: string): S {
    return removeWorkspaceProject(state, projectId)
  }

  relocateProject<S extends WorkspaceMetadataState>(state: S, projectId: string, path: string): S {
    return relocateWorkspaceProject(state, projectId, path, this.now())
  }

  toggleThreadPinned<S extends WorkspaceMetadataState>(state: S, threadId: string): S {
    const timestamp = this.now()
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, pinnedAt: thread.pinnedAt ? undefined : timestamp } : thread,
      ),
    } as S
  }

  toggleProjectPinned<S extends WorkspaceMetadataState>(state: S, projectId: string): S {
    const target = state.projects.find((project) => project.id === projectId)
    if (!target) return state
    return setWorkspaceProjectPinned(state, projectId, !target.pinnedAt, this.now())
  }

  reorderProject<S extends WorkspaceMetadataState>(
    state: S,
    projectId: string,
    targetProjectId: string,
    position: 'before' | 'after',
  ): S {
    return reorderWorkspaceProject(state, projectId, targetProjectId, position)
  }

  toggleSidebar<S extends WorkspaceMetadataState>(state: S): S {
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsed: !state.sidebarPrefs.collapsed },
    } as S
  }

  toggleProjectCollapsed<S extends WorkspaceMetadataState>(state: S, projectId: string): S {
    const collapsedProjectIds = new Set(state.sidebarPrefs.collapsedProjectIds)
    if (collapsedProjectIds.has(projectId)) collapsedProjectIds.delete(projectId)
    else collapsedProjectIds.add(projectId)
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsedProjectIds: [...collapsedProjectIds] },
    } as S
  }

  pruneCollapsedProjects<S extends WorkspaceMetadataState>(state: S): S {
    const projectIds = new Set(state.projects.map((project) => project.id))
    const collapsedProjectIds = state.sidebarPrefs.collapsedProjectIds.filter((id) => projectIds.has(id))
    if (collapsedProjectIds.length === state.sidebarPrefs.collapsedProjectIds.length) return state
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsedProjectIds },
    } as S
  }

  markPromptSubmitted<S extends WorkspaceMetadataState>(
    state: S,
    threadId: string,
    prompt: string,
    untitledTitles: ReadonlySet<string>,
    fallbackTitle: string,
    /** 线程是否已有用户消息；壳层从 `ThreadChatStateStore` 读取，测试可直接传闭包。 */
    threadHasUserMessage: (threadId: string) => boolean = () => false,
  ): S {
    const timestamp = this.now()
    return {
      ...state,
      threads: state.threads.map((thread) => {
        if (thread.id !== threadId) return thread
        const hasUserMessage = threadHasUserMessage(thread.id)
        return {
          ...thread,
          title:
            untitledTitles.has(thread.title) && !hasUserMessage
              ? titleFromPrompt(prompt, fallbackTitle)
              : thread.title,
          updatedAt: timestamp,
        }
      }),
    } as S
  }

  ensureTaskRunThread<S extends WorkspaceMetadataState>(
    state: S,
    input: EnsureTaskRunThreadInput,
  ): S {
    const project =
      state.projects.find((item) => item.id === input.thread.projectId) ??
      state.projects.find((item) => sameProjectPath(item.path, input.projectPath))
    if (!project) return state

    const timestamp = this.now()
    const existing = state.threads.find((thread) => thread.id === input.thread.id)
    const title = input.thread.title || input.title
    if (existing) {
      const updatedAt = Math.max(existing.updatedAt, input.thread.updatedAt || timestamp)
      if (
        existing.projectId === project.id &&
        existing.title === title &&
        existing.purpose === 'task-run' &&
        existing.homePluginSlug === input.slug &&
        existing.updatedAt === updatedAt
      ) {
        return state
      }
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === input.thread.id
            ? {
                ...thread,
                projectId: project.id,
                title,
                purpose: 'task-run',
                homePluginSlug: input.slug,
                updatedAt,
              }
            : thread,
        ),
      } as S
    }

    const thread: ThreadMetadata & { chatState: ChatState } = {
      id: input.thread.id,
      projectId: project.id,
      title,
      purpose: 'task-run',
      homePluginSlug: input.slug,
      createdAt: input.thread.createdAt || timestamp,
      updatedAt: input.thread.updatedAt || timestamp,
      creationSource: { kind: 'user' },
      chatState: { model: 'Claude Agent', items: [] },
    }
    return {
      ...state,
      projects: touchProject(state.projects, project.id, timestamp),
      threads: [thread, ...state.threads],
    } as S
  }

  private cancelSaveTimer(): void {
    if (this.saveHandle === undefined) return
    this.cancelScheduled(this.saveHandle)
    this.saveHandle = undefined
  }

  private async drainPendingSaves(): Promise<void> {
    while (this.pendingSave) {
      const pending = this.pendingSave
      this.pendingSave = null
      try {
        await this.saveState(pending)
      } catch (error) {
        // Keep the exact failed snapshot available for an explicit retry. A
        // failed save must not make flush() report success or silently lose
        // the Local App definition/tab that was waiting to be persisted.
        if (!this.pendingSave) this.pendingSave = pending
        this.lastDurableFingerprint = ''
        throw error
      }
    }
  }

  private prepareDurableSave(state: ChatWorkspaceState): ChatWorkspaceState | null {
    const stripped = stripRuntimeProjectFields(state)
    const fingerprint = workspaceDurableFingerprint(stripped)
    if (fingerprint === this.lastDurableFingerprint) return null

    const revision = Math.max(workspaceRevisionOf(stripped), this.revisionFloor) + 1
    const durableState = withWorkspaceRevision(stripped, revision)
    this.revisionFloor = revision
    this.lastDurableFingerprint = fingerprint
    return durableState
  }
}

function withActiveWorkspaceTab<S extends WorkspaceMetadataState>(state: S, activeWorkspaceTabId: string): S {
  return { ...state, activeWorkspaceTabId, activeLocalAppTabId: activeWorkspaceTabId } as S
}

function latestVisibleThread<S extends WorkspaceMetadataState>(state: S, projectId: string): S['threads'][number] | undefined {
  return state.threads
    .filter((thread) => thread.projectId === projectId && !thread.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function touchProject(projects: WorkspaceProject[], projectId: string, timestamp: number): WorkspaceProject[] {
  return projects.map((project) =>
    project.id === projectId ? { ...project, updatedAt: timestamp } : project,
  )
}

function titleFromPrompt(prompt: string, fallbackTitle: string): string {
  const firstLine = prompt.trim().split(/\n/)[0]?.trim() || fallbackTitle
  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}...` : firstLine
}

function sameProjectPath(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}

function normalizeComparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isEmptyWorkspace(state: ChatWorkspaceState): boolean {
  return (
    state.activeProjectId === '' &&
    state.activeThreadId === '' &&
    state.projects.length === 0 &&
    state.threads.length === 0
    && (state.runtimeDefinitions?.length ?? 0) === 0
    && (state.workspaceTabs?.length ?? 0) === 0
  )
}
