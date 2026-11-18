/**
 * Runtime 开发对话 → 主窗口 Chat 的投影层。
 * Projects the Runtime broker snapshot onto the shared Chat surface.
 *
 * 窗口页面本身不接触 scope 身份：所有 `runtimeScopeId` 的搬运都收敛在这里，
 * 这样 Runtime 窗口既能复用 `ChatPage`，又不会把 Project 的路径身份带进来。
 */

import type {
  RuntimeChatAPI,
  RuntimeChatSnapshot,
  RuntimeChatThreadSnapshot,
  RuntimeDevelopmentWindowContext,
} from '../../runtime-development-contract'
import type { ProjectChatTranscriptItem } from '../../project-chat-contract'
import type { ThreadRunState, TranscriptItem, WorkspaceProject, WorkspaceThread } from '../types'
import type { ChatBridge } from './chat-bridge'

export function runtimeChatApi(): RuntimeChatAPI | undefined {
  return window.runtimeChat
}

/** Runtime 窗口只有一个 scope，身份由 Main capability 决定，因此 bridge 无需入参。 */
export function createRuntimeChatBridge(): ChatBridge {
  return {
    kind: 'runtime',
    createThread: async (input) => runtimeChatApi()?.createThread(input),
    submitRun: async (input) => runtimeChatApi()?.submitRun(input),
    forkThread: async (input) => runtimeChatApi()?.forkThread(input),
    editAndSubmitRun: async (input) => runtimeChatApi()?.editAndSubmitRun(input),
    setThreadModel: async (input) => runtimeChatApi()?.setThreadModel(input),
    markFileDiffReviewed: async (input) => runtimeChatApi()?.markFileDiffReviewed(input),
    rewindFileDiff: async (input) => runtimeChatApi()?.rewindFileDiff(input),
    cancelRun: async (input) => runtimeChatApi()?.cancelRun(input),
    answerPrompt: async (input) => runtimeChatApi()?.answerPrompt(input),
    getModelCatalog: async () => runtimeChatApi()?.getModelCatalog(),
    getAgentContext: async () => runtimeChatApi()?.getAgentContext(),
    searchFiles: async (input) => runtimeChatApi()?.searchFiles(input),
    pickAttachments: async (options) => runtimeChatApi()?.pickAttachments(options),
    // setPermissionMode 缺席：Runtime 开发对话跟随主窗口的权限模式。
  }
}

/**
 * Chat 组件树需要一个 `WorkspaceProject` 形状的归属对象；Runtime 用 scope 充当它的 id，
 * `path` 恒为空串，保证渲染层拿不到任何本地路径。
 */
export function runtimeChatOwner(context: RuntimeDevelopmentWindowContext): WorkspaceProject {
  return {
    id: context.runtimeScopeId,
    name: context.runtimeName,
    path: '',
    createdAt: 0,
    updatedAt: context.development?.developmentGeneration ?? 0,
  }
}

export function runtimeChatThreads(snapshot: RuntimeChatSnapshot): WorkspaceThread[] {
  return snapshot.threads.map(runtimeChatThread)
}

function runtimeChatThread(thread: RuntimeChatThreadSnapshot): WorkspaceThread {
  return {
    id: thread.id,
    projectId: thread.runtimeScopeId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinnedAt: thread.pinnedAt,
    archivedAt: thread.archivedAt,
    creationSource: { kind: 'user' },
    chatState: {
      model: thread.chatState.model,
      modelPick: thread.chatState.modelPick,
      items: thread.chatState.items.map(runtimeChatTranscriptItem),
    },
  }
}

/** Runtime DTO 不带绝对路径；补空串只为满足渲染层类型，不参与任何文件操作。 */
function runtimeChatTranscriptItem(item: ProjectChatTranscriptItem): TranscriptItem {
  if (item.type === 'message') return { ...item, attachments: item.attachments?.map((attachment) => ({ ...attachment, path: '' })) }
  if (item.type === 'file_diff') return { ...item, requestId: '', files: item.files.map((file) => ({ ...file, path: file.relativePath })) }
  return item
}

export function runtimeChatRunStates(snapshot: RuntimeChatSnapshot): Record<string, ThreadRunState> {
  const states: Record<string, ThreadRunState> = {}
  for (const run of snapshot.runs) {
    if (run.phase === 'succeeded' || run.phase === 'failed' || run.phase === 'cancelled') continue
    states[run.threadId] = {
      requestId: run.requestId,
      status: run.phase === 'waiting_permission' ? 'waiting' : run.phase === 'waiting_answer' ? 'asking' : 'running',
      startedAt: run.startedAt,
      updatedAt: run.finishedAt ?? run.startedAt,
    }
  }
  return states
}
