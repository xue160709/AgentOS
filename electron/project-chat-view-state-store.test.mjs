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

function loadStore() {
  const modulePath = resolve(testDir, './project-chat-view-state-store.ts')
  const { outputText } = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

async function withTemp(callback) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'agentos-project-chat-view-state-'))
  try { return await callback(userDataPath) } finally { await rm(userDataPath, { recursive: true, force: true }) }
}

const displays = {
  primaryWorkArea: () => ({ x: 0, y: 0, width: 1400, height: 900 }),
  workAreas: () => [{ x: 0, y: 0, width: 1400, height: 900 }, { x: 1400, y: 0, width: 1200, height: 800 }],
}

test('Project Chat view state round-trips isolated merged patches and draft boundaries', async () => {
  const { ProjectChatViewStateStore } = loadStore()
  await withTemp(async (userDataPath) => {
    let now = 10
    const store = new ProjectChatViewStateStore({ userDataPath, now: () => now++, displays })
    const first = await store.save({ projectId: 'project-1', patch: { selectedThreadId: 'thread-1', draft: 'draft', externalTaskSeenAt: 8, bounds: { x: 20, y: 30, width: 800, height: 600 } } })
    assert.equal(first.updatedAt, 10)
    const merged = await store.save({ projectId: 'project-1', patch: { draft: 'revised' } })
    assert.deepEqual(merged, { ...first, draft: 'revised', updatedAt: 11 })
    await store.save({ projectId: 'project-2', patch: { draft: 'other' } })
    assert.equal((await store.get('project-1')).draft, 'revised')
    assert.equal((await store.get('project-2')).selectedThreadId, undefined)

    const exact = 'x'.repeat(100_000)
    assert.equal((await store.save({ projectId: 'project-1', patch: { draft: exact } })).draft.length, 100_000)
    await assert.rejects(() => store.save({ projectId: 'project-1', patch: { draft: 'x'.repeat(100_001) } }), /draft-too-large/)
    assert.equal((await store.get('project-1')).draft.length, 100_000, 'oversized patch never partially writes')

    assert.ok(existsSync(store.filePath))
    assert.equal(existsSync(`${store.filePath}.tmp`), false, 'temp file was atomically renamed')
  })
})

test('Project Chat view state recovers corrupt files and normalizes bounds to visible defaults', async () => {
  const { ProjectChatViewStateStore } = loadStore()
  await withTemp(async (userDataPath) => {
    const filePath = join(userDataPath, 'project-chat-view-state.json')
    writeFileSync(filePath, '{not json')
    const store = new ProjectChatViewStateStore({ userDataPath, now: () => 77, displays })
    assert.deepEqual(await store.get('project-1'), { schemaVersion: 1, projectId: 'project-1', draft: '', externalTaskSeenAt: 0, updatedAt: 0 })
    assert.ok(readdirSync(userDataPath).includes('project-chat-view-state.json.corrupt-77'))

    const clamped = await store.save({ projectId: 'project-1', patch: { bounds: { x: 10, y: 20, width: 1, height: 2 } } })
    assert.deepEqual(clamped.bounds, { x: 10, y: 20, width: 720, height: 560 })
    const centered = await store.save({ projectId: 'project-1', patch: { bounds: { x: 9999, y: 9999, width: 800, height: 600 } } })
    assert.deepEqual(centered.bounds, { x: 188, y: 70, width: 1024, height: 760 })
    assert.deepEqual(store.resolveBounds({ width: NaN, height: 0 }), { x: 188, y: 70, width: 1024, height: 760 })
  })
})

test('Project Chat view state serializes concurrent project writes without losing either project', async () => {
  const { ProjectChatViewStateStore } = loadStore()
  await withTemp(async (userDataPath) => {
    const store = new ProjectChatViewStateStore({ userDataPath, displays })
    await Promise.all([
      store.save({ projectId: 'project-1', patch: { draft: 'first' } }),
      store.save({ projectId: 'project-2', patch: { draft: 'second' } }),
    ])
    assert.equal((await store.get('project-1')).draft, 'first')
    assert.equal((await store.get('project-2')).draft, 'second')
    assert.equal(existsSync(`${store.filePath}.tmp`), false)
  })
})

test('Project Chat view state keeps the last durable cache on write failure and permits retry', async () => {
  const { ProjectChatViewStateStore } = loadStore()
  await withTemp(async (userDataPath) => {
    let failNextWrite = false
    const store = new ProjectChatViewStateStore({
      userDataPath,
      displays,
      writeTextFile: async (filePath, contents) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new Error('disk full')
        }
        writeFileSync(filePath, contents)
      },
    })
    await store.save({ projectId: 'project-1', patch: { draft: 'durable' } })
    failNextWrite = true
    await assert.rejects(() => store.save({ projectId: 'project-1', patch: { draft: 'lost' } }), /disk full/)
    assert.equal((await store.get('project-1')).draft, 'durable')
    await store.save({ projectId: 'project-1', patch: { draft: 'retried' } })
    assert.equal((await store.get('project-1')).draft, 'retried')
  })
})
