import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports

  const { outputText } = ts.transpileModule(readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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

const loadStore = () => loadTsModule(resolve(testDir, '../src/components/chat/thread-chat-state-store.ts'))
const loadSession = () => loadTsModule(resolve(testDir, '../src/components/workspace-session.ts'))

function durableWorkspace() {
  return {
    workspaceRevision: 4,
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [{ id: 'project-1', name: 'Project', path: '/p', createdAt: 1, updatedAt: 2 }],
    threads: [
      {
        id: 'thread-1',
        projectId: 'project-1',
        title: 'Thread',
        createdAt: 1,
        updatedAt: 2,
        creationSource: { kind: 'user' },
        chatState: { model: 'Claude Agent', items: [{ type: 'message', id: 'user-1', role: 'user', content: 'hi', createdAt: 1 }] },
      },
    ],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1'] },
    runtimeDefinitions: [],
    workspaceTabs: [],
    activeWorkspaceTabId: '',
    projectHomeViewModes: {},
    localAppDefinitions: [],
    localAppTabs: [],
    activeLocalAppTabId: '',
  }
}

function brokerSnapshot({ sequence, updatedAt, title = 'Thread', text = 'a' }) {
  return {
    projectId: 'project-1',
    project: { id: 'project-1', name: 'Project', pathMissing: false },
    workspaceRevision: 10 + sequence,
    sequence,
    routeGeneration: 1,
    threads: [
      {
        id: 'thread-1',
        projectId: 'project-1',
        title,
        createdAt: 1,
        updatedAt,
        chatState: { model: 'Claude Agent', items: [{ type: 'message', id: 'assistant-1', role: 'assistant', content: text, createdAt: 1 }] },
      },
    ],
    runs: [],
    pendingPrompts: [],
    permissionMode: 'auto',
    unreadExternalTaskCount: 0,
  }
}

test('workspace adoption strips chat content into the store and hydration restores the durable shape', () => {
  const { ThreadChatStateStore, adoptWorkspaceChatStates, hydrateWorkspaceChatStates } = loadStore()
  const store = new ThreadChatStateStore()
  const durable = durableWorkspace()

  const metadata = adoptWorkspaceChatStates(durable, store)
  assert.equal('chatState' in metadata.threads[0], false)
  assert.equal(store.read('thread-1').items[0].content, 'hi')

  // 磁盘格式不变：往回装配后与原始快照逐字段一致。
  assert.deepEqual(hydrateWorkspaceChatStates(metadata, store), durable)
})

test('hydration falls back to an empty chat state for threads the store never saw', () => {
  const { ThreadChatStateStore, hydrateWorkspaceChatStates } = loadStore()
  const store = new ThreadChatStateStore()
  const metadata = { ...durableWorkspace(), threads: [{ id: 'ghost', projectId: 'project-1', title: 'Ghost', createdAt: 1, updatedAt: 1, creationSource: { kind: 'user' } }] }
  assert.deepEqual(hydrateWorkspaceChatStates(metadata, store).threads[0].chatState.items, [])
})

test('only subscribers of a changed thread are woken, and a scope replace reclaims dropped threads', () => {
  const { ThreadChatStateStore } = loadStore()
  const store = new ThreadChatStateStore()
  let first = 0
  let second = 0
  let global = 0
  store.subscribeThread('thread-1', () => { first += 1 })
  store.subscribeThread('thread-2', () => { second += 1 })
  store.subscribe(() => { global += 1 })

  store.set('thread-1', { model: 'Claude Agent', items: [] }, 'project-1')
  assert.deepEqual([first, second, global], [1, 0, 1])

  // 同一引用再写一次不算变化。
  const same = store.read('thread-1')
  store.set('thread-1', same, 'project-1')
  assert.deepEqual([first, second, global], [1, 0, 1])

  store.replaceScope('project-1', [{ threadId: 'thread-2', chatState: { model: 'Claude Agent', items: [] } }])
  assert.equal(store.has('thread-1'), false, 'a thread missing from the scope replace must be reclaimed')
  assert.deepEqual([first, second], [2, 1])
})

test('a broker projection writes chat content to the store and keeps it out of the shell metadata', () => {
  const { ThreadChatStateStore } = loadStore()
  const { applyProjectChatSnapshot } = loadSession()
  const store = new ThreadChatStateStore()
  const state = { ...durableWorkspace(), threads: [] }

  const next = applyProjectChatSnapshot(state, brokerSnapshot({ sequence: 1, updatedAt: 100 }), { store })
  assert.equal('chatState' in next.threads[0], false)
  assert.equal(store.read('thread-1').items[0].content, 'a')

  // 不传 store 时保持旧行为，供仍持有完整工作区的调用方使用。
  const legacy = applyProjectChatSnapshot(state, brokerSnapshot({ sequence: 2, updatedAt: 100 }))
  assert.equal(legacy.threads[0].chatState.items[0].content, 'a')
})

test('running deltas that only move timestamps keep the shell state object identical', () => {
  const { ThreadChatStateStore } = loadStore()
  const { applyProjectChatSnapshot } = loadSession()
  const store = new ThreadChatStateStore()
  const base = applyProjectChatSnapshot({ ...durableWorkspace(), threads: [] }, brokerSnapshot({ sequence: 1, updatedAt: 100 }), { store })

  const deferred = applyProjectChatSnapshot(base, brokerSnapshot({ sequence: 2, updatedAt: 200, text: 'ab' }), {
    store,
    deferTimestampOnlyUpdates: true,
  })
  assert.equal(deferred, base, 'a timestamp-only delta must not produce a new shell state')
  assert.equal(store.read('thread-1').items[0].content, 'ab', 'the transcript still advances')

  // 真正的元数据变化仍然照常提交。
  const renamed = applyProjectChatSnapshot(base, brokerSnapshot({ sequence: 3, updatedAt: 300, title: 'Renamed' }), {
    store,
    deferTimestampOnlyUpdates: true,
  })
  assert.notEqual(renamed, base)
  assert.equal(renamed.threads[0].title, 'Renamed')

  // 终止快照没有活跃 run，因此精确时间戳照常落地。
  const terminal = applyProjectChatSnapshot(base, brokerSnapshot({ sequence: 4, updatedAt: 400 }), { store })
  assert.equal(terminal.threads[0].updatedAt, 400)
})
