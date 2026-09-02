/**
 * 工作区保存链路基准：对比逐事件落盘与暂存落盘的主线程占用。
 * Benchmark the workspace persistence hot path.
 *
 * Loads the real `ChatWorkspaceStore` (transpiled on the fly, the same way the
 * electron tests do) and replays a run's worth of streaming deltas twice: once
 * through the durable `save()` path that mid-run events used before the staged
 * write existed, and once through `stage()` plus a single terminal flush.
 *
 * Usage:
 *   node scripts/perf-bench-workspace-store.mjs [pathToWorkspaceJson] [deltaCount]
 *
 * With no argument it reads the current user's workspace on macOS. Any
 * `chat-workspace.json` works, so a colleague's export can be measured too.
 * Nothing is written to the source workspace; every run uses a temp directory.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))
const ts = require('typescript')

const DEFAULT_WORKSPACE = join(homedir(), 'Library/Application Support/AgentOS/chat-workspace.json')
const workspacePath = process.argv[2] || DEFAULT_WORKSPACE
const deltaCount = Number(process.argv[3] || 40)
/** Coalescer ceiling in electron/claude-agent-runner/event-coalescer.ts (50ms window). */
const EVENTS_PER_SECOND = 20

if (!existsSync(workspacePath)) {
  console.error(`No workspace at ${workspacePath}. Pass a path to a chat-workspace.json.`)
  process.exit(1)
}

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

const { ChatWorkspaceStore } = loadTsModule(join(ROOT, 'electron/chat-workspace-store.ts'))
const workspace = JSON.parse(readFileSync(workspacePath, 'utf8'))

const since = (start) => Number(process.hrtime.bigint() - start) / 1e6
const now = () => process.hrtime.bigint()

/** Mutate one thread the way an assistant_delta does: grow the newest message. */
function withGrownDelta(state, length) {
  const target = state.threads[1] ?? state.threads[0]
  if (!target) throw new Error('workspace has no threads to stream into')
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.id !== target.id
        ? thread
        : {
            ...thread,
            updatedAt: Date.now(),
            chatState: {
              ...thread.chatState,
              items: [
                ...thread.chatState.items.slice(0, -1),
                { ...thread.chatState.items[thread.chatState.items.length - 1], content: 'x'.repeat(length) },
              ],
            },
          },
    ),
  }
}

async function measure(mode) {
  const dir = await mkdtemp(join(tmpdir(), 'agentos-perf-'))
  try {
    const store = new ChatWorkspaceStore(dir, { durableFlushDelayMs: 60_000 })
    await store.save(workspace) // committed baseline, excluded from the measurement
    let streamMs = 0
    for (let index = 1; index <= deltaCount; index += 1) {
      const next = withGrownDelta(store.current(), index * 40)
      const start = now()
      if (mode === 'durable-per-event') await store.save(next)
      else store.stage(next)
      streamMs += since(start)
    }
    const terminalStart = now()
    if (mode !== 'durable-per-event') await store.flushPending()
    const terminalMs = since(terminalStart)
    const perEvent = streamMs / deltaCount
    return {
      perEventMs: Number(perEvent.toFixed(3)),
      runTotalMs: Number((streamMs + terminalMs).toFixed(1)),
      terminalFlushMs: Number(terminalMs.toFixed(1)),
      mainThreadPctAt20Hz: Number(((perEvent * EVENTS_PER_SECOND) / 10).toFixed(2)),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const before = await measure('durable-per-event')
const after = await measure('staged')

console.log(
  JSON.stringify(
    {
      workspacePath,
      workspaceBytes: JSON.stringify(workspace).length,
      threads: workspace.threads?.length ?? 0,
      deltaCount,
      eventsPerSecond: EVENTS_PER_SECOND,
      durablePerEvent: before,
      staged: after,
      speedup: Number((before.perEventMs / Math.max(after.perEventMs, 0.001)).toFixed(0)),
    },
    null,
    1,
  ),
)
