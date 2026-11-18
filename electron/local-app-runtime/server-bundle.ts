import { constants } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isRecord } from './defaults'
import { DETECTED_SERVER_BUNDLE_MARKER, SERVER_BUNDLE_BACKUP_DIRECTORY, fingerprintRuntimeSource, newestRuntimeSourceMtime } from './static'

/**
 * Server bundles (`.next`) must run in place, so unlike static artifacts they
 * are never copied into AgentOS storage. What AgentOS keeps is a record of the
 * source it last built them from (`C-RSM-502`): the fingerprint is taken only
 * after a successful build, because the build itself rewrites files such as
 * `tsconfig.tsbuildinfo` and `next-env.d.ts`.
 */
export type ServerBuildRecord = {
  canonicalRoot: string
  buildId: string
  sourceFingerprint: string
  builtAt: number
}

export class ServerBuildRecordStore {
  private records: Record<string, ServerBuildRecord> | null = null

  constructor(private readonly filePath?: string) {}

  async get(definitionId: string): Promise<ServerBuildRecord | undefined> {
    return (await this.load())[definitionId]
  }

  async set(definitionId: string, record: ServerBuildRecord): Promise<void> {
    const records = await this.load()
    records[definitionId] = record
    if (!this.filePath) return
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp-${process.pid}`
    await writeFile(temporary, JSON.stringify(records, null, 2))
    await rename(temporary, this.filePath)
  }

  private async load(): Promise<Record<string, ServerBuildRecord>> {
    if (this.records) return this.records
    const records: Record<string, ServerBuildRecord> = {}
    if (this.filePath) {
      try {
        const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
        if (isRecord(raw)) {
          for (const [id, value] of Object.entries(raw)) {
            if (isRecord(value) && typeof value.canonicalRoot === 'string' && typeof value.buildId === 'string' &&
              typeof value.sourceFingerprint === 'string' && typeof value.builtAt === 'number') {
              records[id] = { canonicalRoot: value.canonicalRoot, buildId: value.buildId, sourceFingerprint: value.sourceFingerprint, builtAt: value.builtAt }
            }
          }
        }
      } catch {
        // Missing or unreadable: every bundle falls back to the mtime rule.
      }
    }
    this.records = records
    return records
  }
}

/** The bundle's own identity and when it was written, or null without a bundle. */
export async function readServerBundleId(canonicalRoot: string): Promise<{ buildId: string; mtimeMs: number } | null> {
  const markerPath = path.join(canonicalRoot, ...DETECTED_SERVER_BUNDLE_MARKER.split('/'))
  try {
    const [content, markerStat] = await Promise.all([readFile(markerPath, 'utf8'), stat(markerPath)])
    const buildId = content.trim()
    return buildId ? { buildId, mtimeMs: markerStat.mtimeMs } : null
  } catch {
    return null
  }
}

/**
 * Whether the source is newer than the server bundle. A matching record is
 * compared by fingerprint; a bundle AgentOS did not build (or a missing
 * record) falls back to "any source file modified after the bundle".
 */
export async function serverBundleStale(canonicalRoot: string, record?: ServerBuildRecord): Promise<boolean | null> {
  const bundle = await readServerBundleId(canonicalRoot)
  if (!bundle) return null
  if (record && record.canonicalRoot === canonicalRoot && record.buildId === bundle.buildId) {
    return (await fingerprintRuntimeSource(canonicalRoot)) !== record.sourceFingerprint
  }
  return (await newestRuntimeSourceMtime(canonicalRoot)) > bundle.mtimeMs
}

/** Record the bundle that now exists; call only after a successful build. */
export async function currentServerBuildRecord(canonicalRoot: string, now: number): Promise<ServerBuildRecord | null> {
  const bundle = await readServerBundleId(canonicalRoot)
  if (!bundle) return null
  return { canonicalRoot, buildId: bundle.buildId, sourceFingerprint: await fingerprintRuntimeSource(canonicalRoot), builtAt: now }
}

/**
 * Keep the running bundle restorable while `next build` wipes `.next`
 * (`DI-RSM-503`). Copy-on-write clone where the volume supports it; the
 * build cache is not worth protecting.
 */
export async function backupServerBundle(canonicalRoot: string): Promise<string | null> {
  const source = path.join(canonicalRoot, '.next')
  const backup = path.join(canonicalRoot, SERVER_BUNDLE_BACKUP_DIRECTORY)
  const cache = path.join(source, 'cache')
  await rm(backup, { recursive: true, force: true })
  try {
    await cp(source, backup, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (entry) => entry !== cache && !entry.startsWith(`${cache}${path.sep}`),
    })
    return backup
  } catch {
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return null
  }
}

export async function restoreServerBundle(canonicalRoot: string, backup: string | null): Promise<void> {
  if (!backup) return
  const target = path.join(canonicalRoot, '.next')
  await rm(target, { recursive: true, force: true })
  await rename(backup, target)
}

export async function discardServerBundleBackup(backup: string | null): Promise<void> {
  if (backup) await rm(backup, { recursive: true, force: true })
}
