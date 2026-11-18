import { useEffect, useRef, useState } from 'react'
import type { AgentOSPairingPrompt } from '../project-chat-contract'
import type { WorkspaceProject } from './types'

export function AgentOSPairingDialog({ pairing, projects }: { pairing: AgentOSPairingPrompt | null; projects: WorkspaceProject[] }) {
  const [projectId, setProjectId] = useState(''); const connectRef = useRef<HTMLButtonElement>(null); const dialogRef = useRef<HTMLElement>(null); const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!pairing) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => (connectRef.current?.disabled ? dialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])') : connectRef.current)?.focus())
    return () => { cancelAnimationFrame(frame); requestAnimationFrame(() => returnFocusRef.current?.focus()) }
  }, [pairing?.pairingId])
  useEffect(() => {
    setProjectId((current) => projects.some((project) => project.id === current && !project.pathMissing)
      ? current : projects.find((project) => !project.pathMissing)?.id ?? '')
  }, [pairing?.pairingId, projects])
  if (!pairing) return null
  const available = projects.filter((project) => !project.pathMissing)
  const submit = (action: 'accept' | 'reject') => void window.projectChat?.respondToWebsitePairing(action === 'reject' ? { pairingId: pairing.pairingId, action } : { pairingId: pairing.pairingId, action, projectId })
  return <div className="local-app-dialog-backdrop agentos-pairing-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label="连接网站" className="local-app-dialog agentos-pairing-dialog" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); submit('reject'); return }
    if (event.key !== 'Tab') return
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),[href],input:not([disabled])') ?? [])]
    if (!controls.length) return
    const index = controls.indexOf(document.activeElement as HTMLElement); const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index === controls.length - 1 ? 0 : index + 1)
    event.preventDefault(); controls[next]?.focus()
  }}>
    <h2>连接网站</h2><p><strong>{pairing.displayName}</strong></p><p><code>{pairing.origin}</code></p>
    <p>连接后，该网站可向所选项目提交任务，并接收这些任务的执行状态和结果摘要。它无法查看其他会话、浏览项目文件或获取权限请求详情。</p>
    <label className="agentos-pairing-dialog__project">目标项目<select aria-label="目标项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{available.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {!available.length && <p role="status">暂无可用项目。请先取消，在侧栏添加项目后重新连接。</p>}
    <footer className="local-app-dialog__actions"><button type="button" className="btn btn-ghost" onClick={() => submit('reject')}>取消</button><button className="btn btn-primary" ref={connectRef} type="button" onClick={() => submit('accept')} disabled={!projectId}>连接</button></footer>
  </section></div>
}
