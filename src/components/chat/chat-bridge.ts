/**
 * Chat broker seam：把「谁在服务这段对话」从 ChatPage 里抽出来。
 * Bridge seam letting one Chat surface run over either broker scope.
 *
 * Scope 身份（projectId / runtimeScopeId / routeGeneration）在构造 bridge 时绑定，
 * ChatPage 只传 scope 内的标识（threadId / requestId / messageId），因此同一份
 * Chat UI 可以同时服务 Project 与 Runtime 开发对话。
 */

import type { ChatModelPick, ClaudePermissionMode, ClaudePermissionResponsePayload } from '../../claude-chat-types'
import type {
  ProjectChatAgentContext,
  ProjectChatAttachment,
  ProjectChatAttachmentSelection,
  ProjectChatFileSearchItem,
  ProjectChatModelCatalog,
  ProjectChatPromptPayload,
  ProjectChatResult,
  ProjectChatRunPhase,
  RewindProjectFileDiffResult,
} from '../../project-chat-contract'

/** preload 缺席时与旧的 `window.projectChat?.x()` 一样返回 undefined，调用方分支不变。 */
type BrokerCall<T> = Promise<ProjectChatResult<T> | undefined>

type ThreadRef = { threadId: string }

/** ChatPage 实际消费的 broker 事实；Project 与 Runtime 快照都直接结构匹配它。 */
export type ChatBrokerRun = {
  threadId: string
  requestId: string
  phase: ProjectChatRunPhase
}

export type ChatBrokerPrompt = {
  threadId: string
  requestId: string
  promptId: string
  payload: ProjectChatPromptPayload
  /** 只有持有 owner 的窗口能应答；其余窗口只读展示。 */
  isOwnedByCaller: boolean
}

export type ChatBrokerSnapshot = {
  routeGeneration: number
  permissionMode: ClaudePermissionMode
  runs: ChatBrokerRun[]
  pendingPrompts: ChatBrokerPrompt[]
}

export type ChatBridge = {
  /** 仅用于诊断与文案；能力差异一律用方法是否存在表达，不用 kind 做分支。 */
  kind: 'project' | 'runtime'
  createThread(input: { title: string }): BrokerCall<{ threadId: string }>
  submitRun(input: ThreadRef & { text: string; attachments?: ProjectChatAttachment[]; modelPick?: ChatModelPick }): BrokerCall<{ requestId: string }>
  forkThread(input: ThreadRef & { messageId: string }): BrokerCall<{ threadId: string }>
  editAndSubmitRun(input: ThreadRef & { messageId: string; text: string; modelPick?: ChatModelPick }): BrokerCall<{ requestId: string }>
  setThreadModel(input: ThreadRef & { modelPick: ChatModelPick }): BrokerCall<void>
  markFileDiffReviewed(input: ThreadRef & { changeSetId: string }): BrokerCall<void>
  rewindFileDiff(input: ThreadRef & { changeSetId: string }): BrokerCall<RewindProjectFileDiffResult>
  cancelRun(input: ThreadRef & { requestId: string }): BrokerCall<void>
  answerPrompt(input: ThreadRef & { requestId: string; promptId: string; response: ClaudePermissionResponsePayload }): BrokerCall<void>
  getModelCatalog(): BrokerCall<ProjectChatModelCatalog>
  getAgentContext(): BrokerCall<ProjectChatAgentContext>
  searchFiles(input: { query: string }): BrokerCall<ProjectChatFileSearchItem[]>
  pickAttachments(options?: { allowImages?: boolean }): BrokerCall<ProjectChatAttachmentSelection>
  /** Runtime 开发对话跟随主窗口权限模式，因此没有这个能力。 */
  setPermissionMode?(mode: ClaudePermissionMode): BrokerCall<ClaudePermissionMode>
}

/** routeGeneration 每次调用都重新读，避免 bridge 缓存过期的路由代次。 */
export type ProjectChatBridgeScope = () => { projectId: string; routeGeneration: number }

export function createProjectChatBridge(scope: ProjectChatBridgeScope): ChatBridge {
  return {
    kind: 'project',
    createThread: async ({ title }) => window.projectChat?.createThread({ projectId: scope().projectId, title, source: 'user' }),
    submitRun: async (input) => window.projectChat?.submitRun({ projectId: scope().projectId, ...input }),
    forkThread: async (input) => window.projectChat?.forkThread({ ...scope(), ...input }),
    editAndSubmitRun: async (input) => window.projectChat?.editAndSubmitRun({ ...scope(), ...input }),
    setThreadModel: async (input) => window.projectChat?.setThreadModel({ ...scope(), ...input }),
    markFileDiffReviewed: async (input) => window.projectChat?.markFileDiffReviewed({ ...scope(), ...input }),
    rewindFileDiff: async (input) => window.projectChat?.rewindFileDiff({ ...scope(), ...input }),
    cancelRun: async (input) => window.projectChat?.cancelRun({ ...scope(), ...input }),
    answerPrompt: async (input) => window.projectChat?.answerPrompt({ ...scope(), ...input }),
    getModelCatalog: async () => window.projectChat?.getModelCatalog(),
    getAgentContext: async () => window.projectChat?.getAgentContext(scope().projectId),
    searchFiles: async ({ query }) => window.projectChat?.searchProjectFiles({ projectId: scope().projectId, query }),
    pickAttachments: async (options) => window.projectChat?.pickAttachments(options),
    setPermissionMode: async (mode) => window.projectChat?.setPermissionMode(mode),
  }
}
