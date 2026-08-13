/** @jsx createElement */
/**
 * Design review d13: probe Function→atom / nested-RxList / nested-Function
 * RxList row shapes against design §3.2.3 G-table exhaustiveness claims.
 * Harvest: REVIEW_D13 console JSON.
 */
import {
    createElement, createRoot, atom, RxList
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

function shapeOf(el: Node): string[] {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        return (n as Element).tagName
    })
}

function deepShape(el: Node, depth = 0): any {
    return Array.from(el.childNodes).map(n => {
        if (n.nodeType === Node.COMMENT_NODE) return `<!--${(n as Comment).data}-->`
        if (n.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(n.nodeValue)}`
        const e = n as Element
        return {
            tag: e.tagName,
            children: depth < 3 ? deepShape(e, depth + 1) : '…'
        }
    })
}

describe('review d13 G-table / FunctionHost structure gaps', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('Function child returns atom → structure path with computed node (FTS)', () => {
        const name = atom('world')
        const root = createRoot(rootEl)
        root.render(<div>{() => name}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const html = div.innerHTML
        const facts = {
            case: 'fnReturnsAtom_textPh',
            shape,
            html,
            hasComputed: shape.some(s => s === '<!--computed node-->'),
            hasEmpty: shape.some(s => s === '<!--empty-->'),
            textNodes: shape.filter(s => s.startsWith('#text:')),
            note: 'Function→atom is NOT text fast path; creates AtomHost under computed node'
        }
        console.log('REVIEW_D13_FN_ATOM', JSON.stringify(facts))
        expect(facts.hasComputed).toBe(true)
        expect(div.textContent).toBe('world')
        // Steady: Text(value), computed, Text('') placeholder
        expect(shape[0]).toBe('#text:"world"')
        expect(shape).toContain('<!--computed node-->')
        const last = shape[shape.length - 1]
        expect(last).toBe('#text:""')
    })

    test('Function child returns nested Function → structure with computed', () => {
        const name = atom('x')
        const root = createRoot(rootEl)
        root.render(<div>{() => () => <span>{name()}</span>}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const facts = {
            case: 'fnReturnsFn_element',
            shape,
            html: div.innerHTML,
            hasComputed: shape.filter(s => s === '<!--computed node-->').length,
            deep: deepShape(div)
        }
        console.log('REVIEW_D13_FN_FN', JSON.stringify(facts))
        expect(facts.hasComputed).toBeGreaterThanOrEqual(1)
        expect(div.textContent).toBe('x')
    })

    test('RxList row item is nested RxList', () => {
        const inner = new RxList([1, 2])
        const outer = new RxList([inner])
        const root = createRoot(rootEl)
        // item itself is RxList → createChildHost → createHost(RxList, rx list item)
        root.render(<div>{outer}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const html = div.innerHTML
        const facts = {
            case: 'rxListItemIsRxList',
            shape,
            html,
            hasComputed: shape.some(s => s === '<!--computed node-->'),
            hasEmpty: shape.some(s => s === '<!--empty-->'),
            rxListItemCount: shape.filter(s => s === '<!--rx list item-->').length,
            note: 'createHost(RxList) as row — not in G1–G4-F/G4 table explicitly'
        }
        console.log('REVIEW_D13_NESTED_RXLIST', JSON.stringify(facts))
        // Nested list of numbers → Compact rows for 1,2? Numbers are primitives → Comment-ph each
        // outer row placeholder is rx list item wrapping whole inner RxListHost
        expect(shape.filter(s => s === '<!--rx list item-->').length).toBeGreaterThanOrEqual(1)
    })

    test('RxList Function row returns atom → G3-F-like FCS not G4-F', () => {
        const a = atom('hi')
        const list = new RxList([() => a])
        const root = createRoot(rootEl)
        root.render(<div>{list}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const html = div.innerHTML
        const facts = {
            case: 'fnRowReturnsAtom',
            shape,
            html,
            hasComputed: shape.some(s => s === '<!--computed node-->'),
            hasEmpty: shape.some(s => s === '<!--empty-->'),
            equalG4F: html === '<!--rx list item--><!--unhandledChild-->' || html === 'hi<!--rx list item--><!--unhandledChild-->',
            note: 'Function→atom must NOT be classified G4-F text state'
        }
        console.log('REVIEW_D13_FN_ROW_ATOM', JSON.stringify(facts))
        expect(facts.hasComputed).toBe(true)
        expect(facts.hasEmpty).toBe(false)
        // Should look like FCS: text, computed, rx list item (not bare G4-F)
        expect(shape).toContain('<!--computed node-->')
        expect(shape).toContain('<!--rx list item-->')
    })

    test('RxList Function row returns nested Function→element', () => {
        const list = new RxList([() => () => <span>z</span>])
        const root = createRoot(rootEl)
        root.render(<div>{list}</div>)
        const div = rootEl.firstElementChild as HTMLElement
        const shape = shapeOf(div)
        const facts = {
            case: 'fnRowReturnsFnElement',
            shape,
            html: div.innerHTML,
            computedCount: shape.filter(s => s === '<!--computed node-->').length
        }
        console.log('REVIEW_D13_FN_ROW_FN', JSON.stringify(facts))
        expect(facts.computedCount).toBeGreaterThanOrEqual(1)
    })
})
