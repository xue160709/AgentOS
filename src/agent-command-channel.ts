export type AgentCommandNavigation = 'stay' | 'open'

export type AgentCommandStatus =
  | 'creating'
  | 'running'
  | 'waiting'
  | 'asking'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AgentCommandEvent = {
  commandId: string
  projectId: string
  threadId?: string
  status: AgentCommandStatus
  errorCode?: string
}

export type AgentCommandResult = {
  commandId: string
  projectId: string
  threadId: string
}

export type AgentCommandSendOptions = {
  navigation?: AgentCommandNavigation
  threadTitle?: string
}

export type AgentCommandRuntime = {
  createThread: (input: { projectId: string; threadTitle?: string }) => string | Promise<string>
  submitPrompt: (input: { projectId: string; threadId: string; prompt: string }) => boolean | Promise<boolean>
  openThread: (threadId: string) => void | Promise<void>
}

export type AgentCommandChannelConfig = {
  projectId: string
  defaultNavigation?: AgentCommandNavigation
  runtime: AgentCommandRuntime
}

export type AgentCommandListener = (event: AgentCommandEvent) => void

export class AgentCommandChannelError extends Error {
  readonly code: 'not_configured' | 'empty_prompt' | 'thread_creation_failed' | 'submit_failed'
  readonly commandId?: string
  readonly threadId?: string

  constructor(
    code: AgentCommandChannelError['code'],
    message: string,
    details: { commandId?: string; threadId?: string } = {},
  ) {
    super(message)
    this.name = 'AgentCommandChannelError'
    this.code = code
    this.commandId = details.commandId
    this.threadId = details.threadId
  }
}

const TERMINAL_STATUSES = new Set<AgentCommandStatus>(['succeeded', 'failed', 'cancelled'])

/**
 * 无 UI 的 Agent 指令入口。项目在 configure 阶段绑定，调用方不能在 send 时改投其它项目。
 * The project is bound at configure time so call sites only provide a complete prompt.
 */
export class AgentCommandChannel {
  private config?: AgentCommandChannelConfig
  private configToken?: symbol
  private sequence = 0
  private readonly listeners = new Set<AgentCommandListener>()
  private readonly threadCommandIds = new Map<string, string>()
  private readonly eventsByCommandId = new Map<string, AgentCommandEvent>()

  configure(config: AgentCommandChannelConfig): () => void {
    const projectId = config.projectId.trim()
    if (!projectId) throw new AgentCommandChannelError('not_configured', 'Agent 指令通道缺少固定项目。')
    const token = Symbol('agent-command-channel-config')
    this.configToken = token
    this.config = { ...config, projectId }
    return () => {
      if (this.configToken !== token) return
      this.configToken = undefined
      this.config = undefined
    }
  }

  async send(prompt: string, options: AgentCommandSendOptions = {}): Promise<AgentCommandResult> {
    const text = prompt.trim()
    if (!text) throw new AgentCommandChannelError('empty_prompt', 'Agent 指令不能为空。')
    const config = this.config
    if (!config) throw new AgentCommandChannelError('not_configured', 'Agent 指令通道尚未配置。')

    const commandId = this.nextCommandId()
    this.publish({ commandId, projectId: config.projectId, status: 'creating' })

    let threadId = ''
    try {
      threadId = (await config.runtime.createThread({
        projectId: config.projectId,
        threadTitle: options.threadTitle?.trim() || undefined,
      })).trim()
    } catch {
      this.publish({ commandId, projectId: config.projectId, status: 'failed', errorCode: 'thread_creation_failed' })
      throw new AgentCommandChannelError('thread_creation_failed', '无法创建 Agent 对话线程。', { commandId })
    }
    if (!threadId) {
      this.publish({ commandId, projectId: config.projectId, status: 'failed', errorCode: 'thread_creation_failed' })
      throw new AgentCommandChannelError('thread_creation_failed', '无法创建 Agent 对话线程。', { commandId })
    }

    this.threadCommandIds.set(threadId, commandId)
    let submitted = false
    try {
      submitted = await config.runtime.submitPrompt({ projectId: config.projectId, threadId, prompt: text })
    } catch {
      this.publish({ commandId, projectId: config.projectId, threadId, status: 'failed', errorCode: 'submit_failed' })
      throw new AgentCommandChannelError('submit_failed', 'Agent 对话线程已创建，但指令提交失败。', {
        commandId,
        threadId,
      })
    }
    if (!submitted) {
      this.publish({ commandId, projectId: config.projectId, threadId, status: 'failed', errorCode: 'submit_failed' })
      throw new AgentCommandChannelError('submit_failed', 'Agent 对话线程已创建，但指令提交失败。', {
        commandId,
        threadId,
      })
    }

    this.publish({ commandId, projectId: config.projectId, threadId, status: 'running' })
    if ((options.navigation ?? config.defaultNavigation ?? 'stay') === 'open') {
      await config.runtime.openThread(threadId)
    }
    return { commandId, projectId: config.projectId, threadId }
  }

  reportThreadStatus(threadId: string, status: AgentCommandStatus, errorCode?: string): void {
    const commandId = this.threadCommandIds.get(threadId)
    const current = commandId ? this.eventsByCommandId.get(commandId) : undefined
    if (!commandId || !current) return
    this.publish({ commandId, projectId: current.projectId, threadId, status, errorCode })
  }

  getThreadStatus(threadId: string): AgentCommandEvent | undefined {
    const commandId = this.threadCommandIds.get(threadId)
    return commandId ? this.eventsByCommandId.get(commandId) : undefined
  }

  subscribe(listener: AgentCommandListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeThread(threadId: string, listener: AgentCommandListener): () => void {
    return this.subscribe((event) => {
      if (event.threadId === threadId) listener(event)
    })
  }

  async openThread(threadId: string): Promise<boolean> {
    if (!this.threadCommandIds.has(threadId) || !this.config) return false
    await this.config.runtime.openThread(threadId)
    return true
  }

  private publish(event: AgentCommandEvent): void {
    const current = this.eventsByCommandId.get(event.commandId)
    // SDK 的 result 可能早于 submit Promise 返回；终态一旦出现就不能被迟到的 running 覆盖。
    if (current && TERMINAL_STATUSES.has(current.status) && !TERMINAL_STATUSES.has(event.status)) return
    this.eventsByCommandId.set(event.commandId, event)
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 观察者失败不能反向破坏已经启动的 Agent 任务。
      }
    }
  }

  private nextCommandId(): string {
    this.sequence += 1
    return `agent-command-${Date.now().toString(36)}-${this.sequence.toString(36)}`
  }
}

export const agentCommandChannel = new AgentCommandChannel()

export function sendAgentCommand(prompt: string, options?: AgentCommandSendOptions): Promise<AgentCommandResult> {
  return agentCommandChannel.send(prompt, options)
}
