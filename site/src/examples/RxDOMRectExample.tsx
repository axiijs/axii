/** @jsx createElement */
// Example: RxDOMRect — element bounding box as a reactive value.
// The rect updates live as the element moves (e.g. on scroll/resize).
import { createElement, createRoot, type RenderContext } from 'axii'
import { atom } from 'data0'
import { RxDOMRect } from 'axii'

export function render(container: HTMLElement): () => void {
  // RxDOMRect requires (value, options). options tells it when to recalculate.
  // The reactive value is on rect.value (an atom); rect itself is the wrapper.
  const rectValue = atom(null)
  const rect = new RxDOMRect(rectValue, 'requestAnimationFrame')

  function App({}, { createElement }: RenderContext) {
    return (
      <div>
        <div
          ref={rect.ref}
          style={{
            padding: '24px',
            border: '1px solid var(--axii-accent)',
            borderRadius: 'var(--axii-radius-lg)',
            background: 'rgba(0,112,243,0.04)',
            color: 'var(--axii-accent)',
            fontWeight: 600,
          }}
        >
          Observed element — scroll the page to see its viewport rect change.
        </div>
        <pre
          style={{
            marginTop: '12px',
            padding: '12px',
            background: '#fafafa',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius)',
            fontFamily: 'var(--axii-font-mono)',
            fontSize: '13px',
            overflow: 'auto',
          }}
        >
          {() => {
            const r = rectValue()
            return r
              ? `top: ${r.top.toFixed(1)}  left: ${r.left.toFixed(1)}\nwidth: ${r.width.toFixed(1)}  height: ${r.height.toFixed(1)}`
              : '(no rect yet)'
          }}
        </pre>
      </div>
    )
  }

  const root = createRoot(container)
  root.render(<App />)
  // Return the destroy handle so <Example> can tear down the inner reactive
  // graph + DOM when the example is unmounted (e.g. on route change). axii
  // roots are not GC'd — destroy() must be called explicitly.
  return () => root.destroy()
}
