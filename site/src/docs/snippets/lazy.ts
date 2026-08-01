// lazy: defer loading a component's code until first render. Useful for
// route-level code splitting without a router.
import { lazy, createElement } from 'axii'

const HeavyChart = lazy(() => import('./HeavyChart.js'))

function Dashboard({}, { createElement }: any) {
  return <HeavyChart />
}
