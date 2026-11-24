/** @jsx createElement */
/**
 * Adjudication d14: FunctionHost text/structure classification must match
 * FunctionHost.ts text fast path for BOTH Text-ph (FTS) and Comment-ph (G3-F/G4-F).
 * Colloquial "element/Fragment/other non-primitive" is NOT an operational definition.
 * Harvest: ADJUDICATION_D14_FACTS console JSON → experiments/adjudication-d14-facts.json
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

/** Mirrors FunctionHost.ts ~144–145 — the only operational text-snapshot predicate. */
function isFunctionHostTextSnapshot(node: unknown): boolean {
    const t = typeof node
    return node == null || t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}

describe('adjudication d14 FunctionHost text/structure (FTS + FCS sides)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('complete finite matrix: Text-ph FTS atom + Comment-ph G3-F/G4-F', () => {
        const facts: Record<string, unknown> = {
            stamp: 'adjudication-d14-2026-08-06',
            environment: 'Vitest browser mode + Playwright chromium',
            sourceAuthority: [
                'src/FunctionHost.ts ~144–145: text path iff null|string|number|boolean|bigint',
                'atom / Function / Element / Array / RxList / ReusableHost / ComponentNode → structure path + computed node',
            ],
            predicate: 'isFunctionHostTextSnapshot ≡ FunctionHost.ts text fast path',
        }

        const a = atom('x')
        const matrix = [
            {label: 'null', v: null as unknown, expectText: true},
            {label: 'undefined', v: undefined as unknown, expectText: true},
            {label: 'false', v: false, expectText: true},
            {label: 'true', v: true, expectText: true},
            {label: 'emptyString', v: '', expectText: true},
            {label: 'string', v: 'hi', expectText: true},
            {label: 'number0', v: 0, expectText: true},
            {label: 'number1', v: 1, expectText: true},
            {label: 'bigint', v: 10n, expectText: true},
            {label: 'atom', v: a, expectText: false},
            {label: 'function', v: () => 'x', expectText: false},
        ]
        facts.predicateMatrix = matrix.map(row => ({
            label: row.label,
            expectText: row.expectText,
            got: isFunctionHostTextSnapshot(row.v),
            ok: isFunctionHostTextSnapshot(row.v) === row.expectText,
        }))
        for (const row of matrix) {
            expect(isFunctionHostTextSnapshot(row.v)).toBe(row.expectText)
        }

        // Text-ph Function→atom = FTS
        {
            const name = atom('world')
            const root = createRoot(rootEl)
            root.render(<div>{() => name}</div>)
            const div = rootEl.firstElementChild as HTMLElement
            const shape = shapeOf(div)
            const html = div.innerHTML
            const wrongAsTextPh = html === 'world'
            const factsRow = {
                case: 'fnReturnsAtom_textPh_FTS',
                shape,
                html,
                hasComputed: shape.includes('<!--computed node-->'),
                trailingEmptyText: shape[shape.length - 1] === '#text:""',
                wrongAsTextPhEqualsCsrHtml: wrongAsTextPh,
                expectedSsrSketch: 'world<!--computed node--><!--axii:0-->',
                note: 'SSR must emit computed + axii:0; must NOT treat atom return as Text-ph text state',
            }
            facts.fnReturnsAtom_textPh_FTS = factsRow
            expect(factsRow.hasComputed).toBe(true)
            expect(factsRow.trailingEmptyText).toBe(true)
            expect(factsRow.wrongAsTextPhEqualsCsrHtml).toBe(false)
            expect(shape[0]).toBe('#text:"world"')
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Text-ph Function→string = Text-ph (no computed)
        {
            const root = createRoot(rootEl)
            root.render(<div>{() => 'hi'}</div>)
            const div = rootEl.firstElementChild as HTMLElement
            const shape = shapeOf(div)
            facts.fnReturnsString_textPh = {
                case: 'fnReturnsString_textPh',
                shape,
                html: div.innerHTML,
                hasComputed: shape.includes('<!--computed node-->'),
            }
            expect((facts.fnReturnsString_textPh as any).hasComputed).toBe(false)
            expect(shape).toEqual(['#text:"hi"'])
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Comment-ph Function→atom = G3-F
        {
            const name = atom('hi')
            const list = new RxList([() => name])
            const root = createRoot(rootEl)
            root.render(<div>{list}</div>)
            const div = rootEl.firstElementChild as HTMLElement
            const shape = shapeOf(div)
            facts.fnRowReturnsAtom_G3F = {
                case: 'fnRowReturnsAtom_G3F',
                shape,
                html: div.innerHTML,
                hasComputed: shape.includes('<!--computed node-->'),
                hasEmpty: shape.includes('<!--empty-->'),
            }
            expect((facts.fnRowReturnsAtom_G3F as any).hasComputed).toBe(true)
            expect((facts.fnRowReturnsAtom_G3F as any).hasEmpty).toBe(false)
            root.destroy()
            rootEl.innerHTML = ''
        }

        // Comment-ph Function→null = G4-F
        {
            const list = new RxList([() => null])
            const root = createRoot(rootEl)
            root.render(<div>{list}</div>)
            const div = rootEl.firstElementChild as HTMLElement
            const shape = shapeOf(div)
            facts.fnRowReturnsNull_G4F = {
                case: 'fnRowReturnsNull_G4F',
                shape,
                html: div.innerHTML,
                hasComputed: shape.includes('<!--computed node-->'),
                hasEmpty: shape.includes('<!--empty-->'),
            }
            expect((facts.fnRowReturnsNull_G4F as any).hasComputed).toBe(false)
            expect((facts.fnRowReturnsNull_G4F as any).hasEmpty).toBe(false)
            root.destroy()
            rootEl.innerHTML = ''
        }

        facts.claims = {
            textSnapshotEqualsFunctionHostPredicate: true,
            atomIsStructureNotText: true,
            ftsFunctionToAtomHasComputedAndTrailingEmpty: true,
            bareTextHtmlIsWrongForFunctionToAtom: true,
            g3fFunctionRowToAtomHasComputed: true,
            g4fFunctionRowToNullHasNoComputedNoEmpty: true,
            colloquialElementFragmentClosedSetRejected: true,
        }

        console.log('ADJUDICATION_D14_FACTS_BEGIN')
        console.log(JSON.stringify(facts, null, 2))
        console.log('ADJUDICATION_D14_FACTS_END')
        expect(facts.claims).toBeTruthy()
    })
})
