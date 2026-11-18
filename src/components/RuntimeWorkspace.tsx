import { useMemo, useRef } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimeDefinition, RuntimeSnapshot, WorkspaceTab } from './types'
import { RuntimePreview } from './RuntimePreview'
import { runtimeDevelopmentStatus, runtimeWorkbenchState } from './runtime-event-state'
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

export function RuntimeWorkspace({ tab, definition, runtime, onRetry, onReload, onRelocate, onBuild, onDevelopmentAction, logsOpen = false, onLogsToggle, showToolbar = true, runtimeDevelopment }: RuntimeWorkspaceProps) {
  const { t } = useI18n()
  const logs = useMemo(() => runtime?.logs?.slice(-12) ?? [], [runtime?.logs])
  const developmentStatus = runtimeDevelopmentStatus(t, runtimeDevelopment)
  // `C-RSM-504/506`: normal states show only the page; the single recovery
  // action appears with the reason only when something is wrong. Build,
  // restart and stop live in the sidebar troubleshooting group (`C-RSM-505`).
  const view = runtimeWorkbenchState(runtime)
  // The first open spans several Runtime generations (static attempt, then
  // the server); keep the first-open hint until a page has been shown once.
  const pageShown = useRef({ definitionId: definition.id, shown: false })
  if (pageShown.current.definitionId !== definition.id) pageShown.current = { definitionId: definition.id, shown: false }
  if (view.kind === 'viewing' || view.kind === 'updating' || view.kind === 'update-failed') pageShown.current.shown = true
  const firstOpen = view.kind === 'preparing' && (view.firstBuild || !pageShown.current.shown)
  const refresh = onBuild ?? onRetry
  const logsButton = onLogsToggle ? <button type="button" className="btn btn-ghost" data-testid="runtime-view-logs" onClick={onLogsToggle} aria-expanded={logsOpen}>{t('runtime.viewLogs')}</button> : null
  const recovery = (title: string, reason: string | undefined, action: { label: string; run: () => void; testId: string } | null) => (
    <div className="runtime-workbench-recovery" role="alert" data-testid="runtime-recovery">
      <strong>{title}</strong>
      {reason ? <span>{reason}</span> : null}
      <div className="runtime-workbench-recovery__actions">
        {action ? <button type="button" className="btn btn-primary" data-testid={action.testId} onClick={action.run}>{action.label}</button> : null}
        {logsButton}
      </div>
    </div>
  )
  const placeholder = view.kind === 'preparing'
    ? <div className="runtime-workbench-progress" role="status" aria-busy="true"><strong>{t('runtime.servePreparing')}</strong>{firstOpen ? <span>{t('runtime.serveFirstBuildHint')}</span> : null}</div>
    : view.kind === 'updating' && !view.pageVisible
      ? <div className="runtime-workbench-progress" role="status" aria-busy="true"><strong>{t('runtime.serveUpdating')}</strong></div>
      : view.kind === 'open-failed'
        ? recovery(t('runtime.serveOpenFailed'), view.reason, { label: t('runtime.retry'), run: refresh, testId: 'runtime-retry' })
        : view.kind === 'not-ready'
          ? recovery(t('runtime.serveNotReady'), undefined, { label: t('runtime.openPage'), run: refresh, testId: 'runtime-open-page' })
          : view.kind === 'path-missing'
            ? recovery(t('runtime.servePathMissing'), definition.rootPath, { label: t('runtime.relocate'), run: onRelocate, testId: 'runtime-relocate' })
            : view.kind === 'stopped'
              ? recovery(t('runtime.serveStoppedTitle'), undefined, { label: t('runtime.startRuntime'), run: onRetry, testId: 'runtime-start' })
              // A viewable page sits under the native Preview; the layer beneath
              // only ever needs a neutral loading line, never status or errors.
              : <div className="runtime-workbench-progress" role="status"><strong>{t('runtime.previewLoading')}</strong></div>
  return <section className={`runtime-workspace runtime-workspace--${view.kind}`} data-testid="runtime-workspace" aria-labelledby="runtime-workspace-title">
    {showToolbar ? <header className="local-app-workspace__toolbar">
      <div className="local-app-workspace__toolbar-title"><strong id="runtime-workspace-title">{tab.title || definition.name}</strong><span className="local-app-workspace__path" title={definition.rootPath}>{definition.rootPath}</span></div>
      <div className="local-app-workspace__actions">
        {onDevelopmentAction ? <><span className="local-app-runtime-compact-status" data-testid="runtime-status" role={developmentStatus.alert ? 'alert' : 'status'} aria-busy={developmentStatus.busy}>{developmentStatus.message}</span>
        <button type="button" className="btn btn-primary" data-testid={developmentStatus.action === 'end' ? 'runtime-end-development' : 'runtime-open-development'} aria-label={developmentStatus.actionLabel} onClick={onDevelopmentAction} disabled={developmentStatus.actionDisabled}>{developmentStatus.actionLabel}</button></> : null}
        <button type="button" className="btn btn-toolbar" data-testid="runtime-refresh" onClick={onReload} disabled={!runtime?.readyUrl && !runtime?.previewUrl}>{t('runtime.refresh')}</button>
      </div>
    </header> : null}
    {!showToolbar && onDevelopmentAction ? <span className="sr-only" data-testid="runtime-status" role={developmentStatus.alert ? 'alert' : 'status'} aria-busy={developmentStatus.busy}>{developmentStatus.message}</span> : null}
    {view.kind === 'update-failed' ? <div className="runtime-workbench-warning" role="alert" data-testid="runtime-update-failed">
      <span>{t('runtime.serveUpdateFailed', { reason: view.reason ?? '' })}</span>
      <div className="runtime-workbench-recovery__actions">
        <button type="button" className="btn btn-primary" data-testid="runtime-retry" onClick={refresh}>{t('runtime.retry')}</button>
        {logsButton}
      </div>
    </div> : null}
    {/* Outside the stage: the native Preview view paints over any DOM inside its bounds. */}
    {view.kind === 'updating' && view.pageVisible ? <div className="runtime-workbench-updating" role="status" aria-busy="true" data-testid="runtime-updating">{t('runtime.serveUpdating')}</div> : null}
    <div className="local-app-preview-stage">
      <RuntimePreview host={{ kind: 'workspace-tab', workspaceTabId: tab.id, runtimeDefinitionId: definition.id }} runtime={runtime} active placeholder={placeholder} />
    </div>
    {logsOpen ? <details className="local-app-runtime-log" data-testid="runtime-log" open><summary>{t('runtime.logs')} ({logs.length})</summary><pre>{logs.join('\n') || t('runtime.noLogs')}</pre></details> : null}
  </section>
}
