/**
 * 对话页：Composer、模型/权限选择、Agent 事件流与线程状态同步。
 * Chat surface coordinating composer, model/permission pickers, Agent IPC stream, and per-thread state.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { IconInline } from '../../icon-inline'
import type {
  AgentContextCatalog,
  AgentContextSource,
  ChatModelPick,
  ClaudeChatAttachment,
  ClaudeChatAttachmentPickerResult,
  ClaudeAgentStatusSnapshot,
  ClaudeAgentSettingsSnapshot,
  ClaudeChatEvent,
  ClaudeChatSubmitPayload,
  ClaudePermissionMode,
  ProjectFileSearchItem,
} from '../../claude-chat-types'
import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, OPEN_AGENT_STATUS_EVENT } from '../../app-events'
import type { HomePluginRunItem, SpeechRecognitionStatus } from '../../desktop-types'
import { useI18n } from '../../i18n/i18n'
import {
  buildModelPickRows,
  displayModelForPick,
  modelPickFromRow,
  modelPickKey,
  modelRowForPick,
  resolveEffectiveModelPick,
  sameModelPick,
  supportsImagesForPick,
} from '../../model-pick'
import type {
  ChatFileDiffItem,
  ChatMessageAttachment,
  ChatMessageItem,
  ChatTaskItem,
  ChatTaskState,
  ChatState,
  FileTreeNode,
  AgentSettingsPanelId,
  ProjectSkillRunRequest,
  ThreadRunState,
  TranscriptItem,
  WorkspaceProject,
  WorkspaceThread,
} from '../types'
import { AgentInputPromptModal, type PendingUserInputPrompt, type UserInputDecision } from './AgentInputPromptModal'
import { ChatStartView } from './ChatStartView'
import { ChatThreadView } from './ChatThreadView'
import { ChatRun, type ChatRunTransition } from './chat-run'
import { projectContent } from '../../project-content'
import { writeClipboardText } from './clipboard'
import { Composer } from './Composer'
import { formatBytes } from './format'
import type { BuiltInSlashCommand, ChatModelMenuRow, ComposerSuggestion, ComposerTrigger, PermissionModeRow } from './local-types'
import type { WorkspaceAgentModeState } from '../useWorkspaceAgentMode'

const PROCESS_TRACE_TOGGLE_EVENT = 'chat-process-trace:toggle'
const MAX_COMPOSER_SUGGESTIONS = 64
const MAX_COMPOSER_ATTACHMENTS = 8
const COMPOSER_ATTACHMENT_MAX_TOTAL_BYTES = 24 * 1024 * 1024
const COMPOSER_PASTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const COMPOSER_PASTE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const ACTIVE_SPEECH_RECOGNITION_STATUSES = new Set<SpeechRecognitionStatus>([
  'starting',
  'requesting_permission',
  'listening',
  'transcribing',
])

type SpeechDraftRange = {
  start: number
  end: number
  committedText: string
  liveText: string
}

function isCjkCharacter(value: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value)
}

function needsSpeechSeparator(left: string, right: string) {
  if (!left || !right) return false
  const last = left.trimEnd().at(-1)
  const first = right.trimStart().at(0)
  if (!last || !first) return false
  if (/^[,.;:!?，。！？；：、）)\]}]/u.test(first)) return false
  if (isCjkCharacter(last) || isCjkCharacter(first)) return false
  return true
}

function joinSpeechSegments(left: string, right: string) {
  const cleanLeft = left.trim()
  const cleanRight = right.trim()
  if (!cleanLeft) return cleanRight
  if (!cleanRight) return cleanLeft
  return `${cleanLeft}${needsSpeechSeparator(cleanLeft, cleanRight) ? ' ' : ''}${cleanRight}`
}

function commonPrefixLength(a: string, b: string) {
  const maxLength = Math.min(a.length, b.length)
  let length = 0
  while (length < maxLength && a[length] === b[length]) {
    length += 1
  }
  return length
}

function shouldStartNewSpeechSegment(previous: string, next: string) {
  if (!previous || !next || previous === next) return false
  if (next.startsWith(previous) || previous.startsWith(next)) return false
  const sharedPrefixLength = commonPrefixLength(previous, next)
  const shorterLength = Math.min(previous.length, next.length)
  if (shorterLength > 0 && sharedPrefixLength / shorterLength >= 0.6) return false
  return next.length + 1 < previous.length || sharedPrefixLength < Math.min(2, shorterLength)
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getNativeFilePath(file: File): string {
  const maybeNativeFile = file as File & { path?: unknown }
  return typeof maybeNativeFile.path === 'string' ? maybeNativeFile.path : ''
}

function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function imageExtensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取剪贴板图片'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('无法读取剪贴板图片'))
    reader.readAsDataURL(file)
  })
}

function mergeComposerAttachments(
  current: ClaudeChatAttachment[],
  incoming: ClaudeChatAttachment[],
): { attachments: ClaudeChatAttachment[]; skipped: Array<{ name: string; reason: string }> } {
  const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
  const skipped: Array<{ name: string; reason: string }> = []

  for (const attachment of incoming) {
    const existing = byPath.get(attachment.path)
    const nextAttachments = existing
      ? [...byPath.values()].map((item) => (item.path === attachment.path ? attachment : item))
      : [...byPath.values(), attachment]

    if (!existing && byPath.size >= MAX_COMPOSER_ATTACHMENTS) {
      skipped.push({ name: attachment.name, reason: `一次最多添加 ${MAX_COMPOSER_ATTACHMENTS} 个文件` })
      continue
    }

    if (totalAttachmentBytes(nextAttachments) > COMPOSER_ATTACHMENT_MAX_TOTAL_BYTES) {
      skipped.push({ name: attachment.name, reason: '附件总大小超过 24MB' })
      continue
    }

    byPath.set(attachment.path, attachment)
  }

  return { attachments: [...byPath.values()].slice(0, MAX_COMPOSER_ATTACHMENTS), skipped }
}

function totalAttachmentBytes(attachments: ClaudeChatAttachment[]): number {
  return attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size || 0), 0)
}

// --- Imperative handle / 命令式句柄 ---

export type ChatPageHandle = {
  startNewThread: () => Promise<void>
  focusComposer: () => void
  insertComposerText: (text: string) => void
  setComposerText: (text: string) => void
  submitComposerDraft: () => Promise<boolean>
  revealMessage: (messageId: string) => boolean
  submitPromptInNewThread: (projectId: string, prompt: string) => Promise<boolean>
  submitPromptInThread: (
    projectId: string,
    threadId: string,
    prompt: string,
    options?: ClaudeChatSubmitPayload['promptMode'] | SubmitPromptOptions,
  ) => Promise<boolean>
}

export type SubmitPromptOptions = {
  promptMode?: ClaudeChatSubmitPayload['promptMode']
  modelPick?: ChatModelPick
}

type ChatPageProps = {
  hidden: boolean
  activeProject: WorkspaceProject
  activeThread: WorkspaceThread | undefined
  projectDefaultModelPick?: ChatModelPick
  projectHomeModelPick?: ChatModelPick
  agentStatusSnapshot: ClaudeAgentStatusSnapshot | null
  /** 按 threadId 查找持久化 sessionId（重启后恢复 SDK）/ Threads list for resolving persisted session ids */
  threads: WorkspaceThread[]
  projects: WorkspaceProject[]
  projectOrderIds: readonly string[]
  threadRunStates: Record<string, ThreadRunState>
  onStatusChange: (text: string) => void
  onNewThread: (projectId?: string) => string | void
  onForkThread: (projectId: string, items: TranscriptItem[], title: string, model?: string, modelPick?: ChatModelPick) => void
  onCreateProject: (mode: 'scratch' | 'existing') => void | Promise<void>
  onSelectProject: (projectId: string) => void
  onThreadChatStateChange: (threadId: string, update: ChatState | ((prev: ChatState) => ChatState)) => void
  onThreadPromptSubmit: (threadId: string, prompt: string) => void
  onThreadRunStateChange: (threadId: string, state: ThreadRunState | null) => void
  onThreadCompletionStateChange: (threadId: string, completedAt: number | null) => void
  onProjectHomeModelPickChange: (projectId: string, pick: ChatModelPick | undefined) => void
  onRefreshAgentStatus: (refresh?: boolean) => void
  agentMode: WorkspaceAgentModeState
  agentModeEnabled: boolean
  todoEnabled: boolean
  agentModeLoading: boolean
  agentSettingsOpen: boolean
  agentSettingsPanel: AgentSettingsPanelId
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
  onAgentSettingsPanelChange: (panel: AgentSettingsPanelId) => void
  onCloseAgentSettings: () => void
  homeModeResetKey: number
  hiddenSkillPaths: string[]
  onCreateHomePluginCardThread: (projectId: string, initialPrompt: string) => string | void
  onEditHomePluginCard: (projectId: string, item: HomePluginRunItem) => void
  onOpenProjectFile: (node: FileTreeNode) => void
  onRunProjectSkill: (projectId: string, skill: ProjectSkillRunRequest) => void
  onStopProjectSkillRun: (projectId: string, skillPath: string) => void
}

// --- Internal helpers / 模块内辅助 ---

type SubmitPromptTarget = {
  threadId?: string
  project?: WorkspaceProject
  promptMode?: ClaudeChatSubmitPayload['promptMode']
  modelPick?: ChatModelPick
  reuseUserMessageId?: string
  resetSession?: boolean
  suppressUserMessage?: boolean
  preserveComposerDraft?: boolean
}

/** 内置 slash 命令清单 / Built-in slash commands backed by i18n strings */
function getBuiltInSlashCommands(t: (path: string, vars?: Record<string, string | number>) => string): BuiltInSlashCommand[] {
  return [
    {
      kind: 'built-in',
      command: 'compact',
      title: t('chat.slashCompactTitle'),
      description: t('chat.slashCompactDesc'),
      argumentHint: '[instructions]',
    },
    {
      kind: 'built-in',
      command: 'status',
      title: t('chat.slashStatusTitle'),
      description: t('chat.slashStatusDesc'),
      argumentHint: '',
    },
  ]
}

/** 为「数据卡片」Home Plugin 起草阶段拼装的系统提示词 / System prompt for creating a single data-card Home Plugin */
function buildDataCardPrompt(userRequest: string, threadId: string): string {
  return [
    '请基于下面的需求，只创建一张独立的数据卡片 Home Plugin。',
    `当前专用 threadId：${threadId}`,
    '要求：选择合适的小/中/大尺寸，在 manifest.json 写入 preferredSize、kind: "data"、threadId、createdAt、updatedAt；不要一次生成多张卡片。',
    '',
    '用户需求：',
    userRequest,
  ].join('\n')
}

/** 将线程用途映射到 `claudeChat.submit` 的 `promptMode` / Map thread `purpose` to SDK `promptMode` */
function promptModeForThreadPurpose(purpose: WorkspaceThread['purpose']): ClaudeChatSubmitPayload['promptMode'] | undefined {
  if (purpose === 'home-plugin-customization' || purpose === 'home-plugin-card-customization') return purpose
  if (purpose === 'task-run') return 'home-plugin-task-run'
  return undefined
}

const PERMISSION_MODE_STORAGE_KEY = 'codex-ui-template:claude-permission-mode'

/** 主聊天路由组件（forwardRef 暴露托盘动作）/ Primary chat route exposing imperative methods */
export const ChatPage = forwardRef<ChatPageHandle, ChatPageProps>(function ChatPage(
  {
    hidden,
    activeProject,
    activeThread,
    projectDefaultModelPick,
    projectHomeModelPick,
    agentStatusSnapshot,
    threads,
    projects,
    projectOrderIds,
    threadRunStates,
    onStatusChange,
    onNewThread,
    onForkThread,
    onCreateProject,
    onSelectProject,
    onThreadChatStateChange,
    onThreadPromptSubmit,
    onThreadRunStateChange,
    onThreadCompletionStateChange,
    onProjectHomeModelPickChange,
    onRefreshAgentStatus,
    agentMode,
    agentModeEnabled,
    todoEnabled,
    agentModeLoading,
    agentSettingsOpen,
    agentSettingsPanel,
    onOpenAgentSettings,
    onAgentSettingsPanelChange,
    onCloseAgentSettings,
    homeModeResetKey,
    hiddenSkillPaths,
    onCreateHomePluginCardThread,
    onEditHomePluginCard,
    onOpenProjectFile,
    onRunProjectSkill,
    onStopProjectSkillRun,
  },
  ref,
) {
  // --- Local state & refs / 组件状态与引用 ---

  const { t } = useI18n()
  const chatItems = activeThread?.chatState.items ?? []
  const activeRunState = activeThread ? threadRunStates[activeThread.id] : undefined
  const isRunning = Boolean(activeRunState)
  const [inputValue, setInputValue] = useState('')
  const [isComposingText, setIsComposingText] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelMenuRows, setModelMenuRows] = useState<ChatModelMenuRow[]>([])
  const [modelMenuSelectionKey, setModelMenuSelectionKey] = useState('')
  const [activeModelSupportsImages, setActiveModelSupportsImages] = useState(false)
  const [claudeSettingsSnapshot, setClaudeSettingsSnapshot] = useState<ClaudeAgentSettingsSnapshot | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<ClaudeChatAttachment[]>([])
  const pendingAttachmentsRef = useRef<ClaudeChatAttachment[]>([])
  const [agentContext, setAgentContext] = useState<AgentContextCatalog | null>(null)
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>(() => readStoredPermissionMode())
  const [permissionModeOpen, setPermissionModeOpen] = useState(false)
  const [pendingUserInputPrompts, setPendingUserInputPrompts] = useState<PendingUserInputPrompt[]>([])
  const [composerSelection, setComposerSelection] = useState({ start: 0, end: 0 })
  const [dismissedAutocompleteKey, setDismissedAutocompleteKey] = useState('')
  const [fileMentionResults, setFileMentionResults] = useState<ProjectFileSearchItem[]>([])
  const [composerSuggestionIndex, setComposerSuggestionIndex] = useState(0)
  /** 与 Electron Claude 设置对齐；Composer 展示此标签 / Mirrors Electron agent settings label shown in composer */
  const [globalDisplayModel, setGlobalDisplayModel] = useState('Claude Agent')
  const [homeComposerMode, setHomeComposerMode] = useState<'normal' | 'data-card-draft'>('normal')
  const [speechRecognitionStatus, setSpeechRecognitionStatus] = useState<SpeechRecognitionStatus>(
    window.desktop?.platform === 'darwin' ? 'idle' : 'unsupported',
  )

  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const permissionModePickerRef = useRef<HTMLDivElement>(null)
  const composerAutocompleteSurfaceRef = useRef<HTMLDivElement>(null)
  const modelPopoverAnchorRef = useRef<HTMLButtonElement>(null)
  const modelPopoverSurfaceRef = useRef<HTMLDivElement>(null)
  const permissionModePopoverAnchorRef = useRef<HTMLButtonElement>(null)
  const permissionModePopoverSurfaceRef = useRef<HTMLDivElement>(null)
  const todoButtonRef = useRef<HTMLButtonElement>(null)
  const todoPanelRef = useRef<HTMLDivElement>(null)
  const activeThreadIdRef = useRef(activeThread?.id ?? '')
  const threadScrollTopRef = useRef(new Map<string, number>())
  const chatRunRef = useRef<ChatRun | null>(null)
  if (!chatRunRef.current) chatRunRef.current = new ChatRun()
  const chatRun = chatRunRef.current

  /** Popover anchor avoids clipping by `.chat-composer` / fixed positioning avoids composer clipping */
  const [modelPopoverBox, setModelPopoverBox] = useState<{
    left: number
    bottom: number
    width: number
    maxHeight: number
  } | null>(null)
  const [permissionModePopoverBox, setPermissionModePopoverBox] = useState<{
    left: number
    bottom: number
    width: number
    maxHeight: number
  } | null>(null)
  const newThreadModelPick = projectHomeModelPick ?? projectDefaultModelPick
  const scrollIntentRef = useRef<'none' | 'force-bottom'>('none')
  /** 取消 / Esc 关闭编辑时抑制贴底，避免 ResizeObserver 误判 isNearBottom 把视口滚到底 */
  const suppressTranscriptResizeStickRef = useRef(false)
  const suppressTranscriptResizeStickTimerRef = useRef<number | null>(null)
  const searchHighlightTimerRef = useRef<number | null>(null)
  const isFirstTranscriptLayoutRef = useRef(true)
  const isRunningRef = useRef(false)
  const globalDisplayModelRef = useRef(globalDisplayModel)
  const currentModelPickRef = useRef<ChatModelPick | undefined>(undefined)
  const inputValueRef = useRef(inputValue)
  const composerSelectionRef = useRef(composerSelection)
  const speechDraftRangeRef = useRef<SpeechDraftRange | null>(null)
  const lastSpeechAppliedValueRef = useRef<string | null>(null)
  const ignoreSpeechRecognitionTextRef = useRef(false)
  const speechRecognitionGenerationRef = useRef<number | null>(null)
  const ignoredSpeechRecognitionGenerationsRef = useRef<Set<number>>(new Set())
  const speechRestartAfterEditRef = useRef(false)
  const speechRecognitionStatusRef = useRef(speechRecognitionStatus)
  const speechSettleWaitersRef = useRef<Array<() => void>>([])
  const submitComposerRef = useRef<(() => Promise<void>) | null>(null)

  const [composerAutocompleteBox, setComposerAutocompleteBox] = useState<{
    left: number
    bottom: number
    width: number
    maxHeight: number
  } | null>(null)
  const [todoPanelOpen, setTodoPanelOpen] = useState(false)

  const hasMessages = chatItems.length > 0
  const activeTaskState = activeThread?.chatState.tasks
  const visibleTaskItems = useMemo(
    () => (activeTaskState?.items ?? []).filter((task) => task.status !== 'deleted'),
    [activeTaskState?.items],
  )
  const hasVisibleTasks = visibleTaskItems.length > 0
  const activeUserInputPrompt = useMemo(() => {
    const activeThreadId = activeThread?.id ?? activeThreadIdRef.current
    if (!activeThreadId) return null
    return (
      pendingUserInputPrompts.find((prompt) => {
        const promptThreadId = prompt.threadId ?? chatRun.threadIdForRequest(prompt.requestId)
        return promptThreadId === activeThreadId
      }) ?? null
    )
  }, [activeThread?.id, chatRun, pendingUserInputPrompts])
  const permissionModeRows = useMemo(() => getPermissionModeRows(t), [t])
  const permissionModeLabel = permissionModeRows.find((row) => row.mode === permissionMode)?.label ?? t('chat.permissionModeAuto')
  const speechRecognitionSupported =
    window.desktop?.platform === 'darwin' &&
    Boolean(
      window.desktop?.startSpeechRecognition &&
        window.desktop?.stopSpeechRecognition &&
        window.desktop?.cancelSpeechRecognition &&
        window.desktop?.onSpeechRecognitionEvent,
    )
  const setThreadChatState = useCallback(
    (threadId: string, update: ChatState | ((prev: ChatState) => ChatState)) => {
      onThreadChatStateChange(threadId, update)
    },
    [onThreadChatStateChange],
  )
  const setSpeechStatus = useCallback((status: SpeechRecognitionStatus) => {
    speechRecognitionStatusRef.current = status
    setSpeechRecognitionStatus(status)
  }, [])
  const rememberSpeechRecognitionGeneration = useCallback((generation: number | undefined) => {
    if (typeof generation !== 'number') return
    speechRecognitionGenerationRef.current = generation
    const ignored = ignoredSpeechRecognitionGenerationsRef.current
    for (const value of ignored) {
      if (value < generation - 2) ignored.delete(value)
    }
  }, [])
  const ignoreCurrentSpeechRecognitionGeneration = useCallback(() => {
    const generation = speechRecognitionGenerationRef.current
    if (generation !== null) ignoredSpeechRecognitionGenerationsRef.current.add(generation)
  }, [])
  const shouldIgnoreSpeechRecognitionEvent = useCallback((generation: number | undefined) => {
    if (typeof generation !== 'number') return ignoreSpeechRecognitionTextRef.current
    if (ignoredSpeechRecognitionGenerationsRef.current.has(generation)) return true
    const currentGeneration = speechRecognitionGenerationRef.current
    return currentGeneration !== null && generation < currentGeneration
  }, [])
  const resolveSpeechRecognitionSettleWaiters = useCallback(() => {
    const waiters = speechSettleWaitersRef.current
    speechSettleWaitersRef.current = []
    waiters.forEach((resolve) => resolve())
  }, [])
  const waitForSpeechRecognitionSettle = useCallback((timeoutMs = 9500) => {
    return new Promise<void>((resolve) => {
      if (!ACTIVE_SPEECH_RECOGNITION_STATUSES.has(speechRecognitionStatusRef.current)) {
        resolve()
        return
      }

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        speechSettleWaitersRef.current = speechSettleWaitersRef.current.filter((item) => item !== finish)
        resolve()
      }
      const timeout = window.setTimeout(finish, timeoutMs)
      speechSettleWaitersRef.current = [...speechSettleWaitersRef.current, finish]
    })
  }, [])
  const setComposerDraftValue = useCallback((nextValue: string, selectionStart = nextValue.length, selectionEnd = selectionStart) => {
    const start = Math.max(0, Math.min(selectionStart, nextValue.length))
    const end = Math.max(start, Math.min(selectionEnd, nextValue.length))
    inputValueRef.current = nextValue
    composerSelectionRef.current = { start, end }
    setInputValue(nextValue)
    setComposerSelection({ start, end })
    if (!nextValue) setDismissedAutocompleteKey('')
  }, [])
  const beginSpeechDraft = useCallback(() => {
    const currentInput = inputValueRef.current
    const selection = composerSelectionRef.current
    const selectionStart = Math.max(0, Math.min(selection.start, currentInput.length))
    const selectionEnd = Math.max(selectionStart, Math.min(selection.end, currentInput.length))
    lastSpeechAppliedValueRef.current = currentInput
    speechDraftRangeRef.current = {
      start: selectionStart,
      end: selectionEnd,
      committedText: '',
      liveText: '',
    }
  }, [])
  const clearSpeechDraft = useCallback(() => {
    speechDraftRangeRef.current = null
    lastSpeechAppliedValueRef.current = null
  }, [])
  const clearComposerDraft = useCallback(() => {
    clearSpeechDraft()
    setComposerDraftValue('', 0, 0)
  }, [clearSpeechDraft, setComposerDraftValue])
  const discardSpeechDraftText = useCallback(() => {
    const draftRange = speechDraftRangeRef.current
    if (!draftRange) {
      clearSpeechDraft()
      return
    }

    const currentInput = inputValueRef.current
    const replacementStart = Math.max(0, Math.min(draftRange.start, currentInput.length))
    const replacementEnd = Math.max(replacementStart, Math.min(draftRange.end, currentInput.length))
    const nextValue = `${currentInput.slice(0, replacementStart)}${currentInput.slice(replacementEnd)}`
    clearSpeechDraft()
    setComposerDraftValue(nextValue, replacementStart, replacementStart)
  }, [clearSpeechDraft, setComposerDraftValue])
  const replaceSpeechDraftText = useCallback((text: string) => {
    const cleanText = text.trim()
    const currentInput = inputValueRef.current

    if (!speechDraftRangeRef.current) {
      beginSpeechDraft()
    }

    const draftRange = speechDraftRangeRef.current
    if (!draftRange) return false

    let committedText = draftRange.committedText
    let liveText = draftRange.liveText
    if (committedText && (cleanText.startsWith(committedText) || cleanText.includes(committedText))) {
      committedText = ''
      liveText = cleanText
    } else if (shouldStartNewSpeechSegment(liveText, cleanText)) {
      committedText = joinSpeechSegments(committedText, liveText)
      liveText = cleanText
    } else {
      liveText = cleanText
    }

    const draftText = joinSpeechSegments(committedText, liveText)

    const replacementStart = Math.max(0, Math.min(draftRange.start, currentInput.length))
    const replacementEnd = Math.max(replacementStart, Math.min(draftRange.end, currentInput.length))
    const before = currentInput.slice(0, replacementStart)
    const after = currentInput.slice(replacementEnd)
    const leadingSpace = needsSpeechSeparator(before, draftText) ? ' ' : ''
    const trailingSpace = needsSpeechSeparator(draftText, after) ? ' ' : ''
    const insertion = draftText ? `${leadingSpace}${draftText}${trailingSpace}` : ''
    const nextValue = `${before}${insertion}${after}`
    const nextCursor = before.length + insertion.length

    speechDraftRangeRef.current = {
      start: replacementStart,
      end: nextCursor,
      committedText,
      liveText,
    }
    inputValueRef.current = nextValue
    composerSelectionRef.current = { start: nextCursor, end: nextCursor }
    lastSpeechAppliedValueRef.current = nextValue
    setInputValue(nextValue)
    setComposerSelection({ start: nextCursor, end: nextCursor })
    requestAnimationFrame(() => {
      chatInputRef.current?.focus()
      chatInputRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
    return draftText.length > 0
  }, [beginSpeechDraft])
  const speechRecognitionErrorMessage = useCallback(
    (code: string, fallback: string) => {
      if (code === 'speech_denied') return t('chat.voiceSpeechDenied')
      if (code === 'microphone_denied') return t('chat.voiceMicrophoneDenied')
      if (code === 'on_device_unavailable') return t('chat.voiceOnDeviceUnavailable')
      if (code === 'helper_start_failed') return t('chat.voiceHelperStartFailed')
      return fallback || t('chat.voiceError')
    },
    [t],
  )

  // --- Agent context catalog (skills/agents for slash & @) / Agent 上下文目录（斜杠与 @ 联想数据来源） ---

  const refreshAgentContext = useCallback(async () => {
    const listAgentContext = window.desktop?.listAgentContext
    if (!listAgentContext) {
      setAgentContext(null)
      return
    }

    try {
      const result = await listAgentContext(activeProject.path)
      setAgentContext(result.ok ? result : null)
    } catch {
      setAgentContext(null)
    }
  }, [activeProject.path])

  // --- Effects: desktop IPC & settings sync / 副作用：桌面 IPC 与设置 ---

  useEffect(() => {
    void refreshAgentContext()
  }, [refreshAgentContext])

  useEffect(() => {
    chatRun.syncRunStates(threadRunStates)
  }, [chatRun, threadRunStates])

  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  useEffect(() => {
    composerSelectionRef.current = composerSelection
  }, [composerSelection])

  useEffect(() => {
    window.localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, permissionMode)
  }, [permissionMode])

  useEffect(() => {
    globalDisplayModelRef.current = globalDisplayModel
  }, [globalDisplayModel])

  useEffect(() => {
    setTodoPanelOpen(false)
  }, [activeThread?.id])

  useEffect(() => {
    if (!hasVisibleTasks) setTodoPanelOpen(false)
  }, [hasVisibleTasks])

  useEffect(() => {
    if (!todoPanelOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (todoPanelRef.current?.contains(target) || todoButtonRef.current?.contains(target)) return
      setTodoPanelOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTodoPanelOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [todoPanelOpen])

  useEffect(() => {
    if (!activeRunState) return
    onStatusChange(
      activeRunState.status === 'asking'
        ? t('chat.waitingForAnswer')
        : activeRunState.status === 'waiting'
          ? t('chat.waitingForPermission')
          : t('chat.statusProcessing'),
    )
  }, [activeRunState, onStatusChange, t])

  useEffect(() => {
    if (!speechRecognitionSupported) {
      setSpeechStatus('unsupported')
      return
    }

    let disposed = false
    window.desktop?.getSpeechRecognitionStatus?.()
      .then((snapshot) => {
        if (!disposed) {
          rememberSpeechRecognitionGeneration(snapshot.generation)
          setSpeechStatus(snapshot.status)
        }
      })
      .catch(() => {
        if (!disposed) setSpeechStatus('error')
    })

    const unsubscribe = window.desktop?.onSpeechRecognitionEvent?.((event) => {
      const hasGeneration = typeof event.generation === 'number'
      if (hasGeneration && shouldIgnoreSpeechRecognitionEvent(event.generation)) {
        if (event.type === 'final' || event.type === 'error') resolveSpeechRecognitionSettleWaiters()
        return
      }
      rememberSpeechRecognitionGeneration(event.generation)

      if (event.type === 'status') {
        setSpeechStatus(event.status)
        if (!ACTIVE_SPEECH_RECOGNITION_STATUSES.has(event.status)) {
          resolveSpeechRecognitionSettleWaiters()
        }
        if (event.status === 'requesting_permission') {
          onStatusChange(t('chat.voiceRequestingPermission'))
        } else if (event.status === 'listening') {
          ignoreSpeechRecognitionTextRef.current = false
          onStatusChange(t('chat.voiceListening'))
        } else if (event.status === 'transcribing') {
          onStatusChange(t('chat.voiceTranscribing'))
        }
        return
      }

      if (event.type === 'partial') {
        if (!hasGeneration && ignoreSpeechRecognitionTextRef.current) return
        replaceSpeechDraftText(event.text)
        return
      }

      if (event.type === 'final') {
        if (!hasGeneration && ignoreSpeechRecognitionTextRef.current) {
          resolveSpeechRecognitionSettleWaiters()
          return
        }
        if (event.text.trim()) {
          replaceSpeechDraftText(event.text)
          clearSpeechDraft()
          onStatusChange(t('chat.voiceInserted'))
        } else if (speechDraftRangeRef.current?.committedText || speechDraftRangeRef.current?.liveText) {
          clearSpeechDraft()
          onStatusChange(t('chat.voiceInserted'))
        } else {
          clearSpeechDraft()
          onStatusChange(t('chat.voiceNoSpeech'))
        }
        resolveSpeechRecognitionSettleWaiters()
        return
      }

      const message = speechRecognitionErrorMessage(event.code, event.message)
      ignoreSpeechRecognitionTextRef.current = false
      clearSpeechDraft()
      setSpeechStatus('error')
      resolveSpeechRecognitionSettleWaiters()
      onStatusChange(message)
    })

    return () => {
      disposed = true
      unsubscribe?.()
      resolveSpeechRecognitionSettleWaiters()
    }
  }, [
    clearSpeechDraft,
    rememberSpeechRecognitionGeneration,
    onStatusChange,
    replaceSpeechDraftText,
    resolveSpeechRecognitionSettleWaiters,
    setSpeechStatus,
    shouldIgnoreSpeechRecognitionEvent,
    speechRecognitionErrorMessage,
    speechRecognitionSupported,
    t,
  ])

  const applyGlobalModelFromSettings = useCallback(
    (snapshot: ClaudeAgentSettingsSnapshot) => {
      const settings = snapshot.settings
      const slots = {
        primary: t('chat.modelSlotPrimary'),
        haiku: t('chat.modelSlotHaiku'),
        sonnet: t('chat.modelSlotSonnet'),
        opus: t('chat.modelSlotOpus'),
      }

      setClaudeSettingsSnapshot(snapshot)
      setModelMenuRows(buildModelPickRows(settings.providers, slots, t('chat.modelFallback')))
    },
    [t],
  )

  useEffect(() => {
    if (!claudeSettingsSnapshot) return
    const settings = claudeSettingsSnapshot.settings
    const requestedPick = activeThread?.id ? activeThread.chatState.modelPick : newThreadModelPick
    const effectivePick = resolveEffectiveModelPick(settings, requestedPick)
    const row = modelRowForPick(modelMenuRows, effectivePick)
    const displayModel = row?.anthropicModelId ?? displayModelForPick(settings, effectivePick, t('chat.modelFallback'))
    const supportsImages = supportsImagesForPick(settings, effectivePick, false)
    currentModelPickRef.current = effectivePick
    setModelMenuSelectionKey(effectivePick ? modelPickKey(effectivePick) : '')
    setGlobalDisplayModel(displayModel)
    setActiveModelSupportsImages(supportsImages)
    if (!isRunningRef.current) {
      onStatusChange(compactModelName(displayModel, t))
    }
  }, [activeThread?.chatState.modelPick, activeThread?.id, claudeSettingsSnapshot, modelMenuRows, newThreadModelPick, onStatusChange, t])

  useEffect(() => {
    setHomeComposerMode('normal')
  }, [homeModeResetKey])

  useEffect(() => {
    window.claudeChat?.getSettings().then(applyGlobalModelFromSettings).catch(() => {
      /* 浏览器独立预览可能没有 Electron 桥接 / Browser preview may run without the Electron bridge */
    })

    const onSettingsChanged = (event: Event) => {
      applyGlobalModelFromSettings((event as CustomEvent<ClaudeAgentSettingsSnapshot>).detail)
    }
    window.addEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [applyGlobalModelFromSettings])

  // --- Composer autocomplete: slash commands, @mentions, debounced file search / 输入框联想：斜杠、@ 与防抖文件搜索 ---

  const activeComposerTrigger = useMemo(
    () => getComposerTrigger(inputValue, composerSelection.start, composerSelection.end),
    [composerSelection.end, composerSelection.start, inputValue],
  )
  const activeAutocompleteKey = activeComposerTrigger
    ? `${activeComposerTrigger.kind}:${activeComposerTrigger.start}:${activeComposerTrigger.query}`
    : ''
  const composerSuggestions = useMemo(
    () => buildComposerSuggestions(activeComposerTrigger, agentContext, fileMentionResults, t),
    [activeComposerTrigger, agentContext, fileMentionResults, t],
  )
  const composerAutocompleteOpen =
    Boolean(activeComposerTrigger) &&
    activeAutocompleteKey !== dismissedAutocompleteKey &&
    composerSuggestions.length > 0

  useEffect(() => {
    setComposerSuggestionIndex(0)
  }, [activeAutocompleteKey])

  useEffect(() => {
    if (activeComposerTrigger?.kind !== 'mention') {
      setFileMentionResults([])
      return
    }

    const query = activeComposerTrigger.query
    const searchSession = projectContent.createSearchSession()
    const timer = window.setTimeout(() => {
      searchSession.search({
        rootPath: activeProject.path,
        query,
        onResult: (result) => setFileMentionResults(result.ok ? result.items : []),
      })
    }, 90)

    return () => {
      window.clearTimeout(timer)
      searchSession.dispose()
    }
  }, [activeComposerTrigger, activeProject.path])

  useLayoutEffect(() => {
    if (!composerAutocompleteOpen || !chatInputRef.current) {
      setComposerAutocompleteBox(null)
      return
    }

    const gap = 8
    const pad = 8
    const maxListPx = 320

    const sync = () => {
      const input = chatInputRef.current
      if (!input) return
      const composer = input.closest('.chat-composer') ?? input
      const r = composer.getBoundingClientRect()
      const width = Math.min(Math.max(r.width, 280), window.innerWidth - pad * 2)
      let left = r.left
      if (left + width > window.innerWidth - pad) left = window.innerWidth - pad - width
      if (left < pad) left = pad
      const bottom = window.innerHeight - r.top + gap
      const maxHeight = Math.min(maxListPx, Math.max(120, r.top - pad - gap))
      setComposerAutocompleteBox({ left, bottom, width, maxHeight })
    }

    sync()
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, true)
    }
  }, [composerAutocompleteOpen, composerSuggestions.length])

  useEffect(() => {
    if (!composerAutocompleteOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const t = event.target as Node | null
      if (!t) return
      if (chatInputRef.current?.contains(t)) return
      if (composerAutocompleteSurfaceRef.current?.contains(t)) return
      setDismissedAutocompleteKey(activeAutocompleteKey)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [activeAutocompleteKey, composerAutocompleteOpen])

  // --- Model & permission pickers: floating position + click-outside / 模型与权限选择器：浮层定位与点击外部关闭 ---

  const pickChatMenuRow = useCallback(async (row: ChatModelMenuRow) => {
    if (isRunningRef.current) return
    const pick = modelPickFromRow(row)
    if (activeThread?.id) {
      currentModelPickRef.current = pick
      setThreadChatState(activeThread.id, (prev) => {
        const changed = !sameModelPick(prev.modelPick, pick)
        return {
          ...prev,
          model: pick.anthropicModel,
          modelPick: pick,
          sessionId: changed ? undefined : prev.sessionId,
        }
      })
      setModelMenuSelectionKey(row.pickKey)
      setGlobalDisplayModel(pick.anthropicModel)
      setActiveModelSupportsImages(row.supportsImages)
      setModelPickerOpen(false)
      return
    }

    onProjectHomeModelPickChange(activeProject.id, pick)
    currentModelPickRef.current = pick
    setModelMenuSelectionKey(row.pickKey)
    setGlobalDisplayModel(pick.anthropicModel)
    setActiveModelSupportsImages(row.supportsImages)
    setModelPickerOpen(false)
  }, [activeProject.id, activeThread?.id, onProjectHomeModelPickChange, setThreadChatState])

  useLayoutEffect(() => {
    if (!modelPickerOpen || !modelPopoverAnchorRef.current) {
      setModelPopoverBox(null)
      return
    }
    const gap = 6
    const pad = 8
    const maxListPx = 280

    const sync = () => {
      const anchor = modelPopoverAnchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const spaceAbove = r.top - pad
      const maxH = Math.min(maxListPx, Math.max(100, spaceAbove))
      const minWidth = Math.max(r.width, 248)
      const vw = window.innerWidth
      let width = Math.min(Math.max(minWidth, 260), vw - pad * 2)
      /** 右上角与按钮右上角对齐（面板右边贴按钮右边），再水平夹紧避免出屏 */
      let left = r.right - width
      if (left < pad) left = pad
      if (left + width > vw - pad) left = vw - pad - width
      const bottom = window.innerHeight - r.top + gap
      setModelPopoverBox({ left, bottom, width, maxHeight: maxH })
    }

    sync()
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, true)
    }
  }, [modelPickerOpen, modelMenuRows.length])

  useLayoutEffect(() => {
    if (!permissionModeOpen || !permissionModePopoverAnchorRef.current) {
      setPermissionModePopoverBox(null)
      return
    }
    const gap = 6
    const pad = 8
    const maxListPx = 260

    const sync = () => {
      const anchor = permissionModePopoverAnchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const spaceAbove = r.top - pad
      const maxH = Math.min(maxListPx, Math.max(120, spaceAbove))
      const minWidth = Math.max(r.width, 248)
      const vw = window.innerWidth
      let width = Math.min(Math.max(minWidth, 280), vw - pad * 2)
      let left = r.left
      if (left + width > vw - pad) left = vw - pad - width
      if (left < pad) left = pad
      const bottom = window.innerHeight - r.top + gap
      setPermissionModePopoverBox({ left, bottom, width, maxHeight: maxH })
    }

    sync()
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, true)
    }
  }, [permissionModeOpen, permissionModeRows.length])

  useEffect(() => {
    if (!modelPickerOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const t = event.target as Node | null
      if (!t) return
      if (modelPickerRef.current?.contains(t)) return
      if (modelPopoverSurfaceRef.current?.contains(t)) return
      setModelPickerOpen(false)
    }
    const onKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') setModelPickerOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [modelPickerOpen])

  useEffect(() => {
    if (!permissionModeOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const t = event.target as Node | null
      if (!t) return
      if (permissionModePickerRef.current?.contains(t)) return
      if (permissionModePopoverSurfaceRef.current?.contains(t)) return
      setPermissionModeOpen(false)
    }
    const onKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') setPermissionModeOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [permissionModeOpen])

  // --- Transcript region: stick to bottom, resize observer, “scroll to latest” chip / 会话区：吸底、ResizeObserver、回到底部按钮 ---

  const syncScrollButtonVisibility = useCallback(() => {
    const sr = scrollRegionRef.current
    if (!sr || sr.hidden) {
      setShowScrollButton(false)
      return
    }
    setShowScrollButton((prev) => shouldShowScrollToBottom(sr, prev))
  }, [])

  const saveActiveThreadScrollTop = useCallback(() => {
    const threadId = activeThreadIdRef.current
    const sr = scrollRegionRef.current
    if (!threadId || !sr) return
    threadScrollTopRef.current.set(threadId, sr.scrollTop)
  }, [])

  const restoreThreadScrollTop = useCallback(
    (threadId: string) => {
      const sr = scrollRegionRef.current
      const savedTop = threadScrollTopRef.current.get(threadId)
      if (!sr || savedTop === undefined) return false
      const maxTop = Math.max(0, sr.scrollHeight - sr.clientHeight)
      const previousScrollBehavior = sr.style.scrollBehavior
      sr.style.scrollBehavior = 'auto'
      sr.scrollTop = Math.min(savedTop, maxTop)
      sr.style.scrollBehavior = previousScrollBehavior
      syncScrollButtonVisibility()
      return true
    },
    [syncScrollButtonVisibility],
  )

  useLayoutEffect(() => {
    return () => saveActiveThreadScrollTop()
  }, [activeThread?.id, saveActiveThreadScrollTop])

  useEffect(() => {
    const nextThreadId = activeThread?.id ?? ''
    const hasSavedScrollTop = nextThreadId ? threadScrollTopRef.current.has(nextThreadId) : false
    activeThreadIdRef.current = nextThreadId
    isFirstTranscriptLayoutRef.current = true
    scrollIntentRef.current = hasSavedScrollTop ? 'none' : 'force-bottom'
    setShowScrollButton(false)
    setModelPickerOpen(false)
    pendingAttachmentsRef.current = []
    setPendingAttachments([])

    let frame = 0
    if (hasSavedScrollTop) {
      frame = window.requestAnimationFrame(() => {
        restoreThreadScrollTop(nextThreadId)
      })
    }

    window.claudeChat?.getSettings().then(applyGlobalModelFromSettings).catch(() => {
      /* 浏览器独立预览可能没有 Electron 桥接 / Browser preview may run without the Electron bridge */
    })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [activeThread?.id, activeProject.id, applyGlobalModelFromSettings, restoreThreadScrollTop])

  const suppressTranscriptResizeStick = useCallback((durationMs = 320) => {
    suppressTranscriptResizeStickRef.current = true
    if (suppressTranscriptResizeStickTimerRef.current !== null) {
      window.clearTimeout(suppressTranscriptResizeStickTimerRef.current)
    }
    suppressTranscriptResizeStickTimerRef.current = window.setTimeout(() => {
      suppressTranscriptResizeStickRef.current = false
      suppressTranscriptResizeStickTimerRef.current = null
    }, durationMs)
  }, [])

  const notifyUserMessageEditDismissed = useCallback(() => {
    suppressTranscriptResizeStick(280)
  }, [suppressTranscriptResizeStick])

  useEffect(() => {
    const onProcessTraceToggle = () => suppressTranscriptResizeStick(360)
    window.addEventListener(PROCESS_TRACE_TOGGLE_EVENT, onProcessTraceToggle)
    return () => window.removeEventListener(PROCESS_TRACE_TOGGLE_EVENT, onProcessTraceToggle)
  }, [suppressTranscriptResizeStick])

  useEffect(() => {
    return () => {
      if (suppressTranscriptResizeStickTimerRef.current !== null) {
        window.clearTimeout(suppressTranscriptResizeStickTimerRef.current)
      }
      if (searchHighlightTimerRef.current !== null) {
        window.clearTimeout(searchHighlightTimerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    const sr = scrollRegionRef.current
    if (!sr || !hasMessages) {
      isFirstTranscriptLayoutRef.current = false
      setShowScrollButton(false)
      return
    }
    const transcriptEl = sr.querySelector('.chat-transcript')
    if (transcriptEl?.querySelector('.chat-message-edit')) {
      scrollIntentRef.current = 'none'
      syncScrollButtonVisibility()
      return
    }
    if (suppressTranscriptResizeStickRef.current) {
      scrollIntentRef.current = 'none'
      syncScrollButtonVisibility()
      return
    }
    const activeThreadId = activeThread?.id ?? ''
    const hasSavedScrollTop = activeThreadId ? threadScrollTopRef.current.has(activeThreadId) : false
    let stick = scrollIntentRef.current === 'force-bottom' || isNearBottom(sr)
    if (isFirstTranscriptLayoutRef.current) {
      if (hasSavedScrollTop && restoreThreadScrollTop(activeThreadId)) {
        scrollIntentRef.current = 'none'
        isFirstTranscriptLayoutRef.current = false
        return
      }
      stick = true
      isFirstTranscriptLayoutRef.current = false
    }
    scrollIntentRef.current = 'none'
    if (stick) {
      sr.scrollTo({ top: sr.scrollHeight, behavior: 'auto' })
      saveActiveThreadScrollTop()
      setShowScrollButton(false)
    } else {
      syncScrollButtonVisibility()
    }
  }, [activeThread?.chatState, activeThread?.id, hasMessages, restoreThreadScrollTop, saveActiveThreadScrollTop, syncScrollButtonVisibility])

  useEffect(() => {
    const sr = scrollRegionRef.current
    if (!sr) return
    const onScroll = () => {
      if (!chatItems.length) return
      saveActiveThreadScrollTop()
      syncScrollButtonVisibility()
    }
    sr.addEventListener('scroll', onScroll, { passive: true })
    return () => sr.removeEventListener('scroll', onScroll)
  }, [chatItems.length, saveActiveThreadScrollTop, syncScrollButtonVisibility])

  useEffect(() => {
    const sr = scrollRegionRef.current
    const transcript = sr?.querySelector('.chat-transcript')
    if (!sr || !transcript || !hasMessages) return

    const ro = new ResizeObserver(() => {
      if (transcript.querySelector('.chat-message-edit')) {
        syncScrollButtonVisibility()
        return
      }
      if (suppressTranscriptResizeStickRef.current) {
        syncScrollButtonVisibility()
        return
      }
      if (scrollIntentRef.current === 'force-bottom' || isNearBottom(sr)) {
        sr.scrollTo({ top: sr.scrollHeight, behavior: 'auto' })
        setShowScrollButton(false)
        return
      }
      syncScrollButtonVisibility()
    })
    ro.observe(transcript)
    return () => ro.disconnect()
  }, [hasMessages, syncScrollButtonVisibility])

  // --- Composer `<textarea>` auto height (cap 180px) / 输入框自适应高度（上限 180px）---

  const resizeComposer = useCallback(() => {
    const ta = chatInputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
  }, [])

  useLayoutEffect(() => {
    resizeComposer()
  }, [inputValue, resizeComposer])

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const sr = scrollRegionRef.current
    if (!sr) return
    const threadId = activeThreadIdRef.current
    const targetTop = Math.max(0, sr.scrollHeight - sr.clientHeight)
    sr.scrollTo({ top: sr.scrollHeight, behavior })
    if (threadId) threadScrollTopRef.current.set(threadId, targetTop)
    setShowScrollButton(false)
  }, [])

  // --- Chat Run adapter / Chat Run 的 React adapter ---

  const getActiveSubmitTarget = useCallback((): SubmitPromptTarget | undefined => {
    if (!activeThread) return undefined
    const projectForThread = projects.find((project) => project.id === activeThread.projectId) ?? activeProject
    return {
      threadId: activeThread.id,
      project: projectForThread,
      promptMode: promptModeForThreadPurpose(activeThread.purpose),
    }
  }, [activeProject, activeThread, projects])

  const applyChatRunTransition = useCallback(
    (transition: ChatRunTransition) => {
      if (transition.updateState) {
        const applyState = () => setThreadChatState(transition.threadId, transition.updateState!)
        if (transition.flush) flushSync(applyState)
        else applyState()
      }
      if (transition.clearCompletion) {
        onThreadCompletionStateChange(transition.threadId, null)
      }
      if (transition.runState !== undefined) {
        onThreadRunStateChange(transition.threadId, transition.runState)
      }
      if (transition.prompt) {
        setPendingUserInputPrompts((prev) =>
          prev.some((item) => item.permissionRequestId === transition.prompt?.permissionRequestId)
            ? prev
            : [...prev, transition.prompt!],
        )
        if (activeThreadIdRef.current === transition.threadId) {
          onStatusChange(
            transition.prompt.type === 'ask_user_question'
              ? t('chat.waitingForAnswer')
              : t('chat.waitingForPermission'),
          )
        }
      }
      if (transition.removePromptsForRequest) {
        setPendingUserInputPrompts((prev) =>
          prev.filter((item) => item.requestId !== transition.removePromptsForRequest),
        )
      }
      if (transition.markCompleted) {
        onThreadCompletionStateChange(
          transition.threadId,
          activeThreadIdRef.current === transition.threadId ? null : Date.now(),
        )
      }
      if (transition.scrollToBottom && activeThreadIdRef.current === transition.threadId) {
        scrollIntentRef.current = 'force-bottom'
      }
      if (!transition.terminal) return
      if (!transition.threadId || activeThreadIdRef.current === transition.threadId) {
        if (transition.terminal.kind === 'result') {
          onStatusChange(compactModelName(globalDisplayModelRef.current, t))
        } else if (transition.terminal.kind === 'error') {
          onStatusChange(
            transition.terminal.code === 'missing_api_key'
              ? t('chat.missingApiKey')
              : t('chat.errorGeneric'),
          )
        } else {
          onStatusChange(t('chat.stoppedStatus'))
        }
      }
      if (transition.terminal.kind !== 'cancelled') playAgentDoneSound()
    },
    [onStatusChange, onThreadCompletionStateChange, onThreadRunStateChange, setThreadChatState, t],
  )

  // --- Fold every Agent event through the Chat Run interface / 所有 Agent 事件统一穿过 Chat Run interface ---

  const handleClaudeEvent = useCallback(
    (event: ClaudeChatEvent) => {
      applyChatRunTransition(
        chatRun.handleEvent(event, {
          activeThreadId: activeThreadIdRef.current,
          fallbackModel: globalDisplayModelRef.current,
          stoppedBody: t('chat.stoppedBody'),
        }),
      )
    },
    [applyChatRunTransition, chatRun, t],
  )

  useEffect(() => {
    const unsub = window.claudeChat?.onEvent((ev) => handleClaudeEvent(ev))
    return () => {
      unsub?.()
    }
  }, [handleClaudeEvent])

  // --- `submitPrompt`: optimistic user row, pending id → real `requestId`, bridge errors / 发送：乐观用户消息、pending id 对齐真实 requestId、桥接错误处理 ---

  const submitPrompt = async (
    rawText: string,
    target?: SubmitPromptTarget,
    attachmentsForSubmit: ClaudeChatAttachment[] = [],
  ) => {
    const text = rawText.trim()
    if (!text && attachmentsForSubmit.length === 0) return
    if (text.toLowerCase() === '/status' && attachmentsForSubmit.length === 0) {
      clearComposerDraft()
      window.dispatchEvent(new CustomEvent(OPEN_AGENT_STATUS_EVENT, { detail: { refresh: true } }))
      onStatusChange(t('chat.statusPanelOpened'))
      return
    }
    const isLocalCompactCommand = text.toLowerCase() === '/compact' && attachmentsForSubmit.length === 0
    const projectForSubmit =
      target?.project ?? (activeThread ? projects.find((project) => project.id === activeThread.projectId) : undefined) ?? activeProject

    if (projectForSubmit.pathMissing) {
      onStatusChange(t('shell.projectPathMissingSubmitBlocked'))
      return
    }
    if (attachmentsForSubmit.some((attachment) => attachment.kind === 'image') && !activeModelSupportsImages) {
      onStatusChange(t('chat.imageInputDisabledStatus'))
      return
    }
    let submittingThreadId = target?.threadId ?? activeThreadIdRef.current
    let createdThreadModelPick: ChatModelPick | undefined
    if (!submittingThreadId) {
      const createdThreadId = onNewThread(projectForSubmit.id)
      if (!createdThreadId) return
      submittingThreadId = createdThreadId
      createdThreadModelPick = newThreadModelPick
      activeThreadIdRef.current = createdThreadId
      isFirstTranscriptLayoutRef.current = true
      scrollIntentRef.current = 'force-bottom'
    }
    const submittingThread = threads.find((thread) => thread.id === submittingThreadId)
    const settings = claudeSettingsSnapshot?.settings
    const modelPickForSubmit =
      target?.modelPick ??
      (settings
        ? resolveEffectiveModelPick(settings, submittingThread?.chatState.modelPick ?? createdThreadModelPick ?? currentModelPickRef.current)
        : currentModelPickRef.current)
    const modelPickChanged = !sameModelPick(submittingThread?.chatState.modelPick, modelPickForSubmit)
    const resumeSessionId = target?.resetSession || modelPickChanged
      ? undefined
      : submittingThread?.chatState.sessionId
    const handoffContext =
      !resumeSessionId && submittingThread?.chatState.items.length
        ? buildHandoffContext(submittingThread.chatState.items)
        : undefined

    const promptMode = target?.promptMode ?? promptModeForThreadPurpose(submittingThread?.purpose)
    const submitAttempt = chatRun.submit({
      threadId: submittingThreadId,
      text,
      attachments: attachmentsForSubmit.map(toChatMessageAttachment),
      model: modelPickForSubmit?.anthropicModel,
      modelPick: modelPickForSubmit,
      clearSession: modelPickChanged,
      reuseUserMessageId: Boolean(target?.reuseUserMessageId || target?.suppressUserMessage || isLocalCompactCommand),
      bridgeUnavailableBody: t('chat.bridgeErrorBody'),
      submit: window.claudeChat
        ? () =>
            window.claudeChat!.submit({
              text,
              attachments: attachmentsForSubmit,
              threadId: submittingThreadId,
              modelPick: modelPickForSubmit,
              handoffContext,
              promptMode,
              sessionId: resumeSessionId,
              cwd: projectForSubmit.path,
              permissionMode,
            })
        : undefined,
    })
    if (!submitAttempt) return

    if (activeThreadIdRef.current === submittingThreadId) scrollIntentRef.current = 'force-bottom'
    if (!target?.suppressUserMessage && !isLocalCompactCommand) onThreadPromptSubmit(submittingThreadId, text)
    applyChatRunTransition(submitAttempt.startTransition)
    if (!target?.preserveComposerDraft) clearComposerDraft()
    if (attachmentsForSubmit.length > 0 || !target?.threadId) {
      pendingAttachmentsRef.current = []
      setPendingAttachments([])
    }
    onStatusChange(t('chat.statusProcessing'))

    const submitResult = await submitAttempt.result
    applyChatRunTransition(submitResult.transition)
    if (submitResult.status === 'bridge_unavailable') {
      onStatusChange(t('chat.bridgeUnavailableStatus'))
      return
    }
    if (submitResult.status === 'failed') {
      onStatusChange(t('chat.sendFailedStatus'))
    }
  }

  // --- Generative UI can dispatch follow-up user text / 生成式 UI 可派发后续用户文案 ---

  useEffect(() => {
    const submitWidgetMessage = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
      if (typeof text !== 'string' || !text.trim()) return
      void submitPrompt(text)
    }
    window.addEventListener('generative-ui:send-message', submitWidgetMessage)
    return () => window.removeEventListener('generative-ui:send-message', submitWidgetMessage)
  })

  // --- Transcript actions: clipboard + edit user message (branch & resubmit) / 消息区：剪贴板与编辑用户消息后重发 ---

  const copyMessage = useCallback(
    async (text: string) => {
      const ok = await writeClipboardText(text)
      onStatusChange(ok ? t('chat.copiedMessage') : t('chat.copyFailed'))
    },
    [onStatusChange, t],
  )

  const forkMessage = useCallback(
    (messageId: string) => {
      if (!activeThread) return
      const items = chatItems
      if (items.length === 0) return
      const idx = items.findIndex((item) => item.type === 'message' && item.id === messageId)
      if (idx < 0) return
      const forkedItems = items.slice(0, idx + 1).map((item) => structuredClone(item))
      const title = activeThread.title
      onForkThread(activeProject.id, forkedItems, title, activeThread.chatState.model, activeThread.chatState.modelPick)
    },
    [activeProject.id, activeThread, chatItems, onForkThread, t],
  )

  const editUserMessage = (messageId: string, text: string) => {
    if (isRunningRef.current) return
    const nextText = text.trim()
    if (!nextText) return

    const threadId = activeThreadIdRef.current
    if (!threadId) return

    const projectForSubmit =
      activeThread ? projects.find((project) => project.id === activeThread.projectId) ?? activeProject : activeProject

    const currentItems = threads.find((thread) => thread.id === threadId)?.chatState.items ?? activeThread?.chatState.items ?? []
    if (!currentItems.some((item) => item.type === 'message' && item.role === 'user' && item.id === messageId)) return

    const editedAt = Date.now()
    setThreadChatState(threadId, (prev) => {
      const idx = prev.items.findIndex((item) => item.type === 'message' && item.role === 'user' && item.id === messageId)
      if (idx < 0) return prev
      const item = prev.items[idx] as ChatMessageItem
      const nextItems = prev.items.slice(0, idx + 1)
      nextItems[idx] = {
        ...item,
        content: nextText,
        status: 'done',
        createdAt: item.createdAt ?? editedAt,
        completedAt: editedAt,
      }
      return {
        ...prev,
        sessionId: undefined,
        items: nextItems,
      }
    })

    scrollIntentRef.current = 'force-bottom'
    void (async () => {
      await window.claudeChat?.newThread(threadId)
      await submitPrompt(nextText, {
        threadId,
        project: projectForSubmit,
        reuseUserMessageId: messageId,
        resetSession: true,
      })
    })()
  }

  const revealMessage = useCallback(
    (messageId: string) => {
      const sr = scrollRegionRef.current
      if (!sr || !messageId) return false
      const node = sr.querySelector<HTMLElement>(`[data-transcript-item-id="${escapeCssAttributeValue(messageId)}"]`)
      if (!node) return false

      suppressTranscriptResizeStick(1400)
      scrollIntentRef.current = 'none'
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      node.classList.remove('is-search-highlight')
      void node.offsetWidth
      node.classList.add('is-search-highlight')

      if (searchHighlightTimerRef.current !== null) {
        window.clearTimeout(searchHighlightTimerRef.current)
      }
      searchHighlightTimerRef.current = window.setTimeout(() => {
        node.classList.remove('is-search-highlight')
        searchHighlightTimerRef.current = null
        syncScrollButtonVisibility()
      }, 1800)
      window.setTimeout(syncScrollButtonVisibility, 320)
      return true
    },
    [suppressTranscriptResizeStick, syncScrollButtonVisibility],
  )

  // --- `forwardRef`: tray / shell entrypoints call into here / `forwardRef`：托盘等外部入口调用的命令式 API ---

  useImperativeHandle(
    ref,
    () => ({
      startNewThread: async () => {
        const threadId = onNewThread()
        if (threadId) activeThreadIdRef.current = threadId
        const modelPick = newThreadModelPick ?? projectDefaultModelPick ?? currentModelPickRef.current
        if (threadId && modelPick) {
          setThreadChatState(threadId, (prev) => ({
            ...prev,
            model: modelPick.anthropicModel,
            modelPick,
          }))
        }
        scrollIntentRef.current = 'force-bottom'
        isFirstTranscriptLayoutRef.current = true
        onStatusChange(compactModelName(globalDisplayModelRef.current, t))
        clearComposerDraft()
        requestAnimationFrame(() => chatInputRef.current?.focus())
      },
      focusComposer: () => {
        requestAnimationFrame(() => chatInputRef.current?.focus())
      },
      insertComposerText: (text: string) => {
        const next = text.trim()
        if (!next) return
        const current = inputValueRef.current
        const separator = current.trim().length > 0 && !current.endsWith('\n') ? '\n' : ''
        const nextValue = `${current}${separator}${next}`
        clearSpeechDraft()
        setComposerDraftValue(nextValue, nextValue.length, nextValue.length)
        requestAnimationFrame(() => chatInputRef.current?.focus())
      },
      setComposerText: (text: string) => {
        const next = text.trim()
        clearSpeechDraft()
        setComposerDraftValue(next, next.length, next.length)
        requestAnimationFrame(() => chatInputRef.current?.focus())
      },
      submitComposerDraft: async () => {
        if (!inputValueRef.current.trim()) return false
        const submit = submitComposerRef.current
        if (!submit) return false
        await submit()
        return true
      },
      revealMessage,
      submitPromptInNewThread: async (projectId: string, prompt: string) => {
        const projectForSubmit = projects.find((project) => project.id === projectId)
        if (!projectForSubmit) return false
        const threadId = onNewThread(projectId)
        if (!threadId) return false

        activeThreadIdRef.current = threadId
        isFirstTranscriptLayoutRef.current = true
        scrollIntentRef.current = 'force-bottom'
        const modelPick = newThreadModelPick ?? projectDefaultModelPick ?? currentModelPickRef.current
        if (modelPick) {
          setThreadChatState(threadId, (prev) => ({ ...prev, model: modelPick.anthropicModel, modelPick }))
        }
        await submitPrompt(prompt, { threadId, project: projectForSubmit, modelPick })
        requestAnimationFrame(() => chatInputRef.current?.focus())
        return true
      },
      submitPromptInThread: async (
        projectId: string,
        threadId: string,
        prompt: string,
        options?: ClaudeChatSubmitPayload['promptMode'] | SubmitPromptOptions,
      ) => {
        const projectForSubmit = projects.find((project) => project.id === projectId)
        if (!projectForSubmit) return false

        const resolvedOptions: SubmitPromptOptions =
          typeof options === 'string' ? { promptMode: options } : options ?? {}
        activeThreadIdRef.current = threadId
        isFirstTranscriptLayoutRef.current = true
        scrollIntentRef.current = 'force-bottom'
        if (resolvedOptions.modelPick) {
          setThreadChatState(threadId, (prev) => ({
            ...prev,
            model: resolvedOptions.modelPick?.anthropicModel ?? prev.model,
            modelPick: resolvedOptions.modelPick,
            sessionId: sameModelPick(prev.modelPick, resolvedOptions.modelPick) ? prev.sessionId : undefined,
          }))
        }
        await submitPrompt(prompt, { threadId, project: projectForSubmit, ...resolvedOptions })
        requestAnimationFrame(() => chatInputRef.current?.focus())
        return true
      },
    }),
    [
      clearComposerDraft,
      clearSpeechDraft,
      newThreadModelPick,
      onNewThread,
      onStatusChange,
      projectDefaultModelPick,
      projects,
      revealMessage,
      setComposerDraftValue,
      setThreadChatState,
      t,
    ],
  )

  // --- Cancel streaming + answer permission / tool questions from modal / 停止生成；在弹窗中应答权限或工具提问 ---

  const cancelActiveRequest = async () => {
    const requestId = chatRun.runStateForThread(activeThread?.id ?? activeThreadIdRef.current)?.requestId
    if (!requestId || isPendingRequestId(requestId) || !window.claudeChat) return
    await window.claudeChat.cancel(requestId)
  }

  const resolveActiveUserInputPrompt = async (decision: UserInputDecision) => {
    const prompt = activeUserInputPrompt
    if (!prompt) return

    setPendingUserInputPrompts((prev) => prev.filter((item) => item.permissionRequestId !== prompt.permissionRequestId))
    const transition = chatRun.resumeAfterPrompt(
      prompt.requestId,
      prompt.threadId ?? activeThreadIdRef.current,
    )
    if (transition.runState !== undefined) {
      onThreadRunStateChange(transition.threadId, transition.runState)
    }
    if (!window.claudeChat) return
    await window.claudeChat.answerPermissionRequest({
      permissionRequestId: prompt.permissionRequestId,
      ...decision,
    })
  }

  // --- Composer attachments via picker, paste, and drag/drop / 通过选择、粘贴、拖拽添加附件 ---

  const applyComposerAttachmentResult = (result: ClaudeChatAttachmentPickerResult) => {
    if (!result.ok) {
      onStatusChange(result.message)
      return
    }

    if (result.attachments.length > 0) {
      const merged = mergeComposerAttachments(pendingAttachmentsRef.current, result.attachments)
      pendingAttachmentsRef.current = merged.attachments
      setPendingAttachments(merged.attachments)
      const first = result.skipped[0] ?? merged.skipped[0]
      if (first) {
        onStatusChange(t('chat.attachmentSkipped', { name: first.name, reason: first.reason }))
      }
      return
    }

    const first = result.skipped[0]
    if (first) {
      onStatusChange(t('chat.attachmentSkipped', { name: first.name, reason: first.reason }))
    }
  }

  const addComposerAttachments = async () => {
    const pickChatAttachments = window.desktop?.pickChatAttachments
    if (!pickChatAttachments || isRunningRef.current) {
      if (!pickChatAttachments) onStatusChange(t('chat.attachmentPickerUnavailable'))
      return
    }

    applyComposerAttachmentResult(await pickChatAttachments({ allowImages: activeModelSupportsImages }))
  }

  const addComposerAttachmentPaths = async (filePaths: string[]) => {
    const readChatAttachments = window.desktop?.readChatAttachments
    if (!readChatAttachments || isRunningRef.current || filePaths.length === 0) {
      if (!readChatAttachments) onStatusChange(t('chat.attachmentPickerUnavailable'))
      return
    }

    applyComposerAttachmentResult(await readChatAttachments(filePaths, { allowImages: activeModelSupportsImages }))
  }

  const addComposerClipboardImages = async (files: File[]) => {
    if (isRunningRef.current || files.length === 0) return

    if (!activeModelSupportsImages) {
      onStatusChange(t('chat.imageInputDisabledStatus'))
      return
    }

    const attachments: ClaudeChatAttachment[] = []
    const skipped: Array<{ name: string; path: string; reason: string }> = []
    for (const [index, file] of files.slice(0, MAX_COMPOSER_ATTACHMENTS).entries()) {
      const name = file.name || `pasted-image-${Date.now()}-${index + 1}.${imageExtensionForMimeType(file.type)}`
      if (!COMPOSER_PASTE_IMAGE_MIME_TYPES.has(file.type)) {
        skipped.push({ name, path: name, reason: '仅支持 PNG、JPG、GIF、WEBP' })
        continue
      }
      if (file.size > COMPOSER_PASTE_IMAGE_MAX_BYTES) {
        skipped.push({ name, path: name, reason: '图片超过 5MB' })
        continue
      }
      if (totalAttachmentBytes(attachments) + file.size > COMPOSER_ATTACHMENT_MAX_TOTAL_BYTES) {
        skipped.push({ name, path: name, reason: '附件总大小超过 24MB' })
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const base64 = dataUrl.split(',', 2)[1] ?? ''
        attachments.push({
          id: `attachment-${Date.now()}-${index}`,
          kind: 'image',
          name,
          path: `clipboard://${name}`,
          mimeType: file.type,
          size: file.size,
          base64,
          dataUrl,
          preview: formatBytes(file.size),
        })
      } catch (error) {
        skipped.push({ name, path: name, reason: error instanceof Error ? error.message : '读取失败' })
      }
    }
    if (files.length > MAX_COMPOSER_ATTACHMENTS) {
      for (const file of files.slice(MAX_COMPOSER_ATTACHMENTS)) {
        skipped.push({
          name: file.name || 'clipboard image',
          path: file.name || 'clipboard image',
          reason: `一次最多添加 ${MAX_COMPOSER_ATTACHMENTS} 个文件`,
        })
      }
    }

    applyComposerAttachmentResult({ ok: true, attachments, skipped })
  }

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    const files = dedupeFiles([...Array.from(event.clipboardData.files), ...itemFiles]).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    void addComposerClipboardImages(files)
  }

  const handleComposerDrop = (event: DragEvent<HTMLFormElement>) => {
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => getNativeFilePath(file))
      .filter((filePath): filePath is string => Boolean(filePath))
    if (filePaths.length === 0) return
    void addComposerAttachmentPaths(filePaths)
  }

  const removeComposerAttachment = (attachmentId: string) => {
    const next = pendingAttachmentsRef.current.filter((attachment) => attachment.id !== attachmentId)
    pendingAttachmentsRef.current = next
    setPendingAttachments(next)
  }

  const syncComposerSelection = useCallback(() => {
    const input = chatInputRef.current
    if (!input) return
    setComposerSelection({ start: input.selectionStart, end: input.selectionEnd })
  }, [])
  const focusComposerInput = useCallback(() => {
    const restoreFocus = () => {
      const input = chatInputRef.current
      if (!input) return
      const selection = composerSelectionRef.current
      const start = Math.max(0, Math.min(selection.start, input.value.length))
      const end = Math.max(start, Math.min(selection.end, input.value.length))
      input.focus({ preventScroll: true })
      input.setSelectionRange(start, end)
    }

    restoreFocus()
    requestAnimationFrame(restoreFocus)
  }, [])

  const insertComposerSuggestion = useCallback(
    (suggestion: ComposerSuggestion) => {
      if (!activeComposerTrigger) return
      const before = inputValue.slice(0, activeComposerTrigger.start)
      const after = inputValue.slice(activeComposerTrigger.end)
      const nextValue = `${before}${suggestion.insertText}${after}`
      const nextCursor = before.length + suggestion.insertText.length
      setInputValue(nextValue)
      setDismissedAutocompleteKey('')
      setComposerSelection({ start: nextCursor, end: nextCursor })
      requestAnimationFrame(() => {
        const input = chatInputRef.current
        if (!input) return
        input.focus()
        input.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [activeComposerTrigger, inputValue],
  )

  // --- Voice submit boundary + Home “data card” draft / 语音提交边界 + 首页「数据卡片」草稿 ---

  const cancelSpeechRecognitionDraft = useCallback(
    async (showStatus = true) => {
      ignoreSpeechRecognitionTextRef.current = true
      ignoreCurrentSpeechRecognitionGeneration()
      try {
        const result = await window.desktop?.cancelSpeechRecognition?.()
        discardSpeechDraftText()
        setSpeechStatus('idle')
        if (result && !result.ok) {
          setSpeechStatus(result.status)
          onStatusChange(result.message)
          return false
        }
        if (showStatus) onStatusChange(t('chat.voiceCancelled'))
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : t('chat.voiceError')
        clearSpeechDraft()
        setSpeechStatus('error')
        onStatusChange(message)
        return false
      } finally {
        resolveSpeechRecognitionSettleWaiters()
      }
    },
    [
      clearSpeechDraft,
      discardSpeechDraftText,
      ignoreCurrentSpeechRecognitionGeneration,
      onStatusChange,
      resolveSpeechRecognitionSettleWaiters,
      setSpeechStatus,
      t,
    ],
  )

  const finalizeSpeechRecognitionBeforeSubmit = useCallback(async () => {
    if (!speechRecognitionSupported) return true

    const status = speechRecognitionStatusRef.current
    if (!ACTIVE_SPEECH_RECOGNITION_STATUSES.has(status)) return true

    if (status === 'listening') {
      setSpeechStatus('transcribing')
      onStatusChange(t('chat.voiceTranscribing'))
      const settled = waitForSpeechRecognitionSettle()
      try {
        const result = await window.desktop?.stopSpeechRecognition?.()
        if (result && !result.ok) {
          setSpeechStatus(result.status)
          onStatusChange(result.message)
          resolveSpeechRecognitionSettleWaiters()
          return false
        }
        await settled
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : t('chat.voiceError')
        clearSpeechDraft()
        setSpeechStatus('error')
        resolveSpeechRecognitionSettleWaiters()
        onStatusChange(message)
        return false
      }
    }

    if (status === 'transcribing') {
      onStatusChange(t('chat.voiceTranscribing'))
      await waitForSpeechRecognitionSettle()
      return true
    }

    return cancelSpeechRecognitionDraft(false)
  }, [
    cancelSpeechRecognitionDraft,
    clearSpeechDraft,
    onStatusChange,
    resolveSpeechRecognitionSettleWaiters,
    setSpeechStatus,
    speechRecognitionSupported,
    t,
    waitForSpeechRecognitionSettle,
  ])

  const submitDataCardDraft = async (rawText = inputValueRef.current) => {
    const text = rawText.trim()
    if (!text) return
    const threadId = onCreateHomePluginCardThread(activeProject.id, text)
    if (!threadId) return
    activeThreadIdRef.current = threadId
    isFirstTranscriptLayoutRef.current = true
    scrollIntentRef.current = 'force-bottom'
    setHomeComposerMode('normal')
    await window.claudeChat?.newThread(threadId)
    await submitPrompt(buildDataCardPrompt(text, threadId), {
      threadId,
      project: activeProject,
      promptMode: 'home-plugin-card-customization',
    })
  }

  const submitComposer = async () => {
    const speechReady = await finalizeSpeechRecognitionBeforeSubmit()
    if (!speechReady) return

    const text = inputValueRef.current
    if (homeComposerMode === 'data-card-draft' && !hasMessages && !activeThread) {
      await submitDataCardDraft(text)
      return
    }
    await submitPrompt(text, getActiveSubmitTarget(), pendingAttachmentsRef.current)
  }
  submitComposerRef.current = submitComposer

  // --- Composer form + keyboard routing (autocomplete vs send) / 表单提交与键盘路由（联想优先于发送）---

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submitComposer()
  }

  const handleSendClick = (event: React.MouseEvent) => {
    if (!isRunning) return
    event.preventDefault()
    void cancelActiveRequest()
  }

  const restartSpeechRecognitionAfterManualEdit = useCallback(() => {
    if (
      !speechRecognitionSupported ||
      speechRecognitionStatus !== 'listening' ||
      speechRestartAfterEditRef.current
    ) {
      return
    }

    speechRestartAfterEditRef.current = true
    ignoreSpeechRecognitionTextRef.current = true
    ignoreCurrentSpeechRecognitionGeneration()
    setSpeechStatus('starting')
    onStatusChange(t('chat.voiceStarting'))

    void (async () => {
      try {
        await window.desktop?.cancelSpeechRecognition?.()
        clearSpeechDraft()
        beginSpeechDraft()
        const result = await window.desktop?.startSpeechRecognition?.({ requiresOnDevice: true })
        if (result && !result.ok) {
          ignoreSpeechRecognitionTextRef.current = false
          clearSpeechDraft()
          setSpeechStatus(result.status)
          onStatusChange(result.message)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('chat.voiceError')
        ignoreSpeechRecognitionTextRef.current = false
        clearSpeechDraft()
        setSpeechStatus('error')
        onStatusChange(message)
      } finally {
        speechRestartAfterEditRef.current = false
      }
    })()
  }, [
    beginSpeechDraft,
    clearSpeechDraft,
    ignoreCurrentSpeechRecognitionGeneration,
    onStatusChange,
    setSpeechStatus,
    speechRecognitionStatus,
    speechRecognitionSupported,
    t,
  ])

  const handleInputKeydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composerAutocompleteOpen && composerSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setComposerSuggestionIndex((index) => (index + 1) % composerSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setComposerSuggestionIndex((index) => (index - 1 + composerSuggestions.length) % composerSuggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const suggestion = composerSuggestions[composerSuggestionIndex] ?? composerSuggestions[0]
        if (event.key === 'Enter' && activeComposerTrigger && isComposerSuggestionAlreadyApplied(inputValue, activeComposerTrigger, suggestion)) {
          setDismissedAutocompleteKey(activeAutocompleteKey)
        } else {
          event.preventDefault()
          insertComposerSuggestion(suggestion)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedAutocompleteKey(activeAutocompleteKey)
        return
      }
    }

    if (event.key !== 'Enter' || event.shiftKey || isComposingText) return
    event.preventDefault()
    void submitComposer()
  }

  const toggleSpeechRecognition = useCallback(async () => {
    focusComposerInput()

    if (!speechRecognitionSupported) {
      onStatusChange(t('chat.voiceUnavailable'))
      return
    }

    const isActive = ACTIVE_SPEECH_RECOGNITION_STATUSES.has(speechRecognitionStatus)
    try {
      if (isActive) {
        if (speechRecognitionStatus === 'listening') {
          setSpeechStatus('transcribing')
          onStatusChange(t('chat.voiceTranscribing'))
          const result = await window.desktop?.stopSpeechRecognition?.()
          if (result && !result.ok) {
            setSpeechStatus(result.status)
            onStatusChange(result.message)
          }
          return
        }

        await cancelSpeechRecognitionDraft()
        return
      }

      setSpeechStatus('starting')
      beginSpeechDraft()
      onStatusChange(t('chat.voiceStarting'))
      const result = await window.desktop?.startSpeechRecognition?.({ requiresOnDevice: true })
      if (result && !result.ok) {
        clearSpeechDraft()
        setSpeechStatus(result.status)
        onStatusChange(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.voiceError')
      clearSpeechDraft()
      setSpeechStatus('error')
      onStatusChange(message)
    }
  }, [
    beginSpeechDraft,
    cancelSpeechRecognitionDraft,
    clearSpeechDraft,
    focusComposerInput,
    onStatusChange,
    setSpeechStatus,
    speechRecognitionStatus,
    speechRecognitionSupported,
    t,
  ])

  // --- File diff UX: mark reviewed + optional rewind via SDK / 文件 diff：标记已读与可选 SDK 回滚 ---

  const reviewFileChanges = useCallback(
    (item: ChatFileDiffItem) => {
      const threadId = item.threadId?.trim() || activeThreadIdRef.current
      setThreadChatState(threadId, (prev) => {
        const idx = prev.items.findIndex((it) => it.type === 'file_diff' && it.changeSetId === item.changeSetId)
        if (idx < 0) return prev
        const next = [...prev.items]
        const it = next[idx] as ChatFileDiffItem
        next[idx] = { ...it, status: 'reviewed', detail: undefined }
        return { ...prev, items: next }
      })
    },
    [setThreadChatState],
  )

  const rewindFileChanges = useCallback(
    async (item: ChatFileDiffItem) => {
      const threadId = item.threadId?.trim() || activeThreadIdRef.current
      const owningThread = threads.find((thread) => thread.id === threadId)
      const projectForThread = owningThread
        ? projects.find((project) => project.id === owningThread.projectId) ?? activeProject
        : activeProject
      if (!item.checkpointId || !window.claudeChat?.rewindFiles) {
        setThreadChatState(threadId, (prev) => updateFileDiffStatus(prev, item.changeSetId, 'error', t('chat.fileDiffUnavailable')))
        return
      }

      setThreadChatState(threadId, (prev) => updateFileDiffStatus(prev, item.changeSetId, 'captured', t('chat.fileDiffReverting')))
      const result = await window.claudeChat.rewindFiles({
        threadId,
        requestId: item.requestId,
        modelPick: owningThread?.chatState.modelPick ?? currentModelPickRef.current,
        changeSetId: item.changeSetId,
        checkpointId: item.checkpointId,
        cwd: projectForThread.path,
      })
      if (!result.ok) {
        setThreadChatState(threadId, (prev) => updateFileDiffStatus(prev, item.changeSetId, 'error', result.message || t('chat.fileDiffUnavailable')))
      }
    },
    [activeProject, projects, setThreadChatState, t, threads],
  )

  const composerContextUsage = useMemo(() => {
    const sessionId = activeThread?.chatState.sessionId?.trim()
    if (!sessionId || !agentStatusSnapshot?.contextUsage) return undefined
    if (agentStatusSnapshot.threadId !== activeThread?.id) return undefined
    if (agentStatusSnapshot.sessionId !== sessionId) return undefined
    return agentStatusSnapshot.contextUsage
  }, [activeThread?.chatState.sessionId, activeThread?.id, agentStatusSnapshot])

  const compactContext = useCallback(() => {
    const threadId = activeThread?.id
    const sessionId = activeThread?.chatState.sessionId?.trim()
    if (!threadId || !sessionId) {
      onStatusChange(t('chat.contextCompactNoSessionStatus'))
      return
    }
    const projectForThread = projects.find((project) => project.id === activeThread.projectId) ?? activeProject
    void submitPrompt('/compact', {
      threadId,
      project: projectForThread,
      modelPick: activeThread.chatState.modelPick ?? currentModelPickRef.current,
      suppressUserMessage: true,
      preserveComposerDraft: true,
    })
  }, [activeProject, activeThread, onStatusChange, projects, t])

  const handleUnsupportedContextCompact = useCallback(() => {
    onStatusChange(t('chat.contextCompactUnavailableStatus'))
  }, [onStatusChange, t])

  // --- Composer subtree (props-only; layout lives in `Composer.tsx`) / Composer 子树（仅传参；布局在 Composer 组件内）---

  const composer = (
    <Composer
      inputValue={inputValue}
      isRunning={isRunning}
      activeModelSupportsImages={activeModelSupportsImages}
      pendingAttachments={pendingAttachments}
      permissionMode={permissionMode}
      permissionModeLabel={permissionModeLabel}
      permissionModeRows={permissionModeRows}
      permissionModeOpen={permissionModeOpen}
      permissionModePopoverBox={permissionModePopoverBox}
      modelPickerOpen={modelPickerOpen}
      modelMenuRows={modelMenuRows}
      modelMenuSelectionKey={modelMenuSelectionKey}
      modelPopoverBox={modelPopoverBox}
      displayModelName={compactModelName(globalDisplayModel, t)}
      contextUsage={composerContextUsage}
      composerAutocompleteOpen={composerAutocompleteOpen}
      composerAutocompleteBox={composerAutocompleteBox}
      activeComposerTrigger={activeComposerTrigger}
      composerSuggestions={composerSuggestions}
      composerSuggestionIndex={composerSuggestionIndex}
      speechRecognitionSupported={speechRecognitionSupported}
      speechRecognitionStatus={speechRecognitionStatus}
      chatInputRef={chatInputRef}
      composerAutocompleteSurfaceRef={composerAutocompleteSurfaceRef}
      permissionModePickerRef={permissionModePickerRef}
      permissionModePopoverAnchorRef={permissionModePopoverAnchorRef}
      permissionModePopoverSurfaceRef={permissionModePopoverSurfaceRef}
      modelPickerRef={modelPickerRef}
      modelPopoverAnchorRef={modelPopoverAnchorRef}
      modelPopoverSurfaceRef={modelPopoverSurfaceRef}
      setPermissionMode={setPermissionMode}
      setPermissionModeOpen={setPermissionModeOpen}
      setModelPickerOpen={setModelPickerOpen}
      setComposerSuggestionIndex={setComposerSuggestionIndex}
      onInputChange={(value, selectionStart, selectionEnd) => {
        inputValueRef.current = value
        composerSelectionRef.current = { start: selectionStart, end: selectionEnd }
        if (speechDraftRangeRef.current && value !== lastSpeechAppliedValueRef.current) {
          clearSpeechDraft()
          restartSpeechRecognitionAfterManualEdit()
        }
        setInputValue(value)
        setComposerSelection({ start: selectionStart, end: selectionEnd })
        setDismissedAutocompleteKey('')
      }}
      onCompositionStart={() => setIsComposingText(true)}
      onCompositionEnd={() => setIsComposingText(false)}
      onInputKeyDown={handleInputKeydown}
      onInputPaste={handleComposerPaste}
      onSyncComposerSelection={syncComposerSelection}
      onFormSubmit={handleFormSubmit}
      onDropComposerFiles={handleComposerDrop}
      onSendClick={handleSendClick}
      onToggleSpeechRecognition={() => void toggleSpeechRecognition()}
      onAddComposerAttachments={() => void addComposerAttachments()}
      onCompactContext={compactContext}
      onCompactContextUnavailable={handleUnsupportedContextCompact}
      onRefreshContextUsage={() => onRefreshAgentStatus(false)}
      onRemoveComposerAttachment={removeComposerAttachment}
      onInsertComposerSuggestion={insertComposerSuggestion}
      onPickChatMenuRow={(row) => void pickChatMenuRow(row)}
    />
  )

  // --- Main render: active thread transcript vs empty “start” surface / 主渲染：有消息走会话轨，否则走起始视图 ---

  const showThreadView =
    hasMessages ||
    activeThread?.purpose === 'home-plugin-customization' ||
    activeThread?.purpose === 'home-plugin-card-customization' ||
    activeThread?.purpose === 'task-run' ||
    activeThread?.purpose === 'skill-run'

  return (
    <section
      className={`chat-page${showThreadView ? ' has-messages' : ''}`}
      id="panel-home"
      aria-label={t('chat.ariaPage')}
      hidden={hidden}
      aria-hidden={hidden}
    >
      {showThreadView ? (
        <ChatThreadView
          items={chatItems}
          isRunning={isRunning}
          activeRunState={activeRunState}
          composer={composer}
          scrollRegionRef={scrollRegionRef}
          showScrollButton={showScrollButton}
          onScrollToBottom={scrollToBottom}
          onCopyMessage={(text) => void copyMessage(text)}
          onForkMessage={forkMessage}
          onEditUserMessage={editUserMessage}
          onUserMessageEditDismissed={notifyUserMessageEditDismissed}
          onReviewFileChanges={reviewFileChanges}
          onRewindFileChanges={rewindFileChanges}
        />
      ) : (
        <ChatStartView
          project={activeProject}
          projects={projects}
          projectOrderIds={projectOrderIds}
          composer={composer}
          agentMode={agentMode}
          agentModeEnabled={agentModeEnabled}
          todoEnabled={todoEnabled}
          agentModeLoading={agentModeLoading}
          agentStatusSnapshot={agentStatusSnapshot}
          agentSettingsOpen={agentSettingsOpen}
          agentSettingsPanel={agentSettingsPanel}
          onOpenAgentSettings={onOpenAgentSettings}
          onAgentSettingsPanelChange={onAgentSettingsPanelChange}
          onCloseAgentSettings={onCloseAgentSettings}
          threads={threads.filter((thread) => thread.projectId === activeProject.id)}
          threadRunStates={threadRunStates}
          hiddenSkillPaths={hiddenSkillPaths}
          heading={homeComposerMode === 'data-card-draft' ? t('chat.dataCardDraftHeading') : undefined}
          onStartDataCardDraft={() => {
            setHomeComposerMode('data-card-draft')
            requestAnimationFrame(() => chatInputRef.current?.focus())
          }}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          onEditHomePluginCard={(item) => onEditHomePluginCard(activeProject.id, item)}
          onOpenProjectFile={onOpenProjectFile}
          onRunProjectSkill={onRunProjectSkill}
          onStopProjectSkillRun={onStopProjectSkillRun}
          onRefreshAgentStatus={onRefreshAgentStatus}
        />
      )}
      {showThreadView && hasVisibleTasks ? (
        <ThreadTodoFloatingPanel
          taskState={activeTaskState}
          buttonRef={todoButtonRef}
          panelRef={todoPanelRef}
          open={todoPanelOpen}
          onOpenChange={setTodoPanelOpen}
        />
      ) : null}
      {activeUserInputPrompt ? (
        <AgentInputPromptModal prompt={activeUserInputPrompt} onResolve={(decision) => void resolveActiveUserInputPrompt(decision)} />
      ) : null}
    </section>
  )
})

function ThreadTodoFloatingPanel({
  taskState,
  buttonRef,
  panelRef,
  open,
  onOpenChange,
}: {
  taskState: ChatTaskState | undefined
  buttonRef: RefObject<HTMLButtonElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const tasks = useMemo(() => (taskState?.items ?? []).filter((task) => task.status !== 'deleted'), [taskState?.items])
  if (tasks.length === 0) return null

  const completed = tasks.filter((task) => task.status === 'completed').length
  const activeTask = tasks.find((task) => task.status === 'in_progress')
  const progress = Math.round((completed / Math.max(1, tasks.length)) * 100)
  const buttonLabel = t('chat.todoPanelButton', { completed, total: tasks.length })

  return (
    <div className="thread-todo-floating">
      <button
        ref={buttonRef}
        type="button"
        className={`thread-todo-trigger${open ? ' is-open' : ''}${activeTask ? ' has-active-task' : ''}`}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls="thread-todo-panel"
        data-mm-label={buttonLabel}
        data-mm-aliases={t('chat.todoPanelTitle')}
        onClick={() => onOpenChange(!open)}
      >
        <IconInline name="checklist" />
        <span>{completed}/{tasks.length}</span>
      </button>
      {open ? (
        <section
          ref={panelRef}
          id="thread-todo-panel"
          className="thread-todo-panel"
          aria-label={t('chat.todoPanelTitle')}
        >
          <header className="thread-todo-panel__header">
            <div className="thread-todo-panel__title">
              <IconInline name="checklist" />
              <span>{t('chat.todoPanelTitle')}</span>
            </div>
            <span className="thread-todo-panel__count">{completed}/{tasks.length}</span>
          </header>
          <div className="thread-todo-panel__progress" aria-label={t('chat.todoPanelProgress', { completed, total: tasks.length })}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="thread-todo-panel__body">
            {tasks.map((task) => (
              <article key={task.id} className={`thread-todo-item thread-todo-item--${task.status}`}>
                <span className="thread-todo-item__marker" aria-hidden="true">
                  {task.status === 'completed' ? <IconInline name="check" /> : null}
                </span>
                <div className="thread-todo-item__copy">
                  <h3>{task.subject}</h3>
                  {task.status === 'in_progress' && task.activeForm ? <p>{task.activeForm}</p> : task.description ? <p>{task.description}</p> : null}
                </div>
                <span className="thread-todo-item__status">{taskStatusLabel(task.status, t)}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

// --- Module-level pure helpers (no React) / 模块级纯函数（无 React 依赖）---

function taskStatusLabel(status: ChatTaskItem['status'], t: (path: string, vars?: Record<string, string | number>) => string): string {
  if (status === 'in_progress') return t('chat.todoStatusInProgress')
  if (status === 'completed') return t('chat.todoStatusCompleted')
  return t('chat.todoStatusPending')
}

function getComposerTrigger(value: string, selectionStart: number, selectionEnd: number): ComposerTrigger | null {
  if (selectionStart !== selectionEnd) return null
  const beforeCursor = value.slice(0, selectionStart)
  const currentLineStart = beforeCursor.lastIndexOf('\n') + 1
  const currentLine = beforeCursor.slice(currentLineStart)
  const slashMatch = /^(\s*)\/([A-Za-z0-9_-]*)$/.exec(currentLine)
  if (slashMatch) {
    const slashOffset = currentLine.indexOf('/')
    return {
      kind: 'slash',
      query: slashMatch[2] ?? '',
      start: currentLineStart + slashOffset,
      end: selectionStart,
    }
  }

  const mentionMatch = /(^|[\s([{])@([^\s@]*)$/.exec(beforeCursor)
  if (!mentionMatch) return null
  return {
    kind: 'mention',
    query: mentionMatch[2] ?? '',
    start: selectionStart - (mentionMatch[2]?.length ?? 0) - 1,
    end: selectionStart,
  }
}

function buildComposerSuggestions(
  trigger: ComposerTrigger | null,
  catalog: AgentContextCatalog | null,
  fileResults: ProjectFileSearchItem[],
  t: (path: string, vars?: Record<string, string | number>) => string,
): ComposerSuggestion[] {
  if (!trigger) return []
  if (trigger.kind === 'slash') return buildSlashSuggestions(trigger.query, catalog, t)
  return buildMentionSuggestions(trigger.query, catalog, fileResults, t)
}

function buildSlashSuggestions(query: string, catalog: AgentContextCatalog | null, t: (path: string, vars?: Record<string, string | number>) => string): ComposerSuggestion[] {
  const normalizedQuery = normalizeSuggestionQuery(query)
  const builtIns: ComposerSuggestion[] = getBuiltInSlashCommands(t).map((command) => ({
    id: `slash-built-in-${command.command}`,
    kind: 'slash',
    title: `${command.title}${command.argumentHint ? ` ${command.argumentHint}` : ''}`,
    subtitle: `${t('chat.slashBuiltInPrefix')}${command.description}`,
    insertText: `${command.title} `,
    item: command,
  }))

  const skills: ComposerSuggestion[] = (catalog?.skills ?? []).map((skill) => ({
    id: `slash-${skill.path}`,
    kind: 'slash',
    title: `${skill.title}${skill.argumentHint ? ` ${skill.argumentHint}` : ''}`,
    subtitle: `${formatContextScope(skill.scope, t)} · ${formatContextSource(skill.source)} · ${skill.description || skill.relativePath}`,
    insertText: `${skill.title} `,
    item: skill,
  }))

  return builtIns
    .concat(skills)
    .filter((suggestion) =>
      matchesSuggestion(normalizedQuery, suggestion.title, suggestion.subtitle, suggestion.insertText),
    )
    .slice(0, MAX_COMPOSER_SUGGESTIONS)
}

function buildMentionSuggestions(
  query: string,
  catalog: AgentContextCatalog | null,
  fileResults: ProjectFileSearchItem[],
  t: (path: string, vars?: Record<string, string | number>) => string,
): ComposerSuggestion[] {
  const normalizedQuery = normalizeSuggestionQuery(query.replace(/^agent-/, ''))
  const files: ComposerSuggestion[] = fileResults.map((file) => ({
    id: `file-${file.path}`,
    kind: 'file',
    title: file.type === 'directory' ? `${file.relativePath}/` : file.relativePath,
    subtitle: file.type === 'directory' ? t('chat.mentionFileTypeDir') : t('chat.mentionFileTypeFile'),
    insertText: `${formatFileMention(file.relativePath, file.type)} `,
    item: file,
  }))

  const agents: ComposerSuggestion[] = (catalog?.agents ?? []).map((agent) => ({
    id: `agent-${agent.path}`,
    kind: 'agent',
    title: `@agent-${agent.name}`,
    subtitle: `${formatContextScope(agent.scope, t)} · ${formatContextSource(agent.source)} · ${agent.description || agent.relativePath}`,
    insertText: `@agent-${agent.name} `,
    item: agent,
  }))

  return files
    .concat(agents)
    .filter((suggestion) =>
      matchesSuggestion(normalizedQuery, suggestion.title, suggestion.subtitle, suggestion.insertText),
    )
    .slice(0, MAX_COMPOSER_SUGGESTIONS)
}

function matchesSuggestion(query: string, ...values: string[]): boolean {
  if (!query) return true
  return values.some((value) => normalizeSuggestionQuery(value).includes(query))
}

function normalizeSuggestionQuery(value: string): string {
  return value.trim().toLowerCase()
}

function isComposerSuggestionAlreadyApplied(
  value: string,
  trigger: ComposerTrigger,
  suggestion: ComposerSuggestion,
): boolean {
  const currentToken = value.slice(trigger.start, trigger.end).trim()
  const insertedToken = suggestion.insertText.trim()
  return currentToken.length > 0 && currentToken === insertedToken
}

function formatFileMention(relativePath: string, type: ProjectFileSearchItem['type']): string {
  const mentionPath = type === 'directory' ? `${relativePath.replace(/\/+$/u, '')}/` : relativePath
  if (!/[\s"']/u.test(mentionPath)) return `@${mentionPath}`
  return `@"${mentionPath.replace(/"/g, '\\"')}"`
}

function toChatMessageAttachment(attachment: ClaudeChatAttachment): ChatMessageAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    path: attachment.path,
    mimeType: attachment.mimeType,
    size: attachment.size,
    preview: attachment.preview,
    dataUrl: attachment.dataUrl,
  }
}

function updateFileDiffStatus(
  state: ChatState,
  changeSetId: string,
  status: ChatFileDiffItem['status'],
  detail?: string,
): ChatState {
  const idx = state.items.findIndex((it) => it.type === 'file_diff' && it.changeSetId === changeSetId)
  if (idx < 0) return state
  const next = [...state.items]
  const it = next[idx] as ChatFileDiffItem
  next[idx] = { ...it, status, detail }
  return { ...state, items: next }
}

const HANDOFF_MAX_MESSAGES = 18
const HANDOFF_MAX_CHARS = 12_000

function buildHandoffContext(items: TranscriptItem[]): string | undefined {
  const messages = items
    .filter((item): item is ChatMessageItem => item.type === 'message' && Boolean(item.content.trim()))
    .slice(-HANDOFF_MAX_MESSAGES)
  if (!messages.length) return undefined

  const lines = messages.map((message) => {
    const attachments = message.attachments?.length
      ? `\n附件：${message.attachments.map((item) => `${item.name} (${item.kind})`).join(', ')}`
      : ''
    return `${message.role === 'user' ? '用户' : '助手'}：${message.content.trim()}${attachments}`
  })
  const omitted = messages.length < items.filter((item) => item.type === 'message').length
    ? ['较早的对话内容已省略。', '']
    : []
  const text = ['以下是当前 thread 的精简历史上下文，用于在新模型 session 中延续对话。', '', ...omitted, ...lines].join('\n')
  return text.length > HANDOFF_MAX_CHARS
    ? `${text.slice(-HANDOFF_MAX_CHARS)}\n\n（历史上下文已按长度截断。）`
    : text
}

function formatContextScope(scope: 'user' | 'project', t: (path: string, vars?: Record<string, string | number>) => string): string {
  return scope === 'user' ? t('chat.scopeUser') : t('chat.scopeProject')
}

function formatContextSource(source: AgentContextSource): string {
  if (source === 'claude') return '.claude'
  if (source === 'agent') return '.agent'
  if (source === 'agents') return '.agents'
  return '.cursor'
}

function readStoredPermissionMode(): ClaudePermissionMode {
  const stored = window.localStorage.getItem(PERMISSION_MODE_STORAGE_KEY)
  return isClaudePermissionMode(stored) ? stored : 'auto'
}


function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
  return value === 'plan' || value === 'auto' || value === 'default' || value === 'acceptEdits' || value === 'bypassPermissions'
}

function getPermissionModeRows(t: (path: string, vars?: Record<string, string | number>) => string): PermissionModeRow[] {
  return [
    {
      mode: 'default',
      label: t('chat.permissionModeDefault'),
      description: t('chat.permissionModeDefaultDesc'),
    },
    {
      mode: 'auto',
      label: t('chat.permissionModeAuto'),
      description: t('chat.permissionModeAutoDesc'),
    },
    {
      mode: 'acceptEdits',
      label: t('chat.permissionModeAcceptEdits'),
      description: t('chat.permissionModeAcceptEditsDesc'),
    },
    {
      mode: 'plan',
      label: t('chat.permissionModePlan'),
      description: t('chat.permissionModePlanDesc'),
    },
    {
      mode: 'bypassPermissions',
      label: t('chat.permissionModeFull'),
      description: t('chat.permissionModeFullDesc'),
    },
  ]
}

function compactModelName(model: string, t: (path: string, vars?: Record<string, string | number>) => string): string {
  if (!/^claude-/i.test(model)) return model || t('chat.modelFallback')

  return model
    .replace(/^claude-/i, '')
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, (letter) => letter.toUpperCase())
}

function isPendingRequestId(requestId: string): boolean {
  return requestId.startsWith('pending-')
}

function playAgentDoneSound(): void {
  if (typeof window === 'undefined') return
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return

  try {
    const ctx = new AudioContextCtor()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const notes = [660, 880]

    notes.forEach((frequency, index) => {
      const start = now + index * 0.11
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.2)
    })

    window.setTimeout(() => void ctx.close(), 700)
  } catch {
    /* Some systems block Web Audio until the next user gesture. */
  }
}

/** 贴底跟随：距底部小于此值视为在底部 */
const SCROLL_STICK_THRESHOLD_PX = 96
/** 滞后显示：向上滚过此距离后才出现按钮，避免临界抖动 */
const SCROLL_SHOW_BUTTON_PX = 120
/** 滞后隐藏：回到距底部此距离内才隐藏 */
const SCROLL_HIDE_BUTTON_PX = 48
/** 内容至少高出可视区这么多才视为可滚动 */
const SCROLL_OVERFLOW_MIN_PX = 8

function getScrollMetrics(scrollRegion: HTMLElement) {
  const overflow = scrollRegion.scrollHeight - scrollRegion.clientHeight
  const remaining = scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight
  return { overflow, remaining }
}

function isScrollable(scrollRegion: HTMLElement): boolean {
  if (scrollRegion.hidden) return false
  return getScrollMetrics(scrollRegion).overflow > SCROLL_OVERFLOW_MIN_PX
}

function isNearBottom(
  scrollRegion: HTMLElement,
  threshold = SCROLL_STICK_THRESHOLD_PX,
): boolean {
  if (scrollRegion.hidden) return true
  if (!isScrollable(scrollRegion)) return true
  return getScrollMetrics(scrollRegion).remaining < threshold
}

function shouldShowScrollToBottom(scrollRegion: HTMLElement, currentlyShown: boolean): boolean {
  if (scrollRegion.hidden || !isScrollable(scrollRegion)) return false
  const { remaining } = getScrollMetrics(scrollRegion)
  if (currentlyShown) return remaining > SCROLL_HIDE_BUTTON_PX
  return remaining > SCROLL_SHOW_BUTTON_PX
}
