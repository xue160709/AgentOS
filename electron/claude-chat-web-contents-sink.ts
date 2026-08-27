import type { WebContents } from 'electron'
import type { ClaudeChatEventSink } from '../src/project-chat-contract'
import { CLAUDE_CHAT_EVENT_CHANNEL } from './claude-agent-runner'

/** Transitional adapter for the legacy main-window chat IPC channel. */
export function createClaudeChatWebContentsSink(webContents: WebContents): ClaudeChatEventSink {
  return {
    publish(event) {
      if (webContents.isDestroyed()) return
      webContents.send(CLAUDE_CHAT_EVENT_CHANNEL, event)
    },
  }
}
