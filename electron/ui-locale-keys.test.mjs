/**
 * 静态 `t('a.b')` 键必须在 zh/en 两份目录里都能解析。
 * Every static `t('a.b')` key must resolve in both locale catalogs; a key that
 * only exists in another namespace renders as the raw path in the UI.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(testDir, '../src')
const en = JSON.parse(readFileSync(resolve(srcDir, 'locales/en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(resolve(srcDir, 'locales/zh.json'), 'utf8'))

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath))
    else if (/\.tsx?$/.test(entry.name)) files.push(entryPath)
  }
  return files
}

function lookup(catalog, path) {
  let cursor = catalog
  for (const part of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

function usedKeys() {
  const keys = new Map()
  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      if (!keys.has(match[1])) keys.set(match[1], file)
    }
  }
  return keys
}

test('every statically referenced locale key exists in both catalogs', () => {
  const keys = usedKeys()
  assert.ok(keys.size > 500, `expected the scan to find the renderer keys, got ${keys.size}`)
  const missing = []
  for (const [key, file] of keys) {
    const inEn = typeof lookup(en, key) === 'string'
    const inZh = typeof lookup(zh, key) === 'string'
    if (!inEn || !inZh) missing.push(`${key} (${inEn ? '' : 'en '}${inZh ? '' : 'zh '}missing) <- ${file}`)
  }
  assert.deepEqual(missing, [])
})

test('runtime development copy lives in the namespace the renderer reads', () => {
  for (const key of ['modifyWithAi', 'endModification', 'developmentIdle', 'developmentConflict', 'switchToActiveRuntime', 'previewNavigation']) {
    assert.equal(typeof en.runtime[key], 'string', `en runtime.${key}`)
    assert.equal(typeof zh.runtime[key], 'string', `zh runtime.${key}`)
  }
})
