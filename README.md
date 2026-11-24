<p align="center">
  <img src="https://axii.dev/logos/axii-logo-bg-black.svg" height="220" alt="Axii" />
</p>

<p align="center">
  <a href="https://axii.dev">
    https://axii.dev
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/blob/main/README.md">
    English
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/blob/main/README-zh_CN.md">
    中文
  </a>
</p>

<p align="center">
  <img alt="Axii NPM Package Version" src="https://img.shields.io/npm/v/axii?style=flat-square">
  <img alt="Axii Test Coverage" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgithub.com%2Faxiijs%2Faxii%2Fraw%2Fmain%2Fcoverage-summary.json&query=%24.total.lines.pct&style=flat-square&label=coverage&color=%2340ba18">
</p>

# 🚀 Axii - An Incremental Reactive Frontend Framework

Axii /ˈæksɪ:/ is a brand-new frontend framework that relies on an "incremental update" reactive data structure to truly build a high-performance data logic layer. 🚀 The official infrastructure provided makes it convenient whether you are creating a component library or developing an application.

## ✨ Feature Overview

- **Simple Mental Model**
  - Uses React-style JSX, but functions execute only once, creating real DOM elements instead of Virtual DOM.
  - Binds updates to elements by recognizing reactive data structures. No special syntax, no framework-specific hooks, no compiler magic.

- **Superior Performance**
  - Precisely updates DOM nodes and attributes. Component functions never re-execute.
  - Reactive data automatically performs incremental computations, resulting in theoretically minimal changes. Significantly reduces computational overhead, especially during complex operations on arrays or collections.
  - Rich reactive structures like `RxList` / `RxMap` / `RxSet` / `RxTime` suitable for various scenarios.

- **Powerful Abstraction Tools**
  - Reactive wrappers for DOM position, size, scroll, and other states commonly used in complex interactions.
  - [Component AOP](https://axii.dev/playground/2-advanced/3-component_AOP) mechanism greatly reduces the workload of maintaining reusable components while providing extremely flexible capabilities.
  - Style-logic separation implemented through Component AOP can maintain logical integrity outside component function scope. Styles with logical capabilities can be quickly generated from design tools like Figma.

- **Infrastructure Ready for Large Applications**
  - Official [routing system](https://axii.dev/playground/3-common_util/1-router), [data request management system](https://axii.dev/playground/3-common_util/2-action), and even a full-featured [state machine system](https://axii.dev/playground/3-common_util/3-statemachine).
  - Official [headless component system](https://ui.axii.dev/list.html?theme=inc), and [interesting theme system](https://ui.axii.dev/forms?theme=fallout).


## 🛠 Installation

Use the following command to create a new project. It comes with sample code to help you get started quickly:

```bash
npx create-axii-app myapp
cd myapp
npm run dev
```

Upgrading from an earlier version? [CHANGELOG.md](./CHANGELOG.md) lists the behavior changes in each release and how to migrate.

## ⚡ Quick Start Example

Below is a simple example showing how to use reactive atomic data and bind it to a DOM property:

```jsx
/* @jsx createElement */
import { createRoot, atom } from 'axii'
function App({}, {createElement}) {
  const title = atom('Hello, Reactive World!')
  return (
    <div>
      <input
        value={title}
        onInput={(e) => title(e.target.value)}
      />
      <h1>{() => title()}</h1>
    </div>
  )
}

const root = document.getElementById('root')
createRoot(root).render(<App />)
```

Here, `title` is a mutable atomic data. Any assignment to `title` will automatically update the parts that depend on it, with no manual coordination required.

## 🍃 Reactive Collections Example

If you need frequent operations on lists or structures like Map/Set, you can also use the built-in `RxList`, `RxMap`, `RxSet`, which offer superior performance:

```jsx
/* @jsx createElement */
import { createRoot, RxList } from 'axii'

function ListApp({}, {createElement}) {
  const items = new RxList([ 'Apple', 'Banana', 'Cherry' ])
  function addItem() {
    items.push(`Random-${Math.random().toFixed(2)}`)
  }
  return (
    <div>
      <ul>
       {items.map(item => <li>{item}</li>)}
      </ul>
      <button onClick={addItem}>Add Random</button>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<ListApp />)
```

Whenever the `items` list changes, that change will be mapped to the DOM *incrementally* without triggering a complete re-render of the list. 🍀


## 📚 Learn More

Check out [https://axii.dev](https://axii.dev) for detailed documentation in both Chinese and English, covering:

1. Basic concepts: from using `atom` to `RxList`/`RxMap`/`RxSet` with examples  
2. Principles of reactivity and dynamic DOM rendering  
3. Component encapsulation, inter-component data passing, and the component AOP mechanism  
4. Side-effect and destruction logic (`useEffect`, `useLayoutEffect`, `ManualCleanup`, etc.)  
5. Server-side rendering: `renderToString` / `hydrateRoot`, Portal and lazy contracts  
6. How to effectively apply these features in real-world projects  

We provide progressively organized examples and explanations in the documentation, which we believe will help you better understand and utilize the unique ideas of this framework.

## 🌐 Server-Side Rendering (SSR)

axii can string-render on the server and activate the same DOM in the browser without a Virtual DOM pass.

| API | Package | Role |
|---|---|---|
| `renderToString(source)` | `axii/ssr` | Node-safe HTML serialization — **no DOM globals** |
| `hydrateRoot(container, source, options?)` | `axii` | Claim existing nodes; bind events and reactive hosts |

```jsx
/* @jsx createElement */
// server (Node)
import { createElement, atom } from 'axii'
import { renderToString } from 'axii/ssr'

function App() {
  const title = atom('Hello')
  return <h1>{title}</h1>
}

const { html, styles, portals } = renderToString(<App />)
// html ends with <!--root-->. Put `styles` in <style data-axii-ssr>.
// Write each portal's html and its own <style data-axii-ssr> into the matching container.
```

```jsx
/* @jsx createElement */
// browser
import { createElement, hydrateRoot, atom } from 'axii'

function App() {
  const title = atom('Hello')
  return <h1>{title}</h1>
}

const root = document.getElementById('root')
root.innerHTML = /* server html */
hydrateRoot(root, <App />)
// Matched nodes keep identity; later updates use the same paths as createRoot().render().
```

**Contracts (short):**

- Keep the component tree and reactive data **identical** between `renderToString` and `hydrateRoot`. axii does **not** dehydrate application state.
- **Portal** under SSR: use `container` as `string | { id }` (or `portalKey`). Content is in `portals[key]`; pass filled elements via `hydrateRoot(..., { portals })`.
- Later `style` array entries come later in stylesheet order. Within one entry index, sheets with direct declarations come first, followed by sheets with only nested rules. Each group uses a stable order based on the serialized CSS. The browser still applies CSS specificity and `!important`.
- **lazy**: the server always emits the fallback (or `null`) and does not await `load()`; the client starts loading after hydrate.
- Not in scope: streaming (`renderToStream`), app-state serialization.
- Design detail and host/marker contracts: `docs/ssr-support/`.

### How hydration claims nodes

`hydrateRoot` reads the server output back in the order `renderToString` wrote it. Each component, function child and list takes its own server nodes in document order, and then the marker that ends them. An element therefore never takes a node that belongs to another position, and hydration time grows linearly with the page. Matched nodes keep their identity. The markers in the server HTML are the same as before, so HTML from an older server can still be hydrated; where it differs from what the current client renders, the difference is handled like any other [mismatch](#mismatches).

### Hydration contract changes

While `hydrateRoot` runs, JSX in your components returns a **hydration description**, not a DOM node. The description never becomes a node, not even after hydration. axii claims the server node for a description when hydration reaches its position. Code that keeps a JSX result and uses it as a node has to reach the node through `ref`:

```jsx
/* @jsx createElement */
// Before: works with createRoot().render(), fails after hydrateRoot
function Search({}, { createElement }) {
  const input = <input />
  return <div>
    {input}
    <button onClick={() => input.focus()}>Search</button>
  </div>
}

// After: works with both
function Search({}, { createElement, createRef }) {
  const input = createRef()
  return <div>
    <input ref={input} />
    <button onClick={() => input.current.focus()}>Search</button>
  </div>
}
```

After `hydrateRoot`, the first version renders and the button responds, but `input.focus()` throws a `TypeError` when the button is clicked, which can be long after the page loaded. A `ref` receives the claimed node. Work that needs the node as soon as it is mounted belongs in the ref callback (`ref={el => …}`) or in `useLayoutEffect`.

A description used as a node fails the same way with diagnostics on or off; with diagnostics on, the access is reported first where it can be detected (see [Development checks](#development-checks-and-the-diagnostics-switch)):

| Use | Example | Result |
|---|---|---|
| Read a property | `input.value`, `el.textContent` | `undefined`; the error comes later, where the value is used |
| Write a property | `el.className = 'x'` | `TypeError` in strict-mode code (ES modules, TypeScript output) |
| Call a method | `input.focus()`, `el.addEventListener(…)` | `TypeError` |
| Pass it to a DOM API | `parent.appendChild(el)`, `observer.observe(el)` | `TypeError`, never reported in advance |
| Compare identity or type | `el === ref.current`, `el instanceof HTMLElement` | `false`, never reported |

What changes:

- **A JSX result used as a node** in the component body, an effect, an event handler or a timer, as in the example above. Use `ref`, and write attributes and listeners as JSX props.
- **Checking whether a JSX result is a node**, for example `child instanceof HTMLElement` on `children`. During hydration this is `false`, so the code takes a different branch than in a client render. Don't branch on the node type, or check `isHydrationElement(child)` as well (exported from `axii`).
- **Rows of `RxList.map` and items of plain arrays** are descriptions while hydration runs. When a row is claimed, `list.data[i]` (or `array[i]`) is replaced with the claimed node, so after hydration they hold the same nodes as after a client render. Only code that uses a row as a node inside the component body or the `map` callback needs the `ref` rewrite.
- **JSX created during hydration but rendered only after it**, such as `const panel = <div/>` shown only by `() => open() ? panel : null`, or the rows of a list that is shown only in a closed tab. It is created like in a client render when it is first rendered, and it works, but a small description object stays behind for each such element (one per row of such a list). To avoid that, create the JSX inside the function that renders it: `() => open() ? <div/> : null`.
- **A node created outside hydration and placed as a child** is inserted as in a client render, and the server node at its position is replaced instead of reused. Write the element as JSX to reuse the server node. This includes an element passed directly to `hydrateRoot`: in `hydrateRoot(root, <main>…</main>)` the JSX is evaluated before hydration starts. Pass a component instead, `hydrateRoot(root, <App />)`, as in the example above.
- **`$name:_use` overrides** accept an element or a description.

What stays the same:

- `createRoot().render()`.
- **JSX kept and rendered again** after it was claimed renders the claimed node, as rendering the same element again does in a client render.
- Portal content, and when `ref` callbacks, `useLayoutEffect` and `useEffect` run.
- **Code in your callbacks** — `ref` callbacks, `useLayoutEffect`, `useEffect`, `root.on(…)` listeners and `onError` — runs outside hydration even while `hydrateRoot` is running: JSX there returns real nodes, and `createRoot().render()` renders as usual.

### Mismatches

When the server HTML and the client render differ, for example because the data differs or the HTML comes from an older server, `hydrateRoot` reports each difference and repairs it where it finds it, then continues:

- After the repair, the node structure (node types, tags, namespaces and order), the text and the attributes that client props write are the same as in a client render. Nodes at matching positions keep their identity. A container whose trailing `<!--root-->` is missing is repaired the same way.
- Attributes that only the server wrote are removed from an element claimed on a repair path. An element claimed without a difference keeps them; this can happen when a difference shows up only later in the same parent. With diagnostics on, such leftovers are reported as `AXII_HYDRATION_ATTRIBUTE_RESIDUE`.
- Each report is an error with `code: 'AXII_HYDRATION_MISMATCH'` (`name` `HydrationMismatchError`) and `expected` / `actual` strings. It goes to `configureDiagnostics({ onError })` whether diagnostics are on or off, and to `console.error`.
- Mismatches are repaired, not thrown. `hydrateRoot` still throws when a Portal container cannot be found, and when an error is thrown while a function child's content is hydrated: that error stops hydration and is thrown from `hydrateRoot`, even if a `root.on('error')` listener is registered.

### Development checks and the diagnostics switch

Diagnostics are off by default in the published package. Turn them on in development before calling `hydrateRoot`; whether hydration checks descriptions is decided when it starts:

```js
import { configureDiagnostics } from 'axii'

// configureDiagnostics replaces the whole configuration: pass onError in the same call.
configureDiagnostics({
  enabled: process.env.NODE_ENV !== 'production', // or your bundler's development flag
  onError: (error) => reportToMonitoring(error),  // optional; called with diagnostics on or off
})
```

With diagnostics on, each description is wrapped in a `Proxy` that reports node-style accesses, and the checks below run. Each report is an error with a `code`, passed to `onError` and to `console.error`; none of them changes the DOM.

| `code` | Reported when |
|---|---|
| `AXII_HYDRATION_ELEMENT_ACCESS` | A description is read or written as a node (calling a method reads it first). The message names the property and, with a development JSX transform (`jsxDEV`), the file, line and column of the JSX. The same access at the same JSX position is reported once. |
| `AXII_HYDRATION_ELEMENT_LATE_RENDER` | JSX created during hydration is rendered for the first time after it. |
| `AXII_HYDRATION_LIVE_NODE` | A node created outside hydration replaced the server node at its position. |
| `AXII_HYDRATION_ATTRIBUTE_RESIDUE` | An element claimed without a difference has attributes that only the server wrote. |
| `AXII_HYDRATION_INVARIANT` | After hydration, the nodes of a component, function child or list are no longer one connected range in the document, or a hydration marker is left behind. Unmodified server output does not cause it unless the same element is rendered twice. |

The checks have limits. Passing a description to a DOM API and comparing identity or type cannot be detected. A line that runs only on a user action, such as a click handler, is reported only when it runs, so go through those interactions in development as well. With diagnostics off, none of these checks run, descriptions are plain objects, and the failures are the ones in the table above.

### Design notes / limitations

- **Event handlers are bound once and are not reactive.** An `on*` prop is attached with `addEventListener` when the element is created; passing an atom or a function-returning-handler will not make the binding itself reactive. If you need conditional behavior, write the condition *inside* the handler (e.g. `onClick={(e) => enabled() && doSomething(e)}`) instead of trying to swap the handler dynamically.
- **Only `on` + an uppercase letter with a function value is an event handler.** Any other prop whose name starts with `on` in any letter case (`onclick`, `ONCLICK`, `oNclick`, `once`, `online`) is not written to the element on the client or in `renderToString` output. This follows React's rule for unknown `on*` props and applies to every element, including SVG and custom elements. Attribute names are case-insensitive, so writing such a name could create an executable inline handler, for example when spreading an untrusted object (`<div {...untrusted}/>`). With diagnostics on (see [Development checks](#development-checks-and-the-diagnostics-switch)), axii logs one warning per prop name. A bare `on` attribute, such as AMP's `on="tap:…"`, is still written.
- **`<a>`, `<title>`, `<style>` and `<script>` inside `<svg>`.** These tag names exist in both HTML and SVG. Written directly in an SVG element's JSX (not inside `<foreignObject>`, `<desc>` or `<title>`), they are SVG elements, the same way the HTML parser treats server output: the SVG parent re-creates them in the SVG namespace when it is created. A reference to such a child taken before its parent is created (`const t = <title/>; <svg>{t}</svg>`) points to the discarded HTML element, and listeners added to it directly are not carried over; use `ref`. Rendered later by a function child, a component or a list, they stay HTML elements; use `createSVGElement` there.

#### Style arrays

`style` can be an array of entries (objects, strings, functions, atoms), and later entries are meant to win. Plain entries are written as inline styles. An entry that needs a stylesheet (nested selectors such as `'&:hover'`, at-rules, `animation` / `@keyframes`, or a `bindProps` style) gets a generated class and takes its own top-level properties back from the inline values that earlier entries wrote. Later plain entries are written inline again.

- **A nested rule in a later entry does not beat an inline value from an earlier entry.** In `style={[{color: 'red'}, {'&:hover': {color: 'blue'}}]}` the hover color never applies. Inline declarations always win over stylesheet rules, and axii keeps plain entries inline on purpose: moving them into stylesheets would create one stylesheet per distinct value (per list row, per animation frame) and would let your app's CSS override them. Write it one of these ways instead. In each of them the base value is part of a stylesheet rule, so your app's CSS can override it like any other stylesheet entry:
  - Put the base value in the same entry as the nested rule: `style={{color: 'red', '&:hover': {color: 'blue'}}}`.
  - When you override a component's inner style from outside (`$name:style`, `bindProps`), repeat the base property at the top level of your entry: `{color: 'red', '&:hover': {color: 'blue'}}`. Its top-level `color` takes the inner inline value back.
  - When the base value differs per row or changes every frame, keep it inline as a custom property and use it from the stylesheet entry. All rows then share one stylesheet: `style={[{'--c': color}, {color: 'var(--c)', '&:hover': {color: 'blue'}}]}`.
- **Selector lists in nested keys are expanded selector by selector.** `{'&.a, &.b': {'& span': {…}}}` becomes `.x.a span, .x.b span`, and each selector keeps its own specificity. Native CSS nesting wraps the parent list in `:is()`, which gives every selector the highest specificity in the list. The same elements match; if a competing rule wins, make the nested selector more specific yourself.
- **Stylesheet rules and `renderToString` inline styles keep a value only if the browser reads it as exactly one declaration.** There the value is written into CSS text, so axii drops the declaration when the browser would read it as more than one declaration or as a nested rule: a top-level `;` or `!important`, a malformed unquoted `url(…)` such as `url(a(b)`, an unescaped line break inside a quoted string, or a top-level `{}` block in anything but a custom property. A client-side inline style rejects the same values.
- **An unclosed bracket works only in a client-side inline style.** The browser closes a bracket left open at the end of an inline value, so `backgroundImage: 'url(a.png'` works as a plain inline style. In a stylesheet rule and in `renderToString` inline styles that declaration is dropped. Close brackets yourself.
- **A string entry sets only the properties it declares.** In `style={[{color: 'blue', paddingTop: 1}, 'margin-top: 3px']}` the element keeps `color` and `padding-top` and gets `margin-top`. Later entries win property by property, whether they are strings or objects, the same as on the server. When a reactive string entry changes, the properties it no longer declares are removed; properties written by other entries stay. Inside one string the browser's rules apply: a later normal declaration does not replace an earlier `!important` one in the same string. Across entries the later entry wins, including over an `!important` declaration in an earlier string entry. A string `detachStyle` also leaves the other inline properties alone. (Earlier versions replaced the whole inline style on the client, so the earlier entries' properties disappeared after hydration.)
- **Custom property values follow the same rules as other values.** `{'--gap': [4, 8]}` is written as `4 8` and `{'--t': [300, 'ms']}` as `300ms` on the client and by `renderToString` (the client used to write `4,8` and `300,ms`). Numbers get no unit.
- **`renderToString` and string entries.** The server splits a string entry into declarations, using the same splitter as the client, so later entries can take properties back from it as they do on the client. A string the server cannot split reliably (escapes, braces, a comment before a property name, unterminated quotes or comments, malformed `url(…)`) is written as is, and `hydrateRoot` rewrites the inline style. The client then applies it as the browser parses it on top of the existing inline style. Until hydration, an unterminated quote, comment or `url(` in such a string also swallows the declarations of later entries, and a later longhand entry does not take its part out of an `!important` shorthand in an earlier string (`['margin: 1px !important', {marginTop: 5}]`).

## 🤝 Contributing

We welcome you to submit [Issues](https://github.com/axiijs/axii/issues) or [Pull Requests](https://github.com/axiijs/axii/pulls) on GitHub to help polish this new incremental reactive frontend framework. Your ideas and suggestions are extremely important to us!

## 📄 License

This project is licensed under the [MIT License](./LICENSE). You are free to fork and develop upon it, and we look forward to your creative input and feedback!
