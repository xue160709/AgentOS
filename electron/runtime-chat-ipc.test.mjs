import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url); const ts = require('typescript'); const testDir = dirname(fileURLToPath(import.meta.url))
function load(modulePath, cache = new Map()) { const file = resolve(modulePath); const cached = cache.get(file); if (cached) return cached.exports; const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file }); const module = { exports: {} }; cache.set(file, module); Function('exports', 'module', 'require', outputText)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(file), `${specifier}.ts`)) ? load(resolve(dirname(file), `${specifier}.ts`), cache) : require(specifier)); return module.exports }
function event(id, url = 'http://renderer.test/index.html?runtimeScopeId=workspace%3Aforged#ignored', subframe = false) { const mainFrame = { url }; return { sender: { id, mainFrame }, senderFrame: subframe ? { url } : mainFrame } }
function ok(value) { return { ok: true, value } }
function makeHarness() {
  const ipc = load(resolve(testDir, './runtime-chat-ipc.ts')); const { RendererCapabilityRegistry } = load(resolve(testDir, './project-chat-ipc.ts'))
  const capabilities = new RendererCapabilityRegistry(); capabilities.registerRuntimeDevelopmentWindow(7, 'workspace:w1', 3, 5); capabilities.registerProjectWindow(8, 'p1', 3); capabilities.registerMainWindow(1)
  const broker = { calls: [], routeGenerationOf: () => 3, developmentGenerationOf: () => 5, getSnapshot: async (authority) => { broker.calls.push(['snapshot', authority]); return ok({ runtimeScopeId: 'workspace:w1', runtimeThreadRevision: 1, sequence: 1, routeGeneration: 3, developmentGeneration: 5, scopeAvailable: true, threads: [], runs: [], pendingPrompts: [], permissionMode: 'auto' }) }, createThread: async (authority, input) => { broker.calls.push(['create', authority, input]); return ok({ threadId: 't1', runtimeThreadRevision: 2 }) }, submitRun: async (authority, input) => { broker.calls.push(['submit', authority, input]); return ok({ requestId: 'r1' }) }, forkThread: async () => ok({ threadId: 'f1', runtimeThreadRevision: 2 }), editAndSubmitRun: async () => ok({ requestId: 'r2' }), archiveThread: async () => ok(undefined), setThreadPinned: async () => ok(undefined), setThreadModel: async () => ok(undefined), markFileDiffReviewed: async () => ok(undefined), rewindFileDiff: async () => ok({ changeSetId: 'c', status: 'reverted' }), cancelRun: async () => ok(undefined), answerPrompt: async () => ok(undefined) }
  const scopedRead = { getModelCatalog: async () => ({ activeProviderId: 'p', activeAnthropicModel: 'm', providers: [{ id: 'p', name: 'Provider', model: 'm', modelSupportsImages: true, defaultHaikuModel: 'h', defaultHaikuSupportsImages: false, defaultOpusModel: 'o', defaultOpusSupportsImages: false, defaultSonnetModel: 's', defaultSonnetSupportsImages: true, apiKey: 'credential' }] }), getAgentContext: async (scopeId) => ({ skills: [{ kind: 'skill', name: 's', command: '/s', title: 'S', description: 'D', argumentHint: '', relativePath: 'skills/s.md', scope: 'project', source: 'claude', native: false, root: '/secret' }], agents: [], scopeId, root: '/secret' }), searchFiles: async (scopeId) => ({ ok: true, rootPath: '/secret', items: [{ label: scopeId, relativePath: 'src/a.ts', type: 'file', path: '/secret' }] }), pickAttachments: async () => ({ attachments: [], skipped: [] }), readAttachments: async () => ({ attachments: [], skipped: [{ name: '/secret', reason: '/secret' }] }), getThreadStatus: async (_scope, input) => ({ threadId: input.threadId, active: false, reportedModel: 'm', permissionMode: 'auto', tools: [], skills: [], slashCommands: [], agents: [], cwd: '/secret' }) }
  const window = { getWindowContext: async (id) => ok({ runtimeScopeId: 'workspace:w1', runtimeName: `Runtime ${id}`, ownerLabel: '工作台', scopeAvailable: true }), getWindowViewState: async (scope) => ok({ schemaVersion: 1, runtimeScopeId: scope, selectedThreadId: 't1', draft: 'draft', updatedAt: 1 }), saveWindowViewState: async (scope, input) => ok({ schemaVersion: 1, runtimeScopeId: scope, ...input.patch, draft: input.patch.draft ?? '', updatedAt: 2 }), reportPresenceSelection: (id, scope, input) => { broker.calls.push(['presence', id, scope, input]); return ok(undefined) } }
  const router = ipc.createRuntimeChatIpcRouter({ broker, capabilities, rendererEntries: ['http://renderer.test/index.html'], scopedRead, window })
  return { ...ipc, router, broker, capabilities, scopedRead }
}

test('Runtime model catalog accepts empty optional model slots and strips credentials', async () => {
  const h = makeHarness()
  h.scopedRead.getModelCatalog = async () => ({ activeProviderId: 'p', activeAnthropicModel: '', providers: [{ id: 'p', name: 'Provider', model: 'model-a', modelSupportsImages: false, defaultHaikuModel: '', defaultHaikuSupportsImages: false, defaultOpusModel: '', defaultOpusSupportsImages: false, defaultSonnetModel: '', defaultSonnetSupportsImages: false, apiKey: 'secret' }] })
  const result = await h.router.getModelCatalog(event(7))
  assert.equal(result.ok, true)
  assert.equal(result.value.providers[0].model, 'model-a')
  assert.equal(JSON.stringify(result).includes('secret'), false)
  h.scopedRead.getModelCatalog = async () => ({ activeProviderId: '', activeAnthropicModel: '', providers: [] })
  assert.equal((await h.router.getModelCatalog(event(7))).ok, true)
})

test('Runtime capability rejects Preview, unknown, project/main windows, subframes, and wrong documents', async () => {
  const h = makeHarness(); const attempts = [event(99), event(8), event(1), event(7, undefined, true), event(7, 'http://evil.test/index.html')]
  for (const sender of attempts) assert.equal((await h.router.getSnapshot(sender)).error.code, 'sender-not-authorized')
  assert.equal(h.broker.calls.length, 0)
})

test('Runtime router ignores query identity and injects only the registered capability authority', async () => {
  const h = makeHarness(); const result = await h.router.getSnapshot(event(7)); assert.equal(result.ok, true)
  assert.deepEqual(h.broker.calls[0], ['snapshot', { runtimeScopeId: 'workspace:w1', routeGeneration: 3, developmentGeneration: 5, ownerWebContentsId: 7 }])
  assert.equal(JSON.stringify(result).includes('ownerWebContentsId'), false)
})

test('Runtime DTO whitelist rejects renderer root, scope, generation, route, and durable thread spoofing', async () => {
  const h = makeHarness(); const forged = [
    { threadId: 't1', text: 'x', runtimeScopeId: 'workspace:w2' },
    { threadId: 't1', text: 'x', root: '/secret' },
    { threadId: 't1', text: 'x', cwd: '/secret' },
    { threadId: 't1', text: 'x', routeGeneration: 3 },
    { threadId: 't1', text: 'x', developmentGeneration: 5 },
    { threadId: 't1', text: 'x', chatState: { items: [] } },
  ]
  for (const input of forged) assert.equal((await h.router.submitRun(event(7), input)).error.code, 'invalid-argument')
  assert.equal((await h.router.createThread(event(7), { title: 'T', runtimeOwner: { kind: 'workspace' } })).error.code, 'invalid-argument')
  assert.equal(h.broker.calls.length, 0)
})

test('stale Runtime capability is rejected before any collaborator or broker call', async () => {
  const h = makeHarness(); h.broker.developmentGenerationOf = () => 6
  assert.equal((await h.router.submitRun(event(7), { threadId: 't1', text: 'x' })).error.code, 'sender-not-authorized')
  assert.equal((await h.router.searchFiles(event(7), { query: 'a' })).error.code, 'sender-not-authorized')
  assert.equal((await h.router.answerPrompt(event(7), { threadId: 't1', requestId: 'r1', promptId: 'prompt-1', response: { permissionRequestId: 'prompt-1', behavior: 'allow' } })).error.code, 'sender-not-authorized', 'late answers from the previous window generation are rejected')
  assert.equal(h.broker.calls.length, 0)
})

test('scoped reads receive capability scope and project only safe fields', async () => {
  const h = makeHarness(); const model = await h.router.getModelCatalog(event(7)); const context = await h.router.getAgentContext(event(7)); const files = await h.router.searchFiles(event(7), { query: 'a' }); const skipped = await h.router.readAttachments(event(7), { relativePaths: ['a.md'] }); const status = await h.router.getThreadStatus(event(7), { threadId: 't1' })
  assert.equal([model, context, files, skipped, status].every((item) => item.ok), true)
  const serialized = JSON.stringify([model, context, files, skipped, status]); assert.equal(serialized.includes('/secret'), false); assert.equal(serialized.includes('credential'), false); assert.equal(files.value[0].label, 'workspace:w1')
})

test('Runtime broadcaster delivers only the exact scope and both generations', () => {
  const h = makeHarness(); h.capabilities.registerRuntimeDevelopmentWindow(9, 'workspace:w1', 3, 4); h.capabilities.registerRuntimeDevelopmentWindow(10, 'workspace:w2', 3, 5)
  const delivered = []; const publish = h.createRuntimeChatCapabilityBroadcaster(h.capabilities, (id) => delivered.push(id)); publish({ type: 'snapshot', runtimeScopeId: 'workspace:w1', sequence: 1, routeGeneration: 3, developmentGeneration: 5, runtimeThreadRevision: 1, snapshot: { runtimeScopeId: 'workspace:w1', runtimeThreadRevision: 1, sequence: 1, routeGeneration: 3, developmentGeneration: 5, scopeAvailable: true, threads: [], runs: [], pendingPrompts: [], permissionMode: 'auto' } })
  assert.deepEqual(delivered, [7])
})

test('Runtime window state and presence derive scope from capability and reject scope spoofing', async () => {
  const h = makeHarness(); const context = await h.router.getWindowContext(event(7)); const view = await h.router.getWindowViewState(event(7)); const saved = await h.router.saveWindowViewState(event(7), { patch: { selectedThreadId: 't1', draft: 'next' } }); const presence = await h.router.reportPresenceSelection(event(7), { selectedThreadId: 't1' })
  assert.equal(context.value.runtimeScopeId, 'workspace:w1'); assert.equal(view.value.runtimeScopeId, 'workspace:w1'); assert.equal(saved.value.draft, 'next'); assert.equal(presence.ok, true)
  assert.deepEqual(h.broker.calls.at(-1), ['presence', 7, 'workspace:w1', { selectedThreadId: 't1' }])
  assert.equal((await h.router.saveWindowViewState(event(7), { patch: { runtimeScopeId: 'workspace:forged', draft: 'x' } })).error.code, 'invalid-argument')
})
