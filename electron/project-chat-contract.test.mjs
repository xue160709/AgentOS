import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTypeScriptModule(relativePath, localRequire = require) {
  const modulePath = resolve(testDir, relativePath)
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function loadRunnerModule() {
  class ImmediateCoalescer {
    constructor(publish) { this.publish = publish }
    emit(event) { this.publish(event) }
    flushRequest() {}
  }
  class Router { constructor() {} }
  const localRequire = (specifier) => {
    if (specifier === '@anthropic-ai/claude-agent-sdk') return { query: () => undefined }
    if (specifier === './claude-agent-runner/event-coalescer') return { ClaudeChatEventCoalescer: ImmediateCoalescer }
    if (specifier === './claude-agent-runner/sdk-message-router') return { ClaudeSdkMessageRouter: Router }
    if (specifier === './agent-context') return {}
    if (specifier === './claude-agent-runner/config') return {}
    if (specifier === './claude-agent-runner/executable') return {}
    if (specifier === './claude-agent-runner/file-diff') return {}
    if (specifier === './claude-agent-runner/input') return { normalizeSubmitAttachments: () => [], resolveWorkspaceCwd: (cwd, fallback) => cwd ?? fallback }
    if (specifier === './claude-agent-runner/mcp') return {}
    if (specifier === './claude-agent-runner/web-search') return {}
    if (specifier === './home-plugin-customization-prompt') return {}
    if (specifier === './safe-console') return { safeConsoleError() {}, safeConsoleInfo() {}, safeConsoleWarn() {} }
    return require(specifier)
  }
  return loadTypeScriptModule('./claude-agent-runner.ts', localRequire)
}

test('project chat error helper preserves the frozen error result contract', () => {
  const { projectChatError } = loadTypeScriptModule('../src/project-chat-contract.ts')
  assert.deepEqual(projectChatError('thread-busy', 'Thread is busy.', true), {
    code: 'thread-busy', message: 'Thread is busy.', retryable: true,
  })
})

test('pure project chat reducer preserves transcript folding and terminal fences', () => {
  const { reduceProjectChatEvent } = loadTypeScriptModule('../src/project-chat-reducer.ts')
  const initial = { chatState: { model: 'Claude Agent', items: [] }, terminalRequestIds: [] }
  const streamed = reduceProjectChatEvent(initial, { type: 'assistant_delta', requestId: 'request-1', messageId: 'message-1', text: 'Hello' }, { now: 10 })
  const complete = reduceProjectChatEvent(streamed, { type: 'result', requestId: 'request-1', sessionId: 'session-1', result: 'ignored' }, { now: 20, assistantMessageId: 'message-1' })
  const late = reduceProjectChatEvent(complete, { type: 'assistant_delta', requestId: 'request-1', messageId: 'message-1', text: ' world' }, { now: 30 })
  assert.deepEqual(complete.chatState.items, [{
    type: 'message', id: 'message-1', role: 'assistant', content: 'Hello', status: 'done',
    createdAt: 10, startedAt: 10, completedAt: 20, durationMs: 10,
  }])
  assert.strictEqual(late, complete)
})

test('runner publishes each normalized event once and absorbs sink failures', () => {
  const { ClaudeAgentRunner } = loadRunnerModule()
  const events = []
  const runner = new ClaudeAgentRunner(
    { publish(event) { events.push(event) } },
    '/workspace', () => ({}), async () => ({}), async () => ({}), () => 'zh',
  )
  runner.emit({ type: 'assistant_delta', requestId: 'request-1', messageId: 'message-1', text: 'Hello' })
  assert.deepEqual(events, [{ type: 'assistant_delta', requestId: 'request-1', messageId: 'message-1', text: 'Hello' }])

  const throwingRunner = new ClaudeAgentRunner(
    { publish() { throw new Error('sink unavailable') } },
    '/workspace', () => ({}), async () => ({}), async () => ({}), () => 'zh',
  )
  throwingRunner.activeRequests.set('request-2', { cancelled: false })
  assert.doesNotThrow(() => throwingRunner.emit({ type: 'cancelled', requestId: 'request-2' }))
  assert.equal(throwingRunner.activeRequests.get('request-2').cancelled, false)
})
