import type { ChatModelPick } from '../claude-chat-types'
import type {
  ChatState,
  ChatWorkspaceState,
  TranscriptItem,
  WorkspaceProject,
  WorkspaceThread,
} from './types'
import { stripRuntimeProjectFields } from '../project-path'
import {
  withWorkspaceRevision,
  workspaceDurableFingerprint,
  workspaceRevisionOf,
} from '../workspace-snapshot-resolution'

export type WorkspaceSessionOptions = {
  load: () => Promise<ChatWorkspaceState>
  save: (state: ChatWorkspaceState) => Promise<void>
  saveImmediately?: (state: ChatWorkspaceState) => void | Promise<void>
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancelScheduled?: (handle: unknown) => void
  saveDebounceMs?: number
}

export type WorkspaceSessionActive = {
  project?: WorkspaceProject
  thread?: WorkspaceThread
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
  createdAt?: number
  activate?: boolean
}

export type AddWorkspaceProjectInput = {
  id: string
  name: string
  path: string
  createdAt?: number
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

  return {
    ...state,
    activeProjectId: project.id,
    activeThreadId: requestedProjectHome ? '' : activeThread?.id ?? '',
  }
}

export class WorkspaceSession {
  private readonly loadState: WorkspaceSessionOptions['load']
  private readonly saveState: WorkspaceSessionOptions['save']
  private readonly saveImmediateState: NonNullable<WorkspaceSessionOptions['saveImmediately']>
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
  private disposed = false

  constructor(options: WorkspaceSessionOptions) {
    this.loadState = options.load
    this.saveState = options.save
    this.saveImmediateState = options.saveImmediately ?? (() => {})
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
    if (!project) return {}

    const thread = restored.activeThreadId
      ? restored.threads.find(
          (thread) =>
            thread.id === restored.activeThreadId &&
            thread.projectId === project.id &&
            !thread.archivedAt,
        )
      : undefined
    return { project, thread }
  }

  stage(state: ChatWorkspaceState): void {
    if (this.disposed) return
    if (this.cleared && isEmptyWorkspace(state)) return
    const durableState = this.prepareDurableSave(state)
    if (!durableState) return
    this.cleared = false
    this.pendingSave = durableState
    void this.saveImmediateState(durableState)
    this.cancelSaveTimer()
    this.saveHandle = this.schedule(() => {
      this.saveHandle = undefined
      void this.flush()
    }, this.saveDebounceMs)
  }

  clear(): void {
    this.cleared = true
    this.pendingSave = null
    this.cancelSaveTimer()
  }

  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.cancelSaveTimer()
    if (this.flushPromise) return this.flushPromise
    this.flushPromise = this.drainPendingSaves().finally(() => {
      this.flushPromise = null
    })
    return this.flushPromise
  }

  async close(): Promise<void> {
    if (this.disposed) return
    this.cancelSaveTimer()
    await this.flush()
    this.disposed = true
    this.pendingSave = null
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
    return {
      ...state,
      activeProjectId: thread.projectId,
      activeThreadId: thread.id,
    }
  }

  selectProject(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    if (!state.projects.some((project) => project.id === projectId)) return state
    return {
      ...state,
      activeProjectId: projectId,
      activeThreadId: '',
    }
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
      chatState: input.chatState,
    }
    return {
      ...state,
      activeProjectId: input.activate === false ? state.activeProjectId : input.projectId,
      activeThreadId: input.activate === false ? state.activeThreadId : input.id,
      projects: touchProject(state.projects, input.projectId, timestamp),
      threads: [thread, ...state.threads],
    }
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
    if (state.projects.some((project) => project.id === input.id)) return state
    const timestamp = input.createdAt ?? this.now()
    const project: WorkspaceProject = {
      id: input.id,
      name: input.name,
      path: input.path,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return {
      ...state,
      activeProjectId: input.id,
      activeThreadId: '',
      projects: [project, ...state.projects],
      sidebarPrefs: {
        ...state.sidebarPrefs,
        projectOrderIds: [input.id, ...orderedProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)],
      },
    }
  }

  removeProject(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
    if (state.projects.length <= 1) return state
    if (!state.projects.some((project) => project.id === projectId)) return state
    const projects = state.projects.filter((project) => project.id !== projectId)
    return {
      ...state,
      projects,
      threads: state.threads.filter((thread) => thread.projectId !== projectId),
      activeProjectId: state.activeProjectId === projectId ? projects[0]?.id ?? '' : state.activeProjectId,
      activeThreadId: state.activeProjectId === projectId ? '' : state.activeThreadId,
      sidebarPrefs: {
        ...state.sidebarPrefs,
        collapsedProjectIds: state.sidebarPrefs.collapsedProjectIds.filter((id) => id !== projectId),
        projectOrderIds: state.sidebarPrefs.projectOrderIds.filter((id) => id !== projectId),
      },
    }
  }

  relocateProject(state: ChatWorkspaceState, projectId: string, path: string): ChatWorkspaceState {
    const timestamp = this.now()
    let changed = false
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) return project
      changed = true
      return { ...project, path, pathMissing: undefined, updatedAt: timestamp }
    })
    return changed ? { ...state, projects } : state
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
    const timestamp = this.now()
    const currentOrder = orderedProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, pinnedAt: project.pinnedAt ? undefined : timestamp, updatedAt: timestamp }
          : project,
      ),
      sidebarPrefs: {
        ...state.sidebarPrefs,
        projectOrderIds: target.pinnedAt
          ? currentOrder
          : [projectId, ...currentOrder.filter((id) => id !== projectId)],
      },
    }
  }

  reorderProject(
    state: ChatWorkspaceState,
    projectId: string,
    targetProjectId: string,
    position: 'before' | 'after',
  ): ChatWorkspaceState {
    if (projectId === targetProjectId) return state
    const projectIds = new Set(state.projects.map((project) => project.id))
    if (!projectIds.has(projectId) || !projectIds.has(targetProjectId)) return state
    const currentOrder = orderedProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)
    const withoutDragged = currentOrder.filter((id) => id !== projectId)
    const targetIndex = withoutDragged.indexOf(targetProjectId)
    if (targetIndex === -1) return state
    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
    const nextOrder = [...withoutDragged.slice(0, insertIndex), projectId, ...withoutDragged.slice(insertIndex)]
    if (nextOrder.join('\n') === currentOrder.join('\n')) return state
    return {
      ...state,
      sidebarPrefs: { ...state.sidebarPrefs, projectOrderIds: nextOrder },
    }
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
    while (this.pendingSave && !this.disposed) {
      const pending = this.pendingSave
      this.pendingSave = null
      await this.saveState(pending)
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

function orderedProjectIds(projects: WorkspaceProject[], persistedOrder: readonly string[]): string[] {
  const projectIds = new Set(projects.map((project) => project.id))
  const ordered = persistedOrder.filter((id) => projectIds.has(id))
  const orderedSet = new Set(ordered)
  const remaining = projects
    .filter((project) => !orderedSet.has(project.id))
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.createdAt - a.createdAt)
    .map((project) => project.id)
  return [...ordered, ...remaining]
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
  )
}
