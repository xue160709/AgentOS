import { AGENTOS_MAX_JSON_BODY_BYTES, normalizeAgentOSOrigin, parseAgentOSJsonBody, type PairReceipt } from './agentos-deep-link'
import type { ProjectChatErrorCode } from '../src/project-chat-contract'

export type AgentOSTicketTransportResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string }
export type AgentOSTicketTransport = (input: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string; connectTimeoutMs: number; totalTimeoutMs: number; maxBodyBytes: number; redirect: 'error'; credentials: 'omit' }) => Promise<AgentOSTicketTransportResponse>
export type AgentOSTicketResult<T> = { ok: true; value: T } | { ok: false; error: { code: Extract<ProjectChatErrorCode, 'credential-rejected' | 'ticket-invalid' | 'ticket-consumed' | 'ticket-fetch-failed' | 'receipt-failed'>; retryable: boolean } }

const MAX_BODY = AGENTOS_MAX_JSON_BODY_BYTES
const CONNECT_TIMEOUT_MS = 5_000
const TOTAL_TIMEOUT_MS = 10_000

type DeadlineRequest = { once(event: 'error' | 'redirect', listener: () => void): void; once(event: 'response', listener: (response: DeadlineResponse) => void): void; abort(): void; end(body?: string): void }
type DeadlineResponse = { statusCode: number; headers: Record<string, string | string[] | undefined>; on(event: 'data', listener: (chunk: Buffer) => void): void; once(event: 'error' | 'end', listener: () => void): void }

/**
 * Applies the frozen v1 deadlines around an injected Main request factory. Keeping
 * this independent from Electron makes its abort/cleanup behavior fixture-testable.
 */
export function createDeadlineBoundAgentOSTicketTransport(
  createRequest: (input: Parameters<AgentOSTicketTransport>[0]) => DeadlineRequest,
  options: { timeoutScale?: number } = {},
): AgentOSTicketTransport {
  const scale = options.timeoutScale ?? 1
  return (input) => new Promise((resolve, reject) => {
    const request = createRequest(input); let settled = false
    const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(firstResponseTimer); clearTimeout(totalTimer); callback() }
    const firstResponseTimer = setTimeout(() => { request.abort(); finish(() => reject(new Error('agentos-first-response-deadline'))) }, Math.max(1, Math.ceil(input.connectTimeoutMs * scale)))
    const totalTimer = setTimeout(() => { request.abort(); finish(() => reject(new Error('agentos-total-deadline'))) }, Math.max(1, Math.ceil(input.totalTimeoutMs * scale)))
    request.once('error', () => finish(() => reject(new Error('agentos-network-error'))))
    request.once('redirect', () => { request.abort(); finish(() => reject(new Error('agentos-redirect'))) })
    request.once('response', (response) => {
      clearTimeout(firstResponseTimer)
      const chunks: Buffer[] = []; let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > input.maxBodyBytes) { request.abort(); finish(() => reject(new Error('agentos-body-too-large'))) }
        else chunks.push(chunk)
      })
      response.once('error', () => finish(() => reject(new Error('agentos-response-error'))))
      response.once('end', () => finish(() => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') })))
    })
    request.end(input.body)
  })
}

/** Fixed-origin Main-only ticket client. It deliberately never accepts a website URL. */
export class AgentOSTicketClient {
  constructor(private readonly transport: AgentOSTicketTransport) {}

  async getTask(input: { origin: string; requestId: string; bindingId: string; credential: string }): Promise<AgentOSTicketResult<Record<string, unknown>>> {
    return this.requestJson('GET', input, undefined)
  }

  /** Pairing never carries a credential on its initial fixed-endpoint GET. */
  async getPair(input: { origin: string; requestId: string }): Promise<AgentOSTicketResult<Record<string, unknown>>> {
    return this.requestPairJson('GET', input)
  }

  async postPairReceipt(input: { origin: string; requestId: string; receipt: PairReceipt }): Promise<AgentOSTicketResult<void>> {
    const response = await this.requestPair('POST', input, JSON.stringify(input.receipt))
    if (!response.ok) return response
    return response.value.status >= 200 && response.value.status <= 299 && response.value.body.length <= MAX_BODY ? { ok: true, value: undefined } : this.statusError(response.value.status, true)
  }

  async postTaskReceipt(input: { origin: string; requestId: string; bindingId: string; credential: string; receipt: Record<string, unknown> }): Promise<AgentOSTicketResult<void>> {
    const response = await this.request('POST', input, JSON.stringify(input.receipt))
    if (!response.ok) return response
    if (response.value.status < 200 || response.value.status > 299) return this.statusError(response.value.status, true)
    if (response.value.body.length > MAX_BODY) return failure('receipt-failed', true)
    return { ok: true, value: undefined }
  }

  private async requestJson(method: 'GET', input: { origin: string; requestId: string; bindingId: string; credential: string }, body: undefined): Promise<AgentOSTicketResult<Record<string, unknown>>> {
    const response = await this.request(method, input, body)
    if (!response.ok) return response
    if (response.value.status < 200 || response.value.status > 299) return this.statusError(response.value.status, false)
    if (!isJson(response.value.headers)) return failure('ticket-invalid', false)
    const parsed = parseAgentOSJsonBody(response.value.body)
    return parsed.ok ? { ok: true, value: parsed.value } : failure('ticket-invalid', false)
  }

  private async requestPairJson(method: 'GET', input: { origin: string; requestId: string }): Promise<AgentOSTicketResult<Record<string, unknown>>> {
    const response = await this.requestPair(method, input)
    if (!response.ok) return response
    if (response.value.status < 200 || response.value.status > 299 || !isJson(response.value.headers)) return this.statusError(response.value.status, false)
    const parsed = parseAgentOSJsonBody(response.value.body)
    return parsed.ok ? { ok: true, value: parsed.value } : failure('ticket-invalid', false)
  }

  private async requestPair(method: 'GET' | 'POST', input: { origin: string; requestId: string }, body?: string): Promise<AgentOSTicketResult<AgentOSTicketTransportResponse>> {
    const origin = normalizeAgentOSOrigin(input.origin)
    if (!origin.ok || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) return failure('ticket-invalid', false)
    const headers: Record<string, string> = { Accept: 'application/json', 'AgentOS-Protocol-Version': '1', 'Cache-Control': 'no-store', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }
    try {
      const response = await this.transport({ method, url: `${origin.value}/.well-known/agentos/v1/pair/${encodeURIComponent(input.requestId)}`, headers, body, connectTimeoutMs: CONNECT_TIMEOUT_MS, totalTimeoutMs: TOTAL_TIMEOUT_MS, maxBodyBytes: MAX_BODY, redirect: 'error', credentials: 'omit' })
      if (response.body.length > MAX_BODY) return failure(method === 'POST' ? 'receipt-failed' : 'ticket-invalid', method === 'POST')
      return { ok: true, value: response }
    } catch { return failure(method === 'POST' ? 'receipt-failed' : 'ticket-fetch-failed', true) }
  }

  private async request(method: 'GET' | 'POST', input: { origin: string; requestId: string; bindingId: string; credential: string }, body?: string): Promise<AgentOSTicketResult<AgentOSTicketTransportResponse>> {
    const origin = normalizeAgentOSOrigin(input.origin)
    if (!origin.ok || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) return failure('ticket-invalid', false)
    const url = `${origin.value}/.well-known/agentos/v1/task/${encodeURIComponent(input.requestId)}`
    const headers: Record<string, string> = {
      Accept: 'application/json', Authorization: `Bearer ${input.credential}`, 'AgentOS-Binding-Id': input.bindingId,
      'AgentOS-Protocol-Version': '1', 'Cache-Control': 'no-store',
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    }
    try {
      const response = await this.transport({ method, url, headers, body, connectTimeoutMs: CONNECT_TIMEOUT_MS, totalTimeoutMs: TOTAL_TIMEOUT_MS, maxBodyBytes: MAX_BODY, redirect: 'error', credentials: 'omit' })
      if (response.body.length > MAX_BODY) return failure(method === 'POST' ? 'receipt-failed' : 'ticket-invalid', method === 'POST')
      return { ok: true, value: response }
    } catch {
      return failure(method === 'POST' ? 'receipt-failed' : 'ticket-fetch-failed', true)
    }
  }

  private statusError(status: number, receipt: boolean): AgentOSTicketResult<never> {
    if (status === 401 || status === 403) return failure('credential-rejected', false)
    if (status === 404 || status === 410) return failure('ticket-consumed', false)
    if (status >= 300 && status <= 399) return failure(receipt ? 'receipt-failed' : 'ticket-fetch-failed', true)
    if (status === 408 || status === 425 || status === 429 || status >= 500) return failure(receipt ? 'receipt-failed' : 'ticket-fetch-failed', true)
    return failure(receipt ? 'receipt-failed' : 'ticket-invalid', false)
  }
}

function isJson(headers: AgentOSTicketTransportResponse['headers']): boolean {
  const raw = headers['content-type'] ?? headers['Content-Type']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(value)
}
function failure(code: Extract<ProjectChatErrorCode, 'credential-rejected' | 'ticket-invalid' | 'ticket-consumed' | 'ticket-fetch-failed' | 'receipt-failed'>, retryable: boolean): AgentOSTicketResult<never> { return { ok: false, error: { code, retryable } } }
