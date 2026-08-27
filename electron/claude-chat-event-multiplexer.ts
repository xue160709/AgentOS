import type { ClaudeChatEvent } from '../src/claude-chat-types'
import type { ClaudeChatEventSink } from '../src/project-chat-contract'

/** A Main-owned switchboard. A faulty observer must never interrupt the SDK runner. */
export class ClaudeChatEventMultiplexer implements ClaudeChatEventSink {
  private sinks: readonly ClaudeChatEventSink[] = []

  setSinks(sinks: readonly ClaudeChatEventSink[]): void {
    this.sinks = [...sinks]
  }

  publish(event: ClaudeChatEvent): void {
    for (const sink of this.sinks) {
      try { sink.publish(event) } catch { /* observers are isolated */ }
    }
  }
}
