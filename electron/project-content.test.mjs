import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadProjectContent() {
  return loadTsModule(resolve(testDir, '../src/project-content.ts'))
}

function loadDesktopProjectContent(overrides = {}) {
  return loadTsModule(resolve(testDir, './project-content.ts'), new Map(), overrides)
}

function loadTsModule(modulePath, cache = new Map(), overrides = {}) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports

  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(overrides, specifier)) return overrides[specifier]
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache, overrides)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

async function withTempProject(callback) {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentos-project-content-'))
  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

function waitForProjectEvent(events, timeoutMs = 2500) {
  return new Promise((resolveWait, rejectWait) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (events.length > 0) {
        clearInterval(timer)
        resolveWait(events[0])
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        rejectWait(new Error('Timed out waiting for project file event'))
      }
    }, 25)
  })
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
  assert.deepEqual(await content.search('/project', 'a'), {
    ok: false,
    rootPath: '/project',
    message: '当前运行环境无法搜索项目文件',
  })
})

test('Project Content search normalizes adapter failures', async () => {
  const { ProjectContent } = loadProjectContent()
  const content = new ProjectContent({
    getAdapter: () => ({
      searchProjectFiles: async () => {
        throw new Error('search backend failed')
      },
    }),
  })

  assert.deepEqual(await content.search('/project', 'readme'), {
    ok: false,
    rootPath: '/project',
    message: 'search backend failed',
  })
})

test('Project Content search session only delivers the latest result', async () => {
  const { ProjectContent } = loadProjectContent()
  const pending = []
  const content = new ProjectContent({
    getAdapter: () => ({
      searchProjectFiles: (rootPath, query) => new Promise((resolveSearch) => {
        pending.push({ rootPath, query, resolveSearch })
      }),
    }),
  })
  const session = content.createSearchSession()
  const results = []
  const settled = []

  session.search({
    rootPath: '/project',
    query: 'old',
    onResult: (result) => results.push(result),
    onSettled: () => settled.push('old'),
  })
  session.search({
    rootPath: '/project',
    query: 'new',
    onResult: (result) => results.push(result),
    onSettled: () => settled.push('new'),
  })

  pending[1].resolveSearch({ ok: true, rootPath: '/project', items: [{ label: 'new.ts', path: '/project/new.ts', relativePath: 'new.ts', type: 'file' }] })
  await Promise.resolve()
  pending[0].resolveSearch({ ok: true, rootPath: '/project', items: [{ label: 'old.ts', path: '/project/old.ts', relativePath: 'old.ts', type: 'file' }] })
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(results.map((result) => (result.ok ? result.items[0].relativePath : result.message)), ['new.ts'])
  assert.deepEqual(settled, ['new'])
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

test('Project Content desktop implementation owns tree, preview, search, and path rules', async () => {
  const content = loadDesktopProjectContent()

  await withTempProject(async (rootPath) => {
    await mkdir(join(rootPath, 'src'), { recursive: true })
    await mkdir(join(rootPath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(rootPath, 'src', 'README.md'), '# Readme\n')
    await writeFile(join(rootPath, 'src', 'app.ts'), 'export const ok = true\n')
    await writeFile(join(rootPath, 'node_modules', 'ignored.ts'), 'ignored\n')

    const tree = await content.readProjectFileTree(rootPath)
    assert.equal(tree.ok, true)
    assert.deepEqual(tree.nodes.map((node) => node.name), ['src'])
    assert.deepEqual(tree.nodes[0].children.map((node) => node.relativePath), ['src/app.ts', 'src/README.md'])

    const preview = await content.readProjectFilePreview(rootPath, 'src/README.md')
    assert.equal(preview.ok, true)
    assert.equal(preview.kind, 'markdown')
    assert.equal(preview.content, '# Readme\n')

    const escapedPreview = await content.readProjectFilePreview(rootPath, '../outside.txt')
    assert.equal(escapedPreview.ok, false)
    assert.equal(escapedPreview.message, '只能预览当前项目内的文件')

    const search = await content.searchProjectFiles(rootPath, 'read')
    assert.equal(search.ok, true)
    assert.deepEqual(search.items.map((item) => item.relativePath), ['src/README.md'])

    assert.equal(await content.pathExistsUnderProject(rootPath, 'src/app.ts'), true)
    assert.equal(await content.pathExistsUnderProject(rootPath, '../outside.txt'), false)
  })
})

test('Project Content desktop implementation emits watched file changes', async () => {
  let watchCallback
  let closeCount = 0
  const content = loadDesktopProjectContent({
    'node:fs': {
      watch: (_rootPath, optionsOrCallback, maybeCallback) => {
        watchCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
        return {
          close: () => {
            closeCount += 1
          },
        }
      },
    },
  })

  await withTempProject(async (rootPath) => {
    const events = []
    content.configureProjectContentEvents((event) => events.push(event))
    const watched = await content.watchProjectFiles(rootPath)
    assert.equal(watched.ok, true)

    watchCallback('change', 'changed.txt')
    const event = await waitForProjectEvent(events)

    assert.equal(event.rootPath, rootPath)
    assert.equal(event.relativePath, 'changed.txt')

    await content.unwatchProjectFiles(rootPath)
    content.disposeProjectFileWatchers()
    assert.equal(closeCount, 1)
  })
})
