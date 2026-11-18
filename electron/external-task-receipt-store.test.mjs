import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
function loadStore() { const file = resolve(testDir, './external-task-receipt-store.ts'); const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file }); const module = { exports: {} }; Function('exports', 'module', 'require', outputText)(module.exports, module, require); return module.exports }
async function withTemp(callback) { const dir = await mkdtemp(join(tmpdir(), 'agentos-receipt-store-')); try { return await callback(dir) } finally { await rm(dir, { recursive: true, force: true }) } }

test('receipt store makes payload idempotency durable and enforces the state machine', async () => {
  const { ExternalTaskReceiptStore } = loadStore()
  await withTemp(async (userDataPath) => {
    let now = 10
    const store = new ExternalTaskReceiptStore({ userDataPath, now: () => now++ })
    const input = { bindingId: 'binding-1', requestId: 'request-1', idempotencyKey: 'key-1', title: ' Title ', task: ' Task ' }
    const first = await store.begin(input)
    assert.equal(first.kind, 'match')
    assert.equal(first.record.state, 'fetching')
    assert.equal((await store.begin(input)).record.createdAt, first.record.createdAt)
    assert.equal((await store.begin({ ...input, task: 'different' })).kind, 'idempotency-conflict')
    await store.transition({ bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, state: 'validated' })
    await store.transition({ bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, state: 'thread-created', threadId: 'local-thread' })
    await store.transition({ bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, state: 'submitting' })
    const accepted = await store.transition({ bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, state: 'accepted', requestIdLocal: 'local-request' })
    assert.equal(accepted.state, 'accepted')
    assert.equal((await store.transition({ bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, state: 'accepted', requestIdLocal: 'ignored' })).requestIdLocal, 'local-request')
    assert.doesNotMatch(readFileSync(store.filePath, 'utf8'), /Title|Task|different/)
    const receipt = { status: 'completed', summary: 'Created figure.png', thread_id: 'local-thread' }
    await store.recordExecution(input.bindingId, input.idempotencyKey, receipt)
    const reopened = new ExternalTaskReceiptStore({ userDataPath, now: () => now++ })
    assert.deepEqual((await reopened.lookup(input.bindingId, input.idempotencyKey, first.record.payloadHash)).record.executionReceipt, receipt)
  })
})

test('receipt store recovers in-flight records, preserves non-terminal capacity, evicts terminal records, and backs up corruption', async () => {
  const { ExternalTaskReceiptStore } = loadStore()
  await withTemp(async (userDataPath) => {
    const filePath = join(userDataPath, 'external-task-receipts.json')
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, records: [
      { bindingId: 'b', requestId: 'r', idempotencyKey: 'inflight', payloadHash: 'a', state: 'thread-created', threadId: 'thread', createdAt: 1, updatedAt: 1 },
      { bindingId: 'b', requestId: 'r2', idempotencyKey: 'old', payloadHash: 'b', state: 'accepted', createdAt: 1, updatedAt: 1 },
      ...Array.from({ length: 1_001 }, (_, index) => ({ bindingId: 'capacity', requestId: `r${index}`, idempotencyKey: `k${index}`, payloadHash: `${index}`, state: 'accepted', createdAt: index + 10, updatedAt: index + 10 })),
      { bindingId: 'capacity', requestId: 'live', idempotencyKey: 'live', payloadHash: 'live', state: 'fetching', createdAt: 5, updatedAt: 5 },
    ] }))
    const store = new ExternalTaskReceiptStore({ userDataPath, now: () => 24 * 60 * 60_000 + 2 })
    const inflight = await store.lookup('b', 'inflight', 'a')
    assert.equal(inflight.record.state, 'rejected')
    assert.equal(inflight.record.rejectionCode, 'sdk-submit-failed')
    assert.equal((await store.lookup('b', 'old', 'b')).kind, 'missing')
    assert.equal((await store.lookup('capacity', 'live', 'live')).record.state, 'fetching')
    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.equal(written.records.filter((record) => record.bindingId === 'capacity').length, 1_000)
    writeFileSync(filePath, '{bad')
    const corrupt = new ExternalTaskReceiptStore({ userDataPath, now: () => 99 })
    assert.equal((await corrupt.lookup('x', 'x', 'x')).kind, 'missing')
    assert.ok(readdirSync(userDataPath).includes('external-task-receipts.json.corrupt-99'))
  })
})
