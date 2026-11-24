/** @jsx createElement */
/**
 * #55 B4：新激活模型的其余形态与开发期检测（设计 docs/ssr-support/hydration-top-down.md §2.6.5、§2.6.8、§2.6.9、§3.1.1、
 * §3.4、§5.2），经 hydrateRoot（B4 时是不导出的内部入口，#55 S 起是公开入口）。激活相关的既有用例经 helpers/hydrate 跑两遍
 * （激活期间诊断开、关，vitest.config.ts 的 hydrate-diag-on / hydrate-diag-off 项目）；这里补它们没有覆盖的契约：
 *  - 开发期 Proxy：描述被当作节点读写时报告 AXII_HYDRATION_ELEMENT_ACCESS，行为与生产相同；框架与语言的探测不报告；
 *  - 事后渲染（C6 / C10）：激活中建好、之后才渲染的描述按 CSR 物化（AXII_HYDRATION_ELEMENT_LATE_RENDER），≡ CSR；
 *  - 现成节点（§2.6.8）：删除服务端的对应物，按 CSR 插入、渲染（AXII_HYDRATION_LIVE_NODE）；
 *  - Portal 的游标栈、reusable()、lazy；激活加销毁之后计数归零；C10 每行多保留的对象（§5.2）。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {configureDiagnostics, createElement, createRoot, lazy, type RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {hydrateRoot} from '../src/hydrateRoot'
import {HydrationDevReport, HydrationInvariantError, HydrationMismatchError} from '../src/hydration'
import {HydrationElement, isHydrationElement} from '../src/hydrationElement'
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

function mount(id?: string): HTMLElement {
    const el = document.createElement('div')
    if (id) el.id = id
    document.body.appendChild(el)
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
const tick = () => new Promise(r => setTimeout(r, 0))
const devReports = (code: string) => reports.filter(e => e instanceof HydrationDevReport && e.code === code)
const mismatches = () => reports.filter(e => e instanceof HydrationMismatchError)
const invariants = () => reports.filter(e => e instanceof HydrationInvariantError)

describe('development Proxy (§3.4, §3.1.1)', () => {
    test('reading an element-interface property of a JSX result in the component body reports AXII_HYDRATION_ELEMENT_ACCESS once per position and property, then reads undefined', () => {
        const seen: unknown[] = []
        const make = () => function App({}: any, {createElement}: RenderContext) {
            const input = <input/>
            const b = <b>t</b>
            seen.push((input as HTMLInputElement).value, (input as HTMLInputElement).value, b.textContent)
            return <div>{input}{b}</div>
        }
        const csr = mount()
        createRoot(csr).render(createElement(make(), null))
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make(), null)).html
        seen.length = 0
        hydrateRoot(hyd, createElement(make(), null))
        const access = devReports('AXII_HYDRATION_ELEMENT_ACCESS') as Error[]
        expect({seen, dom: kids(hyd), access: access.map(e => e.message.match(/"(\w+)" was read/)?.[1]), mismatches: mismatches()})
            .toEqual({seen: [undefined, undefined, undefined], dom: kids(csr), access: ['value', 'textContent'], mismatches: []})
    })

    test('calling a method reports and then throws TypeError; writing an unknown property reports and then throws TypeError (ES modules are strict) — the same failures as production', () => {
        const errors: unknown[] = []
        function App({}: any, {createElement}: RenderContext) {
            const el = <input/> as HTMLInputElement
            try { el.focus() } catch (e) { errors.push(e) }
            try { el.className = 'x' } catch (e) { errors.push(e) }
            return <div>{el}</div>
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(App, null)).html
        errors.length = 0
        hydrateRoot(hyd, createElement(App, null))
        expect(errors.map(e => (e as Error).constructor.name)).toEqual(['TypeError', 'TypeError'])
        expect((devReports('AXII_HYDRATION_ELEMENT_ACCESS') as Error[]).map(e => e.message.match(/"(\w+)" was (read|written)/)!.slice(1).join(' ')))
            .toEqual(['focus read', 'className written'])
        expect(hyd.querySelector('input')!.className).toBe('')
    })

    test('a description captured by an event handler is reported when the handler runs after the activation (§3.1.1); it never becomes the node', () => {
        const errors: unknown[] = []
        let captured: unknown
        function App({}: any, {createElement}: RenderContext) {
            const input = <input/>
            captured = input
            return <div>{input}<button onClick={() => { try { (input as HTMLInputElement).focus() } catch (e) { errors.push(e) } }}>b</button></div>
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(App, null)).html
        hydrateRoot(hyd, createElement(App, null))
        expect(devReports('AXII_HYDRATION_ELEMENT_ACCESS')).toEqual([])
        hyd.querySelector('button')!.click()
        expect(errors.map(e => (e as Error).constructor.name)).toEqual(['TypeError'])
        expect(devReports('AXII_HYDRATION_ELEMENT_ACCESS').length).toBe(1)
        // 认领之后只剩 node 的小壳，仍是描述（§3.1.1），node 是认领到的元素
        expect({desc: isHydrationElement(captured), node: (captured as HydrationElement).node === hyd.querySelector('input'), node2: captured === hyd.querySelector('input')})
            .toEqual({desc: true, node: true, node2: false})
    })

    test('framework and language probes are not reported: preset fields, type, nodeType, then, toJSON, constructor, symbols, __axiiSource', () => {
        const probes: unknown[] = []
        function App({}: any, {createElement}: RenderContext) {
            const d = <input/> as any
            probes.push(d.tag, d.rawProps, d.isSVG, d.node, d.listenerBoundArgs, d.type, d.nodeType, d.then, d.toJSON,
                typeof d.constructor, d[Symbol.iterator], d.__axiiSource, Object.keys(d).length > 0, isHydrationElement(d))
            return <div>{d}</div>
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(App, null)).html
        probes.length = 0
        hydrateRoot(hyd, createElement(App, null))
        expect(probes).toEqual(['input', null, false, null, undefined, undefined, undefined, undefined, undefined, 'function', undefined, undefined, true, true])
        expect(reports).toEqual([])
    })

    test('diagnostics off when the activation starts: descriptions are the bare objects — nothing is reported, the failures are the same', () => {
        configureDiagnostics({enabled: false, onError: (e: unknown) => { reports.push(e) }})
        const seen: unknown[] = []
        const errors: unknown[] = []
        function App({}: any, {createElement}: RenderContext) {
            const el = <input value="x"/> as HTMLInputElement
            seen.push(el.value, isHydrationElement(el), Object.getPrototypeOf(el) === HydrationElement.prototype)
            try { el.focus() } catch (e) { errors.push(e) }
            try { el.className = 'x' } catch (e) { errors.push(e) }
            return <div>{el}</div>
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(App, null)).html
        seen.length = 0
        errors.length = 0
        hydrateRoot(hyd, createElement(App, null))
        expect({seen, errors: errors.map(e => (e as Error).constructor.name), reports}).toEqual({seen: [undefined, true, true], errors: ['TypeError', 'TypeError'], reports: []})
    })
})

// #55 D：README / 站点「hydration 的契约变化」一节的迁移示例与 C9 的说法，钉在这里（文档里的每句说法都有对应用例）
describe('migration as documented in the README (#55 D)', () => {
    test('the "after" example: the ref holds the claimed input, the click focuses it, no report', () => {
        function Search({}: any, {createElement, createRef}: RenderContext) {
            const input = createRef()
            return <div>
                <input ref={input}/>
                <button onClick={() => input.current.focus()}>Search</button>
            </div>
        }
        for (const enabled of [true, false]) {
            reports = []
            configureDiagnostics({enabled, onError: (e: unknown) => { reports.push(e) }})
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(Search, null)).html
            const serverInput = hyd.querySelector('input')
            hydrateRoot(hyd, createElement(Search, null))
            hyd.querySelector('button')!.click()
            expect({enabled, same: hyd.querySelector('input') === serverInput, focused: document.activeElement === serverInput, reports})
                .toEqual({enabled, same: true, focused: true, reports: []})
        }
    })

    test('attribute values that differ from client props are rewritten without a report; a different static id is a mismatch', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><p title="t" className="c" data-k="1">x</p><span id="s">y</span></div>
        }
        const html = renderToString(createElement(App, null)).html
        const hyd = mount()
        hyd.innerHTML = html
        const p = hyd.querySelector('p')!
        p.setAttribute('title', 'HACK')
        p.setAttribute('class', 'x')
        p.setAttribute('data-k', '2')
        hydrateRoot(hyd, createElement(App, null))
        expect({same: hyd.querySelector('p') === p, attrs: [p.title, p.className, p.dataset.k], reports})
            .toEqual({same: true, attrs: ['t', 'c', '1'], reports: []})

        reports = []
        const hyd2 = mount()
        hyd2.innerHTML = html
        hyd2.querySelector('span')!.id = 'z'
        hydrateRoot(hyd2, createElement(App, null))
        expect({id: hyd2.querySelector('span')!.id, mismatches: mismatches().length}).toEqual({id: 's', mismatches: 1})
    })

    test('C9: JSX and createRoot().render() in user callbacks give real nodes', async () => {
        for (const enabled of [true, false]) {
            reports = []
            configureDiagnostics({enabled, onError: (e: unknown) => { reports.push(e) }})
            const made: [string, unknown][] = []
            const side = document.createElement('div')
            const make = (log: boolean) => function App({}: any, {createElement, useEffect, useLayoutEffect, pathContext}: RenderContext) {
                if (log) {
                    pathContext?.root.on('attach', () => { made.push(['attach', <i/>]) })
                    useLayoutEffect(() => { made.push(['useLayoutEffect', <i/>]) })
                    useEffect(() => {
                        made.push(['useEffect', <i/>])
                        createRoot(side).render(<u>side</u>)
                    })
                }
                return <p ref={(el: Element | null) => { if (el && log) made.push(['ref', <i/>]) }}>x</p>
            }
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(make(false), null)).html
            hydrateRoot(hyd, createElement(make(true), null))
            await tick()
            expect({
                enabled,
                kinds: made.map(([k]) => k).sort(),
                nodes: made.every(([, n]) => n instanceof HTMLElement && !isHydrationElement(n)),
                side: side.firstElementChild instanceof HTMLElement && side.firstElementChild.outerHTML,
                reports,
            }).toEqual({enabled, kinds: ['attach', 'ref', 'useEffect', 'useLayoutEffect'], nodes: true, side: '<u>side</u>', reports: []})
        }
    })
})

describe('descriptions rendered after the activation (C6 / C10, §2.2)', () => {
    test('JSX kept in the component body and first rendered after the activation ≡ CSR, its bindings work; AXII_HYDRATION_ELEMENT_LATE_RENDER while diagnostics are on', async () => {
        const make = () => {
            const label = atom('a')
            const open = atom(false)
            function App({}: any, {createElement}: RenderContext) {
                const panel = <p className={() => label()}><b>{label}</b></p>
                return <section>{() => open() ? panel : null}</section>
            }
            return {label, open, App}
        }
        const c = make()
        const csr = mount()
        createRoot(csr).render(createElement(c.App, null))
        const h = make()
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd, createElement(h.App, null))
        for (const s of [c, h]) s.open(true)
        await tick()
        expect(kids(hyd)).toBe(kids(csr))
        expect(kids(hyd)).toContain('<p class=')
        for (const s of [c, h]) s.label('b')
        await tick()
        expect({dom: kids(hyd), late: devReports('AXII_HYDRATION_ELEMENT_LATE_RENDER').length, mismatches: mismatches()})
            .toEqual({dom: kids(csr), late: 1, mismatches: []})
        // 再渲染一次：同一个描述已有 node，与 CSR 重复渲染同一个元素对象相同，不再报告
        for (const s of [c, h]) s.open(false)
        await tick()
        for (const s of [c, h]) s.open(true)
        await tick()
        expect({dom: kids(hyd), late: devReports('AXII_HYDRATION_ELEMENT_LATE_RENDER').length}).toEqual({dom: kids(csr), late: 1})

        configureDiagnostics({enabled: false, onError: (e: unknown) => { reports.push(e) }})
        reports = []
        const h2 = make()
        const hyd2 = mount()
        hyd2.innerHTML = renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd2, createElement(h2.App, null))
        h2.open(true)
        h2.label('b')
        await tick()
        expect({dom: kids(hyd2), reports}).toEqual({dom: kids(csr), reports: []})
    })

    test('a reusable() built during the activation and first placed afterwards ≡ CSR at every step; destroy returns the retained counters to zero', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const make = () => {
                const label = atom('a')
                const open = atom(false)
                function App({}: any, {createElement, reusable}: RenderContext) {
                    const r = reusable(<i>{label}</i>)
                    return <div>{() => open() ? r : null}<s>end</s></div>
                }
                return {label, open, App}
            }
            const c = make()
            const csr = mount()
            const csrRoot = createRoot(csr)
            csrRoot.render(createElement(c.App, null))
            const h = make()
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(make().App, null)).html
            const root = hydrateRoot(hyd, createElement(h.App, null))
            const steps: string[][] = []
            for (const step of [() => [c, h].forEach(s => s.open(true)), () => [c, h].forEach(s => s.label('b')),
                () => [c, h].forEach(s => s.open(false)), () => [c, h].forEach(s => s.open(true))]) {
                step()
                await tick()
                steps.push([kids(hyd), kids(csr)])
            }
            for (const [a, b] of steps) expect(a).toBe(b)
            expect(steps[1][0]).toContain('<i>"b"</i>')
            root.destroy()
            csrRoot.destroy()
            await tick()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect([after.hosts.activeByType, after.lightBindings.totalActive, mismatches()]).toEqual([{}, 0, []])
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })

    test('a reusable() first placed after the activation under another component sees the creator\'s context like CSR', async () => {
        const make = () => {
            const open = atom(false)
            const seen: unknown[] = []
            function Reader({}: any, {context}: RenderContext) {
                seen.push(context.get('k'))
                return <i>r</i>
            }
            function Owner({}: any, {createElement, reusable, context}: RenderContext) {
                context.set('k', 'owner')
                const r = reusable(<Reader/>)
                return <section>{() => open() ? <Other>{r}</Other> : null}</section>
            }
            function Other({children}: any, {createElement, context}: RenderContext) {
                context.set('k', 'other')
                return <div>{children}</div>
            }
            return {open, seen, App: Owner}
        }
        const c = make()
        createRoot(mount()).render(createElement(c.App, null))
        const h = make()
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd, createElement(h.App, null))
        c.open(true)
        h.open(true)
        await tick()
        expect(h.seen).toEqual(c.seen)
    })

    test('C10 under SVG: shared-name array items of a late-rendered <svg> are SVG elements like CSR', async () => {
        const make = () => {
            const open = atom(false)
            function App({}: any, {createElement, createSVGElement}: RenderContext) {
                const g = createSVGElement('svg', null, [createElement('a', {href: '#x'}, createSVGElement('circle', {r: 1}))])
                return <main>{() => open() ? g : null}</main>
            }
            return {open, App}
        }
        const c = make()
        const csr = mount()
        createRoot(csr).render(createElement(c.App, null))
        const h = make()
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd, createElement(h.App, null))
        c.open(true)
        h.open(true)
        await tick()
        expect([kids(hyd), hyd.querySelector('a')?.namespaceURI]).toEqual([kids(csr), csr.querySelector('a')?.namespaceURI])
    })

    test('rows of a derived list never rendered during the activation are Compact rows like CSR when admitted later (C10 in a list)', async () => {
        const make = () => {
            const list = new RxList([1, 2, 3])
            const all = atom(false)
            function App({}: any, {createElement}: RenderContext) {
                // filter 收到的是 map 的结果（行元素 / 描述），按它在 map 里第一次被判定的顺序放行第一行
                let evaluated = 0
                const first = new WeakSet<object>()
                return <ul>{list.map(i => <li>{i}</li>).filter(li => {
                    if (evaluated++ === 0) first.add(li)
                    return all() || first.has(li)
                })}</ul>
            }
            return {all, App}
        }
        const c = make()
        const csr = mount()
        createRoot(csr).render(createElement(c.App, null))
        const h = make()
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd, createElement(h.App, null))
        const first = hyd.querySelector('li')!
        expect(kids(hyd)).toBe(kids(csr))
        for (const s of [c, h]) s.all(true)
        await tick()
        expect({dom: kids(hyd), first: hyd.querySelector('li') === first, late: devReports('AXII_HYDRATION_ELEMENT_LATE_RENDER').length, mismatches: mismatches()})
            .toEqual({dom: kids(csr), first: true, late: 2, mismatches: []})
        expect(kids(hyd)).not.toContain('rx list item')
    })
})

describe('the same description or live node more than once in one activation (C6, §2.6.8; #55 B4 independent review)', () => {
    const csrAndHydrate = async (make: () => {App: any, step?: () => void}, html?: string) => {
        const c = make()
        const csr = mount()
        createRoot(csr).render(createElement(c.App, null))
        const h = make()
        const hyd = mount()
        hyd.innerHTML = html ?? renderToString(createElement(make().App, null)).html
        hydrateRoot(hyd, createElement(h.App, null))
        return {csr, hyd, c, h}
    }

    test('a repeated description with dynamic children is collected once: the next dynamic sibling keeps its own binding', async () => {
        const make = () => {
            const x = atom('x')
            const y = atom('y')
            function App({}: any, {createElement}: RenderContext) {
                const s = <span>{() => x()}</span>
                return <div>{s}{s}{() => y()}</div>
            }
            return {App, step: () => { x('x2'); y('y2') }}
        }
        const {csr, hyd, c, h} = await csrAndHydrate(make)
        expect({dom: kids(hyd), invariants: invariants()}).toEqual({dom: kids(csr), invariants: []})
        c.step!(); h.step!()
        await tick()
        expect(kids(hyd)).toBe(kids(csr))
    })

    test('a description placed by a Host and also written as a static child ends where CSR puts it (the Host renders last)', async () => {
        for (const order of ['fn-first', 'array-first', 'static-first']) {
            reports = []
            const make = () => {
                function App({}: any, {createElement}: RenderContext) {
                    const s = <b>s</b>
                    return order === 'fn-first' ? <div>{() => s}{s}<i>i</i></div>
                        : order === 'array-first' ? <div>{[s]}{s}<i>i</i></div>
                            : <div>{s}{() => s}<i>i</i></div>
                }
                return {App}
            }
            const {csr, hyd} = await csrAndHydrate(make)
            expect({order, dom: kids(hyd), mismatches: mismatches()}).toEqual({order, dom: kids(csr), mismatches: []})
        }
    })

    test('a mismatch-created element rendered a second time stays where the second occurrence puts it', async () => {
        const make = () => {
            function App({}: any, {createElement}: RenderContext) {
                const s = <span>s</span>
                return <div>{s}<i>i</i>{s}</div>
            }
            return {App}
        }
        // 服务端第一个位置是 <em>（失配，<span> 新建），第二个位置照常
        const {csr, hyd} = await csrAndHydrate(make, '<div><em>s</em><i>i</i><span>s</span></div><!--root-->')
        expect({dom: kids(hyd), mismatches: mismatches().length}).toEqual({dom: kids(csr), mismatches: 1})
    })
})

describe('a description placed before its static occurrence in an outer static tree (#55 B4b)', () => {
    // CSR：外层的 createElement 在 JSX 求值时就把静态 child s 插进去，并把它的动态 child 与响应式属性提升到外层，它们归外层的
    //  StaticHost；Host 之后才渲染 s，只把元素挪过去，不再为它建内层 Host。激活按文档顺序走，Host 先放置了 s：之前 Host 那一侧
    //  又为 s 的动态 child 建了一份，外层预建的那一份没人消费，后面兄弟的子 Host 依次错位（y 绑到 x 的位置）。
    //  hydrationCursor.ts「同一个描述的多次放置」：先放置它的一方只认领元素，外层在 s 的静态位置上认领内容、用自己预建的 Host。
    type Shape = (s: any, y: () => any, ctx: RenderContext, list: RxList<number>) => any
    const SHAPES: Record<string, Shape> = {
        'function child, then static': (s, y, {createElement}) => <div>{() => s}{s}{() => y()}</div>,
        'array item, then static': (s, y, {createElement}) => <div>{[s]}{s}{() => y()}</div>,
        'list row, then static': (s, y, {createElement}, list) => <div>{list.map(() => s)}{s}{() => y()}</div>,
        'component result, then static': (s, y, {createElement}) => {
            function Leaf() { return s }
            return <div><Leaf/>{s}{() => y()}</div>
        },
        'function child, another Host, then static': (s, y, {createElement}) => <div>{() => s}{() => 'z'}{s}{() => y()}</div>,
        'function child, then static inside an element': (s, y, {createElement}) => <div>{() => s}<p>{s}</p>{() => y()}</div>,
        'function child inside an element, then static': (s, y, {createElement}) => <div><p>{() => s}</p>{s}{() => y()}</div>,
        'both inside a static element': (s, y, {createElement}) => <div><section>{() => s}<p>{s}</p></section>{() => y()}</div>,
        'static child of JSX a Host creates, then static': (s, y, {createElement}) => <div>{() => <p>{s}</p>}{s}{() => y()}</div>,
        'static child of JSX a Host creates, then static inside an element': (s, y, {createElement}) =>
            <div>{() => <p>{s}</p>}<section>{s}</section>{() => y()}</div>,
    }
    type Source = (x: any, c: any, ctx: RenderContext) => any
    const SOURCES: Record<string, Source> = {
        'one function child': (x, _c, {createElement}) => <b>{() => x()}</b>,
        'nested element, reactive attribute, function and atom children': (x, c, {createElement}) => <b class={() => c()}><i>{() => x()}</i>{x}</b>,
    }
    const makeCase = (shape: Shape, source: Source) => (live: boolean) => {
        const x = atom('x')
        const y = atom('y')
        const c = atom('c1')
        const list = new RxList([1])
        // 现成节点（§2.6.8）：激活之外用 CSR 的 createElement 建好；服务端那一遍（live 为 false）写同一内容的 JSX
        const liveNode = live ? createElement('b', null, () => x()) : undefined
        function App({}: any, ctx: RenderContext) {
            return shape(liveNode ?? source(x, c, ctx), y, ctx, list)
        }
        return {App, step: () => { x('x2'); y('y2'); c('c2') }}
    }
    // CSR 与激活各建一份，比较：DOM；Host 与绑定按种类的创建计数（§2.4.1：同一个 source 两边落到同样的 Host，没有多建的）；
    //  更新之后的 DOM；激活的根销毁之后计数归零。激活这一次的诊断按 diagnostics 开或关。
    const compareWithCsr = async (make: (live: boolean) => {App: any, step: () => void}, diagnostics: boolean, live = false) => {
        reports = []
        const onError = (e: unknown) => { reports.push(e) }
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const c = make(live)
            const csr = mount()
            createRoot(csr).render(createElement(c.App, null))
            const csrCounts = getAxiiRetainedObjectDiagnosticsSnapshot()
            const csrDom = kids(csr)
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(make(false).App, null)).html
            const h = make(live)
            resetAxiiRetainedObjectDiagnostics()
            configureDiagnostics({enabled: diagnostics, onError})
            let root: ReturnType<typeof hydrateRoot>
            try {
                root = hydrateRoot(hyd, createElement(h.App, null))
            } finally {
                configureDiagnostics({enabled: true, onError})
            }
            const hydCounts = getAxiiRetainedObjectDiagnosticsSnapshot()
            const hydDom = kids(hyd)
            c.step()
            h.step()
            await tick()
            const result = {
                csr: {dom: csrDom, hosts: csrCounts.hosts.createdByType, bindings: csrCounts.lightBindings.createdByType, after: kids(csr), active: {}},
                hyd: {dom: hydDom, hosts: hydCounts.hosts.createdByType, bindings: hydCounts.lightBindings.createdByType, after: kids(hyd), active: {} as object},
            }
            root.destroy()
            await tick()
            result.hyd.active = getAxiiRetainedObjectDiagnosticsSnapshot().hosts.activeByType
            return result
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    }

    test('≡ CSR: the later dynamic sibling keeps its own binding, no extra hosts, no mismatch, no development invariant; diagnostics on and off', async () => {
        for (const [sourceName, source] of Object.entries(SOURCES)) {
            for (const [shapeName, shape] of Object.entries(SHAPES)) {
                for (const diagnostics of [true, false]) {
                    const {csr, hyd} = await compareWithCsr(makeCase(shape, source), diagnostics)
                    expect({sourceName, shapeName, diagnostics, ...hyd, mismatches: mismatches(), invariants: invariants()})
                        .toEqual({sourceName, shapeName, diagnostics, ...csr, mismatches: [], invariants: []})
                }
            }
        }
    })

    test('a live element (§2.6.8): the outer StaticHost renders its lifted dynamic children where CSR does; later siblings keep their bindings', async () => {
        for (const shapeName of ['function child, then static', 'array item, then static', 'static child of JSX a Host creates, then static']) {
            const {csr, hyd} = await compareWithCsr(makeCase(SHAPES[shapeName], SOURCES['one function child']), true, true)
            expect({shapeName, ...hyd, mismatches: mismatches(), invariants: invariants()})
                .toEqual({shapeName, ...csr, mismatches: [], invariants: []})
        }
        // 放置的先后与描述相同（开发期不变量见下面放置顺序那条用例的说明）
        for (const shapeName of ['Host, then static in JSX a later Host creates', 'static, Host, static',
            'Host, then JSX a later Host creates with a Host before the static position']) {
            const {csr, hyd} = await compareWithCsr(makeCase(PLACEMENT_SHAPES[shapeName], SOURCES['one function child']), true, true)
            expect({shapeName, ...hyd, mismatches: mismatches()}).toEqual({shapeName, ...csr, mismatches: []})
        }
    })

    test('a collected description first rendered by CSR code during the activation (a function child of a live node): the outer StaticHost still claims its content; later siblings keep their bindings', async () => {
        const make = (live: boolean) => {
            const x = atom('x')
            const y = atom('y')
            let current: any
            // 现成节点里的函数 child 在激活中按 CSR 渲染（外层的遍历走到现成节点时），返回的是外层还没走到的静态 child s
            const liveNode = live ? createElement('i', null, () => current) : undefined
            function App({}: any, {createElement}: RenderContext) {
                const s = current = <b>{() => x()}</b>
                return <div>{liveNode ?? <i>{() => s}</i>}{s}{() => y()}</div>
            }
            return {App, step: () => { x('x2'); y('y2') }}
        }
        const {csr, hyd} = await compareWithCsr(make, true, true)
        expect({...hyd, mismatches: mismatches(), invariants: invariants()}).toEqual({...csr, mismatches: [], invariants: []})
    })

    test('a Fragment description: its children stay at the static position like CSR (moved out on the first insertion); the server\'s copy at the Host is reported once (§11)', async () => {
        const fragment: Source = (x, _c, {createElement, Fragment}) => <>{() => x()}<i>{x}</i></>
        for (const shapeName of ['function child, then static', 'array item, then static', 'static child of JSX a Host creates, then static']) {
            const {csr, hyd} = await compareWithCsr(makeCase(SHAPES[shapeName], fragment), true)
            expect({shapeName, ...hyd, mismatches: mismatches().length, invariants: invariants()})
                .toEqual({shapeName, ...csr, mismatches: 1, invariants: []})
        }
    })

    // 放置的先后（hydrationCursor.ts 第 3 条）：CSR 里静态位置的时刻是外层 createElement 的时刻，Host 的时刻是它渲染的时刻
    const PLACEMENT_SHAPES: Record<string, Shape> = {
        'Host, then static in JSX a later Host creates': (s, y, {createElement}) => <div>{() => s}{() => <p>{s}</p>}{() => y()}</div>,
        'Host, static, static': (s, y, {createElement}) => <div>{() => s}{s}{s}{() => y()}</div>,
        'static, Host, static': (s, y, {createElement}) => <div>{s}{() => s}{s}{() => y()}</div>,
        'static, static in JSX a Host creates, static': (s, y, {createElement}) => <div>{s}{() => <p>{s}</p>}{s}{() => y()}</div>,
        'Host, Host, static': (s, y, {createElement}) => <div>{() => s}{() => s}{s}{() => y()}</div>,
        'Host, static in JSX a later Host creates, static': (s, y, {createElement}) => <div>{() => s}{() => <p>{s}</p>}{s}{() => y()}</div>,
        // 后建的 JSX 里，Host 在静态位置之前：CSR 里 <p> 的 createElement 先把元素放到静态位置，Host 之后把它挪回自己那里
        'Host, then JSX a later Host creates with a Host before the static position': (s, y, {createElement}) =>
            <div>{() => s}{() => <p>{() => s}{s}</p>}{() => y()}</div>,
    }

    test('placement order follows CSR: a static position in JSX created after a Host placed the element wins; static positions collected before it do not', async () => {
        for (const [shapeName, shape] of Object.entries(PLACEMENT_SHAPES)) {
            const {csr, hyd} = await compareWithCsr(makeCase(shape, SOURCES['one function child']), true)
            // 同一个元素渲染两次是误用：一个 Host 的元素被之后的放置挪走时，CSR 里那个 Host 的区间同样断开，开发期不变量（§4.4）把这个
            //  与 CSR 相同的状态报告出来（同 hydrateTopDown.spec「[s, s]」），这里不比较它
            expect({shapeName, ...hyd, mismatches: mismatches()}).toEqual({shapeName, ...csr, mismatches: []})
        }
    })

    test('a mismatch where the Host places the element (new element, approximate claim) or at the static position: repaired ≡ CSR, reported, bindings in place', async () => {
        // 先放置它的一方认领元素时的失配状态（R1 新建、§4.1 近似认领）留到收集它的遍历认领内容时用：新建的元素在新建的层里建子节点，
        //  近似认领的元素按 CSR 写属性。用错状态时内容在空元素里按失配处理，报告条数会多
        const make = () => {
            const x = atom('x')
            const y = atom('y')
            const c = atom('c1')
            function App({}: any, {createElement}: RenderContext) {
                const s = <b id="s" class={() => c()}><i>{() => x()}</i></b>
                return <div>{() => s}{s}{() => y()}</div>
            }
            return {App, step: () => { x('x2'); y('y2'); c('c2') }}
        }
        // [服务端 HTML 的改动, 报告条数]。静态位置上是别的标签时那里不是它的对应物，不删除：之后 y 的文本单元处按 R2 替换它、R5 删除
        //  服务端剩下的文本单元，两条
        const edits: Record<string, [(html: string) => string, number]> = {
            'another tag where the Host places it (R1)': [html => html.replace('<b id="s"', '<em id="s"').replace('</b><!--computed node-->', '</em><!--computed node-->'), 1],
            // 两份都漂移：前方没有 id 相符的同标签元素（否则按 D6 认领静态位置那一份），Host 处按属性漂移近似认领
            'id drift where the Host places it (approximate claim)': [html => html.replace('<b id="s"', '<b id="drift"').replace('<b id="s"', '<b id="drift2"'), 1],
            'another tag at the static position': [html => {
                const at = html.lastIndexOf('<b id="s"')
                return html.slice(0, at) + html.slice(at).replace('<b id="s"', '<u id="s"').replace('</b>', '</u>')
            }, 2],
        }
        for (const [name, [edit, reported]] of Object.entries(edits)) {
            reports = []
            const c = make()
            const csr = mount()
            createRoot(csr).render(createElement(c.App, null))
            const hyd = mount()
            hyd.innerHTML = edit(renderToString(createElement(make().App, null)).html)
            const h = make()
            hydrateRoot(hyd, createElement(h.App, null))
            const before = {dom: kids(hyd), mismatches: mismatches().length, invariants: invariants()}
            const csrBefore = kids(csr)
            c.step()
            h.step()
            await tick()
            expect({name, ...before, after: kids(hyd)}).toEqual({name, dom: csrBefore, mismatches: reported, invariants: [], after: kids(csr)})
        }
    })

    test('a description placed by a Host in an earlier activation and written as a static child in a later one moves there like CSR (nothing carried across activations)', () => {
        // 第二次激活里静态位置之前还有一个渲染它的 Host 时，CSR 里那个 Host 更晚，元素留在 Host 那里
        const seconds = [
            (s: any, {createElement}: RenderContext) => <section>{s}</section>,
            (s: any, {createElement}: RenderContext) => <section>{() => s}{s}</section>,
        ]
        for (const second of seconds) {
            reports = []
            const make = () => {
                let s: any
                function First({}: any, {createElement}: RenderContext) { s = <b>s</b>; return <div>{() => s}</div> }
                function Second({}: any, ctx: RenderContext) { return second(s, ctx) }
                return {First, Second}
            }
            const c = make()
            const [csr1, csr2] = [mount(), mount()]
            createRoot(csr1).render(createElement(c.First, null))
            createRoot(csr2).render(createElement(c.Second, null))
            const server = make()
            const [hyd1, hyd2] = [mount(), mount()]
            hyd1.innerHTML = renderToString(createElement(server.First, null)).html
            hyd2.innerHTML = renderToString(createElement(server.Second, null)).html
            const h = make()
            hydrateRoot(hyd1, createElement(h.First, null))
            hydrateRoot(hyd2, createElement(h.Second, null))
            expect({dom: [kids(hyd1), kids(hyd2)], mismatches: mismatches()}).toEqual({dom: [kids(csr1), kids(csr2)], mismatches: []})
        }
    })
})

describe('C10 quantification (§5.2, D2)', () => {
    // 同一个 N 行列表：CSR 首次渲染，与「激活中建好（组件体里 map 出行描述）、激活中没有渲染（关着的标签页）、激活之后才第一次
    //  渲染」比较每行多保留的对象，按类型：Host、placeholder Comment、描述壳。B4 在 RxListHost.createChildHost 的非 Compact
    //  分支按描述的 node 重新走 Compact 判定，所以 Host 与 Comment 不多；多出来的只有 list.data 里留下的描述壳
    //  （激活之后的 CSR 新行路径不知道行的下标，不写回）。诊断开启时 data 里是包着壳的开发期 Proxy，再多一个对象。
    test.each([[true], [false]])('N rows built during the activation and rendered after it (diagnostics on: %s)', async (diagnostics) => {
        const N = 200
        const make = () => {
            const items = new RxList(Array.from({length: N}, (_, i) => i))
            const open = atom(false)
            let rows: RxList<any> | undefined
            function App({}: any, {createElement}: RenderContext) {
                rows = items.map(i => <li>{i}</li>)
                return <main>{() => open() ? <ul>{rows}</ul> : null}</main>
            }
            return {open, App, rows: () => rows!}
        }
        const measure = async (hydrateIt: boolean) => {
            enableAxiiRetainedObjectDiagnostics({reset: true})
            try {
                const s = make()
                const el = mount()
                if (hydrateIt) {
                    el.innerHTML = renderToString(createElement(make().App, null)).html
                    configureDiagnostics({enabled: diagnostics, onError: (e: unknown) => { reports.push(e) }})
                    hydrateRoot(el, createElement(s.App, null))
                    configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push(e) }})
                } else {
                    createRoot(el).render(createElement(s.App, null))
                }
                s.open(true)
                await tick()
                const snapshot = getAxiiRetainedObjectDiagnosticsSnapshot()
                const ul = el.querySelector('ul')!
                return {
                    dom: kids(el),
                    hosts: snapshot.hosts.activeByType,
                    comments: Array.from(ul.childNodes).filter(n => n.nodeType === Node.COMMENT_NODE).length,
                    shells: s.rows().data.filter(isHydrationElement).length,
                }
            } finally {
                disableAxiiRetainedObjectDiagnostics()
                resetAxiiRetainedObjectDiagnostics()
            }
        }
        const csr = await measure(false)
        const late = await measure(true)
        // eslint-disable-next-line no-console
        console.log(`[C10 §5.2] N=${N} diagnostics=${diagnostics} | CSR hosts ${JSON.stringify(csr.hosts)} comments ${csr.comments} | ` +
            `late hosts ${JSON.stringify(late.hosts)} comments ${late.comments} shells ${late.shells} | per row: ` +
            `Host +${(Object.values(late.hosts).reduce((a, b) => a + b, 0) - Object.values(csr.hosts).reduce((a, b) => a + b, 0)) / N}, ` +
            `Comment +${(late.comments - csr.comments) / N}, description shell +${late.shells / N}`)
        expect({dom: late.dom, hosts: late.hosts, comments: late.comments, shells: late.shells})
            .toEqual({dom: csr.dom, hosts: csr.hosts, comments: csr.comments, shells: N})
        // 激活之后诊断是开着的：每行物化时报告一次
        expect(devReports('AXII_HYDRATION_ELEMENT_LATE_RENDER').length).toBe(N)
    })
})

describe('live nodes (§2.6.8)', () => {
    test('a live element as a JSX child replaces its server counterpart and keeps its own reactive content; siblings keep their server nodes; AXII_HYDRATION_LIVE_NODE once', () => {
        // 激活之前在客户端建好的元素（CSR 的 createElement，带响应式 child）；服务端在同一位置写的是同一内容的 JSX
        const make = (live: boolean) => {
            const label = atom('a')
            const node = live ? createElement('b', {title: 't'}, label) : undefined
            function App({}: any, {createElement}: RenderContext) {
                return <div><i>x</i>{node ?? <b title="t">{label}</b>}<u>y</u></div>
            }
            return {label, node, App}
        }
        const c = make(true)
        const csr = mount()
        createRoot(csr).render(createElement(c.App, null))
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make(false).App, null)).html
        const [i, u] = [hyd.querySelector('i'), hyd.querySelector('u')]
        const h = make(true)
        hydrateRoot(hyd, createElement(h.App, null))
        expect({dom: kids(hyd), live: hyd.querySelector('b') === h.node, kept: hyd.querySelector('i') === i && hyd.querySelector('u') === u,
            liveReports: devReports('AXII_HYDRATION_LIVE_NODE').length, mismatches: mismatches(), invariants: invariants()})
            .toEqual({dom: kids(csr), live: true, kept: true, liveReports: 1, mismatches: [], invariants: []})
        for (const s of [c, h]) s.label('z')
        expect(kids(hyd)).toBe(kids(csr))
    })

    test('a live Text array item, a live Text component result (NodeHost), a live element as a Host source and as a list row ≡ CSR without mismatches', () => {
        type Shape = (live: boolean) => (props: any, ctx: RenderContext) => any
        const shapes: Shape[] = [
            (live) => function App({}: any, {createElement}: RenderContext) { const t = live ? document.createTextNode('t') : 't'; return <div>{['a', t, 'b']}</div> },
            (live) => {
                function Leaf() { return live ? document.createTextNode('leaf') : 'leaf' }
                return function App({}: any, {createElement}: RenderContext) { return <div><Leaf/><i>after</i></div> }
            },
            (live) => {
                function Leaf({}: any, {createElement}: RenderContext) { return live ? document.createElement('em') : <em/> }
                return function App({}: any, {createElement}: RenderContext) { return <div><Leaf/><i>after</i></div> }
            },
            (live) => {
                const list = new RxList([1, 2])
                return function App({}: any, {createElement}: RenderContext) {
                    return <ul>{list.map(i => { if (!live) return <li>{String(i)}</li>; const li = document.createElement('li'); li.textContent = String(i); return li })}</ul>
                }
            },
        ]
        for (const make of shapes) {
            reports = []
            const csr = mount()
            createRoot(csr).render(createElement(make(true), null))
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(make(false), null)).html
            const root = hydrateRoot(hyd, createElement(make(true), null))
            expect({dom: kids(hyd), mismatches: mismatches(), invariants: invariants(), live: devReports('AXII_HYDRATION_LIVE_NODE').length > 0})
                .toEqual({dom: kids(csr), mismatches: [], invariants: [], live: true})
            root.destroy()
        }
    })
})

describe('Portal (§2.6.5)', () => {
    test('nested portals hydrate in their own containers in place; the main cursor continues after the Portal; a drift inside a portal is repaired and reported there', async () => {
        const make = () => {
            const t = atom('p')
            function Inner({}: any, {createElement, createPortal}: RenderContext) {
                return <section><b>{t}</b>{createPortal(() => <i>{t}</i>, 'fp-inner')}</section>
            }
            function App({}: any, {createElement, createPortal}: RenderContext) {
                return <div><span>before</span>{createPortal(() => <Inner/>, 'fp-outer')}<span>after</span></div>
            }
            return {t, App}
        }
        const ssr = renderToString(createElement(make().App, null))
        const hyd = mount()
        const outer = mount('fp-outer')
        const inner = mount('fp-inner')
        hyd.innerHTML = ssr.html
        outer.innerHTML = ssr.portals['fp-outer'].html
        // 内层 Portal 的服务端 HTML 漂移：<i> 换成 <u>
        inner.innerHTML = ssr.portals['fp-inner'].html.replace('<i>', '<u>').replace('</i>', '</u>')
        const kept = [hyd.querySelectorAll('span')[0], hyd.querySelectorAll('span')[1], outer.querySelector('b')]
        const h = make()
        const root = hydrateRoot(hyd, createElement(h.App, null))
        expect({
            main: kids(hyd), outer: kids(outer), inner: kids(inner),
            kept: [hyd.querySelectorAll('span')[0], hyd.querySelectorAll('span')[1], outer.querySelector('b')].every((n, i) => n === kept[i]),
            mismatches: mismatches().length, invariants: invariants(),
        }).toEqual({
            main: '<div><span>"before"</span><!--empty--><!--unhandledChild--><span>"after"</span></div><!--root-->',
            outer: '<section><b>"p"</b><!--empty--><!--unhandledChild--></section><!--computed node--><!--root-->',
            inner: '<i>"p"</i><!--computed node--><!--root-->',
            kept: true,
            mismatches: 1,
            invariants: [],
        })
        h.t('q')
        await tick()
        expect([outer.querySelector('b')!.textContent, inner.querySelector('i')!.textContent]).toEqual(['q', 'q'])
        root.destroy()
        expect([kids(outer), kids(inner)]).toEqual(['', ''])
    })

    test('the development invariants (§4.4) run for every portal container, not only the main one', () => {
        // 探针：原始标记里的 axii:* 注释在激活之后仍在容器里，不变量按「残留标记」报告（主容器一直如此）。放在 Portal 的内容里，
        //  只有 Portal 的容器也被检查时才报告
        function App({}: any, {createElement, createPortal}: RenderContext) {
            return <div>{createPortal(<p dangerouslySetInnerHTML={{__html: '<!--axii:0-->x'}}/>, 'fp-one')}</div>
        }
        const ssr = renderToString(createElement(App, null))
        const hyd = mount()
        const one = mount('fp-one')
        hyd.innerHTML = ssr.html
        one.innerHTML = ssr.portals['fp-one'].html
        hydrateRoot(hyd, createElement(App, null))
        expect({mismatches: mismatches(), invariants: (invariants() as Error[]).map(e => e.message)})
            .toEqual({mismatches: [], invariants: ['[axii] hydration invariant broken: a leftover <!--axii:0--> marker (AXII_HYDRATION_INVARIANT)']})
    })

    test('a junk node after <!--root--> in a portal container is removed and reported once (R5)', () => {
        function App({}: any, {createElement, createPortal}: RenderContext) {
            return <div>{createPortal(<p>x</p>, 'fp-one')}</div>
        }
        const ssr = renderToString(createElement(App, null))
        const hyd = mount()
        const one = mount('fp-one')
        hyd.innerHTML = ssr.html
        one.innerHTML = ssr.portals['fp-one'].html + '<!--axii:0-->'
        hydrateRoot(hyd, createElement(App, null))
        expect({one: kids(one), mismatches: mismatches().length, invariants: invariants()}).toEqual({one: '<p>"x"</p><!--root-->', mismatches: 1, invariants: []})
    })
})

describe('AXII_HYDRATION_ATTRIBUTE_RESIDUE (§4.1)', () => {
    // 判定是 markupNames.isAttributeWrittenByProps：服务端为客户端 props 写下的属性名都不算残留
    const make = () => {
        const on = atom(true)
        const hover = () => ({color: 'rgb(1, 2, 3)', '&:hover': {color: 'red'}})
        return function App({}: any, {createElement, createSVGElement}: RenderContext) {
            return <form>
                <div style={hover} title="t"/>
                <div className="c" style={{color: 'blue'}} data-x="1" uuid="u1" aria-label="l" hidden={() => !on()}/>
                <label htmlFor="i">l</label>
                <input id="i" value="v" readOnly tabIndex={1}/>
                <input type="checkbox" value={true}/>
                <input type="checkbox" checked={on}/>
                <input defaultValue="d"/>
                <select value="b"><option value="a">a</option><option value="b">b</option></select>
                <textarea value="tv"/>
                {createSVGElement('svg', {viewBox: '0 0 1 1'}, createSVGElement('path', {strokeWidth: 2, d: 'M0 0'}), createSVGElement('use', {xlinkHref: '#p'}))}
                <button disabled={true}>b</button>
            </form>
        }
    }

    test('unmodified server output (style classes and markers, className, uuid, aria / data-*, htmlFor, controlled inputs, select, svg names, reactive props) reports no residue', () => {
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make(), null)).html
        hydrateRoot(hyd, createElement(make(), null))
        expect(reports).toEqual([])
    })

    test('a server-only attribute on a clean claim is reported once per element with its names; an approximate claim (§4.1) clears it instead; diagnostics off: no report', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><b>x</b><i id="keep">y</i></div>
        }
        const html = renderToString(createElement(App, null)).html
        const hyd = mount()
        hyd.innerHTML = html.replace('<b>', '<b title="server" data-s="1">').replace('<i id="keep">', '<i id="drift" title="server">')
        hydrateRoot(hyd, createElement(App, null))
        const residue = devReports('AXII_HYDRATION_ATTRIBUTE_RESIDUE') as Error[]
        expect({
            residue: residue.map(e => e.message.match(/<(\w+)> claimed from the server keeps attribute\(s\) ([\w-, ]+) that/)!.slice(1).join(': ')),
            b: hyd.querySelector('b')!.getAttributeNames(),
            i: hyd.querySelector('i')!.getAttributeNames(),
            mismatches: mismatches().length,
        }).toEqual({residue: ['b: title, data-s'], b: ['title', 'data-s'], i: ['id'], mismatches: 1})

        configureDiagnostics({enabled: false, onError: (e: unknown) => { reports.push(e) }})
        reports = []
        const off = mount()
        off.innerHTML = html.replace('<b>', '<b title="server">')
        hydrateRoot(off, createElement(App, null))
        expect({reports, b: off.querySelector('b')!.getAttributeNames()}).toEqual({reports: [], b: ['title']})
    })
})

describe('lazy (§2.6.9)', () => {
    test('the server fallback is claimed in place, the loaded component replaces it by CSR', async () => {
        let resolve!: (c: any) => void
        function Fallback({}: any, {createElement}: RenderContext) { return <span>loading</span> }
        const make = () => lazy(() => new Promise(r => { resolve = r }), () => ({type: Fallback, props: {}, children: []}) as any)
        function Loaded({}: any, {createElement}: RenderContext) { return <em>ready</em> }
        const L = make()
        function App({}: any, {createElement}: RenderContext) { return <div><L/><i>after</i></div> }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(App, null)).html
        const fallback = hyd.querySelector('span')
        hydrateRoot(hyd, createElement(App, null))
        expect({kept: hyd.querySelector('span') === fallback, reports}).toEqual({kept: true, reports: []})
        resolve(Loaded)
        await new Promise(r => setTimeout(r, 0))
        expect(kids(hyd)).toBe('<div><em>"ready"</em><!--computed node--><!--unhandledChild--><i>"after"</i></div><!--root-->')
    })
})

describe('retained objects (§5.2)', () => {
    // CSR 本身的计数缺口（B4 用「激活加销毁后计数归零」验收 reusable 时发现）：ReusableHost 放进树时由 createHost 登记，
    //  它的销毁（所属组件销毁时的 destroyReusable）没有登记，CSR 渲染再销毁之后 ReusableHost 一直算作活跃
    test('CSR: a reusable() placed in the tree and destroyed with its component returns the ReusableHost counter to zero', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const open = atom(true)
            function App({}: any, {createElement, reusable}: RenderContext) {
                const r = reusable(<i>r</i>)
                const never = reusable(<b>n</b>)
                return <div>{() => open() ? r : null}{never && null}</div>
            }
            const root = createRoot(mount())
            root.render(createElement(App, null))
            open(false)
            await tick()
            open(true)
            await tick()
            root.destroy()
            expect(getAxiiRetainedObjectDiagnosticsSnapshot().hosts.activeByType).toEqual({})
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })

    test('hydrate + destroy returns host / binding / style counters to zero for the B4 shapes (Portal, reusable, lazy, live nodes, late rendering)', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const label = atom('x')
            const open = atom(false)
            function Fallback({}: any, {createElement}: RenderContext) { return <span>{label}</span> }
            const L = lazy(() => new Promise(() => {}), () => ({type: Fallback, props: {}, children: []}) as any)
            function App({}: any, {createElement, createPortal, reusable}: RenderContext) {
                const kept = <p className={() => label()}>{label}</p>
                const r = reusable(<i>{label}</i>)
                return <div>
                    {createPortal(() => <b className={() => label()}>{label}</b>, 'fp-ret')}
                    {r}
                    <L/>
                    {[document.createTextNode('live')]}
                    {() => open() ? kept : null}
                </div>
            }
            const portal = mount('fp-ret')
            const hyd = mount()
            const ssr = renderToString(createElement(App, null))
            hyd.innerHTML = ssr.html
            portal.innerHTML = ssr.portals['fp-ret'].html
            const root = hydrateRoot(hyd, createElement(App, null))
            open(true)
            label('y')
            await tick()
            const mid = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(mid.hosts.totalActive).toBeGreaterThan(0)
            root.destroy()
            await new Promise(r => setTimeout(r, 0))
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect([after.hosts.activeByType, after.lightBindings.totalActive, after.styles.activeHostStyleStates, mismatches(), invariants()])
                .toEqual([{}, 0, 0, [], []])
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })
})
