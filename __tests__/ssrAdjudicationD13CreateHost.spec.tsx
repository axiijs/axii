/** @jsx createElement */
/**
 * Adjudication d13: createHost-aligned RxList row exhaustiveness —
 * nested RxList, ReusableHost as row, wrong G3-F/G4 overlays.
 * Harvest: ADJUDICATION_D13 console JSON → experiments/adjudication-d13-facts.json
 */
import {
    createElement, createRoot, atom, RxList, RenderContext
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

describe('adjudication d13 createHost-aligned G table', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('nested RxList as row: inner Comment-ph + outer rx list item; no computed/empty', () => {
        const inner = new RxList([1, 2])
        const outer = new RxList([inner])
        const root = createRoot(rootEl)
        root.render(<div>{outer}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const html = div.innerHTML
        const wrongG3F = `1<!--computed node--><!--rx list item-->2<!--computed node--><!--rx list item--><!--rx list item--><!--unhandledChild-->`
        const wrongG4OnlyOuter = `12<!--rx list item--><!--unhandledChild-->`
        const facts = {
            case: 'nestedRxListRow',
            shape,
            html,
            hasComputed: shape.some(s => s === '<!--computed node-->'),
            hasEmpty: shape.some(s => s === '<!--empty-->'),
            rxListItemCount: shape.filter(s => s === '<!--rx list item-->').length,
            equalCsrHtml: html === '1<!--rx list item-->2<!--rx list item--><!--rx list item--><!--unhandledChild-->',
            wrongG3FEqualsCsr: html === wrongG3F,
            wrongG4FlattenEqualsCsr: html === wrongG4OnlyOuter,
        }
        console.log('ADJUDICATION_D13_NESTED_RXLIST', JSON.stringify(facts))
        expect(facts.equalCsrHtml).toBe(true)
        expect(facts.hasComputed).toBe(false)
        expect(facts.hasEmpty).toBe(false)
        expect(facts.rxListItemCount).toBe(3)
        expect(facts.wrongG3FEqualsCsr).toBe(false)
        expect(facts.wrongG4FlattenEqualsCsr).toBe(false)

        // reorder outer (only one row) — splice inner to prove nested host interval
        inner.splice(0, 1)
        const after = shapeOf(div)
        console.log('ADJUDICATION_D13_NESTED_AFTER_SPLICE', JSON.stringify({shape: after, html: div.innerHTML}))
        expect(div.innerHTML).toBe('2<!--rx list item--><!--rx list item--><!--unhandledChild-->')
        root.destroy()
    })

    test('ReusableHost as RxList row: content + reusable + rx list item', async () => {
        const list = new RxList<any>([])
        function App({}: any, {createElement, reusable}: RenderContext) {
            const reused = reusable(<div id="reused">R</div>)
            list.push(reused)
            return <div id="container">{list}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        await new Promise(r => setTimeout(r, 10))
        const container = rootEl.querySelector('#container') as HTMLElement
        const shape = shapeOf(container)
        const html = container.innerHTML
        const facts = {
            case: 'reusableHostAsRxListRow',
            shape,
            html,
            hasReusable: shape.some(s => s === '<!--reusable-->'),
            hasRxListItem: shape.some(s => s === '<!--rx list item-->'),
            hasComputed: shape.some(s => s === '<!--computed node-->'),
            hasEmpty: shape.some(s => s === '<!--empty-->'),
            text: container.textContent,
        }
        console.log('ADJUDICATION_D13_REUSABLE_ROW', JSON.stringify(facts))
        expect(facts.hasReusable).toBe(true)
        expect(facts.hasRxListItem).toBe(true)
        expect(facts.hasComputed).toBe(false)
        expect(facts.text).toBe('R')
        root.destroy()
    })

    test('createHost branch closure checklist vs G rows', () => {
        // Documented mapping for design rewrite — not a DOM assertion
        const createHostBranches = [
            'function→AtomHost',
            'function→FunctionHost',
            'HTMLElement|SVGElement|DocumentFragment→StaticHost',
            'string|number|boolean|bigint→PrimitiveHost',
            'Array→StaticArrayHost',
            'null|undefined→EmptyHost',
            'RxList→RxListHost',
            'ReusableHost→moveTo/reuse',
            'ComponentNode→ComponentHost',
            'else→assert unknown',
        ]
        const compactBypass = 'Element && !detachStyledChildren → CompactElementHost (createChildHost only)'
        const facts = {
            case: 'branchClosure',
            createHostBranches,
            compactBypass,
            requiredNewGRows: ['G3-RL: item instanceof RxList', 'G3-RU: item instanceof ReusableHost'],
            note: 'G1/G2 stay createChildHost Compact gate; remaining must 1:1 createHost after Compact miss',
        }
        console.log('ADJUDICATION_D13_BRANCHES', JSON.stringify(facts))
        expect(createHostBranches.length).toBe(10)
    })
})
