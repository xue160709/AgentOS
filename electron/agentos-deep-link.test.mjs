import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadProtocol() {
  const file = resolve(testDir, './agentos-deep-link.ts')
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

const requestId = 'r'.repeat(16)
const bindingId = `bnd_${'b'.repeat(16)}`
const now = 1_000_000
const pair = (overrides = {}) => ({ version: 1, kind: 'pair', request_id: requestId, origin: 'https://example.com', display_name: ' Example ', issued_at: now - 1, expires_at: now + 1, nonce: 'n'.repeat(16), ...overrides })
const task = (overrides = {}) => ({ version: 1, kind: 'task', request_id: requestId, origin: 'https://example.com', binding_id: bindingId, issued_at: now - 1, expires_at: now + 1, idempotency_key: 'i'.repeat(16), title: ' Title ', task: ' Do the thing ', ...overrides })

test('deep-link parser normalizes canonical origins and rejects malformed authority/query vectors', () => {
  const protocol = loadProtocol()
  const success = protocol.parseAgentOSDeepLink(`agentos://v1/pair?origin=${encodeURIComponent('https://Example.COM:443/')}&request_id=${requestId}`)
  assert.deepEqual(success, { ok: true, value: { action: 'pair', origin: 'https://example.com', requestId } })
  assert.equal(protocol.parseAgentOSDeepLink(`agentos://v1/task?origin=${encodeURIComponent('https://example.com:8443/')}&request_id=${requestId}`).value.origin, 'https://example.com:8443')
  for (const url of [
    `agentos://v1/pair?origin=${encodeURIComponent('http://example.com/')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://user@example.com/')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/path')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/?x=1')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/#x')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/')}&origin=${encodeURIComponent('https://example.org/')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=${requestId}&extra=1`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=short`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=${requestId}#fragment`,
    `agentos://v2/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=${requestId}`,
    `agentos://v1/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=${'x'.repeat(2_100)}`,
  ]) assert.equal(protocol.parseAgentOSDeepLink(url).ok, false, url)
  assert.equal(protocol.parseAgentOSDeepLink(`agentos://v2/pair?origin=${encodeURIComponent('https://example.com/')}&request_id=${requestId}`).error.code, 'unsupported-version')
})

test('pair and task envelopes enforce identity, body, clock, strings, and forbidden-field vectors', () => {
  const protocol = loadProtocol()
  const context = { requestId, origin: 'https://example.com', now: () => now }
  assert.deepEqual(protocol.parsePairEnvelope(pair(), context), { ok: true, value: { version: 1, kind: 'pair', requestId, origin: 'https://example.com', displayName: 'Example', issuedAt: now - 1, expiresAt: now + 1, nonce: 'n'.repeat(16) } })
  assert.equal(protocol.parsePairEnvelope(pair({ origin: 'https://other.example' }), context).ok, false)
  assert.equal(protocol.parsePairEnvelope(pair({ issued_at: now - 60_000, expires_at: now - 30_001 }), context).error.code, 'ticket-expired')
  assert.equal(protocol.parsePairEnvelope(pair({ issued_at: now + 30_001, expires_at: now + 30_002 }), context).error.code, 'ticket-expired')
  assert.equal(protocol.parsePairEnvelope(pair({ expires_at: now + 300_001 }), context).ok, false)
  assert.equal(protocol.parsePairEnvelope(pair({ version: 2 }), context).error.code, 'unsupported-version')
  const parsedTask = protocol.parseTaskEnvelope(task(), { ...context, bindingId, bindingOrigin: 'https://example.com' })
  assert.equal(parsedTask.ok, true)
  assert.equal(parsedTask.value.title, 'Title')
  assert.equal(parsedTask.value.task, 'Do the thing')
  for (const forbidden of ['projectId', 'projectPath', 'threadId', 'sessionId', 'permissionMode', 'attachments', 'localFileUrl', 'receiptUrl', 'callbackUrl']) {
    assert.equal(protocol.parseTaskEnvelope(task({ [forbidden]: 'ignored' }), { ...context, bindingId, bindingOrigin: 'https://example.com' }).ok, false, forbidden)
  }
  assert.equal(protocol.parseTaskEnvelope(task({ binding_id: `${bindingId}x` }), { ...context, bindingId, bindingOrigin: 'https://example.com' }).ok, false)
  assert.equal(protocol.parseAgentOSJsonBody(JSON.stringify(pair())).ok, true)
  assert.equal(protocol.parseAgentOSJsonBody('[]').ok, false)
  assert.equal(protocol.parseAgentOSJsonBody('x'.repeat(65_537)).ok, false)
})

test('receipt builders preserve only frozen protocol fields and deep link queue is bounded/deduplicated', () => {
  const protocol = loadProtocol()
  const pairEnvelope = protocol.parsePairEnvelope(pair(), { requestId, origin: 'https://example.com', now: () => now }).value
  const credential = 'A'.repeat(43)
  assert.deepEqual(protocol.buildPairReceipt(pairEnvelope, { status: 'accepted', bindingId, credential }).value, { version: 1, kind: 'pair_receipt', request_id: requestId, nonce: 'n'.repeat(16), status: 'accepted', binding_id: bindingId, credential })
  assert.equal(protocol.buildPairReceipt(pairEnvelope, { status: 'accepted', bindingId, credential: 'too-short' }).ok, false)
  const taskEnvelope = protocol.parseTaskEnvelope(task(), { requestId, origin: 'https://example.com', bindingId, bindingOrigin: 'https://example.com', now: () => now }).value
  assert.deepEqual(protocol.buildTaskReceipt(taskEnvelope, { status: 'rejected', code: 'ticket-expired' }), { version: 1, kind: 'task_receipt', request_id: requestId, idempotency_key: 'i'.repeat(16), status: 'rejected', code: 'ticket-expired' })
  let tick = 0
  const queue = new protocol.AgentOSDeepLinkQueue({ now: () => tick, maxEntries: 2, maxAgeMs: 5 })
  const first = { action: 'pair', origin: 'https://example.com', requestId }
  assert.equal(queue.enqueue(first), true)
  assert.equal(queue.enqueue(first), false)
  assert.equal(queue.enqueue({ ...first, requestId: 's'.repeat(16) }), true)
  assert.equal(queue.enqueue({ ...first, requestId: 't'.repeat(16) }), true)
  assert.deepEqual(queue.drain().map((entry) => entry.requestId), ['s'.repeat(16), 't'.repeat(16)])
  queue.enqueue(first); tick = 6
  assert.equal(queue.size, 0)
})


test('local app origins allow only explicit loopback HTTP hosts', () => {
  const { normalizeAgentOSOrigin } = loadProtocol()
  for (const origin of ['http://localhost:3030', 'http://127.0.0.1:3030', 'http://[::1]:3030']) assert.equal(normalizeAgentOSOrigin(origin).ok, true)
  for (const origin of ['http://example.com', 'http://localhost.example.com', 'http://192.168.1.2:3030', 'http://0.0.0.0:3030', 'http://user:pass@localhost:3030', 'http://localhost:3030/task']) assert.equal(normalizeAgentOSOrigin(origin).ok, false, origin)
})
