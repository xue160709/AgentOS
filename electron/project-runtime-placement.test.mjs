import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  const { outputText } = ts.transpileModule(require('node:fs').readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (require('node:fs').existsSync(candidate)) return loadTsModule(candidate, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

const { ProjectRuntimePlacementTracker } = loadTsModule(resolve(testDir, './project-runtime-placement.ts'))

async function finishesAfterAdding(signal, add) {
  const root = mkdtempSync(`${tmpdir()}/project-runtime-placement-`)
  const tracker = new ProjectRuntimePlacementTracker()
  await tracker.beforeRun('project-1', root)
  add(root)
  await tracker.afterRun('project-1', root)
  assert.equal(tracker.hasWarning('project-1'), true, `${signal} added after the run should warn`)
}

test('placement feedback catches new root package.json, index.html, and src signals', async () => {
  await finishesAfterAdding('package.json', (root) => writeFileSync(resolve(root, 'package.json'), '{}'))
  await finishesAfterAdding('index.html', (root) => writeFileSync(resolve(root, 'index.html'), '<main />'))
  await finishesAfterAdding('src', (root) => mkdirSync(resolve(root, 'src')))
})

test('placement feedback ignores pre-existing root signals and clears once .agentos appears', async () => {
  const root = mkdtempSync(`${tmpdir()}/project-runtime-placement-`)
  writeFileSync(resolve(root, 'package.json'), '{}')
  const tracker = new ProjectRuntimePlacementTracker()
  await tracker.beforeRun('project-1', root)
  await tracker.afterRun('project-1', root)
  assert.equal(tracker.hasWarning('project-1'), false)

  await tracker.beforeRun('project-1', root)
  writeFileSync(resolve(root, 'index.html'), '<main />')
  await tracker.afterRun('project-1', root)
  assert.equal(tracker.hasWarning('project-1'), true)

  mkdirSync(resolve(root, '.agentos'))
  await tracker.beforeRun('project-1', root)
  await tracker.afterRun('project-1', root)
  assert.equal(tracker.hasWarning('project-1'), false)
})

test('Project Runtime development stays on the project surface and sends only projectId plus mountId', () => {
  const shell = readFileSync(resolve(testDir, '../src/components/AppShell.tsx'), 'utf8')
  const projectView = readFileSync(resolve(testDir, '../src/components/chat/ProjectHomeRuntimeView.tsx'), 'utf8')
  assert.match(shell, /runRuntimeDevelopmentAction\(\{ kind: 'project-runtime', projectId: activeProject\.id, mountId: projectRuntimeState\.mountId \}/)
  assert.doesNotMatch(shell, /onCreate:[\s\S]{0,300}(openWorkspaceTab|selectWorkspaceTab|activeWorkspaceTabId|activeProjectId)/)
  assert.match(projectView, /project-runtime-open-development/)
  assert.match(projectView, /project-runtime-end-development/)
  assert.match(projectView, /aria-label=\{developmentStatus\.actionLabel\}/)
})
