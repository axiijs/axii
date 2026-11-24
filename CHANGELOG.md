# Changelog

Notable changes to axii, newest release first. Each entry starts with one sentence on what changes for your code and how to migrate; the nested points under it give details and examples. Numbers in parentheses are pull requests in [axiijs/axii](https://github.com/axiijs/axii/pulls) unless marked as an issue. Releases before 4.9.0 are not recorded here.

## 4.9.0 (unreleased)

4.9.0 is the result of a full audit of axii. Most entries are bug fixes, but many of them change what your pages render, so read **Breaking changes**, **Security** and **Dependencies** before upgrading. If you use server-side rendering, upgrade the server (`axii/ssr`) and the client (`axii`) together: `renderToString` output changed in several places. `hydrateRoot` still hydrates HTML from an older server: where its structure differs from the client render, each difference is reported as a mismatch and repaired (see the first entry under Breaking changes).

### Breaking changes

Code that relies on the old behavior needs changes.

- **`hydrateRoot` claims server nodes top-down, in the order the server wrote them, and is no longer experimental; while it runs, JSX returns a hydration description instead of a DOM node.** Migration: reach elements through `ref` (in the ref callback or in `useLayoutEffect`) instead of keeping JSX results and using them as nodes; "Hydration contract changes" in the README lists every affected pattern. (issue #55; #67, #75, #80, #84, #89, #93, #95, #96, #97)
  - Each component, function child and list takes its own server nodes in document order, so an element never takes a node from another position, and hydration time grows linearly with the page. The markers in the server HTML are unchanged.
  - A description never becomes a node, not even after hydration: after `const input = <input/>`, calling `input.focus()` in a click handler throws a `TypeError`, `input.value` is `undefined` and `input === ref.current` is `false`.
  - `RxList.map` rows and array items hold the claimed nodes once hydration is done. JSX created during hydration and first rendered after it is created like in a client render. A node created outside hydration, including an element passed directly to `hydrateRoot` (`hydrateRoot(root, <main/>)`), replaces the server node at its position instead of reusing it; pass a component (`<App/>`).
  - Code in `ref` callbacks, `useLayoutEffect`, `useEffect`, `root.on()` listeners and `onError` runs outside hydration, so JSX there returns real nodes. `createRoot().render()` is unchanged.
  - When server and client output differ, each difference is reported and repaired instead of thrown, including a container without `<!--root-->`: node structure, text and the attributes written by client props end up equal to a client render. Reports have `code: 'AXII_HYDRATION_MISMATCH'` and go to `configureDiagnostics({onError})` and `console.error` whether diagnostics are on or off. Attributes that only the server wrote are removed on the repair path and stay on an element claimed without a difference. `hydrateRoot` still throws when a Portal container is missing or when an error is thrown while a function child's content is hydrated.
  - With diagnostics on (`configureDiagnostics({enabled: true})` before `hydrateRoot`; the published build has them off by default), reading or writing a description is reported with its JSX location when the JSX transform provides it (`AXII_HYDRATION_ELEMENT_ACCESS`), and so are JSX first rendered after hydration (`AXII_HYDRATION_ELEMENT_LATE_RENDER`), server nodes replaced by nodes created outside hydration (`AXII_HYDRATION_LIVE_NODE`), server-only attributes left on a cleanly claimed element (`AXII_HYDRATION_ATTRIBUTE_RESIDUE`) and broken consistency checks after hydration (`AXII_HYDRATION_INVARIANT`).
  - New export: `isHydrationElement(value)` tells a description from other values. Removed: `materializeHydrateDeferred`, `ensureHydrateDeferredPortalContent` and `rematerializeDeferredFragmentChildren`, internal hydration functions that 4.8.1 exposed through the package entry.
  - This replaces the interim claiming rules and the "experimental" label added during 4.9.0 development (#62).
- **`root.destroy()` keeps the listeners registered with `root.on()`, so they still fire after the same root renders again.** Migration: code that registers a listener again after `destroy()` now has it twice, so drop the re-registration or pass the same function reference; to remove a listener, call the function that `on()` returns. (#63)
  - This covers `error`, `attach`, `detach` and custom events.
- **Errors thrown after a tree was destroyed are reported through `configureDiagnostics({onError})` and the console instead of being thrown from `root.render()` or dropped.** Migration: if you caught these errors around `root.render()`, observe them with `configureDiagnostics({onError})`. (#69)
  - This covers a tree discarded in the middle of rendering, a function child or list destroyed while it rendered, and the cleanups of such a tree; one failing cleanup no longer stops the others.
  - Errors from a discarded tree inside a `Portal` no longer reach the parent root's `error` listeners.
- **On a checkbox, the `checked` prop alone decides whether it is checked, and `value` is the submitted value.** Migration: express the checked state with `checked` and put only the submitted value in `value`; a wrapper component that forwards `checked` can no longer be checked with `value={true}`. (#48, #66)
  - `<input type="checkbox" value="red">` is no longer checked by default.
  - A `null` or `undefined` `value` no longer unchecks the box, on the first render or later.
  - Once the element has a `checked` prop (even `checked={undefined}`), only that prop decides, whatever the prop order: `checked={false} value={true}` and `checked={undefined} value={true}` are now unchecked.
  - A boolean `value` still sets the checked state when there is no `checked` prop.
- **A string entry in a `style` array sets only the properties it declares instead of replacing the whole inline style on the client.** Migration: if you relied on a string entry clearing earlier entries, remove those properties from the earlier entries or add a later object entry that sets them to `null`. (#92)
  - In `style={[{color: 'blue'}, 'margin-top: 3px']}` the client keeps `color`, as `renderToString` already did.
  - A string `detachStyle` and `setAttribute(el, 'style', text)` behave the same way.
- **`<a>`, `<title>`, `<style>` and `<script>` written directly in an SVG element's JSX are SVG elements.** Migration: a reference to such a child taken before its parent was created points to the discarded HTML element, so use `ref`; a single such tag rendered later by a function child, a component or a list stays an HTML element, so create it with `createSVGElement`. (#72)
  - The SVG parent re-creates these children in the SVG namespace when it is created, which matches how the browser parses the server HTML. `<foreignObject>`, `<desc>` and `<title>` parents keep them as HTML elements.
- **Props whose name starts with `on` are written only as event handlers.** Migration: see the first entry under Security. (#64)
- **axii requires data0 `^2.17.0`.** Migration: see Dependencies. (#90)

### Security

- **A prop whose name starts with `on`, in any letter case, is never written as an attribute, so spreading an untrusted object can no longer create an executable inline handler.** Migration: write events as `onClick={fn}` and data as `data-*` attributes; component props are not affected. (#64)
  - Only `on` followed by an uppercase letter (`onClick`) binds a listener. Every other such name (`onclick`, `ONCLICK`, `once`, `online`, `onlyIcon`, `on-click`, SVG `xlink:onclick`) is dropped on every element, including SVG and custom elements, both on the client and by `renderToString`.
  - Development builds warn once per dropped name.
  - A bare `on` attribute (AMP's `on="tap:…"`) is now written by the server too.
  - A name with invalid characters such as `"ON x"` is dropped instead of throwing `InvalidCharacterError` on the client.
- **Hydration builds a re-created element completely before inserting it, so a data script such as `<script type="application/json">` is no longer run as JavaScript.** No migration needed. (#76, #89, #96)
  - This applies when hydration replaces a server element that does not match: the new element gets its children and attributes, including reactive ones such as `type={atom}`, while it is still detached.
  - `src`, `integrity`, `is` and `<select multiple>` on such an element behave as in a client render.
- **Stylesheet rules and `renderToString` keep a style value only if the browser reads it as exactly one declaration, the same values a client-side inline style accepts.** No migration needed. (#48, #81)
  - These paths write values into CSS text, so a value that could add declarations or rules is dropped: a top-level `;` or `!important`, unbalanced brackets or quotes, a malformed unquoted `url(…)`, a line break (`\n`, `\r`, `\f`) inside a string, a top-level `{}` block outside a custom property, or `url(` after `<!--`.
  - To stay on the safe side, names with a non-ASCII character directly before `url(` and values nested more than 1024 levels deep are dropped too, and the server does not write an at-rule key whose prelude contains a top-level `;`.
  - Valid values that used to be dropped, such as `url(a}b.png)` or a `}` inside a comment or an escape, now work.
- **`renderToString` throws on markup it cannot write safely and escapes `<style>` and `<script>` text inside `<svg>` and `<math>`.** Migration: validate untrusted prop keys and tag names before rendering them. (#48)
  - It throws on attribute names and tag names the DOM would reject (an untrusted key such as `x onmouseover=…` in a spread, a dynamic tag name), on `<script>` text that cannot be serialized safely, and on `<plaintext>` in HTML content.
  - `<style>` and `<script>` text inside `<svg>` or `<math>` is escaped as ordinary text, so it can no longer turn into real elements when the browser parses the page.

### Behavior changes

These need no code changes in most apps, but what is rendered differs. Tests that compare DOM or server HTML strings may need updates.

#### Roots, effects and lifecycle

- **`root.render()` and `root.destroy()` no longer belong to the effect that calls them: a root's content lives until `root.destroy()`.** No migration needed; if the effect should re-run on an atom read by the content, read it in the effect itself. (#47)
  - Inside an `autorun` or `computed`, atoms read while the root's content renders or is torn down (component bodies, `useEffect` callbacks and cleanups, `ref(null)`) no longer subscribe that effect, so a "destroy, then render" `autorun` no longer re-runs when they change.
  - Bindings and effects created while rendering or tearing down the content are no longer destroyed when that effect re-runs.
- **A function child no longer tracks the teardown of its old content, which removes endless remount loops.** No migration needed. (#47)
  - Atoms read in cleanups (`useEffect` and `useLayoutEffect` cleanups, `onCleanup`, `ref(null)`, a function `detachStyle`) no longer re-run the function child. Before, new content that wrote an atom read by the old content's cleanup remounted forever.
  - Effects created in those cleanups survive the next re-run.
- **`root.dispatch()` runs its listeners untracked, so reads in listeners no longer subscribe the effect that dispatched.** No migration needed. (#47, #48)
  - This covers `attach`, `detach`, `error` and custom listeners.
  - Effects created in listeners, including the layout effects and refs run on `attach`, are no longer collected by that effect; `error` listeners also run detached from the failing binding.
- **List row cleanups run while the row is still in the document, and a replaced row is torn down before its replacement is mounted.** No migration needed. (#48)
  - This applies to `splice`, `pop`, `shift`, `clear` and `set`.
  - A ref shared by the old and the new row ends up on the new row.
- **A root rendered in a component body and `Portal` content with `destroyOnUnmount={false}` stay fully live until their own root is destroyed.** No migration needed. (#48)
  - Before, their attribute bindings and lists stopped updating when the component unmounted, while their text kept updating.
- **Calling `root.destroy()` again during destruction dispatches `detach` once and no longer overflows the stack.** No migration needed. (#48, #69)
  - This covers calls from a cleanup and from a `detach` listener; rendering into the same root from such a cleanup works.
- **Nodes from another realm (a same-origin iframe) and any `Element` are accepted as rendered content.** No migration needed. (#69)
  - Such a node can be a component's return value, a function child's value, an array item, a JSX child or a list row.
  - Any `Element` (MathML, for example) is accepted where only HTML and SVG elements were.
  - A plain object such as `{nodeType: 3}` used as a child now throws a `TypeError` instead of `unknown child type`.
- **A controlled `<select>` whose selected `<option>` is removed shows what a fresh render shows, no selection when nothing matches.** No migration needed. (#48, #69)
  - This also holds when the option leaves with an exit animation.

#### DOM attributes and forms

- **On string-typed properties of built-in elements, `false` is no longer written as the string `"false"`, and `true` writes an empty attribute.** Migration: pass the string `"false"` where an attribute must literally read `false`. (#48)
  - `title={false}` and `href={cond && '/x'}` write nothing.
  - `<div popover>` is an auto popover, and `<a download>` no longer names the file `true`.
  - `draggable="false"` and `translate="no"` are no longer turned into `true`.
  - `aria-*` and `data-*` attributes still write `"false"`.
- **camelCase SVG attributes such as `fillRule` and `stopColor` take effect.** No migration needed, but check graphics whose previously ignored attributes now apply. (#48)
  - A camelCase name whose dashed form is an SVG presentation attribute (`fillRule`, `clipRule`, `stopColor`, `textAnchor` and so on) is written dashed and can be removed again. Before, only nine prefixes were converted and the rest were silently ignored.
  - Native camelCase attributes such as `viewBox` stay as they are.
- **`data-*` attributes keep the name you wrote, static or reactive, and arrays are written whole.** Migration: update selectors and test ids that matched the old names. (#48)
  - A reactive `data-item_id` is no longer written as `data-item-id`, and a reactive `data-fooBar` is written like the static one (`data-foobar`, since HTML attribute names are lowercase).
  - A static `data-ids={[1, 2]}` is written as `"1,2"` instead of only its last item.
- **`dangerouslySetInnerHTML={{__html: string}}` works on the client instead of rendering `[object Object]`.** No migration needed. (#65)
  - A function or atom returning `{__html}` works too, and hydration keeps the server markup.
- **`PropTypes.number.parse` throws on input that is not a number, such as `'abc1'` or `'1px'`, instead of returning `NaN`.** Migration: where you tested the result for `NaN`, catch the error instead. (#48)

#### Styles

- **In a `style` array, an entry that needs a stylesheet takes back the top-level properties it declares from earlier inline values, so later entries win.** No migration needed; "Style arrays" in the README shows patterns for the known limitation below. (#48, #77)
  - Such entries have nested selectors, at-rules, `animation` or `@keyframes`, or come from `bindProps`. `[{color: 'blue'}, {color: 'red', '&:hover': {…}}]` is red.
  - On the server this also removes declarations from earlier string entries.
  - Known limitation: an earlier inline value still beats a nested rule in a later entry (`[{color: 'red'}, {'&:hover': {color: 'blue'}}]` never turns blue).
- **`setAutoUnitType` also applies to stylesheet rules and to `renderToString`, which always used `px` before.** Migration: if you call `setAutoUnitType('rem')` or `setAutoUnitType('em')` and relied on `px` in nested rules, write the unit explicitly. (#48)
- **136 standard length properties get an automatic unit instead of 36, so numbers on properties such as `borderTopLeftRadius` or `gridTemplateColumns` now take effect.** No migration needed. (#91)
  - Examples: `borderTopLeftRadius`, `outlineOffset`, `inset*`, `scrollMargin*`, `translate`, `gridTemplateColumns`, `verticalAlign`. A number there used to be written without a unit and dropped by the browser; it now gets the unit in inline styles, stylesheet rules and server output alike.
  - `0` is written as `0px`: the computed value is the same, but server style text and content-addressed style ids change.
  - The exported `AUTO_ADD_UNIT_ATTR` matches the same names.
  - On these properties a non-`StyleSize` object no longer gets a unit appended (`"2rem"`, not `"2rempx"`), `new Number(5)` writes `"5"`, and stylesheet rules and server output add the unit to a `bigint`.
  - A `Symbol` value in an inline style no longer throws.
- **Array values are joined the same way on every path: `[300, 'ms']` is `300ms`, and custom properties follow the same rules.** No migration needed. (#48, #92)
  - `[300, 'ms']` used to be written as `300,ms`.
  - On the client and the server, `{'--gap': [4, 8]}` is `4 8` and `{'--t': [300, 'ms']}` is `300ms` (the client wrote `4,8` and `300,ms`); numbers on custom properties get no unit.
- **Stylesheet rules and server output name properties the way inline styles do, and drop a declaration whose bracket is left open.** No migration needed; close brackets yourself. (#48)
  - `cssFloat` and lowercase vendor prefixes such as `webkitLineClamp` now work there.
  - A bracket left open at the end of a value (`'url(a.png'`) still works in a client-side inline style, which closes it automatically.

#### Server rendering (`renderToString`)

- **Components go through the same props pipeline as on the client, so server HTML matches the client.** No migration needed. (#48)
  - propTypes defaults, `bindProps`, `as` and `$name:` overrides now apply on the server.
  - Attribute values are evaluated as on the client: reactive attribute functions are called, `checked={atom(false)}` no longer writes `checked`, and a `className` array writes its class names.
- **Attributes are written the way the client leaves them.** No migration needed; update tests that compare server HTML strings. (#70)
  - A real boolean attribute set to `true` is written `x=""` (was `x="true"`), and a numeric property set to `true` writes `"1"` (`tabIndex`).
  - `0` and `""` on a boolean property are omitted, and any truthy `disabled` value is written as `"true"`.
  - `defaultValue`, `defaultChecked`, `defaultSelected` and `defaultMuted` are written as `value`, `checked`, `selected` and `muted`; a `<textarea>`'s `defaultValue` is written as its text.
  - Global properties on custom elements are written as given (`title={false}` becomes `title="false"`), `<div htmlFor>` keeps its name, and `nonce={true}` is `"true"` (was `""`).
  - On the client, clearing `ch`, `chOff` or `encoding` no longer leaves `char`, `charoff` or `enctype` behind.
- **A function child of `<textarea>`, `<title>`, `<style>` or `<script>` writes its current text, and throws only when it returns structure.** No migration needed. (#48, #72)
  - `<title>Inbox ({count})</title>` now renders on the server; a function returning elements there throws `a function child of <tag> must return text`.
- **`<table>` gets an implied `<tbody>` only when its direct children include a bare `<tr>` and no section element.** No migration needed. (#72)
  - A function, list or array that renders `<tbody>` or `<thead>` no longer leaves an empty `<tbody>`.
  - Inside SVG, the attributes of `<a>`, `<title>`, `<style>` and `<script>` are written with SVG rules.
- **A list row whose descendant has `detachStyle` is followed by `<!--rx list item-->`, as on the client, so such pages hydrate instead of throwing.** No migration needed. (#71)
- **Function children whose value is a function, an `RxList` or a `reusable` are written in the client's shape, so they hydrate without leftover nodes or errors.** No migration needed. (#83)
  - The extra `<!--axii:0-->` or `<!--unhandledChild-->` is gone, and an empty atom in an array writes no `<!--axii:0-->`.
  - A function child returning an unsupported value now throws `unsupported render source` instead of `unsupported child type`.
- **Holes in sparse arrays (`[a, , b]`) are skipped as on the client.** Migration: upgrade server and client together; HTML from an older server, which writes extra markup at each hole, is reported as a hydration mismatch and repaired. (#87)
  - Explicit `undefined` and `null` items still render as empty.
  - On the client, an array whose first slot is a hole is now removed, replaced or moved as a whole; its content used to stay behind.
- **`{__html: null}` and `{__html: undefined}` in `dangerouslySetInnerHTML` write empty content instead of the text `null` or `undefined`.** No migration needed. (#65)
- **When a later `style` entry overrides an `!important` declaration in an earlier string entry, the server no longer writes that `!important` declaration.** No migration needed. (#92)

### Fixes

No migration needed.

- `lazy()` components are transparent: `ref` receives the loaded component and `$name:` configuration reaches it. (#48)
- A component or function child may return a `Comment` or `Text` node; it used to throw `unknown child type`. (#48)
- Nested arrays in `style`, `className` and event handler props are flattened; they used to throw or write indexes such as `class="card 0 2"`. (#48)
- `onGotPointerCapture` and `onLostPointerCapture` fire. (#48)
- A nested rule under a selector list applies to every selector in the list (`'&.a, &.b': {'& span': {…}}`). (#48)
- The `animation` shorthand no longer resets `animation-*` longhands written after it, and a `null` item in an `animation` array no longer voids the whole declaration. (#48)
- `null`, `false` and `undefined` clear object-typed properties such as `srcObject` and `valueAsDate`, and `relList={null}` no longer leaves `rel=""`. (#48)
- A prop with a propTypes default is no longer overwritten by a bound prop that evaluates to `undefined`. (#48)
- `PropTypes.atom`, `rxList`, `rxSet` and `rxMap` have `check` (alone they rejected every value, and inside `oneOfType` they threw), and `PropTypes.map({...}).check(null)` no longer throws. (#48)
- `Form`: when one of several fields with the same name unmounts, or a list row is replaced, the value of the field that is still mounted is kept. (#48)
- `RxDOMDragState`: a plain click no longer dispatches `dragend`; a drag interrupted by unmounting or destroying gets exactly one `dragend` carrying the last state and leaves no listeners behind. (#48)
- `RxDOMFocused` updates again after its element is remounted, and `RxDOMSize` on a non-replaced inline element reports 0 consistently instead of a measured size that later drops to 0 (development builds suggest giving the element a box). (#48)
- A `splice` that inserts more than about 100,000 rows no longer throws `RangeError`. (#48)
- Content that a function child, a list or a root was still rendering when it got destroyed no longer leaks or ends up in the container. (#48)
- A function child whose old content's cleanup destroys it no longer renders again or throws an uncaught `TypeError`, and a row cleanup that destroys its list runs each row's cleanup exactly once. (#48)

### Performance

No migration needed.

- Mounting and clearing many rows with different nested styles is no longer quadratic: stylesheet writes from the same synchronous work are merged (4,000 rows: mount 1,606 ms → 45 ms, clear 1,579 ms → 3.7 ms). (#48)
- Swapping two rows of a list costs in proportion to the rows that move, not to the span between them (200,000 rows, swapping first and last: 6.2 ms → 0.0015 ms). (#48)

### Dependencies

- **axii requires data0 `^2.17.0` (the peer dependency was `^2.16.0`), and because axii re-exports data0, its 2.17.0 fixes are visible through axii.** Migration: install data0 `^2.17.0`, and adjust code that relied on the old behavior below, for example code that assumes the `onCleanup` option of `RxList.map` runs only when a row is removed. (#90)
  - Reads in cleanup code no longer create dependencies.
  - An error in a cleanup no longer stops destruction: the first error is thrown, later ones go to `console.error`.
  - A `computed` whose recomputation failed keeps the dependencies of the failed run, so it retries when they change.
  - The `onCleanup` option of `RxList.map` also runs when a row's value is recomputed and replaced.
  - `RxMap.values()` and `entries()` no longer emit `undefined` for a deleted key first.
  - `sortSelf` puts `undefined` last.

### Internal

- Refactors and performance work without visible behavior changes: (#74), (#75), (#86).
