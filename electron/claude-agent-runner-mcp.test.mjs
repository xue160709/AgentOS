import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadMcpModule() {
  const modulePath = resolve(testDir, 'claude-agent-runner/mcp.ts')
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

test('MCP runtime options convert project settings into Claude SDK query options', () => {
  const { buildMcpRuntimeOptions } = loadMcpModule()

  const runtime = buildMcpRuntimeOptions(
    {
      mcpServers: [
        {
          name: 'github',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github', '${GITHUB_TOKEN}'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
          url: '',
          headers: {},
          alwaysLoad: true,
        },
        {
          name: 'remote',
          enabled: true,
          transport: 'http',
          command: '',
          args: [],
          env: {},
          url: 'https://mcp.example.com/${MCP_WORKSPACE}',
          headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
          alwaysLoad: false,
        },
      ],
      mcpToolPolicies: {
        'mcp__github__create_issue': 'allow',
        'mcp__github__delete_repo': 'deny',
        'mcp__remote__search': 'ask',
      },
    },
    ['Read'],
    {
      GITHUB_TOKEN: 'ghp_secret',
      MCP_TOKEN: 'remote_secret',
    },
  )

  assert.deepEqual(runtime.allowedTools, ['Read', 'mcp__github__create_issue'])
  assert.deepEqual(runtime.disallowedTools, ['mcp__github__delete_repo'])
  assert.deepEqual(runtime.unresolvedEnv, [{ serverName: 'remote', field: 'url', variable: 'MCP_WORKSPACE' }])
  assert.equal(runtime.mcpServers.github.command, 'npx')
  assert.deepEqual(runtime.mcpServers.github.args, ['-y', '@modelcontextprotocol/server-github', 'ghp_secret'])
  assert.deepEqual(runtime.mcpServers.github.env, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' })
  assert.equal(runtime.mcpServers.github.alwaysLoad, true)
  assert.equal(runtime.mcpServers.remote.type, 'http')
  assert.equal(runtime.mcpServers.remote.headers.Authorization, 'Bearer remote_secret')
  assert.deepEqual(runtime.mcpServers.remote.tools, [{ name: 'search', permission_policy: 'always_ask' }])
})

test('MCP tool names are formatted for permission and transcript display', () => {
  const { buildMcpPermissionCopy, formatMcpToolDisplayName } = loadMcpModule()

  assert.equal(formatMcpToolDisplayName('mcp__github__create_issue'), 'github · create_issue')
  assert.deepEqual(buildMcpPermissionCopy('mcp__github__create_issue'), {
    title: 'MCP 权限请求',
    displayName: 'github · create_issue',
  })
  assert.deepEqual(buildMcpPermissionCopy('Bash'), {
    title: 'Bash 需要权限',
    displayName: 'Bash',
  })
})

test('MCP runtime options merge servers, policies, aliases, and signatures', () => {
  const { mergeMcpRuntimeOptions } = loadMcpModule()

  const runtime = mergeMcpRuntimeOptions(
    {
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
      allowedTools: ['Read', 'mcp__github__create_issue'],
      disallowedTools: ['mcp__github__delete_repo'],
      configSignature: 'project',
      unresolvedEnv: [{ serverName: 'github', field: 'env.TOKEN', variable: 'TOKEN' }],
    },
    {
      mcpServers: { 'agentos-web': { type: 'sdk', name: 'agentos-web', instance: {} } },
      allowedTools: ['mcp__agentos-web__web_search'],
      disallowedTools: ['WebSearch'],
      toolAliases: { WebSearch: 'mcp__agentos-web__web_search' },
      configSignature: 'web-search',
      unresolvedEnv: [],
    },
  )

  assert.equal(runtime.mcpServers.github.command, 'npx')
  assert.equal(runtime.mcpServers['agentos-web'].name, 'agentos-web')
  assert.deepEqual(runtime.allowedTools, ['Read', 'mcp__github__create_issue', 'mcp__agentos-web__web_search'])
  assert.deepEqual(runtime.disallowedTools, ['mcp__github__delete_repo', 'WebSearch'])
  assert.deepEqual(runtime.toolAliases, { WebSearch: 'mcp__agentos-web__web_search' })
  assert.deepEqual(runtime.unresolvedEnv, [{ serverName: 'github', field: 'env.TOKEN', variable: 'TOKEN' }])
  assert.equal(runtime.configSignature, JSON.stringify(['project', 'web-search']))
})
