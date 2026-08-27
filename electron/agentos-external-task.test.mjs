import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript'); const testDir = dirname(fileURLToPath(import.meta.url))
function loadTsModule(file, cache = new Map()) { const resolved = resolve(file), cached = cache.get(resolved); if (cached) return cached.exports; const output = ts.transpileModule(readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolved }).outputText; const module = { exports: {} }; cache.set(resolved, module); const localRequire = (specifier) => { const candidate = resolve(dirname(resolved), `${specifier}.ts`); return specifier.startsWith('.') && existsSync(candidate) ? loadTsModule(candidate, cache) : require(specifier) }; Function('exports', 'module', 'require', output)(module.exports, module, localRequire); return module.exports }
function load() { return loadTsModule(resolve(testDir, 'agentos-external-task.ts')) }

const requestId = 'r'.repeat(16), bindingId = `bnd_${'b'.repeat(16)}`, key = 'k'.repeat(16)
function fixture({ submitFails = false, before, accepted } = {}) {
  const records = new Map(), posts = []; let creates = 0, submits = 0
  const receipts = {
    async lookup(binding, idempotencyKey, hash) { const record = records.get(`${binding}:${idempotencyKey}`); return !record ? { kind: 'missing' } : record.payloadHash === hash ? { kind: 'match', record: { ...record } } : { kind: 'idempotency-conflict', record: { ...record } } },
    async begin(input) { const payloadHash = require('node:crypto').createHash('sha256').update(`${input.title.trim()}\n${input.task.trim()}`, 'utf8').digest('hex'); const record = { bindingId: input.bindingId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, payloadHash, state: 'fetching' }; records.set(`${input.bindingId}:${input.idempotencyKey}`, record); return { kind: 'match', record: { ...record } } },
    async transition(input) { const record = records.get(`${input.bindingId}:${input.idempotencyKey}`); Object.assign(record, { state: input.state, ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.requestIdLocal ? { requestIdLocal: input.requestIdLocal } : {}), ...(input.rejectionCode ? { rejectionCode: input.rejectionCode } : {}) }); return { ...record } },
  }
  const envelope = { version: 1, kind: 'task', request_id: requestId, origin: 'https://example.com', binding_id: bindingId, issued_at: 99, expires_at: 101, idempotency_key: key, title: 'Safe title', task: 'Safe task' }
  return { posts, records, get creates() { return creates }, get submits() { return submits }, service: new (load().AgentOSExternalTaskService)({
    bindings: { findActiveByOrigin: async () => ({ bindingId, origin: 'https://example.com', projectId: 'project-1' }), credentialFor: async () => ({ ok: true, value: 'c'.repeat(43) }) },
    tickets: { getTask: async () => ({ ok: true, value: envelope }), postTaskReceipt: async (input) => { posts.push(input.receipt); return { ok: true, value: undefined } }, }, receipts,
    broker: { createThread: async (input) => { creates++; assert.equal(input.projectId, 'project-1'); assert.equal(input.source, 'website'); return { ok: true, value: { threadId: 'thread-1' } } }, submitRun: async (input) => { submits++; assert.deepEqual(input, { projectId: 'project-1', threadId: 'thread-1', text: 'Safe task' }); return submitFails ? { ok: false, error: { code: 'sdk-submit-failed' } } : { ok: true, value: { requestId: 'local-run' } } } }, beforeCreate: before ? async () => before : undefined, accepted: accepted ? async (input) => accepted.push(input) : undefined, now: () => 100,
  }) }
}

test('external task is durable before submit, accepted is idempotent, and website fields cannot alter broker authority', async () => {
  const subject = fixture(); const link = { action: 'task', origin: 'https://example.com', requestId }
  assert.deepEqual(await subject.service.handle(link), { status: 'accepted' })
  assert.equal(subject.creates, 1); assert.equal(subject.submits, 1)
  assert.deepEqual(await subject.service.handle(link), { status: 'accepted' })
  assert.equal(subject.creates, 1); assert.equal(subject.posts.length, 2)
  assert.equal(subject.records.get(`${bindingId}:${key}`).requestIdLocal, 'local-run')
})

test('external task captures each pre-broker focus state and only hands it to accepted integration', async () => {
  for (const before of [{ exists: false, idle: true }, { exists: true, idle: true }, { exists: true, idle: false, draft: 'x' }, { exists: true, idle: false, activeRun: true }, { exists: true, idle: false, pendingPrompt: true }]) {
    const accepted = []; const subject = fixture({ before, accepted }); await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId }); assert.equal(accepted.length, 1); assert.deepEqual(accepted[0].before, before); assert.equal(accepted[0].threadId, 'thread-1')
  }
})

test('SDK failure retains the already-created thread and records a terminal rejected receipt', async () => {
  const subject = fixture({ submitFails: true }); const result = await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId })
  assert.deepEqual(result, { status: 'rejected', code: 'sdk-submit-failed' }); assert.equal(subject.creates, 1)
  assert.equal(subject.records.get(`${bindingId}:${key}`).state, 'rejected')
})
