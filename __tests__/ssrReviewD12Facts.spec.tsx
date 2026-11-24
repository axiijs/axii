/** @jsx createElement */
/**
 * Design review d12: Chromium facts for option/select comment markers,
 * Fragment adjacent ElementChildText merge, and boolean-false vs null children.
 * Harvest: ADJUDICATION_D12 / REVIEW_D12 console JSON (browser has no node:fs).
 */
import {
    createElement, createRoot, atom, Fragment, RenderContext, RxList
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

function parseHtml(html: string): HTMLElement {
    const d = document.createElement('div')
    d.innerHTML = html
    return d
}

describe('review d12 option/fragment/false facts', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('collect Chromium facts', async () => {
        const facts: Record<string, unknown> = {
            stamp: 'review-d12-2026-08-06',
            environment: 'Vitest browser mode + Playwright chromium',
        }

        // Fragment adjacent static texts: CSR shape + HTML merge
        {
            const root = createRoot(rootEl)
            function App({}, {createElement, Fragment}: RenderContext) {
                return createElement(Fragment, null, 'hello', 'world')
            }
            root.render(<App />)
            const csrShape = shapeOf(rootEl)
            const html = rootEl.innerHTML
            const parsed = parseHtml(html)
            const parseTextCount = [...parsed.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length
            facts.fragmentAdjacentStatic = {
                csrShape,
                html,
                parseShape: shapeOf(parsed),
                csrTextCount: [...rootEl.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length,
                parseTextCount,
                textsMerged: parseTextCount === 1,
            }
            root.destroy()
            rootEl.innerHTML = ''
        }

        // A2 wrap under fragment start restores two Texts
        {
            const html = '<!--fragment start--><!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t--><!--root-->'
            const parsed = parseHtml(html)
            for (const c of [...parsed.childNodes]) {
                if (c.nodeType === Node.COMMENT_NODE) {
                    const d = (c as Comment).data
                    if (d === 'axii:t' || d === 'axii:/t') c.remove()
                }
            }
            facts.fragmentA2Strip = {
                afterStrip: shapeOf(parsed),
                twoTexts: [...parsed.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length === 2,
            }
        }

        // option + atom text child CSR; empty atom
        {
            const label = atom('hi')
            const root = createRoot(rootEl)
            root.render(() => (
                <select>
                    <option>{label}</option>
                </select>
            ))
            const opt = rootEl.querySelector('option')!
            facts.optionAtomCsr = {
                optionShape: shapeOf(opt),
                optionValue: (opt as HTMLOptionElement).value,
                selectHtml: rootEl.innerHTML,
            }
            label('')
            facts.optionAtomEmpty = {
                optionShape: shapeOf(opt),
                optionValue: (opt as HTMLOptionElement).value,
                selectHtml: rootEl.innerHTML,
                emptyTextSurvivesInDom: [...opt.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.nodeValue === ''),
                emptyTextInHtml: rootEl.innerHTML.includes('<!--') && !(opt as HTMLOptionElement).outerHTML.match(/>[^<]+</),
            }
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Parse option with axii markers / axii:0
        {
            const p1 = parseHtml('<select><option><!--axii:t-->hi<!--axii:/t--></option></select>')
            const opt1 = p1.querySelector('option')!
            facts.optionAxiiT = {
                optionShape: shapeOf(opt1),
                commentCount: [...opt1.childNodes].filter(n => n.nodeType === Node.COMMENT_NODE).length,
                textContent: opt1.textContent,
                value: (opt1 as HTMLOptionElement).value,
                commentsPreserved: [...opt1.childNodes].filter(n => n.nodeType === Node.COMMENT_NODE).length === 2,
            }
            const p2 = parseHtml('<select><option><!--axii:0--></option></select>')
            const opt2 = p2.querySelector('option')!
            facts.optionAxii0 = {
                optionShape: shapeOf(opt2),
                commentCount: [...opt2.childNodes].filter(n => n.nodeType === Node.COMMENT_NODE).length,
                textContent: opt2.textContent,
                value: (opt2 as HTMLOptionElement).value,
            }
            const sent = opt2.firstChild as Comment
            const t = document.createTextNode('')
            opt2.insertBefore(t, sent)
            sent.remove()
            facts.optionAxii0Hydrated = {
                optionShape: shapeOf(opt2),
                value: (opt2 as HTMLOptionElement).value,
            }
        }

        // select direct comments
        {
            const p = parseHtml('<select><!--rx list item--><option>x</option><!--unhandledChild--></select>')
            facts.selectDirectComments = {
                selectShape: shapeOf(p.firstChild!),
                html: p.innerHTML,
            }
        }

        // boolean false vs null as element children
        {
            const root = createRoot(rootEl)
            root.render(() => createElement('div', null, 'a', false as any, 'b'))
            const div = rootEl.firstChild as HTMLElement
            facts.falseSibling = {
                csrShape: shapeOf(div),
                html: div.innerHTML,
                parseShape: shapeOf(parseHtml(div.innerHTML)),
                hasUnhandledChild: div.innerHTML.includes('unhandledChild'),
            }
            root.destroy()
            rootEl.innerHTML = ''
            const root2 = createRoot(rootEl)
            root2.render(() => createElement('div', null, 'a', null as any, 'b'))
            const div2 = rootEl.firstChild as HTMLElement
            const parsed2 = parseHtml(div2.innerHTML)
            facts.nullSibling = {
                csrShape: shapeOf(div2),
                html: div2.innerHTML,
                parseShape: shapeOf(parsed2),
                csrTextCount: [...div2.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length,
                parseTextCount: [...parsed2.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length,
                textsMergedOnParse: [...parsed2.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).length === 1,
            }
            root2.destroy()
            rootEl.innerHTML = ''
        }

        // Function → null as RxList item (not EmptyHost)
        {
            const list = new RxList([() => null])
            const root = createRoot(rootEl)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App />)
            const t = rootEl.querySelector('#t')!
            facts.fnNullListRow = {
                shape: shapeOf(t),
                html: t.innerHTML,
                hasEmpty: t.innerHTML.includes('empty'),
                hasComputed: t.innerHTML.includes('computed'),
            }
            root.destroy()
        }

        // title RCDATA: axii markers become character data
        {
            const p = parseHtml('<div><title><!--axii:0--></title></div>')
            const title = p.querySelector('title')!
            facts.titleAxii0 = {
                childShape: shapeOf(title),
                textContent: title.textContent,
                commentCount: [...title.childNodes].filter(n => n.nodeType === Node.COMMENT_NODE).length,
            }
        }

        console.log('REVIEW_D12_FACTS_BEGIN')
        console.log(JSON.stringify(facts, null, 2))
        console.log('REVIEW_D12_FACTS_END')

        expect((facts.fragmentAdjacentStatic as any).textsMerged).toBe(true)
        expect((facts.fragmentA2Strip as any).twoTexts).toBe(true)
        expect((facts.fnNullListRow as any).hasEmpty).toBe(false)
        expect((facts.nullSibling as any).textsMergedOnParse).toBe(true)
        expect((facts.falseSibling as any).hasUnhandledChild).toBe(true)
    })
})
