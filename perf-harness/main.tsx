/**
 * Render 计数探针：用真实 AppShell 组件树跑一次合成的流式回答。
 *
 * 只桩掉 `window.projectChat`（AppShell 判定 Revision 2+ 的唯一依据）和工作区的
 * localStorage 种子；组件源码零改动，因此同一份探针可以在 git stash 前后各跑一次。
 */
import { createRoot } from 'react-dom/client'
import { AppShell } from '../src/components/AppShell'
import { I18nProvider } from '../src/i18n/i18n'
import '../src/style.css'

const PROJECT_ID = 'project-perf'
const THREAD_ID = 'thread-perf'
const DELTA_COUNT = 40
const now = 1_700_000_000_000

type Any = any

function seedWorkspace() {
  const threads = [1, 2, 3, 4, 5].map((index) => ({
    id: index === 1 ? THREAD_ID : `thread-${index}`,
    projectId: PROJECT_ID,
    title: `会话 ${index}`,
    createdAt: now,
    updatedAt: now + index,
    creationSource: { kind: 'user' },
    chatState: { model: 'Claude Agent', items: [] },
  }))
  const state = {
    workspaceRevision: 1,
    activeProjectId: PROJECT_ID,
    activeThreadId: THREAD_ID,
    projects: [{ id: PROJECT_ID, name: '性能探针项目', path: '/tmp/perf', createdAt: now, updatedAt: now }],
    threads,
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: [PROJECT_ID] },
    runtimeDefinitions: [],
    workspaceTabs: [],
    activeWorkspaceTabId: '',
    projectHomeViewModes: {},
    localAppDefinitions: [],
    localAppTabs: [],
    activeLocalAppTabId: '',
  }
  localStorage.setItem('CodeX-UI-Template-chat-workspace-v1', JSON.stringify(state))
}

let sequence = 0
const listeners = new Set<(event: Any) => void>()

function snapshot(assistantText: string, running: boolean): Any {
  sequence += 1
  const items: Any[] = [
    { type: 'message', id: 'user-1', role: 'user', content: '写一段长文', status: 'done', createdAt: now },
  ]
  if (assistantText) {
    items.push({
      type: 'message',
      id: 'assistant-1',
      role: 'assistant',
      content: assistantText,
      status: running ? 'streaming' : 'done',
      createdAt: now + 1,
    })
  }
  return {
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, name: '性能探针项目', pathMissing: false },
    workspaceRevision: 1 + sequence,
    sequence,
    routeGeneration: 1,
    threads: [1, 2, 3, 4, 5].map((index) => ({
      id: index === 1 ? THREAD_ID : `thread-${index}`,
      projectId: PROJECT_ID,
      title: `会话 ${index}`,
      createdAt: now,
      // Broker 每条 delta 都会推进活动线程的 updatedAt。
      updatedAt: index === 1 ? now + 1000 + sequence : now + index,
      chatState: { model: 'Claude Agent', items: index === 1 ? items : [] },
    })),
    runs: [
      {
        projectId: PROJECT_ID,
        threadId: THREAD_ID,
        requestId: 'request-1',
        phase: running ? 'running' : 'succeeded',
        routeGeneration: 1,
        startedAt: now,
        ...(running ? {} : { finishedAt: now + 5000 }),
      },
    ],
    pendingPrompts: [],
    permissionMode: 'auto',
    unreadExternalTaskCount: 0,
  }
}

function emit(assistantText: string, running: boolean) {
  const value = snapshot(assistantText, running)
  const event = {
    type: 'snapshot',
    projectId: PROJECT_ID,
    sequence: value.sequence,
    routeGeneration: 1,
    workspaceRevision: value.workspaceRevision,
    snapshot: value,
  }
  for (const listener of [...listeners]) listener(event)
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

function installProjectChatStub() {
  const api: Any = new Proxy(
    {
      getSnapshot: () => ok(snapshot('起', true)),
      initializePermissionMode: () => ok('auto'),
      getModelCatalog: () => ok({ providers: [], defaultPick: undefined }),
      getAgentContext: () => ok({ slashCommands: [], mentions: [], knowledge: [] }),
      reportPresenceSelection: () => ok(undefined),
      getThreadStatus: () => ok({ phase: 'idle' }),
      onEvent: (handler: (event: Any) => void) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    },
    {
      get(target, property) {
        if (property in target) return (target as Any)[property]
        return () => ok(undefined)
      },
    },
  )
  ;(window as Any).projectChat = api
}

/**
 * 让出一个宏任务。刻意不用 rAF / setTimeout：面板隐藏时前者不触发、后者被节流，
 * 而 MessageChannel 与 React 调度器同源，不受可见性影响。
 */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
}

const frame = async () => {
  await tick()
  await tick()
  await tick()
}
const settle = async (frames = 12) => {
  for (let index = 0; index < frames; index += 1) await frame()
}

;(window as Any).__perfRun = async () => {
  window.__perfEnabled = false
  window.__perfCounts = {}
  // 先把「run 开始」这次状态迁移跑掉：它本来就应该重渲染一次壳层，
  // 留在计数窗口里会掩盖真正要测的 per-delta 成本，也会让重复调用得到不同结果。
  emit('第 0 段增量输出。', true)
  await settle(20)

  // 计数窗口只覆盖流式 delta，不含 run 开始与终止。
  window.__perfEnabled = true
  let text = ''
  for (let index = 0; index < DELTA_COUNT; index += 1) {
    text += `第 ${index + 1} 段增量输出。`
    emit(text, true)
    await frame()
  }
  await settle(6)
  const streaming = { ...window.__perfCounts }

  window.__perfCounts = {}
  emit(text, false)
  await settle(6)
  const terminal = { ...window.__perfCounts }
  window.__perfEnabled = false

  return { deltaCount: DELTA_COUNT, streaming, terminal }
}

seedWorkspace()
installProjectChatStub()
// 不套 StrictMode：dev 下它会把每次 render 计两次，这里要的是可直接读的 render 次数。
createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <AppShell />
  </I18nProvider>,
)
