import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const NATIVE_TAGS = new Set(['button', 'input', 'select', 'textarea'])
const CUSTOM_NATIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'option', 'form'])
const IGNORED_TAGS = new Set(['dialog'])
const IGNORED_ROLES = new Set(['dialog', 'alertdialog', 'listbox', 'presentation'])
const INTERACTION_HANDLERS = new Set(['onClick', 'onPointerDown', 'onMouseDown', 'onKeyDown'])
const SEMANTIC_REF_PATTERN = /SemanticRef|semanticRef|SemanticNodeRef|chatInputSemanticRef|permissionModeButtonRef|modelButtonRef|semanticAnchorRef/

export function auditOmniControls(root) {
  const files = execFileSync('rg', ['--files', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.tsx'))
  const native = createBucket()
  const customInteractive = createBucket()

  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8')
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile)
        if (NATIVE_TAGS.has(tag)) {
          collectControl(native, sourceFile, node, tag, file)
        } else if (isCustomInteractive(node, tag)) {
          collectControl(customInteractive, sourceFile, node, tag, file)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return {
    tsxFileCount: files.length,
    nativeControls: finalizeBucket(native),
    customInteractiveControls: finalizeBucket(customInteractive),
  }
}

function createBucket() {
  return { total: 0, missing: [] }
}

function finalizeBucket(bucket) {
  return {
    total: bucket.total,
    covered: bucket.total - bucket.missing.length,
    missing: bucket.missing.length,
    gaps: bucket.missing,
  }
}

function collectControl(bucket, sourceFile, node, tag, file) {
  bucket.total += 1
  if (hasOmniSemantics(node, tag)) return
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  bucket.missing.push(`${file}:${pos.line + 1}:${pos.character + 1} <${tag}> attrs=${attributeNames(node).join(',')}`)
}

function attributeNames(node) {
  return node.attributes.properties.map((property) => property.name?.getText?.() ?? '')
}

function attributeText(node, name) {
  const attribute = node.attributes.properties.find((property) => property.name?.getText?.() === name)
  return attribute?.getText?.() ?? ''
}

function literalAttribute(node, name) {
  return attributeText(node, name).match(/^[^=]+=["']([^"']+)["']/)?.[1]
}

function hasOmniSemantics(node, tag) {
  const names = attributeNames(node)
  if (tag === 'SemanticButton' || names.includes('semantic')) return true
  if (names.some((name) => name.startsWith('data-mm-'))) return true
  return SEMANTIC_REF_PATTERN.test(attributeText(node, 'ref'))
}

function isBackdropOrDialogPanel(node) {
  const source = node.getText()
  return /stopPropagation\(\)|currentTarget === event\.target|role="presentation"/.test(source)
}

function isCustomInteractive(node, tag) {
  if (CUSTOM_NATIVE_TAGS.has(tag) || IGNORED_TAGS.has(tag) || isBackdropOrDialogPanel(node)) return false
  const role = literalAttribute(node, 'role')
  if (role && IGNORED_ROLES.has(role)) return false
  const names = attributeNames(node)
  return (
    names.some((name) => INTERACTION_HANDLERS.has(name)) ||
    ['a', 'summary'].includes(tag) ||
    role === 'button' ||
    role === 'menuitem' ||
    role === 'option' ||
    role === 'separator'
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(import.meta.dirname, '..')
  const audit = auditOmniControls(root)
  console.log(JSON.stringify(audit, null, 2))
}
