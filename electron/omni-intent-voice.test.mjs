import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { auditOmniAnswers } from './omni-answer-audit.mjs'
import { auditOmniControls } from './omni-control-audit.mjs'
import { auditOmniManualReadiness } from './omni-manual-readiness-audit.mjs'
import { auditOmniRules } from './omni-rule-audit.mjs'

const root = resolve(import.meta.dirname, '..')

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

async function importTranspiledTs(relativePath) {
  const source = read(relativePath)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  })
  const encoded = Buffer.from(outputText, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

async function importTranspiledTsProject(entryPath, dependencyPaths = []) {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'agentos-ts-'))
  const files = [entryPath, ...dependencyPaths]
  for (const relativePath of files) {
    const source = rewriteRelativeImports(read(relativePath))
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    })
    const outputPath = resolve(outputRoot, relativePath.replace(/\.tsx?$/, '.mjs'))
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, outputText, 'utf8')
  }
  return import(pathToFileURL(resolve(outputRoot, entryPath.replace(/\.tsx?$/, '.mjs'))).href)
}

function rewriteRelativeImports(source) {
  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, specifier) => {
    if (/\.(?:mjs|js|json|css)$/.test(specifier)) return match
    return `from ${quote}${specifier}.mjs${quote}`
  })
}

function createTranslator(catalog) {
  return (path, vars = {}) => {
    const template = path.split('.').reduce((node, key) => node?.[key], catalog)
    const value = typeof template === 'string' ? template : path
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key] ?? ''))
  }
}

test('Omni intent resolver runs Claude SDK in side-effect-free mode', () => {
  const main = read('electron/main.ts')
  const start = main.indexOf('async function resolveOmniIntent')
  const end = main.indexOf('function openMacApplication')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const source = main.slice(start, end)

  assert.match(source, /query\(\{/)
  assert.match(source, /allowedTools:\s*\[\]/)
  assert.match(source, /tools:\s*\[\]/)
  assert.match(source, /mcpServers:\s*\{\}/)
  assert.match(source, /settingSources:\s*\[\]/)
  assert.match(source, /skills:\s*\[\]/)
  assert.match(source, /maxTurns:\s*1/)
  assert.match(source, /abortController/)
  assert.match(source, /buildSdkEnv\(config\)/)
  assert.match(source, /summarizeSdkEnvForLog\(sdkEnv\)/)
  assert.doesNotMatch(source, /safeConsole(?:Info|Warn|Error)\([\s\S]{0,240}(?:apiKey|authToken)/)
})

test('system.openApp uses argument-vector open without shell interpolation', () => {
  const main = read('electron/main.ts')
  const start = main.indexOf('function openMacApplication')
  const end = main.indexOf('function submitVoiceCommand')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const source = main.slice(start, end)

  assert.match(source, /spawn\('\/usr\/bin\/open',\s*\['-a',\s*appName\]/)
  assert.match(source, /shell:\s*false/)
  assert.doesNotMatch(source, /\bexec\(/)
  assert.doesNotMatch(source, /\bshell\.open/)
})

test('system open commands keep safe local fallbacks and SDK-resolved open-ended actions', () => {
  const actions = read('src/multimodal/actions.ts')
  const config = read('src/multimodal/config.ts')
  const normalizer = read('src/multimodal/intent-normalizer.ts')
  const runtime = read('src/multimodal/AgentOsMultimodal.tsx')
  const main = read('electron/main.ts')
  const rulesStart = config.indexOf('rules: [')
  const llmStart = config.indexOf('  llm: {')
  assert.notEqual(rulesStart, -1)
  assert.notEqual(llmStart, -1)
  const settingsDescribeModelsIndex = config.indexOf("id: 'settings.describe.models'")
  const settingsOpenGeneralIndex = config.indexOf("id: 'settings.open.general'")
  assert.notEqual(settingsDescribeModelsIndex, -1)
  assert.notEqual(settingsOpenGeneralIndex, -1)
  assert.ok(settingsDescribeModelsIndex < settingsOpenGeneralIndex)
  const rulesSource = config.slice(rulesStart, llmStart)
  const localFastPathSource = config.slice(config.indexOf('localFastPath:'), config.indexOf('modelActionPolicy:'))
  const modelPolicySource = config.slice(config.indexOf('modelActionPolicy:'))

  assert.match(actions, /id:\s*'system\.openUrl'/)
  assert.match(actions, /id:\s*'system\.openApp'/)
  assert.match(rulesSource, /id:\s*'system\.openUrl\.google'/)
  assert.match(rulesSource, /actionId:\s*systemOpenUrlAction\.id/)
  assert.match(rulesSource, /params:\s*\{\s*url:\s*'https:\/\/www\.google\.com\/'\s*\}/)
  assert.doesNotMatch(rulesSource, /system\.openApp/)
  assert.doesNotMatch(rulesSource, /打开\{appName\}|打开 Safari|打开Safari|open Safari|open \{appName\}/)
  assert.doesNotMatch(localFastPathSource, /'system\.openUrl'/)
  assert.doesNotMatch(localFastPathSource, /'system\.openApp'/)
  assert.match(modelPolicySource, /'system\.openUrl'/)
  assert.match(modelPolicySource, /'system\.openApp'/)
  assert.match(config, /normalizeAgentOsIntentOutputForPageActions\(result\.content,\s*input\.snapshot\)/)
  assert.match(config, /pageActionTargetId/)
  assert.match(config, /Do not use website names or application names as targetReference/)
  assert.match(normalizer, /targetReference:\s*\{\s*kind:\s*'explicit_id',\s*objectId:\s*pageId\s*\}/)
  assert.match(config, /For system\.openUrl/)
  assert.match(config, /For system\.openApp/)
  assert.match(runtime, /useActionExecutor\(systemOpenUrlAction/)
  assert.match(runtime, /useActionExecutor\(systemOpenAppAction/)
  assert.match(runtime, /window\.desktop\.openExternal/)
  assert.match(runtime, /if \(!target\) return \{ status: 'rejected', reason: t\('multimodal\.invalidUrl'/)
  assert.match(runtime, /code: 'invalid_url'/)
  assert.match(runtime, /function normalizeExternalUrl/)
  assert.match(runtime, /if \(url\.protocol !== 'https:' && url\.protocol !== 'http:'\) return null/)
  assert.match(runtime, /if \(!url\.hostname\.includes\('\.'\)\) return null/)
  assert.match(runtime, /multimodal\.website\.google/)
  assert.match(main, /DESKTOP_INVOKE_CHANNELS\.openExternal/)
  assert.match(main, /isExternalHttpUrl\(rawUrl\)/)
  assert.match(main, /typeof rawUrl !== 'string' \|\| !isExternalHttpUrl\(rawUrl\)\) return/)
})

test('AgentOS LLM normalizer binds SDK system actions to current page target', async () => {
  const { normalizeAgentOsIntentOutputForPageActions } = await importTranspiledTs('src/multimodal/intent-normalizer.ts')
  const snapshot = {
    page: { id: 'agentos.page.current' },
    actionSpecs: {
      'system.openUrl': { attachTo: { role: 'page' }, executeScope: 'system' },
      'system.openApp': { attachTo: { role: 'page' }, executeScope: 'system' },
      'project.switch': { attachTo: { role: 'object' }, executeScope: 'object' },
    },
  }

  const openUrl = normalizeAgentOsIntentOutputForPageActions({
    actionId: 'system.openUrl',
    params: { url: 'Google' },
    targetReference: { kind: 'label', label: 'Google' },
  }, snapshot)

  assert.equal(openUrl.actionHint, 'system.openUrl')
  assert.equal(openUrl.targetId, 'agentos.page.current')
  assert.equal(openUrl.modelTargetIdHint, 'agentos.page.current')
  assert.deepEqual(openUrl.targetReference, { kind: 'explicit_id', objectId: 'agentos.page.current' })
  assert.deepEqual(openUrl.params, { url: 'Google' })

  const normalizedText = normalizeAgentOsIntentOutputForPageActions(JSON.stringify({
    hypotheses: [
      {
        actionHint: 'system.openApp',
        params: { appName: 'Safari' },
        targetReference: { kind: 'label', label: 'Safari' },
      },
      {
        actionId: 'project.switch',
        params: { projectId: 'project-2' },
        targetReference: { kind: 'label', label: '第二个项目' },
      },
    ],
  }), snapshot)
  const normalized = JSON.parse(normalizedText)

  assert.equal(normalized.hypotheses[0].targetId, 'agentos.page.current')
  assert.deepEqual(normalized.hypotheses[0].targetReference, { kind: 'explicit_id', objectId: 'agentos.page.current' })
  assert.deepEqual(normalized.hypotheses[0].params, { appName: 'Safari' })
  assert.deepEqual(normalized.hypotheses[1].targetReference, { kind: 'label', label: '第二个项目' })
})

test('AgentOS voice and text commands cover visible pages and shell modules', () => {
  const actions = read('src/multimodal/actions.ts')
  const config = read('src/multimodal/config.ts')
  const runtime = read('src/multimodal/AgentOsMultimodal.tsx')
  const voiceResult = read('src/multimodal/voice-result.ts')
  const settingsDescribe = read('src/multimodal/settings-describe.ts')
  const appShell = read('src/components/AppShell.tsx')
  const workspace = read('src/components/AppShellWorkspace.tsx')
  const zh = JSON.parse(read('src/locales/zh.json'))
  const en = JSON.parse(read('src/locales/en.json'))

  for (const actionId of [
    'app.navigate',
    'project.pin',
    'settings.describe',
    'search.open',
    'sidebar.set',
    'side-panel.open',
    'agent-status.open',
    'thread.switch',
    'thread.pin',
    'task-card.refresh',
    'skill.run',
  ]) {
    assert.match(actions, new RegExp(`id:\\s*'${actionId.replace('.', '\\.')}'`))
    assert.match(config, new RegExp(`'${actionId.replace('.', '\\.')}'`))
  }

  assert.match(actions, /export const settingsOpenAction[\s\S]*attachTo:\s*\{\s*role:\s*'page'\s*\}[\s\S]*executeScope:\s*'app'/)
  assert.match(actions, /export const systemOpenUrlAction[\s\S]*attachTo:\s*\{\s*role:\s*'page'\s*\}[\s\S]*executeScope:\s*'system'/)
  assert.match(actions, /export const systemOpenAppAction[\s\S]*attachTo:\s*\{\s*role:\s*'page'\s*\}[\s\S]*executeScope:\s*'system'/)
  assert.match(actions, /export const threadArchiveAction[\s\S]*attachTo:\s*\{\s*role:\s*'page',\s*entityType:\s*'thread'\s*\}/)

  for (const phrase of [
    '打开文档页',
    'open docs',
    '置顶当前项目',
    'pin current project',
    '打开全局设置的搜索页面',
    'open search settings',
    '现在设置了多少模型厂商',
    '配置了几个模型厂商',
    '有几个模型厂商',
    'how many model providers',
    '还有多少控件没有实现',
    '多少控件没接入omni',
    'omni control coverage',
    "params: { topic: 'controls' }",
    "params: { category: 'skills' }",
    "params: { category: 'updates' }",
    "params: { category: 'agent' }",
    "params: { category: 'developer' }",
    '打开全局搜索',
    'open global search',
    '搜索文件',
    'search files',
    '收起侧栏',
    'collapse sidebar',
    '打开文件面板',
    'open file panel',
    '打开 Agent 状态',
    'open Agent status',
    '打开{thread}对话',
    'open {thread} thread',
    '置顶当前对话',
    'pin current thread',
    '刷新任务卡',
    'refresh task cards',
    '运行{skillName}技能',
    'run {skillName} skill',
  ]) {
    assert.match(config, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const executor of [
    'useActionExecutor(appNavigateAction',
    'useActionExecutor(projectPinAction',
    'useActionExecutor(settingsDescribeAction',
    'useActionExecutor(searchOpenAction',
    'useActionExecutor(sidebarSetAction',
    'useActionExecutor(sidePanelOpenAction',
    'useActionExecutor(agentStatusOpenAction',
    'useActionExecutor(threadSwitchAction',
    'useActionExecutor(threadPinAction',
    'useActionExecutor(taskCardRefreshAction',
    'useActionExecutor(skillRunAction',
  ]) {
    assert.match(runtime, new RegExp(executor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(runtime, /describeSettingsSnapshot\(api\.getSnapshot\(\)/)
  assert.match(runtime, /mapSubmitResult\(result,\s*api\.getSnapshot\(\),\s*t\)/)
  assert.match(voiceResult, /export function mapSubmitResult/)
  assert.match(settingsDescribe, /describeOmniControlCoverage/)
  assert.match(settingsDescribe, /omniControlCoverageMissingCount/)
  assert.match(settingsDescribe, /multimodal\.omniControlCoverageSummary/)
  assert.match(voiceResult, /friendlySubmitError/)
  assert.match(voiceResult, /Resolved interaction has no executable action/)
  assert.match(runtime, /useI18n\(\)/)
  assert.match(runtime, /t\('multimodal\./)
  assert.doesNotMatch(runtime, /已打开|未找到目标|需要确认后执行|执行失败。|已取消。/)
  assert.equal(typeof zh.multimodal.noExecutableAction, 'string')
  assert.equal(typeof en.multimodal.noExecutableAction, 'string')
  assert.equal(typeof zh.multimodal.omniControlCoverageSummary, 'string')
  assert.equal(typeof en.multimodal.omniControlCoverageSummary, 'string')
  assert.match(zh.multimodal.noExecutableAction, /打开搜索设置/)
  assert.match(en.multimodal.noExecutableAction, /open search settings/)
  assert.match(zh.multimodal.omniControlCoverageSummary, /静态接入缺口/)
  assert.match(en.multimodal.omniControlCoverageSummary, /integration gap/)
  assert.match(appShell, /onNavigateView=\{navigateAppView\}/)
  assert.match(appShell, /settingsCategory=\{settingsCategory\}/)
  assert.match(appShell, /onSetSidebarCollapsed=\{setSidebarCollapsedState\}/)
  assert.match(appShell, /onToggleProjectPinned=\{toggleProjectPinned\}/)
  assert.match(appShell, /onToggleThreadPinned=\{toggleThreadPinned\}/)
  assert.match(appShell, /projectSkills=\{projectSkillStates\[activeProject\.id\]\?\.skills \?\? \[\]\}/)
  assert.match(appShell, /onRunProjectSkill=\{runProjectSkill\}/)
  assert.match(workspace, /agentos:open-side-panel/)
})

test('settings.describe executes model and control summaries from the interaction snapshot', async () => {
  const { describeSettingsSnapshot } = await importTranspiledTsProject('src/multimodal/settings-describe.ts', [
    'src/multimodal/coverage-summary.ts',
  ])
  const { mapSubmitResult } = await importTranspiledTs('src/multimodal/voice-result.ts')
  const t = createTranslator(JSON.parse(read('src/locales/zh.json')))
  const modelSnapshot = {
    page: { id: 'agentos.page.settings', label: '设置' },
    visibleObjects: [
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
  }

  const models = describeSettingsSnapshot(modelSnapshot, 'settings', 'general', { topic: 'models' }, t)
  assert.equal(models.status, 'unchanged')
  assert.equal(models.data.providerCount, 2)
  assert.deepEqual(models.data.providerNames, ['MiniMax-CN', '智谱 GLM'])
  assert.equal(models.data.configuredProviderCount, 2)
  assert.equal(models.data.activeModel, 'MiniMax-M3')
  assert.match(models.reason, /2 个模型厂商/)
  assert.match(models.reason, /MiniMax-CN、智谱 GLM/)
  assert.doesNotMatch(models.reason, /sk-should-not-leak|sk-also-hidden/)
  const modelVoiceResult = mapSubmitResult(
    createSubmitResultWithExecution(models, '现在设置了多少模型厂商'),
    modelSnapshot,
    t,
  )
  assert.equal(modelVoiceResult.status, 'success')
  assert.equal(modelVoiceResult.message, models.reason)

  const controls = describeSettingsSnapshot(
    {
      page: { id: 'agentos.page.current', label: '当前页面' },
      visibleObjects: [
        { id: 'agentos.page.current', label: '当前页面' },
        { id: 'agentos.control.composer.send', label: '发送消息' },
        { id: 'agentos.control.sidebar.toggle', label: '切换侧栏' },
      ],
    },
    'home',
    'general',
    { topic: 'controls' },
    t,
  )
  assert.equal(controls.status, 'unchanged')
  assert.equal(controls.data.missingCount, 0)
  assert.equal(controls.data.nativeControls.total, 176)
  assert.equal(controls.data.customInteractiveControls.total, 52)
  assert.equal(controls.data.currentPageObjectCount, 2)
  assert.match(controls.reason, /静态接入缺口为 0 个/)
  assert.match(controls.reason, /原生控件 176\/176/)
  const controlsVoiceResult = mapSubmitResult(
    createSubmitResultWithExecution(controls, '还有多少控件没有实现'),
    {
      page: { id: 'agentos.page.current', label: '当前页面' },
      visibleObjects: [
        { id: 'agentos.page.current', label: '当前页面' },
        { id: 'agentos.control.composer.send', label: '发送消息' },
        { id: 'agentos.control.sidebar.toggle', label: '切换侧栏' },
      ],
    },
    t,
  )
  assert.equal(controlsVoiceResult.status, 'success')
  assert.equal(controlsVoiceResult.message, controls.reason)

  const current = describeSettingsSnapshot(
    {
      page: { id: 'agentos.page.home', label: '项目首页' },
      visibleObjects: [
        { id: 'agentos.page.home', label: '项目首页' },
        { id: 'agentos.control.projectHome.addCard', label: '添加卡片' },
      ],
    },
    'home',
    'general',
    { topic: 'current' },
    t,
  )
  assert.equal(current.data.objectCount, 1)
  assert.deepEqual(current.data.labels, ['添加卡片'])
})

function createSubmitResultWithExecution(execution, utterance) {
  return {
    ok: true,
    snapshot: { visibleObjects: [] },
    resolution: {
      status: 'resolved',
      utterance,
      actionId: 'settings.describe',
      targetId: 'agentos.page.current',
      confidence: 0.92,
    },
    dispatch: { execution },
  }
}

test('AgentOS configured Omni rules resolve settings summary and coverage questions', async () => {
  const audit = await auditOmniRules(root)
  assert.equal(
    audit.failed,
    0,
    `Expected ${audit.caseCount} configured Omni rule cases to resolve as designed. Failures:\n${JSON.stringify(audit.failures, null, 2)}`,
  )

  const byUtterance = new Map(audit.results.map((result) => [result.utterance, result.actual]))
  assert.deepEqual(byUtterance.get('现在设置了多少模型厂商'), {
    status: 'resolved',
    actionId: 'settings.describe',
    targetId: 'agentos.page.current',
    params: { topic: 'models' },
    reason: 'configured_rule:settings.describe.models',
  })
  assert.deepEqual(byUtterance.get('还有多少控件没有实现'), {
    status: 'resolved',
    actionId: 'settings.describe',
    targetId: 'agentos.page.current',
    params: { topic: 'controls' },
    reason: 'configured_rule:settings.describe.controls',
  })
  assert.deepEqual(byUtterance.get('打开 Google 页面'), {
    status: 'resolved',
    actionId: 'system.openUrl',
    targetId: 'agentos.page.current',
    params: { url: 'https://www.google.com/' },
    reason: 'configured_rule:system.openUrl.google',
  })
  assert.equal(byUtterance.get('打开 Safari').status, 'not_found')
})

test('AgentOS Omni answer audit resolves questions into voice-window messages', async () => {
  const audit = await auditOmniAnswers(root)
  assert.equal(
    audit.failed,
    0,
    `Expected ${audit.caseCount} Omni answer cases to produce safe voice-window messages. Failures:\n${JSON.stringify(audit.failures, null, 2)}`,
  )

  const byId = new Map(audit.results.map((result) => [result.id, result.actual]))
  assert.match(byId.get('settings.describe.models.answer').message, /2 个模型厂商/)
  assert.match(byId.get('settings.describe.controls.answer').message, /静态接入缺口为 0 个/)
  assert.match(byId.get('settings.describe.current.answer').message, /项目首页 当前有 2 个可交互对象/)
})

test('High-value AgentOS controls register explicit Omni semantics with i18n labels', () => {
  const semanticControls = read('src/multimodal/semantic-controls.tsx')
  const sidebar = read('src/components/AppShellSidebar.tsx')
  const workspace = read('src/components/AppShellWorkspace.tsx')
  const composer = read('src/components/chat/Composer.tsx')
  const projectHome = read('src/components/chat/ProjectHomeSurface.tsx')
  const modelSettings = read('src/components/setting/ClaudeAgentSettingsPage.tsx')
  const zh = read('src/locales/zh.json')
  const en = read('src/locales/en.json')

  assert.match(semanticControls, /useInteractionNode/)
  assert.match(semanticControls, /SemanticButton/)
  assert.match(semanticControls, /semanticAliases/)
  assert.match(projectHome, /useInteractionObject/)
  assert.match(modelSettings, /useInteractionObjects/)
  assert.match(modelSettings, /agentos\.settings\.models\.summary/)
  assert.match(modelSettings, /entity=\{\{ type: 'model-provider'/)
  assert.match(modelSettings, /data-mm-exposure="value"/)
  assert.match(modelSettings, /data-mm-sensitive="true"/)

  for (const source of [sidebar, workspace, composer, projectHome, modelSettings]) {
    assert.match(source, /SemanticButton|useSemanticNodeRef|useInteractionObject/)
    assert.doesNotMatch(source, /label:\s*['"][^'"]*(?:打开|发送|执行|停止|处理中|文件树|搜索|设置)[^'"]*['"]/)
  }

  for (const id of [
    'agentos.control.sidebar.toggle',
    'agentos.control.sidebar.search',
    'agentos.control.workspace.filePanel',
    'agentos.control.composer.input',
    'agentos.control.composer.send',
    'agentos.control.composer.voice',
    'agentos.control.composer.modelPicker',
    'agentos.control.composer.permissionMode',
    'agentos.control.projectHome.projectSelector',
    'agentos.control.projectHome.addCard',
    'agentos.control.todoCard.open',
    'agentos.control.settings.models.addProvider',
    'agentos.control.settings.models.save',
    'agentos.settings.modelProvider.',
  ]) {
    assert.match(`${sidebar}\n${workspace}\n${composer}\n${projectHome}\n${modelSettings}`, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const key of [
    '"omni"',
    '"controls"',
    '"aliases"',
    '"composerInput"',
    '"projectSelect"',
    '"threadSelect"',
    '"skillRun"',
    '"projectHomeAddCard"',
    '"settingsModelSummary"',
    '"settingsModelProvider"',
    '"todoCardOpenAria"',
    '"todoCardProgressAria"',
  ]) {
    assert.match(zh, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(en, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.doesNotMatch(projectHome, />处理中</)
  assert.doesNotMatch(projectHome, /aria-label="打开 TODO\.md"/)
  assert.doesNotMatch(projectHome, /TODO progress \$\{todo\.percent\}/)
})

test('Settings, search, transcript, and utility controls expose explicit Omni-safe labels', () => {
  const appShell = read('src/components/AppShell.tsx')
  const searchModal = read('src/components/AppSearchModal.tsx')
  const projectSkills = read('src/components/setting/ProjectSkillsSettingsPage.tsx')
  const transcript = read('src/components/chat/Transcript.tsx')
  const composer = read('src/components/chat/Composer.tsx')
  const projectHome = read('src/components/chat/ProjectHomeSurface.tsx')
  const agentPrompt = read('src/components/chat/AgentInputPromptModal.tsx')
  const richCode = read('src/components/chat/RichCodeBlock.tsx')
  const generativeWidget = read('src/components/chat/GenerativeWidget.tsx')
  const agentControls = read('src/components/AgentModeControls.tsx')
  const agentMenu = read('src/components/AgentModeMenu.tsx')
  const statusPopover = read('src/components/AppAgentStatusPopover.tsx')
  const fileTree = read('src/components/AppFileTreePane.tsx')
  const sidePanel = read('src/components/AppWorkspaceSidePanel.tsx')
  const threadView = read('src/components/chat/ChatThreadView.tsx')
  const previewOverlay = read('src/components/ProjectFilePreviewOverlay.tsx')
  const agentSettings = read('src/components/setting/AgentModeSettingsPage.tsx')
  const updateSection = read('src/components/setting/AppUpdateSection.tsx')
  const developerSettings = read('src/components/setting/DeveloperSettingsPage.tsx')
  const modelSettings = read('src/components/setting/ClaudeAgentSettingsPage.tsx')

  for (const source of [
    appShell,
    searchModal,
    projectSkills,
    transcript,
    composer,
    projectHome,
    agentPrompt,
    richCode,
    generativeWidget,
    agentControls,
    agentMenu,
    statusPopover,
    fileTree,
    sidePanel,
    threadView,
    previewOverlay,
    agentSettings,
    updateSection,
    developerSettings,
    modelSettings,
  ]) {
    assert.match(source, /data-mm-label|SemanticButton|useSemanticNodeRef|useInteractionObject|MultimodalGroup/)
  }

  for (const sensitiveSource of [appShell, modelSettings]) {
    assert.match(sensitiveSource, /data-mm-sensitive="true"/)
  }
  assert.match(searchModal, /data-mm-exposure="value"/)
  assert.match(projectSkills, /data-mm-exposure="value"/)
  assert.match(transcript, /data-mm-exposure="value"/)
  assert.match(projectHome, /data-mm-exposure="value"/)
  assert.match(read('src/multimodal/config.ts'), /settings\.describe\.models/)
})

test('All TSX native controls expose Omni semantics or semantic refs', () => {
  const audit = auditOmniControls(root)
  assert.equal(
    audit.nativeControls.missing,
    0,
    `Expected ${audit.nativeControls.total} native controls to expose Omni semantics. Missing:\n${audit.nativeControls.gaps.join('\n')}`,
  )
})

test('All TSX custom interactive controls expose Omni semantics or semantic props', () => {
  const audit = auditOmniControls(root)
  assert.equal(
    audit.customInteractiveControls.missing,
    0,
    `Expected ${audit.customInteractiveControls.total} custom interactive controls to expose Omni semantics. Missing:\n${audit.customInteractiveControls.gaps.join('\n')}`,
  )
})

test('Omni coverage summary matches the TSX control audits', async () => {
  const { OMNI_CONTROL_COVERAGE, omniControlCoverageMissingCount } = await importTranspiledTs('src/multimodal/coverage-summary.ts')
  const audit = auditOmniControls(root)

  assert.equal(audit.tsxFileCount, OMNI_CONTROL_COVERAGE.tsxFileCount)
  assert.equal(audit.nativeControls.total, OMNI_CONTROL_COVERAGE.nativeControls.total)
  assert.equal(audit.nativeControls.covered, OMNI_CONTROL_COVERAGE.nativeControls.covered)
  assert.equal(audit.nativeControls.missing, OMNI_CONTROL_COVERAGE.nativeControls.missing)
  assert.equal(audit.customInteractiveControls.total, OMNI_CONTROL_COVERAGE.customInteractiveControls.total)
  assert.equal(audit.customInteractiveControls.covered, OMNI_CONTROL_COVERAGE.customInteractiveControls.covered)
  assert.equal(audit.customInteractiveControls.missing, OMNI_CONTROL_COVERAGE.customInteractiveControls.missing)
  assert.equal(omniControlCoverageMissingCount(), audit.nativeControls.missing + audit.customInteractiveControls.missing)
})

test('Remaining Omni manual-only scenarios keep acceptance and source readiness evidence', () => {
  const audit = auditOmniManualReadiness(root)
  assert.equal(
    audit.failed,
    0,
    `Expected ${audit.scenarioCount} manual-only Omni scenarios to keep readiness evidence. Failures:\n${JSON.stringify(audit.failures, null, 2)}`,
  )
  assert.equal(audit.scenarioCount, 9)
})

test('Voice command window has isolated route, shortcut, and request/result IPC', () => {
  const main = read('electron/main.ts')
  const preload = read('electron/preload.ts')
  const voiceHtml = read('voice.html')
  const voiceRenderer = read('src/voice-main.tsx')
  const voiceState = read('src/voice-state.ts')
  const runtime = read('src/multimodal/AgentOsMultimodal.tsx')
  const appShell = read('src/components/AppShell.tsx')
  const style = read('src/style.css')
  const viteConfig = read('vite.config.ts')

  assert.match(main, /VOICE_COMMAND_SHORTCUT\s*=\s*'Option\+Space'/)
  assert.match(main, /loadURL\(`\$\{VITE_DEV_SERVER_URL\.replace\(\/\\\/\$\/,\s*''\)\}\/voice\.html`\)/)
  assert.match(main, /loadFile\(path\.join\(RENDERER_DIST,\s*'voice\.html'\)\)/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandRequest/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandResponse/)
  assert.match(main, /DESKTOP_EVENT_CHANNELS\.onVoiceCommandResult/)
  assert.doesNotMatch(main, /voiceCommandWindow\.on\('blur'/)
  assert.match(main, /target\.show\(\)/)
  assert.match(preload, /onVoiceCommandRequest/)
  assert.match(preload, /onVoiceCommandResponse/)
  assert.match(preload, /onVoiceCommandResult/)
  assert.match(voiceHtml, /src="\/src\/voice-main\.tsx"/)
  assert.match(voiceRenderer, /consumer:\s*'voice-command'/)
  assert.match(voiceRenderer, /respondVoiceCommand/)
  assert.match(voiceRenderer, /import '\.\/style\.css'/)
  assert.match(voiceRenderer, /className="chat-composer voice-command-composer"/)
  assert.match(voiceRenderer, /className="chat-input"/)
  assert.match(voiceRenderer, /data-testid="voice-window-start"/)
  assert.match(voiceRenderer, /data-testid="voice-window-submit"/)
  assert.match(voiceRenderer, /data-testid="voice-window-final-input"/)
  assert.match(voiceRenderer, /data-testid="voice-window-confirm-card"/)
  assert.match(voiceRenderer, /data-testid="voice-window-clarify-list"/)
  assert.match(voiceRenderer, /selectVoiceCommandText\(state\)/)
  assert.match(voiceRenderer, /reduceSpeechEvent\(current,\s*event\)/)
  assert.match(voiceRenderer, /reduceVoiceCommandResult\(current,\s*result\)/)
  assert.match(voiceState, /export function reduceSpeechEvent/)
  assert.match(voiceState, /export function reduceVoiceCommandResult/)
  assert.match(runtime, /return null/)
  assert.doesNotMatch(runtime, /omni-command-shell/)
  assert.match(appShell, /style=\{\{\s*display:\s*'contents'\s*\}\}/)
  assert.match(style, /#app\s*>\s*\[data-mm-root\]\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/)
  assert.match(style, /\.multimodal-page-root\s*\{[\s\S]*display:\s*contents;/)
  assert.match(viteConfig, /voice:\s*path\.resolve\(__dirname,\s*'voice\.html'\)/)
})

test('Voice command window state handles final edits and recoverable speech failures', async () => {
  const {
    composerStatusLabel,
    createInitialVoiceUiState,
    isSpeechRecordingStatus,
    reduceSpeechEvent,
    reduceVoiceCommandResult,
    selectVoiceCommandText,
    statusLabel,
    voiceButtonClassName,
  } = await importTranspiledTs('src/voice-state.ts')

  let state = createInitialVoiceUiState()
  assert.equal(statusLabel(state.status, state.submittingId), '准备接收语音命令')
  assert.equal(composerStatusLabel(state.status, state.submittingId), '就绪')
  assert.equal(selectVoiceCommandText(state), '')

  state = reduceSpeechEvent(state, { type: 'status', status: 'listening' })
  assert.equal(isSpeechRecordingStatus(state.status), true)
  assert.equal(statusLabel(state.status, state.submittingId), '正在聆听')
  assert.equal(composerStatusLabel(state.status, state.submittingId), '正在听')
  assert.match(voiceButtonClassName(state.status), /is-active/)
  assert.match(voiceButtonClassName(state.status), /composer-voice-button--listening/)

  state = reduceSpeechEvent(state, { type: 'partial', text: '打开 Go' })
  assert.equal(selectVoiceCommandText(state), '打开 Go')

  state = reduceSpeechEvent(state, { type: 'final', text: '打开 Google 页面' })
  assert.equal(state.status, 'idle')
  assert.equal(state.partialText, '')
  assert.equal(selectVoiceCommandText(state), '打开 Google 页面')

  state = { ...state, finalText: '打开 Safari 应用', partialText: '打开 Google 页面' }
  assert.equal(selectVoiceCommandText(state), '打开 Safari 应用')

  const deniedState = reduceSpeechEvent(state, {
    type: 'error',
    code: 'speech_denied',
    message: '语音识别权限被拒绝',
  })
  assert.equal(deniedState.status, 'error')
  assert.equal(deniedState.error, '语音识别权限被拒绝')
  assert.match(deniedState.permissionHint, /系统设置/)
  assert.equal(isSpeechRecordingStatus(deniedState.status), false)
  assert.equal(composerStatusLabel(deniedState.status, deniedState.submittingId), '需处理')

  const helperRecordingState = reduceSpeechEvent(createInitialVoiceUiState(), { type: 'status', status: 'listening' })
  const helperErrorState = reduceSpeechEvent(helperRecordingState, {
    type: 'error',
    code: 'helper_exited',
    message: 'Apple Speech helper exited with signal TERM.',
  })
  assert.equal(helperErrorState.status, 'error')
  assert.equal(helperErrorState.error, 'Apple Speech helper exited with signal TERM.')
  assert.equal(helperErrorState.permissionHint, '')
  assert.equal(isSpeechRecordingStatus(helperErrorState.status), false)
  assert.equal(statusLabel(helperErrorState.status, helperErrorState.submittingId), '语音识别遇到问题')

  const pendingState = { ...createInitialVoiceUiState(), submittingId: 'cmd-1' }
  const staleResultState = reduceVoiceCommandResult(pendingState, {
    id: 'cmd-2',
    status: 'success',
    message: 'stale result',
  })
  assert.equal(staleResultState, pendingState)

  const completedState = reduceVoiceCommandResult(pendingState, {
    id: 'cmd-1',
    status: 'success',
    message: '已执行',
  })
  assert.equal(completedState.submittingId, null)
  assert.equal(completedState.result.message, '已执行')
  assert.equal(statusLabel(completedState.status, completedState.submittingId), '准备接收语音命令')

  const metaState = reduceVoiceCommandResult({ ...createInitialVoiceUiState(), submittingId: 'cmd-1' }, {
    id: 'voice-window-meta',
    status: 'failed',
    message: '主窗口还没有准备好。',
  })
  assert.equal(metaState.submittingId, 'cmd-1')
  assert.equal(metaState.error, '主窗口还没有准备好。')
})

test('Speech recognition routes events to the active consumer window only', () => {
  const speechRecognition = read('electron/speech-recognition.ts')

  assert.match(speechRecognition, /activeConsumerWindowId:\s*number \| null/)
  assert.match(speechRecognition, /activeConsumer:\s*SpeechRecognitionConsumer \| null/)
  assert.match(speechRecognition, /BrowserWindow\.fromId\(this\.activeConsumerWindowId\)/)
  assert.match(speechRecognition, /isAuthorizedConsumer\(targetWindow\)/)
  assert.match(speechRecognition, /targetWindow\.id === this\.activeConsumerWindowId/)
  assert.match(speechRecognition, /this\.activeConsumer = options\.consumer \?\? 'composer'/)
  assert.match(speechRecognition, /this\.activeConsumerWindowId = null/)
})
