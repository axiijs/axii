/** @jsx createElement */
// Example: atom two-way binding.
//
// This file is imported three ways by <Example>:
//   import rawSource from './AtomTwoWay.tsx?raw'      // copyable string
//   import highlighted from './AtomTwoWay.tsx?shiki'  // highlighted HTML
//   import { render } from './AtomTwoWay.tsx'         // live renderer
//
// Anti-pattern check (C-36, C-37): the input handler is a stable function set
// once via addEventListener (axii binds on* once at creation); it mutates the
// atom, the atom drives the <span> text via a function node. No re-render, no
// handler swapping.
import { createElement, createRoot } from 'axii'
import { atom } from 'data0'

export function render(container: HTMLElement): () => void {
  const text = atom('hello')

  function App() {
    return (
      <div>
        <div class="axii-demo-row">
          <label style={{ minWidth: '80px', color: 'var(--axii-fg-muted)' }}>Input:</label>
          <input
            class="axii-demo-input"
            value={text()}
            onInput={(e: InputEvent) => {
              text((e.target as HTMLInputElement).value)
            }}
          />
        </div>
        <div class="axii-demo-row">
          <label style={{ minWidth: '80px', color: 'var(--axii-fg-muted)' }}>Mirror:</label>
          <span class="axii-demo-tag">{text}</span>
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
