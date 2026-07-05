import {
  defineAction,
  type RuntimeSchema,
} from '@xue160709/omni-ui-react'

type EmptyParams = Record<string, never>

export type ProjectSwitchParams = {
  projectId?: string
}

export type SettingsOpenParams = {
  category?: string
}

export type ComposerTextParams = {
  text: string
}

export type OptionalComposerTextParams = {
  text?: string
}

export type SystemOpenAppParams = {
  appName: string
}

export type SystemOpenUrlParams = {
  url: string
}

export type ModelSwitchParams = {
  modelName: string
}

export type McpToggleParams = {
  serverName: string
  enabled: boolean
}

export type ThreadArchiveParams = {
  threadId?: string
}

export const emptyParamsSchema: RuntimeSchema<EmptyParams> = {
  safeParse(input) {
    return isRecord(input) ? { success: true, data: {} } : { success: false, error: 'params must be an object' }
  },
}

const projectSwitchParamsSchema: RuntimeSchema<ProjectSwitchParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const projectId = readString(input.projectId)
    return { success: true, data: projectId ? { projectId } : {} }
  },
}

const settingsOpenParamsSchema: RuntimeSchema<SettingsOpenParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const category = readString(input.category)
    return { success: true, data: category ? { category } : {} }
  },
}

const composerTextParamsSchema: RuntimeSchema<ComposerTextParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const text = readString(input.text)
    return text
      ? { success: true, data: { text } }
      : { success: false, error: 'text must be a non-empty string' }
  },
}

const optionalComposerTextParamsSchema: RuntimeSchema<OptionalComposerTextParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const text = readString(input.text)
    return { success: true, data: text ? { text } : {} }
  },
}

const systemOpenAppParamsSchema: RuntimeSchema<SystemOpenAppParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const appName = readString(input.appName)
    return appName
      ? { success: true, data: { appName } }
      : { success: false, error: 'appName must be a non-empty string' }
  },
}

const systemOpenUrlParamsSchema: RuntimeSchema<SystemOpenUrlParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const url = readString(input.url)
    return url
      ? { success: true, data: { url } }
      : { success: false, error: 'url must be a non-empty string' }
  },
}

const modelSwitchParamsSchema: RuntimeSchema<ModelSwitchParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const modelName = readString(input.modelName)
    return modelName
      ? { success: true, data: { modelName } }
      : { success: false, error: 'modelName must be a non-empty string' }
  },
}

const mcpToggleParamsSchema: RuntimeSchema<McpToggleParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const serverName = readString(input.serverName)
    return serverName
      ? { success: true, data: { serverName, enabled: input.enabled !== false } }
      : { success: false, error: 'serverName must be a non-empty string' }
  },
}

const threadArchiveParamsSchema: RuntimeSchema<ThreadArchiveParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const threadId = readString(input.threadId)
    return { success: true, data: threadId ? { threadId } : {} }
  },
}

export const projectSwitchAction = defineAction<ProjectSwitchParams>({
  id: 'project.switch',
  title: '切换项目',
  description: '切换到目标项目首页。',
  attachTo: { entityType: 'project' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: projectSwitchParamsSchema,
  paramsFrom: ({ target }) => ({ projectId: target.entity?.id }),
})

export const threadNewAction = defineAction<EmptyParams>({
  id: 'thread.new',
  title: '新建对话',
  description: '在当前项目创建一个新对话。',
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: emptyParamsSchema,
})

export const settingsOpenAction = defineAction<SettingsOpenParams>({
  id: 'settings.open',
  title: '打开设置',
  description: '打开全局设置或指定设置分类。',
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: settingsOpenParamsSchema,
})

export const composerSetTextAction = defineAction<ComposerTextParams>({
  id: 'composer.setText',
  title: '设置输入框文本',
  description: '把文本放入当前 Composer。',
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: composerTextParamsSchema,
})

export const composerSendAction = defineAction<OptionalComposerTextParams>({
  id: 'composer.send',
  title: '发送输入框',
  description: '发送当前 Composer 文本，或先写入指定文本再发送。',
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: optionalComposerTextParamsSchema,
})

export const taskCardRefreshAction = defineAction<EmptyParams>({
  id: 'task-card.refresh',
  title: '刷新任务卡',
  description: '刷新项目首页任务卡。',
  attachTo: { entityType: 'task-card' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: emptyParamsSchema,
})

export const modelSwitchAction = defineAction<ModelSwitchParams>({
  id: 'model.switch',
  title: '切换模型',
  description: '切换当前激活模型。',
  executeScope: 'app',
  risk: 'medium',
  modelCallable: true,
  voiceCallable: true,
  confirmation: { required: true, expiresInMs: 30_000 },
  paramsSchema: modelSwitchParamsSchema,
})

export const mcpToggleAction = defineAction<McpToggleParams>({
  id: 'mcp.toggle',
  title: '切换 MCP 服务',
  description: '切换当前项目的 MCP server 启用状态。',
  executeScope: 'app',
  risk: 'medium',
  modelCallable: true,
  voiceCallable: true,
  confirmation: { required: true, expiresInMs: 30_000 },
  paramsSchema: mcpToggleParamsSchema,
})

export const threadArchiveAction = defineAction<ThreadArchiveParams>({
  id: 'thread.archive',
  title: '归档对话',
  description: '归档当前或指定对话。',
  attachTo: { entityType: 'thread' },
  executeScope: 'object',
  risk: 'medium',
  modelCallable: true,
  voiceCallable: true,
  confirmation: { required: true, expiresInMs: 30_000 },
  paramsSchema: threadArchiveParamsSchema,
  paramsFrom: ({ target }) => ({ threadId: target.entity?.id }),
})

export const systemOpenAppAction = defineAction<SystemOpenAppParams>({
  id: 'system.openApp',
  title: '打开电脑应用',
  description: '在 macOS 上打开指定应用。',
  executeScope: 'system',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: systemOpenAppParamsSchema,
})

export const systemOpenUrlAction = defineAction<SystemOpenUrlParams>({
  id: 'system.openUrl',
  title: '打开网页',
  description: '在默认浏览器中打开指定网页。',
  executeScope: 'system',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: systemOpenUrlParamsSchema,
})

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
