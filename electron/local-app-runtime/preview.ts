/**
 * Main-owned Local App Preview. 预览页面没有应用 preload、Node 或 Electron bridge，
 * 并且只允许加载当前 Runtime 保存的 loopback origin。
 */

import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron'
import { normalizeLoopbackUrl } from './index'
import { STATIC_PREVIEW_SCHEME } from './static'
import type { LocalAppPreviewStatus } from '../../src/components/types'

export type PreviewBounds = { x: number; y: number; width: number; height: number }

export type PreviewSessionSnapshot = {
  previewId: string
  localAppId: string
  tabId: string
  runtimeId: string
  generation: number
  status: LocalAppPreviewStatus
  readyUrl?: string
  detail?: string
}

export type PreviewNavigationState = { previewId: string; canGoBack: boolean; canGoForward: boolean }

export type PreviewViewFactory = (options: {
  webPreferences: {
    nodeIntegration: false
    contextIsolation: true
    sandbox: true
    preload?: undefined
    partition: string
  }
}) => WebContentsView

/** Main-owned registration hook for a static preview's isolated session. */
export type StaticPreviewSessionRegistrar = (session: Session, previewUrl: string) => Promise<void> | void

/**
 * The only Preview-to-Main escape hatch. The receiver owns protocol parsing
 * and routing; Preview never receives a bridge, token, or protocol parser.
 */
export type PreviewAgentOSDeepLinkHandler = (rawUrl: string, session: PreviewSessionSnapshot) => void

export type LocalAppPreviewManagerOptions = {
  window: BrowserWindow
  createView: PreviewViewFactory
  loadTimeoutMs?: number
  registerStaticPreviewSession?: StaticPreviewSessionRegistrar
  onEvent?: (snapshot: PreviewSessionSnapshot) => void
  onNavigationState?: (state: PreviewNavigationState) => void
  onAgentOSDeepLink?: PreviewAgentOSDeepLinkHandler
}

type ActivePreview = {
  snapshot: PreviewSessionSnapshot
  view: WebContentsView
  origin: string
  capturedAgentOSUrls: Set<string>
}

const DEFAULT_PREVIEW_LOAD_TIMEOUT_MS = 30_000

export class LocalAppPreviewManager {
  private readonly window: BrowserWindow
  private readonly createView: PreviewViewFactory
  private readonly registerStaticPreviewSession?: StaticPreviewSessionRegistrar
  private readonly onEvent?: (snapshot: PreviewSessionSnapshot) => void
  private readonly onNavigationState?: (state: PreviewNavigationState) => void
  private readonly onAgentOSDeepLink?: PreviewAgentOSDeepLinkHandler
  private readonly loadTimeoutMs: number
  private readonly previews = new Map<string, ActivePreview>()

  constructor(options: LocalAppPreviewManagerOptions) {
    this.window = options.window
    this.createView = options.createView
    this.registerStaticPreviewSession = options.registerStaticPreviewSession
    this.onEvent = options.onEvent
    this.onNavigationState = options.onNavigationState
    this.onAgentOSDeepLink = options.onAgentOSDeepLink
    this.loadTimeoutMs = Math.max(1, options.loadTimeoutMs ?? DEFAULT_PREVIEW_LOAD_TIMEOUT_MS)
  }

  get(previewId: string): PreviewSessionSnapshot | null {
    return this.previews.get(previewId)?.snapshot ?? null
  }

  getForTab(tabId: string): PreviewSessionSnapshot | null {
    for (const active of this.previews.values()) {
      if (active.snapshot.tabId === tabId) return active.snapshot
    }
    return null
  }

  isCurrent(previewId: string, snapshot: PreviewSessionSnapshot): boolean {
    const current = this.previews.get(previewId)?.snapshot
    return Boolean(
      current &&
      current.previewId === snapshot.previewId &&
      current.tabId === snapshot.tabId &&
      current.localAppId === snapshot.localAppId &&
      current.runtimeId === snapshot.runtimeId &&
      current.generation === snapshot.generation,
    )
  }

  async closeIfCurrent(previewId: string, snapshot: PreviewSessionSnapshot): Promise<boolean> {
    if (!this.isCurrent(previewId, snapshot)) return false
    return this.close(previewId)
  }

  async create(
    previewId: string,
    tabId: string,
    localAppId: string,
    runtime: { runtimeId: string; generation: number; readyUrl?: string; previewUrl?: string },
    options: { waitForLoad?: boolean } = {},
  ): Promise<PreviewSessionSnapshot> {
    const staticPreviewUrl = normalizeStaticPreviewUrl(runtime.previewUrl ?? '')
    const readyUrl = normalizeLoopbackUrl(runtime.readyUrl ?? '') ?? staticPreviewUrl
    const previous = this.previews.get(previewId)
    if (previous && previous.snapshot.tabId === tabId && previous.snapshot.localAppId === localAppId &&
      previous.snapshot.runtimeId === runtime.runtimeId && previous.snapshot.generation === runtime.generation &&
      previous.snapshot.readyUrl === readyUrl) {
      // A tab can unmount while its native view remains hidden. Reuse that
      // session so returning to the tab does not reload the page or spawn a
      // second native view.
      if (previous.snapshot.status === 'closed') {
        await this.close(previewId)
      } else {
        return previous.snapshot
      }
    }
    if (this.previews.has(previewId)) await this.close(previewId)
    if (!readyUrl) {
      const failed: PreviewSessionSnapshot = {
        previewId, tabId, localAppId, runtimeId: runtime.runtimeId, generation: runtime.generation,
        status: 'failed', detail: '当前 Runtime 没有受控 loopback 就绪地址',
      }
      this.onEvent?.(failed)
      return failed
    }
    const url = new URL(readyUrl)
    // `URL.origin` is the literal string `null` for the private static
    // scheme. Keep the opaque scheme/host pair as the navigation boundary;
    // otherwise a same-token document navigation would be rejected by the
    // security hooks below.
    const origin = staticPreviewUrl ?? url.origin
    const view = this.createView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: undefined,
        // Preview storage is intentionally ephemeral. A local project's
        // cookies/localStorage must not outlive this managed preview session.
        // 每个 PreviewSession 使用独立的非持久 partition，避免不同 Tab
        // 共享站点存储，也避免应用重启后无理由保留本地数据。
        partition: `local-app-${localAppId}-${tabId}-${previewId}-${runtime.generation}`,
      },
    })
    if (staticPreviewUrl) {
      if (!this.registerStaticPreviewSession) {
        try { view.webContents.close() } catch { /* test double/window may already be gone */ }
        const failed: PreviewSessionSnapshot = {
          previewId, tabId, localAppId, runtimeId: runtime.runtimeId, generation: runtime.generation,
          status: 'failed', detail: '静态 Preview 协议未注册',
        }
        this.onEvent?.(failed)
        return failed
      }
      try {
        // This is deliberately before addChildView/loadURL. A partition does
        // not inherit the default session's protocol handlers.
        await this.registerStaticPreviewSession(view.webContents.session, staticPreviewUrl)
      } catch (error) {
        try { view.webContents.close() } catch { /* test double/window may already be gone */ }
        const failed: PreviewSessionSnapshot = {
          previewId, tabId, localAppId, runtimeId: runtime.runtimeId, generation: runtime.generation,
          status: 'failed', detail: error instanceof Error ? error.message : '静态 Preview 协议注册失败',
        }
        this.onEvent?.(failed)
        return failed
      }
    }
    const snapshot: PreviewSessionSnapshot = {
      previewId, tabId, localAppId, runtimeId: runtime.runtimeId, generation: runtime.generation,
      status: 'loading', readyUrl,
    }
    const active: ActivePreview = { snapshot, view, origin, capturedAgentOSUrls: new Set() }
    this.previews.set(previewId, active)
    this.configureSecurity(active)
    this.window.contentView.addChildView(view)
    view.setVisible?.(false)
    this.onEvent?.(active.snapshot)
    const load = this.load(active, readyUrl)
    if (options.waitForLoad === false) {
      void load
      return active.snapshot
    }
    return load
  }

  private async load(active: ActivePreview, readyUrl: string): Promise<PreviewSessionSnapshot> {
    const { previewId } = active.snapshot
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        active.view.webContents.loadURL(readyUrl),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('preview-load-timeout')), this.loadTimeoutMs)
        }),
      ])
      if (this.previews.get(previewId) !== active) return active.snapshot
      if (active.snapshot.status !== 'ready') {
        active.snapshot = { ...active.snapshot, status: 'ready', detail: undefined }
        this.onEvent?.(active.snapshot)
      }
    } catch (error) {
      if (this.previews.get(previewId) !== active) return active.snapshot
      if (error instanceof Error && error.message === 'preview-load-timeout') {
        try { active.view.webContents.stop() } catch { /* test doubles may not implement stop */ }
      }
      active.snapshot = {
        ...active.snapshot,
        status: 'failed',
        detail: error instanceof Error && error.message === 'preview-load-timeout'
          ? '预览加载超时，请重试'
          : error instanceof Error ? error.message : '预览加载失败',
      }
      this.onEvent?.(active.snapshot)
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    return active.snapshot
  }

  setBounds(previewId: string, bounds: PreviewBounds): boolean {
    const active = this.previews.get(previewId)
    if (!active || !validBounds(bounds)) return false
    active.view.setBounds(bounds)
    return true
  }

  setVisible(previewId: string, visible: boolean): boolean {
    const active = this.previews.get(previewId)
    if (!active) return false
    active.view.setVisible?.(visible)
    if (visible) this.emitNavigationState(active)
    return true
  }

  getNavigationState(previewId: string): PreviewNavigationState | null {
    const active = this.previews.get(previewId)
    return active && active.snapshot.status !== 'closed' ? this.navigationState(active) : null
  }

  navigate(previewId: string, direction: 'back' | 'forward'): boolean {
    const active = this.previews.get(previewId)
    if (!active || active.snapshot.status === 'closed') return false
    const contents = active.view.webContents
    if (direction === 'back') {
      if (!contents.canGoBack()) return false
      contents.goBack()
      return true
    }
    if (!contents.canGoForward()) return false
    contents.goForward()
    return true
  }

  async reload(previewId: string): Promise<boolean> {
    const active = this.previews.get(previewId)
    if (!active || active.snapshot.status === 'closed') return false
    if (active.snapshot.status !== 'loading') {
      active.snapshot = { ...active.snapshot, status: 'loading', detail: undefined }
      this.onEvent?.(active.snapshot)
    }
    try {
      await active.view.webContents.reload()
      if (this.previews.get(previewId) !== active || active.snapshot.status === 'closed') return false
      // Real WebContents emits did-finish-load as well; setting ready here
      // covers embedders/test doubles whose reload promise is the completion
      // signal and restores the Preview health after HMR/reload succeeds.
      if (active.snapshot.status !== 'ready') {
        active.snapshot = { ...active.snapshot, status: 'ready', detail: undefined }
        this.onEvent?.(active.snapshot)
      }
      return true
    } catch (error) {
      if (this.previews.get(previewId) !== active || active.snapshot.status === 'closed') return false
      active.snapshot = { ...active.snapshot, status: 'failed', detail: error instanceof Error ? error.message : '预览刷新失败' }
      this.onEvent?.(active.snapshot)
      return false
    }
  }

  async close(previewId: string): Promise<boolean> {
    const active = this.previews.get(previewId)
    if (!active) return false
    this.previews.delete(previewId)
    active.snapshot = { ...active.snapshot, status: 'closed' }
    try { this.window.contentView.removeChildView(active.view) } catch { /* window may already be destroyed */ }
    try { active.view.webContents.close() } catch { /* contents may already be gone */ }
    this.onEvent?.(active.snapshot)
    this.onNavigationState?.({ previewId, canGoBack: false, canGoForward: false })
    return true
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((id) => this.close(id)))
  }

  async closeForLocalApp(localAppId: string): Promise<void> {
    const ids = [...this.previews.values()]
      .filter((active) => active.snapshot.localAppId === localAppId)
      .map((active) => active.snapshot.previewId)
    const results = await Promise.all(ids.map((id) => this.close(id)))
    if (results.some((closed) => !closed)) throw new Error('local-app-preview-close-failed')
  }

  async closeForTab(tabId: string): Promise<void> {
    const ids = [...this.previews.values()]
      .filter((active) => active.snapshot.tabId === tabId)
      .map((active) => active.snapshot.previewId)
    const results = await Promise.all(ids.map((id) => this.close(id)))
    if (results.some((closed) => !closed)) throw new Error('local-app-preview-close-failed')
  }

  private configureSecurity(active: ActivePreview): void {
    const contents = active.view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      this.captureAgentOSDeepLink(active, url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, targetUrl) => {
      if (this.captureAgentOSDeepLink(active, targetUrl)) {
        event.preventDefault()
        return
      }
      if (!isAllowedPreviewNavigation(targetUrl, active.origin)) event.preventDefault()
    })
    contents.on('will-redirect', (event, targetUrl) => {
      if (this.captureAgentOSDeepLink(active, targetUrl)) {
        event.preventDefault()
        return
      }
      if (!isAllowedPreviewNavigation(targetUrl, active.origin)) event.preventDefault()
    })
    contents.on('did-start-loading', () => {
      if (this.previews.get(active.snapshot.previewId) !== active || active.snapshot.status === 'closed') return
      if (active.snapshot.status !== 'loading') {
        active.snapshot = { ...active.snapshot, status: 'loading', detail: undefined }
        this.onEvent?.(active.snapshot)
      }
    })
    contents.on('did-finish-load', () => {
      if (this.previews.get(active.snapshot.previewId) !== active || active.snapshot.status === 'closed') return
      if (active.snapshot.status !== 'ready') {
        active.snapshot = { ...active.snapshot, status: 'ready', detail: undefined }
        this.onEvent?.(active.snapshot)
      }
      this.emitNavigationState(active)
    })
    contents.on('did-navigate', () => this.emitNavigationState(active))
    contents.on('did-navigate-in-page', () => this.emitNavigationState(active))
    contents.on('did-fail-load', (_event, _code, description) => {
      if (this.previews.get(active.snapshot.previewId) !== active || active.snapshot.status === 'closed') return
      active.snapshot = { ...active.snapshot, status: 'degraded', detail: description || '预览连接中断' }
      this.onEvent?.(active.snapshot)
    })
    contents.session.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false))
  }

  /**
   * agentos:// remains a denied Preview navigation. A current session may hand
   * the raw URL to Main once; all parsing, deduplication, and task routing stay
   * in Main's shared AgentOS queue.
   */
  private captureAgentOSDeepLink(active: ActivePreview, targetUrl: string): boolean {
    if (!isAgentOSUrl(targetUrl)) return false
    if (!this.isActive(active)) return true
    if (active.capturedAgentOSUrls.has(targetUrl)) return true
    active.capturedAgentOSUrls.add(targetUrl)
    this.onAgentOSDeepLink?.(targetUrl, active.snapshot)
    // The callback is intentionally synchronous. Re-checking means a callback
    // that closes/replaces the Preview cannot cause any follow-up Preview work.
    if (!this.isActive(active)) return true
    return true
  }

  private isActive(active: ActivePreview): boolean {
    return this.previews.get(active.snapshot.previewId) === active && active.snapshot.status !== 'closed'
  }

  private navigationState(active: ActivePreview): PreviewNavigationState {
    const contents = active.view.webContents
    return {
      previewId: active.snapshot.previewId,
      canGoBack: typeof contents.canGoBack === 'function' && contents.canGoBack(),
      canGoForward: typeof contents.canGoForward === 'function' && contents.canGoForward(),
    }
  }

  private emitNavigationState(active: ActivePreview): void {
    if (this.isActive(active)) this.onNavigationState?.(this.navigationState(active))
  }
}

/** Neutral public name; the physical module path remains migration-only. */
export { LocalAppPreviewManager as RuntimePreviewManager }

export function isAllowedPreviewNavigation(targetUrl: string, origin: string): boolean {
  try {
    const target = new URL(targetUrl)
    const base = new URL(origin)
    if (target.protocol !== base.protocol || target.hostname !== base.hostname || target.port !== base.port) return false
    if (target.protocol === `${STATIC_PREVIEW_SCHEME}:`) return Boolean(target.hostname && /^[a-f0-9]{48}$/.test(target.hostname))
    return normalizeLoopbackUrl(target.toString()) !== null
  } catch {
    return false
  }
}

function isAgentOSUrl(targetUrl: string): boolean {
  try { return new URL(targetUrl).protocol === 'agentos:' } catch { return false }
}

function normalizeStaticPreviewUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== `${STATIC_PREVIEW_SCHEME}:` || !/^[a-f0-9]{48}$/.test(url.hostname) || url.username || url.password || url.port) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function validBounds(bounds: PreviewBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value)) && bounds.width >= 0 && bounds.height >= 0
}

/** Convert a renderer host's viewport rect into safe WebContentsView bounds. */
export function previewBoundsFromRect(rect: { left: number; top: number; width: number; height: number }): PreviewBounds {
  return {
    x: Math.max(0, Number.isFinite(rect.left) ? rect.left : 0),
    y: Math.max(0, Number.isFinite(rect.top) ? rect.top : 0),
    width: Math.max(0, Number.isFinite(rect.width) ? rect.width : 0),
    height: Math.max(0, Number.isFinite(rect.height) ? rect.height : 0),
  }
}

export function createElectronPreviewView(options: { WebContentsView: new (options: PreviewViewFactory extends (arg: infer A) => any ? A : never) => WebContentsView }): PreviewViewFactory {
  return ({ webPreferences }) => new options.WebContentsView({ webPreferences })
}

export function attachPreviewRuntimeListeners(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
