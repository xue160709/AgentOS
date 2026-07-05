import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createConfiguredRuleResolver } from '@xue160709/omni-ui-core'
import { createTranslator, importTranspiledTsProject, readJson } from './omni-audit-utils.mjs'

const CONFIG_ENTRY = 'src/multimodal/config.ts'
const CONFIG_DEPENDENCIES = [
  'src/multimodal/actions.ts',
  'src/multimodal/intent-normalizer.ts',
]

export const OMNI_ANSWER_AUDIT_CASES = [
  {
    id: 'settings.describe.models.answer',
    utterance: '现在设置了多少模型厂商',
    activeViewId: 'settings',
    settingsCategory: 'general',
    snapshot: createModelSettingsSnapshot(),
    expectedResolution: {
      status: 'resolved',
      actionId: 'settings.describe',
      params: { topic: 'models' },
    },
    messageIncludes: ['2 个模型厂商', 'MiniMax-CN、智谱 GLM', 'MiniMax-CN / MiniMax-M3', 'API Key 已设置 2 个'],
    messageExcludes: ['sk-should-not-leak', 'sk-also-hidden'],
  },
  {
    id: 'settings.describe.controls.answer',
    utterance: '还有多少控件没有实现',
    activeViewId: 'home',
    settingsCategory: 'general',
    snapshot: createControlCoverageSnapshot(),
    expectedResolution: {
      status: 'resolved',
      actionId: 'settings.describe',
      params: { topic: 'controls' },
    },
    messageIncludes: ['静态接入缺口为 0 个', '原生控件 176/176', '非原生交互控件 52/52', '不是控件接入缺口'],
  },
  {
    id: 'settings.describe.current.answer',
    utterance: '当前页面有什么',
    activeViewId: 'home',
    settingsCategory: 'general',
    snapshot: createCurrentPageSnapshot(),
    expectedResolution: {
      status: 'resolved',
      actionId: 'settings.describe',
      params: { topic: 'current' },
    },
    messageIncludes: ['项目首页 当前有 2 个可交互对象', '发送消息、添加卡片'],
  },
]

export async function auditOmniAnswers(root = resolve(import.meta.dirname, '..')) {
  const [
    { agentOsMultimodalConfig },
    { describeSettingsSnapshot },
    { mapSubmitResult },
  ] = await Promise.all([
    importTranspiledTsProject(root, CONFIG_ENTRY, CONFIG_DEPENDENCIES),
    importTranspiledTsProject(root, 'src/multimodal/settings-describe.ts', [
      'src/multimodal/coverage-summary.ts',
    ]),
    importTranspiledTsProject(root, 'src/multimodal/voice-result.ts'),
  ])

  const resolver = createConfiguredRuleResolver({
    id: 'agentos-answer-audit',
    rules: agentOsMultimodalConfig.rules,
  })
  const t = createTranslator(readJson(root, 'src/locales/zh.json'))
  const results = []

  for (const auditCase of OMNI_ANSWER_AUDIT_CASES) {
    const resolution = await resolver.resolve({ utterance: auditCase.utterance, snapshot: auditCase.snapshot })
    const execution = resolution.status === 'resolved' && resolution.actionId === 'settings.describe'
      ? describeSettingsSnapshot(auditCase.snapshot, auditCase.activeViewId, auditCase.settingsCategory, resolution.params ?? {}, t)
      : undefined
    const voiceResult = execution
      ? mapSubmitResult(createSubmitResultWithExecution(execution, resolution), auditCase.snapshot, t)
      : undefined
    const errors = [
      ...compareResolution(resolution, auditCase.expectedResolution),
      ...compareAnswerMessage(voiceResult?.message ?? '', auditCase),
    ]
    results.push({
      id: auditCase.id,
      utterance: auditCase.utterance,
      ok: errors.length === 0,
      errors,
      actual: {
        resolution: pickResolutionFields(resolution),
        executionStatus: execution?.status,
        message: voiceResult?.message,
      },
    })
  }

  const failures = results.filter((result) => !result.ok)
  return {
    caseCount: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  }
}

function createSubmitResultWithExecution(execution, resolution) {
  return {
    ok: true,
    snapshot: { visibleObjects: [] },
    resolution,
    dispatch: { execution },
  }
}

function createModelSettingsSnapshot() {
  return createSnapshot(
    { id: 'agentos.page.settings', label: '设置' },
    [
      {
        id: 'agentos.settings.models.summary',
        label: '模型设置摘要',
        state: {
          providerCount: 2,
          providerNames: ['MiniMax-CN', '智谱 GLM'],
          configuredProviderCount: 2,
          activeProviderName: 'MiniMax-CN',
          activeModel: 'MiniMax-M3',
          expandedProviderName: 'MiniMax-CN',
        },
      },
      {
        id: 'agentos.settings.modelProvider.minimax',
        label: 'MiniMax-CN',
        entity: { type: 'model-provider', id: 'minimax' },
        state: { apiKeyConfigured: true, apiKey: 'sk-should-not-leak' },
      },
      {
        id: 'agentos.settings.modelProvider.bigmodel',
        label: '智谱 GLM',
        entity: { type: 'model-provider', id: 'bigmodel' },
        state: { apiKeyConfigured: true, apiKey: 'sk-also-hidden' },
      },
    ],
  )
}

function createControlCoverageSnapshot() {
  return createSnapshot(
    { id: 'agentos.page.current', label: '当前页面' },
    [
      { id: 'agentos.control.composer.send', label: '发送消息' },
      { id: 'agentos.control.sidebar.toggle', label: '切换侧栏' },
    ],
  )
}

function createCurrentPageSnapshot() {
  return createSnapshot(
    { id: 'agentos.page.home', label: '项目首页' },
    [
      { id: 'agentos.control.composer.send', label: '发送消息' },
      { id: 'agentos.control.projectHome.addCard', label: '添加卡片' },
    ],
  )
}

function createSnapshot(pageInput, objects) {
  const page = {
    id: pageInput.id,
    type: 'page',
    role: 'page',
    label: pageInput.label,
    title: pageInput.label,
    actions: ['settings.describe'],
  }
  return {
    snapshotId: `agentos-answer-audit:${page.id}`,
    stateVersion: 1,
    contextHash: `agentos-answer-audit:${page.id}`,
    contextEpoch: 1,
    focusRevision: 0,
    eventSequence: 0,
    contextStack: [{ type: 'page', id: page.id, title: page.title }],
    page,
    visibleObjects: [page, ...objects],
    unifiedFocus: {},
    recentEvents: [],
    actionSpecs: {},
  }
}

function compareResolution(actual, expected) {
  const errors = []
  for (const [key, value] of Object.entries(expected)) {
    if (!deepEqual(actual?.[key], value)) {
      errors.push(`resolution.${key}: expected ${JSON.stringify(value)}, received ${JSON.stringify(actual?.[key])}`)
    }
  }
  return errors
}

function compareAnswerMessage(message, auditCase) {
  const errors = []
  if (!message) {
    errors.push('message: expected a non-empty voice-window result message')
    return errors
  }
  for (const fragment of auditCase.messageIncludes ?? []) {
    if (!message.includes(fragment)) {
      errors.push(`message: expected to include ${JSON.stringify(fragment)}, received ${JSON.stringify(message)}`)
    }
  }
  for (const fragment of auditCase.messageExcludes ?? []) {
    if (message.includes(fragment)) {
      errors.push(`message: expected not to include ${JSON.stringify(fragment)}, received ${JSON.stringify(message)}`)
    }
  }
  return errors
}

function pickResolutionFields(resolution) {
  return {
    status: resolution.status,
    actionId: resolution.actionId,
    targetId: resolution.targetId,
    params: resolution.params,
    reason: resolution.reason,
  }
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditOmniAnswers()
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) {
    process.exitCode = 1
  }
}
