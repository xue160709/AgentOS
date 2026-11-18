import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import https from 'node:https'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
function loadTsModule(file, cache = new Map()) { const resolved = resolve(file), cached = cache.get(resolved); if (cached) return cached.exports; const output = ts.transpileModule(readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: resolved }).outputText; const module = { exports: {} }; cache.set(resolved, module); const localRequire = (specifier) => { const candidate = resolve(dirname(resolved), `${specifier}.ts`); return specifier.startsWith('.') && existsSync(candidate) ? loadTsModule(candidate, cache) : require(specifier) }; Function('exports', 'module', 'require', output)(module.exports, module, localRequire); return module.exports }
function load() { return loadTsModule(resolve(testDir, 'agentos-ticket-client.ts')) }

async function withFixture(run) {
  const fixtureDir = mkdtempSync(resolve(tmpdir(), 'agentos-ticket-fixture-'))
  const keyPath = resolve(fixtureDir, 'key.pem'), certPath = resolve(fixtureDir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' })
  const requests = []; let mode = '200'; const server = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    requests.push({ url: req.url, cookie: req.headers.cookie })
    if (mode === 'headers-late') return setTimeout(() => res.end('{}'), 300)
    if (mode === 'body-late') { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); return setTimeout(() => res.end('{}'), 550) }
    if (mode === 'redirect') return res.writeHead(302, { location: 'https://outside.invalid/' }).end()
    if (mode === 'oversize') return res.writeHead(200, { 'content-type': 'application/json' }).end('x'.repeat(65_537))
    const status = Number(mode) || 200; res.writeHead(status, { 'content-type': mode === 'plain' ? 'text/plain' : 'application/json' }); res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; let aborts = 0
  const { createDeadlineBoundAgentOSTicketTransport } = load()
  const transport = createDeadlineBoundAgentOSTicketTransport((input) => { const request = https.request(input.url, { method: input.method, headers: input.headers, rejectUnauthorized: false }); const abort = request.abort.bind(request); request.abort = () => { aborts++; return abort() }; return request }, { timeoutScale: 0.05 })
  try { await run({ origin: `https://127.0.0.1:${port}`, transport, requests, setMode: (next) => { mode = next }, aborts: () => aborts }) } finally { await new Promise((resolve) => server.close(resolve)); await rm(fixtureDir, { recursive: true, force: true }) }
}

const requestId = 'r'.repeat(16)
const bindingId = `bnd_${'b'.repeat(16)}`
const credential = 'c'.repeat(43)
test('ticket client uses a fixed endpoint and fail-closed transport policy', async () => {
  const { AgentOSTicketClient } = load(); const calls = []
  const client = new AgentOSTicketClient(async (input) => { calls.push(input); return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{}' } })
  const result = await client.getTask({ origin: 'https://Example.COM:443/', requestId, bindingId, credential })
  assert.equal(result.ok, true)
  assert.deepEqual(calls[0], {
    method: 'GET', url: `https://example.com/.well-known/agentos/v1/task/${requestId}`,
    headers: { Accept: 'application/json', Authorization: `Bearer ${credential}`, 'AgentOS-Binding-Id': bindingId, 'AgentOS-Protocol-Version': '1', 'Cache-Control': 'no-store' },
    connectTimeoutMs: 5000, totalTimeoutMs: 10000, maxBodyBytes: 65536, redirect: 'error', credentials: 'omit', body: undefined,
  })
})

test('ticket client rejects redirect, auth failure, non-json, oversized and transport failures', async () => {
  const { AgentOSTicketClient } = load()
  const input = { origin: 'https://example.com', requestId, bindingId, credential }
  for (const response of [
    { status: 302, headers: { 'content-type': 'application/json' }, body: '{}' },
    { status: 401, headers: { 'content-type': 'application/json' }, body: '{}' },
    { status: 200, headers: { 'content-type': 'text/plain' }, body: '{}' },
    { status: 200, headers: { 'content-type': 'application/json' }, body: 'x'.repeat(65537) },
  ]) assert.equal((await new AgentOSTicketClient(async () => response).getTask(input)).ok, false)
  const failed = await new AgentOSTicketClient(async () => { throw new Error('network') }).getTask(input)
  assert.equal(failed.error.code, 'ticket-fetch-failed')
})

test('controlled loopback HTTPS fixture enforces independent first-response and total-body deadlines', async () => {
  await withFixture(async ({ origin, transport, requests, setMode, aborts }) => {
    const { AgentOSTicketClient } = load(); const client = new AgentOSTicketClient(transport)
    const input = { origin, requestId, bindingId, credential }
    assert.equal((await client.getTask(input)).ok, true)
    assert.deepEqual(requests[0], { url: `/.well-known/agentos/v1/task/${requestId}`, cookie: undefined })
    setMode('headers-late'); const beforeHeaders = aborts(); assert.equal((await client.getTask(input)).error.code, 'ticket-fetch-failed'); assert.ok(aborts() > beforeHeaders, 'first-response deadline aborts the request')
    setMode('body-late'); const beforeBody = aborts(); assert.equal((await client.getTask(input)).error.code, 'ticket-fetch-failed'); assert.ok(aborts() > beforeBody, 'total-body deadline remains active after response headers')
  })
})

test('controlled loopback HTTPS fixture rejects status, redirect, content-type and oversized bodies without changing endpoint', async () => {
  await withFixture(async ({ origin, transport, requests, setMode }) => {
    const { AgentOSTicketClient } = load(); const client = new AgentOSTicketClient(transport); const input = { origin, requestId, bindingId, credential }
    for (const mode of ['redirect', '401', '404', '410', '429', '500', 'plain', 'oversize']) { setMode(mode); assert.equal((await client.getTask(input)).ok, false, mode) }
    assert.ok(requests.every((request) => request.url === `/.well-known/agentos/v1/task/${requestId}` && request.cookie === undefined))
  })
})
