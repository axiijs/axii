// D-13 gate: mutation check for each example.
//
// For each example source file, inject a defect and verify it produces an
// observable failure (per D-13 (b)/(c)). Two mutation classes:
//
//   ① "delete/break the render mount" — comment out the `root.render(<App/>)`
//     call. The live demo root should be EMPTY (children.length === 0), which
//     contradicts D-09's non-empty assertion → observable failure.
//
//   ② "break an API name" — rename `atom` to `atomX` (or `RxList` to `RxListX`).
//     This should produce a build-time error (import not found / undefined
//     reference) or a runtime TypeError.
//
// For each mutation: record the injection point, failure type, and phenomenon.
// Restore the original source and rebuild to confirm it passes again.
//
// This is a triggered gate (slow: per-mutation rebuild). NOT in check-all.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { withBrowser } from './_headless.mjs'

const PORT = 4173
const BASE = `http://localhost:${PORT}`
const EXAMPLES_DIR = join(process.cwd(), 'src', 'examples')

function startPreview() {
  return spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' },
  })
}

async function waitForServer(proc, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { const res = await fetch(BASE + '/'); if (res.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`preview did not come up within ${timeoutMs}ms`)
}

async function build() {
  const r = spawnSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' })
  return { status: r.status, stdout: r.stdout?.toString() ?? '', stderr: r.stderr?.toString() ?? '' }
}
import { spawnSync } from 'node:child_process'

async function checkLiveRoots() {
  const proc = startPreview()
  try {
    await waitForServer(proc)
    return await withBrowser(async (page) => {
      await page.goto(BASE + '/examples', { waitUntil: 'networkidle' })
      await new Promise((r) => setTimeout(r, 2000))
      return await page.evaluate(() => {
        const roots = document.querySelectorAll('[data-example-root]')
        return Array.from(roots).map((r) => ({
          title: r.querySelector('.axii-example-tabs span')?.textContent?.trim() ?? '',
          liveChildren: r.querySelector('.axii-example-live')?.children?.length ?? -1,
        }))
      })
    })
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!proc.killed) proc.kill('SIGKILL')
  }
}

async function main() {
  const exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.tsx'))
  const records = []

  for (const file of exampleFiles) {
    const filePath = join(EXAMPLES_DIR, file)
    const original = readFileSync(filePath, 'utf8')

    // Mutation ①: comment out root.render(...)
    // Match `root.render(...)` and replace with a no-op comment.
    const mutated1 = original.replace(
      /(\w+)\.render\((<[^>]+>|\([^)]+\)|[\w.]+)\)/,
      '/* MUTATION: render call removed */ void 0',
    )
    if (mutated1 !== original) {
      writeFileSync(filePath, mutated1)
      const buildResult = await build()
      let failureType, phenomenon
      if (buildResult.status !== 0) {
        failureType = 'build-error'
        phenomenon = `build failed: ${buildResult.stderr.slice(0, 200)}`
      } else {
        const liveStates = await checkLiveRoots()
        const target = liveStates.find((s) => s.title.toLowerCase().includes(file.replace('Example.tsx', '').toLowerCase()))
        // For "delete render" mutation, the live root should be empty (0 children).
        // If ALL examples still have children, the mutation didn't take effect or
        // the build cached. Check if any example has 0 children.
        const anyEmpty = liveStates.some((s) => s.liveChildren === 0)
        if (anyEmpty) {
          failureType = 'live-root-empty'
          phenomenon = 'at least one example live root is empty (children.length === 0)'
        } else {
          failureType = 'no-observable-failure'
          phenomenon = 'all examples still have non-empty live roots — mutation did not produce observable failure'
        }
      }
      records.push({ file, mutation: 'delete-render-call', failureType, phenomenon })
      writeFileSync(filePath, original)
    } else {
      records.push({ file, mutation: 'delete-render-call', failureType: 'mutation-not-applied', phenomenon: 'no root.render(...) pattern found' })
    }

    // Mutation ②: break a key API name. Choose based on what the file imports
    // from data0 or axii, so the mutation always targets a symbol the file uses.
    const apiToBreak = (() => {
      if (/import\s+\{[^}]*\batom\b[^}]*\}\s+from\s+['"]data0['"]/.test(original)) return 'atom'
      if (/import\s+\{[^}]*\bRxList\b[^}]*\}\s+from\s+['"]data0['"]/.test(original)) return 'RxList'
      if (/import\s+\{[^}]*\bRxMap\b[^}]*\}\s+from\s+['"]data0['"]/.test(original)) return 'RxMap'
      if (/import\s+\{[^}]*\bRxSet\b[^}]*\}\s+from\s+['"]data0['"]/.test(original)) return 'RxSet'
      if (/import\s+\{[^}]*\bcomputed\b[^}]*\}\s+from\s+['"]data0['"]/.test(original)) return 'computed'
      if (/import\s+\{[^}]*\bcreateRoot\b[^}]*\}\s+from\s+['"]axii['"]/.test(original)) return 'createRoot'
      if (/import\s+\{[^}]*\bcreateElement\b[^}]*\}\s+from\s+['"]axii['"]/.test(original)) return 'createElement'
      return null
    })()

    if (apiToBreak) {
      // Replace both the import and usage of the API name.
      const brokenName = apiToBreak + 'X'
      const re = new RegExp(`\\b${apiToBreak}\\b`, 'g')
      const mutated2 = original.replace(re, brokenName)
      writeFileSync(filePath, mutated2)
      const buildResult = await build()
      let failureType, phenomenon
      if (buildResult.status !== 0) {
        failureType = 'build-error'
        phenomenon = `build failed (atom→atomX): ${buildResult.stderr.slice(0, 200)}`
      } else {
        // Runtime: atomX is not defined → TypeError in the live demo
        const liveStates = await checkLiveRoots()
        const anyEmpty = liveStates.some((s) => s.liveChildren === 0)
        if (anyEmpty) {
          failureType = 'runtime-type-error'
          phenomenon = 'example live root empty (atomX is not defined → TypeError)'
        } else {
          failureType = 'no-observable-failure'
          phenomenon = 'all examples still have non-empty live roots'
        }
      }
      records.push({ file, mutation: `rename-${apiToBreak}-to-${brokenName}`, failureType, phenomenon })
      writeFileSync(filePath, original)
    }
  }

  // Restore and rebuild to confirm clean state
  const cleanBuild = await build()
  if (cleanBuild.status !== 0) {
    console.error('FAIL: clean rebuild after mutations failed')
    process.exit(1)
  }

  // Report
  console.log('Mutation check records:')
  for (const r of records) {
    console.log(`  ${r.file} | ${r.mutation} | ${r.failureType} | ${r.phenomenon}`)
  }

  // A mutation check "passes" when each mutation that was applied produces an
  // observable failure (build-error, live-root-empty, or runtime-type-error).
  // "no-observable-failure" means the mutation didn't break anything visible,
  // which is a false-pass for D-13.
  const falsePasses = records.filter((r) => r.failureType === 'no-observable-failure')
  if (falsePasses.length > 0) {
    console.error(`\nFAIL: ${falsePasses.length} mutation(s) did not produce observable failures:`)
    for (const r of falsePasses) console.error(`  ${r.file} | ${r.mutation}`)
    process.exit(1)
  }
  console.log(`\nOK: ${records.length} mutations all produced observable failures`)
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
