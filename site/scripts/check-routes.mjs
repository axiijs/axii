// D-10 gate: verify the self-built history router works.
// Navigate to /, /docs, /examples via history.pushState and assert each path
// hits the correct content container. Uses headless navigation (not curl,
// which can't see client-rendered content).
import { spawn } from 'node:child_process'
import { withBrowser } from './_headless.mjs'

const PORT = 4173
const BASE = `http://localhost:${PORT}`

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
  const proc = startPreview()
  try {
    await waitForServer(proc)
    await withBrowser(async (page) => {
      const routes = [
        { path: '/', check: () => document.querySelector('.axii-hero') !== null, name: 'home (hero)' },
        { path: '/docs', check: () => document.querySelector('.axii-doc-content') !== null, name: 'docs (content)' },
        { path: '/examples', check: () => document.querySelectorAll('[data-example-root]').length > 0, name: 'examples (list)' },
      ]
      for (const route of routes) {
        await page.goto(BASE + route.path, { waitUntil: 'networkidle' })
        await page.waitForFunction(route.check, { timeout: 10000 })
        const ok = await page.evaluate(route.check)
        if (!ok) throw new Error(`route ${route.path} did not render ${route.name}`)
        console.log(`OK: ${route.path} → ${route.name}`)
      }
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
