/** @jsx createElement */
/**
 * #55 B3：新激活模型的失配规则 R1–R5（设计 docs/ssr-support/hydration-top-down.md §4），经内部入口 hydrateRootTopDown。
 * 失配不再中止激活：每条偏离都报告 HydrationMismatchError（交给 onError），在游标处按 R1–R5 修复，结果的节点结构、文本、
 * 客户端 props 写下的属性与 CSR 相同（§4.1）。这里覆盖只属于新模型的部分：
 *  - R1 新建的元素按 CSR 的语义建好（子元素、动态 child、ref、响应式属性都在），在所属 StaticHost 绑定响应式属性之后
 *    才插入（#73，B3 追加项 1、2）；
 *  - §4.1 属性的边界：近似认领、同一父节点失配之后的认领先清掉服务端独有的属性，干净认领不清理（D4）；
 *  - R2–R5 的黑盒形态；B2 交接的旧服务端 HTML（#82 / #85 之前）与其余形态；修复后的列表销毁、计数归零。
 * 既有的失配用例（ssrHydrate.mismatch / mismatchRebuild、auditSsrHydrate F4a–F4d）经 helpers/hydrate 在内部入口上再跑一遍；
 * 游标规则的白盒用例在 hydrationCursor.spec.tsx，漂移 fuzz 在 auditSsrHydrate（扩展后的 F1i 生成器）。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {configureDiagnostics, createElement, createRoot, type RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {hydrateRootTopDown} from '../src/hydrateTopDown'
import {HydrationMismatchError} from '../src/hydration'
import {
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    resetAxiiRetainedObjectDiagnostics,
} from '../src/retainedObjectDiagnostics'

let reports: unknown[]
beforeEach(() => {
    document.body.innerHTML = ''
    reports = []
    configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push(e) }})
})
afterEach(() => {
    configureDiagnostics({})
})

const SVG_NS = 'http://www.w3.org/2000/svg'
function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
function htmlOf(App: any): string {
    return renderToString(createElement(App, null)).html
}
/** 服务端 HTML（可以是改动过的）解析进一个新容器 */
function parse(html: string): HTMLElement {
    const el = mount()
    el.innerHTML = html
    return el
}
/** DOM 形状：去掉 axii:* 标记与空 Text，属性排序，SVG 元素带命名空间前缀 */
function shape(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === '' ? '' : JSON.stringify(node.nodeValue)
    if (node.nodeType === Node.COMMENT_NODE) {
        const d = (node as Comment).data
        return (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') ? '' : `<!--${d}-->`
    }
    const el = node as Element
    const ns = el.namespaceURI === SVG_NS ? 'svg:' : ''
    const attrs = Array.from(el.attributes).map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
    return `<${ns}${el.localName}${attrs ? ' ' + attrs : ''}>${kids(el)}</${ns}${el.localName}>`
}
function kids(el: Node): string {
    let s = ''
    el.childNodes.forEach(c => { s += shape(c) })
    return s
}
function csrOf(App: any): HTMLElement {
    const el = mount()
    createRoot(el).render(createElement(App, null))
    return el
}
const mismatches = () => reports.filter(e => e instanceof HydrationMismatchError).length
/** 把元素换成另一个标签（子节点与属性搬过去）：服务端在这个位置写的是别的元素 */
function swapTag(el: Element, tag: string): Element {
    const other = el.namespaceURI === SVG_NS ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
    for (const a of Array.from(el.attributes)) other.setAttribute(a.name, a.value)
    while (el.firstChild) other.appendChild(el.firstChild)
    el.replaceWith(other)
    return other
}
function commentIn(parent: Node, data: string): Comment | undefined {
    return Array.from(parent.childNodes).find(n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === data) as Comment | undefined
}
const others = () => reports.filter(e => !(e instanceof HydrationMismatchError)).map(e => String((e as Error)?.message ?? e))
const tick = () => new Promise(r => setTimeout(r, 0))

// 解析时会连入文档的自定义元素：记录它连入那一刻的 data-v（#73：CSR 在插入之前就绑定了响应式属性）
const connectedWith: (string | null)[] = []
class B3Probe extends HTMLElement {
    connectedCallback() { connectedWith.push(this.getAttribute('data-v')) }
}
if (!customElements.get('x-b3-probe')) customElements.define('x-b3-probe', B3Probe)

describe('R1: an element rebuilt on a mismatch is built like CSR (§4.2 R1, B3 addenda)', () => {
    test('the element children evaluated with its JSX are kept: <span><b>x</b><i>y</i></span> (addendum 2)', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><span><b>x</b><i>y</i></span><p>after</p></div>
        }
        const html = htmlOf(App)
        expect(html).toContain('<span><b>')
        const hyd = parse(html.replace('<span>', '<em>').replace('</span>', '</em>'))
        const after = hyd.querySelector('p')
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), others: others(), after: hyd.querySelector('p') === after})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, others: [], after: true})
    })

    test('dynamic children, a ref and reactive attributes of the rebuilt element are bound to the new nodes; later siblings keep their server nodes', async () => {
        const make = () => {
            const cls = atom('c1')
            const txt = atom('t1')
            const fnv = atom('f1')
            const tail = atom('tail1')
            const show = atom(true)
            const refs: unknown[] = []
            function Inner({}: any, {createElement}: RenderContext) { return <u>{txt}</u> }
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <section className={cls} ref={(el: unknown) => refs.push(el)}>
                        {txt}<b>{() => fnv()}</b><Inner/>{() => show() ? <i>on</i> : 'off'}
                    </section>
                    {tail}<p>{tail}</p>
                </div>
            }
            return {App, cls, txt, fnv, tail, show, refs}
        }
        const c = make()
        const csrEl = mount()
        const csrRoot = createRoot(csrEl)
        csrRoot.render(createElement(c.App, null))
        const html = htmlOf(make().App)
        expect(html).toContain('<section')
        const hyd = parse(html.replace('<section', '<article').replace('</section>', '</article>'))
        const p = hyd.querySelector('p')
        const h = make()
        const root = hydrateRootTopDown(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), others: others(), p: hyd.querySelector('p') === p})
            .toEqual({dom: kids(csrEl), mismatches: 1, others: [], p: true})
        expect(h.refs).toEqual([hyd.querySelector('section')])
        expect((h.refs[0] as Element).isConnected).toBe(true)
        for (const s of [c, h]) { s.cls('c2'); s.txt('t2'); s.fnv('f2'); s.tail('tail2'); s.show(false) }
        await tick()
        expect(kids(hyd)).toBe(kids(csrEl))
        root.destroy()
        csrRoot.destroy()
        expect(h.refs).toEqual([h.refs[0], null])
    })

    // #73 / B3 追加项 1：CSR 的 StaticHost 在把元素插入文档之前绑定响应式属性。失配新建的元素同样要在所属 StaticHost 绑定
    //  响应式属性之后才连入文档：自定义元素的 connectedCallback 读到的是那一刻的属性
    test.each([
        ['the root of a component', 'x-b3-probe', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return createElement('x-b3-probe', {'data-v': v})
        }],
        ['nested in a claimed parent', 'x-b3-probe', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return <div>{createElement('x-b3-probe', {'data-v': v})}<p>after</p></div>
        }],
        ['a Compact list row', 'x-b3-probe', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return <ul>{new RxList([1]).map(() => createElement('x-b3-probe', {'data-v': v}))}</ul>
        }],
        // 组件直接返回列表：列表上面没有 StaticHost，新建的行只能由它自己的 CompactElementHost 插入
        ['a Compact row of a list returned by the root component', 'x-b3-probe', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return new RxList([1]).map(() => createElement('x-b3-probe', {'data-v': v}))
        }],
        ['the value of a function child', 'x-b3-probe', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return <div>{() => createElement('x-b3-probe', {'data-v': v})}</div>
        }],
        ['inside a rebuilt parent', 'section', (v: any) => function App({}: any, {createElement}: RenderContext) {
            return <div><section>{createElement('x-b3-probe', {'data-v': v})}</section></div>
        }],
    ] as const)('a rebuilt element is connected only after its reactive attributes are bound: %s (#73, addendum 1)', (_name, swap, makeApp) => {
        connectedWith.length = 0
        const csrEl = mount()
        createRoot(csrEl).render(createElement(makeApp(atom('1')), null))
        expect(connectedWith).toEqual(['1'])
        // 在脱离文档的容器里解析、换掉目标元素，再连入文档：解析出的自定义元素不会先连入一次
        const hyd = document.createElement('div')
        hyd.innerHTML = htmlOf(makeApp(atom('1')))
        hyd.querySelectorAll(swap).forEach(el => el.replaceWith(document.createElement('template')))
        document.body.appendChild(hyd)
        connectedWith.length = 0
        hydrateRootTopDown(hyd, createElement(makeApp(atom('1')), null))
        expect({connectedWith, dom: kids(hyd), mismatches: mismatches(), others: others()})
            .toEqual({connectedWith: ['1'], dom: kids(csrEl), mismatches: 1, others: []})
    })

    test('an element rebuilt under <svg> is created in the SVG namespace with its children, like CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <svg><g data-k="g"><circle r="1"/><title>t</title></g><path d="M0 0"/></svg>
        }
        const html = htmlOf(App)
        expect(html).toContain('<g data-k="g">')
        const hyd = parse(html.replace('<g data-k="g">', '<rect data-k="g">').replace('</g>', '</rect>'))
        const path = hyd.querySelector('path')
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), others: others(), path: hyd.querySelector('path') === path})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, others: [], path: true})
        expect(hyd.querySelector('g')!.namespaceURI).toBe(SVG_NS)
    })
})

describe('§4.1 attribute boundary: claims on the mismatch path clear server-only attributes', () => {
    test('an id-drift claim (D2 / D9) clears them before applying the client props', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><span id="a" title="t">x</span></div>
        }
        const html = htmlOf(App)
        expect(html).toContain('<span id="a" title="t">')
        const hyd = parse(html.replace('<span id="a" title="t">', '<span id="z" title="old" data-junk="1">'))
        const span = hyd.querySelector('span')
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), span: hyd.querySelector('span') === span})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, span: true})
    })

    test('a look-ahead claim (D8) removes the junk in between and clears the claimed element', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><span id="a">a</span><span id="b">b</span></div>
        }
        const html = htmlOf(App)
        expect(html).toContain('<span id="b">')
        const hyd = parse(html.replace('<span id="b">', '<span id="x" data-junk="1">j</span><span id="b" data-junk="2">'))
        const b = hyd.querySelector('#b')
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), b: hyd.querySelector('#b') === b})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, b: true})
    })

    test('after a mismatch was reported in a parent, later claims in that parent are cleared too; other parents are not', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><section><b>1</b><i title="t">2</i></section><p><i title="t">3</i></p></div>
        }
        const hyd = parse(htmlOf(App))
        // 服务端：section 里的 <b> 换成 <u>（失配），两个 <i> 都多一个服务端独有的属性
        swapTag(hyd.querySelector('section > b')!, 'u')
        const [first, second] = Array.from(hyd.querySelectorAll('i'))
        first.setAttribute('data-junk', '1')
        second.setAttribute('data-junk', '2')
        hydrateRootTopDown(hyd, createElement(App, null))
        const csrEl = csrOf(App)
        // 第二个 <p> 里的 <i> 是干净认领：服务端独有的属性留下（D4），它所在的父节点没有失配
        csrEl.querySelector('p > i')!.setAttribute('data-junk', '2')
        expect({dom: kids(hyd), mismatches: mismatches(), kept: [hyd.querySelector('section > i') === first, hyd.querySelector('p > i') === second]})
            .toEqual({dom: kids(csrEl), mismatches: 1, kept: [true, true]})
    })

    test('a clean claim keeps a server-only attribute and reports nothing (D4)', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><i>x</i></div>
        }
        const hyd = parse(htmlOf(App).replace('<i>', '<i data-junk="1">'))
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({junk: hyd.querySelector('i')!.getAttribute('data-junk'), reports}).toEqual({junk: '1', reports: []})
    })

    test('an approximate claim of a raw-markup element re-applies the client markup, like CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><p id="a" dangerouslySetInnerHTML="<b>new</b>"/></div>
        }
        const html = htmlOf(App)
        expect(html).toContain('<p id="a"><b>new</b></p>')
        const hyd = parse(html.replace('<p id="a"><b>new</b></p>', '<p id="z"><b>old</b></p>'))
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches()}).toEqual({dom: kids(csrOf(App)), mismatches: 1})
    })
})

describe('R2–R5 black-box shapes', () => {
    function Comp({}: any, {createElement}: RenderContext) { return <b>c</b> }
    function App({}: any, {createElement}: RenderContext) { return <div><Comp/><p>x</p></div> }

    test('R3: a missing Host slot is inserted at the cursor without consuming the next sibling', () => {
        const hyd = parse(htmlOf(App))
        const div = hyd.querySelector('div')!
        commentIn(div, 'unhandledChild')!.remove()
        const [b, p] = [hyd.querySelector('b'), hyd.querySelector('p')]
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), kept: [hyd.querySelector('b') === b, hyd.querySelector('p') === p]})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, kept: [true, true]})
    })

    test('R3: junk before a Host slot is removed and the slot is claimed', () => {
        const hyd = parse(htmlOf(App))
        const div = hyd.querySelector('div')!
        const slot = commentIn(div, 'unhandledChild')!
        const junk = document.createElement('i')
        junk.textContent = 'junk'
        div.insertBefore(junk, slot)
        div.insertBefore(document.createTextNode('junk'), slot)
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches(), slot: commentIn(div, 'unhandledChild') === slot})
            .toEqual({dom: kids(csrOf(App)), mismatches: 1, slot: true})
    })

    test('R4: a missing axii:0 at the end of a structure-state function inserts Text("") and does not take a later node', () => {
        function Fn({}: any, {createElement}: RenderContext) { return <div>{() => <b>x</b>}<p>y</p></div> }
        const html = htmlOf(Fn)
        expect(html).toContain('<!--computed node--><!--axii:0--><p>')
        const hyd = parse(html.replace('<!--computed node--><!--axii:0-->', '<!--computed node-->'))
        const p = hyd.querySelector('p')
        hydrateRootTopDown(hyd, createElement(Fn, null))
        expect({dom: kids(hyd), mismatches: mismatches(), p: hyd.querySelector('p') === p}).toEqual({dom: kids(csrOf(Fn)), mismatches: 1, p: true})
    })

    test('R5: leftover nodes at the end of a parent are removed and reported once per parent', () => {
        function Two({}: any, {createElement}: RenderContext) { return <div><p>a</p><section>b</section></div> }
        const hyd = parse(htmlOf(Two))
        const junk = (parent: Element) => {
            const i = document.createElement('i')
            i.textContent = 'j'
            parent.append(i, 'text', document.createComment('x'), document.createElement('b'))
        }
        junk(hyd.querySelector('p')!)
        junk(hyd.querySelector('div')!)
        hydrateRootTopDown(hyd, createElement(Two, null))
        expect({dom: kids(hyd), mismatches: mismatches(), others: others()}).toEqual({dom: kids(csrOf(Two)), mismatches: 2, others: []})
    })

    test('R2 in a character-data parent: a unit that is not a prefix of the server text replaces it; later units are inserted', () => {
        const make = (a: string, b: string) => function App({}: any, {createElement}: RenderContext) {
            return <div><textarea>{atom(a)}{atom(b)}</textarea></div>
        }
        const hyd = parse(htmlOf(make('A', 'B')))
        expect(hyd.querySelector('textarea')!.value).toBe('AB')
        hydrateRootTopDown(hyd, createElement(make('X', 'B'), null))
        expect({dom: kids(hyd), value: hyd.querySelector('textarea')!.value, reported: mismatches() > 0})
            .toEqual({dom: kids(csrOf(make('X', 'B'))), value: 'XB', reported: true})
    })
})

describe('B2 hand-off: server HTML written before #82 / #85, and the other shapes', () => {
    test('before #82: an empty atom array item had an extra axii:0 — reported and removed; the atom stays bound', async () => {
        const make = () => {
            const a = atom('')
            function App({}: any, {createElement}: RenderContext) { return <p>{[a, 'x']}</p> }
            return {App, a}
        }
        const c = make()
        const csrEl = mount()
        createRoot(csrEl).render(createElement(c.App, null))
        const html = htmlOf(make().App)
        expect(html).toContain('<p><!--array item-->')
        const hyd = parse(html.replace('<p><!--array item-->', '<p><!--axii:0--><!--array item-->'))
        const h = make()
        hydrateRootTopDown(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reported: mismatches() > 0, markers: hyd.innerHTML.includes('axii:'), others: others()})
            .toEqual({dom: kids(csrEl), reported: true, markers: false, others: []})
        for (const s of [c, h]) s.a('A')
        await tick()
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('before #82: a function returning an RxList had an extra unhandledChild after the rows — reported and removed; the list stays bound', () => {
        const make = () => {
            const list = new RxList([1, 2])
            function App({}: any, {createElement}: RenderContext) { return <div>{() => list.map(i => <li>{i}</li>)}<p>after</p></div> }
            return {App, list}
        }
        const c = make()
        const csrEl = mount()
        createRoot(csrEl).render(createElement(c.App, null))
        const html = htmlOf(make().App)
        expect(html.split('<!--computed node-->').length).toBe(2)
        const hyd = parse(html.replace('<!--computed node-->', '<!--unhandledChild--><!--computed node-->'))
        const rows = Array.from(hyd.querySelectorAll('li'))
        const h = make()
        hydrateRootTopDown(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reported: mismatches() > 0, rows: Array.from(hyd.querySelectorAll('li')).every((li, i) => li === rows[i])})
            .toEqual({dom: kids(csrEl), reported: true, rows: true})
        for (const s of [c, h]) s.list.push(3)
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('before #85: a hole in a sparse array had <!--empty--><!--array item--> — reported and removed, like CSR', () => {
        // eslint-disable-next-line no-sparse-arrays
        function Sparse({}: any, {createElement}: RenderContext) { return <p>{['a', , 'b']}<i>after</i></p> }
        // #85 之前的服务端为空位写的就是 null 项的形态
        function WithNull({}: any, {createElement}: RenderContext) { return <p>{['a', null, 'b']}<i>after</i></p> }
        const html = htmlOf(WithNull)
        expect(html).toContain('<!--empty--><!--array item-->')
        const hyd = parse(html)
        const i = hyd.querySelector('i')
        hydrateRootTopDown(hyd, createElement(Sparse, null))
        expect({dom: kids(hyd), reported: mismatches() > 0, others: others(), i: hyd.querySelector('i') === i})
            .toEqual({dom: kids(csrOf(Sparse)), reported: true, others: [], i: true})
    })

    test('a list repaired during the activation (extra, missing and junk rows of each kind) is destroyed cleanly: retained counters return to zero', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const make = (n: number) => {
                const label = atom('x')
                const compact = new RxList(Array.from({length: n}, (_, i) => i))
                const frag = new RxList(Array.from({length: n}, (_, i) => i))
                function App({}: any, {createElement, Fragment}: RenderContext) {
                    return <div>
                        <ul>{compact.map(i => <li className={() => label() + i}>{i}</li>)}</ul>
                        <ol>{frag.map(i => <Fragment><b>{i}</b>{label}</Fragment>)}</ol>
                    </div>
                }
                return {App, label, compact, frag}
            }
            for (const [server, client, junk] of [[2, 3, false], [3, 2, false], [2, 2, true]] as const) {
                reports = []
                const c = make(client)
                const csrEl = mount()
                const csrRoot = createRoot(csrEl)
                csrRoot.render(createElement(c.App, null))
                let html = htmlOf(make(server).App)
                if (junk) html = html.replace('</li>', '</li><em>junk</em>').replace('</b>', '</b><em>junk</em>')
                const hyd = parse(html)
                const h = make(client)
                const root = hydrateRootTopDown(hyd, createElement(h.App, null))
                expect({dom: kids(hyd), reported: mismatches() > 0, others: others()}).toEqual({dom: kids(csrEl), reported: true, others: []})
                for (const s of [c, h]) { s.label('y'); s.compact.push(9); s.frag.splice(0, 1) }
                await tick()
                expect(kids(hyd)).toBe(kids(csrEl))
                root.destroy()
                csrRoot.destroy()
                const after = getAxiiRetainedObjectDiagnosticsSnapshot()
                expect({hosts: after.hosts.totalActive, bindings: after.lightBindings.totalActive, compact: after.compactListHosts.active, styles: after.styles.activeHostStyleStates})
                    .toEqual({hosts: 0, bindings: 0, compact: 0, styles: 0})
            }
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })

    test('an error listener destroys the root during the activation: the discarded tree finishes its repairs and is destroyed without errors (B1 risk)', () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const make = (clientThrows: boolean) => {
                const list = new RxList(clientThrows ? [1, 2, 3] : [1, 2])
                return function App({}: any, {createElement, pathContext}: RenderContext) {
                    if (pathContext) {
                        pathContext.root.on('error', () => {
                            pathContext.root.destroy()
                            pathContext.root.render(createElement('p', null, 'fallback'))
                        })
                    }
                    function Bad() { if (clientThrows) throw new Error('client only'); return createElement('b', null, 'ok') }
                    return <div><Bad/><ul>{list.map(i => <li>{i}</li>)}</ul>{() => 'tail'}</div>
                }
            }
            const hyd = parse(htmlOf(make(false)))
            const root = hydrateRootTopDown(hyd, createElement(make(true), null))
            expect({fallback: kids(hyd), others: others()}).toEqual({fallback: '<p>"fallback"</p><!--root-->', others: []})
            root.destroy()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect({hosts: after.hosts.totalActive, bindings: after.lightBindings.totalActive}).toEqual({hosts: 0, bindings: 0})
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })

    test('a root component that throws at the container level: the discarded tree\'s repairs stop at the server <!--root--> and leave the fallback rendered into the same container alone', () => {
        // 监听器销毁 root、往同一个容器渲染一个空的兜底（容器层的 <!--empty--><!--root-->，追加在服务端内容之后）。
        //  被丢弃的树按 R3 找自己的 <!--empty--> 时不能越过服务端的 <!--root--> 认领兜底的注释，否则随丢弃的树一起被销毁
        function Fallback() { return null }
        const make = (clientThrows: boolean) => function App({}: any, {createElement, pathContext}: RenderContext) {
            if (pathContext) {
                pathContext.root.on('error', () => {
                    pathContext.root.destroy()
                    pathContext.root.render(createElement(Fallback, null))
                })
            }
            if (clientThrows) throw new Error('client only')
            return <div>ok</div>
        }
        const hyd = parse(htmlOf(make(false)))
        const root = hydrateRootTopDown(hyd, createElement(make(true), null))
        expect({dom: kids(hyd), others: others()}).toEqual({dom: '<!--empty--><!--root-->', others: []})
        root.destroy()
        expect(kids(hyd)).toBe('')
    })

    test('a row component that changes the list on the next tick during the activation is tracked, like CSR', async () => {
        // 同步改动（在 useEffect 里直接 push）CSR 本身就被 data0 拒绝（「detect recompute triggerred in sync recompute」），不在比较范围内
        const make = () => {
            const list = new RxList([1, 2])
            function Row({i}: any, {createElement, useEffect}: RenderContext) {
                useEffect(() => { if (i === 1) queueMicrotask(() => { if (list.data.length < 3) list.push(3) }) })
                return <li>{i}</li>
            }
            function App({}: any, {createElement}: RenderContext) { return <ul>{list.map(i => <Row i={i}/>)}</ul> }
            return {App, list}
        }
        const c = make()
        const csrEl = mount()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = parse(htmlOf(make().App))
        hydrateRootTopDown(hyd, createElement(make().App, null))
        await tick()
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })

    test('rolling style ids: a row claimed by another role and a rebuilt row each get their own stylesheet (no silent collision)', async () => {
        const hover = {'&:hover': {opacity: 0.5}}
        const make = (rows: number[]) => {
            const list = new RxList(rows)
            function App({}: any, {createElement}: RenderContext) {
                return <ul>{list.map(i => <li style={() => ({...hover, zIndex: BigInt(i), position: 'relative'})}>{i}</li>)}</ul>
            }
            return {App, list}
        }
        const server = renderToString(createElement(make([1, 3]).App, null))
        const hyd = parse(`<style data-axii-ssr>${server.styles}</style>${server.html}`)
        const h = make([1, 2, 3])
        const root = hydrateRootTopDown(hyd, createElement(h.App, null))
        const zOf = () => Array.from(hyd.querySelectorAll('li')).map(li => getComputedStyle(li).zIndex)
        expect({z: zOf(), reported: mismatches() > 0, others: others()}).toEqual({z: ['1', '2', '3'], reported: true, others: []})
        h.list.push(4)
        await tick()
        expect(zOf()).toEqual(['1', '2', '3', '4'])
        root.destroy()
    })
})

describe('independent review findings (B3)', () => {
    test('an error thrown while a function child\'s structure is activated aborts the activation even with an error listener (B1: no "render empty" on the cursor); the cursor is restored', () => {
        const caught: unknown[] = []
        const make = (clientBroken: boolean) => {
            function Bad({}: any, {createElement}: RenderContext) {
                // 客户端独有的非法 child：createHydrateHost 的 unknown child type 断言
                return <span>{clientBroken ? new Date(0) as any : 'ok'}</span>
            }
            return function App({}: any, {createElement, pathContext}: RenderContext) {
                if (pathContext) pathContext.root.on('error', (e: unknown) => { caught.push(e) })
                return <div>{() => <p><Bad/></p>}<i>x</i></div>
            }
        }
        const hyd = parse(htmlOf(make(false)))
        expect(() => hydrateRootTopDown(hyd, createElement(make(true), null))).toThrow('unknown child type')
        expect(caught).toEqual([])
        // 激活的状态已恢复：下一次激活从自己的容器开始
        const again = parse(htmlOf(make(false)))
        hydrateRootTopDown(again, createElement(make(false), null))
        expect(kids(again)).toBe(kids(csrOf(make(false))))
    })

    test.each([
        ['static', () => 'b'],
        ['reactive', () => atom('b')],
    ] as const)('a rebuilt <option> keeps the %s value of its claimed <select>, like CSR', (_name, value) => {
        const make = () => function App({}: any, {createElement}: RenderContext) {
            return <div><select value={value()}><option value="a">A</option><option value="b">B</option></select></div>
        }
        const hyd = parse(htmlOf(make()))
        hyd.querySelector('option[value="b"]')!.remove()
        const select = hyd.querySelector('select')
        hydrateRootTopDown(hyd, createElement(make(), null))
        const csrEl = csrOf(make())
        expect({value: (hyd.querySelector('select') as HTMLSelectElement).value, same: hyd.querySelector('select') === select, dom: kids(hyd), reported: mismatches() > 0})
            .toEqual({value: (csrEl.querySelector('select') as HTMLSelectElement).value, same: true, dom: kids(csrEl), reported: true})
        expect((hyd.querySelector('select') as HTMLSelectElement).value).toBe('b')
    })

    test('raw markup is checked before refs and layout effects run: content they change is kept, like CSR', () => {
        const make = (text: string) => function App({}: any, {createElement}: RenderContext) {
            return <div>
                <span>{text}</span>
                <pre ref={(el: HTMLElement | null) => { el?.firstElementChild?.classList.add('hl') }} dangerouslySetInnerHTML={{__html: '<code>x</code>'}}/>
            </div>
        }
        const hyd = parse(htmlOf(make('server')))
        hydrateRootTopDown(hyd, createElement(make('client'), null))
        expect({dom: kids(hyd), reported: mismatches() > 0}).toEqual({dom: kids(csrOf(make('client'))), reported: true})
        expect(hyd.querySelector('pre code')!.className).toBe('hl')
    })

    test('template whitespace around the server HTML in the container is removed without rebuilding the root element', () => {
        function App({}: any, {createElement}: RenderContext) { return <main><input/><p>x</p></main> }
        const hyd = parse(`\n    ${htmlOf(App)}\n  `)
        const [main, input] = [hyd.querySelector('main'), hyd.querySelector('input')]
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), kept: [hyd.querySelector('main') === main, hyd.querySelector('input') === input], reported: mismatches() > 0})
            .toEqual({dom: kids(csrOf(App)), kept: [true, true], reported: true})
    })

    test('onError runs outside the activation context: JSX it creates and list rows it adds are real nodes, like CSR', () => {
        const list = new RxList([1, 2])
        function App({}: any, {createElement}: RenderContext) {
            return <div><ul>{list.map(i => <li>{i}</li>)}</ul><p>{'client'}</p></div>
        }
        const html = htmlOf(App)
        const hyd = parse(html.replace('client', 'server'))
        const made: unknown[] = []
        configureDiagnostics({enabled: true, onError: (e: unknown) => {
            reports.push(e)
            made.push(createElement('b', null))
            if (list.data.length < 3) list.push(3)
        }})
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({rows: Array.from(hyd.querySelectorAll('li')).map(li => li.textContent), made: made.every(n => n instanceof HTMLElement), others: others()})
            .toEqual({rows: ['1', '2', '3'], made: true, others: []})
    })

    test('the subtree of an approximate claim is approximate too: server-only attributes of its children are cleared (§4.1)', () => {
        function App({}: any, {createElement}: RenderContext) { return <div><span id="a"><i>x</i></span></div> }
        const hyd = parse(htmlOf(App))
        const span = hyd.querySelector('span')!
        span.id = 'z'
        span.querySelector('i')!.setAttribute('data-junk', '1')
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({dom: kids(hyd), mismatches: mismatches()}).toEqual({dom: kids(csrOf(App)), mismatches: 1})
    })
})
