import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = dirname(fileURLToPath(import.meta.url))
function load(file, cache = new Map()) {
  const full = resolve(file); if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }; cache.set(full, module)
  const out = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: full }).outputText
  Function('exports', 'module', 'require', out)(module.exports, module, (specifier) => specifier.startsWith('.') && existsSync(resolve(dirname(full), `${specifier}.ts`)) ? load(resolve(dirname(full), `${specifier}.ts`), cache) : require(specifier))
  return module.exports
}

test('multiplexer isolates observers', () => {
  const { ClaudeChatEventMultiplexer } = load(resolve(root, 'claude-chat-event-multiplexer.ts'))
  const events = []; const mux = new ClaudeChatEventMultiplexer()
  mux.setSinks([{ publish: () => { throw new Error('observer') } }, { publish: (event) => events.push(event) }])
  mux.publish({ type: 'result', requestId: 'r', result: 'ok' })
  assert.equal(events.length, 1)
})
