import type {
  ActionExecutionResult,
  InteractionSnapshot,
} from '@xue160709/omni-ui-react'

import type { AppViewId, SettingsCategoryId } from '../components/types'
import type { SettingsDescribeParams } from './actions'
import { OMNI_CONTROL_COVERAGE, omniControlCoverageMissingCount } from './coverage-summary'

export type TranslateFn = (path: string, vars?: Record<string, string | number>) => string

export function describeSettingsSnapshot(
  snapshot: InteractionSnapshot,
  activeViewId: AppViewId,
  settingsCategory: SettingsCategoryId,
  { topic }: SettingsDescribeParams,
  t: TranslateFn,
): ActionExecutionResult {
  const normalizedTopic = topic ?? (activeViewId === 'settings' && settingsCategory === 'general' ? 'models' : 'current')
  if (normalizedTopic === 'controls') return describeOmniControlCoverage(snapshot, t)
  if (normalizedTopic === 'models' || (normalizedTopic === 'current' && activeViewId === 'settings' && settingsCategory === 'general')) {
    return describeModelSettingsSnapshot(snapshot, t)
  }
  return describeCurrentPageSnapshot(snapshot, t)
}

export function describeOmniControlCoverage(snapshot: InteractionSnapshot, t: TranslateFn): ActionExecutionResult {
  const missingCount = omniControlCoverageMissingCount()
  const visibleObjects = snapshot.visibleObjects.filter((object) => object.id !== snapshot.page?.id)
  const message = t('multimodal.omniControlCoverageSummary', {
    missing: missingCount,
    nativeCovered: OMNI_CONTROL_COVERAGE.nativeControls.covered,
    nativeTotal: OMNI_CONTROL_COVERAGE.nativeControls.total,
    customCovered: OMNI_CONTROL_COVERAGE.customInteractiveControls.covered,
    customTotal: OMNI_CONTROL_COVERAGE.customInteractiveControls.total,
    pageObjects: visibleObjects.length,
    manualOnly: OMNI_CONTROL_COVERAGE.manualOnlyScenarioCount,
  })
  return {
    status: 'unchanged',
    reason: message,
    data: {
      missingCount,
      tsxFileCount: OMNI_CONTROL_COVERAGE.tsxFileCount,
      nativeControls: OMNI_CONTROL_COVERAGE.nativeControls,
      customInteractiveControls: OMNI_CONTROL_COVERAGE.customInteractiveControls,
      currentPageObjectCount: visibleObjects.length,
      manualOnlyScenarioCount: OMNI_CONTROL_COVERAGE.manualOnlyScenarioCount,
    },
  }
}

export function describeModelSettingsSnapshot(snapshot: InteractionSnapshot, t: TranslateFn): ActionExecutionResult {
  const summary = snapshot.visibleObjects.find((object) => object.id === 'agentos.settings.models.summary')
  const providerObjects = dedupeObjectsByEntityId(
    snapshot.visibleObjects.filter((object) => object.entity?.type === 'model-provider'),
  )
  const providerNames =
    readStateStringArray(summary?.state?.providerNames)
    ?? providerObjects.map((object) => object.label).filter((label): label is string => Boolean(label))
  const providerCount = readStateNumber(summary?.state?.providerCount) ?? providerObjects.length
  const configuredCount = readStateNumber(summary?.state?.configuredProviderCount) ?? providerObjects.filter((object) => object.state?.apiKeyConfigured === true).length
  const activeProvider = readStateString(summary?.state?.activeProviderName)
  const activeModel = readStateString(summary?.state?.activeModel)
  const expandedProvider = readStateString(summary?.state?.expandedProviderName)

  if (providerCount === 0) {
    return { status: 'unchanged', reason: t('multimodal.settingsModelSummaryEmpty') }
  }

  const active = activeProvider || activeModel
    ? [activeProvider, activeModel].filter(Boolean).join(' / ')
    : t('multimodal.none')
  const message = t('multimodal.settingsModelSummary', {
    count: providerCount,
    names: providerNames.length ? providerNames.join('、') : t('multimodal.none'),
    configuredCount,
    active,
    expanded: expandedProvider || t('multimodal.none'),
  })
  return {
    status: 'unchanged',
    reason: message,
    data: {
      providerCount,
      providerNames,
      configuredProviderCount: configuredCount,
      activeProvider,
      activeModel,
      expandedProvider,
    },
  }
}

export function describeCurrentPageSnapshot(snapshot: InteractionSnapshot, t: TranslateFn): ActionExecutionResult {
  const page = snapshot.page?.label || snapshot.page?.title || t('multimodal.currentPage')
  const visibleObjects = snapshot.visibleObjects.filter((object) => object.id !== snapshot.page?.id)
  const labels = visibleObjects
    .map((object) => object.label)
    .filter((label): label is string => Boolean(label))
    .slice(0, 8)
  const message = t('multimodal.pageSummary', {
    page,
    count: visibleObjects.length,
    items: labels.length ? labels.join('、') : t('multimodal.none'),
  })
  return { status: 'unchanged', reason: message, data: { objectCount: visibleObjects.length, labels } }
}

function dedupeObjectsByEntityId(objects: InteractionSnapshot['visibleObjects']): InteractionSnapshot['visibleObjects'] {
  const seen = new Set<string>()
  return objects.filter((object) => {
    const key = object.entity?.id || object.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readStateString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStateNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readStateStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
