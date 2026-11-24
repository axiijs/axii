/** @jsx createElement */
// Example: Portal — render a subtree into a different DOM container.
// The modal renders into a portal root appended to document.body, so it
// escapes any overflow/transform on its parent.
import { createElement, createRoot, Portal, type RenderContext } from 'axii'
import { atom } from 'data0'

export function render(container: HTMLElement): () => void {
  const open = atom(false)

  // Each example owns its portal root so it cleans up on unmount.
  // The container passed to Portal must be an HTMLElement; we create one
  // here and remove it when the example's root is destroyed (via useEffect).
  let portalRoot: HTMLDivElement | null = null
  function ensurePortalRoot(): HTMLDivElement {
    if (!portalRoot) {
      portalRoot = document.createElement('div')
      portalRoot.dataset.examplePortal = 'true'
      document.body.appendChild(portalRoot)
    }
    return portalRoot
  }

  function ModalContent({}, { createElement }: RenderContext) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: '0',
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: '100',
        }}
        onClick={() => open(false)}
      >
        <div
          onClick={(e: MouseEvent) => e.stopPropagation()}
          style={{
            background: 'var(--axii-bg)',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius-lg)',
            padding: '24px',
            minWidth: '280px',
            boxShadow: 'var(--axii-shadow-lg)',
          }}
        >
          <h3 style={{ margin: '0 0 12px' }}>Modal via Portal</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--axii-fg-muted)' }}>
            This subtree lives in a separate DOM container, attached to document.body.
          </p>
          <button class="axii-btn axii-btn-primary" onClick={() => open(false)}>
            Close
          </button>
        </div>
      </div>
    )
  }

  function App({}, { createElement, useEffect }: RenderContext) {
    useEffect(() => {
      return () => {
        if (portalRoot) {
          document.body.removeChild(portalRoot)
          portalRoot = null
        }
      }
    })
    return (
      <div>
        <button class="axii-btn axii-btn-primary" onClick={() => open(true)}>
          Open modal
        </button>
        {() => (open() ? (
          <Portal container={ensurePortalRoot()} content={() => <ModalContent />} />
        ) : null)}
      </div>
    )
  }

  const root = createRoot(container)
  root.render(<App />)
  // Return the destroy handle so <Example> can tear down the inner reactive
  // graph + DOM when the example is unmounted (e.g. on route change). axii
  // roots are not GC'd — destroy() must be called explicitly. destroy() runs
  // the App component's useEffect cleanup, which removes the portal root div
  // appended to document.body — so navigating away from /examples leaves no
  // orphan modal overlay on the page.
  return () => root.destroy()
}
