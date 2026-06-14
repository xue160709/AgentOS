/**
 * Project Content desktop implementation: tree, preview, search, watch, and path rules.
 */

import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectFileSearchItem, ProjectFileSearchResult } from '../src/claude-chat-types'
import type { FileTreeNode, FileTreeResult, ProjectFilePreviewKind, ProjectFilePreviewResult } from '../src/components/types'
import type { ProjectFilesChangedEvent, ProjectFileWatchResult } from '../src/desktop-types'
import { formatProjectPathError, resolveProjectPath } from './project-path'

type ProjectFilePreviewTextKind = Exclude<ProjectFilePreviewKind, 'image'>

type ProjectFileWatcherState = {
  rootPath: string
  watcher: FSWatcher
  refCount: number
  debounceTimer: NodeJS.Timeout | null
}

type ProjectFilesChangedEmitter = (event: ProjectFilesChangedEvent) => void

const PROJECT_FILE_PREVIEW_TEXT_MAX_BYTES = 5 * 1024 * 1024
const PROJECT_FILE_PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const PROJECT_FILE_PREVIEW_TEXT_SAMPLE_BYTES = 8192
const PROJECT_FILE_WATCH_DEBOUNCE_MS = 500
const MAX_PROJECT_FILE_SEARCH_ENTRIES = 5000
const MAX_PROJECT_FILE_SEARCH_RESULTS = 24
const MAX_PROJECT_FILE_SEARCH_DEPTH = 10

const PROJECT_CONTENT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.next',
  '.pnpm-store',
  '.svn',
  '.turbo',
  '.vite',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'release',
])

const PROJECT_FILE_PREVIEW_TEXT_EXTENSIONS = new Set([
  '.astro',
  '.bat',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cfg',
  '.cmd',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.cts',
  '.csv',
  '.cxx',
  '.dart',
  '.diff',
  '.dockerfile',
  '.env',
  '.fish',
  '.go',
  '.gql',
  '.graphql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.json5',
  '.jsonc',
  '.jsx',
  '.kt',
  '.kts',
  '.less',
  '.log',
  '.lua',
  '.md',
  '.markdown',
  '.mdx',
  '.mjs',
  '.mts',
  '.php',
  '.pl',
  '.properties',
  '.ps1',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.sass',
  '.scala',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.svg',
  '.swift',
  '.toml',
  '.ts',
  '.tsv',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
])

const PROJECT_FILE_PREVIEW_TEXT_FILENAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.eslintignore',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.prettierignore',
  '.prettierrc',
  '.stylelintrc',
  '.yarnrc',
  'brewfile',
  'changelog',
  'dockerfile',
  'gemfile',
  'license',
  'makefile',
  'procfile',
  'rakefile',
  'readme',
  'vagrantfile',
])

const PROJECT_FILE_IMAGE_MEDIA_TYPES = new Map<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'>([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

const projectFileWatchers = new Map<string, ProjectFileWatcherState>()
let emitProjectFilesChanged: ProjectFilesChangedEmitter = () => {}

export function configureProjectContentEvents(emitter: ProjectFilesChangedEmitter): void {
  emitProjectFilesChanged = emitter
}

export async function readProjectFileTree(rootPath: string): Promise<FileTreeResult> {
  const resolvedRootPath = resolveProjectPath(rootPath)
  try {
    const stat = await fs.stat(resolvedRootPath)
    if (!stat.isDirectory()) {
      return {
        ok: false,
        rootPath: resolvedRootPath,
        message: '当前项目路径不是文件夹',
      }
    }

    const rootRealPath = await fs.realpath(resolvedRootPath)
    const visitedRealPaths = new Set([rootRealPath])

    return {
      ok: true,
      rootPath: resolvedRootPath,
      rootName: path.basename(resolvedRootPath) || resolvedRootPath,
      nodes: await readProjectDirectory(resolvedRootPath, '', visitedRealPaths),
      truncated: false,
    }
  } catch (error) {
    return {
      ok: false,
      rootPath: resolvedRootPath,
      message: formatProjectPathError(error),
    }
  }
}

export async function searchProjectFiles(rootPath: string, query: string): Promise<ProjectFileSearchResult> {
  const resolvedRootPath = resolveProjectPath(rootPath)
  try {
    const stat = await fs.stat(resolvedRootPath)
    if (!stat.isDirectory()) {
      return { ok: false, rootPath: resolvedRootPath, message: '当前项目路径不是文件夹' }
    }

    const normalizedQuery = normalizeQuery(query)
    const items: ProjectFileSearchItem[] = []
    let entriesRead = 0

    const walk = async (directoryPath: string, relativeBase: string, depth: number): Promise<void> => {
      if (depth > MAX_PROJECT_FILE_SEARCH_DEPTH || entriesRead >= MAX_PROJECT_FILE_SEARCH_ENTRIES) return
      const entries = await safeReadDir(directoryPath)
      entries.sort(compareProjectDirents)

      for (const entry of entries) {
        if (entriesRead >= MAX_PROJECT_FILE_SEARCH_ENTRIES) break
        if (shouldIgnoreProjectContentEntry(entry)) continue
        const entryPath = path.join(directoryPath, entry.name)
        const relativePath = normalizeRelativePath(path.join(relativeBase, entry.name))
        entriesRead += 1

        if (entry.isDirectory()) {
          if (matchesQuery(entry.name, relativePath, normalizedQuery)) {
            items.push({
              label: entry.name,
              path: entryPath,
              relativePath,
              type: 'directory',
            })
          }
          await walk(entryPath, relativePath, depth + 1)
          continue
        }

        if ((entry.isFile() || entry.isSymbolicLink()) && matchesQuery(entry.name, relativePath, normalizedQuery)) {
          items.push({
            label: entry.name,
            path: entryPath,
            relativePath,
            type: 'file',
          })
        }
      }
    }

    await walk(resolvedRootPath, '', 0)

    return {
      ok: true,
      rootPath: resolvedRootPath,
      items: items
        .sort((a, b) => scoreFileSearchItem(b, normalizedQuery) - scoreFileSearchItem(a, normalizedQuery) || a.relativePath.localeCompare(b.relativePath))
        .slice(0, MAX_PROJECT_FILE_SEARCH_RESULTS),
    }
  } catch (error) {
    return {
      ok: false,
      rootPath: resolvedRootPath,
      message: formatProjectPathError(error),
    }
  }
}

export async function watchProjectFiles(rootPath: string): Promise<ProjectFileWatchResult> {
  const resolvedRootPath = resolveProjectPath(rootPath)
  try {
    const stat = await fs.stat(resolvedRootPath)
    if (!stat.isDirectory()) {
      return { ok: false, rootPath: resolvedRootPath, message: '当前项目路径不是文件夹' }
    }

    const existing = projectFileWatchers.get(resolvedRootPath)
    if (existing) {
      existing.refCount += 1
      return { ok: true, rootPath: resolvedRootPath }
    }

    const watcher = createProjectFileWatcher(resolvedRootPath)
    projectFileWatchers.set(resolvedRootPath, {
      rootPath: resolvedRootPath,
      watcher,
      refCount: 1,
      debounceTimer: null,
    })
    return { ok: true, rootPath: resolvedRootPath }
  } catch (error) {
    return {
      ok: false,
      rootPath: resolvedRootPath,
      message: formatProjectPathError(error),
    }
  }
}

export async function unwatchProjectFiles(rootPath: string): Promise<void> {
  const resolvedRootPath = resolveProjectPath(rootPath)
  const state = projectFileWatchers.get(resolvedRootPath)
  if (!state) return
  state.refCount -= 1
  if (state.refCount > 0) return
  disposeProjectFileWatcher(resolvedRootPath, state)
}

export function disposeProjectFileWatchers(): void {
  for (const [rootPath, state] of Array.from(projectFileWatchers)) {
    disposeProjectFileWatcher(rootPath, state)
  }
}

export async function readProjectFilePreview(rootPath: unknown, filePath: unknown): Promise<ProjectFilePreviewResult> {
  if (typeof rootPath !== 'string' || typeof filePath !== 'string') {
    return {
      ok: false,
      rootPath: '',
      path: '',
      message: '文件路径无效',
    }
  }

  const resolvedRootPath = resolveProjectPath(rootPath)
  const trimmedFilePath = filePath.trim()
  const requestedPath = path.isAbsolute(trimmedFilePath)
    ? path.resolve(trimmedFilePath)
    : path.resolve(resolvedRootPath, trimmedFilePath)
  const relativePath = normalizeRelativePath(path.relative(resolvedRootPath, requestedPath))
  const name = path.basename(requestedPath)

  const fail = (message: string): ProjectFilePreviewResult => ({
    ok: false,
    rootPath: resolvedRootPath,
    path: requestedPath,
    relativePath,
    name,
    message,
  })

  try {
    const rootStat = await fs.stat(resolvedRootPath)
    if (!rootStat.isDirectory()) return fail('当前项目路径不是文件夹')

    if (!isSameOrInsidePath(resolvedRootPath, requestedPath)) {
      return fail('只能预览当前项目内的文件')
    }

    const stat = await fs.stat(requestedPath)
    if (!stat.isFile()) return fail('只能预览文件')

    const extension = path.extname(name).toLowerCase()
    const imageMimeType = PROJECT_FILE_IMAGE_MEDIA_TYPES.get(extension)
    const textKind = await getProjectFilePreviewTextKind(requestedPath, name, stat.size)

    if (!textKind && !imageMimeType) {
      return fail('仅支持预览纯文本文件或 PNG、JPG、GIF、WEBP 图片')
    }

    if (textKind) {
      if (stat.size > PROJECT_FILE_PREVIEW_TEXT_MAX_BYTES) {
        return fail('文本文件超过 5MB，暂不在应用内预览')
      }
      const content = await fs.readFile(requestedPath, 'utf8')
      return {
        ok: true,
        rootPath: resolvedRootPath,
        path: requestedPath,
        relativePath,
        name,
        kind: textKind,
        mimeType: getProjectFilePreviewTextMimeType(textKind),
        size: stat.size,
        content,
      }
    }

    if (!imageMimeType) return fail('仅支持预览纯文本文件或 PNG、JPG、GIF、WEBP 图片')
    if (stat.size > PROJECT_FILE_PREVIEW_IMAGE_MAX_BYTES) {
      return fail('图片超过 10MB，暂不在应用内预览')
    }
    const data = await fs.readFile(requestedPath)
    return {
      ok: true,
      rootPath: resolvedRootPath,
      path: requestedPath,
      relativePath,
      name,
      kind: 'image',
      mimeType: imageMimeType,
      size: stat.size,
      dataUrl: `data:${imageMimeType};base64,${data.toString('base64')}`,
    }
  } catch (error) {
    return fail(formatProjectPathError(error))
  }
}

export async function pathExistsUnderProject(rootPath: unknown, relativePath: unknown): Promise<boolean> {
  if (typeof rootPath !== 'string' || typeof relativePath !== 'string') return false
  const resolvedRoot = resolveProjectPath(rootPath)
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized || normalized.split('/').some((segment) => segment === '..')) return false
  const resolvedTarget = path.resolve(resolvedRoot, ...normalized.split('/'))
  const rel = path.relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  try {
    await fs.access(resolvedTarget)
    return true
  } catch {
    return false
  }
}

async function readProjectDirectory(directoryPath: string, relativeBase: string, visitedRealPaths: Set<string>): Promise<FileTreeNode[]> {
  let entries = await fs.readdir(directoryPath, { withFileTypes: true })
  entries = entries
    .filter((entry) => !shouldIgnoreProjectContentEntry(entry))
    .sort(compareProjectDirents)

  const nodes: FileTreeNode[] = []
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.join(relativeBase, entry.name))
    const entryStat = await statProjectContentEntry(entryPath)
    const isDirectory = entry.isDirectory() || Boolean(entry.isSymbolicLink() && entryStat?.isDirectory())
    const isFile = entry.isFile() || Boolean(entry.isSymbolicLink() && entryStat?.isFile())

    if (isDirectory) {
      nodes.push({
        name: entry.name,
        path: entryPath,
        relativePath,
        type: 'directory',
        children: await readChildDirectory(entryPath, relativePath, visitedRealPaths),
      })
      continue
    }

    if (isFile || entry.isSymbolicLink()) {
      nodes.push({
        name: entry.name,
        path: entryPath,
        relativePath,
        type: 'file',
      })
    }
  }

  return nodes
}

async function readChildDirectory(directoryPath: string, relativePath: string, parentVisitedRealPaths: Set<string>): Promise<FileTreeNode[]> {
  try {
    const realPath = await fs.realpath(directoryPath)
    if (parentVisitedRealPaths.has(realPath)) return []
    const nextVisitedRealPaths = new Set(parentVisitedRealPaths)
    nextVisitedRealPaths.add(realPath)
    return await readProjectDirectory(directoryPath, relativePath, nextVisitedRealPaths)
  } catch {
    return []
  }
}

async function statProjectContentEntry(entryPath: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.stat(entryPath)
  } catch {
    return null
  }
}

function createProjectFileWatcher(rootPath: string): FSWatcher {
  try {
    return watch(rootPath, { recursive: true }, (_eventType, filename) => {
      scheduleProjectFilesChanged(rootPath, filename)
    })
  } catch {
    return watch(rootPath, (_eventType, filename) => {
      scheduleProjectFilesChanged(rootPath, filename)
    })
  }
}

function scheduleProjectFilesChanged(rootPath: string, filename: string | Buffer | null): void {
  const relativePath = normalizeWatchRelativePath(filename)
  if (relativePath && shouldIgnoreWatchedPath(relativePath)) return
  const state = projectFileWatchers.get(rootPath)
  if (!state) return
  if (state.debounceTimer) clearTimeout(state.debounceTimer)
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null
    emitProjectFilesChanged({
      rootPath,
      relativePath,
    })
  }, PROJECT_FILE_WATCH_DEBOUNCE_MS)
}

function normalizeWatchRelativePath(filename: string | Buffer | null): string {
  if (!filename) return ''
  const raw = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename
  return normalizeRelativePath(raw)
}

function shouldIgnoreWatchedPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => PROJECT_CONTENT_IGNORED_DIRECTORIES.has(segment))
}

function disposeProjectFileWatcher(rootPath: string, state: ProjectFileWatcherState): void {
  if (state.debounceTimer) clearTimeout(state.debounceTimer)
  state.watcher.close()
  projectFileWatchers.delete(rootPath)
}

async function getProjectFilePreviewTextKind(filePath: string, name: string, size: number): Promise<ProjectFilePreviewTextKind | null> {
  const lowerName = name.toLowerCase()
  const extension = path.extname(lowerName)
  if (extension === '.md' || extension === '.markdown' || extension === '.mdx') return 'markdown'
  if (extension === '.json' || extension === '.jsonc' || extension === '.json5') return 'json'
  if (
    PROJECT_FILE_PREVIEW_TEXT_EXTENSIONS.has(extension) ||
    PROJECT_FILE_PREVIEW_TEXT_FILENAMES.has(lowerName) ||
    lowerName.startsWith('.env.') ||
    lowerName.endsWith('rc') ||
    lowerName.endsWith('.lock')
  ) {
    return 'text'
  }
  return (await isProbablyTextFile(filePath, size)) ? 'text' : null
}

function getProjectFilePreviewTextMimeType(kind: ProjectFilePreviewTextKind): string {
  if (kind === 'markdown') return 'text/markdown'
  if (kind === 'json') return 'application/json'
  return 'text/plain'
}

async function isProbablyTextFile(filePath: string, size: number): Promise<boolean> {
  const sampleSize = Math.min(Math.max(size, 0), PROJECT_FILE_PREVIEW_TEXT_SAMPLE_BYTES)
  if (sampleSize === 0) return true

  const handle = await fs.open(filePath, 'r')
  try {
    const sample = Buffer.alloc(sampleSize)
    const { bytesRead } = await handle.read(sample, 0, sampleSize, 0)
    return isProbablyTextBuffer(sample.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function isProbablyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true
  let suspiciousBytes = 0
  for (const byte of buffer) {
    if (byte === 0) return false
    const isAllowedControl = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13
    if ((byte < 32 && !isAllowedControl) || byte === 127) suspiciousBytes += 1
  }
  return suspiciousBytes / buffer.length < 0.01
}

async function safeReadDir(directoryPath: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function shouldIgnoreProjectContentEntry(entry: import('node:fs').Dirent): boolean {
  return entry.isDirectory() && PROJECT_CONTENT_IGNORED_DIRECTORIES.has(entry.name)
}

function compareProjectDirents(a: import('node:fs').Dirent, b: import('node:fs').Dirent): number {
  const typeDiff = Number(b.isDirectory()) - Number(a.isDirectory())
  return typeDiff || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function matchesQuery(name: string, relativePath: string, query: string): boolean {
  if (!query) return true
  return scorePathMatch(name, query) > 0 || scorePathMatch(relativePath, query) > 0
}

function scoreFileSearchItem(item: ProjectFileSearchItem, query: string): number {
  if (!query) return item.type === 'file' ? 2 : 1
  let score = scorePathMatch(item.label, query) * 1.7 + scorePathMatch(item.relativePath, query)
  if (item.type === 'directory') score += 8
  else score += 4
  score -= item.relativePath.length / 1000
  return score
}

function scorePathMatch(value: string, query: string): number {
  const normalizedValue = normalizeQuery(value)
  if (!query) return 1
  if (!normalizedValue) return 0
  if (normalizedValue === query) return 120
  if (normalizedValue.startsWith(query)) return 90
  const index = normalizedValue.indexOf(query)
  if (index >= 0) return 62 - Math.min(index, 42)
  return fuzzyPathScore(normalizedValue, query)
}

function fuzzyPathScore(value: string, query: string): number {
  let lastIndex = -1
  let score = 0
  for (const char of query) {
    const index = value.indexOf(char, lastIndex + 1)
    if (index === -1) return 0
    score += index === lastIndex + 1 ? 10 : 5
    if (index === 0 || '/-_ .'.includes(value[index - 1] ?? '')) score += 6
    lastIndex = index
  }
  return Math.max(1, score - value.length / 16)
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/')
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).filter(Boolean).join('/')
}

function isSameOrInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}
