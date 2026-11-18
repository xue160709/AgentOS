import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectChatErrorCode, WebsiteBindingPublic, WebsiteBindingRecord } from '../src/project-chat-contract'
import { normalizeAgentOSOrigin } from './agentos-deep-link'

const BINDING_ID = /^bnd_[A-Za-z0-9_-]{16,128}$/
const CREDENTIAL = /^[A-Za-z0-9_-]{43,}$/

export type AgentOSSafeStorage = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export type WebsiteBindingStoreResult<T> = { ok: true; value: T } | { ok: false; error: { code: Extract<ProjectChatErrorCode, 'binding-not-found' | 'binding-revoked' | 'binding-conflict' | 'credential-storage-unavailable' | 'internal-error'> } }
type WebsiteBindingStoreErrorCode = Extract<ProjectChatErrorCode, 'binding-not-found' | 'binding-revoked' | 'binding-conflict' | 'credential-storage-unavailable' | 'internal-error'>
export type CreateWebsiteBindingInput = { bindingId: string; origin: string; displayName: string; projectId: string; credential: string; createdAt?: number }
export type WebsiteBindingStoreOptions = { userDataPath: string; safeStorage: AgentOSSafeStorage; now?: () => number; writeTextFile?: (filePath: string, contents: string) => Promise<void> }
type StoredBindings = { schemaVersion: 1; bindings: WebsiteBindingRecord[] }

export class WebsiteBindingStore {
  readonly filePath: string
  private readonly safeStorage: AgentOSSafeStorage
  private readonly now: () => number
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private file: StoredBindings | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: WebsiteBindingStoreOptions) {
    this.filePath = path.join(options.userDataPath, 'website-bindings.json')
    this.safeStorage = options.safeStorage
    this.now = options.now ?? Date.now
    this.writeTextFile = options.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, 'utf8'))
  }

  async list(): Promise<WebsiteBindingPublic[]> { await this.writeChain; return (await this.load()).bindings.map(publicBinding) }

  async findActiveByOrigin(origin: string): Promise<WebsiteBindingPublic | undefined> {
    await this.writeChain
    const normalized = normalizeAgentOSOrigin(origin)
    if (!normalized.ok) return undefined
    const binding = (await this.load()).bindings.find((candidate) => candidate.status === 'active' && candidate.origin === normalized.value && candidate.credentialCiphertext)
    return binding ? publicBinding(binding) : undefined
  }

  async create(input: CreateWebsiteBindingInput): Promise<WebsiteBindingStoreResult<WebsiteBindingPublic>> {
    return this.serialize(async () => {
      const normalized = normalizeAgentOSOrigin(input.origin)
      const displayName = input.displayName.trim()
      const projectId = input.projectId.trim()
      if (!normalized.ok || !BINDING_ID.test(input.bindingId) || !displayName || displayName.length > 120 || !projectId || !CREDENTIAL.test(input.credential) || decodedCredentialBytes(input.credential) < 32) return failure('internal-error')
      if (!this.safeStorage.isEncryptionAvailable()) return failure('credential-storage-unavailable')
      const file = await this.load()
      const active = file.bindings.find((binding) => binding.status === 'active' && binding.origin === normalized.value)
      if (active) return failure('binding-conflict')
      let credentialCiphertext: string
      try { credentialCiphertext = this.safeStorage.encryptString(input.credential).toString('base64') } catch { return failure('credential-storage-unavailable') }
      const record: WebsiteBindingRecord = { schemaVersion: 1, bindingId: input.bindingId, origin: normalized.value, displayName, projectId, credentialCiphertext, status: 'active', createdAt: input.createdAt ?? this.now() }
      const next: StoredBindings = { schemaVersion: 1, bindings: [...file.bindings, record] }
      try { await this.write(next); this.file = next; return { ok: true, value: publicBinding(record) } } catch { return failure('internal-error') }
    })
  }

  async credentialFor(bindingId: string): Promise<WebsiteBindingStoreResult<string>> {
    await this.writeChain
    const binding = (await this.load()).bindings.find((candidate) => candidate.bindingId === bindingId)
    if (!binding) return failure('binding-not-found')
    if (binding.status !== 'active' || !binding.credentialCiphertext) return failure('binding-revoked')
    if (!this.safeStorage.isEncryptionAvailable()) return failure('credential-storage-unavailable')
    try { return { ok: true, value: this.safeStorage.decryptString(Buffer.from(binding.credentialCiphertext, 'base64')) } } catch { return failure('credential-storage-unavailable') }
  }

  async revoke(bindingId: string): Promise<WebsiteBindingStoreResult<void>> {
    return this.serialize(async () => {
      const file = await this.load()
      const index = file.bindings.findIndex((binding) => binding.bindingId === bindingId)
      if (index < 0) return failure('binding-not-found')
      const current = file.bindings[index]
      if (current.status === 'revoked') return { ok: true, value: undefined }
      const revoked: WebsiteBindingRecord = { ...current, status: 'revoked', revokedAt: this.now(), credentialCiphertext: '' }
      const next = { schemaVersion: 1 as const, bindings: file.bindings.map((binding, candidate) => candidate === index ? revoked : binding) }
      try { await this.write(next); this.file = next; return { ok: true, value: undefined } } catch { return failure('internal-error') }
    })
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.writeChain.then(operation)
    this.writeChain = queued.then(() => undefined, () => undefined)
    return queued
  }

  private async load(): Promise<StoredBindings> {
    if (this.file) return this.file
    if (!existsSync(this.filePath)) return this.file = { schemaVersion: 1, bindings: [] }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isStoredBindings(parsed) || !parsed.bindings.every(isBindingRecord)) throw new Error('website-bindings-invalid')
      return this.file = { schemaVersion: 1, bindings: parsed.bindings }
    } catch {
      try { await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`) } catch { /* recovery can still start empty */ }
      return this.file = { schemaVersion: 1, bindings: [] }
    }
  }

  private async write(file: StoredBindings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await this.writeTextFile(tempPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tempPath, this.filePath)
  }
}

function publicBinding(binding: WebsiteBindingRecord): WebsiteBindingPublic { const { credentialCiphertext: _, ...result } = binding; return result }
function failure(code: WebsiteBindingStoreErrorCode): WebsiteBindingStoreResult<never> { return { ok: false, error: { code } } }
function decodedCredentialBytes(value: string): number { return Math.floor(value.length * 3 / 4) }
function isStoredBindings(value: unknown): value is StoredBindings { return isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.bindings) }
function isBindingRecord(value: unknown): value is WebsiteBindingRecord {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.bindingId === 'string' && typeof value.origin === 'string' && typeof value.displayName === 'string' && typeof value.projectId === 'string' && typeof value.credentialCiphertext === 'string' && (value.status === 'active' || value.status === 'revoked') && (value.status !== 'active' || value.credentialCiphertext.length > 0) && typeof value.createdAt === 'number' && (value.revokedAt === undefined || typeof value.revokedAt === 'number')
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
