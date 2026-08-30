import type { ChatModelPick } from '../claude-chat-types'
import type { ProjectChatClientEvent, ProjectChatSnapshot, ProjectChatThreadSnapshot, ProjectChatTranscriptItem } from '../project-chat-contract'
import type {
  ChatState,
  ChatWorkspaceState,
  RuntimeDefinition,
  WorkspaceTab,
  TranscriptItem,
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

export type WorkspaceSessionActive = {
  project?: WorkspaceProject
  thread?: WorkspaceThread
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
  chatState: ChatState
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

/** Applies a redacted broker projection without using it as a writable workspace snapshot. */
export function applyProjectChatSnapshot(state: ChatWorkspaceState, snapshot: ProjectChatSnapshot): ChatWorkspaceState {
  const existingProject = state.projects.find((project) => project.id === snapshot.projectId)
  if (!existingProject) return state
  const project = {
    ...existingProject,
    name: snapshot.project.name,
    pathMissing: snapshot.project.pathMissing || undefined,
  }
  const projectedThreads = snapshot.threads.map(projectChatThreadToWorkspaceThread)
  return {
    ...state,
    workspaceRevision: Math.max(state.workspaceRevision, snapshot.workspaceRevision),
    projects: state.projects.map((candidate) => candidate.id === snapshot.projectId ? project : candidate),
    threads: [...state.threads.filter((thread) => thread.projectId !== snapshot.projectId), ...projectedThreads],
  }
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

export function restoreWorkspaceSessionState(state: ChatWorkspaceState): ChatWorkspaceState {
  if (state.projects.length === 0) {
    return { ...state, activeProjectId: '', activeThreadId: '' }
  }

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId)
  const project =
    activeProject && !activeProject.pathMissing
      ? activeProject
      : state.projects.find((candidate) => !candidate.pathMissing) ??
        activeProject ??
        state.projects[0]

  if (!project) {
    return { ...state, activeProjectId: '', activeThreadId: '' }
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

  restore(state: ChatWorkspaceState): ChatWorkspaceState {
    return restoreWorkspaceSessionState(state)
  }

  active(state: ChatWorkspaceState): WorkspaceSessionActive {
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

  selectThread(state: ChatWorkspaceState, threadId: string): ChatWorkspaceState {
    const thread = state.threads.find((item) => item.id === threadId && !item.archivedAt)
    if (!thread) return state
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: thread.projectId,
      activeThreadId: thread.id,
    }, '')
  }

  selectProject(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    if (!state.projects.some((project) => project.id === projectId)) return state
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: projectId,
      activeThreadId: '',
    }, '')
  }

  addThread(state: ChatWorkspaceState, input: AddWorkspaceThreadInput): ChatWorkspaceState {
    if (!state.projects.some((project) => project.id === input.projectId)) return state
    if (state.threads.some((thread) => thread.id === input.id)) return state
    const timestamp = input.createdAt ?? this.now()
    const thread: WorkspaceThread = {
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
      chatState: input.chatState,
    }
    return withActiveWorkspaceTab({
      ...state,
      activeProjectId: input.activate === false ? state.activeProjectId : input.projectId,
      activeThreadId: input.activate === false ? state.activeThreadId : input.id,
      projects: touchProject(state.projects, input.projectId, timestamp),
      threads: [thread, ...state.threads],
    }, input.activate === false ? state.activeWorkspaceTabId : '')
  }

  forkThread(
    state: ChatWorkspaceState,
    input: {
      id: string
      projectId: string
      title: string
      items: TranscriptItem[]
      model?: string
      modelPick?: ChatModelPick
      createdAt?: number
    },
  ): ChatWorkspaceState {
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

  archiveThread(state: ChatWorkspaceState, threadId: string): ChatWorkspaceState {
    const current = state.threads.find((thread) => thread.id === threadId)
    if (!current || current.archivedAt) return state
    const timestamp = this.now()
    const threads = state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, archivedAt: timestamp, updatedAt: timestamp } : thread,
    )
    if (state.activeThreadId !== threadId) return { ...state, threads }

    const nextState = { ...state, threads }
    const nextActive = latestVisibleThread(nextState, current.projectId)
    return {
      ...nextState,
      activeProjectId: current.projectId,
      activeThreadId: nextActive?.id ?? '',
    }
  }

  addProject(state: ChatWorkspaceState, input: AddWorkspaceProjectInput): ChatWorkspaceState {
    // Shared with the Main-owned `project.create` command so both writers agree.
    return createWorkspaceProject(input, state, input.createdAt ?? this.now())
  }

  /** Add a trusted definition and its first view atomically after user confirmation. */
  addRuntime(state: ChatWorkspaceState, input: AddRuntimeInput): ChatWorkspaceState {
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
    }, input.activate === false ? state.activeWorkspaceTabId : tab.id)
  }

  addWorkspaceTab(state: ChatWorkspaceState, tab: WorkspaceTab, activate = true): ChatWorkspaceState {
    if (!state.runtimeDefinitions.some((item) => item.id === tab.runtimeDefinitionId && item.owner?.kind !== 'project')) return state
    if (state.workspaceTabs.some((item) => item.id === tab.id)) return state
    return withActiveWorkspaceTab({
      ...state,
      workspaceTabs: [tab, ...state.workspaceTabs],
    }, activate ? tab.id : state.activeWorkspaceTabId)
  }

  selectWorkspaceTab(state: ChatWorkspaceState, tabId: string): ChatWorkspaceState {
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

  closeWorkspaceTab(state: ChatWorkspaceState, tabId: string): ChatWorkspaceState {
    const index = state.workspaceTabs.findIndex((item) => item.id === tabId)
    if (index < 0) return state
    const tabs = state.workspaceTabs.filter((item) => item.id !== tabId)
    if (state.activeWorkspaceTabId !== tabId) return { ...state, workspaceTabs: tabs }
    const fallback = tabs[Math.min(index, tabs.length - 1)]
    return withActiveWorkspaceTab({ ...state, workspaceTabs: tabs }, fallback?.id ?? '')
  }

  removeRuntime(state: ChatWorkspaceState, runtimeDefinitionId: string): ChatWorkspaceState {
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
    }, activeTabId)
  }

  renameWorkspaceTab(state: ChatWorkspaceState, tabId: string, title: string): ChatWorkspaceState {
    const nextTitle = title.trim()
    if (nextTitle.length < 1 || nextTitle.length > 64) return state
    if (!state.workspaceTabs.some((item) => item.id === tabId)) return state
    return {
      ...state,
      workspaceTabs: state.workspaceTabs.map((tab) => tab.id === tabId ? { ...tab, title: nextTitle, updatedAt: this.now() } : tab),
    }
  }

  setProjectHomeViewMode(state: ChatWorkspaceState, projectId: string, mode: 'overview' | 'runtime'): ChatWorkspaceState {
    if (!state.projects.some((project) => project.id === projectId)) return state
    return { ...state, projectHomeViewModes: { ...state.projectHomeViewModes, [projectId]: mode } }
  }

  /** @deprecated Compatibility wrappers for the Revision 1 renderer. */
  selectLocalAppTab(state: ChatWorkspaceState, tabId: string): ChatWorkspaceState {
    return this.selectWorkspaceTab(state, tabId)
  }

  /** @deprecated Compatibility wrappers for the Revision 1 renderer. */
  removeLocalApp(state: ChatWorkspaceState, runtimeDefinitionId: string): ChatWorkspaceState {
    return this.removeRuntime(state, runtimeDefinitionId)
  }

  removeProject(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    return removeWorkspaceProject(state, projectId)
  }

  relocateProject(state: ChatWorkspaceState, projectId: string, path: string): ChatWorkspaceState {
    return relocateWorkspaceProject(state, projectId, path, this.now())
  }

  toggleThreadPinned(state: ChatWorkspaceState, threadId: string): ChatWorkspaceState {
    const timestamp = this.now()
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, pinnedAt: thread.pinnedAt ? undefined : timestamp } : thread,
      ),
    }
  }

  toggleProjectPinned(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    const target = state.projects.find((project) => project.id === projectId)
    if (!target) return state
    return setWorkspaceProjectPinned(state, projectId, !target.pinnedAt, this.now())
  }

  reorderProject(
    state: ChatWorkspaceState,
    projectId: string,
    targetProjectId: string,
    position: 'before' | 'after',
  ): ChatWorkspaceState {
    return reorderWorkspaceProject(state, projectId, targetProjectId, position)
  }

  toggleSidebar(state: ChatWorkspaceState): ChatWorkspaceState {
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsed: !state.sidebarPrefs.collapsed },
    }
  }

  toggleProjectCollapsed(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    const collapsedProjectIds = new Set(state.sidebarPrefs.collapsedProjectIds)
    if (collapsedProjectIds.has(projectId)) collapsedProjectIds.delete(projectId)
    else collapsedProjectIds.add(projectId)
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsedProjectIds: [...collapsedProjectIds] },
    }
  }

  pruneCollapsedProjects(state: ChatWorkspaceState): ChatWorkspaceState {
    const projectIds = new Set(state.projects.map((project) => project.id))
    const collapsedProjectIds = state.sidebarPrefs.collapsedProjectIds.filter((id) => projectIds.has(id))
    if (collapsedProjectIds.length === state.sidebarPrefs.collapsedProjectIds.length) return state
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, collapsedProjectIds },
    }
  }

  markPromptSubmitted(
    state: ChatWorkspaceState,
    threadId: string,
    prompt: string,
    untitledTitles: ReadonlySet<string>,
    fallbackTitle: string,
  ): ChatWorkspaceState {
    const timestamp = this.now()
    return {
      ...state,
      threads: state.threads.map((thread) => {
        if (thread.id !== threadId) return thread
        const hasUserMessage = thread.chatState.items.some(
          (item) => item.type === 'message' && item.role === 'user',
        )
        return {
          ...thread,
          title:
            untitledTitles.has(thread.title) && !hasUserMessage
              ? titleFromPrompt(prompt, fallbackTitle)
              : thread.title,
          updatedAt: timestamp,
        }
      }),
    }
  }

  ensureTaskRunThread(
    state: ChatWorkspaceState,
    input: EnsureTaskRunThreadInput,
  ): ChatWorkspaceState {
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
      }
    }

    const thread: WorkspaceThread = {
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
    }
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

function withActiveWorkspaceTab(state: ChatWorkspaceState, activeWorkspaceTabId: string): ChatWorkspaceState {
  return { ...state, activeWorkspaceTabId, activeLocalAppTabId: activeWorkspaceTabId }
}

function latestVisibleThread(state: ChatWorkspaceState, projectId: string): WorkspaceThread | undefined {
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
