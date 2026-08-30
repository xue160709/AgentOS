/**
 * Runtime 开发窗口：窗口外壳 + 与主窗口同一套 Chat。
 * Runtime development window: window chrome wrapped around the shared Chat surface.
 *
 * 页面只持有窗口本地视图状态（选中 Thread、草稿、窗口状态机）；对话事实全部来自 Main
 * broker 快照，消息渲染、Composer、权限弹窗一律复用 `ChatPage`，不再自绘一套。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatModelPick } from '../../claude-chat-types'
import type {
  RuntimeChatSnapshot,
  RuntimeDevelopmentWindowContext,
  RuntimeDevelopmentWindowViewState,
} from '../../runtime-development-contract'
import { useI18n } from '../../i18n/i18n'
import { IconInline } from '../../icon-inline'
import type { WorkspaceAgentModeState } from '../useWorkspaceAgentMode'
import { ChatPage } from './ChatPage'
import {
  createRuntimeChatBridge,
  runtimeChatApi,
  runtimeChatOwner,
  runtimeChatRunStates,
  runtimeChatThreads,
} from './runtime-chat-adapter'
import './chat-window.css'

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; context: RuntimeDevelopmentWindowContext; snapshot: RuntimeChatSnapshot; view: RuntimeDevelopmentWindowViewState }
  | { kind: 'unavailable'; message: string }

/** Runtime 窗口没有工作区 Agent 模式开关，用一个惰性对象满足 Chat 组件契约。 */
const inactiveAgentMode: WorkspaceAgentModeState = {
  enabled: false,
  todoEnabled: false,
  loading: false,
  message: '',
  enableAgentMode: async () => undefined,
  updateAgentModeState: async () => false,
}

/** Runtime window is view-only state plus the shared Main broker contract; it owns no durable transcript model. */
export function RuntimeDevelopmentWindowPage() {
  const { t } = useI18n()
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>()
  const [creatingNewThread, setCreatingNewThread] = useState(false)
  const [newThreadModelPick, setNewThreadModelPick] = useState<ChatModelPick | undefined>()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const saveTimer = useRef<number | undefined>(undefined)
  const stateRef = useRef<PageState>(state)
  const selectedThreadIdRef = useRef<string | undefined>(selectedThreadId)
  const draftRef = useRef(draft)
  const refreshCountRef = useRef(0)
  const viewHydratedRef = useRef(false)
  stateRef.current = state
  selectedThreadIdRef.current = selectedThreadId
  draftRef.current = draft

  const chatBridge = useMemo(() => createRuntimeChatBridge(), [])

  const saveView = useCallback((patch: { selectedThreadId?: string; draft?: string }) => {
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined
      void runtimeChatApi()?.saveWindowViewState({ patch }).catch(() => undefined)
    }, 200)
  }, [])

  const refresh = useCallback(async () => {
    const api = runtimeChatApi()
    if (!api) return setState({ kind: 'unavailable', message: t('runtimeDevelopmentWindow.unavailable') })
    const [contextResult, snapshotResult, viewResult] = await Promise.all([api.getWindowContext(), api.getSnapshot(), api.getWindowViewState()])
    if (!contextResult.ok || !snapshotResult.ok || !viewResult.ok) return setState({ kind: 'unavailable', message: unavailableMessage(t, contextResult, snapshotResult) })
    if (contextResult.value.runtimeScopeId !== snapshotResult.value.runtimeScopeId || viewResult.value.runtimeScopeId !== snapshotResult.value.runtimeScopeId) return setState({ kind: 'unavailable', message: t('runtimeDevelopmentWindow.expired') })
    setState({ kind: 'ready', context: contextResult.value, snapshot: snapshotResult.value, view: viewResult.value })
    if (!viewHydratedRef.current) {
      viewHydratedRef.current = true
      setSelectedThreadId(viewResult.value.selectedThreadId)
      setDraft(viewResult.value.draft)
    }
    refreshCountRef.current += 1
    if (refreshCountRef.current < 3) window.setTimeout(() => { void refresh() }, 150)
  }, [t])

  useEffect(() => {
    const api = runtimeChatApi()
    if (!api) { setState({ kind: 'unavailable', message: t('runtimeDevelopmentWindow.unavailable') }); return }
    let active = true
    const unsubscribe = api.onEvent((event) => {
      if (!active) return
      const current = stateRef.current
      if (current.kind !== 'ready' || event.runtimeScopeId !== current.context.runtimeScopeId) return
      if (event.type === 'development') {
        if (event.routeGeneration < current.snapshot.routeGeneration || event.developmentGeneration < current.snapshot.developmentGeneration) return
        setState({ ...current, context: { ...current.context, development: event.snapshot } })
        return
      }
      if (event.routeGeneration !== current.context.development?.routeGeneration || event.developmentGeneration !== current.context.development?.developmentGeneration) return
      setState({ ...current, snapshot: event.snapshot })
    })
    void refresh().catch(() => { if (active) setState({ kind: 'unavailable', message: t('runtimeDevelopmentWindow.loadFailed') }) })
    const flush = () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      void api.saveWindowViewState({ patch: { selectedThreadId: selectedThreadIdRef.current, draft: draftRef.current } }).catch(() => undefined)
    }
    window.addEventListener('beforeunload', flush)
    return () => { active = false; unsubscribe(); window.removeEventListener('beforeunload', flush); flush() }
  }, [refresh, t])

  const snapshot = state.kind === 'ready' ? state.snapshot : undefined
  const threads = useMemo(() => (snapshot ? runtimeChatThreads(snapshot) : []), [snapshot])
  const liveThreads = useMemo(() => threads.filter((thread) => !thread.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt), [threads])
  const threadRunStates = useMemo(() => (snapshot ? runtimeChatRunStates(snapshot) : {}), [snapshot])
  useEffect(() => {
    if (!snapshot) return
    const selected = liveThreads.some((thread) => thread.id === selectedThreadId)
    if (selected || liveThreads.length === 0) return
    const next = liveThreads[0].id; setSelectedThreadId(next); saveView({ selectedThreadId: next, draft })
  }, [draft, liveThreads, saveView, selectedThreadId, snapshot])
  useEffect(() => { if (snapshot) void runtimeChatApi()?.reportPresenceSelection({ selectedThreadId }).catch(() => undefined) }, [selectedThreadId, snapshot])

  const onDraftChange = useCallback((next: string) => { setDraft(next); saveView({ selectedThreadId: selectedThreadIdRef.current, draft: next }) }, [saveView])
  const chatWindowDraft = useMemo(() => ({ draft, onDraftChange }), [draft, onDraftChange])
  const selectThread = useCallback((threadId: string) => {
    const next = threadId || undefined
    setCreatingNewThread(false)
    setNewThreadModelPick(undefined)
    setSelectedThreadId(next)
    saveView({ selectedThreadId: next, draft: draftRef.current })
  }, [saveView])
  const beginNewThread = useCallback(() => {
    setCreatingNewThread(true)
    setSelectedThreadId(undefined)
    saveView({ selectedThreadId: undefined, draft: draftRef.current })
  }, [saveView])

  const development = state.kind === 'ready' ? state.context.development : undefined
  const scopeRemoved = state.kind === 'ready' ? !state.context.scopeAvailable || !state.snapshot.scopeAvailable : false
  const pageBusy = Boolean(development && (development.phase === 'opening' || development.phase === 'exit_requested' || development.phase === 'saving' || development.activeRunCount > 0))

  if (state.kind === 'loading') return <main className="chat-window" aria-busy="true"><p role="status">{t('runtimeDevelopmentWindow.loading')}</p></main>
  if (state.kind === 'unavailable') return <main className="chat-window"><p role="alert">{state.message}</p></main>

  const owner = runtimeChatOwner(state.context)
  const activeThread = threads.find((thread) => thread.id === selectedThreadId)
  const isNewThread = creatingNewThread || !activeThread
  const submitBlockedReason = scopeRemoved
    ? t('runtimeDevelopmentWindow.removed')
    : development?.canSubmit ? undefined : t('runtimeDevelopmentWindow.disabledPlaceholder')

  return (
    <main className="chat-window chat-window--ready" aria-label={t('runtimeDevelopmentWindow.aria', { name: state.context.runtimeName })} aria-busy={pageBusy}>
      <header className="chat-window__header">
        <div className="chat-window__identity">
          <span className="chat-window__identity-icon" aria-hidden="true"><IconInline name="message" /></span>
          <span className="chat-window__identity-copy">
            <h1 title={state.context.runtimeName}>{state.context.runtimeName}</h1>
            <span>{state.context.ownerLabel}</span>
          </span>
        </div>
        <div className="chat-window__actions">
          <label className="chat-window__thread-picker">
            <span className="sr-only">{t('runtimeDevelopmentWindow.threadLabel')}</span>
            <IconInline name="message" className="chat-window__thread-icon" />
            <select aria-label={t('runtimeDevelopmentWindow.threadLabel')} value={isNewThread ? '' : selectedThreadId ?? ''} onChange={(event) => selectThread(event.target.value)}>
              <option value="" disabled>{liveThreads.length ? t('runtimeDevelopmentWindow.chooseThread') : t('runtimeDevelopmentWindow.noThreads')}</option>
              {liveThreads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
            </select>
            <IconInline name="chevron" className="chat-window__thread-chevron" />
          </label>
          <span className="chat-window__action-divider" aria-hidden="true" />
          <button type="button" className="btn chat-window__new-thread" aria-pressed={isNewThread} onClick={beginNewThread}><IconInline name="plus" />{t('runtimeDevelopmentWindow.newThread')}</button>
        </div>
      </header>
      <div className="chat-window__notices" aria-live="polite">
        <p className="chat-window__status" role={development?.errorCode || development?.phase === 'needs_attention' || development?.phase === 'preview_update_failed' ? 'alert' : 'status'}>{phaseMessage(t, development, scopeRemoved)}</p>
        {development?.errorCode ? <p className="chat-window__status" role="alert">{runtimeDevelopmentMessage(t, development.errorCode)}</p> : null}
        {status ? <p className="chat-window__status" role="status">{status}</p> : null}
      </div>
      <ChatPage
        hidden={false} activeProject={owner} activeThread={isNewThread ? undefined : activeThread} projectChatSnapshot={state.snapshot} projectChatEnabled
        chatBridge={chatBridge} submitBlockedReason={submitBlockedReason} agentStatusSnapshot={null}
        threads={threads} projects={[owner]} projectOrderIds={[owner.id]} threadRunStates={threadRunStates} onStatusChange={setStatus}
        onNewThread={() => undefined} onForkThread={() => undefined} onCreateProject={() => undefined} onSelectProject={() => undefined} onSelectThread={selectThread}
        onThreadChatStateChange={() => undefined} onThreadPromptSubmit={() => undefined} onThreadRunStateChange={() => undefined} onThreadCompletionStateChange={() => undefined}
        projectHomeModelPick={isNewThread ? newThreadModelPick : undefined} onProjectHomeModelPickChange={(_owner, pick) => setNewThreadModelPick(pick)}
        onRefreshAgentStatus={() => undefined} agentMode={inactiveAgentMode} agentModeEnabled={false} todoEnabled={false} agentModeLoading={false}
        agentSettingsOpen={false} agentSettingsPanel="project" onOpenAgentSettings={() => undefined} onAgentSettingsPanelChange={() => undefined} onCloseAgentSettings={() => undefined}
        homeModeResetKey={0} hiddenSkillPaths={[]} onCreateHomePluginCardThread={() => undefined} onEditHomePluginCard={() => undefined} onOpenProjectFile={() => undefined}
        onRunProjectSkill={() => undefined} onStopProjectSkillRun={() => undefined} projectWindow={chatWindowDraft}
      />
    </main>
  )
}

type Translate = (path: string, params?: Record<string, string | number>) => string

function phaseMessage(t: Translate, development: RuntimeDevelopmentWindowContext['development'], removed: boolean): string {
  if (removed) return t('runtimeDevelopmentWindow.phaseRemoved')
  if (!development) return t('runtimeDevelopmentWindow.phasePreparing')
  if (development.phase === 'live') return t(development.activeRunCount ? 'runtimeDevelopmentWindow.phaseEditing' : 'runtimeDevelopmentWindow.phaseLive')
  if (development.phase === 'saving') return t('runtimeDevelopmentWindow.phaseSaving')
  if (development.phase === 'needs_attention') return t(development.waitingPromptCount ? 'runtimeDevelopmentWindow.phaseConfirmation' : 'runtimeDevelopmentWindow.phaseAttention')
  if (development.phase === 'exit_requested') return t(development.activeRunCount ? 'runtimeDevelopmentWindow.phaseFinishing' : 'runtimeDevelopmentWindow.phaseEnding')
  if (development.phase === 'preview_update_failed') return t('runtimeDevelopmentWindow.phasePreviewFailed')
  return t(development.phase === 'closed' ? 'runtimeDevelopmentWindow.phaseClosed' : 'runtimeDevelopmentWindow.phaseOpening')
}

function unavailableMessage(t: Translate, ...results: Array<{ ok: boolean; error?: { code: string } }>): string {
  const code = results.find((result) => !result.ok)?.error?.code
  if (code === 'sender-not-authorized' || code === 'runtime-scope-stale') return t('runtimeDevelopmentWindow.expired')
  if (code === 'runtime-scope-unavailable') return t('runtimeDevelopmentWindow.removedUnavailable')
  return t('runtimeDevelopmentWindow.loadFailed')
}

function runtimeDevelopmentMessage(t: Translate, code: string): string {
  const keys: Record<string, string> = {
    'runtime-development-conflict': 'runtime.developmentConflict',
    'runtime-development-busy': 'runtime.developmentBusy',
    'runtime-scope-stale': 'runtime.developmentStale',
    'runtime-root-missing': 'runtime.developmentRootMissing',
    'runtime-trust-required': 'runtime.developmentTrustRequired',
    'runtime-live-preview-unavailable': 'runtime.developmentLiveUnavailable',
    'runtime-save-unavailable': 'runtime.developmentSaveUnavailable',
    'runtime-save-timeout': 'runtime.developmentSaveTimeout',
    'runtime-build-failed': 'runtime.developmentPreviewFailed',
  }
  return t(keys[code] ?? 'runtimeDevelopmentWindow.genericError')
}
