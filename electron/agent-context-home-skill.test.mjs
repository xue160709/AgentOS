import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

test('external projects discover and expand the bundled data-card skill', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agentos-skill-test-'))
  try {
    const output = path.join(temporary, 'agent-context.mjs')
    await build({ entryPoints: ['electron/agent-context.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' })
    const { discoverAgentContext, resolvePromptWithContext } = await import(pathToFileURL(output).href)
    const catalog = await discoverAgentContext(temporary)
    assert.equal(catalog.ok, true)
    const skill = catalog.skills.find((item) => item.command === 'a2ui-project-home-panel')
    assert.ok(skill, 'the application skill is discoverable outside the application project')
    assert.equal(skill.path, path.resolve('.agents/skills/a2ui-project-home-panel/SKILL.md'))
    const prompt = await resolvePromptWithContext('统计文章数量', catalog, { forcedSkillCommand: 'a2ui-project-home-panel' })
    assert.match(prompt, /automatically invoked.*a2ui-project-home-panel/)
    assert.match(prompt, /Required Role Loop/)
    assert.ok(prompt.includes(skill.path), 'the agent receives a usable absolute source path')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
