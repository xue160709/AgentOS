/**
 * Main-owned durable workspace commands.
 *
 * `FIX-WS-01`: project lifecycle and sidebar/home preferences used to be
 * mutated by the renderer's `WorkspaceSession` and persisted by its autosave.
 * The Project Chat cutover disabled that autosave, so those mutations stopped
 * reaching Main at all.  This module is the single pure definition of those
 * transitions; Main applies it inside the workspace operation coordinator and
 * the renderer only submits intents.
 *
 * The command union deliberately carries **no** snapshot payload (no threads,
 * projects, chatState or revision).  Main always derives durable content from
 * its own store, so a redacted renderer projection can never be written back.
 */

import type { ChatWorkspaceState, ProjectHomeViewMode, WorkspaceProject } from './components/types'

export type WorkspaceCommand =
  | { type: 'project.create'; name: string; path: string }
  | { type: 'project.remove'; projectId: string }
  | { type: 'project.relocate'; projectId: string; path: string }
  | { type: 'project.setPinned'; projectId: string; pinned: boolean }
  | { type: 'project.reorder'; projectId: string; targetProjectId: string; position: 'before' | 'after' }
  | {
      type: 'preferences.set'
      sidebarCollapsed?: boolean
      collapsedProjectIds?: string[]
      projectHomeViewModes?: Record<string, ProjectHomeViewMode>
    }

export type WorkspaceCommandType = WorkspaceCommand['type']

export type WorkspaceCommandErrorCode =
  | 'invalid-command'
  | 'workspace-unavailable'
  | 'workspace-conflict'
  | 'project-missing'
  | 'project-last-remaining'
  | 'workspace-save-failed'

export type WorkspaceCommandResult =
  | { ok: true; workspace: ChatWorkspaceState; projectId?: string }
  | { ok: false; code: WorkspaceCommandErrorCode; message: string }

export type WorkspaceCommandApplyResult =
  | { ok: true; state: ChatWorkspaceState; changed: boolean; projectId?: string }
  | { ok: false; code: WorkspaceCommandErrorCode; message: string }

export type WorkspaceCommandContext = {
  now: number
  createProjectId: () => string
}

const MAX_NAME_LENGTH = 120
const MAX_PATH_LENGTH = 4_096
const MAX_ID_LENGTH = 200
const MAX_COLLAPSED_IDS = 2_000

/** Allowed keys per variant. Anything else is rejected, never ignored. */
const COMMAND_KEYS: Record<WorkspaceCommandType, readonly string[]> = {
  'project.create': ['type', 'name', 'path'],
  'project.remove': ['type', 'projectId'],
  'project.relocate': ['type', 'projectId', 'path'],
  'project.setPinned': ['type', 'projectId', 'pinned'],
  'project.reorder': ['type', 'projectId', 'targetProjectId', 'position'],
  'preferences.set': ['type', 'sidebarCollapsed', 'collapsedProjectIds', 'projectHomeViewModes'],
}

function invalid(message: string): { ok: false; code: 'invalid-command'; message: string } {
  return { ok: false, code: 'invalid-command', message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(value: unknown, label: string): { ok: true; value: string } | { ok: false; code: 'invalid-command'; message: string } {
  if (typeof value !== 'string') return invalid(`${label} 无效`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ID_LENGTH) return invalid(`${label} 无效`)
  return { ok: true, value: trimmed }
}

/**
 * Strict parser. Unknown or extra keys fail the whole command; there is no
 * lenient path that silently drops a field.
 */
export function parseWorkspaceCommand(
  value: unknown,
): { ok: true; command: WorkspaceCommand } | { ok: false; code: 'invalid-command'; message: string } {
  if (!isRecord(value)) return invalid('工作区命令无效')
  const type = value.type
  if (typeof type !== 'string' || !(type in COMMAND_KEYS)) return invalid('工作区命令类型无效')
  const allowed = COMMAND_KEYS[type as WorkspaceCommandType]
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return invalid(`工作区命令包含不允许的字段：${key}`)
  }

  if (type === 'project.create') {
    if (typeof value.name !== 'string') return invalid('项目名称无效')
    const name = value.name.trim()
    if (!name || name.length > MAX_NAME_LENGTH) return invalid('项目名称无效')
    if (typeof value.path !== 'string') return invalid('项目路径无效')
    const path = value.path.trim()
    if (!path || path.length > MAX_PATH_LENGTH) return invalid('项目路径无效')
    return { ok: true, command: { type, name, path } }
  }

  if (type === 'project.remove') {
    const projectId = readId(value.projectId, '项目标识')
    if (!projectId.ok) return projectId
    return { ok: true, command: { type, projectId: projectId.value } }
  }

  if (type === 'project.relocate') {
    const projectId = readId(value.projectId, '项目标识')
    if (!projectId.ok) return projectId
    if (typeof value.path !== 'string') return invalid('项目路径无效')
    const path = value.path.trim()
    if (!path || path.length > MAX_PATH_LENGTH) return invalid('项目路径无效')
    return { ok: true, command: { type, projectId: projectId.value, path } }
  }

  if (type === 'project.setPinned') {
    const projectId = readId(value.projectId, '项目标识')
    if (!projectId.ok) return projectId
    if (typeof value.pinned !== 'boolean') return invalid('置顶目标值必须是布尔值')
    return { ok: true, command: { type, projectId: projectId.value, pinned: value.pinned } }
  }

  if (type === 'project.reorder') {
    const projectId = readId(value.projectId, '项目标识')
    if (!projectId.ok) return projectId
    const targetProjectId = readId(value.targetProjectId, '目标项目标识')
    if (!targetProjectId.ok) return targetProjectId
    if (value.position !== 'before' && value.position !== 'after') return invalid('排序位置无效')
    return { ok: true, command: { type, projectId: projectId.value, targetProjectId: targetProjectId.value, position: value.position } }
  }

  const command: WorkspaceCommand = { type: 'preferences.set' }
  if (value.sidebarCollapsed !== undefined) {
    if (typeof value.sidebarCollapsed !== 'boolean') return invalid('侧栏折叠状态无效')
    command.sidebarCollapsed = value.sidebarCollapsed
  }
  if (value.collapsedProjectIds !== undefined) {
    if (!Array.isArray(value.collapsedProjectIds) || value.collapsedProjectIds.length > MAX_COLLAPSED_IDS) return invalid('折叠项目列表无效')
    const ids: string[] = []
    for (const entry of value.collapsedProjectIds) {
      const id = readId(entry, '折叠项目标识')
      if (!id.ok) return id
      if (!ids.includes(id.value)) ids.push(id.value)
    }
    command.collapsedProjectIds = ids
  }
  if (value.projectHomeViewModes !== undefined) {
    if (!isRecord(value.projectHomeViewModes)) return invalid('项目首页视图模式无效')
    const modes: Record<string, ProjectHomeViewMode> = {}
    for (const [key, mode] of Object.entries(value.projectHomeViewModes)) {
      const id = readId(key, '项目标识')
      if (!id.ok) return id
      if (mode !== 'overview' && mode !== 'runtime') return invalid('项目首页视图模式无效')
      modes[id.value] = mode
    }
    command.projectHomeViewModes = modes
  }
  if (
    command.sidebarCollapsed === undefined &&
    command.collapsedProjectIds === undefined &&
    command.projectHomeViewModes === undefined
  ) {
    return invalid('偏好命令至少需要一个字段')
  }
  return { ok: true, command }
}

/** Stable sidebar order: persisted manual order first, then pinned + recency. */
export function orderedWorkspaceProjectIds(
  projects: readonly WorkspaceProject[],
  persistedOrder: readonly string[],
): string[] {
  const projectIds = new Set(projects.map((project) => project.id))
  const ordered = persistedOrder.filter((id) => projectIds.has(id))
  const orderedSet = new Set(ordered)
  const remaining = projects
    .filter((project) => !orderedSet.has(project.id))
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.createdAt - a.createdAt)
    .map((project) => project.id)
  return [...ordered, ...remaining]
}

function withActiveWorkspaceTab(state: ChatWorkspaceState, activeWorkspaceTabId: string): ChatWorkspaceState {
  return { ...state, activeWorkspaceTabId, activeLocalAppTabId: activeWorkspaceTabId }
}

export function createWorkspaceProject(
  input: { id: string; name: string; path: string },
  state: ChatWorkspaceState,
  now: number,
): ChatWorkspaceState {
  if (state.projects.some((project) => project.id === input.id)) return state
  const project: WorkspaceProject = {
    id: input.id,
    name: input.name,
    path: input.path,
    createdAt: now,
    updatedAt: now,
  }
  return withActiveWorkspaceTab({
    ...state,
    activeProjectId: input.id,
    activeThreadId: '',
    projects: [project, ...state.projects],
    sidebarPrefs: {
      ...state.sidebarPrefs,
      projectOrderIds: [input.id, ...orderedWorkspaceProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)],
    },
  }, '')
}

export function removeWorkspaceProject(state: ChatWorkspaceState, projectId: string): ChatWorkspaceState {
  if (state.projects.length <= 1) return state
  if (!state.projects.some((project) => project.id === projectId)) return state
  const projects = state.projects.filter((project) => project.id !== projectId)
  const projectHomeViewModes = { ...(state.projectHomeViewModes ?? {}) }
  delete projectHomeViewModes[projectId]
  return {
    ...state,
    projects,
    threads: state.threads.filter((thread) => thread.projectId !== projectId),
    runtimeDefinitions: (state.runtimeDefinitions ?? []).filter(
      (definition) => definition.owner?.kind !== 'project' || definition.owner.projectId !== projectId,
    ),
    projectHomeViewModes,
    activeProjectId: state.activeProjectId === projectId ? projects[0]?.id ?? '' : state.activeProjectId,
    activeThreadId: state.activeProjectId === projectId ? '' : state.activeThreadId,
    sidebarPrefs: {
      ...state.sidebarPrefs,
      collapsedProjectIds: state.sidebarPrefs.collapsedProjectIds.filter((id) => id !== projectId),
      projectOrderIds: state.sidebarPrefs.projectOrderIds.filter((id) => id !== projectId),
    },
  }
}

export function relocateWorkspaceProject(
  state: ChatWorkspaceState,
  projectId: string,
  path: string,
  now: number,
): ChatWorkspaceState {
  let changed = false
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) return project
    changed = true
    return { ...project, path, pathMissing: undefined, updatedAt: now }
  })
  return changed ? { ...state, projects } : state
}

export function setWorkspaceProjectPinned(
  state: ChatWorkspaceState,
  projectId: string,
  pinned: boolean,
  now: number,
): ChatWorkspaceState {
  const target = state.projects.find((project) => project.id === projectId)
  if (!target) return state
  if (Boolean(target.pinnedAt) === pinned) return state
  const currentOrder = orderedWorkspaceProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId ? { ...project, pinnedAt: pinned ? now : undefined, updatedAt: now } : project,
    ),
    sidebarPrefs: {
      ...state.sidebarPrefs,
      projectOrderIds: pinned ? [projectId, ...currentOrder.filter((id) => id !== projectId)] : currentOrder,
    },
  }
}

export function reorderWorkspaceProject(
  state: ChatWorkspaceState,
  projectId: string,
  targetProjectId: string,
  position: 'before' | 'after',
): ChatWorkspaceState {
  if (projectId === targetProjectId) return state
  const projectIds = new Set(state.projects.map((project) => project.id))
  if (!projectIds.has(projectId) || !projectIds.has(targetProjectId)) return state
  const currentOrder = orderedWorkspaceProjectIds(state.projects, state.sidebarPrefs.projectOrderIds)
  const withoutDragged = currentOrder.filter((id) => id !== projectId)
  const targetIndex = withoutDragged.indexOf(targetProjectId)
  if (targetIndex === -1) return state
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
  const nextOrder = [...withoutDragged.slice(0, insertIndex), projectId, ...withoutDragged.slice(insertIndex)]
  if (nextOrder.join('\n') === currentOrder.join('\n')) return state
  return { ...state, sidebarPrefs: { ...state.sidebarPrefs, projectOrderIds: nextOrder } }
}

export function setWorkspacePreferences(
  state: ChatWorkspaceState,
  patch: {
    sidebarCollapsed?: boolean
    collapsedProjectIds?: readonly string[]
    projectHomeViewModes?: Record<string, ProjectHomeViewMode>
  },
): ChatWorkspaceState {
  const projectIds = new Set(state.projects.map((project) => project.id))
  const sidebarPrefs = {
    ...state.sidebarPrefs,
    collapsed: patch.sidebarCollapsed ?? state.sidebarPrefs.collapsed,
    collapsedProjectIds: patch.collapsedProjectIds
      ? patch.collapsedProjectIds.filter((id) => projectIds.has(id))
      : state.sidebarPrefs.collapsedProjectIds,
  }
  // Unknown projects are dropped rather than rejected: a stale renderer view
  // must not be able to resurrect a removed project id in durable prefs.
  const projectHomeViewModes = patch.projectHomeViewModes
    ? {
        ...(state.projectHomeViewModes ?? {}),
        ...Object.fromEntries(
          Object.entries(patch.projectHomeViewModes).filter(([projectId]) => projectIds.has(projectId)),
        ),
      }
    : state.projectHomeViewModes
  return { ...state, sidebarPrefs, projectHomeViewModes }
}

export function applyWorkspaceCommand(
  state: ChatWorkspaceState,
  command: WorkspaceCommand,
  context: WorkspaceCommandContext,
): WorkspaceCommandApplyResult {
  if (command.type === 'project.create') {
    const projectId = context.createProjectId()
    const next = createWorkspaceProject({ id: projectId, name: command.name, path: command.path }, state, context.now)
    if (next === state) return { ok: false, code: 'invalid-command', message: '项目标识冲突，请重试' }
    return { ok: true, state: next, changed: true, projectId }
  }

  if (command.type === 'project.remove') {
    if (!state.projects.some((project) => project.id === command.projectId)) {
      return { ok: false, code: 'project-missing', message: '项目不存在' }
    }
    if (state.projects.length <= 1) {
      return { ok: false, code: 'project-last-remaining', message: '至少需要保留一个项目' }
    }
    const next = removeWorkspaceProject(state, command.projectId)
    return { ok: true, state: next, changed: next !== state, projectId: command.projectId }
  }

  if (command.type === 'project.relocate') {
    if (!state.projects.some((project) => project.id === command.projectId)) {
      return { ok: false, code: 'project-missing', message: '项目不存在' }
    }
    const next = relocateWorkspaceProject(state, command.projectId, command.path, context.now)
    return { ok: true, state: next, changed: next !== state, projectId: command.projectId }
  }

  if (command.type === 'project.setPinned') {
    if (!state.projects.some((project) => project.id === command.projectId)) {
      return { ok: false, code: 'project-missing', message: '项目不存在' }
    }
    const next = setWorkspaceProjectPinned(state, command.projectId, command.pinned, context.now)
    return { ok: true, state: next, changed: next !== state, projectId: command.projectId }
  }

  if (command.type === 'project.reorder') {
    const known = new Set(state.projects.map((project) => project.id))
    if (!known.has(command.projectId) || !known.has(command.targetProjectId)) {
      return { ok: false, code: 'project-missing', message: '项目不存在' }
    }
    const next = reorderWorkspaceProject(state, command.projectId, command.targetProjectId, command.position)
    return { ok: true, state: next, changed: next !== state, projectId: command.projectId }
  }

  const next = setWorkspacePreferences(state, command)
  return { ok: true, state: next, changed: next !== state }
}

/** Readback assertion shared by Main and its tests. */
export function workspaceCommandApplied(
  persisted: ChatWorkspaceState,
  command: WorkspaceCommand,
  projectId?: string,
): boolean {
  switch (command.type) {
    case 'project.create':
      return Boolean(projectId) && persisted.projects.some((project) => project.id === projectId)
    case 'project.remove':
      return !persisted.projects.some((project) => project.id === command.projectId)
    case 'project.relocate':
      return persisted.projects.some((project) => project.id === command.projectId && project.path === command.path)
    case 'project.setPinned':
      return persisted.projects.some(
        (project) => project.id === command.projectId && Boolean(project.pinnedAt) === command.pinned,
      )
    case 'project.reorder': {
      const order = orderedWorkspaceProjectIds(persisted.projects, persisted.sidebarPrefs.projectOrderIds)
      const from = order.indexOf(command.projectId)
      const to = order.indexOf(command.targetProjectId)
      if (from < 0 || to < 0) return false
      return command.position === 'before' ? from < to : from > to
    }
    case 'preferences.set': {
      if (command.sidebarCollapsed !== undefined && persisted.sidebarPrefs.collapsed !== command.sidebarCollapsed) return false
      if (command.projectHomeViewModes) {
        const known = new Set(persisted.projects.map((project) => project.id))
        for (const [id, mode] of Object.entries(command.projectHomeViewModes)) {
          if (known.has(id) && persisted.projectHomeViewModes?.[id] !== mode) return false
        }
      }
      return true
    }
  }
}
