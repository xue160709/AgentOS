import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectChatErrorCode } from '../src/project-chat-contract'

export type ExternalTaskReceiptState = 'fetching' | 'validated' | 'thread-created' | 'submitting' | 'accepted' | 'rejected'
export type ExternalTaskReceiptRecord = {
  bindingId: string
  requestId: string
  idempotencyKey: string
  payloadHash: string
  state: ExternalTaskReceiptState
  threadId?: string
  requestIdLocal?: string
  rejectionCode?: ProjectChatErrorCode
  executionReceipt?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
export type ExternalTaskReceiptStoreOptions = { userDataPath: string; now?: () => number; writeTextFile?: (filePath: string, contents: string) => Promise<void> }
export type ReceiptLookup = { kind: 'missing' } | { kind: 'match'; record: ExternalTaskReceiptRecord } | { kind: 'idempotency-conflict'; record: ExternalTaskReceiptRecord }
type StoredReceipts = { schemaVersion: 1; records: ExternalTaskReceiptRecord[] }
const TERMINAL = new Set<ExternalTaskReceiptState>(['accepted', 'rejected'])
const TRANSITIONS: Record<ExternalTaskReceiptState, readonly ExternalTaskReceiptState[]> = {
  fetching: ['validated', 'rejected'], validated: ['thread-created', 'rejected'], 'thread-created': ['submitting', 'rejected'], submitting: ['accepted', 'rejected'], accepted: [], rejected: [],
}

export class ExternalTaskReceiptStore {
  readonly filePath: string
  private readonly now: () => number
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private file: StoredReceipts | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: ExternalTaskReceiptStoreOptions) {
    this.filePath = path.join(options.userDataPath, 'external-task-receipts.json')
    this.now = options.now ?? Date.now
    this.writeTextFile = options.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, 'utf8'))
  }

  static payloadHash(title: string, task: string): string { return createHash('sha256').update(`${title.trim()}\n${task.trim()}`, 'utf8').digest('hex') }

  async lookup(bindingId: string, idempotencyKey: string, payloadHash: string): Promise<ReceiptLookup> {
    await this.writeChain
    const record = (await this.load()).records.find((candidate) => candidate.bindingId === bindingId && candidate.idempotencyKey === idempotencyKey)
    if (!record) return { kind: 'missing' }
    return record.payloadHash === payloadHash ? { kind: 'match', record: clone(record) } : { kind: 'idempotency-conflict', record: clone(record) }
  }

  async begin(input: { bindingId: string; requestId: string; idempotencyKey: string; title: string; task: string }): Promise<ReceiptLookup> {
    const payloadHash = ExternalTaskReceiptStore.payloadHash(input.title, input.task)
    return this.serialize(async () => {
      const file = await this.load()
      const existing = file.records.find((record) => record.bindingId === input.bindingId && record.idempotencyKey === input.idempotencyKey)
      if (existing) return existing.payloadHash === payloadHash ? { kind: 'match', record: clone(existing) } : { kind: 'idempotency-conflict', record: clone(existing) }
      const now = this.now()
      const record: ExternalTaskReceiptRecord = { bindingId: input.bindingId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, payloadHash, state: 'fetching', createdAt: now, updatedAt: now }
      await this.commit({ schemaVersion: 1, records: [...file.records, record] })
      return { kind: 'match', record: clone(record) }
    })
  }

  async transition(input: { bindingId: string; idempotencyKey: string; state: ExternalTaskReceiptState; threadId?: string; requestIdLocal?: string; rejectionCode?: ProjectChatErrorCode }): Promise<ExternalTaskReceiptRecord | undefined> {
    return this.serialize(async () => {
      const file = await this.load()
      const index = file.records.findIndex((record) => record.bindingId === input.bindingId && record.idempotencyKey === input.idempotencyKey)
      if (index < 0) return undefined
      const current = file.records[index]
      if (current.state === input.state && TERMINAL.has(current.state)) return clone(current)
      if (!TRANSITIONS[current.state].includes(input.state)) throw new Error('external-task-receipt-invalid-transition')
      if (input.state === 'thread-created' && !input.threadId) throw new Error('external-task-receipt-thread-required')
      if (input.state === 'accepted' && !input.requestIdLocal) throw new Error('external-task-receipt-request-required')
      if (input.state === 'rejected' && !input.rejectionCode) throw new Error('external-task-receipt-rejection-required')
      const next: ExternalTaskReceiptRecord = {
        ...current, state: input.state, updatedAt: this.now(),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.requestIdLocal ? { requestIdLocal: input.requestIdLocal } : {}),
        ...(input.rejectionCode ? { rejectionCode: input.rejectionCode } : {}),
      }
      await this.commit({ schemaVersion: 1, records: file.records.map((record, candidate) => candidate === index ? next : record) })
      return clone(next)
    })
  }

  async recordExecution(bindingId: string, idempotencyKey: string, receipt: Record<string, unknown>): Promise<void> {
    await this.serialize(async () => {
      const file = await this.load()
      await this.commit({ ...file, records: file.records.map((record) => record.bindingId === bindingId && record.idempotencyKey === idempotencyKey ? { ...record, executionReceipt: receipt, updatedAt: this.now() } : record) })
    })
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.writeChain.then(operation)
    this.writeChain = queued.then(() => undefined, () => undefined)
    return queued
  }

  private async load(): Promise<StoredReceipts> {
    if (this.file) return this.file
    if (!existsSync(this.filePath)) return this.file = { schemaVersion: 1, records: [] }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isStoredReceipts(parsed) || !parsed.records.every(isReceiptRecord)) throw new Error('external-task-receipts-invalid')
      const recovered = recoverAndEvict(parsed.records, this.now(), true)
      this.file = { schemaVersion: 1, records: recovered.records }
      if (recovered.changed) await this.write(this.file)
      return this.file
    } catch {
      try { await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`) } catch { /* recovery can still start empty */ }
      return this.file = { schemaVersion: 1, records: [] }
    }
  }

  private async commit(file: StoredReceipts): Promise<void> {
    const normalized = recoverAndEvict(file.records, this.now(), false).records
    const next = { schemaVersion: 1 as const, records: normalized }
    await this.write(next)
    this.file = next
  }

  private async write(file: StoredReceipts): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await this.writeTextFile(tempPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tempPath, this.filePath)
  }
}

function recoverAndEvict(records: ExternalTaskReceiptRecord[], now: number, recoverInFlight: boolean): { records: ExternalTaskReceiptRecord[]; changed: boolean } {
  let changed = false
  let next = records.map((record) => {
    if (!recoverInFlight || (record.state !== 'thread-created' && record.state !== 'submitting')) return record
    changed = true
    return { ...record, state: 'rejected' as const, rejectionCode: 'sdk-submit-failed' as const, updatedAt: now }
  })
  const keep = new Set<ExternalTaskReceiptRecord>()
  for (const recordsForBinding of groupByBinding(next).values()) {
    const active = recordsForBinding.filter((record) => !TERMINAL.has(record.state) || now - record.updatedAt <= 24 * 60 * 60_000)
    if (active.length !== recordsForBinding.length) changed = true
    const removable = active.filter((record) => TERMINAL.has(record.state)).sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt)
    while (active.length > 1_000 && removable.length) {
      const oldest = removable.shift()!
      active.splice(active.indexOf(oldest), 1)
      changed = true
    }
    for (const record of active) keep.add(record)
  }
  next = next.filter((record) => keep.has(record))
  return { records: next, changed }
}
function groupByBinding(records: ExternalTaskReceiptRecord[]): Map<string, ExternalTaskReceiptRecord[]> {
  const grouped = new Map<string, ExternalTaskReceiptRecord[]>()
  for (const record of records) { const entries = grouped.get(record.bindingId) ?? []; entries.push(record); grouped.set(record.bindingId, entries) }
  return grouped
}
function clone(record: ExternalTaskReceiptRecord): ExternalTaskReceiptRecord { return { ...record } }
function isStoredReceipts(value: unknown): value is StoredReceipts { return isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.records) }
function isReceiptRecord(value: unknown): value is ExternalTaskReceiptRecord {
  return isRecord(value) && typeof value.bindingId === 'string' && typeof value.requestId === 'string' && typeof value.idempotencyKey === 'string' && typeof value.payloadHash === 'string' && isState(value.state) && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number' && (value.threadId === undefined || typeof value.threadId === 'string') && (value.requestIdLocal === undefined || typeof value.requestIdLocal === 'string') && (value.rejectionCode === undefined || typeof value.rejectionCode === 'string')
}
function isState(value: unknown): value is ExternalTaskReceiptState { return value === 'fetching' || value === 'validated' || value === 'thread-created' || value === 'submitting' || value === 'accepted' || value === 'rejected' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
