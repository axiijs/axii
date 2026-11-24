/** @jsx createElement */
/**
 * M-02: browser hydrate — attrs, events, FTS/FCS, forms, context, DirectNodes, ElementChildText.
 * Run: npx vitest run __tests__/ssrHydrate.attrs-components.spec.tsx
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    Fragment,
    createContext,
    ContextProvider,
    RenderContext,
} from '@framework'
import {atom} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {createElement as ssrCreateElement, renderToString} from '../src/ssr.js'

function hasAxiiMarkers(root: Node): boolean {
    const walk = (n: Node): boolean => {
        if (n.nodeType === Node.COMMENT_NODE) {
            const d = (n as Comment).data
            if (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') return true
        }
        for (const c of Array.from(n.childNodes)) {
            if (walk(c)) return true
        }
        return false
    }
    return walk(root)
}

function findHostByName(host: any, name: string): any {
    if (!host) return null
    if (host.constructor?.name === name) return host
    if (host.innerHost) {
        const found = findHostByName(host.innerHost, name)
        if (found) return found
    }
    const rh = host.reactiveHosts
    if (Array.isArray(rh)) {
        for (const child of rh) {
            const found = findHostByName(child, name)
            if (found) return found
        }
    } else if (rh) {
        return findHostByName(rh, name)
    }
    if (Array.isArray(host.childHosts)) {
        for (const child of host.childHosts) {
            const found = findHostByName(child, name)
            if (found) return found
        }
    }
    return null
}

describe('M-02 hydrateRoot attrs/components', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('attrs + event binding after hydrate', () => {
        let clicked = 0
        function App({}, {createElement}: RenderContext) {
            return <button id="btn" className="c" data-x="1" onClick={() => { clicked++ }}>go</button>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const btnBefore = rootEl.querySelector('#btn') as HTMLButtonElement
        expect(btnBefore.getAttribute('data-x')).toBe('1')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#btn')).toBe(btnBefore)
        btnBefore.click()
        expect(clicked).toBe(1)
        expect(hasAxiiMarkers(rootEl)).toBe(false)
    })

    test('CB / CK form IDL after parse+hydrate', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>
                <input id="cb" type="checkbox" value={true as any} />
                <input id="ck" type="checkbox" checked={true} />
                <input id="cf" type="checkbox" value={0 as any} />
                <input id="rk" type="radio" name="g" checked={true} />
                <input id="iv" type="text" value="hello" />
            </div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const cb = rootEl.querySelector('#cb') as HTMLInputElement
        const ck = rootEl.querySelector('#ck') as HTMLInputElement
        const cf = rootEl.querySelector('#cf') as HTMLInputElement
        const rk = rootEl.querySelector('#rk') as HTMLInputElement
        const iv = rootEl.querySelector('#iv') as HTMLInputElement
        expect(cb.value).toBe('true')
        expect(cb.checked).toBe(true)
        expect(ck.checked).toBe(true)
        expect(ck.getAttribute('value')).toBe(null)
        expect(ck.value).toBe('on')
        expect(cf.value).toBe('0')
        expect(cf.checked).toBe(false)
        expect(rk.checked).toBe(true)
        expect(rk.getAttribute('value')).toBe(null)
        expect(iv.value).toBe('hello')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(cb.value).toBe('true')
        expect(cb.checked).toBe(true)
        expect(rk.checked).toBe(true)
        expect(iv.value).toBe('hello')
    })

    test('SO: select value prop → parse IDL matches before hydrate', () => {
        // Failing repro (k2 audit): SSR currently emits <select value="b"> without option selected;
        // browser parse leaves .value==='a'. §3.6.2 SO requires selected on matching option.
        function App({}, {createElement}: RenderContext) {
            return <select id="s" value="b">
                <option value="a">A</option>
                <option value="b">B</option>
            </select>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('selected="true"')
        rootEl.innerHTML = html
        const sel = rootEl.querySelector('#s') as HTMLSelectElement
        expect(sel.value).toBe('b')
        expect(sel.options[1].selected).toBe(true)
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(sel.value).toBe('b')
    })

    test('SO: options from map/array under select — parse IDL before hydrate', () => {
        // CSR path (__tests__/fatalBugs11): select children = options.map(...).
        // k3 left selectSo unthreaded through StaticArrayHost → no selected → .value stays first option.
        const options = ['a', 'b', 'c']
        function App({}, {createElement}: RenderContext) {
            return <select id="s" value="b">
                {options.map((o) => <option value={o}>{o}</option>)}
            </select>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<option value="b" selected="true">')
        rootEl.innerHTML = html
        const sel = rootEl.querySelector('#s') as HTMLSelectElement
        expect(sel.value).toBe('b')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(sel.value).toBe('b')
    })
    test('textarea value from child text; no axii markers', () => {
        function App({}, {createElement}: RenderContext) {
            return <textarea id="ta" value={'hello & <world>'} />
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('axii:')
        rootEl.innerHTML = html
        const ta = rootEl.querySelector('#ta') as HTMLTextAreaElement
        expect(ta.value).toBe('hello & <world>')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(ta.value).toBe('hello & <world>')
        expect(hasAxiiMarkers(rootEl)).toBe(false)
    })

    test('FTS element-child function: claim computed, insert Text placeholder, switch to text', async () => {
        const show = atom(true)
        function App({}, {createElement}: RenderContext) {
            return <div id="box">{() => show() ? <span id="s">x</span> : 'plain'}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--computed node--><!--axii:0-->')
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('#s')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#s')).toBe(spanBefore)
        expect(hasAxiiMarkers(rootEl)).toBe(false)

        const fh = findHostByName((root as any).host, 'FunctionHost')
        expect(fh).toBeTruthy()
        expect(fh.textNode).toBeNull()
        expect(fh.placeholder.nodeType).toBe(Node.TEXT_NODE)
        expect(fh.placeholder.nodeValue).toBe('')

        show(false)
        await Promise.resolve()
        expect(rootEl.querySelector('#s')).toBeNull()
        expect(rootEl.querySelector('#box')!.textContent).toBe('plain')
        expect(fh.textNode).toBe(fh.placeholder)

        root.destroy()
        expect(rootEl.querySelector('#box')).toBeNull()
    })

    test('FTS function → atom: inner AtomHost + trailing Text placeholder', () => {
        const a = atom('world')
        function App({}, {createElement}: RenderContext) {
            return <div id="box">{() => a}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toBe('<div id="box">world<!--computed node--><!--axii:0--></div><!--root-->')
        rootEl.innerHTML = html
        const textBefore = Array.from(rootEl.querySelector('#box')!.childNodes)
            .find(n => n.nodeType === Node.TEXT_NODE && n.nodeValue === 'world') as Text
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        const fh = findHostByName((root as any).host, 'FunctionHost')
        expect(fh.textNode).toBeNull()
        expect(fh.placeholder.nodeType).toBe(Node.TEXT_NODE)
        const ah = findHostByName(fh, 'AtomHost')
        expect(ah.element).toBe(textBefore)
        a('next')
        expect(textBefore.nodeValue).toBe('next')
        expect(hasAxiiMarkers(rootEl)).toBe(false)
    })

    test('FTS function → Fragment with fragment start', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return <div id="box">{() => <F><span id="a">a</span><span id="b">b</span></F>}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        const aBefore = rootEl.querySelector('#a')!
        const bBefore = rootEl.querySelector('#b')!
        const fragStart = Array.from(rootEl.querySelector('#box')!.childNodes)
            .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'fragment start')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#a')).toBe(aBefore)
        expect(rootEl.querySelector('#b')).toBe(bBefore)
        expect(
            Array.from(rootEl.querySelector('#box')!.childNodes)
                .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'fragment start'),
        ).toBe(fragStart)
        expect(hasAxiiMarkers(rootEl)).toBe(false)
    })

    test('FCS: root function returns element — claim root, no trailing Text', () => {
        const {html} = renderToString(() => ssrCreateElement('div', {id: 'r'}, 'hi'))
        expect(html).toContain('<!--computed node--><!--root-->')
        expect(html).not.toContain('axii:0')
        rootEl.innerHTML = html
        const divBefore = rootEl.querySelector('#r')!
        const rootComment = Array.from(rootEl.childNodes)
            .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'root')
        hydrateRoot(rootEl, () => <div id="r">hi</div>)
        expect(rootEl.querySelector('#r')).toBe(divBefore)
        expect(
            Array.from(rootEl.childNodes)
                .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'root'),
        ).toBe(rootComment)
        // No trailing empty Text after computed (FCS ≠ FTS)
        const computed = Array.from(rootEl.childNodes)
            .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'computed node')!
        expect(computed.nextSibling).toBe(rootComment)
    })
    test('FCS: StaticArray function item uses array item not rx list item', () => {
        function App({}, {createElement}: RenderContext) {
            return <div id="box">{[() => <span id="s">x</span>]}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--array item-->')
        expect(html).not.toContain('rx list item')
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('#s')!
        const itemPh = Array.from(rootEl.querySelector('#box')!.childNodes)
            .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'array item')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#s')).toBe(spanBefore)
        expect(
            Array.from(rootEl.querySelector('#box')!.childNodes)
                .find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'array item'),
        ).toBe(itemPh)
    })

    test('ElementChildText multi / empty sibling / single empty', () => {
        function Multi({}, {createElement}: RenderContext) {
            return <div id="m">{'hello'}{'world'}</div>
        }
        const {html: h1} = renderToString(createElement(Multi, null as any))
        rootEl.innerHTML = h1
        const texts = () => Array.from(rootEl.querySelector('#m')!.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE) as Text[]
        const before = texts()
        expect(before.length).toBe(2)
        hydrateRoot(rootEl, createElement(Multi, null as any))
        const after = texts()
        expect(after[0]).toBe(before[0])
        expect(after[1]).toBe(before[1])
        expect(hasAxiiMarkers(rootEl)).toBe(false)

        rootEl.innerHTML = ''
        function EmptySib({}, {createElement}: RenderContext) {
            return <div id="e">{''}{'x'}</div>
        }
        const {html: h2} = renderToString(createElement(EmptySib, null as any))
        rootEl.innerHTML = h2
        hydrateRoot(rootEl, createElement(EmptySib, null as any))
        const eTexts = Array.from(rootEl.querySelector('#e')!.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE) as Text[]
        expect(eTexts.length).toBe(2)
        expect(eTexts[0].nodeValue).toBe('')
        expect(eTexts[1].nodeValue).toBe('x')

        rootEl.innerHTML = ''
        function SingleEmpty({}, {createElement}: RenderContext) {
            return <div id="s">{''}</div>
        }
        const {html: h3} = renderToString(createElement(SingleEmpty, null as any))
        expect(h3).toBe('<div id="s"></div><!--root-->')
        rootEl.innerHTML = h3
        hydrateRoot(rootEl, createElement(SingleEmpty, null as any))
        expect(rootEl.querySelector('#s')!.childNodes.length).toBe(0)
    })

    test('DirectNodes adjacent + empty', () => {
        function App({}, {createElement}: RenderContext) {
            return <div id="d">{['hello', 'world']}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--unhandledChild-->')
        rootEl.innerHTML = html
        const textsBefore = Array.from(rootEl.querySelector('#d')!.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE) as Text[]
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        const sah = findHostByName((root as any).host, 'StaticArrayHost')
        expect(sah.directNodes.length).toBe(2)
        expect(sah.directNodes[0]).toBe(textsBefore[0])
        expect(sah.directNodes[1]).toBe(textsBefore[1])
        expect(hasAxiiMarkers(rootEl)).toBe(false)

        rootEl.innerHTML = ''
        function EmptyArr({}, {createElement}: RenderContext) {
            return <div id="e">{['', 'x']}</div>
        }
        const {html: h2} = renderToString(createElement(EmptyArr, null as any))
        rootEl.innerHTML = h2
        const root2 = hydrateRoot(rootEl, createElement(EmptyArr, null as any))
        const sah2 = findHostByName((root2 as any).host, 'StaticArrayHost')
        expect(sah2.directNodes[0].nodeValue).toBe('')
        expect(sah2.directNodes[1].nodeValue).toBe('x')
    })

    test('context + component nesting hydrate', () => {
        const Ctx = createContext<string>('m2')
        function Child({}, {createElement, context}: RenderContext) {
            return <span id="c">{context.get(Ctx)}</span>
        }
        function App({}, {createElement}: RenderContext) {
            return <ContextProvider contextType={Ctx} value="v1">
                <div id="wrap"><Child /></div>
            </ContextProvider>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('v1')
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('#c')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#c')).toBe(spanBefore)
        expect(spanBefore.textContent).toBe('v1')
    })

    test('FunctionHost empty text axii:0 inserts Text', async () => {
        const flag = atom(false as any)
        function App({}, {createElement}: RenderContext) {
            return <div id="box">{() => flag() ? 'yes' : false}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--axii:0-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        flag(true as any)
        await Promise.resolve()
        expect(rootEl.querySelector('#box')!.textContent).toBe('yes')
    })
})
