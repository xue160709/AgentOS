/**
 * Agent Mode 项目设置持久化（开关与 USER/IDENTITY 回退读取）。
 * Persist Agent Mode per-project toggles with USER/IDENTITY.md fallbacks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ChatModelPick } from '../src/claude-chat-types'
import type {
  AgentMcpGlobalSettingsResult,
  AgentMcpServerConfig,
  AgentMcpServerOverrides,
  AgentMcpServerProbeCache,
  AgentMcpServerProbeSnapshot,
  AgentMcpServerTransport,
  AgentMcpToolDescriptor,
  AgentMcpToolPolicies,
  AgentMcpToolPolicy,
  AgentWebSearchProviderId,
  AgentWebSearchSettings,
  AgentWebSearchSettingsResult,
  AgentModeProjectSettings,
  AgentModeSettingsResult,
} from '../src/desktop-types'

type StoredAgentModeSettings = {
  enabled?: boolean
  todoEnabled?: boolean
  user?: string
  identity?: string
  projectModelPick?: ChatModelPick
  skillModelOverrides?: Record<string, ChatModelPick>
  mcpServers?: AgentMcpServerConfig[]
  mcpServerOverrides?: AgentMcpServerOverrides
  mcpToolPolicies?: AgentMcpToolPolicies
}

type AgentModeSettingsFile = {
  globalMcpServers?: AgentMcpServerConfig[]
  globalMcpServerProbeCache?: AgentMcpServerProbeCache
  globalWebSearchSettings?: AgentWebSearchSettings
  projects: Record<string, StoredAgentModeSettings>
}

const SETTINGS_FILE_NAME = 'agent-mode-settings.json'

/** userData 中的 Agent Mode 设置仓库 / Agent Mode settings store in userData */
export class AgentModeSettingsStore {
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, SETTINGS_FILE_NAME)
  }

  async getResult(rootPath: string): Promise<AgentModeSettingsResult> {
    const root = resolveWorkspacePath(rootPath)
    try {
      return {
        ok: true,
        rootPath: root,
        settings: await this.resolve(root),
      }
    } catch (error) {
      return {
        ok: false,
        rootPath: root,
        message: error instanceof Error ? error.message : '无法读取 Agent 模式设置',
      }
    }
  }

  async resolve(rootPath: string): Promise<AgentModeProjectSettings> {
    const root = resolveWorkspacePath(rootPath)
    const file = this.readFile()
    const stored = file.projects[root] ?? {}
    const globalServers = resolveGlobalMcpServers(file)
    const globalProbeCache = resolveGlobalMcpProbeCache(file, globalServers)
    const overrides = normalizeMcpServerOverrides(stored.mcpServerOverrides ?? projectOverridesFromLegacyServers(stored.mcpServers))
    return {
      enabled: stored.enabled === true,
      todoEnabled: stored.todoEnabled === true,
      user: typeof stored.user === 'string' ? stored.user : await readOptionalText(path.join(root, 'USER.md')),
      identity:
        typeof stored.identity === 'string' ? stored.identity : await readOptionalText(path.join(root, 'IDENTITY.md')),
      projectModelPick: stored.projectModelPick,
      skillModelOverrides: stored.skillModelOverrides ?? {},
      mcpServers: applyProjectMcpOverrides(globalServers, overrides),
      mcpServerOverrides: overrides,
      mcpToolPolicies: stored.mcpToolPolicies ?? {},
      mcpServerProbeCache: globalProbeCache,
    }
  }

  async getGlobalMcpSettings(): Promise<AgentMcpGlobalSettingsResult> {
    try {
      const file = this.readFile()
      const mcpServers = resolveGlobalMcpServers(file)
      return {
        ok: true,
        settings: {
          mcpServers,
          mcpServerProbeCache: resolveGlobalMcpProbeCache(file, mcpServers),
        },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '无法读取全局 MCP 设置',
      }
    }
  }

  async saveGlobalMcpSettings(payload: { mcpServers?: unknown }): Promise<AgentMcpGlobalSettingsResult> {
    try {
      const file = this.readFile()
      file.globalMcpServers = normalizeMcpServers(payload.mcpServers)
      file.globalMcpServerProbeCache = filterMcpProbeCache(file.globalMcpServerProbeCache, file.globalMcpServers)
      for (const entry of Object.values(file.projects)) {
        delete entry.mcpServers
      }
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      return {
        ok: true,
        settings: {
          mcpServers: file.globalMcpServers,
          mcpServerProbeCache: file.globalMcpServerProbeCache ?? {},
        },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '保存全局 MCP 设置失败',
      }
    }
  }

  async saveGlobalMcpProbeSnapshot(snapshot: AgentMcpServerProbeSnapshot): Promise<AgentMcpGlobalSettingsResult> {
    try {
      const file = this.readFile()
      const globalServers = resolveGlobalMcpServers(file)
      const matchingServer = globalServers.find((server) => server.name === snapshot.serverName)
      const nextCache = filterMcpProbeCache(file.globalMcpServerProbeCache, globalServers)
      if (matchingServer && snapshot.configSignature === buildAgentMcpServerConfigSignature(matchingServer)) {
        const normalizedSnapshot = normalizeMcpProbeSnapshot(snapshot)
        if (normalizedSnapshot) nextCache[snapshot.serverName] = normalizedSnapshot
      }
      file.globalMcpServerProbeCache = nextCache
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      return {
        ok: true,
        settings: {
          mcpServers: globalServers,
          mcpServerProbeCache: resolveGlobalMcpProbeCache(file, globalServers),
        },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '保存 MCP 测试结果失败',
      }
    }
  }

  async getGlobalWebSearchSettings(): Promise<AgentWebSearchSettingsResult> {
    try {
      return { ok: true, settings: normalizeWebSearchSettings(this.readFile().globalWebSearchSettings) }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '无法读取全局搜索设置',
      }
    }
  }

  async saveGlobalWebSearchSettings(payload: unknown): Promise<AgentWebSearchSettingsResult> {
    try {
      const file = this.readFile()
      file.globalWebSearchSettings = normalizeWebSearchSettings(payload)
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      return { ok: true, settings: file.globalWebSearchSettings }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '保存全局搜索设置失败',
      }
    }
  }

  async saveSettings(
    rootPath: string,
    payload: Partial<
      Pick<
        AgentModeProjectSettings,
        | 'user'
        | 'identity'
        | 'projectModelPick'
        | 'skillModelOverrides'
        | 'mcpServers'
        | 'mcpServerOverrides'
        | 'mcpToolPolicies'
      >
    >,
  ): Promise<AgentModeSettingsResult> {
    return this.save(rootPath, {
      ...(typeof payload.user === 'string' ? { user: payload.user } : {}),
      ...(typeof payload.identity === 'string' ? { identity: payload.identity } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'projectModelPick') ? { projectModelPick: normalizeModelPick(payload.projectModelPick) } : {}),
      ...(payload.skillModelOverrides ? { skillModelOverrides: normalizeSkillModelOverrides(payload.skillModelOverrides) } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'mcpServers') ? { mcpServerOverrides: projectOverridesFromLegacyServers(payload.mcpServers) } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'mcpServerOverrides')
        ? { mcpServerOverrides: normalizeMcpServerOverrides(payload.mcpServerOverrides) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'mcpToolPolicies') ? { mcpToolPolicies: normalizeMcpToolPolicies(payload.mcpToolPolicies) } : {}),
    })
  }

  async saveState(
    rootPath: string,
    payload: Partial<Pick<AgentModeProjectSettings, 'enabled' | 'todoEnabled'>>,
  ): Promise<AgentModeSettingsResult> {
    return this.save(rootPath, payload)
  }

  private async save(rootPath: string, partial: StoredAgentModeSettings): Promise<AgentModeSettingsResult> {
    const root = resolveWorkspacePath(rootPath)
    try {
      const file = this.readFile()
      const current = file.projects[root] ?? {}
      const next: StoredAgentModeSettings = {
        ...current,
        ...partial,
      }
      file.projects[root] = next
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      return { ok: true, rootPath: root, settings: await this.resolve(root) }
    } catch (error) {
      return {
        ok: false,
        rootPath: root,
        message: error instanceof Error ? error.message : '保存 Agent 模式设置失败',
      }
    }
  }

  private readFile(): AgentModeSettingsFile {
    if (!existsSync(this.filePath)) return { projects: {} }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object') return { projects: {} }
      const globalMcpServers = normalizeMcpServers((raw as Record<string, unknown>).globalMcpServers)
      const globalMcpServerProbeCache = normalizeMcpProbeCache((raw as Record<string, unknown>).globalMcpServerProbeCache)
      const globalWebSearchSettings = normalizeWebSearchSettings((raw as Record<string, unknown>).globalWebSearchSettings)
      const projectsRaw = (raw as Record<string, unknown>).projects
      if (!projectsRaw || typeof projectsRaw !== 'object') return { globalMcpServers, globalMcpServerProbeCache, globalWebSearchSettings, projects: {} }
      const projects: Record<string, StoredAgentModeSettings> = {}
      for (const [key, value] of Object.entries(projectsRaw)) {
        if (!value || typeof value !== 'object') continue
        const entry = value as Record<string, unknown>
        projects[resolveWorkspacePath(key)] = {
          enabled: entry.enabled === true,
          todoEnabled: entry.todoEnabled === true,
          user: typeof entry.user === 'string' ? entry.user : undefined,
          identity: typeof entry.identity === 'string' ? entry.identity : undefined,
          projectModelPick: normalizeModelPick(entry.projectModelPick),
          skillModelOverrides: normalizeSkillModelOverrides(entry.skillModelOverrides),
          mcpServers: normalizeMcpServers(entry.mcpServers),
          mcpServerOverrides: normalizeMcpServerOverrides(entry.mcpServerOverrides),
          mcpToolPolicies: normalizeMcpToolPolicies(entry.mcpToolPolicies),
        }
      }
      return { globalMcpServers, globalMcpServerProbeCache, globalWebSearchSettings, projects }
    } catch {
      return { projects: {} }
    }
  }
}

export function normalizeAgentMcpServers(value: unknown): AgentMcpServerConfig[] {
  return normalizeMcpServers(value)
}

export function buildAgentMcpServerConfigSignature(server: AgentMcpServerConfig): string {
  return JSON.stringify({
    transport: normalizeMcpTransport(server.transport),
    command: server.command.trim(),
    args: normalizeStringArray(server.args),
    env: normalizeStringRecord(server.env),
    cwd: server.cwd.trim(),
    url: server.url.trim(),
    headers: normalizeStringRecord(server.headers),
  })
}

export function getDefaultWebSearchSettings(): AgentWebSearchSettings {
  return {
    mode: 'native',
    provider: 'duckduckgo',
    braveApiKey: '',
    tavilyApiKey: '',
    braveApiKeys: [],
    tavilyApiKeys: [],
  }
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return ''
    throw error
  }
}

function resolveWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (trimmed.startsWith('~/')) return path.resolve(path.join(os.homedir(), trimmed.slice(2)))
  return path.resolve(trimmed)
}

function normalizeModelPick(value: unknown): ChatModelPick | undefined {
  if (!value || typeof value !== 'object') return undefined
  const pick = value as Record<string, unknown>
  const providerId = typeof pick.providerId === 'string' ? pick.providerId.trim() : ''
  const anthropicModel = typeof pick.anthropicModel === 'string' ? pick.anthropicModel.trim() : ''
  if (!providerId || !anthropicModel) return undefined
  return { providerId, anthropicModel }
}

function normalizeSkillModelOverrides(value: unknown): Record<string, ChatModelPick> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, ChatModelPick> = {}
  for (const [pathKey, rawPick] of Object.entries(value as Record<string, unknown>)) {
    if (!pathKey.trim() || !rawPick || typeof rawPick !== 'object') continue
    const modelPick = normalizeModelPick(rawPick)
    if (modelPick) out[pathKey] = modelPick
  }
  return out
}

function normalizeMcpServers(value: unknown): AgentMcpServerConfig[] {
  if (!Array.isArray(value)) return []
  const out: AgentMcpServerConfig[] = []
  const usedNames = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const rawName = typeof item.name === 'string' ? item.name.trim() : ''
    const name = uniqueMcpServerName(rawName || 'mcp-server', usedNames)
    const transport = normalizeMcpTransport(item.transport)
    out.push({
      name,
      enabled: item.enabled !== false,
      transport,
      command: typeof item.command === 'string' ? item.command.trim() : '',
      args: normalizeStringArray(item.args),
      env: normalizeStringRecord(item.env),
      cwd: typeof item.cwd === 'string' ? item.cwd.trim() : '',
      url: typeof item.url === 'string' ? item.url.trim() : '',
      headers: normalizeStringRecord(item.headers),
      alwaysLoad: item.alwaysLoad === true,
    })
  }
  return out
}

function resolveGlobalMcpServers(file: AgentModeSettingsFile): AgentMcpServerConfig[] {
  const global = normalizeMcpServers(file.globalMcpServers)
  const usedNames = new Set(global.map((server) => server.name))
  const migrated: AgentMcpServerConfig[] = [...global]
  for (const entry of Object.values(file.projects)) {
    for (const server of normalizeMcpServers(entry.mcpServers)) {
      if (usedNames.has(server.name)) continue
      usedNames.add(server.name)
      migrated.push(server)
    }
  }
  return migrated
}

function resolveGlobalMcpProbeCache(
  file: AgentModeSettingsFile,
  globalServers: AgentMcpServerConfig[],
): AgentMcpServerProbeCache {
  return filterMcpProbeCache(file.globalMcpServerProbeCache, globalServers)
}

function filterMcpProbeCache(
  cache: AgentMcpServerProbeCache | undefined,
  globalServers: AgentMcpServerConfig[],
): AgentMcpServerProbeCache {
  const normalizedCache = normalizeMcpProbeCache(cache)
  const out: AgentMcpServerProbeCache = {}
  for (const server of globalServers) {
    const snapshot = normalizedCache[server.name]
    if (!snapshot) continue
    if (snapshot.configSignature !== buildAgentMcpServerConfigSignature(server)) continue
    out[server.name] = snapshot
  }
  return out
}

function applyProjectMcpOverrides(
  globalServers: AgentMcpServerConfig[],
  overrides: AgentMcpServerOverrides,
): AgentMcpServerConfig[] {
  return globalServers
    .filter((server) => server.enabled)
    .map((server) => ({
      ...server,
      enabled: overrides[server.name]?.enabled !== false,
    }))
}

function projectOverridesFromLegacyServers(value: unknown): AgentMcpServerOverrides {
  const out: AgentMcpServerOverrides = {}
  for (const server of normalizeMcpServers(value)) {
    out[server.name] = { enabled: server.enabled !== false }
  }
  return out
}

function normalizeMcpServerOverrides(value: unknown): AgentMcpServerOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AgentMcpServerOverrides = {}
  for (const [rawName, rawConfig] of Object.entries(value as Record<string, unknown>)) {
    const name = rawName.trim()
    if (!name) continue
    if (typeof rawConfig === 'boolean') {
      out[name] = { enabled: rawConfig }
      continue
    }
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue
    out[name] = { enabled: (rawConfig as Record<string, unknown>).enabled !== false }
  }
  return out
}

function normalizeMcpTransport(value: unknown): AgentMcpServerTransport {
  if (value === 'http' || value === 'sse') return value
  return 'stdio'
}

function normalizeMcpToolPolicies(value: unknown): AgentMcpToolPolicies {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AgentMcpToolPolicies = {}
  for (const [toolName, rawPolicy] of Object.entries(value as Record<string, unknown>)) {
    const name = toolName.trim()
    if (!name) continue
    const policy = normalizeMcpToolPolicy(rawPolicy)
    if (policy) out[name] = policy
  }
  return out
}

function normalizeMcpToolPolicy(value: unknown): AgentMcpToolPolicy | undefined {
  if (value === 'allow' || value === 'deny' || value === 'ask') return value
  return undefined
}

function normalizeMcpProbeCache(value: unknown): AgentMcpServerProbeCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AgentMcpServerProbeCache = {}
  for (const [rawName, rawSnapshot] of Object.entries(value as Record<string, unknown>)) {
    const snapshot = normalizeMcpProbeSnapshot(rawSnapshot)
    if (!snapshot) continue
    const name = rawName.trim() || snapshot.serverName
    if (!name || snapshot.serverName !== name) continue
    out[name] = snapshot
  }
  return out
}

function normalizeMcpProbeSnapshot(value: unknown): AgentMcpServerProbeSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const serverName = typeof record.serverName === 'string' ? record.serverName.trim() : ''
  const status = normalizeMcpProbeStatus(record.status)
  const checkedAt = typeof record.checkedAt === 'string' ? record.checkedAt.trim() : ''
  const configSignature = typeof record.configSignature === 'string' ? record.configSignature : ''
  if (!serverName || !status || !checkedAt || !configSignature) return undefined
  const snapshot: AgentMcpServerProbeSnapshot = {
    serverName,
    status,
    checkedAt,
    configSignature,
    tools: normalizeMcpToolDescriptors(record.tools),
  }
  if (record.serverInfo && typeof record.serverInfo === 'object' && !Array.isArray(record.serverInfo)) {
    const serverInfo = record.serverInfo as Record<string, unknown>
    const name = typeof serverInfo.name === 'string' ? serverInfo.name.trim() : ''
    const version = typeof serverInfo.version === 'string' ? serverInfo.version.trim() : ''
    if (name) snapshot.serverInfo = { name, ...(version ? { version } : {}) }
  }
  if (typeof record.error === 'string' && record.error.trim()) snapshot.error = record.error.trim().slice(0, 1000)
  return snapshot
}

function normalizeMcpProbeStatus(value: unknown): AgentMcpServerProbeSnapshot['status'] | undefined {
  if (value === 'connected' || value === 'failed' || value === 'needs-auth' || value === 'pending' || value === 'disabled') return value
  return undefined
}

function normalizeMcpToolDescriptors(value: unknown): AgentMcpToolDescriptor[] {
  if (!Array.isArray(value)) return []
  const output: AgentMcpToolDescriptor[] = []
  const seen = new Set<string>()
  for (const rawTool of value) {
    if (!rawTool || typeof rawTool !== 'object' || Array.isArray(rawTool)) continue
    const tool = rawTool as Record<string, unknown>
    const name = typeof tool.name === 'string' ? tool.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const descriptor: AgentMcpToolDescriptor = { name }
    if (typeof tool.description === 'string' && tool.description.trim()) {
      descriptor.description = tool.description.trim().slice(0, 1000)
    }
    if (tool.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations)) {
      const annotations = tool.annotations as Record<string, unknown>
      descriptor.annotations = {
        ...(typeof annotations.readOnly === 'boolean' ? { readOnly: annotations.readOnly } : {}),
        ...(typeof annotations.destructive === 'boolean' ? { destructive: annotations.destructive } : {}),
        ...(typeof annotations.openWorld === 'boolean' ? { openWorld: annotations.openWorld } : {}),
      }
    }
    output.push(descriptor)
  }
  return output
}

export function normalizeWebSearchSettings(value: unknown): AgentWebSearchSettings {
  const defaults = getDefaultWebSearchSettings()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const record = value as Record<string, unknown>
  const braveApiKeys = normalizeApiKeyPool(record.braveApiKeys, record.braveApiKey)
  const tavilyApiKeys = normalizeApiKeyPool(record.tavilyApiKeys, record.tavilyApiKey)
  return {
    mode: record.mode === 'agentos' ? 'agentos' : 'native',
    provider: normalizeWebSearchProvider(record.provider),
    braveApiKey: braveApiKeys[0] ?? '',
    tavilyApiKey: tavilyApiKeys[0] ?? '',
    braveApiKeys,
    tavilyApiKeys,
  }
}

function normalizeApiKeyPool(poolValue: unknown, legacyValue: unknown): string[] {
  const source = Array.isArray(poolValue) ? poolValue : typeof legacyValue === 'string' ? [legacyValue] : []
  return source.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function normalizeWebSearchProvider(value: unknown): AgentWebSearchProviderId {
  if (value === 'brave' || value === 'tavily' || value === 'duckduckgo') return value
  if (value === 'duckduckgo-instant') return 'duckduckgo'
  return 'duckduckgo'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim()
    if (!key || typeof rawValue !== 'string') continue
    out[key] = rawValue.trim()
  }
  return out
}

function uniqueMcpServerName(rawName: string, usedNames: Set<string>): string {
  const base = rawName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'mcp-server'
  let name = base
  let suffix = 2
  while (usedNames.has(name)) {
    name = `${base}-${suffix}`
    suffix += 1
  }
  usedNames.add(name)
  return name
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
