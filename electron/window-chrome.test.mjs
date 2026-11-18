import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

function loadWindowChromeModule() {
  const modulePath = resolve(dirname(fileURLToPath(import.meta.url)), 'window-chrome.ts')
  const source = readFileSync(modulePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  Function('exports', 'module', 'require', outputText)(module.exports, module, require)
  return module.exports
}


/**
 * `src/style.css` 现在只有 @import；断言样式规则时要看它实际拉进来的那些文件。
 * 随组件懒加载的区域文件（app-search / settings-page）不在这条链上，也不该在这里断言。
 */
function readStylesheet() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
  const entry = readFileSync(resolve(root, 'style.css'), 'utf8')
  const imports = [...entry.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1])
  return imports.map((specifier) => readFileSync(resolve(root, specifier), 'utf8')).join('\n')
}

test('Windows main window uses hidden titlebar overlay chrome', () => {
  const { getMainWindowChromeOptions } = loadWindowChromeModule()

  assert.deepEqual(getMainWindowChromeOptions('win32', false), {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f9f9f9',
      symbolColor: '#1f1f1f',
      height: 40,
    },
    autoHideMenuBar: true,
  })
})

test('non-Windows platforms keep platform-specific chrome unchanged', () => {
  const { getMainWindowChromeOptions } = loadWindowChromeModule()

  assert.deepEqual(getMainWindowChromeOptions('darwin', false), {})
  assert.deepEqual(getMainWindowChromeOptions('linux', false), {})
})

test('workspace header is not a global drag region', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/AppShellWorkspace.tsx'), 'utf8')

  assert.doesNotMatch(source, /className="app-workspace-header draggable"/)
  assert.match(source, /className="app-workspace-drag-gap draggable"/)
})

test('sidebar chrome keeps stable drag regions without swallowing interactive controls', () => {
  const appShellSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/AppShell.tsx'), 'utf8')
  const sidebarSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/AppShellSidebar.tsx'), 'utf8')
  const styleSource = readStylesheet()

  assert.match(appShellSource, /isWindows\s*\?\s*' is-platform-win32'/)
  assert.match(styleSource, /\.app-shell\.is-platform-win32\.is-shell-settings\s+\.app-sidebar-scroll\s*\{[^}]*padding-top:\s*calc\(var\(--spacing\) \* 3\)/s)
  assert.match(sidebarSource, /className="app-chrome-toolbar draggable"/)
  assert.match(sidebarSource, /className=\{`app-sidebar draggable\$\{isSettingsSidebar/)
  assert.match(appShellSource, /className="app-sidebar local-app-only-sidebar draggable"/)
  assert.match(styleSource, /\.draggable \[draggable='true'\][^{]*\{\s*-webkit-app-region:\s*no-drag/s)
})
