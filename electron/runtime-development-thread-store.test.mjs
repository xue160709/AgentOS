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

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
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

function loadRuntimeStore() {
  return loadTsModule(resolve(testDir, './runtime-development-thread-store.ts'))
}

function loadChatWorkspaceStore() {
  return loadTsModule(resolve(testDir, './chat-workspace-store.ts'))
}

async function withTempUserData(callback) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'agentos-runtime-threads-'))
  try { return await callback(userDataPath) } finally { await rm(userDataPath, { recursive: true, force: true }) }
}

function hasSqlite() {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function createRuntimeThread(overrides = {}) {
  return {
    id: 'runtime-thread-1',
    purpose: 'runtime-development',
    runtimeScopeId: 'project:project-1',
    runtimeOwner: { kind: 'project', projectId: 'project-1' },
    title: 'Improve runtime navigation',
    createdAt: 100,
    updatedAt: 120,
    creationSource: { kind: 'user' },
    chatState: {
      model: 'Claude Agent',
      cwd: '/project',
      items: [{
        type: 'message', id: 'message-1', role: 'user', content: 'Make the runtime navigation clearer',
        status: 'done', createdAt: 110, completedAt: 110,
      }],
    },
    ...overrides,
  }
}

function createWorkspaceState() {
  return {
    workspaceRevision: 1,
    activeProjectId: 'project-1',
    activeThreadId: 'project-thread-1',
    projects: [{ id: 'project-1', name: 'Project', path: '/project', createdAt: 1, updatedAt: 1 }],
    threads: [{
      id: 'project-thread-1', projectId: 'project-1', title: 'Ordinary app command',
      createdAt: 1, updatedAt: 1, creationSource: { kind: 'app-command' },
      chatState: { model: 'Claude Agent', items: [] },
    }],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1'] },
    runtimeDefinitions: [],
    workspaceTabs: [],
    activeWorkspaceTabId: '',
    projectHomeViewModes: {},
    workspaceSchemaVersion: 3,
    snapshotComplete: true,
  }
}

test('Runtime scope codec keeps Project and Workspace identity independent from paths', () => {
  const contract = loadTsModule(resolve(testDir, '../src/runtime-development-contract.ts'))
  assert.equal(contract.projectRuntimeScopeId(' project-1 '), 'project:project-1')
  assert.equal(contract.workspaceRuntimeScopeId('runtime-1'), 'workspace:runtime-1')
  assert.deepEqual(contract.parseRuntimeScopeId('project:project-1'), {
    kind: 'project', projectId: 'project-1', runtimeScopeId: 'project:project-1',
  })
  assert.deepEqual(contract.parseRuntimeScopeId('workspace:runtime-1'), {
    kind: 'workspace', runtimeDefinitionId: 'runtime-1', runtimeScopeId: 'workspace:runtime-1',
  })
  assert.equal(contract.parseRuntimeScopeId('workspace:'), null)
  assert.equal(contract.parseRuntimeScopeId('project:a:b'), null)
  assert.throws(() => contract.projectRuntimeScopeId('a:b'), /invalid-project-runtime-scope/)
  assert.equal(contract.runtimeOwnerMatchesScope('project:project-1', { kind: 'workspace' }), false)
  assert.equal(contract.runtimeOwnerMatchesScope('workspace:runtime-1', { kind: 'workspace' }), false)
  assert.equal(contract.runtimeOwnerMatchesScope('workspace:runtime-1', { kind: 'workspace' }, 'runtime-2'), false)
})

test('Runtime thread sidecar round-trips Project, uninitialized Project, and Workspace scopes', async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const store = new RuntimeDevelopmentThreadStore(userDataPath)
    store.sqliteAvailable = false
    const saved = await store.save({ runtimeDevelopmentThreads: [
      createRuntimeThread(),
      createRuntimeThread({
        id: 'runtime-thread-2', runtimeScopeId: 'project:project-2',
        runtimeOwner: { kind: 'project', projectId: 'project-2' }, title: 'Create runtime',
        creationSource: { kind: 'app-command' }, createdAt: 130, updatedAt: 130,
      }),
      createRuntimeThread({
        id: 'runtime-thread-3', runtimeScopeId: 'workspace:runtime-3', runtimeDefinitionId: 'runtime-3',
        runtimeOwner: { kind: 'workspace' }, title: 'Workspace runtime', createdAt: 140, updatedAt: 140,
      }),
    ] }, 0)
    assert.equal(saved.runtimeThreadRevision, 1)
    assert.equal(saved.runtimeDevelopmentThreads.length, 3)

    const restoredStore = new RuntimeDevelopmentThreadStore(userDataPath)
    restoredStore.sqliteAvailable = false
    const restored = restoredStore.read()
    assert.equal(restored.runtimeThreadRevision, 1)
    assert.deepEqual(restored.runtimeDevelopmentThreads.map((thread) => thread.id), ['runtime-thread-3', 'runtime-thread-2', 'runtime-thread-1'])
    assert.equal(restored.runtimeDevelopmentThreads[2].runtimeDefinitionId, undefined)
    assert.equal(restored.runtimeDevelopmentThreads[2].chatState.items[0].content, 'Make the runtime navigation clearer')
    assert.equal(existsSync(join(userDataPath, 'runtime-development-workspace.json')), true)
    assert.equal(existsSync(join(userDataPath, 'chat-workspace.json')), false)

    const next = await restoredStore.save({
      runtimeDevelopmentThreads: restored.runtimeDevelopmentThreads.map((thread) => ({
        ...thread,
        updatedAt: thread.updatedAt + 1,
      })),
    }, 1)
    assert.equal(next.runtimeThreadRevision, 2)
    const finalStore = new RuntimeDevelopmentThreadStore(userDataPath)
    finalStore.sqliteAvailable = false
    assert.equal(finalStore.read().runtimeThreadRevision, 2)
  })
})

test('Runtime thread writes reject owner mismatch, website source, duplicate ids, and stale revisions', async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const store = new RuntimeDevelopmentThreadStore(userDataPath)
    store.sqliteAvailable = false
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread({ runtimeOwner: { kind: 'workspace' } })] }, 0), /runtime-thread-invalid/)
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread({ runtimeScopeId: 'invalid-scope' })] }, 0), /runtime-thread-invalid/)
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread({
      runtimeScopeId: 'workspace:runtime-1', runtimeOwner: { kind: 'workspace' }, runtimeDefinitionId: undefined,
    })] }, 0), /runtime-thread-invalid/)
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread({ creationSource: { kind: 'website', bindingId: 'b', receivedAt: 1 } })] }, 0), /runtime-thread-invalid/)
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread(), createRuntimeThread()] }, 0), /runtime-thread-duplicate-id/)
    await store.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)
    await assert.rejects(() => store.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0), /runtime-thread-stale-revision/)
  })
})

test('Runtime thread search returns explicit Runtime scope metadata and filters ordinary lists structurally', async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const runtimeStore = new RuntimeDevelopmentThreadStore(userDataPath)
    runtimeStore.sqliteAvailable = false
    await runtimeStore.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)
    const result = runtimeStore.search('navigation', {}, () => 'Project One Runtime')
    assert.equal(result.ok, true)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].name, 'Project One Runtime')
    assert.deepEqual(result.items[0].metadata, {
      scopeKind: 'runtime-development', runtimeScopeId: 'project:project-1', ownerKind: 'project',
      name: 'Project One Runtime', runtimeDefinitionId: undefined, projectId: 'project-1',
      purpose: 'runtime-development',
    })

    const chatStore = new (loadChatWorkspaceStore().ChatWorkspaceStore)(userDataPath)
    await chatStore.save(createWorkspaceState())
    assert.deepEqual(chatStore.read().threads.map((thread) => thread.id), ['project-thread-1'])
    assert.equal(chatStore.searchChatHistory('', 'navigation').items.length, 0)
  })
})

test('ordinary workspace saves do not delete Runtime SQLite rows, sidecar, or reclassify app-command threads', { skip: !hasSqlite() }, async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()
  await withTempUserData(async (userDataPath) => {
    const runtimeStore = new RuntimeDevelopmentThreadStore(userDataPath)
    await runtimeStore.save({ runtimeDevelopmentThreads: [
      createRuntimeThread(),
      createRuntimeThread({
        id: 'workspace-runtime-thread',
        runtimeScopeId: 'workspace:runtime-definition-1',
        runtimeDefinitionId: 'runtime-definition-1',
        runtimeOwner: { kind: 'workspace' },
      }),
    ] }, 0)
    const chatStore = new ChatWorkspaceStore(userDataPath)
    const workspaceDefinition = {
      id: 'runtime-definition-1', owner: { kind: 'workspace' }, name: 'Workspace Runtime', rootPath: '/runtime',
      packageManager: 'npm', devCommand: { executable: 'npm', args: ['run', 'dev'] }, trustStatus: 'trusted',
      autoStart: false, createdAt: 1, updatedAt: 1,
    }
    await chatStore.save({ ...createWorkspaceState(), runtimeDefinitions: [workspaceDefinition] })
    await chatStore.save(createWorkspaceState())

    const dbPath = join(userDataPath, 'chat-workspace.sqlite')
    const runtimeCount = Number(execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM runtime_development_threads;'], { encoding: 'utf8' }).trim())
    const projectThreadCount = Number(execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM threads;'], { encoding: 'utf8' }).trim())
    const projectIdNotNull = execFileSync('sqlite3', ['-json', dbPath, "SELECT [notnull] AS required FROM pragma_table_info('threads') WHERE name = 'project_id';"], { encoding: 'utf8' })
    const runtimeForeignKeys = execFileSync('sqlite3', ['-json', dbPath, "PRAGMA foreign_key_list('runtime_development_threads');"], { encoding: 'utf8' }).trim()
    const runtimeIndex = execFileSync('sqlite3', [dbPath, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_threads_scope_updated';"], { encoding: 'utf8' }).trim()
    assert.equal(runtimeCount, 2)
    assert.equal(projectThreadCount, 1)
    assert.equal(JSON.parse(projectIdNotNull)[0].required, 1)
    assert.equal(runtimeForeignKeys, '')
    assert.equal(runtimeIndex, 'idx_runtime_threads_scope_updated')
    assert.equal(existsSync(join(userDataPath, 'runtime-development-workspace.json')), true)

    await rm(join(userDataPath, 'runtime-development-workspace.json'))
    const restoredRuntime = new RuntimeDevelopmentThreadStore(userDataPath).read()
    assert.deepEqual(
      restoredRuntime.runtimeDevelopmentThreads.map((thread) => thread.id).sort(),
      ['runtime-thread-1', 'workspace-runtime-thread'],
    )
    assert.equal(chatStore.read().threads[0].creationSource.kind, 'app-command')
  })
})

test('newer sidecar revision wins and a later ordinary save leaves it readable', { skip: !hasSqlite() }, async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  const { ChatWorkspaceStore } = loadChatWorkspaceStore()
  await withTempUserData(async (userDataPath) => {
    const runtimeStore = new RuntimeDevelopmentThreadStore(userDataPath)
    await runtimeStore.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)
    await writeFile(join(userDataPath, 'runtime-development-workspace.json'), `${JSON.stringify({
      schemaVersion: 1,
      runtimeThreadRevision: 2,
      savedAt: Date.now() + 1000,
      runtimeDevelopmentThreads: [createRuntimeThread({ title: 'New sidecar title', updatedAt: 999 })],
    }, null, 2)}\n`, 'utf8')
    await new ChatWorkspaceStore(userDataPath).save(createWorkspaceState())
    const restored = new RuntimeDevelopmentThreadStore(userDataPath).read()
    assert.equal(restored.runtimeThreadRevision, 2)
    assert.equal(restored.runtimeDevelopmentThreads[0].title, 'New sidecar title')
  })
})

test('Runtime thread save succeeds with either medium and rejects when both media fail', async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const sidecarOnly = new RuntimeDevelopmentThreadStore(userDataPath)
    sidecarOnly.saveDatabaseSnapshot = () => false
    assert.equal((await sidecarOnly.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)).runtimeThreadRevision, 1)

    const failing = new RuntimeDevelopmentThreadStore(userDataPath)
    failing.saveDatabaseSnapshot = () => false
    failing.saveSidecarSnapshot = async () => false
    await assert.rejects(() => failing.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 1), /runtime-thread-save-failed/)
  })
})

test('failed Runtime revision cannot overwrite the rollout referenced by the last committed SQLite revision', { skip: !hasSqlite() }, async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const store = new RuntimeDevelopmentThreadStore(userDataPath)
    await store.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)

    store.saveDatabaseSnapshot = () => false
    store.saveSidecarSnapshot = async () => false
    const changed = createRuntimeThread({
      updatedAt: 500,
      chatState: {
        model: 'Claude Agent', cwd: '/project',
        items: [{
          type: 'message', id: 'message-2', role: 'user', content: 'uncommitted replacement',
          status: 'done', createdAt: 500, completedAt: 500,
        }],
      },
    })
    await assert.rejects(
      () => store.save({ runtimeDevelopmentThreads: [changed] }, 1),
      /runtime-thread-save-failed/,
    )

    await rm(join(userDataPath, 'runtime-development-workspace.json'))
    const restored = new RuntimeDevelopmentThreadStore(userDataPath).read()
    assert.equal(restored.runtimeThreadRevision, 1)
    assert.equal(
      restored.runtimeDevelopmentThreads[0].chatState.items[0].content,
      'Make the runtime navigation clearer',
    )
  })
})

test('successful Runtime revision switches SQLite atomically and removes the superseded rollout', { skip: !hasSqlite() }, async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const store = new RuntimeDevelopmentThreadStore(userDataPath)
    await store.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)
    const dbPath = join(userDataPath, 'chat-workspace.sqlite')
    const oldRolloutPath = execFileSync('sqlite3', [dbPath, "SELECT rollout_path FROM runtime_development_threads WHERE id = 'runtime-thread-1';"], { encoding: 'utf8' }).trim()

    const next = await store.save({ runtimeDevelopmentThreads: [createRuntimeThread({ updatedAt: 500 })] }, 1)
    const newRolloutPath = execFileSync('sqlite3', [dbPath, "SELECT rollout_path FROM runtime_development_threads WHERE id = 'runtime-thread-1';"], { encoding: 'utf8' }).trim()
    assert.equal(next.runtimeThreadRevision, 2)
    assert.notEqual(newRolloutPath, oldRolloutPath)
    assert.equal(existsSync(oldRolloutPath), false)
    assert.equal(existsSync(newRolloutPath), true)
  })
})

test('Runtime SQLite rows with an unknown owner kind are rejected during recovery', { skip: !hasSqlite() }, async () => {
  const { RuntimeDevelopmentThreadStore } = loadRuntimeStore()
  await withTempUserData(async (userDataPath) => {
    const store = new RuntimeDevelopmentThreadStore(userDataPath)
    await store.save({ runtimeDevelopmentThreads: [createRuntimeThread()] }, 0)
    execFileSync('sqlite3', [join(userDataPath, 'chat-workspace.sqlite'), "UPDATE runtime_development_threads SET owner_kind = 'unknown';"])

    const fallback = new RuntimeDevelopmentThreadStore(userDataPath).read()
    assert.equal(fallback.runtimeThreadRevision, 1)
    assert.equal(fallback.runtimeDevelopmentThreads[0].id, 'runtime-thread-1')

    await rm(join(userDataPath, 'runtime-development-workspace.json'))
    const rejected = new RuntimeDevelopmentThreadStore(userDataPath).read()
    assert.equal(rejected.runtimeThreadRevision, 0)
    assert.deepEqual(rejected.runtimeDevelopmentThreads, [])
  })
})
