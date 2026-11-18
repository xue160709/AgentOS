import { createServer } from 'node:net'
import { LOCAL_APP_RUNTIME_DEFAULTS } from './defaults'

export function normalizeLoopbackUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const host = url.hostname.toLowerCase()
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') return null
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function parseLoopbackReadyUrl(line: string): string | null {
  const matches = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)(?:[^\s)'"`]*)?/gi) ?? []
  for (const match of matches) {
    const normalized = normalizeLoopbackUrl(match)
    if (normalized) return normalized
  }
  return null
}

export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('dynamic-port-unavailable'))
      })
    })
  })
}

export async function probeLoopbackReady(
  readyUrl: string,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const normalized = normalizeLoopbackUrl(readyUrl)
  if (!normalized) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_APP_RUNTIME_DEFAULTS.probeTimeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await (options.fetch ?? globalThis.fetch)(normalized, { redirect: 'manual', signal: controller.signal })
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const finish = () => {
      clearTimeout(timer)
      cleanup()
      resolve()
    }
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
