// D-24 gate: verify all C-31 example categories exist and pass D-09.
// Enumerates the 10 example categories from C-31 and asserts each has a
// corresponding example in the registry AND that the example's live root is
// non-empty when rendered.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withBrowser } from './_headless.mjs'

const PORT = 4173
const BASE = `http://localhost:${PORT}`
const REGISTRY = join(process.cwd(), 'src', 'examples', 'registry.ts')

// C-31 example categories. Each must have a matching example in the registry.
// The IDs match the registry entries in src/examples/registry.ts.
const required = [
  'atom-two-way',  // atom two-way binding
  'rxlist',        // RxList incremental list
  'rxmap',         // RxMap keyed entries
  'rxset',         // RxSet unique membership
  'computed',      // computed derived values
  'component-aop', // Component AOP bindProps
  'portal',        // Portal modal
  'form',          // Form reactive form
  'rxdom-rect',    // RxDOMRect bounding box
  'rxdom-size',    // RxDOMSize content box
  'rxdom-scroll',  // RxDOMScrollPosition scroll state
]

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
  throw new Error(`preview server did not come up within ${timeoutMs}ms`)
}

async function main() {
  // First: verify the registry declares all required categories.
  const registrySrc = readFileSync(REGISTRY, 'utf8')
  const declaredIds = [...registrySrc.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  const missingDeclared = required.filter((id) => !declaredIds.includes(id))
  if (missingDeclared.length > 0) {
    console.error(`FAIL: missing example entries in registry: ${missingDeclared.join(', ')}`)
    process.exit(1)
  }

  // Second: verify each example renders a non-empty live root.
  const proc = startPreview()
  try {
    await waitForServer(proc)
    await withBrowser(async (page) => {
      await page.goto(BASE + '/examples', { waitUntil: 'networkidle' })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-example-root]').length > 0,
        { timeout: 10000 },
      )
      await new Promise((r) => setTimeout(r, 2000))
      const results = await page.evaluate(() => {
        const roots = document.querySelectorAll('[data-example-root]')
        return Array.from(roots).map((r) => ({
          title: r.querySelector('.axii-example-tabs span')?.textContent?.trim() ?? '',
          liveChildren: r.querySelector('.axii-example-live')?.children?.length ?? -1,
        }))
      })
      const empty = results.filter((r) => r.liveChildren === 0)
      if (empty.length > 0) {
        throw new Error(`examples with empty live root: ${JSON.stringify(empty)}`)
      }
      console.log(`OK: all ${required.length} required example categories exist and have non-empty live roots (${results.length} total examples rendered)`)
    })
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!proc.killed) proc.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
