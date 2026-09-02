import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const testDir = dirname(fileURLToPath(import.meta.url))

// nativeImage is Electron-only; the migration's decisions are exercised with a
// stub so the pure workspace-walking logic stays testable in plain Node.
function loadTsModule(modulePath, stubs = {}, cache = new Map()) {
  const resolvedPath = resolve(modulePath)
  const cached = cache.get(resolvedPath)
  if (cached) return cached.exports
  const source = readFileSync(resolvedPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: resolvedPath,
  })
  const module = { exports: {} }
  cache.set(resolvedPath, module)
  const localRequire = (specifier) => {
    if (stubs[specifier]) return stubs[specifier]
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(resolvedPath), `${specifier}.ts`)
      if (existsSync(candidate)) return loadTsModule(candidate, stubs, cache)
    }
    return require(specifier)
  }
  Function('exports', 'module', 'require', outputText)(module.exports, module, localRequire)
  return module.exports
}

function makeNativeImageStub() {
  return {
    nativeImage: {
      createFromDataURL(dataUrl) {
        const declaredEdge = Number(/edge=(\d+)/.exec(dataUrl)?.[1] ?? 0)
        return {
          isEmpty: () => declaredEdge === 0,
          getSize: () => ({ width: declaredEdge, height: declaredEdge }),
          resize: ({ width, height }) => ({
            isEmpty: () => false,
            // Stand-in for a re-encoded thumbnail: proportional to pixel count.
            toDataURL: () => `data:image/png;base64,edge=${width}` + 'y'.repeat(width * height),
            getSize: () => ({ width, height }),
          }),
        }
      },
    },
  }
}

function workspaceWithAttachment(dataUrl) {
  return {
    workspaceRevision: 1,
    activeProjectId: 'project-1',
    activeThreadId: 'thread-1',
    projects: [{ id: 'project-1', name: 'P', path: '/p', createdAt: 1, updatedAt: 1 }],
    threads: [
      {
        id: 'thread-1', projectId: 'project-1', title: 'T', createdAt: 1, updatedAt: 1,
        creationSource: { kind: 'user' },
        chatState: {
          model: 'Claude Agent',
          items: [
            { type: 'message', id: 'm1', role: 'user', content: 'see this', status: 'done', createdAt: 1,
              attachments: [{ id: 'a1', kind: 'image', name: 'shot.png', path: '/p/shot.png', mimeType: 'image/png', size: 10, dataUrl }] },
            { type: 'message', id: 'm2', role: 'assistant', content: 'ok', status: 'done', createdAt: 2 },
          ],
        },
      },
    ],
    sidebarPrefs: { collapsed: false, collapsedProjectIds: [], projectOrderIds: ['project-1'] },
  }
}

test('oversized attachment thumbnails are shrunk once and the rest of the workspace is untouched', () => {
  const { migrateAttachmentThumbnails } = loadTsModule(resolve(testDir, './chat-attachment-thumbnail.ts'), { electron: makeNativeImageStub() })
  const full = 'data:image/png;base64,edge=2000' + 'x'.repeat(1_600_000)
  const state = workspaceWithAttachment(full)

  const first = migrateAttachmentThumbnails(state)
  assert.equal(first.changed, true)
  assert.equal(first.shrunkCount, 1)
  const shrunk = first.state.threads[0].chatState.items[0].attachments[0].dataUrl
  assert.ok(shrunk.length < full.length / 50, 'a thumbnail must be far smaller than the source image')
  assert.equal(first.bytesSaved, full.length - shrunk.length)
  // Non-attachment content keeps identity so an unchanged thread is not rewritten.
  assert.equal(first.state.threads[0].chatState.items[1], state.threads[0].chatState.items[1])

  const second = migrateAttachmentThumbnails(first.state)
  assert.equal(second.changed, false, 'migration must be idempotent')
  assert.equal(second.state, first.state, 'an already-migrated workspace returns by identity')
})

test('already-small thumbnails and non-image attachments are left alone', () => {
  const { migrateAttachmentThumbnails } = loadTsModule(resolve(testDir, './chat-attachment-thumbnail.ts'), { electron: makeNativeImageStub() })
  const small = 'data:image/png;base64,edge=120' + 'x'.repeat(500)
  const result = migrateAttachmentThumbnails(workspaceWithAttachment(small))
  assert.equal(result.changed, false)

  const textState = workspaceWithAttachment('ignored')
  textState.threads[0].chatState.items[0].attachments[0] = {
    id: 'a2', kind: 'text', name: 'notes.md', path: '/p/notes.md', mimeType: 'text/markdown', size: 4,
    dataUrl: 'data:text/plain;base64,edge=2000' + 'x'.repeat(1_600_000),
  }
  assert.equal(migrateAttachmentThumbnails(textState).changed, false, 'only image attachments are thumbnails')
})

test('an undecodable image is left as-is rather than losing the preview', () => {
  const { migrateAttachmentThumbnails } = loadTsModule(resolve(testDir, './chat-attachment-thumbnail.ts'), { electron: makeNativeImageStub() })
  // edge=0 makes the stub report an empty image, standing in for a format
  // nativeImage cannot decode.
  const undecodable = 'data:image/svg+xml;base64,edge=0' + 'x'.repeat(1_600_000)
  const result = migrateAttachmentThumbnails(workspaceWithAttachment(undecodable))
  assert.equal(result.changed, false)
  assert.equal(result.state.threads[0].chatState.items[0].attachments[0].dataUrl, undecodable)
})
