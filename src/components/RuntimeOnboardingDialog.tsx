import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import type { RuntimeDefinition } from './types'
import type { RuntimeInspectResult } from '../desktop-api'

export type RuntimeOnboardingDialogProps = {
  inspect: RuntimeInspectResult | null
  existingDefinitions?: RuntimeDefinition[]
  chooserOpen?: boolean
  busy?: boolean
  error?: string
  onCancel: () => void
  onChooseNew?: () => void
  onOpenExisting?: (definition: RuntimeDefinition) => void
  onTrust: (definition: RuntimeDefinition) => void
}

/** Runtime trust is explicit: this dialog only submits a draft after confirmation. */
export function RuntimeOnboardingDialog({ inspect, existingDefinitions = [], chooserOpen = false, busy = false, error = '', onCancel, onChooseNew, onOpenExisting, onTrust }: RuntimeOnboardingDialogProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const [title, setTitle] = useState('')
  const open = Boolean(inspect || chooserOpen)
  useEffect(() => {
    if (inspect?.ok) setTitle(inspect.name.trim().slice(0, 64))
  }, [inspect])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input, button:not([disabled])')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown) }
  }, [onCancel, open])
  if (!inspect && !chooserOpen) return null
  if (!inspect) return <div className="local-app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section ref={dialogRef} className="local-app-dialog" data-testid="runtime-chooser" role="dialog" aria-modal="true" aria-labelledby="runtime-dialog-title">
      <h2 id="runtime-dialog-title">{t('runtime.openExisting')}</h2>
      {error ? <p role="alert" className="local-app-dialog__error">{error}</p> : null}
      <div className="local-app-existing-list">{existingDefinitions.map((definition) => <button key={definition.id} type="button" className="local-app-existing-item" onClick={() => onOpenExisting?.(definition)} disabled={busy}><strong>{definition.name}</strong><span title={definition.rootPath}>{definition.rootPath}</span></button>)}</div>
      <footer className="local-app-dialog__actions"><button type="button" className="btn btn-ghost" onClick={onCancel}>{t('runtime.cancel')}</button><button type="button" className="btn btn-primary" data-testid="runtime-choose-new" onClick={onChooseNew} disabled={busy}>{t('runtime.newTab')}</button></footer>
    </section>
  </div>
  const definition: RuntimeDefinition | null = inspect.ok ? {
    id: '', name: title.trim(), rootPath: inspect.rootPath, canonicalRoot: inspect.canonicalRoot,
    packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] }, trustStatus: 'trusted', autoStart: true,
    createdAt: Date.now(), updatedAt: Date.now(),
  } : null
  return <div className="local-app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section ref={dialogRef} className="local-app-dialog" data-testid="runtime-onboarding" role="dialog" aria-modal="true" aria-labelledby="runtime-dialog-title">
      <h2 id="runtime-dialog-title">{t('runtime.projectRuntime')}</h2>
      {error ? <p role="alert" className="local-app-dialog__error">{error}</p> : null}
      {inspect.ok ? <>
        <label className="local-app-dialog__field"><span>{t('runtime.tabTitle')}</span><input data-testid="runtime-tab-title-input" value={title} maxLength={64} onChange={(event) => setTitle(event.target.value)} /></label>
        <dl className="local-app-dialog__details"><div><dt>{t('runtime.directory')}</dt><dd title={inspect.canonicalRoot}>{inspect.canonicalRoot}</dd></div><div><dt>{t('runtime.command')}</dt><dd><code>npm run dev</code></dd></div></dl>
      </> : <p role="alert">{inspect.message || t('runtime.invalid')}</p>}
      <footer className="local-app-dialog__actions"><button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('runtime.cancel')}</button><button type="button" className="btn btn-primary" data-testid="runtime-trust-confirm" disabled={!definition || !definition.name || busy} onClick={() => { if (definition) onTrust(definition) }}>{busy ? t('runtime.connecting') : t('runtime.trust')}</button></footer>
    </section>
  </div>
}
