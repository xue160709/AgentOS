import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  normalizeStoredChatState,
  readChatThreadRollout,
  serializeChatThreadRollout,
} from '../src/chat-workspace-persistence'
import {
  RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
  parseRuntimeScopeId,
  runtimeOwnerMatchesScope,
  type RuntimeDevelopmentSearchItem,
  type RuntimeDevelopmentSearchOptions,
  type RuntimeDevelopmentSearchResult,
  type RuntimeDevelopmentThread,
  type RuntimeDevelopmentWorkspace,
  type RuntimeScopeId,
} from '../src/runtime-development-contract'
import type { ChatState } from '../src/components/types'

const WORKSPACE_DB_NAME = 'chat-workspace.sqlite'
const SIDECAR_FILE_NAME = 'runtime-development-workspace.json'
const SESSIONS_DIR_NAME = 'runtime-chat-sessions'
const DEFAULT_SEARCH_LIMIT = 16
const MAX_SEARCH_LIMIT = 64

type RuntimeThreadRow = {
  id: string
  runtimeScopeId: string
  runtimeDefinitionId: string | null
  ownerKind: string
  ownerProjectId: string | null
  rolloutPath: string
  title: string
  createdAt: number
  updatedAt: number
  pinnedAt: number | null
  archivedAt: number | null
  sessionId: string | null
  model: string | null
  modelPickJson: string | null
  cwd: string | null
  creationSourceJson: string | null
}

type RuntimeMetaRow = {
  runtimeThreadRevision: number | null
  savedAt: number | null
}

type RuntimeWorkspaceSnapshot = {
  state: RuntimeDevelopmentWorkspace
  savedAt: number
}

export class RuntimeDevelopmentThreadStore {
  private readonly dbPath: string
  private readonly sidecarPath: string
  private readonly sessionsDir: string
  private sqliteAvailable: boolean | null = null
  private currentState: RuntimeDevelopmentWorkspace | null = null

  constructor(userDataPath: string) {
    this.dbPath = path.join(userDataPath, WORKSPACE_DB_NAME)
    this.sidecarPath = path.join(userDataPath, SIDECAR_FILE_NAME)
    this.sessionsDir = path.join(userDataPath, SESSIONS_DIR_NAME)
  }

  read(): RuntimeDevelopmentWorkspace {
    const database = this.readDatabaseSnapshot()
    const sidecar = this.readSidecarSnapshot()
    const selected = selectNewestSnapshot(database, sidecar)
    const state = selected?.state ?? createEmptyRuntimeDevelopmentWorkspace()
    this.currentState = state
    return state
  }

  current(): RuntimeDevelopmentWorkspace | null {
    return this.currentState
  }

  async save(
    input: unknown,
    expectedRevision?: number,
  ): Promise<RuntimeDevelopmentWorkspace> {
    const runtimeDevelopmentThreads = parseRuntimeDevelopmentThreadsForWrite(input)
    const current = this.read()
    if (expectedRevision !== undefined && expectedRevision !== current.runtimeThreadRevision) {
      throw new Error('runtime-thread-stale-revision')
    }
    const previousRolloutPaths = this.readDatabaseRolloutPathMap()

    const state: RuntimeDevelopmentWorkspace = {
      schemaVersion: RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
      runtimeThreadRevision: current.runtimeThreadRevision + 1,
      runtimeDevelopmentThreads: sortRuntimeDevelopmentThreads(runtimeDevelopmentThreads),
    }
    const savedAt = Date.now()
    await mkdir(path.dirname(this.sidecarPath), { recursive: true })
    await mkdir(this.sessionsDir, { recursive: true })
    // 每个 revision 使用新 rollout 路径；快照提交失败时，旧 revision 不会误读新 Transcript。
    const rolloutPaths = await this.saveRolloutFiles(
      state.runtimeDevelopmentThreads,
      state.runtimeThreadRevision,
    )

    let databaseSaved = false
    let sidecarSaved = false
    try { databaseSaved = this.saveDatabaseSnapshot(state, savedAt, rolloutPaths) } catch { databaseSaved = false }
    try { sidecarSaved = await this.saveSidecarSnapshot(state, savedAt) } catch { sidecarSaved = false }
    // SQLite 与 sidecar 都是完整恢复源；任一成功即可，双失败必须向单写者报错。
    if (!databaseSaved && !sidecarSaved) {
      console.error('[runtime-thread-store] save-failed', { media: 'sqlite-and-sidecar' })
      throw new Error('runtime-thread-save-failed')
    }
    if (databaseSaved) {
      const currentRolloutPaths = new Set(rolloutPaths.values())
      await this.cleanupRolloutFiles(
        [...previousRolloutPaths.values()].filter((rolloutPath) => !currentRolloutPaths.has(rolloutPath)),
      )
    } else if (!this.canUseSqlite()) {
      // 纯 sidecar 模式不引用 rollout，成功落盘后移除本轮中间恢复文件。
      await this.cleanupRolloutFiles([...rolloutPaths.values()])
    }
    this.currentState = state
    return state
  }

  search(
    query: string,
    options: RuntimeDevelopmentSearchOptions = {},
    resolveRuntimeName?: (runtimeScopeId: RuntimeScopeId) => string | undefined,
  ): RuntimeDevelopmentSearchResult {
    const normalizedQuery = typeof query === 'string' ? query.trim() : ''
    if (!normalizedQuery) return { ok: true, items: [] }
    try {
      const limit = normalizeSearchLimit(options.limit)
      const items = this.read().runtimeDevelopmentThreads
        .filter((thread) => options.includeArchived === true || thread.archivedAt === undefined)
        .filter((thread) => options.runtimeScopeId === undefined || thread.runtimeScopeId === options.runtimeScopeId)
        .map((thread) => runtimeThreadSearchItem(thread, normalizedQuery, resolveRuntimeName))
        .filter((item): item is RuntimeDevelopmentSearchItem => item !== null)
        .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt || left.threadTitle.localeCompare(right.threadTitle))
        .slice(0, limit)
      return { ok: true, items }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Runtime development search failed.' }
    }
  }

  private readDatabaseSnapshot(): RuntimeWorkspaceSnapshot | null {
    if (!existsSync(this.dbPath) || !this.canUseSqlite()) return null
    try {
      const hasRuntimeTables = Number(this.selectJson<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('runtime_development_meta', 'runtime_development_threads')",
      )[0]?.count ?? 0) === 2
      if (!hasRuntimeTables) return null
      const meta = this.selectJson<RuntimeMetaRow>(
        'SELECT runtime_thread_revision AS runtimeThreadRevision, saved_at AS savedAt FROM runtime_development_meta WHERE id = 1',
      )[0]
      if (!meta) return null
      const runtimeThreadRevision = strictRuntimeThreadRevision(meta.runtimeThreadRevision)
      if (runtimeThreadRevision === null) return null
      const rows = this.selectJson<RuntimeThreadRow>([
        'SELECT id, runtime_scope_id AS runtimeScopeId, runtime_definition_id AS runtimeDefinitionId,',
        'owner_kind AS ownerKind, owner_project_id AS ownerProjectId, rollout_path AS rolloutPath, title,',
        'created_at AS createdAt, updated_at AS updatedAt, pinned_at AS pinnedAt, archived_at AS archivedAt,',
        'session_id AS sessionId, model, model_pick_json AS modelPickJson, cwd, creation_source_json AS creationSourceJson',
        'FROM runtime_development_threads',
        'ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, created_at DESC',
      ].join(' '))
      const runtimeDevelopmentThreads = rows.map((row) => {
        const fallback: ChatState = {
          sessionId: row.sessionId ?? undefined,
          model: row.model || 'Claude Agent',
          modelPick: normalizeStoredChatState({ modelPick: safeJsonParse(row.modelPickJson, undefined) }).modelPick,
          cwd: row.cwd ?? undefined,
          items: [],
        }
        if (!row.rolloutPath || !existsSync(row.rolloutPath)) throw new Error('runtime-thread-rollout-missing')
        const chatState = readChatThreadRollout(readFileSync(row.rolloutPath, 'utf8'), fallback)
        const runtimeOwner = row.ownerKind === 'project' && row.ownerProjectId
          ? { kind: 'project' as const, projectId: row.ownerProjectId }
          : row.ownerKind === 'workspace' && row.ownerProjectId === null
            ? { kind: 'workspace' as const }
            : undefined
        const normalized = normalizeRuntimeDevelopmentThread({
          id: row.id,
          purpose: 'runtime-development',
          runtimeScopeId: row.runtimeScopeId,
          runtimeDefinitionId: row.runtimeDefinitionId ?? undefined,
          runtimeOwner,
          title: row.title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          pinnedAt: row.pinnedAt ?? undefined,
          archivedAt: row.archivedAt ?? undefined,
          creationSource: safeJsonParse(row.creationSourceJson, undefined),
          chatState,
        })
        if (!normalized) throw new Error('runtime-thread-row-invalid')
        return normalized
      })
      return {
        state: {
          schemaVersion: RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
          runtimeThreadRevision,
          runtimeDevelopmentThreads: sortRuntimeDevelopmentThreads(runtimeDevelopmentThreads),
        },
        savedAt: finiteTimestamp(meta.savedAt),
      }
    } catch {
      console.error('[runtime-thread-store] read-failed', { medium: 'sqlite' })
      return null
    }
  }

  private readSidecarSnapshot(): RuntimeWorkspaceSnapshot | null {
    if (!existsSync(this.sidecarPath)) return null
    try {
      const raw = JSON.parse(readFileSync(this.sidecarPath, 'utf8')) as unknown
      if (!isRecord(raw)) return null
      const state = parseRuntimeDevelopmentWorkspaceSnapshot(raw)
      if (!state) return null
      return {
        state,
        savedAt: finiteTimestamp(raw.savedAt),
      }
    } catch {
      console.error('[runtime-thread-store] read-failed', { medium: 'sidecar' })
      return null
    }
  }

  private saveDatabaseSnapshot(
    state: RuntimeDevelopmentWorkspace,
    savedAt: number,
    rolloutPaths: ReadonlyMap<string, string>,
  ): boolean {
    if (!this.canUseSqlite()) return false
    try {
      const statements = [
        `CREATE TABLE IF NOT EXISTS runtime_development_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          runtime_thread_revision INTEGER NOT NULL DEFAULT 0,
          saved_at INTEGER NOT NULL DEFAULT 0
        );`,
        `CREATE TABLE IF NOT EXISTS runtime_development_threads (
          id TEXT PRIMARY KEY,
          runtime_scope_id TEXT NOT NULL,
          runtime_definition_id TEXT,
          owner_kind TEXT NOT NULL,
          owner_project_id TEXT,
          rollout_path TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          pinned_at INTEGER,
          archived_at INTEGER,
          session_id TEXT,
          model TEXT NOT NULL DEFAULT 'Claude Agent',
          model_pick_json TEXT,
          cwd TEXT,
          creation_source_json TEXT NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 0,
          first_user_message TEXT NOT NULL DEFAULT '',
          preview TEXT NOT NULL DEFAULT ''
        );`,
        'CREATE INDEX IF NOT EXISTS idx_runtime_threads_scope_updated ON runtime_development_threads(runtime_scope_id, archived_at, updated_at DESC);',
        'BEGIN;',
        state.runtimeDevelopmentThreads.length > 0
          ? `DELETE FROM runtime_development_threads WHERE id NOT IN (${state.runtimeDevelopmentThreads.map((thread) => sqlValue(thread.id)).join(', ')});`
          : 'DELETE FROM runtime_development_threads;',
        `INSERT INTO runtime_development_meta (id, runtime_thread_revision, saved_at)
         VALUES (1, ${sqlValue(state.runtimeThreadRevision)}, ${sqlValue(savedAt)})
         ON CONFLICT(id) DO UPDATE SET
           runtime_thread_revision = excluded.runtime_thread_revision,
           saved_at = excluded.saved_at;`,
      ]
      for (const thread of state.runtimeDevelopmentThreads) {
        const rolloutPath = rolloutPaths.get(thread.id)
        if (!rolloutPath) throw new Error('runtime-thread-rollout-path-missing')
        statements.push(
          `INSERT INTO runtime_development_threads (
             id, runtime_scope_id, runtime_definition_id, owner_kind, owner_project_id, rollout_path, title,
             created_at, updated_at, pinned_at, archived_at, session_id, model, model_pick_json, cwd,
             creation_source_json, message_count, first_user_message, preview
           ) VALUES (
             ${sqlValue(thread.id)}, ${sqlValue(thread.runtimeScopeId)}, ${sqlValue(thread.runtimeDefinitionId)},
             ${sqlValue(thread.runtimeOwner.kind)}, ${sqlValue(thread.runtimeOwner.kind === 'project' ? thread.runtimeOwner.projectId : undefined)},
             ${sqlValue(rolloutPath)}, ${sqlValue(thread.title)}, ${sqlValue(thread.createdAt)}, ${sqlValue(thread.updatedAt)},
             ${sqlValue(thread.pinnedAt)}, ${sqlValue(thread.archivedAt)}, ${sqlValue(thread.chatState.sessionId)},
             ${sqlValue(thread.chatState.model)}, ${sqlValue(thread.chatState.modelPick ? JSON.stringify(thread.chatState.modelPick) : undefined)},
             ${sqlValue(thread.chatState.cwd)}, ${sqlValue(JSON.stringify(thread.creationSource))},
             ${sqlValue(messageCount(thread))}, ${sqlValue(firstUserMessage(thread))}, ${sqlValue(transcriptPreview(thread))}
           ) ON CONFLICT(id) DO UPDATE SET
             runtime_scope_id = excluded.runtime_scope_id,
             runtime_definition_id = excluded.runtime_definition_id,
             owner_kind = excluded.owner_kind,
             owner_project_id = excluded.owner_project_id,
             rollout_path = excluded.rollout_path,
             title = excluded.title,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             pinned_at = excluded.pinned_at,
             archived_at = excluded.archived_at,
             session_id = excluded.session_id,
             model = excluded.model,
             model_pick_json = excluded.model_pick_json,
             cwd = excluded.cwd,
             creation_source_json = excluded.creation_source_json,
             message_count = excluded.message_count,
             first_user_message = excluded.first_user_message,
             preview = excluded.preview;`,
        )
      }
      statements.push('COMMIT;')
      this.runSql(statements.join('\n'))
      return true
    } catch {
      console.error('[runtime-thread-store] save-failed', { medium: 'sqlite' })
      return false
    }
  }

  private async saveSidecarSnapshot(state: RuntimeDevelopmentWorkspace, savedAt: number): Promise<boolean> {
    const temporaryPath = `${this.sidecarPath}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ ...state, savedAt }, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.sidecarPath)
      return true
    } catch {
      await unlink(temporaryPath).catch(() => undefined)
      console.error('[runtime-thread-store] save-failed', { medium: 'sidecar' })
      return false
    }
  }

  private async saveRolloutFiles(
    threads: RuntimeDevelopmentThread[],
    runtimeThreadRevision: number,
  ): Promise<Map<string, string>> {
    const rolloutPaths = new Map<string, string>()
    await Promise.all(threads.map(async (thread) => {
      const rolloutPath = this.rolloutPathForThread(thread, runtimeThreadRevision)
      rolloutPaths.set(thread.id, rolloutPath)
      await mkdir(path.dirname(rolloutPath), { recursive: true })
      const temporaryPath = `${rolloutPath}.tmp-${process.pid}-${Date.now().toString(36)}`
      try {
        await writeFile(temporaryPath, serializeChatThreadRollout(thread, {
          purpose: thread.purpose,
          runtimeScopeId: thread.runtimeScopeId,
          runtimeDefinitionId: thread.runtimeDefinitionId,
          runtimeOwner: thread.runtimeOwner,
        }), 'utf8')
        await rename(temporaryPath, rolloutPath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        console.error('[runtime-thread-store] save-failed', { medium: 'rollout' })
        throw error
      }
    }))
    return rolloutPaths
  }

  private rolloutPathForThread(thread: RuntimeDevelopmentThread, runtimeThreadRevision: number): string {
    const date = new Date(thread.createdAt || Date.now())
    const stamp = date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-')
    return path.join(
      this.sessionsDir,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      `rollout-${stamp}-${safeFilename(thread.id)}-r${runtimeThreadRevision}.jsonl`,
    )
  }

  private readDatabaseRolloutPathMap(): Map<string, string> {
    if (!existsSync(this.dbPath) || !this.canUseSqlite()) return new Map()
    try {
      const tableExists = Number(this.selectJson<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'runtime_development_threads'",
      )[0]?.count ?? 0) === 1
      if (!tableExists) return new Map()
      return new Map(this.selectJson<{ id: string; rolloutPath: string }>(
        'SELECT id, rollout_path AS rolloutPath FROM runtime_development_threads',
      ).map((row) => [row.id, row.rolloutPath]))
    } catch {
      return new Map()
    }
  }

  private async cleanupRolloutFiles(rolloutPaths: string[]): Promise<void> {
    await Promise.all(rolloutPaths.map(async (rolloutPath) => {
      try {
        await unlink(rolloutPath)
      } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return
        console.error('[runtime-thread-store] cleanup-failed', { medium: 'rollout' })
      }
    }))
  }

  private canUseSqlite(): boolean {
    if (this.sqliteAvailable !== null) return this.sqliteAvailable
    try {
      execFileSync('sqlite3', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      this.sqliteAvailable = true
    } catch {
      this.sqliteAvailable = false
    }
    return this.sqliteAvailable
  }

  private runSql(sql: string): void {
    execFileSync('sqlite3', [this.dbPath], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }

  private selectJson<T>(sql: string): T[] {
    const output = execFileSync('sqlite3', ['-json', this.dbPath, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return output ? JSON.parse(output) as T[] : []
  }
}

export function createEmptyRuntimeDevelopmentWorkspace(): RuntimeDevelopmentWorkspace {
  return {
    schemaVersion: RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
    runtimeThreadRevision: 0,
    runtimeDevelopmentThreads: [],
  }
}

export function normalizeRuntimeDevelopmentWorkspace(value: unknown): RuntimeDevelopmentWorkspace {
  if (!isRecord(value)) return createEmptyRuntimeDevelopmentWorkspace()
  const seen = new Set<string>()
  const runtimeDevelopmentThreads = Array.isArray(value.runtimeDevelopmentThreads)
    ? value.runtimeDevelopmentThreads.flatMap((item) => {
        const thread = normalizeRuntimeDevelopmentThread(item)
        if (!thread || seen.has(thread.id)) return []
        seen.add(thread.id)
        return [thread]
      })
    : []
  return {
    schemaVersion: RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
    runtimeThreadRevision: finiteRevision(value.runtimeThreadRevision),
    runtimeDevelopmentThreads: sortRuntimeDevelopmentThreads(runtimeDevelopmentThreads),
  }
}

export function normalizeRuntimeDevelopmentThread(value: unknown): RuntimeDevelopmentThread | null {
  if (!isRecord(value) || value.purpose !== 'runtime-development') return null
  const id = normalizedNonEmpty(value.id)
  const title = normalizedNonEmpty(value.title)
  const parsedScope = parseRuntimeScopeId(value.runtimeScopeId)
  if (!id || !title || !parsedScope || !isRecord(value.runtimeOwner)) return null
  const runtimeDefinitionId = normalizedOptional(value.runtimeDefinitionId)
  // scope 是产品身份：Project 必须匹配 projectId，Workspace 必须匹配 Definition 且不得夹带 Project owner。
  const runtimeOwner = value.runtimeOwner.kind === 'project'
    ? { kind: 'project' as const, projectId: normalizedNonEmpty(value.runtimeOwner.projectId) ?? '' }
    : value.runtimeOwner.kind === 'workspace' && value.runtimeOwner.projectId === undefined
      ? { kind: 'workspace' as const }
      : null
  if (!runtimeOwner || !runtimeOwnerMatchesScope(parsedScope.runtimeScopeId, runtimeOwner, runtimeDefinitionId)) return null
  if (!isRecord(value.creationSource) || (value.creationSource.kind !== 'user' && value.creationSource.kind !== 'app-command')) return null
  const createdAt = finiteTimestamp(value.createdAt)
  const updatedAt = finiteTimestamp(value.updatedAt) || createdAt
  return {
    id,
    purpose: 'runtime-development',
    runtimeScopeId: parsedScope.runtimeScopeId,
    runtimeDefinitionId,
    runtimeOwner,
    title,
    createdAt,
    updatedAt,
    pinnedAt: optionalTimestamp(value.pinnedAt),
    archivedAt: optionalTimestamp(value.archivedAt),
    creationSource: { kind: value.creationSource.kind },
    chatState: normalizeStoredChatState(value.chatState),
  }
}

function parseRuntimeDevelopmentThreadsForWrite(value: unknown): RuntimeDevelopmentThread[] {
  const rawThreads = isRecord(value) && Array.isArray(value.runtimeDevelopmentThreads)
    ? value.runtimeDevelopmentThreads
    : null
  if (!rawThreads) throw new Error('runtime-thread-workspace-invalid')
  const threads = rawThreads.map((item) => normalizeRuntimeDevelopmentThread(item))
  if (threads.some((thread) => thread === null)) throw new Error('runtime-thread-invalid')
  const typed = threads as RuntimeDevelopmentThread[]
  if (new Set(typed.map((thread) => thread.id)).size !== typed.length) throw new Error('runtime-thread-duplicate-id')
  return typed
}

function parseRuntimeDevelopmentWorkspaceSnapshot(value: Record<string, unknown>): RuntimeDevelopmentWorkspace | null {
  const runtimeThreadRevision = strictRuntimeThreadRevision(value.runtimeThreadRevision)
  if (runtimeThreadRevision === null) return null
  try {
    return {
      schemaVersion: RUNTIME_DEVELOPMENT_WORKSPACE_SCHEMA_VERSION,
      runtimeThreadRevision,
      runtimeDevelopmentThreads: sortRuntimeDevelopmentThreads(parseRuntimeDevelopmentThreadsForWrite(value)),
    }
  } catch {
    return null
  }
}

// 两个介质先按共享 revision 选新版本；只有 revision 相同才用 savedAt 打破平局。
function selectNewestSnapshot(
  database: RuntimeWorkspaceSnapshot | null,
  sidecar: RuntimeWorkspaceSnapshot | null,
): RuntimeWorkspaceSnapshot | null {
  if (!database) return sidecar
  if (!sidecar) return database
  if (database.state.runtimeThreadRevision !== sidecar.state.runtimeThreadRevision) {
    return database.state.runtimeThreadRevision > sidecar.state.runtimeThreadRevision ? database : sidecar
  }
  return database.savedAt >= sidecar.savedAt ? database : sidecar
}

function sortRuntimeDevelopmentThreads(threads: RuntimeDevelopmentThread[]): RuntimeDevelopmentThread[] {
  return [...threads].sort((left, right) =>
    (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0) ||
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id))
}

function runtimeThreadSearchItem(
  thread: RuntimeDevelopmentThread,
  query: string,
  resolveRuntimeName?: (runtimeScopeId: RuntimeScopeId) => string | undefined,
): RuntimeDevelopmentSearchItem | null {
  const messages = thread.chatState.items.flatMap((item) => item.type === 'message' ? [item.content] : [])
  const body = [thread.title, ...messages].join('\n')
  const normalizedQuery = query.toLocaleLowerCase()
  const normalizedTitle = thread.title.toLocaleLowerCase()
  const normalizedBody = body.toLocaleLowerCase()
  if (!normalizedTitle.includes(normalizedQuery) && !normalizedBody.includes(normalizedQuery)) return null
  const parsed = parseRuntimeScopeId(thread.runtimeScopeId)
  if (!parsed) return null
  const runtimeName = resolveRuntimeName?.(thread.runtimeScopeId)?.trim() ||
    (parsed.kind === 'project' ? 'Project Runtime' : thread.runtimeDefinitionId ?? 'Workspace Runtime')
  const score = (normalizedTitle.includes(normalizedQuery) ? 200 : 0) +
    (normalizedBody.includes(normalizedQuery) ? 100 : 0) +
    Math.max(0, 36 - Math.max(0, Date.now() - thread.updatedAt) / 86_400_000)
  const snippetSource = messages.find((message) => message.toLocaleLowerCase().includes(normalizedQuery)) ?? thread.title
  const metadata = {
    scopeKind: 'runtime-development' as const,
    runtimeScopeId: thread.runtimeScopeId,
    ownerKind: parsed.kind,
    name: runtimeName,
    runtimeDefinitionId: thread.runtimeDefinitionId,
    projectId: thread.runtimeOwner.kind === 'project' ? thread.runtimeOwner.projectId : undefined,
    purpose: 'runtime-development' as const,
  }
  return {
    id: `runtime-history:thread:${thread.id}`,
    ...metadata,
    threadId: thread.id,
    threadTitle: thread.title,
    subtitle: `${runtimeName} · ${parsed.kind === 'project' ? 'Project' : 'Workspace'} Runtime`,
    snippet: compactText(snippetSource, 180),
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    score,
    metadata,
  }
}

function messageCount(thread: RuntimeDevelopmentThread): number {
  return thread.chatState.items.filter((item) => item.type === 'message').length
}

function firstUserMessage(thread: RuntimeDevelopmentThread): string {
  const item = thread.chatState.items.find((candidate) => candidate.type === 'message' && candidate.role === 'user')
  return item?.type === 'message' ? item.content : ''
}

function transcriptPreview(thread: RuntimeDevelopmentThread): string {
  const item = [...thread.chatState.items].reverse().find((candidate) => candidate.type === 'message' && candidate.content.trim())
  return item?.type === 'message' ? compactText(item.content, 240) : ''
}

function normalizeSearchLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(value)))
    : DEFAULT_SEARCH_LIMIT
}

function compactText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 4)).trimEnd()} ...`
}

function normalizedNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizedOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function strictRuntimeThreadRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function finiteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeJsonParse(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback
  try { return JSON.parse(value) as unknown } catch { return fallback }
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function sqlValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
