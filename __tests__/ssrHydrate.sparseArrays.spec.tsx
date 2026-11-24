/** @jsx createElement */
/**
 * #85：稀疏数组的空位（`[a, , b]`、`new Array(n)` 部分赋值、对稀疏数组 `.map` 的结果）。
 *  CSR 的 StaticArrayHost.render 用 forEach：空位不建 Host、不产生任何节点。服务端 serializeStaticArray 曾经用 for…of，
 *  为每个空位写一个 EmptyHost（<!--empty--><!--array item-->），激活在未改动的服务端输出上失配（当时的两种认领模型都是）。
 *  修复：服务端与激活的数组认领都与 forEach 一样跳过空位。显式的 undefined / null 不是空位，两端都是 EmptyHost。
 *
 * Oracles：
 *  - 服务端 HTML 逐字（每个位置的写法）；
 *  - 解析后的服务端 HTML ≡ CSR；
 *  - 激活（经 helpers/hydrate，激活期间诊断开、关两遍）：不报告、不抛错、服务端元素原地保留（没有重建）、
 *    不留下 axii:* 标记、DOM ≡ CSR；
 *  - 之后的更新（数组项里的 atom / 函数、函数值换掉数组、列表行的增删移动）每一步都 ≡ CSR。
 *
 * 首位是空位的数组：StaticArrayHost 曾经只在 index === 0 时设 firstChild，这种数组的 element 退回到 placeholder——
 *  CSR 销毁 / 替换 / 移动它时内容留在原处，组件根上的这种数组激活时被当成容器里的残留节点（两个入口都报告失配）。
 *  CSR 自己的错「≡ CSR」看不出来，最后一组用例与同一终态的全新 CSR 渲染比较。
 * Run: npx vitest run __tests__/ssrHydrate.sparseArrays.spec.tsx
 */
import {createElement, createRoot, RenderContext} from '@framework'
import {atom, RxList} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate, TOP_DOWN_PASS, configureDiagnostics} from './helpers/hydrate'

/* eslint-disable no-sparse-arrays */

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

const app = (body: (ctx: RenderContext) => any) => function App({}: any, ctx: RenderContext) { return body(ctx) }

// ───────────────────────── 服务端 HTML（逐字） ─────────────────────────
describe('#85 server HTML: a hole in a static array writes nothing (≡ StaticArrayHost.render forEach)', () => {
    const partial = () => {
        const a: any[] = new Array(4)
        a[1] = 'm'
        return a
    }
    const cases: [string, () => any, string][] = [
        ['element child', () => createElement(app(({createElement}) => <p>{['a', , 'b']}</p>), null),
            '<p><!--axii:t-->a<!--axii:/t--><!--axii:t-->b<!--axii:/t--><!--unhandledChild--></p><!--root-->'],
        ['leading, consecutive and trailing holes', () => createElement(app(({createElement}) => <p>{[, , <i>x</i>, , ,]}</p>), null),
            '<p><i><!--axii:t-->x<!--axii:/t--></i><!--array item--><!--unhandledChild--></p><!--root-->'],
        ['new Array(n) partly assigned', () => createElement(app(({createElement}) => <p>{partial()}</p>), null),
            '<p><!--axii:t-->m<!--axii:/t--><!--unhandledChild--></p><!--root-->'],
        ['only holes', () => createElement(app(({createElement}) => <p>{new Array(3)}</p>), null),
            '<p><!--unhandledChild--></p><!--root-->'],
        // 显式的 undefined / null 不是空位：EmptyHost（in 判定，不是 === undefined）
        ['explicit undefined and null stay EmptyHost', () => createElement(app(({createElement}) => <p>{['a', undefined, , null, 'b']}</p>), null),
            '<p><!--axii:t-->a<!--axii:/t--><!--empty--><!--array item--><!--empty--><!--array item--><!--axii:t-->b<!--axii:/t--><!--unhandledChild--></p><!--root-->'],
        ['component root', () => createElement(app(({createElement}) => ['a', , <b>x</b>]), null),
            '<!--axii:t-->a<!--axii:/t--><b><!--axii:t-->x<!--axii:/t--></b><!--array item--><!--root-->'],
        ['Fragment child', () => createElement(app(({createElement, Fragment}) => <Fragment>{'h'}{[, 'a', <i>x</i>]}</Fragment>), null),
            '<!--fragment start--><!--axii:t-->h<!--axii:/t--><!--axii:t-->a<!--axii:/t--><i><!--axii:t-->x<!--axii:/t--></i><!--array item--><!--unhandledChild--><!--root-->'],
        ['function value', () => createElement(app(({createElement}) => <div>{() => ['a', , <b>x</b>]}</div>), null),
            '<div><!--axii:t-->a<!--axii:/t--><b><!--axii:t-->x<!--axii:/t--></b><!--array item--><!--computed node--><!--axii:0--></div><!--root-->'],
        ['list row', () => createElement(app(({createElement}) => <ul>{new RxList([1, 2]).map(i => [String(i), , <b>{i}</b>])}</ul>), null),
            '<ul><!--axii:t-->1<!--axii:/t--><b><!--axii:t-->1<!--axii:/t--></b><!--array item--><!--rx list item--><!--axii:t-->2<!--axii:/t--><b><!--axii:t-->2<!--axii:/t--></b><!--array item--><!--rx list item--><!--unhandledChild--></ul><!--root-->'],
        ['nested array', () => createElement(app(({createElement}) => <p>{['a', [, 'b', , <i>c</i>], , 'd']}</p>), null),
            '<p><!--axii:t-->a<!--axii:/t--><!--axii:t-->b<!--axii:/t--><i><!--axii:t-->c<!--axii:/t--></i><!--array item--><!--array item--><!--axii:t-->d<!--axii:/t--><!--unhandledChild--></p><!--root-->'],
        ['root', () => ['a', , () => 'f'],
            '<!--axii:t-->a<!--axii:/t--><!--axii:t-->f<!--axii:/t--><!--array item--><!--root-->'],
        // 对稀疏数组 map 的结果仍是稀疏数组（map 不访问空位、保留空位）：最常见的来源
        ['map over a sparse array', () => createElement(app(({createElement}) => <ul>{['x', , 'y'].map(v => <li>{v}</li>)}</ul>), null),
            '<ul><li><!--axii:t-->x<!--axii:/t--></li><!--array item--><li><!--axii:t-->y<!--axii:/t--></li><!--array item--><!--unhandledChild--></ul><!--root-->'],
    ]
    test.each(cases)('%s', (_name, source, expected) => {
        expect(renderToString(source()).html).toBe(expected)
    })
})

// ───────────────────────── 激活与更新 ─────────────────────────
type Holes = 'middle' | 'leading' | 'trailing' | 'only' | 'mixed'
const HOLES: Holes[] = ['middle', 'leading', 'trailing', 'only', 'mixed']

/** 数组项：静态文本、元素（子节点是 atom）、函数、组件、显式 undefined / null / false；txt 变化 = 项内更新 */
function items(createElement: any, txt: () => string, holes: Holes): any[] {
    function C({}: any, {createElement}: RenderContext) { return <u>c</u> }
    switch (holes) {
        case 'middle': return ['a', , <b>{txt}</b>, , () => txt(), <C/>]
        case 'leading': return [, , 'a', <b>{txt}</b>, () => txt()]
        case 'trailing': return [<b>{txt}</b>, 'a', , ,]
        case 'only': return new Array(3)
        case 'mixed': return ['a', undefined, , null, <b>{txt}</b>, , false, 'z']
    }
}

describe('#85 hydration ≡ CSR: a sparse static array in every position', () => {
    const positions: [string, (txt: () => string, holes: Holes) => (ctx: RenderContext) => any][] = [
        ['element child', (txt, holes) => ({createElement}) => <div>{items(createElement, txt, holes)}<i>tail</i></div>],
        ['element child after a text', (txt, holes) => ({createElement}) => <div>{'h'}{items(createElement, txt, holes)}</div>],
        ['component root', (txt, holes) => ({createElement}) => items(createElement, txt, holes)],
        ['Fragment child (component root)', (txt, holes) => ({createElement, Fragment}) => <Fragment>{'h'}{items(createElement, txt, holes)}{'t'}</Fragment>],
        ['Fragment child (element child)', (txt, holes) => ({createElement, Fragment}) => <div><Fragment>{'h'}{items(createElement, txt, holes)}</Fragment><p>q</p></div>],
        ['function value', (txt, holes) => ({createElement}) => <div>{() => items(createElement, txt, holes)}<i>tail</i></div>],
    ]
    // 组件根 / 函数值上含显式 undefined / null 的数组（'mixed'）：旧模型（#55 S 删除）的数组认领在这里抛错，与空位无关
    //  （稠密的 ['a', undefined, <b/>, 'z'] 同样抛错），这两格曾经只在内部入口跑；#85 交接给 #55 S 的第一种形态
    const cases = positions.flatMap(([p, body]) => HOLES.map(holes => [p, holes, body] as const))
    const name = '%s, %s holes: parse ≡ CSR, in place, no report, no marker left, item updates ≡ CSR'
    const run = async (_p: string, holes: Holes, body: typeof positions[number][1]) => {
        await check(() => {
            const txt = atom('t')
            function App({}: any, ctx: RenderContext) { return body(txt, holes)(ctx) }
            return {source: () => createElement(App, null), updates: [() => txt('u'), () => txt(''), () => txt('v')]}
        })
    }
    test.each(cases)(name, run)

    test('function value: arrays with and without a hole at index 0 replace each other ≡ CSR', async () => {
        await check(() => {
            const show = atom<'arr' | 'text' | 'leading' | 'only'>('leading')
            const txt = atom('t')
            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => {
                    const k = show()
                    if (k === 'text') return 'none'
                    if (k === 'only') return [, , ]
                    if (k === 'leading') return [, 'x', , <b>{txt}</b>]
                    return ['a', , <b>{txt}</b>, , () => txt()]
                }}<i>tail</i></div>
            }
            return {
                source: () => createElement(App, null),
                updates: [() => txt('u'), () => show('text'), () => show('leading'), () => txt('v'), () => show('arr'),
                    () => show('only'), () => show('leading'), () => show('arr'), () => txt('w'), () => show('leading')],
            }
        })
    })

    test.each([
        ['index 0 present', (i: number, txt: () => string, createElement: any) => [String(i), , <b>{txt}</b>, , () => `${txt()}${i}`]],
        ['hole at index 0', (i: number, txt: () => string, createElement: any) => [, String(i), <b>{txt}</b>, , () => `${txt()}${i}`]],
    ] as const)('list rows are sparse arrays (%s): push / splice / swap / unshift / item updates ≡ CSR', async (_n, row) => {
        await check(() => {
            const list = new RxList([1, 2, 3])
            const txt = atom('t')
            function App({}: any, {createElement}: RenderContext) {
                return <ul>{list.map(i => row(i, txt, createElement))}</ul>
            }
            return {
                source: () => createElement(App, null),
                updates: [() => txt('u'), () => list.push(4), () => list.splice(1, 1), () => list.swap(0, 2), () => list.unshift(0), () => txt('v'), () => list.splice(0, 2)],
            }
        })
    })

    test('map over a sparse array ≡ CSR', async () => {
        await check(() => {
            const txt = atom('t')
            function App({}: any, {createElement}: RenderContext) {
                return <ul>{['x', , 'y', , ].map(v => <li>{v}{txt}</li>)}</ul>
            }
            return {source: () => createElement(App, null), updates: [() => txt('u')]}
        })
    })

    test('root array', async () => {
        await check(() => {
            const txt = atom('t')
            return {source: () => [, 'a', , () => txt(), , txt], updates: [() => txt('u'), () => txt('')]}
        })
    })
})

// 嵌套数组：旧模型（#55 S 删除）的数组认领不支持（与空位无关：['a', ['b', <i/>], 'd'] 同样抛错），这组曾经只在内部入口跑；
//  #85 交接给 #55 S 的第二种形态
describe('#85 hydration ≡ CSR: nested sparse arrays', () => {
    test('holes on both levels', async () => {
        await check(() => {
            const txt = atom('t')
            function App({}: any, {createElement}: RenderContext) {
                return <p>{['a', [, 'b', , <i>{txt}</i>], , 'd', [, ]]}</p>
            }
            return {source: () => createElement(App, null), updates: [() => txt('u')]}
        })
    })
})

// #85 交接的第三种形态（#55 S 的追加验收）：函数值返回数组时，项内的更新只更新那一项——外层函数不重跑，元素不重建（≡ CSR）。
//  check() 只在更新之后比较 DOM 字符串，看不出重建，这里另外比较外层函数的运行次数与元素身份。稠密数组同样。
describe('#85 hand-off: a function value returning an array keeps its elements when an item updates', () => {
    test.each([
        ['dense', (txt: any, createElement: any) => ['a', <b>{txt}</b>, () => txt(), <i>{() => txt()}</i>]],
        ['sparse', (txt: any, createElement: any) => ['a', , <b>{txt}</b>, , () => txt(), <i>{() => txt()}</i>]],
    ] as const)('%s: item updates do not re-run the outer function, elements keep their identity', async (_n, arr) => {
        const make = () => {
            const txt = atom('t')
            const runs = {n: 0}
            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => { runs.n++; return arr(txt, createElement) }}<i>tail</i></div>
            }
            return {txt, runs, source: () => createElement(App, null)}
        }
        const html = renderToString(make().source()).html
        const c = make()
        const client = mount()
        createRoot(client).render(c.source())
        const h = make()
        const hyd = mount()
        hyd.innerHTML = html
        const parsed = elementsOf(hyd)
        hydrate(hyd, h.source())
        expect({dom: kids(hyd), runs: h.runs.n, same: sameNodes(elementsOf(hyd), parsed), reports})
            .toEqual({dom: kids(client), runs: c.runs.n, same: true, reports: []})
        for (const v of ['u', '', 'v']) {
            c.txt(v)
            h.txt(v)
            await tick()
            expect({value: v, dom: kids(hyd), runs: h.runs.n, same: sameNodes(elementsOf(hyd), parsed)})
                .toEqual({value: v, dom: kids(client), runs: c.runs.n, same: true})
        }
        expect(reports).toEqual([])
    })
})

// ───────────────────────── CSR：首位是空位的数组整体移除 / 移动 ─────────────────────────
// 「≡ CSR」看不出 CSR 自己的错（激活与 CSR 一起错），这里与同一终态的全新 CSR 渲染比较。
describe('#85 CSR: an array whose index 0 is a hole is removed and moved as a whole', () => {
    function fresh(source: any): string {
        const el = mount()
        createRoot(el).render(source)
        return kids(el)
    }

    test('function value: the array is replaced by a text', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <p>{() => show() ? [, 'a', <i>x</i>, , () => 'f'] : 'gone'}<i>tail</i></p>
        }
        function Final({}: any, {createElement}: RenderContext) { return <p>{'gone'}<i>tail</i></p> }
        const el = mount()
        createRoot(el).render(createElement(App, null))
        expect(kids(el)).toBe('<p>"a"<i>"x"</i><!--array item-->"f"<!--array item--><!--computed node--><i>"tail"</i></p><!--root-->')
        show(false)
        await tick()
        expect(kids(el)).toBe(fresh(createElement(Final, null)))
    })

    test('component root: root.destroy() removes the whole array', () => {
        function App({}: any, {createElement}: RenderContext) { return [, , 'a', <b>x</b>] }
        const el = mount()
        const root = createRoot(el)
        root.render(createElement(App, null))
        expect(kids(el)).toBe('"a"<b>"x"</b><!--array item--><!--root-->')
        root.destroy()
        expect(kids(el)).toBe('')
    })

    test('list rows: splice / swap / unshift end in the same DOM as a fresh render', async () => {
        const row = (i: number, createElement: any) => [, String(i), <b>{i}</b>]
        const list = new RxList([1, 2, 3, 4])
        function App({}: any, {createElement}: RenderContext) { return <ul>{list.map(i => row(i, createElement))}</ul> }
        const el = mount()
        createRoot(el).render(createElement(App, null))
        const steps: [() => void, number[]][] = [
            [() => list.splice(1, 1), [1, 3, 4]],
            [() => list.swap(0, 2), [4, 3, 1]],
            [() => list.unshift(0), [0, 4, 3, 1]],
            [() => list.splice(0, 2), [3, 1]],
        ]
        for (const [step, data] of steps) {
            step()
            await tick()
            const finalList = new RxList(data)
            function Final({}: any, {createElement}: RenderContext) { return <ul>{finalList.map(i => row(i, createElement))}</ul> }
            expect(kids(el)).toBe(fresh(createElement(Final, null)))
        }
    })
})
