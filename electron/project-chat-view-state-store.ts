import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectChatWindowViewState, SaveProjectChatWindowViewStateInput } from '../src/project-chat-contract'

export type ProjectChatDisplayWorkArea = { x: number; y: number; width: number; height: number }
export type ProjectChatDisplayProvider = {
  primaryWorkArea(): ProjectChatDisplayWorkArea
  workAreas(): ProjectChatDisplayWorkArea[]
}

export type ProjectChatViewStateStoreOptions = {
  userDataPath: string
  now?: () => number
  displays?: ProjectChatDisplayProvider
  writeTextFile?: (filePath: string, contents: string) => Promise<void>
}

type StoredViewStateFile = { schemaVersion: 1; projects: Record<string, ProjectChatWindowViewState> }

const MAX_DRAFT_LENGTH = 100_000
const MIN_WIDTH = 720
const MIN_HEIGHT = 560
const DEFAULT_WIDTH = 1024
const DEFAULT_HEIGHT = 760

export class ProjectChatViewStateStore {
  readonly filePath: string
  private readonly now: () => number
  private readonly displays: ProjectChatDisplayProvider
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private file: StoredViewStateFile | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: ProjectChatViewStateStoreOptions) {
    this.filePath = path.join(options.userDataPath, 'project-chat-view-state.json')
    this.now = options.now ?? Date.now
    this.displays = options.displays ?? defaultDisplays
    this.writeTextFile = options.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, 'utf8'))
  }

  async get(projectId: string): Promise<ProjectChatWindowViewState> {
    await this.writeChain
    const file = await this.load()
    const stored = file.projects[projectId]
    return stored ? this.normalizeStored(stored, projectId) : this.empty(projectId)
  }

  async save(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatWindowViewState> {
    const operation = this.writeChain.then(() => this.saveSerialized(input))
    this.writeChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async saveSerialized(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatWindowViewState> {
    const projectId = input.projectId.trim()
    if (!projectId) throw new Error('project-chat-view-state-project-invalid')
    const patch = input.patch
    if (Object.prototype.hasOwnProperty.call(patch, 'draft') && typeof patch.draft === 'string' && patch.draft.length > MAX_DRAFT_LENGTH) {
      throw new RangeError('project-chat-view-state-draft-too-large')
    }
    const file = await this.load()
    const stored = file.projects[projectId]
    const current = stored ? this.normalizeStored(stored, projectId) : this.empty(projectId)
    const next: ProjectChatWindowViewState = {
      ...current,
      ...(typeof patch.draft === 'string' ? { draft: patch.draft } : {}),
      ...(typeof patch.externalTaskSeenAt === 'number' && Number.isFinite(patch.externalTaskSeenAt) ? { externalTaskSeenAt: patch.externalTaskSeenAt } : {}),
      updatedAt: this.now(),
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'selectedThreadId')) {
      if (typeof patch.selectedThreadId === 'string' && patch.selectedThreadId.trim()) next.selectedThreadId = patch.selectedThreadId.trim()
      else delete next.selectedThreadId
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'bounds')) {
      if (patch.bounds) next.bounds = this.resolveBounds(patch.bounds)
      else delete next.bounds
    }
    const nextFile: StoredViewStateFile = { schemaVersion: 1, projects: { ...file.projects, [projectId]: next } }
    await this.write(nextFile)
    this.file = nextFile
    return next
  }

  resolveBounds(bounds?: ProjectChatWindowViewState['bounds']): NonNullable<ProjectChatWindowViewState['bounds']> {
    const fallback = defaultBounds(this.displays.primaryWorkArea())
    if (!bounds || !isFiniteNumber(bounds.width) || !isFiniteNumber(bounds.height)) return fallback
    const width = Math.max(MIN_WIDTH, Math.round(bounds.width))
    const height = Math.max(MIN_HEIGHT, Math.round(bounds.height))
    const x = isFiniteNumber(bounds.x) ? Math.round(bounds.x) : fallback.x ?? 0
    const y = isFiniteNumber(bounds.y) ? Math.round(bounds.y) : fallback.y ?? 0
    const normalized = { x, y, width, height }
    return this.displays.workAreas().some((area) => intersects(normalized, area)) ? normalized : fallback
  }

  private empty(projectId: string): ProjectChatWindowViewState {
    return { schemaVersion: 1, projectId, draft: '', externalTaskSeenAt: 0, updatedAt: 0 }
  }

  private normalizeStored(raw: ProjectChatWindowViewState, projectId: string): ProjectChatWindowViewState {
    const state = this.empty(projectId)
    if (!raw || raw.schemaVersion !== 1 || raw.projectId !== projectId) return state
    if (typeof raw.draft === 'string' && raw.draft.length <= MAX_DRAFT_LENGTH) state.draft = raw.draft
    if (typeof raw.selectedThreadId === 'string' && raw.selectedThreadId.trim()) state.selectedThreadId = raw.selectedThreadId.trim()
    if (isFiniteNumber(raw.externalTaskSeenAt)) state.externalTaskSeenAt = raw.externalTaskSeenAt
    if (isFiniteNumber(raw.updatedAt)) state.updatedAt = raw.updatedAt
    if (raw.bounds) state.bounds = this.resolveBounds(raw.bounds)
    return state
  }

  private async load(): Promise<StoredViewStateFile> {
    if (this.file) return this.file
    if (!existsSync(this.filePath)) return this.file = { schemaVersion: 1, projects: {} }
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!isStoredFile(raw)) throw new Error('project-chat-view-state-invalid')
      return this.file = raw
    } catch {
      const backup = `${this.filePath}.corrupt-${this.now()}`
      try { await rename(this.filePath, backup) } catch { /* empty state remains usable */ }
      return this.file = { schemaVersion: 1, projects: {} }
    }
  }

  private async write(file: StoredViewStateFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await this.writeTextFile(tempPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tempPath, this.filePath)
  }
}

function defaultBounds(area: ProjectChatDisplayWorkArea): { x: number; y: number; width: number; height: number } {
  const width = Math.max(MIN_WIDTH, DEFAULT_WIDTH)
  const height = Math.max(MIN_HEIGHT, DEFAULT_HEIGHT)
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height }
}

function intersects(bounds: { x: number; y: number; width: number; height: number }, area: ProjectChatDisplayWorkArea): boolean {
  return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y
}

function isStoredFile(value: unknown): value is StoredViewStateFile {
  return typeof value === 'object' && value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (value as { projects?: unknown }).projects === 'object' && (value as { projects?: unknown }).projects !== null
}

function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

const defaultDisplays: ProjectChatDisplayProvider = {
  primaryWorkArea: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
  workAreas: () => [{ x: 0, y: 0, width: 1440, height: 900 }],
}
