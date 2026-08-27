import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url); const ts = require('typescript'); const root = dirname(fileURLToPath(import.meta.url))
function load(file) { const module = { exports: {} }; const out = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText; Function('exports', 'module', 'require', out)(module.exports, module, require); return module.exports }
test('production flag defaults on, supports an explicit rollback, and handler map registers once', () => {
  const { projectChatBrokerV2Enabled, registerProjectChatHandlerMap } = load(resolve(root, 'project-chat-composition.ts'))
  assert.equal(projectChatBrokerV2Enabled({}), true); assert.equal(projectChatBrokerV2Enabled({ AGENTOS_PROJECT_CHAT_BROKER_V2: '0' }), false); assert.equal(projectChatBrokerV2Enabled({ AGENTOS_PROJECT_CHAT_BROKER_V2: '1' }), true)
  const calls = []; registerProjectChatHandlerMap({ handle: (channel) => calls.push(channel) }, new Map([['project-chat:a', () => undefined]])); assert.deepEqual(calls, ['project-chat:a'])
})

test('composition rolls back handlers and preserves ordered window cleanup', async () => {
  const { createProjectChatProductionComposition } = load(resolve(root, 'project-chat-composition.ts'))
  const calls = []; const listeners = new Map(); const sinks = []
  const broker = { publish() {}, refreshPromptOwners: async () => {}, onWebContentsUnavailable: async (id) => calls.push(`broker:${id}`) }
  const capabilities = { registerMainWindow: () => ({ webContentsId: 7 }), unregister: (id) => calls.push(`capability:${id}`) }
  const presence = { register: () => {}, unregister: (id) => calls.push(`presence:${id}`), setWindowState: () => true }
  const composition = createProjectChatProductionComposition({
    multiplexer: { setSinks: (next) => sinks.push(next) }, legacySinks: [{ publish() {} }], broker, taskHomeSink: { publish() {} }, capabilities, presence,
    mainWindow: { webContents: { id: 7 }, isVisible: () => true, isFocused: () => true, on: (event, listener) => listeners.set(event, listener) },
    registrar: { handle: (channel) => calls.push(`handle:${channel}`), removeHandler: (channel) => calls.push(`remove:${channel}`) },
    createCollaborator: (lifecycle) => { lifecycle.onCapabilityRegistered({ webContentsId: 9 }); lifecycle.onWindowState(9, { visible: true, focused: true }); return { lifecycle } },
    createHandlers: () => ({ 'project-chat:test': () => undefined }),
  })
  composition.dispose()
  assert.deepEqual(calls.slice(-4), ['presence:7', 'broker:7', 'capability:7', 'remove:project-chat:test'])
  assert.equal(sinks.at(-1).length, 1)

  assert.throws(() => createProjectChatProductionComposition({
    multiplexer: { setSinks: () => {} }, legacySinks: [], broker, taskHomeSink: { publish() {} }, capabilities, presence,
    mainWindow: { webContents: { id: 1 }, isVisible: () => true, isFocused: () => true, on: () => {} },
    registrar: { handle: () => { throw new Error('register-failed') }, removeHandler: () => {} }, createCollaborator: () => ({}), createHandlers: () => ({ 'project-chat:fail': () => undefined }),
  }), /register-failed/)
})
