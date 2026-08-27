import path from 'node:path'
import type { ChatModelPick, ClaudeAgentSettingsSnapshot, ClaudeAgentStatusRequest, ClaudeAgentStatusSnapshot, ClaudeChatSubmitPayload, ClaudePermissionResponsePayload, ClaudeFileRewindPayload, ClaudeFileRewindResult } from '../src/claude-chat-types'
import { normalizeProjectChatRelativePath, projectChatBasename, type GetProjectChatThreadStatusInput, type ProjectChatAgentContext, type ProjectChatAttachmentSelection, type ProjectChatFileSearchItem, type ProjectChatModelCatalog, type ProjectChatThreadStatus, type ReadProjectChatAttachmentsInput, type SearchProjectChatFilesInput } from '../src/project-chat-contract'
import type { ChatWorkspaceState } from '../src/components/types'

export type ProjectChatRunnerLike = {
  submit(payload: ClaudeChatSubmitPayload): { requestId: string } | Promise<{ requestId: string }>
  cancel(requestId?: string): Promise<void>
  answerPermissionRequest(payload: ClaudePermissionResponsePayload): Promise<void>
  newThread(threadId?: string): Promise<void>
  getStatus(payload?: ClaudeAgentStatusRequest): Promise<ClaudeAgentStatusSnapshot>
  rewindFiles(payload: ClaudeFileRewindPayload): Promise<ClaudeFileRewindResult>
}

/** Stateless adapter: Project Chat keeps neither SDK events nor request ownership here. */
export function createProjectChatBrokerRunnerAdapter(runner: ProjectChatRunnerLike) {
  return {
    submit: (payload: ClaudeChatSubmitPayload) => runner.submit(payload),
    cancel: (requestId?: string) => runner.cancel(requestId),
    answerPermissionRequest: (payload: ClaudePermissionResponsePayload) => runner.answerPermissionRequest(payload),
    resetThread: (threadId: string) => runner.newThread(threadId),
    rewindFiles: (payload: ClaudeFileRewindPayload) => runner.rewindFiles(payload),
  }
}

type WorkspaceReader = { read(): ChatWorkspaceState | null }
type RawAttachmentSelection = { attachments: unknown[]; skipped: unknown[] }

export type ProjectChatScopedReadOptions = {
  workspace: WorkspaceReader
  settings: { getSnapshot(): ClaudeAgentSettingsSnapshot }
  runner: Pick<ProjectChatRunnerLike, 'getStatus'>
  discoverAgentContext(rootPath: string): Promise<unknown>
  searchProjectFiles(rootPath: string, query: string): Promise<unknown>
  pickAttachments(allowImages: boolean): Promise<unknown>
  readAttachments(filePaths: string[], allowImages: boolean): Promise<unknown>
  realpath(input: string): Promise<string>
}

export function createProjectChatScopedReadCollaborator(options: ProjectChatScopedReadOptions) {
  const projectPath = (projectId: string) => {
    const state = options.workspace.read()
    const project = state?.projects.find((item) => item.id === projectId)
    return state && project && !project.pathMissing && project.path.trim() ? { state, project, path: project.path } : null
  }
  return {
    async getModelCatalog(): Promise<ProjectChatModelCatalog> {
      const { settings } = options.settings.getSnapshot()
      return {
        activeProviderId: settings.activeProviderId,
        activeAnthropicModel: settings.activeAnthropicModel,
        providers: settings.providers.map((provider) => ({ id: provider.id, name: provider.name, model: provider.model, modelSupportsImages: provider.modelSupportsImages, defaultHaikuModel: provider.defaultHaikuModel, defaultHaikuSupportsImages: provider.defaultHaikuSupportsImages, defaultOpusModel: provider.defaultOpusModel, defaultOpusSupportsImages: provider.defaultOpusSupportsImages, defaultSonnetModel: provider.defaultSonnetModel, defaultSonnetSupportsImages: provider.defaultSonnetSupportsImages })),
      }
    },
    async getAgentContext(projectId: string): Promise<ProjectChatAgentContext> {
      const resolved = projectPath(projectId)
      if (!resolved) throw new Error('project-unavailable')
      return projectContext(await options.discoverAgentContext(resolved.path))
    },
    async searchProjectFiles(input: SearchProjectChatFilesInput): Promise<ProjectChatFileSearchItem[]> {
      const resolved = projectPath(input.projectId)
      if (!resolved) throw new Error('project-unavailable')
      return projectFiles(await options.searchProjectFiles(resolved.path, input.query))
    },
    async pickAttachments(input?: { allowImages?: boolean }): Promise<unknown> {
      return options.pickAttachments(input?.allowImages === true)
    },
    async readProjectAttachments(input: ReadProjectChatAttachmentsInput): Promise<ProjectChatAttachmentSelection | RawAttachmentSelection> {
      if (!Array.isArray(input.relativePaths) || input.relativePaths.length < 1 || input.relativePaths.length > 8) throw new Error('attachment-path-invalid')
      const relativePaths = input.relativePaths.map(normalizeProjectChatRelativePath)
      if (relativePaths.some((item) => item === null)) throw new Error('attachment-path-invalid')
      const resolved = projectPath(input.projectId)
      if (!resolved) throw new Error('project-unavailable')
      const root = await options.realpath(resolved.path)
      const accepted: string[] = []; const skipped: Array<{ name: string; reason: string }> = []
      for (const relativePath of relativePaths as string[]) {
        const name = projectChatBasename(relativePath) ?? 'Attachment'
        try {
          const candidate = await options.realpath(path.join(root, ...relativePath.split('/')))
          const relative = path.relative(root, candidate)
          if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { skipped.push({ name, reason: 'Attachment is unavailable.' }); continue }
          accepted.push(candidate)
        } catch { skipped.push({ name, reason: 'Attachment is unavailable.' }) }
      }
      if (!accepted.length) return { attachments: [], skipped }
      const raw = await options.readAttachments(accepted, input.allowImages === true)
      if (!isSelection(raw)) throw new Error('attachment-reader-invalid')
      return { attachments: raw.attachments, skipped: [...skipped, ...raw.skipped.map((item) => ({ name: safeName(item), reason: 'Attachment is unavailable.' }))] }
    },
    async getThreadStatus(input: GetProjectChatThreadStatusInput): Promise<ProjectChatThreadStatus> {
      const resolved = projectPath(input.projectId)
      const thread = resolved?.state.threads.find((item) => item.id === input.threadId && item.projectId === input.projectId)
      if (!resolved || !thread || thread.archivedAt) throw new Error('thread-unavailable')
      const payload: ClaudeAgentStatusRequest = { threadId: thread.id, cwd: resolved.path, refresh: false, ...(thread.chatState.sessionId ? { sessionId: thread.chatState.sessionId } : {}), ...(thread.chatState.modelPick ? { modelPick: thread.chatState.modelPick as ChatModelPick } : {}) }
      const status = await options.runner.getStatus(payload)
      if (status.threadId !== input.threadId) throw new Error('thread-status-mismatch')
      return { threadId: status.threadId, active: status.active, requestId: status.requestId, reportedModel: status.reportedModel, permissionMode: status.permissionMode, tools: status.tools ?? [], skills: status.skills ?? [], slashCommands: status.slashCommands ?? [], agents: status.agents ?? [], contextUsage: status.contextUsage, lastError: status.lastError, updatedAt: status.updatedAt }
    },
  }
}

function projectContext(raw: unknown): ProjectChatAgentContext {
  if (!record(raw) || !Array.isArray(raw.skills) || !Array.isArray(raw.agents)) throw new Error('context-invalid')
  return { skills: raw.skills.map((item) => {
    if (!record(item) || (item.kind !== 'skill' && item.kind !== 'command') || !strings(item, ['name', 'command', 'title', 'description', 'argumentHint', 'relativePath']) || (item.scope !== 'user' && item.scope !== 'project') || !source(item.source) || typeof item.native !== 'boolean') throw new Error('context-invalid')
    const relativePath = normalizeProjectChatRelativePath(item.relativePath); if (!relativePath) throw new Error('context-invalid')
    return { kind: item.kind, name: item.name, command: item.command, title: item.title, description: item.description, argumentHint: item.argumentHint, relativePath, scope: item.scope, source: item.source, native: item.native }
  }), agents: raw.agents.map((item) => {
    if (!record(item) || item.kind !== 'agent' || !strings(item, ['name', 'description', 'relativePath']) || (item.scope !== 'user' && item.scope !== 'project') || !source(item.source) || typeof item.native !== 'boolean' || !Array.isArray(item.tools) || !item.tools.every((tool) => typeof tool === 'string')) throw new Error('context-invalid')
    const relativePath = normalizeProjectChatRelativePath(item.relativePath); if (!relativePath) throw new Error('context-invalid')
    return { kind: 'agent' as const, name: item.name, description: item.description, relativePath, scope: item.scope, source: item.source, native: item.native, ...(typeof item.model === 'string' ? { model: item.model } : {}), tools: item.tools }
  }) }
}

function projectFiles(raw: unknown): ProjectChatFileSearchItem[] {
  if (!record(raw) || raw.ok !== true || !Array.isArray(raw.items)) throw new Error('search-invalid')
  return raw.items.map((item) => { if (!record(item) || !strings(item, ['label', 'relativePath']) || (item.type !== 'file' && item.type !== 'directory')) throw new Error('search-invalid'); const relativePath = normalizeProjectChatRelativePath(item.relativePath); if (!relativePath) throw new Error('search-invalid'); return { label: item.label, relativePath, type: item.type } })
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function strings(value: Record<string, unknown>, keys: string[]): value is Record<string, string> { return keys.every((key) => typeof value[key] === 'string') }
function source(value: unknown): value is 'claude' | 'agent' | 'agents' | 'cursor' { return value === 'claude' || value === 'agent' || value === 'agents' || value === 'cursor' }
function isSelection(value: unknown): value is RawAttachmentSelection { return record(value) && Array.isArray(value.attachments) && Array.isArray(value.skipped) }
function safeName(value: unknown): string { return record(value) && typeof value.name === 'string' ? projectChatBasename(value.name) ?? 'Attachment' : 'Attachment' }
