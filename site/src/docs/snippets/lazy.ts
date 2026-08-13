// lazy: defer loading a component's code until first render. Useful for
// route-level code splitting without a router.
// SSR: renderToString emits fallback (or null) only — it never awaits load().
// hydrateRoot claims that fallback; the client then starts load() as in CSR.
import { lazy, createElement } from 'axii'

const HeavyChart = lazy(
  () => import('./HeavyChart.js'),
  () => <div>Loading chart…</div>,
)

function Dashboard({}, { createElement }: any) {
  return <HeavyChart />
}
