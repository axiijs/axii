// D-25 gate: example live-root unmount timing.
//
// C-18/C-19/C-20 require each <Example> to render a live axii subtree; the
// audit (W-06 reopening, round 4) found that <Example>'s ref callback only
// handled the mount branch (el && !mounted()) and ignored ref(null), so
// navigating away from /examples left:
//   - every example's inner createRoot alive (reactive graph + DOM leak)
//   - PortalExample's [data-example-portal] div orphaned on document.body
//     (its useEffect cleanup only runs when the inner root is destroyed)
//
// This gate verifies the fix: <Example> must destroy the inner createRoot on
// unmount. Two scenarios:
//
//   ① Portal modal orphan: open the Portal modal (appends [data-example-portal]
//     to body), close it, then client-side navigate to /. Assert no
//     [data-example-portal] remains on body and body.children.length === 1
//     (only #root).
//
//   ② Full examples unmount: navigate to /examples, wait for all live roots
//     to mount, then client-side navigate to /. Assert no [data-example-root]
//     remains anywhere in the document and #root has exactly the home page
//     content (no leftover example DOM).
//
// Both scenarios use the site's own navigate() (history.pushState + atom
// update) via the topnav logo — NOT page.goto(), which would do a full reload
// and mask the leak.
//
// Triggered gate (slow: headless navigation). NOT in check-all.
import { spawn } from 'node:child_process'
import { withBrowser, waitForRoot } from './_headless.mjs'

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

async function waitForExamplesMounted(page, timeout = 10000) {
  await page.waitForFunction(
    () => {
      const roots = document.querySelectorAll('[data-example-root]')
      if (roots.length === 0) return false
      return Array.from(roots).every((r) => {
        const live = r.querySelector('.axii-example-live')
        return live && live.children.length > 0
      })
    },
    { timeout },
  )
}

async function clickTopNavLogo(page) {
  // Click via evaluate to avoid pointer-event interception from any open
  // modal overlay. The topnav logo's onClick calls navigate('/'), which is
  // a client-side history.pushState — the exact scenario this gate tests.
  await page.evaluate(() => {
    const logo = document.querySelector('.axii-topnav-logo')
    if (logo instanceof HTMLElement) logo.click()
  })
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 5000 })
}

async function main() {
  const proc = startPreview()
  try {
    await waitForServer(proc)
    await withBrowser(async (page, { consoleErrors, pageErrors }) => {
      // ---------- Scenario ①: Portal modal orphan ----------
      await page.goto(BASE + '/examples', { waitUntil: 'networkidle' })
      await waitForExamplesMounted(page)

      // Open the Portal modal — appends [data-example-portal] to body.
      const portalExample = page.locator('[data-example-root]', { hasText: 'Portal — modal' })
      await portalExample.locator('button:has-text("Open modal")').click()
      await page.waitForFunction(
        () => document.querySelectorAll('[data-example-portal]').length === 1,
        { timeout: 5000 },
      )

      // Close the modal via its backdrop. This sets open(false); axii destroys
      // the Portal's inner subtree, but the portalRoot div (with
      // [data-example-portal]) stays on document.body until the example's own
      // useEffect cleanup runs — which only fires when the example's createRoot
      // is destroyed.
      await page.evaluate(() => {
        const backdrop = document.querySelector('[data-example-portal] > div')
        if (backdrop instanceof HTMLElement) backdrop.click()
      })
      await page.waitForTimeout(200)
      const portalAfterClose = await page.evaluate(
        () => document.querySelectorAll('[data-example-portal]').length,
      )
      if (portalAfterClose !== 1) {
        throw new Error(
          `scenario ①: expected [data-example-portal]=1 after modal close (div stays on body until root.destroy()), got ${portalAfterClose}`,
        )
      }

      // Client-side navigate to / via the site's own router.
      await clickTopNavLogo(page)
      await page.waitForTimeout(300)

      const leftoverPortal = await page.evaluate(
        () => document.body.querySelectorAll('[data-example-portal]').length,
      )
      const leftoverExampleRootEverywhere = await page.evaluate(
        () => document.querySelectorAll('[data-example-root]').length,
      )
      const bodyChildrenCount = await page.evaluate(() => document.body.children.length)

      if (leftoverPortal !== 0) {
        throw new Error(
          `scenario ①: orphan [data-example-portal] survived navigation (got ${leftoverPortal}, expected 0) — <Example> did not destroy the inner createRoot, so PortalExample's useEffect cleanup never ran to remove the portal root div from document.body`,
        )
      }
      if (leftoverExampleRootEverywhere !== 0) {
        throw new Error(
          `scenario ①: orphan [data-example-root] survived navigation (got ${leftoverExampleRootEverywhere}, expected 0)`,
        )
      }
      if (bodyChildrenCount !== 1) {
        throw new Error(
          `scenario ①: body.children.length=${bodyChildrenCount}, expected 1 (only #root) — orphan DOM appended to body survived navigation`,
        )
      }
      console.log(`scenario ① OK: portal modal + body cleanup after navigation (body.children=${bodyChildrenCount})`)

      // ---------- Scenario ②: full examples unmount ----------
      // Navigate back to /examples, mount all live roots, then leave.
      await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll('.axii-topnav-link')).find(
          (a) => a.textContent?.includes('Examples'),
        )
        if (link instanceof HTMLElement) link.click()
      })
      await page.waitForFunction(() => window.location.pathname === '/examples', { timeout: 5000 })
      await waitForExamplesMounted(page)
      const examplesCountBefore = await page.evaluate(
        () => document.querySelectorAll('[data-example-root]').length,
      )
      if (examplesCountBefore === 0) {
        throw new Error('scenario ②: no [data-example-root] mounted on /examples before navigation')
      }

      // Client-side navigate to /.
      await clickTopNavLogo(page)
      await page.waitForTimeout(300)

      const leftoverRootsAfter = await page.evaluate(
        () => document.querySelectorAll('[data-example-root]').length,
      )
      const leftoverLiveAfter = await page.evaluate(
        () => document.querySelectorAll('.axii-example-live').length,
      )
      const leftoverPortal2 = await page.evaluate(
        () => document.body.querySelectorAll('[data-example-portal]').length,
      )

      if (leftoverRootsAfter !== 0) {
        throw new Error(
          `scenario ②: ${leftoverRootsAfter} [data-example-root] survived navigation (expected 0) — <Example> ref(null) branch did not destroy all ${examplesCountBefore} inner createRoots`,
        )
      }
      if (leftoverLiveAfter !== 0) {
        throw new Error(
          `scenario ②: ${leftoverLiveAfter} .axii-example-live survived navigation (expected 0)`,
        )
      }
      if (leftoverPortal2 !== 0) {
        throw new Error(
          `scenario ②: ${leftoverPortal2} [data-example-portal] survived navigation (expected 0)`,
        )
      }
      console.log(`scenario ② OK: all ${examplesCountBefore} example roots destroyed on navigation away`)

      // No page errors during the whole flow.
      if (pageErrors.length > 0) {
        throw new Error(`page errors during cleanup flow: ${JSON.stringify(pageErrors)}`)
      }
      console.log('OK: D-25 example unmount cleanup verified')
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
