import { stat } from 'node:fs/promises'
import path from 'node:path'
import { projectRuntimeRoot } from './local-app-runtime/index'

type PlacementBaseline = {
  projectRoot: string
  signals: Set<string>
  activeRuns: number
}

export class ProjectRuntimePlacementTracker {
  private readonly baselines = new Map<string, PlacementBaseline>()
  private readonly warnings = new Set<string>()

  async beforeRun(projectId: string, projectRoot: string): Promise<void> {
    const existing = this.baselines.get(projectId)
    if (existing) {
      existing.activeRuns += 1
      return
    }
    this.baselines.set(projectId, {
      projectRoot: path.resolve(projectRoot),
      signals: await readRootWebSignals(projectRoot),
      activeRuns: 1,
    })
  }

  async afterRun(projectId: string, projectRoot: string): Promise<void> {
    const baseline = this.baselines.get(projectId)
    if (!baseline) return
    baseline.activeRuns -= 1
    if (baseline.activeRuns > 0) return
    this.baselines.delete(projectId)
    if (await directoryExists(projectRuntimeRoot(projectRoot))) {
      this.warnings.delete(projectId)
      return
    }
    const current = await readRootWebSignals(projectRoot)
    if ([...current].some((signal) => !baseline.signals.has(signal))) this.warnings.add(projectId)
  }

  hasWarning(projectId: string): boolean {
    return this.warnings.has(projectId)
  }

  clear(projectId: string): void {
    this.warnings.delete(projectId)
    this.baselines.delete(projectId)
  }
}

async function readRootWebSignals(projectRoot: string): Promise<Set<string>> {
  const signals = new Set<string>()
  for (const name of ['package.json', 'index.html', 'src'] as const) {
    try {
      const info = await stat(path.join(projectRoot, name))
      if ((name === 'src' && info.isDirectory()) || (name !== 'src' && info.isFile())) signals.add(name)
    } catch {
      // Absence is the baseline fact we need.
    }
  }
  return signals
}

async function directoryExists(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory()
  } catch {
    return false
  }
}
