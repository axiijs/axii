/** @jsx createElement */
/**
 * Claim-API and cursor corners beyond the milestone specs: malformed axii:t pairs,
 * bare (unwrapped) text units, cursor interstitial/drift/defer paths, EmptyHost
 * fallback scan, trailing-cleanup guards, and Fragment reconcile walk branches.
 * Run: npx vitest run __tests__/ssrHydrate.claimCorners.spec.tsx
 */
import {
    createElement,
    hydrateRoot,
    configureDiagnostics,
    RenderContext,
} from '@framework'
import {atom, RxList} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {
    HydrationMismatchError,
    advanceCursorUntilComment,
    beginHydration,
    claimAtomTextPlaceholder,
    claimCommentAtCursor,
    claimComputedNodeBefore,
    claimElement,
    claimEmptyHostComment,
    claimEmptyHostCommentBefore,
    claimFragmentStartBefore,
    claimTextBeforeCommentPlaceholder,
    claimTextUnit,
    createElementForHydrateMismatch,
    endHydration,
    enterElementChildCursor,
    exitElementChildCursor,
    findRootComment,
    reconcileFlattenedFragmentHydrateChildren,
    reconcileFragmentHydrateChildren,
    stripAxiiTextBoundariesBetween,
    tryClaimElement,
} from '../src/hydration.js'

function captureMismatches(): unknown[] {
    const errors: unknown[] = []
    configureDiagnostics({enabled: true, onError: (e) => { errors.push(e) }})
    return errors
}

function cursorFixture(innerHtml: string): HTMLElement {
    const div = document.createElement('div')
    div.innerHTML = innerHtml
    beginHydration(div)
    enterElementChildCursor(div)
    return div
}

function rootFixture(innerHtml: string): HTMLElement {
    const div = document.createElement('div')
    div.innerHTML = innerHtml
    beginHydration(div)
    return div
}

function shapeOf(parent: Node): string[] {
    return Array.from(parent.childNodes).map(n => {
        if (n.nodeType === Node.TEXT_NODE) return `Text(${(n as Text).nodeValue})`
        if (n.nodeType === Node.COMMENT_NODE) return `Comment(${(n as Comment).data})`
        return `Element(<${(n as Element).tagName.toLowerCase()}>)`
    })
}

afterEach(() => {
    endHydration()
    configureDiagnostics({})
    document.body.innerHTML = ''
})

describe('claimTextUnit / claimEmptyTextPh corners', () => {
    test('eof without expected throws (observable mismatch)', () => {
        const div = cursorFixture('')
        expect(() => claimTextUnit()).toThrow('expected text unit')
    })

    test('axii:t open without a Text node rebuilds and clears the whole pair', () => {
        const div = cursorFixture('<!--axii:t--><span></span>')
        const errors = captureMismatches()
        const text = claimTextUnit()
        expect(text.nodeValue).toBe('')
        expect(shapeOf(div)).toEqual(['Text()'])
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('axii:t pair missing close marker rebuilds from the open marker', () => {
        const div = cursorFixture('<!--axii:t-->hi<div></div>')
        const errors = captureMismatches()
        const text = claimTextUnit()
        expect(text.nodeValue).toBe('hi')
        expect(shapeOf(div)).toEqual(['Text(hi)'])
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('expected text vs axii:0 sentinel rebuilds (sentinel removed, fresh Text)', () => {
        const div = cursorFixture('<!--axii:0-->')
        const errors = captureMismatches()
        const text = claimTextUnit('v')
        expect(text.nodeValue).toBe('v')
        expect(shapeOf(div)).toEqual(['Text(v)'])
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('expected text vs Element rebuilds (element removed, fresh Text)', () => {
        const div = cursorFixture('<span></span>')
        const errors = captureMismatches()
        const text = claimTextUnit('v')
        expect(text.nodeValue).toBe('v')
        expect(shapeOf(div)).toEqual(['Text(v)'])
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('expected text vs ProcessingInstruction reports a nodeType summary', () => {
        const div = document.createElement('div')
        div.appendChild(document.createProcessingInstruction('xml-stylesheet', 'href="x"'))
        const errors = captureMismatches()
        beginHydration(div)
        enterElementChildCursor(div)
        const text = claimTextUnit('v')
        expect(text.nodeValue).toBe('v')
        const mismatch = errors.find(e => e instanceof HydrationMismatchError) as HydrationMismatchError
        expect(mismatch.actual).toBe('nodeType=7')
    })

    test('unexpected Comment without expected throws', () => {
        const div = cursorFixture('<!--x-->')
        expect(() => claimTextUnit()).toThrow('expected Text or axii:t unit')
    })

    test('bare (unwrapped) non-empty Text is claimed with identity kept (§3.2.1 A2 omission form)', () => {
        const div = cursorFixture('x')
        const claimed = claimAtomTextPlaceholder('x')
        expect(claimed).toBe(div.firstChild)
        expect(claimed.nodeValue).toBe('x')
    })
})

describe('cursor comment claiming corners', () => {
    test('advanceCursorUntilComment throws when the target comment is not ahead', () => {
        const div = cursorFixture('<!--a-->')
        expect(() => advanceCursorUntilComment('b')).toThrow('not found from cursor')
    })

    test('claimCommentAtCursor throws on wrong comment data', () => {
        const div = cursorFixture('<!--a-->')
        expect(() => claimCommentAtCursor('b')).toThrow('expected <!--b-->')
    })

    test('claimComputedNodeBefore throws without a preceding computed comment', () => {
        const div = cursorFixture('<!--root-->')
        expect(() => claimComputedNodeBefore(div.firstChild as Comment)).toThrow('expected <!--computed node-->')
    })

    test('claimFragmentStartBefore skips a computed node and walks back past content', () => {
        const div = rootFixture('<!--fragment start--><b></b>T<!--computed node--><!--root-->')
        const found = claimFragmentStartBefore(div.lastChild as Comment)
        expect(found).toBe(div.firstChild)
    })

    test('claimFragmentStartBefore throws when no fragment start exists to the left', () => {
        const div = rootFixture('T<!--root-->')
        expect(() => claimFragmentStartBefore(div.lastChild as Comment)).toThrow('expected <!--fragment start-->')
    })

    test('claimEmptyHostCommentBefore throws when empty comment is missing', () => {
        const div = rootFixture('<!--junk--><!--root-->')
        expect(() => claimEmptyHostCommentBefore(div.lastChild as Comment)).toThrow('expected <!--empty-->')
    })

    test('claimEmptyHostComment scans the root: before-root and mid-container forms', () => {
        const a = rootFixture('<!--empty--><!--root-->')
        expect(claimEmptyHostComment()).toBe(a.firstChild)

        const b = rootFixture('<!--junk--><!--empty--><!--other--><!--root-->')
        expect(claimEmptyHostComment()).toBe(b.childNodes[1])

        const c = rootFixture('<!--root-->')
        expect(() => claimEmptyHostComment()).toThrow('expected <!--empty-->')
    })
})

describe('claimTextBeforeCommentPlaceholder corners (Comment-ph)', () => {
    test('malformed axii:t pair before placeholder throws', () => {
        const div = rootFixture('<!--axii:/t--><!--root-->')
        expect(() => claimTextBeforeCommentPlaceholder(div.lastChild as Comment))
            .toThrow('malformed axii:t pair')
    })

    test('non-empty expected with no preceding text reports mismatch and inserts fresh Text', () => {
        const div = rootFixture('<!--root-->')
        const errors = captureMismatches()
        const ph = div.firstChild as Comment
        const text = claimTextBeforeCommentPlaceholder(ph, 'x')
        expect(text.nodeValue).toBe('x')
        expect(text.previousSibling).toBeNull()
        expect(text.nextSibling).toBe(ph)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('Element directly before placeholder throws (no Text to claim)', () => {
        const div = rootFixture('<span></span><!--root-->')
        expect(() => claimTextBeforeCommentPlaceholder(div.lastChild as Comment))
            .toThrow('expected Text before Comment placeholder')
    })
})

describe('stripAxiiTextBoundariesBetween', () => {
    test('strips pairs, converts axii:0 to empty Text, leaves unmatched opens', () => {
        const div = rootFixture('<!--fs--><!--axii:t-->a<!--axii:/t--><!--axii:0-->b<!--axii:t--><!--end-->')
        stripAxiiTextBoundariesBetween(div.firstChild as Comment, div.lastChild as Comment)
        expect(shapeOf(div)).toEqual([
            'Comment(fs)', 'Text(a)', 'Text()', 'Text(b)', 'Comment(axii:t)', 'Comment(end)',
        ])
    })
})

describe('element claim cursor paths (§3.7 D-series at cursor)', () => {
    test('same-tag wrong-id with exact id ahead: interstitial removed, exact identity claimed (D8)', () => {
        const div = cursorFixture('<span id="junk"></span><i></i><span id="a"></span>')
        const errors = captureMismatches()
        const claimed = tryClaimElement('span', {id: 'a'})
        const exact = div.querySelector('#a')!
        expect(claimed).toBe(exact)
        expect(shapeOf(div)).toEqual(['Element(<span>)'])
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('same-tag wrong-id with no exact ahead claims near-miss as attribute drift (D2/D9)', () => {
        const div = cursorFixture('<span id="x"></span>')
        const errors = captureMismatches()
        const claimed = tryClaimElement('span', {id: 'a'})
        expect(claimed).toBe(div.firstChild)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('same-tag empty-id defers claiming (EmptyHost / Portal layout shell)', () => {
        const div = cursorFixture('<span></span>')
        expect(tryClaimElement('span', {id: 'a'})).toBeNull()
        expect(div.children.length).toBe(1)
    })

    test('wrong tag at cursor carrying wantId returns null (wrong-tag role, rebuild)', () => {
        const div = cursorFixture('<div id="a"></div>')
        expect(tryClaimElement('span', {id: 'a'})).toBeNull()
    })

    test('non-element at cursor with wantId: junk skipped when exact id ahead (D6)', () => {
        const div = cursorFixture('stray<i></i><span id="a"></span>')
        const claimed = tryClaimElement('span', {id: 'a'})
        expect(claimed).toBe(div.lastElementChild)
        expect(shapeOf(div)).toEqual(['Element(<span>)'])
    })

    test('non-element at cursor with wantId and no exact ahead returns null (D6 miss)', () => {
        const div = cursorFixture('stray<span id="b"></span>')
        expect(tryClaimElement('span', {id: 'a'})).toBeNull()
    })

    test('same-tag without id rejected when children do not fit (bare EmptyHost layout)', () => {
        const div = cursorFixture('<span><!--empty--></span>')
        expect(tryClaimElement('span', undefined, [['a', 'b']])).toBeNull()
    })
})

describe('element claim deep-walk candidate fits', () => {
    test('array-child DirectNodes layout fits via trailing unhandledChild (first child not empty)', () => {
        const root = rootFixture('<div><!--axii:t-->a<!--axii:/t--><!--axii:t-->b<!--axii:/t--><!--unhandledChild--></div>')
        expect(tryClaimElement('div', undefined, [['a', 'b']])).toBe(root.firstElementChild)
    })

    test('bare <!--empty--> layout root rejected for array children', () => {
        const root = rootFixture('<div><!--empty--></div>')
        expect(tryClaimElement('div', undefined, [['a', 'b']])).toBeNull()
    })

    test('non-Portal ComponentNode-only children rejected on a leading <!--empty--> root', () => {
        const root = rootFixture('<div><!--empty--><!--unhandledChild--></div>')
        const compNode = {type: function Comp() { return null }, props: {}, children: []}
        expect(tryClaimElement('div', undefined, [compNode])).toBeNull()
    })

    test('exact id behind a different-tag blocker only: deep walk defers (cursor rebuild path)', () => {
        const root = rootFixture('<span id="x"></span><div id="a"></div>')
        expect(tryClaimElement('div', {id: 'a'})).toBeNull()
        expect(root.children.length).toBe(2)
    })

    test('Portal-only ComponentNode children accepted on a <!--empty--> layout root', () => {
        const root = rootFixture('<div><!--empty--><!--unhandledChild--></div>')
        const portalType: any = function PortalStub() { return null }
        portalType.__axiiPortal = true
        const portalNode = {type: portalType, props: {}, children: []}
        expect(tryClaimElement('div', undefined, [portalNode])).toBe(root.firstElementChild)
    })
})

describe('claim helpers error contracts', () => {
    test('createElementForHydrateMismatch without an element cursor throws', () => {
        beginHydration(document.createElement('div'))
        expect(() => createElementForHydrateMismatch('span')).toThrow('without element cursor')
    })

    test('createElementForHydrateMismatch SVG branch creates a namespaced element', () => {
        const div = cursorFixture('<i></i>')
        const errors = captureMismatches()
        const el = createElementForHydrateMismatch('path', true)
        expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg')
        expect(div.firstChild).toBe(el)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })

    test('claimElement returns the claimed element on success', () => {
        const root = rootFixture('<span></span>')
        expect(claimElement('span')).toBe(root.firstChild)
    })

    test('claimElement throws when no unmatched same-tag element exists', () => {
        const root = rootFixture('<span></span>')
        expect(() => claimElement('p')).toThrow('no unmatched <p>')
    })

    test('findRootComment throws when the container lacks <!--root-->', () => {
        const root = rootFixture('<span></span>')
        expect(() => findRootComment(root)).toThrow('missing <!--root-->')
    })
})

describe('trailing cleanup at element cursor (D10/D11)', () => {
    test('host-structure markers ahead guard: junk after markers is kept', () => {
        const div = document.createElement('div')
        div.innerHTML = '<!--zzz--><!--computed node--><b>j</b>'
        const errors = captureMismatches()
        beginHydration(div)
        enterElementChildCursor(div)
        exitElementChildCursor()
        expect(div.querySelector('b')).toBeTruthy()
        expect(errors.length).toBe(0)
    })

    test('cleanup skips claimed elements, comments and processing instructions; removes junk', () => {
        const div = document.createElement('div')
        div.innerHTML = '<span></span><!--note--><i>k</i>'
        div.appendChild(document.createProcessingInstruction('xml-stylesheet', 'href="x"'))
        const errors = captureMismatches()
        beginHydration(div)
        const claimed = tryClaimElement('span')
        expect(claimed).toBe(div.firstChild)
        enterElementChildCursor(div)
        exitElementChildCursor()
        expect(div.querySelector('span')).toBeTruthy()
        expect(div.querySelector('i')).toBeNull()
        expect((div.childNodes[1] as Comment).data).toBe('note')
        expect(div.lastChild?.nodeType).toBe(Node.PROCESSING_INSTRUCTION_NODE)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
    })
})

describe('Fragment reconcile walk branches', () => {
    function walkFixture(children: any[], unhandledCount: number, innerHtml: string) {
        const parent = document.createElement('div')
        parent.innerHTML = innerHtml
        const frag = document.createDocumentFragment()
        ;(frag as any).__axiiFragmentHydrateChildren = children
        ;(frag as any).unhandledChildren = Array.from({length: unhandledCount},
            () => ({placeholder: null, child: null}))
        beginHydration(parent)
        return {
            parent, frag,
            fs: parent.firstChild as Comment,
            ph: parent.lastChild as Comment,
            unhandled: (frag as any).unhandledChildren,
        }
    }

    test('empty-string child claims the axii:0 sentinel as an empty Text', () => {
        const {parent, frag, fs, ph} = walkFixture(['', 'x'], 0,
            '<!--fs--><!--axii:0--><!--axii:t-->x<!--axii:/t--><!--ph-->')
        reconcileFragmentHydrateChildren(frag, fs, ph)
        expect(shapeOf(parent)).toEqual(['Comment(fs)', 'Text()', 'Text(x)', 'Comment(ph)'])
    })

    test('toString-less atom snapshot stringifies via JSON — parity with CSR/SSR stringValue', () => {
        const weird = atom(Object.create(null))
        const {frag, fs, ph} = walkFixture([weird], 1,
            '<!--fs--><!--axii:t-->{}<!--axii:/t--><!--ph-->')
        reconcileFragmentHydrateChildren(frag, fs, ph)
        expect((frag as any).unhandledChildren[0].placeholder.nodeValue).toBe('{}')
    })

    test('array child with DocumentFragment item claims the array item comment', () => {
        const nested = document.createDocumentFragment()
        const arrayChild = [nested]
        const {frag, fs, ph} = walkFixture([arrayChild], 1,
            '<!--fs--><!--array item--><!--unhandledChild--><!--ph-->')
        reconcileFragmentHydrateChildren(frag, fs, ph)
        expect((frag as any).unhandledChildren[0].placeholder.data).toBe('unhandledChild')
        const hosts = (arrayChild as any).__axiiHydrateItemHosts
        expect(hosts).toBeTruthy()
        expect(hosts[0].child).toBe(nested)
        expect(hosts[0].placeholder.data).toBe('array item')
    })

    test('array child with RxList item claims the array item comment and stashes the list cursor', () => {
        const list = new RxList([])
        const {frag, fs, ph} = walkFixture([[list]], 1,
            '<!--fs--><!--array item--><!--unhandledChild--><!--ph-->')
        reconcileFragmentHydrateChildren(frag, fs, ph)
        expect((list as any).__axiiHydrateListParent).toBeTruthy()
        expect((frag as any).unhandledChildren[0].placeholder.data).toBe('unhandledChild')
    })

    test('array child with ComponentNode item claims the array item comment', () => {
        const comp = {type: () => null, props: {}, children: []}
        const {frag, fs, ph} = walkFixture([[comp]], 1,
            '<!--fs--><!--array item--><!--unhandledChild--><!--ph-->')
        reconcileFragmentHydrateChildren(frag, fs, ph)
        expect((frag as any).unhandledChildren[0].placeholder.data).toBe('unhandledChild')
    })

    test('unsupported array item type throws', () => {
        const {frag, fs, ph} = walkFixture([[Symbol('x')]], 1,
            '<!--fs--><!--array item--><!--unhandledChild--><!--ph-->')
        expect(() => reconcileFragmentHydrateChildren(frag, fs, ph)).toThrow('not supported')
    })

    test('unhandledChildren slot mismatch throws', () => {
        const {frag, fs, ph} = walkFixture([atom('v')], 0,
            '<!--fs--><!--axii:t-->v<!--axii:/t--><!--ph-->')
        expect(() => reconcileFragmentHydrateChildren(frag, fs, ph)).toThrow('unhandledChildren mismatch')
    })

    test('reconcileFragmentHydrateChildren throws when the placeholder has no parent', () => {
        const frag = document.createDocumentFragment()
        ;(frag as any).__axiiFragmentHydrateChildren = [atom('x')]
        beginHydration(document.createElement('div'))
        expect(() => reconcileFragmentHydrateChildren(
            frag, document.createComment('fragment start'), document.createComment('root'),
        )).toThrow('without parent')
    })

    test('reconcileFragmentHydrateChildren throws when fragment start is not under the parent', () => {
        const frag = document.createDocumentFragment()
        ;(frag as any).__axiiFragmentHydrateChildren = [atom('x')]
        const parent = document.createElement('div')
        parent.innerHTML = '<!--root-->'
        beginHydration(parent)
        expect(() => reconcileFragmentHydrateChildren(
            frag, document.createComment('fragment start'), parent.lastChild as Comment,
        )).toThrow('fragment start not in parent')
    })

    test('reconcileFlattenedFragmentHydrateChildren throws without an active cursor', () => {
        const frag = document.createDocumentFragment()
        ;(frag as any).__axiiFragmentHydrateChildren = ['x']
        beginHydration(document.createElement('div'))
        expect(() => reconcileFlattenedFragmentHydrateChildren(frag)).toThrow('without parent cursor')
    })
})

describe('hydrateRoot end-to-end claim corners', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('real Text nodes in array children serialize as DirectNodes (empty Text → axii:0)', () => {
        // Real Texts must be passed via ctx.createElement inside the SSR pass —
        // host-tag createElement outside it produces real DOM elements.
        function TextItems({}, ctx: RenderContext) {
            return ctx.createElement('div', null,
                [document.createTextNode('a'), document.createTextNode('')])
        }
        const {html} = renderToString(createElement(TextItems, null))
        expect(html).toBe('<div><!--axii:t-->a<!--axii:/t--><!--axii:0--><!--unhandledChild--></div><!--root-->')
    })

    test('bare unwrapped SSR text is claimed with identity kept (A2 omission is valid input)', () => {
        const name = atom('hello')
        function App({}, {createElement}: RenderContext) {
            return <div>{name}</div>
        }
        rootEl.innerHTML = '<div>hello</div><!--root-->'
        const divBefore = rootEl.querySelector('div')!
        const textBefore = divBefore.firstChild as Text
        const root = hydrateRoot(rootEl, createElement(App, null))
        expect(rootEl.querySelector('div')).toBe(divBefore)
        expect(divBefore.firstChild).toBe(textBefore)
        name('world')
        expect(divBefore.firstChild?.nodeValue).toBe('world')
        root.destroy()
    })

    test('component-root element with array child claims DirectNodes layout', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>{['a', 'b']}</div>
        }
        const {html} = renderToString(createElement(App, null))
        rootEl.innerHTML = html
        const divBefore = rootEl.querySelector('div')!
        const root = hydrateRoot(rootEl, createElement(App, null))
        expect(rootEl.querySelector('div')).toBe(divBefore)
        expect(divBefore.textContent).toBe('ab')
        root.destroy()
    })

    test('Comment-ph drift: SSR text missing while expected non-empty reports + inserts fresh Text', () => {
        const name = atom('x')
        const {html} = renderToString(name)
        rootEl.innerHTML = html.replace('<!--axii:t-->x<!--axii:/t-->', '')
        const errors = captureMismatches()
        const root = hydrateRoot(rootEl, name)
        const text = rootEl.firstChild
        expect(text?.nodeType).toBe(Node.TEXT_NODE)
        expect((text as Text).nodeValue).toBe('x')
        expect(rootEl.lastChild?.nodeType).toBe(Node.COMMENT_NODE)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        name('y')
        expect((rootEl.firstChild as Text).nodeValue).toBe('y')
        root.destroy()
    })

    test('root atom hydrate throws when an Element sits before <!--root-->', () => {
        const name = atom('x')
        rootEl.innerHTML = '<span></span><!--root-->'
        expect(() => hydrateRoot(rootEl, name)).toThrow('expected Text before Comment placeholder')
    })

    test('hydrateRoot throws when the container is missing <!--root-->', () => {
        rootEl.innerHTML = '<span></span>'
        expect(() => hydrateRoot(rootEl, createElement('span', null))).toThrow('missing <!--root-->')
    })
})
