/** @jsx createElement */
/**
 * M-01: browser hydrateRoot smoke — identity reuse, empty atom insert, root, EmptyHost.
 * Run: npx vitest run __tests__/ssrHydrate.smoke.spec.tsx
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    RenderContext,
} from '@framework'
import {atom} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'

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

/** Walk ComponentHost/StaticHost tree to find a named Host (audit/ownership checks). */
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
    return null
}

describe('M-01 hydrateRoot smoke', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('static- + atom: claim identity, strip markers, atom updates same Text; static is element child', () => {
        const text = atom('atomVal')
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{'static-'}{text}</div>
        }

        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html

        const divBefore = rootEl.querySelector('#t')!
        // After parse: markers + two texts
        const textsBefore = Array.from(divBefore.childNodes).filter(n => n.nodeType === Node.TEXT_NODE) as Text[]
        expect(textsBefore.length).toBe(2)
        const staticTextBefore = textsBefore[0]
        const atomTextBefore = textsBefore[1]
        expect(staticTextBefore.nodeValue).toBe('static-')
        expect(atomTextBefore.nodeValue).toBe('atomVal')

        const rootCommentBefore = Array.from(rootEl.childNodes).find(
            n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'root',
        ) as Comment
        expect(rootCommentBefore).toBeTruthy()

        const root = hydrateRoot(rootEl, createElement(App, null as any))

        expect(hasAxiiMarkers(rootEl)).toBe(false)
        const divAfter = rootEl.querySelector('#t')!
        expect(divAfter).toBe(divBefore)

        const children = Array.from(divAfter.childNodes)
        expect(children.length).toBe(2)
        expect(children[0]).toBe(staticTextBefore)
        expect(children[1]).toBe(atomTextBefore)
        expect(children[0].nodeType).toBe(Node.TEXT_NODE)
        expect(children[1].nodeType).toBe(Node.TEXT_NODE)

        // static half is element child, not a host-owned-only node that dies with atom
        text('UPDATED')
        expect(atomTextBefore.nodeValue).toBe('UPDATED')
        expect(staticTextBefore.nodeValue).toBe('static-')
        expect(staticTextBefore.parentNode).toBe(divAfter)
        expect(atomTextBefore.parentNode).toBe(divAfter)

        // root comment claimed
        const rootCommentAfter = Array.from(rootEl.childNodes).find(
            n => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'root',
        )
        expect(rootCommentAfter).toBe(rootCommentBefore)

        // CSR shape对照（含 root）
        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const csr = createRoot(csrEl)
        const text2 = atom('UPDATED')
        function App2({}, {createElement}: RenderContext) {
            return <div id="t">{'static-'}{text2}</div>
        }
        csr.render(<App2 />)
        expect(shapeOf(rootEl).map(s => s.replace(/atomVal|UPDATED/g, 'X'))).toEqual(
            shapeOf(csrEl).map(s => s.replace(/atomVal|UPDATED/g, 'X')),
        )

        // §3.2.1 Identity：AtomHost.destroy 只删 atom Text；ElementChildText 静态半侧仍在
        const atomHost = findHostByName((root as any).host, 'AtomHost')
        expect(atomHost).toBeTruthy()
        atomHost.destroy()
        expect(staticTextBefore.parentNode).toBe(divAfter)
        expect(staticTextBefore.nodeValue).toBe('static-')
        expect(atomTextBefore.parentNode).toBe(null)

        root.destroy()
        csr.destroy()
    })

    test('two adjacent atoms: claim identity, independent updates, no marker residue', () => {
        const a = atom('hello')
        const b = atom('world')
        function App({}, {createElement}: RenderContext) {
            return <div id="t">{a}{b}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t-->')
        rootEl.innerHTML = html
        const div = rootEl.querySelector('#t')!
        const textsBefore = Array.from(div.childNodes).filter(n => n.nodeType === Node.TEXT_NODE) as Text[]
        expect(textsBefore.map(t => t.nodeValue)).toEqual(['hello', 'world'])

        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(div.childNodes.length).toBe(2)
        expect(div.childNodes[0]).toBe(textsBefore[0])
        expect(div.childNodes[1]).toBe(textsBefore[1])

        a('HELLO')
        b('WORLD')
        expect(textsBefore[0].nodeValue).toBe('HELLO')
        expect(textsBefore[1].nodeValue).toBe('WORLD')
        expect(textsBefore[0].parentNode).toBe(div)
        expect(textsBefore[1].parentNode).toBe(div)
    })

    test('empty atom: axii:0 → insert Text, update, no residual markers', () => {
        const text = atom(null as any)
        function App({}, {createElement}: RenderContext) {
            return <div id="e">{text}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--axii:0-->')
        rootEl.innerHTML = html

        const div = rootEl.querySelector('#e')!
        expect(div.childNodes.length).toBe(1)
        expect((div.firstChild as Comment).data).toBe('axii:0')

        hydrateRoot(rootEl, createElement(App, null as any))
        expect(hasAxiiMarkers(rootEl)).toBe(false)
        expect(div.childNodes.length).toBe(1)
        const inserted = div.firstChild as Text
        expect(inserted.nodeType).toBe(Node.TEXT_NODE)
        expect(inserted.nodeValue).toBe('')

        text('hello')
        expect(inserted.nodeValue).toBe('hello')
        expect(div.firstChild).toBe(inserted)
    })

    test('EmptyHost null: claim <!--empty--><!--root-->', () => {
        const {html} = renderToString(null)
        expect(html).toBe('<!--empty--><!--root-->')
        rootEl.innerHTML = html

        const emptyBefore = rootEl.childNodes[0] as Comment
        const rootBefore = rootEl.childNodes[1] as Comment
        expect(emptyBefore.data).toBe('empty')
        expect(rootBefore.data).toBe('root')

        const root = hydrateRoot(rootEl, null)
        expect(rootEl.childNodes[0]).toBe(emptyBefore)
        expect(rootEl.childNodes[1]).toBe(rootBefore)
        expect(shapeOf(rootEl)).toEqual(['<!--empty-->', '<!--root-->'])

        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        createRoot(csrEl).render(null as any)
        expect(shapeOf(rootEl)).toEqual(shapeOf(csrEl))

        root.destroy()
    })

    test('Component → null EmptyHost', () => {
        function NullComp() {
            return null as any
        }
        const {html} = renderToString(createElement(NullComp, null as any))
        expect(html).toBe('<!--empty--><!--root-->')
        rootEl.innerHTML = html
        const emptyBefore = rootEl.childNodes[0]
        const rootBefore = rootEl.childNodes[1]
        hydrateRoot(rootEl, createElement(NullComp, null as any))
        expect(rootEl.childNodes[0]).toBe(emptyBefore)
        expect(rootEl.childNodes[1]).toBe(rootBefore)
    })
})
