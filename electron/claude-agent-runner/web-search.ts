/**
 * In-process MCP bridge that lets Claude Code's WebSearch tool name resolve to
 * AgentOS-owned web search providers.
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type {
  AgentWebSearchCredentialStatus,
  AgentWebSearchProviderErrorKind,
  AgentWebSearchProviderTestResult,
  AgentWebSearchSettings,
} from '../../src/desktop-types'
import {
  buildWebSearchConfigSignature,
  formatWebSearchToolOutput,
  normalizeWebSearchRequest,
  resolveWebSearchProviderStatus,
  searchWeb,
  summarizeWebSearchProviderError,
  type WebSearchEnv,
} from './web-search-provider'

export const AGENTOS_WEB_SEARCH_SERVER_NAME = 'agentos-web'
export const AGENTOS_WEB_SEARCH_TOOL_NAME = 'web_search'
export const AGENTOS_WEB_SEARCH_MCP_TOOL_NAME = `mcp__${AGENTOS_WEB_SEARCH_SERVER_NAME}__${AGENTOS_WEB_SEARCH_TOOL_NAME}`

export type WebSearchRuntimeOptions = {
  mcpServers?: Record<string, McpServerConfig>
  allowedTools: string[]
  disallowedTools?: string[]
  toolAliases?: Record<string, string>
  configSignature: string
  unresolvedEnv: []
}

const WEB_SEARCH_TOOL_SCHEMA = {
  query: z.string().min(1).describe('Search query. Use concise keywords for current or external web information.'),
  max_results: z.number().int().min(1).max(10).optional().describe('Maximum number of results to return. Defaults to 5.'),
  allowed_domains: z.array(z.string().min(1)).optional().describe('Optional domains to restrict results to.'),
  blocked_domains: z.array(z.string().min(1)).optional().describe('Optional domains to exclude from results.'),
  freshness: z.string().optional().describe('Optional freshness hint such as day, week, month, year, pd, pw, pm, or py.'),
}

export function buildWebSearchRuntimeOptions(settings: AgentWebSearchSettings | undefined, env: WebSearchEnv): WebSearchRuntimeOptions {
  const normalizedSettings = normalizeRuntimeWebSearchSettings(settings)
  if (normalizedSettings.mode === 'native') {
    return {
      allowedTools: [],
      configSignature: JSON.stringify({
        mode: 'native',
        version: 2,
      }),
      unresolvedEnv: [],
    }
  }

  const webSearchEnv = buildProviderEnv(normalizedSettings, env)
  const webSearchTool = tool(
    AGENTOS_WEB_SEARCH_TOOL_NAME,
    'Search the web through AgentOS web search providers and return ranked results with URLs and snippets.',
    WEB_SEARCH_TOOL_SCHEMA,
    async (args) => {
      try {
        const request = normalizeWebSearchRequest(args, normalizedSettings.maxResults)
        const response = await searchWeb(request, webSearchEnv)
        return {
          content: [{ type: 'text' as const, text: formatWebSearchToolOutput(response) }],
        }
      } catch (error) {
        const summary = summarizeWebSearchProviderError(error)
        const recovery = summary.recoveryHint ? ` Recovery: ${summary.recoveryHint}` : ''
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `AgentOS web_search failed (${summary.kind}): ${summary.message}${recovery}` }],
        }
      }
    },
    { alwaysLoad: true },
  )

  const status = resolveWebSearchProviderStatus(webSearchEnv)
  const server = createSdkMcpServer({
    name: AGENTOS_WEB_SEARCH_SERVER_NAME,
    version: '0.1.0',
    tools: [webSearchTool],
    alwaysLoad: true,
  })

  return {
    mcpServers: {
      [AGENTOS_WEB_SEARCH_SERVER_NAME]: server,
    },
    allowedTools: [AGENTOS_WEB_SEARCH_MCP_TOOL_NAME],
    disallowedTools: ['WebSearch'],
    toolAliases: {
      WebSearch: AGENTOS_WEB_SEARCH_MCP_TOOL_NAME,
    },
    configSignature: JSON.stringify({
      mode: 'agentos',
      defaultMaxResults: normalizedSettings.maxResults,
      provider: buildWebSearchConfigSignature(webSearchEnv),
      available: status.available,
      providerId: status.id,
      version: 2,
    }),
    unresolvedEnv: [],
  }
}

export function isAgentOsWebSearchServerName(name: string): boolean {
  return name === AGENTOS_WEB_SEARCH_SERVER_NAME
}

export async function testWebSearchProviderSettings(
  settings: AgentWebSearchSettings | undefined,
  env: WebSearchEnv,
): Promise<AgentWebSearchProviderTestResult> {
  const normalizedSettings = normalizeRuntimeWebSearchSettings(settings)
  const checkedAt = new Date().toISOString()
  if (normalizedSettings.mode === 'native') {
    return {
      ok: true,
      providerId: normalizedSettings.provider,
      providerName: 'Native Web Search',
      credentialStatus: 'not-required',
      resultCount: 0,
      checkedAt,
      message: 'Native Web Search is handled by Claude Code.',
    }
  }

  const webSearchEnv = buildProviderEnv(normalizedSettings, env)
  const credentialStatus = resolveWebSearchCredentialStatus(normalizedSettings, env)
  const providerStatus = resolveWebSearchProviderStatus(webSearchEnv)
  if (!providerStatus.available) {
    return {
      ok: false,
      providerId: normalizedSettings.provider,
      providerName: providerStatus.name,
      credentialStatus,
      errorKind: credentialStatus === 'missing' || credentialStatus === 'env-missing' ? 'missing-credential' : 'unknown',
      checkedAt,
      message: providerStatus.reason ?? 'Search provider is unavailable.',
      recoveryHint: recoveryHintForUnavailableProvider(credentialStatus),
    }
  }

  try {
    const response = await searchWeb(
      normalizeWebSearchRequest(
        {
          query: 'AgentOS web search connectivity',
          max_results: 1,
        },
        normalizedSettings.maxResults,
      ),
      webSearchEnv,
    )
    return {
      ok: true,
      providerId: normalizedSettings.provider,
      providerName: providerStatus.name,
      credentialStatus,
      resultCount: response.results.length,
      checkedAt,
      message: `${providerStatus.name} provider test completed.`,
    }
  } catch (error) {
    const summary = summarizeWebSearchProviderError(error)
    return {
      ok: false,
      providerId: normalizedSettings.provider,
      providerName: providerStatus.name,
      credentialStatus,
      errorKind: summary.kind as AgentWebSearchProviderErrorKind,
      checkedAt,
      message: summary.message,
      recoveryHint: summary.recoveryHint,
    }
  }
}

function normalizeRuntimeWebSearchSettings(settings: AgentWebSearchSettings | undefined): AgentWebSearchSettings {
  return {
    mode: settings?.mode === 'agentos' ? 'agentos' : 'native',
    provider:
      settings?.provider === 'brave' || settings?.provider === 'tavily' || settings?.provider === 'duckduckgo'
        ? settings.provider
        : 'duckduckgo',
    maxResults: clampMaxResults(settings?.maxResults),
    braveApiKey: settings?.braveApiKey?.trim() ?? '',
    tavilyApiKey: settings?.tavilyApiKey?.trim() ?? '',
  }
}

function buildProviderEnv(settings: AgentWebSearchSettings, env: WebSearchEnv): WebSearchEnv {
  const nextEnv: WebSearchEnv = {
    ...env,
    AGENTOS_WEB_SEARCH_PROVIDER: settings.provider,
    WEB_SEARCH_PROVIDER: settings.provider,
  }
  if (settings.provider === 'brave') {
    const apiKey = resolveSecretSetting(settings.braveApiKey, env)
    if (apiKey) nextEnv.BRAVE_SEARCH_API_KEY = apiKey
  }
  if (settings.provider === 'tavily') {
    const apiKey = resolveSecretSetting(settings.tavilyApiKey, env)
    if (apiKey) nextEnv.TAVILY_API_KEY = apiKey
  }
  return nextEnv
}

function resolveSecretSetting(value: string, env: WebSearchEnv): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const resolved = trimmed.replace(/\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g, (_match, variable: string) => env[variable]?.trim() ?? '')
  return resolved.trim()
}

function resolveWebSearchCredentialStatus(settings: AgentWebSearchSettings, env: WebSearchEnv): AgentWebSearchCredentialStatus {
  if (settings.provider === 'duckduckgo') return 'not-required'
  const rawValue = settings.provider === 'brave' ? settings.braveApiKey : settings.tavilyApiKey
  const trimmed = rawValue.trim()
  if (!trimmed) return 'missing'

  const references = Array.from(trimmed.matchAll(/\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g)).map((match) => match[1])
  if (references.length === 0) return 'configured'

  const unresolved = references.some((variable) => !env[variable]?.trim())
  return unresolved ? 'env-missing' : 'env-resolved'
}

function recoveryHintForUnavailableProvider(credentialStatus: AgentWebSearchCredentialStatus): string {
  if (credentialStatus === 'missing') return 'Add an API key or a ${ENV_NAME} reference, then test the provider again.'
  if (credentialStatus === 'env-missing') return 'Check that the referenced environment variable is available to the Electron main process.'
  return 'Check provider settings and try again.'
}

function clampMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5
  return Math.min(10, Math.max(1, Math.floor(Number(value))))
}
