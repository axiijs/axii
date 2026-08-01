/** @jsx createElement */
// Example: RxMap — keyed reactive entries. get/set/delete are reactive;
// the rendered chips update as values change.
import { createElement, createRoot } from 'axii'
import { RxMap } from 'data0'

export function render(container: HTMLElement): () => void {
  const allKeys = ['open', 'archived', 'pinned', 'snoozed']
  const filters = new RxMap<string, boolean>([
    ['open', true],
    ['archived', false],
    ['pinned', false],
    ['snoozed', false],
  ])

  const toggle = (key: string) => {
    filters.set(key, !filters.get(key))
  }

  function App() {
    return (
      <div>
        <p style={{ color: 'var(--axii-fg-muted)', margin: '0 0 12px' }}>
          Active filters:{' '}
          {() =>
            allKeys
              .filter((k) => filters.get(k))
              .join(', ') || '(none)'
          }
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {allKeys.map((key) => (
            <button
              class="axii-btn"
              style={() => ({
                background: filters.get(key) ? 'var(--axii-accent)' : 'var(--axii-bg)',
                color: filters.get(key) ? '#fff' : 'var(--axii-fg)',
                border: '1px solid var(--axii-border)',
                padding: '6px 12px',
                fontSize: '13px',
              })}
              onClick={() => toggle(key)}
            >
              {key}: {() => (filters.get(key) ? 'on' : 'off')}
            </button>
          ))}
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
