import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadProjectContent() {
  const modulePath = resolve(testDir, '../src/project-content.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

test('Project Content interface routes list, preview, and search through one adapter', async () => {
  const { ProjectContent } = loadProjectContent()
  const calls = []
  const content = new ProjectContent({
    getAdapter: () => ({
      listProjectFiles: async (rootPath) => {
        calls.push(['list', rootPath])
        return { ok: true, rootPath, rootName: 'project', nodes: [], truncated: false }
      },
      readProjectFile: async (rootPath, filePath) => {
        calls.push(['preview', rootPath, filePath])
        return {
          ok: true,
          rootPath,
          path: filePath,
          relativePath: 'README.md',
          name: 'README.md',
          kind: 'markdown',
          mimeType: 'text/markdown',
          size: 10,
          content: '# Readme',
        }
      },
      searchProjectFiles: async (rootPath, query) => {
        calls.push(['search', rootPath, query])
        return { ok: true, rootPath, query, items: [], truncated: false }
      },
    }),
  })

  assert.equal((await content.list('/project')).ok, true)
  assert.equal((await content.preview('/project', '/project/README.md')).ok, true)
  assert.equal((await content.search('/project', 'readme')).ok, true)
  assert.deepEqual(calls, [
    ['list', '/project'],
    ['preview', '/project', '/project/README.md'],
    ['search', '/project', 'readme'],
  ])
})

test('Project Content interface returns null when the desktop adapter is unavailable', async () => {
  const { ProjectContent } = loadProjectContent()
  const content = new ProjectContent({ getAdapter: () => undefined })
  assert.equal(await content.list('/project'), null)
  assert.equal(await content.preview('/project', '/project/a.ts'), null)
  assert.equal(await content.search('/project', 'a'), null)
})

test('Project Content interface filters change events and balances watch lifecycle', async () => {
  const { ProjectContent } = loadProjectContent()
  let changeHandler
  let unsubscribed = false
  const unwatched = []
  const received = []
  const content = new ProjectContent({
    getAdapter: () => ({
      watchProjectFiles: async () => ({ ok: true, rootPath: '/resolved/project' }),
      unwatchProjectFiles: async (rootPath) => {
        unwatched.push(rootPath)
      },
      onProjectFilesChanged: (handler) => {
        changeHandler = handler
        return () => {
          unsubscribed = true
        }
      },
    }),
  })

  const dispose = content.subscribe('/project', (event) => received.push(event))
  await Promise.resolve()
  changeHandler({ rootPath: '/other' })
  changeHandler({ rootPath: '/resolved/project', relativePath: 'a.ts' })
  dispose()

  assert.deepEqual(received, [{ rootPath: '/resolved/project', relativePath: 'a.ts' }])
  assert.equal(unsubscribed, true)
  assert.deepEqual(unwatched, ['/resolved/project'])
})

test('Project Content interface releases a watcher that resolves after disposal', async () => {
  const { ProjectContent } = loadProjectContent()
  let resolveWatch
  const unwatched = []
  const content = new ProjectContent({
    getAdapter: () => ({
      watchProjectFiles: () => new Promise((resolve) => {
        resolveWatch = resolve
      }),
      unwatchProjectFiles: async (rootPath) => {
        unwatched.push(rootPath)
      },
      onProjectFilesChanged: () => () => {},
    }),
  })

  const dispose = content.subscribe('/project', () => {})
  dispose()
  resolveWatch({ ok: true, rootPath: '/resolved/project' })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(unwatched, ['/resolved/project'])
})
