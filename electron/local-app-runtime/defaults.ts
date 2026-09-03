export const LOCAL_APP_RUNTIME_DEFAULTS = {
  prepareTimeoutMs: 120_000,
  readinessTimeoutMs: 60_000,
  probeIntervalMs: 250,
  probeTimeoutMs: 1_000,
  maxPortAttempts: 3,
  crashRetryCount: 3,
  crashRetryDelaysMs: [1_000, 2_000, 4_000],
  termTimeoutMs: 3_000,
  killTimeoutMs: 2_000,
  quitCleanupTimeoutMs: 5_000,
  logLineLimit: 2_000,
  logBufferLines: 160,
} as const

export type RuntimeDefaults = typeof LOCAL_APP_RUNTIME_DEFAULTS

export type RuntimeLogEntry = {
  stream: 'stdout' | 'stderr'
  line: string
  timestamp: number
}

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}
