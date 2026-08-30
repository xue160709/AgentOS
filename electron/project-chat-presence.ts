import { projectChatError, type ProjectChatResult, type ReportProjectChatPresenceInput } from '../src/project-chat-contract'
import type { RendererCapability } from './project-chat-ipc'
import type { RuntimeDevelopmentCapability } from './project-chat-ipc'
import type { ReportRuntimeChatPresenceInput, RuntimeScopeId } from '../src/runtime-development-contract'

type Entry = (RendererCapability | RuntimeDevelopmentCapability) & {
  visible: boolean
  focused: boolean
  focusEpoch: number
  selectedProjectId?: string
  selectedThreadId?: string
}

export class ProjectChatPresenceRegistry {
  private readonly entries = new Map<number, Entry>()
  private epoch = 0

  register(capability: RendererCapability | RuntimeDevelopmentCapability): void {
    this.entries.set(capability.webContentsId, { ...capability, visible: false, focused: false, focusEpoch: 0 })
  }

  unregister(webContentsId: number): void { this.entries.delete(webContentsId) }

  setWindowState(webContentsId: number, state: { visible: boolean; focused: boolean }): boolean {
    const entry = this.entries.get(webContentsId)
    if (!entry) return false
    const focused = state.visible && state.focused
    if (focused) for (const other of this.entries.values()) other.focused = false
    entry.visible = state.visible
    entry.focused = focused
    if (focused) entry.focusEpoch = ++this.epoch
    return true
  }

  reportSelection(webContentsId: number, input: ReportProjectChatPresenceInput): ProjectChatResult<void> {
    const entry = this.entries.get(webContentsId)
    if (!entry || entry.kind === 'runtime-development' || (entry.kind === 'project-chat-window' && entry.projectId !== input.projectId)) return fail()
    entry.selectedProjectId = input.projectId
    entry.selectedThreadId = input.selectedThreadId
    return { ok: true, value: undefined }
  }

  ownerCandidates(input: { projectId: string; threadId: string; routeGeneration: number }): number[] {
    const entries = [...this.entries.values()].filter((entry) => entry.visible)
    const isCurrentProjectWindow = (entry: Entry) => entry.kind === 'main-window' || (entry.kind === 'project-chat-window' && entry.projectId === input.projectId && entry.routeGeneration === input.routeGeneration)
    const focused = entries.filter((entry) => isCurrentProjectWindow(entry) && entry.focused && entry.selectedProjectId === input.projectId && entry.selectedThreadId === input.threadId)
    const project = entries.filter((entry) => entry.kind === 'project-chat-window' && entry.projectId === input.projectId && entry.routeGeneration === input.routeGeneration)
    const main = entries.filter((entry) => entry.kind === 'main-window')
    return unique([...sort(focused), ...sort(project), ...sort(main)].map((entry) => entry.webContentsId))
  }

  reportRuntimeSelection(webContentsId: number, input: ReportRuntimeChatPresenceInput): ProjectChatResult<void> {
    const entry = this.entries.get(webContentsId)
    if (!entry || entry.kind !== 'runtime-development') return fail()
    entry.selectedThreadId = input.selectedThreadId
    return { ok: true, value: undefined }
  }

  runtimeOwnerCandidates(input: { runtimeScopeId: RuntimeScopeId; threadId: string; routeGeneration: number; developmentGeneration: number }): number[] {
    return sort([...this.entries.values()].filter((entry) =>
      entry.kind === 'runtime-development' && entry.visible && entry.runtimeScopeId === input.runtimeScopeId &&
      entry.routeGeneration === input.routeGeneration && entry.developmentGeneration === input.developmentGeneration &&
      entry.selectedThreadId === input.threadId,
    )).map((entry) => entry.webContentsId)
  }
}

function sort(entries: Entry[]): Entry[] { return [...entries].sort((left, right) => right.focusEpoch - left.focusEpoch || left.webContentsId - right.webContentsId) }
function unique(ids: number[]): number[] { return [...new Set(ids)] }
function fail(): ProjectChatResult<never> { return { ok: false, error: projectChatError('sender-not-authorized', 'Sender is not authorized.') } }
