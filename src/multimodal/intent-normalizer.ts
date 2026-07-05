type JsonObject = Record<string, unknown>

type AgentOsActionSpec = {
  attachTo?: { role?: string }
  executeScope?: string
}

export type AgentOsIntentSnapshot = {
  page?: { id?: string }
  actionSpecs: Record<string, AgentOsActionSpec | undefined>
}

export type AgentOsLlmOutput = string | unknown

export function normalizeAgentOsIntentOutputForPageActions(
  output: AgentOsLlmOutput,
  snapshot: AgentOsIntentSnapshot,
): AgentOsLlmOutput {
  const pageId = snapshot.page?.id
  if (!pageId) return output
  const parsed = typeof output === 'string' ? parseJsonObject(output) : output
  if (!isJsonObject(parsed)) return output
  const normalized = normalizePageActionObject(parsed, snapshot, pageId)
  return typeof output === 'string' ? JSON.stringify(normalized) : normalized
}

function normalizePageActionObject(source: JsonObject, snapshot: AgentOsIntentSnapshot, pageId: string): JsonObject {
  if (Array.isArray(source.hypotheses)) {
    return {
      ...source,
      hypotheses: source.hypotheses.map((hypothesis) => (
        isJsonObject(hypothesis) ? normalizePageActionHypothesis(hypothesis, snapshot, pageId) : hypothesis
      )),
    }
  }

  const actionId = readActionId(source)
  if (!actionId || !isPageTargetAction(snapshot, actionId)) return source

  // SDK still chooses the action; AgentOS only binds page/app/system actions
  // back to the current page target so website/app names remain params.
  if (source.actionHint || source.targetReference) {
    return normalizePageActionHypothesis(source, snapshot, pageId)
  }
  return { ...source, targetId: pageId }
}

function normalizePageActionHypothesis(source: JsonObject, snapshot: AgentOsIntentSnapshot, pageId: string): JsonObject {
  const actionId = readActionId(source)
  if (!actionId || !isPageTargetAction(snapshot, actionId)) return source
  return {
    ...source,
    actionHint: typeof source.actionHint === 'string' ? source.actionHint : actionId,
    targetId: pageId,
    modelTargetIdHint: pageId,
    targetReference: { kind: 'explicit_id', objectId: pageId },
  }
}

function isPageTargetAction(snapshot: AgentOsIntentSnapshot, actionId: string): boolean {
  const action = snapshot.actionSpecs[actionId]
  if (!action) return false
  return action.attachTo?.role === 'page' || action.executeScope === 'page' || action.executeScope === 'app' || action.executeScope === 'system'
}

function readActionId(source: JsonObject): string | undefined {
  if (typeof source.actionId === 'string') return source.actionId
  if (typeof source.actionHint === 'string') return source.actionHint
  return undefined
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
