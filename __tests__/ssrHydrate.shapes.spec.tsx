/** @jsx createElement */
/**
 * #56: three server / client shape divergences (black-box, model-independent).
 *  1. <table> whose children render sections (<tbody>…) through a list / function / fragment: the server
 *     wrapped every dynamic child in an extra <tbody>, the parser closed it early, an empty <tbody> stayed.
 *  2. <svg> with plain JSX <title> / <a> / <style> / <script>: the parser puts them in the SVG namespace,
 *     the client created HTML elements — every hydration reported and rebuilt them, CSR rendered them wrong.
 *  3. Function children of character-data parents (<textarea>, <title>, <style>, <script>): the server threw.
 *
 * Oracles (each case): parse the server HTML ≡ CSR; hydrateRoot reports nothing and keeps the server nodes;
 * after the reactive data changes the hydrated DOM ≡ a CSR root given the same change.
 * Run: npx vitest run __tests__/ssrHydrate.shapes.spec.tsx
 */
import {createElement, createRoot, configureDiagnostics, RenderContext} from '@framework'
import {atom, RxList} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate, pendingTopDown} from './helpers/hydrate'

let reports: string[]
beforeEach(() => {
    document.body.innerHTML = ''
    reports = []
    configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push((e as any)?.message ?? String(e)) }})
})

/** DOM shape with namespaces; transient axii:* markers and empty Text dropped, attributes sorted. */
function shape(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === '' ? '' : `"${node.nodeValue}"`
    if (node.nodeType === Node.COMMENT_NODE) {
        const d = (node as Comment).data
        return (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') ? '' : `<!--${d}-->`
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const ns = el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg:' : ''
    const attrs = Array.from(el.attributes)
        .map(a => `${a.namespaceURI ? a.namespaceURI.split('/').pop() + '|' + a.localName : a.name}=${JSON.stringify(a.value)}`)
        .sort().join(' ')
    return `<${ns}${el.localName}${attrs ? ' ' + attrs : ''}>${kids(el)}</${ns}${el.localName}>`
}
function kids(el: Element): string {
    let s = ''
    el.childNodes.forEach(c => { s += shape(c) })
    return s
}
function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
const tick = () => new Promise(r => setTimeout(r, 0))
const elementsOf = (root: Element) => Array.from(root.querySelectorAll('*'))
const sameNodes = (a: Element[], b: Element[]) => a.length === b.length && a.every((n, i) => n === b[i])

/**
 * Renders `make()` three times: server HTML parsed into `ssr`, a CSR root `client`, and a hydrated root.
 * Returns the parsed shape, both scenario instances and a snapshot of the server element identities.
 */
function setup<S extends {App: any}>(make: () => S) {
    let html = ''
    let ssrError: unknown
    try {
        html = renderToString(createElement(make().App, null as any)).html
    } catch (e) {
        ssrError = e
    }
    const hyd = mount()
    hyd.innerHTML = html
    const parsed = kids(hyd)
    const c = make()
    const client = mount()
    createRoot(client).render(createElement(c.App, null as any))
    const before = elementsOf(hyd)
    const h = make()
    if (ssrError === undefined) hydrate(hyd, createElement(h.App, null as any))
    return {ssrError: ssrError === undefined ? undefined : String(ssrError), parsed, hyd, client, c, h, before}
}

// ───────────────────────── 1. table sections rendered by dynamic children ─────────────────────────
describe('#56-1 <table> sections from a list / function / fragment: no extra empty <tbody>', () => {
    test('list of <tbody>, function returning <tbody>, fragment of sections: parse ≡ CSR, in place, updates ≡ CSR', async () => {
        const make = () => {
            const groups = new RxList([1, 2])
            const empty = new RxList<number>([])
            const show = atom(true)
            function App({}: any, {createElement, Fragment}: RenderContext) {
                // the function table comes last: same-tag static elements after content a function renders later are a
                // known defect of the children-first claim model (auditSsrHydrate F1f–F1h, #55), not part of #56
                return <div>
                    <table id="list">{groups.map(g => <tbody><tr><td>{g}</td></tr></tbody>)}</table>
                    <table id="frag"><><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></></table>
                    <table id="frag1"><><tbody><tr><td>c</td></tr></tbody></></table>
                    <table id="empty">{empty.map(g => <tbody><tr><td>{g}</td></tr></tbody>)}</table>
                    <table id="fn">{() => show() ? <tbody><tr><td>f</td></tr></tbody> : null}</table>
                </div>
            }
            return {App, groups, empty, show}
        }
        const {ssrError, parsed, hyd, client, c, h, before} = setup(make)
        expect({ssrError, parsed}).toEqual({ssrError: undefined, parsed: kids(client)})
        expect({same: sameNodes(elementsOf(hyd), before), dom: kids(hyd), reports})
            .toEqual({same: true, dom: kids(client), reports: []})

        for (const s of [c, h]) {
            s.groups.push(3)
            s.groups.splice(0, 1)
            s.empty.push(7)
            s.show(false)
        }
        await tick()
        expect(kids(hyd)).toBe(kids(client))
        for (const s of [c, h]) s.show(true)
        await tick()
        expect({dom: kids(hyd), tbodies: hyd.querySelectorAll('tbody').length, reports})
            .toEqual({dom: kids(client), tbodies: client.querySelectorAll('tbody').length, reports: []})
    })

    test('bare rows (list / function / component) still get one explicit <tbody> and stay live', async () => {
        const make = () => {
            const rows = new RxList([1, 2])
            const more = atom(true)
            function Row({n}: any, {createElement}: RenderContext) { return <tr><td>{n}</td></tr> }
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <table id="rows">{rows.map(i => <tr><td>{i}</td></tr>)}</table>
                    <table id="fnrow">{() => more() ? <tr><td>m</td></tr> : null}</table>
                    <table id="comp"><Row n="c"/></table>
                </div>
            }
            return {App, rows, more}
        }
        const {ssrError, hyd, h, before} = setup(make)
        expect(ssrError).toBe(undefined)
        // one tbody per table holding every row (written by the server for bare rows, implied for the component row)
        const sections = (root: Element) => Array.from(root.querySelectorAll('table'))
            .map(t => Array.from(t.children).map(s => `${s.localName}:${s.querySelectorAll('tr').length}`).join(','))
        expect(sections(hyd)).toEqual(['tbody:2', 'tbody:1', 'tbody:1'])
        expect({same: sameNodes(elementsOf(hyd), before), reports}).toEqual({same: true, reports: []})
        h.rows.push(3)
        h.more(false)
        await tick()
        expect(Array.from(hyd.querySelectorAll('#rows td')).map(td => td.textContent)).toEqual(['1', '2', '3'])
        expect({fnrow: hyd.querySelectorAll('#fnrow td').length, comp: hyd.querySelector('#comp td')!.textContent, reports})
            .toEqual({fnrow: 0, comp: 'c', reports: []})
    })
})

// ───────────────────────── 2. HTML / SVG shared tag names under <svg> ─────────────────────────
describe('#56-2 plain JSX <title> / <a> / <style> / <script> under <svg> are SVG elements on both ends', () => {
    test('static children, nested and array items: parse ≡ CSR, in place, listeners and reactive attrs work', async () => {
        const clicks: string[] = []
        const make = () => {
            const tip = atom('tip')
            const href = atom('#one')
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <svg id="s" viewBox="0 0 10 10">
                        <title>{tip}</title>
                        <a href={href} target="_blank" className="lnk" fillOpacity={0.5} onClick={(e: Event) => { e.preventDefault(); clicks.push('a') }}>
                            <title>inner</title>
                            <text x="1">link</text>
                        </a>
                        <style>{'text{fill:red}'}</style>
                        <script type="text/plain">{'not run'}</script>
                        {[<a href="#arr"><text>i</text></a>, <title>arr</title>]}
                        <g><title>in g</title></g>
                        <foreignObject><a href="#html">html</a></foreignObject>
                    </svg>
                    <nav><a href="#outside">outside</a></nav>
                </div>
            }
            return {App, tip, href}
        }
        const {ssrError, parsed, hyd, client, c, h, before} = setup(make)
        expect({ssrError, parsed}).toEqual({ssrError: undefined, parsed: kids(client)})
        // the client must agree with the parser: SVG inside <svg>, HTML inside foreignObject / outside
        const nsOf = (root: Element) => Array.from(root.querySelectorAll('title, a, style, script'))
            .map(n => `${n.localName}:${n.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html'}`)
        expect(nsOf(client)).toEqual([
            'title:svg', 'a:svg', 'title:svg', 'style:svg', 'script:svg', 'a:svg', 'title:svg', 'title:svg', 'a:html', 'a:html',
        ])
        expect({same: sameNodes(elementsOf(hyd), before), dom: kids(hyd), reports})
            .toEqual({same: true, dom: kids(client), reports: []})

        for (const root of [client, hyd]) {
            (root.querySelector('#s a') as SVGAElement).dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
        }
        expect(clicks).toEqual(['a', 'a'])
        for (const s of [c, h]) { s.tip('tip2'); s.href('#two') }
        await tick()
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(client), reports: []})
        expect(hyd.querySelector('#s > title')!.textContent).toBe('tip2')
    })

    // static icons and component icons are separate roots: a static <svg> after a component that renders an <svg> later
    // is the known children-first claim defect (auditSsrHydrate F1b, #55), not part of #56
    test.each([
        ['static', (createElement: any) => <div>
            <svg><title>s1</title><path d="M4 4"/></svg>
            <svg><title>s2</title><a href="#s2"><path d="M5 5"/></a></svg>
            <nav><a href="/home">home</a></nav>
        </div>],
        ['component roots', (createElement: any) => {
            function Icon({label, d}: any, {createElement}: RenderContext) {
                return <svg viewBox="0 0 24 24"><title>{label}</title><a href="#i"><path d={d}/></a></svg>
            }
            return <div><button><Icon label="close" d="M0 0L1 1"/>x</button><button><Icon label="open" d="M2 2L3 3"/>y</button></div>
        }],
    ])('icons side by side (%s): each keeps its own <title> / <a> / <path>, no HTML <a> is taken, in place', (_name, body) => {
        const make = () => {
            function App({}: any, {createElement}: RenderContext) { return body(createElement) }
            return {App}
        }
        const {ssrError, parsed, hyd, client, before} = setup(make)
        expect({ssrError, parsed}).toEqual({ssrError: undefined, parsed: kids(client)})
        expect({same: sameNodes(elementsOf(hyd), before), dom: kids(hyd), reports})
            .toEqual({same: true, dom: kids(client), reports: []})
    })

    // The whole icon (svg + its <title>) rendered later is fine: the svg and its static children come from the same render.
    // On 3ea5b96 these reported and rebuilt every <title> / <a>; the component inside a list row made hydrateRoot throw.
    // One root per shape: same-tag content rendered later before same-tag static content is the known #55 defect.
    const iconsRenderedLater: [string, (state: any, createElement: any) => any][] = [
        ['function child', ({show}: any, createElement: any) =>
            <p>{() => show() ? <svg><title>fn</title><a href="#fn"><path d="M0"/></a></svg> : null}<span>s</span></p>],
        ['list rows', ({rows}: any, createElement: any) =>
            <ul>{rows.map((i: number) => <li><svg><title>{'r' + i}</title><path d={'M' + i}/></svg></li>)}</ul>],
        ['components in list rows', ({rows}: any, createElement: any) => {
            function Icon({n}: any, {createElement}: RenderContext) {
                return <svg><title>{'c' + n}</title><a href={'#c' + n}><path d={'M' + n}/></a></svg>
            }
            return <ul>{rows.map((i: number) => <li><Icon n={i}/></li>)}</ul>
        }],
        ['array items', (_: any, createElement: any) =>
            <div>{[1, 2].map(i => <svg><title>{'a' + i}</title><path d={'M' + i}/></svg>)}</div>],
    ]
    const iconsRenderedLaterCase = async (_name: string, body: (state: any, createElement: any) => any) => {
        const make = () => {
            const state = {show: atom(true), rows: new RxList([1, 2])}
            function App({}: any, {createElement}: RenderContext) { return body(state, createElement) }
            return {App, ...state}
        }
        const {ssrError, parsed, hyd, client, c, h, before} = setup(make)
        expect({ssrError, parsed}).toEqual({ssrError: undefined, parsed: kids(client)})
        expect({same: sameNodes(elementsOf(hyd), before), dom: kids(hyd), reports})
            .toEqual({same: true, dom: kids(client), reports: []})
        for (const s of [c, h]) { s.rows.push(3); s.show(false) }
        await tick()
        for (const s of [c, h]) s.show(true)
        await tick()
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(client), reports: []})
    }
    test.each(iconsRenderedLater.slice(0, 1))('whole icons rendered later (%s): in place, no report, updates ≡ CSR', iconsRenderedLaterCase)
    // 内部入口那一遍：列表行与数组项的激活在 #55 B2
    test.each(iconsRenderedLater.slice(1))('whole icons rendered later (%s): in place, no report, updates ≡ CSR', iconsRenderedLaterCase)

    // Known limit (documented at DOM.adoptSvgChild): tags a function / list renders later are inserted by a Host,
    // CSR keeps them HTML while the parser makes them SVG. Hydration should then report and rebuild them ≡ CSR
    // (design hydration-top-down.md §2.6.7). The children-first claim model does not (identical on 3ea5b96, before #56):
    // the function leaves the server SVG <title> next to a new empty HTML one, the list row keeps the SVG <a>.
    // Kept executable as test.fails; it flips once hydration claims top-down (#55). A throw from hydrateRoot is not
    // this defect: it is logged and the body returns normally, so test.fails reports it instead of swallowing it.
    // 内部入口那一遍（#55 §7.2）：新模型在认领处看到命名空间不符，按 R1 报告并重建（B3），之前待实现
    ;(pendingTopDown('B3') ? test.skip : test.fails)('shared-name tags rendered later by a function / list end ≡ CSR after hydration (#55)', async () => {
        const make = () => {
            const tip = atom('d1')
            const rows = new RxList(['r1'])
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <svg id="fn">{() => <title>{tip()}</title>}<path d="M0 0"/></svg>
                    <svg id="list">{rows.map(r => <a href={'#' + r}><text>{r}</text></a>)}</svg>
                </div>
            }
            return {App, tip, rows}
        }
        let result: ReturnType<typeof setup<ReturnType<typeof make>>>
        try {
            result = setup(make)
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[known-defect case] unexpected error, not the documented failure:', e)
            return
        }
        const {ssrError, hyd, client, c, h} = result
        expect({ssrError, dom: kids(hyd)}).toEqual({ssrError: undefined, dom: kids(client)})
        for (const s of [c, h]) { s.tip('d2'); s.rows.push('r2') }
        await tick()
        expect(kids(hyd)).toBe(kids(client))
    })
})

// ───────────────────────── 3. function children of character-data parents ─────────────────────────
describe('#56-3 function children of <textarea> / <title> / <style> / <script>: server writes the current value', () => {
    test('single, mixed, empty and adjacent function units: parse ≡ CSR, in place, stay reactive', async () => {
        const make = () => {
            const v = atom('a')
            const n = atom(3)
            const site = atom('Site')
            const blank = atom('')
            const color = atom('red')
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <textarea id="t1">{() => v() + '!'}</textarea>
                    <textarea id="t2">Note: {() => v()} ({() => blank()})</textarea>
                    <title id="h1">{() => 'T' + v()}</title>
                    <title id="h2">Inbox ({() => n()}) - {() => site()}{() => blank()}</title>
                    <title id="h3">{() => blank()}</title>
                    <style id="st">{() => `p{color:${color()}}`}</style>
                    <script id="sc" type="text/plain">{'var x = '}{() => n()}</script>
                </div>
            }
            return {App, v, n, site, blank, color}
        }
        // character data is one Text in the parsed HTML and one Text per unit in CSR: compare values first,
        // the full shape once hydration has split the server Text back into units
        const {ssrError, hyd, client, c, h, before} = setup(make)
        expect(ssrError).toBe(undefined)
        const read = (root: HTMLElement) => ({
            t1: (root.querySelector('#t1') as HTMLTextAreaElement).value,
            t2: (root.querySelector('#t2') as HTMLTextAreaElement).value,
            h1: root.querySelector('#h1')!.textContent,
            h2: root.querySelector('#h2')!.textContent,
            h3: root.querySelector('#h3')!.textContent,
            st: root.querySelector('#st')!.textContent,
            sc: root.querySelector('#sc')!.textContent,
        })
        const parsedValues = read(hyd)
        expect(parsedValues).toEqual(read(client))
        expect(parsedValues).toEqual({t1: 'a!', t2: 'Note: a ()', h1: 'Ta', h2: 'Inbox (3) - Site', h3: '', st: 'p{color:red}', sc: 'var x = 3'})
        expect({same: sameNodes(elementsOf(hyd), before), dom: kids(hyd), reports})
            .toEqual({same: true, dom: kids(client), reports: []})

        for (const s of [c, h]) { s.v('b'); s.n(4); s.site('S2'); s.blank('?'); s.color('blue') }
        await tick()
        expect({values: read(hyd), dom: kids(hyd), reports}).toEqual({values: read(client), dom: kids(client), reports: []})
        expect(read(hyd)).toEqual({t1: 'b!', t2: 'Note: b (?)', h1: 'Tb', h2: 'Inbox (4) - S2?', h3: '?', st: 'p{color:blue}', sc: 'var x = 4'})
    })
})
