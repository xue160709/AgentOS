import type {
  RuntimeDevelopmentSnapshot,
  RuntimeDevelopmentWindowContext,
  RuntimeScopeId,
  SaveRuntimeDevelopmentWindowViewStateInput,
} from '../src/runtime-development-contract'
import type { RendererCapabilityRegistry, RuntimeDevelopmentCapability } from './project-chat-ipc'
import type { RuntimeDevelopmentAuthority } from './runtime-development-coordinator'
import type { RuntimeDevelopmentViewStateStore } from './runtime-development-view-state-store'

export type RuntimeDevelopmentWindowWebContents = { id: number; on(event: 'destroyed', listener: () => void): void }
export type RuntimeDevelopmentWindow = {
  webContents: RuntimeDevelopmentWindowWebContents
  loadURL(url: string): Promise<void>
  show(): void
  focus(): void
  isDestroyed(): boolean
  destroy(): void
  getBounds?(): { x: number; y: number; width: number; height: number }
  isVisible?(): boolean
  isFocused?(): boolean
  on(event: 'focus' | 'show' | 'hide' | 'blur' | 'close' | 'closed', listener: (event?: { preventDefault(): void }) => void): void
}

export type RuntimeDevelopmentWindowCreationOptions = {
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
    additionalArguments: ['--agentos-window-kind=runtime-development']
  }
}

export type RuntimeDevelopmentWindowPreparation = {
  context: Omit<RuntimeDevelopmentWindowContext, 'development'>
  authority: RuntimeDevelopmentAuthority
  action: 'open' | 'reenter' | 'reuse-session'
}

export type RuntimeDevelopmentWindowManagerOptions = {
  createWindow(options: RuntimeDevelopmentWindowCreationOptions): RuntimeDevelopmentWindow
  rendererEntry: string
  preloadPath: string
  capabilities: RendererCapabilityRegistry
  viewStateStore: Pick<RuntimeDevelopmentViewStateStore, 'get' | 'save' | 'flush' | 'resolveBounds'>
  prepare(runtimeScopeId: RuntimeScopeId): Promise<RuntimeDevelopmentWindowPreparation>
  activate(preparation: RuntimeDevelopmentWindowPreparation): Promise<RuntimeDevelopmentSnapshot | null>
  requestExit(authority: RuntimeDevelopmentAuthority): void
  onCapabilityRegistered?(capability: RuntimeDevelopmentCapability): void
  onWindowState?(webContentsId: number, state: { visible: boolean; focused: boolean }): void
  onActivated?(webContentsId: number, snapshot: RuntimeDevelopmentSnapshot): void
  onWindowCleanup(webContentsId: number): void
}

type WindowEntry = {
  runtimeScopeId: RuntimeScopeId
  window: RuntimeDevelopmentWindow
  authority: RuntimeDevelopmentAuthority
  context: RuntimeDevelopmentWindowContext
  closeRequested: boolean
  cleaned: boolean
}

/** One Runtime scope owns one native window and one capability generation at a time. */
export class RuntimeDevelopmentWindowManager {
  private readonly windows = new Map<RuntimeScopeId, WindowEntry>()

  constructor(private readonly options: RuntimeDevelopmentWindowManagerOptions) {}

  async open(runtimeScopeId: RuntimeScopeId): Promise<{ window: RuntimeDevelopmentWindow; context: RuntimeDevelopmentWindowContext }> {
    const current = this.windows.get(runtimeScopeId)
    if (current && !current.window.isDestroyed()) {
      current.window.show()
      current.window.focus()
      return { window: current.window, context: current.context }
    }
    if (current) this.cleanup(current)

    const preparation = await this.options.prepare(runtimeScopeId)
    const viewState = await this.options.viewStateStore.get(runtimeScopeId)
    const bounds = this.options.viewStateStore.resolveBounds(viewState.bounds)
    const title = `${preparation.context.runtimeName} · ${preparation.context.ownerLabel} · Runtime 开发 · AgentOS`
    const window = this.options.createWindow({
      title, width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, minWidth: 720, minHeight: 560,
      webPreferences: { preload: this.options.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: ['--agentos-window-kind=runtime-development'] },
    })
    const entry: WindowEntry = { runtimeScopeId, window, authority: preparation.authority, context: preparation.context, closeRequested: false, cleaned: false }
    this.windows.set(runtimeScopeId, entry)
    if (!this.registerCapability(entry)) {
      this.cleanupAndDestroy(entry)
      throw new Error('runtime-development-window-capability-invalid')
    }
    const reportState = () => this.options.onWindowState?.(window.webContents.id, { visible: window.isVisible?.() ?? true, focused: window.isFocused?.() ?? false })
    window.on('focus', reportState)
    window.on('show', reportState)
    window.on('hide', reportState)
    window.on('blur', () => { void this.flush(entry); reportState() })
    window.on('close', (event) => this.nativeClose(entry, event))
    window.on('closed', () => this.cleanup(entry))
    window.webContents.on('destroyed', () => this.cleanup(entry))
    try {
      await window.loadURL(runtimeDevelopmentWindowUrl(this.options.rendererEntry, runtimeScopeId))
      if (!this.isCurrent(entry)) throw new Error('runtime-development-window-stale-before-activation')
      const development = await this.options.activate(preparation)
      if (!development) throw new Error('runtime-development-window-activation-failed')
      if (!this.isCurrent(entry) || development.runtimeScopeId !== runtimeScopeId || development.routeGeneration !== preparation.authority.routeGeneration || development.developmentGeneration < preparation.authority.developmentGeneration) throw new Error('runtime-development-window-stale-after-activation')
      entry.authority = { runtimeScopeId, routeGeneration: development.routeGeneration, developmentGeneration: development.developmentGeneration }
      entry.context = { ...preparation.context, scopeAvailable: preparation.context.scopeAvailable, development }
      if (!this.registerCapability(entry)) throw new Error('runtime-development-window-capability-refresh-failed')
      this.options.onActivated?.(window.webContents.id, development)
      reportState()
      return { window, context: entry.context }
    } catch (error) {
      this.cleanupAndDestroy(entry)
      throw error
    }
  }

  get(runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentWindow | undefined { return this.windows.get(runtimeScopeId)?.window }
  contextFor(webContentsId: number): RuntimeDevelopmentWindowContext | null { return [...this.windows.values()].find((entry) => !entry.cleaned && entry.window.webContents.id === webContentsId)?.context ?? null }

  async saveViewState(runtimeScopeId: RuntimeScopeId, input: SaveRuntimeDevelopmentWindowViewStateInput) { return this.options.viewStateStore.save(runtimeScopeId, input) }

  async close(runtimeScopeId: RuntimeScopeId): Promise<boolean> {
    const entry = this.windows.get(runtimeScopeId)
    if (!entry || entry.window.isDestroyed()) return false
    this.beginClose(entry)
    await this.flush(entry)
    if (!entry.window.isDestroyed()) entry.window.destroy()
    return true
  }

  dispose(): void { for (const entry of [...this.windows.values()]) this.cleanupAndDestroy(entry) }

  private nativeClose(entry: WindowEntry, event?: { preventDefault(): void }): void {
    if (entry.cleaned || entry.window.isDestroyed()) return
    event?.preventDefault()
    if (entry.closeRequested) return
    this.beginClose(entry)
    // close 事务不等待 Run/build；这里只等待独立 view-state 写链落盘再销毁视图。
    void this.flush(entry).finally(() => { if (!entry.window.isDestroyed()) entry.window.destroy() })
  }

  private beginClose(entry: WindowEntry): void {
    if (entry.closeRequested) return
    entry.closeRequested = true
    this.options.onWindowState?.(entry.window.webContents.id, { visible: false, focused: false })
    this.options.requestExit(entry.authority)
  }

  private async flush(entry: WindowEntry): Promise<void> {
    const bounds = entry.window.getBounds?.()
    if (bounds) await this.options.viewStateStore.save(entry.runtimeScopeId, { patch: { bounds } })
    await this.options.viewStateStore.flush()
  }

  private registerCapability(entry: WindowEntry): boolean {
    const capability = this.options.capabilities.registerRuntimeDevelopmentWindow(entry.window.webContents.id, entry.runtimeScopeId, entry.authority.routeGeneration, entry.authority.developmentGeneration)
    if (!capability) return false
    this.options.onCapabilityRegistered?.(capability)
    return true
  }

  private cleanup(entry: WindowEntry): void {
    if (entry.cleaned) return
    entry.cleaned = true
    if (this.windows.get(entry.runtimeScopeId) === entry) this.windows.delete(entry.runtimeScopeId)
    this.options.onWindowCleanup(entry.window.webContents.id)
  }

  private cleanupAndDestroy(entry: WindowEntry): void {
    this.cleanup(entry)
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }

  private isCurrent(entry: WindowEntry): boolean {
    return !entry.cleaned && !entry.closeRequested && !entry.window.isDestroyed() && this.windows.get(entry.runtimeScopeId) === entry
  }
}

export function runtimeDevelopmentWindowUrl(rendererEntry: string, runtimeScopeId: RuntimeScopeId): string {
  const url = new URL(rendererEntry)
  url.searchParams.set('window-kind', 'runtime-development')
  // 仅用于 renderer 显示路由；Main 注册的 webContents capability 才是 authority。
  url.searchParams.set('runtimeScopeId', runtimeScopeId)
  return url.toString()
}
