/**
 * Main-owned durable WorkspaceTab -> Project binding rules.
 *
 * This module is intentionally filesystem-free. Callers must fresh-read the
 * workspace and provide a normalized Runtime root before committing the result
 * in the ChatWorkspaceCoordinator.
 */

import path from 'node:path'
import type { ChatWorkspaceState, RuntimeDefinition, WorkspaceProject, WorkspaceTab } from '../src/components/types'

export type WorkspaceTabProjectResolution =
  | { ok: true; workspace: ChatWorkspaceState; project: WorkspaceProject; changed: boolean }
  | { ok: false; code: 'workspace-tab-missing' | 'runtime-definition-missing' | 'workspace-tab-project-ambiguous'; message: string }

export type EnsureWorkspaceTabProjectOptions = {
  workspace: ChatWorkspaceState
  workspaceTabId: string
  canonicalRoot: string
  now: number
  createProjectId: () => string
  projectPathForMatch?: (project: WorkspaceProject) => string
}

/** Resolves platform spelling differences without accepting renderer path data. */
export function normalizeWorkspaceProjectPath(value: string): string {
  return path.normalize(path.resolve(value)).replace(/[\\/]+$/, '') || path.parse(path.resolve(value)).root
}

export function ensureWorkspaceTabProject(options: EnsureWorkspaceTabProjectOptions): WorkspaceTabProjectResolution {
  const tab = options.workspace.workspaceTabs.find((item) => item.id === options.workspaceTabId)
  if (!tab) return { ok: false, code: 'workspace-tab-missing', message: 'Workspace Tab 不存在或已关闭' }
  const definition = options.workspace.runtimeDefinitions.find((item) => item.id === tab.runtimeDefinitionId)
  if (!definition) return { ok: false, code: 'runtime-definition-missing', message: 'Workspace Tab 对应的 Runtime 不存在' }

  const root = normalizeWorkspaceProjectPath(options.canonicalRoot)
  const matches = options.workspace.projects.filter((project) =>
    normalizeWorkspaceProjectPath(options.projectPathForMatch?.(project) ?? project.path) === root,
  )
  if (matches.length > 1) {
    return { ok: false, code: 'workspace-tab-project-ambiguous', message: 'Workspace Tab 对应目录存在多个 Project，无法安全打开 Chat' }
  }

  const linked = tab.projectId ? options.workspace.projects.find((project) => project.id === tab.projectId) : undefined
  const project = matches[0] ?? createBackingProject(tab, definition, root, options)
  const changed = tab.projectId !== project.id || !matches[0]
  if (!changed) return { ok: true, workspace: options.workspace, project, changed: false }

  const projects = matches[0] ? options.workspace.projects : [project, ...options.workspace.projects]
  const projectOrderIds = matches[0]
    ? options.workspace.sidebarPrefs.projectOrderIds
    : [project.id, ...options.workspace.sidebarPrefs.projectOrderIds.filter((id) => id !== project.id)]
  const workspaceTabs = options.workspace.workspaceTabs.map((candidate) =>
    candidate.id === tab.id ? { ...candidate, projectId: project.id, updatedAt: options.now } : candidate,
  )
  // A dangling/wrong tab.projectId is deliberately repaired by canonical root;
  // `linked` is only read to make that intent clear and must never win by itself.
  void linked
  return {
    ok: true,
    workspace: { ...options.workspace, projects, workspaceTabs, sidebarPrefs: { ...options.workspace.sidebarPrefs, projectOrderIds } },
    project,
    changed: true,
  }
}

function createBackingProject(
  tab: WorkspaceTab,
  definition: RuntimeDefinition,
  canonicalRoot: string,
  options: EnsureWorkspaceTabProjectOptions,
): WorkspaceProject {
  const id = options.createProjectId()
  const name = tab.title.trim() || definition.name.trim() || path.basename(canonicalRoot) || 'Runtime'
  return { id, name, path: canonicalRoot, createdAt: options.now, updatedAt: options.now }
}
