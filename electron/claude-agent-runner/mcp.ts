/**
 * Project-level MCP config adapters for Claude Agent SDK runtime options.
 */

import type { McpServerConfig, McpServerToolPolicy } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentMcpToolPolicy, AgentModeProjectSettings } from '../../src/desktop-types'

type EnvSource = Record<string, string | undefined>

export type McpRuntimeOptions = {
  mcpServers?: Record<string, McpServerConfig>
  allowedTools: string[]
  disallowedTools?: string[]
  toolAliases?: Record<string, string>
  configSignature: string
  unresolvedEnv: McpEnvReference[]
}

export type McpEnvReference = {
  serverName: string
  field: string
  variable: string
}

const MCP_ENV_REF_PATTERN = /\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g
const POSIX_PATH_KEY = 'PATH'
const WINDOWS_PATH_KEY = 'Path'

export function buildMcpRuntimeOptions(
  settings: Pick<AgentModeProjectSettings, 'mcpServers' | 'mcpToolPolicies'> | undefined,
  baseAllowedTools: readonly string[],
  env: EnvSource,
): McpRuntimeOptions {
  const executableEnv = buildMcpExecutableEnv(env)
  const unresolvedEnv: McpEnvReference[] = []
  const mcpServers: Record<string, McpServerConfig> = {}

  for (const server of settings?.mcpServers ?? []) {
    if (!server.enabled) continue
    const name = normalizeMcpServerName(server.name)
    if (!name) continue

    if (server.transport === 'stdio') {
      const command = resolveMcpTemplate(server.command, executableEnv, unresolvedEnv, name, 'command').trim()
      if (!command) continue
      const resolvedEnv = withExecutablePathEnv(resolveMcpRecord(server.env, executableEnv, unresolvedEnv, name, 'env'), executableEnv)
      mcpServers[name] = {
        type: 'stdio',
        command: resolveMcpExecutableCommand(command, executableEnv),
        args: server.args.map((arg, index) => resolveMcpTemplate(arg, executableEnv, unresolvedEnv, name, `args[${index}]`)),
        env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
        alwaysLoad: server.alwaysLoad || undefined,
      }
      continue
    }

    const url = resolveMcpTemplate(server.url, executableEnv, unresolvedEnv, name, 'url').trim()
    if (!url) continue
    const headers = resolveMcpRecord(server.headers, executableEnv, unresolvedEnv, name, 'headers')
    const tools = buildRemoteToolPolicies(name, settings?.mcpToolPolicies ?? {})
    mcpServers[name] = {
      type: server.transport,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      tools: tools.length > 0 ? tools : undefined,
      alwaysLoad: server.alwaysLoad || undefined,
    }
  }

  const allowedTools = uniqueStrings([
    ...baseAllowedTools,
    ...Object.entries(settings?.mcpToolPolicies ?? {})
      .filter(([, policy]) => policy === 'allow')
      .map(([toolName]) => toolName),
  ])
  const disallowedTools = uniqueStrings(
    Object.entries(settings?.mcpToolPolicies ?? {})
      .filter(([, policy]) => policy === 'deny')
      .map(([toolName]) => toolName),
  )

  return {
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
    allowedTools,
    disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
    configSignature: JSON.stringify({
      servers: settings?.mcpServers ?? [],
      policies: settings?.mcpToolPolicies ?? {},
    }),
    unresolvedEnv,
  }
}

export function mergeMcpRuntimeOptions(...runtimes: McpRuntimeOptions[]): McpRuntimeOptions {
  const mcpServers: Record<string, McpServerConfig> = {}
  const unresolvedEnv: McpEnvReference[] = []
  const toolAliases: Record<string, string> = {}

  for (const runtime of runtimes) {
    Object.assign(mcpServers, runtime.mcpServers ?? {})
    Object.assign(toolAliases, runtime.toolAliases ?? {})
    unresolvedEnv.push(...runtime.unresolvedEnv)
  }

  return {
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
    allowedTools: uniqueStrings(runtimes.flatMap((runtime) => runtime.allowedTools)),
    disallowedTools: uniqueStrings(runtimes.flatMap((runtime) => runtime.disallowedTools ?? [])),
    toolAliases: Object.keys(toolAliases).length > 0 ? toolAliases : undefined,
    configSignature: JSON.stringify(runtimes.map((runtime) => runtime.configSignature)),
    unresolvedEnv,
  }
}

export function buildMcpExecutableEnv(env: EnvSource): EnvSource {
  const pathKey = findPathEnvKey(env)
  const currentPath = pathKey ? env[pathKey] ?? '' : ''
  if (!currentPath.trim()) return env

  const nextPath = uniquePathEntries([
    ...splitPathEntries(currentPath),
    ...getCommonExecutableDirectories(env),
  ]).join(path.delimiter)
  if (!nextPath || nextPath === currentPath) return env
  return {
    ...env,
    [pathKey ?? defaultPathEnvKey()]: nextPath,
  }
}

export function resolveMcpExecutableCommand(command: string, env: EnvSource): string {
  const trimmed = command.trim()
  if (!trimmed) return trimmed
  if (hasPathSeparator(trimmed)) return expandHomePath(trimmed, env)
  if (/\s/.test(trimmed)) return trimmed

  for (const directory of getPathEntries(env)) {
    for (const candidate of getExecutableCandidates(path.join(directory, trimmed))) {
      if (existsSync(candidate)) return candidate
    }
  }

  return trimmed
}

export function isMcpToolName(toolName: string): boolean {
  return Boolean(parseMcpToolName(toolName))
}

export function formatMcpToolDisplayName(toolName: string): string {
  const parsed = parseMcpToolName(toolName)
  if (!parsed) return toolName
  return `${parsed.server} · ${parsed.tool}`
}

export function buildMcpPermissionCopy(toolName: string, fallbackTitle?: string, fallbackDisplayName?: string) {
  if (!isMcpToolName(toolName)) {
    return {
      title: fallbackTitle || `${toolName} 需要权限`,
      displayName: fallbackDisplayName || toolName,
    }
  }
  const displayName = fallbackDisplayName || formatMcpToolDisplayName(toolName)
  return {
    title: fallbackTitle || 'MCP 权限请求',
    displayName,
  }
}

function parseMcpToolName(toolName: string): { server: string; tool: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (!match) return undefined
  const [, server, tool] = match
  if (!server || !tool) return undefined
  return { server, tool }
}

function buildRemoteToolPolicies(serverName: string, policies: Record<string, AgentMcpToolPolicy>): McpServerToolPolicy[] {
  const prefix = `mcp__${serverName}__`
  const output: McpServerToolPolicy[] = []
  for (const [toolName, policy] of Object.entries(policies)) {
    if (!toolName.startsWith(prefix)) continue
    const name = toolName.slice(prefix.length).trim()
    if (!name) continue
    output.push({
      name,
      permission_policy:
        policy === 'allow'
          ? 'always_allow'
          : policy === 'deny'
            ? 'always_deny'
            : 'always_ask',
    })
  }
  return output
}

function resolveMcpRecord(
  record: Record<string, string>,
  env: EnvSource,
  unresolvedEnv: McpEnvReference[],
  serverName: string,
  field: string,
): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    const nextKey = key.trim()
    if (!nextKey) continue
    output[nextKey] = resolveMcpTemplate(value, env, unresolvedEnv, serverName, `${field}.${nextKey}`)
  }
  return output
}

function resolveMcpTemplate(
  value: string,
  env: EnvSource,
  unresolvedEnv: McpEnvReference[],
  serverName: string,
  field: string,
): string {
  return value.replace(MCP_ENV_REF_PATTERN, (match, variable: string) => {
    const resolved = env[variable]
    if (resolved === undefined) {
      unresolvedEnv.push({ serverName, field, variable })
      return match
    }
    return resolved
  })
}

function normalizeMcpServerName(name: string): string {
  return name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64)
}

function withExecutablePathEnv(serverEnv: Record<string, string>, executableEnv: EnvSource): Record<string, string> {
  const pathKey = findPathEnvKey(executableEnv)
  const executablePath = pathKey ? executableEnv[pathKey] : undefined
  if (!pathKey || !executablePath) return serverEnv
  if (findPathEnvKey(serverEnv)) return serverEnv
  // release 版从 Finder 启动时 PATH 通常很短；stdio MCP 子进程需要这份 PATH 才能执行 npx/node/uvx 等本机命令。
  return { ...serverEnv, [pathKey]: executablePath }
}

function getPathEntries(env: EnvSource): string[] {
  const pathKey = findPathEnvKey(env)
  return pathKey ? splitPathEntries(env[pathKey] ?? '') : []
}

function splitPathEntries(value: string): string[] {
  return value.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean)
}

function findPathEnvKey(env: EnvSource): string | undefined {
  if (env[POSIX_PATH_KEY] !== undefined) return POSIX_PATH_KEY
  if (env[WINDOWS_PATH_KEY] !== undefined) return WINDOWS_PATH_KEY
  return Object.keys(env).find((key) => key.toLowerCase() === 'path')
}

function defaultPathEnvKey(): string {
  return process.platform === 'win32' ? WINDOWS_PATH_KEY : POSIX_PATH_KEY
}

function getCommonExecutableDirectories(env: EnvSource): string[] {
  if (process.platform === 'win32') return []
  const home = resolveHomeDir(env)
  return uniquePathEntries([
    ...(home
      ? [
          path.join(home, '.local', 'bin'),
          path.join(home, 'bin'),
          path.join(home, '.npm-global', 'bin'),
          path.join(home, '.volta', 'bin'),
          path.join(home, '.asdf', 'shims'),
          path.join(home, '.bun', 'bin'),
          path.join(home, '.local', 'share', 'mise', 'shims'),
          path.join(home, '.mise', 'shims'),
          ...getVersionedNodeBins(path.join(home, '.nvm', 'versions', 'node')),
          ...getVersionedFnmBins(path.join(home, '.local', 'share', 'fnm', 'node-versions')),
          ...getVersionedFnmBins(path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions')),
        ]
      : []),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ])
}

function getVersionedNodeBins(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareNodeVersionNamesDesc)
      .map((name) => path.join(root, name, 'bin'))
  } catch {
    return []
  }
}

function getVersionedFnmBins(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareNodeVersionNamesDesc)
      .map((name) => path.join(root, name, 'installation', 'bin'))
  } catch {
    return []
  }
}

function compareNodeVersionNamesDesc(a: string, b: string): number {
  const left = parseNodeVersionName(a)
  const right = parseNodeVersionName(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0)
    if (diff !== 0) return diff
  }
  return b.localeCompare(a)
}

function parseNodeVersionName(value: string): number[] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value)
  if (!match) return [0, 0, 0]
  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function resolveHomeDir(env: EnvSource): string {
  return env.HOME?.trim() || os.homedir()
}

function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function expandHomePath(value: string, env: EnvSource): string {
  if (value === '~') return resolveHomeDir(env)
  if (!value.startsWith('~/')) return value
  return path.join(resolveHomeDir(env), value.slice(2))
}

function getExecutableCandidates(candidate: string): string[] {
  if (process.platform !== 'win32') return [candidate]
  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
  if (extensions.some((extension) => candidate.toLowerCase().endsWith(extension.toLowerCase()))) return [candidate]
  return [candidate, ...extensions.map((extension) => `${candidate}${extension.toLowerCase()}`)]
}

function uniquePathEntries(values: string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    output.push(trimmed)
  }
  return output
}

function uniqueStrings(values: string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    output.push(trimmed)
  }
  return output
}
