/** @jsx createElement */
// Example: Component AOP — bindProps pre-binds props to a component, returning
// a new component. The component function still runs once per instance; only
// the props are pre-bound at definition time.
import { createElement, createRoot, bindProps, type RenderContext } from 'axii'
import { atom } from 'data0'

function Button({ label, color, onClick }: any, { createElement }: RenderContext) {
  return (
    <button
      onClick={onClick}
      style={() => ({
        padding: '8px 16px',
        borderRadius: 'var(--axii-radius)',
        border: '1px solid var(--axii-border)',
        background: color ?? 'var(--axii-bg)',
        color: color ? '#fff' : 'var(--axii-fg)',
        fontSize: '14px',
        cursor: 'pointer',
      })}
    >
      {label}
    </button>
  )
}

const PrimaryButton = bindProps(Button, { color: '#0070f3' })
const DangerButton = bindProps(Button, { color: '#e5484d' })

export function render(container: HTMLElement): () => void {
  const clicks = atom(0)

  function App() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button
            label="default"
            onClick={() => clicks(clicks())}
          />
          <PrimaryButton
            label="primary"
            onClick={() => clicks(clicks() + 1)}
          />
          <DangerButton
            label="danger"
            onClick={() => clicks(clicks() + 5)}
          />
        </div>
        <div class="axii-demo-tag">clicks: {clicks}</div>
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
