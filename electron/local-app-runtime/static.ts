/**
 * Static AgentOS runtime primitives.
 *
 * This module deliberately contains no Electron or renderer imports.  The
 * Main process owns declaration parsing, artifact persistence and preview
 * path resolution; tests can exercise the security boundary without starting
 * Electron.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { RuntimeServeOverride, RuntimeStaticDeclaration } from '../../src/components/types'

export const STATIC_PREVIEW_SCHEME = 'agentos-static'
export const STATIC_ARTIFACT_VERSION = 1

export type StaticDeclarationParseResult =
  | { ok: true; declaration?: undefined }
  | { ok: true; declaration: RuntimeStaticDeclaration }
  | { ok: false; code: 'static-declaration-invalid'; message: string }

export type StaticArtifact = {
  artifactId: string
  rootPath: string
  entryFile: string
  lastBuildAt: number
  sourceFingerprint?: string
}

export type StaticArtifactPointer = StaticArtifact & {
  version: typeof STATIC_ARTIFACT_VERSION
}

export type StaticOutputValidation = {
  canonicalProjectRoot: string
  outputRootPath: string
  entryPath: string
}

/** A result intentionally small enough to pass across the Main-owned seam. */
export type StaticRequestResolution =
  | { ok: true; filePath: string; contentType: string; artifact: StaticArtifact }
  | { ok: false; status: 400 | 403 | 404 | 405; reason: string }

type StaticTokenRecord = {
  artifact: StaticArtifact
  runtimeId: string
  generation: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidDeclaration(message: string): StaticDeclarationParseResult {
  return { ok: false, code: 'static-declaration-invalid', message }
}

/**
 * `undefined` means legacy dev mode.  Once `agentos` is present, malformed
 * declarations are rejected instead of silently becoming an npm dev runtime.
 */
export function parseAgentOSStaticDeclaration(packageJson: unknown): StaticDeclarationParseResult {
  if (!isRecord(packageJson) || packageJson.agentos === undefined) return { ok: true }
  const raw = packageJson.agentos
  if (!isRecord(raw)) return invalidDeclaration('package.json.agentos 必须是对象')
  if (raw.mode !== 'static') return invalidDeclaration('package.json.agentos.mode 必须为 static')
  if (raw.buildCommand !== 'npm run build') return invalidDeclaration('静态构建命令必须为 npm run build')
  if (typeof raw.outputRoot !== 'string' || !isSafeStaticRelativePath(raw.outputRoot)) {
    return invalidDeclaration('静态 outputRoot 必须是安全相对路径')
  }
  if (typeof raw.entryFile !== 'string' || !isSafeStaticRelativePath(raw.entryFile)) {
    return invalidDeclaration('静态 entryFile 必须是安全相对路径')
  }
  return {
    ok: true,
    declaration: {
      mode: 'static',
      buildCommand: 'npm run build',
      outputRoot: normalizeStaticRelativePath(raw.outputRoot),
      entryFile: normalizeStaticRelativePath(raw.entryFile),
    },
  }
}

/** Reject all path syntax that can cross the project/artifact boundary. */
export function isSafeStaticRelativePath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  if (/^[A-Za-z]:/.test(value) || /^\\/.test(value)) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) return false
  return segments.every((segment) => segment !== '.')
}

export function normalizeStaticRelativePath(value: string): string {
  return value.split('/').filter(Boolean).join('/')
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = path.resolve(parentPath)
  const candidate = path.resolve(candidatePath)
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`)
}

/**
 * Validate the declared output directory and entry using both lexical and
 * realpath containment.  A symlink may not make output escape the project.
 */
export async function validateStaticOutput(
  projectRoot: string,
  declaration: RuntimeStaticDeclaration,
): Promise<StaticOutputValidation> {
  const parsed = parseAgentOSStaticDeclaration({ agentos: declaration })
  if (!parsed.ok || !parsed.declaration) throw new Error('static-declaration-invalid')
  const canonicalProjectRoot = await realpath(projectRoot)
  const outputRootPath = path.resolve(canonicalProjectRoot, ...parsed.declaration.outputRoot.split('/'))
  if (!isPathInside(canonicalProjectRoot, outputRootPath)) throw new Error('static-output-escape')
  const canonicalOutputRoot = await realpath(outputRootPath)
  if (!isPathInside(canonicalProjectRoot, canonicalOutputRoot)) throw new Error('static-output-symlink-escape')
  const outputStat = await stat(canonicalOutputRoot)
  if (!outputStat.isDirectory()) throw new Error('static-output-not-directory')
  const entryPath = path.resolve(canonicalOutputRoot, ...parsed.declaration.entryFile.split('/'))
  if (!isPathInside(canonicalOutputRoot, entryPath)) throw new Error('static-entry-escape')
  const canonicalEntry = await realpath(entryPath)
  if (!isPathInside(canonicalOutputRoot, canonicalEntry)) throw new Error('static-entry-symlink-escape')
  const entryStat = await stat(canonicalEntry)
  if (!entryStat.isFile()) throw new Error('static-entry-not-file')
  return {
    canonicalProjectRoot,
    outputRootPath: canonicalOutputRoot,
    entryPath: canonicalEntry,
  }
}

/**
 * Detection candidates, in priority order. Detection never invents a path or a
 * command: only these fixed output roots and the two fixed npm scripts are
 * considered, and every candidate still passes the containment checks in
 * `validateStaticOutput`.
 */
export const DETECTED_STATIC_OUTPUT_ROOTS = ['out', 'dist', 'build'] as const
export const DETECTED_STATIC_ENTRY_FILE = 'index.html'

/**
 * How a Runtime can be viewed. `C-RSM-402` freezes three serve tiers plus the
 * unsupported case; a declaration, when present, always wins over detection.
 */
export type RuntimeServePlan =
  | { kind: 'artifact'; declaration: RuntimeStaticDeclaration; source: 'declaration' | 'detected' }
  | { kind: 'buildable'; declaration?: RuntimeStaticDeclaration; source: 'declaration' | 'detected' }
  | { kind: 'production'; reason: 'server-bundle-present' | 'build-produces-no-artifact' }
  | { kind: 'development'; reason: 'no-build-script' | 'no-start-script' }
  | { kind: 'unsupported'; reason: 'no-runnable-script' }

/**
 * The one server-bundle marker detection is allowed to recognize. It is a fixed
 * Next.js artifact path; other frameworks must build first rather than have
 * their output location guessed.
 */
export const DETECTED_SERVER_BUNDLE_MARKER = '.next/BUILD_ID'

export type RuntimeServeScripts = { hasBuildScript: boolean; hasStartScript: boolean; hasDevScript: boolean }

/** The serve tier for a Runtime that cannot be viewed from files alone. */
export function serverServePlan(
  scripts: RuntimeServeScripts,
  reason: 'server-bundle-present' | 'build-produces-no-artifact' | 'no-build-script',
): RuntimeServePlan {
  if (scripts.hasStartScript && reason !== 'no-build-script') {
    return { kind: 'production', reason: reason === 'server-bundle-present' ? 'server-bundle-present' : 'build-produces-no-artifact' }
  }
  if (scripts.hasStartScript && reason === 'no-build-script') return { kind: 'development', reason: 'no-build-script' }
  if (scripts.hasDevScript) {
    return { kind: 'development', reason: reason === 'no-build-script' ? 'no-build-script' : 'no-start-script' }
  }
  return { kind: 'unsupported', reason: 'no-runnable-script' }
}

/** Synthesize the declaration a detected output directory is equivalent to. */
export function detectedStaticDeclaration(outputRoot: string): RuntimeStaticDeclaration {
  return {
    mode: 'static',
    buildCommand: 'npm run build',
    outputRoot: normalizeStaticRelativePath(outputRoot),
    entryFile: DETECTED_STATIC_ENTRY_FILE,
  }
}

/** First fixed candidate that holds a usable, contained entry file. */
export async function findDetectedStaticArtifact(canonicalRoot: string): Promise<RuntimeStaticDeclaration | null> {
  for (const outputRoot of DETECTED_STATIC_OUTPUT_ROOTS) {
    const declaration = detectedStaticDeclaration(outputRoot)
    try {
      await validateStaticOutput(canonicalRoot, declaration)
      return declaration
    } catch {
      // Missing, not a directory, or escaping the root: try the next candidate.
    }
  }
  return null
}

/**
 * Resolve how a Runtime should be served. The order is frozen and must not be
 * reordered: declaration, existing artifact, buildable, development, then
 * unsupported.
 */
export async function detectRuntimeServePlan(input: {
  canonicalRoot: string
  declaration?: RuntimeStaticDeclaration
} & RuntimeServeScripts): Promise<RuntimeServePlan> {
  if (input.declaration) {
    try {
      await validateStaticOutput(input.canonicalRoot, input.declaration)
      return { kind: 'artifact', declaration: input.declaration, source: 'declaration' }
    } catch {
      return { kind: 'buildable', declaration: input.declaration, source: 'declaration' }
    }
  }
  const detected = await findDetectedStaticArtifact(input.canonicalRoot)
  if (detected) return { kind: 'artifact', declaration: detected, source: 'detected' }
  // An existing server bundle is the SSR equivalent of an existing artifact:
  // serve it as it is instead of paying for another build.
  if (input.hasStartScript && await hasServerBundle(input.canonicalRoot)) {
    return { kind: 'production', reason: 'server-bundle-present' }
  }
  if (input.hasBuildScript) return { kind: 'buildable', source: 'detected' }
  return serverServePlan(input, 'no-build-script')
}

async function hasServerBundle(canonicalRoot: string): Promise<boolean> {
  const markerPath = path.resolve(canonicalRoot, ...DETECTED_SERVER_BUNDLE_MARKER.split('/'))
  if (!isPathInside(canonicalRoot, markerPath)) return false
  try {
    const canonicalMarker = await realpath(markerPath)
    if (!isPathInside(canonicalRoot, canonicalMarker)) return false
    return (await stat(canonicalMarker)).isFile()
  } catch {
    return false
  }
}

/**
 * A user override is the only thing allowed to outrank detection
 * (`C-RSM-404`). It can force a serve tier but never invents a declaration:
 * forcing `artifact` on a directory with no build path stays unsupported.
 */
export function applyServeOverride(
  plan: RuntimeServePlan,
  override: RuntimeServeOverride | undefined,
  scripts: RuntimeServeScripts,
): RuntimeServePlan {
  // `artifact` only clears a previous `server` override; it cannot make a
  // directory static that has no build path, and the surface reports that
  // honestly instead of silently falling back. `server` means "keep it
  // running" — production or development is still detection's call.
  if (override !== 'server' || plan.kind === 'unsupported') return plan
  if (plan.kind === 'production' || plan.kind === 'development') return plan
  return serverServePlan(scripts, scripts.hasStartScript ? 'server-bundle-present' : 'no-build-script')
}

async function ensureSafeSourceTree(sourceRoot: string, containmentRoot: string, visiting = new Set<string>()): Promise<void> {
  const canonicalRoot = await realpath(sourceRoot)
  if (!isPathInside(containmentRoot, canonicalRoot)) throw new Error('static-output-symlink-escape')
  const sourceStat = await stat(canonicalRoot)
  if (!sourceStat.isDirectory()) throw new Error('static-output-not-directory')
  if (visiting.has(canonicalRoot)) throw new Error('static-output-symlink-cycle')
  visiting.add(canonicalRoot)
  try {
    for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
      const canonicalEntry = await realpath(path.join(canonicalRoot, entry.name))
      if (!isPathInside(containmentRoot, canonicalEntry)) throw new Error('static-output-symlink-escape')
      const entryStat = await stat(canonicalEntry)
      if (entryStat.isDirectory()) await ensureSafeSourceTree(canonicalEntry, containmentRoot, visiting)
      else if (!entryStat.isFile()) throw new Error('static-output-entry-type-invalid')
    }
  } finally {
    visiting.delete(canonicalRoot)
  }
}

async function copySafeTree(sourceRoot: string, targetRoot: string, projectRoot: string): Promise<void> {
  const canonicalProjectRoot = await realpath(projectRoot)
  const canonicalSourceRoot = await realpath(sourceRoot)
  if (!isPathInside(canonicalProjectRoot, canonicalSourceRoot)) throw new Error('static-output-escape')
  // Every dereferenced output entry must stay inside the output root itself;
  // a link to another project directory is not a safe static artifact input.
  await ensureSafeSourceTree(canonicalSourceRoot, canonicalSourceRoot)
  const copyNode = async (sourcePath: string, targetPath: string, visiting = new Set<string>()): Promise<void> => {
    const canonical = await realpath(sourcePath)
    if (!isPathInside(canonicalSourceRoot, canonical)) throw new Error('static-output-symlink-escape')
    if (visiting.has(canonical)) throw new Error('static-output-symlink-cycle')
    visiting.add(canonical)
    try {
      const sourceStat = await stat(canonical)
      if (sourceStat.isDirectory()) {
        await mkdir(targetPath, { recursive: true })
        for (const entry of await readdir(canonical, { withFileTypes: true })) {
          await copyNode(path.join(canonical, entry.name), path.join(targetPath, entry.name), visiting)
        }
        return
      }
      if (!sourceStat.isFile()) throw new Error('static-output-entry-type-invalid')
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(canonical, targetPath)
    } finally {
      visiting.delete(canonical)
    }
  }
  await copyNode(canonicalSourceRoot, targetRoot)
}

export async function copyStaticOutput(sourceRoot: string, targetRoot: string, projectRoot: string): Promise<void> {
  await rm(targetRoot, { recursive: true, force: true })
  await copySafeTree(sourceRoot, targetRoot, projectRoot)
}

function stableDefinitionKey(definitionId: string, canonicalRoot: string): string {
  return createHash('sha256').update(`${definitionId}\0${canonicalRoot}`).digest('hex').slice(0, 32)
}

function safeArtifactId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,95}$/i.test(value)
}

export class StaticArtifactStore {
  private readonly basePath: string
  private readonly now: () => number
  private nonce = 0
  /** Artifact ids whose commit is between the staging rename and the pointer rename. */
  private readonly committing = new Set<string>()

  constructor(userDataPath: string, now: () => number = Date.now) {
    this.basePath = path.join(userDataPath, 'runtime-static')
    this.now = now
  }

  private runtimePath(definitionId: string, canonicalRoot: string): string {
    return path.join(this.basePath, stableDefinitionKey(definitionId, canonicalRoot))
  }

  async loadLastGood(definitionId: string, canonicalRoot: string): Promise<StaticArtifact | null> {
    const runtimePath = this.runtimePath(definitionId, canonicalRoot)
    let pointer: StaticArtifactPointer
    try {
      pointer = JSON.parse(await readFile(path.join(runtimePath, 'last-good.json'), 'utf8')) as StaticArtifactPointer
    } catch {
      return null
    }
    if (pointer.version !== STATIC_ARTIFACT_VERSION || !safeArtifactId(pointer.artifactId) ||
      typeof pointer.entryFile !== 'string' || !isSafeStaticRelativePath(pointer.entryFile)) return null
    const artifactRoot = path.join(runtimePath, 'artifacts', pointer.artifactId)
    try {
      const canonicalRuntime = await realpath(runtimePath)
      const canonicalArtifact = await realpath(artifactRoot)
      if (!isPathInside(canonicalRuntime, canonicalArtifact)) return null
      const entry = await realpath(path.resolve(canonicalArtifact, ...pointer.entryFile.split('/')))
      if (!isPathInside(canonicalArtifact, entry) || !(await stat(entry)).isFile()) return null
      // Only the pointed artifact is ever served again. Copies left behind by
      // earlier builds (or by versions that never pruned) are reclaimed here so
      // an existing install heals on its next load instead of only on rebuild.
      await this.pruneArtifacts(runtimePath, pointer.artifactId)
      return {
        artifactId: pointer.artifactId,
        rootPath: canonicalArtifact,
        entryFile: pointer.entryFile,
        lastBuildAt: Number.isFinite(pointer.lastBuildAt) ? pointer.lastBuildAt : 0,
        sourceFingerprint: typeof pointer.sourceFingerprint === 'string' ? pointer.sourceFingerprint : undefined,
      }
    } catch {
      return null
    }
  }

  async commit(
    definitionId: string,
    canonicalRoot: string,
    declaration: RuntimeStaticDeclaration,
    sourceOutput: string,
    sourceFingerprint?: string,
    signal?: AbortSignal,
    beforePointerCommit?: () => boolean,
  ): Promise<StaticArtifact> {
    const runtimePath = this.runtimePath(definitionId, canonicalRoot)
    const artifactsPath = path.join(runtimePath, 'artifacts')
    await mkdir(artifactsPath, { recursive: true })
    const artifactId = `${this.now().toString(36)}-${(++this.nonce).toString(36)}-${randomBytes(6).toString('hex')}`
    const temporaryRoot = path.join(artifactsPath, `.staging-${artifactId}`)
    const artifactRoot = path.join(artifactsPath, artifactId)
    let pointerTmp: string | undefined
    let committed = false
    this.committing.add(artifactId)
    try {
      await copyStaticOutput(sourceOutput, temporaryRoot, canonicalRoot)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await rename(temporaryRoot, artifactRoot)
      const artifact: StaticArtifact = {
        artifactId,
        rootPath: artifactRoot,
        entryFile: declaration.entryFile,
        lastBuildAt: this.now(),
        sourceFingerprint,
      }
      const pointer: StaticArtifactPointer = { version: STATIC_ARTIFACT_VERSION, ...artifact }
      pointerTmp = path.join(runtimePath, `.last-good-${artifactId}.tmp`)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await writeFile(pointerTmp, `${JSON.stringify(pointer)}\n`, 'utf8')
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      // Main transaction authority is re-read at the last cancellable point;
      // a stale development generation must never replace last-good.
      if (beforePointerCommit && !beforePointerCommit()) throw new RuntimeBuildCommitFenceRejectedError()
      // The pointer rename is the atomic commit boundary. Once it succeeds,
      // callers must publish this artifact even if cancellation is requested
      // in the following in-memory publication window.
      await rename(pointerTmp, path.join(runtimePath, 'last-good.json'))
      committed = true
      // The pointer now names the only artifact that can ever be loaded again;
      // every previous copy of this definition is dead weight (each one is a
      // full static export, easily hundreds of MB). Reclaim it best-effort:
      // a prune failure must never turn a committed build into a failure.
      await this.pruneArtifacts(runtimePath, artifactId)
      return artifact
    } finally {
      this.committing.delete(artifactId)
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
      if (pointerTmp) await rm(pointerTmp, { force: true }).catch(() => undefined)
      // A copy that was renamed into place but never pointed to (fence
      // rejection, abort, pointer write failure) is unreachable: nothing loads
      // it and the previous last-good is untouched. Drop it instead of leaking
      // one full export per failed build.
      if (!committed) await rm(artifactRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /**
   * Delete the committed artifacts of one definition that nothing can reach.
   *
   * Reachable, and therefore never deleted: `keepArtifactId` (the caller's own
   * artifact), whatever `last-good.json` names at this moment, and any commit
   * that has renamed its staging copy but not yet its pointer. The on-disk
   * pointer is re-read here rather than trusted from the caller, so a caller
   * holding a stale pointer (a load that overlapped a concurrent commit)
   * cannot delete the newer artifact that pointer now names.
   *
   * Also skipped: `.staging-*` directories, whose owning commit removes them
   * in its own `finally`, and any name that is not a well-formed artifact id.
   *
   * Errors are swallowed throughout: pruning reclaims space, it is never part
   * of the commit contract, and a failure must not fail a committed build.
   */
  private async pruneArtifacts(runtimePath: string, keepArtifactId: string): Promise<void> {
    const artifactsPath = path.join(runtimePath, 'artifacts')
    let entries: Dirent[]
    try {
      entries = await readdir(artifactsPath, { withFileTypes: true })
    } catch {
      return
    }
    const keep = new Set([keepArtifactId])
    try {
      const pointer = JSON.parse(await readFile(path.join(runtimePath, 'last-good.json'), 'utf8')) as StaticArtifactPointer
      if (typeof pointer.artifactId === 'string') keep.add(pointer.artifactId)
    } catch {
      // No readable pointer: fall back to the caller's artifact alone.
    }
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return
      const name = entry.name
      if (keep.has(name) || !safeArtifactId(name) || this.committing.has(name)) return
      await rm(path.join(artifactsPath, name), { recursive: true, force: true }).catch(() => undefined)
    }))
  }
}

export class RuntimeBuildCommitFenceRejectedError extends Error {
  constructor() { super('runtime-build-commit-fence-rejected'); this.name = 'RuntimeBuildCommitFenceRejectedError' }
}

export class StaticPreviewRegistry {
  private readonly tokens = new Map<string, StaticTokenRecord>()

  register(runtimeId: string, generation: number, artifact: StaticArtifact): string {
    const token = randomBytes(24).toString('hex')
    this.tokens.set(token, { runtimeId, generation, artifact })
    return token
  }

  resolve(token: string): StaticTokenRecord | null {
    return this.tokens.get(token) ?? null
  }

  revoke(token: string): void {
    this.tokens.delete(token)
  }

  revokeRuntime(runtimeId: string, generation?: number): void {
    for (const [token, record] of this.tokens) {
      if (record.runtimeId === runtimeId && (generation === undefined || record.generation === generation)) this.tokens.delete(token)
    }
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function contentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function decodedStaticPath(rawPath: string): { ok: true; relative: string } | { ok: false; reason: string } {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return { ok: false, reason: 'invalid-encoding' }
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, reason: 'unsafe-path' }
  const withoutLeading = decoded.replace(/^\/+/, '')
  const segments = withoutLeading.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return { ok: false, reason: 'path-traversal' }
  return { ok: true, relative: segments.filter(Boolean).join('/') }
}

/** Resolve one opaque-token static request without exposing filesystem paths. */
export async function resolveStaticRequest(
  requestUrl: string,
  method: string,
  registry: StaticPreviewRegistry,
): Promise<StaticRequestResolution> {
  let url: URL
  try { url = new URL(requestUrl) } catch { return { ok: false, status: 400, reason: 'invalid-url' } }
  if (url.protocol !== `${STATIC_PREVIEW_SCHEME}:` || !url.hostname || url.username || url.password || url.port) {
    return { ok: false, status: 403, reason: 'invalid-origin' }
  }
  const token = url.hostname.toLowerCase()
  if (!/^[a-f0-9]{48}$/.test(token)) return { ok: false, status: 403, reason: 'invalid-token' }
  const record = registry.resolve(token)
  if (!record) return { ok: false, status: 404, reason: 'unknown-token' }
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return { ok: false, status: 405, reason: 'method-not-allowed' }
  const parsed = decodedStaticPath(url.pathname)
  if (!parsed.ok) return { ok: false, status: 403, reason: parsed.reason }
  let relative = parsed.relative ? parsed.relative : record.artifact.entryFile
  if (parsed.relative && url.pathname.endsWith('/')) {
    relative = `${parsed.relative}/index.html`
  } else if (parsed.relative) {
    // Next's trailing-slash export normally receives `/route/`, but a
    // document can also navigate to `/route`. Resolve that form only when
    // the lexical target is an actual directory; an existing file such as
    // `/assets/app.js` must remain the file resource, never `app.js/index.html`.
    const lexicalTarget = path.resolve(record.artifact.rootPath, ...parsed.relative.split('/'))
    try {
      if ((await stat(lexicalTarget)).isDirectory()) relative = `${parsed.relative}/index.html`
    } catch {
      // The final realpath/stat below reports a bounded 404 for missing paths.
    }
  }
  if (!isSafeStaticRelativePath(relative)) return { ok: false, status: 403, reason: 'unsafe-path' }
  const lexicalPath = path.resolve(record.artifact.rootPath, ...relative.split('/'))
  if (!isPathInside(record.artifact.rootPath, lexicalPath)) return { ok: false, status: 403, reason: 'path-escape' }
  try {
    const canonicalPath = await realpath(lexicalPath)
    if (!isPathInside(await realpath(record.artifact.rootPath), canonicalPath)) return { ok: false, status: 403, reason: 'symlink-escape' }
    const fileStat = await stat(canonicalPath)
    if (!fileStat.isFile()) return { ok: false, status: 404, reason: 'directory-or-missing' }
    return { ok: true, filePath: canonicalPath, contentType: contentType(canonicalPath), artifact: record.artifact }
  } catch {
    return { ok: false, status: 404, reason: 'missing' }
  }
}

export function staticPreviewUrl(token: string, pathname = '/'): string {
  return `${STATIC_PREVIEW_SCHEME}://${token}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

/** Lightweight source metadata used by the asynchronous stale checker. */
export async function fingerprintStaticSource(
  projectRoot: string,
  declaration: RuntimeStaticDeclaration,
): Promise<string> {
  return fingerprintRuntimeSource(projectRoot, declaration.outputRoot)
}

/** Build output AgentOS itself writes next to a server bundle while updating it. */
export const SERVER_BUNDLE_BACKUP_DIRECTORY = '.next.agentos-backup'

/** Visit every source file in stable order, skipping VCS, dependencies and build output. */
async function walkRuntimeSource(
  projectRoot: string,
  outputRoot: string | undefined,
  onFile: (relative: string, fileStat: Awaited<ReturnType<typeof stat>>) => void,
): Promise<void> {
  const ignored = new Set(['.git', 'node_modules', '.next', SERVER_BUNDLE_BACKUP_DIRECTORY, ...(outputRoot ? [outputRoot] : [])])
  const visit = async (directory: string, relative = ''): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (ignored.has(nextRelative) || (!relative && ignored.has(entry.name))) continue
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(filePath, nextRelative)
      } else if (entry.isFile()) {
        onFile(nextRelative, await stat(filePath))
      }
    }
  }
  await visit(projectRoot)
}

/** Source-only fingerprint shared by static-capable and development-only sessions. */
export async function fingerprintRuntimeSource(projectRoot: string, outputRoot?: string): Promise<string> {
  const hash = createHash('sha256')
  await walkRuntimeSource(projectRoot, outputRoot, (relative, fileStat) => {
    hash.update(`${relative}:${fileStat.size}:${fileStat.mtimeMs}\n`)
  })
  return hash.digest('hex')
}

/** Latest modification time of any source file; 0 for an empty tree. */
export async function newestRuntimeSourceMtime(projectRoot: string, outputRoot?: string): Promise<number> {
  let newest = 0
  await walkRuntimeSource(projectRoot, outputRoot, (_relative, fileStat) => {
    newest = Math.max(newest, Number(fileStat.mtimeMs))
  })
  return newest
}
