/** @jsx createElement */
// Example: computed — derived reactive value. The total re-evaluates only when
// price or quantity changes; intermediate atoms that weren't read don't trigger it.
import { createElement, createRoot } from 'axii'
import { atom, computed } from 'data0'

export function render(container: HTMLElement): () => void {
  const price = atom(100)
  const quantity = atom(3)
  const total = computed(() => price() * quantity())
  const discount = atom(0)
  const payable = computed(() => Math.max(0, total() - discount()))

  function App() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div class="axii-demo-row">
          <label style={{ minWidth: '100px', color: 'var(--axii-fg-muted)' }}>Price:</label>
          <input
            class="axii-demo-input"
            type="number"
            value={price()}
            onInput={(e: InputEvent) => price(Number((e.target as HTMLInputElement).value) || 0)}
          />
        </div>
        <div class="axii-demo-row">
          <label style={{ minWidth: '100px', color: 'var(--axii-fg-muted)' }}>Quantity:</label>
          <input
            class="axii-demo-input"
            type="number"
            value={quantity()}
            onInput={(e: InputEvent) => quantity(Number((e.target as HTMLInputElement).value) || 0)}
          />
        </div>
        <div class="axii-demo-row">
          <label style={{ minWidth: '100px', color: 'var(--axii-fg-muted)' }}>Discount:</label>
          <input
            class="axii-demo-input"
            type="number"
            value={discount()}
            onInput={(e: InputEvent) => discount(Number((e.target as HTMLInputElement).value) || 0)}
          />
        </div>
        <div
          style={{
            marginTop: '8px',
            padding: '12px 16px',
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius)',
            background: '#fafafa',
            fontFamily: 'var(--axii-font-mono)',
          }}
        >
          subtotal = {total} · payable = {payable}
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
