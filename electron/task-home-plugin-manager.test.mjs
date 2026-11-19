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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['electron/task-home-plugin-manager.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { TaskHomePluginManager } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

for (const scenario of ['legacy', 'independent', 'shared', 'stop']) {
  test('Skills task session routing: ' + scenario, async (t) => {
    const root = await mkdtemp(resolve(tmpdir(), 'skill-session-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const requests = [], threads = [], cancellations = []
    const port = {
      async ensureThread(thread) { threads.push(thread.threadId) },
      async submit(request) { requests.push(request); return { requestId: 'req-' + requests.length } },
      async cancel(request) { cancellations.push(request) },
    }
    let latest
    const deps = {
      getWorkspace: () => ({ projects: [{ id: 'project', path: root }] }),
      getRunPort: () => port,
      emitTaskEvent(event) { latest = { ...event.runtime } },
    }
    const step = { id: 'one', title: '整理', command: 'outline', path: 'outline/SKILL.md' }
    const saved = await new TaskHomePluginManager(deps).saveTask(root, {
      title: '测试', mode: 'skills', sessionMode: scenario === 'shared' ? 'shared' : 'independent',
      skillSteps: [step, { ...step, id: 'two' }], runCount: 2, schedule: {}, enabled: false,
    })
    assert.equal(saved.ok, true)
    if (scenario === 'legacy') {
      const data = JSON.parse(await readFile(saved.taskPath, 'utf8'))
      delete data.sessionMode
      await writeFile(saved.taskPath, JSON.stringify(data))
    }
    const manager = new TaskHomePluginManager(deps)
    const loaded = await manager.readTask(root, saved.slug)
    assert.equal(loaded.task.sessionMode, scenario === 'shared' ? 'shared' : 'independent')
    const started = await manager.startTask(root, saved.slug)
    assert.equal(started.ok, true)
    async function waitFor(check) {
      for (let i = 0; i < 200 && !check(); i++) await delay(5)
      assert.ok(check(), 'expected task event')
    }
    const count = scenario === 'stop' ? 2 : 4
    for (let n = 1; n <= count; n++) {
      const requestId = 'req-' + n
      await waitFor(() => latest.requestId === requestId)
      assert.equal(requests.length, n)
      const request = requests[n - 1]
      assert.equal(request.threadId, latest.threadId)
      assert.doesNotMatch(request.text, /PREVIOUS_OUTPUT/)
      assert.match(request.text, new RegExp('第 ' + Math.ceil(n / 2) + '/2 次运行，第 ' + ((n - 1) % 2 + 1) + '/2'))
      if (scenario === 'stop' && n === 2) {
        const stale = await manager.stopTask(root, saved.slug, requests[0].threadId)
        assert.equal(stale.stopped, false)
        assert.deepEqual(cancellations, [])
        await manager.stopTask(root, saved.slug)
        assert.deepEqual(cancellations, [{ projectId: 'project', threadId: request.threadId, requestId }])
      } else {
        manager.handleClaudeEvent({ type: 'result', threadId: request.threadId, requestId, result: 'PREVIOUS_OUTPUT' })
      }
    }
    await waitFor(() => latest.status === (scenario === 'stop' ? 'cancelled' : 'done'))
    await delay(15)
    assert.equal(requests.length, count)
    const uniqueThreads = [...new Set(requests.map((item) => item.threadId))]
    assert.equal(uniqueThreads.length, scenario === 'shared' ? 1 : count)
    assert.deepEqual(threads, uniqueThreads)
  })
}
