import { useI18n } from '../../i18n/i18n'
import type { RuntimeDefinition, RuntimeSnapshot, WorkspaceProject } from '../types'
import { RuntimePreview } from '../RuntimePreview'

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
}

export function ProjectHomeRuntimeView({ controller }: { controller: ProjectHomeRuntimeController }) {
  const { t } = useI18n()
  const { project, definition, runtime, trustRequired } = controller
  const status = runtime?.status ?? (trustRequired ? 'stopped' : 'stopped')
  const label = t(({ preparing: 'runtime.runtimePreparing', starting: 'runtime.runtimeStarting', running: 'runtime.runtimeRunning', degraded: 'runtime.runtimeDegraded', failed: 'runtime.runtimeFailed', path_missing: 'runtime.runtimePathMissing', stopped: 'runtime.runtimeStopped' })[status])
  const canStop = ['preparing', 'starting', 'running', 'degraded'].includes(status)
  const canRestart = Boolean(definition) && ['running', 'degraded', 'failed', 'stopped'].includes(status)
  const logs = runtime?.logs?.slice(-20) ?? []
  return <section className="project-runtime-page" data-testid="project-runtime-page" aria-labelledby="project-runtime-title">
    <header className="project-runtime-page__header"><div><p className="eyebrow">{t('runtime.projectRuntime')}</p><h2 id="project-runtime-title">{project.name}</h2><p>{definition?.rootPath ?? project.path}</p></div><div className="project-runtime-page__actions"><span data-testid="project-runtime-status" role="status">{trustRequired ? t('runtime.trustRequired') : label}</span><button type="button" className="btn btn-primary" data-testid="project-runtime-start" onClick={controller.onStart}>{trustRequired ? t('runtime.trust') : t('runtime.start')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-open-tab" onClick={controller.onOpenTab}>{t('runtime.openTab')}</button></div></header>
    <div className="project-runtime-page__actions project-runtime-page__secondary"><button type="button" className="btn btn-toolbar" data-testid="project-runtime-refresh" onClick={controller.onRefresh} disabled={!runtime?.readyUrl}>{t('runtime.refresh')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-logs" onClick={controller.onToggleLogs} aria-expanded={controller.logsOpen}>{t('runtime.logs')}</button><button type="button" className="btn btn-toolbar" data-testid="project-runtime-restart" onClick={controller.onRestart} disabled={!canRestart}>{t('runtime.restart')}</button><button type="button" className="btn btn-ghost" data-testid="project-runtime-stop" onClick={controller.onStop} disabled={!canStop}>{t('runtime.stop')}</button></div>
    {runtime?.detail ? <p className="project-runtime-page__detail" role={runtime.status === 'failed' ? 'alert' : 'status'}>{runtime.detail}</p> : null}
    <div className="project-runtime-page__preview"><RuntimePreview host={{ kind: 'project-home', projectId: project.id, mountId: controller.mountId, runtimeDefinitionId: definition?.id ?? '' }} runtime={runtime} active={Boolean(definition && runtime?.status === 'running')} testId="project-runtime-preview" /></div>
    {controller.logsOpen ? <details data-testid="project-runtime-log" open><summary>{t('runtime.logs')}</summary><pre>{logs.join('\n') || t('runtime.noLogs')}</pre></details> : null}
  </section>
}
