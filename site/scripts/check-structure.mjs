// D-08 + D-11 gate: verify page structure via headless navigation.
// D-08: skeleton components (TopNav, Sidebar, Hero) produce real DOM.
// D-11: homepage has hero (H1 + subtitle + CTA) + >= 3 feature cards.
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
  const pages = process.argv.includes('--page')
    ? [process.argv[process.argv.indexOf('--page') + 1]]
    : (process.argv.includes('--pages')
      ? process.argv[process.argv.indexOf('--pages') + 1].split(',')
      : ['home', 'docs', 'examples'])

  const proc = startPreview()
  try {
    await waitForServer(proc)
    await withBrowser(async (page) => {
      // Home page (D-11): hero + feature cards + CTA
      if (pages.includes('home')) {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' })
        await page.waitForFunction(() => document.querySelector('.axii-topnav') !== null, { timeout: 10000 })
        const homeStructure = await page.evaluate(() => {
          const hero = document.querySelector('.axii-hero')
          const h1 = hero?.querySelector('h1')
          const subtitle = hero?.querySelector('.axii-hero-subtitle')
          const cta = hero?.querySelectorAll('.axii-btn')
          const features = document.querySelectorAll('.axii-feature-card')
          return {
            hasHero: !!hero,
            hasH1: !!h1,
            hasSubtitle: !!subtitle,
            ctaCount: cta?.length ?? 0,
            featureCards: features.length,
          }
        })
        if (!homeStructure.hasHero || !homeStructure.hasH1 || !homeStructure.hasSubtitle || homeStructure.ctaCount < 1 || homeStructure.featureCards < 3) {
          throw new Error(`home page structure check failed: ${JSON.stringify(homeStructure)}`)
        }
        console.log(`OK home: hero=${homeStructure.hasHero}, h1=${homeStructure.hasH1}, cta=${homeStructure.ctaCount}, features=${homeStructure.featureCards}`)
      }

      // Docs page (D-08): TopNav + Sidebar
      if (pages.includes('docs')) {
        await page.goto(BASE + '/docs', { waitUntil: 'networkidle' })
        await page.waitForFunction(() => document.querySelector('.axii-topnav') !== null, { timeout: 10000 })
        const docsStructure = await page.evaluate(() => ({
          hasTopNav: !!document.querySelector('.axii-topnav'),
          hasSidebar: !!document.querySelector('.axii-doc-sidebar'),
          hasContent: !!document.querySelector('.axii-doc-content'),
        }))
        if (!docsStructure.hasTopNav || !docsStructure.hasSidebar || !docsStructure.hasContent) {
          throw new Error(`docs page structure check failed: ${JSON.stringify(docsStructure)}`)
        }
        console.log(`OK docs: ${JSON.stringify(docsStructure)}`)
      }

      // Examples page (D-08): TopNav + examples
      if (pages.includes('examples')) {
        await page.goto(BASE + '/examples', { waitUntil: 'networkidle' })
        await page.waitForFunction(() => document.querySelector('.axii-topnav') !== null, { timeout: 10000 })
        const exStructure = await page.evaluate(() => ({
          hasTopNav: !!document.querySelector('.axii-topnav'),
          exampleCount: document.querySelectorAll('[data-example-root]').length,
        }))
        if (!exStructure.hasTopNav || exStructure.exampleCount === 0) {
          throw new Error(`examples page structure check failed: ${JSON.stringify(exStructure)}`)
        }
        console.log(`OK examples: topnav=${exStructure.hasTopNav}, examples=${exStructure.exampleCount}`)
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
