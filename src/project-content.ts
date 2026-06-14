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

  async search(rootPath: string, query: string): Promise<ProjectFileSearchResult | null> {
    const operation = this.getAdapter()?.searchProjectFiles
    return operation ? operation(rootPath, query) : null
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

export const projectContent = new ProjectContent()
