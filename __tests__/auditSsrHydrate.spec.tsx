/** @jsx createElement */
/**
 * Audit: hydration + SSR ≡ CSR.
 * On pristine v4.8.1 every F* / X* / N* test of the original audit fails. With the fixes in src/:
 *  - pass: F1d (mitigated: cubic → quadratic), F2, F5, F6, F7, F8, X1–X7, N1, N2 and their regressions;
 *  - NOT fixed, kept as `test.fails` so the evidence stays executable (each flips to a failure the
 *    day it starts passing): F1a, F1b, F1c, F1e (global deepest-same-tag claim), F3a, F3b
 *    (function-child anchor look-ahead), F4a–F4d (structural drift). All three need hydration to
 *    claim top-down by position; JSX evaluates children before their parent, so that means
 *    deferred descriptors instead of live nodes during hydration — a design decision.
 *
 * Oracles:
 *  (a) parse the server HTML in the browser and compare with a CSR render of the same tree;
 *  (b) hydrate, change the reactive data, compare with a CSR root given the same change;
 *  (c) hydration of unmodified renderToString output must report no HydrationMismatchError.
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    configureDiagnostics,
    bindProps,
    PropTypes,
    RenderContext,
} from '@framework'
import {atom, RxList} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'

let reports: string[]
beforeEach(() => {
    document.body.innerHTML = ''
    reports = []
    configureDiagnostics({enabled: false, onError: (e: unknown) => { reports.push((e as any)?.message ?? String(e)) }})
})

/** Shape of a DOM subtree: transient axii:* markers and empty Text dropped, attributes sorted. */
function shape(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue === '' ? '' : `"${node.nodeValue}"`
    if (node.nodeType === Node.COMMENT_NODE) {
        const d = (node as Comment).data
        return (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') ? '' : `<!--${d}-->`
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    // namespace-aware name: setAttributeNS(xlink, 'href') and a parsed `xlink:href` are the same attribute
    const attrs = Array.from(el.attributes)
        .map(a => `${a.namespaceURI ? a.namespaceURI.split('/').pop() + '|' + a.localName : a.name}=${JSON.stringify(a.value)}`)
        .sort().join(' ')
    return `<${tag}${attrs ? ' ' + attrs : ''}>${kids(el)}</${tag}>`
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
function csr(App: any): HTMLElement {
    const el = mount()
    createRoot(el).render(createElement(App, null as any))
    return el
}
function ssrInto(App: any): HTMLElement {
    const el = mount()
    el.innerHTML = renderToString(createElement(App, null as any)).html
    return el
}
const tick = () => new Promise(r => setTimeout(r, 0))

/**
 * test.fails only checks that the body throws, so an unrelated error in hydrateRoot (a regression
 * elsewhere, a typo) would silently count as "the known defect". Every known-defect case below calls
 * hydrateRoot through this guard:
 *  - `reason` given (F3a, F4d): the defect IS a throw; only an error whose message matches is rethrown;
 *  - no `reason`: the defect shows up as a failed assertion, so hydrateRoot must not throw at all.
 * Any other error is logged and the body returns normally — test.fails then reports the case as
 * failing instead of swallowing the error. Once the defect is fixed the body passes and test.fails
 * fails as before (flip the case to `test`).
 */
function hydrateKnownDefect(container: HTMLElement, source: any, reason?: RegExp): boolean {
    try {
        hydrateRoot(container, source)
        return true
    } catch (e) {
        if (reason && reason.test(String((e as Error)?.message))) throw e
        // eslint-disable-next-line no-console
        console.error('[known-defect case] unexpected error, not the documented failure:', e)
        return false
    }
}

// ───────────────────────── Finding 1: element claim order ─────────────────────────
describe('F1 tryClaimElement claims the deepest same-tag element of the whole root', () => {
    test.fails('F1a same tag at two depths: hydrated DOM must equal CSR and report nothing', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><span>a</span><p><span>b</span></p></div>
        }
        const hyd = ssrInto(App)
        if (!hydrateKnownDefect(hyd, createElement(App, null as any))) return
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    test.fails('F1b child component deeper than a later sibling: content must survive hydration', () => {
        function Header({}: any, {createElement}: RenderContext) {
            return <header><nav><p>deep</p></nav></header>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Header/><main><p>hello</p></main></div>
        }
        const hyd = ssrInto(App)
        if (!hydrateKnownDefect(hyd, createElement(App, null as any))) return
        expect(kids(hyd)).toBe(kids(csr(App)))
    })

    test.fails('F1c listeners must be bound to the element at the same position', () => {
        const log: string[] = []
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <button onClick={() => log.push('A')}>x</button>
                <p><button onClick={() => log.push('B')}>x</button></p>
            </div>
        }
        const hyd = ssrInto(App)
        if (!hydrateKnownDefect(hyd, createElement(App, null as any))) return
        ;(hyd.querySelectorAll('button')[0] as HTMLButtonElement).click()
        expect(log).toEqual(['A'])
    })

    test.fails('F1e markup written by dangerouslySetInnerHTML is not claimed by a same-tag JSX sibling', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><div id="raw" dangerouslySetInnerHTML={'<p><em>raw</em></p>'}/><em>sibling</em></div>
        }
        const hyd = ssrInto(App)
        if (!hydrateKnownDefect(hyd, createElement(App, null as any))) return
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    test('F1d hydration time must not grow cubically with the number of sibling rows', () => {
        const hydrateMs = (n: number) => {
            const make = () => {
                const list = new RxList(Array.from({length: n}, (_, i) => i))
                return function App({}: any, {createElement}: RenderContext) {
                    return <ul>{list.map(i => <li>{i}</li>)}</ul>
                }
            }
            const hyd = ssrInto(make())
            const t0 = performance.now()
            hydrateRoot(hyd, createElement(make(), null as any))
            return performance.now() - t0
        }
        // best of 3: scheduling noise (other browser processes, GC) only ever adds time
        const best = (n: number) => Math.min(hydrateMs(n), hydrateMs(n), hydrateMs(n))
        best(50) // warm up
        const small = best(150)
        const large = best(600)
        const growth = large / small
        // eslint-disable-next-line no-console
        console.log(`[F1d] n=150 hydrate=${small.toFixed(1)}ms | n=600 hydrate=${large.toFixed(1)}ms | growth x${growth.toFixed(1)}`)
        // 4x rows: linear → ~4x, quadratic → ~16x, cubic → ~64x. The bound sits at the geometric mean of
        // quadratic and cubic: a factor 2 of timing noise either way still classifies correctly
        // (a 2x rows step only left 4 vs 5 between quadratic and the bound).
        expect(growth).toBeLessThan(32)
    })
})

// ───────────────── Finding 2: empty Comment-placeholder host takes the previous Text ─────────────────
describe('F2 empty Comment-ph unit claims the preceding sibling Text', () => {
    test('F2a static text followed by a boolean child keeps its text', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <p>Hello{false}</p>
        }
        const hyd = ssrInto(App)
        hydrateRoot(hyd, createElement(App, null as any))
        expect({text: hyd.textContent, reports}).toEqual({text: 'Hello', reports: []})
    })

    test('F2b atom text followed by a component that renders nothing: text and binding survive', () => {
        const make = () => {
            const name = atom('Ann')
            function Maybe({}: any, {createElement}: RenderContext) { return () => null }
            function App({}: any, {createElement}: RenderContext) {
                return <p>{name}<Maybe/></p>
            }
            return {App, name}
        }
        const s = make()
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(s.App, null as any)).html
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        expect(hyd.textContent).toBe('Ann')
        h.name('Bob')
        expect(hyd.textContent).toBe('Bob')
    })
})

describe('F2 regression: text ownership in other containers and across hydrations', () => {
    function FragmentApp({}: any, {createElement, Fragment}: RenderContext) {
        return <Fragment>Hello{false}<i>tail</i></Fragment>
    }
    function ArrayApp({}: any, {createElement}: RenderContext) {
        return <p>{['Hello', false, 'World', true]}</p>
    }
    test('F2c Fragment root and array (DirectNodes) siblings keep their text', () => {
        for (const App of [FragmentApp, ArrayApp]) {
            const hyd = ssrInto(App)
            hydrateRoot(hyd, createElement(App, null as any))
            expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
        }
    })

    test('F2d two hydrations in a row: the ownership set of the first does not leak into the second', () => {
        const make = () => {
            const name = atom('Ann')
            function Maybe({}: any, {createElement}: RenderContext) { return () => null }
            function Row({}: any, {createElement}: RenderContext) { return name } // Comment-ph atom: own text
            function App({}: any, {createElement}: RenderContext) {
                return <div><p>{name}<Maybe/></p><p>Hi <Row/></p></div>
            }
            return {App, name}
        }
        const html = renderToString(createElement(make().App, null as any)).html
        const run = () => {
            const hyd = mount()
            hyd.innerHTML = html
            const ownTextBefore = hyd.querySelectorAll('p')[1].childNodes[4] // Text("Ann") inside axii:t
            const h = make()
            const root = hydrateRoot(hyd, createElement(h.App, null as any))
            const sameOwnText = hyd.querySelectorAll('p')[1].childNodes[1] === ownTextBefore
            h.name('Bob')
            const text = hyd.textContent
            root.destroy()
            return {text, sameOwnText}
        }
        const first = run()
        const second = run()
        expect({first, second, reports}).toEqual({
            first: {text: 'BobHi Bob', sameOwnText: true},
            second: {text: 'BobHi Bob', sameOwnText: true},
            reports: [],
        })
    })
})

// Found while writing the F2 regression: array children with null / boolean items.
describe('N1 array child with null / boolean items (list.map(i => cond ? <li/> : null))', () => {
    test('N1a element-child array: hydrates, equals CSR, no report', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <ul>{[1, 2, 3, 4].map(i => i % 2 ? <li>{i}</li> : null)}{[false, 'x', undefined, true]}</ul>
        }
        const hyd = ssrInto(App)
        const liBefore = Array.from(hyd.querySelectorAll('li'))
        hydrateRoot(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports, sameLi: Array.from(hyd.querySelectorAll('li')).every((li, i) => li === liBefore[i])})
            .toEqual({dom: kids(csr(App)), reports: [], sameLi: true})
    })

    test('N1b the same arrays under a Fragment root', () => {
        function App({}: any, {createElement, Fragment}: RenderContext) {
            return <Fragment>{[1, 2, 3].map(i => i % 2 ? <b>{i}</b> : null)}{['x', false]}</Fragment>
        }
        const hyd = ssrInto(App)
        hydrateRoot(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })
})

// Found while designing F1: Fragment children metadata slots.
describe('N2 Fragment with an element that has its own dynamic child, followed by a dynamic sibling', () => {
    const cases: {[name: string]: (ce: any, F: any, a: any, c: any, n: any) => any} = {
        'N2a component returns <><b>{a}</b>{c}</>': (createElement, Fragment, a, c) =>
            <Fragment><b>{a}</b>{c}</Fragment>,
        'N2b <>{a}<b>{() => n * 2}</b>{() => n > 1 ? <i/> : text}</>': (createElement, Fragment, a, c, n) =>
            <Fragment>{a}<b>{() => n() * 2}</b>{() => n() > 1 ? <i>big</i> : 'small'}</Fragment>,
        'N2c element-child Fragment (flattened)': (createElement, Fragment, a, c) =>
            <div><Fragment><b>{a}</b>{c}</Fragment><i>t</i></div>,
        'N2d nested Fragments': (createElement, Fragment, a, c, n) =>
            <Fragment><u>{a}</u><Fragment><b>{c}</b>{() => n()}<Fragment>{a}<s>{c}</s></Fragment></Fragment>{c}</Fragment>,
    }
    for (const name of Object.keys(cases)) {
        test(name, async () => {
            const make = () => {
                const a = atom('a'), c = atom('c'), n = atom(1)
                function App({}: any, {createElement, Fragment}: RenderContext) {
                    return cases[name](createElement, Fragment, a, c, n)
                }
                return {App, a, c, n}
            }
            const hyd = mount()
            hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
            const cs = make(), h = make()
            const client = mount()
            createRoot(client).render(createElement(cs.App, null as any))
            hydrateRoot(hyd, createElement(h.App, null as any))
            const first = {dom: kids(hyd), reports: reports.slice()}
            for (const s of [cs, h]) { s.a('A'); s.c('C'); s.n(2) }
            await tick()
            expect({first, after: kids(hyd)}).toEqual({first: {dom: first.dom, reports: []}, after: kids(client)})
            expect(first.dom).toBe(kids(mountCsr(make().App)))
        })
    }
    function mountCsr(App: any) { return csr(App) }
})

// ───────────────── Finding 3: FTS anchor look-ahead takes another function child's anchor ─────────────────
describe('F3 claimFunctionTextPlaceholder takes the first computed+axii:0 pair it sees', () => {
    test.fails('F3a text-state function child before a structure-state one must hydrate', async () => {
        const make = () => {
            const title = atom('title')
            function App({}: any, {createElement}: RenderContext) {
                return <h1>{() => title()}{() => <b>badge</b>}</h1>
            }
            return {App, title}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const h = make()
        if (!hydrateKnownDefect(hyd, createElement(h.App, null as any), /hydrate mismatch: expected text unit/)) return
        h.title('t2')
        await tick()
        expect(hyd.textContent).toBe('t2badge')
    })

    test.fails('F3b function → Fragment → function: node order must equal CSR', () => {
        function App({}: any, {createElement, Fragment}: RenderContext) {
            return <div>{() => <Fragment>{() => <b>x</b>}</Fragment>}</div>
        }
        const hyd = ssrInto(App)
        if (!hydrateKnownDefect(hyd, createElement(App, null as any))) return
        expect(kids(hyd)).toBe(kids(csr(App)))
    })
})

// ───────────────── Finding 4: structural drift is neither reported nor repaired ─────────────────
describe('F4 §3.7 structural mismatch: must be reported and rebuilt to the CSR shape', () => {
    const listApp = (items: number[]) => {
        const list = new RxList(items)
        return function App({}: any, {createElement}: RenderContext) {
            return <ul>{list.map(i => <li>{i}</li>)}</ul>
        }
    }
    test.fails('F4a client list has one more row than the server HTML', () => {
        const hyd = ssrInto(listApp([1, 2]))
        if (!hydrateKnownDefect(hyd, createElement(listApp([1, 2, 3]), null as any))) return
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(listApp([1, 2, 3])))})
    })

    test.fails('F4b client list has one row fewer than the server HTML', () => {
        const hyd = ssrInto(listApp([1, 2, 3]))
        if (!hydrateKnownDefect(hyd, createElement(listApp([1, 2]), null as any))) return
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(listApp([1, 2])))})
    })

    const fnApp = (asElement: boolean) => function App({}: any, {createElement}: RenderContext) {
        return <div>{() => asElement ? <b>el</b> : 'text'}<i>tail</i></div>
    }
    test.fails('F4c server rendered an element, client function returns text', () => {
        const hyd = ssrInto(fnApp(true))
        if (!hydrateKnownDefect(hyd, createElement(fnApp(false), null as any))) return
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(fnApp(false)))})
    })

    test.fails('F4d server rendered text, client function returns an element', () => {
        const hyd = ssrInto(fnApp(false))
        // throws instead of rebuilding
        if (!hydrateKnownDefect(hyd, createElement(fnApp(true), null as any), /expected <!--computed node--> before FunctionHost placeholder/)) return
        expect(kids(hyd)).toBe(kids(csr(fnApp(true))))
    })
})

// ───────────────── Finding 5: table rows are deleted by hydration ─────────────────
describe('F5 SSR wraps bare rows in <tbody>; hydration removes that tbody', () => {
    test('F5a static <table><tr>: rows must survive hydration, no mismatch report', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <table><tr><td>1</td></tr></table>
        }
        const hyd = ssrInto(App)
        expect(hyd.querySelectorAll('td').length).toBe(1)
        hydrateRoot(hyd, createElement(App, null as any))
        expect({cells: hyd.querySelectorAll('td').length, reports}).toEqual({cells: 1, reports: []})
    })

    test('F5b <table>{list.map(row)}</table>: rows survive and the list stays live', () => {
        const make = () => {
            const list = new RxList([1, 2])
            function App({}: any, {createElement}: RenderContext) {
                return <table>{list.map(i => <tr><td>{i}</td></tr>)}</table>
            }
            return {App, list}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        expect(Array.from(hyd.querySelectorAll('td')).map(td => td.textContent)).toEqual(['1', '2'])
        h.list.push(3)
        expect(Array.from(hyd.querySelectorAll('td')).map(td => td.textContent)).toEqual(['1', '2', '3'])
    })
})

describe('F5 regression: implied vs authored tbody', () => {
    test('F5c component row under <table> (tbody implied by the parser): rows survive, no report', () => {
        function Row({n}: any, {createElement}: RenderContext) { return <tr><td>{n}</td></tr> }
        function App({}: any, {createElement}: RenderContext) { return <table><Row n="1"/></table> }
        const hyd = ssrInto(App)
        const tdBefore = hyd.querySelector('td')
        hydrateRoot(hyd, createElement(App, null as any))
        expect({sameTd: hyd.querySelector('td') === tdBefore, text: hyd.textContent, reports})
            .toEqual({sameTd: true, text: '1', reports: []})
    })

    test('F5d authored <thead>/<tbody> are claimed as themselves; a conditional row function stays live', async () => {
        const make = () => {
            const more = atom(false)
            const list = new RxList([1])
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <table id="authored"><thead><tr><th>h</th></tr></thead><tbody>{list.map(i => <tr><td>{i}</td></tr>)}</tbody></table>
                    <table id="implied">{() => more() ? <tr><td>more</td></tr> : null}</table>
                </div>
            }
            return {App, more, list}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const sections = Array.from(hyd.querySelectorAll('#authored > *'))
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        expect(reports).toEqual([])
        expect(Array.from(hyd.querySelectorAll('#authored > *'))).toEqual(sections)
        h.list.push(2)
        h.more(true)
        await tick()
        expect(Array.from(hyd.querySelectorAll('td')).map(td => td.textContent)).toEqual(['1', '2', 'more'])
    })
})

// ───────────────── Finding 6: SSR skips the component prop pipeline ─────────────────
describe('F6 renderToString does not apply propTypes defaults / bindProps / as / AOP overrides', () => {
    test('F6a propTypes default values: parsed SSR ≡ CSR', () => {
        function Label(props: any, {createElement}: RenderContext) {
            return <div>{props.label}|{String(props.n)}</div>
        }
        ;(Label as any).propTypes = {
            label: PropTypes.string.default(() => 'dflt'),
            n: PropTypes.number.default(() => 3),
        }
        function App({}: any, {createElement}: RenderContext) { return <Label/> }
        expect(kids(ssrInto(App))).toBe(kids(csr(App)))
    })

    test('F6b bindProps: parsed SSR ≡ CSR', () => {
        function Show(props: any, {createElement}: RenderContext) {
            return <div>{String(props.a)}</div>
        }
        const Bound = bindProps(Show as any, {a: 5})
        function App({}: any, {createElement}: RenderContext) { return <Bound/> }
        expect(kids(ssrInto(App))).toBe(kids(csr(App)))
    })

    test('F6c as="name" + $name:prop overrides: parsed SSR ≡ CSR', () => {
        function Card(props: any, {createElement}: RenderContext) {
            return <div as="root"><span as="label">x</span></div>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <Card $root:className="over" $label:data-x="1"/>
        }
        expect(kids(ssrInto(App))).toBe(kids(csr(App)))
    })
})

// ───────────────── Finding 7: element props serialized without CSR value semantics ─────────────────
describe('F7 serializeAttrs / serializeSsrElement vs DOM.setAttribute', () => {
    test('F7a checkbox checked={atom(false)} must not be checked in the server HTML', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <input id="c" type="checkbox" checked={atom(false)}/>
        }
        expect((ssrInto(App).querySelector('#c') as HTMLInputElement).checked)
            .toBe((csr(App).querySelector('#c') as HTMLInputElement).checked)
    })

    test('F7b function-valued value: server HTML must carry the value, not the function source', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <form><input id="i" value={() => 'hello'}/><textarea id="t" value={() => 'hello'}/></form>
        }
        const ssr = ssrInto(App), client = csr(App)
        expect((ssr.querySelector('#i') as HTMLInputElement).value).toBe((client.querySelector('#i') as HTMLInputElement).value)
        expect((ssr.querySelector('#t') as HTMLTextAreaElement).value).toBe((client.querySelector('#t') as HTMLTextAreaElement).value)
    })

    test('F7c className array / object with reactive value: parsed SSR class ≡ CSR class', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="a" className={['a', 'b']}><i id="o" className={{active: atom(false), base: true}}>x</i></div>
        }
        const ssr = ssrInto(App), client = csr(App)
        expect(ssr.querySelector('#a')!.className).toBe(client.querySelector('#a')!.className)
        expect(ssr.querySelector('#o')!.className).toBe(client.querySelector('#o')!.className)
    })

    test('F7d dangerouslySetInnerHTML (string, the CSR contract): present in SSR and after hydration', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><div id="raw" dangerouslySetInnerHTML={'<em>raw</em>'}/></div>
        }
        const expected = csr(App).querySelector('#raw')!.innerHTML
        expect(expected).toBe('<em>raw</em>')
        const hyd = ssrInto(App)
        const before = hyd.querySelector('#raw')!.innerHTML
        hydrateRoot(hyd, createElement(App, null as any))
        const after = hyd.querySelector('#raw')!.innerHTML
        expect({before, after}).toEqual({before: expected, after: expected})
    })
})

describe('F7 regression: hydration of the new server output', () => {
    test('F7e reactive form values hydrate without reports and stay bound', () => {
        const make = () => {
            const on = atom(false), text = atom('hello')
            function App({}: any, {createElement}: RenderContext) {
                return <form>
                    <input id="c" type="checkbox" checked={on}/>
                    <input id="i" value={() => text()}/>
                    <textarea id="t" value={text}/>
                </form>
            }
            return {App, on, text}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const inputBefore = hyd.querySelector('#i')
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        h.on(true); h.text('bye')
        expect({
            sameInput: hyd.querySelector('#i') === inputBefore,
            checked: (hyd.querySelector('#c') as HTMLInputElement).checked,
            input: (hyd.querySelector('#i') as HTMLInputElement).value,
            textarea: (hyd.querySelector('#t') as HTMLTextAreaElement).value,
        }).toEqual({sameInput: true, checked: true, input: 'bye', textarea: 'bye'})
    })

    test('F7f dangerouslySetInnerHTML function form: server nodes kept until the value changes, no report', () => {
        const make = () => {
            const html = atom('<em>raw</em>')
            function App({}: any, {createElement}: RenderContext) {
                return <div><div id="raw" dangerouslySetInnerHTML={() => html()}/><b>sibling</b></div>
            }
            return {App, html}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        const first = hyd.querySelector('#raw')!.innerHTML
        h.html('<u>2</u>')
        expect({first, second: hyd.querySelector('#raw')!.innerHTML, sibling: hyd.querySelector('#raw + b')!.textContent, reports})
            .toEqual({first: '<em>raw</em>', second: '<u>2</u>', sibling: 'sibling', reports: []})
    })
})

describe('F7 regression: dangerouslySetInnerHTML on an element rebuilt after a tag mismatch', () => {
    test('F7g the rebuilt element gets its raw markup', () => {
        const app = (tag: string) => function App({}: any, {createElement}: RenderContext) {
            return <section>{createElement(tag, {id: 'raw', dangerouslySetInnerHTML: '<em>raw</em>'})}</section>
        }
        const hyd = ssrInto(app('p'))
        hydrateRoot(hyd, createElement(app('div'), null as any))
        expect({reported: reports.length > 0, dom: kids(hyd)}).toEqual({reported: true, dom: kids(csr(app('div')))})
    })
})

// ───────────────── Finding 8: attribute / tag names reach the HTML unescaped ─────────────────
describe('F8 hostile prop keys and tag names', () => {
    test('F8a spread of an untrusted object must not create attributes it did not ask for', () => {
        const untrusted: any = JSON.parse('{"x onmouseover=alert(1) y": "v", "a><img src=x onerror=alert(2)><b": "v"}')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="host" {...untrusted}>text</div>
        }
        // CSR oracle: the DOM refuses these names (InvalidCharacterError), nothing is created
        expect(() => csr(App)).toThrow()
        let el: HTMLElement
        try {
            el = ssrInto(App)
        } catch {
            return // refusing the name on the server (as the DOM does) is an acceptable outcome
        }
        const host = el.querySelector('#host')!
        expect({onmouseover: host.getAttribute('onmouseover'), injectedImg: !!el.querySelector('img')})
            .toEqual({onmouseover: null, injectedImg: false})
    })

    test('F8b an untrusted tag name must not open other elements', () => {
        function App({}: any, {createElement}: RenderContext) {
            return createElement('div><script>window.__pwned=1</script' as any, null, 'x')
        }
        // CSR oracle: document.createElement refuses the name
        expect(() => csr(App)).toThrow()
        let el: HTMLElement
        try {
            el = ssrInto(App)
        } catch {
            return
        }
        expect(el.querySelector('script')).toBe(null)
    })
})

// ───────────────── Confirmed, beyond the 8-finding cap (one compact test each) ─────────────────
describe('X extra confirmed defects', () => {
    test('X1 inline SVG is claimed (identity kept, no report) and dash attributes match CSR', () => {
        function App({}: any, {createElement, createSVGElement}: RenderContext) {
            return <div>{createSVGElement('svg', {viewBox: '0 0 10 10'},
                createSVGElement('path', {d: 'M0 0L1 1', strokeWidth: 2}))}</div>
        }
        const hyd = ssrInto(App)
        const parsed = kids(hyd)
        const svgBefore = hyd.querySelector('svg')
        hydrateRoot(hyd, createElement(App, null as any))
        expect({parsed, sameSvg: hyd.querySelector('svg') === svgBefore, reports})
            .toEqual({parsed: kids(csr(App)), sameSvg: true, reports: []})
    })

    test('X1b SVG <a> vs HTML <a>, xlink attributes, camelCase tags: claimed in place', () => {
        function App({}: any, {createElement, createSVGElement}: RenderContext) {
            return <div>
                <a href="/h">html</a>
                {createSVGElement('svg', {width: 10},
                    createSVGElement('defs', null, createSVGElement('clipPath', {id: 'c'}, createSVGElement('rect', {width: 1, height: 1}))),
                    createSVGElement('a', {xlinkHref: '#x'}, createSVGElement('text', {fillOpacity: 0.5}, 't')),
                    createSVGElement('use', {'xlink:href': '#y'}))}
            </div>
        }
        const hyd = ssrInto(App)
        const parsed = kids(hyd)
        const before = Array.from(hyd.querySelectorAll('*'))
        hydrateRoot(hyd, createElement(App, null as any))
        const after = Array.from(hyd.querySelectorAll('*'))
        expect({parsed, same: after.length === before.length && after.every((n, i) => n === before[i]), reports})
            .toEqual({parsed: kids(csr(App)), same: true, reports: []})
    })

    test('X1c <svg><path/></svg> as a component root (plain JSX tags): the content survives hydration', () => {
        function Icon({}: any, {createElement}: RenderContext) {
            return <svg viewBox="0 0 24 24"><g><path d="M0 0L1 1"/><circle cx="1" cy="1" r="1"/></g></svg>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <button><Icon/>label</button>
        }
        for (const Root of [Icon, App]) {
            const hyd = ssrInto(Root)
            const before = Array.from(hyd.querySelectorAll('*'))
            expect(hyd.querySelectorAll('path, circle').length).toBe(2)
            hydrateRoot(hyd, createElement(Root, null as any))
            const after = Array.from(hyd.querySelectorAll('*'))
            expect({dom: kids(hyd), same: after.length === before.length && after.every((n, i) => n === before[i]), reports})
                .toEqual({dom: kids(csr(Root)), same: true, reports: []})
        }
    })

    test('X2 a root rendered from useEffect during hydrateRoot gets its content', () => {
        let tipHtml = ''
        function App({}: any, {createElement, useEffect}: RenderContext) {
            useEffect(() => {
                const tip = mount()
                createRoot(tip).render(<span>tip</span>)
                tipHtml = tip.innerHTML
            })
            return <div><span>main</span></div>
        }
        const hyd = ssrInto(App)
        hydrateRoot(hyd, createElement(App, null as any))
        expect(tipHtml).toBe('<span>tip</span><!--root-->')
    })

    test('X2b layout effects, refs and error listeners also run outside the claim context; a nested hydrateRoot is isolated', () => {
        function Island({}: any, {createElement}: RenderContext) { return <i>island</i> }
        const island = mount()
        island.innerHTML = renderToString(createElement(Island, null as any)).html
        const islandNode = island.querySelector('i')
        const made: {[k: string]: string} = {}
        let islandHydrated = false
        function Child({}: any, {createElement, useEffect, useLayoutEffect}: RenderContext) {
            useEffect(() => {
                // a complete, separate hydration started from inside the outer one (once: the CSR
                // oracle below renders App again and must not hydrate the island a second time)
                if (!islandHydrated) {
                    islandHydrated = true
                    hydrateRoot(island, createElement(Island, null as any))
                }
                made.effect = (<b>from effect</b> as HTMLElement).outerHTML
            })
            useLayoutEffect(() => { made.layout = (<b>from layout</b> as HTMLElement).outerHTML })
            return <p ref={() => { made.ref = (<b>from ref</b> as HTMLElement).outerHTML }}>child</p>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Child/><b>ssr b</b><span>after</span></div>
        }
        const hyd = ssrInto(App)
        const before = Array.from(hyd.querySelectorAll('*'))
        hydrateRoot(hyd, createElement(App, null as any))
        const after = Array.from(hyd.querySelectorAll('*'))
        expect({
            made,
            same: after.length === before.length && after.every((n, i) => n === before[i]),
            islandSame: island.querySelector('i') === islandNode,
            dom: kids(hyd),
            reports,
        }).toEqual({
            made: {effect: '<b>from effect</b>', layout: '<b>from layout</b>', ref: '<b>from ref</b>'},
            same: true,
            islandSame: true,
            dom: kids(csr(App)),
            reports: [],
        })
    })

    // X2b's nested hydrateRoot used to end the outer hydration as a side effect, which let the layout
    // effect / ref part pass on the unfixed code too. Same check without the nested hydration.
    test('X2c layout effects and refs (via the attach dispatch) render fresh roots, not claims', () => {
        const made: {[k: string]: string} = {}
        function Child({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                const tip = mount()
                createRoot(tip).render(<span>tip</span>)
                made.layout = tip.innerHTML
            })
            return <p ref={() => {
                const tip = mount()
                createRoot(tip).render(<em>ref</em>)
                made.ref = tip.innerHTML
            }}>child</p>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Child/><span>s</span><em>e</em></div>
        }
        const hyd = ssrInto(App)
        const before = Array.from(hyd.querySelectorAll('*'))
        hydrateRoot(hyd, createElement(App, null as any))
        const after = Array.from(hyd.querySelectorAll('*'))
        expect({made, same: after.length === before.length && after.every((n, i) => n === before[i]), reports}).toEqual({
            made: {layout: '<span>tip</span><!--root-->', ref: '<em>ref</em><!--root-->'},
            same: true,
            reports: [],
        })
    })

    test('X3 reactive attributes are in the server HTML; a reactive id does not force a rebuild', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><a id={atom('link')} href={() => '/x'} className={() => 'c'}>go</a></div>
        }
        const hyd = ssrInto(App)
        const parsed = kids(hyd)
        const aBefore = hyd.querySelector('a')
        hydrateRoot(hyd, createElement(App, null as any))
        expect({parsed, sameA: hyd.querySelector('a') === aBefore, reports})
            .toEqual({parsed: kids(csr(App)), sameA: true, reports: []})
    })

    test('X4 textarea: value survives parsing, hydration reports nothing', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <form><textarea id="nl" value={'\nabc'}/><textarea id="two">{'a'}{'b'}</textarea></form>
        }
        const hyd = ssrInto(App), client = csr(App)
        const value = (root: HTMLElement, id: string) => (root.querySelector('#' + id) as HTMLTextAreaElement).value
        const parsed = {nl: value(hyd, 'nl'), two: value(hyd, 'two')}
        hydrateRoot(hyd, createElement(App, null as any))
        expect({parsed, reports}).toEqual({parsed: {nl: value(client, 'nl'), two: value(client, 'two')}, reports: []})
    })

    test('X4b character-data parents: concatenated units are split back, updates stay bound, no report', () => {
        const make = () => {
            const name = atom('Ann'), empty = atom(''), note = atom('n1')
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <title>Hi {name}{empty}!</title>
                    <textarea id="kids">Hello {name}</textarea>
                    <textarea id="val" value={note}/>
                    <pre id="raw" dangerouslySetInnerHTML={'\nline'}/>
                    <pre id="txt">{'\nline'}</pre>
                </div>
            }
            return {App, name, empty, note}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const c = make()
        const client = mount()
        createRoot(client).render(createElement(c.App, null as any))
        const read = (root: HTMLElement) => ({
            title: root.querySelector('title')!.textContent,
            kids: (root.querySelector('#kids') as HTMLTextAreaElement).value,
            val: (root.querySelector('#val') as HTMLTextAreaElement).value,
            raw: root.querySelector('#raw')!.textContent,
            txt: root.querySelector('#txt')!.textContent,
        })
        const parsed = read(hyd)
        const csrBefore = read(client)
        expect(csrBefore).toEqual({title: 'Hi Ann!', kids: 'Hello Ann', val: 'n1', raw: '\nline', txt: '\nline'})
        const firstTitleText = hyd.querySelector('title')!.firstChild
        const h = make()
        hydrateRoot(hyd, createElement(h.App, null as any))
        const sameFirst = hyd.querySelector('title')!.firstChild === firstTitleText
        for (const s of [c, h]) { s.name('Bob'); s.empty('?'); s.note('n2') }
        expect({parsed, sameFirst, after: read(hyd), shape: kids(hyd), reports})
            .toEqual({parsed: csrBefore, sameFirst: true, after: read(client), shape: kids(client), reports: []})
        expect(read(hyd).title).toBe('Hi Bob?!')
    })

    test('X5 aria-*/data-* false and htmlFor: parsed SSR ≡ CSR', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><b aria-expanded={false} data-on={false}>y</b><label htmlFor="q">l</label></div>
        }
        expect(kids(ssrInto(App))).toBe(kids(csr(App)))
    })

    test('X5b enumerated false (draggable / spellcheck / contentEditable), meta/form names, detachStyle', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <form acceptCharset="utf-8">
                <p draggable={false} spellcheck={false} contentEditable={false} hidden={false}>y</p>
                <span detachStyle={{opacity: 0} as any}>z</span>
            </form>
        }
        const hyd = ssrInto(App)
        const parsed = kids(hyd)
        hydrateRoot(hyd, createElement(App, null as any))
        expect({parsed, hydrated: kids(hyd), reports}).toEqual({parsed: kids(csr(App)), hydrated: kids(csr(App)), reports: []})
    })

    test('X6 <script> text containing "<!--<script>" must not swallow the rest of the page', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><script type="application/json">{'{"x":"<!--<script>"}'}</script><p id="after">after</p></div>
        }
        // §3.6.1 policy for RAWTEXT payloads that cannot be serialized: renderToString throws.
        // Either outcome keeps the page intact; silently emitting the swallowing markup does not.
        let refused = false
        let el: HTMLElement | undefined
        try { el = ssrInto(App) } catch { refused = true }
        expect(refused || !!el!.querySelector('#after')).toBe(true)
    })

    test('X7 inline style value cannot add declarations that the CSSOM (CSR) rejects', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="s" style={{color: 'red;position:fixed'}}>x</div>
        }
        expect((ssrInto(App).querySelector('#s') as HTMLElement).style.position)
            .toBe((csr(App).querySelector('#s') as HTMLElement).style.position)
    })

    test('X7b inline declarations: hostile values / names are dropped like the CSSOM does, legal ones kept', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="s" style={{
                color: 'red !important',
                background: 'url("a;b.png") no-repeat',
                width: 'calc(1px + (2px * 3))',
                fontFamily: '"A;B", serif',
                margin: '1px\\',
                '--tok': 'a;b',
                '--ok': '{"k": [1, 2]}',
                'top:0;position': 'fixed',
            } as any}>x</div>
        }
        const read = (root: HTMLElement) => {
            const st = (root.querySelector('#s') as HTMLElement).style
            return {color: st.color, bg: st.backgroundImage, width: st.width, font: st.fontFamily, margin: st.margin,
                tok: st.getPropertyValue('--tok'), ok: st.getPropertyValue('--ok'), position: st.position, top: st.top}
        }
        expect(read(ssrInto(App))).toEqual(read(csr(App)))
    })
})

// ───────────────── Follow-up review of #48: RAWTEXT elements inside foreign content ─────────────────
describe('F9 <style> / <script> under <svg> / <math> are parsed as foreign elements (text is normal data)', () => {
    // (a literal </style> / <!--<script> is covered by the Node spec; here the unfixed serializer must not throw first)
    const hostile = 'a>b{} <img src=x onerror="window.__axiiF9=1"> &amp; <p>'
    test('F9c the parsed server HTML contains no element made from the text, and the text round-trips', () => {
        function App({}: any, {createElement, createSVGElement}: RenderContext) {
            return <div>
                <svg id="a"><style>{hostile}</style></svg>
                <svg id="b">{createSVGElement('style', null as any, hostile)}{createSVGElement('script', {type: 'text/plain'}, hostile)}</svg>
                <math id="c"><style>{hostile}</style></math>
            </div>
        }
        const ssr = ssrInto(App)
        expect({
            img: ssr.querySelectorAll('img').length,
            texts: Array.from(ssr.querySelectorAll('style, script')).map(n => n.textContent),
        }).toEqual({img: 0, texts: [hostile, hostile, hostile, hostile]})
    })

    test('F9d createSVGElement("style") with several text units hydrates in place, stays bound, reports nothing', () => {
        const make = () => {
            const color = atom('red')
            function App({}: any, {createElement, createSVGElement}: RenderContext) {
                return <svg>{createSVGElement('style', null as any, 'a>b{fill:', color, '} & <x>')}<circle r="1"/></svg>
            }
            return {App, color}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const styleBefore = hyd.querySelector('style')
        const h = make(), c = make()
        const client = mount()
        createRoot(client).render(createElement(c.App, null as any))
        hydrateRoot(hyd, createElement(h.App, null as any))
        const first = {text: hyd.querySelector('style')!.textContent, same: hyd.querySelector('style') === styleBefore}
        h.color('blue'); c.color('blue')
        expect({first, after: kids(hyd), reports})
            .toEqual({first: {text: 'a>b{fill:red} & <x>', same: true}, after: kids(client), reports: []})
    })
})
