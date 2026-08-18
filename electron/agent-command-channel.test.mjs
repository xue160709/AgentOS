import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadAgentCommandChannel() {
  const sourcePath = resolve(testDir, '../src/agent-command-channel.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

test('Agent command channel binds the project and stays on the current view by default', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  const calls = []
  const events = []
  channel.subscribe((event) => events.push(event))
  channel.configure({
    projectId: ' project-fixed ',
    defaultNavigation: 'stay',
    runtime: {
      createThread: (input) => {
        calls.push(['create', input])
        return 'thread-1'
      },
      submitPrompt: (input) => {
        calls.push(['submit', input])
        return true
      },
      openThread: (threadId) => calls.push(['open', threadId]),
    },
  })

  const result = await channel.send('  完整指令  ', { threadTitle: ' 写作任务 ' })

  assert.equal(result.projectId, 'project-fixed')
  assert.equal(result.threadId, 'thread-1')
  assert.deepEqual(calls, [
    ['create', { projectId: 'project-fixed', threadTitle: '写作任务' }],
    ['submit', { projectId: 'project-fixed', threadId: 'thread-1', prompt: '完整指令' }],
  ])
  assert.deepEqual(events.map((event) => event.status), ['creating', 'running'])
})

test('Agent command channel opens the created thread only when requested', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  const opened = []
  channel.configure({
    projectId: 'project-1',
    runtime: {
      createThread: () => 'thread-open',
      submitPrompt: () => true,
      openThread: (threadId) => opened.push(threadId),
    },
  })

  await channel.send('开始任务', { navigation: 'open' })
  assert.deepEqual(opened, ['thread-open'])
})

test('Agent command channel rejects empty prompts before creating a thread', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  let created = false
  channel.configure({
    projectId: 'project-1',
    runtime: {
      createThread: () => {
        created = true
        return 'thread-unused'
      },
      submitPrompt: () => true,
      openThread: () => {},
    },
  })

  await assert.rejects(() => channel.send('   '), (error) => error.code === 'empty_prompt')
  assert.equal(created, false)
})

test('Agent command channel keeps the created thread and reports submit failure', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  const events = []
  channel.subscribe((event) => events.push(event))
  channel.configure({
    projectId: 'project-1',
    runtime: {
      createThread: () => 'thread-failed',
      submitPrompt: () => false,
      openThread: () => {},
    },
  })

  await assert.rejects(
    () => channel.send('开始任务'),
    (error) => error.code === 'submit_failed' && error.threadId === 'thread-failed',
  )
  assert.equal(events.at(-1).status, 'failed')
  assert.equal(events.at(-1).threadId, 'thread-failed')
})

test('Agent command channel normalizes runtime submit exceptions', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  channel.configure({
    projectId: 'project-1',
    runtime: {
      createThread: () => 'thread-exception',
      submitPrompt: () => {
        throw new Error('runtime details')
      },
      openThread: () => {},
    },
  })

  await assert.rejects(
    () => channel.send('开始任务'),
    (error) => error.code === 'submit_failed' && error.threadId === 'thread-exception',
  )
  assert.equal(channel.getThreadStatus('thread-exception').status, 'failed')
})

test('Agent command channel does not let a late running event overwrite a terminal event', async () => {
  const { AgentCommandChannel } = loadAgentCommandChannel()
  const channel = new AgentCommandChannel()
  channel.configure({
    projectId: 'project-1',
    runtime: {
      createThread: () => 'thread-fast',
      submitPrompt: () => {
        channel.reportThreadStatus('thread-fast', 'succeeded')
        return true
      },
      openThread: () => {},
    },
  })

  await channel.send('快速任务')
  assert.equal(channel.getThreadStatus('thread-fast').status, 'succeeded')
})
