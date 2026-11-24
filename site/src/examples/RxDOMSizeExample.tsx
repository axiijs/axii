/** @jsx createElement */
// Example: RxDOMSize — element content/border box size as a reactive value,
// backed by a ResizeObserver. Resize the textarea to see the numbers update.
import { createElement, createRoot, type RenderContext } from 'axii'
import { RxDOMSize } from 'axii'

export function render(container: HTMLElement): () => void {
  // RxDOMSize uses a default atom(null) for its value, exposed on .value.
  const size = new RxDOMSize()

  function App({}, { createElement }: RenderContext) {
    return (
      <div>
        <textarea
          ref={size.ref}
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '8px',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius)',
            fontFamily: 'var(--axii-font-mono)',
            fontSize: '13px',
            resize: 'both',
          }}
          placeholder="Drag the bottom-right corner to resize me"
        />
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
            const s = size.value()
            return s
              ? `content: ${s.width.toFixed(1)} × ${s.height.toFixed(1)}  border-box: ${s.borderBoxWidth.toFixed(1)} × ${s.borderBoxHeight.toFixed(1)}`
              : '(no size yet)'
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
