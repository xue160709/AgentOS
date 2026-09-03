import * as path from 'node:path'

export const PROJECT_AGENTOS_RUNTIME_DIRECTORY = '.agentos'

/** Main-owned lexical location for a project's embedded Runtime. */
export function projectRuntimeRoot(projectPath: string): string {
  return path.join(path.resolve(projectPath), PROJECT_AGENTOS_RUNTIME_DIRECTORY)
}

/** Reject a canonical .agentos directory that escapes through a symlink. */
export function isContainedInProject(projectRealRoot: string, canonicalRoot: string): boolean {
  const projectRoot = path.resolve(projectRealRoot)
  const runtimeRoot = path.resolve(canonicalRoot)
  return runtimeRoot === projectRoot || runtimeRoot.startsWith(`${projectRoot}${path.sep}`)
}
