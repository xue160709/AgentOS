import { useEffect, useRef, useState } from 'react'
import type { AgentOSPairingPrompt } from '../project-chat-contract'
import type { WorkspaceProject } from './types'

export function AgentOSPairingDialog({ pairing, projects }: { pairing: AgentOSPairingPrompt | null; projects: WorkspaceProject[] }) {
  const [projectId, setProjectId] = useState(''); const connectRef = useRef<HTMLButtonElement>(null); const dialogRef = useRef<HTMLElement>(null); const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!pairing) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectId(projects.find((project) => !project.pathMissing)?.id ?? ''); requestAnimationFrame(() => connectRef.current?.focus())
    return () => { requestAnimationFrame(() => returnFocusRef.current?.focus()) }
  }, [pairing?.pairingId, projects])
  if (!pairing) return null
  const available = projects.filter((project) => !project.pathMissing)
  const submit = (action: 'accept' | 'reject') => void window.projectChat?.respondToWebsitePairing(action === 'reject' ? { pairingId: pairing.pairingId, action } : { pairingId: pairing.pairingId, action, projectId })
  return <div className="agentos-pairing-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label="连接网站" className="agentos-pairing-dialog" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); submit('reject'); return }
    if (event.key !== 'Tab') return
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),[href],input:not([disabled])') ?? [])]
    if (!controls.length) return
    const index = controls.indexOf(document.activeElement as HTMLElement); const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index === controls.length - 1 ? 0 : index + 1)
    event.preventDefault(); controls[next]?.focus()
  }}>
    <h2>连接网站</h2><p><strong>{pairing.displayName}</strong></p><p><code>{pairing.origin}</code></p>
    <p>该网站之后可以直接为项目创建新会话；它不能查看对话、文件、权限请求或最终结果。</p>
    <label>目标项目<select aria-label="目标项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{available.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <div><button ref={connectRef} type="button" onClick={() => submit('accept')} disabled={!projectId}>连接</button><button type="button" onClick={() => submit('reject')}>取消</button></div>
  </section></div>
}
