// SSR: string-serialize on the server, claim-hydrate in the browser.
//
// - `renderToString` lives in the Node-safe entry `axii/ssr` (no DOM globals).
// - `hydrateRoot` is exported from the main `axii` package and reuses the
//   server DOM instead of rebuilding it (matched nodes keep identity).
// - Callers must keep the reactive tree/data identical between the two
//   moments; axii does not ship a state dehydrate protocol.
import { createElement, hydrateRoot, atom, Portal } from 'axii'
import { renderToString } from 'axii/ssr'

function App({}, { createElement }: any) {
  const title = atom('Hello from SSR')
  return (
    <div>
      <h1>{title}</h1>
      {/* Portal content is returned in `portals`, not in the main html. */}
      <Portal container={{ id: 'modal-root' }} content={() => <div>Modal</div>} />
    </div>
  )
}

// --- Server (Node) ---
const { html, styles, portals } = renderToString(<App />)
// html ends with <!--root-->. Inject styles (e.g. <style data-axii-ssr>) and
// write portals['modal-root'].html into the matching container before hydrate.

// --- Client (browser) ---
const rootEl = document.getElementById('root')!
rootEl.innerHTML = html
const modalEl = document.getElementById('modal-root')!
if (portals['modal-root']) modalEl.innerHTML = portals['modal-root'].html

const root = hydrateRoot(rootEl, <App />, {
  portals: { 'modal-root': modalEl },
})
// After hydrate, updates use the same CSR paths as createRoot().render().
// root.destroy() tears down hosts/bindings like CSR.
