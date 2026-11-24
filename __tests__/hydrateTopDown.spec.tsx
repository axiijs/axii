/** @jsx createElement */
/**
 * #55 B1：自顶向下认领的激活（hydrateRoot）的行为，设计 docs/ssr-support/hydration-top-down.md。B1–B4 期间经不导出的
 * 内部入口落地，#55 S 起它就是公开的 hydrateRoot。激活相关的既有用例经 __tests__/helpers/hydrate.ts 跑两遍（诊断开、关）；
 * 这里补它们没有覆盖、只属于这个认领模型的契约：元数据与 CSR 逐项相同（§2.6.1）、子 Host 的构造顺序（§2.4）、
 * 认领元素的转交字段（§3.2 B1 行）、激活中止不被 error 监听器吞掉、根的各种 source、开发期不变量（§4.4）、
 * B4 之前显式抛错的形态（§7.2）现在 ≡ CSR。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {
    configureDiagnostics,
    createElement,
    createRoot,
    lazy,
    Portal,
    type RenderContext,
} from '@framework'
import {renderToString} from '../src/ssr.js'
import {hydrateRoot} from '../src/hydrateRoot'
import {HydrationMismatchError} from '../src/hydration'
import {isHydrationElement} from '../src/hydrationElement'
import {componentTypeIds} from '../src/styleSerialize'
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

function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
function ssrInto(source: any): HTMLElement {
    const el = mount()
    el.innerHTML = renderToString(source).html
    return el
}
/** DOM 形状：去掉 axii:* 标记与空 Text（激活前后的差别只在它们） */
function shape(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === '' ? '' : `"${node.nodeValue}"`
    if (node.nodeType === Node.COMMENT_NODE) {
        const d = (node as Comment).data
        return (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') ? '' : `<!--${d}-->`
    }
    const el = node as Element
    const attrs = Array.from(el.attributes).map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
    return `<${el.localName}${attrs ? ' ' + attrs : ''}>${kids(el)}</${el.localName}>`
}
function kids(el: Node): string {
    let s = ''
    el.childNodes.forEach(c => { s += shape(c) })
    return s
}
/** 元素在容器里的位置（子元素下标的路径），用来比较两棵树里「同一个位置」的元素 */
function positionOf(el: Node, container: Node): string {
    const path: number[] = []
    let node: Node | null = el
    while (node && node !== container) {
        const parent: Node | null = node.parentNode
        if (!parent) return 'detached'
        path.unshift(Array.prototype.indexOf.call(parent.childNodes, node))
        node = parent
    }
    return path.join('.')
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('metadata collected by the claim step ≡ CSR createElement (§2.6.1)', () => {
    // 与 elementMetadata.spec 同一棵树：null / false 占下标、Fragment 多一级、自己的 ref 排在子元素的 ref 之前、
    //  ref / detachStyle 的项不继承 source。路径决定样式 id 与 StaticHost 定位元素，必须逐位相同。
    test('reactive attributes, refs and detachStyle: same keys, paths, order and element positions; inner hosts at the same paths', () => {
        const S_OUTER = {fileName: 'outer.tsx', lineNumber: 1, columnNumber: 1}
        const S_MID = {fileName: 'mid.tsx', lineNumber: 2, columnNumber: 2}
        const make = () => {
            const cls = atom('c')
            const title = atom('t')
            const exitStyle = {opacity: 0}
            const refs: string[] = []
            const r1 = () => { refs.push('div') }
            const r2 = () => { refs.push('b') }
            const r3 = () => { refs.push('i') }
            function App({}: any, {createElement, Fragment}: RenderContext) {
                return <section __source={S_OUTER}>
                    {null}{false}
                    <div __source={S_MID} ref={r1}>text<span className={cls} detachStyle={exitStyle}>{() => 'f'}</span></div>
                    <p>{() => 'g'}<b ref={r2} title={title}/></p>
                    <Fragment><i ref={r3} data-x={cls}>{cls}</i>{null}<u>{() => cls()}</u></Fragment>
                </section>
            }
            return {App, cls, refs}
        }
        const csrEl = mount()
        const c = make()
        const csrRoot = createRoot(csrEl)
        csrRoot.render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const h = make()
        const root = hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})

        const describeHost = (staticHost: any, container: Node) => ({
            attrs: (Array.isArray(staticHost.attrEffects) ? staticHost.attrEffects : [staticHost.attrEffects])
                .map((e: any) => ({key: e.key, path: e.path, at: positionOf(e.el, container), source: e.debugSource})),
            refs: staticHost.refHandles.map((r: any) => ({path: r.path, at: positionOf(r.el, container), source: 'source' in r})),
            detach: staticHost.detachStyledChildren.map((d: any) => ({path: d.path, at: positionOf(d.el, container)})),
            hosts: staticHost.reactiveHosts.map((x: any) => ({
                type: x.constructor.name,
                path: x.position?.elementPath ?? x.pathContext.elementPath,
                source: x.position?.debugSource ?? x.pathContext.debugSource,
            })),
        })
        const hydrated = describeHost((root.host as any).innerHost, hyd)
        expect(hydrated).toEqual(describeHost((csrRoot.host as any).innerHost, csrEl))
        // 抽查绝对值，防止两边一起错
        expect(hydrated.refs.map((r: any) => r.path)).toEqual([[2], [3, 1], [4, 0]])
        expect(hydrated.attrs.map((a: any) => [a.key, a.path])).toEqual([['className', [2, 1]], ['title', [3, 1]], ['data-x', [4, 0]]])
        // false（下标 1）是 PrimitiveHost 的动态 child
        expect(hydrated.hosts.map((x: any) => [x.type, x.path])).toEqual([
            ['PrimitiveHost', [1]], ['FunctionHost', [2, 1, 0]], ['FunctionHost', [3, 0]], ['AtomHost', [4, 0, 0]], ['FunctionHost', [4, 2, 0]],
        ])
        // ref 的可观察顺序与 CSR 相同（自己的在前、按文档顺序）
        expect(h.refs).toEqual(c.refs)
        // 绑定照常更新
        for (const s of [c, h]) s.cls('d')
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('the server element is claimed in place: element identity kept, listener args and listeners on the claimed node', () => {
        const make = () => {
            const log: any[] = []
            // 事件回调的第二个参数是外层组件的 props 列表（最近的在前，ComponentHost.getContextComponentProps）
            function Item({}: any, {createElement}: RenderContext) {
                return <button onClick={(e: Event, context: any[]) => log.push(context[0].label)}>x</button>
            }
            function Outer({}: any, {createElement}: RenderContext) { return <Item/> }
            function App({}: any, {createElement}: RenderContext) {
                return <div><Outer label="a"/><Outer label="b"/></div>
            }
            return {App, log}
        }
        const hyd = ssrInto(createElement(make().App, null))
        const before = Array.from(hyd.querySelectorAll('button'))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        const after = Array.from(hyd.querySelectorAll('button'))
        expect(after).toEqual(before)
        after[1].click()
        after[0].click()
        // listenerBoundArgs 由 ComponentHost 写在描述上，认领时转交给元素（§3.2 B1 行）
        expect(h.log).toEqual(['b', 'a'])
        expect(reports).toEqual([])
    })
})

describe('server forms that are easy to misread (review findings)', () => {
    // 服务端对「null / undefined 之外唯一的 ''」不写 axii:0，元素与 Fragment 的 children 各自判定；
    //  见到 axii:0 就拿的话，Fragment 里的 '' 会拿走后面 atom 的哨兵，atom 再认领时失配
    test.each([
        ['Fragment whose only child is "" before an empty atom', (a: any, createElement: any, Fragment: any) => <p><Fragment>{''}</Fragment>{a}</p>],
        ['"" after a null, before an empty atom', (a: any, createElement: any) => <p>{null}{''}</p>],
        ['"" among other children', (a: any, createElement: any) => <p>{''}{a}{'x'}</p>],
        ['function → Fragment with a sole "" before an empty function', (a: any, createElement: any, Fragment: any) => <p>{() => <Fragment>{''}</Fragment>}{() => a()}</p>],
    ])('%s: DOM ≡ CSR, no report', (_name, body) => {
        const make = () => {
            const a = atom('')
            function App({}: any, {createElement, Fragment}: RenderContext) { return body(a, createElement, Fragment) }
            return {App, a}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        expect(hyd.childNodes.length).toBe(csrEl.childNodes.length)
        expect(hyd.firstChild!.childNodes.length).toBe(csrEl.firstChild!.childNodes.length)
        for (const s of [c, h]) s.a('v')
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('a boolean child of <title> / <style> (the server skips it): hydrates in place ≡ CSR', () => {
        const make = () => {
            const dark = atom(false)
            function App({}: any, {createElement}: RenderContext) {
                return <div><title>{false}{'x'}</title><style>{() => dark() && '.d{color:red}'}{false}</style></div>
            }
            return {App, dark}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const title = hyd.querySelector('title')!.firstChild
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        expect(Array.from(hyd.querySelector('title')!.childNodes).map(n => n.nodeType))
            .toEqual(Array.from(csrEl.querySelector('title')!.childNodes).map(n => n.nodeType))
        expect(hyd.querySelector('title')!.childNodes[2]).toBe(title)
    })

    test('a root destroyed and re-rendered by an error listener during the activation renders with CSR; the discarded tree raises nothing beyond its own mismatches', () => {
        const make = (clientThrows: boolean) => function App({}: any, {createElement, pathContext}: RenderContext) {
            if (pathContext) {
                pathContext.root.on('error', () => {
                    pathContext.root.destroy()
                    pathContext.root.render(createElement('p', null, 'fallback'))
                })
            }
            function Bad() { if (clientThrows) throw new Error('client only'); return createElement('b', null, 'ok') }
            return <div><Bad/>{'tail'}</div>
        }
        const hyd = ssrInto(createElement(make(false), null))
        const root = hydrateRoot(hyd, createElement(make(true), null))
        // 被丢弃的激活树（B3 起不中止）按 R3 修复完自己的失配：出错的组件渲染为空（<!--empty--> 插入），它的 slot 之前的服务端
        //  <b> 删除。只有这两条认领处的报告，没有容器清扫等后续报告，也没有别的错误
        expect(reports.map(e => (e as Error).message)).toEqual([
            '[axii] hydration mismatch: expected Comment("empty"), got Element(<b>)',
            '[axii] hydration mismatch: expected Comment("unhandledChild"), got Element(<b>)',
        ])
        expect(hyd.querySelector('p')?.textContent).toBe('fallback')
        // 之后 destroy + render 仍是 CSR
        root.destroy()
        root.render(createElement('i', null, 'again'))
        expect(hyd.querySelector('i')?.textContent).toBe('again')
    })

    test('the same JSX element rendered twice in one activation ≡ CSR (C6, #55 B4): the second occurrence moves the claimed node, the server copy goes', () => {
        const make = () => function App({}: any, {createElement}: RenderContext) {
            const s = <span>s</span>
            return <div>{s}{s}</div>
        }
        const csr = mount()
        createRoot(csr).render(createElement(make(), null))
        const hyd = mount()
        hyd.innerHTML = '<div><span>s</span><span>s</span></div><!--root-->'
        const first = hyd.querySelector('span')!
        hydrateRoot(hyd, createElement(make(), null))
        expect({dom: kids(hyd), first: hyd.querySelector('span') === first, reports}).toEqual({dom: kids(csr), first: true, reports: []})
    })
})

describe('§3.2 B1 call points: $name:_use and $name:_eventTarget', () => {
    test('$name:_use given a JSX element from the parent: the description is claimed at the named position', () => {
        const make = () => {
            const n = atom(1)
            function Child({}: any, {createElement}: RenderContext) { return <div><span as="box">own</span><i>tail</i></div> }
            function App({}: any, {createElement}: RenderContext) { return <Child $box:_use={<section>{n}</section>}/> }
            return {App, n}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const section = hyd.querySelector('section')
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        expect(hyd.querySelector('section')).toBe(section)
        for (const s of [c, h]) s.n(2)
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('$name:_eventTarget dispatches to the claimed element, not to its description', () => {
        const make = () => {
            const log: string[] = []
            let forward: ((e: Event) => any) | undefined
            function Child({}: any, {createElement}: RenderContext) { return <button as="btn" onClick={() => log.push('clicked')}>b</button> }
            function App({}: any, {createElement}: RenderContext) {
                return <div><Child $btn:_eventTarget={(dispatch: (e: Event) => any) => { forward = dispatch }}/></div>
            }
            return {App, log, forward: (e: Event) => forward!(e)}
        }
        const hyd = ssrInto(createElement(make().App, null))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        h.forward(new MouseEvent('click'))
        expect(h.log).toEqual(['clicked'])
        expect(reports).toEqual([])
    })
})

describe('component boundary and construction order (§2.4)', () => {
    test('all child hosts of a static subtree are constructed before any of them hydrates: component type ids follow CSR order', () => {
        // 服务端 HTML 用另一组同样的组件生成，激活用的组件第一次出现在激活里，类型 id 在这里按构造顺序分配
        const makeTypes = () => {
            function Leaf({}: any, {createElement}: RenderContext) { return <i>leaf</i> }
            function First({}: any, {createElement}: RenderContext) { return <b><Leaf/></b> }
            function Second({}: any, {createElement}: RenderContext) { return <u>second</u> }
            function App({}: any, {createElement}: RenderContext) { return <div><First/><Second/></div> }
            return {App, First, Second, Leaf}
        }
        const hyd = ssrInto(createElement(makeTypes().App, null))
        const t = makeTypes()
        hydrateRoot(hyd, createElement(t.App, null))
        const id = (f: Function) => componentTypeIds.get(f)!
        // CSR：App 的静态子树先构造 First、Second，First 渲染时才构造 Leaf
        expect([id(t.App) < id(t.First), id(t.First) < id(t.Second), id(t.Second) < id(t.Leaf)]).toEqual([true, true, true])
        expect(reports).toEqual([])
    })

    test('nested components share their placeholder with the innermost host; the function child after them claims its own anchor', async () => {
        const make = () => {
            const n = atom(1)
            function Inner({}: any, {createElement}: RenderContext) { return <p>inner</p> }
            function Outer({}: any, {createElement}: RenderContext) { return <Inner/> }
            function App({}: any, {createElement}: RenderContext) { return <div><Outer/>{() => <p>{n()}</p>}<p>tail</p></div> }
            return {App, n}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const h = make()
        const root = hydrateRoot(hyd, createElement(h.App, null))
        const outer = (root.host as any).innerHost.reactiveHosts[0]
        expect(outer.placeholder).toBe(outer.innerHost.placeholder)
        expect(outer.placeholder).toBe(outer.innerHost.innerHost.placeholder)
        expect((outer.placeholder as Comment).data).toBe('unhandledChild')
        for (const s of [c, h]) s.n(2)
        await tick()
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })
})

describe('element claim details (§2.6.1, §2.6.7)', () => {
    test('HTML / SVG shared-name tags as static children of <svg> are claimed as SVG (≡ CSR adoptSvgChild, #56); integration points keep HTML', () => {
        const make = () => {
            const tip = atom('t1')
            function App({}: any, {createElement, Fragment}: RenderContext) {
                return <div>
                    <svg viewBox="0 0 4 4">
                        <title>{tip}</title>
                        <a href="#x"><title>inner</title><path d="M0 0"/></a>
                        <Fragment><style>{'.c{fill:red}'}</style><a href="#y"/></Fragment>
                        <foreignObject><a href="#html">html</a></foreignObject>
                    </svg>
                    <a href="#page">page</a>
                </div>
            }
            return {App, tip}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const serverNodes = Array.from(hyd.querySelectorAll('*'))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        expect(Array.from(hyd.querySelectorAll('*'))).toEqual(serverNodes)
        const ns = (el: Element) => el.namespaceURI!.split('/').pop()
        expect(Array.from(hyd.querySelectorAll('a, title, style')).map(e => `${e.localName}:${ns(e)}`))
            .toEqual(Array.from(csrEl.querySelectorAll('a, title, style')).map(e => `${e.localName}:${ns(e)}`))
        for (const s of [c, h]) s.tip('t2')
        expect(kids(hyd)).toBe(kids(csrEl))
    })

    test('a Fragment source is replaced by a DocumentFragment after the claim: fragment semantics (forceHandleElement) ≡ CSR', () => {
        function Exit({}: any, {createElement}: RenderContext) { return <i detachStyle={{opacity: 0}}>e</i> }
        function C({}: any, {createElement, Fragment}: RenderContext) { return <Fragment><Exit/><b>x</b></Fragment> }
        const csrEl = mount()
        const csrRoot = createRoot(csrEl)
        csrRoot.render(createElement(C, null))
        const hyd = ssrInto(createElement(C, null))
        const root = hydrateRoot(hyd, createElement(C, null))
        const csrHost = (csrRoot.host as any).innerHost
        const host = (root.host as any).innerHost
        expect(host.source).toBeInstanceOf(DocumentFragment)
        expect(host.source.childNodes.length).toBe(0)
        expect(host.forceHandleElement).toBe(csrHost.forceHandleElement)
        expect(host.forceHandleElement).toBe(true)
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })
})

describe('root sources (§2.5 「根」)', () => {
    const cases: [string, () => {source: () => any, update?: () => void}][] = [
        ['atom', () => { const a = atom('a'); return {source: () => a, update: () => a('b')} }],
        ['empty atom', () => { const a = atom(''); return {source: () => a, update: () => a('b')} }],
        ['string', () => ({source: () => 'str'})],
        ['empty string', () => ({source: () => ''})],
        ['boolean', () => ({source: () => false})],
        ['null', () => ({source: () => null})],
        ['function → text', () => { const a = atom('t'); return {source: () => () => a(), update: () => a('u')} }],
        ['function → empty text', () => { const a = atom(''); return {source: () => () => a(), update: () => a('u')} }],
        ['component → function → element', () => {
            const a = atom('t')
            function C({}: any, {createElement}: RenderContext) { return () => <b>{a()}</b> }
            return {source: () => createElement(C, null), update: () => a('u')}
        }],
        ['component → Fragment', () => {
            const a = atom('t')
            function C({}: any, {createElement, Fragment}: RenderContext) { return <Fragment>{a}<i>{() => a()}</i>{''}{'z'}</Fragment> }
            return {source: () => createElement(C, null), update: () => a('u')}
        }],
        ['component → atom', () => { const a = atom('t'); function C() { return a } return {source: () => createElement(C, null), update: () => a('u')} }],
        ['component → null', () => { function C() { return null } return {source: () => createElement(C, null)} }],
    ]
    test.each(cases)('%s: DOM ≡ CSR, no report, server nodes kept, updates ≡ CSR', async (_name, make) => {
        // 激活之外求值的 JSX 元素（hydrateRoot(c, <p/>) 的参数）是现成节点（§2.6.8，B4），元素根用函数 / 组件表达
        const c = make()
        const csrEl = mount()
        const csrRoot = createRoot(csrEl)
        csrRoot.render(c.source())
        const hyd = mount()
        hyd.innerHTML = renderToString(make().source()).html
        const serverNodes = Array.from(hyd.querySelectorAll('*'))
        const h = make()
        const root = hydrateRoot(hyd, h.source())
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        expect(Array.from(hyd.querySelectorAll('*')).filter(e => !serverNodes.includes(e))).toEqual([])
        if (c.update) {
            c.update()
            h.update!()
            await tick()
            expect(kids(hyd)).toBe(kids(csrEl))
        }
        // 销毁与 CSR 相同（Fragment 的 source 认领后换成 DocumentFragment，按 fragment 区间整段删除）
        csrRoot.destroy()
        root.destroy()
        expect(kids(hyd)).toBe(kids(csrEl))
    })
})

describe('mismatches do not abort the activation (B3: §4.2); other errors still do', () => {
    // B1 / B2 在失配处报告并抛出；B3 起失配按 R1–R5 修复、不中止（这两条由「报告并抛出」改成「报告并修复」）
    test('a mismatch is reported once and repaired; an error listener registered by a component does not receive it', () => {
        const caught: unknown[] = []
        const make = (text: string) => function App({}: any, {createElement, pathContext}: RenderContext) {
            // 服务端的 RenderContext 没有 pathContext
            if (pathContext) pathContext.root.on('error', (e: unknown) => { caught.push(e) })
            return <div><p>{() => text}</p></div>
        }
        const hyd = ssrInto(createElement(make('server'), null))
        hydrateRoot(hyd, createElement(make('client'), null))
        expect(reports.length).toBe(1)
        expect(reports[0]).toBeInstanceOf(HydrationMismatchError)
        expect({dom: kids(hyd), caught}).toEqual({dom: '<div><p>"client"</p></div><!--root-->', caught: []})
    })

    test('the activation state is restored after an abort (an error nobody handles): CSR and the next activation work', () => {
        function Throws(): any { throw new Error('render failed') }
        const hyd = ssrInto('server')
        expect(() => hydrateRoot(hyd, createElement(Throws, null))).toThrow('render failed')
        const el = createElement('div', null) as HTMLElement
        expect(el instanceof HTMLDivElement).toBe(true)
        const again = ssrInto('ok')
        hydrateRoot(again, 'ok')
        expect(kids(again)).toBe('"ok"<!--root-->')
    })
})

describe('lists and arrays (B2: §2.5, §2.6.4, §3.3)', () => {
    const OPACITY_0 = {opacity: 0}
    type RowKind = 'compact' | 'non-compact' | 'fragment' | 'component' | 'function'
    const rowKinds: RowKind[] = ['compact', 'non-compact', 'fragment', 'component', 'function']
    // 组件直接返回 RxList（#68 会话报告的形态，B2 追加的验收）：作为激活根（slot 是 root），以及作为元素 child 里的组件
    function makeRows(kind: RowKind, asRoot: boolean) {
        const list = new RxList([1, 2, 3])
        function Item({i}: any, {createElement}: RenderContext) { return <li>c{i}</li> }
        function Rows({}: any, {createElement, Fragment}: RenderContext) {
            return list.map(i =>
                kind === 'compact' ? <li data-i={i}>{i}</li>
                    : kind === 'non-compact' ? <li data-i={i}><b detachStyle={OPACITY_0}>{i}</b></li>
                        : kind === 'fragment' ? <Fragment><li>{i}</li></Fragment>
                            : kind === 'component' ? <Item i={i}/>
                                : () => <li>f{i}</li>)
        }
        function App({}: any, {createElement}: RenderContext) { return <ul><Rows/></ul> }
        return {list, App: asRoot ? Rows : App}
    }
    for (const asRoot of [true, false]) {
        test.each(rowKinds)(`a component returning list.map(...) ${asRoot ? 'as the activation root' : 'inside an element'}, %s rows: ≡ CSR, no report, server nodes kept; patches ≡ CSR`, (kind) => {
            const csrEl = mount()
            const c = makeRows(kind, asRoot)
            createRoot(csrEl).render(createElement(c.App, null))
            const hyd = ssrInto(createElement(makeRows(kind, asRoot).App, null))
            const before = Array.from(hyd.querySelectorAll('li'))
            const h = makeRows(kind, asRoot)
            const root = hydrateRoot(hyd, createElement(h.App, null))
            expect({dom: kids(hyd), reports, kept: Array.from(hyd.querySelectorAll('li')).every((li, i) => li === before[i])})
                .toEqual({dom: kids(csrEl), reports: [], kept: true})
            const findList = (host: any): any => !host ? undefined
                : host.constructor.name === 'RxListHost' ? host
                    : findList(host.innerHost) ?? (Array.isArray(host.reactiveHosts) ? undefined : findList(host.reactiveHosts))
            const rowHosts = findList(root.host).hosts.map((row: any) => row.constructor.name)
            expect(rowHosts).toEqual(Array(3).fill(kind === 'compact' ? 'CompactElementHost'
                : kind === 'component' ? 'ComponentHost' : kind === 'function' ? 'FunctionHost' : 'StaticHost'))
            for (const s of [c, h]) { s.list.push(4); s.list.splice(0, 1); s.list.unshift(0) }
            expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        })
    }

    test('after the activation list.data and array items hold the claimed nodes, never descriptions (§3.3, §5.2)', () => {
        const make = () => {
            const list = new RxList([1, 2])
            const got: {[k: string]: any} = {}
            function App({}: any, {createElement, Fragment}: RenderContext) {
                got.compact = list.map(i => <li>{i}</li>)
                got.nonCompact = list.map(i => <li><b detachStyle={OPACITY_0}>{i}</b></li>)
                got.fragment = list.map(i => <Fragment><i>{i}</i></Fragment>)
                got.nested = list.map(i => new RxList([i, i * 10]).map(j => <s>{j}</s>))
                got.array = [<b>x</b>, 'y', <Fragment><u>f</u></Fragment>, null]
                got.fnArray = undefined
                return <div>
                    <ul>{got.compact}</ul><ul>{got.nonCompact}</ul><p>{got.fragment}</p><p>{got.nested}</p><p>{got.array}</p>
                    {() => (got.fnArray = [<em>e</em>, <em>f</em>])}
                </div>
            }
            return {App, got}
        }
        const kindsOf = (got: any) => ({
            compact: got.compact.data.map((x: any) => x.localName),
            nonCompact: got.nonCompact.data.map((x: any) => x.localName),
            fragment: got.fragment.data.map((x: any) => x.nodeType),
            nestedInner: got.nested.data.map((inner: any) => inner.data.map((x: any) => x.localName)),
            array: got.array.map((x: any) => x?.nodeType ?? x),
            fnArray: got.fnArray.map((x: any) => x.localName),
        })
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const lis = Array.from(hyd.querySelectorAll('ul')).map(ul => Array.from(ul.querySelectorAll(':scope > li')))
        const b = hyd.querySelector('p > b')
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect(reports).toEqual([])
        expect(kindsOf(h.got)).toEqual(kindsOf(c.got))
        // 写回的就是认领到的服务端节点
        expect([h.got.compact.data[0] === lis[0][0], h.got.nonCompact.data[1] === lis[1][1], h.got.array[0] === b])
            .toEqual([true, true, true])
        const descriptions = [h.got.compact, h.got.nonCompact, h.got.fragment, ...h.got.nested.data].flatMap((l: any) => l.data)
            .concat(h.got.array, h.got.fnArray)
            .filter((x: unknown) => isHydrationElement(x))
        expect(descriptions).toEqual([])
    })

    test('rows and array items are all constructed before any of them hydrates: component type ids follow CSR order (§2.4)', () => {
        // CSR：RxListHost 先对每行 createChildHost（组件行在这里构造），再逐行渲染（Compact 行里的组件在这时构造）；
        //  StaticArrayHost 同样先构造全部项再渲染。服务端 HTML 用另一组同样的组件生成，类型 id 在激活里第一次分配
        const makeTypes = () => {
            function RowLeaf({}: any, {createElement}: RenderContext) { return <i>leaf</i> }
            function RowComp({}: any, {createElement}: RenderContext) { return <u>row</u> }
            function ItemLeaf({}: any, {createElement}: RenderContext) { return <i>leaf</i> }
            function ItemComp({}: any, {createElement}: RenderContext) { return <u>item</u> }
            const list = new RxList([0, 1])
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <ul>{list.map(i => i === 0 ? <li><RowLeaf/></li> : <RowComp/>)}</ul>
                    <p>{[<b><ItemLeaf/></b>, <ItemComp/>]}</p>
                </div>
            }
            return {App, RowLeaf, RowComp, ItemLeaf, ItemComp}
        }
        const hyd = ssrInto(createElement(makeTypes().App, null))
        const t = makeTypes()
        hydrateRoot(hyd, createElement(t.App, null))
        const id = (f: Function) => componentTypeIds.get(f)!
        expect({rows: id(t.RowComp) < id(t.RowLeaf), items: id(t.ItemComp) < id(t.ItemLeaf), reports})
            .toEqual({rows: true, items: true, reports: []})
    })

    test('atoms as array items (Comment-ph AtomHost on <!--array item-->), empty and non-empty, next to DirectNodes: hydrates ≡ CSR, updates ≡ CSR', async () => {
        const make = () => {
            const a = atom('')
            const b = atom('y')
            const list = new RxList([1])
            // 组件返回 atom：数组项的 placeholder 由组件与它的 AtomHost 共享
            function C({}: any, {createElement}: RenderContext) { return a }
            function App({}: any, {createElement}: RenderContext) {
                return <div><p>{[a, 'x', b, '']}</p><ul>{list.map(() => [a, <i>i</i>])}</ul><p>{[<C/>, b]}</p></div>
            }
            return {App, a, b}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        // 空值的 Comment-ph 文本单元服务端不写任何节点（#82 之前曾写 axii:0），激活在 placeholder 前插入 Text('')
        expect(hyd.innerHTML).not.toContain('<!--axii:0--><!--array item-->')
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), reports, markers: hyd.innerHTML.includes('axii:')}).toEqual({dom: kids(csrEl), reports: [], markers: false})
        for (const s of [c, h]) { s.a('A'); s.b('') }
        await tick()
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })

    test('an array under an element that only became SVG keeps HTML items like CSR: the parser\'s SVG <title> is reported and rebuilt, not claimed silently', () => {
        // CSR 只在创建时就是 SVG 的元素上改建数组项（adoptSvgArrayItems）；被父元素改建、或作为数组项被改建的 <a> 不改建它的数组项，
        //  其中的 <title> 是 HTML 元素，解析器却按 SVG 解析。激活与 CSR 一致按 HTML 认领，在认领处报告失配，按 R1 新建（B3）
        const ns = (root: Element) => Array.from(root.querySelectorAll('title')).map(n => n.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html')
        const shapes = [
            function App({}: any, {createElement}: RenderContext) { return <svg><a>{[<title>t</title>]}</a></svg> },
            function App({}: any, {createElement}: RenderContext) { return <svg>{[<a>{[<title>t</title>]}</a>]}</svg> },
        ]
        for (const App of shapes) {
            reports = []
            const csrEl = mount()
            createRoot(csrEl).render(createElement(App, null))
            expect(ns(csrEl)).toEqual(['html'])
            const hyd = ssrInto(createElement(App, null))
            hydrateRoot(hyd, createElement(App, null))
            expect({ns: ns(hyd), dom: kids(hyd), reports: reports.length, mismatch: reports[0] instanceof HydrationMismatchError})
                .toEqual({ns: ['html'], dom: kids(csrEl), reports: 1, mismatch: true})
        }
        // 对照：创建时就是 SVG 的元素（<g>）改建它的数组项，激活 ≡ CSR、不报告
        reports = []
        function Control({}: any, {createElement}: RenderContext) { return <svg><g>{[<title>t</title>]}</g></svg> }
        const csrEl = mount()
        createRoot(csrEl).render(createElement(Control, null))
        const hyd = ssrInto(createElement(Control, null))
        hydrateRoot(hyd, createElement(Control, null))
        expect({ns: ns(hyd), dom: kids(hyd), reports}).toEqual({ns: ['svg'], dom: kids(csrEl), reports: []})
    })

    test('a frozen array hydrates ≡ CSR: its items are not written back (that would throw in strict mode)', () => {
        let frozen: any[] = []
        function App({}: any, {createElement}: RenderContext) {
            frozen = Object.freeze([<b>x</b>, 'y', <i>z</i>]) as any[]
            return <p>{frozen}</p>
        }
        const csrEl = mount()
        createRoot(csrEl).render(createElement(App, null))
        const hyd = ssrInto(createElement(App, null))
        hydrateRoot(hyd, createElement(App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        // 已知：冻结的数组里留着认领过的描述壳（不能写回）
        expect(isHydrationElement(frozen[0])).toBe(true)
    })

    test('development invariants on a list / array longer than the argument-count limit: no RangeError (diagnostics on)', () => {
        const N = 150000
        const make = () => {
            const list = new RxList(Array.from({length: N}, (_, i) => i))
            return function App({}: any, {createElement}: RenderContext) {
                return <div>{list.map(() => <i/>)}{Array.from({length: N}, () => <b/>)}</div>
            }
        }
        const hyd = ssrInto(createElement(make(), null))
        hydrateRoot(hyd, createElement(make(), null))
        expect({rows: hyd.querySelectorAll('i').length + hyd.querySelectorAll('b').length, reports}).toEqual({rows: 2 * N, reports: []})
    })

    test('the same JSX element twice as array items / list rows ≡ CSR (C6, #55 B4)', () => {
        const shapes = [
            () => function App({}: any, {createElement}: RenderContext) { const s = <span>s</span>; return <div>{[s, s]}</div> },
            () => {
                const list = new RxList([1, 2])
                return function App({}: any, {createElement}: RenderContext) { const s = <span>s</span>; return <ul>{list.map(() => s)}</ul> }
            },
        ]
        for (const make of shapes) {
            reports = []
            const csr = mount()
            createRoot(csr).render(createElement(make(), null))
            const hyd = mount()
            // 服务端写两份；CSR 第二次插入把同一个节点挪走
            hyd.innerHTML = renderToString(createElement(make(), null)).html
            hydrateRoot(hyd, createElement(make(), null))
            // 同一个元素渲染两次是误用：CSR 里第一个 Host 的区间也随之断开（它的元素被第二次插入挪走），CSR 不检查；
            //  激活的开发期不变量（§4.4）把这个与 CSR 相同的状态报告出来，没有失配
            expect({dom: kids(hyd), mismatches: reports.filter(e => e instanceof HydrationMismatchError)}).toEqual({dom: kids(csr), mismatches: []})
        }
    })

    test('map(f).filter(p): rows the predicate admits again after the activation are the claimed elements, Compact like CSR (§3.3, #55 B4)', () => {
        // 写回只覆盖被渲染的 filter 列表；上游 map 的 data 仍是（已认领、瘦身的）描述，谓词重新放行时插入的是它们。
        //  RxListHost.createChildHost 按描述的 node 重新走 Compact 判定：行是同一批元素、没有 <!--rx list item-->，≡ CSR
        const list = new RxList([1, 2])
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <ul>{list.map(i => <li>{i}</li>).filter(() => show())}</ul>
        }
        const hyd = ssrInto(createElement(App, null))
        const rows = Array.from(hyd.querySelectorAll('li'))
        hydrateRoot(hyd, createElement(App, null))
        show(false)
        show(true)
        expect({dom: kids(hyd), same: Array.from(hyd.querySelectorAll('li')).every((li, i) => li === rows[i]), reports})
            .toEqual({dom: '<ul><li>"1"</li><li>"2"</li><!--unhandledChild--></ul><!--root-->', same: true, reports: []})
    })

    test('development invariants (§4.4) walk list rows and array items; Compact rows (no placeholder of their own) are not misreported', () => {
        const kinds = (App: any) => {
            reports = []
            const el = mount()
            el.innerHTML = renderToString(createElement(App, null)).html
            hydrateRoot(el, createElement(App, null))
            return reports.map((e: any) => `${e.code}: ${String(e.message).replace(/^\[axii\] hydration invariant broken: | \(AXII_HYDRATION_INVARIANT\)$/g, '')}`)
        }
        const removeNext = (el: Element | null) => { if (el) el.nextSibling?.remove() }
        // 匹配路径：Compact 行、非 Compact 行、数组项都不报告
        expect(kinds(function App({}: any, {createElement}: RenderContext) {
            return <div><ul>{new RxList([1, 2]).map(i => <li>{i}</li>)}</ul><p>{[<b>x</b>, () => 'y']}</p></div>
        })).toEqual([])
        // ref 在激活结束前执行：拿掉非 Compact 行自己的 <!--rx list item-->、数组项自己的 <!--array item-->
        expect(kinds(function App({}: any, {createElement}: RenderContext) {
            return <ul>{new RxList([1]).map(i => <li ref={removeNext}><b detachStyle={OPACITY_0}>{i}</b></li>)}</ul>
        })).toEqual(['AXII_HYDRATION_INVARIANT: StaticHost.placeholder is not in the document'])
        expect(kinds(function App({}: any, {createElement}: RenderContext) {
            return <p>{[<b ref={removeNext}>x</b>]}</p>
        })).toEqual(['AXII_HYDRATION_INVARIANT: StaticHost.placeholder is not in the document'])
        // Compact 行的元素被拿出文档：列表自己的区间（从第一行开始）也断开
        expect(kinds(function App({}: any, {createElement}: RenderContext) {
            return <ul>{new RxList([1]).map(i => <li ref={(el: Element | null) => { el?.remove() }}>{i}</li>)}</ul>
        })).toEqual([
            'AXII_HYDRATION_INVARIANT: RxListHost range [element … placeholder] is not reachable',
            'AXII_HYDRATION_INVARIANT: CompactElementHost.element is not in the document',
        ])
    })

    test('hydrate + destroy returns host / binding counters to zero (B2 kinds: RxListHost, CompactElementHost, StaticArrayHost)', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const list = new RxList([1, 2])
            const label = atom('x')
            function Item({i}: any, {createElement}: RenderContext) { return <em>{i}</em> }
            function App({}: any, {createElement, Fragment}: RenderContext) {
                return <div>
                    <ul>{list.map(i => <li className={() => label()}>{i}{label}</li>)}</ul>
                    <ul>{list.map(i => <li><b detachStyle={OPACITY_0}>{i}</b></li>)}</ul>
                    <p>{list.map(i => <Item i={i}/>)}{list.map(i => <Fragment>{i}{() => label()}</Fragment>)}</p>
                    <p>{[<b>{label}</b>, 'y', () => label(), new RxList([3]).map(i => <s>{i}</s>), null, false]}</p>
                </div>
            }
            const hyd = ssrInto(createElement(App, null))
            const root = hydrateRoot(hyd, createElement(App, null))
            expect(reports).toEqual([])
            const mid = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect([mid.hosts.activeByType.RxListHost, mid.hosts.activeByType.CompactElementHost, mid.hosts.activeByType.StaticArrayHost])
                .toEqual([5, 3, 1])
            list.push(3)
            list.splice(0, 1)
            label('z')
            await tick()
            root.destroy()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect([after.hosts.totalActive, after.lightBindings.totalActive, after.compactListHosts.active])
                .toEqual([0, 0, 0])
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })
})

describe('the shapes that were explicit throws until #55 B4 now hydrate ≡ CSR (§7.2)', () => {
    // 第四项：服务端 HTML（缺省时用 renderToString 生成）。现成节点在服务端没有对应的写法，给出它所在元素的形状
    const shapes: [string, () => any, string?][] = [
        ['Portal', () => function App({}: any, {createElement}: RenderContext) { return <div><Portal container="td-portal" content={<b>p</b>}/></div> }],
        ['lazy', () => { const L = lazy(() => new Promise(() => {}), () => 'loading'); return function App({}: any, {createElement}: RenderContext) { return <div><L/></div> } }],
        ['reusable', () => function App({}: any, {createElement, reusable}: RenderContext) { return <div>{reusable(<b>r</b>)}</div> }],
        ['a live node', () => { const live = document.createElement('b'); return function App({}: any, {createElement}: RenderContext) { return <div>{live}</div> } }, '<div></div><!--root-->'],
    ]
    test.each(shapes)('%s', (_name, make, html) => {
        const portal = () => { const el = mount(); el.id = 'td-portal'; return el }
        const csrPortal = portal()
        const csr = mount()
        createRoot(csr).render(createElement(make(), null))
        const csrPortalDom = kids(csrPortal)
        csrPortal.remove()
        const hydPortal = portal()
        const hyd = mount()
        if (html !== undefined) {
            hyd.innerHTML = html
        } else {
            const ssr = renderToString(createElement(make(), null))
            hyd.innerHTML = ssr.html
            if (ssr.portals['td-portal']) hydPortal.innerHTML = ssr.portals['td-portal'].html
        }
        const root = hydrateRoot(hyd, createElement(make(), null))
        expect({dom: kids(hyd), portal: kids(hydPortal), mismatches: reports.filter(e => e instanceof HydrationMismatchError)})
            .toEqual({dom: kids(csr), portal: csrPortalDom, mismatches: []})
        root.destroy()
    })
})

describe('retained objects (§5.2)', () => {
    test('hydrate + destroy returns host / binding / style counters to zero (B1 kinds)', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const label = atom('x')
            const on = atom(true)
            const refs: unknown[] = []
            function Badge({}: any, {createElement, useEffect}: RenderContext) {
                useEffect(() => () => {})
                return <b className={() => label()}>{label}</b>
            }
            function Rows({}: any, {createElement, Fragment}: RenderContext) {
                return <Fragment><i ref={(el: unknown) => refs.push(el)}>{() => label() + '!'}</i>{false}{null}</Fragment>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div style={{color: 'red', '&:hover': {color: 'blue'}}}>
                    <Badge/>
                    {() => on() ? <p>{label}</p> : 'off'}
                    <Rows/>
                    {() => label()}
                </div>
            }
            const {html, styles} = renderToString(createElement(App, null))
            const hyd = mount()
            hyd.innerHTML = styles ? `<style data-axii-ssr>${styles}</style>${html}` : html
            const root = hydrateRoot(hyd, createElement(App, null))
            expect(reports).toEqual([])
            const mid = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(mid.hosts.totalActive).toBeGreaterThan(0)
            expect(mid.lightBindings.totalActive).toBeGreaterThan(0)
            on(false)
            label('y')
            await tick()
            root.destroy()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(after.hosts.totalActive).toBe(0)
            expect(after.lightBindings.totalActive).toBe(0)
            expect(after.styles.activeHostStyleStates).toBe(0)
            expect(refs.length).toBe(2)
            expect(refs[1]).toBe(null)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })
})

describe('server / CSR agreement found in B1 (fixed in #82)', () => {
    // 函数结构态的值又是（非 atom 的）函数：CSR 里内层 FunctionHost 的 placeholder 是外层的 <!--computed node-->（Comment-ph）。
    //  服务端曾经经 serializeChild 按 Text-ph 写内层（多一个 axii:0），新模型在认领处报告失配并抛出。#82 在服务端修复
    //  （ssr.serializeStructureResult 按 Comment-ph 的分派写），这条由 test.fails 翻转为 test；两个入口的覆盖见
    //  ssrHydrate.functionValues.spec.tsx。
    test('function child returning a function returning "" / an element: hydrates ≡ CSR without a report', () => {
        for (const inner of [() => '', (createElement: any) => <b>e</b>]) {
            reports = []
            function App({}: any, {createElement}: RenderContext) { return <div>{() => () => inner(createElement)}<i>tail</i></div> }
            const csrEl = mount()
            createRoot(csrEl).render(createElement(App, null))
            const hyd = ssrInto(createElement(App, null))
            hydrateRoot(hyd, createElement(App, null))
            expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
        }
    })
})

describe('server / CSR agreement found in B2 (fixed in #82)', () => {
    // 函数结构态的值是 RxList（{() => list.map(...)}）：CSR 里 RxListHost 的 placeholder 就是 FunctionHost 的 <!--computed node-->。
    //  服务端曾经经 serializeChild 按「元素 child」写这个列表，行之后多一个 <!--unhandledChild-->：旧模型把它留在 DOM 里，
    //  之后 push 的行插在它后面；新模型在认领 <!--computed node--> 处报告失配并抛出。#82 在服务端按 Comment-ph 的分派修复
    //  （ssr.serializeStructureResult → serialize），B2 写下这条时是 test.fails，合入 #82 之后翻转为 test。
    test('function child returning list.map(...): hydrates ≡ CSR without a report, push ≡ CSR', () => {
        const make = () => {
            const list = new RxList([1, 2])
            function App({}: any, {createElement}: RenderContext) { return <div>{() => list.map(i => <li>{i}</li>)}<p>x</p></div> }
            return {list, App}
        }
        const csrEl = mount()
        const c = make()
        createRoot(csrEl).render(createElement(c.App, null))
        const hyd = ssrInto(createElement(make().App, null))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null))
        for (const s of [c, h]) s.list.push(3)
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })
})

describe('a hole in a sparse static array (server / CSR disagreement, fixed in #85)', () => {
    // CSR 的 StaticArrayHost.render 用 forEach，跳过空位；服务端 serializeStaticArray 曾经用 for…of，为空位写 <!--empty--><!--array item-->。
    //  #85 在服务端修复（与 forEach 一样跳过空位）：renderToString 的输出激活后 ≡ CSR，不报告（各位置的覆盖见 ssrHydrate.sparseArrays.spec）。
    test('the server skips the hole like CSR: the activation reports nothing and ≡ CSR', () => {
        // eslint-disable-next-line no-sparse-arrays
        function App({}: any, {createElement}: RenderContext) { return <p>{['a', , 'b']}</p> }
        const csrEl = mount()
        createRoot(csrEl).render(createElement(App, null))
        const hyd = ssrInto(createElement(App, null))
        expect(hyd.innerHTML).not.toContain('<!--empty-->')
        hydrateRoot(hyd, createElement(App, null))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csrEl), reports: []})
    })

    // #85 之前的服务端写出的 HTML（逐字）：激活与 CSR 一样跳过空位，服务端多写的部分在认领处报告失配、按 R2 / R3 删除（B3），
    //  不静默地多建一个 EmptyHost、在 DOM 里多留两个注释。
    test('the activation follows CSR (the hole is skipped), reports the extra server markup and removes it', () => {
        // eslint-disable-next-line no-sparse-arrays
        function App({}: any, {createElement}: RenderContext) { return <p>{['a', , 'b']}</p> }
        const hyd = mount()
        hyd.innerHTML = '<p><!--axii:t-->a<!--axii:/t--><!--empty--><!--array item--><!--axii:t-->b<!--axii:/t--><!--unhandledChild--></p><!--root-->'
        expect(hyd.innerHTML).toContain('<!--empty--><!--array item-->')
        hydrateRoot(hyd, createElement(App, null))
        const csrEl = mount()
        createRoot(csrEl).render(createElement(App, null))
        expect({dom: kids(hyd), reported: reports.length > 0, all: reports.every(e => e instanceof HydrationMismatchError)})
            .toEqual({dom: kids(csrEl), reported: true, all: true})
    })
})

describe('development invariants after the activation (§4.4)', () => {
    test('a host range broken during the activation is reported as AXII_HYDRATION_INVARIANT (diagnostics on only)', () => {
        const make = () => function App({}: any, {createElement}: RenderContext) {
            return <div><span ref={() => {}}>x</span>{() => 'y'}</div>
        }
        const html = renderToString(createElement(make(), null)).html
        const hyd = mount()
        hyd.innerHTML = html
        hydrateRoot(hyd, createElement(make(), null))
        expect(reports).toEqual([])

        // ref 在激活结束前（attach 派发时）执行；拿掉元素后面组件的 placeholder，组件与它的 StaticHost 的区间断开
        function Comp({}: any, {createElement}: RenderContext) {
            return <span ref={(el: Element | null) => { if (el) el.nextSibling?.remove() }}>x</span>
        }
        const Broken = function App({}: any, {createElement}: RenderContext) { return <div><Comp/></div> }
        for (const enabled of [true, false]) {
            reports = []
            configureDiagnostics({enabled, onError: (e: unknown) => { reports.push(e) }})
            const el = mount()
            el.innerHTML = renderToString(createElement(Broken, null)).html
            hydrateRoot(el, createElement(Broken, null))
            const codes = reports.map((e: any) => e.code)
            if (enabled) {
                expect(codes.length).toBeGreaterThan(0)
                expect(new Set(codes)).toEqual(new Set(['AXII_HYDRATION_INVARIANT']))
            } else {
                expect(codes).toEqual([])
            }
        }
    })
})
