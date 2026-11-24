/** @jsx createElement */
/**
 * Audit: hydration + SSR ≡ CSR.
 * On pristine v4.8.1 every F* / X* / N* test of the original audit fails. With the fixes in src/:
 *  - pass: F1a, F1c, F1e (#54: claim order = JSX evaluation order, raw markup skipped), F1d
 *    (mitigated: cubic → quadratic), F2, F5, F6, F7, F8, X1–X7, N1, N2 and their regressions;
 *    I50 (#50, dangerouslySetInnerHTML={{__html}} on the client; fails on 4712285);
 *  - NOT fixed, kept as `test.fails` so the evidence stays executable (each flips to a failure the
 *    day it starts passing): F1b, F1f–F1h (content a component / function child renders later is
 *    taken by a same-tag element of the parent), F1j (a raw-markup element claims a same-tag node
 *    inside its own markup), F3a, F3b (function-child anchor look-ahead),
 *    F4a–F4d (structural drift). All of them need hydration to claim top-down by position (#55);
 *    JSX evaluates children before their parent, so that means deferred descriptors instead of
 *    live nodes during hydration — a design decision.
 *
 * Oracles:
 *  (a) parse the server HTML in the browser and compare with a CSR render of the same tree;
 *  (b) hydrate, change the reactive data, compare with a CSR root given the same change;
 *  (c) hydration of unmodified renderToString output must report no HydrationMismatchError.
 */
import {
    createElement,
    createRoot,
    bindProps,
    PropTypes,
    RenderContext,
} from '@framework'
import {atom, RxList} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {isSsrPass} from '../src/ssrContext.js'
import {
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    resetAxiiRetainedObjectDiagnostics,
} from '../src/retainedObjectDiagnostics'
import {hydrate, HYDRATE_DIAGNOSTICS, TOP_DOWN_PASS, configureDiagnostics} from './helpers/hydrate'

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

// ───────────────────────── Finding 1: element claim order ─────────────────────────
// v4.8.1 claimed the deepest same-tag element of the whole root (F1a / F1c / F1e). #54 claims the first
// one in children-before-parent order (the order JSX evaluates createElement) and skips raw markup.
describe('F1 tryClaimElement: which same-tag element of the root a createElement claims', () => {
    test('F1a same tag at two depths: hydrated DOM must equal CSR and report nothing', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><span>a</span><p><span>b</span></p></div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    // #55: App's <p>hello</p> is claimed while App's JSX is evaluated, before <Header/> renders; the
    // first unclaimed <p> in children-before-parent order is Header's. Needs component-region
    // awareness (top-down claim), not a different search order.
    test('F1b child component deeper than a later sibling: content must survive hydration', () => {
        function Header({}: any, {createElement}: RenderContext) {
            return <header><nav><p>deep</p></nav></header>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Header/><main><p>hello</p></main></div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        expect(kids(hyd)).toBe(kids(csr(App)))
    })

    test('F1c listeners must be bound to the element at the same position', () => {
        const log: string[] = []
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <button onClick={() => log.push('A')}>x</button>
                <p><button onClick={() => log.push('B')}>x</button></p>
            </div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        ;(hyd.querySelectorAll('button')[0] as HTMLButtonElement).click()
        expect(log).toEqual(['A'])
    })

    test('F1e markup written by dangerouslySetInnerHTML is not claimed by a same-tag JSX sibling', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div><div id="raw" dangerouslySetInnerHTML={'<p><em>raw</em></p>'}/><em>sibling</em></div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    // ── #55: content that a Host renders after the parent's JSX was evaluated ──
    // A component / function child renders after the parent's whole JSX is evaluated, so the parent's
    // own elements are claimed first. When the parent has a same-tag element nested in a later sibling,
    // the first unclaimed one in children-before-parent order is the child's (it comes earlier).
    // F1f / F1g passed on 4e5dbef only because the deepest-candidate rule happened to pick the deeper
    // element; that rule is what broke F1a / F1c, and the static form is far more common. F1h fails
    // under both rules (it throws). Fixing these needs top-down claim by position (#55).
    test('F1f component output shallower than a same-tag element in a later sibling', () => {
        function Comp({}: any, {createElement}: RenderContext) { return <p>c</p> }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Comp/><main><p>x</p></main></div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    test('F1g function child output shallower than a same-tag element in a later sibling', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => <p>f</p>}<main><p>x</p></main></div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    test('F1h component wrapping a same-tag element, same depth as one in a later sibling', () => {
        function Comp({}: any, {createElement}: RenderContext) { return <header><div>logo</div></header> }
        function App({}: any, {createElement}: RenderContext) {
            return <div><Comp/><main><div>x</div></main></div>
        }
        const hyd = ssrInto(App)
        // throws: App's <div>x</div> takes Comp's <div>, so Comp's <header> no longer fits the cursor
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports}).toEqual({dom: kids(csr(App)), reports: []})
    })

    // #55 (same class as F1e, not covered by #54's mitigation): the raw element's own claim still looks
    // inside its own markup. Its markup is skipped only once it is claimed; while it is being claimed, an
    // element of the same tag inside that markup comes first in children-before-parent order, and the
    // DOM alone cannot tell the raw element from the nodes of its own markup (the server writes no
    // marker for it). Already failing on 4e5dbef (the deepest-candidate rule picks the inner node too).
    // Here the raw element and its markup are removed (reported); as an RxList row it is silent instead:
    // no report, class / listeners land on the inner node. A static id avoids it (exact-id match).
    test('F1j raw markup containing the raw element\'s own tag: the element claims itself, not its markup', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <section><div className="raw" dangerouslySetInnerHTML={'<div><b>raw</b></div>'}/><b>sibling</b></section>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
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
            hydrate(hyd, createElement(make(), null as any))
            return performance.now() - t0
        }
        // best of 3: scheduling noise (other browser processes, GC) only ever adds time
        const best = (n: number) => Math.min(hydrateMs(n), hydrateMs(n), hydrateMs(n))
        best(50) // warm up
        // Internal entry (#55 B2): 150 / 600 rows hydrate in ~0.1–0.4 ms, at the 0.1 ms timer resolution, so the ratio says
        //  nothing there; 3000 / 12000 rows (~1.4 / ~6 ms) keep the same 4x step measurable.
        const [smallN, largeN] = TOP_DOWN_PASS ? [3000, 12000] : [150, 600]
        const small = best(smallN)
        const large = best(largeN)
        const growth = large / small
        // eslint-disable-next-line no-console
        console.log(`[F1d] n=${smallN} hydrate=${small.toFixed(1)}ms | n=${largeN} hydrate=${large.toFixed(1)}ms | growth x${growth.toFixed(1)}`)
        // 4x rows: linear → ~4x, quadratic → ~16x, cubic → ~64x. The bound sits at the geometric mean of
        // quadratic and cubic: a factor 2 of timing noise either way still classifies correctly
        // (a 2x rows step only left 4 vs 5 between quadratic and the bound).
        // Internal entry (#55 B2): top-down claiming visits every server node once, so the bound is the geometric mean
        // of linear and quadratic (8) — the same factor 2 of noise margin, one class lower.
        expect(growth).toBeLessThan(TOP_DOWN_PASS ? 8 : 32)
    })
})

// #54: the class behind F1a / F1c / F1e, not just those three shapes. Within one component's JSX (no
// child component / function child), createElement runs in children-before-parent order, so every
// generated tree must hydrate exactly: same DOM as CSR, no report, every server element kept, and each
// listener bound to the element at its own position. Few tags → same-tag elements at every depth.
// Generated: elements (some with a static id), static text, atom text, eager RxList rows, raw markup.
// Not generated: child components / function children (F1b, F1f–F1h) and raw markup that contains the
// raw element's own tag (F1j) — the known limits of this claim model, kept executable above (#55).
// On 4e5dbef 131 of these 300 trees fail (16 throw, 3 are silent: no report).
describe('F1 regression: static trees hydrate in place (deterministic fuzz)', () => {
    const TAGS = ['div', 'span', 'b', 'em', 'section']
    type Kid = Spec | {text: string} | {atom: string} | {rows: Spec[]}
    type Spec = {tag: string, key: string, id?: string, raw?: string, kids: Kid[]}

    function mulberry32(seed: number) {
        let a = seed >>> 0
        return () => {
            a = (a + 0x6D2B79F5) >>> 0
            let t = a
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }
    function generate(seed: number): Spec {
        const rnd = mulberry32(seed)
        const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
        let n = 0
        // markup written by dangerouslySetInnerHTML, built from the same tags as the JSX around it —
        // except the raw element's own tag: that shape is the known limit F1j (#55), excluded here on purpose
        const rawHtml = (own: string, depth: number): string => {
            const tag = pick(TAGS.filter(t => t !== own))
            return `<${tag}>${depth < 2 && rnd() < 0.5 ? rawHtml(own, depth + 1) : `r${n++}`}</${tag}>`
        }
        const element = (depth: number): Spec => {
            const spec: Spec = {tag: depth === 0 ? 'div' : pick(TAGS), key: `k${n++}`, kids: []}
            if (rnd() < 0.2) spec.id = `i${spec.key}`
            if (depth > 0 && rnd() < 0.15) {
                spec.raw = rawHtml(spec.tag, 0)
                return spec
            }
            const count = depth >= 4 ? 0 : Math.floor(rnd() * 4)
            for (let i = 0; i < count; i++) {
                const r = rnd()
                if (r < 0.15) spec.kids.push({text: `t${n++}`})
                else if (r < 0.25) spec.kids.push({atom: `a${n++}`})
                else if (r < 0.35 && depth < 3) {
                    spec.kids.push({rows: Array.from({length: 1 + Math.floor(rnd() * 3)}, () => element(depth + 1))})
                } else spec.kids.push(element(depth + 1))
            }
            return spec
        }
        return element(0)
    }

    function appOf(spec: Spec, log: string[]) {
        function render(s: Spec, h: RenderContext['createElement']): any {
            const props: any = {
                'data-k': s.key,
                onClick: (e: Event) => { if (e.target === e.currentTarget) log.push(s.key) },
            }
            if (s.id) props.id = s.id
            // both value shapes of the same markup (#50): odd keys use the React shape {__html}. Chosen from the key,
            // not from rnd(), so every seed still generates the same tree
            if (s.raw !== undefined) props.dangerouslySetInnerHTML = Number(s.key.slice(1)) % 2 ? {__html: s.raw} : s.raw
            // kids.map runs before createElement(s.tag): the same order as JSX arguments
            const children = s.kids.map(k =>
                'text' in k ? k.text
                    : 'atom' in k ? atom(k.atom)
                        : 'rows' in k ? new RxList(k.rows.map((_, i) => i)).map(i => render(k.rows[i], h))
                            : render(k, h))
            return h(s.tag, props, ...children)
        }
        return function App({}: any, {createElement: h}: RenderContext) { return render(spec, h) }
    }

    test('F1i 300 generated trees: DOM ≡ CSR, no report, server nodes kept, listeners at their own position', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const spec = generate(seed)
            const log: string[] = []
            const hyd = ssrInto(appOf(spec, log))
            const nodesBefore = Array.from(hyd.querySelectorAll('*'))
            const keyed = Array.from(hyd.querySelectorAll('[data-k]')) as HTMLElement[]
            const keysBefore = keyed.map(el => el.getAttribute('data-k'))
            reports.length = 0
            hydrate(hyd, createElement(appOf(spec, log), null as any))
            const nodesAfter = Array.from(hyd.querySelectorAll('*'))
            const clicked = keyed.map(el => { log.length = 0; el.click(); return log.join(',') })
            const actual = {
                seed,
                dom: kids(hyd),
                reports: reports.slice(),
                serverNodesKept: nodesAfter.length === nodesBefore.length && nodesAfter.every((el, i) => el === nodesBefore[i]),
                clicked,
            }
            const expected = {
                seed,
                dom: kids(csr(appOf(spec, []))),
                reports: [],
                serverNodesKept: true,
                clicked: keysBefore,
            }
            expect(actual).toEqual(expected) // `seed` in the diff: rerun generate(seed) to replay
            document.body.innerHTML = ''
        }
    })
})

// #55 B2 (design §7.2 "F1i", §2.4.1): the F1i generator without its exclusions — child components, function children
// (text and structure), Fragments (as element child, component root, function value, list row, array item), static arrays,
// RxList rows of every kind (Compact and non-Compact elements, Fragment, function, atom, primitive, null, array, nested
// list, component), atom / string / number / bigint / boolean / null children and raw markup that contains the raw element's
// own tag. Every tree: DOM ≡ CSR, no report, every server element kept, each listener at its own position, and the Host
// kinds the activation creates equal the kinds a CSR render creates, kind by kind (§2.4.1: createHydrateHost and
// createHost must not diverge; CompactElementHost included). Over the 300 trees each landed kind appears on both sides.
// Since #55 B4 it also generates reusable() (a component returning reusable(source)) and live DOM nodes — a live element or
// Text as an element child, a live Text as a component's result (NodeHost). A live node is client-only content (§2.6.8):
// the server renders the same content as JSX (marked data-live), the activation replaces that counterpart with the live node,
// reports exactly one AXII_HYDRATION_LIVE_NODE per live node when diagnostics are on, and keeps every other server node.
// Not generated: Portal (it needs containers outside the tree; ssrHydrate.lifecycle / hydrateTopDownForms cover it),
// lazy (its loading is asynchronous), the same JSX element twice (C6; hydrateTopDown.spec).
// A function child whose value is another function or an RxList is generated: the server writes it as a Comment-ph
// since #82 (it used to fall back to the element-child writer).
// Internal entry only until #55 S replaces the generator above with this one (the old model does not support these shapes).
describe.skipIf(!TOP_DOWN_PASS)('F1 regression, extended generator (#55 B2): every landed Host kind hydrates in place', () => {
    const TAGS = ['div', 'span', 'b', 'em', 'section']
    const OPACITY_0 = {opacity: 0}
    // every Host kind of createHost's dispatch (HOST_TYPE_NAMES) and CompactElementHost: all landed since #55 B4 (§2.4.1)
    const LANDED_KINDS = ['StaticHost', 'PrimitiveHost', 'StaticArrayHost', 'EmptyHost', 'RxListHost', 'ReusableHost',
        'ComponentHost', 'AtomHost', 'FunctionHost', 'NodeHost', 'CompactElementHost']
    type Gen =
        | {k: 'el', tag: string, key: string, id?: string, raw?: string, detach?: boolean, kids: Gen[]}
        | {k: 'frag', kids: Gen[]}
        | {k: 'text', v: string | number | bigint}
        | {k: 'bool', v: boolean}
        | {k: 'nil', v: null | undefined}
        | {k: 'atom', v: string}
        | {k: 'fn', body: Gen}
        | {k: 'arr', items: Gen[]}
        | {k: 'list', rows: Gen[]}
        | {k: 'comp', body: Gen}
        | {k: 'reuse', body: Gen}
        | {k: 'liveEl', tag: string, v: string}
        | {k: 'liveText', v: string}

    function mulberry32(seed: number) {
        let a = seed >>> 0
        return () => {
            a = (a + 0x6D2B79F5) >>> 0
            let t = a
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }
    function generate(seed: number): Gen {
        const rnd = mulberry32(seed)
        const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
        let n = 0
        // raw markup built from the same tags, the raw element's own tag included (F1j)
        const rawHtml = (depth: number): string => {
            const tag = pick(TAGS)
            return `<${tag}>${depth < 2 && rnd() < 0.5 ? rawHtml(depth + 1) : `r${n++}`}</${tag}>`
        }
        const text = (): Gen => {
            const r = rnd()
            return {k: 'text', v: r < 0.1 ? '' : r < 0.2 ? n++ : r < 0.27 ? BigInt(n++) : `t${n++}`}
        }
        const element = (depth: number, tag = pick(TAGS)): Gen => {
            const spec: Gen = {k: 'el', tag, key: `k${n++}`, kids: []}
            if (rnd() < 0.2) spec.id = `i${spec.key}`
            if (rnd() < 0.15) spec.detach = true
            if (depth > 0 && rnd() < 0.12) {
                spec.raw = rawHtml(0)
                return spec
            }
            const count = depth >= 4 ? 0 : Math.floor(rnd() * 4)
            for (let i = 0; i < count; i++) spec.kids.push(child(depth + 1))
            return spec
        }
        const many = (depth: number, max: number, of: (depth: number) => Gen) =>
            Array.from({length: Math.floor(rnd() * (max + 1))}, () => of(depth))
        // a child of an element / Fragment
        const child = (depth: number): Gen => {
            if (depth >= 5) return rnd() < 0.5 ? text() : {k: 'atom', v: rnd() < 0.2 ? '' : `a${n++}`}
            // live nodes as element children (§2.6.8, B4)
            const live = rnd()
            if (live < 0.03) return {k: 'liveEl', tag: pick(TAGS), v: `l${n++}`}
            if (live < 0.05) return {k: 'liveText', v: `l${n++}`}
            const r = rnd()
            if (r < 0.28) return element(depth)
            if (r < 0.38) return text()
            if (r < 0.45) return {k: 'atom', v: rnd() < 0.2 ? '' : `a${n++}`}
            if (r < 0.55) return {k: 'fn', body: source(depth + 1)}
            if (r < 0.65) return {k: 'comp', body: source(depth + 1)}
            if (r < 0.73) return {k: 'list', rows: many(depth + 1, 3, source)}
            if (r < 0.81) return {k: 'arr', items: many(depth + 1, 3, source)}
            if (r < 0.88) return {k: 'frag', kids: many(depth + 1, 3, child)}
            if (r < 0.95) return {k: 'bool', v: rnd() < 0.5}
            return {k: 'nil', v: rnd() < 0.5 ? null : undefined}
        }
        // the source of a Host: a function's value, a component's result, a list row, an array item
        const source = (depth: number): Gen => {
            if (depth >= 5) return rnd() < 0.5 ? text() : element(depth)
            // reusable() and a component whose result is a live Text (NodeHost) (B4)
            const extra = rnd()
            if (extra < 0.05) return {k: 'reuse', body: source(depth + 1)}
            if (extra < 0.08) return {k: 'comp', body: {k: 'liveText', v: `l${n++}`}}
            const r = rnd()
            if (r < 0.3) return element(depth)
            if (r < 0.4) return {k: 'frag', kids: many(depth + 1, 3, child)}
            if (r < 0.5) return text()
            if (r < 0.57) return {k: 'atom', v: rnd() < 0.2 ? '' : `a${n++}`}
            if (r < 0.66) return {k: 'fn', body: source(depth + 1)}
            if (r < 0.75) return {k: 'comp', body: source(depth + 1)}
            if (r < 0.82) return {k: 'list', rows: many(depth + 1, 3, source)}
            if (r < 0.89) return {k: 'arr', items: many(depth + 1, 3, source)}
            if (r < 0.95) return {k: 'bool', v: rnd() < 0.5}
            return {k: 'nil', v: rnd() < 0.5 ? null : undefined}
        }
        return element(0, 'div')
    }

    // atoms：渲染时创建的 atom 按创建顺序记下（漂移 fuzz 激活后改它们的值，比较更新后的 DOM）
    // lives：渲染时创建的现成节点按创建顺序记下（激活恰好为每个报告一条 AXII_HYDRATION_LIVE_NODE）
    function appOf(spec: Gen, log: string[], atoms?: ReturnType<typeof atom>[], lives?: Node[]) {
        // createElement / Fragment come from the render context (the server passes its own)
        type Ctx = {h: RenderContext['createElement'], F: RenderContext['Fragment']}
        function render(g: Gen, c: Ctx): any {
            const {h, F} = c
            switch (g.k) {
                case 'el': {
                    const props: any = {
                        'data-k': g.key,
                        onClick: (e: Event) => { if (e.target === e.currentTarget) log.push(g.key) },
                    }
                    if (g.id) props.id = g.id
                    if (g.detach) props.detachStyle = OPACITY_0
                    if (g.raw !== undefined) props.dangerouslySetInnerHTML = Number(g.key.slice(1)) % 2 ? {__html: g.raw} : g.raw
                    // kids are evaluated before h(g.tag): the same order as JSX arguments
                    return h(g.tag, props, ...g.kids.map(k => render(k, c)))
                }
                case 'frag': return h(F, null, ...g.kids.map(k => render(k, c)))
                case 'text': case 'bool': case 'nil': return g.v
                case 'atom': {
                    const a = atom(g.v)
                    atoms?.push(a)
                    return a
                }
                case 'fn': return () => render(g.body, c)
                case 'arr': return g.items.map(item => render(item, c))
                case 'list': return new RxList(g.rows.map((_, i) => i)).map(i => render(g.rows[i], c))
                case 'comp': {
                    const Comp = function Comp({}: any, {createElement: h, Fragment: F}: RenderContext) { return render(g.body, {h, F}) }
                    return h(Comp, null)
                }
                case 'reuse': {
                    const Reuse = function Reuse({}: any, {createElement: h, Fragment: F, reusable}: RenderContext) { return reusable(render(g.body, {h, F})) }
                    return h(Reuse, null)
                }
                // a live node is client-only: the server renders the same content as JSX
                case 'liveEl': {
                    if (isSsrPass()) return h(g.tag, {'data-live': ''}, g.v)
                    const el = document.createElement(g.tag)
                    el.setAttribute('data-live', '')
                    el.textContent = g.v
                    lives?.push(el)
                    return el
                }
                case 'liveText': {
                    if (isSsrPass()) return g.v
                    const t = document.createTextNode(g.v)
                    lives?.push(t)
                    return t
                }
            }
        }
        return function App({}: any, {createElement: h, Fragment: F}: RenderContext) { return render(spec, {h, F}) }
    }

    function countShapes(g: Gen, into: {[k: string]: number}) {
        into[g.k] = (into[g.k] ?? 0) + 1
        if (g.k === 'el' && g.raw !== undefined) into.raw = (into.raw ?? 0) + 1
        if (g.k === 'fn' && (g.body.k === 'fn' || g.body.k === 'list')) into[`fn→${g.body.k}`] = (into[`fn→${g.body.k}`] ?? 0) + 1
        const nested = g.k === 'el' || g.k === 'frag' ? g.kids : g.k === 'arr' ? g.items : g.k === 'list' ? g.rows
            : g.k === 'fn' || g.k === 'comp' || g.k === 'reuse' ? [g.body] : []
        nested.forEach(c => countShapes(c, into))
    }

    test('F1i extended: 300 generated trees — DOM ≡ CSR, no report, server nodes kept, listeners at their own position, Host kinds ≡ CSR', () => {
        const shapes: {[k: string]: number} = {}
        const totals = {csr: {} as {[k: string]: number}, hydrate: {} as {[k: string]: number}}
        const addTo = (into: {[k: string]: number}, counts: {[k: string]: number}) => {
            for (const k in counts) into[k] = (into[k] ?? 0) + counts[k]
        }
        // diagnostics on: the development invariants (§4.4) run after every activation and must not report
        configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push((e as any)?.message ?? String(e)) }})
        try {
            for (let seed = 1; seed <= 300; seed++) {
                const spec = generate(seed)
                countShapes(spec, shapes)
                enableAxiiRetainedObjectDiagnostics({reset: true})
                const csrDom = kids(csr(appOf(spec, [])))
                const csrKinds = getAxiiRetainedObjectDiagnosticsSnapshot().hosts.createdByType
                disableAxiiRetainedObjectDiagnostics()
                const log: string[] = []
                const hyd = ssrInto(appOf(spec, log))
                // 现成节点在服务端的对应物（data-live）由激活换成客户端的节点，其余服务端元素原地保留
                const nodesBefore = Array.from(hyd.querySelectorAll('*:not([data-live])'))
                const keyed = Array.from(hyd.querySelectorAll('[data-k]')) as HTMLElement[]
                const keysBefore = keyed.map(el => el.getAttribute('data-k'))
                reports.length = 0
                const lives: Node[] = []
                enableAxiiRetainedObjectDiagnostics({reset: true})
                hydrate(hyd, createElement(appOf(spec, log, undefined, lives), null as any))
                const hydrateKinds = getAxiiRetainedObjectDiagnosticsSnapshot().hosts.createdByType
                disableAxiiRetainedObjectDiagnostics()
                const nodesAfter = Array.from(hyd.querySelectorAll('*:not([data-live])'))
                const clicked = keyed.map(el => { log.length = 0; el.click(); return log.join(',') })
                addTo(totals.csr, csrKinds)
                addTo(totals.hydrate, hydrateKinds)
                const liveReports = reports.filter(m => m.includes('AXII_HYDRATION_LIVE_NODE')).length
                expect({
                    seed,
                    dom: kids(hyd),
                    reports: reports.filter(m => !m.includes('AXII_HYDRATION_LIVE_NODE')),
                    liveReports,
                    liveInPlace: lives.every(node => hyd.contains(node)),
                    serverNodesKept: nodesAfter.length === nodesBefore.length && nodesAfter.every((el, i) => el === nodesBefore[i]),
                    clicked,
                    kinds: hydrateKinds,
                }).toEqual({
                    seed,
                    dom: csrDom,
                    reports: [],
                    liveReports: HYDRATE_DIAGNOSTICS === true ? lives.length : 0,
                    liveInPlace: true,
                    serverNodesKept: true,
                    clicked: keysBefore,
                    kinds: csrKinds,
                }) // `seed` in the diff: rerun generate(seed) to replay
                document.body.innerHTML = ''
            }
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
        // eslint-disable-next-line no-console
        console.log(`[F1i extended] shapes ${JSON.stringify(shapes)} | host kinds (CSR = hydrate) ${JSON.stringify(totals.hydrate)}`)
        // §2.4.1 coverage: every landed kind is created on both sides somewhere in the 300 trees
        expect(LANDED_KINDS.filter(k => !(totals.csr[k] > 0 && totals.hydrate[k] > 0))).toEqual([])
    })

    // #55 B3 (design §7.4 B3 row, §4.1, §4.2): drift fuzz on the extended trees. The server renders the tree, then one drift is
    // injected — on the client side (a list / array row added or removed, an element swapped for text or back) or into the parsed
    // server DOM (an element's tag replaced, a junk element / Text / Comment inserted, an axii marker or structure Comment
    // removed, a Text value tampered). Raw markup (dangerouslySetInnerHTML) is opaque and never touched. Every activation:
    //  - does not throw; the node structure, text, structure Comments and the attributes the client props write equal CSR
    //    (server-only attributes may remain only on clean claims — D4 — and only in trees that reported a mismatch; with
    //    diagnostics on they are reported as AXII_HYDRATION_ATTRIBUTE_RESIDUE exactly in those trees, #55 B4);
    //  - reports at least one HydrationMismatchError when the drift changed the server output, none otherwise (never silent);
    //    no development invariant (§4.4) is broken;
    //  - each element's listener is at its own position; after every atom changes, DOM ≡ CSR again; destroying both roots
    //    returns the retained Host / binding counters to zero.
    const INJECTIONS = ['row+', 'row-', 'el↔text', 'tag', 'junk', 'marker-', 'text~'] as const
    type Injection = typeof INJECTIONS[number]
    type Slot = {value: Gen, set: (g: Gen) => void}
    function slotsOf(g: Gen, out: Slot[]) {
        const arrays = g.k === 'el' || g.k === 'frag' ? [g.kids] : g.k === 'arr' ? [g.items] : g.k === 'list' ? [g.rows] : []
        for (const arr of arrays) {
            arr.forEach((child, i) => {
                out.push({value: child, set: v => { arr[i] = v }})
                slotsOf(child, out)
            })
        }
        if (g.k === 'fn' || g.k === 'comp' || g.k === 'reuse') {
            const owner = g
            out.push({value: owner.body, set: v => { owner.body = v }})
            slotsOf(owner.body, out)
        }
        return out
    }
    function rawKeysOf(g: Gen, into: Set<string>) {
        if (g.k === 'el' && g.raw !== undefined) into.add(g.key)
        const nested = g.k === 'el' || g.k === 'frag' ? g.kids : g.k === 'arr' ? g.items : g.k === 'list' ? g.rows
            : g.k === 'fn' || g.k === 'comp' || g.k === 'reuse' ? [g.body] : []
        nested.forEach(c => rawKeysOf(c, into))
        return into
    }
    /** Mutate the client spec; false when the tree has nothing to apply it to. */
    function injectClient(spec: Gen, kind: Injection, rnd: () => number): boolean {
        const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
        const slots = slotsOf(spec, [])
        if (kind === 'row+' || kind === 'row-') {
            const owners = slots.map(s => s.value).filter((g): g is Extract<Gen, {k: 'list' | 'arr'}> => g.k === 'list' || g.k === 'arr')
                .filter(g => kind === 'row+' || (g.k === 'list' ? g.rows : g.items).length > 0)
            if (!owners.length) return false
            const owner = pick(owners)
            const rows = owner.k === 'list' ? owner.rows : owner.items
            const at = Math.floor(rnd() * (rows.length + (kind === 'row+' ? 1 : 0)))
            if (kind === 'row-') rows.splice(at, 1)
            else rows.splice(at, 0, rnd() < 0.5 ? {k: 'el', tag: pick(TAGS), key: 'kins', kids: [{k: 'atom', v: 'ins'}]} : {k: 'text', v: 'ins'})
            return true
        }
        const swappable = slots.filter(s => s.value.k === 'el' || (s.value.k === 'text' && s.value.v !== ''))
        if (!swappable.length) return false
        const slot = pick(swappable)
        slot.set(slot.value.k === 'el' ? {k: 'text', v: 'swapped'} : {k: 'el', tag: 'b', key: 'kswap', kids: [{k: 'text', v: 'sw'}]})
        return true
    }
    /** Drift in the parsed server DOM; false when there is no target. */
    function injectServer(container: HTMLElement, rawKeys: Set<string>, kind: Injection, rnd: () => number): boolean {
        const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
        // 现成节点在服务端的对应物（data-live）与原始标记一样不透明：激活把它整个换成客户端的节点，里面的漂移不可见也无影响
        const isRaw = (n: Node) => n.nodeType === Node.ELEMENT_NODE
            && (rawKeys.has((n as Element).getAttribute('data-k') ?? '') || (n as Element).hasAttribute('data-live'))
        const inRaw = (n: Node) => {
            for (let p = n.parentNode; p && p !== container; p = p.parentNode) if (isRaw(p)) return true
            return false
        }
        // 现成 Text 在服务端的对应物是值为 l<n> 的文本单元（生成器只给它们用这种值），连同包边一样不透明
        const isLiveText = (n: Node | null) => !!n && n.nodeType === Node.TEXT_NODE && /^l\d+$/.test(n.nodeValue!)
        const isLiveTextUnit = (n: Node) => isLiveText(n)
            || (n.nodeType === Node.COMMENT_NODE && ((n as Comment).data === 'axii:t' ? isLiveText(n.nextSibling) : (n as Comment).data === 'axii:/t' && isLiveText(n.previousSibling)))
        const all: Node[] = []
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ALL)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!inRaw(n) && !isLiveTextUnit(n)) all.push(n)
        if (kind === 'tag') {
            const els = all.filter(n => n.nodeType === Node.ELEMENT_NODE && TAGS.includes((n as Element).localName)) as Element[]
            if (!els.length) return false
            const el = pick(els)
            const other = document.createElement(pick(TAGS.filter(t => t !== el.localName)))
            for (const a of Array.from(el.attributes)) other.setAttribute(a.name, a.value)
            while (el.firstChild) other.appendChild(el.firstChild)
            el.replaceWith(other)
            return true
        }
        if (kind === 'junk') {
            const parents = [container, ...all.filter(n => n.nodeType === Node.ELEMENT_NODE && !isRaw(n))] as Element[]
            const parent = pick(parents)
            const r = rnd()
            // 杂元素用生成器自己的标签：后面同标签的角色可能干净地认领它，它的 data-junk 就是服务端独有属性的残留（§4.1 D4）
            const junk = r < 0.4 ? Object.assign(document.createElement(pick(TAGS)), {textContent: 'junk'}) : r < 0.7 ? document.createTextNode('junk') : document.createComment('junk')
            if (junk instanceof Element) junk.setAttribute('data-junk', '1')
            parent.insertBefore(junk, parent.childNodes[Math.floor(rnd() * (parent.childNodes.length + 1))] ?? null)
            return true
        }
        if (kind === 'marker-') {
            const comments = all.filter(n => n.nodeType === Node.COMMENT_NODE)
            if (!comments.length) return false
            ;(pick(comments) as Comment).remove()
            return true
        }
        const texts = all.filter(n => n.nodeType === Node.TEXT_NODE && n.nodeValue !== '') as Text[]
        if (!texts.length) return false
        pick(texts).nodeValue += '~'
        return true
    }
    /** Serialize like kids(), keeping only the attributes the CSR twin has; `residue` records any server-only attribute. */
    function significant(parent: Node): Node[] {
        return Array.from(parent.childNodes).filter(n => shape(n) !== '')
    }
    function alignedKids(node: Node, twin: Node | undefined, residue: {found: boolean}): string {
        const twins = twin ? significant(twin) : []
        return significant(node).map((n, i) => alignedShape(n, twins[i], residue)).join('')
    }
    function alignedShape(node: Node, twin: Node | undefined, residue: {found: boolean}): string {
        if (node.nodeType !== Node.ELEMENT_NODE) return shape(node)
        const el = node as Element
        const twinEl = twin && twin.nodeType === Node.ELEMENT_NODE && (twin as Element).tagName === el.tagName ? twin as Element : undefined
        const attrs = Array.from(el.attributes).filter(a => {
            if (twinEl && !twinEl.hasAttribute(a.name)) {
                residue.found = true
                return false
            }
            return true
        }).map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
        const tag = el.tagName.toLowerCase()
        return `<${tag}${attrs ? ' ' + attrs : ''}>${alignedKids(el, twinEl, residue)}</${tag}>`
    }

    test('drift fuzz (#55 B3): 300 trees × 7 injections — repaired ≡ CSR, reported, never silent, listeners in place, updates ≡ CSR, destroy clean', () => {
        const applied: {[k: string]: number} = {}
        let withResidue = 0
        let unchanged = 0
        configureDiagnostics({enabled: true, onError: (e: unknown) => { reports.push((e as any)?.message ?? String(e)) }})
        const errors: unknown[] = []
        try {
            for (let seed = 1; seed <= 300; seed++) {
                for (let k = 0; k < INJECTIONS.length; k++) {
                    const kind = INJECTIONS[k]
                    const rnd = mulberry32(seed * 7919 + k)
                    const serverSpec = generate(seed)
                    const clientSpec = generate(seed)
                    const clientSide = kind === 'row+' || kind === 'row-' || kind === 'el↔text'
                    if (clientSide && !injectClient(clientSpec, kind, rnd)) continue
                    const serverHtml = renderToString(createElement(appOf(serverSpec, []), null as any)).html
                    const hyd = mount()
                    hyd.innerHTML = serverHtml
                    if (!clientSide && !injectServer(hyd, rawKeysOf(serverSpec, new Set()), kind, rnd)) {
                        document.body.innerHTML = ''
                        continue
                    }
                    applied[kind] = (applied[kind] ?? 0) + 1
                    const changed = !clientSide || renderToString(createElement(appOf(clientSpec, []), null as any)).html !== serverHtml
                    if (!changed) unchanged++
                    enableAxiiRetainedObjectDiagnostics({reset: true})
                    const csrAtoms: ReturnType<typeof atom>[] = []
                    const csrEl = mount()
                    const csrRoot = createRoot(csrEl)
                    csrRoot.render(createElement(appOf(clientSpec, [], csrAtoms), null as any))
                    const log: string[] = []
                    const atoms: ReturnType<typeof atom>[] = []
                    reports.length = 0
                    let thrown: string | undefined
                    let root: ReturnType<typeof hydrate> | undefined
                    try {
                        root = hydrate(hyd, createElement(appOf(clientSpec, log, atoms), null as any))
                    } catch (e) {
                        thrown = String((e as Error)?.stack ?? e)
                    }
                    const residue = {found: false}
                    const dom = alignedKids(hyd, csrEl, residue)
                    const csrDom = kids(csrEl)
                    const hydrateReports = reports.slice()
                    const mismatchCount = hydrateReports.filter(m => m.includes('hydration mismatch')).length
                    // 服务端独有属性的开发期报告（§4.1，B4）：诊断开启的那一遍里恰好在有残留的树上出现
                    const residueReported = hydrateReports.some(m => m.includes('AXII_HYDRATION_ATTRIBUTE_RESIDUE'))
                    // 现成节点的开发期提示（§2.6.8）不算在内
                    const otherReports = hydrateReports.filter(m => !m.includes('hydration mismatch') && !m.includes('AXII_HYDRATION_ATTRIBUTE_RESIDUE')
                        && !m.includes('AXII_HYDRATION_LIVE_NODE'))
                    if (residue.found) withResidue++
                    const clicked = (Array.from(hyd.querySelectorAll('[data-k]')) as HTMLElement[])
                        .map(el => { log.length = 0; el.click(); return log.join(',') === el.getAttribute('data-k') })
                    for (const list of [csrAtoms, atoms]) for (const a of list) a(String(a()) + '!')
                    const updated = alignedKids(hyd, csrEl, {found: false})
                    const csrUpdated = kids(csrEl)
                    // 快照都在销毁之前取：detachStyle 的元素在离场时先写上样式
                    root?.destroy()
                    csrRoot.destroy()
                    const after = getAxiiRetainedObjectDiagnosticsSnapshot()
                    disableAxiiRetainedObjectDiagnostics()
                    const actual = {
                        seed, kind, thrown, dom, otherReports,
                        reported: changed ? mismatchCount > 0 : mismatchCount === 0,
                        residueOnlyWhenReported: !residue.found || mismatchCount > 0,
                        residueReported,
                        listenersInPlace: clicked.every(Boolean),
                        atoms: atoms.length === csrAtoms.length,
                        updated,
                        retained: [after.hosts.totalActive, after.lightBindings.totalActive],
                    }
                    const expected = {
                        seed, kind, thrown: undefined, dom: csrDom, otherReports: [],
                        reported: true,
                        residueOnlyWhenReported: true,
                        residueReported: HYDRATE_DIAGNOSTICS === true && residue.found,
                        listenersInPlace: true,
                        atoms: true,
                        updated: csrUpdated,
                        retained: [0, 0],
                    }
                    // `seed` / `kind` in the diff: rerun generate(seed) with mulberry32(seed * 7919 + INJECTIONS.indexOf(kind)) to replay
                    try {
                        expect(actual).toEqual(expected)
                    } catch (e) {
                        errors.push(e)
                        if (errors.length >= 20) break
                    }
                    document.body.innerHTML = ''
                }
            }
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
        // eslint-disable-next-line no-console
        console.log(`[drift fuzz] failures ${errors.length} | applied ${JSON.stringify(applied)} | unchanged client drifts ${unchanged} | trees with server-only attribute residue ${withResidue}`)
        if (errors.length) throw errors[0]
        // every kind of drift is exercised on at least a third of the trees (row± and el↔text need a list / an element or text
        //  slot in the tree, text~ a non-empty Text outside raw markup), and the residue path of §4.1 is exercised
        expect({kinds: INJECTIONS.filter(kind => !((applied[kind] ?? 0) >= 100)), residue: withResidue > 0}).toEqual({kinds: [], residue: true})
    })
})

// ───────────────── Finding 2: empty Comment-placeholder host takes the previous Text ─────────────────
describe('F2 empty Comment-ph unit claims the preceding sibling Text', () => {
    test('F2a static text followed by a boolean child keeps its text', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <p>Hello{false}</p>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
            hydrate(hyd, createElement(App, null as any))
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
            const root = hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
        expect({dom: kids(hyd), reports, sameLi: Array.from(hyd.querySelectorAll('li')).every((li, i) => li === liBefore[i])})
            .toEqual({dom: kids(csr(App)), reports: [], sameLi: true})
    })

    test('N1b the same arrays under a Fragment root', () => {
        function App({}: any, {createElement, Fragment}: RenderContext) {
            return <Fragment>{[1, 2, 3].map(i => i % 2 ? <b>{i}</b> : null)}{['x', false]}</Fragment>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
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
            hydrate(hyd, createElement(h.App, null as any))
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
    test('F3a text-state function child before a structure-state one must hydrate', async () => {
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
        hydrate(hyd, createElement(h.App, null as any))
        h.title('t2')
        await tick()
        expect(hyd.textContent).toBe('t2badge')
    })

    test('F3b function → Fragment → function: node order must equal CSR', () => {
        function App({}: any, {createElement, Fragment}: RenderContext) {
            return <div>{() => <Fragment>{() => <b>x</b>}</Fragment>}</div>
        }
        const hyd = ssrInto(App)
        hydrate(hyd, createElement(App, null as any))
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
    test('F4a client list has one more row than the server HTML', () => {
        const hyd = ssrInto(listApp([1, 2]))
        hydrate(hyd, createElement(listApp([1, 2, 3]), null as any))
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(listApp([1, 2, 3])))})
    })

    test('F4b client list has one row fewer than the server HTML', () => {
        const hyd = ssrInto(listApp([1, 2, 3]))
        hydrate(hyd, createElement(listApp([1, 2]), null as any))
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(listApp([1, 2])))})
    })

    const fnApp = (asElement: boolean) => function App({}: any, {createElement}: RenderContext) {
        return <div>{() => asElement ? <b>el</b> : 'text'}<i>tail</i></div>
    }
    test('F4c server rendered an element, client function returns text', () => {
        const hyd = ssrInto(fnApp(true))
        hydrate(hyd, createElement(fnApp(false), null as any))
        expect({reported: reports.length > 0, dom: kids(hyd)})
            .toEqual({reported: true, dom: kids(csr(fnApp(false)))})
    })

    test('F4d server rendered text, client function returns an element', () => {
        const hyd = ssrInto(fnApp(false))
        // throws instead of rebuilding
        hydrate(hyd, createElement(fnApp(true), null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(app('div'), null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
            hydrate(hyd, createElement(Root, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
                    hydrate(island, createElement(Island, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
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
        hydrate(hyd, createElement(App, null as any))
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
        hydrate(hyd, createElement(h.App, null as any))
        const first = {text: hyd.querySelector('style')!.textContent, same: hyd.querySelector('style') === styleBefore}
        h.color('blue'); c.color('blue')
        expect({first, after: kids(hyd), reports})
            .toEqual({first: {text: 'a>b{fill:red} & <x>', same: true}, after: kids(client), reports: []})
    })
})

// ───────────────── #50: dangerouslySetInnerHTML in the React shape {__html} ─────────────────
// The server always unwrapped {__html}; the client wrote the object itself ("[object Object]") and,
// during hydration, replaced the claimed server markup with that string without a report.
// Decision (#50): the client accepts {__html: string} as a static value too; the string form is unchanged.
describe('I50 dangerouslySetInnerHTML={{__html}}: CSR, reactive form, hydration', () => {
    const rawApp = (value: any) => function App({}: any, {createElement}: RenderContext) {
        return <div><div id="raw" dangerouslySetInnerHTML={value}/><em>sibling</em></div>
    }
    const raw = (root: HTMLElement) => root.querySelector('#raw')!.innerHTML

    test('I50a CSR: {__html} renders the same HTML as the string form', () => {
        expect({object: raw(csr(rawApp({__html: '<b>x</b>'}))), string: raw(csr(rawApp('<b>x</b>')))})
            .toEqual({object: '<b>x</b>', string: '<b>x</b>'})
    })

    test('I50b nullish __html clears the content on both ends, like the nullish string form', () => {
        const read = (value: any) => ({csr: raw(csr(rawApp(value))), ssr: raw(ssrInto(rawApp(value)))})
        expect([read({__html: null}), read({__html: undefined}), read(null), read(undefined)])
            .toEqual(Array(4).fill({csr: '', ssr: ''}))
    })

    test('I50c reactive {__html} (function / atom) behaves like the reactive string form: first frame, update, nullish', () => {
        const html = atom<string | null>('<b>1</b>')
        const objectAtom = atom<{__html: string | null} | null>({__html: '<b>1</b>'})
        const shapes: Record<string, any> = {
            stringAtom: html,
            stringFn: () => html(),
            objectFn: () => ({__html: html()}),
            objectOrNullFn: () => html() == null ? null : {__html: html()},
            objectAtom,
        }
        const root = mount()
        createRoot(root).render(<div>{Object.keys(shapes).map(k => <p id={k} dangerouslySetInnerHTML={shapes[k]}/>)}</div>)
        const read = () => Object.fromEntries(Object.keys(shapes).map(k => [k, root.querySelector(`#${k}`)!.innerHTML]))
        const frames = [read()]
        html('<i>2</i>'); objectAtom({__html: '<i>2</i>'}); frames.push(read())
        html(null); objectAtom(null); frames.push(read())
        const all = (v: string) => Object.fromEntries(Object.keys(shapes).map(k => [k, v]))
        expect(frames).toEqual([all('<b>1</b>'), all('<i>2</i>'), all('')])
    })

    test('I50d hydration: server {__html} markup is claimed as is (same nodes, no report, DOM ≡ CSR)', () => {
        const App = rawApp({__html: '<p><em>raw</em></p>'})
        const hyd = ssrInto(App)
        const before = hyd.querySelector('#raw em')
        expect(before).not.toBe(null)
        hydrate(hyd, createElement(App, null as any))
        expect({inner: raw(hyd), dom: kids(hyd), reports, sameNode: hyd.querySelector('#raw em') === before})
            .toEqual({inner: '<p><em>raw</em></p>', dom: kids(csr(App)), reports: [], sameNode: true})
    })

    test('I50e hydration of a nullish {__html}: empty content, no report, DOM ≡ CSR', () => {
        for (const App of [rawApp({__html: null}), rawApp({__html: undefined})]) {
            const hyd = ssrInto(App)
            hydrate(hyd, createElement(App, null as any))
            expect({inner: raw(hyd), dom: kids(hyd), reports}).toEqual({inner: '', dom: kids(csr(App)), reports: []})
        }
    })

    // The raw-content decision of a claimed element (DOM.createElement → exitElementChildCursor) reads
    // the unwrapped value: a nullish {__html} is not raw markup, exactly like the nullish string form.
    // Undefined is the baseline (static path); a bare null goes through the reactive attribute path.
    test('I50g drift: server markup, client nullish {__html} → handled exactly like client undefined', () => {
        const read = (client: any) => {
            const hyd = ssrInto(rawApp({__html: '<b>x</b>'}))
            reports.length = 0
            hydrate(hyd, createElement(rawApp(client), null as any))
            return {inner: raw(hyd), dom: kids(hyd), reports: reports.slice()}
        }
        const baseline = read(undefined)
        expect(baseline.inner).toBe('')
        expect([read({__html: null}), read({__html: undefined})]).toEqual([baseline, baseline])
    })

    // Only objects that carry an __html key are unwrapped. TrustedHTML (the value innerHTML takes under
    // Trusted Types) has none: unwrapping every object would read .__html (undefined) and blank the content.
    test('I50h an object without __html (TrustedHTML) is passed through unchanged on both ends', () => {
        const policy = (window as any).trustedTypes.createPolicy(`axii-i50h-${Math.random()}`, {createHTML: (s: string) => s})
        const value = policy.createHTML('<b>t</b>')
        expect({csr: raw(csr(rawApp(value))), ssr: raw(ssrInto(rawApp(value)))}).toEqual({csr: '<b>t</b>', ssr: '<b>t</b>'})
    })

    test('I50f hydration of the reactive {__html} form (≡ F7f): content kept, stays bound, no report', () => {
        const make = () => {
            const html = atom('<em>raw</em>')
            return {App: rawApp(() => ({__html: html()})), html}
        }
        const hyd = mount()
        hyd.innerHTML = renderToString(createElement(make().App, null as any)).html
        const h = make()
        hydrate(hyd, createElement(h.App, null as any))
        const first = raw(hyd)
        h.html('<u>2</u>')
        expect({first, second: raw(hyd), sibling: hyd.querySelector('#raw + em')!.textContent, reports})
            .toEqual({first: '<em>raw</em>', second: '<u>2</u>', sibling: 'sibling', reports: []})
    })
})
