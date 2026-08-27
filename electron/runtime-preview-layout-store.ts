import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RuntimePreviewLayout, RuntimePreviewLayoutSize } from '../src/desktop-api'

export const DEFAULT_RUNTIME_PREVIEW_HEIGHT = 960
export const MIN_RUNTIME_PREVIEW_WIDTH = 480
export const MIN_RUNTIME_PREVIEW_HEIGHT = 240
export const MAX_RUNTIME_PREVIEW_WIDTH = 4_096
export const MAX_RUNTIME_PREVIEW_HEIGHT = 1_600

type StoredLayoutFile = { schemaVersion: 1; projects: Record<string, RuntimePreviewLayout> }

export type RuntimePreviewLayoutStoreOptions = {
  userDataPath: string
  now?: () => number
  writeTextFile?: (filePath: string, contents: string) => Promise<void>
}

export class RuntimePreviewLayoutStore {
  readonly filePath: string
  private readonly now: () => number
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private file: StoredLayoutFile | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: RuntimePreviewLayoutStoreOptions) {
    this.filePath = path.join(options.userDataPath, 'runtime-preview-layout.json')
    this.now = options.now ?? Date.now
    this.writeTextFile = options.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, 'utf8'))
  }

  async get(projectId: string): Promise<RuntimePreviewLayout> {
    const id = normalizeProjectId(projectId)
    await this.writeChain
    const file = await this.load()
    return normalizeStoredLayout(file.projects[id], id)
  }

  async save(projectId: string, size: RuntimePreviewLayoutSize): Promise<RuntimePreviewLayout> {
    const id = normalizeProjectId(projectId)
    const normalized = normalizeRuntimePreviewLayoutSize(size)
    const operation = this.writeChain.then(async () => {
      const file = await this.load()
      const layout: RuntimePreviewLayout = { projectId: id, ...normalized, updatedAt: this.now() }
      const next: StoredLayoutFile = { schemaVersion: 1, projects: { ...file.projects, [id]: layout } }
      await this.write(next)
      this.file = next
      return layout
    })
    this.writeChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  async reset(projectId: string): Promise<RuntimePreviewLayout> {
    const id = normalizeProjectId(projectId)
    const operation = this.writeChain.then(async () => {
      const file = await this.load()
      if (!file.projects[id]) return defaultRuntimePreviewLayout(id)
      const projects = { ...file.projects }
      delete projects[id]
      const next: StoredLayoutFile = { schemaVersion: 1, projects }
      await this.write(next)
      this.file = next
      return defaultRuntimePreviewLayout(id)
    })
    this.writeChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  async clear(): Promise<void> {
    const operation = this.writeChain.then(async () => {
      const next = emptyFile()
      await this.write(next)
      this.file = next
    })
    this.writeChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async load(): Promise<StoredLayoutFile> {
    if (this.file) return this.file
    if (!existsSync(this.filePath)) return this.file = emptyFile()
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!isStoredLayoutFile(raw)) throw new Error('runtime-preview-layout-invalid')
      const projects: Record<string, RuntimePreviewLayout> = {}
      for (const [projectId, layout] of Object.entries(raw.projects)) {
        try { projects[projectId] = normalizeStoredLayout(layout, projectId) } catch { /* discard invalid entry */ }
      }
      return this.file = { schemaVersion: 1, projects }
    } catch {
      try { await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`) } catch { /* empty state remains usable */ }
      return this.file = emptyFile()
    }
  }

  private async write(file: StoredLayoutFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await this.writeTextFile(tempPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tempPath, this.filePath)
  }
}

export function normalizeRuntimePreviewLayoutSize(value: unknown): RuntimePreviewLayoutSize {
  if (!isRecord(value) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    throw new TypeError('runtime-preview-layout-size-invalid')
  }
  return {
    width: clampInteger(value.width, MIN_RUNTIME_PREVIEW_WIDTH, MAX_RUNTIME_PREVIEW_WIDTH),
    height: clampInteger(value.height, MIN_RUNTIME_PREVIEW_HEIGHT, MAX_RUNTIME_PREVIEW_HEIGHT),
  }
}

export function defaultRuntimePreviewLayout(projectId: string): RuntimePreviewLayout {
  return { projectId: normalizeProjectId(projectId), height: DEFAULT_RUNTIME_PREVIEW_HEIGHT, updatedAt: 0 }
}

function normalizeStoredLayout(value: unknown, projectId: string): RuntimePreviewLayout {
  const id = normalizeProjectId(projectId)
  if (!isRecord(value)) return defaultRuntimePreviewLayout(id)
  const height = isFiniteNumber(value.height)
    ? clampInteger(value.height, MIN_RUNTIME_PREVIEW_HEIGHT, MAX_RUNTIME_PREVIEW_HEIGHT)
    : DEFAULT_RUNTIME_PREVIEW_HEIGHT
  const width = isFiniteNumber(value.width)
    ? clampInteger(value.width, MIN_RUNTIME_PREVIEW_WIDTH, MAX_RUNTIME_PREVIEW_WIDTH)
    : undefined
  return { projectId: id, ...(width ? { width } : {}), height, updatedAt: isFiniteNumber(value.updatedAt) ? Math.max(0, Math.round(value.updatedAt)) : 0 }
}

function normalizeProjectId(value: string): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new TypeError('runtime-preview-layout-project-invalid')
  return id
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function emptyFile(): StoredLayoutFile { return { schemaVersion: 1, projects: {} } }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isStoredLayoutFile(value: unknown): value is StoredLayoutFile {
  return isRecord(value) && value.schemaVersion === 1 && isRecord(value.projects)
}
