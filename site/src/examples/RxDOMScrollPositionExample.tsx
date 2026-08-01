/** @jsx createElement */
// Example: RxDOMScrollPosition — reactive scrollTop/scrollLeft/scrollHeight.
// Scroll the inner box to see the values update live.
import { createElement, createRoot, type RenderContext } from 'axii'
import { RxDOMScrollPosition } from 'axii'

export function render(container: HTMLElement): () => void {
  // RxDOMScrollPosition uses a default atom(null) for its value, exposed on .value.
  const scroll = new RxDOMScrollPosition()

  function App({}, { createElement }: RenderContext) {
    return (
      <div>
        <div
          ref={scroll.ref}
          style={{
            height: '160px',
            overflow: 'auto',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius)',
            padding: '12px',
            fontFamily: 'var(--axii-font-mono)',
            fontSize: '13px',
            color: 'var(--axii-fg-muted)',
          }}
        >
          <p>Scroll me…</p>
          {Array.from({ length: 30 }, (_, i) => (
            <p style={{ margin: '0 0 12px' }}>line {i + 1}</p>
          ))}
        </div>
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            background: '#fafafa',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius)',
            fontFamily: 'var(--axii-font-mono)',
            fontSize: '13px',
          }}
        >
          {() => {
            const s = scroll.value()
            return s
              ? `scrollTop: ${s.scrollTop.toFixed(0)} / ${s.scrollHeight}  scrollLeft: ${s.scrollLeft.toFixed(0)}`
              : '(no scroll yet)'
          }}
        </div>
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
