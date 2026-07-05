import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importTranspiledTsProject } from './omni-audit-utils.mjs'

const BDD_PATH = 'prd/multimodal-voice-control/voice-command-bdd.md'

export async function auditVoiceCommandBdd(root = resolve(import.meta.dirname, '..')) {
  const { classifyVoiceAutoRoute } = await importTranspiledTsProject(root, 'src/multimodal/voice-routing.ts')
  const rows = parseCommandRows(readFileSync(resolve(root, BDD_PATH), 'utf8'))
  const results = rows.map((row) => {
    const expectedRoute = expectedRouteForStatus(row.status)
    const actualRoute = classifyVoiceAutoRoute(row.utterance)
    const errors = []
    if (!expectedRoute) errors.push(`unknown status "${row.status}"`)
    if (expectedRoute && actualRoute !== expectedRoute) {
      errors.push(`route: expected ${expectedRoute}, received ${actualRoute}`)
    }
    return { ...row, expectedRoute, actualRoute, ok: errors.length === 0, errors }
  })

  const ids = rows.map((row) => row.id)
  const expectedIds = Array.from({ length: 50 }, (_value, index) => index + 1)
  const idErrors = []
  if (rows.length !== expectedIds.length) idErrors.push(`caseCount: expected 50, received ${rows.length}`)
  for (const expectedId of expectedIds) {
    if (!ids.includes(expectedId)) idErrors.push(`missing command #${expectedId}`)
  }

  const failures = results.filter((result) => !result.ok)
  return {
    bddPath: BDD_PATH,
    caseCount: rows.length,
    passed: rows.length - failures.length,
    failed: failures.length + idErrors.length,
    idErrors,
    failures,
    routeSummary: summarizeRoutes(results),
    results,
  }
}

function parseCommandRows(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
      return {
        id: Number(cells[0]),
        utterance: cells[1],
        capability: cells[2],
        status: cells[3],
        expectedResult: cells[4],
      }
    })
}

function expectedRouteForStatus(status) {
  if (status === '已接入') return 'command'
  if (status === '已接入：SDK 路由') return 'agent_task'
  if (status === '已接入：当前 Chat 返回内容') return 'answer'
  return null
}

function summarizeRoutes(results) {
  return results.reduce(
    (summary, result) => {
      const key = result.expectedRoute ?? 'unknown'
      summary[key] = (summary[key] ?? 0) + 1
      return summary
    },
    {},
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditVoiceCommandBdd()
  console.log(JSON.stringify(result, null, 2))
  if (result.failed > 0) {
    process.exitCode = 1
  }
}
