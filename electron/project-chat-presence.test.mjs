import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function load(modulePath, cache = new Map()) {
  const file = resolve(modulePath); const cached = cache.get(file); if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file })
  const module = { exports: {} }; cache.set(file, module)
  Function('exports', 'module', 'require', outputText)(module.exports, module, (specifier) => {
    if (specifier.startsWith('.')) { const candidate = resolve(dirname(file), `${specifier}.ts`); if (existsSync(candidate)) return load(candidate, cache) }
    return require(specifier)
  })
  return module.exports
}

function registry() { const { ProjectChatPresenceRegistry } = load(resolve(testDir, './project-chat-presence.ts')); return new ProjectChatPresenceRegistry() }
function main(id) { return { webContentsId: id, kind: 'main-window' } }
function project(id, projectId, routeGeneration) { return { webContentsId: id, kind: 'project-chat-window', projectId, routeGeneration } }
function runtime(id, runtimeScopeId, routeGeneration, developmentGeneration) { return { webContentsId: id, kind: 'runtime-development', runtimeScopeId, routeGeneration, developmentGeneration } }

test('presence defaults hidden and selection is capability-bound', () => {
  const presence = registry(); presence.register(main(1)); presence.register(project(7, 'p', 3)); presence.register(project(8, 'p', 2))
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [])
  assert.equal(presence.reportSelection(99, { projectId: 'p', selectedThreadId: 't' }).error.code, 'sender-not-authorized')
  assert.equal(presence.reportSelection(7, { projectId: 'wrong', selectedThreadId: 't' }).error.code, 'sender-not-authorized')
  assert.equal(presence.setWindowState(99, { visible: true, focused: true }), false)
  presence.reportSelection(7, { projectId: 'p', selectedThreadId: 't' }); presence.setWindowState(7, { visible: true, focused: true })
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [7])
  presence.setWindowState(8, { visible: true, focused: true })
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [7], 'stale generation is never a candidate')
  presence.setWindowState(7, { visible: false, focused: false }); presence.reportSelection(8, { projectId: 'p', selectedThreadId: 't' }); presence.setWindowState(8, { visible: true, focused: true })
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [], 'a stale focused project window is never a first-priority candidate')
})

test('presence ranks focused exact thread, current project windows, then main windows stably', () => {
  const presence = registry()
  for (const entry of [main(1), main(2), project(7, 'p', 3), project(8, 'p', 3), project(9, 'other', 3)]) presence.register(entry)
  presence.setWindowState(2, { visible: true, focused: false }); presence.setWindowState(1, { visible: true, focused: false })
  presence.setWindowState(8, { visible: true, focused: false }); presence.setWindowState(7, { visible: true, focused: true }); presence.setWindowState(9, { visible: true, focused: false })
  presence.reportSelection(7, { projectId: 'p', selectedThreadId: 't' })
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [7, 8, 1, 2])
  presence.setWindowState(1, { visible: true, focused: true }); presence.reportSelection(1, { projectId: 'p', selectedThreadId: 't' })
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [1, 7, 8, 2])
  presence.setWindowState(1, { visible: false, focused: true }); presence.unregister(7)
  assert.deepEqual(presence.ownerCandidates({ projectId: 'p', threadId: 't', routeGeneration: 3 }), [8, 2])
})

test('Runtime prompt owner is only the visible exact scope and both-generation window', () => {
  const presence = registry(); presence.register(main(1)); presence.register(project(7, 'p', 3)); presence.register(runtime(20, 'workspace:r', 4, 8)); presence.register(runtime(21, 'workspace:r', 4, 7)); presence.register(runtime(22, 'workspace:other', 4, 8))
  assert.equal(presence.reportRuntimeSelection(1, { selectedThreadId: 't' }).error.code, 'sender-not-authorized')
  presence.reportRuntimeSelection(20, { selectedThreadId: 't' }); presence.reportRuntimeSelection(21, { selectedThreadId: 't' }); presence.reportRuntimeSelection(22, { selectedThreadId: 't' })
  presence.setWindowState(20, { visible: true, focused: true }); presence.setWindowState(21, { visible: true, focused: false }); presence.setWindowState(22, { visible: true, focused: false })
  assert.deepEqual(presence.runtimeOwnerCandidates({ runtimeScopeId: 'workspace:r', threadId: 't', routeGeneration: 4, developmentGeneration: 8 }), [20])
  presence.setWindowState(20, { visible: false, focused: false })
  assert.deepEqual(presence.runtimeOwnerCandidates({ runtimeScopeId: 'workspace:r', threadId: 't', routeGeneration: 4, developmentGeneration: 8 }), [], 'closed/hidden window leaves no Runtime prompt owner')
})
