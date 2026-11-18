import type {
  RuntimeDevelopmentErrorCode,
  RuntimeDevelopmentOperationFence,
  RuntimeDevelopmentSaveCapability,
  RuntimeDevelopmentSnapshot,
  RuntimeScopeId,
} from '../src/runtime-development-contract'
import type { RuntimeEditRunnerHook, RuntimeEditTerminalPhase, RuntimeEditToolName } from './runtime-edit-coordinator'

export const RUNTIME_DEVELOPMENT_SETTLE_QUIET_MS = 1_500
export const RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS = 30_000

export type RuntimeDevelopmentAuthority = {
  runtimeScopeId: RuntimeScopeId
  routeGeneration: number
  developmentGeneration: number
}

export type RuntimeDevelopmentOpenInput = RuntimeDevelopmentAuthority & {
  runtimeDefinitionId?: string
  entryFingerprint: string
  saveCapability: RuntimeDevelopmentSaveCapability
}

export type RuntimeDevelopmentIntent =
  | ({ type: 'save' } & RuntimeDevelopmentOperationFence)
  | ({ type: 'cancel-save' } & RuntimeDevelopmentOperationFence)
  | ({ type: 'closed'; retainRuntimeService: boolean } & RuntimeDevelopmentOperationFence)

export type RuntimeDevelopmentCoordinatorOptions = {
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
  fingerprint: (runtimeScopeId: RuntimeScopeId) => Promise<string> | string
  intent?: (intent: RuntimeDevelopmentIntent) => Promise<void> | void
  createOperationId?: () => string
  onSnapshot?: (snapshot: RuntimeDevelopmentSnapshot) => void
}

type RuntimeRunRoute = RuntimeDevelopmentAuthority & { isPlan: boolean; phase: 'submitting' | 'accepted' }
type RuntimeDevelopmentSession = RuntimeDevelopmentOpenInput & {
  phase: RuntimeDevelopmentSnapshot['phase']
  exitRequested: boolean
  activeRunIds: Set<string>
  waitingPromptIds: Set<string>
  mutationCountByRun: Map<string, number>
  failedMutationRunIds: Set<string>
  activeAgentLeaseIds: Set<string>
  settleOperationId?: string
  buildOperationId?: string
  autoSaveAttemptedGeneration?: number
  gateStartedAt?: number
  stableFingerprint?: string
  stableSince?: number
  timer?: unknown
  probePending: boolean
  probeSequence: number
  errorCode?: RuntimeDevelopmentErrorCode
  userMessage?: string
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/**
 * Window-lifetime Runtime edit transaction. It owns only session/generation
 * state; the existing Runtime manager remains the sole build/artifact owner.
 */
export class RuntimeDevelopmentCoordinator implements RuntimeEditRunnerHook {
  private readonly sessions = new Map<RuntimeScopeId, RuntimeDevelopmentSession>()
  private readonly runs = new Map<string, RuntimeRunRoute>()
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private readonly fingerprint: (runtimeScopeId: RuntimeScopeId) => Promise<string>
  private readonly intent: (intent: RuntimeDevelopmentIntent) => Promise<void>
  private readonly createOperationId: () => string
  private readonly onSnapshot: (snapshot: RuntimeDevelopmentSnapshot) => void
  private nextOperation = 0
  private quitting = false

  constructor(options: RuntimeDevelopmentCoordinatorOptions) {
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    this.fingerprint = async (runtimeScopeId) => options.fingerprint(runtimeScopeId)
    this.intent = async (intent) => { await options.intent?.(intent) }
    this.createOperationId = options.createOperationId ?? (() => `runtime-development-${++this.nextOperation}`)
    this.onSnapshot = options.onSnapshot ?? (() => undefined)
  }

  open(input: RuntimeDevelopmentOpenInput): RuntimeDevelopmentSnapshot {
    const existing = this.sessions.get(input.runtimeScopeId)
    if (existing && existing.routeGeneration === input.routeGeneration && existing.developmentGeneration === input.developmentGeneration && existing.phase !== 'closed') {
      return this.toSnapshot(existing)
    }
    if (existing) this.invalidateOperation(existing, true)
    const session: RuntimeDevelopmentSession = {
      ...input,
      phase: 'opening',
      exitRequested: false,
      activeRunIds: new Set(),
      waitingPromptIds: new Set(),
      mutationCountByRun: new Map(),
      failedMutationRunIds: new Set(),
      activeAgentLeaseIds: new Set(),
      probePending: false,
      probeSequence: 0,
    }
    this.sessions.set(input.runtimeScopeId, session)
    this.publish(session)
    return this.toSnapshot(session)
  }

  ready(authority: RuntimeDevelopmentAuthority): boolean {
    const session = this.current(authority)
    if (!session || session.phase !== 'opening') return false
    session.phase = session.exitRequested ? 'exit_requested' : 'live'
    this.publish(session)
    if (session.exitRequested) this.maybeSettle(session)
    return true
  }

  failOpening(authority: RuntimeDevelopmentAuthority, errorCode: RuntimeDevelopmentErrorCode, userMessage?: string): boolean {
    const session = this.current(authority)
    if (!session || session.phase !== 'opening') return false
    this.failNeedsAttention(session, errorCode, userMessage)
    return true
  }

  canSubmit(authority: RuntimeDevelopmentAuthority): boolean {
    const session = this.current(authority)
    return Boolean(session && session.phase === 'live' && !session.exitRequested && !this.quitting)
  }

  registerSubmittingRun(input: RuntimeDevelopmentAuthority & { pendingRequestId: string; permissionMode: string }): boolean {
    const session = this.current(input)
    if (!session || session.phase !== 'live' || session.exitRequested || this.quitting || this.runs.has(input.pendingRequestId)) return false
    const route: RuntimeRunRoute = {
      runtimeScopeId: input.runtimeScopeId,
      routeGeneration: input.routeGeneration,
      developmentGeneration: input.developmentGeneration,
      isPlan: input.permissionMode === 'plan',
      phase: 'submitting',
    }
    this.runs.set(input.pendingRequestId, route)
    session.activeRunIds.add(input.pendingRequestId)
    session.mutationCountByRun.set(input.pendingRequestId, 0)
    this.resetStability(session)
    this.publish(session)
    return true
  }

  registerAcceptedRun(input: RuntimeDevelopmentAuthority & { requestId: string; permissionMode: string; pendingRequestId?: string }): boolean {
    if (input.pendingRequestId) {
      const pending = this.runs.get(input.pendingRequestId)
      const session = this.current(input)
      if (!pending || pending.phase !== 'submitting' || !sameRoute(pending, input) || !session || session.phase === 'closed' || session.phase === 'saving' || this.quitting || this.runs.has(input.requestId)) return false
      const mutationCount = session.mutationCountByRun.get(input.pendingRequestId) ?? 0
      this.runs.delete(input.pendingRequestId)
      this.runs.set(input.requestId, { ...pending, isPlan: input.permissionMode === 'plan', phase: 'accepted' })
      session.activeRunIds.delete(input.pendingRequestId)
      session.activeRunIds.add(input.requestId)
      session.mutationCountByRun.delete(input.pendingRequestId)
      session.mutationCountByRun.set(input.requestId, mutationCount)
      this.publish(session)
      return true
    }
    const session = this.current(input)
    if (!session || session.phase !== 'live' || session.exitRequested || this.quitting || this.runs.has(input.requestId)) return false
    const route: RuntimeRunRoute = { runtimeScopeId: input.runtimeScopeId, routeGeneration: input.routeGeneration, developmentGeneration: input.developmentGeneration, isPlan: input.permissionMode === 'plan', phase: 'accepted' }
    this.runs.set(input.requestId, route)
    session.activeRunIds.add(input.requestId)
    session.mutationCountByRun.set(input.requestId, 0)
    this.resetStability(session)
    this.publish(session)
    return true
  }

  rollbackSubmittedRun(input: { pendingRequestId: string; acceptedRequestId?: string }): boolean {
    const candidates = [
      { requestId: input.pendingRequestId, phase: 'submitting' as const },
      ...(input.acceptedRequestId ? [{ requestId: input.acceptedRequestId, phase: 'accepted' as const }] : []),
    ]
    const affected = new Set<RuntimeDevelopmentSession>()
    let changed = false
    for (const candidate of candidates) {
      const route = this.runs.get(candidate.requestId)
      if (!route || route.phase !== candidate.phase) continue
      this.runs.delete(candidate.requestId)
      const session = this.sessions.get(route.runtimeScopeId)
      if (!session || session.routeGeneration !== route.routeGeneration || session.developmentGeneration !== route.developmentGeneration) continue
      session.activeRunIds.delete(candidate.requestId)
      for (const leaseId of [...session.activeAgentLeaseIds]) {
        if (leaseId.startsWith(`${candidate.requestId}:`)) session.activeAgentLeaseIds.delete(leaseId)
      }
      const mutationCount = session.mutationCountByRun.get(candidate.requestId) ?? 0
      if (mutationCount > 0) {
        session.failedMutationRunIds.add(candidate.requestId)
      } else {
        session.mutationCountByRun.delete(candidate.requestId)
      }
      affected.add(session)
      changed = true
    }
    for (const session of affected) {
      if (session.failedMutationRunIds.size > 0) {
        this.failNeedsAttention(session, undefined, '修改未自动保存，请检查失败或取消后的文件。')
      } else {
        this.publish(session)
        this.maybeSettle(session)
      }
    }
    return changed
  }

  beforeTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName }): void {
    if (!WRITE_TOOLS.has(input.toolName)) return
    const routed = this.routedSession(input.requestId)
    if (!routed || routed.route.isPlan) return
    const leaseId = leaseKey(input.requestId, input.toolUseId)
    if (routed.session.activeAgentLeaseIds.has(leaseId)) return
    routed.session.activeAgentLeaseIds.add(leaseId)
    this.publish(routed.session)
  }

  afterTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName; succeeded: boolean; hasProjectDiff: boolean }): void {
    const routed = this.routedSession(input.requestId)
    if (!routed || routed.route.isPlan) return
    routed.session.activeAgentLeaseIds.delete(leaseKey(input.requestId, input.toolUseId))
    if (input.succeeded && input.hasProjectDiff) this.recordMutation(routed.session, input.requestId)
    this.publish(routed.session)
    this.maybeSettle(routed.session)
  }

  recordMutationForRequest(requestId: string): void {
    const routed = this.routedSession(requestId)
    if (!routed || routed.route.isPlan) return
    this.recordMutation(routed.session, requestId)
    this.publish(routed.session)
  }

  markPromptWaiting(input: RuntimeDevelopmentAuthority & { requestId: string; promptId: string }): boolean {
    const routed = this.routedSession(input.requestId)
    if (!routed || !sameRoute(routed.route, input)) return false
    routed.session.waitingPromptIds.add(input.promptId)
    if (routed.session.exitRequested) routed.session.phase = 'needs_attention'
    this.publish(routed.session)
    return true
  }

  markPromptResolved(input: RuntimeDevelopmentAuthority & { requestId: string; promptId: string }): boolean {
    const routed = this.routedSession(input.requestId)
    if (!routed || !sameRoute(routed.route, input)) return false
    routed.session.waitingPromptIds.delete(input.promptId)
    if (routed.session.exitRequested && routed.session.waitingPromptIds.size === 0) routed.session.phase = 'exit_requested'
    this.publish(routed.session)
    this.maybeSettle(routed.session)
    return true
  }

  markRunTerminal(input: RuntimeDevelopmentAuthority & { requestId: string; phase: RuntimeEditTerminalPhase }): boolean {
    const route = this.runs.get(input.requestId)
    if (!route || !sameRoute(route, input)) return false
    this.runs.delete(input.requestId)
    const session = this.sessions.get(route.runtimeScopeId)
    if (!session || session.routeGeneration !== route.routeGeneration) return false
    session.activeRunIds.delete(input.requestId)
    for (const leaseId of [...session.activeAgentLeaseIds]) {
      if (leaseId.startsWith(`${input.requestId}:`)) session.activeAgentLeaseIds.delete(leaseId)
    }
    for (const promptId of [...session.waitingPromptIds]) {
      if (promptId.startsWith(`${input.requestId}:`)) session.waitingPromptIds.delete(promptId)
    }
    if ((input.phase === 'failed' || input.phase === 'cancelled') && (session.mutationCountByRun.get(input.requestId) ?? 0) > 0) {
      session.failedMutationRunIds.add(input.requestId)
      this.failNeedsAttention(session, undefined, '修改未自动保存，请检查失败或取消后的文件。')
    }
    this.publish(session)
    this.maybeSettle(session)
    return true
  }

  requestExit(authority: RuntimeDevelopmentAuthority): RuntimeDevelopmentSnapshot | null {
    const session = this.current(authority)
    if (!session || session.phase === 'closed') return session ? this.toSnapshot(session) : null
    if (!session.exitRequested) {
      session.exitRequested = true
      // Run/permission 等待时间不计入源码稳定期；最后一个 blocker 清理后才启动 30s settle gate。
      session.gateStartedAt = undefined
      const blockedByFailedMutation = session.failedMutationRunIds.size > 0
      session.settleOperationId = blockedByFailedMutation ? undefined : this.createOperationId()
      session.phase = session.waitingPromptIds.size > 0 || blockedByFailedMutation ? 'needs_attention' : 'exit_requested'
      this.publish(session)
      this.maybeSettle(session)
    }
    return this.toSnapshot(session)
  }

  reenter(runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentSnapshot | null {
    const session = this.sessions.get(runtimeScopeId)
    if (!session) return null
    const oldFence = this.fence(session)
    this.invalidateOperation(session, false)
    const previousGeneration = session.developmentGeneration
    session.developmentGeneration += 1
    for (const requestId of session.activeRunIds) {
      const route = this.runs.get(requestId)
      if (route && route.runtimeScopeId === runtimeScopeId && route.developmentGeneration === previousGeneration) {
        this.runs.set(requestId, { ...route, developmentGeneration: session.developmentGeneration })
      }
    }
    session.exitRequested = false
    session.phase = 'live'
    session.autoSaveAttemptedGeneration = undefined
    session.errorCode = undefined
    session.userMessage = undefined
    session.gateStartedAt = undefined
    this.publish(session)
    if (oldFence) this.emit({ type: 'cancel-save', ...oldFence })
    return this.toSnapshot(session)
  }

  retrySave(runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentSnapshot | null {
    const session = this.sessions.get(runtimeScopeId)
    if (!session || session.activeRunIds.size > 0 || session.activeAgentLeaseIds.size > 0 || session.waitingPromptIds.size > 0 || session.failedMutationRunIds.size > 0 || this.quitting) return null
    const oldFence = this.fence(session)
    this.invalidateOperation(session, false)
    session.developmentGeneration += 1
    session.exitRequested = true
    session.phase = 'exit_requested'
    session.autoSaveAttemptedGeneration = undefined
    session.errorCode = undefined
    session.userMessage = undefined
    session.gateStartedAt = this.now()
    session.settleOperationId = this.createOperationId()
    this.schedule(session, RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS)
    this.publish(session)
    if (oldFence) this.emit({ type: 'cancel-save', ...oldFence })
    this.maybeSettle(session)
    return this.toSnapshot(session)
  }

  canCommit(fence: RuntimeDevelopmentOperationFence): boolean {
    const session = this.current(fence)
    return Boolean(session && session.phase === 'saving' && session.exitRequested && session.buildOperationId === fence.operationId && !this.quitting)
  }

  completeSave(fence: RuntimeDevelopmentOperationFence, result: 'saved' | 'build-failed' | 'aborted'): boolean {
    const session = this.current(fence)
    if (!session || session.buildOperationId !== fence.operationId) return false
    session.buildOperationId = undefined
    session.settleOperationId = undefined
    if (result === 'saved') {
      this.close(session, false, '已保存预览。')
    } else if (result === 'build-failed') {
      session.phase = 'preview_update_failed'
      session.errorCode = 'runtime-build-failed'
      session.userMessage = '预览更新失败，仍显示上一版。'
      this.publish(session)
    } else {
      session.phase = 'needs_attention'
      session.userMessage = '保存已中止，修改仍保留。'
      this.publish(session)
    }
    return true
  }

  invalidateRoute(runtimeScopeId: RuntimeScopeId, routeGeneration: number): RuntimeDevelopmentSnapshot | null {
    const session = this.sessions.get(runtimeScopeId)
    if (!session || routeGeneration <= session.routeGeneration) return session ? this.toSnapshot(session) : null
    const oldFence = this.fence(session)
    this.invalidateOperation(session, false)
    session.routeGeneration = routeGeneration
    session.developmentGeneration += 1
    session.exitRequested = false
    session.phase = 'needs_attention'
    session.errorCode = 'runtime-scope-stale'
    session.userMessage = 'Runtime 位置已变化，请重新打开后继续。'
    this.publish(session)
    if (oldFence) this.emit({ type: 'cancel-save', ...oldFence })
    return this.toSnapshot(session)
  }

  setQuitting(): void {
    if (this.quitting) return
    this.quitting = true
    for (const session of this.sessions.values()) {
      const oldFence = this.fence(session)
      this.invalidateOperation(session, false)
      if (oldFence) this.emit({ type: 'cancel-save', ...oldFence })
      this.publish(session)
    }
  }

  snapshot(runtimeScopeId: RuntimeScopeId): RuntimeDevelopmentSnapshot | undefined {
    const session = this.sessions.get(runtimeScopeId)
    return session ? this.toSnapshot(session) : undefined
  }

  /** Destructive owner/root changes must not race an in-memory development transaction. */
  hasActiveSession(runtimeScopeId: RuntimeScopeId): boolean {
    const session = this.sessions.get(runtimeScopeId)
    return Boolean(session && session.phase !== 'closed')
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.clearSessionTimer(session)
    this.sessions.clear()
    this.runs.clear()
  }

  private maybeSettle(session: RuntimeDevelopmentSession): void {
    if (!this.canProbe(session) || session.probePending) return
    if (session.gateStartedAt === undefined) {
      session.gateStartedAt = this.now()
      this.schedule(session, RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS)
    }
    const elapsed = this.now() - (session.gateStartedAt ?? this.now())
    if (elapsed >= RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS) return this.timeout(session)
    const fence = this.fence(session)
    if (!fence) return
    const probeSequence = ++session.probeSequence
    session.probePending = true
    void this.fingerprint(session.runtimeScopeId).then((fingerprint) => {
      if (session.probeSequence !== probeSequence) return
      session.probePending = false
      if (!this.matchesFence(session, fence) || !this.canProbe(session)) return
      const now = this.now()
      if (now - (session.gateStartedAt ?? now) >= RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS) return this.timeout(session)
      if (session.stableFingerprint !== fingerprint) {
        session.stableFingerprint = fingerprint
        session.stableSince = now
      }
      const quietRemaining = RUNTIME_DEVELOPMENT_SETTLE_QUIET_MS - (now - (session.stableSince ?? now))
      if (quietRemaining <= 0) return this.finishStable(session, fingerprint)
      const timeoutRemaining = RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS - (now - (session.gateStartedAt ?? now))
      this.schedule(session, Math.max(1, Math.min(quietRemaining, timeoutRemaining)))
    }).catch(() => {
      if (session.probeSequence !== probeSequence) return
      session.probePending = false
      if (this.matchesFence(session, fence)) this.timeout(session)
    })
  }

  private finishStable(session: RuntimeDevelopmentSession, fingerprint: string): void {
    if (!this.canProbe(session)) return
    if (fingerprint === session.entryFingerprint) return this.close(session, false)
    if (session.saveCapability === 'development-only') return this.close(session, true, '修改仅在运行中的页面可见。')
    // The bridge rebuilds and restarts the served bundle once the session closes.
    if (session.saveCapability === 'server') return this.close(session, true, '页面会更新到修改后的版本。')
    if (session.saveCapability !== 'static') return this.failNeedsAttention(session, 'runtime-save-unavailable', '此 Runtime 没有可靠的保存声明。')
    if (session.autoSaveAttemptedGeneration === session.developmentGeneration) return
    const operationId = session.settleOperationId
    if (!operationId) return
    session.autoSaveAttemptedGeneration = session.developmentGeneration
    session.buildOperationId = operationId
    session.phase = 'saving'
    this.clearSessionTimer(session)
    this.publish(session)
    this.emit({ type: 'save', runtimeScopeId: session.runtimeScopeId, routeGeneration: session.routeGeneration, developmentGeneration: session.developmentGeneration, operationId })
  }

  private close(session: RuntimeDevelopmentSession, retainRuntimeService: boolean, userMessage?: string): void {
    const fence = this.fence(session) ?? {
      runtimeScopeId: session.runtimeScopeId,
      routeGeneration: session.routeGeneration,
      developmentGeneration: session.developmentGeneration,
      operationId: this.createOperationId(),
    }
    this.clearSessionTimer(session)
    session.phase = 'closed'
    session.exitRequested = true
    session.settleOperationId = undefined
    session.buildOperationId = undefined
    session.userMessage = userMessage
    session.errorCode = undefined
    session.activeRunIds.clear()
    session.activeAgentLeaseIds.clear()
    session.waitingPromptIds.clear()
    this.publish(session)
    this.emit({ type: 'closed', ...fence, retainRuntimeService })
  }

  private timeout(session: RuntimeDevelopmentSession): void {
    if (!session.exitRequested || session.phase === 'closed' || session.phase === 'saving') return
    this.clearSessionTimer(session)
    session.phase = 'needs_attention'
    session.errorCode = 'runtime-save-timeout'
    session.userMessage = '等待修改稳定超时，尚未自动保存。'
    session.settleOperationId = undefined
    this.publish(session)
  }

  private failNeedsAttention(session: RuntimeDevelopmentSession, errorCode?: RuntimeDevelopmentErrorCode, userMessage?: string): void {
    this.clearSessionTimer(session)
    session.phase = 'needs_attention'
    session.errorCode = errorCode
    session.userMessage = userMessage
    session.settleOperationId = undefined
    session.buildOperationId = undefined
    this.publish(session)
  }

  private recordMutation(session: RuntimeDevelopmentSession, requestId: string): void {
    session.mutationCountByRun.set(requestId, (session.mutationCountByRun.get(requestId) ?? 0) + 1)
    this.resetStability(session)
  }

  private canProbe(session: RuntimeDevelopmentSession): boolean {
    return !this.quitting && session.exitRequested && session.phase !== 'saving' && session.phase !== 'closed' && session.activeRunIds.size === 0 && session.activeAgentLeaseIds.size === 0 && session.waitingPromptIds.size === 0 && session.failedMutationRunIds.size === 0 && Boolean(session.settleOperationId)
  }

  private schedule(session: RuntimeDevelopmentSession, delayMs: number): void {
    this.clearSessionTimer(session)
    session.timer = this.setTimer(() => {
      session.timer = undefined
      const elapsed = this.now() - (session.gateStartedAt ?? this.now())
      if (elapsed >= RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS) this.timeout(session)
      else this.maybeSettle(session)
    }, delayMs)
  }

  private resetStability(session: RuntimeDevelopmentSession): void {
    session.probeSequence += 1
    session.probePending = false
    session.stableFingerprint = undefined
    session.stableSince = undefined
    if (session.exitRequested && session.gateStartedAt !== undefined) {
      const remaining = RUNTIME_DEVELOPMENT_SETTLE_TIMEOUT_MS - (this.now() - session.gateStartedAt)
      this.schedule(session, Math.max(1, remaining))
    }
  }

  private invalidateOperation(session: RuntimeDevelopmentSession, clearRuns: boolean): void {
    this.clearSessionTimer(session)
    session.settleOperationId = undefined
    session.buildOperationId = undefined
    session.probePending = false
    session.probeSequence += 1
    session.stableFingerprint = undefined
    session.stableSince = undefined
    if (clearRuns) {
      for (const requestId of session.activeRunIds) this.runs.delete(requestId)
      session.activeRunIds.clear()
      session.activeAgentLeaseIds.clear()
      session.waitingPromptIds.clear()
    }
  }

  private clearSessionTimer(session: RuntimeDevelopmentSession): void {
    if (session.timer !== undefined) this.clearTimer(session.timer)
    session.timer = undefined
  }

  private current(authority: RuntimeDevelopmentAuthority): RuntimeDevelopmentSession | undefined {
    const session = this.sessions.get(authority.runtimeScopeId)
    return session && session.routeGeneration === authority.routeGeneration && session.developmentGeneration === authority.developmentGeneration ? session : undefined
  }

  private routedSession(requestId: string): { route: RuntimeRunRoute; session: RuntimeDevelopmentSession } | null {
    const route = this.runs.get(requestId)
    if (!route) return null
    const session = this.sessions.get(route.runtimeScopeId)
    return session && session.routeGeneration === route.routeGeneration ? { route, session } : null
  }

  private fence(session: RuntimeDevelopmentSession): RuntimeDevelopmentOperationFence | null {
    const operationId = session.buildOperationId ?? session.settleOperationId
    return operationId ? { runtimeScopeId: session.runtimeScopeId, routeGeneration: session.routeGeneration, developmentGeneration: session.developmentGeneration, operationId } : null
  }

  private matchesFence(session: RuntimeDevelopmentSession, fence: RuntimeDevelopmentOperationFence): boolean {
    return session.runtimeScopeId === fence.runtimeScopeId && session.routeGeneration === fence.routeGeneration && session.developmentGeneration === fence.developmentGeneration && (session.settleOperationId === fence.operationId || session.buildOperationId === fence.operationId)
  }

  private emit(intent: RuntimeDevelopmentIntent): void {
    void this.intent(intent).catch(() => {
      // Intent failures may carry a local root, command, stack or user text.
      // Keep the operational signal useful without copying exception content.
      console.error('[runtime-development/coordinator] intent-failed', {
        type: intent.type,
        scopeKind: intent.runtimeScopeId.startsWith('project:') ? 'project' : 'workspace',
        code: 'runtime-development-intent-failed',
      })
    })
  }
  private publish(session: RuntimeDevelopmentSession): void { this.onSnapshot(this.toSnapshot(session)) }
  private toSnapshot(session: RuntimeDevelopmentSession): RuntimeDevelopmentSnapshot {
    const hasChanges = [...session.mutationCountByRun.values()].some((count) => count > 0)
    return {
      runtimeScopeId: session.runtimeScopeId,
      runtimeDefinitionId: session.runtimeDefinitionId,
      routeGeneration: session.routeGeneration,
      developmentGeneration: session.developmentGeneration,
      phase: session.phase,
      activeRunCount: session.activeRunIds.size,
      activeAgentLeaseCount: session.activeAgentLeaseIds.size,
      waitingPromptCount: session.waitingPromptIds.size,
      hasChanges,
      canSubmit: session.phase === 'live' && !session.exitRequested && !this.quitting,
      canReopen: session.phase === 'exit_requested' || session.phase === 'needs_attention' || session.phase === 'saving' || session.phase === 'preview_update_failed',
      canEnd: session.phase === 'opening' || session.phase === 'live',
      exitRequested: session.exitRequested,
      autoSaveAttempted: session.autoSaveAttemptedGeneration === session.developmentGeneration,
      userMessage: session.userMessage,
      errorCode: session.errorCode,
    }
  }
}

function leaseKey(requestId: string, toolUseId: string): string { return `${requestId}:${toolUseId}` }
function sameRoute(left: RuntimeDevelopmentAuthority, right: RuntimeDevelopmentAuthority): boolean {
  return left.runtimeScopeId === right.runtimeScopeId && left.routeGeneration === right.routeGeneration && left.developmentGeneration === right.developmentGeneration
}
