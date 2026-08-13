/**
 * M-02: Node-side renderToString — attrs, forms, escape, FTS/FCS, context, DirectNodes, ElementChildText.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/ssrRenderToString.spec.ts
 */
import {describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {assertNoRawTextTerminator, createElement, Fragment, isAcceptableSingleCssRule, renderToString} from '../../src/ssr.js'
import {createContext, ContextProvider} from '../../src/ContextProvider.js'
import type {RenderContext} from '../../src/types.js'

describe('M-01 renderToString (Node)', () => {
    test('does not require document / HTMLElement', () => {
        expect(typeof globalThis.document).toBe('undefined')
        expect(typeof (globalThis as any).HTMLElement).toBe('undefined')
    })

    test('static text + atom emits axii:t boundaries and <!--root-->', () => {
        const text = atom('atomVal')
        function App({}, {createElement}: RenderContext) {
            return createElement('div', {id: 't'}, 'static-', text)
        }
        const {html, styles, portals} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div id="t"><!--axii:t-->static-<!--axii:/t--><!--axii:t-->atomVal<!--axii:/t--></div><!--root-->',
        )
        expect(styles).toBe('')
        expect(portals).toEqual({})
    })

    test('empty atom Text-ph emits <!--axii:0-->', () => {
        const text = atom(null)
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, text)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe('<div><!--axii:0--></div><!--root-->')

        text('')
        const {html: html2} = renderToString(createElement(App, null))
        expect(html2).toBe('<div><!--axii:0--></div><!--root-->')
    })

    test('EmptyHost: render null → <!--empty--><!--root-->', () => {
        const {html} = renderToString(null)
        expect(html).toBe('<!--empty--><!--root-->')
    })

    test('EmptyHost: Component → null', () => {
        function NullComp() {
            return null as any
        }
        const {html} = renderToString(createElement(NullComp, null))
        expect(html).toBe('<!--empty--><!--root-->')
    })

    test('two adjacent atoms get boundaries', () => {
        const a = atom('hello')
        const b = atom('world')
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, a, b)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t--></div><!--root-->',
        )
    })

    test('Fragment is allowed as child structure', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', null, createElement(F as any, null, 'a', atom('b')))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--root-->')
        expect(html).toContain('<!--axii:t-->a<!--axii:/t-->')
        expect(html).toContain('<!--axii:t-->b<!--axii:/t-->')
    })
})

describe('M-02 renderToString (Node)', () => {
    test('attrs: boolean / className / style / text escape', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', {
                id: 'x',
                disabled: true,
                className: 'a b',
                style: {color: 'red', fontSize: '12px'},
                title: 'a<b>&"c',
            }, '1<2>&3')
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('disabled="true"')
        expect(html).toContain('class="a b"')
        expect(html).toContain('style="color:red;font-size:12px"')
        expect(html).toContain('title="a&lt;b&gt;&amp;&quot;c"')
        expect(html).toContain('<!--axii:t-->1&lt;2&gt;&amp;3<!--axii:/t-->')
        expect(html).not.toContain('onClick')
    })

    test('CB checkbox value={true} dual channel; CK-only; CB falsy', () => {
        const {html: cbTrue} = renderToString(
            createElement('input', {type: 'checkbox', value: true} as any),
        )
        expect(cbTrue).toContain('value="true"')
        expect(cbTrue).toContain('checked="true"')

        const {html: cbFalse} = renderToString(
            createElement('input', {type: 'checkbox', value: false} as any),
        )
        expect(cbFalse).toContain('value="false"')
        expect(cbFalse).not.toContain('checked')

        const {html: ck} = renderToString(
            createElement('input', {type: 'checkbox', checked: true} as any),
        )
        expect(ck).toContain('checked="true"')
        expect(ck).not.toMatch(/\svalue=/)
    })

    test('textarea TA: child text, no value attr, no axii markers; entity escape', () => {
        const {html} = renderToString(
            createElement('textarea', {value: 'a<b>&</textarea>x'} as any),
        )
        expect(html).toBe(
            '<textarea>a&lt;b&gt;&amp;&lt;/textarea&gt;x</textarea><!--root-->',
        )
        expect(html).not.toContain('axii:')
        expect(html).not.toMatch(/<textarea[^>]*value=/)
    })

    test('select/option SO: explicit option selected="true"', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('select', null as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement('option', {value: 'b', selected: true} as any, 'B'),
            )
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<option value="b" selected="true">')
    })

    test('SO: select value prop maps to option selected (not select value attr)', () => {
        // §3.6.2 SO / F-F8: CSR select.value is IDL-only; SSR must emit selected on matching option.
        // HTML <select value="…"> does not set parse-time selection.
        const {html} = renderToString(
            createElement('select', {value: 'b'} as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement('option', {value: 'b'} as any, 'B'),
            ),
        )
        expect(html).toContain('<option value="b" selected="true">')
        expect(html).not.toMatch(/<select[^>]*\svalue=/)
    })

    test('SO: select multiple array value selects matching options', () => {
        const {html} = renderToString(
            createElement('select', {multiple: true, value: ['a', 'c']} as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement('option', {value: 'b'} as any, 'B'),
                createElement('option', {value: 'c'} as any, 'C'),
            ),
        )
        expect(html).toContain('<option value="a" selected="true">')
        expect(html).toContain('<option value="c" selected="true">')
        expect(html).not.toContain('<option value="b" selected="true">')
    })

    test('SO: optgroup + text-fallback + atom value + SO overrides selected', () => {
        // Finite SO edges already correct in product (k3); lock against regression.
        const {html: og} = renderToString(
            createElement('select', {value: 'b'} as any,
                createElement('optgroup', {label: 'g'} as any,
                    createElement('option', {value: 'a'} as any, 'A'),
                    createElement('option', {value: 'b'} as any, 'B'),
                ),
            ),
        )
        expect(og).toContain('<option value="b" selected="true">')
        expect(og).not.toContain('<option value="a" selected="true">')

        const {html: textFb} = renderToString(
            createElement('select', {value: 'B'} as any,
                createElement('option', null as any, 'A'),
                createElement('option', null as any, 'B'),
            ),
        )
        expect(textFb).toMatch(/<option selected="true">/)
        expect(textFb).toContain('<!--axii:t-->B<!--axii:/t-->')

        const v = atom('b')
        const {html: atomVal} = renderToString(
            createElement('select', {value: v} as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement('option', {value: 'b'} as any, 'B'),
            ),
        )
        expect(atomVal).toContain('<option value="b" selected="true">')

        const {html: override} = renderToString(
            createElement('select', {value: 'a'} as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement('option', {value: 'b', selected: true} as any, 'B'),
            ),
        )
        expect(override).toContain('<option value="a" selected="true">')
        expect(override).not.toContain('<option value="b" selected="true">')
    })

    test('SO: array / function / component option children inherit select value (CSR map path)', () => {
        // k3 audit D1: selectSo dropped in serializeStaticArray / FunctionHost / Component.
        // CSR fatalBugs11 uses `{options.map(...)}` under select — must select matching options.
        const {html: arr} = renderToString(
            createElement('select', {value: 'b'} as any,
                [
                    createElement('option', {value: 'a'} as any, 'A'),
                    createElement('option', {value: 'b'} as any, 'B'),
                ],
            ),
        )
        expect(arr).toContain('<option value="b" selected="true">')
        expect(arr).not.toMatch(/<select[^>]*\svalue=/)

        const {html: fn} = renderToString(
            createElement('select', {value: 'b'} as any,
                () => createElement('option', {value: 'b'} as any, 'B'),
                createElement('option', {value: 'a'} as any, 'A'),
            ),
        )
        expect(fn).toContain('<option value="b" selected="true">')

        function Opt(_p: any, {createElement: ce}: any) {
            return ce('option', {value: 'b'} as any, 'B')
        }
        const {html: comp} = renderToString(
            createElement('select', {value: 'b'} as any,
                createElement('option', {value: 'a'} as any, 'A'),
                createElement(Opt, null),
            ),
        )
        expect(comp).toContain('<option value="b" selected="true">')

        const {html: multiMap} = renderToString(
            createElement('select', {multiple: true, value: ['a', 'c']} as any,
                ['a', 'b', 'c'].map((o) => createElement('option', {value: o} as any, o)),
            ),
        )
        expect(multiMap).toContain('<option value="a" selected="true">')
        expect(multiMap).toContain('<option value="c" selected="true">')
        expect(multiMap).not.toContain('<option value="b" selected="true">')

        // k4-audit: finite SO compositions through the same Host paths (once-list lock)
        const {html: frag} = renderToString(
            createElement('select', {value: 'b'} as any,
                createElement(Fragment, null as any,
                    createElement('option', {value: 'a'} as any, 'A'),
                    createElement('option', {value: 'b'} as any, 'B'),
                ),
            ),
        )
        expect(frag).toContain('<option value="b" selected="true">')

        const {html: fnArr} = renderToString(
            createElement('select', {value: 'b'} as any,
                () => [
                    createElement('option', {value: 'a'} as any, 'A'),
                    createElement('option', {value: 'b'} as any, 'B'),
                ],
            ),
        )
        expect(fnArr).toContain('<option value="b" selected="true">')

        function OptA(_p: any, {createElement: ce}: any) {
            return ce('option', {value: 'a'} as any, 'A')
        }
        function OptB(_p: any, {createElement: ce}: any) {
            return ce('option', {value: 'b'} as any, 'B')
        }
        const {html: arrComp} = renderToString(
            createElement('select', {value: 'b'} as any,
                [createElement(OptA, null), createElement(OptB, null)],
            ),
        )
        expect(arrComp).toContain('<option value="b" selected="true">')

        const Ctx = createContext('soCtx')
        function WithCtx(_p: any, {createElement: ce}: any) {
            return ce('select', {value: 'b'} as any,
                ce(ContextProvider, {contextType: Ctx, value: 1} as any,
                    ce('option', {value: 'a'} as any, 'A'),
                    ce('option', {value: 'b'} as any, 'B'),
                ),
            )
        }
        const {html: ctx} = renderToString(createElement(WithCtx, null))
        expect(ctx).toContain('<option value="b" selected="true">')
    })
    test('CK radio + IV text + radio value does not set checked', () => {
        const {html: radioCk} = renderToString(
            createElement('input', {type: 'radio', name: 'g', checked: true} as any),
        )
        expect(radioCk).toContain('checked="true"')
        expect(radioCk).not.toMatch(/\svalue=/)

        const {html: iv} = renderToString(
            createElement('input', {type: 'text', value: 'hello'} as any),
        )
        expect(iv).toContain('value="hello"')

        const {html: radioVal} = renderToString(
            createElement('input', {type: 'radio', value: true} as any),
        )
        expect(radioVal).toContain('value="true"')
        expect(radioVal).not.toContain('checked')
    })

    test('CB deferred: value then checked=false; checked=false then value=true', () => {
        const props1: any = {type: 'checkbox'}
        props1.value = true
        props1.checked = false
        const {html: h1} = renderToString(createElement('input', props1))
        expect(h1).toContain('value="true"')
        expect(h1).not.toContain('checked')

        const props2: any = {type: 'checkbox'}
        props2.checked = false
        props2.value = true
        const {html: h2} = renderToString(createElement('input', props2))
        expect(h2).toContain('value="true"')
        expect(h2).toContain('checked="true"')
    })
    test('RAWTEXT </style> termination throws', () => {
        expect(() => assertNoRawTextTerminator('color:red;</style><script>', 'style')).toThrow(
            /RAWTEXT termination/,
        )
        expect(() =>
            renderToString(createElement('style', null, 'a{}</style><b>')),
        ).toThrow(/RAWTEXT termination/)
    })

    test('dangerouslySetInnerHTML passthrough', () => {
        const {html} = renderToString(
            createElement('div', {dangerouslySetInnerHTML: {__html: '<em>x</em>'}} as any),
        )
        expect(html).toBe('<div><em>x</em></div><!--root-->')
    })

    test('FunctionHost text empty / false → axii:0', () => {
        const {html} = renderToString(
            createElement('div', null, () => false as any),
        )
        expect(html).toBe('<div><!--axii:0--></div><!--root-->')
        const {html: h2} = renderToString(
            createElement('div', null, () => '' as any),
        )
        expect(h2).toBe('<div><!--axii:0--></div><!--root-->')
    })

    test('FTS: element-child function → element emits computed + axii:0', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, () => createElement('span', null, 'x'))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><span><!--axii:t-->x<!--axii:/t--></span><!--computed node--><!--axii:0--></div><!--root-->',
        )
    })

    test('FTS: function → atom emits content + computed + axii:0', () => {
        const a = atom('world')
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, () => a)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe('<div>world<!--computed node--><!--axii:0--></div><!--root-->')
    })

    test('FTS: function → Fragment emits fragment start + computed + axii:0', () => {
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', null, () =>
                createElement(F as any, null,
                    createElement('span', null, 'a'),
                    createElement('span', null, 'b'),
                ),
            )
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--computed node--><!--axii:0-->')
        expect(html).not.toContain('<!--rx list item-->')
    })

    test('FCS: root function → element emits computed before root (no axii:0)', () => {
        const {html} = renderToString(() => createElement('div', {id: 'r'}, 'hi'))
        expect(html).toBe(
            '<div id="r"><!--axii:t-->hi<!--axii:/t--></div><!--computed node--><!--root-->',
        )
        expect(html).not.toContain('axii:0')
    })

    test('FCS: StaticArray function item emits array item not rx list item', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, [() => createElement('span', null, 'x')])
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--computed node--><!--array item--><!--unhandledChild-->')
        expect(html).not.toContain('rx list item')
        expect(html).not.toContain('axii:0')
    })

    test('ElementChildText: multi static siblings + empty sibling + single empty', () => {
        const {html: multi} = renderToString(
            createElement('div', null, 'hello', 'world'),
        )
        expect(multi).toBe(
            '<div><!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t--></div><!--root-->',
        )
        expect(multi).not.toContain('unhandledChild')

        const {html: emptySib} = renderToString(
            createElement('div', null, '', 'x'),
        )
        expect(emptySib).toBe(
            '<div><!--axii:0--><!--axii:t-->x<!--axii:/t--></div><!--root-->',
        )

        const {html: singleEmpty} = renderToString(
            createElement('div', null, ''),
        )
        expect(singleEmpty).toBe('<div></div><!--root-->')
    })

    test('DirectNodes: adjacent static array + empty', () => {
        const {html} = renderToString(
            createElement('div', null, ['hello', 'world']),
        )
        expect(html).toBe(
            '<div><!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t--><!--unhandledChild--></div><!--root-->',
        )

        const {html: empty} = renderToString(
            createElement('div', null, ['']),
        )
        expect(empty).toBe('<div><!--axii:0--><!--unhandledChild--></div><!--root-->')

        const {html: emptyLead} = renderToString(
            createElement('div', null, ['', 'x']),
        )
        expect(emptyLead).toBe(
            '<div><!--axii:0--><!--axii:t-->x<!--axii:/t--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('createContext / ContextProvider', () => {
        const Ctx = createContext<string>('t')
        function Child({}, {context}: RenderContext) {
            return createElement('span', null, context.get(Ctx) as string)
        }
        function App({}, {createElement}: RenderContext) {
            return createElement(ContextProvider as any, {contextType: Ctx, value: 'from-ctx'},
                createElement(Child, null),
            )
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--axii:t-->from-ctx<!--axii:/t-->')
    })

    test('Component nesting', () => {
        function Inner({}, {createElement}: RenderContext) {
            return createElement('b', null, 'in')
        }
        function Outer({}, {createElement}: RenderContext) {
            return createElement('div', null, createElement(Inner, null))
        }
        const {html} = renderToString(createElement(Outer, null))
        expect(html).toBe(
            '<div><b><!--axii:t-->in<!--axii:/t--></b><!--unhandledChild--></div><!--root-->',
        )
    })
})

describe('M-03 renderToString RxList rows (Node)', () => {
    test('G1 Compact element rows: no rx list item', () => {
        const list = new RxList([1, 2])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list.map((i: number) => createElement('span', null, i)))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><span><!--axii:t-->1<!--axii:/t--></span><span><!--axii:t-->2<!--axii:/t--></span><!--unhandledChild--></div><!--root-->',
        )
        expect(html).not.toContain('rx list item')
    })

    test('G2 detachStyle element row emits rx list item', () => {
        const list = new RxList([1])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list.map((i: number) =>
                createElement('span', {detachStyle: {opacity: 0}} as any, i)))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--rx list item-->')
        expect(html).toContain('<span')
    })

    test('G4 atom Comment-ph empty and non-empty', () => {
        const list = new RxList([atom(''), atom('hi')])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--rx list item--><!--axii:t-->hi<!--axii:/t--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G4-F Function text-state empty: only rx list item (no empty/computed)', () => {
        const list = new RxList([() => null, () => false as any])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--rx list item--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
        expect(html).not.toContain('<!--empty-->')
        expect(html).not.toContain('computed node')
    })

    test('G3-E null row: empty + rx list item', () => {
        const list = new RxList<any>([null])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--empty--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-F Function→element: computed + rx list item', () => {
        const list = new RxList([() => createElement('span', null, 'x')])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><span><!--axii:t-->x<!--axii:/t--></span><!--computed node--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-F Function→atom is not G4-F', () => {
        const a = atom('world')
        const list = new RxList([() => a])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list)
        }
        const {html} = renderToString(createElement(App, null))
        // Atom under FCS: bare text + computed + rx list item (not G4-F-only comment)
        expect(html).toBe(
            '<div>world<!--computed node--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-C Component row: no computed', () => {
        function Row({}, {createElement}: RenderContext) {
            return createElement('span', null, 'r')
        }
        const list = new RxList([1])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, list.map(() => createElement(Row, null)))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<span><!--axii:t-->r<!--axii:/t--></span><!--rx list item-->')
        expect(html).not.toContain('computed node')
    })

    test('G3-Fr Fragment row: fragment start, no computed', () => {
        const list = new RxList([1])
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement('div', null, list.map(() =>
                createElement(F as any, null, createElement('span', null, 'a'), createElement('span', null, 'b'))))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toContain('<!--rx list item-->')
        expect(html).not.toContain('computed node')
    })

    test('G3-RL nested RxList: inner rows + outer rx list item; no computed/empty', () => {
        const inner = new RxList([1, 2])
        const outer = new RxList([inner])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, outer)
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--axii:t-->1<!--axii:/t--><!--rx list item--><!--axii:t-->2<!--axii:/t--><!--rx list item--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
        expect(html).not.toContain('computed')
        expect(html).not.toContain('<!--empty-->')
    })

    test('G3-RU reusable row', () => {
        function App({}, {createElement, reusable}: RenderContext) {
            const reused = reusable(createElement('div', {id: 'reused'}, 'R'))
            return createElement('div', null, new RxList([reused]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><div id="reused"><!--axii:t-->R<!--axii:/t--></div><!--reusable--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('table bare tr wraps tbody', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('table', null, createElement('tr', null, createElement('td', null, 'x')))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<table><tbody><tr>')
        expect(html).toContain('</tbody></table>')
    })

    test('table with explicit tbody + list keeps tbody', () => {
        const list = new RxList([1])
        function App({}, {createElement}: RenderContext) {
            return createElement('table', null,
                createElement('tbody', null, list.map((i: number) =>
                    createElement('tr', null, createElement('td', null, i)))))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<table><tbody>')
        expect(html.match(/<tbody>/g)?.length).toBe(1)
        expect(html).not.toContain('rx list item')
    })

    test('G3-A string DirectNodes row: axii:t pair + rx list item (no array item between strings)', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([['x', 'y'] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--axii:t-->x<!--axii:/t--><!--axii:t-->y<!--axii:/t--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-A multi-atom row: text + array item each, then rx list item', () => {
        const a = atom('A')
        const b = atom('B')
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([[a, b] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--axii:t-->A<!--axii:/t--><!--array item--><!--axii:t-->B<!--axii:/t--><!--array item--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-A nested array item: content + array item only (no nested unhandledChild)', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([[[1, 2], 'x'] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toBe(
            '<div><!--axii:t-->1<!--axii:/t--><!--axii:t-->2<!--axii:/t--><!--array item--><!--axii:t-->x<!--axii:/t--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-A Fragment item: fragment start before content + array item', () => {
        function App({}, {createElement, Fragment}: RenderContext) {
            return createElement('div', null, new RxList([[
                createElement(Fragment as any, null, 'a', createElement('span', null, 'b')),
            ] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start-->')
        expect(html).toMatch(/<!--fragment start-->[\s\S]*<!--array item--><!--rx list item-->/)
    })

    test('G3-A Component item: no unhandledChild before array item', () => {
        function Child({}, {createElement}: RenderContext) {
            return createElement('span', null, 'c')
        }
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([[createElement(Child, null)] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toBe(
            '<div><span><!--axii:t-->c<!--axii:/t--></span><!--array item--><!--rx list item--><!--unhandledChild--></div><!--root-->',
        )
    })

    test('G3-A RxList item: inner rows + array item (no nested unhandledChild)', () => {
        const inner = new RxList([1, 2])
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([[inner, 'z'] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toMatch(/<!--rx list item-->[\s\S]*<!--rx list item--><!--array item-->/)
    })

    test('G3-A Reusable item: reusable + array item (no nested unhandledChild)', () => {
        function App({}, {createElement, reusable}: RenderContext) {
            const reused = reusable(createElement('div', {id: 'reused'}, 'R'))
            return createElement('div', null, new RxList([[reused, 'z'] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toContain('<!--reusable--><!--array item-->')
    })

    test('G3-A Component→Fragment item: SSR emits fragment start (hydrate covered in lists)', () => {
        function Child({}, {createElement, Fragment}: RenderContext) {
            return createElement(Fragment as any, null, 'p', createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([[createElement(Child, null), 'z'] as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start-->')
        expect(html).not.toMatch(/<!--unhandledChild--><!--array item-->/)
        expect(html).toMatch(/<!--fragment start-->[\s\S]*<!--array item--><!--axii:t-->z/)
    })

    test('G3-C Component→Fragment row: SSR fragment start, no computed', () => {
        function Child({}, {createElement, Fragment}: RenderContext) {
            return createElement(Fragment as any, null, 'p', createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([createElement(Child, null) as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start-->')
        expect(html).not.toContain('<!--computed node-->')
        expect(html).toContain('<!--rx list item-->')
    })

    test('boolean child → PrimitiveHost Comment-ph (<!--unhandledChild--> only)', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, 'a', false, 'b')
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div><!--axii:t-->a<!--axii:/t--><!--unhandledChild--><!--axii:t-->b<!--axii:/t--></div><!--root-->',
        )
    })

    test('Fragment boolean false → Comment-ph before siblings', () => {
        function Child({}, {createElement, Fragment}: RenderContext) {
            return createElement(Fragment as any, null, false, createElement('em', null, 'q'))
        }
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null, new RxList([createElement(Child, null) as any]))
        }
        const {html} = renderToString(createElement(App, null))
        expect(html).toContain('<!--fragment start--><!--unhandledChild--><em>')
        expect(html).not.toContain('<!--computed node-->')
    })
})

describe('M-04 renderToString styles (Node)', () => {
    test('nested style emits styles + class; escape gate omits breakout', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', {
                style: {
                    color: 'red',
                    '&:hover': {color: 'blue'},
                },
            }, 'x')
        }
        const {html, styles} = renderToString(createElement(App, null))
        expect(styles).toMatch(/:hover/)
        expect(html).toMatch(/class="/)
        expect(isAcceptableSingleCssRule('.x{width:100px} body{x:1}')).toBe(false)
        expect(isAcceptableSingleCssRule('.x::before{content:"a}b"}')).toBe(true)

        const evil = '100px; } body { outline: 1px solid red; } .z {'
        function Evil({}, {createElement}: RenderContext) {
            return createElement('div', {style: {'&:hover': {width: evil}}}, 'x')
        }
        const {styles: evilStyles} = renderToString(createElement(Evil, null))
        expect(evilStyles.includes('body')).toBe(false)
    })

    test('isAcceptableSingleCssRule oracle pairs', () => {
        expect(isAcceptableSingleCssRule('.axii-d5-break{width:100px} body{outline:1px solid red;}')).toBe(false)
        expect(isAcceptableSingleCssRule('.x{content:"a}b"}')).toBe(true)
        expect(isAcceptableSingleCssRule('')).toBe(false)
    })
})


describe('M-04 style isolation (Node)', () => {
    test('parallel renderToString do not cross-contaminate styles', async () => {
        const a = atom('rgb(1, 2, 3)')
        const b = atom('rgb(4, 5, 6)')
        function AppA(_: any, {createElement}: any) {
            return createElement('div', {style: {color: a as any, '&:hover': {opacity: '0.5'}}}, 'a')
        }
        function AppB(_: any, {createElement}: any) {
            return createElement('div', {style: {color: b as any, '&:hover': {opacity: '0.5'}}}, 'b')
        }
        const [ra, rb] = await Promise.all([
            Promise.resolve(renderToString(createElement(AppA, null))),
            Promise.resolve(renderToString(createElement(AppB, null))),
        ])
        expect(ra.styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        expect(ra.styles).not.toMatch(/rgb\(4,\s*5,\s*6\)/)
        expect(rb.styles).toMatch(/rgb\(4,\s*5,\s*6\)/)
        expect(rb.styles).not.toMatch(/rgb\(1,\s*2,\s*3\)/)
    })
})
