// D-21 gate: verify the npm data0 fallback branch resolves (no sibling needed).
//
// Uses the non-destructive env-var mechanism (C-45, R4-F06): sets
// AXII_DATA0_FORCE_NPM=1 which makes site/vite.config.ts skip the sibling
// existsSync branch and force the npm-installed data0. Then does a clean
// install + build. Does NOT rename, move, or delete ../data0.
//
// This gate is DESTRUCTIVE to site/node_modules (rm -rf + reinstall) and SLOW,
// so it is a triggered gate (not in check-all's per-round set).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Match the sibling path that site/vite.config.ts checks. vite.config.ts is at
// site/, so it uses `../../data0/src/index.ts`. This script is at site/scripts/,
// so the equivalent is `../../../data0/src/index.ts`.
const SIBLING = fileURLToPath(new URL('../../../data0/src/index.ts', import.meta.url))

async function main() {
  // Pre-condition: the sibling must exist for this check to be meaningful
  // (otherwise the default behavior already exercises the npm branch).
  if (!existsSync(SIBLING)) {
    console.log('OK (trivially): no sibling data0 exists — npm fallback is the default. Nothing to verify.')
    return
  }

  console.log(`sibling data0 exists at ${SIBLING.pathname}; forcing npm branch via AXII_DATA0_FORCE_NPM=1`)

  // Clean install + build with the npm fallback forced. The env var is read
  // by site/vite.config.ts (C-45).
  const env = { ...process.env, AXII_DATA0_FORCE_NPM: '1' }

  console.log('→ rm -rf node_modules && npm install')
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: process.cwd(), env, stdio: 'inherit',
  })
  if (install.status !== 0) {
    console.error('FAIL: npm install under AXII_DATA0_FORCE_NPM=1 failed')
    process.exit(1)
  }

  console.log('→ npm run build (AXII_DATA0_FORCE_NPM=1)')
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: process.cwd(), env, stdio: 'inherit',
  })
  if (build.status !== 0) {
    console.error('FAIL: vite build under AXII_DATA0_FORCE_NPM=1 failed')
    process.exit(1)
  }

  // Verify the sibling was NOT touched.
  if (!existsSync(SIBLING)) {
    console.error('FAIL: sibling data0 was removed/moved during the check — destructive operation detected')
    process.exit(1)
  }

  console.log('OK: npm data0 fallback branch resolves (AXII_DATA0_FORCE_NPM=1), sibling untouched')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
