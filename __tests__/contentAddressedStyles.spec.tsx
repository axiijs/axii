/** @jsx createElement */
/**
 * Content-addressed stylesheets (StyleManager).
 *
 * Entries that used to get a per-element stylesheet — function styles, bound styles,
 * static nested styles under a function child, and static entries whose shared-path
 * signature diverged — now get a class derived from their evaluated content
 * (`axs-<hash>F<entryIndex>`). Same content ⇒ one shared stylesheet, reference-counted.
 * Stylesheets are grouped in `document.adoptedStyleSheets` by entry index, so on one
 * element a later entry beats an earlier one, before and after re-evaluation.
 *
 * Run: npx vitest run __tests__/contentAddressedStyles.spec.tsx
 */
import {
    atom,
    createElement,
    createRoot,
    RenderContext,
    RxList,
    enableAxiiRetainedObjectDiagnostics,
    disableAxiiRetainedObjectDiagnostics,
    resetAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
} from '@framework'
import * as framework from '@framework'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate} from './helpers/hydrate'

const N = 1000

function styleClassesOf(el: Element) {
    return Array.from(el.classList).filter(c => /F\d+/.test(c))
}

describe('content-addressed stylesheets', () => {
    let rootEl: HTMLElement
    let root: ReturnType<typeof createRoot> | undefined
    let baseline: number
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        baseline = document.adoptedStyleSheets.length
    })
    afterEach(() => {
        root?.destroy()
        root = undefined
    })

    test(`${N} elements with the same function style + nested selector share one stylesheet`, () => {
        const color = atom('rgb(1, 2, 3)')
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(i => (
                    <div class="row" style={() => ({color: color(), '&:hover': {opacity: '0.5'}})}>{i}</div>
                ))}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        const rows = rootEl.querySelectorAll('.row')
        expect(rows.length).toBe(N)
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        expect(getComputedStyle(rows[N - 1]).color).toBe('rgb(1, 2, 3)')
        // every row carries exactly the same single stylesheet class
        const cls = styleClassesOf(rows[0])
        expect(cls.length).toBe(1)
        expect(styleClassesOf(rows[N - 1])).toEqual(cls)
    })

    test('nested-under-function-child static styles share one stylesheet', () => {
        const items = new RxList<number>(Array.from({length: N}, (_, i) => i))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {items.map(i => (
                    <div>{() => <span class="cell" style={{color: 'rgb(4, 5, 6)', '&:hover': {opacity: '0.5'}}}>{i}</span>}</div>
                ))}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(rootEl.querySelectorAll('.cell').length).toBe(N)
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        expect(getComputedStyle(rootEl.querySelector('.cell')!).color).toBe('rgb(4, 5, 6)')
    })

    test('re-evaluating every element keeps the stylesheet count constant', () => {
        const color = atom('rgb(1, 2, 3)')
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(i => (
                    <div class="row" style={() => ({color: color(), '&:hover': {opacity: '0.5'}})}>{i}</div>
                ))}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)

        color('rgb(9, 8, 7)')
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        const rows = rootEl.querySelectorAll('.row')
        expect(getComputedStyle(rows[0]).color).toBe('rgb(9, 8, 7)')
        expect(getComputedStyle(rows[N - 1]).color).toBe('rgb(9, 8, 7)')

        // back to a previous content: still one table, old one was dropped at refcount 0
        color('rgb(1, 2, 3)')
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        expect(getComputedStyle(rows[N - 1]).color).toBe('rgb(1, 2, 3)')
    })

    test('unmount returns the stylesheet count (and retained style states) to baseline', () => {
        enableAxiiRetainedObjectDiagnostics()
        resetAxiiRetainedObjectDiagnostics()
        try {
            const color = atom('rgb(1, 2, 3)')
            const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    {list.map(i => (
                        <div style={() => ({color: color(), '&:hover': {opacity: '0.5'}})}>{i}</div>
                    ))}
                </div>
            }
            const r = createRoot(rootEl)
            r.render(<App/>)
            color('rgb(9, 8, 7)')
            // partial removal keeps the shared table alive
            list.splice(0, N - 1)
            expect(document.adoptedStyleSheets.length - baseline).toBe(1)
            r.destroy()
            expect(document.adoptedStyleSheets.length).toBe(baseline)
            expect(getAxiiRetainedObjectDiagnosticsSnapshot().styles.activeHostStyleStates).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })

    test('several elements of one host sharing a content id release every reference on unmount', async () => {
        const show = atom(true)
        const color = atom('rgb(1, 2, 3)')
        const shared = () => ({color: color(), '&:hover': {opacity: '0.5'}})
        function Group({}: any, {createElement}: RenderContext) {
            // one StaticHost owns all three elements
            return <div>
                <span style={shared}>a</span>
                <span style={shared}>b</span>
                <span style={shared}>c</span>
            </div>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <Group/> : null}</div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        color('rgb(9, 8, 7)')
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        show(false)
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(document.adoptedStyleSheets.length).toBe(baseline)
    })

    test('two different contents get two stylesheets', () => {
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(i => (
                    <div class="row" style={() => ({
                        color: i % 2 ? 'rgb(0, 0, 255)' : 'rgb(255, 0, 0)',
                        '&:hover': {opacity: '0.5'},
                    })}>{i}</div>
                ))}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.adoptedStyleSheets.length - baseline).toBe(2)
        const rows = rootEl.querySelectorAll('.row')
        expect(getComputedStyle(rows[0]).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(rows[1]).color).toBe('rgb(0, 0, 255)')
        expect(styleClassesOf(rows[0])).not.toEqual(styleClassesOf(rows[1]))
    })

    test('same element: the later entry wins, and still wins after the earlier entry re-evaluates', () => {
        const color = atom('rgb(255, 0, 0)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="t" style={[
                () => ({color: color(), '&:hover': {opacity: '0.5'}}),
                {color: 'rgb(0, 0, 255)', '&:hover': {opacity: '0.4'}},
            ]}>x</div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        const el = rootEl.querySelector('#t')!
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        color('rgb(0, 128, 0)')
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        color('rgb(1, 1, 1)')
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
    })

    test('later entry still wins when its stylesheet was created before the earlier entry\'s', async () => {
        // Another element creates the entry-1 table first; then our element's entry-0
        // content is new and gets created later. Grouping by entry index must still put
        // entry 0 before entry 1.
        const color = atom('rgb(255, 0, 0)')
        const showSecond = atom(false)
        const second = {color: 'rgb(0, 0, 255)', '&:hover': {opacity: '0.4'}}
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <div id="a" style={[() => ({opacity: '1', '&:focus': {opacity: '0.9'}}), () => second]}>a</div>
                {() => showSecond() ? <div id="b" style={[() => ({color: color(), '&:hover': {opacity: '0.5'}}), () => second]}>b</div> : null}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        showSecond(true)
        await new Promise(resolve => setTimeout(resolve, 10))
        const el = rootEl.querySelector('#b')!
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        color('rgb(0, 128, 0)')
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
    })

    test('two elements using the same contents in opposite entry order each get the later entry', () => {
        // The entry index is part of the content id: B as entry 1 of x and B as entry 0 of y
        // are two tables in two groups. Without the index, B would have one table in one
        // group and one of x / y would show the earlier entry.
        const a = atom('rgb(255, 0, 0)')
        const b = atom('rgb(0, 0, 255)')
        const A = () => ({color: a(), '&:hover': {opacity: '0.5'}})
        const B = () => ({color: b(), '&:hover': {opacity: '0.4'}})
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <div id="x" style={[A, B]}>x</div>
                <div id="y" style={[B, A]}>y</div>
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        const x = rootEl.querySelector('#x')!
        const y = rootEl.querySelector('#y')!
        expect(getComputedStyle(x).color).toBe('rgb(0, 0, 255)')
        expect(getComputedStyle(y).color).toBe('rgb(255, 0, 0)')
        a('rgb(0, 128, 0)')
        expect(getComputedStyle(x).color).toBe('rgb(0, 0, 255)')
        expect(getComputedStyle(y).color).toBe('rgb(0, 128, 0)')
    })

    test('SSR orders CSS by entry index, so the later entry wins before hydrate too', () => {
        document.adoptedStyleSheets = []
        const red = () => ({color: 'rgb(255, 0, 0)', '&:hover': {opacity: '0.5'}})
        const blue = () => ({color: 'rgb(0, 0, 255)', '&:hover': {opacity: '0.4'}})
        const other = () => ({opacity: '1', '&:focus': {opacity: '0.9'}})
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {/* first element: blue's F1 table is seen before red's F0 table */}
                <div id="first" style={[other, blue]}>first</div>
                <div id="t" style={[red, blue]}>t</div>
            </div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        const wrap = document.createElement('div')
        wrap.innerHTML = html
        const [redId, blueId] = styleClassesOf(wrap.querySelector('#t')!)
        expect(redId).toMatch(/F0$/)
        expect(blueId).toMatch(/F1$/)
        expect(styles.indexOf(`.${redId}`)).toBeGreaterThanOrEqual(0)
        expect(styles.indexOf(`.${redId}`)).toBeLessThan(styles.indexOf(`.${blueId}`))

        // before hydrate only the SSR <style> applies
        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        expect(getComputedStyle(rootEl.querySelector('#t')!).color).toBe('rgb(0, 0, 255)')
        root = hydrate(rootEl, createElement(App, null as any))
        expect(getComputedStyle(rootEl.querySelector('#t')!).color).toBe('rgb(0, 0, 255)')
    })

    test('@keyframes entries with the same content share one stylesheet', () => {
        const list = new RxList<number>(Array.from({length: 100}, (_, i) => i))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(i => (
                    <div class="spin" style={() => ({
                        '@keyframes': {from: {opacity: 0}, to: {opacity: 1}},
                        animation: '1s linear infinite @self',
                    })}>{i}</div>
                ))}
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.adoptedStyleSheets.length - baseline).toBe(1)
        const name = getComputedStyle(rootEl.querySelector('.spin')!).animationName
        expect(name).toMatch(/^animation-/)
        expect(getComputedStyle(rootEl.querySelectorAll('.spin')[99]).animationName).toBe(name)
    })

    test('entries whose content cannot be serialized fall back to a per-element stylesheet', () => {
        class CyclicSize {
            self: CyclicSize = this
            toString() { return '12px' }
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <div id="a" style={() => ({width: new CyclicSize(), '&:hover': {opacity: '0.5'}})}>a</div>
                <div id="b" style={() => ({width: new CyclicSize(), '&:hover': {opacity: '0.5'}})}>b</div>
            </div>
        }
        root = createRoot(rootEl)
        root.render(<App/>)
        expect(getComputedStyle(rootEl.querySelector('#a')!).width).toBe('12px')
        expect(getComputedStyle(rootEl.querySelector('#b')!).width).toBe('12px')
        expect(styleClassesOf(rootEl.querySelector('#a')!)[0]).not.toMatch(/^axs-/)
        expect(document.adoptedStyleSheets.length - baseline).toBe(2)
    })

    test('fallback per-element path stays bounded under re-evaluation and cleans up on destroy', () => {
        class CyclicSize {
            self: CyclicSize = this
            constructor(public px: number) {}
            toString() { return `${this.px}px` }
        }
        const w = atom(10)
        function App({}: any, {createElement}: RenderContext) {
            return <div id="a" style={() => ({width: new CyclicSize(w()), '&:hover': {opacity: '0.5'}})}>a</div>
        }
        const r = createRoot(rootEl)
        r.render(<App/>)
        const afterRender = document.adoptedStyleSheets.length
        for (let i = 1; i <= 20; i++) w(10 + i)
        expect(document.adoptedStyleSheets.length - afterRender).toBeLessThanOrEqual(1)
        const el = rootEl.querySelector('#a')!
        expect(getComputedStyle(el).width).toBe('30px')
        expect(styleClassesOf(el).length).toBe(1)
        r.destroy()
        expect(document.adoptedStyleSheets.length).toBe(baseline)
    })

    test('fallback per-element path: SSR rolling class is reclaimed on hydrate', () => {
        document.adoptedStyleSheets = []
        class CyclicSize {
            self: CyclicSize = this
            toString() { return '12px' }
        }
        const size = new CyclicSize()
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={() => ({width: size, '&:hover': {opacity: '0.5'}})}>x</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        const wrap = document.createElement('div')
        wrap.innerHTML = html
        const ssrClasses = styleClassesOf(wrap.querySelector('#c')!)
        expect(ssrClasses.length).toBe(1)
        expect(ssrClasses[0]).toMatch(/R\d+F0I0$/)
        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        root = hydrate(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c')!
        expect(styleClassesOf(el)).toEqual(ssrClasses)
        expect(getComputedStyle(el).width).toBe('12px')
    })

    test('SSR and CSR compute the same content id; hydrate claims it without a second class', () => {
        document.adoptedStyleSheets = []
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={() => ({color: color(), '&:hover': {opacity: '0.5'}})}>x</div>
        }
        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const csrRoot = createRoot(csrEl)
        csrRoot.render(<App/>)
        const csrClasses = styleClassesOf(csrEl.querySelector('#c')!)
        csrRoot.destroy()
        csrEl.remove()

        const {html, styles} = renderToString(createElement(App, null as any))
        const wrap = document.createElement('div')
        wrap.innerHTML = html
        const ssrClasses = styleClassesOf(wrap.querySelector('#c')!)
        expect(ssrClasses).toEqual(csrClasses)
        expect(ssrClasses[0]).toMatch(/^axs-[0-9a-z]+F0$/)

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        root = hydrate(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c')!
        expect(styleClassesOf(el)).toEqual(ssrClasses)
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        expect(document.adoptedStyleSheets.length).toBe(1)
        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
        expect(styleClassesOf(el).length).toBe(1)
        expect(document.adoptedStyleSheets.length).toBe(1)
    })

    test('generateStyleContent is exported from the package entry', () => {
        const generateStyleContent = (framework as any).generateStyleContent
        expect(typeof generateStyleContent).toBe('function')
        expect(generateStyleContent('.x', {color: 'red', '&:hover': {color: 'blue'}}).length).toBe(2)
    })
})
