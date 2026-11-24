// Documentation content registry. Each entry is one C-27 concept.
//
// Snippet imports use the `?raw` + `?shiki` pair (same as <Example>):
//   - `?raw`     → the copyable source string
//   - `?shiki`   → the build-time highlighted HTML (Shiki, see vite-shiki-plugin.ts)
// Both resolve to the same physical file, so the displayed snippet cannot drift
// from the actual TypeScript (C-19, applied to docs).
//
// Concept coverage follows C-27. The router/Action/state-machine/headless
// external-package callouts live in the ExternalPackages section (C-34, C-35).

import mentalModelRaw from './snippets/mental-model.ts?raw'
import mentalModelHtml from './snippets/mental-model.ts?shiki'
import atomRaw from './snippets/atom.ts?raw'
import atomHtml from './snippets/atom.ts?shiki'
import rxlistRaw from './snippets/rxlist.ts?raw'
import rxlistHtml from './snippets/rxlist.ts?shiki'
import rxmapRxsetRaw from './snippets/rxmap-rxset.ts?raw'
import rxmapRxsetHtml from './snippets/rxmap-rxset.ts?shiki'
import rxtimeRaw from './snippets/rxtime.ts?raw'
import rxtimeHtml from './snippets/rxtime.ts?shiki'
import computedRaw from './snippets/computed.ts?raw'
import computedHtml from './snippets/computed.ts?shiki'
import componentAopRaw from './snippets/component-aop.ts?raw'
import componentAopHtml from './snippets/component-aop.ts?shiki'
import portalRaw from './snippets/portal.ts?raw'
import portalHtml from './snippets/portal.ts?shiki'
import formRaw from './snippets/form.ts?raw'
import formHtml from './snippets/form.ts?shiki'
import contextRaw from './snippets/context.ts?raw'
import contextHtml from './snippets/context.ts?shiki'
import rxdomRaw from './snippets/rxdom-state.ts?raw'
import rxdomHtml from './snippets/rxdom-state.ts?shiki'
import lazyRaw from './snippets/lazy.ts?raw'
import lazyHtml from './snippets/lazy.ts?shiki'
import ssrRaw from './snippets/ssr.ts?raw'
import ssrHtml from './snippets/ssr.ts?shiki'
import diagnosticsRaw from './snippets/diagnostics.ts?raw'
import diagnosticsHtml from './snippets/diagnostics.ts?shiki'

export type DocSection = {
  id: string
  title: string
  group: string
  prose: string
  raw?: string
  html?: string
  language?: string
}

export type DocGroup = {
  id: string
  title: string
  sections: DocSection[]
}

export const docGroups: DocGroup[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    sections: [
      {
        id: 'mental-model',
        title: 'Mental model: functions run once',
        group: 'Getting started',
        prose:
          'axii is a high-performance incremental-update framework without Virtual DOM. ' +
          'A component function runs exactly once — at mount time. Every subsequent update is a ' +
          'fine-grained DOM write computed from reactive data (atom / RxList / computed), never a re-render. ' +
          'There is no diff pass and no vdom tree.',
        raw: mentalModelRaw,
        html: mentalModelHtml,
        language: 'tsx',
      },
      {
        id: 'atom',
        title: 'atom — reactive primitive',
        group: 'Getting started',
        prose:
          'atom(value) creates a reactive cell. Calling it reads the value (and subscribes when read inside ' +
          'a computed or function node). Calling it with an argument sets the value and notifies subscribers. ' +
          'atom is re-exported from axii (it comes from data0, the reactive core).',
        raw: atomRaw,
        html: atomHtml,
        language: 'ts',
      },
    ],
  },
  {
    id: 'reactive-collections',
    title: 'Reactive collections',
    sections: [
      {
        id: 'rxlist',
        title: 'RxList — incremental arrays',
        group: 'Reactive collections',
        prose:
          'RxList is a reactive array. Mutations produce incremental list patches: only the affected rows are ' +
          'inserted, moved, or removed — the rest keep their DOM identity and reactive subscriptions. ' +
          'This is what makes long lists cheap.',
        raw: rxlistRaw,
        html: rxlistHtml,
        language: 'ts',
      },
      {
        id: 'rxmap-rxset',
        title: 'RxMap / RxSet — keyed & unique',
        group: 'Reactive collections',
        prose:
          'RxMap mirrors Map with reactive get/set/delete. RxSet mirrors Set with reactive add/delete. ' +
          'Form values are stored in an RxMap so the whole form state is reactive end-to-end.',
        raw: rxmapRxsetRaw,
        html: rxmapRxsetHtml,
        language: 'ts',
      },
      {
        id: 'rxtime',
        title: 'RxTime — reactive clock',
        group: 'Reactive collections',
        prose:
          'RxTime(ms) is a reactive value that updates on a timer. Reading it inside a computed or function ' +
          'node re-evaluates the consumer on each tick. Destroy it to stop the timer.',
        raw: rxtimeRaw,
        html: rxtimeHtml,
        language: 'ts',
      },
      {
        id: 'computed',
        title: 'computed — derived values',
        group: 'Reactive collections',
        prose:
          'computed(fn) produces a derived reactive value. Dependencies are collected automatically from ' +
          'atom/RxList reads inside fn. It re-evaluates only when a dependency it actually read changes.',
        raw: computedRaw,
        html: computedHtml,
        language: 'ts',
      },
    ],
  },
  {
    id: 'components',
    title: 'Components & composition',
    sections: [
      {
        id: 'component-aop',
        title: 'Component AOP — bindProps / mergeProps',
        group: 'Components & composition',
        prose:
          'Component AOP lets you compose components declaratively. bindProps(Component, props) returns a new ' +
          'component with pre-bound props (propTypes/boundProps are carried over). mergeProps merges props at ' +
          'runtime inside a component. mergeProp does the same for a single key. Reusable subtrees ' +
          '(see ReusableHost) preserve identity across parent updates.',
        raw: componentAopRaw,
        html: componentAopHtml,
        language: 'tsx',
      },
      {
        id: 'portal',
        title: 'Portal — render elsewhere',
        group: 'Components & composition',
        prose:
          'Portal renders a subtree into a different DOM container (typically document.body for modals, ' +
          'tooltips, popovers). The subtree is a real axii tree with its reactive graph intact; it is ' +
          'destroyed when the Portal unmounts. Under SSR, pass a string id, { id }, or portalKey instead of a ' +
          'real HTMLElement — content is emitted into renderToString().portals[key], and hydrateRoot ' +
          'activates it via options.portals[key] (or document.getElementById).',
        raw: portalRaw,
        html: portalHtml,
        language: 'tsx',
      },
      {
        id: 'form',
        title: 'Form — reactive form container',
        group: 'Components & composition',
        prose:
          'Form registers its items via the FormContext and exposes submit / reset / clear. Values are held ' +
          'in an RxMap so the whole form state is reactive and can be read/written from anywhere.',
        raw: formRaw,
        html: formHtml,
        language: 'tsx',
      },
      {
        id: 'context',
        title: 'createContext / ContextProvider',
        group: 'Components & composition',
        prose:
          'createContext(name) creates a typed context token. ContextProvider supplies a value to its subtree; ' +
          'consumers read it via context.get(Token) from their RenderContext.',
        raw: contextRaw,
        html: contextHtml,
        language: 'tsx',
      },
    ],
  },
  {
    id: 'dom-state',
    title: 'Reactive DOM state',
    sections: [
      {
        id: 'rxdom',
        title: 'RxDOM* — DOM as reactive values',
        group: 'Reactive DOM state',
        prose:
          'The RxDOM* wrappers attach to an element via their .ref and expose DOM measurements and interactions ' +
          'as atoms: RxDOMRect, RxDOMSize, RxDOMScrollPosition, RxDOMFocused, RxDOMHovered, RxDOMDragState, ' +
          'RxDOMEventListener. Each cleans up its listeners/observers on destroy.',
        raw: rxdomRaw,
        html: rxdomHtml,
        language: 'tsx',
      },
    ],
  },
  {
    id: 'infra',
    title: 'Infrastructure',
    sections: [
      {
        id: 'lazy',
        title: 'lazy — code splitting',
        group: 'Infrastructure',
        prose:
          'lazy(loader, fallback?) defers loading a component module until first render. Useful for route-level ' +
          'code splitting without a router. Pass a fallback JSX element for the initial loading state. On the ' +
          'server, renderToString always emits the fallback (or null) synchronously and does not call load() — ' +
          'hydrateRoot claims that fallback, then the client starts loading as in CSR.',
        raw: lazyRaw,
        html: lazyHtml,
        language: 'tsx',
      },
      {
        id: 'ssr',
        title: 'SSR — renderToString + hydrateRoot',
        group: 'Infrastructure',
        prose:
          'Server rendering uses the Node-safe entry axii/ssr: renderToString(source) returns ' +
          '{ html, styles, portals } with no DOM globals. html ends with <!--root-->. Inject styles ' +
          '(e.g. <style data-axii-ssr>) and write each portals[key].html into the matching container before ' +
          'activation. On the client, hydrateRoot(container, source, { portals? }) reads the server output back ' +
          'top-down, in the order the server wrote it: each component, function child and list takes its own ' +
          'server nodes instead of searching the page for a same-tag element, so with matching output every ' +
          'element claims the node written for it, matched nodes keep their identity, and hydration time ' +
          'grows linearly with the page. ' +
          'Keep the component tree and reactive data identical between SSR and hydrate — axii does not ' +
          'dehydrate application state. Streaming SSR and state transfer are out of scope. Full design ' +
          'contracts live under docs/ssr-support/. ' +
          'Contract change: while hydrateRoot runs, JSX returns a hydration description, not a DOM node, and ' +
          'that value never becomes a node. Reading a property of it gives undefined, calling a method or ' +
          'passing it to a DOM API that takes only nodes throws a TypeError (append or replaceWith insert the ' +
          'text [object Object] instead), writing a property throws in strict-mode code, and identity or ' +
          'instanceof checks are false — also in event handlers that run long after hydration. ' +
          'Reach nodes through ref, as Search does in the snippet; where code checks whether a JSX result is ' +
          'a node, also check isHydrationElement(value). RxList.map rows and array items hold the claimed ' +
          'nodes once hydration is done (a frozen array keeps the descriptions). JSX created during hydration ' +
          'but first rendered after it is created ' +
          'like in a client render. A node created outside hydration replaces the server node at its position ' +
          'instead of reusing it; this includes an element passed directly to hydrateRoot, so pass a component ' +
          '(<App />). Code in ref callbacks, useLayoutEffect, useEffect and root.on listeners runs outside ' +
          'hydration and gets real nodes, and createRoot().render() is unchanged. ' +
          'Differences in node structure or text between server HTML and the client render are reported ' +
          '(code AXII_HYDRATION_MISMATCH, to configureDiagnostics({ onError }) and console.error) and ' +
          'repaired where they are found, so structure, text and the attributes written by client props end ' +
          'up equal to a client render; attribute values are written again from client props without a ' +
          'report, and attributes only the server wrote are removed on the repair path. A component error ' +
          'that no root.on(\'error\') listener handles, such as a missing Portal container, is thrown from ' +
          'hydrateRoot as from createRoot().render(). Diagnostics are off by default ' +
          'in the published package. With configureDiagnostics({ enabled: true }) called before hydrateRoot, ' +
          'reading or writing a description is reported, with its JSX location when the JSX transform provides ' +
          'it (AXII_HYDRATION_ELEMENT_ACCESS), ' +
          'and so are JSX first rendered after hydration (AXII_HYDRATION_ELEMENT_LATE_RENDER), server nodes ' +
          'replaced by nodes created outside hydration (AXII_HYDRATION_LIVE_NODE), server-only attributes left ' +
          'on a cleanly claimed element (AXII_HYDRATION_ATTRIBUTE_RESIDUE) and broken consistency checks ' +
          '(AXII_HYDRATION_INVARIANT). The README section "Hydration contract changes" has the full list.',
        raw: ssrRaw,
        html: ssrHtml,
        language: 'tsx',
      },
      {
        id: 'diagnostics',
        title: 'Diagnostics — dev-only invariants',
        group: 'Infrastructure',
        prose:
          'enableAxiiRetainedObjectDiagnostics turns on dev-only checks for leaked hosts and retained objects ' +
          'after clear. List-order invariants (AXII_LIST_ORDER_BROKEN) and range checks also run only when ' +
          'diagnostics are on. Production pays at most a boolean check — these paths are eliminated by ' +
          'dead-code elimination when __DEV__ is false.',
        raw: diagnosticsRaw,
        html: diagnosticsHtml,
        language: 'ts',
      },
      {
        id: 'external-packages',
        title: 'External packages',
        group: 'Infrastructure',
        prose:
          'The README mentions router, Action, state-machine and a headless UI system. These are NOT part of ' +
          'the axii core package — they live in separate repositories and are not re-exported from src/. ' +
          'Use them directly from npm when you need them:',
      },
    ],
  },
]

// External package callouts (C-34, C-35). Listed explicitly so the
// machine-checkable gate can verify each README-mentioned-but-unexported
// capability is annotated with its real package name and not fabricated.
export const externalPackages = [
  {
    capability: 'router',
    packageName: 'router0',
    source: 'npm · reactive-data-based router for axii',
    url: 'https://www.npmjs.com/package/router0',
  },
  {
    capability: 'Action (data-fetching / side-effects)',
    packageName: 'action0',
    source: 'npm · data0-based action management',
    url: 'https://www.npmjs.com/package/action0',
  },
  {
    capability: 'state-machine',
    packageName: 'statemachine0',
    source: 'npm · data0-based state machine',
    url: 'https://www.npmjs.com/package/statemachine0',
  },
  {
    capability: 'headless UI components',
    packageName: '@axiijs/ui',
    source: 'GitHub axiijs/ui · headless component system targeting ui.axii.dev',
    url: 'https://github.com/axiijs/ui',
  },
] as const
