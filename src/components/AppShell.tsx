/**
 * 应用壳：工作区持久化、侧栏尺寸、聊天路由与设置哈希同步。
 * Root shell owning workspace persistence, sidebar sizing, chat routing, and hash-synced settings.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import {
  createEmptyChatState,
  createId,
  loadChatWorkspaceState,
  persistChatWorkspaceState,
  persistChatWorkspaceStateToLocalStorage,
  createDefaultChatWorkspaceState,
} from '../chat-workspace-persistence'
import { workspaceRevisionOf } from '../workspace-snapshot-resolution'
import {
  SIDEBAR_HIDDEN_SKILLS_STORAGE_KEY,
  SIDEBAR_PROJECT_SKILLS_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_MAX_RATIO,
  VIEW_HEADING_KEYS,
  settingsCategoryFromLocation,
  settingsWorkspaceTitleKey,
  viewFromLocation,
} from './app-shell-constants.ts'
import { CHAT_WORKSPACE_CLEARED_EVENT, CLAUDE_AGENT_SETTINGS_CHANGED_EVENT } from '../app-events'
import { defaultThreadTitleSet, getInitialLocale, translate, useI18n } from '../i18n/i18n'
import { IconInline } from '../icon-inline'
import type { DesktopPreferences, HomePluginRunItem, HomePluginTaskEvent } from '../desktop-types'
import type { RuntimeCreationResult, RuntimeInspectResult, WorkspaceTabResult, RuntimeRelocationResult } from '../desktop-api'
import type { ChatModelPick, ClaudeAgentModelProvider, ClaudeAgentProviderAuthMode, ClaudeAgentSettingsSnapshot, ClaudePermissionMode } from '../claude-chat-types'
import {
  LOCAL_PROVIDER_PRESET_CATALOG,
  localizeProviderPresetName,
  normalizePresetCatalog,
  type ProviderPreset,
} from '../model-provider-presets'
import { providerHasCredential, resolveEffectiveModelPick, sameModelPick, validateModelPick } from '../model-pick'
import { agentCommandChannel, createProjectChatAgentCommandRuntime } from '../agent-command-channel'
import type {
  AppViewId,
  ChatState,
  ChatWorkspaceState,
  CreateWorkspaceThreadOptions,
  TranscriptItem,
  WorkspaceMetadataState,
  ProjectSkillRunRequest,
  ProjectSkillListState,
  SelectedProjectSkill,
  SettingsCategoryId,
  ThreadCompletionState,
  ThreadRunState,
  WorkspaceProject,
  RuntimeSnapshot,
  WorkspaceTab,
  RuntimeDefinition,
  RuntimeEvent,
} from './types'
import { AppShellSidebar } from './AppShellSidebar'
import { AppShellWorkspace } from './AppShellWorkspace'
import { type ChatPageHandle } from './chat/ChatPage'
import { WorkspaceCommandClient, adoptAuthoritativeWorkspace } from './workspace-command-client'
import { ProjectChatThreadIntentClient, isProjectThreadBusy, type ProjectChatReadiness } from './project-chat-thread-intents'
import { configureProjectHomeRuntime, type ProjectHomeRuntimeContext } from './chat/ChatStartView'
import { WorkspaceSession } from './workspace-session'
import { ProjectChatSnapshotController, applyProjectChatSnapshot } from './workspace-session'
import {
  adoptWorkspaceChatStates,
  hydrateWorkspaceChatStates,
  threadChatStore,
} from './chat/thread-chat-state-store'
import { BrokerSnapshotStore } from './chat/broker-snapshot-source'
import type { ProjectChatSnapshot } from '../project-chat-contract'
import { RuntimeOnboardingDialog } from './RuntimeOnboardingDialog'
import { AgentOSPairingDialog } from './AgentOSPairingDialog'
import { RuntimeWorkspace } from './RuntimeWorkspace'
import { RuntimeDetailsDialog } from './RuntimeDetailsDialog'
import { applyRuntimeDevelopmentSnapshot, applyRuntimeEvents, isStaleRuntimeSnapshot, RuntimeEventBatcher } from './runtime-event-state'
import { projectContent } from '../project-content'
import {
  projectRuntimeScopeId,
  workspaceRuntimeScopeId,
  type RuntimeDevelopmentErrorCode,
  type RuntimeDevelopmentSnapshot,
  type RuntimeDevelopmentTarget,
  type RuntimeScopeKind,
} from '../runtime-development-contract'

const INITIAL_PROVIDER_SKIP_VALUE = '__skip'
const INITIAL_PROVIDER_CUSTOM_VALUE = '__custom'

function readLegacyProjectChatPermissionMode(): ClaudePermissionMode | undefined {
  const value = window.localStorage.getItem('codex-ui-template:claude-permission-mode')
  return value === 'plan' || value === 'auto' || value === 'default' || value === 'acceptEdits' || value === 'bypassPermissions'
    ? value
    : undefined
}

function mergeAcceptedRuntime(
  current: Record<string, RuntimeSnapshot>,
  incoming: RuntimeSnapshot,
): Record<string, RuntimeSnapshot> {
  const runtimeDefinitionId = incoming.runtimeDefinitionId
  if (!runtimeDefinitionId) return current
  if (isStaleRuntimeSnapshot(current[runtimeDefinitionId], incoming)) return current
  const neutralSnapshot: RuntimeSnapshot = {
    runtimeDefinitionId,
    runtimeId: incoming.runtimeId,
    generation: incoming.generation,
    status: incoming.status,
    mode: incoming.mode,
    buildStatus: incoming.buildStatus,
    artifactId: incoming.artifactId,
    buildId: incoming.buildId,
    operationId: incoming.operationId,
    stale: incoming.stale,
    lastBuildAt: incoming.lastBuildAt,
    previewUrl: incoming.previewUrl,
    readyUrl: incoming.readyUrl,
    port: incoming.port,
    restartAttempt: incoming.restartAttempt,
    startedAt: incoming.startedAt,
    updatedAt: incoming.updatedAt,
    stopReason: incoming.stopReason,
    phase: incoming.phase,
    errorCode: incoming.errorCode,
    detail: incoming.detail,
    logs: incoming.logs,
    previewStatus: incoming.previewStatus,
  }
  return { ...current, [runtimeDefinitionId]: neutralSnapshot }
}

function WorkspaceSaveErrorNotice({
  error,
  retrying,
  onRetry,
  retryLabel,
}: {
  error: string
  retrying: boolean
  onRetry: () => void
  retryLabel: string
}) {
  if (!error) return null
  return (
    <div className="workspace-save-error" data-testid="workspace-save-error" role="alert">
      <span>{error}</span>
      <button type="button" data-testid="workspace-save-retry" onClick={onRetry} disabled={retrying}>
        {retrying ? '…' : retryLabel}
      </button>
    </div>
  )
}

type RuntimeDevelopmentConflict = {
  token: string
  runtimeName: string
  ownerKind: RuntimeScopeKind
}

/**
 * `T4.7`: Main reports a lost root race as a structured payload inside the IPC
 * error message. Browsing paths must show it instead of silently staying
 * stopped, which is how a same-directory Runtime looked broken before.
 */
function parseRuntimeRootConflict(error: unknown): RuntimeDevelopmentConflict | null {
  const message = error instanceof Error ? error.message : ''
  const start = message.indexOf('{')
  if (start < 0) return null
  try {
    const parsed = JSON.parse(message.slice(start)) as {
      code?: unknown
      conflictToken?: unknown
      conflictingRuntimeName?: unknown
      conflictingOwnerKind?: unknown
    }
    if (parsed.code !== 'runtime-root-conflict' || typeof parsed.conflictToken !== 'string') return null
    return {
      token: parsed.conflictToken,
      runtimeName: typeof parsed.conflictingRuntimeName === 'string' ? parsed.conflictingRuntimeName : '',
      ownerKind: parsed.conflictingOwnerKind === 'project' ? 'project' : 'workspace',
    }
  } catch {
    return null
  }
}

function RuntimeDevelopmentConflictNotice({ conflict, onFocus }: { conflict: RuntimeDevelopmentConflict | null; onFocus: () => void }) {
  const { t } = useI18n()
  if (!conflict) return null
  return <div className="workspace-save-error" data-testid="runtime-development-conflict" role="alert">
    <span>{t('runtime.developmentConflict')} · {conflict.runtimeName} · {t(conflict.ownerKind === 'project' ? 'runtime.runtimeOwnerProject' : 'runtime.runtimeOwnerWorkspace')}</span>
    <button type="button" data-testid="runtime-development-conflict-focus" onClick={onFocus}>{t('runtime.switchToActiveRuntime')}</button>
  </div>
}

function runtimeDevelopmentErrorCopy(t: (path: string) => string, code: RuntimeDevelopmentErrorCode): string {
  const keys: Record<RuntimeDevelopmentErrorCode, string> = {
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
  return t(keys[code])
}

function RuntimeOnlySidebar({
  tabs,
  activeTabId,
  onNew,
  onSelect,
  onClose,
  onRename,
}: {
  tabs: WorkspaceTab[]
  activeTabId: string
  onNew: () => void
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onRename: (tabId: string, title: string) => void | Promise<boolean>
}) {
  const { t } = useI18n()
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const openMenu = (event: ReactMouseEvent<HTMLElement>, tab: WorkspaceTab) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    returnFocusRef.current = event.currentTarget
    setMenu({ tabId: tab.id, x: event.clientX || rect.left, y: event.clientY || rect.bottom })
  }
  useEffect(() => {
    if (!menu) return
    const closeOnOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        requestAnimationFrame(() => returnFocusRef.current?.focus())
      } else if (items.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const index = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', onKeyDown)
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])
  const tab = menu ? tabs.find((item) => item.id === menu.tabId) : undefined
  const submitRename = async () => {
    if (!tab) return
    const title = editingTitle.trim()
    if (title.length < 1 || title.length > 64) return
    if (await onRename(tab.id, title) !== false) setEditingId(null)
  }
  return <aside className="app-sidebar local-app-only-sidebar draggable" aria-label={t('runtime.section')}>
    <div className="app-sidebar-inner">
      <button type="button" className="app-sidebar-new-thread" data-testid="runtime-new-tab" onClick={onNew}><IconInline name="plus" /><span>{t('runtime.newTab')}</span></button>
      <div className="local-app-sidebar-list runtime-tabs-list">
        {tabs.map((item) => <div key={item.id} className={`local-app-sidebar-row runtime-tab-row${item.id === activeTabId ? ' is-active' : ''}`} data-testid="runtime-tab">
          {editingId === item.id ? <input autoFocus data-testid="runtime-tab-title-input" className="runtime-tab-title-input" value={editingTitle} maxLength={64} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitRename() } if (event.key === 'Escape') { event.preventDefault(); setEditingId(null) } }} /> : <button type="button" className="local-app-sidebar-select runtime-tab-select" data-runtime-tab-id={item.id} aria-current={item.id === activeTabId ? 'page' : undefined} onClick={() => onSelect(item.id)} onContextMenu={(event) => openMenu(event, item)} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); returnFocusRef.current = event.currentTarget; setMenu({ tabId: item.id, x: rect.left, y: rect.bottom }) } }}><IconInline name="folder" /><span><strong>{item.title}</strong></span></button>}
        </div>)}
      </div>
    </div>
    {menu && tab ? <div ref={menuRef} className="app-sidebar-context-menu" data-testid="runtime-tab-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" data-testid="runtime-tab-menu-rename" className="app-sidebar-context-menu__item" onClick={() => { setEditingId(tab.id); setEditingTitle(tab.title); setMenu(null) }}>{t('runtime.rename')}</button>
      <button type="button" role="menuitem" data-testid="runtime-tab-menu-close" className="app-sidebar-context-menu__item is-danger" onClick={() => { setMenu(null); onClose(tab.id) }}>{t('runtime.close')}</button>
    </div> : null}
  </aside>
}
const EYE_COMFORT_CLASS = 'is-eye-comfort'

type InitialModelFormState = {
  presetId: string
  name: string
  apiKeyUrl: string
  authMode: ClaudeAgentProviderAuthMode
  apiKey: string
  baseUrl: string
  model: string
  modelSupportsImages: boolean
  haikuModel: string
  haikuSupportsImages: boolean
  sonnetModel: string
  sonnetSupportsImages: boolean
  opusModel: string
  opusSupportsImages: boolean
}

type SkillRunModelPickResolution = {
  modelPick?: ChatModelPick
  consumedProjectDraft: boolean
}

type SkillRunModelPickCandidate = {
  source: 'skill-override' | 'skill-explicit' | 'project-draft' | 'project-default' | 'active-thread'
  pick?: ChatModelPick
}

/** 组合侧栏 + 工作区 + 聊天页顶栏 / Composes sidebar rail, workspace chrome, and chat surfaces */
export function AppShell() {
  // --- Shell state / 壳层状态 ---

  const { t, locale } = useI18n()
  const [activeViewId, setActiveViewId] = useState<AppViewId>(() => viewFromLocation())
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategoryId>(() => settingsCategoryFromLocation())
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [headerStatus, setHeaderStatus] = useState(() => translate(getInitialLocale(), 'shell.headerDefault'))
  const [chatWorkspace, setChatWorkspace] = useState<WorkspaceMetadataState | null>(null)
  const [localAppInspect, setLocalAppInspect] = useState<RuntimeInspectResult | null>(null)
  const [localAppChooserOpen, setLocalAppChooserOpen] = useState(false)
  const [localAppDialogBusy, setLocalAppDialogBusy] = useState(false)
  const [localAppDialogError, setLocalAppDialogError] = useState('')
  const [workspaceSaveError, setWorkspaceSaveError] = useState('')
  const [workspaceSaveRetrying, setWorkspaceSaveRetrying] = useState(false)
  const [runtimeStates, setRuntimeStates] = useState<Record<string, RuntimeSnapshot>>({})
  const [runtimeDevelopmentStates, setRuntimeDevelopmentStates] = useState<Record<string, RuntimeDevelopmentSnapshot>>({})
  const [runtimeDevelopmentConflict, setRuntimeDevelopmentConflict] = useState<RuntimeDevelopmentConflict | null>(null)
  const [runtimeDetailsTabId, setRuntimeDetailsTabId] = useState<string | null>(null)
  const [projectRuntimeState, setProjectRuntimeState] = useState<{ definition?: RuntimeDefinition; runtime: RuntimeSnapshot | null; status: 'not_initialized' | 'trust_required' | 'ready'; runtimeRoot: string; misplacedRuntime?: boolean; trustRequired: boolean; mountId: string; logsOpen: boolean }>({ runtime: null, status: 'not_initialized', runtimeRoot: '', trustRequired: false, mountId: '', logsOpen: false })
  const [projectRuntimeRefreshNonce, setProjectRuntimeRefreshNonce] = useState(0)
  const restoredLocalAppsRef = useRef<Set<string>>(new Set())
  const localAppDialogOpenRef = useRef(false)
  const localAppEntryRef = useRef<HTMLElement | null>(null)
  const localAppFocusTabIdRef = useRef<string | null>(null)
  const localAppVisibilitySeqRef = useRef(0)
  const projectRuntimeRequestRef = useRef(0)
  const [showProjectSkillsInSidebar, setShowProjectSkillsInSidebar] = useState(() =>
    readStoredBoolean(SIDEBAR_PROJECT_SKILLS_STORAGE_KEY, true),
  )
  const [projectSkillStates, setProjectSkillStates] = useState<Record<string, ProjectSkillListState>>({})
  const [projectDefaultModelPick, setProjectDefaultModelPick] = useState<ChatModelPick | undefined>(undefined)
  const [projectHomeDraftModelPicks, setProjectHomeDraftModelPicks] = useState<Record<string, ChatModelPick>>({})
  const [threadRunStates, setThreadRunStates] = useState<Record<string, ThreadRunState>>({})
  const [threadCompletionStates, setThreadCompletionStates] = useState<Record<string, ThreadCompletionState>>({})
  // Broker 快照放在外部 store：每条 delta 都会重发整份快照，但 `runs`/`pendingPrompts`
  // 通常没变，订阅方按片段比较后不会重渲染。
  const projectChatSnapshotStoreRef = useRef(new BrokerSnapshotStore<ProjectChatSnapshot>())
  const projectChatSnapshotStore = projectChatSnapshotStoreRef.current
  // `FIX-CHAT-01`: three states. `probing` must never fall back to the legacy
  // durable writer, so only an explicit `legacy` re-enables Revision 1 paths.
  const [projectChatReadiness, setProjectChatReadiness] = useState<ProjectChatReadiness>('probing')
  const projectChatEnabled = projectChatReadiness !== 'legacy'
  // The Revision 3 entry and Runtime facade share the same Main composition
  // flag. During probing/rollback the new entry stays unreachable.
  const runtimeDevelopmentEnabled = projectChatReadiness === 'enabled'
  const projectChatReadinessRef = useRef<ProjectChatReadiness>('probing')
  projectChatReadinessRef.current = projectChatReadiness
  const [pendingPairing, setPendingPairing] = useState<import('../project-chat-contract').AgentOSPairingPrompt | null>(null)
  const [selectedProjectSkill, setSelectedProjectSkill] = useState<SelectedProjectSkill | null>(null)
  const [hiddenSkillPathsByProject, setHiddenSkillPathsByProject] = useState<Record<string, string[]>>(() =>
    readHiddenSkillPathsMap(),
  )
  const [homeModeResetKey, setHomeModeResetKey] = useState(0)
  const [initialModelForm, setInitialModelForm] = useState<InitialModelFormState>(() => createInitialModelFormState())
  const [initialModelEnabled, setInitialModelEnabled] = useState(false)
  const [initialModelTouched, setInitialModelTouched] = useState(false)
  const [initialModelStatus, setInitialModelStatus] = useState('')
  const [initialModelBusy, setInitialModelBusy] = useState(false)
  const [initialProjectPath, setInitialProjectPath] = useState('')
  const initialModelTouchedRef = useRef(false)

  const chatRef = useRef<ChatPageHandle>(null)
  const projectChatSnapshotControllerRef = useRef(new ProjectChatSnapshotController())
  const projectChatPermissionInitializedRef = useRef(false)
  const workspaceSessionRef = useRef<WorkspaceSession | null>(null)
  const workspaceCommandClientRef = useRef<WorkspaceCommandClient | null>(null)
  const threadIntentClientRef = useRef<ProjectChatThreadIntentClient | null>(null)
  const refreshProjectChatSnapshotRef = useRef<(projectId: string) => Promise<ProjectChatSnapshot | null>>(async () => null)
  if (!workspaceSessionRef.current) {
    workspaceSessionRef.current = new WorkspaceSession({
      load: loadChatWorkspaceState,
      save: persistChatWorkspaceState,
      saveImmediately: persistChatWorkspaceStateToLocalStorage,
      onSaveError: (error) => {
        setWorkspaceSaveError(error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed'))
      },
    })
  }
  const workspaceSession = workspaceSessionRef.current
  const retryWorkspaceSave = useCallback(async () => {
    setWorkspaceSaveRetrying(true)
    try {
      await workspaceSession.flush()
      setWorkspaceSaveError('')
    } catch (error) {
      setWorkspaceSaveError(error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed'))
    } finally {
      setWorkspaceSaveRetrying(false)
    }
  }, [t, workspaceSession])
  const projectSkillStatesRef = useRef(projectSkillStates)
  const shellRef = useRef<HTMLDivElement>(null)
  const appBodyRef = useRef<HTMLDivElement>(null)
  const appSidebarRef = useRef<HTMLElement>(null)
  const sidebarSplitterRef = useRef<HTMLDivElement>(null)
  const sidebarResizeActive = useRef(false)

  // --- Workspace mutation helpers (centralized `setChatWorkspace`) / 工作区变更辅助（统一走 setChatWorkspace）---

  const updateChatWorkspace = useCallback((update: (prev: WorkspaceMetadataState) => WorkspaceMetadataState) => {
    setChatWorkspace((prev) => (prev ? update(prev) : prev))
  }, [])

  /** 主进程权威快照进入壳层的唯一入口：对话内容落进 store，React state 只留元数据。 */
  const adoptAuthoritativeSnapshot = useCallback((workspace: ChatWorkspaceState) => {
    setChatWorkspace(adoptWorkspaceChatStates(workspace))
  }, [])

  useEffect(() => {
    return window.desktop?.onRuntimeDevelopmentEvent?.((event) => {
      if (event.type !== 'snapshot') return
      setRuntimeDevelopmentStates((current) => applyRuntimeDevelopmentSnapshot(current, event.snapshot))
    })
  }, [])

  const runRuntimeDevelopmentAction = useCallback(async (
    target: RuntimeDevelopmentTarget,
    snapshot?: RuntimeDevelopmentSnapshot,
  ) => {
    if (!runtimeDevelopmentEnabled) return
    setRuntimeDevelopmentConflict(null)
    const request = snapshot?.canEnd
      ? window.desktop?.endRuntimeDevelopment?.(target)
      : window.desktop?.openRuntimeDevelopment?.(target)
    if (!request) {
      setWorkspaceSaveError(t('runtime.developmentLiveUnavailable'))
      return
    }
    try {
      const result = await request
      if (result.ok) return
      if (result.error.code === 'runtime-development-conflict' && 'conflictToken' in result.error) {
        setRuntimeDevelopmentConflict({ token: result.error.conflictToken, runtimeName: result.error.conflictingRuntimeName, ownerKind: result.error.conflictingOwnerKind })
        return
      }
      setWorkspaceSaveError(runtimeDevelopmentErrorCopy(t, result.error.code))
    } catch {
      setWorkspaceSaveError(t('runtime.developmentLiveUnavailable'))
    }
  }, [runtimeDevelopmentEnabled, t])

  const focusRuntimeDevelopmentConflict = useCallback(async () => {
    const conflict = runtimeDevelopmentConflict
    if (!conflict) return
    const result = await window.desktop?.focusRuntimeDevelopmentConflict?.(conflict.token)
    if (result?.ok) {
      setRuntimeDevelopmentConflict(null)
      return
    }
    setRuntimeDevelopmentConflict(null)
    setWorkspaceSaveError(result ? runtimeDevelopmentErrorCopy(t, result.error.code) : t('runtime.developmentStale'))
  }, [runtimeDevelopmentConflict, t])

  // --- Main-owned workspace commands (`FIX-WS-01`) / 主进程权威工作区命令 ---

  const tRef = useRef(t)
  tRef.current = t
  const threadRunStatesRef = useRef(threadRunStates)
  threadRunStatesRef.current = threadRunStates
  const chatWorkspaceRef = useRef<WorkspaceMetadataState | null>(null)
  chatWorkspaceRef.current = chatWorkspace
  if (!workspaceCommandClientRef.current) {
    workspaceCommandClientRef.current = new WorkspaceCommandClient({
      invoke: (command, expectedRevision) => {
        const apply = window.desktop?.applyWorkspaceCommand
        if (!apply) return Promise.resolve({ ok: false as const, code: 'workspace-unavailable' as const, message: '桌面接口不可用' })
        return apply(command, expectedRevision)
      },
      refresh: () => Promise.resolve(window.desktop?.getChatWorkspace?.() ?? null).then((state) => state ?? null),
      getWorkspace: () => chatWorkspaceRef.current,
      adopt: (workspace, options) => {
        // store.reset 会唤醒订阅者，必须留在 setState updater 之外（updater 必须是纯函数）。
        const current = chatWorkspaceRef.current
        const next = adoptWorkspaceChatStates(
          current ? adoptAuthoritativeWorkspace(current, workspace, options) : workspace,
        )
        chatWorkspaceRef.current = next
        setChatWorkspace(next)
      },
      onError: (message) => setWorkspaceSaveError(message),
    })
  }
  const workspaceCommandClient = workspaceCommandClientRef.current
  if (!threadIntentClientRef.current) {
    threadIntentClientRef.current = new ProjectChatThreadIntentClient({
      api: () => window.projectChat,
      getSnapshot: (projectId) => projectChatSnapshotControllerRef.current.snapshot(projectId),
      refreshSnapshot: (projectId) => refreshProjectChatSnapshotRef.current(projectId),
      onError: (message) => setHeaderStatus(message),
      onBusy: () => setHeaderStatus(tRef.current('sidebar.archiveBusyThread')),
    })
  }
  const threadIntentClient = threadIntentClientRef.current
  useEffect(() => () => {
    void workspaceCommandClient.flushPreferences()
    workspaceCommandClient.dispose()
  }, [workspaceCommandClient])

  const updateShowProjectSkillsInSidebar = useCallback((enabled: boolean) => {
    setShowProjectSkillsInSidebar(enabled)
    writeStoredBoolean(SIDEBAR_PROJECT_SKILLS_STORAGE_KEY, enabled)
  }, [])

  const updateThreadRunState = useCallback((threadId: string, state: ThreadRunState | null) => {
    // Revision 1：delta 不再推进 `updatedAt`，否则侧栏会按 delta 频率重排。
    // 运行结束是这条线程真正的「最近活动」时刻，在这里补一次即可保持排序语义。
    if (!state && projectChatReadinessRef.current === 'legacy') {
      updateChatWorkspace((prev) => touchWorkspaceThread(prev, threadId, Date.now()))
    }
    setThreadRunStates((prev) => {
      const current = prev[threadId]
      if (!state) {
        if (!current) return prev
        const next = { ...prev }
        delete next[threadId]
        return next
      }
      if (
        current?.requestId === state.requestId &&
        current.status === state.status &&
        current.updatedAt === state.updatedAt
      ) {
        return prev
      }
      return { ...prev, [threadId]: state }
    })
  }, [updateChatWorkspace])

  const updateThreadCompletionState = useCallback((threadId: string, completedAt: number | null) => {
    setThreadCompletionStates((prev) => {
      if (completedAt === null) {
        if (!prev[threadId]) return prev
        const next = { ...prev }
        delete next[threadId]
        return next
      }
      if (prev[threadId]?.completedAt === completedAt) return prev
      return { ...prev, [threadId]: { completedAt } }
    })
  }, [])

  // --- Desktop bridge: mirror `locale` into desktop prefs + tray strings / 桌面桥：将 locale 写入桌面偏好与托盘文案 ---

  useEffect(() => {
    if (!window.desktop?.setDesktopPreferences) return
    void window.desktop.setDesktopPreferences({ locale })
    void window.desktop.syncTrayLocale?.(locale)
  }, [locale])

  useEffect(() => {
    if (!window.desktop?.getDesktopPreferences) return
    let cancelled = false
    void window.desktop.getDesktopPreferences().then((prefs) => {
      if (!cancelled) applyEyeComfortPreference(prefs)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    initialModelTouchedRef.current = initialModelTouched
  }, [initialModelTouched])

  // --- Derived handles: active project/thread powering chat chrome / 派生句柄：驱动聊天框架的当前项目与线程 ---

  const activeWorkspace = chatWorkspace ? workspaceSession.active(chatWorkspace) : {}
  const activeProject = activeWorkspace.project
  const activeThread = activeWorkspace.thread
  const activeWorkspaceTab = activeWorkspace.workspaceTab
  const activeRuntimeDefinition = activeWorkspace.runtimeDefinition
  const activeWorkspaceRuntimeDevelopment = activeRuntimeDefinition
    ? runtimeDevelopmentStates[workspaceRuntimeScopeId(activeRuntimeDefinition.id)]
    : undefined
  const activeProjectRuntimeDevelopment = activeProject
    ? runtimeDevelopmentStates[projectRuntimeScopeId(activeProject.id)]
    : undefined
  const runtimeDetailsTab = chatWorkspace?.workspaceTabs.find((item) => item.id === runtimeDetailsTabId)
  const runtimeDetailsDefinition = runtimeDetailsTab
    ? chatWorkspace?.runtimeDefinitions.find((item) => item.id === runtimeDetailsTab.runtimeDefinitionId)
    : undefined
  const projectHomeModelPick = activeProject
    ? projectHomeDraftModelPicks[activeProject.id] ?? projectDefaultModelPick
    : undefined
  const projectHomeViewMode = activeProject ? chatWorkspace?.projectHomeViewModes[activeProject.id] ?? 'overview' : 'overview'
  const projectRuntimeMountId = useMemo(
    () => activeProject ? createId('project-mount') : '',
    [activeProject?.id, activeProject?.path],
  )

  const acceptProjectChatSnapshot = useCallback((snapshot: ProjectChatSnapshot) => {
    projectChatSnapshotControllerRef.current.adopt(snapshot)
    projectChatSnapshotStore.set(snapshot.projectId, snapshot)
    // 运行中只有时间戳在动，壳层不需要重渲染；终止快照里 run 不再活跃，精确时间戳照常落地。
    const hasActiveRun = snapshot.runs.some(
      (run) => run.phase !== 'succeeded' && run.phase !== 'failed' && run.phase !== 'cancelled',
    )
    // store 写入会唤醒订阅者，必须留在 setState updater 之外。
    const current = chatWorkspaceRef.current
    if (current) {
      const next = applyProjectChatSnapshot(current, snapshot, {
        store: threadChatStore,
        deferTimestampOnlyUpdates: hasActiveRun,
      })
      if (next !== current) {
        chatWorkspaceRef.current = next
        setChatWorkspace(next)
      }
    }
    setThreadRunStates((currentRunStates) => {
      const next: Record<string, ThreadRunState> = { ...currentRunStates }
      for (const thread of snapshot.threads) delete next[thread.id]
      for (const run of snapshot.runs) {
        if (run.phase === 'succeeded' || run.phase === 'failed' || run.phase === 'cancelled') continue
        next[run.threadId] = {
          requestId: run.requestId,
          status: run.phase === 'waiting_answer' ? 'asking' : run.phase === 'waiting_permission' ? 'waiting' : 'running',
          startedAt: run.startedAt,
          updatedAt: run.finishedAt ?? run.startedAt,
        }
      }
      return sameThreadRunStates(currentRunStates, next) ? currentRunStates : next
    })
    for (const run of snapshot.runs) {
      const status = run.phase === 'waiting_permission'
        ? 'waiting'
        : run.phase === 'waiting_answer'
          ? 'asking'
          : run.phase === 'submitting' || run.phase === 'running'
            ? 'running'
            : run.phase
      agentCommandChannel.reportThreadStatus(run.threadId, status, run.error?.code)
    }
  }, [projectChatSnapshotStore])

  const refreshProjectChatSnapshot = useCallback(async (projectId: string): Promise<ProjectChatSnapshot | null> => {
    const api = window.projectChat
    if (!api) {
      setProjectChatReadiness('legacy')
      return null
    }
    try {
      const result = await api.getSnapshot(projectId)
      // A reachable channel proves the production composition is installed,
      // even when this particular project is rejected.
      setProjectChatReadiness('enabled')
      if (!result.ok) return null
      acceptProjectChatSnapshot(result.value)
      if (!projectChatPermissionInitializedRef.current) {
        projectChatPermissionInitializedRef.current = true
        const legacy = readLegacyProjectChatPermissionMode()
        const initialized = await api.initializePermissionMode(legacy)
        if (initialized.ok) window.localStorage.removeItem('codex-ui-template:claude-permission-mode')
      }
      return result.value
    } catch {
      // The channel is not registered: this build really is Revision 1.
      setProjectChatReadiness('legacy')
      return null
    }
  }, [acceptProjectChatSnapshot])

  refreshProjectChatSnapshotRef.current = refreshProjectChatSnapshot

  useEffect(() => {
    if (!window.projectChat) setProjectChatReadiness('legacy')
  }, [])

  useEffect(() => {
    if (!activeProject?.id) return
    void refreshProjectChatSnapshot(activeProject.id)
  }, [activeProject?.id, refreshProjectChatSnapshot])

  useEffect(() => {
    const api = window.projectChat
    if (!api) return
    return api.onEvent((event) => {
      if (event.type === 'agentos-pairing') { setPendingPairing(event.pairing); return }
      if (event.type === 'open-project-preview') {
        applyProjectHomeViewMode(event.projectId, 'runtime')
        selectProject(event.projectId)
        return
      }
      if (event.type === 'open-project-path-recovery') { selectProject(event.projectId); return }
      if (event.type === 'select-thread') return
      const outcome = projectChatSnapshotControllerRef.current.accept(event)
      if (outcome === 'accepted') acceptProjectChatSnapshot(event.snapshot)
      else if (outcome === 'gap') void refreshProjectChatSnapshot(event.projectId)
    })
  }, [acceptProjectChatSnapshot, refreshProjectChatSnapshot])

  useEffect(() => {
    const project = activeProject
    const request = ++projectRuntimeRequestRef.current
    // Runtime inspection can touch the filesystem and workspace store. Only
    // pay that cost when the Runtime tab is actually visible.
    if (!project || activeThread?.id || projectHomeViewMode !== 'runtime' || !projectRuntimeMountId || !window.desktop?.ensureProjectRuntime) {
      setProjectRuntimeState({ runtime: null, status: 'not_initialized', runtimeRoot: project ? `${project.path}/.agentos` : '', trustRequired: false, mountId: projectRuntimeMountId, logsOpen: false })
      return
    }
    let cancelled = false
    void window.desktop.ensureProjectRuntime(project.id, projectRuntimeMountId).then((result) => {
      if (!result.ok) {
        if (!cancelled && request === projectRuntimeRequestRef.current) setWorkspaceSaveError(result.message)
        return
      }
      const stale = cancelled || request !== projectRuntimeRequestRef.current || result.projectId !== project.id || result.mountId !== projectRuntimeMountId
      if (stale) {
        if (result.definition) {
          void window.desktop?.releaseRuntime?.(result.definition.id, `project-home:${result.projectId}:${result.mountId}`)
        }
        return
      }
      setProjectRuntimeState((current) => ({ ...current, definition: result.definition, runtime: result.runtime, status: result.status, runtimeRoot: result.runtimeRoot, misplacedRuntime: result.misplacedRuntime, trustRequired: result.status === 'trust_required', mountId: result.mountId }))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [activeProject?.id, activeThread?.id, projectHomeViewMode, projectRuntimeMountId, projectRuntimeRefreshNonce])

  useEffect(() => {
    const project = activeProject
    if (!project || activeThread?.id || projectHomeViewMode !== 'runtime') return
    return projectContent.subscribe(project.path, (event) => {
      const relativePath = event.relativePath?.replaceAll('\\', '/') ?? ''
      if (!relativePath || relativePath === '.agentos' || relativePath.startsWith('.agentos/')) {
        setProjectRuntimeRefreshNonce((value) => value + 1)
      }
    })
  }, [activeProject?.id, activeProject?.path, activeThread?.id, projectHomeViewMode])

  useEffect(() => {
    const definition = projectRuntimeState.definition
    if (!definition) return
    const runtime = runtimeStates[definition.id]
    if (!runtime || runtime === projectRuntimeState.runtime) return
    setProjectRuntimeState((current) => current.runtime === runtime ? current : { ...current, runtime })
  }, [runtimeStates, projectRuntimeState.definition?.id, projectRuntimeState.runtime])

  const applyProjectHomeViewMode = useCallback((projectId: string, mode: 'overview' | 'runtime') => {
    updateChatWorkspace((prev) => prev.projects.some((project) => project.id === projectId)
      ? { ...prev, projectHomeViewModes: { ...prev.projectHomeViewModes, [projectId]: mode } }
      : prev)
    workspaceCommandClient.queuePreferences({ projectHomeViewModes: { [projectId]: mode } })
  }, [updateChatWorkspace, workspaceCommandClient])

  const setProjectHomeViewMode = useCallback((mode: 'overview' | 'runtime') => {
    if (!activeProject) return
    applyProjectHomeViewMode(activeProject.id, mode)
  }, [activeProject, applyProjectHomeViewMode])

  const ensureTrustedProjectRuntime = useCallback(async (): Promise<RuntimeDefinition | null> => {
    const project = activeProject
    const mountId = projectRuntimeMountId
    if (!project || !mountId || !window.desktop?.trustProjectRuntime) return null
    const request = ++projectRuntimeRequestRef.current
    let result
    try {
      result = await window.desktop.trustProjectRuntime(project.id, mountId)
    } catch (error) {
      setWorkspaceSaveError(error instanceof Error ? error.message : t('runtime.workspaceSaveFailed'))
      return null
    }
    const stale = request !== projectRuntimeRequestRef.current || !result.ok || result.projectId !== project.id || result.mountId !== mountId
    if (!result.ok) {
      if (!stale) setWorkspaceSaveError(result.message)
      return null
    }
    if (stale) {
      if (result.definition) void window.desktop?.releaseRuntime?.(result.definition.id, `project-home:${result.projectId}:${result.mountId}`)
      return null
    }
    if (!result.definition) return null
    try {
      const authoritative = await window.desktop?.getChatWorkspace?.()
      if (request !== projectRuntimeRequestRef.current || !authoritative) {
        void window.desktop?.releaseRuntime?.(result.definition.id, `project-home:${result.projectId}:${result.mountId}`)
        return null
      }
      // Trusting a project Runtime must not move the user: adopt Main's facts
      // but keep the renderer's selection, or the project home would flip to
      // whichever Workspace Tab Main still records as active.
      let adopted = authoritative
      flushSync(() => setChatWorkspace((current) => {
        adopted = current ? adoptAuthoritativeWorkspace(current, authoritative, { preserveSelection: true }) : authoritative
        return adopted
      }))
      persistChatWorkspaceStateToLocalStorage(adopted)
    } catch (error) {
      setWorkspaceSaveError(error instanceof Error ? error.message : t('runtime.workspaceSaveFailed'))
      return null
    }
    setProjectRuntimeState((current) => ({ ...current, definition: result.definition, runtime: result.runtime, status: result.status, runtimeRoot: result.runtimeRoot, misplacedRuntime: result.misplacedRuntime, trustRequired: false, mountId }))
    return result.definition
  }, [activeProject, projectRuntimeMountId, setChatWorkspace, t])

  const startProjectRuntime = useCallback(async () => {
    const project = activeProject
    if (!project) return
    let request = projectRuntimeRequestRef.current
    const mountId = projectRuntimeState.mountId
    if (!mountId || mountId !== projectRuntimeMountId) return
    let definition = projectRuntimeState.definition
    if (projectRuntimeState.trustRequired || !definition) {
      const trustedDefinition = await ensureTrustedProjectRuntime()
      request = projectRuntimeRequestRef.current
      if (!trustedDefinition) return
      definition = trustedDefinition
    }
    const consumerId = `project-home:${project.id}:${mountId}`
    try {
      const runtime = await window.desktop?.startRuntime?.(definition.id, 'user', consumerId)
      const stale = request !== projectRuntimeRequestRef.current || mountId !== projectRuntimeMountId || activeProject?.id !== project.id
      if (stale) {
        await window.desktop?.releaseRuntime?.(definition.id, consumerId)
        return
      }
      if (runtime) setProjectRuntimeState((current) => ({ ...current, definition, runtime, trustRequired: false }))
    } catch (error) {
      if (request !== projectRuntimeRequestRef.current || mountId !== projectRuntimeMountId || activeProject?.id !== project.id) {
        await window.desktop?.releaseRuntime?.(definition.id, consumerId)
        return
      }
      const conflict = parseRuntimeRootConflict(error)
      if (conflict) setRuntimeDevelopmentConflict(conflict)
      else setWorkspaceSaveError(error instanceof Error ? error.message : t('runtime.runtimeFailed'))
    }
  }, [activeProject, ensureTrustedProjectRuntime, projectRuntimeMountId, projectRuntimeState, t])

  useEffect(() => {
    const project = activeProject
    const definition = projectRuntimeState.definition
    const mountId = projectRuntimeState.mountId
    if (!project || activeThread?.id || projectHomeViewMode !== 'runtime' || !definition || projectRuntimeState.trustRequired || !mountId || mountId !== projectRuntimeMountId || !window.desktop?.startRuntime) return
    const request = projectRuntimeRequestRef.current
    let cancelled = false
    const consumerId = `project-home:${project.id}:${mountId}`
    void window.desktop.startRuntime(definition.id, 'restore', consumerId).then((runtime) => {
      const stale = cancelled || request !== projectRuntimeRequestRef.current || mountId !== projectRuntimeMountId || activeProject?.id !== project.id
      if (stale) {
        void window.desktop?.releaseRuntime?.(definition.id, consumerId)
        return
      }
      setProjectRuntimeState((current) => ({ ...current, runtime }))
    }).catch((error: unknown) => {
      if (cancelled || request !== projectRuntimeRequestRef.current || mountId !== projectRuntimeMountId || activeProject?.id !== project.id) {
        void window.desktop?.releaseRuntime?.(definition.id, consumerId)
        return
      }
      const conflict = parseRuntimeRootConflict(error)
      if (conflict) setRuntimeDevelopmentConflict(conflict)
    })
    return () => {
      cancelled = true
      void window.desktop?.releaseRuntime?.(definition.id, consumerId)
    }
  }, [activeProject?.id, activeThread?.id, projectHomeViewMode, projectRuntimeMountId, projectRuntimeState.definition?.id, projectRuntimeState.mountId, projectRuntimeState.trustRequired])

  const projectRuntimePreviewId = projectRuntimeState.runtime ? `preview-project-home:${activeProject?.id ?? ''}:${projectRuntimeState.mountId}-${projectRuntimeState.runtime.generation}` : ''
  const projectRuntimeContext = useMemo<ProjectHomeRuntimeContext | null>(() => {
    if (!activeProject) return null
    return {
      project: activeProject,
      mountId: projectRuntimeState.mountId,
      definition: projectRuntimeState.definition,
      runtime: projectRuntimeState.runtime,
      status: projectRuntimeState.status,
      runtimeRoot: projectRuntimeState.runtimeRoot,
      misplacedRuntime: projectRuntimeState.misplacedRuntime,
      runtimeDevelopment: activeProjectRuntimeDevelopment,
      trustRequired: projectRuntimeState.trustRequired,
      logsOpen: projectRuntimeState.logsOpen,
      viewMode: projectHomeViewMode,
      onViewModeChange: setProjectHomeViewMode,
      onStart: () => { void startProjectRuntime() },
      onCreate: runtimeDevelopmentEnabled ? () => { void runRuntimeDevelopmentAction({ kind: 'project-runtime', projectId: activeProject.id, mountId: projectRuntimeState.mountId }) } : undefined,
      onRefresh: () => { if (projectRuntimePreviewId) void window.desktop?.reloadRuntimePreview?.(projectRuntimePreviewId) },
      onToggleLogs: () => setProjectRuntimeState((current) => ({ ...current, logsOpen: !current.logsOpen })),
      onRestart: () => { if (projectRuntimeState.definition) void window.desktop?.restartRuntime?.(projectRuntimeState.definition.id).then((runtime) => setProjectRuntimeState((current) => ({ ...current, runtime }))) },
      onStop: () => { if (projectRuntimeState.definition) void window.desktop?.stopRuntime?.(projectRuntimeState.definition.id, 'user').then((runtime) => setProjectRuntimeState((current) => ({ ...current, runtime }))) },
      onBuild: () => {
        if (!projectRuntimeState.definition) return
        void window.desktop?.buildRuntime?.(projectRuntimeState.definition.id).then((result) => {
          if (result.ok) { setProjectRuntimeState((current) => ({ ...current, runtime: result.runtime })); return }
          if (result.runtime) setProjectRuntimeState((current) => ({ ...current, runtime: result.runtime! }))
          if (result.conflict) {
            setRuntimeDevelopmentConflict({
              token: result.conflict.conflictToken,
              runtimeName: result.conflict.conflictingRuntimeName,
              ownerKind: result.conflict.conflictingOwnerKind,
            })
          }
        })
      },
      onCancelBuild: () => {
        const definition = projectRuntimeState.definition
        const buildId = projectRuntimeState.runtime?.buildId
        const request = definition ? window.desktop?.cancelRuntimeBuild?.(definition.id, buildId) : undefined
        void request?.then((runtime) => { if (runtime) setProjectRuntimeState((current) => ({ ...current, runtime })) })
      },
      onDevelopmentAction: runtimeDevelopmentEnabled ? () => { void runRuntimeDevelopmentAction({ kind: 'project-runtime', projectId: activeProject.id, mountId: projectRuntimeState.mountId }, activeProjectRuntimeDevelopment) } : undefined,
      serveOverride: projectRuntimeState.definition?.serveOverride,
      onServeOverrideChange: projectRuntimeState.definition && window.desktop?.setRuntimeServeOverride
        ? (next) => {
            const definitionId = projectRuntimeState.definition?.id
            if (!definitionId) return
            void window.desktop?.setRuntimeServeOverride?.(definitionId, next)
              .then((runtime) => {
                setProjectRuntimeState((current) => (runtime ? { ...current, runtime } : current))
                setProjectRuntimeRefreshNonce((value) => value + 1)
              })
              .catch((error: unknown) => {
                const conflict = parseRuntimeRootConflict(error)
                if (conflict) setRuntimeDevelopmentConflict(conflict)
                else setWorkspaceSaveError(error instanceof Error ? error.message : t('runtime.workspaceSaveFailed'))
              })
          }
        : undefined,
    }
  }, [activeProject, activeProjectRuntimeDevelopment, projectHomeViewMode, projectRuntimePreviewId, projectRuntimeState, runRuntimeDevelopmentAction, runtimeDevelopmentEnabled, setProjectHomeViewMode, startProjectRuntime])

  useEffect(() => {
    configureProjectHomeRuntime(projectRuntimeContext)
    return () => configureProjectHomeRuntime(null)
  }, [projectRuntimeContext])

  const setActiveLocalAppPreviewVisible = useCallback(async (visible: boolean) => {
    const request = ++localAppVisibilitySeqRef.current
    const tab = activeWorkspaceTab
    const definition = activeRuntimeDefinition
    const runtime = definition ? runtimeStates[definition.id] : undefined
    if (!tab || !definition || !runtime) return true
    const previewId = `preview-${tab.id}-${runtime.generation}`
    let applied: boolean | undefined
    try {
      applied = await window.desktop?.setRuntimePreviewVisible?.(previewId, visible)
    } catch {
      applied = false
    }
    if (localAppVisibilitySeqRef.current !== request) return false
    if (applied === false && !visible) {
      // A native view may have gone away while a chooser was opening. Close
      // only that Preview session as a fallback; the Runtime consumer remains.
      try { await window.desktop?.closeRuntimePreview?.(previewId) } catch { /* preview already gone */ }
    }
    return applied !== false
  }, [activeRuntimeDefinition, activeWorkspaceTab, runtimeStates])

  useEffect(() => {
    if (activeViewId !== 'home') void setActiveLocalAppPreviewVisible(false)
  }, [activeViewId, setActiveLocalAppPreviewVisible])

  useEffect(() => {
    const open = Boolean(localAppInspect || localAppChooserOpen)
    const wasOpen = localAppDialogOpenRef.current
    localAppDialogOpenRef.current = open
    if (wasOpen && !open) {
      void setActiveLocalAppPreviewVisible(true)
      requestAnimationFrame(() => {
        const focusTabId = localAppFocusTabIdRef.current
        localAppFocusTabIdRef.current = null
        const tab = focusTabId
          ? [...document.querySelectorAll<HTMLElement>('[data-runtime-tab-id]')]
              .find((element) => element.dataset.runtimeTabId === focusTabId)
          : null
        ;(tab ?? (localAppEntryRef.current?.isConnected ? localAppEntryRef.current : null) ?? document.querySelector<HTMLElement>('[data-testid="runtime-new-tab"]'))?.focus()
      })
    }
  }, [localAppChooserOpen, localAppInspect, setActiveLocalAppPreviewVisible])

  const loadProjectDefaultModelPick = useCallback(async (project = activeProject) => {
    if (!project) {
      setProjectDefaultModelPick((prev) => (sameModelPick(prev, undefined) ? prev : undefined))
      return
    }
    try {
      const [settingsSnapshot, agentSettings] = await Promise.all([
        window.claudeChat?.getSettings?.().catch(() => undefined),
        window.desktop?.getAgentModeSettings?.(project.path).catch(() => undefined),
      ])
      const pick = settingsSnapshot && agentSettings?.ok
        ? validateModelPick(settingsSnapshot.settings, agentSettings.settings.projectModelPick)
        : undefined
      if (settingsSnapshot) {
        setProjectHomeDraftModelPicks((prev) => {
          let changed = false
          const next: Record<string, ChatModelPick> = {}
          for (const [projectId, draftPick] of Object.entries(prev)) {
            const valid = validateModelPick(settingsSnapshot.settings, draftPick)
            if (valid) next[projectId] = valid
            if (!valid || !sameModelPick(valid, draftPick)) changed = true
          }
          return changed ? next : prev
        })
      }
      setProjectDefaultModelPick((prev) => (sameModelPick(prev, pick) ? prev : pick))
    } catch {
      setProjectDefaultModelPick((prev) => (sameModelPick(prev, undefined) ? prev : undefined))
    }
  }, [activeProject])

  useEffect(() => {
    void loadProjectDefaultModelPick()
  }, [loadProjectDefaultModelPick])

  useEffect(() => {
    const onSettingsChanged = () => {
      void loadProjectDefaultModelPick()
    }
    const onProjectSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; projectModelPickChanged?: boolean }>).detail
      const projectPath = detail?.projectPath
      if (!projectPath || !activeProject || sameProjectPath(projectPath, activeProject.path)) {
        if (detail?.projectModelPickChanged && activeProject) {
          setProjectHomeDraftModelPicks((prev) => {
            if (!prev[activeProject.id]) return prev
            const next = { ...prev }
            delete next[activeProject.id]
            return next
          })
        }
        void loadProjectDefaultModelPick()
      }
    }
    window.addEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    window.addEventListener('agentos:project-agent-settings-changed', onProjectSettingsChanged)
    return () => {
      window.removeEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
      window.removeEventListener('agentos:project-agent-settings-changed', onProjectSettingsChanged)
    }
  }, [activeProject, loadProjectDefaultModelPick])

  const projectSkillProjectKey = useMemo(
    () => chatWorkspace?.projects.map((project) => `${project.id}:${project.path}`).join('\n') ?? '',
    [chatWorkspace?.projects],
  )

  const setProjectHomeDraftModelPick = useCallback((projectId: string, pick: ChatModelPick | undefined) => {
    setProjectHomeDraftModelPicks((prev) => {
      if (!pick) {
        if (!prev[projectId]) return prev
        const next = { ...prev }
        delete next[projectId]
        return next
      }
      if (sameModelPick(prev[projectId], pick)) return prev
      return { ...prev, [projectId]: pick }
    })
  }, [])

  const projectIdsKey = useMemo(
    () => chatWorkspace?.projects.map((project) => project.id).sort().join('\n') ?? '',
    [chatWorkspace?.projects],
  )

  const threadIdsKey = useMemo(
    () => chatWorkspace?.threads.map((thread) => thread.id).sort().join('\n') ?? '',
    [chatWorkspace?.threads],
  )

  const sidebarCollapsed = chatWorkspace?.sidebarPrefs.collapsed ?? false
  const isWindows = typeof window !== 'undefined' && window.desktop?.platform === 'win32'
  const initialProviderPresets = useMemo(
    () => normalizePresetCatalog(LOCAL_PROVIDER_PRESET_CATALOG, locale).providers,
    [locale],
  )

  // --- Prune stored maps when projects disappear; keep collapsed ids consistent / 项目删除后裁剪存储映射；折叠 id 列表保持一致 ---

  useEffect(() => {
    if (!projectIdsKey) return
    setHiddenSkillPathsByProject((prev) => {
      const allowed = new Set(projectIdsKey.split('\n'))
      let changed = false
      const next: Record<string, string[]> = {}
      for (const [projectId, paths] of Object.entries(prev)) {
        if (!allowed.has(projectId)) {
          changed = true
          continue
        }
        next[projectId] = paths
      }
      if (changed) writeHiddenSkillPathsMap(next)
      return changed ? next : prev
    })
  }, [projectIdsKey])

  useEffect(() => {
    if (!projectIdsKey) return
    updateChatWorkspace((prev) => workspaceSession.pruneCollapsedProjects(prev))
  }, [projectIdsKey, updateChatWorkspace, workspaceSession])

  // --- Hydrate workspace from persistence (Electron file + localStorage merge) / 从持久化恢复工作区（Electron 文件与 localStorage 合并）---

  useEffect(() => {
    let cancelled = false
    void workspaceSession.load().then((state) => {
      if (!cancelled) adoptAuthoritativeSnapshot(state)
    })
    return () => {
      cancelled = true
    }
  }, [adoptAuthoritativeSnapshot, workspaceSession])

  // Runtime event scope is checked by runtimeDefinitionId/runtimeId/generation; old generations are discarded.
  useEffect(() => {
    let mounted = true
    const batcher = new RuntimeEventBatcher({
      commit: (events) => {
        if (!mounted) return
        setRuntimeStates((current) => applyRuntimeEvents(current, events))
      },
    })
    const unsubscribe = window.desktop?.onRuntimeEvent?.((event: RuntimeEvent) => batcher.handle(event))
    return () => {
      mounted = false
      batcher.dispose()
      unsubscribe?.()
    }
  }, [])

  const applyInitialModelSnapshot = useCallback(
    (snapshot: ClaudeAgentSettingsSnapshot) => {
      if (initialModelTouchedRef.current) return
      const provider = selectInitialModelProvider(snapshot)
      const localizedProvider = provider ? localizeProviderPresetName(provider, initialProviderPresets) : undefined
      setInitialModelForm({
        presetId: localizedProvider?.presetId ?? '',
        name: localizedProvider?.name ?? '',
        apiKeyUrl: localizedProvider?.apiKeyUrl ?? '',
        authMode: localizedProvider?.authMode ?? 'apiKey',
        apiKey: localizedProvider?.apiKey ?? '',
        baseUrl: localizedProvider?.baseUrl ?? '',
        model: localizedProvider?.model ?? '',
        modelSupportsImages: localizedProvider?.modelSupportsImages ?? false,
        haikuModel: localizedProvider?.defaultHaikuModel ?? '',
        haikuSupportsImages: localizedProvider?.defaultHaikuSupportsImages ?? false,
        sonnetModel:
          localizedProvider?.defaultSonnetModel ?? localizedProvider?.model ?? '',
        sonnetSupportsImages:
          localizedProvider?.defaultSonnetSupportsImages ?? localizedProvider?.modelSupportsImages ?? false,
        opusModel: localizedProvider?.defaultOpusModel ?? '',
        opusSupportsImages: localizedProvider?.defaultOpusSupportsImages ?? false,
      })
      setInitialModelStatus(t('shell.initModelLoaded'))
    },
    [initialProviderPresets, t],
  )

  useEffect(() => {
    if (!chatWorkspace || chatWorkspace.projects.length > 0) return
    if (!window.claudeChat) {
      setInitialModelStatus(t('shell.initModelBridgeUnavailable'))
      return
    }

    let cancelled = false
    setInitialModelStatus(t('shell.initModelLoading'))
    void window.claudeChat
      .getSettings()
      .then((snapshot) => {
        if (cancelled) return
        applyInitialModelSnapshot(snapshot)
      })
      .catch((error) => {
        if (cancelled) return
        setInitialModelStatus(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [applyInitialModelSnapshot, chatWorkspace, t])

  // --- Watch active project folder on disk (`pathMissing` badge in UI) / 监视当前项目目录是否存在（侧栏 pathMissing 标记）---

  useEffect(() => {
    if (!chatWorkspace || !activeProject) return
    const validate = window.desktop?.validateProjectPaths
    if (!validate) return

    let cancelled = false
    void validate([activeProject.path]).then((results) => {
      if (cancelled) return
      const missing = results[activeProject.path] === false
      if (missing === Boolean(activeProject.pathMissing)) return
      updateChatWorkspace((prev) => ({
        ...prev,
        projects: prev.projects.map((project) =>
          project.id === activeProject.id ? { ...project, pathMissing: missing || undefined } : project,
        ),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [activeProject?.id, activeProject?.path, activeProject?.pathMissing, chatWorkspace, updateChatWorkspace])

  // --- GC: strip orphan skill/run maps after thread & project deletes / 垃圾回收：删除线程/项目后移除孤儿技能与运行态 ---

  useEffect(() => {
    if (!chatWorkspace) return

    setProjectSkillStates((current) => {
      const projectIds = new Set(chatWorkspace.projects.map((project) => project.id))
      let changed = false
      const next: Record<string, ProjectSkillListState> = {}
      for (const [projectId, state] of Object.entries(current)) {
        if (!projectIds.has(projectId)) {
          changed = true
          continue
        }
        next[projectId] = state
      }
      return changed ? next : current
    })

    setThreadRunStates((current) => {
      const threadIds = new Set(chatWorkspace.threads.map((thread) => thread.id))
      let changed = false
      const next: Record<string, ThreadRunState> = {}
      for (const [threadId, state] of Object.entries(current)) {
        if (!threadIds.has(threadId)) {
          changed = true
          continue
        }
        next[threadId] = state
      }
      return changed ? next : current
    })

    setThreadCompletionStates((current) => {
      const threadIds = new Set(chatWorkspace.threads.map((thread) => thread.id))
      let changed = false
      const next: Record<string, ThreadCompletionState> = {}
      for (const [threadId, state] of Object.entries(current)) {
        if (!threadIds.has(threadId)) {
          changed = true
          continue
        }
        next[threadId] = state
      }
      return changed ? next : current
    })
  }, [projectSkillProjectKey, threadIdsKey, chatWorkspace])

  useEffect(() => {
    if (!activeThread?.id) return
    updateThreadCompletionState(activeThread.id, null)
  }, [activeThread?.id, updateThreadCompletionState])

  useEffect(() => {
    projectSkillStatesRef.current = projectSkillStates
  }, [projectSkillStates])

  // --- Sidebar skills rail: debounced `listAgentContext` scan per project / 侧栏技能：按项目惰性扫描 listAgentContext ---

  useEffect(() => {
    if (!showProjectSkillsInSidebar || !chatWorkspace) return

    const listAgentContext = window.desktop?.listAgentContext
    let cancelled = false

    const markUnavailable = (project: WorkspaceProject) => {
      setProjectSkillStates((current) => ({
        ...current,
        [project.id]: {
          path: project.path,
          loading: false,
          loaded: true,
          skills: [],
          message: t('shell.projectSkillUnavailable'),
        },
      }))
    }

    for (const project of chatWorkspace.projects) {
      const existing = projectSkillStatesRef.current[project.id]
      if (existing?.path === project.path && (existing.loading || existing.loaded)) continue

      if (!listAgentContext) {
        markUnavailable(project)
        continue
      }

      setProjectSkillStates((current) => ({
        ...current,
        [project.id]: {
          path: project.path,
          loading: true,
          loaded: false,
          skills: [],
        },
      }))

      listAgentContext(project.path)
        .then((result) => {
          if (cancelled) return
          setProjectSkillStates((current) => ({
            ...current,
            [project.id]: {
              path: project.path,
              loading: false,
              loaded: true,
              skills: result.ok
                ? result.skills.filter((skill) => skill.scope === 'project' && skill.kind === 'skill')
                : [],
              message: result.ok ? undefined : result.message,
            },
          }))
        })
        .catch((error) => {
          if (cancelled) return
          setProjectSkillStates((current) => ({
            ...current,
            [project.id]: {
              path: project.path,
              loading: false,
              loaded: true,
              skills: [],
              message: error instanceof Error ? error.message : t('shell.projectSkillReadError'),
            },
          }))
        })
    }

    return () => {
      cancelled = true
    }
  }, [projectSkillProjectKey, showProjectSkillsInSidebar, t])

  // --- Autosave through Workspace Session / 通过 Workspace Session 自动保存 ---
  useEffect(() => {
    if (!chatWorkspace) return
    // Probing is not legacy: staging here would let a renderer mirror overwrite
    // Main before the seam has answered.
    if (projectChatReadiness !== 'legacy') return
    workspaceSession.stage(hydrateWorkspaceChatStates(chatWorkspace))
    // Revision 1 由渲染进程持有耐久副本，对话内容不再经过壳层 state，
    // 因此改由 store 变化驱动同一次 staging；磁盘格式不变，落盘前装回线程。
    return threadChatStore.subscribe(() => {
      const current = chatWorkspaceRef.current
      if (current) workspaceSession.stage(hydrateWorkspaceChatStates(current))
    })
  }, [chatWorkspace, projectChatReadiness, workspaceSession])

  useEffect(() => {
    return () => {
      // React StrictMode probes mount effects by cleaning them up and then
      // immediately mounting again.  The session is retained in a ref, so a
      // cleanup must flush pending work without permanently disposing its
      // queue; otherwise the next stage() would be silently ignored.
      void workspaceSession.flush().catch(() => undefined)
    }
  }, [workspaceSession])

  // --- Routing helper: strip hash to return to main workspace chrome / 路由辅助：清空 hash 回到主工作区框架 ---

  const goHome = useCallback(() => {
    window.location.hash = ''
  }, [])

  const handleWorkspaceCleared = useCallback(() => {
    workspaceSession.clear()
    adoptAuthoritativeSnapshot(createDefaultChatWorkspaceState())
    setProjectSkillStates({})
    setThreadRunStates({})
    setSelectedProjectSkill(null)
    setHomeModeResetKey((value) => value + 1)
    setHeaderStatus(t('shell.headerDefault'))
    window.location.hash = ''
  }, [adoptAuthoritativeSnapshot, t, workspaceSession])

  // --- Chat/workspace reducers: merge transcript updates and CRUD threads/projects / 归约器：合并聊天内容并增删改线程与项目 ---

  /**
   * 流式写入口。对话内容只进 `ThreadChatStateStore`，不再触发壳层的 `setState`；
   * 线程时间戳交给运行状态变化那一刻统一推进，避免每条 delta 重排侧栏。
   */
  const updateThreadChatState = useCallback(
    (threadId: string, update: ChatState | ((prev: ChatState) => ChatState)) => {
      const projectId = chatWorkspaceRef.current?.threads.find((thread) => thread.id === threadId)?.projectId
      threadChatStore.set(threadId, update, projectId)
    },
    [],
  )

  const selectThread = useCallback(
    (threadId: string) => {
      void setActiveLocalAppPreviewVisible(false)
      setSelectedProjectSkill(null)
      updateThreadCompletionState(threadId, null)
      updateChatWorkspace((prev) => workspaceSession.selectThread(prev, threadId))
      goHome()
    },
    [goHome, setActiveLocalAppPreviewVisible, updateChatWorkspace, updateThreadCompletionState, workspaceSession],
  )

  const createThreadInProject = useCallback(
    (projectId?: string, options: CreateWorkspaceThreadOptions = {}) => {
      const activate = options.activate !== false
      if (projectChatEnabled) {
        const targetProjectId = projectId ?? activeProject?.id
        if (!targetProjectId || !window.projectChat) return undefined
        void window.projectChat.createThread({
          projectId: targetProjectId,
          title: options.title?.trim() || t('thread.newThreadTitle'),
          source: 'user',
        }).then((result) => {
          if (!result.ok) { setHeaderStatus(result.error.message); return }
          if (activate) {
            updateChatWorkspace((state) => workspaceSession.selectThread(state, result.value.threadId))
            goHome()
            requestAnimationFrame(() => void chatRef.current?.focusComposer())
          }
        }).catch(() => setHeaderStatus(t('chat.errorGeneric')))
        return undefined
      }
      if (activate) setSelectedProjectSkill(null)
      const threadId = createId('thread')
      const draftProjectId = projectId ?? activeProject?.id
      const shouldClearHomeDraft = activate && Boolean(draftProjectId && projectHomeDraftModelPicks[draftProjectId])
      const targetProjectId = projectId ?? chatWorkspaceRef.current?.activeProjectId ?? ''
      const defaultModelPick = targetProjectId === activeProject?.id
        ? (activate ? projectHomeDraftModelPicks[targetProjectId] : undefined) ?? projectDefaultModelPick
        : projectHomeDraftModelPicks[targetProjectId]
      threadChatStore.set(threadId, createEmptyChatState(defaultModelPick), targetProjectId)
      updateChatWorkspace((prev) => workspaceSession.addThread(prev, {
        id: threadId,
        projectId: targetProjectId,
        title: options.title?.trim() || t('thread.newThreadTitle'),
        activate,
      }))
      if (shouldClearHomeDraft && draftProjectId) {
        setProjectHomeDraftModelPick(draftProjectId, undefined)
      }
      void window.claudeChat?.newThread(threadId)
      if (activate) {
        goHome()
        requestAnimationFrame(() => void chatRef.current?.focusComposer())
      }
      return threadId
    },
    [activeProject?.id, goHome, projectChatEnabled, projectDefaultModelPick, projectHomeDraftModelPicks, setProjectHomeDraftModelPick, updateChatWorkspace, t, workspaceSession],
  )

  useEffect(() => {
    if (!activeProject?.id) return
    return agentCommandChannel.configure({
      projectId: activeProject.id,
      defaultNavigation: 'stay',
      runtime: projectChatEnabled && window.projectChat
        ? createProjectChatAgentCommandRuntime(window.projectChat, (threadId) => selectThread(threadId))
        : {
        createThread: ({ projectId, threadTitle }) =>
          createThreadInProject(projectId, { activate: false, title: threadTitle }) ?? '',
        submitPrompt: async ({ projectId, threadId, prompt }) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          return Boolean(await chatRef.current?.submitPromptInThread(projectId, threadId, prompt, {
            activate: false,
            preserveComposerDraft: true,
          }))
        },
        openThread: (threadId) => selectThread(threadId),
      },
    })
  }, [activeProject?.id, createThreadInProject, projectChatEnabled, selectThread])

  useEffect(() => {
    const openProjectChatWindow = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: unknown }>).detail?.projectId
      const targetProjectId = typeof projectId === 'string' && projectId.trim() ? projectId.trim() : activeProject?.id
      if (!targetProjectId) return
      void window.projectChat?.openProjectWindow(targetProjectId)
    }
    window.addEventListener('agentos:open-project-chat-window', openProjectChatWindow)
    return () => window.removeEventListener('agentos:open-project-chat-window', openProjectChatWindow)
  }, [activeProject?.id])

  const forkThreadInProject = useCallback(
    (projectId: string, items: TranscriptItem[], title: string, model?: string, modelPick?: ChatModelPick) => {
      setSelectedProjectSkill(null)
      const threadId = createId('thread')
      const project = chatWorkspaceRef.current?.projects.find((item) => item.id === projectId)
      threadChatStore.set(
        threadId,
        { model: model ?? 'Claude Agent', modelPick, cwd: project?.path, items },
        projectId,
      )
      updateChatWorkspace((prev) =>
        workspaceSession.addThread(prev, {
          id: threadId,
          projectId,
          title,
        }),
      )
      void window.claudeChat?.newThread(threadId)
      goHome()
      requestAnimationFrame(() => void chatRef.current?.focusComposer())
    },
    [goHome, updateChatWorkspace, workspaceSession],
  )

  const createHomePluginCardThread = useCallback(
    (projectId: string, initialPrompt: string) => {
      setSelectedProjectSkill(null)
      const threadId = createId('thread')
      threadChatStore.set(threadId, createEmptyChatState(), projectId)
      updateChatWorkspace((prev) =>
        workspaceSession.addThread(prev, {
          id: threadId,
          projectId,
          title: deriveDataCardThreadTitle(initialPrompt, t),
          purpose: 'home-plugin-card-customization',
        }),
      )
      goHome()
      return threadId
    },
    [goHome, t, updateChatWorkspace, workspaceSession],
  )

  const openHomePluginCardThread = useCallback(
    (projectId: string, item: HomePluginRunItem) => {
      setSelectedProjectSkill(null)
      let threadId = ''
      let createdThread = false
      const boundThreadId = item.manifest.threadId?.trim()

      updateChatWorkspace((prev) => {
        if (!prev.projects.some((project) => project.id === projectId)) return prev
        const existing = boundThreadId
          ? prev.threads.find((thread) => thread.id === boundThreadId && thread.projectId === projectId && !thread.archivedAt)
          : undefined
        if (existing) {
          threadId = existing.id
          return {
            ...prev,
            activeProjectId: projectId,
            activeThreadId: existing.id,
          }
        }

        threadId = createId('thread')
        createdThread = true
        return workspaceSession.addThread(prev, {
          id: threadId,
          projectId,
          title: t('thread.homePluginCardEditTitle', { name: item.manifest.name }),
          purpose: 'home-plugin-card-customization',
          homePluginSlug: item.slug,
        })
      })
      goHome()

      void (async () => {
        if (threadId && createdThread) await window.claudeChat?.newThread(threadId)
        requestAnimationFrame(() => {
          if (!threadId || !createdThread) {
            void chatRef.current?.focusComposer()
            return
          }
          const prompt = buildEditHomePluginCardPrompt(item, threadId)
          const submit = chatRef.current?.submitPromptInThread(projectId, threadId, prompt, 'home-plugin-card-customization')
          if (!submit) {
            void chatRef.current?.focusComposer()
            return
          }
          void submit.then((submitted) => {
            if (!submitted) void chatRef.current?.focusComposer()
          })
        })
      })()
    },
    [goHome, t, updateChatWorkspace, workspaceSession],
  )

  const resolveSkillRunModelPick = useCallback(
    async (projectId: string, skill: ProjectSkillRunRequest): Promise<SkillRunModelPickResolution> => {
      const project = chatWorkspace?.projects.find((item) => item.id === projectId)
      const activeThread = chatWorkspace?.threads.find((thread) => thread.id === chatWorkspace.activeThreadId)
      const [snapshot, result] = await Promise.all([
        window.claudeChat?.getSettings?.().catch(() => undefined),
        project ? window.desktop?.getAgentModeSettings?.(project.path).catch(() => undefined) : undefined,
      ])
      const projectModelPick = result?.ok
        ? result.settings.projectModelPick
        : projectId === activeProject?.id
          ? projectDefaultModelPick
          : undefined
      const candidates: SkillRunModelPickCandidate[] = [
        { source: 'skill-override', pick: result?.ok ? result.settings.skillModelOverrides[skill.path] : undefined },
        { source: 'skill-explicit', pick: skill.modelPick },
        { source: 'project-draft', pick: projectHomeDraftModelPicks[projectId] },
        { source: 'project-default', pick: projectModelPick },
        { source: 'active-thread', pick: activeThread?.projectId === projectId ? threadChatStore.read(activeThread.id).modelPick : undefined },
      ]
      if (!snapshot) {
        const selected = firstDefinedModelPickCandidate(candidates)
        return { modelPick: selected?.pick, consumedProjectDraft: selected?.source === 'project-draft' }
      }
      const settings = snapshot.settings
      const selected = firstValidModelPickCandidate(settings, candidates)
      return {
        modelPick: resolveEffectiveModelPick(settings, selected?.pick),
        consumedProjectDraft: selected?.source === 'project-draft',
      }
    },
    [activeProject?.id, chatWorkspace, projectDefaultModelPick, projectHomeDraftModelPicks],
  )

  const runProjectSkill = useCallback(
    (projectId: string, skill: ProjectSkillRunRequest) => {
      void (async () => {
        setSelectedProjectSkill(null)
        const { modelPick, consumedProjectDraft } = await resolveSkillRunModelPick(projectId, skill)
        if (!chatWorkspace?.projects.some((project) => project.id === projectId)) {
          createThreadInProject(projectId)
          return
        }
        const threadId = createId('thread')
        const prompt = skill.title

        updateChatWorkspace((prev) =>
          workspaceSession.addThread(prev, {
            id: threadId,
            projectId,
            title: t('thread.newThreadTitle'),
            purpose: 'skill-run',
            skillPath: skill.path,
            skillCommand: skill.command,
            skillTitle: skill.title,
            chatState: createEmptyChatState(modelPick),
          }),
        )
        if (consumedProjectDraft) {
          setProjectHomeDraftModelPick(projectId, undefined)
        }
        goHome()

        requestAnimationFrame(() => {
          void (async () => {
            await window.claudeChat?.newThread(threadId)
            const submitted = await chatRef.current?.submitPromptInThread(projectId, threadId, prompt, { modelPick })
            if (!submitted) setHeaderStatus(t('shell.headerProcessingThread'))
          })()
        })
      })()
    },
    [chatWorkspace?.projects, createThreadInProject, goHome, resolveSkillRunModelPick, setProjectHomeDraftModelPick, t, updateChatWorkspace, workspaceSession],
  )

  const stopProjectSkillRun = useCallback(
    async (projectId: string, skillPath: string) => {
      const runningThread = chatWorkspace?.threads
        .filter((thread) => thread.projectId === projectId && thread.purpose === 'skill-run' && thread.skillPath === skillPath && !thread.archivedAt)
        .filter((thread) => Boolean(threadRunStates[thread.id]))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const requestId = runningThread ? threadRunStates[runningThread.id]?.requestId : undefined
      if (!requestId || requestId.startsWith('pending-') || !window.claudeChat) return
      await window.claudeChat.cancel(requestId)
    },
    [chatWorkspace?.threads, threadRunStates],
  )

  const selectProject = useCallback(
    (projectId: string) => {
      void setActiveLocalAppPreviewVisible(false)
      setSelectedProjectSkill(null)
      setHomeModeResetKey((value) => value + 1)
      updateChatWorkspace((prev) => workspaceSession.selectProject(prev, projectId))
      goHome()
    },
    [goHome, setActiveLocalAppPreviewVisible, updateChatWorkspace, workspaceSession],
  )

  const createProjectFromExistingPath = useCallback(
    async (projectPath: string) => {
      const value = projectPath.trim()
      if (!value) return
      const scratchDefault = t('project.scratchDefaultName')
      setSelectedProjectSkill(null)
      // Main owns project creation. A renderer-only project is invisible to the
      // broker (`project-not-found` on every submit) and is lost on restart.
      const result = await workspaceCommandClient.submit(
        { type: 'project.create', name: pathBasename(value, scratchDefault), path: value },
        { preserveSelection: false },
      )
      if (!result.ok) return result
      goHome()
      requestAnimationFrame(() => void chatRef.current?.focusComposer())
      return result
    },
    [goHome, t, workspaceCommandClient],
  )

  const createProject = useCallback(
    async (mode: 'scratch' | 'existing') => {
      let value: string | undefined
      if (mode === 'scratch') {
        value = window.prompt(t('project.promptNewName'), t('project.scratchDefaultName'))?.trim()
      } else if (window.desktop?.pickProjectDirectory) {
        value = (await window.desktop.pickProjectDirectory())?.trim()
      } else {
        value = window.prompt(t('project.promptExistingPath'), '')?.trim()
      }
      if (!value) return

      if (mode === 'existing') {
        await createProjectFromExistingPath(value)
        return
      }

      setSelectedProjectSkill(null)
      const result = await workspaceCommandClient.submit(
        { type: 'project.create', name: value, path: `~/Projects/${value}` },
        { preserveSelection: false },
      )
      if (!result.ok) return
      goHome()
      requestAnimationFrame(() => void chatRef.current?.focusComposer())
    },
    [createProjectFromExistingPath, goHome, t, workspaceCommandClient],
  )

  const selectWorkspaceTab = useCallback((tabId: string) => {
    if (activeWorkspaceTab?.id !== tabId) void setActiveLocalAppPreviewVisible(false)
    setSelectedProjectSkill(null)
    // Workspace selection is view state only. Legacy tab.projectId remains
    // readable for rollback, but the Revision 3 entry never follows it.
    updateChatWorkspace((prev) => prev.workspaceTabs.some((tab) => tab.id === tabId)
      ? { ...prev, activeWorkspaceTabId: tabId, activeLocalAppTabId: tabId, activeThreadId: '' }
      : prev)
    goHome()
  }, [activeWorkspaceTab?.id, goHome, setActiveLocalAppPreviewVisible, updateChatWorkspace])

  const inspectLocalApp = useCallback(async () => {
    setLocalAppDialogError('')
    const picked = await window.desktop?.pickProjectDirectory?.()
    if (!picked?.trim()) return
    if (!window.desktop?.inspectRuntimeDirectory) return
    try {
      setLocalAppInspect(await window.desktop.inspectRuntimeDirectory(picked.trim()))
    } catch (error) {
      setLocalAppInspect({ ok: false, rootPath: picked, code: 'invalid-root', message: error instanceof Error ? error.message : '目录检查失败' })
    }
  }, [])

  const openLocalAppEntry = useCallback(async (event?: ReactMouseEvent<HTMLElement>) => {
    localAppEntryRef.current = event?.currentTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setLocalAppDialogError('')
    await setActiveLocalAppPreviewVisible(false)
    setLocalAppChooserOpen(true)
  }, [setActiveLocalAppPreviewVisible])

  const trustAndCreateLocalApp = useCallback(async (draft: RuntimeDefinition) => {
    setLocalAppDialogBusy(true)
    setLocalAppDialogError('')
    try {
      if (!chatWorkspace || !window.desktop?.createWorkspaceTab || !window.desktop?.getChatWorkspace) {
        setLocalAppDialogError('Runtime 服务暂不可用，请重试')
        return
      }
      // Flush renderer-pending chat/project changes before taking the Main
      // revision gate. A rejected flush keeps the dialog open and prevents
      // both create and runtime start.
      try {
        await workspaceSession.flush()
        setWorkspaceSaveError('')
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed')
        setWorkspaceSaveError(message)
        setLocalAppDialogError(message)
        return
      }
      let authoritative: ChatWorkspaceState | null
      try {
        authoritative = await window.desktop.getChatWorkspace()
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed')
        setLocalAppDialogError(message)
        return
      }
      if (!authoritative) {
        setLocalAppDialogError(t('runtime.workspaceSaveFailed'))
        return
      }
      let result: RuntimeCreationResult
      try {
        result = await window.desktop.createWorkspaceTab(draft.rootPath, workspaceRevisionOf(authoritative), draft.name)
      } catch (error) {
        setLocalAppDialogError(error instanceof Error ? error.message : 'Runtime 工作区保存失败，请重试')
        return
      }
      if (!result.ok) {
        setLocalAppDialogError(result.message)
        return
      }
      setWorkspaceSaveError('')
      // Main has verified JSON/SQLite persistence and registered the trusted
      // definition. Publish the tab before asking Main to start its process.
      localAppFocusTabIdRef.current = result.tab.id
      flushSync(() => {
        adoptAuthoritativeSnapshot(result.workspace)
        setLocalAppInspect(null)
        setLocalAppChooserOpen(false)
      })
      persistChatWorkspaceStateToLocalStorage(result.workspace)
      if (window.desktop.startRuntime) {
        try {
          let runtime = await window.desktop.startRuntime(result.definition.id, 'user', `tab:${result.tab.id}`)
          setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
          if (result.definition.mode === 'static' && (runtime.status === 'build_required' || runtime.buildStatus === 'build_required') && window.desktop.buildRuntime) {
            const buildResult = await window.desktop.buildRuntime(result.definition.id)
            if (buildResult.runtime) {
              runtime = buildResult.runtime
              setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
            }
          }
        } catch (error) {
          setRuntimeStates((current) => mergeAcceptedRuntime(current, {
            runtimeDefinitionId: result.definition.id,
            runtimeId: 'none',
            generation: 0,
            status: 'failed',
            restartAttempt: 0,
            updatedAt: Date.now(),
            phase: 'start',
            errorCode: 'start-failed',
            detail: error instanceof Error ? error.message : '运行时启动失败',
            logs: [],
          }))
        }
      }
    } finally {
      setLocalAppDialogBusy(false)
    }
  }, [chatWorkspace, setChatWorkspace, t, workspaceSession])

  const startLocalApp = useCallback(async (localAppId: string, cause: 'user' | 'restore' = 'user', consumerId?: string) => {
    try {
      const consumer = consumerId ?? chatWorkspace?.workspaceTabs.find((tab) => tab.id === chatWorkspace.activeWorkspaceTabId && tab.runtimeDefinitionId === localAppId)?.id
      const normalizedConsumer = consumer ? (consumer.startsWith('tab:') ? consumer : `tab:${consumer}`) : undefined
      const runtime = await window.desktop?.startRuntime?.(localAppId, cause, normalizedConsumer)
      if (runtime) setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
    } catch (error) {
      const conflict = parseRuntimeRootConflict(error)
      if (conflict) {
        setRuntimeDevelopmentConflict(conflict)
        return
      }
      const pathMissing = error instanceof Error && error.message === 'local-app-path-missing'
      setRuntimeStates((current) => mergeAcceptedRuntime(current, {
          runtimeDefinitionId: localAppId,
          runtimeId: 'none', generation: 0, status: pathMissing ? 'path_missing' : 'failed', restartAttempt: 0,
          updatedAt: Date.now(), phase: pathMissing ? 'inspect' : 'start', errorCode: pathMissing ? 'path-missing' : 'start-failed',
          detail: pathMissing ? 'Runtime 目录不存在' : error instanceof Error ? error.message : '运行时启动失败', logs: [],
        }))
    }
  }, [chatWorkspace])

  const openExistingLocalApp = useCallback(async (definition: RuntimeDefinition) => {
    if (!chatWorkspace) return
    const existingWorkbench = chatWorkspace.workspaceTabs.find((item) => item.runtimeDefinitionId === definition.id)
    if (existingWorkbench) {
      localAppFocusTabIdRef.current = existingWorkbench.id
      setLocalAppChooserOpen(false)
      setLocalAppInspect(null)
      selectWorkspaceTab(existingWorkbench.id)
      return
    }
    if (!window.desktop?.openWorkspaceTab || !window.desktop?.getChatWorkspace) {
      setLocalAppDialogError(t('runtime.workspaceSaveFailed'))
      return
    }
    setLocalAppDialogBusy(true)
    setLocalAppDialogError('')
    try {
      try {
        await workspaceSession.flush()
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed')
        setWorkspaceSaveError(message)
        setLocalAppDialogError(message)
        return
      }
      const authoritative = await window.desktop.getChatWorkspace()
      if (!authoritative) {
        setLocalAppDialogError(t('runtime.workspaceSaveFailed'))
        return
      }
      let result: WorkspaceTabResult
      try {
        result = await window.desktop.openWorkspaceTab(definition.id, workspaceRevisionOf(authoritative))
      } catch (error) {
        setLocalAppDialogError(error instanceof Error ? error.message : t('runtime.workspaceSaveFailed'))
        return
      }
      if (!result.ok) {
        setLocalAppDialogError(result.message)
        return
      }
      localAppFocusTabIdRef.current = result.tab.id
      flushSync(() => {
        adoptAuthoritativeSnapshot(result.workspace)
        setLocalAppChooserOpen(false)
        setLocalAppInspect(null)
      })
      persistChatWorkspaceStateToLocalStorage(result.workspace)
      await startLocalApp(result.definition.id, 'user', `tab:${result.tab.id}`)
    } catch (error) {
      setLocalAppDialogError(error instanceof Error ? error.message : t('runtime.workspaceSaveFailed'))
    } finally {
      setLocalAppDialogBusy(false)
    }
  }, [chatWorkspace, selectWorkspaceTab, setChatWorkspace, startLocalApp, t, workspaceSession])

  const stopLocalApp = useCallback((localAppId: string) => {
    const request = window.desktop?.stopRuntime?.(localAppId, 'user')
    void request?.then((runtime) => {
      if (runtime) setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
    })
  }, [])

  const restartLocalApp = useCallback((localAppId: string) => {
    const request = window.desktop?.restartRuntime?.(localAppId)
    void request?.then((runtime) => {
      if (runtime) setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
    }).catch(() => undefined)
  }, [])

  const buildLocalApp = useCallback((localAppId: string) => {
    const request = window.desktop?.buildRuntime?.(localAppId)
    void request?.then((result) => {
      if (result.ok) { setRuntimeStates((current) => mergeAcceptedRuntime(current, result.runtime)); return }
      if (result.runtime) setRuntimeStates((current) => mergeAcceptedRuntime(current, result.runtime!))
      if (result.conflict) {
        setRuntimeDevelopmentConflict({
          token: result.conflict.conflictToken,
          runtimeName: result.conflict.conflictingRuntimeName,
          ownerKind: result.conflict.conflictingOwnerKind,
        })
      }
    }).catch(() => undefined)
  }, [])

  const cancelLocalAppBuild = useCallback((localAppId: string, buildId?: string) => {
    const request = window.desktop?.cancelRuntimeBuild?.(localAppId, buildId)
    void request?.then((runtime) => {
      if (runtime) setRuntimeStates((current) => mergeAcceptedRuntime(current, runtime))
    }).catch(() => undefined)
  }, [])

  const closeLocalAppTab = useCallback(async (tabId: string) => {
    const current = chatWorkspace
    const tab = current?.workspaceTabs.find((item) => item.id === tabId)
    if (!tab || !window.desktop?.closeWorkspaceTab || !window.desktop?.getChatWorkspace) return

    try {
      // Renderer state may include a pending chat/project update.  Flush it
      // first, then ask Main for its authoritative revision so a close cannot
      // overwrite a concurrent durable workspace change.
      await workspaceSession.flush()
      const authoritative = await window.desktop.getChatWorkspace()
      if (!authoritative) throw new Error(t('runtime.workspaceSaveFailed'))
      const result = await window.desktop.closeWorkspaceTab(tabId, workspaceRevisionOf(authoritative))
      if (!result.ok) {
        setWorkspaceSaveError(result.message)
        return
      }

      // Only publish the authoritative post-commit snapshot.  Main closes the
      // Preview and releases the Runtime consumer after this durable commit;
      // there is intentionally no optimistic renderer deletion/release path.
      flushSync(() => adoptAuthoritativeSnapshot(result.workspace))
      persistChatWorkspaceStateToLocalStorage(result.workspace)
      setWorkspaceSaveError(result.warning ?? '')
      setRuntimeStates((current) => {
        if (result.runtime) return mergeAcceptedRuntime(current, result.runtime)
        const next = { ...current }
        delete next[result.runtimeDefinitionId]
        return next
      })
      requestAnimationFrame(() => {
        const activeTabId = result.workspace.activeWorkspaceTabId
        const runtimeTabButtons = [...document.querySelectorAll<HTMLElement>('[data-runtime-tab-id]')]
        const active = runtimeTabButtons.find((element) => element.dataset.runtimeTabId === activeTabId)
        ;(active ?? document.querySelector<HTMLElement>('[data-testid="runtime-new-tab"]'))?.focus()
      })
    } catch (error) {
      setWorkspaceSaveError(error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed'))
    }
  }, [chatWorkspace, setChatWorkspace, t, workspaceSession])

  const renameLocalAppTab = useCallback(async (tabId: string, title: string): Promise<boolean> => {
    if (!window.desktop?.renameWorkspaceTab || !window.desktop.getChatWorkspace) return false
    try {
      const authoritative = await window.desktop.getChatWorkspace()
      if (!authoritative) return false
      const result = await window.desktop.renameWorkspaceTab(tabId, title, workspaceRevisionOf(authoritative))
      if (!result.ok) {
        setWorkspaceSaveError(result.message)
        return false
      }
      flushSync(() => adoptAuthoritativeSnapshot(result.workspace))
      persistChatWorkspaceStateToLocalStorage(result.workspace)
      return true
    } catch (error) {
      setWorkspaceSaveError(error instanceof Error ? error.message : t('runtime.renameFailed'))
      return false
    }
  }, [setChatWorkspace, t])

  const reloadLocalAppPreview = useCallback((tabId: string, localAppId: string) => {
    const runtime = runtimeStates[localAppId]
    if (runtime) void window.desktop?.reloadRuntimePreview?.(`preview-${tabId}-${runtime.generation}`)
  }, [runtimeStates])

  const navigateLocalAppPreview = useCallback((tabId: string, localAppId: string, direction: 'back' | 'forward') => {
    const runtime = runtimeStates[localAppId]
    if (runtime) void window.desktop?.navigateRuntimePreview?.(`preview-${tabId}-${runtime.generation}`, direction)
  }, [runtimeStates])

  const relocateLocalApp = useCallback(async (localAppId: string) => {
    const picked = await window.desktop?.pickProjectDirectory?.()
    if (!picked?.trim() || !window.desktop?.inspectRuntimeDirectory) return
    if (window.desktop.relocateRuntime && chatWorkspace && window.desktop.getChatWorkspace) {
      let result: RuntimeRelocationResult
      try {
        await workspaceSession.flush()
        setWorkspaceSaveError('')
        const authoritative = await window.desktop.getChatWorkspace()
        if (!authoritative) {
          setLocalAppDialogError(t('runtime.workspaceSaveFailed'))
          return
        }
        result = await window.desktop.relocateRuntime(localAppId, picked.trim(), workspaceRevisionOf(authoritative))
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'Runtime relocation failed'
        setWorkspaceSaveError(message)
        setLocalAppInspect({ ok: false, rootPath: picked, code: 'invalid-root', message })
        return
      }
      if (!result.ok) {
        setLocalAppDialogError(result.message)
        setLocalAppInspect({ ok: false, rootPath: picked, code: result.code === 'path-missing' ? 'path-missing' : 'invalid-root', message: result.message })
        return
      }
      // Main returned the authoritative committed snapshot. Publishing it
      // avoids overwriting concurrent chat/project changes with stale React state.
      flushSync(() => adoptAuthoritativeSnapshot(result.workspace))
      persistChatWorkspaceStateToLocalStorage(result.workspace)
      setLocalAppInspect(null)
      if (result.warning) {
        setLocalAppDialogError(result.warning)
        setWorkspaceSaveError(result.warning)
      }
      if (result.runtime) {
        setRuntimeStates((current) => mergeAcceptedRuntime(current, result.runtime!))
      }
      return
    }
    const inspected = await window.desktop.inspectRuntimeDirectory(picked.trim())
    if (!inspected.ok) {
      setLocalAppInspect(inspected)
      return
    }
    const definition = chatWorkspace?.runtimeDefinitions.find((item) => item.id === localAppId)
    if (!definition) return
    const nextDefinition: RuntimeDefinition = { ...definition, rootPath: inspected.rootPath, canonicalRoot: inspected.canonicalRoot, name: inspected.name, updatedAt: Date.now(), trustStatus: 'trusted' }
    const trusted = window.desktop.trustRuntimeDirectory ? await window.desktop.trustRuntimeDirectory(nextDefinition.rootPath) : null
    if (trusted?.ok) {
      const nextWorkspace = chatWorkspace
        ? {
            ...chatWorkspace,
            runtimeDefinitions: chatWorkspace.runtimeDefinitions.map((item) =>
              item.id === localAppId ? { ...nextDefinition, id: localAppId } : item,
            ),
          }
        : null
      if (!nextWorkspace) return
      setChatWorkspace(nextWorkspace)
      workspaceSession.stage(hydrateWorkspaceChatStates(nextWorkspace))
      try {
        await workspaceSession.flush()
      } catch (error) {
        setWorkspaceSaveError(error instanceof Error && error.message ? error.message : t('runtime.workspaceSaveFailed'))
        return
      }
      void startLocalApp(localAppId)
    }
  }, [chatWorkspace, setChatWorkspace, startLocalApp, t, workspaceSession])

  useEffect(() => {
    if (!chatWorkspace || !window.desktop?.startRuntime) return
    const pending: Array<{ definitionId: string; tabId: string }> = []
    for (const definition of chatWorkspace.runtimeDefinitions) {
      if (!definition.autoStart || definition.trustStatus !== 'trusted') continue
      for (const tab of chatWorkspace.workspaceTabs.filter((item) => item.runtimeDefinitionId === definition.id)) {
        if (restoredLocalAppsRef.current.has(tab.id)) continue
        restoredLocalAppsRef.current.add(tab.id)
        pending.push({ definitionId: definition.id, tabId: tab.id })
      }
    }
    // Starting several npm processes at once makes the active tab slower and
    // can saturate disk/CPU. Restore the visible tab first, then warm the rest
    // sequentially in the background.
    pending.sort((left, right) => Number(right.tabId === chatWorkspace.activeWorkspaceTabId) - Number(left.tabId === chatWorkspace.activeWorkspaceTabId))
    void (async () => {
      for (const item of pending) {
        await startLocalApp(item.definitionId, 'restore', item.tabId)
      }
    })()
  }, [chatWorkspace, startLocalApp])

  const updateInitialModelField = useCallback(
    <K extends keyof InitialModelFormState>(field: K, value: InitialModelFormState[K]) => {
      setInitialModelEnabled(true)
      setInitialModelTouched(true)
      setInitialModelForm((current) => ({ ...current, [field]: value }))
    },
    [],
  )

  const chooseInitialProviderPreset = useCallback(
    (preset: ProviderPreset) => {
      setInitialModelEnabled(true)
      setInitialModelTouched(true)
      setInitialModelForm({
        presetId: preset.id,
        name: preset.name,
        apiKeyUrl: preset.apiKeyUrl,
        authMode: preset.authMode,
        apiKey: '',
        baseUrl: preset.baseUrl,
        model: preset.model,
        modelSupportsImages: preset.modelSupportsImages,
        haikuModel: preset.defaultHaikuModel,
        haikuSupportsImages: preset.defaultHaikuSupportsImages,
        sonnetModel: preset.defaultSonnetModel,
        sonnetSupportsImages: preset.defaultSonnetSupportsImages,
        opusModel: preset.defaultOpusModel,
        opusSupportsImages: preset.defaultOpusSupportsImages,
      })
      setInitialModelStatus(t('shell.initModelProviderSelected', { name: preset.name }))
    },
    [t],
  )

  const chooseInitialCustomProvider = useCallback(() => {
    setInitialModelEnabled(true)
    setInitialModelTouched(true)
    setInitialModelForm(createInitialModelFormState())
    setInitialModelStatus(t('shell.initModelCustomSelected'))
  }, [t])

  const skipInitialModelSetup = useCallback(() => {
    setInitialModelEnabled(false)
    setInitialModelStatus(t('shell.initModelSkipped'))
  }, [t])

  const openInitialModelApiKeyLink = useCallback((event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
    if (!window.desktop?.openExternal) return
    event.preventDefault()
    void window.desktop.openExternal(url)
  }, [])

  const pickInitialProjectFolder = useCallback(async () => {
    let value: string | undefined
    if (window.desktop?.pickProjectDirectory) {
      value = (await window.desktop.pickProjectDirectory())?.trim()
    } else {
      value = window.prompt(t('project.promptExistingPath'), '')?.trim()
    }
    if (!value) return
    setInitialProjectPath(value)
    setInitialModelStatus(t('shell.initProjectSelected'))
  }, [t])

  const saveInitialModelSettings = useCallback(async () => {
    if (!initialModelEnabled || !hasInitialModelInput(initialModelForm)) {
      return true
    }
    if (!window.claudeChat) {
      setInitialModelStatus(t('shell.initModelBridgeUnavailable'))
      return false
    }

    const primaryModel = initialModelForm.model.trim() || initialModelForm.sonnetModel.trim()
    const sonnetModel = initialModelForm.sonnetModel.trim()
    const haikuModel = initialModelForm.haikuModel.trim()
    const opusModel = initialModelForm.opusModel.trim()
    const selectedModel = primaryModel || sonnetModel || opusModel || haikuModel
    if (!selectedModel) {
      setInitialModelStatus(t('shell.initModelRequired'))
      return false
    }
    if (!initialModelForm.apiKey.trim()) {
      setInitialModelStatus(t('shell.initModelApiKeyRequired'))
      return false
    }

    setInitialModelBusy(true)
    setInitialModelStatus(t('shell.initModelSaving'))

    try {
      const snapshot = await window.claudeChat.getSettings()
      const activeProvider =
        snapshot.settings.providers.find((provider) => provider.id === snapshot.settings.activeProviderId) ??
        snapshot.settings.providers[0] ??
        createInitialModelProvider()
      const configuredProvider: ClaudeAgentModelProvider = {
        ...activeProvider,
        presetId: initialModelForm.presetId,
        name: initialModelForm.name.trim(),
        apiKeyUrl: initialModelForm.apiKeyUrl.trim(),
        authMode: initialModelForm.authMode,
        apiKey: initialModelForm.apiKey.trim(),
        authToken: '',
        baseUrl: initialModelForm.baseUrl.trim(),
        model: primaryModel || selectedModel,
        modelSupportsImages: initialModelForm.modelSupportsImages,
        defaultHaikuModel: haikuModel,
        defaultHaikuSupportsImages: initialModelForm.haikuSupportsImages,
        defaultSonnetModel: sonnetModel || selectedModel,
        defaultSonnetSupportsImages: initialModelForm.sonnetSupportsImages,
        defaultOpusModel: opusModel,
        defaultOpusSupportsImages: initialModelForm.opusSupportsImages,
      }
      const existingConfiguredProviders = snapshot.settings.providers.filter(providerHasCredential)
      const nextProviders = existingConfiguredProviders.some((provider) => provider.id === configuredProvider.id)
        ? existingConfiguredProviders.map((provider) =>
            provider.id === configuredProvider.id ? configuredProvider : provider,
          )
        : [configuredProvider, ...existingConfiguredProviders]
      const activeId = configuredProvider.id

      const nextSnapshot = await window.claudeChat.saveSettings({
        configSource: 'settings',
        activeProviderId: activeId,
        activeAnthropicModel: selectedModel,
        providers: nextProviders,
      })
      window.dispatchEvent(new CustomEvent(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, { detail: nextSnapshot }))
      applyInitialModelSnapshot(nextSnapshot)
      setInitialModelStatus(t('shell.initModelSaved'))
      return true
    } catch (error) {
      setInitialModelStatus(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setInitialModelBusy(false)
    }
  }, [applyInitialModelSnapshot, initialModelEnabled, initialModelForm, t])

  const startInitialSetup = useCallback(
    async (event: ReactFormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!initialProjectPath.trim()) {
        setInitialModelStatus(t('shell.initProjectRequired'))
        return
      }
      const saved = await saveInitialModelSettings()
      if (!saved) return
      // The shared workspace error notice is not rendered on this screen, so
      // a refused create must be surfaced in the setup status line itself.
      const result = await createProjectFromExistingPath(initialProjectPath)
      if (result && !result.ok) setInitialModelStatus(result.message)
    },
    [createProjectFromExistingPath, initialProjectPath, saveInitialModelSettings, t],
  )

  // --- OS tray: default locale once + wire menu actions (new thread / open project) / 系统托盘：初始化语言并绑定新建会话与打开项目 ---

  useEffect(() => {
    void window.desktop?.syncTrayLocale?.(getInitialLocale())
  }, [])

  useEffect(() => {
    const onWorkspaceCleared = () => {
      handleWorkspaceCleared()
    }
    window.addEventListener(CHAT_WORKSPACE_CLEARED_EVENT, onWorkspaceCleared)
    return () => window.removeEventListener(CHAT_WORKSPACE_CLEARED_EVENT, onWorkspaceCleared)
  }, [handleWorkspaceCleared])

  useEffect(() => {
    const subscribe = window.desktop?.onTrayMenuAction
    if (!subscribe) return
    return subscribe((action) => {
      if (!chatWorkspace) return
      if (action === 'new-thread') {
        createThreadInProject()
      } else if (action === 'open-project') {
        void createProject('existing')
      }
    })
  }, [chatWorkspace, createProject, createThreadInProject])

  // --- Home plugin tasks: mirror background threads opened from the panel / 首页插件任务：同步面板打开的后台线程 ---

  const ensureTaskRunThread = useCallback(
    (event: HomePluginTaskEvent) => {
      if (!event.thread) return
      updateChatWorkspace((prev) =>
        workspaceSession.ensureTaskRunThread(prev, {
          projectPath: event.projectPath,
          slug: event.slug,
          title: event.task.mode === 'agent' ? '执行agent' : `执行${event.task.title}`,
          thread: event.thread!,
        }),
      )
    },
    [updateChatWorkspace, workspaceSession],
  )

  useEffect(() => {
    const subscribe = window.desktop?.onHomePluginTaskEvent
    if (!subscribe) return
    return subscribe((event) => {
      ensureTaskRunThread(event)
    })
  }, [ensureTaskRunThread])

  const archiveThread = useCallback(
    async (threadId: string) => {
      const target = chatWorkspaceRef.current?.threads.find((thread) => thread.id === threadId)
      if (!target || target.archivedAt) return
      const wasActive = chatWorkspaceRef.current?.activeThreadId === threadId

      if (projectChatReadinessRef.current === 'legacy') {
        // Revision 1 behavior, unchanged.
        if (target.purpose === 'task-run' && target.homePluginSlug) {
          const project = chatWorkspaceRef.current?.projects.find((item) => item.id === target.projectId)
          if (project?.path && window.desktop?.stopTaskHomePlugin) {
            try {
              await window.desktop.stopTaskHomePlugin(project.path, target.homePluginSlug)
            } catch {
              /* stop is best-effort when archiving a running task */
            }
          }
        } else if (target.purpose === 'skill-run') {
          const requestId = threadRunStatesRef.current[target.id]?.requestId
          if (requestId && !requestId.startsWith('pending-') && window.claudeChat) {
            try {
              await window.claudeChat.cancel(requestId)
            } catch {
              /* stop is best-effort when archiving a running Skill */
            }
          }
        }
        updateChatWorkspace((prev) => workspaceSession.archiveThread(prev, threadId))
        setSelectedProjectSkill(null)
        if (wasActive) goHome()
        return
      }

      // Main owns the durable archive; no implicit cancel, and a busy thread is
      // refused rather than silently orphaning its run.
      const archived = await threadIntentClient.archive(target.projectId, threadId)
      if (!archived) return
      setSelectedProjectSkill(null)
      // Only the archived thread's own selection may move.
      if (wasActive) goHome()
    },
    [goHome, threadIntentClient, updateChatWorkspace, workspaceSession],
  )

  /**
   * Busy is a snapshot fact in broker mode. Legacy keeps its own `task-run`
   * confirm flow, so this reports false there.
   */
  const isThreadBusy = useCallback((threadId: string) => {
    if (projectChatReadiness === 'legacy') return false
    const thread = chatWorkspaceRef.current?.threads.find((item) => item.id === threadId)
    if (!thread) return false
    return isProjectThreadBusy(projectChatSnapshotStore.get(thread.projectId), threadId)
  }, [projectChatReadiness, projectChatSnapshotStore])

  const toggleThreadPinned = useCallback((threadId: string) => {
    const target = chatWorkspaceRef.current?.threads.find((thread) => thread.id === threadId)
    if (!target) return
    if (projectChatReadinessRef.current === 'legacy') {
      updateChatWorkspace((prev) => workspaceSession.toggleThreadPinned(prev, threadId))
      return
    }
    // Explicit boolean target so a retry cannot flip twice.
    void threadIntentClient.setPinned(target.projectId, threadId, !target.pinnedAt)
  }, [threadIntentClient, updateChatWorkspace, workspaceSession])

  const toggleProjectPinned = useCallback((projectId: string) => {
    // Explicit target value: a toggle intent would flip twice on a retry.
    const pinned = !chatWorkspaceRef.current?.projects.find((project) => project.id === projectId)?.pinnedAt
    void workspaceCommandClient.submit({ type: 'project.setPinned', projectId, pinned })
  }, [workspaceCommandClient])

  const reorderProject = useCallback((projectId: string, targetProjectId: string, position: 'before' | 'after') => {
    void workspaceCommandClient.submit({ type: 'project.reorder', projectId, targetProjectId, position })
  }, [workspaceCommandClient])

  // Preferences stay optimistic for responsiveness and are merged into one
  // debounced Main command; the flush on unmount keeps the last toggle.
  const toggleSidebarCollapsed = useCallback(() => {
    const next = !chatWorkspaceRef.current?.sidebarPrefs.collapsed
    updateChatWorkspace((prev) => ({ ...prev, sidebarPrefs: { ...prev.sidebarPrefs, collapsed: next } }))
    workspaceCommandClient.queuePreferences({ sidebarCollapsed: next })
  }, [updateChatWorkspace, workspaceCommandClient])

  const toggleSidebarProjectCollapsed = useCallback((projectId: string) => {
    const current = chatWorkspaceRef.current?.sidebarPrefs.collapsedProjectIds ?? []
    const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    updateChatWorkspace((prev) => ({ ...prev, sidebarPrefs: { ...prev.sidebarPrefs, collapsedProjectIds: next } }))
    workspaceCommandClient.queuePreferences({ collapsedProjectIds: next })
  }, [updateChatWorkspace, workspaceCommandClient])

  const removeProject = useCallback(
    async (projectId: string) => {
      const projectDefinition = chatWorkspaceRef.current?.runtimeDefinitions.find((definition) => definition.owner.kind === 'project' && definition.owner.projectId === projectId)
      const wasActive = chatWorkspaceRef.current?.activeProjectId === projectId
      const result = await workspaceCommandClient.submit(
        { type: 'project.remove', projectId },
        { preserveSelection: !wasActive },
      )
      if (!result.ok) return
      if (projectDefinition) {
        const consumerId = `project-home:${projectId}:${projectRuntimeState.mountId}`
        void window.desktop?.releaseRuntime?.(projectDefinition.id, consumerId)
        void window.desktop?.stopRuntime?.(projectDefinition.id, 'last-consumer')
      }
      void window.desktop?.resetRuntimePreviewLayout?.(projectId)
      setSelectedProjectSkill((current) => (current?.projectId === projectId ? null : current))
      goHome()
    },
    [goHome, projectRuntimeState.mountId, workspaceCommandClient],
  )

  const revealProjectInFileManager = useCallback((projectPath: string) => {
    void window.desktop?.showItemInFolder?.(projectPath)
  }, [])

  const relocateProject = useCallback(
    async (projectId: string) => {
      let value: string | undefined
      if (window.desktop?.pickProjectDirectory) {
        value = (await window.desktop.pickProjectDirectory())?.trim()
      } else {
        value = window.prompt(t('project.promptExistingPath'), '')?.trim()
      }
      if (!value) return

      await workspaceCommandClient.submit({ type: 'project.relocate', projectId, path: value })
    },
    [t, workspaceCommandClient],
  )

  const hideProjectSkill = useCallback((projectId: string, skillPath: string) => {
    setHiddenSkillPathsByProject((prev) => {
      const existing = prev[projectId] ?? []
      if (existing.includes(skillPath)) return prev
      const next = { ...prev, [projectId]: [...existing, skillPath] }
      writeHiddenSkillPathsMap(next)
      return next
    })
    setSelectedProjectSkill((current) =>
      current?.projectId === projectId && current.path === skillPath ? null : current,
    )
  }, [])

  const selectProjectSkill = useCallback((projectId: string, skill: Omit<SelectedProjectSkill, 'projectId'>) => {
    setSelectedProjectSkill({ ...skill, projectId })
  }, [])

  const handleThreadPromptSubmit = useCallback((threadId: string, prompt: string) => {
    setSelectedProjectSkill(null)
    updateChatWorkspace((prev) =>
      workspaceSession.markPromptSubmitted(
        prev,
        threadId,
        prompt,
        defaultThreadTitleSet,
        t('thread.newThreadTitle'),
        (id) => threadChatStore.read(id).items.some((item) => item.type === 'message' && item.role === 'user'),
      ),
    )
  }, [updateChatWorkspace, t, workspaceSession])

  // --- Read CSS length tokens, clamp sidebar, persist user width / 读取 CSS 长度 token、夹紧侧栏宽度并持久化用户宽度 ---

  const readCssPxVar = useCallback((name: string, fallback: number): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) ? n : fallback
  }, [])

  const clampSidebarWidth = useCallback(
    (px: number): number => {
      const body = appBodyRef.current
      if (!body) return px
      const min = readCssPxVar('--width-sidebar-min', 160)
      const bodyW = body.getBoundingClientRect().width
      const max = Math.max(min, bodyW * SIDEBAR_MAX_RATIO)
      return Math.min(max, Math.max(min, px))
    },
    [readCssPxVar],
  )

  const applySidebarWidthPx = useCallback(
    (px: number) => {
      const body = appBodyRef.current
      if (!body) return
      const clamped = clampSidebarWidth(px)
      body.style.setProperty('--sidebar-user-width', `${clamped}px`)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(clamped)))
      } catch {
        /* 私密模式或禁用存储时忽略 / Ignore when storage is blocked (private mode, etc.) */
      }
    },
    [clampSidebarWidth],
  )

  const handleWindowResize = useCallback(() => {
    if (sidebarCollapsed || !appBodyRef.current) return
    const width = Number.parseFloat(
      getComputedStyle(appBodyRef.current).getPropertyValue('--sidebar-current-width').trim(),
    )
    if (Number.isFinite(width)) applySidebarWidthPx(width)
  }, [applySidebarWidthPx, sidebarCollapsed])

  const syncHistoryButtons = useCallback(() => {
    const nav = (window as unknown as { navigation?: { canGoBack?: boolean; canGoForward?: boolean } }).navigation
    if (nav && typeof nav.canGoBack === 'boolean') {
      setCanBack(nav.canGoBack)
      setCanForward(!!nav.canGoForward)
      return
    }
    setCanBack(window.history.length > 1)
    setCanForward(false)
  }, [])

  const openSettingsCategory = useCallback(
    (category: SettingsCategoryId) => {
      void setActiveLocalAppPreviewVisible(false)
      flushSync(() => {
        setActiveViewId('settings')
        setSettingsCategory(category)
      })

      const nextHash = `settings/${category}`
      const currentHash = window.location.hash.replace(/^#\/?/, '')
      if (currentHash !== nextHash) {
        window.location.hash = nextHash
      } else {
        syncHistoryButtons()
      }
    },
    [setActiveLocalAppPreviewVisible, syncHistoryButtons],
  )

  // --- `hashchange` → settings view; keep back/forward mirrors in sync / hash 变化映射到设置视图；同步前进后退按钮态 ---

  useEffect(() => {
    const onHash = () => {
      setActiveViewId(viewFromLocation())
      setSettingsCategory(settingsCategoryFromLocation())
      syncHistoryButtons()
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', syncHistoryButtons)
    window.addEventListener('resize', handleWindowResize)
    onHash()
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', syncHistoryButtons)
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [handleWindowResize, syncHistoryButtons])

  // --- On boot, reapply stored sidebar width token / 启动时重新应用已保存的侧栏宽度 ---

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
      if (!raw) return
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n)) applySidebarWidthPx(n)
    } catch {
      /* 私密模式或禁用存储时忽略 / Ignore when storage is blocked (private mode, etc.) */
    }
  }, [applySidebarWidthPx])

  // --- Splitter drag: pointer capture translates to sidebar width delta / 分割条拖拽：指针捕获映射为侧栏宽度增量 ---

  const handleSidebarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (sidebarCollapsed) return

    event.preventDefault()
    sidebarResizeActive.current = true
    shellRef.current?.classList.add('is-resizing-sidebar')
    const splitter = sidebarSplitterRef.current
    const sidebar = appSidebarRef.current
    const body = appBodyRef.current
    if (!splitter || !sidebar || !body) return

    const startX = event.clientX
    const startWidth = sidebar.getBoundingClientRect().width || readCssPxVar('--width-sidebar-min', 240)

    const onMove = (moveEvent: PointerEvent) => {
      if (!sidebarResizeActive.current) return
      applySidebarWidthPx(startWidth + moveEvent.clientX - startX)
    }
    const onUp = () => {
      sidebarResizeActive.current = false
      shellRef.current?.classList.remove('is-resizing-sidebar')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    try {
      splitter.setPointerCapture(event.pointerId)
    } catch {
      /* 旧版 Chromium 可能抛错；无捕获时仍可用 mousemove 兜底 / Older Chromium may throw; move handlers still work */
    }
  }

  // --- Title region: settings category vs “project · thread” on home / 标题区：设置分类与首页「项目 · 线程」---

  const workspaceTitle = useMemo(() => {
    if (activeRuntimeDefinition && activeWorkspaceTab) return activeWorkspaceTab.title || activeRuntimeDefinition.name
    if (activeViewId === 'settings') return t(settingsWorkspaceTitleKey(settingsCategory))
    if (activeViewId === 'home') {
      const projectName = activeProject?.name.trim()
      const threadTitle = activeThread?.title.trim()
      if (projectName && threadTitle) return `${projectName} · ${threadTitle}`
      if (projectName) return projectName
    }
    return t(VIEW_HEADING_KEYS[activeViewId])
  }, [activeRuntimeDefinition, activeWorkspaceTab, activeProject?.name, activeThread?.title, activeViewId, settingsCategory, t])

  // --- Render gates: wait for data; empty workspace CTA; guard missing project / 渲染门控：等待数据；空工作区引导；缺少项目则短路 ---

  if (!chatWorkspace) {
    return null
  }

  const initialProjectComplete = Boolean(initialProjectPath.trim())
  const initialSetupReady = initialProjectComplete && !initialModelBusy
  const initialProjectName = initialProjectPath ? pathBasename(initialProjectPath, t('shell.initProjectFolderTitle')) : ''
  const initialModelSummary = buildInitialModelSummary(initialModelForm)
  const initialProviderSelectValue = !initialModelEnabled
    ? INITIAL_PROVIDER_SKIP_VALUE
    : initialModelForm.presetId || INITIAL_PROVIDER_CUSTOM_VALUE
  const selectedInitialProviderPreset = initialModelEnabled && initialModelForm.presetId
    ? initialProviderPresets.find((preset) => preset.id === initialModelForm.presetId)
    : undefined
  const initialProviderSelectMeta = !initialModelEnabled
    ? initialModelSummary
      ? t('shell.initModelCurrentConfig', { summary: initialModelSummary })
      : t('shell.initModelSkipMeta')
    : selectedInitialProviderPreset
      ? selectedInitialProviderPreset.baseUrl
      : t('settings.models.customProviderMeta')
  const initialModelUsesCustomProvider = initialModelEnabled && !initialModelForm.presetId
  const initialModelRows = [
    {
      key: 'primary',
      label: t('settings.models.fieldPrimary'),
      hint: t('settings.models.fieldPrimaryHint'),
      inputId: 'init-model-primary',
      field: 'model' as const,
      value: initialModelForm.model,
      supportField: 'modelSupportsImages' as const,
      supportsImages: initialModelForm.modelSupportsImages,
    },
    {
      key: 'haiku',
      label: t('settings.models.fieldHaiku'),
      hint: t('settings.models.fieldHaikuHint'),
      inputId: 'init-model-haiku',
      field: 'haikuModel' as const,
      value: initialModelForm.haikuModel,
      supportField: 'haikuSupportsImages' as const,
      supportsImages: initialModelForm.haikuSupportsImages,
    },
    {
      key: 'sonnet',
      label: t('settings.models.fieldSonnet'),
      hint: t('settings.models.fieldSonnetHint'),
      inputId: 'init-model-sonnet',
      field: 'sonnetModel' as const,
      value: initialModelForm.sonnetModel,
      supportField: 'sonnetSupportsImages' as const,
      supportsImages: initialModelForm.sonnetSupportsImages,
    },
    {
      key: 'opus',
      label: t('settings.models.fieldOpus'),
      hint: t('settings.models.fieldOpusHint'),
      inputId: 'init-model-opus',
      field: 'opusModel' as const,
      value: initialModelForm.opusModel,
      supportField: 'opusSupportsImages' as const,
      supportsImages: initialModelForm.opusSupportsImages,
    },
  ]

  if (chatWorkspace.projects.length === 0 && chatWorkspace.workspaceTabs.length === 0) {
    return (
      <div className="app-shell app-shell-empty" id="app-shell">
        <form className="app-shell-empty__panel no-drag" onSubmit={(event) => void startInitialSetup(event)}>
          <header className="app-shell-empty__header">
            <span className="app-shell-empty__eyebrow">{t('shell.initEyebrow')}</span>
            <h1>{t('shell.emptyWorkspaceHeading')}</h1>
            <p>{t('shell.emptyWorkspaceBody')}</p>
          </header>

          <div className="app-shell-empty__flow" aria-label={t('shell.initFlowAria')}>
            <section className="app-shell-empty__step app-shell-empty__step--project" aria-labelledby="init-project-title">
              <div className="app-shell-empty__step-heading">
                <span className="app-shell-empty__step-index">1</span>
                <div>
                  <h2 id="init-project-title">{t('shell.initProjectTitle')}</h2>
                  <p>{t('shell.initProjectBody')}</p>
                </div>
              </div>
              <button
                type="button"
                className={`app-shell-empty__project-preview${initialProjectComplete ? ' is-selected' : ''}`}
                onClick={() => void pickInitialProjectFolder()}
                disabled={initialModelBusy}
              >
                <IconInline name="folder" />
                <div>
                  <strong>{t('shell.initProjectFolderTitle')}</strong>
                  <span>{initialProjectName ? initialProjectPath : t('shell.initProjectFolderHint')}</span>
                </div>
              </button>
            </section>

            <section className="app-shell-empty__step app-shell-empty__step--model" aria-labelledby="init-model-title">
              <div className="app-shell-empty__step-heading">
                <span className="app-shell-empty__step-index">2</span>
                <div>
                  <h2 id="init-model-title">{t('shell.initModelTitle')}</h2>
                  <p>{t('shell.initModelBody')}</p>
                </div>
              </div>

              <div className="app-shell-empty__provider-select-block">
                <label htmlFor="init-provider-select" className="app-shell-empty__provider-select-label">
                  {t('settings.models.addProviderDialogTitle')}
                </label>
                <div className="app-shell-empty__provider-select-wrap">
                  <select
                    id="init-provider-select"
                    className="app-shell-empty__provider-select"
                    value={initialProviderSelectValue}
                    aria-label={t('shell.initModelPresetAria')}
                    disabled={initialModelBusy}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === INITIAL_PROVIDER_SKIP_VALUE) {
                        skipInitialModelSetup()
                        return
                      }
                      if (value === INITIAL_PROVIDER_CUSTOM_VALUE) {
                        chooseInitialCustomProvider()
                        return
                      }
                      const preset = initialProviderPresets.find((item) => item.id === value)
                      if (preset) chooseInitialProviderPreset(preset)
                    }}
                  >
                    <option value={INITIAL_PROVIDER_SKIP_VALUE}>{t('shell.initModelSkipTitle')}</option>
                    {initialProviderPresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                    <option value={INITIAL_PROVIDER_CUSTOM_VALUE}>{t('settings.models.customProvider')}</option>
                  </select>
                  <span className="app-shell-empty__provider-select-chevron" aria-hidden="true">
                    <IconInline name="chevron" />
                  </span>
                </div>
                <p className="app-shell-empty__provider-select-meta">{initialProviderSelectMeta}</p>
              </div>

              {initialModelEnabled ? (
                <>
                  {!initialModelUsesCustomProvider ? (
                    <p className="app-shell-empty__preset-hint">{t('shell.initModelPresetHiddenHint')}</p>
                  ) : null}
                  <div className="settings-group settings-group--provider-fields app-shell-empty__model-fields">
                    {initialModelUsesCustomProvider ? (
                      <div className="settings-field-row">
                        <div className="settings-field-row__meta">
                          <label htmlFor="init-model-provider-name" className="settings-field-row__label">
                            <IconInline name="settings" />
                            {t('settings.models.fieldName')}
                          </label>
                          <p className="settings-field-row__hint">{t('settings.models.fieldNameHint')}</p>
                        </div>
                        <input
                          id="init-model-provider-name"
                          type="text"
                          className="settings-input"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t('settings.models.fieldNamePlaceholder')}
                          value={initialModelForm.name}
                          onChange={(event) => updateInitialModelField('name', event.target.value)}
                          disabled={initialModelBusy}
                        />
                      </div>
                    ) : null}
                    <div className="settings-field-row">
                      <div className="settings-field-row__meta">
                        <label htmlFor="init-model-api-key" className="settings-field-row__label">
                          <IconInline name="key" />
                          {t('settings.models.fieldApiKey')}
                        </label>
                        {/* <p className="settings-field-row__hint">{t('settings.models.fieldApiKeyHint')}</p> */}
                        {initialModelForm.apiKeyUrl ? (
                          <a
                            className="settings-api-key-link"
                            href={initialModelForm.apiKeyUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => openInitialModelApiKeyLink(event, initialModelForm.apiKeyUrl)}
                          >
                            {t('settings.models.getApiKey')}
                          </a>
                        ) : null}
                      </div>
                      <input
                        id="init-model-api-key"
                        type="password"
                        className="settings-input"
                        autoComplete="off"
                        spellCheck={false}
                        value={initialModelForm.apiKey}
                        onChange={(event) => updateInitialModelField('apiKey', event.target.value)}
                        disabled={initialModelBusy}
                      />
                    </div>
                    {initialModelUsesCustomProvider ? (
                      <div className="settings-field-row">
                        <div className="settings-field-row__meta">
                          <label htmlFor="init-model-base-url" className="settings-field-row__label">
                            <IconInline name="server" />
                            {t('settings.models.fieldBaseUrl')}
                          </label>
                          <p className="settings-field-row__hint">{t('settings.models.fieldBaseUrlHint')}</p>
                        </div>
                        <input
                          id="init-model-base-url"
                          type="url"
                          className="settings-input"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t('shell.initModelBaseUrlPlaceholder')}
                          value={initialModelForm.baseUrl}
                          onChange={(event) => updateInitialModelField('baseUrl', event.target.value)}
                          disabled={initialModelBusy}
                        />
                      </div>
                    ) : null}
                    {initialModelUsesCustomProvider ? (
                      <div className="settings-model-map" aria-label={t('settings.models.modelMappingsAria')}>
                        {initialModelRows.map((row) => (
                          <div className="settings-field-row settings-model-row" key={row.key}>
                            <div className="settings-field-row__meta">
                              <label htmlFor={row.inputId} className="settings-field-row__label">
                                <IconInline name="chip" />
                                {row.label}
                              </label>
                              <p className="settings-field-row__hint">{row.hint}</p>
                            </div>
                            <input
                              id={row.inputId}
                              type="text"
                              className="settings-input"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={t('shell.initModelIdPlaceholder')}
                              value={row.value}
                              onChange={(event) => updateInitialModelField(row.field, event.target.value)}
                              disabled={initialModelBusy}
                            />
                            <label
                              className="settings-model-image-toggle"
                              title={t('settings.models.modelImageToggleTitle', { slot: row.label })}
                            >
                              <span className="settings-model-image-toggle__glyph" aria-hidden="true">
                                <IconInline name="image" />
                              </span>
                              <span className="settings-switch-control">
                                <input
                                  type="checkbox"
                                  className="settings-switch-input"
                                  checked={row.supportsImages}
                                  aria-label={t('settings.models.modelImageToggleAria', { slot: row.label })}
                                  onChange={(event) => updateInitialModelField(row.supportField, event.target.checked)}
                                  disabled={initialModelBusy}
                                />
                                <span className="settings-switch-track" aria-hidden="true">
                                  <span className="settings-switch-thumb" />
                                </span>
                              </span>
                            </label>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          </div>

          <footer className="app-shell-empty__footer">
            <p className="app-shell-empty__status" role="status">
              {initialModelStatus || t('shell.initModelIdle')}
            </p>
            <button type="submit" className="btn btn-primary app-shell-empty__submit" disabled={!initialSetupReady}>
              <IconInline name="check" />
              <span>{initialModelBusy ? t('shell.initModelSaving') : t('shell.initSubmit')}</span>
            </button>
          </footer>
        </form>
      </div>
    )
  }

  if (!activeProject) {
    if (activeWorkspaceTab && activeRuntimeDefinition && activeViewId === 'home') {
      const localTabs = chatWorkspace.workspaceTabs
      return (
        <div className={`app-shell${isWindows ? ' is-platform-win32' : ''}`} id="app-shell">
          <div className="app-body">
            <WorkspaceSaveErrorNotice error={workspaceSaveError} retrying={workspaceSaveRetrying} onRetry={() => void retryWorkspaceSave()} retryLabel={t('runtime.retryWorkspaceSave')} />
            <RuntimeDevelopmentConflictNotice conflict={runtimeDevelopmentConflict} onFocus={() => void focusRuntimeDevelopmentConflict()} />
            <RuntimeOnlySidebar
              tabs={localTabs}
              activeTabId={activeWorkspaceTab.id}
              onNew={() => { void openLocalAppEntry() }}
              onSelect={selectWorkspaceTab}
              onClose={(tabId) => { void closeLocalAppTab(tabId) }}
              onRename={renameLocalAppTab}
            />
            <main className="app-main local-app-only-main" role="main">
              <RuntimeWorkspace
                tab={activeWorkspaceTab}
                definition={activeRuntimeDefinition}
                runtime={runtimeStates[activeRuntimeDefinition.id] ?? null}
                onRetry={() => void startLocalApp(activeRuntimeDefinition.id)}
                onRestart={() => restartLocalApp(activeRuntimeDefinition.id)}
                onStop={() => stopLocalApp(activeRuntimeDefinition.id)}
                onReload={() => reloadLocalAppPreview(activeWorkspaceTab.id, activeRuntimeDefinition.id)}
                onRelocate={() => void relocateLocalApp(activeRuntimeDefinition.id)}
                onBuild={() => buildLocalApp(activeRuntimeDefinition.id)}
                onCancelBuild={() => cancelLocalAppBuild(activeRuntimeDefinition.id, runtimeStates[activeRuntimeDefinition.id]?.buildId)}
                runtimeDevelopment={activeWorkspaceRuntimeDevelopment}
                onDevelopmentAction={runtimeDevelopmentEnabled ? () => void runRuntimeDevelopmentAction({ kind: 'workspace-runtime', workspaceTabId: activeWorkspaceTab.id }, activeWorkspaceRuntimeDevelopment) : undefined}
              />
            </main>
          </div>
          <RuntimeOnboardingDialog
            inspect={localAppInspect}
            chooserOpen={localAppChooserOpen}
            existingDefinitions={chatWorkspace.runtimeDefinitions.filter((definition) => definition.owner.kind === 'workspace')}
            busy={localAppDialogBusy}
            error={localAppDialogError}
            onCancel={() => { setLocalAppInspect(null); setLocalAppChooserOpen(false); setLocalAppDialogError('') }}
            onChooseNew={() => { void inspectLocalApp() }}
            onOpenExisting={(definition) => void openExistingLocalApp(definition)}
            onTrust={(definition) => void trustAndCreateLocalApp(definition)}
          />
        </div>
      )
    }
    if (activeViewId === 'settings' && settingsCategory === 'mcp') {
      return (
        <div className={`app-shell${isWindows ? ' is-platform-win32' : ''} is-shell-settings`} id="app-shell">
          <div className="app-body">
            <WorkspaceSaveErrorNotice error={workspaceSaveError} retrying={workspaceSaveRetrying} onRetry={() => void retryWorkspaceSave()} retryLabel={t('runtime.retryWorkspaceSave')} />
            <RuntimeDevelopmentConflictNotice conflict={runtimeDevelopmentConflict} onFocus={() => void focusRuntimeDevelopmentConflict()} />
            <div className="app-workspace">
              <div className="app-workspace-top-drag draggable" aria-hidden />
              <div className="app-workspace-content">
                <main className="app-main" role="main">
                  <section
                    className="app-main-inner settings-page settings-page--mcp"
                    id="panel-settings-mcp"
                    data-testid="global-mcp-settings-page"
                    aria-hidden={false}
                  >
                    <header className="settings-page-header">
                      <h1 className="app-main-heading">{t('settings.mcp.pageTitle')}</h1>
                      <p className="settings-lede">{t('settings.mcp.pageLede')}</p>
                    </header>
                    <div className="settings-mcp-empty" data-testid="mcp-settings-no-project-empty" role="status">
                      <strong>{t('settings.mcp.noActiveProjectTitle')}</strong>
                      <span>{t('settings.mcp.noActiveProjectBody')}</span>
                    </div>
                  </section>
                </main>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  // --- Primary layout once a project exists: sidebar rail + workspace stack / 存在项目后的主布局：侧栏轨道 + 工作区堆叠 ---

  return (
    <div
      className={`app-shell${isWindows ? ' is-platform-win32' : ''}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${activeViewId === 'settings' ? ' is-shell-settings' : ''}`}
      id="app-shell"
      ref={shellRef}
    >
      <div className="app-body" ref={appBodyRef}>
        <WorkspaceSaveErrorNotice error={workspaceSaveError} retrying={workspaceSaveRetrying} onRetry={() => void retryWorkspaceSave()} retryLabel={t('runtime.retryWorkspaceSave')} />
        <RuntimeDevelopmentConflictNotice conflict={runtimeDevelopmentConflict} onFocus={() => void focusRuntimeDevelopmentConflict()} />
        <AppShellSidebar
          activeViewId={activeViewId}
          settingsCategory={settingsCategory}
          projects={chatWorkspace.projects}
          projectOrderIds={chatWorkspace.sidebarPrefs.projectOrderIds}
          threads={chatWorkspace.threads}
          threadRunStates={threadRunStates}
          threadCompletionStates={threadCompletionStates}
          activeProjectId={chatWorkspace.activeProjectId}
          activeThreadId={chatWorkspace.activeThreadId}
          collapsedProjectIds={chatWorkspace.sidebarPrefs.collapsedProjectIds}
          showProjectSkills={showProjectSkillsInSidebar}
          projectSkillStates={projectSkillStates}
          selectedProjectSkill={selectedProjectSkill}
          hiddenSkillPathsByProject={hiddenSkillPathsByProject}
          canBack={canBack}
          canForward={canForward}
          onCreateProject={createProject}
          workspaceTabs={chatWorkspace.workspaceTabs}
          runtimeDefinitions={chatWorkspace.runtimeDefinitions}
          activeWorkspaceTabId={chatWorkspace.activeWorkspaceTabId}
          runtimeStates={runtimeStates}
          runtimeDevelopmentStates={runtimeDevelopmentStates}
          onNewRuntime={openLocalAppEntry}
          onSelectWorkspaceTab={selectWorkspaceTab}
          onCloseWorkspaceTab={closeLocalAppTab}
          onRenameWorkspaceTab={renameLocalAppTab}
          onBuildWorkspaceRuntime={(tab) => {
            const runtime = runtimeStates[tab.runtimeDefinitionId]
            if (runtime?.status === 'building' || runtime?.buildStatus === 'building') cancelLocalAppBuild(tab.runtimeDefinitionId, runtime.buildId)
            else buildLocalApp(tab.runtimeDefinitionId)
          }}
          onRefreshWorkspaceRuntime={(tab) => {
            selectWorkspaceTab(tab.id)
            requestAnimationFrame(() => requestAnimationFrame(() => reloadLocalAppPreview(tab.id, tab.runtimeDefinitionId)))
          }}
          onRuntimeDevelopmentAction={(tab, snapshot) => {
            if (!runtimeDevelopmentEnabled) {
              setWorkspaceSaveError(t('runtime.developmentLiveUnavailable'))
              return
            }
            void runRuntimeDevelopmentAction({ kind: 'workspace-runtime', workspaceTabId: tab.id }, snapshot)
          }}
          onViewWorkspaceRuntime={(tab) => setRuntimeDetailsTabId(tab.id)}
          onRestartWorkspaceRuntime={(tab) => restartLocalApp(tab.runtimeDefinitionId)}
          onStopWorkspaceRuntime={(tab) => stopLocalApp(tab.runtimeDefinitionId)}
          onOpenSearch={() => window.dispatchEvent(new CustomEvent('agentos:open-search', { detail: { scope: 'all' } }))}
          onOpenSettingsCategory={openSettingsCategory}
          onSelectProject={selectProject}
          onSelectThread={selectThread}
          onSelectProjectSkill={selectProjectSkill}
          onRunProjectSkill={runProjectSkill}
          onToggleThreadPinned={toggleThreadPinned}
          onArchiveThread={archiveThread}
          isThreadBusy={isThreadBusy}
          onToggleProjectPinned={toggleProjectPinned}
          onReorderProject={reorderProject}
          onToggleSidebarProjectCollapsed={toggleSidebarProjectCollapsed}
          onRemoveProject={removeProject}
          onRelocateProject={(projectId) => void relocateProject(projectId)}
          onRevealProjectInFileManager={revealProjectInFileManager}
          onHideProjectSkill={hideProjectSkill}
          onToggleCollapsed={toggleSidebarCollapsed}
          sidebarRef={appSidebarRef}
          splitterRef={sidebarSplitterRef}
          onSplitterPointerDown={handleSidebarPointerDown}
        />
        <AppShellWorkspace
          workspaceTitle={workspaceTitle}
          headerStatus={headerStatus}
          activeViewId={activeViewId}
          settingsCategory={settingsCategory}
          activeProject={activeProject}
          activeThread={activeThread}
          activeWorkspaceTab={activeWorkspaceTab}
          activeRuntimeDefinition={activeRuntimeDefinition}
          activeRuntime={activeRuntimeDefinition ? runtimeStates[activeRuntimeDefinition.id] ?? null : null}
          onRetryRuntime={activeRuntimeDefinition ? () => void startLocalApp(activeRuntimeDefinition.id) : undefined}
          onRestartRuntime={activeRuntimeDefinition ? () => restartLocalApp(activeRuntimeDefinition.id) : undefined}
          onStopRuntime={activeRuntimeDefinition ? () => stopLocalApp(activeRuntimeDefinition.id) : undefined}
          onReloadRuntime={activeWorkspaceTab && activeRuntimeDefinition ? () => reloadLocalAppPreview(activeWorkspaceTab.id, activeRuntimeDefinition.id) : undefined}
          onNavigateRuntime={activeWorkspaceTab && activeRuntimeDefinition ? (direction) => navigateLocalAppPreview(activeWorkspaceTab.id, activeRuntimeDefinition.id, direction) : undefined}
          onRelocateRuntime={activeRuntimeDefinition ? () => void relocateLocalApp(activeRuntimeDefinition.id) : undefined}
          onBuildRuntime={activeRuntimeDefinition ? () => buildLocalApp(activeRuntimeDefinition.id) : undefined}
          onCancelBuildRuntime={activeRuntimeDefinition ? () => cancelLocalAppBuild(activeRuntimeDefinition.id, runtimeStates[activeRuntimeDefinition.id]?.buildId) : undefined}
          runtimeDevelopment={activeWorkspaceRuntimeDevelopment}
          onRuntimeDevelopmentAction={activeWorkspaceTab ? (runtimeDevelopmentEnabled ? () => void runRuntimeDevelopmentAction({ kind: 'workspace-runtime', workspaceTabId: activeWorkspaceTab.id }, activeWorkspaceRuntimeDevelopment) : undefined) : undefined}
          onOpenRuntimeDevelopmentThread={runtimeDevelopmentEnabled ? (threadId) => { void window.desktop?.openRuntimeDevelopmentThread?.(threadId) } : undefined}
          projectDefaultModelPick={projectDefaultModelPick}
          projectHomeModelPick={projectHomeModelPick}
          projectChatSnapshots={projectChatSnapshotStore}
          projectChatEnabled={projectChatEnabled}
          threads={chatWorkspace.threads}
          projects={chatWorkspace.projects}
          projectOrderIds={chatWorkspace.sidebarPrefs.projectOrderIds}
          threadRunStates={threadRunStates}
          chatRef={chatRef}
          onStatusChange={setHeaderStatus}
          onNewThread={createThreadInProject}
          onForkThread={forkThreadInProject}
          onCreateProject={createProject}
          onSelectProject={selectProject}
          onSelectThread={selectThread}
          onThreadChatStateChange={updateThreadChatState}
          onThreadPromptSubmit={handleThreadPromptSubmit}
          onThreadRunStateChange={updateThreadRunState}
          onThreadCompletionStateChange={updateThreadCompletionState}
          onProjectHomeModelPickChange={setProjectHomeDraftModelPick}
          homeModeResetKey={homeModeResetKey}
          onCreateHomePluginCardThread={createHomePluginCardThread}
          onEditHomePluginCard={openHomePluginCardThread}
          hiddenSkillPaths={hiddenSkillPathsByProject[activeProject.id] ?? []}
          projectSkills={projectSkillStates[activeProject.id]?.skills ?? []}
          onRunProjectSkill={runProjectSkill}
          onStopProjectSkillRun={stopProjectSkillRun}
          showProjectSkillsInSidebar={showProjectSkillsInSidebar}
          onShowProjectSkillsInSidebarChange={updateShowProjectSkillsInSidebar}
        />
        <RuntimeOnboardingDialog
          inspect={localAppInspect}
          chooserOpen={localAppChooserOpen}
          existingDefinitions={chatWorkspace.runtimeDefinitions.filter((definition) => definition.owner.kind === 'workspace')}
          busy={localAppDialogBusy}
          error={localAppDialogError}
          onCancel={() => { setLocalAppInspect(null); setLocalAppChooserOpen(false); setLocalAppDialogError('') }}
          onChooseNew={() => { void inspectLocalApp() }}
          onOpenExisting={(definition) => void openExistingLocalApp(definition)}
          onTrust={(definition) => void trustAndCreateLocalApp(definition)}
        />
        <AgentOSPairingDialog pairing={pendingPairing} projects={chatWorkspace.projects} />
        {runtimeDetailsTab && runtimeDetailsDefinition ? <RuntimeDetailsDialog tab={runtimeDetailsTab} definition={runtimeDetailsDefinition} runtime={runtimeStates[runtimeDetailsDefinition.id] ?? null} onClose={() => setRuntimeDetailsTabId(null)} /> : null}
      </div>
    </div>
  )
}

// --- File-level utilities (pure helpers below `AppShell`) / 文件级工具函数（`AppShell` 下方的纯函数）---

/**
 * Broker 每条 delta 都重发一份 run 列表；运行中的 run 字段其实没变。
 * 不比较就返回新对象，会让整棵壳层树按 delta 频率重渲染。
 */
/** Revision 1 的「最近活动」时间戳补写；Revision 2+ 由 broker 快照携带。 */
function touchWorkspaceThread(
  state: WorkspaceMetadataState,
  threadId: string,
  timestamp: number,
): WorkspaceMetadataState {
  const thread = state.threads.find((item) => item.id === threadId)
  if (!thread || thread.updatedAt >= timestamp) return state
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === thread.projectId ? { ...project, updatedAt: timestamp } : project,
    ),
    threads: state.threads.map((item) => (item.id === threadId ? { ...item, updatedAt: timestamp } : item)),
  }
}

function sameThreadRunStates(
  left: Record<string, ThreadRunState>,
  right: Record<string, ThreadRunState>,
): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  for (const key of leftKeys) {
    const a = left[key]
    const b = right[key]
    if (!b) return false
    if (a.requestId !== b.requestId || a.status !== b.status || a.startedAt !== b.startedAt || a.updatedAt !== b.updatedAt) {
      return false
    }
  }
  return true
}

function deriveDataCardThreadTitle(prompt: string, t: (path: string, vars?: Record<string, string | number>) => string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return t('thread.homePluginCardCreateTitle')
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized
}

function buildEditHomePluginCardPrompt(item: HomePluginRunItem, threadId: string): string {
  const pluginDir = `.agents/home-plugins/${item.slug}`
  return [
    `请修改数据卡片：${item.manifest.name}`,
    `当前专用 threadId：${threadId}`,
    `目标插件目录：${pluginDir}`,
    '',
    '开始前请先读取：',
    `${pluginDir}/manifest.json`,
    `${pluginDir}/extractor.js`,
    '',
    '要求：只修改这一张卡片，不要创建或改写其他 Home Plugin；修改后保持 small / medium / large 三种响应式展示契约。',
  ].join('\n')
}

function pathBasename(path: string, fallback: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path || fallback
}

function sameProjectPath(a: string, b: string): boolean {
  return normalizeComparablePath(a) === normalizeComparablePath(b)
}

function normalizeComparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function createInitialModelFormState(): InitialModelFormState {
  return {
    presetId: '',
    name: '',
    apiKeyUrl: '',
    authMode: 'apiKey',
    apiKey: '',
    baseUrl: '',
    model: '',
    modelSupportsImages: false,
    haikuModel: '',
    haikuSupportsImages: false,
    sonnetModel: '',
    sonnetSupportsImages: false,
    opusModel: '',
    opusSupportsImages: false,
  }
}

function hasInitialModelInput(form: InitialModelFormState): boolean {
  return [
    form.name,
    form.apiKey,
    form.baseUrl,
    form.model,
    form.haikuModel,
    form.sonnetModel,
    form.opusModel,
  ].some((value) => value.trim())
}

function buildInitialModelSummary(form: InitialModelFormState): string {
  return [form.name, form.model || form.sonnetModel || form.opusModel || form.haikuModel, form.baseUrl]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' · ')
}

function createInitialModelProvider(): ClaudeAgentModelProvider {
  return {
    id: createId('provider'),
    presetId: '',
    name: '',
    apiKeyUrl: '',
    authMode: 'apiKey',
    apiKey: '',
    authToken: '',
    baseUrl: '',
    model: '',
    modelSupportsImages: false,
    defaultHaikuModel: '',
    defaultHaikuSupportsImages: false,
    defaultOpusModel: '',
    defaultOpusSupportsImages: false,
    defaultSonnetModel: '',
    defaultSonnetSupportsImages: false,
  }
}

function selectInitialModelProvider(snapshot: ClaudeAgentSettingsSnapshot): ClaudeAgentModelProvider | undefined {
  return (
    snapshot.settings.providers.find((provider) => provider.id === snapshot.settings.activeProviderId) ??
    snapshot.settings.providers[0]
  )
}

function firstDefinedModelPickCandidate(
  candidates: SkillRunModelPickCandidate[],
): SkillRunModelPickCandidate | undefined {
  return candidates.find((candidate) => Boolean(candidate.pick))
}

function firstValidModelPickCandidate(
  settings: ClaudeAgentSettingsSnapshot['settings'],
  candidates: SkillRunModelPickCandidate[],
): SkillRunModelPickCandidate | undefined {
  for (const candidate of candidates) {
    const pick = validateModelPick(settings, candidate.pick)
    if (pick) return { ...candidate, pick }
  }
  return undefined
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return fallback
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function applyEyeComfortPreference(prefs: Pick<DesktopPreferences, 'eyeComfortMode'>) {
  document.documentElement.classList.toggle(EYE_COMFORT_CLASS, prefs.eyeComfortMode)
}

function readHiddenSkillPathsMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(SIDEBAR_HIDDEN_SKILLS_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string[]> = {}
    for (const [projectId, paths] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof projectId !== 'string' || !Array.isArray(paths)) continue
      const list = paths.filter((item): item is string => typeof item === 'string')
      if (list.length > 0) out[projectId] = list
    }
    return out
  } catch {
    return {}
  }
}

function writeHiddenSkillPathsMap(map: Record<string, string[]>): void {
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_SKILLS_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}
