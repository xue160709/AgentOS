import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export async function importTranspiledTsProject(root, entryPath, dependencyPaths = []) {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'agentos-omni-audit-'))
  linkNodeModules(root, outputRoot)
  const files = [entryPath, ...dependencyPaths]
  for (const relativePath of files) {
    const source = rewriteRelativeImports(readFileSync(resolve(root, relativePath), 'utf8'))
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    })
    const outputPath = resolve(outputRoot, relativePath.replace(/\.tsx?$/, '.mjs'))
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, outputText, 'utf8')
  }
  return import(pathToFileURL(resolve(outputRoot, entryPath.replace(/\.tsx?$/, '.mjs'))).href)
}

export function readJson(root, relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'))
}

export function createTranslator(catalog) {
  return (path, vars = {}) => {
    const template = path.split('.').reduce((node, key) => node?.[key], catalog)
    const value = typeof template === 'string' ? template : path
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key] ?? ''))
  }
}

function linkNodeModules(root, outputRoot) {
  const source = resolve(root, 'node_modules')
  const target = resolve(outputRoot, 'node_modules')
  if (!existsSync(source) || existsSync(target)) return
  symlinkSync(source, target, 'dir')
}

function rewriteRelativeImports(source) {
  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, specifier) => {
    if (/\.(?:mjs|js|json|css)$/.test(specifier)) return match
    return `from ${quote}${specifier}.mjs${quote}`
  })
}
