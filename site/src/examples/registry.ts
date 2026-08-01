// Examples registry. Each entry maps to one example source file imported three
// ways (per C-19, DR-06):
//   ?raw     → copyable source string
//   ?shiki   → build-time highlighted HTML
//   normal   → the `render(container)` function (live demo)
//
// The three imports resolve to the same physical file on disk, so the displayed
// code cannot drift from the running instance. The registry is the single
// source of truth for the examples index page AND for the D-24 coverage gate
// (check-examples-coverage.mjs reads the IDs here).

import atomRaw from './AtomTwoWay.tsx?raw'
import atomHtml from './AtomTwoWay.tsx?shiki'
import { render as atomRender } from './AtomTwoWay.tsx'

import rxlistRaw from './RxListExample.tsx?raw'
import rxlistHtml from './RxListExample.tsx?shiki'
import { render as rxlistRender } from './RxListExample.tsx'

import rxmapRaw from './RxMapExample.tsx?raw'
import rxmapHtml from './RxMapExample.tsx?shiki'
import { render as rxmapRender } from './RxMapExample.tsx'

import rxsetRaw from './RxSetExample.tsx?raw'
import rxsetHtml from './RxSetExample.tsx?shiki'
import { render as rxsetRender } from './RxSetExample.tsx'

import computedRaw from './ComputedExample.tsx?raw'
import computedHtml from './ComputedExample.tsx?shiki'
import { render as computedRender } from './ComputedExample.tsx'

import aopRaw from './ComponentAopExample.tsx?raw'
import aopHtml from './ComponentAopExample.tsx?shiki'
import { render as aopRender } from './ComponentAopExample.tsx'

import portalRaw from './PortalExample.tsx?raw'
import portalHtml from './PortalExample.tsx?shiki'
import { render as portalRender } from './PortalExample.tsx'

import formRaw from './FormExample.tsx?raw'
import formHtml from './FormExample.tsx?shiki'
import { render as formRender } from './FormExample.tsx'

import rectRaw from './RxDOMRectExample.tsx?raw'
import rectHtml from './RxDOMRectExample.tsx?shiki'
import { render as rectRender } from './RxDOMRectExample.tsx'

import sizeRaw from './RxDOMSizeExample.tsx?raw'
import sizeHtml from './RxDOMSizeExample.tsx?shiki'
import { render as sizeRender } from './RxDOMSizeExample.tsx'

import scrollRaw from './RxDOMScrollPositionExample.tsx?raw'
import scrollHtml from './RxDOMScrollPositionExample.tsx?shiki'
import { render as scrollRender } from './RxDOMScrollPositionExample.tsx'

export type ExampleEntry = {
  id: string
  title: string
  description: string
  category: string
  rawSource: string
  highlightedSource: string
  // render() mounts a live axii subtree into the container and returns a
  // destroy handle. <Example> calls the handle when its ref is detached
  // (route change / unmount) so the inner reactive graph + DOM are torn down
  // — axii roots are not GC'd, so destroy() must be called explicitly.
  render: (container: HTMLElement) => () => void
}

export const examples: ExampleEntry[] = [
  {
    id: 'atom-two-way',
    title: 'atom — two-way binding',
    description: 'An input writes to an atom; the atom drives a sibling span. No re-render.',
    category: 'Reactive primitives',
    rawSource: atomRaw,
    highlightedSource: atomHtml,
    render: atomRender,
  },
  {
    id: 'rxlist',
    title: 'RxList — incremental list',
    description: 'push / splice / clear produce incremental DOM patches; rows keep their identity.',
    category: 'Reactive collections',
    rawSource: rxlistRaw,
    highlightedSource: rxlistHtml,
    render: rxlistRender,
  },
  {
    id: 'rxmap',
    title: 'RxMap — keyed entries',
    description: 'Reactive get/set/delete. Filter chips toggle on/off; the active list recomputes.',
    category: 'Reactive collections',
    rawSource: rxmapRaw,
    highlightedSource: rxmapHtml,
    render: rxmapRender,
  },
  {
    id: 'rxset',
    title: 'RxSet — unique membership',
    description: 'Toggle tags; the count updates incrementally as the set changes.',
    category: 'Reactive collections',
    rawSource: rxsetRaw,
    highlightedSource: rxsetHtml,
    render: rxsetRender,
  },
  {
    id: 'computed',
    title: 'computed — derived values',
    description: 'subtotal and payable recompute only when their actual inputs change.',
    category: 'Reactive primitives',
    rawSource: computedRaw,
    highlightedSource: computedHtml,
    render: computedRender,
  },
  {
    id: 'component-aop',
    title: 'Component AOP — bindProps',
    description: 'bindProps pre-binds props to a component at definition time. The function runs once per instance.',
    category: 'Composition',
    rawSource: aopRaw,
    highlightedSource: aopHtml,
    render: aopRender,
  },
  {
    id: 'portal',
    title: 'Portal — modal',
    description: 'A modal rendered into a separate DOM container, escaping parent overflow/transform.',
    category: 'Composition',
    rawSource: portalRaw,
    highlightedSource: portalHtml,
    render: portalRender,
  },
  {
    id: 'form',
    title: 'Form — reactive form',
    description: 'Items register via FormContext; values live in an RxMap. submit/reset are exposed on the context.',
    category: 'Composition',
    rawSource: formRaw,
    highlightedSource: formHtml,
    render: formRender,
  },
  {
    id: 'rxdom-rect',
    title: 'RxDOMRect — bounding box',
    description: 'Element bounding box as a reactive value; updates on scroll/resize.',
    category: 'Reactive DOM state',
    rawSource: rectRaw,
    highlightedSource: rectHtml,
    render: rectRender,
  },
  {
    id: 'rxdom-size',
    title: 'RxDOMSize — content box',
    description: 'ResizeObserver-backed size as a reactive value. Resize the textarea to see it update.',
    category: 'Reactive DOM state',
    rawSource: sizeRaw,
    highlightedSource: sizeHtml,
    render: sizeRender,
  },
  {
    id: 'rxdom-scroll',
    title: 'RxDOMScrollPosition — scroll state',
    description: 'scrollTop/scrollLeft/scrollHeight as reactive values. Scroll the inner box.',
    category: 'Reactive DOM state',
    rawSource: scrollRaw,
    highlightedSource: scrollHtml,
    render: scrollRender,
  },
]
