import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadCoordinator() {
  const modulePath = resolve(testDir, './chat-workspace-coordinator.ts')
  const { outputText } = ts.transpileModule(readFileSync(modulePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: modulePath })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports.ChatWorkspaceCoordinator
}

test('workspace coordinator is FIFO, waits for pending work, and releases errors unchanged', async () => {
  const ChatWorkspaceCoordinator = loadCoordinator()
  const coordinator = new ChatWorkspaceCoordinator()
  const order = []
  let release
  const first = coordinator.runExclusive(async () => { order.push('first:start'); await new Promise((resolve) => { release = resolve }); order.push('first:end'); return 'first' })
  const thrown = coordinator.runExclusive(() => { order.push('throw'); throw new Error('sync failure') })
  const rejected = coordinator.runExclusive(async () => { order.push('reject'); throw new Error('async failure') })
  const last = coordinator.runExclusive(() => { order.push('last'); return 'last' })
  let idle = false
  void coordinator.idle().then(() => { idle = true })
  await Promise.resolve()
  assert.deepEqual(order, ['first:start']); assert.equal(idle, false)
  release()
  assert.equal(await first, 'first')
  await assert.rejects(thrown, /sync failure/)
  await assert.rejects(rejected, /async failure/)
  assert.equal(await last, 'last')
  await coordinator.idle()
  assert.deepEqual(order, ['first:start', 'first:end', 'throw', 'reject', 'last'])
  assert.equal(idle, true)
})
