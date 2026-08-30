import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseRuntimeScopeId,
  type RuntimeDevelopmentWindowViewState,
  type RuntimeScopeId,
  type SaveRuntimeDevelopmentWindowViewStateInput,
} from '../src/runtime-development-contract'

export type RuntimeDevelopmentDisplayWorkArea = { x: number; y: number; width: number; height: number }
export type RuntimeDevelopmentDisplayProvider = {
  primaryWorkArea(): RuntimeDevelopmentDisplayWorkArea
  workAreas(): RuntimeDevelopmentDisplayWorkArea[]
}

export type RuntimeDevelopmentViewStateStoreOptions = {
  userDataPath: string
  now?: () => number
  displays?: RuntimeDevelopmentDisplayProvider
  threadBelongsToScope?: (runtimeScopeId: RuntimeScopeId, threadId: string) => boolean
  writeTextFile?: (filePath: string, contents: string) => Promise<void>
}

type StoredFile = { schemaVersion: 1; scopes: Record<string, RuntimeDevelopmentWindowViewState> }

const MAX_DRAFT_LENGTH = 100_000
const MIN_WIDTH = 720
const MIN_HEIGHT = 560
const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 760

/** Runtime window view state is a separate durable collection; it never writes Project workspace state. */
export class RuntimeDevelopmentViewStateStore {
  readonly filePath: string
  private readonly now: () => number
  private readonly displays: RuntimeDevelopmentDisplayProvider
  private readonly threadBelongsToScope: (runtimeScopeId: RuntimeScopeId, threadId: string) => boolean
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private file: StoredFile | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: RuntimeDevelopmentViewStateStoreOptions) {
    this.filePath = path.join(options.userDataPath, 'runtime-development-view-state.json')
    this.now = options.now ?? Date.now
    this.displays = options.displays ?? defaultDisplays
    this.threadBelongsToScope = options.threadBelongsToScope ?? (() => true)
    this.writeTextFile = options.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, 'utf8'))
  }

  async get(runtimeScopeId: RuntimeScopeId): Promise<RuntimeDevelopmentWindowViewState> {
    assertScope(runtimeScopeId)
    await this.writeChain
    const stored = (await this.load()).scopes[runtimeScopeId]
    return stored ? this.normalize(stored, runtimeScopeId) : this.empty(runtimeScopeId)
  }

  async save(runtimeScopeId: RuntimeScopeId, input: SaveRuntimeDevelopmentWindowViewStateInput): Promise<RuntimeDevelopmentWindowViewState> {
    assertScope(runtimeScopeId)
    const operation = this.writeChain.then(() => this.saveSerialized(runtimeScopeId, input))
    this.writeChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  async flush(): Promise<void> { await this.writeChain }

  resolveBounds(bounds?: RuntimeDevelopmentWindowViewState['bounds']): NonNullable<RuntimeDevelopmentWindowViewState['bounds']> {
    const fallback = defaultBounds(this.displays.primaryWorkArea())
    if (!bounds || !finite(bounds.width) || !finite(bounds.height)) return fallback
    const normalized = {
      x: finite(bounds.x) ? Math.round(bounds.x) : fallback.x ?? 0,
      y: finite(bounds.y) ? Math.round(bounds.y) : fallback.y ?? 0,
      width: Math.max(MIN_WIDTH, Math.round(bounds.width)),
      height: Math.max(MIN_HEIGHT, Math.round(bounds.height)),
    }
    return this.displays.workAreas().some((area) => intersects(normalized, area)) ? normalized : fallback
  }

  private async saveSerialized(runtimeScopeId: RuntimeScopeId, input: SaveRuntimeDevelopmentWindowViewStateInput): Promise<RuntimeDevelopmentWindowViewState> {
    const patch = input?.patch
    if (!record(patch) || Object.keys(patch).some((key) => !['selectedThreadId', 'draft', 'bounds'].includes(key))) throw new Error('runtime-view-state-patch-invalid')
    if (Object.prototype.hasOwnProperty.call(patch, 'draft') && (typeof patch.draft !== 'string' || patch.draft.length > MAX_DRAFT_LENGTH)) throw new RangeError('runtime-view-state-draft-invalid')
    const file = await this.load()
    const current = file.scopes[runtimeScopeId] ? this.normalize(file.scopes[runtimeScopeId], runtimeScopeId) : this.empty(runtimeScopeId)
    const next: RuntimeDevelopmentWindowViewState = {
      ...current,
      ...(typeof patch.draft === 'string' ? { draft: patch.draft } : {}),
      updatedAt: this.now(),
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'selectedThreadId')) {
      if (typeof patch.selectedThreadId === 'string' && patch.selectedThreadId.trim()) {
        const threadId = patch.selectedThreadId.trim()
        if (!this.threadBelongsToScope(runtimeScopeId, threadId)) throw new Error('runtime-view-state-thread-scope-mismatch')
        next.selectedThreadId = threadId
      } else delete next.selectedThreadId
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'bounds')) {
      if (record(patch.bounds)) next.bounds = this.resolveBounds(patch.bounds as RuntimeDevelopmentWindowViewState['bounds'])
      else if (patch.bounds === undefined || patch.bounds === null) delete next.bounds
      else throw new Error('runtime-view-state-bounds-invalid')
    }
    const nextFile: StoredFile = { schemaVersion: 1, scopes: { ...file.scopes, [runtimeScopeId]: next } }
    await this.write(nextFile)
    this.file = nextFile
    return next
  }

  private normalize(raw: RuntimeDevelopmentWindowViewState, runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentWindowViewState {
    const state = this.empty(runtimeScopeId)
    if (!record(raw) || raw.schemaVersion !== 1 || raw.runtimeScopeId !== runtimeScopeId) return state
    if (typeof raw.draft === 'string' && raw.draft.length <= MAX_DRAFT_LENGTH) state.draft = raw.draft
    if (typeof raw.selectedThreadId === 'string' && raw.selectedThreadId.trim() && this.threadBelongsToScope(runtimeScopeId, raw.selectedThreadId.trim())) state.selectedThreadId = raw.selectedThreadId.trim()
    if (finite(raw.updatedAt)) state.updatedAt = raw.updatedAt
    if (raw.bounds) state.bounds = this.resolveBounds(raw.bounds)
    return state
  }

  private empty(runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentWindowViewState {
    return { schemaVersion: 1, runtimeScopeId, draft: '', updatedAt: 0 }
  }

  private async load(): Promise<StoredFile> {
    if (this.file) return this.file
    if (!existsSync(this.filePath)) return this.file = { schemaVersion: 1, scopes: {} }
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!record(raw) || raw.schemaVersion !== 1 || !record(raw.scopes)) throw new Error('runtime-view-state-file-invalid')
      return this.file = raw as StoredFile
    } catch {
      try { await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`) } catch { /* empty state remains usable */ }
      return this.file = { schemaVersion: 1, scopes: {} }
    }
  }

  private async write(file: StoredFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await this.writeTextFile(tempPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tempPath, this.filePath)
  }
}

function assertScope(runtimeScopeId: RuntimeScopeId): void { if (!parseRuntimeScopeId(runtimeScopeId)) throw new Error('runtime-view-state-scope-invalid') }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function intersects(bounds: { x: number; y: number; width: number; height: number }, area: RuntimeDevelopmentDisplayWorkArea): boolean { return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y }
function defaultBounds(area: RuntimeDevelopmentDisplayWorkArea) { return { x: Math.round(area.x + (area.width - DEFAULT_WIDTH) / 2), y: Math.round(area.y + (area.height - DEFAULT_HEIGHT) / 2), width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT } }
const defaultDisplays: RuntimeDevelopmentDisplayProvider = { primaryWorkArea: () => ({ x: 0, y: 0, width: 1440, height: 900 }), workAreas: () => [{ x: 0, y: 0, width: 1440, height: 900 }] }
