import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadChatWorkspaceStore() {
  return loadTsModule(resolve(testDir, './chat-workspace-store.ts'))
}

function loadTsModule(modulePath, cache = new Map()) {
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
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

async function withTempUserData(callback) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'agentos-chat-workspace-'))
  try {
    return await callback(userDataPath)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
}

function hasSqlite() {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function createWorkspaceState({ activeThreadId = 'thread-old', threads = [createThread('thread-old', 100)] } = {}) {
  return {
    activeProjectId: 'project-1',
    activeThreadId,
    projects: [
      {
        id: 'project-1',
        name: 'Project',
        path: '/project',
        createdAt: 1,
        updatedAt: Math.max(...threads.map((thread) => thread.updatedAt)),
      },
    ],
    threads,
    sidebarPrefs: {
      collapsed: false,
      collapsedProjectIds: [],
      projectOrderIds: ['project-1'],
    },
  }
}

function createThread(id, updatedAt) {
  return {
    id,
    projectId: 'project-1',
    title: id === 'thread-new' ? 'New persisted chat' : 'Old chat',
    createdAt: updatedAt,
    updatedAt,
    chatState: {
      model: 'Claude Agent',
      items: [
        {
          type: 'message',
          id: `message-${id}`,
          role: 'user',
          content: id === 'thread-new' ? 'new content that must survive restart' : 'old content',
          status: 'done',
          createdAt: updatedAt,
          completedAt: updatedAt,
        },
      ],
    },
  }
}

test('Chat Workspace Store prefers newer JSON snapshot when SQLite index is stale', { skip: !hasSqlite() }, async () => {
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()

  await withTempUserData(async (userDataPath) => {
    const store = new ChatWorkspaceStore(userDataPath)
    await store.save(createWorkspaceState())

    const freshState = createWorkspaceState({
      activeThreadId: 'thread-new',
      threads: [createThread('thread-new', 500), createThread('thread-old', 100)],
    })
    await writeFile(
      join(userDataPath, 'chat-workspace.json'),
      `${JSON.stringify({ ...freshState, savedAt: Date.now() + 10_000 }, null, 2)}\n`,
      'utf8',
    )

    const restored = store.read()
    assert.ok(restored)
    assert.equal(restored.activeThreadId, 'thread-new')
    assert.deepEqual(restored.threads.map((thread) => thread.id), ['thread-new', 'thread-old'])
    assert.equal(restored.threads[0].chatState.items[0].content, 'new content that must survive restart')
  })
})

test('Chat Workspace Store uses workspace revision before savedAt when both snapshots have revisions', { skip: !hasSqlite() }, async () => {
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()

  await withTempUserData(async (userDataPath) => {
    const store = new ChatWorkspaceStore(userDataPath)
    await store.save({ ...createWorkspaceState(), workspaceRevision: 7 })

    const olderRevisionJson = createWorkspaceState({
      activeThreadId: 'thread-new',
      threads: [createThread('thread-new', 500), createThread('thread-old', 100)],
    })
    await writeFile(
      join(userDataPath, 'chat-workspace.json'),
      `${JSON.stringify({ ...olderRevisionJson, workspaceRevision: 6, savedAt: Date.now() + 60_000 }, null, 2)}\n`,
      'utf8',
    )

    const restored = store.read()
    assert.ok(restored)
    assert.equal(restored.workspaceRevision, 7)
    assert.equal(restored.activeThreadId, 'thread-old')
  })
})

test('Chat Workspace Store does not resurrect stale SQLite rows after an empty workspace save', { skip: !hasSqlite() }, async () => {
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()

  await withTempUserData(async (userDataPath) => {
    const store = new ChatWorkspaceStore(userDataPath)
    await store.save(createWorkspaceState())
    await store.save({
      workspaceRevision: 20,
      activeProjectId: '',
      activeThreadId: '',
      projects: [],
      threads: [],
      sidebarPrefs: {
        collapsed: false,
        collapsedProjectIds: [],
        projectOrderIds: [],
      },
    })

    const restored = store.read()
    assert.ok(restored)
    assert.equal(restored.workspaceRevision, 20)
    assert.deepEqual(restored.projects, [])
    assert.deepEqual(restored.threads, [])
  })
})

test('Chat Workspace Store history search index remains substitutable for chat search', async () => {
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()

  await withTempUserData(async (userDataPath) => {
    const store = new ChatWorkspaceStore(userDataPath)
    await store.save(createWorkspaceState({
      activeThreadId: 'thread-new',
      threads: [createThread('thread-new', 500), createThread('thread-old', 100)],
    }))

    const result = store.searchChatHistory('', 'survive restart', { limit: 8 })
    assert.equal(result.ok, true)
    assert.equal(result.items[0]?.threadId, 'thread-new')
  })
})
