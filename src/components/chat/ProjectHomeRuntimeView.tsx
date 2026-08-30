import { useI18n } from '../../i18n/i18n'
import type { RuntimeDefinition, RuntimeServeOverride, RuntimeSnapshot, WorkspaceProject } from '../types'
import { RuntimePreview } from '../RuntimePreview'
import { ResizableRuntimePreview } from '../ResizableRuntimePreview'
import { runtimeDevelopmentStatus, runtimeServeStatus } from '../runtime-event-state'
import type { RuntimeDevelopmentSnapshot } from '../../runtime-development-contract'

export type ProjectHomeRuntimeController = {
  project: WorkspaceProject
  mountId: string
  definition?: RuntimeDefinition
  runtime: RuntimeSnapshot | null
  status: 'not_initialized' | 'trust_required' | 'ready'
  runtimeRoot: string
  misplacedRuntime?: boolean
  trustRequired: boolean
  logsOpen: boolean
  onStart: () => void
  onCreate?: () => void
  onRefresh: () => void
  onToggleLogs: () => void
  onRestart: () => void
  onStop: () => void
  onBuild?: () => void
  onCancelBuild?: () => void
  onDevelopmentAction?: () => void
  runtimeDevelopment?: RuntimeDevelopmentSnapshot
  serveOverride?: RuntimeServeOverride
  onServeOverrideChange?: (next: RuntimeServeOverride | null) => void
}

export function ProjectHomeRuntimeView({ controller }: { controller: ProjectHomeRuntimeController }) {
  const { t } = useI18n()
  const { project, definition, runtime } = controller
  const notInitialized = controller.status === 'not_initialized'
  const status = runtime?.status ?? 'stopped'
  const staticMode = runtime?.mode ? runtime.mode === 'static' : definition?.mode === 'static'
  const buildStatus = runtime?.buildStatus ?? (staticMode ? status : 'idle')
  const displayStatus = staticMode && !['stopped', 'failed', 'path_missing'].includes(status) ? buildStatus : status
  const canStop = staticMode ? displayStatus === 'building' : ['preparing', 'starting', 'running', 'degraded'].includes(status)
  const canRestart = Boolean(definition) && (staticMode ? status === 'stopped' || ['ready', 'stale', 'build_failed'].includes(displayStatus) : ['running', 'degraded', 'failed', 'stopped'].includes(status))
  const isBuilding = staticMode && displayStatus === 'building'
  const hasLastGood = Boolean(runtime?.artifactId && runtime?.previewUrl)
  const developmentStatus = runtimeDevelopmentStatus(t, controller.runtimeDevelopment)
  // Two independent facts (`C-RSM-407`): how the page is served, and what the
  // AI session is doing. The development status must not hide a stopped Runtime.
  const serveStatus = runtimeServeStatus(t, runtime)
  const serveAction = notInitialized
    ? undefined
    : serveStatus.action === 'update' || serveStatus.action === 'retry'
      ? (controller.onBuild ?? controller.onStart)
      : serveStatus.action === 'start' ? controller.onStart : undefined
  const logs = runtime?.logs?.slice(-20) ?? []
  return <section className="project-runtime-page" data-testid="project-runtime-page" aria-labelledby="project-runtime-title">
    <header className="project-runtime-page__header"><div><p className="eyebrow">{t('runtime.projectRuntime')}</p><h2 id="project-runtime-title">{project.name}</h2><p>{controller.runtimeRoot || definition?.rootPath}</p></div><div className="project-runtime-page__actions">{notInitialized ? null : <span data-testid="project-runtime-serve-status" role={serveStatus.alert ? 'alert' : 'status'} aria-busy={serveStatus.busy}>{serveStatus.message}</span>}{serveAction && serveStatus.actionLabel ? <button type="button" className="btn btn-toolbar" data-testid="project-runtime-serve-action" onClick={serveAction}>{serveStatus.actionLabel}</button> : null}{controller.onDevelopmentAction || controller.onCreate ? <span data-testid="project-runtime-status" role={developmentStatus.alert ? 'alert' : 'status'} aria-busy={developmentStatus.busy}>{notInitialized ? t('runtime.notInitialized') : developmentStatus.message}</span> : null}{notInitialized ? (controller.onCreate ? <button type="button" className="btn btn-primary" data-testid="project-runtime-create" onClick={controller.onCreate}>{t('runtime.createWithAgent')}</button> : null) : (controller.onDevelopmentAction ? <button type="button" className="btn btn-primary" data-testid={developmentStatus.action === 'end' ? 'project-runtime-end-development' : 'project-runtime-open-development'} aria-label={developmentStatus.actionLabel} onClick={controller.onDevelopmentAction} disabled={developmentStatus.actionDisabled}>{developmentStatus.actionLabel}</button> : null)}</div></header>
    {controller.misplacedRuntime ? <p className="project-runtime-page__detail" role="alert" data-testid="project-runtime-misplaced">{t('runtime.misplacedRuntime')} {controller.runtimeRoot}</p> : null}
    {!notInitialized && controller.onServeOverrideChange ? <div className="project-runtime-page__actions project-runtime-page__secondary" role="group" aria-label={t('runtime.viewMode')} data-testid="project-runtime-view-mode">
      <span>{t('runtime.viewMode')}</span>
      <button type="button" className="btn btn-toolbar" aria-pressed={controller.serveOverride === 'artifact'} data-testid="project-runtime-view-artifact" onClick={() => controller.onServeOverrideChange?.('artifact')}>{t('runtime.viewModeArtifact')}</button>
      <button type="button" className="btn btn-toolbar" aria-pressed={controller.serveOverride === 'server'} data-testid="project-runtime-view-development" onClick={() => controller.onServeOverrideChange?.('server')}>{t('runtime.viewModeDevelopment')}</button>
      {controller.serveOverride ? <button type="button" className="btn btn-ghost" data-testid="project-runtime-view-auto" onClick={() => controller.onServeOverrideChange?.(null)}>{t('runtime.viewModeAuto')}</button> : null}
    </div> : null}
    {!notInitialized ? <div className="project-runtime-page__actions project-runtime-page__secondary"><button type="button" className="btn btn-toolbar" data-testid="project-runtime-refresh" onClick={controller.onRefresh} disabled={!runtime?.readyUrl && !runtime?.previewUrl}>{t('runtime.refresh')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-logs" onClick={controller.onToggleLogs} aria-expanded={controller.logsOpen}>{t('runtime.logs')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-restart" onClick={controller.onRestart} disabled={!canRestart}>{t('runtime.restart')}</button>{staticMode ? <button type="button" className="btn btn-ghost" data-testid="project-runtime-build" onClick={controller.onBuild ?? controller.onStart} disabled={displayStatus === 'building'}>{hasLastGood ? t('runtime.rebuild') : t('runtime.build')}</button> : null}<button type="button" className="btn btn-ghost" data-testid={isBuilding ? 'project-runtime-cancel-build' : 'project-runtime-stop'} onClick={isBuilding ? (controller.onCancelBuild ?? controller.onStop) : controller.onStop} disabled={!canStop}>{isBuilding ? t('runtime.cancel') : t('runtime.stop')}</button></div> : null}
    {notInitialized ? <div className="project-runtime-page__preview" data-testid="project-runtime-empty"><p>{t('runtime.notInitializedHint')}</p></div> : <ResizableRuntimePreview projectId={project.id}><div className="project-runtime-page__preview"><RuntimePreview host={{ kind: 'project-home', projectId: project.id, mountId: controller.mountId, runtimeDefinitionId: definition?.id ?? '' }} runtime={runtime} active={Boolean(definition && (runtime?.status === 'running' || (staticMode && ['ready', 'stale', 'building', 'build_failed'].includes(displayStatus))))} testId="project-runtime-preview" /></div></ResizableRuntimePreview>}
    {controller.logsOpen ? <details data-testid="project-runtime-log" open><summary>{t('runtime.logs')}</summary><pre>{logs.join('\n') || t('runtime.noLogs')}</pre></details> : null}
  </section>
}
