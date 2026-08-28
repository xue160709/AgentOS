import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/i18n'
import type { LocalAppDefinition } from './types'
import type { LocalAppInspectResult } from '../desktop-types'

export type LocalAppOnboardingDialogProps = {
  inspect: LocalAppInspectResult | null
  existingDefinitions?: LocalAppDefinition[]
  chooserOpen?: boolean
  busy?: boolean
  error?: string
  onCancel: () => void
  onChooseNew?: () => void
  onOpenExisting?: (definition: LocalAppDefinition) => void
  onTrust: (definition: LocalAppDefinition) => void
}

/** 首次接入只展示待提交草稿；Trust 之前不创建 durable Definition/Tab，也不启动脚本。 */
export function LocalAppOnboardingDialog({ inspect, existingDefinitions = [], chooserOpen = false, busy = false, error = '', onCancel, onChooseNew, onOpenExisting, onTrust }: LocalAppOnboardingDialogProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const open = Boolean(inspect || chooserOpen)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const first = dialog?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]),'
          + ' [contenteditable="true"]',
      )
      ;(first ?? dialog)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]),'
          + ' [contenteditable="true"]',
      )]
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel, open])
  if (!inspect && !chooserOpen) return null
  if (!inspect) {
    return (
      <div className="local-app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
        <section ref={dialogRef} className="local-app-dialog" data-testid="local-app-chooser" role="dialog" aria-modal="true" aria-labelledby="local-app-dialog-title" tabIndex={-1}>
          <h2 id="local-app-dialog-title">{t('localApp.dialogOpenTitle')}</h2>
          {error ? <p role="alert" className="local-app-dialog__error">{error}</p> : null}
          <p>{t('localApp.dialogOpenDescription')}</p>
          {existingDefinitions.length > 0 ? <p className="local-app-dialog__section-label">{t('localApp.openExisting')}</p> : null}
          <div className="local-app-existing-list">
            {existingDefinitions.map((definition) => (
              <button key={definition.id} type="button" className="local-app-existing-item" onClick={() => onOpenExisting?.(definition)} disabled={busy}>
                <strong>{definition.name}</strong><span title={definition.rootPath}>{definition.rootPath}</span>
              </button>
            ))}
          </div>
          <footer className="local-app-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('localApp.cancel')}</button>
            <button type="button" className="btn btn-primary" data-testid="local-app-choose-new" onClick={onChooseNew} disabled={busy}>{t('localApp.bindNew')}</button>
          </footer>
        </section>
      </div>
    )
  }
  const canTrust = inspect.ok
  const definition: LocalAppDefinition | null = canTrust
    ? {
        id: '',
        owner: { kind: 'workspace' },
        name: inspect.name,
        rootPath: inspect.rootPath,
        canonicalRoot: inspect.canonicalRoot,
        packageManager: 'npm',
        devCommand: { executable: 'npm', args: ['run', 'dev'] },
        trustStatus: 'trusted',
        autoStart: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    : null
  return (
    <div className="local-app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section ref={dialogRef} className="local-app-dialog" role="dialog" aria-modal="true" aria-labelledby="local-app-dialog-title" tabIndex={-1}>
        <h2 id="local-app-dialog-title">{t('localApp.dialogTitle')}</h2>
        {error ? <p role="alert" className="local-app-dialog__error">{error}</p> : null}
        {canTrust ? (
          <>
            <p>{t('localApp.dialogDescription')}</p>
            <dl className="local-app-dialog__details">
              <div><dt>{t('localApp.directory')}</dt><dd title={inspect.canonicalRoot}>{inspect.canonicalRoot}</dd></div>
              <div><dt>{t('localApp.command')}</dt><dd><code>npm run dev</code></dd></div>
              <div><dt>{t('localApp.recovery')}</dt><dd>{t('localApp.recoveryText')}</dd></div>
            </dl>
          </>
        ) : (
          <p role="alert">{inspect.message || t('localApp.invalid')}</p>
        )}
        <footer className="local-app-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('localApp.cancel')}</button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="local-app-trust-confirm"
            disabled={!definition || busy}
            onClick={() => { if (definition) onTrust(definition) }}
          >
            {busy ? t('localApp.connecting') : t('localApp.trust')}
          </button>
        </footer>
      </section>
    </div>
  )
}
