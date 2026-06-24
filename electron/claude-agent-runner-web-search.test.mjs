import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadWebSearchProviderModule() {
  const modulePath = resolve(testDir, 'claude-agent-runner/web-search-provider.ts')
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
  const localRequire = (specifier) => {
    if (specifier === './config') return { summarizeErrorForLog: (error) => ({ message: error?.message ?? String(error) }) }
    if (specifier === '../safe-console') return { safeConsoleInfo() {}, safeConsoleError() {} }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function loadWebSearchRuntimeModule() {
  const modulePath = resolve(testDir, 'claude-agent-runner/web-search.ts')
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
  const schema = {
    min() { return this },
    max() { return this },
    int() { return this },
    optional() { return this },
    describe() { return this },
  }
  const localRequire = (specifier) => {
    if (specifier === './web-search-provider') return loadWebSearchProviderModule()
    if (specifier === '@anthropic-ai/claude-agent-sdk') {
      return {
        createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: config }),
        tool: (name, description, toolSchema, handler, options) => ({ name, description, toolSchema, handler, options }),
      }
    }
    if (specifier === 'zod/v4') {
      return {
        z: {
          string: () => schema,
          number: () => schema,
          array: () => schema,
        },
      }
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

test('web search request normalization accepts Claude-style snake case fields', () => {
  const { normalizeWebSearchRequest } = loadWebSearchProviderModule()

  assert.deepEqual(
    normalizeWebSearchRequest({
      query: '  latest claude agent sdk  ',
      max_results: 20,
      allowed_domains: ['https://docs.anthropic.com/en/docs', 'WWW.example.com/path'],
      blocked_domains: ['spam.example.com'],
      freshness: 'week',
    }),
    {
      query: 'latest claude agent sdk',
      maxResults: 10,
      allowedDomains: ['docs.anthropic.com', 'example.com'],
      blockedDomains: ['spam.example.com'],
      freshness: 'week',
    },
  )
})

test('web search results are deduped and filtered by domain rules', () => {
  const { filterWebSearchResults } = loadWebSearchProviderModule()

  const results = filterWebSearchResults(
    [
      { title: 'A', url: 'https://docs.anthropic.com/en/a', snippet: 'first' },
      { title: 'A duplicate', url: 'https://docs.anthropic.com/en/a', snippet: 'duplicate' },
      { title: 'Blocked', url: 'https://blog.example.com/post' },
      { title: 'Outside', url: 'https://outside.test/page' },
    ],
    {
      allowedDomains: ['anthropic.com', 'example.com'],
      blockedDomains: ['blog.example.com'],
    },
  )

  assert.deepEqual(results, [{ title: 'A', url: 'https://docs.anthropic.com/en/a', snippet: 'first', source: '' }])
})

test('web search provider status prefers Brave when configured and otherwise falls back', () => {
  const { resolveWebSearchProviderStatus } = loadWebSearchProviderModule()

  assert.deepEqual(resolveWebSearchProviderStatus({ BRAVE_SEARCH_API_KEY: 'secret' }), {
    id: 'brave',
    name: 'Brave Search',
    available: true,
    reason: undefined,
  })
  assert.deepEqual(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'secret' }), {
    id: 'tavily',
    name: 'Tavily',
    available: true,
    reason: undefined,
  })
  assert.equal(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo-instant' }).id, 'duckduckgo-instant')
  assert.equal(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'missing' }).available, false)
})

test('web search provider executes through fetch and returns normalized results', async () => {
  const { normalizeWebSearchRequest, searchWeb } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, 'api.duckduckgo.com')
    return {
      ok: true,
      json: async () => ({
        AbstractURL: 'https://example.com/overview',
        Heading: 'Example',
        AbstractText: 'Overview snippet',
        RelatedTopics: [
          {
            FirstURL: 'https://docs.example.com/page',
            Text: 'Docs page - extra detail',
          },
        ],
      }),
    }
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest({ query: 'example', max_results: 2 }),
      { AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo-instant' },
    )

    assert.equal(response.provider.id, 'duckduckgo-instant')
    assert.deepEqual(response.results.map((item) => item.url), ['https://example.com/overview', 'https://docs.example.com/page'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web search provider executes Tavily through POST and returns normalized results', async () => {
  const { normalizeWebSearchRequest, searchWeb } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.tavily.com')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.Authorization, 'Bearer tavily-secret')
    const payload = JSON.parse(init.body)
    assert.equal(payload.query, 'claude agent sdk')
    assert.equal(payload.max_results, 3)
    assert.equal(payload.time_range, 'week')
    assert.deepEqual(payload.include_domains, ['example.com'])
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Claude Agent SDK',
            url: 'https://example.com/sdk',
            content: 'SDK overview',
            published_date: '2026-06-01',
          },
        ],
      }),
    }
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest({
        query: 'claude agent sdk',
        max_results: 3,
        allowed_domains: ['example.com'],
        freshness: 'week',
      }),
      { AGENTOS_WEB_SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'tavily-secret' },
    )

    assert.equal(response.provider.id, 'tavily')
    assert.deepEqual(response.results, [
      {
        title: 'Claude Agent SDK',
        url: 'https://example.com/sdk',
        snippet: 'SDK overview',
        source: 'example.com',
        publishedAt: '2026-06-01',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web search runtime leaves native WebSearch untouched', () => {
  const { buildWebSearchRuntimeOptions } = loadWebSearchRuntimeModule()

  const runtime = buildWebSearchRuntimeOptions(
    {
      mode: 'native',
      provider: 'brave',
      maxResults: 10,
      braveApiKey: '${BRAVE_SEARCH_API_KEY}',
      tavilyApiKey: '',
    },
    { BRAVE_SEARCH_API_KEY: 'secret' },
  )

  assert.equal(runtime.mcpServers, undefined)
  assert.deepEqual(runtime.allowedTools, [])
  assert.equal(runtime.disallowedTools, undefined)
  assert.equal(runtime.toolAliases, undefined)
  assert.match(runtime.configSignature, /"mode":"native"/)
})

test('web search runtime aliases WebSearch to AgentOS provider when enabled', () => {
  const {
    AGENTOS_WEB_SEARCH_MCP_TOOL_NAME,
    AGENTOS_WEB_SEARCH_SERVER_NAME,
    buildWebSearchRuntimeOptions,
  } = loadWebSearchRuntimeModule()

  const runtime = buildWebSearchRuntimeOptions(
    {
      mode: 'agentos',
      provider: 'brave',
      maxResults: 7,
      braveApiKey: '${BRAVE_SEARCH_API_KEY}',
      tavilyApiKey: '',
    },
    { BRAVE_SEARCH_API_KEY: 'secret' },
  )

  assert.equal(runtime.mcpServers[AGENTOS_WEB_SEARCH_SERVER_NAME].name, AGENTOS_WEB_SEARCH_SERVER_NAME)
  assert.deepEqual(runtime.allowedTools, [AGENTOS_WEB_SEARCH_MCP_TOOL_NAME])
  assert.deepEqual(runtime.disallowedTools, ['WebSearch'])
  assert.deepEqual(runtime.toolAliases, { WebSearch: AGENTOS_WEB_SEARCH_MCP_TOOL_NAME })
  assert.match(runtime.configSignature, /"mode":"agentos"/)
  assert.match(runtime.configSignature, /"providerId":"brave"/)
  assert.match(runtime.configSignature, /"defaultMaxResults":7/)
})
