import { useMemo } from 'react'
import { useI18n } from '../i18n/i18n'
import type { LocalAppDefinition, LocalAppRuntimeSnapshot, LocalAppTab } from './types'
import { LocalAppPreview } from './LocalAppPreview'

export type LocalAppWorkspaceProps = {
  tab: LocalAppTab
  definition: LocalAppDefinition
  runtime: LocalAppRuntimeSnapshot | null
  onRetry: () => void
  onRestart: () => void
  onStop: () => void
  onClose: () => void
  onReload: () => void
  onRelocate: () => void
  onRemove: () => void
  logsOpen?: boolean
  onLogsToggle?: () => void
  showToolbar?: boolean
}

export function LocalAppWorkspace({ tab, definition, runtime, onRetry, onRestart, onStop, onClose, onReload, onRelocate, onRemove, logsOpen = false, onLogsToggle, showToolbar = true }: LocalAppWorkspaceProps) {
  const { t } = useI18n()
  const status = runtime?.status ?? 'stopped'
  const canRetry = status === 'failed' || status === 'path_missing' || status === 'stopped'
  const canRestart = status === 'running' || status === 'degraded' || status === 'failed' || status === 'stopped'
  const canStop = status === 'preparing' || status === 'starting' || status === 'running' || status === 'degraded'
  const logs = useMemo(() => runtime?.logs?.slice(-12) ?? [], [runtime?.logs])
  const showRecovery = Boolean(runtime?.errorCode) || status === 'failed' || status === 'path_missing'
  return <section className={`local-app-workspace local-app-workspace--${status}`} aria-labelledby="local-app-workspace-title">
    {showToolbar ? <header className="local-app-workspace__toolbar">
      <div className="local-app-workspace__toolbar-title"><strong id="local-app-workspace-title">{tab.title || definition.name}</strong><span className="local-app-workspace__path" title={definition.rootPath}>{definition.rootPath}</span></div>
      <div className="local-app-workspace__actions">
        <span className="local-app-runtime-compact-status" data-testid="local-app-runtime-status" role="status">{runtimeStatusLabel(t, status)}</span>
        <button type="button" className="btn btn-toolbar" data-testid="local-app-preview-refresh" onClick={onReload} disabled={!runtime?.readyUrl} title={t('localApp.refreshPreviewHint')}>{t('localApp.refreshPreview')}</button>
        <button type="button" className="btn btn-toolbar" data-testid="local-app-logs" onClick={onLogsToggle} aria-expanded={logsOpen}>{t('localApp.logs')}</button>
        <button type="button" className="btn btn-toolbar" data-testid="local-app-restart" onClick={onRestart} disabled={!canRestart} title={t('localApp.restartHint')}>{t('localApp.restart')}</button>
        <button type="button" className="btn btn-ghost" data-testid="local-app-stop" onClick={onStop} disabled={!canStop}>{t('localApp.stop')}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('localApp.close')}</button>
      </div>
    </header> : null}
    {!showToolbar ? <span className="sr-only" data-testid="local-app-runtime-status" role="status">{runtimeStatusLabel(t, status)}{runtime?.detail ? `: ${runtime.detail}` : ''}</span> : null}
    {status === 'degraded' && runtime?.detail ? <div className="local-app-runtime-degraded" role="status">{runtime.detail}</div> : null}
    {showRecovery ? <div className="local-app-runtime-recovery" role={status === 'failed' || status === 'path_missing' ? 'alert' : undefined}>
      <div><strong>{runtimeStatusLabel(t, status)}</strong>{runtime?.detail ? <span>{runtime.detail}</span> : null}</div>
      <div className="local-app-runtime-recovery__actions">
        <button type="button" className="btn btn-primary" data-testid="local-app-retry" onClick={onRetry} disabled={!canRetry}>{status === 'stopped' ? t('localApp.start') : t('localApp.retry')}</button>
        <button type="button" className="btn btn-ghost" onClick={onRestart} disabled={!canRestart}>{t('localApp.restart')}</button>
        <button type="button" className="btn btn-ghost" onClick={onRelocate}>{t('localApp.relocate')}</button>
        <button type="button" className="btn btn-danger" onClick={onRemove}>{t('localApp.remove')}</button>
      </div>
    </div> : null}
    <div className="local-app-preview-stage"><LocalAppPreview tabId={tab.id} localAppId={definition.id} runtime={runtime} active /></div>
    {logsOpen ? <details className="local-app-runtime-log" data-testid="local-app-runtime-log" open><summary>{t('localApp.recentLogs', { n: logs.length })}</summary><pre>{logs.join('\n') || t('localApp.noLogs')}</pre></details> : null}
  </section>
}

function runtimeStatusLabel(t: (path: string) => string, status: LocalAppRuntimeSnapshot['status']): string {
  const labels: Record<LocalAppRuntimeSnapshot['status'], string> = {
    ready: 'localApp.runtimeReady',
    stale: 'localApp.runtimeStale',
    build_required: 'localApp.runtimeBuildRequired',
    building: 'localApp.runtimeBuilding',
    build_failed: 'localApp.runtimeBuildFailed',
    development: 'localApp.runtimeRunning',
    preparing: 'localApp.runtimePreparing',
    starting: 'localApp.runtimeStarting',
    running: 'localApp.runtimeRunning',
    degraded: 'localApp.runtimeDegraded',
    failed: 'localApp.runtimeFailed',
    path_missing: 'localApp.runtimePathMissing',
    stopped: 'localApp.runtimeStopped',
  }
  return t(labels[status])
}
