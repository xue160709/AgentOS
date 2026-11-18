import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stylesDir = resolve(root, 'src/styles')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const entry = read('src/style.css')
const eagerImports = [...entry.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1])
const eagerAreaFiles = eagerImports
  .filter((specifier) => specifier.startsWith('./styles/'))
  .map((specifier) => specifier.slice('./styles/'.length))
const areaFiles = readdirSync(stylesDir).filter((name) => name.endsWith('.css'))
const lazyAreaFiles = areaFiles.filter((name) => !eagerAreaFiles.includes(name))

/** 顶层块切分：只跟踪花括号深度与注释/字符串状态，够用来数规则和取选择器。 */
function topLevelBlocks(source) {
  const blocks = []
  let depth = 0
  let start = 0
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') index += 1
        index += 1
      }
      index += 1
      continue
    }
    if (char === '{') { depth += 1; index += 1; continue }
    if (char === '}') {
      depth -= 1
      if (depth === 0) { blocks.push(source.slice(start, index + 1)); start = index + 1 }
      index += 1
      continue
    }
    if (depth === 0 && char === ';') {
      if (source.slice(start, index + 1).trim()) blocks.push(source.slice(start, index + 1))
      start = index + 1
      index += 1
      continue
    }
    index += 1
  }
  return blocks
}

/** 每条规则「被赋样式的那个元素」上的类；`is-*` / `has-*` 是跨区域共用状态，不算归属。 */
function styledClasses(css) {
  const classes = new Set()
  const walk = (source) => {
    for (const block of topLevelBlocks(source)) {
      const head = block.replace(/\/\*[\s\S]*?\*\//g, '').split('{')[0].trim()
      if (!head) continue
      if (head.startsWith('@')) {
        if (/^@(media|supports|container|layer)/.test(head)) {
          walk(block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')))
        }
        continue
      }
      for (const branch of head.split(',')) {
        const target = branch.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() ?? ''
        for (const match of target.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
          if (!/^(is|has)-/.test(match[1])) classes.add(match[1])
        }
      }
    }
  }
  walk(css)
  return classes
}

function sourceFiles(dir, out = []) {
  for (const entryName of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const next = `${dir}/${entryName.name}`
    if (entryName.isDirectory()) { sourceFiles(next, out); continue }
    if (/\.(tsx|ts)$/.test(entryName.name)) out.push(next)
  }
  return out
}

test('the style entry only orders imports, and every imported area file exists', () => {
  const withoutComments = entry.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const statements = withoutComments.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const statement of statements) {
    assert.match(statement, /^@import '[^']+';$/, `style.css 只应保留 @import，发现：${statement}`)
  }
  for (const specifier of eagerImports) {
    assert.ok(existsSync(resolve(root, 'src', specifier)), `missing ${specifier}`)
  }
  assert.ok(eagerAreaFiles.length > 0)
})

test('every area stylesheet is either imported by the entry or by exactly one component', () => {
  const modules = sourceFiles('src')
  for (const name of areaFiles) {
    const importers = modules.filter((file) => read(file).includes(`styles/${name}`))
    if (eagerAreaFiles.includes(name)) {
      assert.equal(importers.length, 0, `${name} 已由 style.css 引入，不应再被组件重复 import`)
      continue
    }
    assert.equal(importers.length, 1, `${name} 必须恰好被一个组件模块 import，实际 ${importers.length} 个`)
  }
})

test('a route-lazy stylesheet never styles a class that the first-paint sheet also styles', () => {
  // 懒加载块在 index.css 之后到达。只要两边给同一个类上样式，级联结果就取决于加载时机，
  // 而加载时机取决于用户什么时候打开那个路由——这类回归在开发机上几乎不会被看见。
  const eager = new Set()
  for (const name of eagerAreaFiles) for (const cls of styledClasses(read(`src/styles/${name}`))) eager.add(cls)
  for (const cls of styledClasses(read('src/theme/tokens.css'))) eager.add(cls)

  assert.ok(lazyAreaFiles.length > 0, '至少应有一个随路由懒加载的区域文件')
  for (const name of lazyAreaFiles) {
    const overlap = [...styledClasses(read(`src/styles/${name}`))].filter((cls) => eager.has(cls))
    assert.deepEqual(overlap, [], `${name} 与首屏样式表争抢这些类：${overlap.join(', ')}`)
  }
})

test('route-lazy stylesheets stay behind their own lazy import boundary', () => {
  const workspace = read('src/components/AppShellWorkspace.tsx')
  assert.match(workspace, /const AppSearchModal = lazy\(/)
  assert.match(workspace, /const SettingsPage = lazy\(/)
  assert.match(read('src/components/AppSearchModal.tsx'), /import '\.\.\/styles\/app-search\.css'/)
  assert.match(read('src/components/setting/SettingsPage.tsx'), /import '\.\.\/\.\.\/styles\/settings-page\.css'/)

  // settings 目录只能经由那个 lazy import 进入，否则 settings-page.css 会和 eager 代码分家。
  const outsideImporters = sourceFiles('src')
    .filter((file) => !file.startsWith('src/components/setting/'))
    .filter((file) => /['"][^'"]*\bsetting\//.test(read(file)))
  assert.deepEqual(outsideImporters, ['src/components/AppShellWorkspace.tsx'])
})
