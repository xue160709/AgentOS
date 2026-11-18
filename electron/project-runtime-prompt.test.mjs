import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

function loadTsModule(modulePath, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports
  const { outputText } = ts.transpileModule(readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath,
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

const prompt = loadTsModule(resolve(testDir, './project-runtime-prompt.ts'))

test('project Runtime prompt injects the canonical absolute .agentos root', async () => {
  const root = mkdtempSync(`${tmpdir()}/project-runtime-prompt-`)
  const context = await prompt.resolveProjectAgentRuntimeContext('project-1', root)
  assert.deepEqual(context, {
    projectId: 'project-1',
    projectRoot: realpathSync(root),
    runtimeRoot: resolve(realpathSync(root), '.agentos'),
  })
  const rendered = prompt.buildProjectRuntimeSystemPrompt(context)
  assert.match(rendered, /<agentos_project_runtime>/)
  assert.match(rendered, new RegExp(resolve(realpathSync(root), '.agentos').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(rendered, /读取并分析当前项目文件夹中已有的文档、数据、代码和其他内容/)
  assert.match(rendered, /必须构建一个数据可视化工作台/)
  assert.match(rendered, /必须使用 Next\.js、React 和 TypeScript 实现/)
  assert.match(rendered, /out\/index\.html/)
  assert.match(rendered, /不得使用 Python、Flask、Streamlit/)
  assert.match(rendered, /在上述 \.agentos 目录内执行 npm install/)
  assert.match(rendered, /执行 npm run build/)
  assert.match(rendered, /构建成功并生成 out\/index\.html/)
  assert.match(rendered, /不要把 Runtime 网页实现写入项目根目录/)
})

test('project Runtime prompt is absent without a projectId or when the project path is invalid', async () => {
  const root = mkdtempSync(`${tmpdir()}/project-runtime-prompt-`)
  assert.equal(await prompt.resolveProjectAgentRuntimeContext(undefined, root), null)
  assert.equal(await prompt.resolveProjectAgentRuntimeContext('project-1', resolve(root, 'missing')), null)
})

test('Runtime creation copy requires a Next.js data-visualization workbench from project content', () => {
  for (const locale of ['zh', 'en']) {
    const copy = JSON.parse(readFileSync(resolve(testDir, `../src/locales/${locale}.json`), 'utf8')).runtime.createPrompt
    assert.match(copy, /Next\.js/)
    assert.match(copy, /\.agentos/)
    assert.match(copy, /npm install/)
    assert.match(copy, /npm run build/)
    assert.match(copy, /out\/index\.html/)
    assert.match(copy, /Python/)
  }
  const zhCopy = JSON.parse(readFileSync(resolve(testDir, '../src/locales/zh.json'), 'utf8')).runtime.createPrompt
  assert.match(zhCopy, /当前项目文件夹中的已有内容和数据/)
  assert.match(zhCopy, /数据可视化工作台/)
  const enCopy = JSON.parse(readFileSync(resolve(testDir, '../src/locales/en.json'), 'utf8')).runtime.createPrompt
  assert.match(enCopy, /existing content and data in the current project folder/)
  assert.match(enCopy, /data-visualization workbench/)
})

test('Claude runner appends the project Runtime prompt only for an eligible Runtime-scoped request', () => {
  const runner = readFileSync(resolve(testDir, './claude-agent-runner.ts'), 'utf8')
  assert.match(runner, /activeRequest\.projectRuntimePrompt\s*\?\s*await resolveProjectAgentRuntimeContext\(activeRequest\.projectId, activeRequest\.cwd\)\s*:\s*null/)
  assert.match(runner, /projectRuntimePrompt: payload\.projectRuntimePrompt === true/)
  assert.match(runner, /buildRequestAppendSystemPrompt\(activeRequest, runtimeContext\.appendSystemPrompt, projectRuntimePrompt\)/)
})
