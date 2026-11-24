/** @jsx createElement */
import { createElement, createRoot, Fragment } from 'axii'
import { atom } from 'data0'
import { Router, currentPath, navigate } from './router.js'
import { Layout } from './components/Layout.js'
import { HomePage } from './pages/HomePage.js'
import { DocsPage } from './pages/DocsPage.js'
import { ExamplesPage } from './pages/ExamplesPage.js'
import './theme/tokens.css'
import './theme/global.css'

// Self-built history router (DR-03): the router is not exported from src/, so
// the site ships a minimal history-API implementation. It keeps the current
// path in an `atom` so the layout can re-render the outlet as a fine-grained
// DOM update rather than a full re-render — which is itself the correct axii
// reactive pattern (component functions run once; only the outlet subtree
// responds to the path atom).
function App() {
  return (
    <Router>
      <Layout>
        {() => {
          const path = currentPath()
          if (path === '/' || path === '') return <HomePage />
          if (path === '/docs' || path.startsWith('/docs/')) return <DocsPage />
          if (path === '/examples' || path.startsWith('/examples/')) return <ExamplesPage />
          return (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <h1>404</h1>
              <p>The page {path} was not found.</p>
              <button
                class="axii-btn axii-btn-primary"
                onClick={() => navigate('/')}
              >
                Back home
              </button>
            </div>
          )
        }}
      </Layout>
    </Router>
  )
}

const container = document.getElementById('root')!
const root = createRoot(container)
root.render(<App />)
