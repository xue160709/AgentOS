/**
 * Main-memory aggregation for Agent-owned project edits.  This deliberately
 * owns neither files nor Runtime state: it only turns reliable SDK facts into
 * fenced Runtime intents.
 */

import type { ProjectChatRuntimeEditSnapshot } from '../src/project-chat-contract'

export const RUNTIME_EDIT_SETTLE_QUIET_MS = 1_500
export const RUNTIME_EDIT_SETTLE_TIMEOUT_MS = 30_000

export type RuntimeEditTerminalPhase = 'succeeded' | 'failed' | 'cancelled'
export type RuntimeEditToolName = 'Edit' | 'Write' | 'NotebookEdit' | string

export type RuntimeEditIntent =
  | { type: 'potential-run-registered'; projectId: string; requestId: string; editGeneration: number }
  | { type: 'agent-lease-acquired'; projectId: string; requestId: string; toolUseId: string; editGeneration: number }
  | { type: 'agent-lease-released'; projectId: string; requestId: string; toolUseId: string; editGeneration: number }
  | { type: 'manual-lease-changed'; projectId: string; manualLeaseCount: number; manualStopFence: boolean; editGeneration: number }
  | { type: 'manual-stop-fence-changed'; projectId: string; manualStopFence: boolean; editGeneration: number }
  | { type: 'settle'; projectId: string; editGeneration: number; operationId: string }
  | { type: 'settle-timeout'; projectId: string; editGeneration: number; operationId: string }
  | { type: 'no-auto-build'; projectId: string; editGeneration: number }

export type RuntimeEditSnapshot = ProjectChatRuntimeEditSnapshot

export type RuntimeEditCoordinatorOptions = {
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
  fingerprint: (projectId: string) => Promise<string> | string
  intent?: (intent: RuntimeEditIntent) => Promise<void> | void
  createOperationId?: () => string
  onSnapshot?: (snapshot: RuntimeEditSnapshot) => void
}

export type RuntimeEditRunnerHook = {
  beforeTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName }): void
  afterTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName; succeeded: boolean; hasProjectDiff: boolean }): void
}

type EditSession = {
  projectId: string
  editGeneration: number
  potentialRunIds: Set<string>
  activeEditLeaseIds: Set<string>
  successfulMutationCount: number
  failedOrCancelledAfterMutation: boolean
  manualLeaseCount: number
  manualStopFence: boolean
  settleOperationId?: string
  buildOperationId?: string
  settleTimer?: unknown
  settleStartedAt?: number
  stableFingerprint?: string
  stableSince?: number
}

type RunRoute = { projectId: string; isPlan: boolean }

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/**
 * A project has one coordinator session for the lifetime of the Main process.
 * `registerAcceptedRun` and hook callbacks are intentionally synchronous so a
 * runner hook never races a later event-loop turn to acquire its lease.
 */
export class RuntimeEditCoordinator implements RuntimeEditRunnerHook {
  private readonly sessions = new Map<string, EditSession>()
  private readonly runs = new Map<string, RunRoute>()
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private readonly fingerprint: (projectId: string) => Promise<string>
  private readonly intent: (intent: RuntimeEditIntent) => Promise<void>
  private readonly createOperationId: () => string
  private readonly onSnapshot: (snapshot: RuntimeEditSnapshot) => void
  private nextOperation = 0

  constructor(options: RuntimeEditCoordinatorOptions) {
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    this.fingerprint = async (projectId) => options.fingerprint(projectId)
    this.intent = async (intent) => { await options.intent?.(intent) }
    this.createOperationId = options.createOperationId ?? (() => `runtime-edit-${++this.nextOperation}`)
    this.onSnapshot = options.onSnapshot ?? (() => undefined)
  }

  registerAcceptedRun(input: { projectId: string; requestId: string; permissionMode: string }): void {
    const isPlan = input.permissionMode === 'plan'
    this.runs.set(input.requestId, { projectId: input.projectId, isPlan })
    if (isPlan) return
    const session = this.session(input.projectId)
    if (session.settleOperationId || session.buildOperationId) this.invalidateInFlight(session)
    session.potentialRunIds.add(input.requestId)
    this.emit({ type: 'potential-run-registered', projectId: input.projectId, requestId: input.requestId, editGeneration: session.editGeneration })
    this.publish(session)
  }

  beforeTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName }): void {
    if (!WRITE_TOOLS.has(input.toolName)) return
    const route = this.runs.get(input.requestId)
    if (!route || route.isPlan) return
    const session = this.session(route.projectId)
    const leaseId = leaseKey(input.requestId, input.toolUseId)
    if (session.activeEditLeaseIds.has(leaseId)) return
    session.activeEditLeaseIds.add(leaseId)
    this.publish(session)
    if (!session.manualStopFence) this.emit({ type: 'agent-lease-acquired', projectId: session.projectId, requestId: input.requestId, toolUseId: input.toolUseId, editGeneration: session.editGeneration })
  }

  afterTool(input: { requestId: string; toolUseId: string; toolName: RuntimeEditToolName; succeeded: boolean; hasProjectDiff: boolean }): void {
    const route = this.runs.get(input.requestId)
    if (!route || route.isPlan) return
    const session = this.session(route.projectId)
    const leaseId = leaseKey(input.requestId, input.toolUseId)
    const hadLease = session.activeEditLeaseIds.delete(leaseId)
    if (hadLease) this.emit({ type: 'agent-lease-released', projectId: session.projectId, requestId: input.requestId, toolUseId: input.toolUseId, editGeneration: session.editGeneration })
    if (input.succeeded && input.hasProjectDiff) this.recordMutation(session)
    this.publish(session)
    this.maybeStartSettle(session)
  }

  recordMutationForRequest(requestId: string): void {
    const route = this.runs.get(requestId)
    if (!route || route.isPlan) return
    const session = this.session(route.projectId)
    this.recordMutation(session)
    this.publish(session)
    this.maybeStartSettle(session)
  }

  markRunTerminal(requestId: string, phase: RuntimeEditTerminalPhase): void {
    const route = this.runs.get(requestId)
    this.runs.delete(requestId)
    if (!route || route.isPlan) return
    const session = this.session(route.projectId)
    session.potentialRunIds.delete(requestId)
    for (const leaseId of [...session.activeEditLeaseIds]) {
      if (!leaseId.startsWith(`${requestId}:`)) continue
      session.activeEditLeaseIds.delete(leaseId)
      const toolUseId = leaseId.slice(requestId.length + 1)
      this.emit({ type: 'agent-lease-released', projectId: session.projectId, requestId, toolUseId, editGeneration: session.editGeneration })
    }
    if ((phase === 'failed' || phase === 'cancelled') && session.successfulMutationCount > 0) {
      session.failedOrCancelledAfterMutation = true
      this.cancelSettleTimer(session)
      this.emit({ type: 'no-auto-build', projectId: session.projectId, editGeneration: session.editGeneration })
    }
    this.publish(session)
    this.maybeStartSettle(session)
  }

  acquireManualLease(projectId: string): void {
    const session = this.session(projectId)
    session.manualLeaseCount += 1
    this.publish(session)
    this.emit({ type: 'manual-lease-changed', projectId, manualLeaseCount: session.manualLeaseCount, manualStopFence: session.manualStopFence, editGeneration: session.editGeneration })
  }

  releaseManualLease(projectId: string): void {
    const session = this.session(projectId)
    session.manualLeaseCount = Math.max(0, session.manualLeaseCount - 1)
    this.publish(session)
    this.emit({ type: 'manual-lease-changed', projectId, manualLeaseCount: session.manualLeaseCount, manualStopFence: session.manualStopFence, editGeneration: session.editGeneration })
  }

  setManualStopFence(projectId: string, stopped: boolean): void {
    const session = this.session(projectId)
    if (session.manualStopFence === stopped) return
    session.manualStopFence = stopped
    if (stopped) this.cancelSettleTimer(session)
    this.publish(session)
    this.emit({ type: 'manual-stop-fence-changed', projectId, manualStopFence: stopped, editGeneration: session.editGeneration })
    if (!stopped) this.maybeStartSettle(session)
  }

  snapshot(projectId: string): RuntimeEditSnapshot | undefined {
    const session = this.sessions.get(projectId)
    return session ? this.toSnapshot(session) : undefined
  }

  /**
   * Runtime integration claims a build after receiving a current settle intent.
   * The returned id is a generation fence, never a command or build policy.
   */
  beginBuild(projectId: string, editGeneration: number): string | undefined {
    const session = this.sessions.get(projectId)
    if (!session || session.editGeneration !== editGeneration || session.failedOrCancelledAfterMutation || session.manualStopFence || session.buildOperationId) return undefined
    const operationId = this.createOperationId()
    session.buildOperationId = operationId
    this.publish(session)
    return operationId
  }

  /** Returns true only when the completing Runtime operation still owns this generation. */
  completeBuild(projectId: string, editGeneration: number, operationId: string): boolean {
    const session = this.sessions.get(projectId)
    if (!session || session.editGeneration !== editGeneration || session.buildOperationId !== operationId) return false
    session.buildOperationId = undefined
    this.publish(session)
    return true
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.cancelSettleTimer(session)
    this.sessions.clear()
    this.runs.clear()
  }

  private recordMutation(session: EditSession): void {
    if (session.settleOperationId || session.buildOperationId) this.invalidateInFlight(session)
    session.successfulMutationCount += 1
  }

  private maybeStartSettle(session: EditSession): void {
    if (
      session.successfulMutationCount === 0 ||
      session.potentialRunIds.size > 0 ||
      session.failedOrCancelledAfterMutation ||
      session.manualStopFence ||
      session.settleOperationId ||
      session.buildOperationId ||
      session.settleTimer !== undefined
    ) return
    session.settleStartedAt = this.now()
    session.stableFingerprint = undefined
    session.stableSince = undefined
    this.probeFingerprint(session, session.editGeneration)
  }

  private probeFingerprint(session: EditSession, generation: number): void {
    const startedAt = session.settleStartedAt
    if (startedAt === undefined || !this.canSettle(session, generation)) return
    if (this.now() - startedAt >= RUNTIME_EDIT_SETTLE_TIMEOUT_MS) {
      this.timeoutSettle(session, generation)
      return
    }
    void this.fingerprint(session.projectId).then((fingerprint) => {
      if (!this.canSettle(session, generation)) return
      const now = this.now()
      if (now - (session.settleStartedAt ?? now) >= RUNTIME_EDIT_SETTLE_TIMEOUT_MS) {
        this.timeoutSettle(session, generation)
        return
      }
      if (session.stableFingerprint !== fingerprint) {
        session.stableFingerprint = fingerprint
        session.stableSince = now
      }
      const quietRemaining = RUNTIME_EDIT_SETTLE_QUIET_MS - (now - (session.stableSince ?? now))
      if (quietRemaining <= 0) {
        this.beginSettleIntent(session, generation)
        return
      }
      const timeoutRemaining = RUNTIME_EDIT_SETTLE_TIMEOUT_MS - (now - (session.settleStartedAt ?? now))
      session.settleTimer = this.setTimer(() => {
        session.settleTimer = undefined
        this.probeFingerprint(session, generation)
      }, Math.max(1, Math.min(quietRemaining, timeoutRemaining)))
    }).catch(() => {
      if (this.canSettle(session, generation)) this.timeoutSettle(session, generation)
    })
  }

  private beginSettleIntent(session: EditSession, generation: number): void {
    if (!this.canSettle(session, generation)) return
    const operationId = this.createOperationId()
    session.settleOperationId = operationId
    this.publish(session)
    void this.intent({ type: 'settle', projectId: session.projectId, editGeneration: generation, operationId }).then(() => {
      if (session.editGeneration !== generation || session.settleOperationId !== operationId) return
      session.settleOperationId = undefined
      this.publish(session)
    }).catch(() => {
      if (session.editGeneration !== generation || session.settleOperationId !== operationId) return
      session.settleOperationId = undefined
      this.publish(session)
    })
  }

  private timeoutSettle(session: EditSession, generation: number): void {
    if (!this.canSettle(session, generation)) return
    const operationId = this.createOperationId()
    this.cancelSettleTimer(session)
    session.settleStartedAt = undefined
    session.stableFingerprint = undefined
    session.stableSince = undefined
    this.emit({ type: 'settle-timeout', projectId: session.projectId, editGeneration: generation, operationId })
    this.publish(session)
  }

  private invalidateInFlight(session: EditSession): void {
    this.cancelSettleTimer(session)
    session.editGeneration += 1
    session.settleOperationId = undefined
    session.buildOperationId = undefined
    session.settleStartedAt = undefined
    session.stableFingerprint = undefined
    session.stableSince = undefined
  }

  private canSettle(session: EditSession, generation: number): boolean {
    return session.editGeneration === generation && session.successfulMutationCount > 0 && session.potentialRunIds.size === 0 && !session.failedOrCancelledAfterMutation && !session.manualStopFence && !session.settleOperationId && !session.buildOperationId
  }

  private cancelSettleTimer(session: EditSession): void {
    if (session.settleTimer !== undefined) this.clearTimer(session.settleTimer)
    session.settleTimer = undefined
    session.settleStartedAt = undefined
    session.stableFingerprint = undefined
    session.stableSince = undefined
  }

  private session(projectId: string): EditSession {
    const existing = this.sessions.get(projectId)
    if (existing) return existing
    const session: EditSession = {
      projectId,
      editGeneration: 1,
      potentialRunIds: new Set(),
      activeEditLeaseIds: new Set(),
      successfulMutationCount: 0,
      failedOrCancelledAfterMutation: false,
      manualLeaseCount: 0,
      manualStopFence: false,
    }
    this.sessions.set(projectId, session)
    return session
  }

  private emit(intent: RuntimeEditIntent): void { void this.intent(intent) }
  private publish(session: EditSession): void { this.onSnapshot(this.toSnapshot(session)) }
  private toSnapshot(session: EditSession): RuntimeEditSnapshot {
    return {
      projectId: session.projectId,
      editGeneration: session.editGeneration,
      potentialRunCount: session.potentialRunIds.size,
      activeAgentLeaseCount: session.activeEditLeaseIds.size,
      successfulMutationCount: session.successfulMutationCount,
      failedOrCancelledAfterMutation: session.failedOrCancelledAfterMutation,
      manualLeaseCount: session.manualLeaseCount,
      manualStopFence: session.manualStopFence,
      ...(session.settleOperationId ? { settleOperationId: session.settleOperationId } : {}),
      ...(session.buildOperationId ? { buildOperationId: session.buildOperationId } : {}),
    }
  }
}

function leaseKey(requestId: string, toolUseId: string): string { return `${requestId}:${toolUseId}` }
