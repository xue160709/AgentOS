import type { ProjectFileSearchResult } from './claude-chat-types'
import type { FileTreeResult, ProjectFilePreviewResult } from './components/types'
import type { ProjectFilesChangedEvent, ProjectFileWatchResult } from './desktop-types'

export type ProjectContentAdapter = {
  listProjectFiles?: (rootPath: string) => Promise<FileTreeResult>
  readProjectFile?: (rootPath: string, filePath: string) => Promise<ProjectFilePreviewResult>
  searchProjectFiles?: (rootPath: string, query: string) => Promise<ProjectFileSearchResult>
  watchProjectFiles?: (rootPath: string) => Promise<ProjectFileWatchResult>
  unwatchProjectFiles?: (rootPath: string) => Promise<void>
  onProjectFilesChanged?: (handler: (event: ProjectFilesChangedEvent) => void) => () => void
}

export type ProjectContentOptions = {
  getAdapter?: () => ProjectContentAdapter | undefined
}

export type ProjectContentSearchRequest = {
  rootPath: string
  query: string
  onResult: (result: ProjectFileSearchResult) => void
  onSettled?: () => void
}

export type ProjectContentSearchSession = {
  search: (request: ProjectContentSearchRequest) => void
  cancel: () => void
  dispose: () => void
}

const PROJECT_FILE_SEARCH_UNAVAILABLE_MESSAGE = '当前运行环境无法搜索项目文件'
const PROJECT_FILE_SEARCH_FAILED_MESSAGE = '搜索项目文件失败'

export class ProjectContent {
  private readonly getAdapter: NonNullable<ProjectContentOptions['getAdapter']>

  constructor(options: ProjectContentOptions = {}) {
    this.getAdapter =
      options.getAdapter ??
      (() => (typeof window === 'undefined' ? undefined : window.desktop))
  }

  async list(rootPath: string): Promise<FileTreeResult | null> {
    const operation = this.getAdapter()?.listProjectFiles
    return operation ? operation(rootPath) : null
  }

  async preview(rootPath: string, filePath: string): Promise<ProjectFilePreviewResult | null> {
    const operation = this.getAdapter()?.readProjectFile
    return operation ? operation(rootPath, filePath) : null
  }

  async search(rootPath: string, query: string): Promise<ProjectFileSearchResult> {
    const operation = this.getAdapter()?.searchProjectFiles
    if (!operation) return createProjectFileSearchFailure(rootPath, PROJECT_FILE_SEARCH_UNAVAILABLE_MESSAGE)

    try {
      return await operation(rootPath, query)
    } catch (error) {
      return createProjectFileSearchFailure(rootPath, formatProjectFileSearchError(error))
    }
  }

  createSearchSession(): ProjectContentSearchSession {
    return new ProjectContentSearchLifecycle(this)
  }

  subscribe(rootPath: string, handler: (event: ProjectFilesChangedEvent) => void): () => void {
    const adapter = this.getAdapter()
    const watch = adapter?.watchProjectFiles
    const unwatch = adapter?.unwatchProjectFiles
    const onChanged = adapter?.onProjectFilesChanged
    if (!watch || !unwatch || !onChanged) return () => {}

    let disposed = false
    let watchedRootPath: string | null = null
    const unsubscribe = onChanged((event) => {
      if (
        event.rootPath === rootPath ||
        (watchedRootPath !== null && event.rootPath === watchedRootPath)
      ) {
        handler(event)
      }
    })

    void watch(rootPath)
      .then((result) => {
        if (!result.ok) return
        if (disposed) {
          void unwatch(result.rootPath)
          return
        }
        watchedRootPath = result.rootPath
      })
      .catch(() => {
        /* File watching is an optional enhancement; explicit refresh remains available. */
      })

    return () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      if (watchedRootPath) void unwatch(watchedRootPath)
    }
  }
}

class ProjectContentSearchLifecycle implements ProjectContentSearchSession {
  private sequence = 0
  private disposed = false

  constructor(private readonly content: ProjectContent) {}

  search(request: ProjectContentSearchRequest): void {
    const sequence = ++this.sequence
    void this.content.search(request.rootPath, request.query)
      .then((result) => {
        if (!this.isCurrent(sequence)) return
        request.onResult(result)
      })
      .finally(() => {
        if (this.isCurrent(sequence)) request.onSettled?.()
      })
  }

  cancel(): void {
    this.sequence += 1
  }

  dispose(): void {
    this.disposed = true
    this.sequence += 1
  }

  private isCurrent(sequence: number): boolean {
    return !this.disposed && this.sequence === sequence
  }
}

function createProjectFileSearchFailure(rootPath: string, message: string): ProjectFileSearchResult {
  return {
    ok: false,
    rootPath,
    message,
  }
}

function formatProjectFileSearchError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return PROJECT_FILE_SEARCH_FAILED_MESSAGE
}

export const projectContent = new ProjectContent()
