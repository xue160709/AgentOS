import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadRouterModule() {
  const modulePath = resolve(testDir, './claude-agent-runner/sdk-message-router.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (specifier === './file-diff') return { fileDiffFromPostToolUse: () => undefined }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function createActiveRequest(overrides = {}) {
  return {
    requestId: 'request-1',
    assistantMessageId: 'assistant-request-1',
    threadId: 'thread-1',
    cwd: '/workspace',
    didEmitText: false,
    didEmitThinking: false,
    seenToolUseIds: new Set(),
    seenTaskInputToolUseIds: new Set(),
    toolNamesByUseId: new Map(),
    diffedToolUseIds: new Set(),
    streamBlocks: new Map(),
    ...overrides,
  }
}

test('Claude SDK router surfaces local slash command output as assistant text', () => {
  const { ClaudeSdkMessageRouter } = loadRouterModule()
  const events = []
  const router = new ClaudeSdkMessageRouter(
    (event) => events.push(event),
    () => ({ model: 'Claude Agent' }),
  )
  const activeRequest = createActiveRequest()

  router.handleSdkMessage(
    {
      type: 'system',
      subtype: 'local_command_output',
      content: 'Available commands:\n/help',
      uuid: 'message-1',
      session_id: 'session-1',
    },
    activeRequest,
  )

  assert.equal(activeRequest.didEmitText, true)
  assert.deepEqual(events[0], {
    type: 'assistant_delta',
    requestId: 'request-1',
    messageId: 'assistant-request-1',
    text: 'Available commands:\n/help',
  })
  assert.equal(events[1].type, 'agent_activity')
  assert.equal(events[1].title, '本地命令输出')
})

test('Claude SDK router surfaces context compaction as a transcript boundary event', () => {
  const { ClaudeSdkMessageRouter } = loadRouterModule()
  const events = []
  const router = new ClaudeSdkMessageRouter(
    (event) => events.push(event),
    () => ({ model: 'Claude Agent' }),
  )
  const activeRequest = createActiveRequest()

  router.handleSdkMessage(
    {
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'status-1',
      session_id: 'session-1',
    },
    activeRequest,
  )
  router.handleSdkMessage(
    {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: 128000,
        post_tokens: 21000,
        duration_ms: 1400,
        preserved_messages: {
          anchor_uuid: 'anchor-1',
          uuids: ['message-1', 'message-2'],
        },
      },
      uuid: 'boundary-1',
      session_id: 'session-1',
    },
    activeRequest,
  )

  assert.deepEqual(events[0], {
    type: 'context_compaction',
    requestId: 'request-1',
    compactionId: 'context-compact-request-1',
    status: 'running',
    error: undefined,
  })
  assert.deepEqual(events[1], {
    type: 'context_compaction',
    requestId: 'request-1',
    compactionId: 'context-compact-request-1',
    status: 'done',
    trigger: 'manual',
    preTokens: 128000,
    postTokens: 21000,
    durationMs: 1400,
    preservedMessageCount: 2,
  })
})
