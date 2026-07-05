import {
  useActionExecutor,
  useInteractionApi,
  type ActionExecutionResult,
  type InteractionSnapshot,
  type InteractionSubmitResult,
} from '@xue160709/omni-ui-react'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'

import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT } from '../app-events'
import type { SettingsCategoryId, WorkspaceProject, WorkspaceThread } from '../components/types'
import type { ChatPageHandle } from '../components/chat/ChatPage'
import type { AgentMcpServerConfig, VoiceCommandExecutionResult, VoiceCommandResponseRequest } from '../desktop-types'
import type { ClaudeAgentSettingsSnapshot } from '../claude-chat-types'
import {
  composerSendAction,
  composerSetTextAction,
  mcpToggleAction,
  modelSwitchAction,
  projectSwitchAction,
  settingsOpenAction,
  systemOpenAppAction,
  systemOpenUrlAction,
  taskCardRefreshAction,
  threadArchiveAction,
  threadNewAction,
  type McpToggleParams,
  type ModelSwitchParams,
} from './actions'

type AgentOsMultimodalRuntimeProps = {
  activeProject: WorkspaceProject
  activeThread: WorkspaceThread | undefined
  projects: WorkspaceProject[]
  threads: WorkspaceThread[]
  chatRef: RefObject<ChatPageHandle | null>
  onSelectProject: (projectId: string) => void
  onNewThread: (projectId?: string) => string | void
  onOpenSettingsCategory: (category: SettingsCategoryId) => void
  onArchiveThread: (threadId: string) => void | Promise<void>
}

export function AgentOsMultimodalRuntime({
  activeProject,
  activeThread,
  projects,
  threads,
  chatRef,
  onSelectProject,
  onNewThread,
  onOpenSettingsCategory,
  onArchiveThread,
}: AgentOsMultimodalRuntimeProps) {
  const api = useInteractionApi()
  const pendingConfirmationRef = useRef<{ requestId: string; turnId: string } | null>(null)
  const pendingClarificationRef = useRef<{ requestId: string } | null>(null)

  const projectIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects])
  const threadIds = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads])

  useActionExecutor(projectSwitchAction, ({ projectId }, context) => {
    const targetProjectId = projectId || context.target.entity?.id
    if (!targetProjectId || !projectIds.has(targetProjectId)) {
      return { status: 'rejected', reason: '未找到目标项目。', code: 'project_not_found' }
    }
    onSelectProject(targetProjectId)
    const project = projects.find((item) => item.id === targetProjectId)
    return { status: 'changed', message: `已打开 ${project?.name ?? '目标项目'}` }
  })

  useActionExecutor(threadNewAction, () => {
    const threadId = onNewThread(activeProject.id)
    return threadId
      ? { status: 'changed', message: '已新建对话。', data: { threadId } }
      : { status: 'failed', reason: '新建对话失败。', error: new Error('thread.new failed') }
  })

  useActionExecutor(settingsOpenAction, ({ category }) => {
    onOpenSettingsCategory(normalizeSettingsCategory(category))
    return { status: 'changed', message: '已打开设置。' }
  })

  useActionExecutor(composerSetTextAction, ({ text }) => {
    chatRef.current?.setComposerText(text)
    return { status: 'changed', message: '已写入输入框。' }
  })

  useActionExecutor(composerSendAction, async ({ text }) => {
    if (text) chatRef.current?.setComposerText(text)
    const submitted = await chatRef.current?.submitComposerDraft()
    return submitted
      ? { status: 'changed', message: '已发送。' }
      : { status: 'rejected', reason: '当前没有可发送的内容。', code: 'composer_empty' }
  })

  useActionExecutor(taskCardRefreshAction, () => {
    window.dispatchEvent(new CustomEvent('project-home:refresh'))
    return { status: 'changed', message: '已刷新项目首页任务卡。' }
  })

  useActionExecutor(systemOpenAppAction, async ({ appName }) => {
    const result = await window.desktop?.openApp?.(appName)
    if (!result) return { status: 'unsupported', reason: '当前环境不支持打开电脑应用。' }
    return result.ok
      ? { status: 'changed', message: result.message }
      : { status: 'rejected', reason: result.message, code: 'app_not_found' }
  })

  useActionExecutor(systemOpenUrlAction, async ({ url }) => {
    const target = normalizeExternalUrl(url)
    if (!target) return { status: 'rejected', reason: `无法打开网页 ${url}。`, code: 'invalid_url' }
    if (!window.desktop?.openExternal) return { status: 'unsupported', reason: '当前环境不支持打开网页。' }
    try {
      await window.desktop.openExternal(target.href)
      return { status: 'changed', message: `已打开 ${target.label}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'failed', reason: `打开网页失败：${message}`, error: new Error(message) }
    }
  })

  useActionExecutor(modelSwitchAction, async (params) => switchActiveModel(params))

  useActionExecutor(mcpToggleAction, async (params) => toggleProjectMcp(activeProject, params))

  useActionExecutor(threadArchiveAction, async ({ threadId }) => {
    const targetThreadId = threadId || activeThread?.id
    if (!targetThreadId || !threadIds.has(targetThreadId)) {
      return { status: 'rejected', reason: '未找到要归档的对话。', code: 'thread_not_found' }
    }
    await onArchiveThread(targetThreadId)
    return { status: 'changed', message: '已归档对话。' }
  })

  const clearPendingForRequest = useCallback((requestId: string) => {
    if (pendingConfirmationRef.current?.requestId === requestId) pendingConfirmationRef.current = null
    if (pendingClarificationRef.current?.requestId === requestId) pendingClarificationRef.current = null
  }, [])

  const deliverVoiceResult = useCallback(
    async (requestId: string, result: InteractionSubmitResult) => {
      const mapped = mapSubmitResult(result, api.getSnapshot())
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
    [api, clearPendingForRequest],
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
          await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: '没有可确认的命令。' })
          return
        }
        pendingConfirmationRef.current = null
        if (event.action === 'cancel') {
          api.cancelTurn(pending.turnId, 'User cancelled AgentOS command confirmation from voice window.')
          await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: '已取消。' })
          return
        }
        const result = await api.confirmTurn(pending.turnId)
        await window.desktop?.sendVoiceCommandResult?.({
          id: event.id,
          status: result.ok ? 'success' : 'failed',
          message: executionMessage(result.execution) ?? result.error?.message ?? '确认执行失败。',
        })
        return
      }

      const pending = pendingClarificationRef.current
      if (!pending || pending.requestId !== event.id || !event.candidateId) {
        await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: '没有可选择的候选。' })
        return
      }
      const lastResolution = api.lastResolution
      if (!lastResolution) {
        await window.desktop?.sendVoiceCommandResult?.({ id: event.id, status: 'failed', message: '候选上下文已失效。' })
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
    [api, deliverVoiceResult],
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

async function switchActiveModel({ modelName }: ModelSwitchParams) {
  if (!window.claudeChat?.getSettings || !window.claudeChat.setActiveChatPick) {
    return { status: 'unsupported' as const, reason: '模型设置桥不可用。' }
  }
  const snapshot = await window.claudeChat.getSettings()
  const match = findModelPick(snapshot, modelName)
  if (!match) return { status: 'rejected' as const, reason: `未找到模型 ${modelName}。`, code: 'model_not_found' }
  const nextSnapshot = await window.claudeChat.setActiveChatPick(match)
  window.dispatchEvent(new CustomEvent(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, { detail: nextSnapshot }))
  return { status: 'changed' as const, message: `已切换到 ${match.anthropicModel || '主模型'}。` }
}

async function toggleProjectMcp(project: WorkspaceProject, { serverName, enabled }: McpToggleParams) {
  const getSettings = window.desktop?.getAgentModeSettings
  const saveSettings = window.desktop?.saveAgentModeSettings
  if (!getSettings || !saveSettings) return { status: 'unsupported' as const, reason: 'MCP 设置桥不可用。' }
  const result = await getSettings(project.path)
  if (!result.ok) return { status: 'failed' as const, error: new Error(result.message), reason: result.message }
  const server = findMcpServer(result.settings.mcpServers, serverName)
  if (!server) return { status: 'rejected' as const, reason: `未找到 MCP ${serverName}。`, code: 'mcp_not_found' }
  const saved = await saveSettings(project.path, {
    mcpServerOverrides: {
      ...result.settings.mcpServerOverrides,
      [server.name]: { enabled },
    },
  })
  if (!saved.ok) return { status: 'failed' as const, error: new Error(saved.message), reason: saved.message }
  window.dispatchEvent(new CustomEvent('agentos:project-agent-settings-changed', { detail: { projectPath: project.path } }))
  return { status: 'changed' as const, message: `${enabled ? '已启用' : '已关闭'} ${server.name}。` }
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

function mapSubmitResult(
  result: InteractionSubmitResult,
  snapshot: InteractionSnapshot,
): Omit<VoiceCommandExecutionResult, 'id'> {
  if (result.pendingCommand) {
    return { status: 'needs_confirmation', message: '需要确认后执行。' }
  }
  if (result.resolution.status === 'needs_clarification') {
    const candidates = (result.resolution.targetCandidates ?? []).map((candidate) => ({
      id: candidate.id,
      label: snapshot.visibleObjects.find((object) => object.id === candidate.id)?.label ?? candidate.id,
    }))
    return { status: 'needs_clarification', message: '需要选择目标。', candidates }
  }
  if (result.ok) {
    return {
      status: 'success',
      message: executionMessage(result.dispatch?.execution) ?? '已执行。',
    }
  }
  if (result.resolution.status === 'unsupported' || result.resolution.status === 'not_found') {
    return { status: 'unsupported', message: result.resolution.reason ?? '无法识别。' }
  }
  return { status: 'failed', message: result.error ?? validationMessage(result.validation) ?? '执行失败。' }
}

function executionMessage(execution: ActionExecutionResult | undefined): string | undefined {
  if (!execution) return undefined
  if (execution.status === 'changed') return execution.message
  if ('reason' in execution) return execution.reason
  return undefined
}

function validationMessage(validation: InteractionSubmitResult['validation']): string | undefined {
  return validation && !validation.ok ? validation.reason : undefined
}

function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?:：；;\s"'“”‘’]/g, '')
}

function normalizeExternalUrl(rawUrl: string): { href: string; label: string } | null {
  const input = rawUrl.trim().replace(/\s+/g, ' ')
  if (!input) return null
  const stripped = input
    .replace(/^(打开|访问|进入)\s*/i, '')
    .replace(/(页面|网页|网站)$/i, '')
    .trim()
  const alias = findKnownWebsite(stripped)
  if (alias) return alias

  const candidate = /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    const hostLabel = url.hostname.replace(/^www\./i, '')
    return { href: url.toString(), label: hostLabel === 'google.com' ? 'Google 页面' : hostLabel }
  } catch {
    return null
  }
}

function findKnownWebsite(value: string): { href: string; label: string } | null {
  const key = normalizeSpeech(value)
  if (key === 'google' || key === '谷歌') return { href: 'https://www.google.com/', label: 'Google 页面' }
  return null
}
