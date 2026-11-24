/** @jsx createElement */
// Example: RxSet — unique membership, reactive end-to-end.
// Clicking a tag toggles its membership; the count updates incrementally.
import { createElement, createRoot } from 'axii'
import { RxSet, computed } from 'data0'

export function render(container: HTMLElement): () => void {
  const allTags = ['reactive', 'vdom-free', 'fine-grained', 'fast', 'minimal', 'typescript']
  const selected = new RxSet<string>(['reactive', 'vdom-free'])
  const count = computed(() => selected.size)

  const toggle = (tag: string) => {
    if (selected.has(tag)) selected.delete(tag)
    else selected.add(tag)
  }

  function App() {
    return (
      <div>
        <p style={{ color: 'var(--axii-fg-muted)', margin: '0 0 12px' }}>
          {count} tag{() => (count() === 1 ? '' : 's')} selected
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {allTags.map((tag) => (
            <button
              class="axii-btn"
              style={() => ({
                background: selected.has(tag) ? 'var(--axii-fg)' : 'var(--axii-bg)',
                color: selected.has(tag) ? '#fff' : 'var(--axii-fg)',
                border: '1px solid var(--axii-border)',
                padding: '6px 12px',
                fontSize: '13px',
              })}
              onClick={() => toggle(tag)}
            >
              {tag}
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
