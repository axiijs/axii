/** @jsx createElement */
/**
 * Design adjudication d12: independently verify Function text-state RxList rows
 * (G4-F / Comment-ph) ≠ G3-F/FCS ≠ G3-E EmptyHost (review-d12 P1).
 * Harvest: ADJUDICATION_D12 console JSON → docs/ssr-support/experiments/adjudication-d12-facts.json
 */
import {
    createElement, createRoot, atom, RenderContext, RxList
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

describe('adjudication d12 Function text-state RxList row (G4-F)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('CSR: Function→null/false/string rows are Comment-ph; wrong G3-E/FCS HTML unequal', async () => {
        const facts: Record<string, unknown> = {
            stamp: 'adjudication-d12-2026-08-06',
            environment: 'Vitest browser mode + Playwright chromium (independent of review-d12)',
            sourceAuthority: [
                "src/RxListHost.ts createChildHost → createHost(item, Comment('rx list item')) for non-Compact",
                "src/createHost.ts function (non-atom) → FunctionHost",
                "src/FunctionHost.ts null/boolean/string/number/bigint → text fast path (no EmptyHost, no computed node)",
            ],
        }

        // G4-F: Function → null
        {
            const list = new RxList([() => null])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            const shape = shapeOf(t)
            const html = t.innerHTML
            facts.fnNullListRow = {
                shape,
                html,
                hasEmpty: html.includes('empty'),
                hasComputed: html.includes('computed'),
                parseShape: parseShape(html),
                note: 'Function→null is Comment-ph A1c (empty Text lost in HTML), NOT EmptyHost, NOT FCS',
            }
            expect(shape[0]).toMatch(/^#text:/)
            expect(shape).toContain('<!--rx list item-->')
            expect(shape).not.toContain('<!--empty-->')
            expect(shape).not.toContain('<!--computed node-->')
            expect(html).toBe('<!--rx list item--><!--unhandledChild-->')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // G4-F: Function → false (boolean → '')
        {
            const list = new RxList([() => false as any])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.fnFalseListRow = {
                shape: shapeOf(t),
                html: t.innerHTML,
                hasEmpty: t.innerHTML.includes('empty'),
                hasComputed: t.innerHTML.includes('computed'),
            }
            expect(shapeOf(t)[0]).toMatch(/^#text:/)
            expect(t.innerHTML).not.toContain('empty')
            expect(t.innerHTML).not.toContain('computed')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // G4-F: Function → non-empty string
        {
            const list = new RxList([() => 'hi'])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.fnStringListRow = {
                shape: shapeOf(t),
                html: t.innerHTML,
                hasComputed: t.innerHTML.includes('computed'),
            }
            expect(shapeOf(t)).toEqual(['#text:"hi"', '<!--rx list item-->', '<!--unhandledChild-->'])
            expect(t.innerHTML).not.toContain('computed')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Contrast: G3-E item===null
        {
            const list = new RxList<any>([null])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.g3eNullItem = {
                shape: shapeOf(t),
                html: t.innerHTML,
            }
            expect(shapeOf(t)).toEqual([
                '<!--empty-->', '<!--rx list item-->', '<!--unhandledChild-->',
            ])
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Contrast: G4 atom('')
        {
            const list = new RxList([atom('')])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.g4AtomEmpty = {
                shape: shapeOf(t),
                html: t.innerHTML,
            }
            expect(t.innerHTML).toBe('<!--rx list item--><!--unhandledChild-->')
            expect(t.innerHTML).not.toContain('empty')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Contrast: G3-F Function → element
        {
            const list = new RxList([() => <span>x</span>])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.g3fFnElement = {
                shape: shapeOf(t),
                html: t.innerHTML,
                hasComputed: t.innerHTML.includes('computed node'),
            }
            expect(shapeOf(t)).toContain('<!--computed node-->')
            expect(shapeOf(t)).toContain('<!--rx list item-->')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Wrong SSR HTML: treat Function→null as G3-E
        {
            const wrongEmpty = '<!--empty--><!--rx list item--><!--unhandledChild-->'
            const csrHtml = '<!--rx list item--><!--unhandledChild-->'
            facts.wrongG3eForFnNull = {
                wrongHtml: wrongEmpty,
                csrHtml,
                equalCsr: wrongEmpty === csrHtml,
                parseWrong: parseShape(wrongEmpty),
                parseCsr: parseShape(csrHtml),
            }
            expect(facts.wrongG3eForFnNull).toMatchObject({ equalCsr: false })
        }

        // Wrong SSR HTML: treat Function→null as FCS
        {
            const wrongFcs = '<!--computed node--><!--rx list item--><!--unhandledChild-->'
            const csrHtml = '<!--rx list item--><!--unhandledChild-->'
            facts.wrongFcsForFnNull = {
                wrongHtml: wrongFcs,
                csrHtml,
                equalCsr: wrongFcs === csrHtml,
                parseWrong: parseShape(wrongFcs),
                parseCsr: parseShape(csrHtml),
            }
            expect(facts.wrongFcsForFnNull).toMatchObject({ equalCsr: false })
        }

        // A1c SSR for Function→null matches CSR HTML (empty Text omitted)
        {
            const a1c = '<!--rx list item--><!--unhandledChild-->'
            facts.a1cMatchesCsrHtml = {
                a1cHtml: a1c,
                equalCsrHtml: a1c === '<!--rx list item--><!--unhandledChild-->',
                parseShape: parseShape(a1c),
            }
            expect((facts.a1cMatchesCsrHtml as any).equalCsrHtml).toBe(true)
        }

        console.log('ADJUDICATION_D12_FACTS_BEGIN')
        console.log(JSON.stringify(facts, null, 2))
        console.log('ADJUDICATION_D12_FACTS_END')
    })
})
