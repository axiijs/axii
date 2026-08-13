/** @jsx createElement */
/**
 * Design adjudication d11: independently verify EmptyHost vs G3/FCS/A1c
 * (review-d11 claims). Writes docs/ssr-support/experiments/adjudication-d11-facts.json.
 */
import {
    createElement, createRoot, atom, RenderContext, RxList, Fragment
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

function parseShape(html: string): string[] {
    const d = document.createElement('div')
    d.innerHTML = html
    return shapeOf(d)
}

describe('adjudication d11 EmptyHost vs G3/FCS/A1c', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('CSR shapes: EmptyHost ≠ A1c ≠ FCS; component/Fragment rows lack computed', async () => {
        const facts: Record<string, unknown> = {
            stamp: 'adjudication-d11-2026-08-06',
            environment: 'Vitest browser mode + Playwright chromium (independent of review-d11)',
            sourceAuthority: [
                "src/createHost.ts EmptyHost (Comment('empty') as element)",
                "src/FunctionHost.ts null/boolean → text fast path",
                "src/RxListHost.ts createChildHost → createHost(item, Comment('rx list item'))",
                "src/ComponentHost.ts createHost(null, placeholder) → EmptyHost",
            ],
        }

        // root.render(null)
        {
            const root = createRoot(rootEl)
            root.render(null as any)
            facts.rootNull = { shape: shapeOf(rootEl), html: rootEl.innerHTML }
            expect(shapeOf(rootEl)).toEqual(['<!--empty-->', '<!--root-->'])
            root.destroy()
            rootEl.innerHTML = ''
        }

        // root.render(() => null) — FunctionHost text path
        {
            const root = createRoot(rootEl)
            root.render(() => null)
            facts.rootFnNull = { shape: shapeOf(rootEl), html: rootEl.innerHTML }
            expect(shapeOf(rootEl)[0]).toMatch(/^#text:/)
            expect(shapeOf(rootEl)).toContain('<!--root-->')
            expect(shapeOf(rootEl)).not.toContain('<!--empty-->')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Component → null
        {
            function NullComp() { return null as any }
            const root = createRoot(rootEl)
            root.render(<NullComp />)
            facts.componentNull = { shape: shapeOf(rootEl), html: rootEl.innerHTML }
            expect(shapeOf(rootEl)).toEqual(['<!--empty-->', '<!--root-->'])
            root.destroy()
            rootEl.innerHTML = ''
        }

        // RxList [null, null]
        {
            const list = new RxList<any>([null, null])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.listNull = { shape: shapeOf(t), html: t.innerHTML }
            expect(shapeOf(t)).toEqual([
                '<!--empty-->', '<!--rx list item-->',
                '<!--empty-->', '<!--rx list item-->',
                '<!--unhandledChild-->',
            ])
            expect(t.innerHTML).not.toContain('computed node')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // RxList [atom('')] — A1c Comment-ph empty text
        {
            const list = new RxList<any>([atom('')])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.listAtomEmpty = { shape: shapeOf(t), html: t.innerHTML }
            expect(shapeOf(t)[0]).toMatch(/^#text:/)
            expect(shapeOf(t)).toContain('<!--rx list item-->')
            expect(shapeOf(t)).not.toContain('<!--empty-->')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Component rows — no computed node
        {
            function Row() { return <span>x</span> }
            const list = new RxList([1, 2])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list.map(() => <Row />)}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            const s = shapeOf(t)
            facts.listComponentRows = {
                shape: s,
                html: t.innerHTML,
                hasComputedNode: s.includes('<!--computed node-->'),
            }
            expect(s.includes('<!--computed node-->')).toBe(false)
            expect(s.filter(x => x === 'SPAN').length).toBe(2)
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Fragment row — fragment start, no computed
        {
            const list = new RxList([1])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list.map(() => <Fragment><span>a</span><span>b</span></Fragment>)}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            const s = shapeOf(t)
            facts.listFragmentRow = {
                shape: s,
                html: t.innerHTML,
                hasComputedNode: s.includes('<!--computed node-->'),
            }
            expect(s[0]).toBe('<!--fragment start-->')
            expect(s.includes('<!--computed node-->')).toBe(false)
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Wrong SSR vs correct for null list
        {
            const csrHtml = '<!--empty--><!--rx list item--><!--empty--><!--rx list item--><!--unhandledChild-->'
            const wrongA1c = '<!--rx list item--><!--rx list item--><!--unhandledChild-->'
            const wrongFcs = '<!--computed node--><!--rx list item--><!--computed node--><!--rx list item--><!--unhandledChild-->'
            facts.wrongA1cForNullList = {
                ssrHtml: wrongA1c,
                equalCsr: JSON.stringify(parseShape(wrongA1c)) === JSON.stringify(parseShape(csrHtml)),
            }
            facts.correctEmptyForNullList = {
                ssrHtml: csrHtml,
                equalCsr: JSON.stringify(parseShape(csrHtml)) === JSON.stringify(parseShape(csrHtml)),
            }
            facts.wrongFcsForNullList = {
                ssrHtml: wrongFcs,
                equalCsr: JSON.stringify(parseShape(wrongFcs)) === JSON.stringify(parseShape(csrHtml)),
            }
            expect((facts.wrongA1cForNullList as any).equalCsr).toBe(false)
            expect((facts.correctEmptyForNullList as any).equalCsr).toBe(true)
            expect((facts.wrongFcsForNullList as any).equalCsr).toBe(false)
        }

        // Function returning element in list — IS FCS (has computed)
        {
            const list = new RxList([1])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list.map(() => () => <span>y</span>)}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            const s = shapeOf(t)
            facts.listFnStructureRow = {
                shape: s,
                html: t.innerHTML,
                hasComputedNode: s.includes('<!--computed node-->'),
            }
            expect(s.includes('<!--computed node-->')).toBe(true)
            expect(s).toContain('<!--rx list item-->')
            root.destroy()
            rootEl.innerHTML = ''
        }

        facts.claims = {
            listNullHasEmpty: true,
            listNullHasComputed: false,
            listNullEqualsAtomEmpty: false,
            rootNullIsEmptyThenRoot: true,
            rootFnNullIsTextNotEmptyHost: true,
            componentNullIsEmptyHost: true,
            emptyCommentIsEmptyHostElementNotOuterPlaceholder: true,
            a1cOnlyStructureMismatchesNullList: true,
            correctEmptyMatchesNullList: true,
            fcsComputedMismatchesNullList: true,
            componentRowsAreNotFcs: true,
            fragmentRowsHaveFragmentStartNotOnlyFcs: true,
            functionStructureRowIsFcs: true,
        }

        // Harvest marker for adjudication (browser has no node:fs)
        console.log('ADJUDICATION_D11_FACTS_BEGIN')
        console.log(JSON.stringify(facts, null, 2))
        console.log('ADJUDICATION_D11_FACTS_END')
        expect(facts.claims).toBeTruthy()
    })
})
