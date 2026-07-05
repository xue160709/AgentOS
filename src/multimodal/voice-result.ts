import type {
  ActionExecutionResult,
  InteractionSnapshot,
  InteractionSubmitResult,
} from '@xue160709/omni-ui-react'

import type { VoiceCommandExecutionResult } from '../desktop-types'

export type TranslateFn = (path: string, vars?: Record<string, string | number>) => string

export function mapSubmitResult(
  result: InteractionSubmitResult,
  snapshot: InteractionSnapshot,
  t: TranslateFn,
): Omit<VoiceCommandExecutionResult, 'id'> {
  if (result.pendingCommand) {
    return { status: 'needs_confirmation', message: t('multimodal.needsConfirmation') }
  }
  if (result.resolution.status === 'needs_clarification') {
    const candidates = (result.resolution.targetCandidates ?? []).map((candidate) => ({
      id: candidate.id,
      label: snapshot.visibleObjects.find((object) => object.id === candidate.id)?.label ?? candidate.id,
    }))
    return { status: 'needs_clarification', message: t('multimodal.needsClarification'), candidates }
  }
  if (result.ok) {
    return {
      status: 'success',
      message: executionMessage(result.dispatch?.execution) ?? t('multimodal.executed'),
    }
  }
  if (result.resolution.status === 'unsupported' || result.resolution.status === 'not_found') {
    return { status: 'unsupported', message: result.resolution.reason ?? t('multimodal.unrecognized') }
  }
  return { status: 'failed', message: friendlySubmitError(result.error, validationMessage(result.validation), t) }
}

export function executionMessage(execution: ActionExecutionResult | undefined): string | undefined {
  if (!execution) return undefined
  if (execution.status === 'changed') return execution.message
  if ('reason' in execution) return execution.reason
  return undefined
}

function validationMessage(validation: InteractionSubmitResult['validation']): string | undefined {
  return validation && !validation.ok ? validation.reason : undefined
}

function friendlySubmitError(error: string | undefined, validation: string | undefined, t: TranslateFn): string {
  const message = error ?? validation
  if (!message) return t('multimodal.executionFailed')
  if (message === 'Resolved interaction has no executable action.') {
    return t('multimodal.noExecutableAction')
  }
  return message
}
