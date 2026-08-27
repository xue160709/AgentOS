import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('runtime preview layout IPC is narrow, main-window-only, and forwarded by preload', () => {
  const main = readFileSync(resolve(root, 'electron/main.ts'), 'utf8')
  const preload = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8')
  const seam = readFileSync(resolve(root, 'src/desktop-seam.ts'), 'utf8')
  for (const capability of ['getRuntimePreviewLayout', 'saveRuntimePreviewLayout', 'resetRuntimePreviewLayout']) {
    assert.match(seam, new RegExp(`${capability}: 'desktop:runtime-preview-layout:`))
    assert.match(preload, new RegExp(`DESKTOP_INVOKE_CHANNELS\\.${capability}\\b`))
    const start = main.indexOf(`ipcMain.handle(DESKTOP_INVOKE_CHANNELS.${capability}`)
    assert.notEqual(start, -1)
    const handler = main.slice(start, main.indexOf('ipcMain.handle(', start + 20))
    assert.match(handler, /isAuthorizedMainWindowInvoke\(event\)/)
  }
  assert.match(main, /event\.sender\.id === win\.webContents\.id/)
  assert.match(main, /event\.senderFrame === event\.sender\.mainFrame/)
})

test('runtime preview resize suspends the native view until the drag completes', () => {
  const resizer = readFileSync(resolve(root, 'src/components/ResizableRuntimePreview.tsx'), 'utf8')
  const preview = readFileSync(resolve(root, 'src/components/RuntimePreview.tsx'), 'utf8')
  const events = readFileSync(resolve(root, 'src/runtime-preview-events.ts'), 'utf8')
  assert.match(events, /agentos:runtime-preview-resize/)
  assert.match(resizer, /setNativePreviewResizeActive\(true\)/)
  assert.match(resizer, /setNativePreviewResizeActive\(false\)/)
  assert.match(resizer, /is-height-rail/)
  assert.match(preview, /setRuntimePreviewVisible\?\.\(previewId, false\)/)
  assert.match(preview, /if \(!resizeActive\).*setRuntimePreviewVisible/)
  assert.match(preview, /requestAnimationFrame\(\(\) => \{ resumeFrame = null; sync\(\) \}\)/)
})
