import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadModelPickModule() {
  const modulePath = resolve(testDir, '../src/model-pick.ts')
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

function provider(overrides = {}) {
  return {
    id: 'provider-1',
    presetId: '',
    name: 'Provider',
    apiKeyUrl: '',
    authMode: 'apiKey',
    apiKey: '',
    authToken: '',
    baseUrl: 'https://example.com/anthropic',
    model: 'model-primary',
    modelSupportsImages: false,
    defaultHaikuModel: 'model-haiku',
    defaultHaikuSupportsImages: false,
    defaultOpusModel: 'model-opus',
    defaultOpusSupportsImages: false,
    defaultSonnetModel: 'model-sonnet',
    defaultSonnetSupportsImages: false,
    ...overrides,
  }
}

const slots = { primary: 'Primary', haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

test('model picker excludes providers that have no configured credential', () => {
  const { buildModelPickRows } = loadModelPickModule()

  assert.deepEqual(buildModelPickRows([provider()], slots, 'Fallback'), [])
})

test('model picker includes models from configured providers', () => {
  const { buildModelPickRows } = loadModelPickModule()
  const rows = buildModelPickRows([provider({ apiKey: 'secret' })], slots, 'Fallback')

  assert.deepEqual(
    rows.map((row) => row.anthropicModelId),
    ['model-primary', 'model-haiku', 'model-sonnet', 'model-opus'],
  )
})

test('settings editor exposes the primary model used by runtime and connection tests', () => {
  const source = readFileSync(resolve(testDir, '../src/components/setting/ClaudeAgentSettingsPage.tsx'), 'utf8')

  assert.match(source, /field:\s*'model'\s+as const/)
  assert.match(source, /label:\s*t\('settings\.models\.fieldPrimary'\)/)
  assert.match(source, /value:\s*provider\.model/)
})
