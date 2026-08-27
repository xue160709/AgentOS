import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProjectChatSnapshot,
  ProjectChatThreadSnapshot,
  ProjectChatTranscriptItem,
  ProjectChatWindowViewState,
} from '../../project-chat-contract'
import type { ChatModelPick } from '../../claude-chat-types'
import type { WorkspaceAgentModeState } from '../useWorkspaceAgentMode'
import type { ThreadRunState, TranscriptItem, WorkspaceProject, WorkspaceThread } from '../types'
import { ProjectChatSnapshotController } from '../workspace-session'
import { ChatPage } from './ChatPage'
import { runtimeEditStatus } from '../runtime-event-state'
import { useI18n } from '../../i18n/i18n'
import { IconInline } from '../../icon-inline'
import './project-chat-window.css'

type WindowPageState =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: ProjectChatSnapshot }
  | { kind: 'removed' }
  | { kind: 'error' }

const EMPTY_VIEW_STATE: Omit<ProjectChatWindowViewState, 'projectId'> = {
  schemaVersion: 1,
  draft: '',
  externalTaskSeenAt: 0,
  updatedAt: 0,
}

const inactiveAgentMode: WorkspaceAgentModeState = {
  enabled: false,
  todoEnabled: false,
  loading: false,
  message: '',
  enableAgentMode: async () => undefined,
  updateAgentModeState: async () => false,
}

/** The window owns only view state; all Chat facts are broker snapshots. */
export function ProjectChatWindowPage({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const [state, setState] = useState<WindowPageState>({ kind: 'loading' })
  const [viewState, setViewState] = useState<ProjectChatWindowViewState>({ ...EMPTY_VIEW_STATE, projectId })
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>()
  const [creatingNewThread, setCreatingNewThread] = useState(false)
  const [newThreadModelPick, setNewThreadModelPick] = useState<ChatModelPick | undefined>()
  const [status, setStatus] = useState('')
  const controllerRef = useRef(new ProjectChatSnapshotController())
  const viewStateRef = useRef(viewState)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const pendingPatchRef = useRef<Partial<Pick<ProjectChatWindowViewState, 'selectedThreadId' | 'draft' | 'externalTaskSeenAt' | 'bounds'>>>({})

  const flushViewState = useCallback(() => {
    const patch = pendingPatchRef.current
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    pendingPatchRef.current = {}
    if (Object.keys(patch).length) void window.projectChat?.saveWindowViewState({ projectId, patch }).catch(() => undefined)
  }, [projectId])

  const queueViewState = useCallback((patch: Partial<Pick<ProjectChatWindowViewState, 'selectedThreadId' | 'draft' | 'externalTaskSeenAt' | 'bounds'>>) => {
    const current = viewStateRef.current
    const changed = Object.entries(patch).some(([key, value]) => current[key as keyof typeof patch] !== value)
    if (!changed) return
    viewStateRef.current = { ...current, ...patch }
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch }
    setViewState(viewStateRef.current)
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(flushViewState, 300)
  }, [flushViewState])

  const refreshSnapshot = useCallback(async () => {
    const result = await window.projectChat?.getSnapshot(projectId)
    if (!result) return setState({ kind: 'error' })
    if (result.ok) {
      controllerRef.current.adopt(result.value)
      setState({ kind: 'ready', snapshot: result.value })
    } else if (result.error.code === 'project-not-found') setState({ kind: 'removed' })
    else setState({ kind: 'error' })
  }, [projectId])

  useEffect(() => {
    controllerRef.current = new ProjectChatSnapshotController()
    const api = window.projectChat
    if (!api) {
      setState({ kind: 'error' })
      return
    }
    let active = true
    const unsubscribe = api.onEvent((event) => {
      if (event.type !== 'snapshot') return
      if (!active || event.projectId !== projectId) return
      const outcome = controllerRef.current.accept(event)
      if (outcome === 'accepted') setState({ kind: 'ready', snapshot: event.snapshot })
      if (outcome === 'gap') void refreshSnapshot()
    })
    void Promise.all([api.getWindowViewState(projectId), api.getSnapshot(projectId)]).then(([saved, snapshot]) => {
      if (!active) return
      if (saved.ok) {
        viewStateRef.current = saved.value
        setViewState(saved.value)
        setSelectedThreadId(saved.value.selectedThreadId)
      }
      if (snapshot.ok) {
        controllerRef.current.adopt(snapshot.value)
        setState({ kind: 'ready', snapshot: snapshot.value })
      } else if (snapshot.error.code === 'project-not-found') setState({ kind: 'removed' })
      else setState({ kind: 'error' })
    }).catch(() => { if (active) setState({ kind: 'error' }) })
    const flush = () => flushViewState()
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
      flushViewState()
    }
  }, [flushViewState, projectId, refreshSnapshot])

  const snapshot = state.kind === 'ready' ? state.snapshot : undefined
  useEffect(() => {
    if (!snapshot) return
    if (creatingNewThread) return
    const selected = snapshot.threads.find((thread) => thread.id === selectedThreadId && !thread.archivedAt)
    if (selected) return
    const nextId = [...snapshot.threads].filter((thread) => !thread.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id
    if (nextId === selectedThreadId) return
    setSelectedThreadId(nextId)
    queueViewState({ selectedThreadId: nextId })
  }, [creatingNewThread, queueViewState, selectedThreadId, snapshot])

  useEffect(() => {
    if (!snapshot) return
    void window.projectChat?.reportPresenceSelection({ projectId, selectedThreadId }).catch(() => undefined)
  }, [projectId, selectedThreadId, snapshot])

  const selectThread = useCallback((threadId: string) => {
    const nextId = threadId || undefined
    setCreatingNewThread(false)
    setNewThreadModelPick(undefined)
    setSelectedThreadId(nextId)
    queueViewState({ selectedThreadId: nextId })
  }, [queueViewState])

  const beginNewThread = useCallback(() => {
    setCreatingNewThread(true)
    setSelectedThreadId(undefined)
    queueViewState({ selectedThreadId: undefined })
  }, [queueViewState])

  const onDraftChange = useCallback((draft: string) => queueViewState({ draft }), [queueViewState])
  const openUnreadExternal = useCallback(() => {
    const latest = snapshot?.latestUnreadExternalThreadId
    if (!latest) return
    const seenAt = Date.now(); selectThread(latest); queueViewState({ externalTaskSeenAt: seenAt })
    void window.projectChat?.markExternalTasksSeen(projectId, seenAt)
  }, [projectId, queueViewState, selectThread, snapshot])
  const projectWindow = useMemo(() => ({ draft: viewState.draft, onDraftChange }), [onDraftChange, viewState.draft])

  if (state.kind === 'loading') return <main className="project-chat-window" aria-label={t('projectChatWindow.aria')}><p>{t('projectChatWindow.loading')}</p></main>
  if (state.kind === 'removed') return <main className="project-chat-window" aria-label={t('projectChatWindow.aria')}><p role="alert">{t('projectChatWindow.removed')}</p></main>
  if (state.kind === 'error' || !snapshot) return <main className="project-chat-window" aria-label={t('projectChatWindow.aria')}><p role="alert">{t('projectChatWindow.unavailable')}</p></main>

  const project = projectFromSnapshot(snapshot)
  const threads = snapshot.threads.map(threadFromSnapshot)
  const activeThread = threads.find((thread) => thread.id === selectedThreadId)
  const isNewThread = creatingNewThread || !activeThread
  const runtimeStatus = runtimeEditStatus(snapshot.runtimeEdit)

  return (
    <main className="project-chat-window project-chat-window--ready" aria-label={t('projectChatWindow.projectAria', { project: project.name })}>
      <header className="project-chat-window__header">
        <div className="project-chat-window__identity">
          <span className="project-chat-window__identity-icon" aria-hidden="true"><IconInline name="message" /></span>
          <span className="project-chat-window__identity-copy">
            <h1 title={project.name}>{project.name}</h1>
            <span>{t('projectChatWindow.chatSuffix')}</span>
          </span>
          {project.pathMissing ? <p role="alert">{t('projectChatWindow.pathMissing')}<button type="button" onClick={() => void window.projectChat?.openProjectPathRecovery(projectId)}>{t('projectChatWindow.recoverPath')}</button></p> : null}
        </div>
        <div className="project-chat-window__actions">
          <label className="project-chat-window__thread-picker">
            <span className="sr-only">{t('projectChatWindow.thread')}</span>
            <IconInline name="message" className="project-chat-window__thread-icon" />
            <select aria-label={t('projectChatWindow.thread')} value={isNewThread ? '' : selectedThreadId ?? ''} onChange={(event) => selectThread(event.target.value)}><option value="" disabled>{threads.length ? t('projectChatWindow.chooseThread') : t('projectChatWindow.noThreads')}</option>{threads.filter((thread) => !thread.archivedAt).map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select>
            <IconInline name="chevron" className="project-chat-window__thread-chevron" />
          </label>
          <span className="project-chat-window__action-divider" aria-hidden="true" />
          <button type="button" className="btn project-chat-window__new-thread" aria-pressed={isNewThread} onClick={beginNewThread}><IconInline name="plus" />{t('projectChatWindow.newThread')}</button>
        </div>
      </header>
      <div className="project-chat-window__notices" aria-live="polite">
        {runtimeStatus ? <p className="project-chat-window__status" role={runtimeStatus.alert ? 'alert' : 'status'} aria-busy={runtimeStatus.busy}>{runtimeStatus.message}</p> : null}
        {snapshot.unreadExternalTaskCount ? <button type="button" className="project-chat-window__unread" aria-label={`新任务，${snapshot.unreadExternalTaskCount} 条`} onClick={openUnreadExternal}>新任务（{snapshot.unreadExternalTaskCount}）</button> : null}
        {status ? <p className="project-chat-window__status" role="status">{status}</p> : null}
      </div>
      <ChatPage
        hidden={false} activeProject={project} activeThread={activeThread} projectChatSnapshot={snapshot} projectChatEnabled agentStatusSnapshot={null}
        threads={threads} projects={[project]} projectOrderIds={[projectId]} threadRunStates={runStatesFromSnapshot(snapshot)} onStatusChange={setStatus}
        onNewThread={() => undefined} onForkThread={() => undefined} onCreateProject={() => undefined} onSelectProject={() => undefined} onSelectThread={selectThread}
        onThreadChatStateChange={() => undefined} onThreadPromptSubmit={() => undefined} onThreadRunStateChange={() => undefined} onThreadCompletionStateChange={() => undefined}
        projectHomeModelPick={isNewThread ? newThreadModelPick : undefined} onProjectHomeModelPickChange={(_projectId, pick) => setNewThreadModelPick(pick)}
        onRefreshAgentStatus={() => undefined} agentMode={inactiveAgentMode} agentModeEnabled={false} todoEnabled={false} agentModeLoading={false}
        agentSettingsOpen={false} agentSettingsPanel="project" onOpenAgentSettings={() => undefined} onAgentSettingsPanelChange={() => undefined} onCloseAgentSettings={() => undefined}
        homeModeResetKey={0} hiddenSkillPaths={[]} onCreateHomePluginCardThread={() => undefined} onEditHomePluginCard={() => undefined} onOpenProjectFile={() => undefined}
        onRunProjectSkill={() => undefined} onStopProjectSkillRun={() => undefined} projectWindow={projectWindow}
      />
    </main>
  )
}

function projectFromSnapshot(snapshot: ProjectChatSnapshot): WorkspaceProject {
  return { id: snapshot.project.id, name: snapshot.project.name, path: '', pathMissing: snapshot.project.pathMissing, createdAt: 0, updatedAt: snapshot.workspaceRevision }
}

function threadFromSnapshot(thread: ProjectChatThreadSnapshot): WorkspaceThread {
  return {
    id: thread.id, projectId: thread.projectId, title: thread.title, purpose: thread.purpose, homePluginSlug: thread.homePluginSlug,
    skillCommand: thread.skillCommand, skillTitle: thread.skillTitle, createdAt: thread.createdAt, updatedAt: thread.updatedAt,
    pinnedAt: thread.pinnedAt, archivedAt: thread.archivedAt, creationSource: { kind: 'user' },
    chatState: { model: thread.chatState.model, modelPick: thread.chatState.modelPick, tasks: thread.chatState.tasks, items: thread.chatState.items.map(transcriptItemFromSnapshot) },
  }
}

function transcriptItemFromSnapshot(item: ProjectChatTranscriptItem): TranscriptItem {
  if (item.type === 'message') return { ...item, attachments: item.attachments?.map((attachment) => ({ ...attachment, path: '' })) }
  if (item.type === 'file_diff') return { ...item, requestId: '', files: item.files.map((file) => ({ ...file, path: file.relativePath })) }
  return item
}

function runStatesFromSnapshot(snapshot: ProjectChatSnapshot): Record<string, ThreadRunState> {
  const states: Record<string, ThreadRunState> = {}
  for (const run of snapshot.runs) {
    if (run.phase === 'succeeded' || run.phase === 'failed' || run.phase === 'cancelled') continue
    states[run.threadId] = { requestId: run.requestId, status: run.phase === 'waiting_permission' ? 'waiting' : run.phase === 'waiting_answer' ? 'asking' : 'running', startedAt: run.startedAt, updatedAt: run.finishedAt ?? run.startedAt }
  }
  return states
}
