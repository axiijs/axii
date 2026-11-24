/** @jsx createElement */
/**
 * #55 B4：新激活模型的其余形态与开发期检测（设计 docs/ssr-support/hydration-top-down.md §2.6.5、§2.6.8、§2.6.9、§3.1.1、
 * §3.4、§5.2），经内部入口 hydrateRootTopDown。激活相关的既有用例经 helpers/hydrate 在内部入口上跑两遍（激活期间诊断开、关，
 * vitest.config.ts 的 top-down / top-down-diag-off 项目）；这里补它们没有覆盖、只属于新模型的契约：
 *  - 开发期 Proxy：描述被当作节点读写时报告 AXII_HYDRATION_ELEMENT_ACCESS，行为与生产相同；框架与语言的探测不报告；
 *  - 事后渲染（C6 / C10）：激活中建好、之后才渲染的描述按 CSR 物化（AXII_HYDRATION_ELEMENT_LATE_RENDER），≡ CSR；
 *  - 现成节点（§2.6.8）：删除服务端的对应物，按 CSR 插入、渲染（AXII_HYDRATION_LIVE_NODE）；
 *  - Portal 的游标栈、reusable()、lazy；激活加销毁之后计数归零；C10 每行多保留的对象（§5.2）。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {configureDiagnostics, createElement, createRoot, lazy, type RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {hydrateRootTopDown} from '../src/hydrateTopDown'
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
        hydrateRootTopDown(hyd, createElement(make(), null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
        expect({seen, errors: errors.map(e => (e as Error).constructor.name), reports}).toEqual({seen: [undefined, true, true], errors: ['TypeError', 'TypeError'], reports: []})
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd2, createElement(h2.App, null))
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
            const root = hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
                    hydrateRootTopDown(el, createElement(s.App, null))
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
        hydrateRootTopDown(hyd, createElement(h.App, null))
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
            const root = hydrateRootTopDown(hyd, createElement(make(true), null))
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
        const root = hydrateRootTopDown(hyd, createElement(h.App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(make(), null))
        expect(reports).toEqual([])
    })

    test('a server-only attribute on a clean claim is reported once per element with its names; an approximate claim (§4.1) clears it instead; diagnostics off: no report', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><b>x</b><i id="keep">y</i></div>
        }
        const html = renderToString(createElement(App, null)).html
        const hyd = mount()
        hyd.innerHTML = html.replace('<b>', '<b title="server" data-s="1">').replace('<i id="keep">', '<i id="drift" title="server">')
        hydrateRootTopDown(hyd, createElement(App, null))
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
        hydrateRootTopDown(off, createElement(App, null))
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
        hydrateRootTopDown(hyd, createElement(App, null))
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

    test('hydrate + destroy through the internal entry returns host / binding / style counters to zero for the B4 shapes (Portal, reusable, lazy, live nodes, late rendering)', async () => {
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
            const root = hydrateRootTopDown(hyd, createElement(App, null))
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
