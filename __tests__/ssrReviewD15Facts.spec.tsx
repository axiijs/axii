/** @jsx createElement */
/**
 * Independent design-review facts for design-round 14 (additional task 1).
 * Harvest: REVIEW_D15_* console JSON → docs/ssr-support/experiments/review-d15-facts.json
 */
import { createElement, createRoot, Fragment, atom, RxList } from "@framework";
import { beforeEach, describe, expect, test } from "vitest";

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

describe('review d15 facts (design round 14)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('createElement boolean → Comment-ph PrimitiveHost; FTS Reusable/Component; CB; nested FTS; Fragment A2; empty atom', () => {
        const facts: Record<string, unknown> = {
            stamp: 'review-d15-2026-08-06',
            environment: 'Vitest browser + Playwright chromium',
        }

        {
            const root = createRoot(rootEl)
            root.render(createElement('div', null, 'a', false, 'b'))
            const div = rootEl.firstElementChild as HTMLElement
            facts.booleanSiblingAmongText = { shape: shapeOf(div), html: div.innerHTML }
            expect(div.innerHTML).toBe('a<!--unhandledChild-->b')
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, false))
            const div = rootEl.firstElementChild as HTMLElement
            facts.singleFalseChild = { shape: shapeOf(div), html: div.innerHTML }
            expect(div.innerHTML).toBe('<!--unhandledChild-->')
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            function App({}: any, { createElement: h, reusable }: any) {
                return h('div', null, () => reusable(h('span', null, 'R')))
            }
            const root = createRoot(rootEl)
            root.render(createElement(App as any, null))
            const div = rootEl.querySelector('div') as HTMLElement
            facts.fnReturnsReusable_textPh = { shape: shapeOf(div), html: div.innerHTML }
            expect(shapeOf(div).includes('<!--computed node-->')).toBe(true)
            expect(shapeOf(div).includes('<!--reusable-->')).toBe(true)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            function Inner() { return createElement('span', null, 'I') }
            const root = createRoot(rootEl)
            root.render(createElement('div', null, () => createElement(Inner as any, null)))
            const div = rootEl.firstElementChild as HTMLElement
            facts.fnReturnsComponent_textPh = { shape: shapeOf(div), html: div.innerHTML }
            expect(shapeOf(div).includes('<!--computed node-->')).toBe(true)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('input', { type: 'checkbox', value: true }))
            const input = rootEl.firstElementChild as HTMLInputElement
            facts.checkboxValueTrue = {
                outer: input.outerHTML,
                value: input.value,
                checked: input.checked,
            }
            expect(input.value).toBe('true')
            expect(input.checked).toBe(true)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, [false, 'x']))
            const div = rootEl.firstElementChild as HTMLElement
            facts.arrayBooleanAndString = { shape: shapeOf(div), html: div.innerHTML }
            expect(div.innerHTML).toContain('<!--array item-->')
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, () => () => atom('z')))
            const div = rootEl.firstElementChild as HTMLElement
            const shape = shapeOf(div)
            facts.nestedFnToAtom_textPh = { shape, html: div.innerHTML }
            expect(shape.filter(s => s === '<!--computed node-->').length).toBeGreaterThanOrEqual(2)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, new RxList([false as any, true as any])))
            const div = rootEl.firstElementChild as HTMLElement
            facts.rxListBooleanPrimitive = {
                shape: shapeOf(div),
                html: div.innerHTML,
                hasEmpty: shapeOf(div).includes('<!--empty-->'),
            }
            expect(facts.rxListBooleanPrimitive.hasEmpty).toBe(false)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, () => createElement(Fragment, null, 'hello', 'world')))
            const div = rootEl.firstElementChild as HTMLElement
            facts.fnFragmentAdjacentText = { shape: shapeOf(div), html: div.innerHTML }
            expect(div.innerHTML).toContain('helloworld')
            expect(shapeOf(div).includes('<!--fragment start-->')).toBe(true)
            root.destroy()
        }

        {
            rootEl.innerHTML = ''
            const root = createRoot(rootEl)
            root.render(createElement('div', null, atom('')))
            const div = rootEl.firstElementChild as HTMLElement
            const textPh = { shape: shapeOf(div), html: div.innerHTML }
            root.destroy()
            rootEl.innerHTML = ''
            const root2 = createRoot(rootEl)
            root2.render(createElement('div', null, new RxList([atom('')])))
            const div2 = rootEl.firstElementChild as HTMLElement
            const commentPh = { shape: shapeOf(div2), html: div2.innerHTML }
            root2.destroy()
            facts.atomEmptyTextPhVsCommentPh = { textPh, commentPh }
            expect(textPh.html).toBe('')
            expect(commentPh.html).toBe('<!--rx list item--><!--unhandledChild-->')
        }

        console.log('REVIEW_D15_FACTS', JSON.stringify(facts))
        console.log('REVIEW_D15_FACTS_END')
    })
})
