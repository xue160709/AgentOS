import { useMemo } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimeDefinition, RuntimeSnapshot, WorkspaceTab } from './types'
import { RuntimePreview } from './RuntimePreview'
import { runtimeDevelopmentStatus, runtimeServeStatus } from './runtime-event-state'
import type { RuntimeDevelopmentSnapshot } from '../runtime-development-contract'

export type RuntimeWorkspaceProps = {
  tab: WorkspaceTab
  definition: RuntimeDefinition
  runtime: RuntimeSnapshot | null
  onRetry: () => void
  onRestart: () => void
  onStop: () => void
  onReload: () => void
  onRelocate: () => void
  onBuild?: () => void
  onCancelBuild?: () => void
  onDevelopmentAction?: () => void
  logsOpen?: boolean
  onLogsToggle?: () => void
  showToolbar?: boolean
  runtimeDevelopment?: RuntimeDevelopmentSnapshot
}

export function RuntimeWorkspace({ tab, definition, runtime, onRetry, onRestart, onStop, onReload, onRelocate, onBuild, onCancelBuild, onDevelopmentAction, logsOpen = false, onLogsToggle, showToolbar = true, runtimeDevelopment }: RuntimeWorkspaceProps) {
  const { t } = useI18n()
  const status = runtime?.status ?? 'stopped'
  const staticMode = runtime?.mode ? runtime.mode === 'static' : definition.mode === 'static'
  const buildStatus = runtime?.buildStatus ?? (staticMode ? status : 'idle')
  // Main publishes both fields for static runtimes. `status` remains the
  // lifecycle authority for terminal states (especially after Stop), while
  // buildStatus carries static build progress for an active runtime.
  const displayStatus = staticMode && !['stopped', 'failed', 'path_missing'].includes(status) ? buildStatus : status
  const logs = useMemo(() => runtime?.logs?.slice(-12) ?? [], [runtime?.logs])
  const canStart = staticMode ? status === 'stopped' || ['ready', 'build_required', 'build_failed', 'stale'].includes(displayStatus) : ['failed', 'path_missing', 'stopped'].includes(status)
  const canRestart = staticMode ? status === 'stopped' || ['ready', 'stale', 'build_failed'].includes(displayStatus) : ['running', 'degraded', 'failed', 'stopped'].includes(status)
  const canStop = staticMode ? displayStatus === 'building' : ['preparing', 'starting', 'running', 'degraded'].includes(status)
  const isBuilding = staticMode && displayStatus === 'building'
  const firstBuild = isBuilding && !runtime?.artifactId && !runtime?.previewUrl
  const hasLastGood = Boolean(runtime?.artifactId && runtime?.previewUrl)
  // Borrowed Runtime: this tab owns no process, so stopping only leaves it.
  const shared = runtime?.sharedRootRuntime
  const label = t(({
    idle: 'runtime.runtimeStopped', ready: 'runtime.runtimeReady', stale: 'runtime.runtimeStale', build_required: 'runtime.runtimeBuildRequired', building: firstBuild ? 'runtime.runtimeFirstBuilding' : 'runtime.runtimeBuilding', build_failed: hasLastGood ? 'runtime.runtimeBuildFailedKeptLast' : 'runtime.runtimeBuildFailed',
    preparing: 'runtime.runtimePreparing', starting: 'runtime.runtimeStarting', running: 'runtime.runtimeRunning', degraded: 'runtime.runtimeDegraded', failed: 'runtime.runtimeFailed', path_missing: 'runtime.runtimePathMissing', stopped: 'runtime.runtimeStopped',
  } as Record<string, string>)[displayStatus] ?? 'runtime.runtimeStopped')
  const developmentStatus = runtimeDevelopmentStatus(t, runtimeDevelopment)
  const serveStatus = runtimeServeStatus(t, runtime)
  const serveAction = serveStatus.action === 'update' || serveStatus.action === 'retry'
    ? (onBuild ?? onRetry)
    : serveStatus.action === 'start' ? onRetry : undefined
  return <section className={`runtime-workspace runtime-workspace--${displayStatus}`} data-testid="runtime-workspace" aria-labelledby="runtime-workspace-title">
    {showToolbar ? <header className="local-app-workspace__toolbar">
      <div className="local-app-workspace__toolbar-title"><strong id="runtime-workspace-title">{tab.title || definition.name}</strong><span className="local-app-workspace__path" title={definition.rootPath}>{definition.rootPath}</span></div>
      <div className="local-app-workspace__actions">
        <span className="local-app-runtime-compact-status" data-testid="runtime-serve-status" role={serveStatus.alert ? 'alert' : 'status'} aria-busy={serveStatus.busy}>{serveStatus.message}</span>
        {serveAction && serveStatus.actionLabel ? <button type="button" className="btn btn-toolbar" data-testid="runtime-serve-action" onClick={serveAction}>{serveStatus.actionLabel}</button> : null}
        {onDevelopmentAction ? <><span className="local-app-runtime-compact-status" data-testid="runtime-status" role={developmentStatus.alert ? 'alert' : 'status'} aria-busy={developmentStatus.busy}>{developmentStatus.message}</span>
        <button type="button" className="btn btn-primary" data-testid={developmentStatus.action === 'end' ? 'runtime-end-development' : 'runtime-open-development'} aria-label={developmentStatus.actionLabel} onClick={onDevelopmentAction} disabled={developmentStatus.actionDisabled}>{developmentStatus.actionLabel}</button></> : null}
        {staticMode ? <button type="button" className="btn btn-primary" data-testid="runtime-build" onClick={onBuild ?? onRetry} disabled={!canStart}>{hasLastGood ? t('runtime.rebuild') : t('runtime.build')}</button> : null}
        <button type="button" className="btn btn-toolbar" data-testid="runtime-refresh" onClick={onReload} disabled={!runtime?.readyUrl && !runtime?.previewUrl}>{t('runtime.refresh')}</button>
        <button type="button" className="btn btn-toolbar" data-testid="runtime-logs" onClick={onLogsToggle} aria-expanded={logsOpen}>{t('runtime.logs')}</button>
        <button type="button" className="btn btn-toolbar" data-testid="runtime-restart" onClick={onRestart} disabled={!canRestart}>{t('runtime.restart')}</button>
        <button type="button" className="btn btn-ghost" data-testid={isBuilding ? 'runtime-cancel-build' : 'runtime-stop'} onClick={isBuilding ? (onCancelBuild ?? onStop) : onStop} disabled={!canStop}>{isBuilding ? t('runtime.cancel') : shared ? t('runtime.leaveShared') : t('runtime.stop')}</button>
      </div>
    </header> : null}
    {!showToolbar && onDevelopmentAction ? <span className="sr-only" data-testid="runtime-status" role={developmentStatus.alert ? 'alert' : 'status'} aria-busy={developmentStatus.busy}>{developmentStatus.message}</span> : null}
    {(staticMode ? ['build_required', 'build_failed'].includes(displayStatus) : ['failed', 'path_missing', 'stopped'].includes(status)) ? <div className="local-app-runtime-recovery" role={status === 'failed' || status === 'path_missing' || displayStatus === 'build_failed' ? 'alert' : undefined}><div><strong>{label}</strong></div><div className="local-app-runtime-recovery__actions"><button type="button" className="btn btn-primary" data-testid="runtime-start" onClick={staticMode ? (onBuild ?? onRetry) : onRetry} disabled={!canStart}>{staticMode ? (hasLastGood ? t('runtime.rebuild') : t('runtime.build')) : t('runtime.start')}</button><button type="button" className="btn btn-ghost" onClick={onRestart} disabled={!canRestart}>{t('runtime.restart')}</button><button type="button" className="btn btn-ghost" onClick={onRelocate}>{t('runtime.relocate')}</button></div></div> : null}
    <div className="local-app-preview-stage"><RuntimePreview host={{ kind: 'workspace-tab', workspaceTabId: tab.id, runtimeDefinitionId: definition.id }} runtime={runtime} active /></div>
    {logsOpen ? <details className="local-app-runtime-log" data-testid="runtime-log" open><summary>{t('runtime.logs')} ({logs.length})</summary><pre>{logs.join('\n') || t('runtime.noLogs')}</pre></details> : null}
  </section>
}
