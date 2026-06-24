/**
 * Web search provider registry for the Claude Agent runtime.
 *
 * Providers stay behind this narrow interface so future Brave/Tavily/Exa/SearXNG
 * backends do not leak SDK or MCP details into the runner.
 */

import { summarizeErrorForLog } from './config'
import { safeConsoleError, safeConsoleInfo, safeConsoleWarn } from '../safe-console'

export type WebSearchEnv = Record<string, string | undefined>

export type WebSearchRequest = {
  query: string
  maxResults: number
  allowedDomains: string[]
  blockedDomains: string[]
  freshness?: string
}

export type WebSearchResultItem = {
  title: string
  url: string
  snippet?: string
  source?: string
  publishedAt?: string
}

export type WebSearchResponse = {
  query: string
  provider: {
    id: string
    name: string
  }
  generatedAt: string
  results: WebSearchResultItem[]
}

export type WebSearchProviderStatus = {
  id: string
  name: string
  available: boolean
  reason?: string
}

export type WebSearchProviderErrorKind =
  | 'missing-credential'
  | 'auth'
  | 'quota'
  | 'bot-challenge'
  | 'network'
  | 'service'
  | 'unknown'

export type WebSearchProviderErrorSummary = {
  message: string
  kind: WebSearchProviderErrorKind
  recoveryHint?: string
}

export class WebSearchProviderError extends Error {
  readonly kind: WebSearchProviderErrorKind
  readonly status?: number
  readonly recoveryHint?: string

  constructor(message: string, options: { kind: WebSearchProviderErrorKind; status?: number; recoveryHint?: string }) {
    super(message)
    this.name = 'WebSearchProviderError'
    this.kind = options.kind
    this.status = options.status
    this.recoveryHint = options.recoveryHint
  }
}

export type WebSearchToolArgs = {
  query?: string
  max_results?: number
  maxResults?: number
  allowed_domains?: string[]
  allowedDomains?: string[]
  blocked_domains?: string[]
  blockedDomains?: string[]
  freshness?: string
}

type WebSearchProvider = {
  id: string
  name: string
  requiresCredential: boolean
  isAvailable: (env: WebSearchEnv) => boolean
  unavailableReason: (env: WebSearchEnv) => string
  search: (request: WebSearchRequest, env: WebSearchEnv) => Promise<WebSearchResultItem[]>
}

type BraveSearchResponse = {
  web?: {
    results?: Array<{
      title?: string
      url?: string
      description?: string
      profile?: { name?: string }
      page_age?: string
    }>
  }
}

type TavilySearchResponse = {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    published_date?: string
  }>
}

type DuckDuckGoTopic = {
  Text?: string
  FirstURL?: string
  Result?: string
  Topics?: DuckDuckGoTopic[]
}

type DuckDuckGoInstantAnswer = {
  AbstractText?: string
  AbstractURL?: string
  Heading?: string
  RelatedTopics?: DuckDuckGoTopic[]
  Results?: DuckDuckGoTopic[]
}

type DuckDuckGoHtmlResult = {
  title: string
  url: string
  snippet: string
}

const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS_LIMIT = 10
const WEB_SEARCH_TIMEOUT_MS = 10_000
const PROVIDER_ENV_NAMES = ['AGENTOS_WEB_SEARCH_PROVIDER', 'WEB_SEARCH_PROVIDER'] as const
const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html'
const DUCKDUCKGO_HTML_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const DUCKDUCKGO_HTML_SAFE_SEARCH_MODERATE = '-1'
const DUCKDUCKGO_HTML_CACHE_TTL_MS = 5 * 60 * 1000
const duckDuckGoHtmlCache = new Map<string, { insertedAt: number; results: WebSearchResultItem[] }>()

const braveProvider: WebSearchProvider = {
  id: 'brave',
  name: 'Brave Search',
  requiresCredential: true,
  isAvailable: (env) => Boolean(resolveBraveApiKey(env)),
  unavailableReason: () => 'BRAVE_SEARCH_API_KEY is not configured.',
  async search(request, env) {
    const apiKey = resolveBraveApiKey(env)
    if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is not configured.')

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', request.query)
    url.searchParams.set('count', String(request.maxResults))
    url.searchParams.set('safesearch', 'moderate')
    url.searchParams.set('text_decorations', 'false')
    const freshness = normalizeBraveFreshness(request.freshness)
    if (freshness) url.searchParams.set('freshness', freshness)

    const body = await fetchJson<BraveSearchResponse>(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    })

    return (body.web?.results ?? [])
      .map((item) => ({
        title: cleanText(item.title) || cleanText(item.profile?.name) || item.url || 'Untitled result',
        url: item.url?.trim() ?? '',
        snippet: cleanText(item.description),
        source: cleanText(item.profile?.name) || domainFromUrl(item.url ?? ''),
        publishedAt: item.page_age,
      }))
      .filter((item) => Boolean(item.url))
  },
}

const tavilyProvider: WebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  requiresCredential: true,
  isAvailable: (env) => Boolean(resolveTavilyApiKey(env)),
  unavailableReason: () => 'TAVILY_API_KEY is not configured.',
  async search(request, env) {
    const apiKey = resolveTavilyApiKey(env)
    if (!apiKey) throw new Error('TAVILY_API_KEY is not configured.')

    const payload: Record<string, unknown> = {
      query: request.query,
      max_results: request.maxResults,
      search_depth: 'basic',
      include_answer: false,
      include_images: false,
      include_raw_content: false,
    }
    const timeRange = normalizeTavilyTimeRange(request.freshness)
    if (timeRange) payload.time_range = timeRange
    if (request.allowedDomains.length > 0) payload.include_domains = request.allowedDomains
    if (request.blockedDomains.length > 0) payload.exclude_domains = request.blockedDomains

    const body = await fetchJson<TavilySearchResponse>(new URL('https://api.tavily.com/search'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    return (body.results ?? [])
      .map((item) => ({
        title: cleanText(item.title) || item.url || 'Untitled result',
        url: item.url?.trim() ?? '',
        snippet: cleanText(item.content),
        source: domainFromUrl(item.url ?? ''),
        publishedAt: cleanText(item.published_date) || undefined,
      }))
      .filter((item) => Boolean(item.url))
  },
}

const duckDuckGoInstantProvider: WebSearchProvider = {
  id: 'duckduckgo-instant',
  name: 'DuckDuckGo Search',
  requiresCredential: false,
  isAvailable: () => typeof fetch === 'function',
  unavailableReason: () => 'global fetch is not available in this runtime.',
  async search(request) {
    try {
      const instantResults = await searchDuckDuckGoInstantAnswers(request)
      if (instantResults.length > 0) return instantResults
    } catch (error) {
      safeConsoleWarn('[AgentOS/WebSearch] DuckDuckGo Instant Answer fallback', {
        queryLength: request.query.length,
        error: summarizeErrorForLog(error),
      })
    }

    try {
      return await searchDuckDuckGoHtml(request)
    } catch (error) {
      safeConsoleWarn('[AgentOS/WebSearch] DuckDuckGo HTML fallback failed', {
        queryLength: request.query.length,
        error: summarizeErrorForLog(error),
      })
      return []
    }
  },
}

const WEB_SEARCH_PROVIDERS = [braveProvider, tavilyProvider, duckDuckGoInstantProvider] as const

export function normalizeWebSearchRequest(args: WebSearchToolArgs, defaultMaxResults = DEFAULT_MAX_RESULTS): WebSearchRequest {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('web_search requires a non-empty query.')

  return {
    query,
    maxResults: clampMaxResults(args.max_results ?? args.maxResults, defaultMaxResults),
    allowedDomains: normalizeDomainList(args.allowed_domains ?? args.allowedDomains),
    blockedDomains: normalizeDomainList(args.blocked_domains ?? args.blockedDomains),
    freshness: typeof args.freshness === 'string' ? args.freshness.trim() || undefined : undefined,
  }
}

export function resolveWebSearchProviderStatus(env: WebSearchEnv): WebSearchProviderStatus {
  const provider = selectWebSearchProvider(env)
  if (!provider) {
    const requested = requestedProviderId(env)
    return {
      id: requested || 'none',
      name: requested || 'No provider',
      available: false,
      reason: requested ? `Unknown web search provider: ${requested}.` : 'No web search provider is available.',
    }
  }
  const available = provider.isAvailable(env)
  return {
    id: provider.id,
    name: provider.name,
    available,
    reason: available ? undefined : provider.unavailableReason(env),
  }
}

export function summarizeWebSearchProviderError(error: unknown): WebSearchProviderErrorSummary {
  if (error instanceof WebSearchProviderError) {
    return {
      message: error.message,
      kind: error.kind,
      recoveryHint: error.recoveryHint,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/BRAVE_SEARCH_API_KEY|TAVILY_API_KEY/.test(message) && /not configured/i.test(message)) {
    return {
      message,
      kind: 'missing-credential',
      recoveryHint: 'Add an API key or a ${ENV_NAME} reference in Search settings.',
    }
  }
  if (/bot-detection challenge/i.test(message)) {
    return {
      message,
      kind: 'bot-challenge',
      recoveryHint: 'Switch to Brave Search or Tavily for an API-backed provider.',
    }
  }
  if (/aborted|timeout|fetch failed|network/i.test(message)) {
    return {
      message,
      kind: 'network',
      recoveryHint: 'Check network connectivity or try another provider.',
    }
  }
  return { message, kind: 'unknown' }
}

export function buildWebSearchConfigSignature(env: WebSearchEnv): string {
  return JSON.stringify({
    provider: requestedProviderId(env) || 'auto',
    hasBraveKey: Boolean(resolveBraveApiKey(env)),
    hasTavilyKey: Boolean(resolveTavilyApiKey(env)),
    version: 2,
  })
}

export async function searchWeb(request: WebSearchRequest, env: WebSearchEnv = process.env): Promise<WebSearchResponse> {
  const provider = selectWebSearchProvider(env)
  if (!provider) {
    const requested = requestedProviderId(env)
    throw new Error(requested ? `Unknown web search provider: ${requested}.` : 'No web search provider is available.')
  }
  if (!provider.isAvailable(env)) throw new Error(provider.unavailableReason(env))

  const startedAt = Date.now()
  safeConsoleInfo('[AgentOS/WebSearch] search enter', {
    provider: provider.id,
    queryLength: request.query.length,
    maxResults: request.maxResults,
    allowedDomainCount: request.allowedDomains.length,
    blockedDomainCount: request.blockedDomains.length,
  })

  try {
    const rawResults = await provider.search(request, env)
    const results = filterWebSearchResults(rawResults, request).slice(0, request.maxResults)
    safeConsoleInfo('[AgentOS/WebSearch] search success', {
      provider: provider.id,
      resultCount: results.length,
      ms: Date.now() - startedAt,
    })
    return {
      query: request.query,
      provider: { id: provider.id, name: provider.name },
      generatedAt: new Date().toISOString(),
      results,
    }
  } catch (error) {
    safeConsoleError('[AgentOS/WebSearch] search failed', {
      provider: provider.id,
      queryLength: request.query.length,
      error: summarizeErrorForLog(error),
    })
    throw error
  }
}

export function filterWebSearchResults(results: WebSearchResultItem[], request: Pick<WebSearchRequest, 'allowedDomains' | 'blockedDomains'>): WebSearchResultItem[] {
  return dedupeResults(results).filter((item) => {
    const domain = normalizeDomain(domainFromUrl(item.url))
    if (!domain) return false
    if (request.blockedDomains.some((blocked) => domainMatches(domain, blocked))) return false
    if (request.allowedDomains.length > 0 && !request.allowedDomains.some((allowed) => domainMatches(domain, allowed))) return false
    return true
  })
}

export function formatWebSearchToolOutput(response: WebSearchResponse): string {
  return JSON.stringify(
    {
      source: 'AgentOS web_search',
      provider: response.provider,
      query: response.query,
      generatedAt: response.generatedAt,
      results: response.results.map((item, index) => ({
        rank: index + 1,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        source: item.source,
        publishedAt: item.publishedAt,
      })),
    },
    null,
    2,
  )
}

function selectWebSearchProvider(env: WebSearchEnv): WebSearchProvider | undefined {
  const requested = requestedProviderId(env)
  if (requested) return WEB_SEARCH_PROVIDERS.find((provider) => provider.id === requested)
  return WEB_SEARCH_PROVIDERS.find((provider) => provider.isAvailable(env))
}

function requestedProviderId(env: WebSearchEnv): string {
  for (const name of PROVIDER_ENV_NAMES) {
    const value = env[name]?.trim().toLowerCase()
    if (value) return value
  }
  return ''
}

function resolveBraveApiKey(env: WebSearchEnv): string {
  return env.BRAVE_SEARCH_API_KEY?.trim() || env.BRAVE_API_KEY?.trim() || ''
}

function resolveTavilyApiKey(env: WebSearchEnv): string {
  return env.TAVILY_API_KEY?.trim() || ''
}

async function fetchJson<T>(url: URL, init: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw await createProviderHttpError(response, url)
    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(url: URL, init: RequestInit): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw await createProviderHttpError(response, url)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function createProviderHttpError(response: Response, url: URL): Promise<WebSearchProviderError> {
  const providerName = providerNameFromHostname(url.hostname)
  const bodyHint = sanitizeProviderErrorHint(await readProviderErrorText(response))
  const suffix = bodyHint ? ` Provider message: ${bodyHint}.` : ''

  if (response.status === 401 || response.status === 403) {
    return new WebSearchProviderError(
      `${providerName} authentication failed (HTTP ${response.status}).${suffix}`,
      {
        kind: 'auth',
        status: response.status,
        recoveryHint: `Check the ${providerName} API key or environment variable reference, then test the provider again.`,
      },
    )
  }

  if (response.status === 402 || response.status === 429 || response.status === 432) {
    return new WebSearchProviderError(
      `${providerName} quota or plan limit was reached (HTTP ${response.status}).${suffix}`,
      {
        kind: 'quota',
        status: response.status,
        recoveryHint: `Check ${providerName} usage limits or switch to another search provider.`,
      },
    )
  }

  if (response.status >= 500) {
    return new WebSearchProviderError(
      `${providerName} service is unavailable (HTTP ${response.status}).${suffix}`,
      {
        kind: 'service',
        status: response.status,
        recoveryHint: `Retry later or switch to another search provider.`,
      },
    )
  }

  return new WebSearchProviderError(
    `${providerName} request failed (HTTP ${response.status}).${suffix}`,
    {
      kind: 'unknown',
      status: response.status,
      recoveryHint: `Check the provider settings and try again.`,
    },
  )
}

async function readProviderErrorText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000)
  } catch {
    return ''
  }
}

function sanitizeProviderErrorHint(raw: string): string {
  const text = extractProviderErrorHint(raw).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (/(bearer|api[_ -]?key|token|authorization|tvly-|sk-[A-Za-z0-9_-]+)/i.test(text)) return ''
  return text.slice(0, 180)
}

function extractProviderErrorHint(raw: string): string {
  if (!raw.trim()) return ''
  try {
    const data = JSON.parse(raw) as unknown
    const found = findProviderErrorMessage(data)
    if (found) return found
  } catch {
    /* fall back to plain text */
  }
  return stripHtml(raw).slice(0, 240)
}

function findProviderErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProviderErrorMessage(item)
      if (found) return found
    }
    return ''
  }
  const record = value as Record<string, unknown>
  for (const key of ['message', 'error', 'error_description', 'detail']) {
    const found = findProviderErrorMessage(record[key])
    if (found) return found
  }
  return ''
}

function providerNameFromHostname(hostname: string): string {
  if (hostname.includes('tavily')) return 'Tavily'
  if (hostname.includes('brave')) return 'Brave Search'
  if (hostname.includes('duckduckgo')) return 'DuckDuckGo'
  return hostname
}

async function searchDuckDuckGoInstantAnswers(request: WebSearchRequest): Promise<WebSearchResultItem[]> {
  const url = new URL('https://api.duckduckgo.com/')
  url.searchParams.set('q', request.query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')

  const body = await fetchJson<DuckDuckGoInstantAnswer>(url, {
    headers: { Accept: 'application/json' },
  })
  const results: WebSearchResultItem[] = []

  if (body.AbstractURL) {
    results.push({
      title: cleanText(body.Heading) || request.query,
      url: body.AbstractURL,
      snippet: cleanText(body.AbstractText),
      source: domainFromUrl(body.AbstractURL),
    })
  }

  for (const topic of flattenDuckDuckGoTopics([...(body.Results ?? []), ...(body.RelatedTopics ?? [])])) {
    const url = topic.FirstURL?.trim() ?? ''
    if (!url) continue
    results.push({
      title: titleFromDuckDuckGoText(topic.Text) || domainFromUrl(url) || 'Untitled result',
      url,
      snippet: cleanText(topic.Text),
      source: domainFromUrl(url),
    })
  }

  return dedupeResults(results).slice(0, request.maxResults)
}

async function searchDuckDuckGoHtml(request: WebSearchRequest): Promise<WebSearchResultItem[]> {
  const cacheKey = JSON.stringify({
    query: request.query,
    maxResults: request.maxResults,
    allowedDomains: request.allowedDomains,
    blockedDomains: request.blockedDomains,
  })
  const cached = duckDuckGoHtmlCache.get(cacheKey)
  if (cached && Date.now() - cached.insertedAt < DUCKDUCKGO_HTML_CACHE_TTL_MS) {
    return cached.results
  }

  const url = new URL(DUCKDUCKGO_HTML_ENDPOINT)
  url.searchParams.set('q', request.query)
  url.searchParams.set('kp', DUCKDUCKGO_HTML_SAFE_SEARCH_MODERATE)

  const html = await fetchText(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': DUCKDUCKGO_HTML_USER_AGENT,
    },
  })
  if (isDuckDuckGoBotChallenge(html)) {
    throw new WebSearchProviderError(
      'DuckDuckGo returned a bot-detection challenge.',
      {
        kind: 'bot-challenge',
        recoveryHint: 'Switch to Brave Search or Tavily for API-backed web search.',
      },
    )
  }

  const results = parseDuckDuckGoHtml(html)
    .map((item) => ({
      title: cleanText(item.title) || domainFromUrl(item.url) || 'Untitled result',
      url: item.url,
      snippet: cleanText(item.snippet),
      source: domainFromUrl(item.url),
    }))
    .filter((item) => Boolean(item.url))
    .slice(0, request.maxResults)

  const deduped = dedupeResults(results)
  duckDuckGoHtmlCache.set(cacheKey, { insertedAt: Date.now(), results: deduped })
  return deduped
}

function normalizeBraveFreshness(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return ''
  if (['pd', 'pw', 'pm', 'py'].includes(normalized)) return normalized
  if (normalized === 'day') return 'pd'
  if (normalized === 'week') return 'pw'
  if (normalized === 'month') return 'pm'
  if (normalized === 'year') return 'py'
  return ''
}

function normalizeTavilyTimeRange(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'pd' || normalized === 'd' || normalized === 'day') return 'day'
  if (normalized === 'pw' || normalized === 'w' || normalized === 'week') return 'week'
  if (normalized === 'pm' || normalized === 'm' || normalized === 'month') return 'month'
  if (normalized === 'py' || normalized === 'y' || normalized === 'year') return 'year'
  return ''
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[], output: DuckDuckGoTopic[] = []): DuckDuckGoTopic[] {
  for (const topic of topics) {
    if (topic.Topics) {
      flattenDuckDuckGoTopics(topic.Topics, output)
      continue
    }
    output.push(topic)
  }
  return output
}

function titleFromDuckDuckGoText(value: string | undefined): string {
  const text = cleanText(value)
  if (!text) return ''
  return text.split(' - ')[0]?.trim() || text.slice(0, 80)
}

function parseDuckDuckGoHtml(html: string): DuckDuckGoHtmlResult[] {
  const results: DuckDuckGoHtmlResult[] = []
  const resultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi
  const nextResultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")[^>]*>/i
  const snippetRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*")[^>]*>([\s\S]*?)<\/a>/i

  for (const match of html.matchAll(resultRegex)) {
    const rawAttributes = match[1] ?? ''
    const rawTitle = match[2] ?? ''
    const rawUrl = readHrefAttribute(rawAttributes)
    const matchEnd = (match.index ?? 0) + match[0].length
    const trailingHtml = html.slice(matchEnd)
    const nextResultIndex = trailingHtml.search(nextResultRegex)
    const scopedTrailingHtml = nextResultIndex >= 0 ? trailingHtml.slice(0, nextResultIndex) : trailingHtml
    const rawSnippet = snippetRegex.exec(scopedTrailingHtml)?.[1] ?? ''
    const title = decodeHtmlEntities(stripHtml(rawTitle))
    const url = decodeDuckDuckGoUrl(decodeHtmlEntities(rawUrl))
    const snippet = decodeHtmlEntities(stripHtml(rawSnippet))

    if (title && url) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

function readHrefAttribute(tagAttributes: string): string {
  return /\bhref="([^"]*)"/i.exec(tagAttributes)?.[1] ?? ''
}

function decodeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    const parsed = new URL(normalized)
    const redirectTarget = parsed.searchParams.get('uddg')
    return redirectTarget || normalized
  } catch {
    return rawUrl
  }
}

function isDuckDuckGoBotChallenge(html: string): boolean {
  if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) return false
  return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(html)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '--')
    .replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, (_match, code: string) => decodeHtmlCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeHtmlCodePoint(Number.parseInt(code, 16)))
}

function decodeHtmlCodePoint(codePoint: number): string {
  try {
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
  } catch {
    return ''
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function clampMaxResults(value: number | undefined, fallback = DEFAULT_MAX_RESULTS): number {
  if (!Number.isFinite(value)) return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.floor(Number(fallback))))
  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.floor(Number(value))))
}

function normalizeDomainList(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values ?? []) {
    const domain = normalizeDomain(value)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    output.push(domain)
  }
  return output
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    const host = trimmed.includes('://') ? new URL(trimmed).hostname : trimmed.split('/')[0]
    return host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function domainFromUrl(value: string): string {
  try {
    return normalizeDomain(new URL(value).hostname)
  } catch {
    return ''
  }
}

function domainMatches(domain: string, rule: string): boolean {
  return domain === rule || domain.endsWith(`.${rule}`)
}

function dedupeResults(results: WebSearchResultItem[]): WebSearchResultItem[] {
  const output: WebSearchResultItem[] = []
  const seen = new Set<string>()
  for (const item of results) {
    const url = item.url.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    output.push({
      ...item,
      title: cleanText(item.title) || url,
      url,
      snippet: cleanText(item.snippet),
      source: cleanText(item.source),
    })
  }
  return output
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim()
}
