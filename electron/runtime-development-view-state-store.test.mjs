import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url); const ts = require('typescript'); const root = dirname(fileURLToPath(import.meta.url))
function load(file, cache = new Map()) { const target = resolve(file); if (cache.has(target)) return cache.get(target).exports; const module = { exports: {} }; cache.set(target, module); const out = ts.transpileModule(readFileSync(target, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: target }).outputText; Function('exports', 'module', 'require', out)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(target), `${specifier}.ts`)) ? load(resolve(dirname(target), `${specifier}.ts`), cache) : require(specifier)); return module.exports }

test('Runtime view state round-trips independently and rejects cross-scope selected threads', async () => {
  const { RuntimeDevelopmentViewStateStore } = load(resolve(root, 'runtime-development-view-state-store.ts'))
  const directory = await mkdtemp(resolve(tmpdir(), 'agentos-runtime-view-'))
  const memberships = new Map([['t-a', 'workspace:a'], ['t-b', 'workspace:b']])
  const store = new RuntimeDevelopmentViewStateStore({ userDataPath: directory, now: () => 42, threadBelongsToScope: (scope, thread) => memberships.get(thread) === scope })
  const saved = await store.save('workspace:a', { patch: { selectedThreadId: 't-a', draft: 'draft-a', bounds: { x: 10, y: 20, width: 900, height: 700 } } })
  assert.equal(saved.selectedThreadId, 't-a'); assert.equal(saved.draft, 'draft-a'); assert.equal(saved.updatedAt, 42)
  assert.equal((await store.get('workspace:b')).draft, '')
  await assert.rejects(() => store.save('workspace:a', { patch: { selectedThreadId: 't-b' } }), /scope-mismatch/)
  const restarted = new RuntimeDevelopmentViewStateStore({ userDataPath: directory, threadBelongsToScope: (scope, thread) => memberships.get(thread) === scope })
  assert.deepEqual(await restarted.get('workspace:a'), saved)
})

test('Runtime view state drops stale selections and clamps off-screen bounds', async () => {
  const { RuntimeDevelopmentViewStateStore } = load(resolve(root, 'runtime-development-view-state-store.ts'))
  const directory = await mkdtemp(resolve(tmpdir(), 'agentos-runtime-view-'))
  const store = new RuntimeDevelopmentViewStateStore({ userDataPath: directory, displays: { primaryWorkArea: () => ({ x: 0, y: 0, width: 1400, height: 900 }), workAreas: () => [{ x: 0, y: 0, width: 1400, height: 900 }] }, threadBelongsToScope: () => false })
  await writeFile(store.filePath, JSON.stringify({ schemaVersion: 1, scopes: { 'project:p': { schemaVersion: 1, runtimeScopeId: 'project:p', selectedThreadId: 'foreign', draft: 'kept', bounds: { x: 9999, y: 9999, width: 20, height: 20 }, updatedAt: 9 } } }))
  const state = await store.get('project:p')
  assert.equal(state.selectedThreadId, undefined); assert.equal(state.draft, 'kept'); assert.equal(state.bounds.width, 1080); assert.equal(state.bounds.height, 760)
})

test('Runtime view state atomically replaces corrupt files with an empty collection', async () => {
  const { RuntimeDevelopmentViewStateStore } = load(resolve(root, 'runtime-development-view-state-store.ts'))
  const directory = await mkdtemp(resolve(tmpdir(), 'agentos-runtime-view-'))
  const store = new RuntimeDevelopmentViewStateStore({ userDataPath: directory, now: () => 77 })
  await writeFile(store.filePath, '{not-json')
  assert.equal((await store.get('workspace:a')).draft, '')
  await store.save('workspace:a', { patch: { draft: 'recovered' } }); await store.flush()
  assert.equal(JSON.parse(await readFile(store.filePath, 'utf8')).scopes['workspace:a'].draft, 'recovered')
})
