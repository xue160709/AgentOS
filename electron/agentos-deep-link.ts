import type { ProjectChatErrorCode } from '../src/project-chat-contract'

export const AGENTOS_MAX_DEEP_LINK_BYTES = 2_048
export const AGENTOS_MAX_JSON_BODY_BYTES = 65_536
export const AGENTOS_CLOCK_SKEW_MS = 30_000
export const AGENTOS_MAX_TTL_MS = 300_000

const REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/
const BINDING_ID = /^bnd_[A-Za-z0-9_-]{16,128}$/
const BASE64_URL = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_TASK_FIELDS = new Set([
  'projectId', 'projectPath', 'threadId', 'sessionId', 'permissionMode',
  'attachments', 'attachment', 'localFileUrl', 'local_file_url',
  'receiptUrl', 'receipt_url', 'callback', 'callbackUrl', 'finalResultCallback',
])

export type AgentOSDeepLinkAction = 'pair' | 'task'
export type AgentOSDeepLink = {
  action: AgentOSDeepLinkAction
  origin: string
  requestId: string
}

export type AgentOSProtocolError = {
  code: Extract<ProjectChatErrorCode, 'invalid-deep-link' | 'unsupported-version' | 'ticket-invalid' | 'ticket-expired'>
  message: string
}

export type AgentOSProtocolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentOSProtocolError }

export type PairEnvelope = {
  version: 1
  kind: 'pair'
  requestId: string
  origin: string
  displayName: string
  issuedAt: number
  expiresAt: number
  nonce: string
}

export type TaskEnvelope = {
  version: 1
  kind: 'task'
  requestId: string
  origin: string
  bindingId: string
  issuedAt: number
  expiresAt: number
  idempotencyKey: string
  title: string
  task: string
}

export type PairReceipt =
  | { version: 1; kind: 'pair_receipt'; request_id: string; nonce: string; status: 'accepted'; binding_id: string; credential: string }
  | { version: 1; kind: 'pair_receipt'; request_id: string; nonce: string; status: 'accepted'; binding_id: string; already_bound: true }
  | { version: 1; kind: 'pair_receipt'; request_id: string; nonce: string; status: 'rejected'; code: PairRejectionCode }
export type TaskReceipt =
  | { version: 1; kind: 'task_receipt'; request_id: string; idempotency_key: string; status: 'accepted' }
  | { version: 1; kind: 'task_receipt'; request_id: string; idempotency_key: string; status: 'rejected'; code: TaskRejectionCode }
export type PairRejectionCode = 'user-rejected' | 'invalid-envelope' | 'expired' | 'origin-mismatch' | 'project-not-found' | 'project-path-missing' | 'binding-conflict' | 'credential-storage-unavailable' | 'internal-error'
export type TaskRejectionCode = 'invalid-deep-link' | 'binding-not-found' | 'binding-revoked' | 'credential-rejected' | 'ticket-fetch-failed' | 'ticket-invalid' | 'ticket-expired' | 'ticket-consumed' | 'idempotency-conflict' | 'project-not-found' | 'project-path-missing' | 'sdk-submit-failed' | 'internal-error'

export type PairEnvelopeContext = { requestId: string; origin: string; now?: () => number }
export type TaskEnvelopeContext = { requestId: string; origin: string; bindingId: string; bindingOrigin: string; now?: () => number }

/** Parses the only two accepted agentos:// v1 URLs using the platform URL parser. */
export function parseAgentOSDeepLink(raw: unknown): AgentOSProtocolResult<AgentOSDeepLink> {
  if (typeof raw !== 'string' || utf8Bytes(raw) > AGENTOS_MAX_DEEP_LINK_BYTES) return invalidDeepLink('Deep link is invalid')
  let url: URL
  try { url = new URL(raw) } catch { return invalidDeepLink('Deep link is invalid') }
  if (url.protocol !== 'agentos:' || url.username || url.password || url.port || url.hash) {
    return invalidDeepLink('Deep link is invalid')
  }
  if (url.hostname !== 'v1') return unsupportedVersion('Deep link version is unsupported')
  const action = url.pathname === '/pair' ? 'pair' : url.pathname === '/task' ? 'task' : null
  if (!action) return invalidDeepLink('Deep link action is invalid')
  const parameters = [...url.searchParams]
  if (parameters.length !== 2 || new Set(parameters.map(([key]) => key)).size !== 2 ||
    !parameters.some(([key]) => key === 'origin') || !parameters.some(([key]) => key === 'request_id')) {
    return invalidDeepLink('Deep link query is invalid')
  }
  const origin = normalizeAgentOSOrigin(url.searchParams.get('origin'))
  const requestId = url.searchParams.get('request_id')
  if (!origin.ok) return origin
  if (!requestId || !REQUEST_ID.test(requestId)) return invalidDeepLink('Deep link request id is invalid')
  return { ok: true, value: { action, origin: origin.value, requestId } }
}

/** Canonical HTTPS origin used as the sole binding identity. */
export function normalizeAgentOSOrigin(raw: unknown): AgentOSProtocolResult<string> {
  if (typeof raw !== 'string' || !raw) return invalidDeepLink('Origin is invalid')
  let url: URL
  try { url = new URL(raw) } catch { return invalidDeepLink('Origin is invalid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname) {
    return invalidDeepLink('Origin is invalid')
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname.endsWith('.') || !isValidOriginHostname(hostname)) return invalidDeepLink('Origin is invalid')
  return { ok: true, value: `${url.protocol}//${url.host}` }
}

/** Rejects oversized or non-object JSON before envelope validation. */
export function parseAgentOSJsonBody(body: unknown): AgentOSProtocolResult<Record<string, unknown>> {
  if (typeof body !== 'string' || utf8Bytes(body) > AGENTOS_MAX_JSON_BODY_BYTES) return ticketInvalid('Envelope body is invalid')
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? { ok: true, value: parsed } : ticketInvalid('Envelope body is invalid')
  } catch {
    return ticketInvalid('Envelope body is invalid')
  }
}

export function parsePairEnvelope(raw: unknown, context: PairEnvelopeContext): AgentOSProtocolResult<PairEnvelope> {
  if (!isRecord(raw)) return ticketInvalid('Pair envelope is invalid')
  if (raw.version !== 1) return unsupportedVersion('Envelope version is unsupported')
  if (raw.kind !== 'pair') return ticketInvalid('Pair envelope is invalid')
  const requestId = stringField(raw, 'request_id')
  const origin = normalizeAgentOSOrigin(raw.origin)
  const displayName = trimmedString(raw.display_name, 1, 120)
  const nonce = stringField(raw, 'nonce')
  const time = parseEnvelopeTime(raw, context.now)
  if (!requestId || !origin.ok || !displayName || !nonce || !BASE64_URL.test(nonce) || nonce.length < 16 || nonce.length > 128 || !time.ok) {
    return !time.ok ? time : ticketInvalid('Pair envelope is invalid')
  }
  if (requestId !== context.requestId || origin.value !== context.origin) return ticketInvalid('Pair envelope does not match deep link')
  return { ok: true, value: { version: 1, kind: 'pair', requestId, origin: origin.value, displayName, nonce, ...time.value } }
}

export function parseTaskEnvelope(raw: unknown, context: TaskEnvelopeContext): AgentOSProtocolResult<TaskEnvelope> {
  if (!isRecord(raw)) return ticketInvalid('Task envelope is invalid')
  if (raw.version !== 1) return unsupportedVersion('Envelope version is unsupported')
  if (raw.kind !== 'task' || [...FORBIDDEN_TASK_FIELDS].some((key) => Object.prototype.hasOwnProperty.call(raw, key))) {
    return ticketInvalid('Task envelope is invalid')
  }
  const requestId = stringField(raw, 'request_id')
  const origin = normalizeAgentOSOrigin(raw.origin)
  const bindingId = stringField(raw, 'binding_id')
  const idempotencyKey = stringField(raw, 'idempotency_key')
  const title = trimmedString(raw.title, 1, 120)
  const task = trimmedString(raw.task, 1, 20_000)
  const time = parseEnvelopeTime(raw, context.now)
  if (!requestId || !origin.ok || !bindingId || !BINDING_ID.test(bindingId) || !idempotencyKey || !REQUEST_ID.test(idempotencyKey) || !title || !task || !time.ok) {
    return !time.ok ? time : ticketInvalid('Task envelope is invalid')
  }
  if (requestId !== context.requestId || origin.value !== context.origin || origin.value !== context.bindingOrigin || bindingId !== context.bindingId) {
    return ticketInvalid('Task envelope does not match binding')
  }
  return { ok: true, value: { version: 1, kind: 'task', requestId, origin: origin.value, bindingId, idempotencyKey, title, task, ...time.value } }
}

export function buildPairReceipt(envelope: PairEnvelope, input: { status: 'accepted'; bindingId: string; credential: string } | { status: 'accepted'; bindingId: string; alreadyBound: true } | { status: 'rejected'; code: PairRejectionCode }): AgentOSProtocolResult<PairReceipt> {
  if (input.status === 'accepted') {
    if (!BINDING_ID.test(input.bindingId)) return ticketInvalid('Pair receipt is invalid')
    if ('alreadyBound' in input) return { ok: true, value: { version: 1, kind: 'pair_receipt', request_id: envelope.requestId, nonce: envelope.nonce, status: 'accepted', binding_id: input.bindingId, already_bound: true } }
    if (!isCredential(input.credential)) return ticketInvalid('Pair receipt is invalid')
    return { ok: true, value: { version: 1, kind: 'pair_receipt', request_id: envelope.requestId, nonce: envelope.nonce, status: 'accepted', binding_id: input.bindingId, credential: input.credential } }
  }
  return { ok: true, value: { version: 1, kind: 'pair_receipt', request_id: envelope.requestId, nonce: envelope.nonce, status: 'rejected', code: input.code } }
}

export function buildTaskReceipt(envelope: TaskEnvelope, input: { status: 'accepted' } | { status: 'rejected'; code: TaskRejectionCode }): TaskReceipt {
  return input.status === 'accepted'
    ? { version: 1, kind: 'task_receipt', request_id: envelope.requestId, idempotency_key: envelope.idempotencyKey, status: 'accepted' }
    : { version: 1, kind: 'task_receipt', request_id: envelope.requestId, idempotency_key: envelope.idempotencyKey, status: 'rejected', code: input.code }
}

/** Pure bounded cold/warm queue. The lifecycle owner decides when to route values. */
export class AgentOSDeepLinkQueue {
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly maxAgeMs: number
  private readonly entries: Array<{ link: AgentOSDeepLink; receivedAt: number }> = []

  constructor(options: { now?: () => number; maxEntries?: number; maxAgeMs?: number } = {}) {
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? 32
    this.maxAgeMs = options.maxAgeMs ?? 5 * 60_000
  }

  enqueue(link: AgentOSDeepLink): boolean {
    this.removeExpired()
    if (this.entries.some(({ link: current }) => sameLink(current, link))) return false
    while (this.entries.length >= this.maxEntries) this.entries.shift()
    this.entries.push({ link, receivedAt: this.now() })
    return true
  }

  drain(): AgentOSDeepLink[] {
    this.removeExpired()
    return this.entries.splice(0).map(({ link }) => link)
  }

  get size(): number { this.removeExpired(); return this.entries.length }

  private removeExpired(): void {
    const earliest = this.now() - this.maxAgeMs
    while (this.entries[0] && this.entries[0].receivedAt < earliest) this.entries.shift()
  }
}

function parseEnvelopeTime(raw: Record<string, unknown>, nowProvider: (() => number) | undefined): AgentOSProtocolResult<{ issuedAt: number; expiresAt: number }> {
  const issuedAt = raw.issued_at
  const expiresAt = raw.expires_at
  if (!isSafeInteger(issuedAt) || !isSafeInteger(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > AGENTOS_MAX_TTL_MS) return ticketInvalid('Envelope time is invalid')
  const now = (nowProvider ?? Date.now)()
  if (issuedAt > now + AGENTOS_CLOCK_SKEW_MS || expiresAt < now - AGENTOS_CLOCK_SKEW_MS) return expired('Envelope is expired')
  return { ok: true, value: { issuedAt, expiresAt } }
}

function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength }
function stringField(value: Record<string, unknown>, field: string): string | null { return typeof value[field] === 'string' ? value[field] : null }
function trimmedString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null
}
function sameLink(left: AgentOSDeepLink, right: AgentOSDeepLink): boolean { return left.action === right.action && left.origin === right.origin && left.requestId === right.requestId }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isSafeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) }
function isValidOriginHostname(hostname: string): boolean {
  if (hostname === 'localhost' || /^\[[0-9a-f:.]+\]$/i.test(hostname) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return true
  if (hostname.length > 253) return false
  return hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}
function isCredential(value: string): boolean { return BASE64_URL.test(value) && value.length >= 43 && Math.floor(value.length * 3 / 4) >= 32 }
function invalidDeepLink(message: string): AgentOSProtocolResult<never> { return { ok: false, error: { code: 'invalid-deep-link', message } } }
function unsupportedVersion(message: string): AgentOSProtocolResult<never> { return { ok: false, error: { code: 'unsupported-version', message } } }
function ticketInvalid(message: string): AgentOSProtocolResult<never> { return { ok: false, error: { code: 'ticket-invalid', message } } }
function expired(message: string): AgentOSProtocolResult<never> { return { ok: false, error: { code: 'ticket-expired', message } } }
