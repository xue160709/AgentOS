/**
 * 中央工作区：聊天页、文档、设置与侧栏抽屉协同。
 * Center pane coordinating Chat/Docs/Settings routes plus auxiliary drawers.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { IconInline } from '../icon-inline'
import { useI18n } from '../i18n/i18n'
import type { AgentContextSlashItem, AgentKnowledgeSearchItem, ChatModelPick, ClaudeAgentStatusSnapshot, ProjectFileSearchItem } from '../claude-chat-types'
import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, OPEN_AGENT_STATUS_EVENT } from '../app-events'
import type {
  TranscriptItem,
  AgentSettingsPanelId,
  AppSearchScope,
  AppViewId,
  ChatState,
  CreateWorkspaceThreadOptions,
  FileTreeNode,
  ProjectSkillRunRequest,
  SettingsCategoryId,
  ThreadRunState,
  WorkspaceProject,
  WorkspaceThread,
  RuntimeDefinition,
  RuntimeSnapshot,
  WorkspaceTab,
} from './types'
import { AgentModeMenu } from './AgentModeMenu'
import { AppAgentStatusPopover } from './AppAgentStatusPopover'
import { AppFileTreePane, type AppFileTreePaneHandle } from './AppFileTreePane'
import { AppSearchModal } from './AppSearchModal'
import { AppWorkspaceSidePanel, type WorkspaceSidePanelTab } from './AppWorkspaceSidePanel'
import { ChatPage, type ChatPageHandle } from './chat/ChatPage'
import { DocsPage } from './DocsPage'
import { ProjectFilePreviewOverlay, type ProjectFilePreviewOverlayState } from './ProjectFilePreviewOverlay'
import { SettingsPage } from './setting/SettingsPage'
import { useWorkspaceAgentMode } from './useWorkspaceAgentMode'
import type { AgentModeSettingsResult, HomePluginRunItem } from '../desktop-types'
import { projectContent } from '../project-content'
import { RuntimeWorkspace } from './RuntimeWorkspace'

/** 右侧辅助抽屉开关与当前标签 / Auxiliary side panel open flag and active tab */
type SidePanelState = {
  open: boolean
  tab: WorkspaceSidePanelTab
}

function withProjectMcpProbeStatus(
  snapshot: ClaudeAgentStatusSnapshot,
  agentModeResult: AgentModeSettingsResult | undefined,
): ClaudeAgentStatusSnapshot {
  if (!agentModeResult?.ok) return snapshot
  const enabledServers = agentModeResult.settings.mcpServers.filter((server) => server.enabled)
  if (enabledServers.length === 0) return snapshot

  const runtimeByName = new Map((snapshot.mcpServers ?? []).map((server) => [server.name, server]))
  const mcpServers = enabledServers.map((server) => {
    const probe = agentModeResult.settings.mcpServerProbeCache[server.name]
    if (probe) {
      return {
        name: server.name,
        status: probe.status,
        error: probe.error,
        toolCount: probe.tools.length,
      }
    }
    const runtimeStatus = runtimeByName.get(server.name)
    if (runtimeStatus?.status === 'connected') return runtimeStatus
    return {
      name: server.name,
      status: 'untested',
      error: runtimeStatus?.error,
      toolCount: runtimeStatus?.toolCount,
    }
  })

  return {
    ...snapshot,
    health: statusHealthWithMcpServers(snapshot, mcpServers),
    mcpServers,
  }
}

function statusHealthWithMcpServers(
  snapshot: ClaudeAgentStatusSnapshot,
  mcpServers: NonNullable<ClaudeAgentStatusSnapshot['mcpServers']>,
): ClaudeAgentStatusSnapshot['health'] {
  if (snapshot.health === 'unconfigured' || snapshot.health === 'running' || snapshot.health === 'error') return snapshot.health
  const hasMcpIssue = mcpServers.some((server) => server.status !== 'connected' && server.status !== 'disabled')
  if (hasMcpIssue) return 'partial'
  return snapshot.sessionId ? 'ready' : 'idle'
}

/** `AppShellWorkspace` 的 props：标题、活动视图、聊天委托与侧栏联动 / Props wiring title, active view, chat callbacks, and drawer prefs */
type AppShellWorkspaceProps = {
  workspaceTitle: string
  headerStatus: string
  activeViewId: AppViewId
  settingsCategory: SettingsCategoryId
  activeProject: WorkspaceProject
  activeThread: WorkspaceThread | undefined
  activeWorkspaceTab?: WorkspaceTab
  activeRuntimeDefinition?: RuntimeDefinition
  activeRuntime?: RuntimeSnapshot | null
  onRetryRuntime?: () => void
  onRestartRuntime?: () => void
  onStopRuntime?: () => void
  onReloadRuntime?: () => void
  onRelocateRuntime?: () => void
  projectDefaultModelPick?: ChatModelPick
  projectHomeModelPick?: ChatModelPick
  threads: WorkspaceThread[]
  projects: WorkspaceProject[]
  projectOrderIds: readonly string[]
  threadRunStates: Record<string, ThreadRunState>
  chatRef: RefObject<ChatPageHandle | null>
  onStatusChange: (text: string) => void
  onNewThread: (projectId?: string, options?: CreateWorkspaceThreadOptions) => string | void
  onForkThread: (projectId: string, items: TranscriptItem[], title: string, model?: string, modelPick?: ChatModelPick) => void
  onCreateProject: (mode: 'scratch' | 'existing') => void | Promise<void>
  onSelectProject: (projectId: string) => void
  onSelectThread: (threadId: string) => void
  onThreadChatStateChange: (threadId: string, update: ChatState | ((prev: ChatState) => ChatState)) => void
  onThreadPromptSubmit: (threadId: string, prompt: string) => void
  onThreadRunStateChange: (threadId: string, state: ThreadRunState | null) => void
  onThreadCompletionStateChange: (threadId: string, completedAt: number | null) => void
  onProjectHomeModelPickChange: (projectId: string, pick: ChatModelPick | undefined) => void
  homeModeResetKey: number
  onCreateHomePluginCardThread: (projectId: string, initialPrompt: string) => string | void
  onEditHomePluginCard: (projectId: string, item: HomePluginRunItem) => void
  hiddenSkillPaths: string[]
  projectSkills: AgentContextSlashItem[]
  onRunProjectSkill: (projectId: string, skill: ProjectSkillRunRequest) => void
  onStopProjectSkillRun: (projectId: string, skillPath: string) => void
  showProjectSkillsInSidebar: boolean
  onShowProjectSkillsInSidebarChange: (enabled: boolean) => void
}

/** Shell 主体渲染路由器 / Shell workspace router mounting routed surfaces */
export function AppShellWorkspace({
  workspaceTitle,
  headerStatus: _headerStatus,
  activeViewId,
  settingsCategory,
  activeProject,
  activeThread,
  activeWorkspaceTab,
  activeRuntimeDefinition,
  activeRuntime,
  onRetryRuntime,
  onRestartRuntime,
  onStopRuntime,
  onReloadRuntime,
  onRelocateRuntime,
  projectDefaultModelPick,
  projectHomeModelPick,
  threads,
  projects,
  projectOrderIds,
  threadRunStates,
  chatRef,
  onStatusChange,
  onNewThread,
  onForkThread,
  onCreateProject,
  onSelectProject,
  onSelectThread,
  onThreadChatStateChange,
  onThreadPromptSubmit,
  onThreadRunStateChange,
  onThreadCompletionStateChange,
  onProjectHomeModelPickChange,
  homeModeResetKey,
  onCreateHomePluginCardThread,
  onEditHomePluginCard,
  hiddenSkillPaths,
  projectSkills,
  onRunProjectSkill,
  onStopProjectSkillRun,
  showProjectSkillsInSidebar,
  onShowProjectSkillsInSidebarChange,
}: AppShellWorkspaceProps) {
  // --- Derived chrome flags (settings hide header; home “surface” vs chat stream) / 派生框架标志（设置页隐藏顶栏；首页表面对话流）---

  const { t } = useI18n()
  const isSettingsChromeHidden = activeViewId === 'settings'
  const [sidePanel, setSidePanel] = useState<SidePanelState>(() => ({ open: false, tab: 'files' }))
  const [filePreview, setFilePreview] = useState<ProjectFilePreviewOverlayState | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchScope, setSearchScope] = useState<AppSearchScope>('all')
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  const [agentSettingsPanel, setAgentSettingsPanel] = useState<AgentSettingsPanelId>('project')
  const [agentStatusOpen, setAgentStatusOpen] = useState(false)
  const [agentStatusLoading, setAgentStatusLoading] = useState(false)
  const [agentStatusSnapshot, setAgentStatusSnapshot] = useState<ClaudeAgentStatusSnapshot | null>(null)
  const [localAppLogsOpen, setLocalAppLogsOpen] = useState(false)
  const filePaneRef = useRef<AppFileTreePaneHandle>(null)
  const filePreviewRequestRef = useRef(0)
  const agentStatusRequestSeqRef = useRef(0)
  const autoContextRefreshKeysRef = useRef<Set<string>>(new Set())
  const agentMode = useWorkspaceAgentMode(activeProject)
  const activeThreadRunning = Boolean(activeThread && threadRunStates[activeThread.id])
  const agentStatusRequest = useMemo(
    () => ({
      threadId: activeThread?.id,
      sessionId: activeThread?.chatState.sessionId,
      modelPick: activeThread?.chatState.modelPick ?? projectHomeModelPick ?? projectDefaultModelPick,
      cwd: activeProject.path,
    }),
    [activeProject.path, activeThread?.chatState.modelPick, activeThread?.chatState.sessionId, activeThread?.id, projectDefaultModelPick, projectHomeModelPick],
  )

  /** 与 ChatPage.showThreadView 一致：有消息或插件定制线程时视为对话流，否则为项目首页 / Mirrors ChatPage.showThreadView */
  const chatItems = activeThread?.chatState.items ?? []
  const hasThreadMessages = chatItems.length > 0
  const showConversationFlow =
    hasThreadMessages ||
    activeThread?.purpose === 'home-plugin-customization' ||
    activeThread?.purpose === 'home-plugin-card-customization' ||
    activeThread?.purpose === 'task-run' ||
    activeThread?.purpose === 'skill-run'
  const showAgentModeToolbar = activeViewId === 'home' && !showConversationFlow
  const showAgentStatusToolbar = activeViewId !== 'home' || showConversationFlow
  const isRuntimeActive = Boolean(activeWorkspaceTab && activeRuntimeDefinition && activeViewId === 'home')

  useEffect(() => {
    setLocalAppLogsOpen(false)
  }, [activeWorkspaceTab?.id, activeRuntime?.generation])

  // --- Close auxiliary drawer when navigating into settings / 进入设置路由时收起辅助抽屉 ---

  useEffect(() => {
    if (activeViewId === 'settings') {
      setSidePanel((prev) => ({ ...prev, open: false }))
      setAgentStatusOpen(false)
    }
  }, [activeViewId])

  useEffect(() => {
    if (!showAgentStatusToolbar && agentStatusOpen) setAgentStatusOpen(false)
  }, [agentStatusOpen, showAgentStatusToolbar])

  useEffect(() => {
    filePreviewRequestRef.current += 1
    setFilePreview(null)
  }, [activeProject.path])

  useEffect(() => {
    if (activeViewId !== 'home') {
      filePreviewRequestRef.current += 1
      setFilePreview(null)
    }
  }, [activeViewId])

  // --- Side panel: single-tab toggle (second click closes) / 侧栏：单标签切换（再点同按钮则关闭）---

  const toggleSidePanelTab = useCallback((tab: WorkspaceSidePanelTab) => {
    setSidePanel((prev) => {
      if (prev.open && prev.tab === tab) {
        return { ...prev, open: false }
      }
      return { open: true, tab }
    })
  }, [])

  const openSearch = useCallback((scope: AppSearchScope) => {
    setSearchScope(scope)
    setSearchOpen(true)
  }, [])

  const openAgentSettings = useCallback((panel: AgentSettingsPanelId, options?: { showProjectHome?: boolean }) => {
    if (activeViewId !== 'home') {
      window.location.hash = ''
    }
    if (options?.showProjectHome) {
      onSelectProject(activeProject.id)
    }
    setAgentSettingsPanel(panel)
    setAgentSettingsOpen(true)
  }, [activeProject.id, activeViewId, onSelectProject])

  const refreshAgentStatus = useCallback(async (refresh = false) => {
    const getStatus = window.claudeChat?.getStatus
    if (!getStatus) {
      setAgentStatusSnapshot(null)
      return
    }
    const requestSeq = agentStatusRequestSeqRef.current + 1
    agentStatusRequestSeqRef.current = requestSeq
    setAgentStatusLoading(true)
    try {
      const [snapshot, agentModeResult] = await Promise.all([
        getStatus({ ...agentStatusRequest, refresh }),
        window.desktop?.getAgentModeSettings?.(activeProject.path).catch(() => undefined),
      ])
      if (agentStatusRequestSeqRef.current === requestSeq) {
        setAgentStatusSnapshot(withProjectMcpProbeStatus(snapshot, agentModeResult))
      }
    } catch {
      if (agentStatusRequestSeqRef.current === requestSeq) setAgentStatusSnapshot(null)
    } finally {
      if (agentStatusRequestSeqRef.current === requestSeq) setAgentStatusLoading(false)
    }
  }, [activeProject.path, agentStatusRequest])

  useEffect(() => {
    void refreshAgentStatus(false)
  }, [activeThreadRunning, refreshAgentStatus])

  useEffect(() => {
    const threadId = activeThread?.id
    const sessionId = activeThread?.chatState.sessionId?.trim()
    if (activeViewId !== 'home' || !threadId || !sessionId || activeThreadRunning) return
    if (
      agentStatusSnapshot?.threadId === threadId &&
      agentStatusSnapshot.sessionId === sessionId &&
      agentStatusSnapshot.contextUsage
    ) {
      return
    }

    const refreshKey = `${activeProject.path}:${threadId}:${sessionId}`
    if (autoContextRefreshKeysRef.current.has(refreshKey)) return
    autoContextRefreshKeysRef.current.add(refreshKey)
    void refreshAgentStatus(true)
  }, [
    activeProject.path,
    activeThread?.chatState.sessionId,
    activeThread?.id,
    activeThreadRunning,
    activeViewId,
    agentStatusSnapshot?.contextUsage,
    agentStatusSnapshot?.sessionId,
    agentStatusSnapshot?.threadId,
    refreshAgentStatus,
  ])

  useEffect(() => {
    const openStatus = (event: Event) => {
      setAgentStatusOpen(true)
      if ((event as CustomEvent<{ refresh?: boolean }>).detail?.refresh) {
        void refreshAgentStatus(true)
      }
    }
    window.addEventListener(OPEN_AGENT_STATUS_EVENT, openStatus)
    return () => window.removeEventListener(OPEN_AGENT_STATUS_EVENT, openStatus)
  }, [refreshAgentStatus])

  useEffect(() => {
    if (!agentStatusOpen) return
    const refresh = () => void refreshAgentStatus(false)
    const unsubscribe = window.claudeChat?.onEvent((event) => {
      if (
        event.type === 'session_start' ||
        event.type === 'result' ||
        event.type === 'error' ||
        event.type === 'cancelled'
      ) {
        refresh()
      }
    })
    window.addEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, refresh)
    return () => {
      unsubscribe?.()
      window.removeEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, refresh)
    }
  }, [agentStatusOpen, refreshAgentStatus])

  useEffect(() => {
    const onOpenSearch = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: AppSearchScope }>).detail?.scope
      openSearch(scope === 'files' || scope === 'chats' || scope === 'messages' || scope === 'memory' || scope === 'skills' || scope === 'tasks' ? scope : 'all')
    }
    window.addEventListener('agentos:open-search', onOpenSearch)
    return () => window.removeEventListener('agentos:open-search', onOpenSearch)
  }, [openSearch])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      const scope: AppSearchScope | null = key === 'k' ? 'all' : key === 'p' ? 'files' : key === 'g' ? 'chats' : null
      if (!scope) return
      event.preventDefault()
      event.stopPropagation()
      openSearch(scope)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [openSearch])

  const openProjectFilePreview = useCallback(
    async (node: FileTreeNode) => {
      const requestId = filePreviewRequestRef.current + 1
      filePreviewRequestRef.current = requestId
      setFilePreview({
        status: 'loading',
        path: node.path,
        relativePath: node.relativePath,
        name: node.name,
      })

      try {
        const result = await projectContent.preview(activeProject.path, node.path)
        if (filePreviewRequestRef.current !== requestId) return
        if (!result) {
          setFilePreview({
            status: 'error',
            path: node.path,
            relativePath: node.relativePath,
            name: node.name,
            message: t('filePanel.previewUnsupported'),
          })
          return
        }
        if (result.ok) {
          setFilePreview({ status: 'ready', file: result })
          return
        }
        setFilePreview({
          status: 'error',
          path: result.path || node.path,
          relativePath: result.relativePath || node.relativePath,
          name: result.name || node.name,
          message: result.message,
        })
      } catch (error) {
        if (filePreviewRequestRef.current !== requestId) return
        setFilePreview({
          status: 'error',
          path: node.path,
          relativePath: node.relativePath,
          name: node.name,
          message: error instanceof Error ? error.message : t('filePanel.previewUnavailable'),
        })
      }
    },
    [activeProject.path, t],
  )

  const openSearchFileResult = useCallback(
    (item: ProjectFileSearchItem) => {
      if (item.type === 'directory') {
        setSidePanel({ open: true, tab: 'files' })
        return
      }
      void openProjectFilePreview({
        name: item.label,
        path: item.path,
        relativePath: item.relativePath,
        type: item.type,
      })
    },
    [openProjectFilePreview],
  )

  const openSearchMessageResult = useCallback(
    (threadId: string, itemId?: string) => {
      onSelectThread(threadId)
      if (!itemId) return

      let attempts = 0
      const reveal = () => {
        attempts += 1
        const found = chatRef.current?.revealMessage(itemId) ?? false
        if (!found && attempts < 8) requestAnimationFrame(reveal)
      }
      requestAnimationFrame(reveal)
    },
    [chatRef, onSelectThread],
  )

  const askAboutKnowledgeResult = useCallback(
    (item: AgentKnowledgeSearchItem) => {
      const prompt = [
        t('search.askPromptIntro', { title: item.title }),
        item.relativePath ? t('search.askPromptPath', { path: item.relativePath }) : '',
        item.snippet ? t('search.askPromptSnippet', { snippet: item.snippet }) : '',
      ]
        .filter(Boolean)
        .join('\n')
      void chatRef.current?.submitPromptInNewThread(item.projectId, prompt)
    },
    [chatRef, t],
  )

  const insertKnowledgeContext = useCallback(
    (item: AgentKnowledgeSearchItem) => {
      const contextText = [
        item.relativePath ? `@${item.relativePath}` : item.title,
        item.snippet ? item.snippet : '',
      ]
        .filter(Boolean)
        .join('\n')
      chatRef.current?.insertComposerText(contextText)
    },
    [chatRef],
  )

  const folderToolbarActive = sidePanel.open && sidePanel.tab === 'files'
  const activePreviewPath = filePreview?.status === 'ready' ? filePreview.file.path : filePreview?.path ?? null

  // --- Layout: title bar (hidden in settings), routed `<main>`, right drawer / 布局：标题栏（设置页隐藏）、路由主区、右侧抽屉 ---

  return (
    <div className="app-workspace">
      {isSettingsChromeHidden ? (
        <div className="app-workspace-top-drag draggable" aria-hidden />
      ) : (
        <header className="app-workspace-header" role="banner">
          <span className={`app-workspace-title no-drag${isRuntimeActive ? ' local-app-runtime-title' : ''}`} id="workspace-title" title={workspaceTitle}>
            {workspaceTitle}
          </span>
          <div className="app-workspace-drag-gap draggable" aria-hidden="true" />
          <div className={`app-workspace-actions no-drag${isRuntimeActive ? ' local-app-runtime-actions' : ''}`}>
            {!isRuntimeActive && showAgentModeToolbar ? <AgentModeMenu agent={agentMode} onOpenSettings={() => openAgentSettings('project')} /> : null}
            {!isRuntimeActive && showAgentStatusToolbar ? (
              <AppAgentStatusPopover
                open={agentStatusOpen}
                loading={agentStatusLoading}
                running={activeThreadRunning}
                snapshot={agentStatusSnapshot}
                onOpenChange={setAgentStatusOpen}
                onRefresh={() => void refreshAgentStatus(true)}
                onOpenMcpSettings={() => {
                  setAgentStatusOpen(false)
                  openAgentSettings('mcp', { showProjectHome: true })
                }}
              />
            ) : null}
            {isRuntimeActive ? <>
              <span
                className="local-app-runtime-compact-status"
                data-testid="runtime-status"
                role="status"
                title={runtimeWorkspaceStatusLabel(t, activeRuntime?.status ?? 'stopped')}
              >
                {runtimeWorkspaceStatusLabel(t, activeRuntime?.status ?? 'stopped')}
              </span>
              <button
                type="button"
                className="btn btn-toolbar local-app-runtime-action"
                data-testid="runtime-refresh"
                onClick={onReloadRuntime}
                disabled={!activeRuntime?.readyUrl}
                aria-label={t('runtime.refresh')}
                title={t('runtime.refresh')}
              >
                <IconInline name="refresh" />
                <span className="local-app-runtime-action__label">{t('runtime.refresh')}</span>
              </button>
              <button
                type="button"
                className="btn btn-toolbar local-app-runtime-action"
                data-testid="runtime-logs"
                onClick={() => setLocalAppLogsOpen((open) => !open)}
                aria-label={t('runtime.logs')}
                title={t('runtime.logs')}
                aria-expanded={localAppLogsOpen}
              >
                <IconInline name="checklist" />
                <span className="local-app-runtime-action__label">{t('runtime.logs')}</span>
              </button>
              <button
                type="button"
                className="btn btn-toolbar local-app-runtime-action"
                data-testid="runtime-restart"
                onClick={onRestartRuntime}
                disabled={!onRestartRuntime || !['running', 'degraded', 'failed', 'stopped'].includes(activeRuntime?.status ?? 'stopped')}
                aria-label={t('runtime.restart')}
                title={t('runtime.restart')}
              >
                <IconInline name="undo" />
                <span className="local-app-runtime-action__label">{t('runtime.restart')}</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost local-app-runtime-action"
                data-testid="runtime-stop"
                onClick={onStopRuntime}
                disabled={!onStopRuntime || !['preparing', 'starting', 'running', 'degraded'].includes(activeRuntime?.status ?? 'stopped')}
                aria-label={t('runtime.stop')}
                title={t('runtime.stop')}
              >
                <IconInline name="stop" />
                <span className="local-app-runtime-action__label">{t('runtime.stop')}</span>
              </button>
            </> : null}
            {!isRuntimeActive ? <button
              type="button"
              className={`btn btn-toolbar${folderToolbarActive ? ' is-active' : ''}`}
              id="btn-toggle-file-panel"
              title={t('workspace.fileTree')}
              aria-label={t('workspace.toggleFilePanel')}
              aria-controls="app-file-panel"
              aria-expanded={folderToolbarActive}
              onClick={() => toggleSidePanelTab('files')}
            >
              <IconInline name="folder" />
            </button> : null}
          </div>
        </header>
      )}
      <div className="app-workspace-content">
        <main className="app-main" role="main">
          {/* 三视图互斥：`hidden` 保留挂载以维持 Chat 内存态 / Mutually exclusive routes; `hidden` keeps Chat mounted */}
          {isRuntimeActive && activeWorkspaceTab && activeRuntimeDefinition ? <RuntimeWorkspace
            tab={activeWorkspaceTab}
            definition={activeRuntimeDefinition}
            runtime={activeRuntime ?? null}
            onRetry={onRetryRuntime ?? (() => undefined)}
            onRestart={onRestartRuntime ?? (() => undefined)}
            onStop={onStopRuntime ?? (() => undefined)}
            onReload={onReloadRuntime ?? (() => undefined)}
            onRelocate={onRelocateRuntime ?? (() => undefined)}
            logsOpen={localAppLogsOpen}
            onLogsToggle={() => setLocalAppLogsOpen((open) => !open)}
            showToolbar={false}
          /> : <ChatPage
            ref={chatRef}
            hidden={activeViewId !== 'home'}
            activeProject={activeProject}
            activeThread={activeThread}
            projectDefaultModelPick={projectDefaultModelPick}
            projectHomeModelPick={projectHomeModelPick}
            agentStatusSnapshot={agentStatusSnapshot}
            threads={threads}
            projects={projects}
            projectOrderIds={projectOrderIds}
            threadRunStates={threadRunStates}
            onStatusChange={onStatusChange}
            onNewThread={onNewThread}
            onForkThread={onForkThread}
            onCreateProject={onCreateProject}
            onSelectProject={onSelectProject}
            onThreadChatStateChange={onThreadChatStateChange}
            onThreadPromptSubmit={onThreadPromptSubmit}
            onThreadRunStateChange={onThreadRunStateChange}
            onThreadCompletionStateChange={onThreadCompletionStateChange}
            onProjectHomeModelPickChange={onProjectHomeModelPickChange}
            onRefreshAgentStatus={refreshAgentStatus}
            agentMode={agentMode}
            agentModeEnabled={agentMode.enabled}
            todoEnabled={agentMode.todoEnabled}
            agentModeLoading={agentMode.loading}
            agentSettingsOpen={agentSettingsOpen}
            agentSettingsPanel={agentSettingsPanel}
            onOpenAgentSettings={openAgentSettings}
            onAgentSettingsPanelChange={setAgentSettingsPanel}
            onCloseAgentSettings={() => setAgentSettingsOpen(false)}
            homeModeResetKey={homeModeResetKey}
            hiddenSkillPaths={hiddenSkillPaths}
            onCreateHomePluginCardThread={onCreateHomePluginCardThread}
            onEditHomePluginCard={onEditHomePluginCard}
            onOpenProjectFile={openProjectFilePreview}
            onRunProjectSkill={onRunProjectSkill}
            onStopProjectSkillRun={onStopProjectSkillRun}
          />}
          {!isRuntimeActive ? <DocsPage hidden={activeViewId !== 'docs'} /> : null}
          {!isRuntimeActive ? <SettingsPage
            hidden={activeViewId !== 'settings'}
            settingsCategory={settingsCategory}
            activeProject={activeProject}
            showProjectSkillsInSidebar={showProjectSkillsInSidebar}
            onShowProjectSkillsInSidebarChange={onShowProjectSkillsInSidebarChange}
            onOpenAgentSettings={openAgentSettings}
          /> : null}
          {filePreview ? (
            <ProjectFilePreviewOverlay preview={filePreview} onClose={() => setFilePreview(null)} />
          ) : null}
        </main>
        <AppWorkspaceSidePanel
          open={sidePanel.open}
          activeTab={sidePanel.tab}
          onActiveTabChange={(tab) => setSidePanel((prev) => ({ ...prev, open: true, tab }))}
          onClose={() => setSidePanel((prev) => ({ ...prev, open: false }))}
          filePaneRef={filePaneRef}
          filesPane={
            <AppFileTreePane
              ref={filePaneRef}
              project={activeProject}
              isVisible={sidePanel.open && sidePanel.tab === 'files'}
              activeFilePath={activePreviewPath}
              onOpenFile={openProjectFilePreview}
            />
          }
        />
      </div>
      {searchOpen ? (
        <AppSearchModal
          activeProject={activeProject}
          projects={projects}
          threads={threads}
          projectSkills={projectSkills}
          threadRunStates={threadRunStates}
          initialScope={searchScope}
          onClose={() => setSearchOpen(false)}
          onOpenFile={openSearchFileResult}
          onRunProjectSkill={onRunProjectSkill}
          onAskKnowledge={askAboutKnowledgeResult}
          onInsertKnowledgeContext={insertKnowledgeContext}
          onSelectMessage={openSearchMessageResult}
          onSelectThread={onSelectThread}
        />
      ) : null}
    </div>
  )
}

function runtimeWorkspaceStatusLabel(
  t: (path: string) => string,
  status: RuntimeSnapshot['status'],
): string {
  return t(({
    preparing: 'runtime.runtimePreparing',
    starting: 'runtime.runtimeStarting',
    running: 'runtime.runtimeRunning',
    degraded: 'runtime.runtimeDegraded',
    failed: 'runtime.runtimeFailed',
    path_missing: 'runtime.runtimePathMissing',
    stopped: 'runtime.runtimeStopped',
  } as const)[status])
}
