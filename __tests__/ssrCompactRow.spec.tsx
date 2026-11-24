/** @jsx createElement */
/**
 * #68: RxList Compact 行判定，规则定义在 src/compactListRow.ts。
 *
 * Compact 行：行是元素（不是 Fragment），并且它的**静态子树**（元素 / Fragment 子节点，
 * 不进入 Host child：函数、atom、数组、RxList、组件、reusable）里没有任何生效的 detachStyle。
 * CSR 由 createElement 把静态子树里的 detachStyle 提升进 detachStyledChildren，createChildHost 读这个字段；
 * 服务端（以及 #55 B2 的激活描述）用 isCompactListRowDescriptor 对描述的静态子树做同一判断。
 * 本文件守住两种形态的结果一致：服务端 HTML ≡ CSR、激活不报告不重建、行 Host 种类 ≡ CSR。
 *
 * 曾经服务端只看行元素**自己**的 detachStyle：后代带 detachStyle 时少写一个 <!--rx list item-->，
 * 激活时找不到行级 Comment 而抛错。
 *
 * Run: npx vitest run __tests__/ssrCompactRow.spec.tsx
 */
import {
    atom,
    configureDiagnostics,
    createElement,
    createRoot,
    RenderContext,
    RxList,
} from '@framework'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {CompactElementHost} from '../src/StaticHost.js'
import {hydrate, pendingTopDown} from './helpers/hydrate'

/** 递归的结构签名：标签、Comment、Text（不含属性），用于比较服务端解析结果与 CSR 的 DOM 形状。 */
function structure(n: Node): string {
    if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
    if (n.nodeType === Node.TEXT_NODE) return `#${JSON.stringify(n.nodeValue)}`
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    return `<${tag}>${Array.from(el.childNodes).map(structure).join('')}</${tag}>`
}

/**
 * 服务端 HTML 里的文本边界标记（axii:t / axii:/t / axii:0）是文本单元的编码，激活时被消费掉；
 * 比较「解析结果 ≡ CSR」时去掉它们和空 Text，结构 Comment（rx list item 等）全部保留。
 */
function structureWithoutTextMarkers(n: Node): string {
    return structure(n).replace(/<!--axii:(?:t|\/t|0)-->|#""/g, '')
}

function findListHost(host: any): any {
    if (!host) return null
    if (host.constructor?.name === 'RxListHost') return host
    for (const key of ['innerHost', 'reactiveHosts', 'childHosts', 'hosts']) {
        const v = host[key]
        if (!v) continue
        for (const child of Array.isArray(v) ? v : [v]) {
            const found = findListHost(child)
            if (found) return found
        }
    }
    return null
}

const OPACITY_0 = {opacity: 0} as any

type Ctx = {createElement: RenderContext['createElement'], Fragment: any}
type RowCase = {
    name: string
    /** 与 CSR 一致的期望：行是否走 CompactElementHost */
    compact: boolean
    row: (i: number, ctx: Ctx) => any
    /** 列表挂载位置：默认是 <div id="t"> 的元素 child */
    mount?: 'elementChild' | 'arrayItem' | 'componentRoot'
    /** false：只比较服务端解析结果 ≡ CSR，不激活（原因写在用例旁） */
    hydrate?: false
}

function Child({}, {createElement}: RenderContext) {
    return <b detachStyle={OPACITY_0}>c</b>
}

const CASES: RowCase[] = [
    // --- issue 原始写法与静态子树里的各种深度 ---
    {name: 'own detachStyle (G2 control)', compact: false,
        row: (i, {createElement}) => <li detachStyle={OPACITY_0}>{i}</li>},
    {name: 'no detachStyle (G1 control)', compact: true,
        row: (i, {createElement}) => <li><span>{i}</span></li>},
    {name: 'child element has detachStyle (#68 issue)', compact: false,
        row: (i, {createElement}) => <li><span detachStyle={OPACITY_0}>{i}</span></li>},
    {name: 'deep descendant has detachStyle', compact: false,
        row: (i, {createElement}) => <li><div><p><span detachStyle={OPACITY_0}>{i}</span></p></div></li>},
    {name: 'second sibling subtree has detachStyle', compact: false,
        row: (i, {createElement}) => <li><i>x</i><div><em>{i}</em><span detachStyle={OPACITY_0}>y</span></div></li>},
    {name: 'detachStyle inside element-child Fragment', compact: false,
        row: (i, {createElement, Fragment}) =>
            <li>{createElement(Fragment, null, <span detachStyle={OPACITY_0}>{i}</span>, <i>z</i>)}</li>},
    // createElement(Fragment) 也登记自己的 detachStyle 并被父元素提升。
    // CAUTION 不激活：这一行被删除时 removeElements 对 DocumentFragment 调 getComputedStyle 会抛错（既有行为，
    //  与 Compact 判定无关）；这里只守住两端对这一行的 Compact 判定一致。
    {name: 'Fragment child with its own detachStyle', compact: false, hydrate: false,
        row: (i, {createElement, Fragment}) =>
            <li>{createElement(Fragment, {detachStyle: OPACITY_0} as any, <span>{i}</span>)}</li>},
    {name: 'descendant detachStyle passed via props.children (no explicit children)', compact: false,
        row: (i, {createElement}) => createElement('li', {children: [<span detachStyle={OPACITY_0}>{i}</span>]} as any)},
    // innerHTML 覆盖 children，但 createElement 照样先建 children、提升它们的 detachStyle（判定跟随 CSR）。
    // CAUTION 不激活：dangerouslySetInnerHTML 与 children 并存的元素（I66 开发期警告的写法）在列表外、
    //  不带 detachStyle 时激活也报告失配（children 去认领 innerHTML 的内容），与 Compact 判定无关，不归 #68。
    {name: 'dangerouslySetInnerHTML + child with detachStyle', compact: false, hydrate: false,
        row: (i, {createElement}) =>
            <li dangerouslySetInnerHTML={{__html: `<em>${i}</em>`}}><span detachStyle={OPACITY_0}>x</span></li>},
    {name: 'svg row: descendant has detachStyle', compact: false,
        row: (i, {createElement}) => <g><circle r={i} detachStyle={OPACITY_0}/></g>},
    // --- detachStyle 的真值规则（≡ createElement 的注册条件）---
    {name: 'descendant detachStyle is a function (truthy even if it returns null)', compact: false,
        row: (i, {createElement}) => <li><span detachStyle={() => null}>{i}</span></li>},
    {name: 'descendant detachStyle is an atom', compact: false,
        row: (i, {createElement}) => <li><span detachStyle={atom(OPACITY_0)}>{i}</span></li>},
    {name: 'descendant detachStyle null', compact: true,
        row: (i, {createElement}) => <li><span detachStyle={null as any}>{i}</span></li>},
    {name: 'descendant detachStyle false', compact: true,
        row: (i, {createElement}) => <li><span detachStyle={false as any}>{i}</span></li>},
    {name: 'descendant detachStyle 0', compact: true,
        row: (i, {createElement}) => <li><span detachStyle={0 as any}>{i}</span></li>},
    {name: 'descendant detachStyle empty string', compact: true,
        row: (i, {createElement}) => <li><span detachStyle={'' as any}>{i}</span></li>},
    // --- Host child 里的 detachStyle 不计入行（由那个 Host 自己处理）---
    {name: 'detachStyle inside function child (Host child, not counted)', compact: true,
        row: (i, {createElement}) => <li>{() => <span detachStyle={OPACITY_0}>{i}</span>}</li>},
    {name: 'detachStyle inside array child (Host child, not counted)', compact: true,
        row: (i, {createElement}) => <li>{[<span detachStyle={OPACITY_0}>{i}</span>]}</li>},
    {name: 'detachStyle inside component child (Host child, not counted)', compact: true,
        row: (i, {createElement}) => <li>{i}<Child/></li>},
    {name: 'detachStyle passed as a component prop (Host child, not counted)', compact: true,
        row: (i, {createElement}) => <li>{i}<Child detachStyle={OPACITY_0}/></li>},
    {name: 'detachStyle inside nested RxList child (Host child, not counted)', compact: true,
        row: (i, {createElement}) =>
            <li>{new RxList([i]).map(j => <span detachStyle={OPACITY_0}>{j}</span>)}</li>},
    // --- 非元素行：永远有行级 Comment（与 detachStyle 无关）---
    {name: 'Fragment row with descendant detachStyle', compact: false,
        row: (i, {createElement, Fragment}) =>
            createElement(Fragment, null, <span detachStyle={OPACITY_0}>{i}</span>, <i>f</i>)},
    {name: 'array row with descendant detachStyle', compact: false,
        row: (i, {createElement}) => [<li><span detachStyle={OPACITY_0}>{i}</span></li>]},
    // G3-RL：行本身是 RxList，内层每一行按同一判定
    {name: 'nested RxList row whose inner rows have descendant detachStyle', compact: false,
        row: (i, {createElement}) => new RxList([i]).map(j => <li><span detachStyle={OPACITY_0}>{j}</span></li>)},
    // --- 列表挂在别的位置：数组项、组件根 ---
    {name: 'list inside a static array item, row descendant has detachStyle', compact: false, mount: 'arrayItem',
        row: (i, {createElement}) => <li><span detachStyle={OPACITY_0}>{i}</span></li>},
    // CAUTION 不激活：组件直接返回 RxList 时，任何非 Compact 行（行自己带 detachStyle、atom 行、函数行）
    //  的激活在 origin/main 上本来就抛 'advanceCursorUntilComment without cursor'（RxListHost.render 的
    //  激活分支没有列表起点游标）。那是另一个缺陷，与 Compact 判定无关，不归 #68。这里只守住服务端形状。
    {name: 'list as component root, row descendant has detachStyle', compact: false, mount: 'componentRoot',
        hydrate: false,
        row: (i, {createElement}) => <li><span detachStyle={OPACITY_0}>{i}</span></li>},
]

function makeApp(c: RowCase, list: RxList<number>) {
    return function App({}, {createElement, Fragment}: RenderContext) {
        const ctx = {createElement, Fragment}
        const rows = list.map((i: number) => c.row(i, ctx))
        if (c.mount === 'componentRoot') return rows
        const isSvg = c.name.startsWith('svg')
        const content = c.mount === 'arrayItem' ? [rows] : rows
        return isSvg ? <svg id="t">{content}</svg> : <div id="t">{content}</div>
    }
}

describe('#68 RxList Compact row: server ≡ CSR, hydration claims without mismatch', () => {
    let errors: unknown[]
    beforeEach(() => {
        document.body.innerHTML = ''
        errors = []
        configureDiagnostics({enabled: true, onError: (e) => { errors.push(e) }})
    })
    afterEach(() => {
        configureDiagnostics({})
    })

    for (const c of CASES) {
        // 内部入口那一遍：每个 case 都激活一个 RxList（列表的激活在 #55 B2），不激活的 case 照常运行
        test.skipIf(pendingTopDown('B2') && c.hydrate !== false)(c.name, () => {
            // CSR 基准
            const csrEl = document.body.appendChild(document.createElement('div'))
            const csrList = new RxList([1, 2])
            const csrRoot = createRoot(csrEl)
            csrRoot.render(createElement(makeApp(c, csrList), null as any))
            const csrShape = structure(csrEl)
            const csrListHost = findListHost((csrRoot as any).host)
            expect(csrListHost.hosts[0] instanceof CompactElementHost).toBe(c.compact)

            // 服务端 HTML 解析结果 ≡ CSR
            const ssrList = new RxList([1, 2])
            const {html} = renderToString(createElement(makeApp(c, ssrList), null as any))
            const rootEl = document.body.appendChild(document.createElement('div'))
            rootEl.innerHTML = html
            expect(structureWithoutTextMarkers(rootEl)).toBe(structureWithoutTextMarkers(csrEl))
            if (c.hydrate === false) {
                csrRoot.destroy()
                return
            }

            // 激活：不报告、不重建（服务端节点原样保留），行 Host 种类 ≡ CSR
            const serverNodes = Array.from(rootEl.querySelectorAll('*'))
            const hydrated = hydrate(rootEl, createElement(makeApp(c, ssrList), null as any))
            expect(errors).toEqual([])
            expect(structure(rootEl)).toBe(csrShape)
            for (const n of serverNodes) expect(n.isConnected).toBe(true)
            const listHost = findListHost((hydrated as any).host)
            expect(listHost.hosts.map((h: any) => h.constructor.name))
                .toEqual(csrListHost.hosts.map((h: any) => h.constructor.name))

            // 激活之后的行增删 ≡ CSR
            for (const l of [csrList, ssrList]) {
                l.push(3)
                l.unshift(0)
            }
            expect(structure(rootEl)).toBe(structure(csrEl))
            for (const l of [csrList, ssrList]) {
                l.splice(1, 2)
            }
            expect(structure(rootEl)).toBe(structure(csrEl))
            expect(errors).toEqual([])
            hydrated.destroy()
            csrRoot.destroy()
        })
    }
})

describe('#68 exit animation of a hydrated row whose descendant has detachStyle', () => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    let errors: unknown[]
    beforeEach(() => {
        document.body.innerHTML = ''
        errors = []
        configureDiagnostics({enabled: true, onError: (e) => { errors.push(e) }})
    })
    afterEach(() => {
        configureDiagnostics({})
    })

    test.skipIf(pendingTopDown('B2'))('removed row stays while the descendant plays its exit transition, then leaves', async () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement}: RenderContext) {
            return <ul id="t">{list.map((k: string) =>
                <li id={`row-${k}`}><span id={`s-${k}`} style={{opacity: 1, transition: 'opacity 0.15s'}}
                    detachStyle={OPACITY_0}>{k}</span></li>)}</ul>
        }
        const {html} = renderToString(createElement(App, null as any))
        const rootEl = document.body.appendChild(document.createElement('div'))
        rootEl.innerHTML = html
        const rowA = rootEl.querySelector('#row-a')!
        const rowB = rootEl.querySelector('#row-b')!
        const root = hydrate(rootEl, createElement(App, null as any))
        expect(errors).toEqual([])
        expect(rootEl.querySelector('#row-a')).toBe(rowA)
        await sleep(30)

        list.splice(0, 1)
        await sleep(40)
        // 离场 transition 进行中：行还在，后代拿到了离场样式
        expect(rowA.isConnected).toBe(true)
        expect((rootEl.querySelector('#s-a') as HTMLElement).style.opacity).toBe('0')
        expect(rowB.isConnected).toBe(true)
        await sleep(500)
        expect(rowA.isConnected).toBe(false)
        expect(rowB.isConnected).toBe(true)
        expect(structure(rootEl.querySelector('#t')!))
            .toBe('<ul><li><span>#"b"</span></li><!--rx list item--><!--unhandledChild--></ul>')
        expect(errors).toEqual([])
        root.destroy()
    })
})
