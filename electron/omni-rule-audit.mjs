import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createConfiguredRuleResolver } from '@xue160709/omni-ui-core'
import { importTranspiledTsProject } from './omni-audit-utils.mjs'

const CONFIG_ENTRY = 'src/multimodal/config.ts'
const CONFIG_DEPENDENCIES = [
  'src/multimodal/actions.ts',
  'src/multimodal/intent-normalizer.ts',
]

export const OMNI_RULE_AUDIT_CASES = [
  {
    utterance: '现在设置了多少模型厂商',
    expected: {
      status: 'resolved',
      actionId: 'settings.describe',
      targetId: 'agentos.page.current',
      params: { topic: 'models' },
    },
  },
  {
    utterance: '现在模型设置页面有几个模型厂商',
    expected: {
      status: 'resolved',
      actionId: 'settings.describe',
      targetId: 'agentos.page.current',
      params: { topic: 'models' },
    },
  },
  {
    utterance: '还有多少控件没有实现',
    expected: {
      status: 'resolved',
      actionId: 'settings.describe',
      targetId: 'agentos.page.current',
      params: { topic: 'controls' },
    },
  },
  {
    utterance: '多少控件没接入omni',
    expected: {
      status: 'resolved',
      actionId: 'settings.describe',
      targetId: 'agentos.page.current',
      params: { topic: 'controls' },
    },
  },
  {
    utterance: '打开搜索设置',
    expected: {
      status: 'resolved',
      actionId: 'settings.open',
      targetId: 'agentos.page.current',
      params: { category: 'search' },
    },
  },
  {
    utterance: '打开 Google 页面',
    expected: {
      status: 'resolved',
      actionId: 'system.openUrl',
      targetId: 'agentos.page.current',
      params: { url: 'https://www.google.com/' },
    },
  },
  {
    utterance: '打开 Safari',
    expected: {
      status: 'not_found',
    },
  },
]

export async function auditOmniRules(root = resolve(import.meta.dirname, '..')) {
  const { agentOsMultimodalConfig } = await importTranspiledTsProject(root, CONFIG_ENTRY, CONFIG_DEPENDENCIES)
  const resolver = createConfiguredRuleResolver({
    id: 'agentos-rule-audit',
    rules: agentOsMultimodalConfig.rules,
  })
  const snapshot = createAuditSnapshot()
  const results = []

  for (const auditCase of OMNI_RULE_AUDIT_CASES) {
    const resolution = await resolver.resolve({ utterance: auditCase.utterance, snapshot })
    const errors = compareResolution(resolution, auditCase.expected)
    results.push({
      utterance: auditCase.utterance,
      ok: errors.length === 0,
      errors,
      expected: auditCase.expected,
      actual: pickResolutionFields(resolution),
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

function createAuditSnapshot() {
  const page = {
    id: 'agentos.page.current',
    type: 'page',
    role: 'page',
    label: 'AgentOS 当前页',
    title: 'AgentOS',
    actions: ['settings.describe', 'settings.open', 'app.navigate'],
  }
  return {
    snapshotId: 'agentos-rule-audit',
    stateVersion: 1,
    contextHash: 'agentos-rule-audit',
    contextEpoch: 1,
    focusRevision: 0,
    eventSequence: 0,
    contextStack: [{ type: 'page', id: page.id, title: page.title }],
    page,
    visibleObjects: [page],
    unifiedFocus: {},
    recentEvents: [],
    actionSpecs: {},
  }
}

function compareResolution(actual, expected) {
  const errors = []
  for (const [key, value] of Object.entries(expected)) {
    if (!deepEqual(actual?.[key], value)) {
      errors.push(`${key}: expected ${JSON.stringify(value)}, received ${JSON.stringify(actual?.[key])}`)
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
  const result = await auditOmniRules()
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) {
    process.exitCode = 1
  }
}
