import { buildTaskReceipt, parseTaskEnvelope, type AgentOSDeepLink, type TaskEnvelope, type TaskRejectionCode } from './agentos-deep-link'
import { AgentOSTicketClient } from './agentos-ticket-client'
import { ExternalTaskReceiptStore, type ExternalTaskReceiptRecord } from './external-task-receipt-store'
import type { WebsiteBindingStore } from './website-binding-store'
import type { ProjectChatInternalEvent, ProjectChatInternalSnapshot } from '../src/project-chat-contract'
import type { ProjectChatBroker } from './project-chat-broker'

type TaskBroker = Pick<ProjectChatBroker, 'createThread' | 'submitRun'> & Partial<Pick<ProjectChatBroker, 'getSnapshot'>>
type Execution = { link: AgentOSDeepLink; bindingId: string; credential: string; envelope: TaskEnvelope; projectId: string; threadId: string; requestId: string; lastStatus?: string; delivery: Promise<void> }
type Outcome = { status: 'accepted' } | { status: 'rejected'; code: TaskRejectionCode }

/**
 * The external-task linearization owner. Its keyed in-memory gate complements the
 * durable receipt so a same-process replay can never create a second thread.
 */
export class AgentOSExternalTaskService {
  private disposed = false
  private readonly retryWaits = new Map<ReturnType<typeof setTimeout>, () => void>()

  dispose(): void {
    this.disposed = true
    for (const [timer, resolve] of this.retryWaits) { clearTimeout(timer); resolve() }
    this.retryWaits.clear()
    this.executions.clear()
  }

  private waitForRetry(ms: number): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.retryWaits.delete(timer); resolve() }, ms)
      timer.unref?.()
      this.retryWaits.set(timer, resolve)
    })
  }

  private readonly executions = new Map<string, Execution>()

  /** Main-only broker snapshots: callbacks stay on the paired origin's fixed endpoint. */
  observe(event: ProjectChatInternalEvent): void {
    if (this.disposed) return
    for (const execution of this.executions.values()) {
      if (execution.projectId === event.projectId) this.observeExecution(execution, event.snapshot)
    }
  }

  private observeExecution(execution: Execution, snapshot: ProjectChatInternalSnapshot): void {
    const run = snapshot.runs.find((run) => run.requestId === execution.requestId)
    if (!run) return
    const status = run.phase === 'succeeded' ? 'completed' : run.phase === 'failed' || run.phase === 'cancelled' ? 'failed' : 'running'
    if (execution.lastStatus === run.phase) return
    execution.lastStatus = run.phase
    // A transcript message may accumulate commentary and intermediate tool payloads.
    // Only the SDK terminal answer is a website-facing result; progress carries no transcript text.
    const summary = (run.error?.message ?? (status === 'completed' ? run.finalResult ?? '' : '')).slice(0, 12_000)
    const receipt = { version: 1, kind: 'task_receipt', request_id: execution.envelope.requestId, idempotency_key: execution.envelope.idempotencyKey, status, thread_id: execution.threadId, phase: run.phase, summary }
    execution.delivery = execution.delivery.then(async () => {
      await this.options.receipts.recordExecution(execution.bindingId, execution.envelope.idempotencyKey, receipt).catch(() => undefined)
      // Seven attempts over roughly one minute; no deep-link replay is needed for a transient outage.
      const delays = this.options.receiptRetryDelaysMs ?? [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
      for (let attempt = 0; attempt <= delays.length && !this.disposed; attempt++) {
        if (attempt > 0) await this.waitForRetry(delays[attempt - 1])
        if (this.disposed) break
        const delivered = await this.options.tickets.postTaskReceipt({ origin: execution.link.origin, requestId: execution.link.requestId, bindingId: execution.bindingId, credential: execution.credential, receipt }).catch(() => undefined)
        if (delivered?.ok) break
      }
      if (status !== 'running') this.executions.delete(execution.requestId)
    }).catch(() => undefined)
  }

  private async watchExecution(link: AgentOSDeepLink, binding: { bindingId: string; projectId: string }, credential: string, envelope: TaskEnvelope, threadId: string, requestId: string): Promise<void> {
    if (this.disposed || !this.options.broker.getSnapshot || this.executions.has(requestId)) return
    const execution = { link, bindingId: binding.bindingId, projectId: binding.projectId, credential, envelope, threadId, requestId, delivery: Promise.resolve() }
    this.executions.set(requestId, execution)
    const snapshot = await this.options.broker.getSnapshot(binding.projectId)
    if (snapshot.ok) {
      const value = snapshot.value
      if (!value.runs.some((run) => run.requestId === requestId)) {
        // Accepted receipts survive restart, but in-process runs do not. Never leave a replay polling forever.
        this.observeExecution(execution, { ...value, runs: [{ projectId: binding.projectId, threadId, requestId, phase: 'failed', routeGeneration: value.routeGeneration, startedAt: 0, error: { code: 'internal-error', message: 'Agent OS no longer has this run; it may have been interrupted by a restart.', retryable: false } }] })
      } else this.observeExecution(execution, value)
    }
  }

  private readonly active = new Map<string, Promise<Outcome>>()
  private readonly idempotencyActive = new Map<string, Promise<Outcome>>()
  constructor(private readonly options: {
    bindings: WebsiteBindingStore; receipts: ExternalTaskReceiptStore; tickets: AgentOSTicketClient; broker: TaskBroker; now?: () => number
    receiptRetryDelaysMs?: number[]
    accepted?(input: { projectId: string; threadId: string; receivedAt: number }): Promise<void> | void
  }) {}

  handle(link: AgentOSDeepLink): Promise<Outcome> {
    if (this.disposed || link.action !== 'task') return Promise.resolve({ status: 'rejected', code: 'invalid-deep-link' })
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
    const payloadHash = ExternalTaskReceiptStore.payloadHash(envelope.title, envelope.task)
    const existing = await this.options.receipts.lookup(binding.bindingId, envelope.idempotencyKey, payloadHash)
    if (existing.kind === 'idempotency-conflict') return this.reply(link, binding.bindingId, credential, envelope, { status: 'rejected', code: 'idempotency-conflict' })
    if (existing.kind === 'match' && terminal(existing.record)) {
      if (existing.record.executionReceipt && ['completed', 'failed'].includes(String(existing.record.executionReceipt.status))) {
        await this.options.tickets.postTaskReceipt({ origin: link.origin, requestId: link.requestId, bindingId: binding.bindingId, credential, receipt: { ...existing.record.executionReceipt, request_id: link.requestId } }).catch(() => undefined)
        return recordOutcome(existing.record)
      }
      const outcome = await this.reply(link, binding.bindingId, credential, envelope, recordOutcome(existing.record))
      if (existing.record.state === 'accepted' && existing.record.threadId && existing.record.requestIdLocal) await this.watchExecution(link, binding, credential, envelope, existing.record.threadId, existing.record.requestIdLocal)
      return outcome
    }
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
    await this.options.accepted?.({ projectId: binding.projectId, threadId: created.value.threadId, receivedAt: (this.options.now ?? Date.now)() })
    const outcome = await this.reply(link, binding.bindingId, credential, envelope, { status: 'accepted' })
    await this.watchExecution(link, binding, credential, envelope, created.value.threadId, submitted.value.requestId)
    return outcome
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
