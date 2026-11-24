/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { examples } from '../examples/registry.js'
import { Example } from '../components/Example.js'

// Examples index page (C-31, C-32, C-33). Every entry renders BOTH the
// highlighted source AND a live axii subtree of the same source file (C-19).
// The page itself is rendered with axii (C-16); each <Example> mounts its own
// child root and disposes it on unmount.
export function ExamplesPage(_: {}, {}: RenderContext): JSXElement {
  return (
    <div class="axii-container" style={{ padding: '40px 24px 80px' }}>
      <h1 style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px' }}>
        Examples
      </h1>
      <p style={{ color: 'var(--axii-fg-muted)', fontSize: '17px', margin: '0 0 32px' }}>
        Each example is a live axii subtree — type in the inputs, click the buttons,
        resize the boxes. The code shown is the exact code running in the preview.
      </p>

      {examples.map((entry) => (
        <Example
          title={entry.title}
          description={entry.description}
          rawSource={entry.rawSource}
          highlightedSource={entry.highlightedSource}
          render={entry.render}
        />
      ))}
    </div>
  )
}
