/** @jsx createElement */
// Example: RxList incremental list. push / splice / clear produce incremental
// DOM patches — only the affected rows are inserted/removed, the rest keep
// their identity and reactive subscriptions.
import { createElement, createRoot } from 'axii'
import { atom, RxList } from 'data0'

export function render(container: HTMLElement): () => void {
  const items = new RxList<string>(['first', 'second'])
  const draft = atom('')

  function App() {
    return (
      <div>
        <div class="axii-demo-row">
          <input
            class="axii-demo-input"
            placeholder="add an item"
            value={draft()}
            onInput={(e: InputEvent) => draft((e.target as HTMLInputElement).value)}
          />
          <button
            class="axii-btn axii-btn-primary"
            onClick={() => {
              const v = draft().trim()
              if (!v) return
              items.push(v)
              draft('')
            }}
          >
            Add
          </button>
          <button class="axii-btn axii-btn-secondary" onClick={() => items.clear()}>
            Clear
          </button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {items.map((item, index) => (
            <li
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                border: '1px solid var(--axii-border)',
                borderRadius: 'var(--axii-radius)',
                marginBottom: '6px',
              }}
            >
              <span>
                <span style={{ color: 'var(--axii-fg-muted)', fontFamily: 'var(--axii-font-mono)', marginRight: '8px' }}>
                  {() => `${index() + 1}.`}
                </span>
                {item}
              </span>
              <button
                class="axii-btn axii-btn-secondary"
                style={{ padding: '2px 10px', fontSize: '12px' }}
                onClick={() => items.splice(index(), 1)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
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
