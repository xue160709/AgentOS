import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/i18n'
import type { WebsiteBindingPublic } from '../../project-chat-contract'
import type { WorkspaceProject } from '../types'

export function WebsiteBindingsSettingsPage({ projects }: { projects: WorkspaceProject[] }) {
  const { t, locale } = useI18n()
  const [bindings, setBindings] = useState<WebsiteBindingPublic[]>([])
  const [confirming, setConfirming] = useState<WebsiteBindingPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.projectChat?.listWebsiteBindings()
      if (!result?.ok) throw new Error('unavailable')
      setBindings(result.value.filter((binding) => binding.status === 'active'))
      setError('')
    } catch { setError(t('websiteBindings.loadError')) }
    finally { setLoading(false) }
  }, [t])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { if (confirming && !dialogRef.current?.open) dialogRef.current?.showModal() }, [confirming])

  const openProject = async (projectId: string) => {
    try {
      const result = await window.projectChat?.openProjectWindow(projectId)
      if (!result?.ok) throw new Error('unavailable')
      setError('')
    } catch { setError(t('websiteBindings.openError')) }
  }
  const revoke = async () => {
    if (!confirming || busy) return
    setBusy(true)
    try {
      const result = await window.projectChat?.revokeWebsiteBinding(confirming.bindingId)
      if (!result?.ok) throw new Error('unavailable')
      dialogRef.current?.close()
      setConfirming(null)
      await reload()
    } catch { setError(t('websiteBindings.revokeError')); dialogRef.current?.close(); setConfirming(null) }
    finally { setBusy(false) }
  }
  return <section className="app-main-inner settings-page" aria-label={t('websiteBindings.title')}>
    <header className="settings-page-header">
      <h1 className="app-main-heading">{t('websiteBindings.title')}</h1>
      <p className="settings-lede">{t('websiteBindings.description')}</p>
    </header>
    <div className="settings-stack"><section>
      <h2 className="settings-section-heading">{t('websiteBindings.listTitle')}</h2>
      {error && <p className="website-bindings-error" role="alert">{error} {error === t('websiteBindings.loadError') && <button type="button" className="btn btn-ghost btn-compact" onClick={() => void reload()}>{t('websiteBindings.retry')}</button>}</p>}
      <p className="settings-section-caption" role="status" aria-live="polite">{loading ? t('websiteBindings.loading') : bindings.length ? t('websiteBindings.count', { count: bindings.length }) : error ? '' : t('websiteBindings.empty')}</p>
      {!loading && bindings.length > 0 && <ul className="settings-group website-bindings-list">{bindings.map((binding) => {
        const name = projectNames.get(binding.projectId)
        const date = new Date(binding.createdAt)
        return <li className="website-binding" key={binding.bindingId}>
          <div className="website-binding__details"><div className="website-binding__heading"><strong>{binding.displayName}</strong><span className="website-binding__status">{t('websiteBindings.connected')}</span></div>
            <code>{binding.origin}</code>
            <p>{t('websiteBindings.project', { name: name ?? t('websiteBindings.projectUnavailable') })}</p>
            {Number.isFinite(date.getTime()) && <p>{t('websiteBindings.created', { date: date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US') })}</p>}
          </div>
          <div className="website-binding__actions"><button type="button" className="btn btn-ghost btn-compact" disabled={!name} onClick={() => void openProject(binding.projectId)}>{t('websiteBindings.openProject')}</button>
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => setConfirming(binding)}>{t('websiteBindings.revoke')}</button></div>
        </li>
      })}</ul>}
    </section></div>
    <dialog ref={dialogRef} className="settings-restart-dialog" aria-label={t('websiteBindings.revokeTitle')} onClose={() => setConfirming(null)} onCancel={(event) => { if (busy) event.preventDefault() }}>
      <div className="settings-restart-dialog__panel"><h2 className="settings-restart-dialog__title">{t('websiteBindings.revokeTitle')}</h2>
        <p className="settings-restart-dialog__body">{t('websiteBindings.revokeDescription', { name: confirming?.displayName ?? '' })}</p>
        <div className="settings-restart-dialog__actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => dialogRef.current?.close()}>{t('websiteBindings.cancel')}</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void revoke()}>{t('websiteBindings.confirmRevoke')}</button></div>
      </div>
    </dialog>
  </section>
}
