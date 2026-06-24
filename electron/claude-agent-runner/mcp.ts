/**
 * Project-level MCP config adapters for Claude Agent SDK runtime options.
 */

import type { McpServerConfig, McpServerToolPolicy } from '@anthropic-ai/claude-agent-sdk'
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

export function buildMcpRuntimeOptions(
  settings: Pick<AgentModeProjectSettings, 'mcpServers' | 'mcpToolPolicies'> | undefined,
  baseAllowedTools: readonly string[],
  env: EnvSource,
): McpRuntimeOptions {
  const unresolvedEnv: McpEnvReference[] = []
  const mcpServers: Record<string, McpServerConfig> = {}

  for (const server of settings?.mcpServers ?? []) {
    if (!server.enabled) continue
    const name = normalizeMcpServerName(server.name)
    if (!name) continue

    if (server.transport === 'stdio') {
      const command = resolveMcpTemplate(server.command, env, unresolvedEnv, name, 'command').trim()
      if (!command) continue
      const resolvedEnv = resolveMcpRecord(server.env, env, unresolvedEnv, name, 'env')
      mcpServers[name] = {
        type: 'stdio',
        command,
        args: server.args.map((arg, index) => resolveMcpTemplate(arg, env, unresolvedEnv, name, `args[${index}]`)),
        env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
        alwaysLoad: server.alwaysLoad || undefined,
      }
      continue
    }

    const url = resolveMcpTemplate(server.url, env, unresolvedEnv, name, 'url').trim()
    if (!url) continue
    const headers = resolveMcpRecord(server.headers, env, unresolvedEnv, name, 'headers')
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
