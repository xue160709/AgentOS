import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('TaskHome depends on a narrow run port rather than a concrete runner', () => {
  const source = readFileSync(resolve('electron/task-home-plugin-manager.ts'), 'utf8')
  assert.match(source, /export type TaskHomeRunPort/)
  assert.match(source, /getRunPort/)
  assert.doesNotMatch(source, /ClaudeAgentRunner/)
})
