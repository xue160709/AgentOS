import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimePreviewHost } from '../desktop-api'
import { RUNTIME_PREVIEW_RESIZE_EVENT, type RuntimePreviewResizeEvent } from '../runtime-preview-events'
import type { PreviewStatus, RuntimeSnapshot } from './types'
import { runtimePreviewReady } from './runtime-event-state'

export type RuntimePreviewProps = { host: RuntimePreviewHost; runtime: RuntimeSnapshot | null; active: boolean; testId?: string }

export function runtimePreviewBoundsFromRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  return { x: Math.max(0, Number.isFinite(rect.left) ? rect.left : 0), y: Math.max(0, Number.isFinite(rect.top) ? rect.top : 0), width: Math.max(0, Number.isFinite(rect.width) ? rect.width : 0), height: Math.max(0, Number.isFinite(rect.height) ? rect.height : 0) }
}

export function RuntimePreview({ host, runtime, active, testId = 'runtime-preview' }: RuntimePreviewProps) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const previewIdRef = useRef<string | null>(null)
  const requestRef = useRef(0)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle')
  const [previewMountKey, setPreviewMountKey] = useState(0)
  const previewReady = runtimePreviewReady(runtime)
  useEffect(() => {
    const request = ++requestRef.current
    let cancelled = false
    const previous = previewIdRef.current
    if (previous) void window.desktop?.setRuntimePreviewVisible?.(previous, false)
    previewIdRef.current = null
    if (!active || !previewReady || !window.desktop?.createRuntimePreview) {
      setPreviewStatus(runtime?.status === 'degraded' ? 'degraded' : 'idle')
      return () => { cancelled = true; requestRef.current += 1 }
    }
    setPreviewStatus('loading')
    void window.desktop.createRuntimePreview(host).then((result) => {
      if (cancelled || requestRef.current !== request) return
      if (!result.ok) { setPreviewStatus('failed'); return }
      previewIdRef.current = result.previewId
      setPreviewMountKey((key) => key + 1)
      setPreviewStatus(result.status === 'ready' ? 'ready' : 'loading')
    }).catch(() => { if (!cancelled && requestRef.current === request) setPreviewStatus('failed') })
    return () => {
      cancelled = true
      requestRef.current += 1
      const previewId = previewIdRef.current
      previewIdRef.current = null
      if (previewId) {
        void window.desktop?.setRuntimePreviewVisible?.(previewId, false)
      }
    }
  }, [active, host.kind, host.kind === 'project-home' ? host.projectId : host.workspaceTabId, host.kind === 'project-home' ? host.mountId : host.runtimeDefinitionId, host.runtimeDefinitionId, runtime?.generation, runtime?.readyUrl, runtime?.previewUrl, runtime?.mode, previewReady])
  useEffect(() => {
    const element = hostRef.current
    const previewId = previewIdRef.current
    if (!element || !previewId || !window.desktop?.setRuntimePreviewBounds || !window.desktop.setRuntimePreviewVisible) return
    let resizeActive = false
    const sync = () => { void window.desktop?.setRuntimePreviewBounds?.(previewId, runtimePreviewBoundsFromRect(element.getBoundingClientRect())); if (!resizeActive) void window.desktop?.setRuntimePreviewVisible?.(previewId, active) }
    let resumeFrame: number | null = null
    const onResizeActive = (event: Event) => {
      const resizing = (event as RuntimePreviewResizeEvent).detail?.active === true
      resizeActive = resizing
      if (resumeFrame !== null) { window.cancelAnimationFrame(resumeFrame); resumeFrame = null }
      if (resizing) {
        void window.desktop?.setRuntimePreviewVisible?.(previewId, false)
        return
      }
      resumeFrame = window.requestAnimationFrame(() => { resumeFrame = null; sync() })
    }
    sync()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    observer?.observe(element)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    window.addEventListener(RUNTIME_PREVIEW_RESIZE_EVENT, onResizeActive)
    return () => { if (resumeFrame !== null) window.cancelAnimationFrame(resumeFrame); observer?.disconnect(); window.removeEventListener('resize', sync); window.removeEventListener('scroll', sync, true); window.removeEventListener(RUNTIME_PREVIEW_RESIZE_EVENT, onResizeActive); void window.desktop?.setRuntimePreviewVisible?.(previewId, false) }
  }, [active, previewMountKey])
  const effectivePreviewStatus = runtime?.previewStatus && runtime.previewStatus !== 'idle'
    ? runtime.previewStatus
    : previewStatus
  const staticLifecycleStatus = runtime?.mode === 'static' && !['stopped', 'failed', 'path_missing'].includes(runtime.status)
    ? runtime.buildStatus ?? runtime.status
    : runtime?.status
  const hasRuntimePreview = ['running', 'ready', 'stale', 'building', 'build_failed'].includes(staticLifecycleStatus ?? '')
  const previewStatusKey = effectivePreviewStatus === 'loading' && hasRuntimePreview
    ? 'runtime.previewLoading'
    : effectivePreviewStatus === 'failed' && hasRuntimePreview
      ? 'runtime.previewFailed'
      : null
  const status = staticLifecycleStatus === 'building'
    ? (!runtime?.artifactId && !runtime?.previewUrl ? t('runtime.runtimeFirstBuilding') : t('runtime.runtimeBuilding'))
    : staticLifecycleStatus === 'build_required'
      ? t('runtime.runtimeBuildRequired')
      : previewStatusKey
        ? t(previewStatusKey)
        : staticLifecycleStatus === 'preparing' ? t('runtime.runtimePreparing')
          : staticLifecycleStatus === 'starting' ? t('runtime.runtimeStarting')
            : staticLifecycleStatus === 'running' ? (effectivePreviewStatus === 'ready' ? t('runtime.preview') : t('runtime.runtimeRunning'))
              : staticLifecycleStatus === 'ready' ? (effectivePreviewStatus === 'ready' ? t('runtime.preview') : t('runtime.runtimeReady'))
                : staticLifecycleStatus === 'stale' ? t('runtime.runtimeStale')
                  : staticLifecycleStatus === 'build_failed' ? t(runtime?.artifactId && runtime.previewUrl ? 'runtime.runtimeBuildFailedKeptLast' : 'runtime.runtimeBuildFailed')
                    : staticLifecycleStatus === 'degraded' ? t('runtime.runtimeDegraded')
                      : staticLifecycleStatus === 'failed' ? t('runtime.runtimeFailed')
                        : staticLifecycleStatus === 'path_missing' ? t('runtime.runtimePathMissing')
                          : t('runtime.runtimeStopped')
  return <div ref={hostRef} className={`runtime-preview-host is-${effectivePreviewStatus}`} data-testid={testId} role="region" aria-label={status}>{effectivePreviewStatus !== 'ready' ? <div className="local-app-preview-placeholder" role="status"><strong>{status}</strong><span>{runtime?.detail ?? t('runtime.preview')}</span></div> : null}</div>
}
