/** Main-only transactional opener for a WorkspaceTab's durable Project Chat. */

import type { ChatWorkspaceState } from '../src/components/types'
import type { ProjectChatResult } from '../src/project-chat-contract'
import { withNextWorkspaceRevision, workspaceRevisionOf } from '../src/workspace-snapshot-resolution'
import { ensureWorkspaceTabProject } from './workspace-tab-project'

export type WorkspaceTabProjectChatStore = {
  read(): ChatWorkspaceState | null
  save(state: ChatWorkspaceState): Promise<ChatWorkspaceState>
}

export async function openWorkspaceTabProjectChat(
  workspaceTabId: string,
  options: {
    store: WorkspaceTabProjectChatStore
    canonicalizePath(path: string): Promise<string>
    createProjectId(): string
    now(): number
    openProjectWindow(projectId: string): Promise<void>
  },
): Promise<ProjectChatResult<void>> {
  const current = options.store.read()
  if (!current) return error('internal-error', 'Workspace is unavailable.', true)
  const tab = current.workspaceTabs.find((item) => item.id === workspaceTabId)
  if (!tab) return error('invalid-argument', 'Workspace Tab does not exist.')
  const definition = current.runtimeDefinitions.find((item) => item.id === tab.runtimeDefinitionId)
  if (!definition) return error('invalid-argument', 'Workspace Tab Runtime does not exist.')

  const canonicalRoot = definition.canonicalRoot ?? await options.canonicalizePath(definition.rootPath).catch(() => definition.rootPath)
  const canonicalProjectRoots = new Map(await Promise.all(current.projects.map(async (project) => [
    project.id,
    await options.canonicalizePath(project.path).catch(() => project.path),
  ] as const)))
  const resolved = ensureWorkspaceTabProject({
    workspace: current,
    workspaceTabId,
    canonicalRoot,
    now: options.now(),
    createProjectId: options.createProjectId,
    projectPathForMatch: (project) => canonicalProjectRoots.get(project.id) ?? project.path,
  })
  if (!resolved.ok) return error('invalid-argument', resolved.message)

  if (resolved.changed) {
    const proposed = withNextWorkspaceRevision(resolved.workspace, workspaceRevisionOf(current))
    try {
      await options.store.save(proposed)
      const persisted = options.store.read()
      const persistedTab = persisted?.workspaceTabs.find((candidate) => candidate.id === workspaceTabId)
      const persistedProject = persisted?.projects.find((candidate) => candidate.id === resolved.project.id)
      if (!persisted || persistedTab?.projectId !== resolved.project.id || !persistedProject || workspaceRevisionOf(persisted) !== workspaceRevisionOf(proposed)) {
        throw new Error('workspace-tab-project-readback-failed')
      }
    } catch {
      // The only recoverable action is to restore the fresh snapshot. Do not
      // expose a window if either persistence medium rejected the link.
      await options.store.save(current).catch(() => undefined)
      return error('internal-error', 'Workspace Tab Project link could not be saved.', true)
    }
  }

  await options.openProjectWindow(resolved.project.id)
  return { ok: true, value: undefined }
}

function error(code: 'invalid-argument' | 'internal-error', message: string, retryable = false): ProjectChatResult<void> {
  return { ok: false, error: { code, message, retryable } }
}
