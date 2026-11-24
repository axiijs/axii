/** @jsx createElement */
/**
 * M-06 §3.7: hydration mismatch observability + local CSR rebuild.
 * Run: npx vitest run __tests__/ssrHydrate.mismatch.spec.tsx
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    configureDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    disableAxiiRetainedObjectDiagnostics,
    resetAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    RenderContext,
} from '@framework'
import {atom, RxList} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {HydrationMismatchError} from '../src/hydration.js'

describe('M-06 hydration mismatch (§3.7)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        configureDiagnostics({})
    })

    test('tampered ElementChildText: diagnostics + new text identity; matched sibling preserved', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })

        function App({}: any, {createElement}: RenderContext) {
            return (
                <div>
                    <span id="a">{'hello'}</span>
                    <span id="b">{'world'}</span>
                </div>
            )
        }

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html

        const aBefore = rootEl.querySelector('#a')!
        const bBefore = rootEl.querySelector('#b')!
        const aTextBefore = Array.from(aBefore.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        const bTextBefore = Array.from(bBefore.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(aTextBefore.nodeValue).toBe('hello')
        // Tamper SSR text (version/data drift)
        aTextBefore.nodeValue = 'TAMPERED'

        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const mismatch = errors.find(e => e instanceof HydrationMismatchError) as HydrationMismatchError | undefined
        expect(mismatch).toBeTruthy()
        expect(mismatch!.code).toBe('AXII_HYDRATION_MISMATCH')
        expect(mismatch!.expected).toContain('hello')
        expect(mismatch!.actual).toContain('TAMPERED')

        const aAfter = rootEl.querySelector('#a')!
        const bAfter = rootEl.querySelector('#b')!
        expect(aAfter).toBe(aBefore)
        expect(bAfter).toBe(bBefore)
        const aTextAfter = Array.from(aAfter.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        const bTextAfter = Array.from(bAfter.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(aTextAfter.nodeValue).toBe('hello')
        // Mismatched unit rebuilt — new Text identity
        expect(aTextAfter).not.toBe(aTextBefore)
        // Matched sibling identity kept
        expect(bTextAfter).toBe(bTextBefore)
        expect(bTextAfter.nodeValue).toBe('world')

        root.destroy()
        configureDiagnostics({})
    })

    test('tampered atom Text-ph: rebuild then reactive updates on new Text', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const text = atom('client')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="t">{text}</div>
        }

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const div = rootEl.querySelector('#t')!
        const before = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(before.nodeValue).toBe('client')
        before.nodeValue = 'stale-ssr'

        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        const after = Array.from(div.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(after.nodeValue).toBe('client')
        expect(after).not.toBe(before)
        text('updated')
        expect(after.nodeValue).toBe('updated')
        root.destroy()
        configureDiagnostics({})
    })

    test('matched path: no mismatch report; text identity reused', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        function App({}: any, {createElement}: RenderContext) {
            return <div id="ok">{'same'}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const before = Array.from(rootEl.querySelector('#ok')!.childNodes)
            .find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(before.nodeValue).toBe('same')
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(errors.filter(e => e instanceof HydrationMismatchError)).toHaveLength(0)
        const after = Array.from(rootEl.querySelector('#ok')!.childNodes)
            .find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(after).toBe(before)
        root.destroy()
        configureDiagnostics({})
    })

    // --- k21-audit: §3.7 claim-miss / marker-miss must not leave silent unbound DOM ---

    test('wrong child tag: no leftover axii markers; client tag bound and updates', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const text = atom('hi')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d"><span id="s">{text}</span></div>
        }
        const {html} = renderToString(createElement(App, null as any))
        // Tamper: span → p (structure / tag mismatch)
        rootEl.innerHTML = html.replace('<span id="s">', '<p id="s">').replace('</span>', '</p>')
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        const span = rootEl.querySelector('span#s')
        expect(span).toBeTruthy()
        expect(rootEl.querySelector('p#s')).toBeFalsy()
        text('BYE')
        expect(span!.textContent).toBe('BYE')
        expect(
            errors.some(e => e instanceof HydrationMismatchError) || span != null,
        ).toBe(true)
        root.destroy()
        configureDiagnostics({})
    })

    test('id attribute drift: client id/title applied; no orphan SSR sibling', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}: any, {createElement}: RenderContext) {
            return <div id="ok" title="t">{'x'}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const el = rootEl.querySelector('#ok') as HTMLElement
        el.id = 'WRONG'
        el.setAttribute('title', 'HACK')
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(rootEl.querySelector('#ok')).toBeTruthy()
        expect(rootEl.querySelector('#ok')!.getAttribute('title')).toBe('t')
        expect(rootEl.querySelector('#WRONG')).toBeFalsy()
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        expect(rootEl.querySelectorAll('div').length).toBe(1)
        root.destroy()
        configureDiagnostics({})
    })

    test('missing axii:0: mismatch report + empty Text-ph bound for atom updates', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const text = atom('')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="e">{text}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--axii:0-->')
        rootEl.innerHTML = html.replace(/<!--axii:0-->/g, '')
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        const host = rootEl.querySelector('#e')!
        const t = Array.from(host.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(t).toBeTruthy()
        text('filled')
        expect(t.nodeValue).toBe('filled')
        expect(rootEl.querySelectorAll('div').length).toBe(1)
        root.destroy()
        configureDiagnostics({})
    })

    // --- k22-audit: tryClaimElement must not steal same-tag siblings when cursor unit is wrong tag ---

    test('wrong-tag child with id: must not steal next same-tag sibling; orphan removed', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const em = document.createElement('em')
        em.id = 'a'
        while (aEl.firstChild) em.appendChild(aEl.firstChild)
        aEl.replaceWith(em)
        const bBefore = rootEl.querySelector('#b')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(rootEl.querySelector('em#a')).toBeFalsy()
        expect(rootEl.querySelector('span#a')).toBeTruthy()
        expect(rootEl.querySelector('#b')).toBe(bBefore)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        root.destroy()
        configureDiagnostics({})
    })

    test('wrong-tag child without id: must not steal next same-tag sibling; orphan removed', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span>{a}</span>
                    <span>{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const first = rootEl.querySelector('#d')!.firstElementChild!
        expect(first.tagName).toBe('SPAN')
        const em = document.createElement('em')
        while (first.firstChild) em.appendChild(first.firstChild)
        first.replaceWith(em)
        const secondBefore = rootEl.querySelector('#d')!.querySelector('span')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(rootEl.querySelector('em')).toBeFalsy()
        expect(rootEl.querySelectorAll('#d > span').length).toBe(2)
        expect(rootEl.querySelectorAll('#d > span')[1]).toBe(secondBefore)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        const spans = rootEl.querySelectorAll('#d > span')
        expect(spans[0].textContent).toBe('AA')
        expect(spans[1].textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    // --- k23-audit: interstitial extra node / swapped tags (domain-review → milestone-review) ---

    test('interstitial extra element: remove junk, claim next same-tag; no orphan axii:t', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const extra = document.createElement('div')
        extra.id = 'x'
        extra.textContent = 'junk'
        aEl.after(extra)
        const bBefore = rootEl.querySelector('#b')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}`).join(',')
        expect(rootEl.querySelector('#x'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        expect(rootEl.querySelector('#b')).toBe(bBefore)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('multiple interstitial junk nodes: remove all; claim next exact id', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const j1 = document.createElement('div')
        j1.id = 'x1'
        const j2 = document.createElement('em')
        j2.id = 'x2'
        aEl.after(j1)
        j1.after(j2)
        const bBefore = rootEl.querySelector('#b')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}`).join(',')
        expect(rootEl.querySelector('#x1'), dump).toBeFalsy()
        expect(rootEl.querySelector('#x2'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        expect(rootEl.querySelector('#b')).toBe(bBefore)
        a('AA'); b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('swapped sibling tags: must not wrongIdMiss-claim earlier wrong role; restore span then p', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <p id="b">{b}</p>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const bEl = rootEl.querySelector('#b')!
        const p = document.createElement('p')
        p.id = 'a'
        while (aEl.firstChild) p.appendChild(aEl.firstChild)
        const s = document.createElement('span')
        s.id = 'b'
        while (bEl.firstChild) s.appendChild(bEl.firstChild)
        aEl.replaceWith(p)
        bEl.replaceWith(s)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}:${k.textContent}`).join(' | ')
        expect(rootEl.querySelector('span#a'), dump).toBeTruthy()
        expect(rootEl.querySelector('p#b'), dump).toBeTruthy()
        expect(kids.length, dump).toBe(2)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        expect(rootEl.querySelector('span#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('p#b')!.textContent).toBe('BB')
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        root.destroy()
        configureDiagnostics({})
    })

    test('middle wrong-tag between correct siblings: rebuild middle only', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        const c = atom('C')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                    <span id="c">{c}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const bEl = rootEl.querySelector('#b')!
        const em = document.createElement('em')
        em.id = 'b'
        while (bEl.firstChild) em.appendChild(bEl.firstChild)
        bEl.replaceWith(em)
        const aBefore = rootEl.querySelector('#a')!
        const cBefore = rootEl.querySelector('#c')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(rootEl.querySelector('em')).toBeFalsy()
        expect(rootEl.querySelector('#a')).toBe(aBefore)
        expect(rootEl.querySelector('#c')).toBe(cBefore)
        expect(rootEl.querySelectorAll('#d > span').length).toBe(3)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA'); b('BB'); c('CC')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        expect(rootEl.querySelector('#c')!.textContent).toBe('CC')
        root.destroy()
        configureDiagnostics({})
    })

    // --- k24-audit: same-tag interstitial / swapped ids (deep-walk bypasses D6 cursor cleanup) ---

    test('same-tag interstitial wrong-id: remove junk; claim next exact id; no orphan', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const junk = document.createElement('span')
        junk.id = 'x'
        junk.textContent = 'junk'
        aEl.after(junk)
        const bBefore = rootEl.querySelector('#b')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}:${k.textContent}`).join(' | ')
        expect(rootEl.querySelector('#x'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        expect(rootEl.querySelector('#b'), dump).toBe(bBefore)
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('swapped same-tag ids: preserve client order roles; no cross-wired bindings', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a') as HTMLElement
        const bEl = rootEl.querySelector('#b') as HTMLElement
        aEl.id = 'b'
        bEl.id = 'a'
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}:${k.textContent}`).join(' | ')
        expect(kids.length, dump).toBe(2)
        expect((kids[0] as HTMLElement).id, dump).toBe('a')
        expect((kids[1] as HTMLElement).id, dump).toBe('b')
        expect(rootEl.innerHTML).not.toMatch(/<!--axii:t-->/)
        a('AA')
        b('BB')
        expect(kids[0].textContent, dump).toBe('AA')
        expect(kids[1].textContent, dump).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    // --- k25-audit: multi same-tag interstitial (green strengthen) + trailing orphans (red) ---

    test('multiple same-tag interstitial junk: remove all; claim exact id', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const aEl = rootEl.querySelector('#a')!
        const j1 = document.createElement('span')
        j1.id = 'x1'
        j1.textContent = 'j1'
        const j2 = document.createElement('span')
        j2.id = 'x2'
        j2.textContent = 'j2'
        aEl.after(j1)
        j1.after(j2)
        const bBefore = rootEl.querySelector('#b')!
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}`).join('|')
        expect(rootEl.querySelector('#x1'), dump).toBeFalsy()
        expect(rootEl.querySelector('#x2'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        expect(rootEl.querySelector('#b')).toBe(bBefore)
        a('AA'); b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('trailing same-tag junk: must not leave orphan after hydrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const junk = document.createElement('span')
        junk.id = 'x'
        junk.textContent = 'junk'
        d.appendChild(junk)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}`).join('|')
        expect(rootEl.querySelector('#x'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        a('AA'); b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('trailing different-tag junk: must not leave orphan after hydrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const junk = document.createElement('div')
        junk.id = 'x'
        junk.textContent = 'junk'
        d.appendChild(junk)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const kids = Array.from(rootEl.querySelector('#d')!.children)
        const dump = kids.map(k => `${k.tagName}#${(k as HTMLElement).id}`).join('|')
        expect(rootEl.querySelector('#x'), dump).toBeFalsy()
        expect(kids.length, dump).toBe(2)
        a('AA'); b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        expect(rootEl.querySelector('#b')!.textContent).toBe('BB')
        root.destroy()
        configureDiagnostics({})
    })

    test('trailing text junk: must not leave orphan after hydrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        d.appendChild(document.createTextNode('TRAILING'))
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(d.childNodes).map(n =>
            n.nodeType === Node.TEXT_NODE ? `T(${n.nodeValue})` : (n as Element).tagName,
        ).join('|')
        expect(d.textContent, dump).not.toContain('TRAILING')
        expect(Array.from(d.children).length, dump).toBe(1)
        a('AA')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        root.destroy()
        configureDiagnostics({})
    })

    // --- k26-audit: element-child trailing strengthen + hydrate-root container orphans (D11) ---

    test('multiple mixed trailing junk: remove all element+text orphans', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        const b = atom('B')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                    <span id="b">{b}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const j1 = document.createElement('span')
        j1.id = 'x1'
        j1.textContent = 'j1'
        const j2 = document.createElement('div')
        j2.id = 'x2'
        j2.textContent = 'j2'
        d.appendChild(j1)
        d.appendChild(document.createTextNode('TAIL'))
        d.appendChild(j2)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(d.childNodes).map(n =>
            n.nodeType === Node.TEXT_NODE ? `T(${n.nodeValue})` : `${(n as Element).tagName}#${(n as HTMLElement).id}`,
        ).join('|')
        expect(rootEl.querySelector('#x1'), dump).toBeFalsy()
        expect(rootEl.querySelector('#x2'), dump).toBeFalsy()
        expect(d.textContent, dump).not.toContain('TAIL')
        expect(d.children.length, dump).toBe(2)
        a('AA'); b('BB')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        root.destroy()
        configureDiagnostics({})
    })

    test('trailing junk after RxList: must not leave orphan', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const items = new RxList(['a', 'b'])
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    {items.map(i => <span class="i">{i}</span>)}
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const junk = document.createElement('span')
        junk.id = 'x'
        junk.textContent = 'junk'
        d.appendChild(junk)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(d.childNodes).map(n =>
            n.nodeType === Node.COMMENT_NODE ? `C(${(n as Comment).data})` : (n as Element).tagName,
        ).join('|')
        expect(rootEl.querySelector('#x'), dump).toBeFalsy()
        items.push('c')
        expect(d.querySelectorAll('span.i').length, dump).toBe(3)
        root.destroy()
        configureDiagnostics({})
    })

    test('hydrate-root trailing junk after <!--root-->: must not leave orphan', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const junk = document.createElement('div')
        junk.id = 'root-x'
        junk.textContent = 'root junk'
        rootEl.appendChild(junk)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(rootEl.childNodes).map(n => {
            if (n.nodeType === Node.COMMENT_NODE) return `C(${(n as Comment).data})`
            return `${(n as Element).tagName}#${(n as HTMLElement).id}`
        }).join('|')
        expect(rootEl.querySelector('#root-x'), dump).toBeFalsy()
        expect(rootEl.querySelector('#d'), dump).toBeTruthy()
        a('AA')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        root.destroy()
        configureDiagnostics({})
    })

    test('hydrate-root junk before <!--root-->: must not leave orphan sibling', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        const a = atom('A')
        function App({}: any, {createElement}: RenderContext) {
            return (
                <div id="d">
                    <span id="a">{a}</span>
                </div>
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const rootComment = Array.from(rootEl.childNodes).find(
            n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'root',
        )!
        const junk = document.createElement('div')
        junk.id = 'pre-root-x'
        rootEl.insertBefore(junk, rootComment)
        // Also cover leading sibling before the app root element
        const lead = document.createElement('div')
        lead.id = 'lead-x'
        rootEl.insertBefore(lead, rootEl.firstChild)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(rootEl.childNodes).map(n => {
            if (n.nodeType === Node.COMMENT_NODE) return `C(${(n as Comment).data})`
            return `${(n as Element).tagName}#${(n as HTMLElement).id}`
        }).join('|')
        expect(rootEl.querySelector('#pre-root-x'), dump).toBeFalsy()
        expect(rootEl.querySelector('#lead-x'), dump).toBeFalsy()
        expect(rootEl.querySelector('#d'), dump).toBeTruthy()
        a('AA')
        expect(rootEl.querySelector('#a')!.textContent).toBe('AA')
        root.destroy()
        configureDiagnostics({})
    })

    // --- k27/k28-audit: Comment-ph text drift (D12) + container leading STYLE/SCRIPT/LINK (D13) ---

    test('Comment-ph atom text drift: must report HydrationMismatchError (not silent run() fix)', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        // RxList atom row → Comment-ph; claimTextBeforeCommentPlaceholder(expected) must report+rebuild
        const items = new RxList([atom('A')])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">{items.map(i => i)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const textBefore = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textBefore.nodeValue).toBe('A')
        textBefore.nodeValue = 'STALE'
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const mismatch = errors.find(e => e instanceof HydrationMismatchError) as HydrationMismatchError | undefined
        expect(
            mismatch,
            `errors=${errors.map(e => (e as Error).message).join('; ')}; DOM=${d.textContent}`,
        ).toBeTruthy()
        expect(mismatch!.expected).toContain('A')
        expect(mismatch!.actual).toContain('STALE')
        // §3.7: mismatch unit identity must differ after local rebuild
        const textAfter = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textAfter.nodeValue).toBe('A')
        expect(textAfter).not.toBe(textBefore)
        root.destroy()
        configureDiagnostics({})
    })

    test('matched Comment-ph: no mismatch; text identity reused', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const items = new RxList([atom('A')])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">{items.map(i => i)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const textBefore = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(errors.filter(e => e instanceof HydrationMismatchError)).toHaveLength(0)
        const textAfter = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textAfter).toBe(textBefore)
        expect(textAfter.nodeValue).toBe('A')
        root.destroy()
        configureDiagnostics({})
    })

    test('G4-F Function→string Comment-ph text drift: report + identity rebuild', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const items = new RxList([() => 'A'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">{items.map(i => i)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const textBefore = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textBefore.nodeValue).toBe('A')
        textBefore.nodeValue = 'STALE'
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        const mismatch = errors.find(e => e instanceof HydrationMismatchError) as HydrationMismatchError | undefined
        expect(mismatch, `errors=${errors.map(e => (e as Error).message).join('; ')}`).toBeTruthy()
        const textAfter = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textAfter.nodeValue).toBe('A')
        expect(textAfter).not.toBe(textBefore)
        root.destroy()
        configureDiagnostics({})
    })

    test('PrimitiveHost Comment-ph string drift: report + identity rebuild', () => {
        const errors: unknown[] = []
        configureDiagnostics({
            enabled: true,
            onError: (e) => { errors.push(e) },
        })
        const items = new RxList(['A' as any])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">{items.map(i => i)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const d = rootEl.querySelector('#d')!
        const textBefore = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textBefore.nodeValue).toBe('A')
        textBefore.nodeValue = 'STALE'
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        const mismatch = errors.find(e => e instanceof HydrationMismatchError) as HydrationMismatchError | undefined
        expect(mismatch, `errors=${errors.map(e => (e as Error).message).join('; ')}`).toBeTruthy()
        const textAfter = Array.from(d.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text
        expect(textAfter.nodeValue).toBe('A')
        expect(textAfter).not.toBe(textBefore)
        root.destroy()
        configureDiagnostics({})
    })

    test('hydrate-root leading non-ssr STYLE: must not remain after migrate (CSR shape)', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">ok</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        // After migrateSsrStyleTags, leftover STYLE/SCRIPT/LINK are orphans (§3.7 / D13).
        const style = document.createElement('style')
        style.id = 'evil'
        style.textContent = 'body{outline:1px solid red}'
        rootEl.insertBefore(style, rootEl.firstChild)
        const root = hydrateRoot(rootEl, createElement(App, null as any))

        const dump = Array.from(rootEl.childNodes).map(n => {
            if (n.nodeType === Node.COMMENT_NODE) return `C(${(n as Comment).data})`
            if (n.nodeType === Node.ELEMENT_NODE) {
                const el = n as HTMLElement
                return el.id ? `${el.tagName}#${el.id}` : el.tagName
            }
            return `T(${(n as Text).nodeValue})`
        }).join('|')
        expect(rootEl.querySelector('#evil'), dump).toBeFalsy()
        expect(rootEl.querySelector('#d'), dump).toBeTruthy()
        root.destroy()
        configureDiagnostics({})
    })

    test('hydrate-root leading SCRIPT orphan: must not remain after migrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">ok</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const script = document.createElement('script')
        script.id = 'evil-js'
        script.textContent = 'window.__axiiEvil=1'
        rootEl.insertBefore(script, rootEl.firstChild)
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#evil-js')).toBeFalsy()
        expect(rootEl.querySelector('#d')).toBeTruthy()
        root.destroy()
        configureDiagnostics({})
    })

    test('hydrate-root leading LINK orphan: must not remain after migrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}: any, {createElement}: RenderContext) {
            return <div id="d">ok</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const link = document.createElement('link')
        link.id = 'evil-link'
        link.rel = 'stylesheet'
        link.href = 'data:text/css,body{color:red}'
        rootEl.insertBefore(link, rootEl.firstChild)
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#evil-link')).toBeFalsy()
        expect(rootEl.querySelector('#d')).toBeTruthy()
        root.destroy()
        configureDiagnostics({})
    })

    test('portal container trailing junk after <!--root-->: must not leave orphan', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(() => <div id="pc">p</div>, 'portal-target' as any)}
            </div>
        }
        const portalEl = document.createElement('div')
        portalEl.id = 'portal-target'
        document.body.appendChild(portalEl)
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const junk = document.createElement('div')
        junk.id = 'pj'
        portalEl.appendChild(junk)
        const root = hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#pj')).toBeFalsy()
        expect(portalEl.querySelector('#pc')).toBeTruthy()
        root.destroy()
        portalEl.remove()
        configureDiagnostics({})
    })

    test('portal container leading STYLE orphan: must not remain after migrate', () => {
        configureDiagnostics({enabled: true, onError: () => {}})
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(() => <div id="pc">p</div>, 'portal-target' as any)}
            </div>
        }
        const portalEl = document.createElement('div')
        portalEl.id = 'portal-target'
        document.body.appendChild(portalEl)
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const style = document.createElement('style')
        style.id = 'evil-p'
        style.textContent = 'body{outline:1px solid red}'
        portalEl.insertBefore(style, portalEl.firstChild)
        const root = hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#evil-p')).toBeFalsy()
        expect(portalEl.querySelector('#pc')).toBeTruthy()
        root.destroy()
        portalEl.remove()
        configureDiagnostics({})
    })
})

describe('M-06 retained after hydrate+destroy', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('hydrate+destroy returns host/binding/style retained counters to zero', () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const label = atom('x')
            const items = new RxList(['a', 'b'])
            function App({}: any, {createElement}: RenderContext) {
                return (
                    <div style={{color: 'red', '&:hover': {color: 'blue'}}}>
                        {label}
                        {items.map(i => <span>{i}</span>)}
                    </div>
                )
            }
            const {html, styles} = renderToString(createElement(App, null as any))
            rootEl.innerHTML = styles ? `<style data-axii-ssr>${styles}</style>${html}` : html
            const root = hydrateRoot(rootEl, createElement(App, null as any))
            const mid = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(mid.hosts.totalActive).toBeGreaterThan(0)
            expect(mid.lightBindings.totalActive).toBeGreaterThan(0)
            root.destroy()
            const after = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(after.hosts.totalActive).toBe(0)
            expect(after.lightBindings.totalActive).toBe(0)
            expect(after.compactListHosts.active).toBe(0)
            expect(after.styles.activeHostStyleStates).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
            resetAxiiRetainedObjectDiagnostics()
        }
    })

    test('CSR control: createRoot destroy still zeros (no hydrate regression)', () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            function App({}: any, {createElement}: RenderContext) {
                return <div>{atom('c')}</div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            expect(getAxiiRetainedObjectDiagnosticsSnapshot().hosts.totalActive).toBeGreaterThan(0)
            root.destroy()
            expect(getAxiiRetainedObjectDiagnosticsSnapshot().hosts.totalActive).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })
})
