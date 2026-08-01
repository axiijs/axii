// D-23 gate: verify all C-27 concepts are covered in the docs.
// Enumerates the 12 concept categories from C-27 and asserts each appears at
// least once in the docs source (snippet files + docSections registry prose).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SNIPPETS_DIR = join(process.cwd(), 'src', 'docs', 'snippets')
const DOC_SECTIONS = join(process.cwd(), 'src', 'docs', 'docSections.ts')

// C-27 concept keywords. Each concept must appear in at least one source file.
const concepts = [
  { id: 'mental-model', keywords: ['mental-model', 'functions run once', 'run once'] },
  { id: 'atom', keywords: ['atom'] },
  { id: 'RxList', keywords: ['RxList'] },
  { id: 'RxMap', keywords: ['RxMap'] },
  { id: 'RxSet', keywords: ['RxSet'] },
  { id: 'RxTime', keywords: ['RxTime'] },
  { id: 'computed', keywords: ['computed'] },
  { id: 'component-aop', keywords: ['bindProps', 'mergeProps', 'mergeProp', 'reusable', 'Component AOP'] },
  { id: 'Portal', keywords: ['Portal'] },
  { id: 'Form', keywords: ['Form'] },
  { id: 'context', keywords: ['createContext', 'ContextProvider'] },
  { id: 'rxdom', keywords: ['RxDOMRect', 'RxDOMSize', 'RxDOMScrollPosition', 'RxDOMFocused', 'RxDOMHovered'] },
  { id: 'lazy', keywords: ['lazy'] },
  { id: 'diagnostics', keywords: ['enableAxiiRetainedObjectDiagnostics'] },
]

const sources = []
if (existsSync(SNIPPETS_DIR)) {
  for (const f of readdirSync(SNIPPETS_DIR)) {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) sources.push({ name: f, content: readFileSync(join(SNIPPETS_DIR, f), 'utf8') })
  }
}
if (existsSync(DOC_SECTIONS)) {
  sources.push({ name: 'docSections.ts', content: readFileSync(DOC_SECTIONS, 'utf8') })
}

const missing = []
for (const concept of concepts) {
  const found = concept.keywords.some((kw) =>
    sources.some((s) => s.content.includes(kw)),
  )
  if (!found) missing.push(concept.id)
}

if (missing.length > 0) {
  console.error(`FAIL: missing C-27 concept coverage: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`OK: all ${concepts.length} C-27 concepts covered in docs`)
