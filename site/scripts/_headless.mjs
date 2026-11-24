// Shared headless browser helper for the site gate scripts.
// Uses the playwright instance installed in site/node_modules.
import { chromium } from 'playwright'

export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  // Collect console errors and page errors so individual checks can assert on them.
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })
  try {
    const result = await fn(page, { consoleErrors, pageErrors })
    return result
  } finally {
    await context.close()
    await browser.close()
  }
}

// Wait for the SPA root to render. axii is a pure client-side renderer; the
// static HTML root is empty. This helper waits until #root has children.
export async function waitForRoot(page, { timeout = 10000 } = {}) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#root')
      return root && root.children.length > 0
    },
    { timeout },
  )
}
