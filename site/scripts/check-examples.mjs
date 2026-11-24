// D-09 gate: every example page has BOTH a code block container AND a non-empty
// live demo root. The live root's children.length > 0 assertion catches the
// "empty container false-pass" where <Example> renders the container div but
// the example's render() never mounted a subtree (D-13's "delete render call"
// mutation would leave the container empty).
import { spawn } from 'node:child_process'
import { withBrowser } from './_headless.mjs'

const PORT = 4173
const BASE = `http://localhost:${PORT}`

function startPreview() {
  return spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  })
}

async function waitForServer(proc, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`preview server did not come up within ${timeoutMs}ms`)
}

async function main() {
  const proc = startPreview()
  try {
    await waitForServer(proc)
    await withBrowser(async (page) => {
      await page.goto(BASE + '/examples', { waitUntil: 'networkidle' })
      // Give examples time to mount their live subtrees.
      await page.waitForFunction(
        () => {
          const roots = document.querySelectorAll('[data-example-root]')
          if (roots.length === 0) return false
          return Array.from(roots).every((r) => {
            const live = r.querySelector('.axii-example-live')
            return live && live.children.length > 0
          })
        },
        { timeout: 10000 },
      )
      const results = await page.evaluate(() => {
        const roots = document.querySelectorAll('[data-example-root]')
        return Array.from(roots).map((r, i) => {
          const live = r.querySelector('.axii-example-live')
          const code = r.querySelector('.axii-code pre')
          return {
            index: i,
            title: r.querySelector('.axii-example-tabs span')?.textContent?.trim() ?? '',
            liveChildren: live?.children?.length ?? -1,
            hasCode: !!code,
          }
        })
      })
      const failures = results.filter((r) => r.liveChildren === 0 || !r.hasCode)
      if (failures.length > 0) {
        throw new Error(
          `examples failing D-09 (code block + non-empty live root):\n${JSON.stringify(failures, null, 2)}`,
        )
      }
      console.log(`OK: ${results.length} examples all have code block + non-empty live root`)
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
