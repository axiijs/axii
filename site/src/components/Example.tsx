/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { atom } from 'data0'
import { CodeBlock } from './CodeBlock.js'

// <Example> (C-18, C-19, C-20, C-24): renders BOTH the highlighted source and a
// live axii subtree of the SAME source file.
//
// The "same file" guarantee (C-19) comes from how the parent page wires imports:
//   import rawSource from '../examples/AtomTwoWay.tsx?raw'      // copyable string
//   import highlighted from '../examples/AtomTwoWay.tsx?shiki'  // highlighted HTML
//   import { render } from '../examples/AtomTwoWay.tsx'         // live renderer
// All three resolve to the same physical file on disk, so the displayed code
// cannot drift from the running instance.
//
// The live demo area is the real axii subtree (C-20): the parent passes a
// `render(container)` function (C-18) that creates its own inner `createRoot`
// and returns a destroy handle. The handle is held in a closure and invoked
// when axii detaches this element (ref(null)) — i.e. when the route changes
// away from /examples. Calling the handle runs `root.destroy()`, which tears
// down the example's reactive graph and DOM (including any Portal roots the
// example appended to document.body via its own useEffect cleanup). axii roots
// are NOT garbage-collected; without this destroy the reactive subscriptions
// and DOM nodes leak across navigations.
//
// Tabs (Preview / Code) are a presentation toggle. The live subtree is always
// mounted (even when the Code tab is shown) so its reactive graph stays alive
// and switching back does not pay re-initialization cost; the tab only toggles
// CSS visibility.
export function Example({
  title,
  description,
  rawSource,
  highlightedSource,
  render,
}: {
  title: string
  description?: string
  rawSource: string
  highlightedSource: string
  render: (container: HTMLElement) => () => void
}, _: RenderContext): JSXElement {
  const tab = atom<'preview' | 'code'>('preview')
  const mounted = atom(false)
  // Destroy handle for the inner createRoot. Held in a closure (not reactive
  // state — it is only read in the ref callback, never in a reactive context).
  let destroyHandle: (() => void) | null = null

  return (
    <div class="axii-example" data-example-root>
      <div class="axii-example-tabs">
        <button
          class="axii-example-tab"
          data-active={() => (tab() === 'preview' ? 'true' : 'false')}
          onClick={() => tab('preview')}
        >
          Preview
        </button>
        <button
          class="axii-example-tab"
          data-active={() => (tab() === 'code' ? 'true' : 'false')}
          onClick={() => tab('code')}
        >
          Code
        </button>
        <span style={{ marginLeft: 'auto', padding: '0 12px', color: 'var(--axii-fg-muted)', fontSize: '13px' }}>
          {title}
        </span>
      </div>

      {description ? (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--axii-border)', color: 'var(--axii-fg-muted)', fontSize: '14px' }}>
          {description}
        </div>
      ) : null}

      {/* Live preview. Always mounted (reactive graph stays alive); visibility is toggled.
          The example's `render(container)` creates its own inner createRoot and returns a
          destroy handle; we call it on ref(null) to tear down the inner root. */}
      <div
        class="axii-example-preview"
        style={() => ({ display: tab() === 'preview' ? 'block' : 'none' })}
      >
        <div class="axii-example-preview-title">Live demo</div>
        <div
          class="axii-example-live"
          ref={(el: HTMLDivElement | null) => {
            if (el && !mounted()) {
              // Mount: the example's render() creates its own createRoot and
              // returns a destroy handle. We hold the handle so the detach
              // branch can tear the inner root down.
              destroyHandle = render(el)
              mounted(true)
            } else if (el === null) {
              // Detach: axii calls ref(null) when this subtree is removed
              // (route change away from /examples). Destroy the inner root so
              // its reactive graph and DOM are reclaimed. Running the example's
              // useEffect/onCleanup callbacks (e.g. PortalExample's portal-root
              // removal) is part of root.destroy() — see src/render.ts.
              if (destroyHandle) {
                destroyHandle()
                destroyHandle = null
              }
            }
          }}
        />
      </div>

      {/* Code view. Highlighted HTML is produced at build time by the Shiki plugin. */}
      <div style={() => ({ display: tab() === 'code' ? 'block' : 'none' })}>
        <CodeBlock highlightedHtml={highlightedSource} rawCode={rawSource} language="tsx" />
      </div>
    </div>
  )
}
