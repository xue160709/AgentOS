import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadChatRunModule() {
  const modulePath = resolve(testDir, '../src/components/chat/chat-run.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

function createHarness(initialNow = 100) {
  const { ChatRun } = loadChatRunModule()
  let now = initialNow
  const scheduled = []
  const run = new ChatRun({
    now: () => now,
    random: () => 0.5,
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
  })
  run.syncRunStates({})
  return {
    run,
    scheduled,
    setNow(value) {
      now = value
    },
  }
}

function emptyState(overrides = {}) {
  return {
    model: 'Claude Agent',
    items: [],
    ...overrides,
  }
}

function applyEvent(harness, state, event, context = {}) {
  const transition = harness.run.handleEvent(
    { threadId: 'thread-1', ...event },
    {
      activeThreadId: 'thread-1',
      fallbackModel: 'Claude Agent',
      stoppedBody: 'Stopped',
      ...context,
    },
  )
  return {
    transition,
    state: transition.updateState ? transition.updateState(state) : state,
  }
}

function beginAcceptedRun(harness, requestId, threadId = 'thread-1') {
  const submission = harness.run.beginSubmission(threadId)
  assert.ok(submission)
  const accepted = harness.run.acceptSubmission(
    threadId,
    submission.pendingRequestId,
    requestId,
    submission.startedAt,
  )
  assert.equal(accepted.requestId, requestId)
  return submission
}

test('Chat Run interface folds session start, streamed text, and result completion', () => {
  const harness = createHarness(100)
  beginAcceptedRun(harness, 'request-1')
  let state = emptyState({
    items: [
      {
        type: 'message',
        id: 'assistant-request-1',
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: 100,
      },
    ],
  })

  ;({ state } = applyEvent(harness, state, {
    type: 'session_start',
    requestId: 'request-1',
    sessionId: 'session-1',
    model: 'claude-sonnet',
    cwd: '/workspace',
    tools: [],
    skills: [],
    slashCommands: [],
    agents: [],
    mcpServers: [],
    permissionMode: 'auto',
    plugins: [],
  }))
  ;({ state } = applyEvent(harness, state, {
    type: 'assistant_delta',
    requestId: 'request-1',
    messageId: 'message-1',
    text: 'Hello',
  }))
  ;({ state } = applyEvent(harness, state, {
    type: 'assistant_delta',
    requestId: 'request-1',
    messageId: 'message-1',
    text: ' world',
  }))
  harness.setNow(250)
  const result = applyEvent(harness, state, {
    type: 'result',
    requestId: 'request-1',
    sessionId: 'session-1',
    result: 'ignored because streamed content exists',
  })
  state = result.state

  assert.deepEqual(result.transition.terminal, { kind: 'result' })
  assert.equal(result.transition.runState, null)
  assert.equal(result.transition.markCompleted, true)
  assert.equal(state.sessionId, 'session-1')
  assert.equal(state.model, 'claude-sonnet')
  assert.equal(state.cwd, '/workspace')
  assert.deepEqual(state.items, [
    {
      type: 'message',
      id: 'message-1',
      role: 'assistant',
      content: 'Hello world',
      status: 'done',
      createdAt: 100,
      startedAt: 100,
      completedAt: 250,
      durationMs: 150,
    },
  ])
})

test('Chat Run interface materializes result-only replies and clears a missing session', () => {
  const harness = createHarness(10)
  beginAcceptedRun(harness, 'request-result')
  let state = emptyState({ sessionId: 'stale-session' })

  harness.setNow(40)
  ;({ state } = applyEvent(harness, state, {
    type: 'result',
    requestId: 'request-result',
    sessionId: 'session-result',
    result: 'Final answer',
  }))

  assert.equal(state.sessionId, 'session-result')
  assert.equal(state.items[0].content, 'Final answer')
  assert.equal(state.items[0].status, 'done')

  harness.setNow(50)
  beginAcceptedRun(harness, 'request-error')
  harness.setNow(80)
  const error = applyEvent(harness, state, {
    type: 'error',
    requestId: 'request-error',
    code: 'sdk_error',
    message: 'No conversation found with session ID session-result',
  })
  state = error.state

  assert.deepEqual(error.transition.terminal, { kind: 'error', code: 'sdk_error' })
  assert.equal(state.sessionId, undefined)
  assert.equal(state.items[1].id, 'assistant-request-error')
  assert.equal(state.items[1].status, 'error')
  assert.equal(state.items[1].durationMs, 30)
})

test('Chat Run interface marks cancellation without discarding partial text', () => {
  const harness = createHarness(100)
  beginAcceptedRun(harness, 'request-cancelled')
  harness.setNow(175)
  const { state, transition } = applyEvent(
    harness,
    emptyState({
      items: [
        {
          type: 'message',
          id: 'assistant-request-cancelled',
          role: 'assistant',
          content: 'Partial answer',
          status: 'streaming',
          startedAt: 100,
        },
      ],
    }),
    {
      type: 'cancelled',
      requestId: 'request-cancelled',
    },
  )

  assert.deepEqual(transition.terminal, { kind: 'cancelled' })
  assert.equal(transition.scrollToBottom, true)
  assert.deepEqual(state.items[0], {
    type: 'message',
    id: 'assistant-request-cancelled',
    role: 'assistant',
    content: 'Partial answer',
    status: 'cancelled',
    startedAt: 100,
    completedAt: 175,
    durationMs: 75,
  })
})

test('Chat Run interface owns thinking, tool, activity, task, and prompt lifecycle', () => {
  const harness = createHarness(100)
  beginAcceptedRun(harness, 'request-2')
  let state = emptyState()
  const events = [
    {
      type: 'thinking_start',
      requestId: 'request-2',
      thinkingId: 'thinking-1',
      title: 'Think',
    },
    {
      type: 'thinking_delta',
      requestId: 'request-2',
      thinkingId: 'thinking-1',
      text: 'Inspecting',
    },
    {
      type: 'thinking_done',
      requestId: 'request-2',
      thinkingId: 'thinking-1',
    },
    {
      type: 'tool_start',
      requestId: 'request-2',
      toolUseId: 'tool-1',
      name: 'Read',
      inputPreview: 'README.md',
    },
    {
      type: 'tool_done',
      requestId: 'request-2',
      toolUseId: 'tool-1',
      status: 'done',
      detail: 'Read complete',
    },
    {
      type: 'agent_activity',
      requestId: 'request-2',
      activityId: 'activity-1',
      title: 'Analyzed',
      status: 'done',
      detail: 'Complete',
    },
    {
      type: 'task_create',
      requestId: 'request-2',
      toolUseId: 'task-tool-1',
      taskId: 'task-1',
      subject: 'Add tests',
    },
    {
      type: 'task_update',
      requestId: 'request-2',
      toolUseId: 'task-tool-1',
      taskId: 'task-1',
      status: 'completed',
      blockedBy: ['task-0'],
    },
  ]

  events.forEach((event, index) => {
    harness.setNow(100 + index)
    ;({ state } = applyEvent(harness, state, event))
  })

  harness.setNow(120)
  const prompt = applyEvent(harness, state, {
    type: 'ask_user_question',
    requestId: 'request-2',
    permissionRequestId: 'permission-1',
    toolUseId: 'question-tool',
    questions: [],
  }).transition

  assert.equal(prompt.prompt.permissionRequestId, 'permission-1')
  assert.equal(prompt.runState.status, 'asking')
  const resumed = harness.run.resumeAfterPrompt('request-2', 'thread-1')
  assert.equal(resumed.runState.status, 'running')
  assert.equal(state.tasks.items[0].status, 'completed')
  assert.equal(state.items[0].type, 'thinking')
  assert.equal(state.items[1].type, 'tool')
  assert.equal(state.items[2].type, 'activity')
})

test('Chat Run interface merges file diffs and records rewind status', () => {
  const harness = createHarness()
  beginAcceptedRun(harness, 'request-3')
  const firstFile = {
    path: '/workspace/a.ts',
    relativePath: 'a.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    hunks: [],
  }
  const secondFile = {
    ...firstFile,
    status: 'deleted',
    additions: 1,
    deletions: 3,
    truncated: true,
  }
  let state = emptyState()
  ;({ state } = applyEvent(harness, state, {
    type: 'file_diff',
    requestId: 'request-3',
    changeSetId: 'change-1',
    checkpointId: 'checkpoint-1',
    files: [firstFile],
  }))
  ;({ state } = applyEvent(harness, state, {
    type: 'file_diff',
    requestId: 'request-3',
    changeSetId: 'change-1',
    checkpointId: 'checkpoint-2',
    files: [secondFile],
  }))
  ;({ state } = applyEvent(harness, state, {
    type: 'file_rewind_result',
    requestId: 'request-3',
    changeSetId: 'change-1',
    status: 'reverted',
    detail: 'Reverted',
  }))

  assert.equal(state.items[0].checkpointId, 'checkpoint-2')
  assert.equal(state.items[0].files[0].additions, 3)
  assert.equal(state.items[0].files[0].deletions, 4)
  assert.equal(state.items[0].files[0].truncated, true)
  assert.equal(state.items[0].status, 'reverted')
})

test('Chat Run interface blocks a second submission on the same thread', () => {
  const harness = createHarness()
  const first = harness.run.beginSubmission('thread-1')

  assert.ok(first)
  assert.equal(harness.run.beginSubmission('thread-1'), null)
  assert.equal(harness.run.runStateForThread('thread-1').requestId, first.pendingRequestId)
})

test('Chat Run interface absorbs terminal-before-submit-acknowledgement races', () => {
  const harness = createHarness(100)
  const submission = harness.run.beginSubmission('thread-1')
  assert.ok(submission)

  harness.setNow(120)
  const terminal = applyEvent(harness, emptyState(), {
    type: 'result',
    requestId: 'request-race',
    sessionId: 'session-race',
    result: 'Fast result',
  }).transition

  assert.equal(terminal.runState, null)
  assert.equal(harness.run.runStateForThread('thread-1'), undefined)

  const accepted = harness.run.acceptSubmission(
    'thread-1',
    submission.pendingRequestId,
    'request-race',
    submission.startedAt,
  )

  assert.equal(accepted, undefined)
  assert.equal(harness.run.runStateForThread('thread-1'), undefined)
  assert.equal(harness.scheduled[0].delayMs, 30_000)
})
