// D-22 gate: verify production build has __DEV__ = false.
// Checks the production JS bundle for evidence that __DEV__ was set to false
// at build time (so dev-only code paths are dead-code eliminated):
//
//   1. The literal identifier `__DEV__` should NOT appear in the bundle —
//      esbuild replaces it with `false` during define substitution. If
//      `__DEV__` appears as a bare identifier, the define was not applied.
//
//   2. The dev diagnostic string `data-axii-style-itor-num` (from
//      src/StaticHost.ts:528, only set inside `if (__DEV__)`) should NOT be
//      in the production bundle — dead-code elimination removes the entire
//      `if (false) { ... }` block.
//
//   3. `if(__DEV__)debugger` (src/util.ts:65, data0/src/util.ts:203) should
//      be eliminated — we check that no `debugger` statement survives that
//      was guarded by `__DEV__`. We do NOT flag bare `debugger` statements in
//      third-party dependencies (those are upstream bugs, not __DEV__ leakage).
//      The specific check: no `debugger` preceded by `__DEV__` or a
//      now-constant `false` condition.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = join(process.cwd(), 'dist')

if (!existsSync(DIST)) {
  console.error('FAIL: site/dist does not exist — run `npm run build` first')
  process.exit(1)
}

const jsFiles = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
const failures = []

for (const f of jsFiles) {
  const content = readFileSync(join(DIST, 'assets', f), 'utf8')

  // 1. __DEV__ should be replaced, not present as a code reference.
  //    esbuild's define substitutes `__DEV__` with `false` everywhere it
  //    appears as an identifier. After substitution, `__DEV__` should only
  //    survive inside string literals (e.g. doc prose that mentions it).
  //    Check for code-context usage: `if(__DEV__)`, `__DEV__&&`, `__DEV__?`,
  //    `__DEV__===`, etc. A bare `__DEV__` inside a quoted string is fine.
  //    Strip string literals before checking.
  const withoutStrings = content
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  if (/\b__DEV__\b/.test(withoutStrings)) {
    failures.push(`${f}: bare '__DEV__' identifier in code (define not applied)`)
  }

  // 2. Dev diagnostic string from StaticHost.ts:528 — only set in if(__DEV__).
  if (content.includes('data-axii-style-itor-num')) {
    failures.push(`${f}: 'data-axii-style-itor-num' present (StaticHost.ts:528 dev diagnostic leaked)`)
  }

  // 3. No `debugger` that was guarded by __DEV__ should survive. After define
  //    substitution, `if (__DEV__) debugger` becomes `if (false) debugger`
  //    which esbuild eliminates entirely. A `debugger` preceded by `if(false)`
  //    or `if(!0)` would indicate incomplete elimination. We do NOT flag bare
  //    `debugger` from third-party deps (data0 has one at RxList.ts:1277 that
  //    is NOT __DEV__-guarded — that's an upstream data0 issue).
  if (/if\s*\(\s*false\s*\)\s*debugger/.test(content)) {
    failures.push(`${f}: 'if(false)debugger' present (incomplete dead-code elimination)`)
  }
}

if (failures.length > 0) {
  console.error('FAIL: production bundle contains __DEV__ leakage:')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`OK: production bundle has __DEV__=false (no bare __DEV__, no dev diagnostic strings, no if(false)debugger) — ${jsFiles.length} JS files checked`)
