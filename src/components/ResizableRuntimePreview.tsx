import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimePreviewLayoutSize } from '../desktop-api'

const DEFAULT_HEIGHT = 960
const MIN_WIDTH = 480
const MIN_HEIGHT = 240
const MAX_WIDTH = 4_096
const MAX_HEIGHT = 1_600
const KEYBOARD_SAVE_DELAY_MS = 400

type ResizeAxis = 'width' | 'height' | 'both'
type PreviewSize = { width?: number; height: number }
type DragState = { axis: ResizeAxis; startX: number; startY: number; startWidth: number; startHeight: number; maxWidth: number }

export function clampRuntimePreviewSize(size: RuntimePreviewLayoutSize, availableWidth: number): RuntimePreviewLayoutSize {
  const maximumWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(availableWidth) || MAX_WIDTH))
  return {
    width: Math.min(maximumWidth, Math.max(MIN_WIDTH, Math.round(size.width))),
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(size.height))),
  }
}

export function ResizableRuntimePreview({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { t } = useI18n()
  const frameRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<PreviewSize>({ height: DEFAULT_HEIGHT })
  const dragRef = useRef<DragState | null>(null)
  const pendingSizeRef = useRef<RuntimePreviewLayoutSize | null>(null)
  const frameRequestRef = useRef<number | null>(null)
  const keyboardSaveRef = useRef<number | null>(null)
  const statusTimerRef = useRef<number | null>(null)
  const loadRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const currentProjectRef = useRef(projectId)
  const [size, setSizeState] = useState<PreviewSize>({ height: DEFAULT_HEIGHT })
  const [dragging, setDragging] = useState<ResizeAxis | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')

  const setSize = (next: PreviewSize) => {
    sizeRef.current = next
    setSizeState(next)
  }
  currentProjectRef.current = projectId

  useEffect(() => {
    const request = ++loadRequestRef.current
    saveRequestRef.current += 1
    if (keyboardSaveRef.current !== null) { window.clearTimeout(keyboardSaveRef.current); keyboardSaveRef.current = null }
    dragRef.current = null
    pendingSizeRef.current = null
    setDragging(null)
    document.documentElement.classList.remove('is-resizing-runtime-preview')
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', finishDrag)
    window.removeEventListener('pointercancel', finishDrag)
    setSize({ height: DEFAULT_HEIGHT })
    setSaveStatus('idle')
    void window.desktop?.getRuntimePreviewLayout?.(projectId).then((layout) => {
      if (request !== loadRequestRef.current) return
      setSize({ ...(layout.width ? { width: layout.width } : {}), height: layout.height })
    }).catch(() => { /* defaults remain usable */ })
    return () => { loadRequestRef.current += 1 }
  }, [projectId])

  useEffect(() => () => {
    if (frameRequestRef.current !== null) window.cancelAnimationFrame(frameRequestRef.current)
    if (keyboardSaveRef.current !== null) window.clearTimeout(keyboardSaveRef.current)
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current)
    dragRef.current = null
    document.documentElement.classList.remove('is-resizing-runtime-preview')
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', finishDrag)
    window.removeEventListener('pointercancel', finishDrag)
  }, [])

  const availableWidth = () => frameRef.current?.parentElement?.getBoundingClientRect().width ?? MAX_WIDTH

  const showTransientStatus = (status: 'saved' | 'failed') => {
    setSaveStatus(status)
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setSaveStatus('idle'), status === 'saved' ? 1_200 : 3_000)
  }

  const persist = async (next: RuntimePreviewLayoutSize) => {
    const targetProjectId = projectId
    const request = ++saveRequestRef.current
    setSaveStatus('saving')
    try {
      const save = window.desktop?.saveRuntimePreviewLayout
      if (!save) throw new Error('runtime-preview-layout-unavailable')
      const saved = await save(targetProjectId, next)
      if (currentProjectRef.current !== targetProjectId || request !== saveRequestRef.current) return
      if (saved) setSize({ width: saved.width ?? next.width, height: saved.height })
      showTransientStatus('saved')
    } catch {
      if (currentProjectRef.current !== targetProjectId || request !== saveRequestRef.current) return
      showTransientStatus('failed')
    }
  }

  const applyPendingSize = () => {
    frameRequestRef.current = null
    const pending = pendingSizeRef.current
    if (!pending) return
    pendingSizeRef.current = null
    setSize(pending)
  }

  const queueSize = (next: RuntimePreviewLayoutSize) => {
    pendingSizeRef.current = next
    if (frameRequestRef.current === null) frameRequestRef.current = window.requestAnimationFrame(applyPendingSize)
  }

  const finishDrag = () => {
    const active = dragRef.current
    if (!active) return
    dragRef.current = null
    setDragging(null)
    document.documentElement.classList.remove('is-resizing-runtime-preview')
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', finishDrag)
    window.removeEventListener('pointercancel', finishDrag)
    if (frameRequestRef.current !== null) {
      window.cancelAnimationFrame(frameRequestRef.current)
      frameRequestRef.current = null
    }
    const next = pendingSizeRef.current ?? {
      width: sizeRef.current.width ?? frameRef.current?.getBoundingClientRect().width ?? MIN_WIDTH,
      height: sizeRef.current.height,
    }
    pendingSizeRef.current = null
    setSize(next)
    void persist(next)
  }

  const onWindowPointerMove = (event: PointerEvent) => {
    const active = dragRef.current
    if (!active) return
    const width = active.axis === 'height' ? active.startWidth : active.startWidth + event.clientX - active.startX
    const height = active.axis === 'width' ? active.startHeight : active.startHeight + event.clientY - active.startY
    queueSize(clampRuntimePreviewSize({ width, height }, active.maxWidth))
  }

  const startDrag = (axis: ResizeAxis, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    // Keep receiving pointer events while the cursor crosses the native
    // WebContentsView; otherwise shrinking into the page interrupts the drag.
    event.currentTarget.setPointerCapture(event.pointerId)
    loadRequestRef.current += 1
    dragRef.current = { axis, startX: event.clientX, startY: event.clientY, startWidth: rect.width, startHeight: rect.height, maxWidth: availableWidth() }
    setDragging(axis)
    setSaveStatus('idle')
    document.documentElement.classList.add('is-resizing-runtime-preview')
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
  }

  const scheduleKeyboardSave = (next: RuntimePreviewLayoutSize) => {
    if (keyboardSaveRef.current !== null) window.clearTimeout(keyboardSaveRef.current)
    keyboardSaveRef.current = window.setTimeout(() => { keyboardSaveRef.current = null; void persist(next) }, KEYBOARD_SAVE_DELAY_MS)
  }

  const resizeFromKeyboard = (axis: ResizeAxis, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 50 : 10
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    let width = rect.width
    let height = rect.height
    let handled = false
    if (axis !== 'height' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      width += event.key === 'ArrowRight' ? step : -step
      handled = true
    }
    if (axis !== 'width' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      height += event.key === 'ArrowDown' ? step : -step
      handled = true
    }
    if (!handled) return
    event.preventDefault()
    const next = clampRuntimePreviewSize({ width, height }, availableWidth())
    setSize(next)
    scheduleKeyboardSave(next)
  }

  const reset = async () => {
    if (keyboardSaveRef.current !== null) window.clearTimeout(keyboardSaveRef.current)
    const targetProjectId = projectId
    const request = ++saveRequestRef.current
    setSaveStatus('saving')
    try {
      const resetLayout = window.desktop?.resetRuntimePreviewLayout
      if (!resetLayout) throw new Error('runtime-preview-layout-unavailable')
      const layout = await resetLayout(targetProjectId)
      if (currentProjectRef.current !== targetProjectId || request !== saveRequestRef.current) return
      setSize({ height: layout?.height ?? DEFAULT_HEIGHT })
      showTransientStatus('saved')
    } catch {
      if (currentProjectRef.current !== targetProjectId || request !== saveRequestRef.current) return
      showTransientStatus('failed')
    }
  }

  const label = `${Math.round(size.width ?? frameRef.current?.getBoundingClientRect().width ?? 0)} × ${Math.round(size.height)}`
  return <div
    ref={frameRef}
    className={`runtime-preview-resizer${dragging ? ' is-resizing' : ''}`}
    style={{ width: size.width ? `${size.width}px` : '100%', height: `${size.height}px`, maxWidth: '100%' }}
    data-testid="runtime-preview-resizer"
  >
    <div className="runtime-preview-resizer__viewport">{children}</div>
    <button type="button" className="runtime-preview-resizer__handle is-width" aria-label={t('runtime.resizePreviewWidth')} onPointerDown={(event) => startDrag('width', event)} onKeyDown={(event) => resizeFromKeyboard('width', event)} />
    <button type="button" className="runtime-preview-resizer__handle is-height" aria-label={t('runtime.resizePreviewHeight')} onPointerDown={(event) => startDrag('height', event)} onKeyDown={(event) => resizeFromKeyboard('height', event)} />
    <button type="button" className="runtime-preview-resizer__handle is-both" aria-label={t('runtime.resizePreviewBoth')} title={t('runtime.resetPreviewSizeHint')} onPointerDown={(event) => startDrag('both', event)} onKeyDown={(event) => resizeFromKeyboard('both', event)} onDoubleClick={() => void reset()}><span aria-hidden>↘</span></button>
    {(dragging || saveStatus !== 'idle') ? <div className={`runtime-preview-resizer__status is-${saveStatus}`} role={saveStatus === 'failed' ? 'alert' : 'status'}>{saveStatus === 'failed' ? t('runtime.previewSizeSaveFailed') : saveStatus === 'saving' ? t('runtime.previewSizeSaving') : label}</div> : null}
  </div>
}
