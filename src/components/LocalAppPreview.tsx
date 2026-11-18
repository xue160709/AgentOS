import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import type { LocalAppPreviewStatus, LocalAppRuntimeSnapshot } from './types'

export type LocalAppPreviewProps = {
  tabId: string
  localAppId: string
  runtime: LocalAppRuntimeSnapshot | null
  active: boolean
}

export type LocalAppPreviewRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

/** Keep this conversion pure so scroll/resize behavior can be regression-tested without Electron. */
export function localAppPreviewBoundsFromRect(rect: LocalAppPreviewRect) {
  return {
    x: Math.max(0, Number.isFinite(rect.left) ? rect.left : 0),
    y: Math.max(0, Number.isFinite(rect.top) ? rect.top : 0),
    width: Math.max(0, Number.isFinite(rect.width) ? rect.width : 0),
    height: Math.max(0, Number.isFinite(rect.height) ? rect.height : 0),
  }
}

/** DOM 宿主只显示状态；真正页面由 Main 的 WebContentsView 挂载，避免 iframe/任意 URL 绕过安全策略。 */
export function LocalAppPreview({ tabId, localAppId, runtime, active }: LocalAppPreviewProps) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const previewIdRef = useRef<string | null>(null)
  const requestSeqRef = useRef(0)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewStatus, setPreviewStatus] = useState<LocalAppPreviewStatus>('idle')

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current
    let cancelled = false
    const previousPreviewId = previewIdRef.current
    if (previousPreviewId) void window.desktop?.setLocalAppPreviewVisible?.(previousPreviewId, false)
    previewIdRef.current = null
    setPreviewId(null)
    if (!active || runtime?.status !== 'running' || !runtime.readyUrl || !window.desktop?.createLocalAppPreview) {
      setPreviewStatus(runtime?.status === 'degraded' ? 'failed' : 'idle')
      return () => { cancelled = true; requestSeqRef.current += 1 }
    }
    setPreviewStatus('loading')
    void window.desktop.createLocalAppPreview(tabId, localAppId).then((result) => {
      if (cancelled || requestSeqRef.current !== requestSeq) return
      if (result.ok) {
        previewIdRef.current = result.previewId
        setPreviewId(result.previewId)
        setPreviewStatus(result.status === 'ready' ? 'ready' : 'loading')
      } else {
        setPreviewStatus('failed')
      }
    }).catch(() => {
      if (!cancelled && requestSeqRef.current === requestSeq) setPreviewStatus('failed')
    })
    return () => {
      cancelled = true
      requestSeqRef.current += 1
      const currentPreviewId = previewIdRef.current
      previewIdRef.current = null
      // Unmounting means the tab is hidden, not released. Main closes this
      // native session only on close/stop/restart/new generation.
      if (currentPreviewId) void window.desktop?.setLocalAppPreviewVisible?.(currentPreviewId, false)
    }
  }, [active, localAppId, runtime?.generation, runtime?.readyUrl, runtime?.status, tabId])

  useEffect(() => {
    const element = hostRef.current
    if (!element || !previewId || !window.desktop?.setLocalAppPreviewBounds || !window.desktop.setLocalAppPreviewVisible) return
    const sync = () => {
      const rect = element.getBoundingClientRect()
      void window.desktop?.setLocalAppPreviewBounds?.(previewId, localAppPreviewBoundsFromRect(rect))
      void window.desktop?.setLocalAppPreviewVisible?.(previewId, active)
    }
    sync()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    observer?.observe(element)
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, { capture: true, passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, true)
      void window.desktop?.setLocalAppPreviewVisible?.(previewId, false)
    }
  }, [active, previewId])

  const visiblePreviewStatus = runtime?.previewStatus && runtime.previewStatus !== 'idle'
    ? runtime.previewStatus
    : previewStatus
  const statusText = runtime?.status === 'preparing' ? t('localApp.preparing')
    : runtime?.status === 'starting' ? t('localApp.starting')
      : runtime?.status === 'running' && visiblePreviewStatus === 'ready' ? t('localApp.previewRunning')
        : runtime?.status === 'running' && (visiblePreviewStatus === 'degraded' || visiblePreviewStatus === 'failed') ? t('localApp.previewUnavailable')
        : runtime?.status === 'degraded' ? t('localApp.previewUnavailable')
          : runtime?.status === 'failed' ? t('localApp.runtimeFailedShort')
            : runtime?.status === 'path_missing' ? t('localApp.directoryUnavailable')
              : t('localApp.stopped')
  return <div ref={hostRef} className={`local-app-preview-host is-${visiblePreviewStatus}`} data-testid="local-app-preview" aria-label={statusText}>
    {visiblePreviewStatus !== 'ready' ? <div className="local-app-preview-placeholder" role="status"><strong>{statusText}</strong><span>{runtime?.detail ?? t('localApp.previewWaiting')}</span></div> : null}
  </div>
}
