import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimeDefinition, RuntimeServeOverride, RuntimeSnapshot, WorkspaceTab } from './types'

export function RuntimeDetailsDialog({
  tab,
  definition,
  runtime,
  onClose,
  onServeOverrideChange,
}: {
  tab: WorkspaceTab
  definition: RuntimeDefinition
  runtime: RuntimeSnapshot | null
  onClose: () => void
  /** `C-RSM-404` / `Q-R5-01`: the view-mode override lives here, not on the workbench. */
  onServeOverrideChange?: (next: RuntimeServeOverride | null) => void
}) {
  const { t } = useI18n()
  const [serveOverride, setServeOverride] = useState<RuntimeServeOverride | undefined>(definition.serveOverride)
  const chooseOverride = (next: RuntimeServeOverride | null) => {
    setServeOverride(next ?? undefined)
    onServeOverrideChange?.(next)
  }
  const dialogRef = useRef<HTMLElement>(null)
  const logs = runtime?.logs?.slice(-40) ?? []

  useEffect(() => {
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return <div className="runtime-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="runtime-details-dialog" role="dialog" aria-modal="true" aria-labelledby="runtime-details-title">
      <header className="runtime-details-dialog__header">
        <div><span>{t('runtime.viewRuntime')}</span><h2 id="runtime-details-title">{tab.title}</h2></div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('runtime.done')}</button>
      </header>
      <dl className="runtime-details-dialog__facts">
        <div><dt>{t('runtime.status')}</dt><dd>{runtime ? t(runtimeStatusKey(runtime.status)) : t('runtime.runtimeStopped')}</dd></div>
        <div><dt>{t('runtime.mode')}</dt><dd>{runtime?.mode === 'development' ? t('runtime.viewModeDevelopment') : t('runtime.viewModeArtifact')}</dd></div>
        <div><dt>{t('runtime.directory')}</dt><dd title={definition.rootPath}>{definition.rootPath}</dd></div>
        {runtime?.detail ? <div><dt>{t('runtime.detail')}</dt><dd>{runtime.detail}</dd></div> : null}
      </dl>
      {onServeOverrideChange ? <div className="runtime-details-dialog__view-mode" role="group" aria-label={t('runtime.viewMode')} data-testid="runtime-details-view-mode">
        <span>{t('runtime.viewMode')}</span>
        <button type="button" className="btn btn-toolbar" aria-pressed={serveOverride === 'artifact'} onClick={() => chooseOverride('artifact')}>{t('runtime.viewModeArtifact')}</button>
        <button type="button" className="btn btn-toolbar" aria-pressed={serveOverride === 'server'} onClick={() => chooseOverride('server')}>{t('runtime.viewModeDevelopment')}</button>
        {serveOverride ? <button type="button" className="btn btn-ghost" onClick={() => chooseOverride(null)}>{t('runtime.viewModeAuto')}</button> : null}
      </div> : null}
      <section className="runtime-details-dialog__logs" aria-label={t('runtime.logs')}>
        <h3>{t('runtime.logs')}</h3>
        <pre>{logs.join('\n') || t('runtime.noLogs')}</pre>
      </section>
    </section>
  </div>
}

function runtimeStatusKey(status: RuntimeSnapshot['status']): string {
  return ({
    ready: 'runtime.runtimeReady', stale: 'runtime.runtimeStale', build_required: 'runtime.runtimeBuildRequired',
    building: 'runtime.runtimeBuilding', build_failed: 'runtime.runtimeBuildFailed', development: 'runtime.runtimeRunning',
    preparing: 'runtime.runtimePreparing', starting: 'runtime.runtimeStarting', running: 'runtime.runtimeRunning',
    degraded: 'runtime.runtimeDegraded', failed: 'runtime.runtimeFailed', path_missing: 'runtime.runtimePathMissing',
    stopped: 'runtime.runtimeStopped',
  } as Record<RuntimeSnapshot['status'], string>)[status]
}
