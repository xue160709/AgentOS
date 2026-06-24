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
    if (specifier === '../safe-console') return { safeConsoleInfo() {}, safeConsoleError() {}, safeConsoleWarn() {} }
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
  assert.equal(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo' }).id, 'duckduckgo')
  assert.equal(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo-instant' }).id, 'duckduckgo')
  assert.equal(resolveWebSearchProviderStatus({ AGENTOS_WEB_SEARCH_PROVIDER: 'missing' }).available, false)
})

test('web search provider executes through fetch and returns normalized results', async () => {
  const { normalizeWebSearchRequest, searchWeb } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const parsedUrl = new URL(url)
    calls.push(`${parsedUrl.hostname}${parsedUrl.pathname}`)
    assert.equal(parsedUrl.hostname, 'html.duckduckgo.com')
    assert.equal(parsedUrl.searchParams.get('q'), 'example')
    assert.match(init.headers['User-Agent'], /Mozilla\/5\.0/)
    return {
      ok: true,
      text: async () => `
        <a class="result__a" href="https://example.com/overview">Example &amp; Overview</a>
        <a class="result__snippet">Overview&nbsp;snippet</a>
        <a class="result__a" href="https://docs.example.com/page">Docs page</a>
        <a class="result__snippet">extra detail</a>
      `,
    }
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest({ query: 'example', max_results: 2 }),
      { AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo' },
    )

    assert.equal(response.provider.id, 'duckduckgo')
    assert.deepEqual(calls, ['html.duckduckgo.com/html'])
    assert.deepEqual(response.results.map((item) => item.url), ['https://example.com/overview', 'https://docs.example.com/page'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('DuckDuckGo provider decodes HTML search results directly', async () => {
  const { normalizeWebSearchRequest, searchWeb } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const parsedUrl = new URL(url)
    calls.push(`${parsedUrl.hostname}${parsedUrl.pathname}`)
    assert.equal(parsedUrl.hostname, 'html.duckduckgo.com')
    assert.match(init.headers['User-Agent'], /Mozilla\/5\.0/)
    return {
      ok: true,
      text: async () => `
        <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fq%3Dsam" class="result__a">
          Sam &amp; OpenAI News
        </a>
        <a class="result__snippet">Fresh&nbsp;search &hellip; with details</a>
        <a class="result__a" href="https://example.org/direct">Direct result</a>
        <a class="result__snippet">Second snippet</a>
      `,
    }
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest({ query: 'Sam Altman news', max_results: 2, freshness: 'week' }),
      { AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo' },
    )

    assert.equal(response.provider.name, 'DuckDuckGo Search')
    assert.deepEqual(calls, ['html.duckduckgo.com/html'])
    assert.deepEqual(response.results, [
      {
        title: 'Sam & OpenAI News',
        url: 'https://example.com/news?q=sam',
        snippet: 'Fresh search ... with details',
        source: 'example.com',
      },
      {
        title: 'Direct result',
        url: 'https://example.org/direct',
        snippet: 'Second snippet',
        source: 'example.org',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('DuckDuckGo provider returns an empty result instead of a tool error when HTML search fails', async () => {
  const { normalizeWebSearchRequest, searchWeb } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const parsedUrl = new URL(url)
    calls.push(`${parsedUrl.hostname}${parsedUrl.pathname}`)
    throw new Error(`TLS failed for ${parsedUrl.hostname}`)
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest({ query: 'Sam Altman news today 2026-06-24', freshness: 'day' }),
      { AGENTOS_WEB_SEARCH_PROVIDER: 'duckduckgo' },
    )

    assert.equal(response.provider.name, 'DuckDuckGo Search')
    assert.deepEqual(calls, ['html.duckduckgo.com/html'])
    assert.deepEqual(response.results, [])
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

test('web search provider maps HTTP quota errors and does not leak credentials', async () => {
  const { normalizeWebSearchRequest, searchWeb, summarizeWebSearchProviderError } = loadWebSearchProviderModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 432,
    text: async () => JSON.stringify({ detail: { error: 'Monthly request limit reached' } }),
  })

  try {
    await assert.rejects(
      () =>
        searchWeb(
          normalizeWebSearchRequest({ query: 'claude agent sdk', max_results: 1 }),
          { AGENTOS_WEB_SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'tvly-secret-value' },
        ),
      (error) => {
        const summary = summarizeWebSearchProviderError(error)
        assert.equal(summary.kind, 'quota')
        assert.match(summary.message, /Tavily quota or plan limit was reached/)
        assert.match(summary.message, /Monthly request limit reached/)
        assert.doesNotMatch(summary.message, /tvly-secret-value/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web search provider test resolves environment references before probing', async () => {
  const { testWebSearchProviderSettings } = loadWebSearchRuntimeModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.tavily.com')
    assert.equal(init.headers.Authorization, 'Bearer resolved-tavily-key')
    return {
      ok: true,
      json: async () => ({
        results: [{ title: 'Connectivity', url: 'https://example.com/result', content: 'ok' }],
      }),
    }
  }

  try {
    const result = await testWebSearchProviderSettings(
      {
        mode: 'agentos',
        provider: 'tavily',
        maxResults: 3,
        braveApiKey: '',
        tavilyApiKey: '${TAVILY_SEARCH_KEY}',
      },
      { TAVILY_SEARCH_KEY: 'resolved-tavily-key' },
    )

    assert.equal(result.ok, true)
    assert.equal(result.providerId, 'tavily')
    assert.equal(result.credentialStatus, 'env-resolved')
    assert.equal(result.resultCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web search provider test reports unresolved environment references without fetching', async () => {
  const { testWebSearchProviderSettings } = loadWebSearchRuntimeModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for missing credentials')
  }

  try {
    const result = await testWebSearchProviderSettings(
      {
        mode: 'agentos',
        provider: 'tavily',
        maxResults: 3,
        braveApiKey: '',
        tavilyApiKey: '${MISSING_TAVILY_KEY}',
      },
      {},
    )

    assert.equal(result.ok, false)
    assert.equal(result.providerId, 'tavily')
    assert.equal(result.credentialStatus, 'env-missing')
    assert.equal(result.errorKind, 'missing-credential')
    assert.match(result.message, /TAVILY_API_KEY is not configured/)
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

test('web search runtime tool errors include recovery hints', async () => {
  const { AGENTOS_WEB_SEARCH_SERVER_NAME, buildWebSearchRuntimeOptions } = loadWebSearchRuntimeModule()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 432,
    text: async () => JSON.stringify({ detail: 'Monthly request limit reached' }),
  })

  try {
    const runtime = buildWebSearchRuntimeOptions(
      {
        mode: 'agentos',
        provider: 'tavily',
        maxResults: 1,
        braveApiKey: '',
        tavilyApiKey: 'tvly-secret-value',
      },
      {},
    )
    const tool = runtime.mcpServers[AGENTOS_WEB_SEARCH_SERVER_NAME].instance.tools[0]
    const result = await tool.handler({ query: 'claude agent sdk', max_results: 1 })

    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /AgentOS web_search failed \(quota\)/)
    assert.match(result.content[0].text, /Recovery:/)
    assert.doesNotMatch(result.content[0].text, /tvly-secret-value/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
