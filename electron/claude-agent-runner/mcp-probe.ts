/**
 * Best-effort MCP connection probe used by the global settings page.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentMcpServerConfig,
  AgentMcpServerProbeResult,
  AgentMcpServerProbeSnapshot,
  AgentMcpServerProbeStatus,
  AgentMcpToolDescriptor,
} from '../../src/desktop-types'
import { buildAgentMcpServerConfigSignature } from '../agent-mode-settings-store'
import { buildMcpRuntimeOptions } from './mcp'

type EnvSource = Record<string, string | undefined>

type RuntimeStdioConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
}

type RuntimeRemoteConfig = {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

type JsonRpcResponse = {
  id?: number
  result?: unknown
  error?: {
    code?: number
    message?: string
  }
}

const MCP_PROTOCOL_VERSION = '2024-11-05'
const DEFAULT_PROBE_TIMEOUT_MS = 15_000

export async function probeMcpServer(
  server: AgentMcpServerConfig,
  options: { env?: EnvSource; timeoutMs?: number } = {},
): Promise<AgentMcpServerProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const configSignature = buildAgentMcpServerConfigSignature(server)

  if (!server.enabled) {
    return {
      ok: true,
      snapshot: createProbeSnapshot(server, 'disabled', configSignature, { tools: [] }),
    }
  }

  const runtime = buildMcpRuntimeOptions(
    { mcpServers: [{ ...server, enabled: true }], mcpToolPolicies: {} },
    [],
    options.env ?? process.env,
  )
  if (runtime.unresolvedEnv.length > 0) {
    const variables = [...new Set(runtime.unresolvedEnv.map((item) => item.variable))].join(', ')
    return createFailedProbe(server, configSignature, `未解析环境变量：${variables}`)
  }

  const runtimeServer = runtime.mcpServers?.[server.name]
  if (!runtimeServer) {
    return createFailedProbe(server, configSignature, 'MCP 配置不完整，无法启动连接测试。')
  }

  try {
    if (server.transport === 'stdio') {
      const result = await probeStdioMcpServer(server, runtimeServer as RuntimeStdioConfig, timeoutMs)
      return {
        ok: true,
        snapshot: createProbeSnapshot(server, 'connected', configSignature, result),
      }
    }

    const result = await probeRemoteMcpServer(runtimeServer as RuntimeRemoteConfig, timeoutMs)
    return {
      ok: true,
      snapshot: createProbeSnapshot(server, 'connected', configSignature, result),
    }
  } catch (error) {
    if (error instanceof NeedsAuthError) {
      const message = error.message || '远端 MCP 服务需要认证。'
      return {
        ok: false,
        message,
        snapshot: createProbeSnapshot(server, 'needs-auth', configSignature, {
          tools: [],
          error: message,
        }),
      }
    }
    return createFailedProbe(server, configSignature, error instanceof Error ? error.message : String(error))
  }
}

export function parseMcpEventStreamPayload(text: string): unknown {
  const dataLines: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) return undefined
  const payload = dataLines.join('\n').trim()
  if (!payload || payload === '[DONE]') return undefined
  return JSON.parse(payload)
}

async function probeStdioMcpServer(
  server: AgentMcpServerConfig,
  config: RuntimeStdioConfig,
  timeoutMs: number,
): Promise<{ serverInfo?: AgentMcpServerProbeSnapshot['serverInfo']; tools: AgentMcpToolDescriptor[] }> {
  const child = spawn(config.command, config.args ?? [], {
    cwd: resolveProbeCwd(server.cwd),
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: 'pipe',
  })
  const rpc = createStdioRpcClient(child, config.command)

  try {
    const initialized = await rpc.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'AgentOS',
          version: '0.1.15',
        },
      },
      timeoutMs,
    )
    rpc.notify('notifications/initialized')
    const toolsResult = await rpc.request('tools/list', {}, timeoutMs)
    return {
      serverInfo: normalizeServerInfo(initialized),
      tools: normalizeToolsFromResult(toolsResult),
    }
  } finally {
    rpc.dispose()
  }
}

async function probeRemoteMcpServer(
  config: RuntimeRemoteConfig,
  timeoutMs: number,
): Promise<{ serverInfo?: AgentMcpServerProbeSnapshot['serverInfo']; tools: AgentMcpToolDescriptor[] }> {
  const initialize = await postJsonRpc(config.url, config.headers ?? {}, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'AgentOS',
        version: '0.1.15',
      },
    },
  }, timeoutMs)
  const sessionHeaders: Record<string, string> = initialize.sessionId ? { 'Mcp-Session-Id': initialize.sessionId } : {}
  const headers = { ...(config.headers ?? {}), ...sessionHeaders }
  await postJsonRpc(config.url, headers, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, timeoutMs)
  const tools = await postJsonRpc(config.url, headers, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, timeoutMs)
  return {
    serverInfo: normalizeServerInfo(initialize.result),
    tools: normalizeToolsFromResult(tools.result),
  }
}

function createStdioRpcClient(child: ChildProcessWithoutNullStreams, command: string): {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>
  notify(method: string, params?: unknown): void
  dispose(): void
} {
  let nextId = 1
  let stdoutBuffer = ''
  let stderrBuffer = ''
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  const rejectAll = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    let newlineIndex = stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      handleJsonRpcLine(line, pending)
      newlineIndex = stdoutBuffer.indexOf('\n')
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer = summarizeProbeText(`${stderrBuffer}${chunk.toString('utf8')}`)
  })

  child.once('error', (error) => {
    rejectAll(new Error(formatStdioSpawnError(command, error)))
  })

  child.once('exit', (code, signal) => {
    if (pending.size === 0) return
    const detail = stderrBuffer ? `：${stderrBuffer}` : ''
    rejectAll(new Error(`MCP 进程提前退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）${detail}`))
  })

  return {
    request(method: string, params: unknown, timeoutMs: number) {
      const id = nextId
      nextId += 1
      const payload = { jsonrpc: '2.0', id, method, params }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          const detail = stderrBuffer ? `：${stderrBuffer}` : ''
          reject(new Error(`MCP 连接测试超时${detail}`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', (error) => {
          if (!error) return
          clearTimeout(timer)
          pending.delete(id)
          reject(new Error(`写入 MCP 请求失败：${error.message}`))
        })
      })
    },
    notify(method: string, params?: unknown) {
      const payload = params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    },
    dispose() {
      rejectAll(new Error('MCP 连接测试已结束。'))
      if (!child.killed) child.kill('SIGTERM')
      const killTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 800)
      killTimer.unref?.()
    },
  }
}

function formatStdioSpawnError(command: string, error: Error): string {
  if (isNodeError(error) && error.code === 'ENOENT') {
    return `启动失败：找不到 MCP 命令 ${command}（${error.message}）。请确认命令已安装，或在命令字段填写绝对路径。`
  }
  return `启动失败：${error.message}`
}

function handleJsonRpcLine(
  line: string,
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>,
): void {
  if (!line) return
  let message: JsonRpcResponse
  try {
    message = JSON.parse(line) as JsonRpcResponse
  } catch {
    return
  }
  if (typeof message.id !== 'number') return
  const entry = pending.get(message.id)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(message.id)
  if (message.error) {
    entry.reject(new Error(message.error.message || `MCP JSON-RPC 错误 ${message.error.code ?? ''}`.trim()))
    return
  }
  entry.resolve(message.result)
}

async function postJsonRpc(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ result?: unknown; sessionId?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new NeedsAuthError(`认证失败（HTTP ${response.status}）`)
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${text.trim() ? `：${summarizeProbeText(text)}` : ''}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    const message = parseJsonRpcHttpPayload(contentType, text)
    if (!message) return { sessionId: response.headers.get('mcp-session-id') ?? undefined }
    if (isJsonRpcError(message)) {
      throw new Error(message.error.message || `MCP JSON-RPC 错误 ${message.error.code ?? ''}`.trim())
    }
    return {
      result: isRecord(message) && Object.prototype.hasOwnProperty.call(message, 'result') ? message.result : undefined,
      sessionId: response.headers.get('mcp-session-id') ?? undefined,
    }
  } catch (error) {
    if (error instanceof NeedsAuthError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new Error('MCP 连接测试超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonRpcHttpPayload(contentType: string, text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (contentType.includes('text/event-stream')) return parseMcpEventStreamPayload(trimmed)
  return JSON.parse(trimmed)
}

function normalizeServerInfo(value: unknown): AgentMcpServerProbeSnapshot['serverInfo'] | undefined {
  const record = isRecord(value) && isRecord(value.serverInfo) ? value.serverInfo : undefined
  if (!record) return undefined
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const version = typeof record.version === 'string' ? record.version.trim() : ''
  if (!name) return undefined
  return { name, ...(version ? { version } : {}) }
}

function normalizeToolsFromResult(value: unknown): AgentMcpToolDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) return []
  const output: AgentMcpToolDescriptor[] = []
  const seen = new Set<string>()
  for (const rawTool of value.tools) {
    if (!isRecord(rawTool)) continue
    const name = typeof rawTool.name === 'string' ? rawTool.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const tool: AgentMcpToolDescriptor = { name }
    if (typeof rawTool.description === 'string' && rawTool.description.trim()) {
      tool.description = rawTool.description.trim().slice(0, 1000)
    }
    if (isRecord(rawTool.annotations)) {
      tool.annotations = {
        ...(typeof rawTool.annotations.readOnly === 'boolean' ? { readOnly: rawTool.annotations.readOnly } : {}),
        ...(typeof rawTool.annotations.destructive === 'boolean' ? { destructive: rawTool.annotations.destructive } : {}),
        ...(typeof rawTool.annotations.openWorld === 'boolean' ? { openWorld: rawTool.annotations.openWorld } : {}),
      }
    }
    output.push(tool)
  }
  return output
}

function createProbeSnapshot(
  server: AgentMcpServerConfig,
  status: AgentMcpServerProbeStatus,
  configSignature: string,
  details: {
    serverInfo?: AgentMcpServerProbeSnapshot['serverInfo']
    tools: AgentMcpToolDescriptor[]
    error?: string
  },
): AgentMcpServerProbeSnapshot {
  return {
    serverName: server.name,
    status,
    checkedAt: new Date().toISOString(),
    configSignature,
    tools: details.tools,
    ...(details.serverInfo ? { serverInfo: details.serverInfo } : {}),
    ...(details.error ? { error: details.error } : {}),
  }
}

function createFailedProbe(
  server: AgentMcpServerConfig,
  configSignature: string,
  message: string,
): AgentMcpServerProbeResult {
  const safeMessage = summarizeProbeText(message)
  return {
    ok: false,
    message: safeMessage,
    snapshot: createProbeSnapshot(server, 'failed', configSignature, {
      tools: [],
      error: safeMessage,
    }),
  }
}

function resolveProbeCwd(cwd: string): string | undefined {
  const trimmed = cwd.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('~/')) return path.resolve(os.homedir(), trimmed.slice(2))
  return path.resolve(trimmed)
}

function summarizeProbeText(value: string): string {
  return value
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/(token|key|secret|authorization)=([^\s]+)/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000)
}

function isJsonRpcError(value: unknown): value is { error: { code?: number; message?: string } } {
  return isRecord(value) && isRecord(value.error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

class NeedsAuthError extends Error {}
