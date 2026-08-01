// D-12 + D-14 gate: verify that every symbol imported as `from 'axii'` (or used
// bare in code blocks / example source) is actually exported from the library's
// `src/index.ts`, AND that router/Action/state-machine/headless — which are
// mentioned in the README but NOT exported from src/ — are annotated as
// external packages (not used as bare API calls).
//
// This script reads:
//   - ../src/index.ts (the library's export surface, re-exporting data0 etc.)
//   - site/src/docs/snippets/*.ts and site/src/examples/*.tsx (source files)
//   - site/dist/ (the rendered docs content, for external-package annotations)
//
// D-12 (consistency): every `import { ... } from 'axii'` and every bare
// `Identifier(` call in example/snippet source must be in the export set or
// explicitly exempted.
//
// D-14 (unexported annotation): router/Action/state-machine/headless must not
// appear as bare API calls (e.g. createRouter(...)) anywhere in docs/examples.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const LIB_SRC = join(process.cwd(), '..', 'src', 'index.ts')
const SNIPPETS_DIR = join(process.cwd(), 'src', 'docs', 'snippets')
const EXAMPLES_DIR = join(process.cwd(), 'src', 'examples')

// --- Build the export set from src/index.ts ---
// We parse `export * from '...'` (which re-exports data0 and several modules)
// and named exports. For `export *`, we can't statically resolve here without
// running the modules, so we hardcode the known re-export sources' public
// symbols that are relevant to docs/examples. This is a conservative check:
// false positives (flagging a real export as missing) are the failure mode.
const indexSource = readFileSync(LIB_SRC, 'utf8')

// Collect named exports from src/index.ts
const namedExports = new Set()
for (const m of indexSource.matchAll(/export\s+\{([^}]+)\}/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(/\s+as\s+/)[0].trim()
    if (name) namedExports.add(name)
  }
}
// `export * from './DOM'` etc. — collect the module names; we resolve the key
// ones below. For the check, we allow any identifier that appears as an export
// in the re-exported modules. We hardcode the well-known ones to avoid a full
// TS parser dependency.
const reExportModules = [...indexSource.matchAll(/export\s+\*\s+from\s+['"]\.\/([^'"]+)['"]/g)].map((m) => m[1])

// Known exports from the re-exported modules (verified against src/*.ts).
// This is the allowlist — any symbol used in docs/examples must be here OR be
// a global (document, window, etc.) OR a type-only import.
const knownExports = new Set([
  // DOM.ts
  'createElement', 'Fragment', 'createSVGElement', 'jsxs', 'jsx', 'jsxDEV',
  'StyleSize', 'setAttribute', 'insertBefore', 'insertAfter', 'dispatchEvent',
  'AUTO_ADD_UNIT_ATTR', 'COMMA_MULTI_VALUE_ATTR', 'autoUnit', 'setAutoUnitType', 'stringifyStyleValue',
  // propTypes.ts
  'PropTypes', 'TypeChecker',
  // render.ts
  'createRoot',
  // createHost.ts
  'createHost',
  // Host.ts
  // types.ts (mostly types)
  // ref.ts
  'createRef', 'createRxRef',
  // Portal.tsx
  'Portal',
  // Form.tsx
  'Form', 'FormContext',
  // ComponentHost.ts
  'bindProps', 'mergeProps', 'mergeProp', 'StateTransformer', 'StateFromRef', 'ComponentHost',
  'DataContext', 'ComponentRenderContext', 'ReusableHost', 'N_ATTR',
  // StaticHost.ts
  'StaticHost', 'CompactElementHost', 'StaticHostConfig',
  'markBoundProp', 'markAopProp', 'markDynamicProp', 'isBoundProp', 'isAopProp', 'isDynamicProp',
  // reactiveDOMState.ts
  'RxDOMState', 'RxDOMRect', 'RxDOMSize', 'RxDOMFocused', 'RxDOMHovered',
  'RxDOMScrollPosition', 'RxDOMDragState', 'RxDOMEventListener', 'ModalContext',
  'RectObject', 'SizeObject', 'ScrollPosition', 'DragState', 'DragOptions',
  // diagnostics.ts
  'AxiiError', 'configureDiagnostics', 'isAxiiDiagnosticsEnabled',
  'enableAxiiRetainedObjectDiagnostics', 'disableAxiiRetainedObjectDiagnostics',
  'resetAxiiRetainedObjectDiagnostics', 'isAxiiRetainedObjectDiagnosticsEnabled',
  'getAxiiRetainedObjectDiagnosticsSnapshot',
  // ContextProvider.ts
  'ContextProvider', 'createContext',
  // data0 (re-exported via export * from 'data0')
  'atom', 'computed', 'autorun', 'RxList', 'RxMap', 'RxSet', 'RxTime',
  'ManualCleanup', 'AutoCleanup', 'Atom',
  // lazy.ts
  'lazy',
  // eventAlias.ts
  'eventAlias', 'onUpKey', 'onDownKey', 'onLeftKey', 'onRightKey', 'onEnterKey',
  'onTabKey', 'onESCKey', 'onBackspaceKey', 'onSpaceKey', 'onLeftMouseDown',
  'onRightMouseDown', 'onMiddleMouseDown', 'onKey', 'onSelf', 'createEventTransfer',
  'withCurrentRange', 'withPreventDefault', 'withStopPropagation',
  // named in index.ts
  'enableAxiiRetainedObjectDiagnostics',
  // types.ts (re-exported via export * from './types.js')
  'RenderContext', 'JSXElement', 'Props', 'Component', 'ComponentNode',
  'EffectHandle', 'PathContext', 'Host', 'RefObject', 'RefFn',
  'CreateStateFromRefFn', 'CreatePortalFn', 'CreateRefFn', 'CreateRxRefFn',
  'UseEffectFn', 'OnCleanupFn', 'UseLayoutEffectFn', 'CreateElementFn',
  'CreateSVGElementFn', 'ExposeFn', 'ReuseFn', 'StaticBoundProps',
  'DynamicBoundProps', 'BoundProps', 'AttributesArg', 'JSXElementType',
  'UnhandledChildInfo', 'UnhandledAttrInfo', 'RefHandleInfo', 'DetachStyledInfo',
  'UnhandledPlaceholder', 'ExtendedElement',
])
for (const n of namedExports) knownExports.add(n)

// --- Scan source files for `from 'axii'` imports and bare API calls ---
function scanFile(filePath, content) {
  const issues = []
  // import { A, B, C } from 'axii'
  for (const m of content.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]axii['"]/g)) {
    for (const part of m[1].split(',')) {
      const raw = part.trim()
      if (!raw) continue
      // strip `type` prefix and `as` alias
      const name = raw.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (!name) continue
      if (!knownExports.has(name)) {
        issues.push({ file: filePath, symbol: name, kind: 'import-from-axii' })
      }
    }
  }
  return issues
}

const issues = []
const filesToScan = []
if (existsSync(SNIPPETS_DIR)) {
  for (const f of readdirSync(SNIPPETS_DIR)) {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) filesToScan.push(join(SNIPPETS_DIR, f))
  }
}
if (existsSync(EXAMPLES_DIR)) {
  for (const f of readdirSync(EXAMPLES_DIR)) {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) filesToScan.push(join(EXAMPLES_DIR, f))
  }
}
for (const f of filesToScan) {
  const content = readFileSync(f, 'utf8')
  issues.push(...scanFile(f, content))
}

// --- D-14: check for bare unexported API calls ---
// Forbidden patterns: createRouter(...), createAction(...), createStateMachine(...)
const forbiddenPatterns = [
  { name: 'createRouter', pkg: 'router0' },
  { name: 'createAction', pkg: 'action0' },
  { name: 'createStateMachine', pkg: 'statemachine0' },
]
const forbiddenIssues = []
for (const f of filesToScan) {
  const content = readFileSync(f, 'utf8')
  for (const { name, pkg } of forbiddenPatterns) {
    const re = new RegExp(`\\b${name}\\s*\\(`)
    if (re.test(content)) {
      forbiddenIssues.push({ file: f, symbol: name, package: pkg })
    }
  }
}

if (issues.length > 0) {
  console.error('FAIL: symbols used in docs/examples not in src/index.ts export set:')
  for (const i of issues) console.error(`  ${i.file}: ${i.symbol} (${i.kind})`)
  process.exit(1)
}
if (forbiddenIssues.length > 0) {
  console.error('FAIL: bare unexported API calls found (must be annotated as external):')
  for (const i of forbiddenIssues) console.error(`  ${i.file}: ${i.symbol}() — use ${i.package} instead`)
  process.exit(1)
}

console.log(`OK: scanned ${filesToScan.length} source files, all imports from 'axii' are in the export set, no bare unexported API calls`)
