import {
  defineAction,
  type RuntimeSchema,
} from '@xue160709/omni-ui-react'

type EmptyParams = Record<string, never>

export type AppNavigateParams = {
  view: 'home' | 'docs'
}

export type ProjectSwitchParams = {
  projectId?: string
}

export type ProjectPinParams = {
  projectId?: string
  pinned: boolean
}

export type SettingsOpenParams = {
  category?: string
}

export type SettingsDescribeParams = {
  topic?: 'current' | 'models' | 'search' | 'mcp' | 'controls'
}

export type SearchOpenParams = {
  scope?: string
}

export type SidebarSetParams = {
  collapsed: boolean
}

export type SidePanelOpenParams = {
  panel?: string
  open?: boolean
}

export type AgentStatusOpenParams = {
  refresh?: boolean
}

export type SkillRunParams = {
  skillName: string
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

export type ThreadPinParams = {
  threadId?: string
  pinned: boolean
}

export type ThreadSwitchParams = {
  threadId?: string
}

export type TaskCardRefreshParams = {
  taskCardId?: string
}

export const emptyParamsSchema: RuntimeSchema<EmptyParams> = {
  safeParse(input) {
    return isRecord(input) ? { success: true, data: {} } : { success: false, error: 'params must be an object' }
  },
}

const appNavigateParamsSchema: RuntimeSchema<AppNavigateParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    return input.view === 'home' || input.view === 'docs'
      ? { success: true, data: { view: input.view } }
      : { success: false, error: 'view must be home or docs' }
  },
}

const projectSwitchParamsSchema: RuntimeSchema<ProjectSwitchParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const projectId = readString(input.projectId)
    return { success: true, data: projectId ? { projectId } : {} }
  },
}

const projectPinParamsSchema: RuntimeSchema<ProjectPinParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const projectId = readString(input.projectId)
    return { success: true, data: { ...(projectId ? { projectId } : {}), pinned: input.pinned !== false } }
  },
}

const settingsOpenParamsSchema: RuntimeSchema<SettingsOpenParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const category = readString(input.category)
    return { success: true, data: category ? { category } : {} }
  },
}

const settingsDescribeParamsSchema: RuntimeSchema<SettingsDescribeParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const topic = readString(input.topic)
    if (!topic) return { success: true, data: {} }
    if (topic === 'current' || topic === 'models' || topic === 'search' || topic === 'mcp' || topic === 'controls') {
      return { success: true, data: { topic } }
    }
    return { success: false, error: 'topic must be current, models, search, mcp, or controls' }
  },
}

const searchOpenParamsSchema: RuntimeSchema<SearchOpenParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const scope = readString(input.scope)
    return { success: true, data: scope ? { scope } : {} }
  },
}

const sidebarSetParamsSchema: RuntimeSchema<SidebarSetParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    return { success: true, data: { collapsed: input.collapsed === true } }
  },
}

const sidePanelOpenParamsSchema: RuntimeSchema<SidePanelOpenParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const panel = readString(input.panel)
    return { success: true, data: { panel: panel || 'files', open: input.open !== false } }
  },
}

const agentStatusOpenParamsSchema: RuntimeSchema<AgentStatusOpenParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    return { success: true, data: { refresh: input.refresh === true } }
  },
}

const skillRunParamsSchema: RuntimeSchema<SkillRunParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const skillName = readString(input.skillName)
    return skillName
      ? { success: true, data: { skillName } }
      : { success: false, error: 'skillName must be a non-empty string' }
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

const threadPinParamsSchema: RuntimeSchema<ThreadPinParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const threadId = readString(input.threadId)
    return { success: true, data: { ...(threadId ? { threadId } : {}), pinned: input.pinned !== false } }
  },
}

const threadSwitchParamsSchema: RuntimeSchema<ThreadSwitchParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const threadId = readString(input.threadId)
    return { success: true, data: threadId ? { threadId } : {} }
  },
}

const taskCardRefreshParamsSchema: RuntimeSchema<TaskCardRefreshParams> = {
  safeParse(input) {
    if (!isRecord(input)) return { success: false, error: 'params must be an object' }
    const taskCardId = readString(input.taskCardId)
    return { success: true, data: taskCardId ? { taskCardId } : {} }
  },
}

export const appNavigateAction = defineAction<AppNavigateParams>({
  id: 'app.navigate',
  title: '打开页面',
  description: '切换到 AgentOS 的主页面或文档页。',
  attachTo: { role: 'page' },
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: appNavigateParamsSchema,
})

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

export const projectPinAction = defineAction<ProjectPinParams>({
  id: 'project.pin',
  title: '置顶项目',
  description: '置顶或取消置顶当前/指定项目。',
  attachTo: { role: 'page', entityType: 'project' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: projectPinParamsSchema,
})

export const threadNewAction = defineAction<EmptyParams>({
  id: 'thread.new',
  title: '新建对话',
  description: '在当前项目创建一个新对话。',
  attachTo: { role: 'page' },
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
  attachTo: { role: 'page' },
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: settingsOpenParamsSchema,
})

export const settingsDescribeAction = defineAction<SettingsDescribeParams>({
  id: 'settings.describe',
  title: '读取设置页数据',
  description: '读取 AgentOS 的安全摘要，例如模型厂商数量、当前页面数据或 omni 控件接入统计。',
  attachTo: { role: 'page' },
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: settingsDescribeParamsSchema,
})

export const searchOpenAction = defineAction<SearchOpenParams>({
  id: 'search.open',
  title: '打开搜索',
  description: '打开 AgentOS 全局搜索弹窗，可指定文件、对话、消息、记忆、技能或任务范围。',
  attachTo: { role: 'page' },
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: searchOpenParamsSchema,
})

export const sidebarSetAction = defineAction<SidebarSetParams>({
  id: 'sidebar.set',
  title: '设置侧栏',
  description: '展开或收起主工作区侧栏。',
  attachTo: { role: 'page' },
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: sidebarSetParamsSchema,
})

export const sidePanelOpenAction = defineAction<SidePanelOpenParams>({
  id: 'side-panel.open',
  title: '打开辅助面板',
  description: '打开或关闭工作区右侧辅助面板，例如文件树。',
  attachTo: { role: 'page' },
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: sidePanelOpenParamsSchema,
})

export const agentStatusOpenAction = defineAction<AgentStatusOpenParams>({
  id: 'agent-status.open',
  title: '打开 Agent 状态',
  description: '打开 Agent 状态面板，可选择刷新状态。',
  attachTo: { role: 'page' },
  executeScope: 'app',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: agentStatusOpenParamsSchema,
})

export const skillRunAction = defineAction<SkillRunParams>({
  id: 'skill.run',
  title: '运行项目技能',
  description: '运行当前项目中的指定 Skill。',
  attachTo: { role: 'page' },
  executeScope: 'task',
  risk: 'medium',
  modelCallable: true,
  voiceCallable: true,
  confirmation: { required: true, expiresInMs: 30_000 },
  paramsSchema: skillRunParamsSchema,
})

export const composerSetTextAction = defineAction<ComposerTextParams>({
  id: 'composer.setText',
  title: '设置输入框文本',
  description: '把文本放入当前 Composer。',
  attachTo: { role: 'page' },
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
  attachTo: { role: 'page' },
  executeScope: 'page',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: optionalComposerTextParamsSchema,
})

export const taskCardRefreshAction = defineAction<TaskCardRefreshParams>({
  id: 'task-card.refresh',
  title: '刷新任务卡',
  description: '刷新项目首页任务卡。',
  attachTo: { role: 'page', entityType: 'task-card' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: taskCardRefreshParamsSchema,
  paramsFrom: ({ target }) => ({ taskCardId: target.entity?.id }),
})

export const modelSwitchAction = defineAction<ModelSwitchParams>({
  id: 'model.switch',
  title: '切换模型',
  description: '切换当前激活模型。',
  attachTo: { role: 'page' },
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
  attachTo: { role: 'page' },
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
  attachTo: { role: 'page', entityType: 'thread' },
  executeScope: 'object',
  risk: 'medium',
  modelCallable: true,
  voiceCallable: true,
  confirmation: { required: true, expiresInMs: 30_000 },
  paramsSchema: threadArchiveParamsSchema,
  paramsFrom: ({ target }) => ({ threadId: target.entity?.id }),
})

export const threadPinAction = defineAction<ThreadPinParams>({
  id: 'thread.pin',
  title: '置顶对话',
  description: '置顶或取消置顶当前/指定对话。',
  attachTo: { role: 'page', entityType: 'thread' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: threadPinParamsSchema,
})

export const threadSwitchAction = defineAction<ThreadSwitchParams>({
  id: 'thread.switch',
  title: '切换对话',
  description: '切换到指定对话。',
  attachTo: { entityType: 'thread' },
  executeScope: 'object',
  risk: 'low',
  modelCallable: true,
  voiceCallable: true,
  paramsSchema: threadSwitchParamsSchema,
  paramsFrom: ({ target }) => ({ threadId: target.entity?.id }),
})

export const systemOpenAppAction = defineAction<SystemOpenAppParams>({
  id: 'system.openApp',
  title: '打开电脑应用',
  description: '在 macOS 上打开指定应用。',
  attachTo: { role: 'page' },
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
  attachTo: { role: 'page' },
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
