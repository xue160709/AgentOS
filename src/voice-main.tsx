import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionStatus,
  VoiceCommandExecutionResult,
} from './desktop-types'
import { IconInline } from './icon-inline'
import './style.css'
import './voice.css'

type VoiceUiState = {
  status: SpeechRecognitionStatus
  partialText: string
  finalText: string
  result: VoiceCommandExecutionResult | null
  error: string
  permissionHint: string
  submittingId: string | null
}

const ACTIVE_SPEECH_STATUSES = new Set<SpeechRecognitionStatus>([
  'starting',
  'requesting_permission',
  'listening',
  'transcribing',
])

function VoiceCommandWindow() {
  const [state, setState] = useState<VoiceUiState>({
    status: 'idle',
    partialText: '',
    finalText: '',
    result: null,
    error: '',
    permissionHint: '',
    submittingId: null,
  })

  const recording = ACTIVE_SPEECH_STATUSES.has(state.status)
  const commandText = useMemo(() => state.finalText.trim() || state.partialText.trim(), [state.finalText, state.partialText])

  useEffect(() => {
    window.desktop?.getSpeechRecognitionStatus?.()
      .then((snapshot) => {
        setState((current) => ({ ...current, status: snapshot.status }))
      })
      .catch(() => {
        setState((current) => ({ ...current, status: 'unsupported', error: '无法读取语音状态。' }))
      })

    const unsubscribeSpeech = window.desktop?.onSpeechRecognitionEvent?.((event) => {
      setState((current) => reduceSpeechEvent(current, event))
    })
    const unsubscribeResult = window.desktop?.onVoiceCommandResult?.((result) => {
      setState((current) => {
        if (result.id !== 'voice-window-meta' && current.submittingId && result.id !== current.submittingId) return current
        return {
          ...current,
          result,
          submittingId: result.id === current.submittingId ? null : current.submittingId,
          error: result.status === 'failed' ? result.message : current.error,
        }
      })
    })

    return () => {
      unsubscribeSpeech?.()
      unsubscribeResult?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.close()
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submitCommand()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const toggleRecording = async () => {
    setState((current) => ({ ...current, result: null, error: '', permissionHint: '' }))
    const result = recording
      ? await window.desktop?.stopSpeechRecognition?.()
      : await window.desktop?.startSpeechRecognition?.({ requiresOnDevice: true, consumer: 'voice-command' })
    if (!result) {
      setState((current) => ({ ...current, error: '当前环境不支持语音命令。', status: 'unsupported' }))
      return
    }
    if (!result.ok) {
      setState((current) => ({
        ...current,
        status: result.status,
        error: result.message,
        permissionHint: result.status === 'error' ? result.message : current.permissionHint,
      }))
    }
  }

  const cancelRecording = async () => {
    await window.desktop?.cancelSpeechRecognition?.()
    setState((current) => ({
      ...current,
      status: 'idle',
      partialText: '',
      finalText: '',
      result: null,
      error: '',
      permissionHint: '',
      submittingId: null,
    }))
  }

  const submitCommand = async () => {
    const utterance = commandText
    if (!utterance) {
      setState((current) => ({ ...current, error: '先说出或输入一条命令。' }))
      return
    }
    const result = await window.desktop?.submitVoiceCommand?.(utterance)
    if (!result?.ok) {
      setState((current) => ({ ...current, error: result?.message ?? '主窗口还没有准备好。' }))
      return
    }
    setState((current) => ({
      ...current,
      submittingId: result.id,
      result: { id: result.id, status: 'success', message: '已发送到主窗口，正在执行...' },
      error: '',
    }))
  }

  const respondToCommand = async (action: 'confirm' | 'cancel' | 'choose', candidateId?: string) => {
    const id = state.result?.id
    if (!id) return
    const result = await window.desktop?.respondVoiceCommand?.({ id, action, candidateId })
    if (!result?.ok) {
      setState((current) => ({ ...current, error: result?.message ?? '主窗口还没有准备好。' }))
      return
    }
    setState((current) => ({
      ...current,
      submittingId: id,
      result: { id, status: 'success', message: action === 'cancel' ? '正在取消...' : '正在继续执行...' },
      error: '',
    }))
  }

  return (
    <main className="voice-window">
      <header className="voice-window__header">
        <div>
          <span className="voice-window__eyebrow">AgentOS</span>
          <h1>命令窗口</h1>
        </div>
        <button type="button" className="voice-window__ghost" aria-label="关闭语音命令窗口" onClick={() => window.close()}>
          ×
        </button>
      </header>

      <p className="voice-window__status" role="status">
        {statusLabel(state.status, state.submittingId)}
      </p>

      <form className="chat-composer-wrap voice-window__composer no-drag" onSubmit={(event) => handleSubmit(event, submitCommand)}>
        <div className="chat-composer voice-command-composer">
          <textarea
            id="voice-command-final"
            className="chat-input"
            data-testid="voice-window-final-input"
            rows={1}
            value={state.finalText}
            placeholder="例如：打开 Google 页面，新建对话"
            onChange={(event) => setState((current) => ({ ...current, finalText: event.target.value, error: '' }))}
          />
          <div className="voice-window__partial" data-testid="voice-window-partial">
            {state.partialText || '等待语音输入'}
          </div>
          <div className="composer-footer">
            <div className="composer-actions">
              <button
                type="button"
                className={voiceButtonClassName(state.status)}
                title={recording ? '停止语音输入' : '开始语音输入'}
                aria-label={recording ? '停止语音输入' : '开始语音输入'}
                aria-pressed={recording}
                data-testid="voice-window-start"
                onClick={() => void toggleRecording()}
              >
                <IconInline name="mic" />
              </button>
              <button
                type="button"
                className="composer-icon-button"
                title="清空命令"
                aria-label="清空命令"
                onClick={() => void cancelRecording()}
              >
                <IconInline name="x" />
              </button>
            </div>
            <div className="composer-actions composer-actions--end">
              <span className="voice-window__composer-status">{composerStatusLabel(state.status, state.submittingId)}</span>
              <button
                type="submit"
                className="composer-send-button"
                title="执行命令"
                aria-label="执行命令"
                data-testid="voice-window-submit"
                disabled={!commandText || Boolean(state.submittingId)}
              >
                <IconInline name={state.submittingId ? 'stop' : 'send'} />
              </button>
            </div>
          </div>
        </div>
      </form>

      {state.permissionHint ? (
        <div className="voice-window__hint" data-testid="voice-window-permission-hint">
          {state.permissionHint}
        </div>
      ) : null}

      {state.error ? <div className="voice-window__error">{state.error}</div> : null}
      {state.result?.status === 'needs_confirmation' ? (
        <div className="voice-window__confirm" data-testid="voice-window-confirm-card" role="dialog" aria-label="确认执行命令">
          <span>{state.result.message}</span>
          <button type="button" onClick={() => void respondToCommand('confirm')}>确认</button>
          <button type="button" onClick={() => void respondToCommand('cancel')}>取消</button>
        </div>
      ) : null}

      {state.result?.status === 'needs_clarification' && state.result.candidates?.length ? (
        <div className="voice-window__clarify" data-testid="voice-window-clarify-list" role="listbox" aria-label="选择命令目标">
          {state.result.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              onClick={() => void respondToCommand('choose', candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="voice-window__result" data-testid="voice-window-result">
        {state.result?.message ?? ''}
      </div>
    </main>
  )
}

function reduceSpeechEvent(state: VoiceUiState, event: SpeechRecognitionEvent): VoiceUiState {
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
  return {
    ...state,
    status: 'error',
    error: event.message,
    permissionHint: denied ? '请在系统设置中允许 AgentOS 使用语音识别，然后重新开始。' : state.permissionHint,
  }
}

function statusLabel(status: SpeechRecognitionStatus, submittingId: string | null) {
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

function composerStatusLabel(status: SpeechRecognitionStatus, submittingId: string | null) {
  if (submittingId) return '执行中'
  if (status === 'listening') return '正在听'
  if (status === 'transcribing') return '转写中'
  if (status === 'error') return '需处理'
  if (status === 'unsupported') return '不可用'
  return '就绪'
}

function voiceButtonClassName(status: SpeechRecognitionStatus) {
  const active = ACTIVE_SPEECH_STATUSES.has(status)
  return [
    'composer-icon-button',
    'composer-voice-button',
    status === 'listening' ? 'composer-voice-button--listening' : '',
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function handleSubmit(event: FormEvent<HTMLFormElement>, submitCommand: () => Promise<void>) {
  event.preventDefault()
  void submitCommand()
}

const appRoot = document.querySelector<HTMLDivElement>('#voice-app')
if (!appRoot) throw new Error('Missing #voice-app root element.')

createRoot(appRoot).render(
  <StrictMode>
    <VoiceCommandWindow />
  </StrictMode>,
)
