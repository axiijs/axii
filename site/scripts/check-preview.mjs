// D-02 gate: start `npm run preview`, headlessly load `/`, execute JS, assert
// that #root has real rendered children (i.e. axii actually mounted, not just
// a static empty <div id="root">). Also catches runtime page errors.
//
// This is the gate that catches "false-pass" preview checks: curl alone would
// see the empty <div id="root"></div> from index.html and pass, masking any
// runtime crash. axii is a pure client-side renderer — the static HTML root is
// always empty until JS executes.
import { spawn } from 'node:child_process'
import { withBrowser, waitForRoot } from './_headless.mjs'

const PORT = 4173
const BASE = `http://localhost:${PORT}`

function startPreview() {
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  })
  return proc
}

async function waitForServer(proc, timeoutMs = 30000) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) return
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`preview server did not come up at ${BASE} within ${timeoutMs}ms: ${lastErr?.message ?? 'unknown'}`)
}

export async function runPreviewCheck(path = '/', { expectConsoleErrors = [] } = {}) {
  const proc = startPreview()
  try {
    await waitForServer(proc)
    return await withBrowser(async (page, { consoleErrors, pageErrors }) => {
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await waitForRoot(page)
      const rootChildren = await page.evaluate(() => document.querySelector('#root').children.length)
      if (rootChildren === 0) {
        throw new Error(`#root has no children — axii did not mount (path=${path})`)
      }
      if (pageErrors.length > 0) {
        throw new Error(`page errors during render (path=${path}):\n${pageErrors.join('\n')}`)
      }
      // Filter out benign network console errors (external fonts failing offline).
      const seriousConsoleErrors = consoleErrors.filter(
        (m) =>
          !m.includes('fonts.googleapis.com') &&
          !m.includes('net::ERR') &&
          !expectConsoleErrors.some((pat) => m.includes(pat)),
      )
      if (seriousConsoleErrors.length > 0) {
        throw new Error(`console errors during render (path=${path}):\n${seriousConsoleErrors.join('\n')}`)
      }
      return { rootChildren, consoleErrors, pageErrors }
    })
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!proc.killed) proc.kill('SIGKILL')
  }
}

async function main() {
  const result = await runPreviewCheck('/')
  console.log(`OK: #root children=${result.rootChildren}, no page errors`)
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
