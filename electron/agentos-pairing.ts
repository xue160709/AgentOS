import { randomBytes } from 'node:crypto'
import { buildPairReceipt, parsePairEnvelope, type AgentOSDeepLink, type PairEnvelope, type PairRejectionCode } from './agentos-deep-link'
import type { AgentOSTicketClient } from './agentos-ticket-client'
import type { WebsiteBindingStore } from './website-binding-store'

export type PairingProjection = { pairingId: string; displayName: string; origin: string; expiresAt: number }
export type PairingResponse = { pairingId: string; action: 'accept'; projectId: string } | { pairingId: string; action: 'reject' }
type PairProject = { id: string; pathMissing?: boolean }
type Outcome = { status: 'accepted' | 'rejected'; code?: PairRejectionCode }

/** Main-only pairing queue. It intentionally retains nonce and credentials outside every IPC projection. */
export class AgentOSPairingService {
  private readonly pending = new Map<string, PairEnvelope>()
  private readonly queue: string[] = []
  private sequence = 0
  constructor(private readonly options: { tickets: AgentOSTicketClient; bindings: WebsiteBindingStore; projects: () => Promise<PairProject[]>; publish: (pairing: PairingProjection | null) => void; now?: () => number; randomBytes?: (size: number) => Buffer }) {}

  async enqueue(link: AgentOSDeepLink): Promise<Outcome> {
    if (link.action !== 'pair') return { status: 'rejected', code: 'invalid-envelope' }
    const fetched = await this.options.tickets.getPair({ origin: link.origin, requestId: link.requestId })
    if (!fetched.ok) return { status: 'rejected', code: 'invalid-envelope' }
    const parsed = parsePairEnvelope(fetched.value, { origin: link.origin, requestId: link.requestId, now: this.options.now })
    if (!parsed.ok) return { status: 'rejected', code: parsed.error.code === 'ticket-expired' ? 'expired' : 'invalid-envelope' }
    const pairingId = `pair_${++this.sequence}_${randomId(this.options.randomBytes)}`
    this.pending.set(pairingId, parsed.value); this.queue.push(pairingId); if (this.queue.length === 1) this.publishCurrent()
    return { status: 'accepted' }
  }

  async respond(response: PairingResponse): Promise<Outcome> {
    const envelope = this.pending.get(response.pairingId)
    if (!envelope || this.queue[0] !== response.pairingId) return { status: 'rejected', code: 'invalid-envelope' }
    if (response.action === 'reject') return this.finish(response.pairingId, envelope, { status: 'rejected', code: 'user-rejected' })
    if (expired(envelope, this.options.now)) return this.finish(response.pairingId, envelope, { status: 'rejected', code: 'expired' })
    const project = (await this.options.projects()).find((item) => item.id === response.projectId)
    if (!project) return this.finish(response.pairingId, envelope, { status: 'rejected', code: 'project-not-found' })
    if (project.pathMissing) return this.finish(response.pairingId, envelope, { status: 'rejected', code: 'project-path-missing' })
    const existing = await this.options.bindings.findActiveByOrigin(envelope.origin)
    if (existing) {
      if (existing.projectId === project.id) return this.finish(response.pairingId, envelope, { status: 'accepted', bindingId: existing.bindingId, alreadyBound: true })
      return this.finish(response.pairingId, envelope, { status: 'rejected', code: 'binding-conflict' })
    }
    const bindingId = `bnd_${randomId(this.options.randomBytes)}`
    const credential = (this.options.randomBytes ?? randomBytes)(32).toString('base64url')
    const stored = await this.options.bindings.create({ bindingId, origin: envelope.origin, displayName: envelope.displayName, projectId: project.id, credential })
    if (!stored.ok) return this.finish(response.pairingId, envelope, { status: 'rejected', code: stored.error.code === 'credential-storage-unavailable' ? 'credential-storage-unavailable' : stored.error.code === 'binding-conflict' ? 'binding-conflict' : 'internal-error' })
    return this.finish(response.pairingId, envelope, { status: 'accepted', bindingId, credential })
  }

  async cancelAll(): Promise<void> { for (const pairingId of [...this.queue]) await this.respond({ pairingId, action: 'reject' }) }

  private async finish(pairingId: string, envelope: PairEnvelope, result: { status: 'accepted'; bindingId: string; credential?: string; alreadyBound?: true } | { status: 'rejected'; code: PairRejectionCode }): Promise<Outcome> {
    this.pending.delete(pairingId); this.queue.splice(this.queue.indexOf(pairingId), 1); this.publishCurrent()
    const receipt = buildPairReceipt(envelope, result.status === 'accepted' && result.alreadyBound ? { status: 'accepted', bindingId: result.bindingId, alreadyBound: true } : result.status === 'accepted' ? { status: 'accepted', bindingId: result.bindingId, credential: result.credential! } : result)
    if (receipt.ok) await this.options.tickets.postPairReceipt({ origin: envelope.origin, requestId: envelope.requestId, receipt: receipt.value }).catch(() => undefined)
    return result.status === 'accepted' ? { status: 'accepted' } : result
  }

  private publishCurrent(): void {
    const pairingId = this.queue[0]; const envelope = pairingId ? this.pending.get(pairingId) : undefined
    if (!pairingId || !envelope || expired(envelope, this.options.now)) { if (pairingId) { this.pending.delete(pairingId); this.queue.shift(); return this.publishCurrent() }; this.options.publish(null); return }
    this.options.publish({ pairingId, displayName: envelope.displayName, origin: envelope.origin, expiresAt: envelope.expiresAt })
  }
}
function randomId(random?: (size: number) => Buffer): string { return (random ?? randomBytes)(24).toString('base64url') }
function expired(envelope: PairEnvelope, now?: () => number): boolean { return envelope.expiresAt < (now ?? Date.now)() - 30_000 }
