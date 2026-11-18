import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
function load(modulePath, cache = new Map()) {
  const file = resolve(modulePath); const cached = cache.get(file); if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file })
  const module = { exports: {} }; cache.set(file, module)
  Function('exports', 'module', 'require', outputText)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(file), `${specifier}.ts`)) ? load(resolve(dirname(file), `${specifier}.ts`), cache) : require(specifier))
  return module.exports
}
function workspace(path = '/project') { return { workspaceRevision: 0, projects: [{ id: 'p', name: 'Project', path, createdAt: 1, updatedAt: 1 }], threads: [{ id: 't', projectId: 'p', title: 'T', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', sessionId: 'durable-session', modelPick: { providerId: 'p1', anthropicModel: 'm1' }, items: [] } }] } }
function settings() { return { settings: { configSource: 'settings', activeProviderId: 'p1', activeAnthropicModel: 'active', providers: [{ id: 'p1', name: 'Provider', model: 'm', modelSupportsImages: true, defaultHaikuModel: 'h', defaultHaikuSupportsImages: false, defaultOpusModel: 'o', defaultOpusSupportsImages: false, defaultSonnetModel: 's', defaultSonnetSupportsImages: true, apiKey: 'credential-sentinel', authToken: 'token', baseUrl: 'https://secret', apiKeyUrl: 'https://key', authMode: 'apiKey' }] }, env: { hasApiKey: true, hasAuthToken: true, baseUrl: 'env-secret', model: 'env-model', supportsImages: true, defaultHaikuModel: '', defaultOpusModel: '', defaultSonnetModel: '' } } }

test('runner adapter delegates exactly and reset only calls newThread', async () => {
  const { createProjectChatBrokerRunnerAdapter } = load(resolve(testDir, './project-chat-runtime-services.ts'))
  const calls = []; const failure = new Error('reject')
  const runner = { submit: (x) => { calls.push(['submit', x]); return { requestId: 'r' } }, cancel: async (x) => { calls.push(['cancel', x]); throw failure }, answerPermissionRequest: async (x) => { calls.push(['answer', x]) }, newThread: async (x) => { calls.push(['new', x]) }, rewindFiles: async (x) => { calls.push(['rewind', x]); return { ok: true, changeSetId: x.changeSetId } }, getStatus: async () => ({}) }
  const adapter = createProjectChatBrokerRunnerAdapter(runner)
  assert.deepEqual(await adapter.submit({ text: 'x' }), { requestId: 'r' }); await assert.rejects(adapter.cancel('r'), failure); await adapter.answerPermissionRequest({ permissionRequestId: 'p', behavior: 'allow' }); await adapter.resetThread('thread'); await assert.deepEqual(await adapter.rewindFiles({ checkpointId: 'checkpoint', threadId: 'thread', sessionId: 'durable' }), { ok: true, changeSetId: undefined })
  assert.deepEqual(calls.map(([name]) => name), ['submit', 'cancel', 'answer', 'new', 'rewind']); assert.equal(calls[3][1], 'thread'); assert.deepEqual(calls[4][1], { checkpointId: 'checkpoint', threadId: 'thread', sessionId: 'durable' })
})

test('scoped services fresh-read durable state and never return settings/status secrets', async () => {
  const { createProjectChatScopedReadCollaborator } = load(resolve(testDir, './project-chat-runtime-services.ts'))
  let state = workspace(); let settingReads = 0; const calls = []
  const service = createProjectChatScopedReadCollaborator({ workspace: { read: () => state }, settings: { getSnapshot: () => { settingReads += 1; return settings() } }, runner: { getStatus: async (payload) => { calls.push(['status', payload]); return { threadId: 't', active: false, reportedModel: 'm', permissionMode: 'auto', tools: ['tool'], skills: [], slashCommands: [], agents: [], cwd: '/secret', sessionId: 'secret', baseUrl: 'secret', endpointHost: 'secret', apiKeySource: 'secret', configSource: 'env', authentication: 'api-key', route: 'custom-gateway' } } }, discoverAgentContext: async (root) => { calls.push(['context', root]); return { skills: [{ kind: 'skill', name: 's', command: '/s', title: 'S', description: 'D', argumentHint: '', relativePath: 'skills/s.md', scope: 'project', source: 'claude', native: false, path: '/secret', instruction: 'secret' }], agents: [] } }, searchProjectFiles: async (root) => { calls.push(['search', root]); return { ok: true, rootPath: root, items: [{ label: 'a', relativePath: 'src/a.ts', type: 'file', path: '/secret' }] } }, pickAttachments: async () => ({ attachments: [], skipped: [] }), readAttachments: async () => ({ attachments: [], skipped: [] }), realpath: async (x) => x })
  const one = await service.getModelCatalog(); const two = await service.getModelCatalog(); assert.equal(settingReads, 2); assert.equal(JSON.stringify([one, two]).includes('secret'), false); assert.equal(JSON.stringify(one).includes('credential-sentinel'), false)
  await service.getAgentContext('p'); state.projects[0].path = '/next'; await service.searchProjectFiles({ projectId: 'p', query: 'a' }); const status = await service.getThreadStatus({ projectId: 'p', threadId: 't' })
  assert.deepEqual(calls.filter(([name]) => name === 'context' || name === 'search').map(([, value]) => value), ['/project', '/next']); assert.deepEqual(calls.find(([name]) => name === 'status')[1], { threadId: 't', cwd: '/next', refresh: false, sessionId: 'durable-session', modelPick: { providerId: 'p1', anthropicModel: 'm1' } }); assert.equal(JSON.stringify(status).includes('secret'), false)
  state.projects[0].pathMissing = true; await assert.rejects(service.getAgentContext('p')); assert.equal(calls.filter(([name]) => name === 'context').length, 1)
})

test('project and runtime catalogs reflect added and removed models and exclude providers without credentials', async () => {
  const { createProjectChatScopedReadCollaborator, createRuntimeChatScopedReadCollaborator } = load(resolve(testDir, './project-chat-runtime-services.ts'))
  const snapshot = settings()
  const options = { workspace: { read: () => workspace() }, settings: { getSnapshot: () => snapshot }, runner: {}, discoverAgentContext: async () => ({}), searchProjectFiles: async () => ({}), pickAttachments: async () => ({}), readAttachments: async () => ({}), realpath: async (x) => x, runtimeWorkspace: { read: () => ({}) }, resolveScope: () => null }
  const services = [createProjectChatScopedReadCollaborator(options), createRuntimeChatScopedReadCollaborator(options)]
  for (const service of services) assert.equal((await service.getModelCatalog()).providers[0].model, 'm')
  snapshot.settings.providers[0].model = 'new-model'
  snapshot.settings.providers[0].defaultHaikuModel = ''
  snapshot.settings.providers.push({ ...snapshot.settings.providers[0], id: 'empty', apiKey: '', authToken: '' })
  for (const service of services) {
    const catalog = await service.getModelCatalog()
    assert.equal(catalog.providers.length, 1)
    assert.equal(catalog.providers[0].model, 'new-model')
    assert.equal(catalog.providers[0].defaultHaikuModel, '')
    assert.equal(JSON.stringify(catalog).includes('credential-sentinel'), false)
  }
})

test('attachment reads canonicalize candidates before reader and turn escapes into generic skips', async () => {
  const { createProjectChatScopedReadCollaborator } = load(resolve(testDir, './project-chat-runtime-services.ts'))
  const realpaths = []; const read = []; const service = createProjectChatScopedReadCollaborator({ workspace: { read: () => workspace('/root') }, settings: { getSnapshot: settings }, runner: { getStatus: async () => ({}) }, discoverAgentContext: async () => ({}), searchProjectFiles: async () => ({ ok: true, rootPath: '/root', items: [] }), pickAttachments: async () => ({ attachments: [], skipped: [] }), readAttachments: async (paths, allowImages) => { read.push([paths, allowImages]); return { attachments: [{ id: 'ok', kind: 'text', name: 'ok.md', mimeType: 'text/markdown', size: 999, text: 'ok', path: '/root/ok.md' }], skipped: [{ name: '/secret', path: '/secret', reason: 'secret' }] } }, realpath: async (input) => { realpaths.push(input); return input === '/root' ? '/real/root' : input.endsWith('ok.md') ? '/real/root/ok.md' : input.endsWith('escape.md') ? '/outside/escape.md' : Promise.reject(new Error('missing')) } })
  const result = await service.readProjectAttachments({ projectId: 'p', relativePaths: ['dir\\ok.md', 'escape.md', 'missing.md'], allowImages: true })
  assert.deepEqual(realpaths, ['/root', '/real/root/dir/ok.md', '/real/root/escape.md', '/real/root/missing.md']); assert.deepEqual(read, [[['/real/root/ok.md'], true]]); assert.equal(JSON.stringify(result).includes('/outside'), false); assert.equal(result.skipped.length, 3)
  await assert.rejects(service.readProjectAttachments({ projectId: 'p', relativePaths: ['/abs'], allowImages: false })); await assert.rejects(service.readProjectAttachments({ projectId: 'p', relativePaths: Array.from({ length: 9 }, () => 'x') }))
})

test('Runtime scoped services fresh-resolve Project cwd versus Workspace root and fence cross-scope threads', async () => {
  const { createRuntimeChatScopedReadCollaborator } = load(resolve(testDir, './project-chat-runtime-services.ts'))
  const scopes = {
    'project:p': { runtimeScopeId: 'project:p', runtimeDefinitionId: 'rd-p', runtimeOwner: { kind: 'project', projectId: 'p' }, cwd: '/project', runtimeRoot: '/project/.agentos', routeGeneration: 1, developmentGeneration: 1 },
    'workspace:w': { runtimeScopeId: 'workspace:w', runtimeDefinitionId: 'w', runtimeOwner: { kind: 'workspace' }, cwd: '/runtime', runtimeRoot: '/runtime', routeGeneration: 1, developmentGeneration: 1 },
  }
  const runtimeWorkspace = { schemaVersion: 1, runtimeThreadRevision: 1, runtimeDevelopmentThreads: [{ id: 'rt', purpose: 'runtime-development', runtimeScopeId: 'workspace:w', runtimeDefinitionId: 'w', runtimeOwner: { kind: 'workspace' }, title: 'Runtime', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' }, chatState: { model: 'Claude', sessionId: 'session', items: [] } }] }
  const calls = []
  const service = createRuntimeChatScopedReadCollaborator({ runtimeWorkspace: { read: () => runtimeWorkspace }, resolveScope: (id) => scopes[id] ?? null, settings: { getSnapshot: settings }, runner: { getStatus: async (payload) => { calls.push(['status', payload]); return { threadId: payload.threadId, active: false, reportedModel: 'm', permissionMode: 'auto', tools: [], skills: [], slashCommands: [], agents: [] } } }, discoverAgentContext: async (root) => { calls.push(['context', root]); return { skills: [], agents: [] } }, searchProjectFiles: async (root) => { calls.push(['search', root]); return { ok: true, items: [] } }, pickAttachments: async () => ({ attachments: [], skipped: [] }), readAttachments: async () => ({ attachments: [], skipped: [] }), realpath: async (input) => input })
  await service.getAgentContext('project:p'); await service.searchFiles('workspace:w', { query: 'x' }); await service.getThreadStatus('workspace:w', { threadId: 'rt' })
  assert.deepEqual(calls.filter(([name]) => name === 'context' || name === 'search'), [['context', '/project'], ['search', '/runtime']])
  assert.equal(calls.find(([name]) => name === 'status')[1].cwd, '/runtime')
  await assert.rejects(service.getThreadStatus('project:p', { threadId: 'rt' }), /thread-unavailable/)
  await assert.rejects(service.getAgentContext('workspace:missing'), /runtime-scope-unavailable/)
})
