import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadStoreModule() {
  const modulePath = resolve(testDir, 'agent-mode-settings-store.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'agentos-agent-mode-'))
  const root = join(dir, 'project')
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  try {
    const { AgentModeSettingsStore } = loadStoreModule()
    const result = run(new AgentModeSettingsStore(dir), root, dir)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

test('agent mode settings keep MCP definitions global and project switches local', async () => {
  await withStore(async (store, root, dir) => {
    const globalResult = await store.saveGlobalMcpSettings({
      mcpServers: [
        {
          name: 'github server',
          enabled: true,
          transport: 'stdio',
          command: ' npx ',
          args: [' -y ', '', '@modelcontextprotocol/server-github'],
          env: { ' GITHUB_TOKEN ': ' ${GITHUB_TOKEN} ', EMPTY: 12 },
          url: 'https://ignored.example.com',
          headers: {},
          alwaysLoad: true,
        },
        {
          name: 'github-server',
          enabled: false,
          transport: 'http',
          command: '',
          args: [],
          env: {},
          url: ' https://mcp.example.com ',
          headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
          alwaysLoad: false,
        },
      ],
    })

    assert.equal(globalResult.ok, true)
    assert.deepEqual(globalResult.settings.mcpServers.map((server) => server.name), ['github-server', 'github-server-2'])
    assert.equal(globalResult.settings.mcpServers[0].command, 'npx')
    assert.deepEqual(globalResult.settings.mcpServers[0].args, ['-y', '@modelcontextprotocol/server-github'])
    assert.deepEqual(globalResult.settings.mcpServers[0].env, { GITHUB_TOKEN: '${GITHUB_TOKEN}' })

    const result = await store.saveSettings(root, {
      mcpServerOverrides: {
        'github-server': { enabled: false },
        'github-server-2': { enabled: true },
      },
      mcpToolPolicies: {
        'mcp__github-server__create_issue': 'allow',
        'mcp__github-server__delete_repo': 'deny',
        invalid: 'sometimes',
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.settings.mcpServers.map((server) => [server.name, server.enabled]), [['github-server', false]])
    assert.deepEqual(result.settings.mcpServerOverrides, {
      'github-server': { enabled: false },
      'github-server-2': { enabled: true },
    })
    assert.deepEqual(result.settings.mcpToolPolicies, {
      'mcp__github-server__create_issue': 'allow',
      'mcp__github-server__delete_repo': 'deny',
    })

    const raw = JSON.parse(readFileSync(join(dir, 'agent-mode-settings.json'), 'utf8'))
    assert.equal(raw.globalMcpServers[1].url, 'https://mcp.example.com')
    assert.equal(raw.projects[resolve(root)].mcpServers, undefined)
    assert.equal(raw.projects[resolve(root)].mcpServerOverrides['github-server'].enabled, false)
  })
})

test('agent mode settings persist global web search settings', async () => {
  await withStore(async (store, _root, dir) => {
    const result = await store.saveGlobalWebSearchSettings({
      mode: 'agentos',
      provider: 'tavily',
      maxResults: 20,
      braveApiKey: ' ${BRAVE_SEARCH_API_KEY} ',
      tavilyApiKey: ' tvly-test-key ',
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.settings, {
      mode: 'agentos',
      provider: 'tavily',
      braveApiKey: '${BRAVE_SEARCH_API_KEY}',
      tavilyApiKey: 'tvly-test-key',
      braveApiKeys: ['${BRAVE_SEARCH_API_KEY}'],
      tavilyApiKeys: ['tvly-test-key'],
    })

    const reloaded = await store.getGlobalWebSearchSettings()
    assert.equal(reloaded.ok, true)
    assert.deepEqual(reloaded.settings, result.settings)

    const raw = JSON.parse(readFileSync(join(dir, 'agent-mode-settings.json'), 'utf8'))
    assert.deepEqual(raw.globalWebSearchSettings, result.settings)

    const pooled = await store.saveGlobalWebSearchSettings({
      mode: 'agentos',
      provider: 'brave',
      braveApiKeys: [' first-brave ', '', '${SECOND_BRAVE_KEY}'],
      tavilyApiKeys: [' tvly-one ', 'tvly-two'],
    })
    assert.equal(pooled.ok, true)
    assert.deepEqual(pooled.settings.braveApiKeys, ['first-brave', '${SECOND_BRAVE_KEY}'])
    assert.deepEqual(pooled.settings.tavilyApiKeys, ['tvly-one', 'tvly-two'])
    assert.equal(pooled.settings.braveApiKey, 'first-brave')
    assert.equal(pooled.settings.tavilyApiKey, 'tvly-one')

    const legacyDuckDuckGo = await store.saveGlobalWebSearchSettings({
      mode: 'agentos',
      provider: 'duckduckgo-instant',
      braveApiKey: '',
      tavilyApiKey: '',
    })
    assert.equal(legacyDuckDuckGo.ok, true)
    assert.equal(legacyDuckDuckGo.settings.provider, 'duckduckgo')
  })
})

test('agent mode settings cache MCP probe snapshots only for matching global configs', async () => {
  await withStore(async (store) => {
    const { buildAgentMcpServerConfigSignature } = loadStoreModule()
    const saved = await store.saveGlobalMcpSettings({
      mcpServers: [
        {
          name: 'github',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
          cwd: '~/code',
          url: '',
          headers: {},
          alwaysLoad: false,
        },
      ],
    })

    assert.equal(saved.ok, true)
    const [server] = saved.settings.mcpServers
    const cached = await store.saveGlobalMcpProbeSnapshot({
      serverName: server.name,
      status: 'connected',
      checkedAt: '2026-06-24T00:00:00.000Z',
      configSignature: buildAgentMcpServerConfigSignature(server),
      serverInfo: { name: 'github-mcp', version: '1.0.0' },
      tools: [{ name: 'create_issue', description: 'Create an issue' }],
    })

    assert.equal(cached.ok, true)
    assert.deepEqual(cached.settings.mcpServerProbeCache.github.tools.map((tool) => tool.name), ['create_issue'])

    const changed = await store.saveGlobalMcpSettings({
      mcpServers: [{ ...server, command: 'node' }],
    })

    assert.equal(changed.ok, true)
    assert.deepEqual(changed.settings.mcpServerProbeCache, {})
  })
})
