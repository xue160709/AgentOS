import {
  useActionExecutor,
  useInteractionApi,
  type InteractionSubmitResult,
} from '@xue160709/omni-ui-react'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'

import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, OPEN_AGENT_STATUS_EVENT } from '../app-events'
import type { AppSearchScope, AppViewId, ProjectSkillRunRequest, SettingsCategoryId, WorkspaceProject, WorkspaceThread } from '../components/types'
import type { ChatPageHandle } from '../components/chat/ChatPage'
import type { AgentMcpServerConfig, VoiceCommandResponseRequest } from '../desktop-types'
import type { ClaudeAgentSettingsSnapshot } from '../claude-chat-types'
import { useI18n } from '../i18n/i18n'
import {
  agentStatusOpenAction,
  appNavigateAction,
  composerSendAction,
  composerSetTextAction,
  mcpToggleAction,
  modelSwitchAction,
  projectPinAction,
  projectSwitchAction,
  settingsDescribeAction,
  searchOpenAction,
  settingsOpenAction,
  sidebarSetAction,
  sidePanelOpenAction,
  skillRunAction,
  systemOpenAppAction,
  systemOpenUrlAction,
  taskCardRefreshAction,
  threadArchiveAction,
  threadNewAction,
  threadPinAction,
  threadSwitchAction,
  type AppNavigateParams,
  type McpToggleParams,
  type ModelSwitchParams,
  type ProjectPinParams,
  type SkillRunParams,
  type ThreadPinParams,
} from './actions'
import { describeSettingsSnapshot, type TranslateFn } from './settings-describe'
import { executionMessage, mapSubmitResult } from './voice-result'

type AgentOsMultimodalRuntimeProps = {
  activeViewId: AppViewId
  settingsCategory: SettingsCategoryId
  sidebarCollapsed: boolean
  activeProject: WorkspaceProject
  activeThread: WorkspaceThread | undefined
  projects: WorkspaceProject[]
  threads: WorkspaceThread[]
  projectSkills: ProjectSkillRunRequest[]
  chatRef: RefObject<ChatPageHandle | null>
  onNavigateView: (view: Exclude<AppViewId, 'settings'>) => void
  onSelectProject: (projectId: string) => void
  onSelectThread: (threadId: string) => void
  onToggleProjectPinned: (projectId: string) => void
  onToggleThreadPinned: (threadId: string) => void
  onRunProjectSkill: (projectId: string, skill: ProjectSkillRunRequest) => void
  onNewThread: (projectId?: string) => string | void
  onOpenSettingsCategory: (category: SettingsCategoryId) => void
  onSetSidebarCollapsed: (collapsed: boolean) => void
  onArchiveThread: (threadId: string) => void | Promise<void>
}

export function AgentOsMultimodalRuntime({
  activeViewId,
  settingsCategory,
  sidebarCollapsed,
  activeProject,
  activeThread,
  projects,
  threads,
  projectSkills,
  chatRef,
  onNavigateView,
  onSelectProject,
  onSelectThread,
  onToggleProjectPinned,
  onToggleThreadPinned,
  onRunProjectSkill,
  onNewThread,
  onOpenSettingsCategory,
  onSetSidebarCollapsed,
  onArchiveThread,
}: AgentOsMultimodalRuntimeProps) {
  const { t } = useI18n()
  const api = useInteractionApi()
  const pendingConfirmationRef = useRef<{ requestId: string; turnId: string } | null>(null)
  const pendingClarificationRef = useRef<{ requestId: string } | null>(null)

  const projectIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects])
  const threadIds = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads])

  useActionExecutor(appNavigateAction, ({ view }) => {
    const nextView = normalizeAppView(view)
    const message = t('multimodal.openedView', { view: appViewLabel(t, nextView) })
    onNavigateView(nextView)
    return { status: activeViewId === nextView ? 'unchanged' : 'changed', reason: message, message }
  })

  useActionExecutor(projectSwitchAction, ({ projectId }, context) => {
    const targetProjectId = projectId || context.target.entity?.id
    if (!targetProjectId || !projectIds.has(targetProjectId)) {
      return { status: 'rejected', reason: t('multimodal.projectNotFound'), code: 'project_not_found' }
    }
    onSelectProject(targetProjectId)
    const project = projects.find((item) => item.id === targetProjectId)
    return { status: 'changed', message: t('multimodal.projectOpened', { name: project?.name ?? t('multimodal.targetProject') }) }
  })

  useActionExecutor(projectPinAction, (params, context) => {
    const targetProjectId = resolveProjectTarget(params, context.target.entity?.id, activeProject.id)
    const project = projects.find((item) => item.id === targetProjectId)
    if (!project) return { status: 'rejected', reason: t('multimodal.projectNotFound'), code: 'project_not_found' }
    const alreadyPinned = Boolean(project.pinnedAt)
    const message = t(params.pinned ? 'multimodal.projectPinned' : 'multimodal.projectUnpinned', { name: project.name })
    if (alreadyPinned === params.pinned) return { status: 'unchanged', reason: message }
    onToggleProjectPinned(project.id)
    return { status: 'changed', message }
  })

  useActionExecutor(threadSwitchAction, ({ threadId }, context) => {
    const targetThreadId = threadId || context.target.entity?.id
    if (!targetThreadId || !threadIds.has(targetThreadId)) {
      return { status: 'rejected', reason: t('multimodal.threadNotFound'), code: 'thread_not_found' }
    }
    onSelectThread(targetThreadId)
    const thread = threads.find((item) => item.id === targetThreadId)
    const message = t('multimodal.threadOpened', { title: thread?.title ?? t('multimodal.targetThread') })
    return { status: activeThread?.id === targetThreadId ? 'unchanged' : 'changed', reason: message, message }
  })

  useActionExecutor(threadPinAction, (params, context) => {
    const targetThreadId = resolveThreadTarget(params, context.target.entity?.id, activeThread?.id)
    const thread = threads.find((item) => item.id === targetThreadId)
    if (!thread) return { status: 'rejected', reason: t('multimodal.threadNotFound'), code: 'thread_not_found' }
    const alreadyPinned = Boolean(thread.pinnedAt)
    const message = t(params.pinned ? 'multimodal.threadPinned' : 'multimodal.threadUnpinned', { title: thread.title })
    if (alreadyPinned === params.pinned) return { status: 'unchanged', reason: message }
    onToggleThreadPinned(thread.id)
    return { status: 'changed', message }
  })

  useActionExecutor(threadNewAction, () => {
    const threadId = onNewThread(activeProject.id)
    return threadId
      ? { status: 'changed', message: t('multimodal.threadCreated'), data: { threadId } }
      : { status: 'failed', reason: t('multimodal.threadCreateFailed'), error: new Error('thread.new failed') }
  })

  useActionExecutor(settingsOpenAction, ({ category }) => {
    const nextCategory = normalizeSettingsCategory(category)
    onOpenSettingsCategory(nextCategory)
    return { status: 'changed', message: t('multimodal.settingsOpened', { category: settingsCategoryLabel(t, nextCategory) }) }
  })

  useActionExecutor(settingsDescribeAction, (params) => describeSettingsSnapshot(api.getSnapshot(), activeViewId, settingsCategory, params, t))

  useActionExecutor(searchOpenAction, ({ scope }) => {
    const nextScope = normalizeSearchScope(scope)
    window.dispatchEvent(new CustomEvent('agentos:open-search', { detail: { scope: nextScope } }))
    return { status: 'changed', message: t('multimodal.searchOpened', { scope: searchScopeLabel(t, nextScope) }) }
  })

  useActionExecutor(sidebarSetAction, ({ collapsed }) => {
    if (sidebarCollapsed !== collapsed) onSetSidebarCollapsed(collapsed)
    const message = t(collapsed ? 'multimodal.sidebarCollapsed' : 'multimodal.sidebarExpanded')
    return sidebarCollapsed === collapsed
      ? { status: 'unchanged', reason: message }
      : { status: 'changed', message }
  })

  useActionExecutor(sidePanelOpenAction, ({ panel, open }) => {
    const nextPanel = panel === 'files' ? 'files' : 'files'
    window.dispatchEvent(new CustomEvent('agentos:open-side-panel', { detail: { panel: nextPanel, open: open !== false } }))
    return { status: 'changed', message: t(open === false ? 'multimodal.filePanelClosed' : 'multimodal.filePanelOpened') }
  })

  useActionExecutor(agentStatusOpenAction, ({ refresh }) => {
    window.dispatchEvent(new CustomEvent(OPEN_AGENT_STATUS_EVENT, { detail: { refresh: refresh === true } }))
    return { status: 'changed', message: t(refresh ? 'multimodal.agentStatusRefreshed' : 'multimodal.agentStatusOpened') }
  })

  useActionExecutor(composerSetTextAction, ({ text }) => {
    chatRef.current?.setComposerText(text)
    return { status: 'changed', message: t('multimodal.composerTextSet') }
  })

  useActionExecutor(composerSendAction, async ({ text }) => {
    if (text) chatRef.current?.setComposerText(text)
    const submitted = await chatRef.current?.submitComposerDraft()
    return submitted
      ? { status: 'changed', message: t('multimodal.composerSent') }
      : { status: 'rejected', reason: t('multimodal.composerEmpty'), code: 'composer_empty' }
  })

  useActionExecutor(taskCardRefreshAction, ({ taskCardId }, context) => {
    window.dispatchEvent(new CustomEvent('project-home:refresh'))
    const cardLabel = context.target.role === 'page' ? '' : context.target.label || taskCardId || ''
    return { status: 'changed', message: cardLabel ? t('multimodal.taskCardRefreshedNamed', { label: cardLabel }) : t('multimodal.taskCardsRefreshed') }
  })

  useActionExecutor(skillRunAction, ({ skillName }) => {
    const skill = findProjectSkill(projectSkills, { skillName })
    if (!skill) return { status: 'rejected', reason: t('multimodal.skillNotFound', { name: skillName }), code: 'skill_not_found' }
    onRunProjectSkill(activeProject.id, skill)
    return { status: 'changed', message: t('multimodal.skillRun', { title: skill.title }) }
  })

  useActionExecutor(systemOpenAppAction, async ({ appName }) => {
    const result = await window.desktop?.openApp?.(appName)
    if (!result) return { status: 'unsupported', reason: t('multimodal.openAppUnsupported') }
    return result.ok
      ? { status: 'changed', message: result.message }
      : { status: 'rejected', reason: result.message, code: 'app_not_found' }
  })

  useActionExecutor(systemOpenUrlAction, async ({ url }) => {
    const target = normalizeExternalUrl(url, t)
    if (!target) return { status: 'rejected', reason: t('multimodal.invalidUrl', { url }), code: 'invalid_url' }
    if (!window.desktop?.openExternal) return { status: 'unsupported', reason: t('multimodal.openUrlUnsupported') }
    try {
      await window.desktop.openExternal(target.href)
      return { status: 'changed', message: t('multimodal.urlOpened', { label: target.label }) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'failed', reason: t('multimodal.urlOpenFailed', { message }), error: new Error(message) }
    }
  })

  useActionExecutor(modelSwitchAction, async (params) => switchActiveModel(params, t))

  useActionExecutor(mcpToggleAction, async (params) => toggleProjectMcp(activeProject, params, t))

  useActionExecutor(threadArchiveAction, async ({ threadId }) => {
    const targetThreadId = threadId || activeThread?.id
    if (!targetThreadId || !threadIds.has(targetThreadId)) {
      return { status: 'rejected', reason: t('multimodal.archiveThreadNotFound'), code: 'thread_not_found' }
    }
    await onArchiveThread(targetThreadId)
    return { status: 'changed', message: t('multimodal.threadArchived') }
  })

  const clearPendingForRequest = useCallback((requestId: string) => {
    if (pendingConfirmationRef.current?.requestId === requestId) pendingConfirmationRef.current = null
    if (pendingClarificationRef.current?.requestId === requestId) pendingClarificationRef.current = null
  }, [])

  const deliverVoiceResult = useCallback(
    async (requestId: string, result: InteractionSubmitResult) => {
      const mapped = mapSubmitResult(result, api.getSnapshot(), t)
      if (result.pendingCommand) {
        pendingConfirmationRef.current = { requestId, turnId: result.pendingCommand.turnId }
        pendingClarificationRef.current = null
      } else if (mapped.status === 'needs_clarification') {
        pendingClarificationRef.current = { requestId }
        pendingConfirmationRef.current = null
      } else {
        clearPendingForRequest(requestId)
      }
      await window.desktop?.sendVoiceCommandResult?.({ id: requestId, ...mapped })
    },
    [api, clearPendingForRequest, t],
  )

  const submitCommand = useCallback(
    async (text: string, voiceRequestId?: string) => {
      const normalized = text.trim()
      if (!normalized) return
      if (voiceRequestId) clearPendingForRequest(voiceRequestId)
      try {
        const result = await api.submitUtterance(normalized)
        if (voiceRequestId) {
          await deliverVoiceResult(voiceRequestId, result)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (voiceRequestId) {
          clearPendingForRequest(voiceRequestId)
          await window.desktop?.sendVoiceCommandResult?.({ id: voiceRequestId, status: 'failed', message })
        }
      }
    },
    [api, clearPendingForRequest, deliverVoiceResult],
  )

  useEffect(() => {
    const unsubscribe = window.desktop?.onVoiceCommandRequest?.((event) => {
      void submitCommand(event.utterance, event.id)
    })
    return () => unsubscribe?.()
  }, [submitCommand])

  const handleVoiceCommandResponse = useCallback(
    async (event: VoiceCommandResponseRequest) => {
      if (event.action === 'confirm' || event.action === 'cancel') {
        const pending = pendingConfirmationRef.current
        if (!pending || pending.requestId !== event.id) {
          await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: t('multimodal.noPendingConfirmation') })
          return
        }
        pendingConfirmationRef.current = null
        if (event.action === 'cancel') {
          api.cancelTurn(pending.turnId, 'User cancelled AgentOS command confirmation from voice window.')
          await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: t('multimodal.cancelled') })
          return
        }
        const result = await api.confirmTurn(pending.turnId)
        await window.desktop?.sendVoiceCommandResult?.({
          id: event.id,
          status: result.ok ? 'success' : 'failed',
          message: executionMessage(result.execution) ?? result.error?.message ?? t('multimodal.confirmationFailed'),
        })
        return
      }

      const pending = pendingClarificationRef.current
      if (!pending || pending.requestId !== event.id || !event.candidateId) {
        await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: t('multimodal.noCandidate') })
        return
      }
      const lastResolution = api.lastResolution
      if (!lastResolution) {
        await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: t('multimodal.candidateExpired') })
        return
      }
      pendingClarificationRef.current = null
      const result = await api.dispatchResolution({
        ...lastResolution,
        status: 'resolved',
        targetId: event.candidateId,
        confidence: Math.max(lastResolution.confidence, 0.8),
      })
      await deliverVoiceResult(event.id, result)
    },
    [api, deliverVoiceResult, t],
  )

  useEffect(() => {
    const unsubscribe = window.desktop?.onVoiceCommandResponse?.((event) => {
      void handleVoiceCommandResponse(event)
    })
    return () => unsubscribe?.()
  }, [handleVoiceCommandResponse])

  return null
}

function normalizeSettingsCategory(value: string | undefined): SettingsCategoryId {
  if (
    value === 'general' ||
    value === 'search' ||
    value === 'mcp' ||
    value === 'skills' ||
    value === 'updates' ||
    value === 'agent' ||
    value === 'developer'
  ) {
    return value
  }
  return 'general'
}

function normalizeAppView(value: AppNavigateParams['view'] | undefined): Exclude<AppViewId, 'settings'> {
  return value === 'docs' ? 'docs' : 'home'
}

function normalizeSearchScope(value: string | undefined): AppSearchScope {
  if (
    value === 'chats' ||
    value === 'files' ||
    value === 'memory' ||
    value === 'messages' ||
    value === 'skills' ||
    value === 'tasks'
  ) {
    return value
  }
  return 'all'
}

function appViewLabel(t: TranslateFn, view: Exclude<AppViewId, 'settings'>): string {
  return t(view === 'docs' ? 'multimodal.view.docs' : 'multimodal.view.home')
}

function settingsCategoryLabel(t: TranslateFn, category: SettingsCategoryId): string {
  return t(`multimodal.settingsCategory.${category}`)
}

function searchScopeLabel(t: TranslateFn, scope: AppSearchScope): string {
  return t(`multimodal.searchScope.${scope}`)
}

function findProjectSkill(
  projectSkills: ProjectSkillRunRequest[],
  { skillName }: SkillRunParams,
): ProjectSkillRunRequest | undefined {
  const normalizedQuery = normalizeSkillLookup(skillName)
  if (!normalizedQuery) return undefined
  return projectSkills.find((skill) => {
    const labels = [skill.title, skill.command, skill.relativePath, skill.path, skill.description]
    return labels.some((label) => {
      const normalizedLabel = normalizeSkillLookup(label)
      if (!normalizedLabel) return false
      return normalizedLabel === normalizedQuery || normalizedLabel.includes(normalizedQuery) || normalizedQuery.includes(normalizedLabel)
    })
  })
}

function resolveProjectTarget(params: ProjectPinParams, targetEntityId: string | undefined, activeProjectId: string): string {
  return params.projectId || targetEntityId || activeProjectId
}

function resolveThreadTarget(params: ThreadPinParams, targetEntityId: string | undefined, activeThreadId: string | undefined): string | undefined {
  return params.threadId || targetEntityId || activeThreadId
}

async function switchActiveModel({ modelName }: ModelSwitchParams, t: TranslateFn) {
  if (!window.claudeChat?.getSettings || !window.claudeChat.setActiveChatPick) {
    return { status: 'unsupported' as const, reason: t('multimodal.modelBridgeUnavailable') }
  }
  const snapshot = await window.claudeChat.getSettings()
  const match = findModelPick(snapshot, modelName)
  if (!match) return { status: 'rejected' as const, reason: t('multimodal.modelNotFound', { name: modelName }), code: 'model_not_found' }
  const nextSnapshot = await window.claudeChat.setActiveChatPick(match)
  window.dispatchEvent(new CustomEvent(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, { detail: nextSnapshot }))
  return { status: 'changed' as const, message: t('multimodal.modelSwitched', { name: match.anthropicModel || t('multimodal.primaryModel') }) }
}

async function toggleProjectMcp(project: WorkspaceProject, { serverName, enabled }: McpToggleParams, t: TranslateFn) {
  const getSettings = window.desktop?.getAgentModeSettings
  const saveSettings = window.desktop?.saveAgentModeSettings
  if (!getSettings || !saveSettings) return { status: 'unsupported' as const, reason: t('multimodal.mcpBridgeUnavailable') }
  const result = await getSettings(project.path)
  if (!result.ok) return { status: 'failed' as const, error: new Error(result.message), reason: result.message }
  const server = findMcpServer(result.settings.mcpServers, serverName)
  if (!server) return { status: 'rejected' as const, reason: t('multimodal.mcpNotFound', { name: serverName }), code: 'mcp_not_found' }
  const saved = await saveSettings(project.path, {
    mcpServerOverrides: {
      ...result.settings.mcpServerOverrides,
      [server.name]: { enabled },
    },
  })
  if (!saved.ok) return { status: 'failed' as const, error: new Error(saved.message), reason: saved.message }
  window.dispatchEvent(new CustomEvent('agentos:project-agent-settings-changed', { detail: { projectPath: project.path } }))
  return { status: 'changed' as const, message: t(enabled ? 'multimodal.mcpEnabled' : 'multimodal.mcpDisabled', { name: server.name }) }
}

function findModelPick(snapshot: ClaudeAgentSettingsSnapshot, query: string) {
  const normalizedQuery = normalizeSpeech(query)
  for (const provider of snapshot.settings.providers) {
    const modelIds = [
      provider.model,
      provider.defaultHaikuModel,
      provider.defaultSonnetModel,
      provider.defaultOpusModel,
    ].filter(Boolean)
    for (const model of modelIds) {
      const labels = [provider.name, provider.presetId, model].map(normalizeSpeech)
      if (labels.some((label) => label && (label.includes(normalizedQuery) || normalizedQuery.includes(label)))) {
        return { providerId: provider.id, anthropicModel: model }
      }
    }
  }
  return null
}

function findMcpServer(servers: AgentMcpServerConfig[], query: string): AgentMcpServerConfig | undefined {
  const normalizedQuery = normalizeSpeech(query)
  return servers.find((server) => {
    const name = normalizeSpeech(server.name)
    return name === normalizedQuery || name.includes(normalizedQuery) || normalizedQuery.includes(name)
  })
}

function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?:：；;\s"'“”‘’]/g, '')
}

function normalizeSkillLookup(value: string | undefined): string {
  return normalizeSpeech(value ?? '').replace(/[\\/._-]/g, '')
}

function normalizeExternalUrl(rawUrl: string, t: TranslateFn): { href: string; label: string } | null {
  const input = rawUrl.trim().replace(/\s+/g, ' ')
  if (!input) return null
  const stripped = input
    .replace(/^(打开|访问|进入|open|visit|go to)\s*/i, '')
    .replace(/(页面|网页|网站|page|website|site)$/i, '')
    .trim()
  const alias = findKnownWebsite(stripped, t)
  if (alias) return alias

  const candidate = /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    const hostLabel = url.hostname.replace(/^www\./i, '')
    return { href: url.toString(), label: hostLabel === 'google.com' ? t('multimodal.website.google') : hostLabel }
  } catch {
    return null
  }
}

function findKnownWebsite(value: string, t: TranslateFn): { href: string; label: string } | null {
  const key = normalizeSpeech(value)
  if (key === 'google' || key === '谷歌') return { href: 'https://www.google.com/', label: t('multimodal.website.google') }
  return null
}
