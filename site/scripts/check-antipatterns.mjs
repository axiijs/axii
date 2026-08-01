// D-15 gate: scan example source for anti-patterns (C-36, C-37).
//
// C-36 forbids: dynamic on* handler swapping, re-render/vdom-diff mindset,
// handler written as a reactive expression outside the handler.
//
// The mechanically-checkable subset (per Backlog R3-F03): scan for `on*`
// attributes whose value is NOT a function literal or function identifier
// (e.g. `onClick={someAtom}` where the atom is called as a reactive expression).
// The non-mechanically-checkable subset (vdom-diff mindset) is a doc-review
// item, noted in (c) of D-15.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLES_DIR = join(process.cwd(), 'src', 'examples')
const SNIPPETS_DIR = join(process.cwd(), 'src', 'docs', 'snippets')

const issues = []

function scanFile(filePath, content) {
  // Match onXxx={value} where value is not a function literal or identifier
  // followed by ( ... ). We look for on* attributes whose value starts with
  // something that's clearly not a function: an atom call like `someAtom()`,
  // a bare identifier that's known to be an atom (heuristic), etc.
  //
  // Pattern: on[A-Z]\w*\s*=\s*\{([^}]+)\}
  // Then check if the value looks like a reactive expression rather than a
  // handler. A handler is: () => ..., function() {...}, or an identifier that's
  // not immediately followed by ().
  for (const m of content.matchAll(/\bon([A-Z]\w*)\s*=\s*\{([^}]+)\}/g)) {
    const value = m[2].trim()
    // Allow: () => ..., async () => ..., function () {...}, function name() {...},
    // an identifier (handler reference), or withCurrentRange/withPreventDefault/withStopPropagation wrappers.
    const isArrowFn = /^\s*(?:async\s+)?\(?[^)]*\)?\s*=>/.test(value)
    const isFunctionKw = /^\s*function\b/.test(value)
    const isIdentifierRef = /^\s*[a-zA-Z_$][\w$]*\s*$/.test(value)
    const isWrapper = /^\s*(?:withCurrentRange|withPreventDefault|withStopPropagation|createEventTransfer)\b/.test(value)
    if (!isArrowFn && !isFunctionKw && !isIdentifierRef && !isWrapper) {
      // Check if it's a reactive expression (atom call)
      if (/\(\s*\)\s*$/.test(value) || /^\s*[a-zA-Z_$][\w$]*\s*\(\s*\)/.test(value)) {
        issues.push({
          file: filePath,
          attr: 'on' + m[1],
          value: value.slice(0, 80),
          kind: 'reactive-handler-expression',
        })
      }
    }
  }

  // Check for dynamic handler swapping: reassigning an on* property at runtime
  // (e.g. `el.onClick = ...` or `element.on* = ...`).
  if (/\.\s*on[A-Z]\w*\s*=/.test(content)) {
    issues.push({ file: filePath, kind: 'dynamic-handler-swap', value: content.match(/\.\s*on[A-Z]\w*\s*=[^\n;]+/)?.[0]?.slice(0, 80) ?? '' })
  }
}

const files = []
for (const dir of [EXAMPLES_DIR, SNIPPETS_DIR]) {
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) files.push(join(dir, f))
    }
  }
}
for (const f of files) scanFile(f, readFileSync(f, 'utf8'))

if (issues.length > 0) {
  console.error('FAIL: anti-patterns found in example/snippet source:')
  for (const i of issues) console.error(`  ${i.file}: ${i.kind} (${i.attr ?? ''} ${i.value})`)
  process.exit(1)
}
console.log(`OK: scanned ${files.length} files, no mechanically-checkable anti-patterns found`)
console.log('  (note: vdom-diff mindset patterns are a doc-review item, not mechanically checkable — see D-15 Backlog R3-F03)')
