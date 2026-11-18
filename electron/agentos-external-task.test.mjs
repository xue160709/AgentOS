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
function fixture({ submitFails = false, accepted, snapshot, postReceipt, receiptRetryDelaysMs } = {}) {
  const records = new Map(), posts = []; let creates = 0, submits = 0
  const receipts = {
    async recordExecution(binding, idempotencyKey, receipt) { records.get(`${binding}:${idempotencyKey}`).executionReceipt = receipt },
    async lookup(binding, idempotencyKey, hash) { const record = records.get(`${binding}:${idempotencyKey}`); return !record ? { kind: 'missing' } : record.payloadHash === hash ? { kind: 'match', record: { ...record } } : { kind: 'idempotency-conflict', record: { ...record } } },
    async begin(input) { const payloadHash = require('node:crypto').createHash('sha256').update(`${input.title.trim()}\n${input.task.trim()}`, 'utf8').digest('hex'); const record = { bindingId: input.bindingId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, payloadHash, state: 'fetching' }; records.set(`${input.bindingId}:${input.idempotencyKey}`, record); return { kind: 'match', record: { ...record } } },
    async transition(input) { const record = records.get(`${input.bindingId}:${input.idempotencyKey}`); Object.assign(record, { state: input.state, ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.requestIdLocal ? { requestIdLocal: input.requestIdLocal } : {}), ...(input.rejectionCode ? { rejectionCode: input.rejectionCode } : {}) }); return { ...record } },
  }
  const envelope = { version: 1, kind: 'task', request_id: requestId, origin: 'https://example.com', binding_id: bindingId, issued_at: 99, expires_at: 101, idempotency_key: key, title: 'Safe title', task: 'Safe task' }
  return { posts, records, get creates() { return creates }, get submits() { return submits }, service: new (load().AgentOSExternalTaskService)({
    bindings: { findActiveByOrigin: async () => ({ bindingId, origin: 'https://example.com', projectId: 'project-1' }), credentialFor: async () => ({ ok: true, value: 'c'.repeat(43) }) },
    tickets: { getTask: async () => ({ ok: true, value: envelope }), postTaskReceipt: async (input) => { posts.push(input.receipt); return postReceipt ? postReceipt(input.receipt) : { ok: true, value: undefined } }, }, receipts,
    broker: { ...(snapshot ? { getSnapshot: async () => ({ ok: true, value: snapshot }) } : {}), createThread: async (input) => { creates++; assert.equal(input.projectId, 'project-1'); assert.equal(input.source, 'website'); return { ok: true, value: { threadId: 'thread-1' } } }, submitRun: async (input) => { submits++; assert.deepEqual(input, { projectId: 'project-1', threadId: 'thread-1', text: 'Safe task' }); return submitFails ? { ok: false, error: { code: 'sdk-submit-failed' } } : { ok: true, value: { requestId: 'local-run' } } } }, accepted: accepted ? async (input) => accepted.push(input) : undefined, now: () => 100, receiptRetryDelaysMs,
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

test('external task notifies acceptance once without window focus state', async () => {
  const accepted = [], subject = fixture({ accepted })
  const link = { action: 'task', origin: 'https://example.com', requestId }
  await subject.service.handle(link)
  await subject.service.handle(link)
  assert.deepEqual(accepted, [{ projectId: 'project-1', threadId: 'thread-1', receivedAt: 100 }])
})

test('SDK failure retains the already-created thread and records a terminal rejected receipt', async () => {
  const subject = fixture({ submitFails: true }); const result = await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId })
  assert.deepEqual(result, { status: 'rejected', code: 'sdk-submit-failed' }); assert.equal(subject.creates, 1)
  assert.equal(subject.records.get(`${bindingId}:${key}`).state, 'rejected')
})

const tick = () => new Promise((resolve) => setImmediate(resolve))
test('execution receipts follow accepted, persist final text, replay without executing again', async () => {
  const snapshot = { runs: [{ requestId: 'local-run', phase: 'running' }], threads: [{ id: 'thread-1', chatState: { items: [] } }] }
  const subject = fixture({ snapshot })
  const link = { action: 'task', origin: 'https://example.com', requestId }
  await subject.service.handle(link); await tick()
  assert.deepEqual(subject.posts.map((p) => p.status), ['accepted', 'running'])
  const completed = { runs: [{ requestId: 'local-run', phase: 'succeeded', finalResult: 'Created article/assets/figure.png' }], threads: [{ id: 'thread-1', chatState: { items: [
    { type: 'thinking', content: 'private reasoning' }, { type: 'tool', detail: 'private token' },
    { type: 'message', role: 'assistant', content: 'private analyze_image input signed-url; accumulated progress; Created article/assets/figure.png' },
  ] } }] }
  subject.service.observe({ projectId: 'project-1', snapshot: completed }); await tick()
  subject.service.observe({ projectId: 'project-1', snapshot: completed }); await tick()
  assert.equal(subject.posts.length, 3)
  assert.equal(subject.posts[2].status, 'completed')
  assert.equal(subject.posts[2].thread_id, 'thread-1')
  assert.equal(subject.posts[2].summary, 'Created article/assets/figure.png')
  assert.ok(!JSON.stringify(subject.posts).includes('private'))
  await subject.service.handle(link)
  assert.equal(subject.posts.at(-1).status, 'completed')
  assert.equal(subject.creates, 1)
})

test('terminal state emitted during submit is recovered from broker snapshot and cancellation fails', async () => {
  const subject = fixture({ snapshot: { runs: [{ requestId: 'local-run', phase: 'cancelled', error: { message: 'Cancelled' } }], threads: [] } })
  await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId }); await tick()
  assert.deepEqual(subject.posts.map((p) => p.status), ['accepted', 'failed'])
  assert.equal(subject.posts.at(-1).summary, 'Cancelled')
})


test('waiting phases are delivered and an interrupted accepted run gets a terminal receipt on replay', async () => {
  const snapshot = { routeGeneration: 1, runs: [{ requestId: 'local-run', phase: 'running' }], threads: [] }
  const subject = fixture({ snapshot })
  const link = { action: 'task', origin: 'https://example.com', requestId }
  await subject.service.handle(link); await tick()
  subject.service.observe({ projectId: 'project-1', snapshot: { ...snapshot, runs: [{ requestId: 'local-run', phase: 'waiting_permission' }] } }); await tick()
  assert.equal(subject.posts.at(-1).phase, 'waiting_permission')
  assert.equal(subject.posts.at(-1).status, 'running')
  const interrupted = fixture({ snapshot: { routeGeneration: 1, runs: [], threads: [] } })
  await interrupted.service.handle(link); await tick()
  assert.equal(interrupted.posts.at(-1).status, 'failed')
  assert.match(interrupted.posts.at(-1).summary, /interrupted/)
})


test('terminal delivery retries automatically after transient outage and dispose cancels retry timers', async () => {
  const snapshot = { runs: [{ requestId: 'local-run', phase: 'succeeded' }], threads: [] }
  let failures = 0
  const subject = fixture({ snapshot, receiptRetryDelaysMs: [5, 5], postReceipt: (receipt) => ({ ok: receipt.status !== 'completed' || ++failures >= 3 }) })
  await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(failures, 3)
  assert.equal(subject.creates, 1)
  subject.service.dispose()
  const cancelled = fixture({ snapshot, receiptRetryDelaysMs: [30, 30], postReceipt: receipt => ({ ok: receipt.status !== 'completed' }) })
  await cancelled.service.handle({ action: 'task', origin: 'https://example.com', requestId }); await tick()
  const sent = cancelled.posts.length
  cancelled.service.dispose()
  await new Promise(resolve => setTimeout(resolve, 70))
  assert.equal(cancelled.posts.length, sent)
  cancelled.service.observe({ projectId: 'project-1', snapshot }); await tick()
  assert.equal(cancelled.posts.length, sent)
})


test('progress never exports accumulated assistant text and missing final answer does not fall back to it', async () => {
  const snapshot = { runs: [{ requestId: 'local-run', phase: 'running' }], threads: [{ id: 'thread-1', chatState: { items: [{ type: 'message', role: 'assistant', content: 'private tool payload and signed URL' }] } }] }
  const subject = fixture({ snapshot })
  await subject.service.handle({ action: 'task', origin: 'https://example.com', requestId }); await tick()
  assert.equal(subject.posts.at(-1).summary, '')
  subject.service.observe({ projectId: 'project-1', snapshot: { ...snapshot, runs: [{ requestId: 'local-run', phase: 'succeeded' }] } }); await tick()
  assert.equal(subject.posts.at(-1).summary, '')
  assert.ok(!JSON.stringify(subject.posts).includes('private'))
})
