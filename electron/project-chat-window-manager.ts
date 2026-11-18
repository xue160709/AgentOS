import type { RendererCapability, RendererCapabilityRegistry } from './project-chat-ipc'
import type { SaveProjectChatWindowViewStateInput } from '../src/project-chat-contract'
import type { ProjectChatViewStateStore } from './project-chat-view-state-store'

export type ProjectChatWindowWebContents = {
  id: number
  on(event: 'destroyed', listener: () => void): void
}

export type ProjectChatWindow = {
  webContents: ProjectChatWindowWebContents
  loadURL(url: string): Promise<void>
  show(): void
  focus(): void
  isDestroyed(): boolean
  destroy?(): void
  getBounds?(): { x: number; y: number; width: number; height: number }
  isVisible?(): boolean
  isFocused?(): boolean
  on(event: 'focus' | 'show' | 'hide' | 'blur' | 'close' | 'closed', listener: () => void): void
}

export type ProjectChatWindowCreationOptions = {
  title: string
  width: number
  height: number
  x?: number
  y?: number
  minWidth: number
  minHeight: number
  webPreferences: {
    preload: string
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    additionalArguments: ['--agentos-window-kind=project-chat']
  }
}

export type ProjectChatWindowTimer = {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export type ProjectChatWindowManagerOptions = {
  createWindow(options: ProjectChatWindowCreationOptions): ProjectChatWindow
  rendererEntry: string
  preloadPath: string
  capabilities: RendererCapabilityRegistry
  routeGenerationOf(projectId: string): number
  viewStateStore: Pick<ProjectChatViewStateStore, 'get' | 'save' | 'resolveBounds'>
  onWebContentsUnavailable(webContentsId: number): void
  onCapabilityRegistered?(capability: RendererCapability): void
  /** When supplied, owns the complete ordered cleanup transaction. */
  onWindowCleanup?(webContentsId: number): void
  onWindowState?(webContentsId: number, state: { visible: boolean; focused: boolean }): void
  resolveProjectName?(projectId: string): string
  timer?: ProjectChatWindowTimer
}

type WindowEntry = {
  projectId: string
  window: ProjectChatWindow
  controller: DebouncedViewStateController
  unavailableNotified: boolean
  cleaned: boolean
}

const DEBOUNCE_MS = 300

export class ProjectChatWindowManager {
  private readonly windows = new Map<string, WindowEntry>()
  private readonly timer: ProjectChatWindowTimer

  constructor(private readonly options: ProjectChatWindowManagerOptions) {
    this.timer = options.timer ?? {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
  }

  async open(projectId: string): Promise<ProjectChatWindow> {
    const current = this.windows.get(projectId)
    if (current && !current.window.isDestroyed()) {
      current.window.show()
      current.window.focus()
      return current.window
    }
    if (current) this.cleanup(current)

    const viewState = await this.options.viewStateStore.get(projectId)
    const bounds = this.options.viewStateStore.resolveBounds(viewState.bounds)
    const projectName = this.options.resolveProjectName?.(projectId) ?? projectId
    const window = this.options.createWindow({
      title: `${projectName} · Chat · AgentOS`,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 720,
      minHeight: 560,
      webPreferences: {
        preload: this.options.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true,
        additionalArguments: ['--agentos-window-kind=project-chat'],
      },
    })
    const controller = new DebouncedViewStateController(projectId, this.options.viewStateStore, this.timer)
    const entry: WindowEntry = { projectId, window, controller, unavailableNotified: false, cleaned: false }
    this.windows.set(projectId, entry)
    const capability = this.options.capabilities.registerProjectWindow(window.webContents.id, projectId, this.options.routeGenerationOf(projectId))
    if (!capability) {
      this.cleanupAndDestroy(entry)
      throw new Error('project-chat-window-capability-invalid')
    }
    this.options.onCapabilityRegistered?.(capability)
    const reportState = () => this.options.onWindowState?.(window.webContents.id, { visible: window.isVisible?.() ?? true, focused: window.isFocused?.() ?? false })
    window.on('focus', reportState)
    window.on('show', reportState)
    window.on('hide', reportState)
    window.on('blur', () => { void this.flush(entry); reportState() })
    window.on('close', () => { void this.flush(entry) })
    window.on('closed', () => this.cleanup(entry))
    window.webContents.on('destroyed', () => this.cleanup(entry))
    try {
      await window.loadURL(projectChatWindowUrl(this.options.rendererEntry, projectId))
      return window
    } catch (error) {
      this.cleanupAndDestroy(entry)
      throw error
    }
  }

  queueViewState(projectId: string, patch: SaveProjectChatWindowViewStateInput['patch']): void {
    this.windows.get(projectId)?.controller.queue(patch)
  }

  async flushViewState(projectId: string): Promise<void> {
    const entry = this.windows.get(projectId)
    if (entry) await this.flush(entry)
  }

  get(projectId: string): ProjectChatWindow | undefined { return this.windows.get(projectId)?.window }

  private async flush(entry: WindowEntry): Promise<void> {
    const bounds = entry.window.getBounds?.()
    if (bounds) entry.controller.queue({ bounds })
    await entry.controller.flush()
  }

  private cleanup(entry: WindowEntry): void {
    if (entry.cleaned) return
    entry.cleaned = true
    void this.flush(entry).catch(() => undefined)
    if (this.windows.get(entry.projectId) === entry) this.windows.delete(entry.projectId)
    if (!entry.unavailableNotified) {
      entry.unavailableNotified = true
      if (this.options.onWindowCleanup) this.options.onWindowCleanup(entry.window.webContents.id)
      else {
        this.options.onWebContentsUnavailable(entry.window.webContents.id)
        this.options.capabilities.unregister(entry.window.webContents.id)
      }
    }
  }

  private cleanupAndDestroy(entry: WindowEntry): void {
    this.cleanup(entry)
    if (!entry.window.isDestroyed()) entry.window.destroy?.()
  }
}

export function projectChatWindowUrl(rendererEntry: string, projectId: string): string {
  const url = new URL(rendererEntry)
  url.searchParams.set('window-kind', 'project-chat')
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

class DebouncedViewStateController {
  private pending: SaveProjectChatWindowViewStateInput['patch'] = {}
  private handle: unknown
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly projectId: string,
    private readonly store: Pick<ProjectChatViewStateStore, 'save'>,
    private readonly timer: ProjectChatWindowTimer,
  ) {}

  queue(patch: SaveProjectChatWindowViewStateInput['patch']): void {
    this.pending = { ...this.pending, ...patch }
    if (this.handle !== undefined) this.timer.clear(this.handle)
    this.handle = this.timer.set(() => { void this.flush() }, DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    if (this.handle !== undefined) {
      this.timer.clear(this.handle)
      this.handle = undefined
    }
    const patch = this.pending
    if (Object.keys(patch).length === 0) return this.writeChain
    this.pending = {}
    this.writeChain = this.writeChain.then(async () => { await this.store.save({ projectId: this.projectId, patch }) })
    return this.writeChain
  }
}
