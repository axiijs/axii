/** @jsx createElement */
/**
 * #82：结构态函数的值又是函数（`{() => () => x}`）、RxList、reusable，以及数组项是 atom 时，服务端写出的形态与 CSR 不同。
 *  CSR 里这些值都由 createHost 放在一个 Comment placeholder 上（函数结果在外层的 <!--computed node--> 上，数组项在
 *  <!--array item--> 上）：内层函数是 Comment-ph 的 FunctionHost，空文本单元不写任何节点。服务端曾经按元素 child 的
 *  分派写函数结果（内层函数按 Text-ph 写，多一个 axii:0；RxList / reusable 后面多一个 unhandledChild），数组项里的
 *  atom 按 Text-ph 写（空值多一个 axii:0）。旧模型激活后留下这些节点或抛错，新模型报告失配并抛出。
 *
 * Oracles：
 *  - 每个改动位置的服务端 HTML 逐字比较（标记是否多余，解析后的形状看不出来）；
 *  - 解析后的服务端 HTML ≡ CSR；
 *  - 激活（经 helpers/hydrate，旧入口与内部入口两遍）：不报告、不抛错、服务端元素原地保留、不留下 axii:* 标记、DOM ≡ CSR；
 *  - 之后的更新（内层值在文本 / 空 / 元素 / atom / null 之间切换，外层函数换掉内层函数）每一步都 ≡ CSR。
 * Run: npx vitest run __tests__/ssrHydrate.functionValues.spec.tsx
 */
import {createElement, createRoot, configureDiagnostics, RenderContext} from '@framework'
import {atom, RxList} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate, pendingTopDown} from './helpers/hydrate'

let reports: string[]
beforeEach(() => {
    document.body.innerHTML = ''
    reports = []
    configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push((e as any)?.message ?? String(e)) }})
})
afterEach(() => {
    configureDiagnostics({})
})

/** DOM 形状：去掉 axii:* 标记与空 Text（激活前后的差别只在它们），属性排序 */
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
/** 激活之后还留在 DOM 里的 axii:* 标记（CSR 里没有这些节点） */
function markersIn(root: Node): string[] {
    const found: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const d = (n as Comment).data
        if (d.startsWith('axii:')) found.push(d)
    }
    return found
}
function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
const tick = () => new Promise(r => setTimeout(r, 0))
const elementsOf = (root: Element) => Array.from(root.querySelectorAll('*'))
const sameNodes = (a: Element[], b: Element[]) => a.length === b.length && a.every((n, i) => n === b[i])

type Scenario = {source: () => any, updates: (() => void)[]}

/**
 * 三份独立的场景实例：服务端 HTML、CSR root、激活的 root。先比较解析结果与激活结果，再对 CSR 与激活的 root
 * 逐步做同样的更新，每一步比较 DOM。
 */
async function check(make: () => Scenario) {
    const html = renderToString(make().source()).html
    const parsed = mount()
    parsed.innerHTML = html
    const c = make()
    const client = mount()
    createRoot(client).render(c.source())
    expect(kids(parsed)).toBe(kids(client))

    const h = make()
    const hyd = mount()
    hyd.innerHTML = html
    const before = elementsOf(hyd)
    hydrate(hyd, h.source())
    expect({dom: kids(hyd), markers: markersIn(hyd), same: sameNodes(elementsOf(hyd), before), reports})
        .toEqual({dom: kids(client), markers: [], same: true, reports: []})

    for (let i = 0; i < c.updates.length; i++) {
        c.updates[i]()
        h.updates[i]()
        await tick()
        expect({step: i, dom: kids(hyd)}).toEqual({step: i, dom: kids(client)})
    }
    expect(reports).toEqual([])
}

// ───────────────────────── 服务端 HTML（逐字） ─────────────────────────
describe('#82 server HTML: a structure value is written as createHost(value, <Comment placeholder>)', () => {
    const app = (body: (ctx: RenderContext) => any) => function App({}: any, ctx: RenderContext) { return body(ctx) }
    const cases: [string, () => any, string][] = [
        // 外层是 Text-ph（元素 child）的 FTS：[内层的内容, 外层 computed node, axii:0]；内层是 Comment-ph，空值不写节点
        ['fn → fn → ""', () => createElement(app(({createElement}) => <div>{() => () => ''}</div>), null),
            '<div><!--computed node--><!--axii:0--></div><!--root-->'],
        ['fn → fn → null', () => createElement(app(({createElement}) => <div>{() => () => null}</div>), null),
            '<div><!--computed node--><!--axii:0--></div><!--root-->'],
        ['fn → fn → "x"', () => createElement(app(({createElement}) => <div>{() => () => 'x'}</div>), null),
            '<div><!--axii:t-->x<!--axii:/t--><!--computed node--><!--axii:0--></div><!--root-->'],
        // 内层结构态（FCS）：[元素, 内层 computed node]，然后是外层的 computed node 与 axii:0
        ['fn → fn → element', () => createElement(app(({createElement}) => <div>{() => () => <b>e</b>}</div>), null),
            '<div><b><!--axii:t-->e<!--axii:/t--></b><!--computed node--><!--computed node--><!--axii:0--></div><!--root-->'],
        ['fn → fn → atom', () => createElement(app(({createElement}) => <div>{() => () => atom('a')}</div>), null),
            '<div>a<!--computed node--><!--computed node--><!--axii:0--></div><!--root-->'],
        ['fn → fn → fn → ""', () => createElement(app(({createElement}) => <div>{() => () => () => ''}</div>), null),
            '<div><!--computed node--><!--computed node--><!--axii:0--></div><!--root-->'],
        // RxList / reusable 的 placeholder 是 computed node，没有元素 child 的 unhandledChild
        ['fn → RxList', () => createElement(app(({createElement}) => <div>{() => new RxList([1, 2]).map(i => <b>{i}</b>)}</div>), null),
            '<div><b><!--axii:t-->1<!--axii:/t--></b><b><!--axii:t-->2<!--axii:/t--></b><!--computed node--><!--axii:0--></div><!--root-->'],
        ['fn → reusable', () => createElement(app(({createElement, reusable}) => <div>{() => reusable(<b>r</b>)}</div>), null),
            '<div><b><!--axii:t-->r<!--axii:/t--></b><!--reusable--><!--computed node--><!--axii:0--></div><!--root-->'],
        // Comment-ph 的外层（组件根 / 根 / 列表行 / 数组项）：外层自己也不写 axii:0
        ['component root: fn → fn → ""', () => createElement(app(() => () => () => ''), null),
            '<!--computed node--><!--root-->'],
        ['root: fn → fn → ""', () => () => () => '',
            '<!--computed node--><!--root-->'],
        ['list row: fn → fn → ""', () => createElement(app(({createElement}) => <div>{new RxList([1]).map(() => () => () => '')}</div>), null),
            '<div><!--computed node--><!--rx list item--><!--unhandledChild--></div><!--root-->'],
        ['array item: fn → fn → ""', () => createElement(app(({createElement}) => <div>{[() => () => '']}</div>), null),
            '<div><!--computed node--><!--array item--><!--unhandledChild--></div><!--root-->'],
        // 数组项里的 atom 是 Comment-ph 的 AtomHost（placeholder 是 array item），不是 DirectNodes
        ['array item: empty atom', () => createElement(app(({createElement}) => <div>{[atom(''), 's']}</div>), null),
            '<div><!--array item--><!--axii:t-->s<!--axii:/t--><!--unhandledChild--></div><!--root-->'],
        ['array item: atom', () => createElement(app(({createElement}) => <div>{[atom('a')]}</div>), null),
            '<div><!--axii:t-->a<!--axii:/t--><!--array item--><!--unhandledChild--></div><!--root-->'],
    ]
    test.each(cases)('%s', (_name, source, expected) => {
        expect(renderToString(source()).html).toBe(expected)
    })
})

// ───────────────────────── 激活与更新 ─────────────────────────
type Kind = 'text' | 'empty' | 'element' | 'atom' | 'emptyAtom' | 'null' | 'fnElement'
const KINDS: Kind[] = ['text', 'empty', 'element', 'atom', 'emptyAtom', 'null', 'fnElement']

/**
 * 一个场景：外层函数读 kind、返回一个新的内层函数（kind 变化 = 外层重算、换掉内层函数）；内层函数按 kind 返回
 * 文本 / 空 / 元素 / atom / null / 再一层函数（读 txt：txt 变化 = 内层重算）。
 */
function nested(initial: Kind, textOnly = false) {
    const kind = atom<Kind>(initial)
    const txt = atom('t')
    const a = atom('a')
    const e = atom('')
    const valueOf = (k: Kind, createElement: any): any => {
        switch (k) {
            case 'text': return txt()
            case 'empty': return ''
            case 'element': return <b>{txt}</b>
            case 'atom': return a
            case 'emptyAtom': return e
            case 'null': return null
            case 'fnElement': return () => <b>{txt()}</b>
        }
    }
    const fn = (createElement?: any) => () => {
        const k = kind()
        return () => valueOf(k, createElement)
    }
    const order: Kind[] = textOnly ? ['text', 'empty', 'atom', 'emptyAtom', 'null'] : KINDS
    const updates: (() => void)[] = [() => txt('u'), () => a('b'), () => e('c')]
    for (const k of order) updates.push(() => kind(k), () => txt(txt() + '!'))
    updates.push(() => kind(initial), () => e(''))
    return {fn, updates}
}

describe('#82 hydration ≡ CSR: function child whose value is a function', () => {
    const positions: [string, (fn: (ce: any) => () => any) => (ctx: RenderContext) => any][] = [
        ['element child', (fn) => ({createElement}) => <div>{fn(createElement)}<i>tail</i></div>],
        ['element child after a text', (fn) => ({createElement}) => <div>{'a'}{fn(createElement)}</div>],
        ['component root', (fn) => ({createElement}) => fn(createElement)],
        ['Fragment child', (fn) => ({createElement, Fragment}) => <Fragment>{'h'}{fn(createElement)}{'t'}</Fragment>],
    ]
    const cases = positions.flatMap(([p, body]) => KINDS.map(k => [p, k, body] as const))
    test.each(cases)('%s, inner value %s: parse ≡ CSR, in place, no report, no marker left, updates ≡ CSR', async (_p, k, body) => {
        await check(() => {
            const {fn, updates} = nested(k)
            function App({}: any, ctx: RenderContext) { return body(fn)(ctx) }
            return {source: () => createElement(App, null), updates}
        })
    })

    // 根上的函数（render(() => …)）：值不经组件，用不到 createElement 的形态
    test.each(['text', 'empty', 'atom', 'emptyAtom', 'null'] as Kind[])('root, inner value %s', async (k) => {
        await check(() => {
            const {fn, updates} = nested(k, true)
            return {source: () => fn(), updates}
        })
    })
})

describe('#82 hydration ≡ CSR: list rows / array items / RxList and array values (#55 B2 on the internal entry)', () => {
    test.skipIf(pendingTopDown('B2')).each(KINDS)('list row and array items are a function returning a function (%s)', async (k) => {
        await check(() => {
            const {fn, updates} = nested(k)
            const rows = new RxList([1, 2])
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <p>{rows.map(() => fn(createElement))}</p>
                    <p>{[fn(createElement), <i>tail</i>]}</p>
                    <p>{['s', fn(createElement)]}</p>
                </div>
            }
            return {source: () => createElement(App, null), updates: [...updates, () => rows.push(3), () => rows.splice(0, 1)]}
        })
    })

    test.skipIf(pendingTopDown('B2'))('function returning an RxList / a function returning an RxList / an array', async () => {
        await check(() => {
            const rows = new RxList([1, 2])
            const show = atom(true)
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <p>{() => show() ? rows.map(i => <b>{i}</b>) : 'none'}<i>tail</i></p>
                    <p>{() => () => rows.map(i => <b>{i}</b>)}</p>
                    <p>{() => () => show() ? [<b>x</b>, 's'] : ''}</p>
                </div>
            }
            return {
                source: () => createElement(App, null),
                updates: [() => rows.push(3), () => rows.splice(0, 1), () => show(false), () => show(true), () => rows.push(4)],
            }
        })
    })

    test.skipIf(pendingTopDown('B2'))('array items that are atoms (Comment-ph): empty / non-empty, next to text', async () => {
        await check(() => {
            const e = atom('')
            const a = atom('a')
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <p>{[e, <i>tail</i>]}</p>
                    <p>{['s', e]}</p>
                    <p>{[a, e, 's']}</p>
                </div>
            }
            return {source: () => createElement(App, null), updates: [() => e('x'), () => a(''), () => e(''), () => a('b')]}
        })
    })
})

// 函数结构态里元素的样式路径：内层 FunctionHost 由 createHost 创建、没有 position（没有 owner），
//  hostPath 上只多它自己一层（StaticHost.GetPathToLastComponent）。服务端曾经按元素 child 多登记一个 owner。
//  滚动 id 的序号（R<n>）是各自的计数，比较时去掉。
describe('#82 style path of an element inside a function returning a function', () => {
    test.each([
        ['element child', (rs: any) => function App({}: any, {createElement}: RenderContext) { return <div>{() => () => <b style={rs}>s</b>}</div> }],
        ['three levels', (rs: any) => function App({}: any, {createElement}: RenderContext) { return <div>{() => () => () => <b style={rs}>s</b>}</div> }],
        ['component root', (rs: any) => function App({}: any, {createElement}: RenderContext) { return () => () => <b style={rs}>s</b> }],
        ['list row', (rs: any) => function App({}: any, {createElement}: RenderContext) { return <div>{new RxList([1]).map(() => () => () => <b style={rs}>s</b>)}</div> }],
    ] as const)('%s: server rolling style id ≡ CSR', async (_name, make) => {
        // `& + &` 不能按内容共享，走按路径的滚动 id
        const rs = {color: 'red', '& + &': {color: 'blue'}}
        const App = make(rs)
        const html = renderToString(createElement(App, null)).html
        const serverClass = /class="([^"]*)"/.exec(html)?.[1]
        const client = mount()
        const root = createRoot(client)
        root.render(createElement(App, null))
        await tick()
        const clientClass = client.querySelector('b')!.getAttribute('class')
        const withoutSeq = (c: string | null | undefined) => String(c).replace(/R\d+F/g, 'RF')
        expect(withoutSeq(serverClass)).toBe(withoutSeq(clientClass))
        root.destroy()
    })
})
