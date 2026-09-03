import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isRecord } from './defaults'

export class LocalAppTrustStore {
  private readonly filePath: string
  private grants = new Map<string, { canonicalRoot: string; grantedAt: number; trustStatus: 'trusted' | 'revoked'; revokedAt?: number }>()
  private loaded = false

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'local-app-trust.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const value of raw) {
        if (!isRecord(value) || typeof value.canonicalRoot !== 'string') continue
        if (value.trustStatus !== 'trusted' && value.trustStatus !== 'revoked') continue
        this.grants.set(value.canonicalRoot, {
          canonicalRoot: value.canonicalRoot,
          grantedAt: typeof value.grantedAt === 'number' ? value.grantedAt : Date.now(),
          trustStatus: value.trustStatus,
          revokedAt: typeof value.revokedAt === 'number' ? value.revokedAt : undefined,
        })
      }
    } catch { /* first run or malformed store: treat as empty */ }
  }

  isTrusted(canonicalRoot: string): boolean {
    return this.grants.get(canonicalRoot)?.trustStatus === 'trusted'
  }

  async grant(canonicalRoot: string): Promise<void> {
    await this.load()
    this.grants.set(canonicalRoot, { canonicalRoot, grantedAt: Date.now(), trustStatus: 'trusted' })
    await this.save()
  }

  async revoke(canonicalRoot: string): Promise<void> {
    await this.load()
    const current = this.grants.get(canonicalRoot)
    this.grants.set(canonicalRoot, { canonicalRoot, grantedAt: current?.grantedAt ?? Date.now(), trustStatus: 'revoked', revokedAt: Date.now() })
    await this.save()
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify([...this.grants.values()], null, 2)}\n`, 'utf8')
  }
}
