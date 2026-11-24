/**
 * Serialization corners not exercised by the milestone specs: top-level sources,
 * attr/style input shapes, RCDATA flattening, table tbody gating, StaticArray item
 * types, render-context stubs, and reusable placement.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/ssrSerializationCorners.spec.ts
 */
import {describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {createElement, Fragment, isAcceptableSingleCssRule, renderToString} from '../../src/ssr.js'
import {evaluateStyleSnapshot, styleValueNeedsStylesheet} from '../../src/styleSerialize.js'

describe('renderToString top-level sources', () => {
    test('top-level string wraps as a text unit', () => {
        const {html, styles, portals} = renderToString('hello')
        expect(html).toBe('<!--axii:t-->hello<!--axii:/t--><!--root-->')
        expect(styles).toBe('')
        expect(portals).toEqual({})
    })

    test('top-level number wraps as a text unit', () => {
        expect(renderToString(42).html).toBe('<!--axii:t-->42<!--axii:/t--><!--root-->')
    })

    test('top-level boolean renders no text (Comment-ph empty)', () => {
        expect(renderToString(true).html).toBe('<!--root-->')
        expect(renderToString(false).html).toBe('<!--root-->')
    })

    test('top-level Fragment sentinel function renders no text', () => {
        // Fragment() invoked as the source function itself — sentinel returns null
        expect(renderToString(Fragment).html).toBe('<!--root-->')
    })

    test('top-level RxList serializes rows (hostRoot path mode)', () => {
        const {html} = renderToString(new RxList(['a', null]))
        expect(html).toBe(
            '<!--axii:t-->a<!--axii:/t--><!--rx list item-->'
            + '<!--empty--><!--rx list item-->'
            + '<!--root-->',
        )
    })

    test('top-level reusable source emits content + reusable marker', () => {
        function Source({}, ctx: any) {
            return ctx.reusable(ctx.createElement('b', null, 'K'))
        }
        const {html} = renderToString(createElement(Source, null))
        expect(html).toBe('<b><!--axii:t-->K<!--axii:/t--></b><!--reusable--><!--root-->')
    })

    test('unsupported top-level source throws (observable)', () => {
        expect(() => renderToString({})).toThrow('unsupported render source')
    })
})

describe('renderToString attr/style input shapes', () => {
    test('style string prop goes inline verbatim', () => {
        expect(renderToString(createElement('div', {style: 'color:red'})).html)
            .toBe('<div style="color:red"></div><!--root-->')
    })

    test('style array with string entries inlines them joined by ;', () => {
        expect(renderToString(createElement('div', {style: ['color:red', 'font-size:12px']})).html)
            .toBe('<div style="color:red;font-size:12px"></div><!--root-->')
    })

    test('CSS custom property key keeps leading -- without camelCase rewrite', () => {
        expect(renderToString(createElement('div', {style: {'--brand': 'red'}})).html)
            .toBe('<div style="--brand:red"></div><!--root-->')
    })

    test('className object emits truthy keys only', () => {
        expect(renderToString(createElement('div', {className: {on: true, off: false}})).html)
            .toBe('<div class="on"></div><!--root-->')
    })

    test('literal true attribute value renders name="true"', () => {
        expect(renderToString(createElement('div', {'data-flag': true})).html)
            .toBe('<div data-flag="true"></div><!--root-->')
    })

    test('numeric size values auto-append px', () => {
        expect(renderToString(createElement('div', {style: {fontSize: 12, top: 1.5}})).html)
            .toBe('<div style="font-size:12px;top:1.5px"></div><!--root-->')
    })

    test('array style values: space join / comma join / [num, unit] tuple', () => {
        const {html} = renderToString(createElement('div', {
            style: {
                margin: [1, 2],
                boxShadow: ['1px 1px 0 black', 'inset 0 0 4px red'],
                width: [3, 'em'],
            },
        }))
        expect(html).toContain('margin:1px 2px')
        expect(html).toContain('box-shadow:1px 1px 0 black,inset 0 0 4px red')
        expect(html).toContain('width:3em')
    })

    test('non-plain object style value with custom toString (StyleSize-like) is stringified by it', () => {
        // Plain objects are nested-style dictionaries; only class instances reach the
        // stringifyCssValue toString branch (matches CSR StyleSize handling).
        class StyleSize { toString() { return '5' } }
        expect(renderToString(createElement('div', {style: {zIndex: new StyleSize()}})).html)
            .toBe('<div style="z-index:5"></div><!--root-->')
    })
    test('option selected with a non-boolean truthy value emits selected (option-specific branch)', () => {
        // {selected: true} alone hits the generic boolean-attribute branch instead
        expect(renderToString(createElement('option', {selected: 'yes'}, 'A')).html)
            .toBe('<option selected="true"><!--axii:t-->A<!--axii:/t--></option><!--root-->')
    })

    test('empty textarea emits no child text', () => {
        expect(renderToString(createElement('textarea', null)).html)
            .toBe('<textarea></textarea><!--root-->')
    })

    test('element child inside an RCDATA parent throws', () => {
        expect(() => renderToString(createElement('title', null, createElement('i', null, 'x'))))
            .toThrow('unsupported child in <title>')
    })

    test('style entry snapshotting to null is skipped in inline output', () => {
        expect(renderToString(createElement('div', {style: {color: () => null as any}})).html)
            .toBe('<div></div><!--root-->')
    })
})

describe('renderToString form corners', () => {
    test('option selected prop emits selected even without select SO', () => {
        const {html} = renderToString(createElement('select', null,
            createElement('option', {selected: true, value: 'a'}, 'A'),
        ))
        expect(html).toBe(
            '<select><option selected="true" value="a"><!--axii:t-->A<!--axii:/t--></option></select><!--root-->',
        )
    })

    test('checked on a non-checkbox input still emits checked (IV deferred path)', () => {
        expect(renderToString(createElement('input', {type: 'text', checked: true})).html)
            .toBe('<input type="text" checked="true"/><!--root-->')
    })

    test('checkbox value then checked=false: value attr kept, checked omitted (key order wins)', () => {
        expect(renderToString(createElement('input', {type: 'checkbox', value: 'v', checked: false})).html)
            .toBe('<input type="checkbox" value="v"/><!--root-->')
    })

    test('option with props.children (no spread args) resolves text for SO match', () => {
        const {html} = renderToString(createElement('select', {value: 'B'},
            createElement('option', {children: 'A'}),
            createElement('option', {children: 'B'}),
        ))
        expect(html).toContain('<option selected="true">')
        expect(html).not.toContain('<option>A</option>')
    })

    test('textarea string child becomes RCDATA-escaped text', () => {
        expect(renderToString(createElement('textarea', null, 'a<b')).html)
            .toBe('<textarea>a&lt;b</textarea><!--root-->')
    })

    test('textarea atom child resolves to text', () => {
        expect(renderToString(createElement('textarea', null, atom('x'))).html)
            .toBe('<textarea>x</textarea><!--root-->')
    })

    test('textarea props.children fallback resolves to text', () => {
        expect(renderToString(createElement('textarea', {children: 'y'})).html)
            .toBe('<textarea>y</textarea><!--root-->')
    })
})

describe('renderToString RCDATA parents', () => {
    test('title children flatten: string + atom concatenate, boolean skipped, no axii markers', () => {
        const {html} = renderToString(createElement('title', null, 'Page ', atom('One'), false))
        expect(html).toBe('<title>Page One</title><!--root-->')
    })

    test('empty RCDATA parent emits no children', () => {
        expect(renderToString(createElement('title', null)).html).toBe('<title></title><!--root-->')
    })
})

describe('renderToString style sheet corners', () => {
    test('root-level nested style (outside any component) uses GLOBAL static id', () => {
        const {html, styles} = renderToString(createElement('div', {style: {':hover': {color: 'red'}}}))
        expect(styles).toContain('GLOBAL')
        expect(styles).toContain(':hover')
        expect(html).toMatch(/<div class="GLOBAL/)
    })

    test('null values inside nested style objects are dropped from emitted rules', () => {
        const {styles} = renderToString(createElement('div', {style: {':hover': {color: null, background: 'red'}}}))
        expect(styles).toContain('background:red')
        expect(styles).not.toContain('color:')
    })
})

describe('styleSerialize pure helpers', () => {
    test('evaluateStyleSnapshot resolves function items in returned arrays', () => {
        expect(evaluateStyleSnapshot(() => [() => 'red', 'blue'])).toEqual(['red', 'blue'])
    })

    test('styleValueNeedsStylesheet rejects primitives', () => {
        expect(styleValueNeedsStylesheet(5)).toBe(false)
        expect(styleValueNeedsStylesheet(null)).toBe(false)
        expect(styleValueNeedsStylesheet(undefined)).toBe(false)
        expect(styleValueNeedsStylesheet(true)).toBe(false)
        expect(styleValueNeedsStylesheet('color:red')).toBe(false)
    })

    test('isAcceptableSingleCssRule rejects unclosed rule', () => {
        expect(isAcceptableSingleCssRule('div {')).toBe(false)
    })

    test('isAcceptableSingleCssRule accepts escaped quote inside a string value', () => {
        expect(isAcceptableSingleCssRule('.a::before{content:"a\\"b"}')).toBe(true)
    })
})

describe('renderToString table tbody gating', () => {
    test('empty table emits no tbody', () => {
        expect(renderToString(createElement('table', null)).html).toBe('<table></table><!--root-->')
    })

    test('table with RxList rows wraps rows in explicit tbody', () => {
        const rows = new RxList([createElement('tr', null, createElement('td', null, '1'))])
        const {html} = renderToString(createElement('table', null, rows))
        expect(html).toContain('<table><tbody><tr>')
        expect(html).toContain('</tr><!--unhandledChild--></tbody></table><!--root-->')
    })

    test('table with array rows wraps rows in explicit tbody', () => {
        const {html} = renderToString(createElement('table', null, [createElement('tr', null)]))
        expect(html).toContain('<table><tbody><tr></tr>')
        expect(html).toContain('</tbody></table><!--root-->')
    })

    // #56: the decision follows what is written directly under the table, not the child's kind
    test('sections rendered by a list / function / array / fragment are not wrapped in another tbody', () => {
        const section = (n: number) => createElement('tbody', null, createElement('tr', null, createElement('td', null, String(n))))
        // [source, number of <tbody> the source itself renders]: the server adds none
        const cases: [any, number][] = [
            [new RxList([section(1), section(2)]), 2],
            [() => section(1), 1],
            [[section(1)], 1],
            [createElement(Fragment, null, createElement('thead', null), section(1)), 1],
            [new RxList<any>([]), 0],
            [() => null, 0],
        ]
        for (const [source, sections] of cases) {
            const {html} = renderToString(createElement('table', null, source))
            expect(html.match(/<tbody>/g)?.length ?? 0).toBe(sections)
        }
    })

    test('a function or component row under table still gets the explicit tbody', () => {
        const row = () => createElement('tr', null, createElement('td', null, 'f'))
        expect(renderToString(createElement('table', null, row)).html.startsWith('<table><tbody><tr>')).toBe(true)
        // a nested table decides for itself; the outer one only sees its own direct children
        const nested = renderToString(createElement('table', null, createElement('tbody', null, createElement('tr', null,
            createElement('td', null, createElement('table', null, row))))))
        expect(nested.html.match(/<tbody>/g)!.length).toBe(2)
    })
})

describe('renderToString #56 character-data function children and SVG shared tag names', () => {
    test('function children of title / textarea / style / script write their current text', () => {
        const n = atom(3)
        expect(renderToString(createElement('title', null, 'Inbox (', () => n(), ') ', () => null, () => false)).html)
            .toBe('<title>Inbox (3) </title><!--root-->')
        expect(renderToString(createElement('textarea', null, () => 'a<b')).html)
            .toBe('<textarea>a&lt;b</textarea><!--root-->')
        expect(renderToString(createElement('style', null, () => 'p>a{color:red}')).html)
            .toBe('<style>p>a{color:red}</style><!--root-->')
        expect(renderToString(createElement('script', {type: 'text/plain'}, 'x=', () => 1n)).html)
            .toBe('<script type="text/plain">x=1</script><!--root-->')
    })

    test('a function child of a character-data parent that returns structure still throws', () => {
        expect(() => renderToString(createElement('title', null, () => createElement('i', null, 'x'))))
            .toThrow('a function child of <title> must return text')
    })

    test('a / title / style / script under <svg> use the SVG attribute rules; outside svg and in foreignObject they stay HTML', () => {
        const a = (key: string) => createElement('a', {href: '#x', fillOpacity: 0.5, xlinkTitle: 't', 'data-k': key})
        const {html} = renderToString(createElement('div', null,
            createElement('svg', null, a('svg'), createElement('foreignObject', null, a('fo'))),
            a('html')))
        expect(html).toContain('<a href="#x" fill-opacity="0.5" xlink:title="t" data-k="svg">')
        expect(html).toContain('<a href="#x" fillOpacity="0.5" xlinkTitle="t" data-k="fo">')
        expect(html).toContain('<a href="#x" fillOpacity="0.5" xlinkTitle="t" data-k="html">')
    })
})

describe('renderToString StaticArray item types', () => {
    test('boolean array item emits only the array item comment (PrimitiveHost empty)', () => {
        expect(renderToString(createElement('div', null, [true])).html)
            .toBe('<div><!--array item--><!--unhandledChild--></div><!--root-->')
    })

    test('null array item emits EmptyHost pair', () => {
        expect(renderToString(createElement('div', null, [null])).html)
            .toBe('<div><!--empty--><!--array item--><!--unhandledChild--></div><!--root-->')
    })

    test('unsupported StaticArray item type throws', () => {
        expect(() => renderToString(createElement('div', null, [Symbol('x')]))).toThrow('unsupported StaticArray item type')
    })

    test('unsupported element child type throws', () => {
        expect(() => renderToString(createElement('div', null, Symbol('x')))).toThrow('unsupported child type')
    })

    test('unsupported RxList row type throws', () => {
        expect(() => renderToString(new RxList([Symbol('x')]))).toThrow('unsupported RxList row type')
    })
})

describe('renderToString component render-context corners', () => {
    test('__source/__self dev JSX fields are stripped from component props', () => {
        let seen: any
        function C(props: any) {
            seen = props
            return null
        }
        renderToString(createElement(C, {__source: {fileName: 'x'}, __self: {}, name: 'n'} as any))
        expect(seen.name).toBe('n')
        expect(seen.__source).toBeUndefined()
        expect(seen.__self).toBeUndefined()
    })

    test('ctx.createSVGElement passes tag/attrs through without _isSVG attribute', () => {
        function C({}, ctx: any) {
            return ctx.createSVGElement('circle', {cx: 5, cy: 6})
        }
        expect(renderToString(createElement(C, null)).html)
            .toBe('<circle cx="5" cy="6"></circle><!--root-->')
    })

    test('ctx.context.get returns undefined for a context that was never provided', () => {
        let got: unknown = 'sentinel'
        function C({}, ctx: any) {
            got = ctx.context.get({})
            return null
        }
        renderToString(createElement(C, null))
        expect(got).toBeUndefined()
    })

    test('ctx.context.set after renderToString finished throws', () => {
        let stash: any
        function C({}, ctx: any) {
            stash = ctx
            return null
        }
        renderToString(createElement(C, null))
        expect(() => stash.context.set({}, 1)).toThrow('context.set outside component')
    })

    test('ctx.createStateFromRef returns an inert stub (§3.4: no layout subscription)', () => {
        let state: any
        function C({}, ctx: any) {
            state = ctx.createStateFromRef()
            return null
        }
        renderToString(createElement(C, null))
        expect(state()).toBe(null)
        expect(() => state.ref()).not.toThrow()
    })

    test('reusable as element child emits content + reusable + unhandledChild', () => {
        function C({}, ctx: any) {
            return ctx.createElement('div', null, ctx.reusable(ctx.createElement('span', null, 'R')))
        }
        expect(renderToString(createElement(C, null)).html)
            .toBe('<div><span><!--axii:t-->R<!--axii:/t--></span><!--reusable--><!--unhandledChild--></div><!--root-->')
    })
})
