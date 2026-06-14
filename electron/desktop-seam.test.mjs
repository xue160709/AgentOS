import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('Desktop seam exposes only named adapters to the renderer', () => {
  const preload = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8')
  const windowTypes = readFileSync(resolve(root, 'electron/electron-env.d.ts'), 'utf8')

  assert.doesNotMatch(preload, /exposeInMainWorld\(['"]ipcRenderer['"]/)
  assert.doesNotMatch(windowTypes, /\bipcRenderer\s*:/)
  assert.match(preload, /satisfies DesktopAPI/)
  assert.match(windowTypes, /desktop\?: DesktopAPI/)
})

test('Desktop interface does not leak generic IPC primitives', () => {
  const desktopInterface = readFileSync(resolve(root, 'src/desktop-api.ts'), 'utf8')

  assert.doesNotMatch(desktopInterface, /^\s*(invoke|send|on|off)\??\s*:/m)
  assert.match(desktopInterface, /export type DesktopAPI/)
})
