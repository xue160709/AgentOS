import { buildTaskReceipt, parseTaskEnvelope, type AgentOSDeepLink, type TaskEnvelope, type TaskRejectionCode } from './agentos-deep-link'
import { AgentOSTicketClient } from './agentos-ticket-client'
import { ExternalTaskReceiptStore, type ExternalTaskReceiptRecord } from './external-task-receipt-store'
import type { WebsiteBindingStore } from './website-binding-store'
import type { ProjectChatBroker } from './project-chat-broker'

type TaskBroker = Pick<ProjectChatBroker, 'createThread' | 'submitRun'>
type Outcome = { status: 'accepted' } | { status: 'rejected'; code: TaskRejectionCode }

/**
 * The external-task linearization owner. Its keyed in-memory gate complements the
 * durable receipt so a same-process replay can never create a second thread.
 */
export class AgentOSExternalTaskService {
  private readonly active = new Map<string, Promise<Outcome>>()
  private readonly idempotencyActive = new Map<string, Promise<Outcome>>()
  constructor(private readonly options: {
    bindings: WebsiteBindingStore; receipts: ExternalTaskReceiptStore; tickets: AgentOSTicketClient; broker: TaskBroker; now?: () => number
    /** Captured before this task creates its own Run, so UI focus cannot be biased by it. */
    beforeCreate?(input: { projectId: string }): Promise<unknown> | unknown
    accepted?(input: { projectId: string; threadId: string; receivedAt: number; before: unknown }): Promise<void> | void
  }) {}

  handle(link: AgentOSDeepLink): Promise<Outcome> {
    if (link.action !== 'task') return Promise.resolve({ status: 'rejected', code: 'invalid-deep-link' })
    const key = `${link.origin}\n${link.requestId}`
    const current = this.active.get(key)
    if (current) return current
    const operation = this.consume(link).finally(() => this.active.delete(key))
    this.active.set(key, operation)
    return operation
  }

  private async consume(link: AgentOSDeepLink): Promise<Outcome> {
    const binding = await this.options.bindings.findActiveByOrigin(link.origin)
    if (!binding) return { status: 'rejected', code: 'binding-not-found' }
    const credential = await this.options.bindings.credentialFor(binding.bindingId)
    if (!credential.ok) return { status: 'rejected', code: credential.error.code === 'binding-revoked' ? 'binding-revoked' : 'binding-not-found' }
    const fetched = await this.options.tickets.getTask({ origin: link.origin, requestId: link.requestId, bindingId: binding.bindingId, credential: credential.value })
    if (!fetched.ok) return { status: 'rejected', code: ticketCode(fetched.error.code) }
    const envelope = parseTaskEnvelope(fetched.value, { requestId: link.requestId, origin: link.origin, bindingId: binding.bindingId, bindingOrigin: binding.origin, now: this.options.now })
    if (!envelope.ok) return { status: 'rejected', code: envelope.error.code === 'ticket-expired' ? 'ticket-expired' : 'ticket-invalid' }
    const idempotencyGate = `${binding.bindingId}\n${envelope.value.idempotencyKey}`
    const running = this.idempotencyActive.get(idempotencyGate)
    if (running) return running
    const operation = this.consumeValidated(link, binding, credential.value, envelope.value).finally(() => this.idempotencyActive.delete(idempotencyGate))
    this.idempotencyActive.set(idempotencyGate, operation)
    return operation
  }

  private async consumeValidated(link: AgentOSDeepLink, binding: { bindingId: string; origin: string; projectId: string }, credential: string, envelope: TaskEnvelope): Promise<Outcome> {
    const before = await this.options.beforeCreate?.({ projectId: binding.projectId })
    const payloadHash = ExternalTaskReceiptStore.payloadHash(envelope.title, envelope.task)
    const existing = await this.options.receipts.lookup(binding.bindingId, envelope.idempotencyKey, payloadHash)
    if (existing.kind === 'idempotency-conflict') return this.reply(link, binding.bindingId, credential, envelope, { status: 'rejected', code: 'idempotency-conflict' })
    if (existing.kind === 'match' && terminal(existing.record)) return this.reply(link, binding.bindingId, credential, envelope, recordOutcome(existing.record))
    const begun = existing.kind === 'match' ? existing : await this.options.receipts.begin({ bindingId: binding.bindingId, requestId: link.requestId, idempotencyKey: envelope.idempotencyKey, title: envelope.title, task: envelope.task })
    if (begun.kind === 'idempotency-conflict') return this.reply(link, binding.bindingId, credential, envelope, { status: 'rejected', code: 'idempotency-conflict' })
    await this.options.receipts.transition({ bindingId: binding.bindingId, idempotencyKey: envelope.idempotencyKey, state: 'validated' }).catch(() => undefined)
    const created = await this.options.broker.createThread({ projectId: binding.projectId, title: envelope.title, source: 'website', idempotencyKey: envelope.idempotencyKey, bindingId: binding.bindingId, receivedAt: (this.options.now ?? Date.now)() })
    if (!created.ok) return this.reject(link, binding.bindingId, credential, envelope, brokerCode(created.error.code))
    await this.options.receipts.transition({ bindingId: binding.bindingId, idempotencyKey: envelope.idempotencyKey, state: 'thread-created', threadId: created.value.threadId })
    await this.options.receipts.transition({ bindingId: binding.bindingId, idempotencyKey: envelope.idempotencyKey, state: 'submitting' })
    const submitted = await this.options.broker.submitRun({ projectId: binding.projectId, threadId: created.value.threadId, text: envelope.task })
    if (!submitted.ok) return this.reject(link, binding.bindingId, credential, envelope, brokerCode(submitted.error.code))
    await this.options.receipts.transition({ bindingId: binding.bindingId, idempotencyKey: envelope.idempotencyKey, state: 'accepted', requestIdLocal: submitted.value.requestId })
    await this.options.accepted?.({ projectId: binding.projectId, threadId: created.value.threadId, receivedAt: (this.options.now ?? Date.now)(), before })
    return this.reply(link, binding.bindingId, credential, envelope, { status: 'accepted' })
  }

  private async reject(link: AgentOSDeepLink, bindingId: string, credential: string, envelope: Parameters<typeof buildTaskReceipt>[0], code: TaskRejectionCode): Promise<Outcome> {
    await this.options.receipts.transition({ bindingId, idempotencyKey: envelope.idempotencyKey, state: 'rejected', rejectionCode: code }).catch(() => undefined)
    return this.reply(link, bindingId, credential, envelope, { status: 'rejected', code })
  }
  private async reply(link: AgentOSDeepLink, bindingId: string, credential: string, envelope: Parameters<typeof buildTaskReceipt>[0], outcome: Outcome): Promise<Outcome> {
    const receipt = buildTaskReceipt(envelope, outcome)
    // Receipt delivery is intentionally best effort: a failed POST never cancels a run.
    await this.options.tickets.postTaskReceipt({ origin: link.origin, requestId: link.requestId, bindingId, credential, receipt }).catch(() => undefined)
    return outcome
  }
}

function terminal(record: ExternalTaskReceiptRecord): boolean { return record.state === 'accepted' || record.state === 'rejected' }
function recordOutcome(record: ExternalTaskReceiptRecord): Outcome { return record.state === 'accepted' ? { status: 'accepted' } : { status: 'rejected', code: (record.rejectionCode as TaskRejectionCode | undefined) ?? 'internal-error' } }
function ticketCode(code: string): TaskRejectionCode { return code === 'credential-rejected' ? 'credential-rejected' : code === 'ticket-consumed' ? 'ticket-consumed' : 'ticket-fetch-failed' }
function brokerCode(code: string): TaskRejectionCode { return code === 'project-not-found' ? code : code === 'project-path-missing' ? code : code === 'sdk-submit-failed' ? code : 'internal-error' }
