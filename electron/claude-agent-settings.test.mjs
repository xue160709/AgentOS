import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))
const presetCatalog = require('../src/model-provider-presets.json')

function loadSettingsModule() {
  const modulePath = resolve(testDir, 'claude-agent-settings.ts')
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
    if (specifier === './safe-console') return { safeConsoleInfo() {} }
    if (specifier === '../src/model-provider-presets.json') return presetCatalog
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function withSettingsStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'agentos-settings-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  try {
    const { ClaudeAgentSettingsStore } = loadSettingsModule()
    const result = run(new ClaudeAgentSettingsStore(dir), dir)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

test('new installations start with one empty provider instead of the entire preset catalog', () => {
  withSettingsStore((store) => {
    const settings = store.read()

    assert.equal(settings.providers.length, 1)
    assert.equal(settings.providers[0].apiKey, '')
    assert.equal(settings.providers[0].baseUrl, '')
    assert.equal(settings.providers[0].model, '')
  })
})

test('legacy preset-catalog pollution is removed while the configured provider is preserved', () => {
  withSettingsStore((store, dir) => {
    const minimax = presetCatalog.providers.find((provider) => provider.name.en === 'MiniMax-CN')
    assert.ok(minimax)
    const configuredProvider = {
      ...minimax,
      id: 'anthropic',
      presetId: 'minimax',
      name: 'MiniMax-CN',
      apiKey: 'configured-secret',
    }
    const legacySettings = {
      configSource: 'settings',
      activeProviderId: configuredProvider.id,
      activeAnthropicModel: configuredProvider.model,
      providers: [configuredProvider, ...presetCatalog.providers.slice(1)],
    }
    writeFileSync(join(dir, 'claude-agent-settings.json'), JSON.stringify(legacySettings), 'utf8')

    const settings = store.read()

    assert.equal(settings.providers.length, 1)
    assert.equal(settings.providers[0].name, 'MiniMax-CN')
    assert.equal(settings.providers[0].apiKey, 'configured-secret')
  })
})

test('connection tests send the visible primary model before tier fallbacks', async () => {
  await withSettingsStore(async (store) => {
    const originalFetch = globalThis.fetch
    let requestedModel = ''
    globalThis.fetch = async (_url, options) => {
      requestedModel = JSON.parse(options.body).model
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    try {
      const result = await store.testProvider({
        id: 'minimax',
        presetId: 'minimax',
        name: 'MiniMax-CN',
        apiKeyUrl: '',
        authMode: 'authToken',
        apiKey: 'secret',
        authToken: '',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        model: 'MiniMax-M2.7',
        modelSupportsImages: false,
        defaultHaikuModel: 'MiniMax-M3',
        defaultHaikuSupportsImages: false,
        defaultOpusModel: 'MiniMax-M3',
        defaultOpusSupportsImages: false,
        defaultSonnetModel: 'MiniMax-M3',
        defaultSonnetSupportsImages: false,
      })

      assert.equal(requestedModel, 'MiniMax-M2.7')
      assert.equal(result.message, '连接成功，已验证 MiniMax-M2.7。')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
