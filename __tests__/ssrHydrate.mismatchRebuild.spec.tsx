/** @jsx createElement */
/**
 * #73: an element rebuilt on a hydration mismatch must be finished while detached — props and children
 * applied — and only then inserted, the same order as CSR (createElement returns a finished detached
 * element, the Host inserts it). Elements whose insertion has a one-time effect read their attributes at
 * that moment: a connected <script> runs as soon as it gets text or a src, as whatever `type` it has
 * by then; a connected <link rel=stylesheet> fetches as soon as it has rel + href, with whatever
 * `integrity` it has by then. Inserting first and applying props afterwards ran
 * `<script type="application/json">` content as JavaScript.
 *
 * Black-box (model-independent): the server HTML is parsed, the element under test is swapped for a
 * different tag so that hydration reports a mismatch and rebuilds it; the observable effect and the
 * DOM must equal a CSR root of the same tree.
 * Run: npx vitest run __tests__/ssrHydrate.mismatchRebuild.spec.tsx
 */
import {createElement, createRoot, RenderContext} from '@framework'
import {atom} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {HydrationMismatchError} from '../src/hydration.js'
import {hydrate, configureDiagnostics} from './helpers/hydrate'

type ProbeWindow = Window & {__axiiI73Probe?: string[]}
const probeWindow = window as ProbeWindow
// Script bodies only push a tag onto this array; nothing else runs if a script executes.
const run = (tag: string) => `window.__axiiI73Probe.push(${JSON.stringify(tag)})`
const probe = () => probeWindow.__axiiI73Probe!

let errors: unknown[]
beforeEach(() => {
    document.body.innerHTML = ''
    probeWindow.__axiiI73Probe = []
    errors = []
    configureDiagnostics({enabled: true, onError: (e: unknown) => { errors.push(e) }})
})
afterEach(() => {
    configureDiagnostics({})
    document.body.innerHTML = ''
})

/** DOM shape: elements with sorted attributes, text, structure comments; transient axii:* markers dropped. */
function shape(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === '' ? '' : JSON.stringify(node.nodeValue)
    if (node.nodeType === Node.COMMENT_NODE) {
        const d = (node as Comment).data
        return (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') ? '' : `<!--${d}-->`
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const ns = el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg:' : ''
    const attrs = Array.from(el.attributes).map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
    let kids = ''
    el.childNodes.forEach(c => { kids += shape(c) })
    return `<${ns}${el.localName}${attrs ? ' ' + attrs : ''}>${kids}</${ns}${el.localName}>`
}
function contentShape(container: Element): string {
    let s = ''
    container.childNodes.forEach(c => { s += shape(c) })
    return s
}

function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}

/**
 * Server-render `App`, parse it into a fresh container, then replace every element matched by
 * `selector` with an empty `<template>` (a different tag at the same position), so that hydration
 * reports a mismatch there and rebuilds the client element. Parsing through innerHTML marks the
 * server's own <script> elements as already started, so only rebuilt scripts can ever run.
 */
function serverHtmlWithSwapped(App: any, selector: string): HTMLElement {
    const {html} = renderToString(createElement(App, null as any))
    const container = mount()
    container.innerHTML = html
    const targets = container.querySelectorAll(selector)
    expect(targets.length, `selector ${selector} must match the server HTML`).toBeGreaterThan(0)
    targets.forEach(t => t.replaceWith(document.createElement('template')))
    return container
}

function csrShape(App: any): string {
    const container = mount()
    const root = createRoot(container)
    root.render(createElement(App, null as any))
    const s = contentShape(container)
    root.destroy()
    container.remove()
    return s
}

const reportedMismatch = () => errors.some(e => e instanceof HydrationMismatchError)

/** Resolves after a classic external script inserted now has run (external scripts run in a later task). */
function afterExternalScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = `data:text/javascript,${encodeURIComponent(run('control'))}`
        s.onload = () => { s.remove(); resolve() }
        s.onerror = () => reject(new Error('control script failed to load'))
        document.head.appendChild(s)
    })
}

function loadOutcome(el: HTMLLinkElement | HTMLScriptElement): Promise<'load' | 'error'> {
    return new Promise(resolve => {
        el.addEventListener('load', () => resolve('load'), {once: true})
        el.addEventListener('error', () => resolve('error'), {once: true})
    })
}

describe('#73 elements rebuilt on a hydration mismatch are finished before they are inserted', () => {
    test('inline data scripts (application/json, text/plain, text/template) do not run; DOM ≡ CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <script type="application/json">{run('json')}</script>
                    <script type="text/plain">{run('plain')}</script>
                    <script type="text/template">{run('template')}</script>
                    <span>after</span>
                </div>
            )
        }
        const expected = csrShape(App)
        expect(probe(), 'CSR does not run data scripts').toEqual([])

        const container = serverHtmlWithSwapped(App, 'script')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(probe()).toEqual([])
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('a data script nested in a rebuilt parent does not run; DOM ≡ CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <section><script type="application/json">{run('nested')}</script></section>
                    <span>after</span>
                </div>
            )
        }
        const expected = csrShape(App)
        expect(probe()).toEqual([])

        // The whole <section> (and its <script>) is swapped, so both are rebuilt: the script inside the section.
        const container = serverHtmlWithSwapped(App, 'section')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(probe()).toEqual([])
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('an external script with a non-JavaScript type (src written before type) is not fetched or run', async () => {
        const src = `data:text/javascript,${encodeURIComponent(run('src'))}`
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <script src={src} type="text/plain"></script>
                    <span>after</span>
                </div>
            )
        }
        const expected = csrShape(App)
        await afterExternalScripts()
        expect(probe(), 'CSR does not fetch or run it').toEqual(['control'])
        probeWindow.__axiiI73Probe = []

        const container = serverHtmlWithSwapped(App, 'script')
        const root = hydrate(container, createElement(App, null as any))
        const rebuilt = container.querySelector('script')!
        let settled = false
        rebuilt.addEventListener('load', () => { settled = true })
        rebuilt.addEventListener('error', () => { settled = true })
        await afterExternalScripts()

        expect(reportedMismatch()).toBe(true)
        expect(probe()).toEqual(['control'])
        expect(settled, 'a script that is never fetched fires neither load nor error').toBe(false)
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('a plain <script> (no type) behaves as in CSR: the rebuilt one runs exactly once', () => {
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <script>{run('js')}</script>
                    <span>after</span>
                </div>
            )
        }
        const expected = csrShape(App)
        expect(probe(), 'CSR runs a script created by createElement once, when it is inserted').toEqual(['js'])
        probeWindow.__axiiI73Probe = []

        const container = serverHtmlWithSwapped(App, 'script')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(probe()).toEqual(['js'])
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('a claimed (not rebuilt) server script is not run again', () => {
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <script>{run('claimed')}</script>
                    <p>keep</p>
                    <b>x</b>
                </div>
            )
        }
        const expected = csrShape(App)
        probeWindow.__axiiI73Probe = []

        // Only the <b> is swapped; the <script> is claimed as the server parsed it.
        const container = serverHtmlWithSwapped(App, 'b')
        const serverScript = container.querySelector('script')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(container.querySelector('script')).toBe(serverScript)
        expect(probe()).toEqual([])
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('<link rel="stylesheet"> with integrity: the rebuilt link enforces integrity like CSR', async () => {
        const href = `data:text/css,${encodeURIComponent('#d{color:rgb(1, 2, 3)}')}`
        const integrity = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <link rel="stylesheet" href={href} integrity={integrity}/>
                    <span>after</span>
                </div>
            )
        }
        const csrContainer = mount()
        const csrRoot = createRoot(csrContainer)
        csrRoot.render(createElement(App, null as any))
        const csrOutcome = await loadOutcome(csrContainer.querySelector('link')!)
        expect(csrOutcome, 'CSR: integrity mismatch blocks the stylesheet').toBe('error')
        const expected = contentShape(csrContainer)
        csrRoot.destroy()
        csrContainer.remove()

        const container = serverHtmlWithSwapped(App, 'link')
        const root = hydrate(container, createElement(App, null as any))
        const outcome = await loadOutcome(container.querySelector('link')!)

        expect(reportedMismatch()).toBe(true)
        expect(outcome).toBe(csrOutcome)
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('customized built-in element (is=): the rebuilt element is created upgraded, like CSR', () => {
        class I73Button extends HTMLButtonElement {}
        if (!customElements.get('i73-rebuild-button')) {
            customElements.define('i73-rebuild-button', I73Button, {extends: 'button'})
        }
        const Ctor = customElements.get('i73-rebuild-button')!
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <button is="i73-rebuild-button">go</button>
                    <span>after</span>
                </div>
            )
        }
        const csrContainer = mount()
        const csrRoot = createRoot(csrContainer)
        csrRoot.render(createElement(App, null as any))
        expect(csrContainer.querySelector('button')).toBeInstanceOf(Ctor)
        const expected = contentShape(csrContainer)
        csrRoot.destroy()
        csrContainer.remove()

        const container = serverHtmlWithSwapped(App, 'button')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(container.querySelector('button')).toBeInstanceOf(Ctor)
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('<select multiple> rebuilt with its options: every selected option stays selected, like CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <select multiple>
                        <option value="a" selected>a</option>
                        <option value="b" selected>b</option>
                        <option value="c">c</option>
                    </select>
                </div>
            )
        }
        const selectedOf = (c: Element) => Array.from((c.querySelector('select') as HTMLSelectElement).selectedOptions).map(o => o.value)
        const csrContainer = mount()
        const csrRoot = createRoot(csrContainer)
        csrRoot.render(createElement(App, null as any))
        expect(selectedOf(csrContainer)).toEqual(['a', 'b'])
        const expected = contentShape(csrContainer)
        csrRoot.destroy()
        csrContainer.remove()

        // The whole <select> (with its options) is swapped, so the select and its options are rebuilt.
        const container = serverHtmlWithSwapped(App, 'select')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(selectedOf(container)).toEqual(['a', 'b'])
        expect(contentShape(container)).toBe(expected)
        root.destroy()
    })

    test('the rebuilt element keeps its position and later siblings are still claimed', () => {
        const text = atom('t')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span>before</span>
                    <script type="application/json">{run('pos')}</script>
                    <p id="after">{text}</p>
                </div>
            )
        }
        const expected = csrShape(App)
        const container = serverHtmlWithSwapped(App, 'script')
        const serverAfter = container.querySelector('#after')
        const root = hydrate(container, createElement(App, null as any))

        expect(reportedMismatch()).toBe(true)
        expect(probe()).toEqual([])
        expect(contentShape(container)).toBe(expected)
        expect(container.querySelector('#after')).toBe(serverAfter)
        text('u')
        expect(serverAfter!.textContent).toBe('u')
        root.destroy()
    })
})

describe('#73 known limit: reactive attributes of a rebuilt element', () => {
    // Reactive attributes (atom / function values) are bound by the StaticHost that owns the JSX tree, after every
    // createElement of the tree has returned. CSR binds them before that host inserts its root, so a rebuilt
    // <script type={atom}> is already typed when it is connected. On a mismatch the rebuilt element is inserted at
    // the end of its createElement — static props and children applied, reactive ones not yet — so its script still
    // runs as JavaScript under the children-first claim model. The top-down claim model (#55, hydration-top-down.md
    // §4.2 R1, B3) inserts a rebuilt element only after its owning StaticHost has bound the reactive attributes;
    // since #55 S hydrateRoot uses it and this case passes (it was test.fails before).
    test('a rebuilt <script> with a reactive data type does not run, like CSR (#55)', () => {
        const type = atom('application/json')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <script type={type}>{run('reactive-type')}</script>
                    <span>after</span>
                </div>
            )
        }
        const expected = csrShape(App)
        expect(probe(), 'CSR binds the reactive type before the script is inserted').toEqual([])

        const container = serverHtmlWithSwapped(App, 'script')
        const root = hydrate(container, createElement(App, null as any))
        try {
            expect(reportedMismatch()).toBe(true)
            expect(contentShape(container)).toBe(expected)
            expect(probe()).toEqual([])
        } finally {
            root.destroy()
        }
    })
})
