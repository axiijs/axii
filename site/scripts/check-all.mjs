// D-20 gate: run all per-round and triggered-when-relevant gates in sequence.
// This is the "every round must run" aggregator.
//
// Runs (in order):
//   1. check-preview.mjs       (D-02) — preview + #root non-empty
//   2. check-examples.mjs      (D-09) — code block + non-empty live root per example
//   3. check-exports.mjs       (D-12, D-14) — export consistency + unexported annotation
//   4. check-antipatterns.mjs  (D-15) — no anti-patterns in example source
//   5. check-structure.mjs     (D-08, D-11) — page structure
//   6. check-routes.mjs        (D-10) — history router
//   7. check-doc-coverage.mjs  (D-23) — C-27 concept coverage
//   8. check-examples-coverage.mjs (D-24) — C-31 example coverage
//   9. check-cleanup.mjs       (D-25) — example live-root unmount on navigation
//
// NOT included here (separate triggered gates):
//   - check-data0-fallback.mjs (D-21) — destructive (rm -rf node_modules), slow
//   - check-dev-flag.mjs       (D-22) — run separately (needs build)
//   - mutation-check.mjs       (D-13) — very slow (per-mutation rebuild)
//
// Each sub-script must exit 0 for check-all to pass. check-all does not skip
// any sub-check.
import { spawnSync } from 'node:child_process'

const checks = [
  { name: 'D-02 check-preview', script: 'check-preview.mjs' },
  { name: 'D-09 check-examples', script: 'check-examples.mjs' },
  { name: 'D-12/D-14 check-exports', script: 'check-exports.mjs' },
  { name: 'D-15 check-antipatterns', script: 'check-antipatterns.mjs' },
  { name: 'D-08/D-11 check-structure', script: 'check-structure.mjs' },
  { name: 'D-10 check-routes', script: 'check-routes.mjs' },
  { name: 'D-23 check-doc-coverage', script: 'check-doc-coverage.mjs' },
  { name: 'D-24 check-examples-coverage', script: 'check-examples-coverage.mjs' },
  { name: 'D-25 check-cleanup', script: 'check-cleanup.mjs' },
]

let allOk = true
for (const check of checks) {
  console.log(`\n=== ${check.name} ===`)
  const r = spawnSync('node', [`scripts/${check.script}`], { cwd: process.cwd(), stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`FAIL: ${check.name} exited with ${r.status}`)
    allOk = false
  }
}

if (!allOk) {
  console.error('\nFAIL: one or more checks failed')
  process.exit(1)
}
console.log('\nOK: all checks passed')
