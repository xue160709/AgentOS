import {
  createLlmResolver,
  defineMultimodalConfig,
  type IntentResolver,
} from '@xue160709/omni-ui-react'
import type { LlmResolverInput } from '@xue160709/omni-ui-core'

import {
  composerSendAction,
  composerSetTextAction,
  mcpToggleAction,
  modelSwitchAction,
  projectSwitchAction,
  settingsOpenAction,
  systemOpenAppAction,
  systemOpenUrlAction,
  threadArchiveAction,
  threadNewAction,
} from './actions'

export const agentOsMultimodalConfig = defineMultimodalConfig({
  rules: [
    {
      id: 'thread.new',
      patterns: ['新建对话', '新建聊天', '创建新对话', '开一个新对话', '再开一个新的'],
      target: 'page.current',
      actionId: threadNewAction.id,
    },
    {
      id: 'project.switch.by-index',
      patterns: ['打开{project}项目', '切换到{project}项目', '进入{project}项目'],
      target: { kind: 'entity', entityType: 'project', slot: 'project', by: 'labelOrIndex' },
      actionId: projectSwitchAction.id,
    },
    {
      id: 'settings.open.general',
      patterns: ['打开设置', '进入设置', '全局设置'],
      target: 'page.current',
      actionId: settingsOpenAction.id,
      params: { category: 'general' },
    },
    {
      id: 'settings.open.model',
      patterns: ['打开模型设置', '进入模型设置', '配置模型'],
      target: 'page.current',
      actionId: settingsOpenAction.id,
      params: { category: 'general' },
    },
    {
      id: 'settings.open.mcp',
      patterns: ['打开MCP设置', '打开 mcp 设置', '进入MCP设置', '进入 mcp 设置'],
      target: 'page.current',
      actionId: settingsOpenAction.id,
      params: { category: 'mcp' },
    },
    {
      id: 'composer.setText',
      patterns: ['输入{text}', '把输入框设为{text}', '在输入框输入{text}'],
      target: 'page.current',
      actionId: composerSetTextAction.id,
      params: { text: '$text' },
    },
    {
      id: 'composer.send.current',
      patterns: ['发送', '发送消息', '提交消息'],
      target: 'page.current',
      actionId: composerSendAction.id,
    },
    {
      id: 'composer.send.text',
      patterns: ['发送{text}', '发送消息{text}'],
      target: 'page.current',
      actionId: composerSendAction.id,
      params: { text: '$text' },
    },
    {
      id: 'thread.archive.current',
      patterns: ['归档当前对话', '归档这个对话', '关闭当前对话'],
      target: 'page.current',
      actionId: threadArchiveAction.id,
    },
    {
      id: 'model.switch',
      patterns: ['切换到{modelName}', '切换模型到{modelName}', '使用{modelName}模型'],
      target: 'page.current',
      actionId: modelSwitchAction.id,
      params: { modelName: '$modelName' },
    },
    {
      id: 'mcp.disable',
      patterns: ['关掉这个项目的{serverName}', '关闭这个项目的{serverName}', '禁用这个项目的{serverName}'],
      target: 'page.current',
      actionId: mcpToggleAction.id,
      params: { serverName: '$serverName', enabled: false },
    },
    {
      id: 'mcp.enable',
      patterns: ['打开这个项目的{serverName}', '启用这个项目的{serverName}'],
      target: 'page.current',
      actionId: mcpToggleAction.id,
      params: { serverName: '$serverName', enabled: true },
    },
    {
      id: 'system.openUrl.google',
      patterns: ['打开 Google 页面', '打开 google 页面', '打开google页面', '打开谷歌页面', '打开 Google', '打开google', '打开谷歌', '访问 Google', '访问google', '访问谷歌'],
      target: 'page.current',
      actionId: systemOpenUrlAction.id,
      params: { url: 'https://www.google.com' },
      confidence: 0.95,
    },
    {
      id: 'system.openUrl',
      patterns: ['打开{url}页面', '打开{url}网页', '打开{url}网站', '打开网页{url}', '打开网站{url}', '访问{url}', '进入{url}网站'],
      target: 'page.current',
      actionId: systemOpenUrlAction.id,
      params: { url: '$url' },
      confidence: 0.88,
    },
    {
      id: 'system.openApp',
      patterns: ['打开{appName}', '启动{appName}', '打开应用{appName}', '打开电脑应用{appName}'],
      target: 'page.current',
      actionId: systemOpenAppAction.id,
      params: { appName: '$appName' },
      confidence: 0.85,
    },
  ],
  llm: {
    localFastPath: {
      mode: 'allowlist',
      minConfidence: 0.68,
      allowDomainActions: true,
      allowPrimitiveActions: false,
      actionIds: [
        'project.switch',
        'thread.new',
        'settings.open',
        'composer.setText',
        'composer.send',
        'task-card.refresh',
        'system.openUrl',
        'system.openApp',
      ],
    },
    modelActionPolicy: {
      mode: 'allowlist',
      minConfidence: 0.7,
      allowDomainActions: true,
      allowPrimitiveActions: false,
      actionIds: [
        'project.switch',
        'thread.new',
        'settings.open',
        'composer.setText',
        'composer.send',
        'task-card.refresh',
        'model.switch',
        'mcp.toggle',
        'thread.archive',
        'system.openUrl',
        'system.openApp',
      ],
      requireConfirmationForRisk: ['medium', 'high'],
    },
  },
})

export const agentOsLlmResolver: IntentResolver = createLlmResolver({
  id: 'agentos-claude-sdk',
  async complete(input) {
    const resolveIntent = window.desktop?.resolveOmniIntent
    if (!resolveIntent) throw new Error('intent resolver bridge unavailable')

    const result = await resolveIntent({
      utterance: input.utterance,
      prompt: createAgentOsIntentPrompt(input),
    })
    if (!result.ok) throw new Error(result.message)
    return result.content
  },
})

function createAgentOsIntentPrompt(input: LlmResolverInput): string {
  return JSON.stringify(
    {
      utterance: input.utterance,
      snapshot: {
        page: input.snapshot.page,
        visibleObjects: input.snapshot.visibleObjects.map((object) => ({
          id: object.id,
          role: object.role,
          label: object.label,
          aliases: object.aliases,
          entity: object.entity,
          state: object.state,
          actions: object.actions,
        })),
        actionSpecs: Object.fromEntries(
          Object.entries(input.snapshot.actionSpecs).map(([id, action]) => [
            id,
            {
              id,
              title: action.title,
              description: action.description,
              risk: action.risk,
              executeScope: action.executeScope,
              modelCallable: action.modelCallable,
            },
          ]),
        ),
      },
      schema: input.schema,
      guidance: [
        'Return one JSON object only.',
        'Use actionId values exactly as listed in actionSpecs.',
        'For system.openApp, put the app name in params.appName.',
        'For system.openUrl, put a full URL or a recognizable website name in params.url.',
        'For model.switch, put the model label or id in params.modelName.',
        'For mcp.toggle, put params.serverName and params.enabled.',
      ],
    },
    null,
    2,
  )
}
