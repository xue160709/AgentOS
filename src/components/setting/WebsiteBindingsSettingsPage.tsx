import { useEffect, useMemo, useState } from 'react'
import type { WebsiteBindingPublic } from '../../project-chat-contract'
import type { WorkspaceProject } from '../types'

/** Main only projects public binding metadata here. */
export function WebsiteBindingsSettingsPage({ projects }: { projects: WorkspaceProject[] }) {
  const [bindings, setBindings] = useState<WebsiteBindingPublic[]>([])
  const [confirming, setConfirming] = useState<WebsiteBindingPublic | null>(null)
  const [error, setError] = useState('')
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const reload = () => void window.projectChat?.listWebsiteBindings().then((result) => {
    if (result?.ok) { setBindings(result.value); setError('') }
    else if (result) setError('网站连接暂不可用。')
  }).catch(() => setError('网站连接暂不可用。'))
  useEffect(() => { reload() }, [])
  const revoke = async () => {
    if (!confirming) return
    const result = await window.projectChat?.revokeWebsiteBinding(confirming.bindingId)
    if (!result?.ok) { setError('撤销连接失败，请重试。'); return }
    setConfirming(null); reload()
  }
  return <section className="settings-page" aria-label="网站连接">
    <h1>网站连接</h1>
    <p>网站只能为已连接项目创建新会话，不能读取对话、文件、权限请求或结果。</p>
    {error ? <p role="alert">{error}</p> : null}
    <div role="status" aria-live="polite">{bindings.length ? `共 ${bindings.length} 个网站连接` : '尚无网站连接'}</div>
    <ul>{bindings.map((binding) => <li key={binding.bindingId}>
      <strong>{binding.displayName}</strong> <code>{binding.origin}</code>
      <span> · {projectNames.get(binding.projectId) ?? binding.projectId} · {binding.status === 'active' ? '已连接' : '已撤销'}</span>
      <button type="button" onClick={() => void window.projectChat?.openProjectWindow(binding.projectId)}>聚焦项目</button>
      {binding.status === 'active' ? <button type="button" onClick={() => setConfirming(binding)}>撤销连接</button> : null}
    </li>)}</ul>
    {confirming ? <div role="dialog" aria-modal="true" aria-label="撤销网站连接" onKeyDown={(event) => { if (event.key === 'Escape') setConfirming(null) }}>
      <p>撤销 {confirming.displayName} 的连接？这只会阻止未来任务，不会取消已运行会话。</p>
      <button type="button" onClick={() => void revoke()}>确认撤销</button><button type="button" onClick={() => setConfirming(null)}>取消</button>
    </div> : null}
  </section>
}
