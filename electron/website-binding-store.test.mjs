import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
function loadTs(file) {
  const source = readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file })
  const module = { exports: {} }
  const localRequire = (specifier) => specifier.startsWith('.') ? loadTs(resolve(dirname(file), `${specifier}.ts`)) : require(specifier)
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}
async function withTemp(callback) { const dir = await mkdtemp(join(tmpdir(), 'agentos-binding-store-')); try { return await callback(dir) } finally { await rm(dir, { recursive: true, force: true }) } }
const bindingId = `bnd_${'b'.repeat(16)}`
const credential = 'A'.repeat(43)
function fakeSafeStorage(available = true) { return { isEncryptionAvailable: () => available, encryptString: (value) => Buffer.from(`cipher:${value}`), decryptString: (value) => value.toString().replace(/^cipher:/, '') } }

test('binding store encrypts credential, projects no ciphertext, preserves unique active origin and tombstones revocation', async () => {
  const { WebsiteBindingStore } = loadTs(resolve(testDir, './website-binding-store.ts'))
  await withTemp(async (userDataPath) => {
    const store = new WebsiteBindingStore({ userDataPath, safeStorage: fakeSafeStorage(), now: () => 10 })
    const created = await store.create({ bindingId, origin: 'https://Example.COM:443/', displayName: ' Site ', projectId: 'project-1', credential })
    assert.deepEqual(created, { ok: true, value: { schemaVersion: 1, bindingId, origin: 'https://example.com', displayName: 'Site', projectId: 'project-1', status: 'active', createdAt: 10 } })
    const stored = readFileSync(store.filePath, 'utf8')
    assert.match(stored, /"credentialCiphertext": "[A-Za-z0-9+/=]+"/)
    assert.doesNotMatch(stored, new RegExp(credential))
    assert.doesNotMatch(JSON.stringify(await store.list()), /credentialCiphertext|cipher:|AAAA/)
    assert.equal((await store.credentialFor(bindingId)).value, credential)
    assert.equal((await store.create({ bindingId: `bnd_${'c'.repeat(16)}`, origin: 'https://example.com/', displayName: 'Other', projectId: 'project-2', credential })).error.code, 'binding-conflict')
    assert.equal((await store.revoke(bindingId)).ok, true)
    assert.equal((await store.credentialFor(bindingId)).error.code, 'binding-revoked')
    assert.equal((await store.findActiveByOrigin('https://example.com/')), undefined)
    assert.match(readFileSync(store.filePath, 'utf8'), /"status": "revoked"/)
  })
})

test('binding store never falls back to plaintext and recovers corrupt data atomically', async () => {
  const { WebsiteBindingStore } = loadTs(resolve(testDir, './website-binding-store.ts'))
  await withTemp(async (userDataPath) => {
    const unavailable = new WebsiteBindingStore({ userDataPath, safeStorage: fakeSafeStorage(false) })
    const rejected = await unavailable.create({ bindingId, origin: 'https://example.com/', displayName: 'Site', projectId: 'project-1', credential })
    assert.equal(rejected.error.code, 'credential-storage-unavailable')
    assert.equal(existsSync(unavailable.filePath), false)
    writeFileSync(unavailable.filePath, '{bad json')
    const recovered = new WebsiteBindingStore({ userDataPath, safeStorage: fakeSafeStorage(), now: () => 88 })
    assert.deepEqual(await recovered.list(), [])
    assert.ok(readdirSync(userDataPath).includes('website-bindings.json.corrupt-88'))
    await recovered.create({ bindingId, origin: 'https://example.com/', displayName: 'Site', projectId: 'project-1', credential })
    assert.equal(existsSync(`${recovered.filePath}.tmp`), false)
  })
})
