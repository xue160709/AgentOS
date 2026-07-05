import type {
  SpeechRecognitionEvent,
  SpeechRecognitionStatus,
  VoiceCommandExecutionResult,
} from './desktop-types'

export type VoiceUiState = {
  status: SpeechRecognitionStatus
  partialText: string
  finalText: string
  result: VoiceCommandExecutionResult | null
  error: string
  permissionHint: string
  submittingId: string | null
}

export const ACTIVE_SPEECH_STATUSES = new Set<SpeechRecognitionStatus>([
  'starting',
  'requesting_permission',
  'listening',
  'transcribing',
])

export function createInitialVoiceUiState(): VoiceUiState {
  return {
    status: 'idle',
    partialText: '',
    finalText: '',
    result: null,
    error: '',
    permissionHint: '',
    submittingId: null,
  }
}

export function isSpeechRecordingStatus(status: SpeechRecognitionStatus): boolean {
  return ACTIVE_SPEECH_STATUSES.has(status)
}

export function selectVoiceCommandText(state: Pick<VoiceUiState, 'finalText' | 'partialText'>): string {
  return state.finalText.trim() || state.partialText.trim()
}

export function reduceSpeechEvent(state: VoiceUiState, event: SpeechRecognitionEvent): VoiceUiState {
  if (event.type === 'status') {
    return { ...state, status: event.status, error: event.status === 'error' ? state.error : '' }
  }
  if (event.type === 'partial') {
    return { ...state, partialText: event.text, error: '' }
  }
  if (event.type === 'final') {
    return { ...state, finalText: event.text, partialText: '', status: 'idle', error: '' }
  }
  const denied = event.code === 'speech_denied' || event.message.includes('语音识别权限')
  const helperExited = event.code === 'helper_exited'
  return {
    ...state,
    status: 'error',
    error: event.message,
    permissionHint: denied
      ? '请在系统设置中允许 AgentOS 使用语音识别，然后重新开始。'
      : helperExited ? '' : state.permissionHint,
  }
}

export function reduceVoiceCommandResult(
  state: VoiceUiState,
  result: VoiceCommandExecutionResult,
): VoiceUiState {
  if (result.id !== 'voice-window-meta' && state.submittingId && result.id !== state.submittingId) return state
  return {
    ...state,
    result,
    submittingId: result.id === state.submittingId ? null : state.submittingId,
    error: result.status === 'failed' ? result.message : state.error,
  }
}

export function statusLabel(status: SpeechRecognitionStatus, submittingId: string | null): string {
  if (submittingId) return '正在交给主窗口执行'
  switch (status) {
    case 'starting':
      return '正在启动语音识别'
    case 'requesting_permission':
      return '正在请求语音权限'
    case 'listening':
      return '正在聆听'
    case 'transcribing':
      return '正在转写'
    case 'unsupported':
      return '当前环境不支持 Apple Speech'
    case 'error':
      return '语音识别遇到问题'
    case 'idle':
    default:
      return '准备接收语音命令'
  }
}

export function composerStatusLabel(status: SpeechRecognitionStatus, submittingId: string | null): string {
  if (submittingId) return '执行中'
  if (status === 'listening') return '正在听'
  if (status === 'transcribing') return '转写中'
  if (status === 'error') return '需处理'
  if (status === 'unsupported') return '不可用'
  return '就绪'
}

export function voiceButtonClassName(status: SpeechRecognitionStatus): string {
  const active = isSpeechRecordingStatus(status)
  return [
    'composer-icon-button',
    'composer-voice-button',
    status === 'listening' ? 'composer-voice-button--listening' : '',
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
