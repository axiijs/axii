// SSR: string-serialize on the server, claim-hydrate in the browser.
//
// - `renderToString` lives in the Node-safe entry `axii/ssr` (no DOM globals).
// - `hydrateRoot` is exported from the main `axii` package and claims the
//   server DOM top-down instead of rebuilding it (matched nodes keep identity).
// - Callers must keep the reactive tree/data identical between the two
//   moments; axii does not ship a state dehydrate protocol.
// - While `hydrateRoot` runs, JSX returns a hydration description, not a DOM
//   node, and it never becomes one: reach nodes through `ref` (see Search).
import { createElement, hydrateRoot, atom, Portal, configureDiagnostics } from 'axii'
import { renderToString } from 'axii/ssr'

function Search({}, { createElement, createRef }: any) {
  // Not `const input = <input/>` and `input.focus()` in the handler: after
  // hydrateRoot that value is a description, and focus() throws a TypeError
  // when the button is clicked. The ref receives the claimed server <input>.
  const input = createRef()
  return (
    <div>
      <input ref={input} />
      <button onClick={() => input.current.focus()}>Search</button>
    </div>
  )
}

function App({}, { createElement }: any) {
  const title = atom('Hello from SSR')
  return (
    <div>
      <h1>{title}</h1>
      <Search />
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
// Diagnostics are off in the published package. In development, turn them on
// before hydrateRoot to get AXII_HYDRATION_* reports with JSX locations.
// Mismatches are reported to onError (diagnostics on or off) and repaired.
if (import.meta.env.DEV) {
  configureDiagnostics({ enabled: true, onError: (error) => console.warn(error) })
}

const rootEl = document.getElementById('root')!
rootEl.innerHTML = html
const modalEl = document.getElementById('modal-root')!
if (portals['modal-root']) modalEl.innerHTML = portals['modal-root'].html

// Pass a component: an element written directly here (hydrateRoot(rootEl, <main/>))
// is created before hydration starts and replaces the server node instead of reusing it.
const root = hydrateRoot(rootEl, <App />, {
  portals: { 'modal-root': modalEl },
})
// After hydrate, updates use the same CSR paths as createRoot().render().
// root.destroy() tears down hosts/bindings like CSR.
