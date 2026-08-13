/** @jsx createElement */
/**
 * M-03: RxList SSR→hydrate — Compact / Comment-ph / G3-* / G4-F / reorder.
 * Run: npx vitest run __tests__/ssrHydrate.lists.spec.tsx
 */
import {
    createElement,
    createRoot,
    Fragment,
    hydrateRoot,
    RenderContext,
    RxList,
} from '@framework'
import {atom, RxMap} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {CompactElementHost} from '../src/StaticHost.js'

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

function hasAxiiMarkers(root: Node): boolean {
    const walk = (n: Node): boolean => {
        if (n.nodeType === Node.COMMENT_NODE) {
            const d = (n as Comment).data
            if (d === 'axii:t' || d === 'axii:/t' || d === 'axii:0') return true
        }
        for (const c of Array.from(n.childNodes)) {
            if (walk(c)) return true
        }
        return false
    }
    return walk(root)
}

function findHostByName(host: any, name: string): any {
    if (!host) return null
    if (host.constructor?.name === name) return host
    if (host.innerHost) {
        const found = findHostByName(host.innerHost, name)
        if (found) return found
    }
    const rh = host.reactiveHosts
    if (Array.isArray(rh)) {
        for (const child of rh) {
            const found = findHostByName(child, name)
            if (found) return found
        }
    } else if (rh) {
        return findHostByName(rh, name)
    }
    if (Array.isArray(host.hosts)) {
        for (const child of host.hosts) {
            const found = findHostByName(child, name)
            if (found) return found
        }
    }
    return null
}

describe('M-03 hydrateRoot RxList', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('G1 Compact: claim identity, no row comments; move matches CSR', () => {
        const list = new RxList([1, 2, 3])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{list.map((i: number) => <span data-i={i}>{i}</span>)}</div>
        }

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const spansBefore = Array.from(rootEl.querySelectorAll('span'))
        expect(spansBefore.map(s => s.textContent)).toEqual(['1', '2', '3'])

        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        const box = rootEl.querySelector('#t')!
        expect(shapeOf(box).filter(s => s === '<!--rx list item-->')).toEqual([])
        const spansAfter = Array.from(box.querySelectorAll('span'))
        expect(spansAfter[0]).toBe(spansBefore[0])
        expect(spansAfter[1]).toBe(spansBefore[1])
        expect(spansAfter[2]).toBe(spansBefore[2])

        const listHost = findHostByName((root as any).host, 'RxListHost')
        expect(listHost).toBeTruthy()
        expect(listHost.hosts[0]).toBeInstanceOf(CompactElementHost)
        expect(listHost.hosts[0].element).toBe(spansAfter[0])

        list.swap(0, 2)
        expect(Array.from(box.querySelectorAll('span')).map(s => s.textContent)).toEqual(['3', '2', '1'])
        expect(shapeOf(box).filter(s => s === '<!--rx list item-->')).toEqual([])

        const csr = document.createElement('div')
        document.body.appendChild(csr)
        const list2 = new RxList([3, 2, 1])
        createRoot(csr).render(createElement(() =>
            <div id="c">{list2.map((i: number) => <span data-i={i}>{i}</span>)}</div>, null as any))
        expect(shapeOf(csr.querySelector('#c')!)).toEqual(shapeOf(box))
    })

    test('G2 detachStyle: has rx list item (non-Compact)', () => {
        const list = new RxList([1])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{list.map((i: number) =>
                <span detachStyle={{opacity: 0} as any}>{i}</span>)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--rx list item-->')
        rootEl.innerHTML = html
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!).includes('<!--rx list item-->')).toBe(true)
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0]).not.toBeInstanceOf(CompactElementHost)
        expect(lh.hosts[0].placeholder).toBeInstanceOf(Comment)
        expect((lh.hosts[0].placeholder as Comment).data).toBe('rx list item')
    })

    test('G4 atom Comment-ph: empty/non-empty; splice; no marker residue', () => {
        const a = atom('')
        const b = atom('hi')
        const list = new RxList([a, b])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{list}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        const box = rootEl.querySelector('#t')!
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].element).toBeInstanceOf(Text)
        expect(lh.hosts[0].placeholder).toBeInstanceOf(Comment)
        expect((lh.hosts[0].placeholder as Comment).data).toBe('rx list item')
        expect((lh.hosts[0].element as Text).nodeValue).toBe('')
        expect((lh.hosts[1].element as Text).nodeValue).toBe('hi')

        a('X')
        expect((lh.hosts[0].element as Text).nodeValue).toBe('X')

        list.splice(0, 1)
        expect(shapeOf(box).filter(s => s.startsWith('#text')).length).toBe(1)
        list.unshift(atom('Z'))
        expect((lh.hosts[0].element as Text).nodeValue).toBe('Z')
    })

    test('G4-F Function→null: only rx list item; ≠ G3-E / G3-F', () => {
        function App({}, {createElement}: RenderContext) {
            const list = new RxList([() => null])
            return <div id="t">{list}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('<!--empty-->')
        expect(html).not.toContain('computed')
        rootEl.innerHTML = html
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].constructor.name).toBe('FunctionHost')
        expect((lh.hosts[0].placeholder as Comment).data).toBe('rx list item')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual([
            '#text:\"\"',
            '<!--rx list item-->',
            '<!--unhandledChild-->',
        ])
    })

    test('G3-E null row vs G4-F', () => {
        const list = new RxList<any>([null])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{list}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--empty--><!--rx list item-->')
        rootEl.innerHTML = html
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual([
            '<!--empty-->',
            '<!--rx list item-->',
            '<!--unhandledChild-->',
        ])
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].constructor.name).toBe('EmptyHost')
    })

    test('G3-F Function→element has computed; Function→atom not G4-F', () => {
        const name = atom('world')
        // Closures must be created inside App so JSX createElement resolves to context (SSR/DOM).
        function App({}, {createElement}: RenderContext) {
            const list = new RxList([() => <span>x</span>, () => name])
            return <div id="t">{list}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html.match(/computed node/g)?.length).toBe(2)
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('span')!
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('span')).toBe(spanBefore)
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].constructor.name).toBe('FunctionHost')
        expect(lh.hosts[1].constructor.name).toBe('FunctionHost')
        name('Y')
        expect(rootEl.textContent).toContain('Y')
    })

    test('G3-C Component row: no computed', () => {
        function Row({}, {createElement}: RenderContext) {
            return <span>r</span>
        }
        const list = new RxList([1])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{list.map(() => <Row />)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('computed')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#t')!.textContent).toBe('r')
        expect(shapeOf(rootEl.querySelector('#t')!).includes('<!--rx list item-->')).toBe(true)
    })

    test('G3-Fr Fragment row: fragment start', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            const list = new RxList([1])
            return <div id="t">{list.map(() =>
                // use F from context so SSR Fragment sentinel matches
                createElement(F as any, null, <span>a</span>, <span>b</span>)
            )}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!).includes('<!--fragment start-->')).toBe(true)
        expect(rootEl.querySelector('#t')!.textContent).toBe('ab')
    })

    test('G3-RL nested RxList: outer anchor; inner splice', () => {
        const inner = new RxList([1, 2])
        const outer = new RxList([inner])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{outer}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('computed')
        expect(html).not.toContain('<!--empty-->')
        rootEl.innerHTML = html
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        const box = rootEl.querySelector('#t')!
        expect(shapeOf(box).filter(s => s === '<!--rx list item-->').length).toBe(3)
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].constructor.name).toBe('RxListHost')
        expect((lh.hosts[0].placeholder as Comment).data).toBe('rx list item')

        inner.splice(0, 1)
        expect(shapeOf(box)).toEqual([
            '#text:\"2\"',
            '<!--rx list item-->',
            '<!--rx list item-->',
            '<!--unhandledChild-->',
        ])
    })

    test('G3-RU reusable row', () => {
        function App({}, {createElement, reusable}: RenderContext) {
            const reused = reusable(<div id="reused">R</div>)
            return <div id="t">{new RxList([reused])}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--reusable-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(rootEl.querySelector('#reused')!.textContent).toBe('R')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual([
            'DIV',
            '<!--reusable-->',
            '<!--rx list item-->',
            '<!--unhandledChild-->',
        ])
    })

    test('table tbody + Compact rows', () => {
        const list = new RxList([1, 2])
        function App({}, {createElement}: RenderContext) {
            return <table id="t"><tbody>{list.map((i: number) =>
                <tr><td>{i}</td></tr>)}</tbody></table>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const trsBefore = Array.from(rootEl.querySelectorAll('tr'))
        hydrateRoot(rootEl, createElement(App, null as any))
        const trsAfter = Array.from(rootEl.querySelectorAll('tr'))
        expect(trsAfter[0]).toBe(trsBefore[0])
        expect(trsAfter[1]).toBe(trsBefore[1])
        list.push(3)
        expect(rootEl.querySelectorAll('tr').length).toBe(3)
    })

    // --- G3-A row hydrate (audit k5): DirectNodes / multi-atom must claim without createElement stash ---

    test('G3-A string DirectNodes row: hydrate + CSR shape', () => {
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([['x', 'y'] as any])}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--axii:t-->x<!--axii:/t--><!--axii:t-->y<!--axii:/t--><!--rx list item-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#t')!.textContent).toContain('xy')
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        expect(shapeOf(csr.querySelector('#t')!)).toEqual(shapeOf(rootEl.querySelector('#t')!))
    })

    test('G3-A number DirectNodes row hydrate', () => {
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[1, 2] as any])}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#t')!.textContent).toContain('12')
    })

    test('G3-A multi-atom array row: each AtomHost updates independently', () => {
        const a = atom('A')
        const b = atom('B')
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[a, b] as any])}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--array item-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#t')!.textContent).toContain('AB')
        a('X')
        expect(rootEl.querySelector('#t')!.textContent).toContain('XB')
        b('Y')
        expect(rootEl.querySelector('#t')!.textContent).toContain('XY')
    })

    test('G3-A mixed DirectNodes + element row hydrate', () => {
        function App({}, {createElement}: RenderContext) {
            const rows = new RxList([1])
            return <div id="t">{rows.map(() => ['pre', <span>mid</span>, 'post'] as any)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('span')).toBe(spanBefore)
        expect(rootEl.querySelector('#t')!.textContent).toBe('premidpost')
    })

    test('G3-A element-only array row still claims (control)', () => {
        function App({}, {createElement}: RenderContext) {
            const rows = new RxList([1])
            return <div id="t">{rows.map(() => [<span>a</span>, <span>b</span>] as any)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const spansBefore = Array.from(rootEl.querySelectorAll('span'))
        const r = hydrateRoot(rootEl, createElement(App, null as any))
        expect(Array.from(rootEl.querySelectorAll('span'))[0]).toBe(spansBefore[0])
        const lh = findHostByName((r as any).host, 'RxListHost')
        expect(lh.hosts[0].constructor.name).toBe('StaticArrayHost')
        expect((lh.hosts[0].placeholder as Comment).data).toBe('rx list item')
    })

    // --- G3-A nested items (audit k6): SSR must match CSR placeholders for Array/Fragment items ---

    test('G3-A nested array item: no spurious unhandledChild; hydrate ≡ CSR', () => {
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[[1, 2], 'x'] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.filter(s => s === '<!--unhandledChild-->').length).toBe(1) // list host only
        expect(csrShape.includes('<!--array item-->')).toBe(true)

        const {html} = renderToString(createElement(App, null as any))
        // Nested StaticArray placeholder is <!--array item-->, not <!--unhandledChild--><!--array item-->
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#t')!.textContent).toContain('12x')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A Fragment item: fragment start + hydrate identity ≡ CSR', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return <div id="t">{new RxList([[
                createElement(F as any, null, 'a', createElement('span', null, 'b')),
            ] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.includes('<!--fragment start-->')).toBe(true)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')

        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('span')).toBe(spanBefore)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A Component item: no orphan unhandledChild; shape ≡ CSR', () => {
        function Child({}, {createElement}: RenderContext) {
            return <span>c</span>
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[createElement(Child, null)] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.filter(s => s === '<!--unhandledChild-->').length).toBe(1)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)

        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('span')).toBe(spanBefore)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A RxList item: nested rows + array item (no nested unhandledChild)', () => {
        const inner = new RxList([1, 2])
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[inner, 'z'] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.filter(s => s === '<!--unhandledChild-->').length).toBe(1)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A Reusable item: reusable + array item (no nested unhandledChild)', () => {
        function App({}, {createElement, reusable}: RenderContext) {
            const reused = reusable(<div id="reused">R</div>)
            return <div id="t">{new RxList([[reused, 'z'] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.includes('<!--reusable-->')).toBe(true)
        expect(csrShape.filter(s => s === '<!--unhandledChild-->').length).toBe(1)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toContain('<!--reusable--><!--array item-->')

        rootEl.innerHTML = html
        const before = rootEl.querySelector('#reused')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#reused')).toBe(before)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    // --- Fragment createElement under active list/array cursor (audit k7) ---
    // Root cause: hydrate Fragment createElement claims text via parent cursor when
    // StaticArrayHost/RxListHost left the region cursor active; intended path is leave
    // content for StaticHost(DocumentFragment) + claimFragmentStartBefore(placeholder).

    test('G3-A Component→Fragment item: hydrate ≡ CSR (fragment under array cursor)', () => {
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, 'p', createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[createElement(Child, null), 'z'] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.includes('<!--fragment start-->')).toBe(true)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)

        rootEl.innerHTML = html
        const emBefore = rootEl.querySelector('em')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('em')).toBe(emBefore)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A Function→Fragment item: FCS + array item hydrate ≡ CSR', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return <div id="t">{new RxList([[
                () => createElement(F as any, null, 'p', createElement('em', null, 'q')),
                'z',
            ] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--computed node--><!--array item-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-C Component→Fragment row: hydrate ≡ CSR (fragment under list cursor)', () => {
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, 'p', createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([createElement(Child, null) as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.includes('<!--fragment start-->')).toBe(true)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).not.toContain('<!--computed node-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-F Function→Fragment row: hydrate ≡ CSR (fragment under list cursor)', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return <div id="t">{new RxList([
                () => createElement(F as any, null, 'a', createElement('i', null, 'b')),
            ] as any)}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape.includes('<!--fragment start-->')).toBe(true)
        expect(csrShape.includes('<!--computed node-->')).toBe(true)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--computed node-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-A nested Component→Fragment item: hydrate ≡ CSR', () => {
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, 'x', createElement('b', null, 'y'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[[createElement(Child, null), 'z']] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    // --- Fragment dynamic children under cursor / without cursor (audit k8) ---
    // k8 only skipped static text + Node advancePastNode for Fragment; atom / function /
    // array children still call claim* via parent cursor (or throw with no cursor).

    test('G3-C Component→Fragment with atom child: hydrate ≡ CSR', () => {
        const a = atom('hello')
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, a, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([createElement(Child, null) as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('world')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('G3-A Component→Fragment with atom child (array item): hydrate ≡ CSR', () => {
        const a = atom('hello')
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, a, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([[createElement(Child, null), 'z'] as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-F Function→Fragment with nested function text: hydrate ≡ CSR', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return <div id="t">{new RxList([
                () => createElement(F as any, null, () => 'dyn', createElement('i', null, 'b')),
            ] as any)}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--computed node-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('G3-C Component→Fragment with array child: hydrate ≡ CSR', () => {
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, ['a', 'b'] as any, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([createElement(Child, null) as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--unhandledChild-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('element-child Component→Fragment with atom: hydrate ≡ CSR (no list cursor)', () => {
        const a = atom('hello')
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, a, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t"><div>{createElement(Child, null as any)}</div></div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('world')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    // --- Fragment child kinds once-listed (audit k9): nested DF dynamic + PrimitiveHost boolean ---
    // k9 reconciled top-level Fragment atom/fn/array/RxList; nested DocumentFragment dynamic
    // children stay unbound (stub placeholder); boolean is CSR Comment-ph but SSR omits + hydrate wrong.

    test('G3-C nested Fragment with atom: hydrate update ≡ CSR', () => {
        const a = atom('inner')
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null,
                createElement(F as any, null, a, createElement('b', null, 'b')),
                createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([createElement(Child, null) as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--fragment start-->')

        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('changed')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('G3-C Fragment with boolean false: SSR+hydrate ≡ CSR Comment-ph', () => {
        function Child({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F as any, null, false, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{new RxList([createElement(Child, null) as any])}</div>
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape).toContain('#text:""')
        expect(csrShape.filter(s => s === '<!--unhandledChild-->').length).toBeGreaterThanOrEqual(1)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    // --- Element-child Fragment flatten path (audit k10): no <!--fragment start-->, no
    // StaticHost(DocumentFragment) reconcile. createElement(Fragment) defers stubs +
    // __axiiFragmentHydrateChildren, but only StaticHost DF calls reconcile — so atom/fn/
    // boolean/array stay unbound (axii:t residue / stub not in DOM / crash). Distinct from
    // Component→Fragment (has fragment start + reconcile; existing green control above).

    test('element-child Fragment + atom: hydrate update ≡ CSR (no fragment start)', () => {
        const a = atom('el')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, a, createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape).toEqual(['#text:"el"', 'EM'])

        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('up')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child nested Fragment + atom: hydrate update ≡ CSR', () => {
        const a = atom('el')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null,
                    createElement(F as any, null, a),
                    createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('up')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child Fragment + boolean: SSR+hydrate ≡ CSR Comment-ph', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, false, createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        expect(csrShape).toContain('#text:""')

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
    })

    test('element-child Fragment + function text: hydrate update ≡ CSR', () => {
        const a = atom('fn')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, () => a(), createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('changed')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child Fragment + array atom: hydrate update ≡ CSR', () => {
        const a = atom('arr')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, [a, 's'], createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('z')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    // --- Path B matrix completion (audit k11): Component / RxList / static peel /
    // consecutive Fragments / element-with-atom / outer siblings — same flatten reconcile.

    test('element-child Fragment + Component→atom: hydrate update ≡ CSR', () => {
        const a = atom('c')
        function Child() {
            return a as any
        }
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, createElement(Child as any, null), createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('up')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child Fragment + RxList Compact: push ≡ CSR', () => {
        const list = new RxList([1, 2])
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null,
                    list.map((i: number) => createElement('span', {'data-i': i}, i)),
                    createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        expect(html).not.toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        list.push(3)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child Fragment static+atom strips axii:t', () => {
        const a = atom('dyn')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, 'pre', a, 'post'))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toMatch(/axii:t/)
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('X')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('two consecutive element-child Fragments with atoms', () => {
        const a = atom('a')
        const b = atom('b')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null, a),
                createElement(F as any, null, b),
                createElement('em', null, 'q'))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('A')
        b('B')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('element-child Fragment + element(atom child): identity + update', () => {
        const a = atom('in')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                createElement(F as any, null,
                    createElement('span', {id: 's'}, a),
                    createElement('em', null, 'q')))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const spanBefore = rootEl.querySelector('#s')
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#s')).toBe(spanBefore)
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('out')
        expect(rootEl.querySelector('#s')!.textContent).toBe('out')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('sibling static outside Fragment + Fragment atom', () => {
        const a = atom('m')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', {id: 't'},
                'L',
                createElement(F as any, null, a),
                'R')
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        a('M')
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })

    test('RxMap.keys().map Compact hydrate ≡ CSR', () => {
        const map = new RxMap<string, number>([['a', 1], ['b', 2]])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', {id: 't'},
                map.keys().map((k: string) => createElement('span', {'data-k': k}, k)))
        }
        const csr = document.createElement('div')
        document.body.appendChild(csr)
        createRoot(csr).render(createElement(App, null as any))
        const csrShape = shapeOf(csr.querySelector('#t')!)
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(csrShape)
        map.set('c', 3)
        expect(shapeOf(rootEl.querySelector('#t')!)).toEqual(shapeOf(csr.querySelector('#t')!))
    })
})
