import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
const presetCatalog = require('../src/model-provider-presets.json')

function loadPresetModule() {
  const modulePath = resolve(testDir, '../src/model-provider-presets.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (specifier === './model-provider-presets.json') return presetCatalog
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

test('local model provider preset ids are unique', () => {
  const ids = presetCatalog.providers.map((provider) => provider.id)

  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('minimax'))
  assert.ok(ids.includes('minimax-global'))
})

test('preset catalog normalization rewrites duplicate ids before rendering', () => {
  const { normalizePresetCatalog } = loadPresetModule()
  const catalog = normalizePresetCatalog({
    version: 'test',
    providers: [
      { id: 'duplicate', name: { en: 'One', zh: 'One' }, baseUrl: 'https://one.example.test' },
      { id: 'duplicate', name: { en: 'Two', zh: 'Two' }, baseUrl: 'https://two.example.test' },
    ],
  }, 'en')

  assert.deepEqual(catalog.providers.map((provider) => provider.id), ['duplicate', 'duplicate-2'])
  assert.deepEqual(catalog.providers.map((provider) => provider.name), ['One', 'Two'])
})

test('settings page does not fetch remote provider presets by default', () => {
  const source = readFileSync(resolve(testDir, '../src/components/setting/ClaudeAgentSettingsPage.tsx'), 'utf8')

  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/xuezhirong\/AgentOS/)
  assert.match(source, /VITE_MODEL_PROVIDER_PRESETS_URL/)
})
