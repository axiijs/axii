/** @jsx createElement */
/**
 * M-04: SSR styles → hydrate adoptedStyleSheets, no FOUC, escape gate, cleanup.
 * Run: npx vitest run __tests__/ssrStyles.spec.tsx
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    enableAxiiRetainedObjectDiagnostics,
    disableAxiiRetainedObjectDiagnostics,
    resetAxiiRetainedObjectDiagnostics,
    RenderContext,
} from '@framework'
import {atom} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString, isAcceptableSingleCssRule} from '../src/ssr.js'
import {markBoundProp} from '../src/StaticHost.js'

describe('M-04 SSR styles', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        document.adoptedStyleSheets = []
    })

    test('nested &:hover and @media enter styles; hydrate migrates to adoptedStyleSheets', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="box" style={{
                color: 'rgb(1, 2, 3)',
                '& .inner': {color: 'rgb(4, 5, 6)'},
                '@media (min-width: 1px)': {
                    '& .inner': {fontWeight: '700'},
                },
            }}>
                <div class="inner" id="inner">x</div>
            </div>
        }

        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles.length).toBeGreaterThan(0)
        expect(styles).toMatch(/\.inner/)
        expect(styles).toMatch(/@media/)
        // Element should carry stylesheet class
        expect(html).toMatch(/class="[^"]*F0/)

        rootEl.innerHTML = `<style data-axii-ssr="1">${styles}</style>${html}`
        const boxBefore = rootEl.querySelector('#box') as HTMLElement
        const colorBefore = getComputedStyle(boxBefore).color
        expect(colorBefore).toBe('rgb(1, 2, 3)')

        const sheetsBefore = document.adoptedStyleSheets.length
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        // SSR style tag removed after adopt
        expect(rootEl.querySelector('style[data-axii-ssr]')).toBeNull()
        expect(document.adoptedStyleSheets.length).toBeGreaterThan(sheetsBefore)

        const box = rootEl.querySelector('#box') as HTMLElement
        const inner = rootEl.querySelector('#inner') as HTMLElement
        expect(box).toBe(boxBefore) // identity reuse
        expect(getComputedStyle(box).color).toBe('rgb(1, 2, 3)')
        expect(getComputedStyle(inner).color).toBe('rgb(4, 5, 6)')
        expect(getComputedStyle(inner).fontWeight).toMatch(/700|bold/)

        root.destroy()
        expect(document.adoptedStyleSheets.length).toBe(sheetsBefore)
    })

    test('no FOUC: computed color stable across hydrate migrate', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{color: 'rgb(10, 20, 30)', '&:hover': {opacity: '0.5'}}}>hi</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        const el = rootEl.querySelector('#c') as HTMLElement
        const samples: string[] = []
        samples.push(getComputedStyle(el).color)
        hydrateRoot(rootEl, createElement(App, null as any))
        samples.push(getComputedStyle(el).color)
        expect(samples.every(c => c === 'rgb(10, 20, 30)')).toBe(true)
        expect(rootEl.querySelector('style[data-axii-ssr]')).toBeNull()
    })

    test('CSS escape gate: breakout rule omitted from SSR styles (dual of insertRule)', () => {
        const evil = '100px; } body { background: rgb(0, 128, 0); } .z {'
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{'&:hover': {width: evil}}}>x</div>
        }
        const {styles} = renderToString(createElement(App, null as any))
        // Breakout multi-rule must not appear as injectable body rule in styles payload
        expect(styles.includes('body')).toBe(false)
        // Gate oracle
        expect(isAcceptableSingleCssRule('.x{width:100px} body{outline:1px solid red;}')).toBe(false)
        expect(isAcceptableSingleCssRule('.x::before{content:"a}b{c"}')).toBe(true)

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${renderToString(createElement(App, null as any)).html}`
        // Parse style tag — must not inject body rule via textContent multi-rule
        const tag = rootEl.querySelector('style[data-axii-ssr]') as HTMLStyleElement
        const sheet = tag.sheet
        const hasBody = sheet ? Array.from(sheet.cssRules).some(r => r.cssText.includes('body')) : false
        expect(hasBody).toBe(false)
    })

    test('quoted brace in content still emitted', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{'&::before': {content: '"a}b{c"'}}}>x</div>
        }
        const {styles} = renderToString(createElement(App, null as any))
        expect(styles).toMatch(/a\}b\{c/)
        // Full payload may be multi-line; gate each generateStyleContent-shaped rule
        expect(isAcceptableSingleCssRule('.x::before{content:"a}b{c"}')).toBe(true)
        // Entire styles string is multiple rules joined — gate survivors already applied at emit
        expect(styles.includes('body')).toBe(false)
    })

    test('destroy after hydrate returns style host retained count toward zero', () => {
        enableAxiiRetainedObjectDiagnostics()
        resetAxiiRetainedObjectDiagnostics()
        try {
            function App({}: any, {createElement}: RenderContext) {
                return <div style={{color: 'red', '&:hover': {color: 'blue'}}}>x</div>
            }
            const {html, styles} = renderToString(createElement(App, null as any))
            rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
            const root = hydrateRoot(rootEl, createElement(App, null as any))
            const mid = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(mid.styles.activeHostStyleStates).toBeGreaterThan(0)
            root.destroy()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(after.styles.activeHostStyleStates).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })

    test('CSR control: nested styles still work after StyleManager shared path', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{color: 'rgb(1, 2, 3)', '& .inner': {color: 'rgb(4, 5, 6)'}}}>
                <div class="inner" id="inner">x</div>
            </div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(getComputedStyle(document.getElementById('c')!).color).toBe('rgb(1, 2, 3)')
        expect(getComputedStyle(document.getElementById('inner')!).color).toBe('rgb(4, 5, 6)')
        root.destroy()
    })

    // ─── k12-audit: F30 content-signature + path-id alignment ───

    test('F30: StaticArray siblings with different nested styles must not share one SSR sheet', () => {
        function App({}: any, {createElement}: RenderContext) {
            return [
                <div id="a" style={{'&:hover': {opacity: '0.9'}, color: 'rgb(1, 2, 3)'}}>a</div>,
                <div id="b" style={{'&:hover': {opacity: '0.8'}, color: 'rgb(4, 5, 6)'}}>b</div>,
            ]
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        expect(styles).toMatch(/rgb\(4,\s*5,\s*6\)/)
        const wrap = document.createElement('div')
        wrap.innerHTML = html
        const ca = Array.from(wrap.querySelector('#a')!.classList).filter(c => /F\d/.test(c))
        const cb = Array.from(wrap.querySelector('#b')!.classList).filter(c => /F\d/.test(c))
        expect(ca[0]).not.toBe(cb[0])

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        expect(getComputedStyle(rootEl.querySelector('#a')!).color).toBe('rgb(1, 2, 3)')
        expect(getComputedStyle(rootEl.querySelector('#b')!).color).toBe('rgb(4, 5, 6)')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(getComputedStyle(rootEl.querySelector('#a')!).color).toBe('rgb(1, 2, 3)')
        expect(getComputedStyle(rootEl.querySelector('#b')!).color).toBe('rgb(4, 5, 6)')
    })

    test('stylesheet id path: FunctionHost nested style SSR class reclaimable (matches CSR staticId+R*)', () => {
        const show = atom(true as any)
        function App({}: any, {createElement}: RenderContext) {
            return <div id="r">{() => show()
                ? <span id="inner" style={{color: 'rgb(7, 8, 9)', '&:hover': {opacity: '0.5'}}}>x</span>
                : 'plain'
            }</div>
        }
        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const csrRoot = createRoot(csrEl)
        csrRoot.render(<App/>)
        const csrClass = (csrEl.querySelector('#inner') as HTMLElement).className
        csrRoot.destroy()
        csrEl.remove()

        const {html, styles} = renderToString(createElement(App, null as any))
        const ssrClass = (html.match(/id="inner"[^>]*class="([^"]+)"/) ||
            html.match(/class="([^"]+)"[^>]*id="inner"/))?.[1] || ''
        // SSR rolling base must share CSR's staticId prefix so reclaimRollingStyleId can match
        const csrBase = csrClass.replace(/I\d+$/, '').replace(/F\d+$/, '')
        const ssrBase = ssrClass.replace(/F\d+$/, '')
        expect(ssrBase.startsWith(csrBase.replace(/R\d+$/, '') + 'R') || ssrBase === csrBase).toBe(true)

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        hydrateRoot(rootEl, createElement(App, null as any))
        const hyd = rootEl.querySelector('#inner') as HTMLElement
        expect(getComputedStyle(hyd).color).toBe('rgb(7, 8, 9)')
        // After hydrate, prefer single reclaim class — no orphan SSR id alongside a new rolling id
        const styleClasses = Array.from(hyd.classList).filter(c => /R\d+F\d/.test(c))
        expect(styleClasses.length).toBe(1)
        expect(styleClasses[0]).toBe(ssrClass)
    })

    test('isAcceptableSingleCssRule pairs with Chromium insertRule oracle', () => {
        const sheet = new CSSStyleSheet()
        const cases = [
            '.x{width:100px}',
            '.x{width:100px} body{outline:1px solid red;}',
            '.x::before{content:"a}b{c"}',
            '.x{width:100px;} .y{color:red}',
            '',
            '.x{content:"a}b"}',
        ]
        for (const rule of cases) {
            let chromiumOk = false
            try {
                sheet.insertRule(rule, sheet.cssRules.length)
                chromiumOk = true
                sheet.deleteRule(sheet.cssRules.length - 1)
            } catch {
                chromiumOk = false
            }
            expect({rule, gate: isAcceptableSingleCssRule(rule)}).toEqual({rule, gate: chromiumOk})
        }
    })

    // ─── k13-audit: F31 reactive-in-stylesheet + simple atom snapshot ───

    test('F31: atom in nested stylesheet must SSR rolling (not static orphan)', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{color: color as any, '&:hover': {opacity: '0.5'}}}>x</div>
        }
        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const csrRoot = createRoot(csrEl)
        csrRoot.render(<App/>)
        const csrClass = (csrEl.querySelector('#c') as HTMLElement).className
        csrRoot.destroy()
        csrEl.remove()
        // CSR uses rolling + I-itor for reactive stylesheet values
        expect(/R\d+F\d/.test(csrClass)).toBe(true)

        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        const ssrClass = (html.match(/class="([^"]+)"/) || [])[1] || ''
        // SSR must emit reclaimable rolling base (static App*PF0 orphans beside hydrate I-itor)
        expect(/R\d+F/.test(ssrClass)).toBe(true)

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        hydrateRoot(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        const styleClasses = Array.from(el.classList).filter(c => /F\d/.test(c))
        expect(styleClasses.length).toBe(1)

        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
        expect(Array.from(el.classList).filter(c => /F\d/.test(c)).length).toBe(1)
    })

    test('F31 nested-only: atom inside &:hover still forces rolling', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{opacity: '1', '&:hover': {color: color as any}}}>x</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        const ssrClass = (html.match(/class="([^"]+)"/) || [])[1] || ''
        expect(/R\d+F/.test(ssrClass)).toBe(true)
    })

    test('simple atom style without nested must SSR snapshot (no FOUC)', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{color: color as any}}>x</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles).toBe('')
        rootEl.innerHTML = html
        const el = rootEl.querySelector('#c') as HTMLElement
        // Pre-hydrate must already reflect atom snapshot (Task req 1 / M-04 no FOUC)
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        expect(el.getAttribute('style') || '').toMatch(/color/)
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
    })

    // ─── k14-audit: bound+reactive / array / function / CSR↔SSR I0 parity ───

    test('bound+reactive: __bound nested with atom SSR rolling I0 and reclaim', () => {
        const color = atom('rgb(1, 2, 3)')
        const bound = markBoundProp({
            color: color as any,
            '&:hover': {opacity: '0.5'},
        })
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={bound as any}>x</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        const ssrClass = (html.match(/class="([^"]+)"/) || [])[1] || ''
        expect(/R\d+F\d+I0/.test(ssrClass)).toBe(true)

        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        hydrateRoot(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        expect(Array.from(el.classList).filter(c => /F\d/.test(c))).toEqual([ssrClass])
        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
    })

    test('style array: reactive sheet entry + plain inline sibling', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={[
                {color: color as any, '&:hover': {opacity: '0.5'}},
                {fontWeight: '700'},
            ] as any}>x</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        expect(styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        expect(/R\d+F0I0/.test((html.match(/class="([^"]+)"/) || [])[1] || '')).toBe(true)
        expect(html).toMatch(/font-weight:\s*700|font-weight:700/)
        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        hydrateRoot(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        expect(getComputedStyle(el).fontWeight).toMatch(/700|bold/)
        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
    })

    test('function style returning nested+atom forces rolling reclaim', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={() => ({
                color: color as any,
                '&:hover': {opacity: '0.5'},
            })}>x</div>
        }
        const {html, styles} = renderToString(createElement(App, null as any))
        const ssrClass = (html.match(/class="([^"]+)"/) || [])[1] || ''
        expect(/R\d+F/.test(ssrClass)).toBe(true)
        rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        hydrateRoot(rootEl, createElement(App, null as any))
        const el = rootEl.querySelector('#c') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(1, 2, 3)')
        expect(Array.from(el.classList).filter(c => /F\d/.test(c)).length).toBe(1)
        color('rgb(9, 8, 7)')
        expect(getComputedStyle(el).color).toBe('rgb(9, 8, 7)')
    })

    test('F31 CSR/SSR class shape parity (staticId + R* + F*I0)', () => {
        const color = atom('rgb(1, 2, 3)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="c" style={{color: color as any, '&:hover': {opacity: '0.5'}}}>x</div>
        }
        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const csrRoot = createRoot(csrEl)
        csrRoot.render(<App/>)
        const csrClass = (csrEl.querySelector('#c') as HTMLElement).className
        csrRoot.destroy()
        csrEl.remove()

        const {html} = renderToString(createElement(App, null as any))
        const ssrClass = (html.match(/class="([^"]+)"/) || [])[1] || ''
        expect(ssrClass).toMatch(/I0$/)
        expect(csrClass).toMatch(/I0$/)
        const stripR = (c: string) => c.replace(/R\d+/, 'R#')
        expect(stripR(ssrClass)).toBe(stripR(csrClass))
    })
})
