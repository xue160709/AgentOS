import { useI18n } from '../../i18n/i18n'
import type { RuntimeDefinition, RuntimeSnapshot, WorkspaceProject } from '../types'
import { RuntimePreview } from '../RuntimePreview'
import { ResizableRuntimePreview } from '../ResizableRuntimePreview'
import { runtimeEditStatus } from '../runtime-event-state'
import type { ProjectChatRuntimeEditSnapshot } from '../../project-chat-contract'

export type ProjectHomeRuntimeController = {
  project: WorkspaceProject
  mountId: string
  definition?: RuntimeDefinition
  runtime: RuntimeSnapshot | null
  trustRequired: boolean
  logsOpen: boolean
  onStart: () => void
  onOpenTab: () => void
  onRefresh: () => void
  onToggleLogs: () => void
  onRestart: () => void
  onStop: () => void
  onBuild?: () => void
  onCancelBuild?: () => void
  onDevelopment?: () => void
  runtimeEdit?: ProjectChatRuntimeEditSnapshot
}

export function ProjectHomeRuntimeView({ controller }: { controller: ProjectHomeRuntimeController }) {
  const { t } = useI18n()
  const { project, definition, runtime, trustRequired } = controller
  const status = runtime?.status ?? (trustRequired ? 'stopped' : 'stopped')
  const staticMode = runtime?.mode ? runtime.mode === 'static' : definition?.mode === 'static'
  const buildStatus = runtime?.buildStatus ?? (staticMode ? status : 'idle')
  const displayStatus = staticMode && !['stopped', 'failed', 'path_missing'].includes(status) ? buildStatus : status
  const firstBuild = staticMode && displayStatus === 'building' && !runtime?.artifactId && !runtime?.previewUrl
  const label = t(({
    idle: 'runtime.runtimeStopped', ready: 'runtime.runtimeReady', stale: 'runtime.runtimeStale', build_required: 'runtime.runtimeBuildRequired', building: firstBuild ? 'runtime.runtimeFirstBuilding' : 'runtime.runtimeBuilding', build_failed: 'runtime.runtimeBuildFailed',
    preparing: 'runtime.runtimePreparing', starting: 'runtime.runtimeStarting', running: 'runtime.runtimeRunning', degraded: 'runtime.runtimeDegraded', failed: 'runtime.runtimeFailed', path_missing: 'runtime.runtimePathMissing', stopped: 'runtime.runtimeStopped',
  } as Record<string, string>)[displayStatus] ?? 'runtime.runtimeStopped')
  const canStop = staticMode ? displayStatus === 'building' : ['preparing', 'starting', 'running', 'degraded'].includes(status)
  const canRestart = Boolean(definition) && (staticMode ? status === 'stopped' || ['ready', 'stale', 'build_failed'].includes(displayStatus) : ['running', 'degraded', 'failed', 'stopped'].includes(status))
  const isBuilding = staticMode && displayStatus === 'building'
  const hasLastGood = Boolean(runtime?.artifactId && runtime?.previewUrl)
  const runtimeNeedsRecovery = ['failed', 'build_failed', 'path_missing', 'stopped'].includes(displayStatus)
  const editStatus = runtimeNeedsRecovery ? null : runtimeEditStatus(controller.runtimeEdit)
  const logs = runtime?.logs?.slice(-20) ?? []
  return <section className="project-runtime-page" data-testid="project-runtime-page" aria-labelledby="project-runtime-title">
    <header className="project-runtime-page__header"><div><p className="eyebrow">{t('runtime.projectRuntime')}</p><h2 id="project-runtime-title">{project.name}</h2><p>{definition?.rootPath ?? project.path}</p></div><div className="project-runtime-page__actions"><span data-testid="project-runtime-status" role={editStatus?.alert ? 'alert' : 'status'} aria-busy={editStatus?.busy}>{editStatus?.message ?? (trustRequired ? t('runtime.trustRequired') : label)}</span>{staticMode ? <button type="button" className="btn btn-primary" data-testid="project-runtime-build" onClick={controller.onBuild ?? controller.onStart} disabled={displayStatus === 'building'}>{hasLastGood ? t('runtime.rebuild') : t('runtime.build')}</button> : <button type="button" className="btn btn-primary" data-testid="project-runtime-start" onClick={controller.onStart}>{t('runtime.start')}</button>}<button type="button" className="btn btn-toolbar" data-testid="project-runtime-open-tab" onClick={controller.onOpenTab}>{t('runtime.openTab')}</button></div></header>
    <div className="project-runtime-page__actions project-runtime-page__secondary"><button type="button" className="btn btn-toolbar" data-testid="project-runtime-refresh" onClick={controller.onRefresh} disabled={!runtime?.readyUrl && !runtime?.previewUrl}>{t('runtime.refresh')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-logs" onClick={controller.onToggleLogs} aria-expanded={controller.logsOpen}>{t('runtime.logs')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-restart" onClick={controller.onRestart} disabled={!canRestart}>{t('runtime.restart')}</button>{staticMode ? <button type="button" className="btn btn-ghost" data-testid="project-runtime-development" onClick={controller.onDevelopment} disabled={!controller.onDevelopment}>{t('runtime.developmentMode')}</button> : null}<button type="button" className="btn btn-ghost" data-testid={isBuilding ? 'project-runtime-cancel-build' : 'project-runtime-stop'} onClick={isBuilding ? (controller.onCancelBuild ?? controller.onStop) : controller.onStop} disabled={!canStop}>{isBuilding ? t('runtime.cancel') : t('runtime.stop')}</button></div>
    {runtime?.detail ? <p className="project-runtime-page__detail" role={runtime.status === 'failed' ? 'alert' : 'status'}>{runtime.detail}</p> : null}
    <ResizableRuntimePreview projectId={project.id}><div className="project-runtime-page__preview"><RuntimePreview host={{ kind: 'project-home', projectId: project.id, mountId: controller.mountId, runtimeDefinitionId: definition?.id ?? '' }} runtime={runtime} active={Boolean(definition && (runtime?.status === 'running' || (staticMode && ['ready', 'stale', 'building', 'build_failed'].includes(displayStatus))))} testId="project-runtime-preview" /></div></ResizableRuntimePreview>
    {controller.logsOpen ? <details data-testid="project-runtime-log" open><summary>{t('runtime.logs')}</summary><pre>{logs.join('\n') || t('runtime.noLogs')}</pre></details> : null}
  </section>
}
