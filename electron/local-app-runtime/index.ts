/**
 * Runtime module surface. 只有 Main 能调用这里的进程能力；renderer 只能通过
 * named Desktop Seam 传入 Runtime id 和受信定义，不能传 executable/args/env/URL。
 *
 * 每个 module 住在自己的文件里，这里只保留调用方使用的 interface：
 *
 * - `paths` / `defaults` / `loopback` —— Runtime 的固定事实与 loopback 原语
 * - `inspect` —— 目录事实与 serve 决策的单一 owner
 * - `snapshot-state` —— snapshot 状态机
 * - `child-process` —— 受监督子进程（spawn / 日志 / 退出 / 终止）
 * - `liveness-bridge` —— 桥接器源码模板
 * - `static-build` —— 静态 build 的所有权与取消 fence
 * - `supervisor` / `manager` / `lease-book` —— 生命周期、归属与根租约
 * - `edit-bridge` / `trust-store` —— 各自独立的 adapter 与授权存储
 */

export { LOCAL_APP_RUNTIME_DEFAULTS } from './defaults'
export type { RuntimeDefaults, RuntimeLogEntry } from './defaults'

export { PROJECT_AGENTOS_RUNTIME_DIRECTORY, isContainedInProject, projectRuntimeRoot } from './paths'

export { allocateLoopbackPort, normalizeLoopbackUrl, parseLoopbackReadyUrl, probeLoopbackReady, waitWithAbort } from './loopback'

export {
  RuntimeChildProcess,
  buildAllowedRuntimeEnv,
  readableFailureReason,
  redactRuntimeLine,
  terminateNextDevLockOwners,
  terminateProcessTree,
} from './child-process'
export type { RuntimeChildExit, RuntimeChildSpec, RuntimeProcess } from './child-process'

export { runtimeDevCommandArgs } from './liveness-bridge'

export {
  RuntimeInspectionPass,
  canonicalizeLocalAppRoot,
  inspectLocalAppDirectory,
  runtimeServeDecision,
  servedRuntimeDefinition,
} from './inspect'
export type {
  LocalAppInspectFailureCode,
  LocalAppInspectResult,
  RuntimeDirectoryFacts,
  RuntimeServeDecision,
} from './inspect'

export { RuntimeSnapshotTransitions } from './snapshot-state'

export { StaticBuildFence } from './static-build'
export type { BuildFailureKind, BuildStepOutcome } from './static-build'

export { LocalAppRuntimeSupervisor } from './supervisor'
export type {
  RuntimeBuildOptions,
  RuntimeStartOptions,
  RuntimeStaticOutputValidator,
  RuntimeStaticSourceFingerprinter,
  RuntimeSupervisorOptions,
} from './supervisor'

export { RuntimeLeaseBook, runtimeScopeForDefinition } from './lease-book'

export { LocalAppRuntimeManager } from './manager'
export type { RuntimeManagerOptions } from './manager'

export { RuntimeEditRuntimeBridge } from './edit-bridge'

export { LocalAppTrustStore } from './trust-store'

// Neutral Revision 2 exports. The physical directory remains for safe
// migration, while new callers use Runtime terminology.
export { LocalAppRuntimeManager as RuntimeManager } from './manager'
export { LocalAppTrustStore as RuntimeTrustStore } from './trust-store'
export { inspectLocalAppDirectory as inspectRuntimeDirectory, canonicalizeLocalAppRoot as canonicalizeRuntimeRoot } from './inspect'
