import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
const require = createRequire(import.meta.url), ts = require('typescript'), here = dirname(fileURLToPath(import.meta.url))
function load(file, cache = new Map()) { file = resolve(file); if (cache.has(file)) return cache.get(file).exports; const module = { exports: {} }; cache.set(file, module); const localRequire = specifier => { const path = resolve(dirname(file), `${specifier}.ts`); return specifier.startsWith('.') && existsSync(path) ? load(path, cache) : require(specifier) }; const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; Function('module', 'exports', 'require', output)(module, module.exports, localRequire); return module.exports }
function fixture() {
  let now = 100_000, name = 'Reader'; const published = [], receipts = []
  const service = new (load(resolve(here, 'agentos-pairing.ts')).AgentOSPairingService)({
    now: () => now, publish: value => published.push(value), projects: async () => [], bindings: {},
    tickets: { getPair: async ({ origin, requestId }) => ({ ok: true, value: { version: 1, kind: 'pair', request_id: requestId, origin, display_name: name, nonce: 'n'.repeat(24), issued_at: now, expires_at: now + 1000 } }), postPairReceipt: async input => { receipts.push(input.receipt); return { ok: true } } },
  })
  return { service, published, receipts, advance: ms => { now += ms }, rename: value => { name = value } }
}
const first = { action: 'pair', origin: 'http://localhost:3030', requestId: 'a'.repeat(24) }
test('reopening the same pairing restores its prompt, refreshes its envelope and never duplicates the queue', async () => {
  const f = fixture(); await f.service.enqueue(first); const id = f.published.at(-1).pairingId
  f.rename('Reader refreshed'); f.advance(100); await f.service.enqueue(first)
  assert.equal(f.published.length, 2); assert.equal(f.published.at(-1).pairingId, id); assert.equal(f.published.at(-1).displayName, 'Reader refreshed')
  await f.service.respond({ pairingId: id, action: 'reject' })
  assert.equal(f.published.at(-1), null); assert.equal(f.receipts.length, 1)
})
test('expired queue entries cannot trap later pairing requests and reopening restores the FIFO head', async () => {
  const f = fixture(); await f.service.enqueue(first)
  f.advance(32_000)
  const second = { ...first, requestId: 'b'.repeat(24) }; await f.service.enqueue(second)
  const secondId = f.published.at(-1).pairingId
  assert.notEqual(secondId, f.published[0].pairingId)
  await f.service.enqueue({ ...first, origin: 'http://127.0.0.1:3030' })
  assert.equal(f.published.at(-1).pairingId, secondId)
  await f.service.respond({ pairingId: secondId, action: 'reject' })
  assert.equal(f.published.at(-1).origin, 'http://127.0.0.1:3030')
  await f.service.cancelAll(); assert.equal(f.published.at(-1), null)
})
