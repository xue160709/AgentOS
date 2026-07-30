import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { VoiceCommandMode } from './desktop-types'
import { IconInline } from './icon-inline'
import {
  composerStatusLabel,
  createInitialVoiceUiState,
  isSpeechRecordingStatus,
  reduceSpeechEvent,
  reduceVoiceCommandResult,
  selectVoiceCommandText,
  statusLabel,
  voiceButtonClassName,
} from './voice-state'
import './style.css'
import './voice.css'

const windowEffects = window.desktop?.windowEffects

if (windowEffects?.macVibrancy) {
  document.documentElement.dataset.voiceWindowEffects = 'mac-vibrancy'
} else if (windowEffects?.windowsAcrylic) {
  document.documentElement.dataset.voiceWindowEffects = 'windows-acrylic'
} else {
  document.documentElement.dataset.voiceWindowEffects = 'css-glass'
}

function VoiceCommandWindow() {
  const [state, setState] = useState(createInitialVoiceUiState)
  const [mode, setMode] = useState<VoiceCommandMode>('auto')

  const recording = isSpeechRecordingStatus(state.status)
  const commandText = useMemo(() => selectVoiceCommandText(state), [state.finalText, state.partialText])

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
      setState((current) => reduceVoiceCommandResult(current, result))
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
    setState(createInitialVoiceUiState())
  }

  const submitCommand = async () => {
    const utterance = commandText
    if (!utterance) {
      setState((current) => ({ ...current, error: '先说出或输入一条命令。' }))
      return
    }
    const result = await window.desktop?.submitVoiceCommand?.({ utterance, mode })
    if (!result?.ok) {
      setState((current) => ({ ...current, error: result?.message ?? '主窗口还没有准备好。' }))
      return
    }
    setState((current) => ({
      ...current,
      submittingId: result.id,
      result: { id: result.id, status: 'success', message: mode === 'chat' ? '已发送到主窗口，正在进入聊天...' : '已发送到主窗口，正在执行...' },
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
        <button
          type="button"
          className="voice-window__ghost"
          aria-label="关闭语音命令窗口"
          data-mm-label="关闭语音命令窗口"
          data-mm-aliases="关闭命令窗口|关闭悬浮窗"
          onClick={() => window.close()}
        >
          ×
        </button>
      </header>

      <p className="voice-window__status" role="status">
        {statusLabel(state.status, state.submittingId)}
      </p>

      <div className="voice-window__mode no-drag" role="group" aria-label="选择命令窗口模式" data-testid="voice-window-mode">
        {VOICE_MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            className={mode === item.mode ? 'is-active' : ''}
            aria-pressed={mode === item.mode}
            title={item.title}
            data-testid={`voice-window-mode-${item.mode}`}
            data-mm-label={item.label}
            data-mm-aliases={item.aliases}
            onClick={() => setMode(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form className="chat-composer-wrap voice-window__composer no-drag" onSubmit={(event) => handleSubmit(event, submitCommand)}>
        <div className="chat-composer voice-command-composer">
          <textarea
            id="voice-command-final"
            className="chat-input"
            data-testid="voice-window-final-input"
            rows={1}
            value={state.finalText}
            placeholder="例如：打开 Google 页面，新建对话"
            data-mm-label="语音命令输入框"
            data-mm-aliases="命令输入|编辑命令|输入语音命令"
            data-mm-exposure="value"
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
                data-mm-label={recording ? '停止语音输入' : '开始语音输入'}
                data-mm-aliases="语音输入|听写命令|录音命令"
                onClick={() => void toggleRecording()}
              >
                <IconInline name="mic" />
              </button>
              <button
                type="button"
                className="composer-icon-button"
                title="清空命令"
                aria-label="清空命令"
                data-mm-label="清空命令"
                data-mm-aliases="取消语音输入|清除命令"
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
                data-mm-label="执行命令"
                data-mm-aliases="提交命令|发送命令"
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
          <button type="button" data-mm-label="确认执行命令" data-mm-aliases="确认|继续执行" onClick={() => void respondToCommand('confirm')}>确认</button>
          <button type="button" data-mm-label="取消执行命令" data-mm-aliases="取消|停止执行" onClick={() => void respondToCommand('cancel')}>取消</button>
        </div>
      ) : null}

      {state.result?.status === 'needs_clarification' && state.result.candidates?.length ? (
        <div className="voice-window__clarify" data-testid="voice-window-clarify-list" role="listbox" aria-label="选择命令目标">
          {state.result.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              data-mm-label={candidate.label}
              data-mm-aliases="选择命令目标|澄清候选"
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

function handleSubmit(event: FormEvent<HTMLFormElement>, submitCommand: () => Promise<void>) {
  event.preventDefault()
  void submitCommand()
}

const VOICE_MODES: Array<{ mode: VoiceCommandMode; label: string; title: string; aliases: string }> = [
  {
    mode: 'auto',
    label: '自动',
    title: '自动判断命令、系统任务或聊天问题',
    aliases: '自动模式|智能判断|命令聊天自动',
  },
  {
    mode: 'command',
    label: '命令',
    title: '强制按 AgentOS 命令解析',
    aliases: '命令模式|只执行命令|控制主窗口',
  },
  {
    mode: 'chat',
    label: '聊天',
    title: '直接发送到当前对话',
    aliases: '聊天模式|问问题|发送到对话',
  },
]

const appRoot = document.querySelector<HTMLDivElement>('#voice-app')
if (!appRoot) throw new Error('Missing #voice-app root element.')

createRoot(appRoot).render(
  <StrictMode>
    <VoiceCommandWindow />
  </StrictMode>,
)
