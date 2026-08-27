import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', '__filename', '__dirname', outputText)(module.exports, module, localRequire, resolvedPath, dirname(resolvedPath))
  return module.exports
}

const layout = loadTsModule(resolve(testDir, './runtime-preview-layout-store.ts'))

test('runtime preview layout size normalization bounds native view dimensions', () => {
  assert.deepEqual(layout.normalizeRuntimePreviewLayoutSize({ width: 120, height: 9_000 }), { width: 480, height: 1_600 })
  assert.deepEqual(layout.normalizeRuntimePreviewLayoutSize({ width: 900, height: 100 }), { width: 900, height: 240 })
  assert.deepEqual(layout.normalizeRuntimePreviewLayoutSize({ width: 901.4, height: 959.6 }), { width: 901, height: 960 })
  assert.throws(() => layout.normalizeRuntimePreviewLayoutSize({ width: Number.NaN, height: 960 }), /size-invalid/)
})

test('runtime preview layouts persist independently per project and reset to fill width', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentos-runtime-preview-layout-'))
  let now = 100
  const first = new layout.RuntimePreviewLayoutStore({ userDataPath: root, now: () => ++now })
  assert.deepEqual(await first.get('project-a'), { projectId: 'project-a', height: 960, updatedAt: 0 })
  assert.deepEqual(await first.save('project-a', { width: 880, height: 720 }), { projectId: 'project-a', width: 880, height: 720, updatedAt: 101 })
  await first.save('project-b', { width: 1_200, height: 1_100 })

  const restored = new layout.RuntimePreviewLayoutStore({ userDataPath: root, now: () => ++now })
  assert.equal((await restored.get('project-a')).width, 880)
  assert.equal((await restored.get('project-b')).height, 1_100)
  assert.deepEqual(await restored.reset('project-a'), { projectId: 'project-a', height: 960, updatedAt: 0 })
  assert.equal((await restored.get('project-b')).width, 1_200)
  await restored.clear()
  assert.deepEqual(await restored.get('project-b'), { projectId: 'project-b', height: 960, updatedAt: 0 })
})

test('corrupt runtime preview layout storage is backed up and recovers with defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentos-runtime-preview-layout-corrupt-'))
  const filePath = join(root, 'runtime-preview-layout.json')
  await writeFile(filePath, '{broken', 'utf8')
  const store = new layout.RuntimePreviewLayoutStore({ userDataPath: root, now: () => 777 })
  assert.deepEqual(await store.get('project-a'), { projectId: 'project-a', height: 960, updatedAt: 0 })
  assert.equal(existsSync(`${filePath}.corrupt-777`), true)
})
