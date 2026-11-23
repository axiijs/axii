/**
 * Audit: renderToString (Node, no DOM). The F* tests fail on pristine v4.8.1 and pass with the fixes in src/;
 * the "regression" / X* blocks pin the fixed behaviour.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/audit-ssr.spec.ts
 */
import {describe, expect, test} from 'vitest'
import {atom} from 'data0'
import {createElement, renderToString} from '../../src/ssr.js'
import PropTypes from '../../src/propTypes.js'
import type {RenderContext} from '../../src/types.js'

describe('F6 component prop pipeline (Node)', () => {
    test('F6a propTypes defaults reach the component on the server', () => {
        function Label(props: any, {createElement}: RenderContext) {
            return createElement('div', null, props.label)
        }
        ;(Label as any).propTypes = {label: PropTypes.string.default(() => 'dflt')}
        expect(renderToString(createElement(Label as any, {})).html)
            .toBe('<div><!--axii:t-->dflt<!--axii:/t--></div><!--root-->')
    })

    test('F6c `as` is a framework prop: not an HTML attribute; CSR writes data-as', () => {
        function Card(_: any, {createElement}: RenderContext) {
            return createElement('div', {as: 'root'}, 'x')
        }
        const {html} = renderToString(createElement(Card as any, {'$root:className': 'over'}))
        expect(html).toBe('<div data-as="root" class="over"><!--axii:t-->x<!--axii:/t--></div><!--root-->')
    })
})

describe('F7 element props (Node)', () => {
    test('F7a checked={atom(false)} is not emitted as checked', () => {
        expect(renderToString(createElement('input', {type: 'checkbox', checked: atom(false)})).html)
            .toBe('<input type="checkbox"/><!--root-->')
    })

    test('F7b function-valued value is evaluated, never stringified as source code', () => {
        const input = renderToString(createElement('input', {value: () => 'hello'})).html
        const textarea = renderToString(createElement('textarea', {value: () => 'hello'})).html
        expect({input, textarea}).toEqual({
            input: '<input value="hello"/><!--root-->',
            textarea: '<textarea>hello</textarea><!--root-->',
        })
    })

    test('F7c className array (accepted by createElement.isValidAttribute) keeps its class names', () => {
        expect(renderToString(createElement('div', {className: ['a', 'b']})).html)
            .toBe('<div class="a b"></div><!--root-->')
    })

    test('F7d dangerouslySetInnerHTML string (the CSR contract: node.innerHTML = value) is embedded', () => {
        expect(renderToString(createElement('div', {dangerouslySetInnerHTML: '<em>raw</em>'})).html)
            .toBe('<div><em>raw</em></div><!--root-->')
    })
})

describe('F7 regression (Node)', () => {
    test('value snapshot never calls event handlers or refs', () => {
        const calls: string[] = []
        const html = renderToString(createElement('input', {
            value: () => 'v',
            onInput: () => { calls.push('onInput') },
            onChange: [() => { calls.push('onChange') }],
            ref: () => { calls.push('ref') },
        })).html
        expect({html, calls}).toEqual({html: '<input value="v"/><!--root-->', calls: []})
    })

    test('CB / CK matrix holds for reactive values', () => {
        const cb = (props: any) => renderToString(createElement('input', {type: 'checkbox', ...props})).html
        expect([
            cb({value: atom(true)}), cb({value: atom(0)}), cb({checked: () => true}),
            cb({value: atom('v'), checked: atom(false)}), cb({checked: atom(false), value: atom(true)}),
        ]).toEqual([
            '<input type="checkbox" value="true" checked="true"/><!--root-->',
            '<input type="checkbox" value="0"/><!--root-->',
            '<input type="checkbox" checked="true"/><!--root-->',
            '<input type="checkbox" value="v"/><!--root-->',
            '<input type="checkbox" value="true" checked="true"/><!--root-->',
        ])
    })

    test('select value / option value as functions drive selected; className shapes', () => {
        expect(renderToString(createElement('select', {value: () => 'b'},
            createElement('option', {value: 'a'}, 'A'), createElement('option', {value: 'b'}, 'B'))).html)
            .toContain('<option value="b" selected="true">')
        expect(renderToString(createElement('div', {
            className: ['a', false, null, {on: atom(true), off: atom(false), fn: () => true}, () => 'late'],
        })).html).toBe('<div class="a on fn late"></div><!--root-->')
    })

    test('dangerouslySetInnerHTML: function form, nullish clears children, {__html} unchanged', () => {
        expect(renderToString(createElement('div', {dangerouslySetInnerHTML: () => '<i>f</i>'})).html)
            .toBe('<div><i>f</i></div><!--root-->')
        expect(renderToString(createElement('div', {dangerouslySetInnerHTML: undefined}, 'child')).html)
            .toBe('<div></div><!--root-->')
        expect(renderToString(createElement('div', {dangerouslySetInnerHTML: {__html: '<em>x</em>'}} as any)).html)
            .toBe('<div><em>x</em></div><!--root-->')
    })
})

describe('X3 reactive attributes are serialized (Node)', () => {
    test('function / atom attributes are snapshotted; handlers, refs and config keys are never called', () => {
        const calls: string[] = []
        const spy = (name: string) => () => { calls.push(name); return name }
        const html = renderToString(createElement('a', {
            id: atom('link'),
            href: () => '/x',
            className: () => ['c', {on: atom(true)}],
            hidden: atom(false),
            disabled: () => true,
            'aria-expanded': () => false,
            title: ['a', () => 'last'],
            tabIndex: () => null,
            onClick: spy('onClick'),
            onclick: spy('onclick'),
            ref: spy('ref'),
            '$root:onClick': spy('$root:onClick'),
            'prop:render': spy('prop:render'),
        })).html
        expect({html, calls}).toEqual({
            html: '<a id="link" href="/x" disabled="true" aria-expanded="false" title="last" class="c on"></a><!--root-->',
            calls: [],
        })
    })

    test('reactive input type selects the checkbox channel', () => {
        expect(renderToString(createElement('input', {type: () => 'checkbox', value: atom(true)})).html)
            .toBe('<input type="checkbox" value="true" checked="true"/><!--root-->')
    })
})

// Server markup against the CSR rules introduced by the DOM / styles reviewers' patches
// (DOM.ts setEmptyOrBooleanProperty rule table, checkbox value, SVG presentation attributes, uuid, data-*).
// These assert the SERVER string; the browser-side SSR ≡ CSR comparison needs the merged CSR code.
describe('R1–R6 serializeAttrs follows the new CSR attribute rules (Node)', () => {
    const html = (tag: string, props: any, ...children: any[]) => {
        const out = renderToString(createElement(tag, props, ...children)).html
        return out.slice(0, out.length - '<!--root-->'.length)
    }

    test('R1 true on a string-typed property is written as x=""; keyword names keep their keyword', () => {
        expect(html('a', {download: true, href: true, title: true})).toBe('<a download="" href="" title=""></a>')
        expect(html('div', {popover: true})).toBe('<div popover=""></div>')
        expect(html('img', {alt: true})).toBe('<img alt=""/>')
        expect(html('input', {placeholder: true})).toBe('<input placeholder=""/>')
        // exceptions: boolean keyword kept (translate's keywords are yes / no)
        expect(html('div', {
            contentEditable: true, writingSuggestions: true, 'aria-hidden': true, ariaExpanded: true,
            draggable: true, spellcheck: true, translate: true, 'data-on': true,
        })).toBe('<div contentEditable="true" writingSuggestions="true" aria-hidden="true" aria-expanded="true" '
            + 'draggable="true" spellcheck="true" translate="yes" data-on="true"></div>')
        // custom elements and SVG elements: attribute semantics, "true"
        expect(html('my-el', {title: true, download: true})).toBe('<my-el title="true" download="true"></my-el>')
        expect(html('svg', {title: true})).toBe('<svg title="true"></svg>')
        // real boolean attributes keep the documented §3.6.1 form
        expect(html('input', {disabled: true, required: true})).toBe('<input disabled="true" required="true"/>')
    })

    test('R2 false / undefined: omitted on string and number properties, literal for keyword attributes', () => {
        expect(html('a', {title: false, href: undefined, download: false, maxLength: false, hidden: false, popover: false}))
            .toBe('<a></a>')
        expect(html('div', {
            spellCheck: false, contentEditable: false, draggable: false, 'aria-expanded': false, 'data-on': false,
            writingSuggestions: false, ariaPressed: false, translate: false,
        })).toBe('<div spellCheck="false" contentEditable="false" draggable="false" aria-expanded="false" data-on="false" '
            + 'writingSuggestions="false" aria-pressed="false" translate="no"></div>')
        expect(html('p', {spellcheck: false, contenteditable: false})).toBe('<p spellcheck="false" contenteditable="false"></p>')
        // SVG / custom elements: only the attribute-branch keywords survive
        expect(html('svg', {draggable: false, spellCheck: false, 'aria-hidden': false}))
            .toBe('<svg spellCheck="false" aria-hidden="false"></svg>')
        expect(html('my-el', {draggable: false, translate: false, 'data-x': false})).toBe('<my-el data-x="false"></my-el>')
    })

    test('R3 checkbox: only a boolean / nullish value is a checked state', () => {
        const cb = (props: any) => html('input', {type: 'checkbox', ...props})
        expect([
            cb({value: 'red'}), cb({value: 1}), cb({value: 0}),
            cb({value: 'red', checked: true}), cb({checked: true, value: 'red'}), cb({checked: false, value: 'red'}),
            cb({value: () => 'red', checked: atom(true)}),
        ]).toEqual([
            '<input type="checkbox" value="red"/>', '<input type="checkbox" value="1"/>', '<input type="checkbox" value="0"/>',
            '<input type="checkbox" value="red" checked="true"/>', '<input type="checkbox" value="red" checked="true"/>',
            '<input type="checkbox" value="red"/>',
            '<input type="checkbox" value="red" checked="true"/>',
        ])
        // boolean / nullish value: unchanged dual channel (§3.6.2 CB)
        expect([cb({value: true}), cb({value: false}), cb({value: null}), cb({value: true, checked: false}), cb({checked: false, value: true})])
            .toEqual([
                '<input type="checkbox" value="true" checked="true"/>', '<input type="checkbox" value="false"/>',
                '<input type="checkbox" value=""/>', '<input type="checkbox" value="true"/>',
                '<input type="checkbox" value="true" checked="true"/>',
            ])
    })

    test('R4 SVG: camelCase is dash-converted only for presentation attributes (exact names)', () => {
        expect(html('path', {fillRule: 'evenodd', clipRule: 'evenodd', strokeWidth: 2, strokeLinecap: 'round', fillOpacity: 0.5}))
            .toBe('<path fill-rule="evenodd" clip-rule="evenodd" stroke-width="2" stroke-linecap="round" fill-opacity="0.5"></path>')
        expect(html('stop', {stopColor: 'red', stopOpacity: 1})).toBe('<stop stop-color="red" stop-opacity="1"></stop>')
        expect(html('text', {textAnchor: 'middle', dominantBaseline: 'central', fontSize: 12}))
            .toBe('<text text-anchor="middle" dominant-baseline="central" font-size="12"></text>')
        // native camelCase attributes and non-presentation names stay as authored
        expect(html('svg', {viewBox: '0 0 1 1', preserveAspectRatio: 'none'})).toBe('<svg viewBox="0 0 1 1" preserveAspectRatio="none"></svg>')
        expect(html('linearGradient', {gradientUnits: 'userSpaceOnUse', gradientTransform: 'rotate(1)'}))
            .toBe('<linearGradient gradientUnits="userSpaceOnUse" gradientTransform="rotate(1)"></linearGradient>')
        expect(html('marker', {markerWidth: 3, strokeWidthX: 1})).toBe('<marker markerWidth="3" strokeWidthX="1"></marker>')
        // HTML elements are not converted
        expect(html('div', {fillRule: 'evenodd'})).toBe('<div fillRule="evenodd"></div>')
    })

    test('R5 uuid → data-uuid (nullish: none); htmlFor → for; hidden={true} → hidden=""', () => {
        expect(html('div', {uuid: 'u1'})).toBe('<div data-uuid="u1"></div>')
        expect(html('div', {uuid: () => 7})).toBe('<div data-uuid="7"></div>')
        expect(html('div', {uuid: null})).toBe('<div></div>')
        expect(html('div', {uuid: undefined})).toBe('<div></div>')
        expect(html('label', {htmlFor: 'q'}, 'l')).toBe('<label for="q"><!--axii:t-->l<!--axii:/t--></label>')
        expect(html('label', {htmlFor: false})).toBe('<label></label>')
        expect(html('div', {hidden: true})).toBe('<div hidden=""></div>')
        expect(html('div', {hidden: () => true})).toBe('<div hidden=""></div>')
        expect(html('div', {ariaLabel: 'close'})).toBe('<div aria-label="close"></div>')
    })

    test('R6 data-*: literal authored name for reactive values; an array is stringified as a whole', () => {
        expect(html('div', {'data-item_id': atom('7'), 'data-level-1': () => 'x', 'data-camelCase': atom(1)}))
            .toBe('<div data-item_id="7" data-level-1="x" data-camelCase="1"></div>')
        expect(html('div', {'data-x': [1, 2]})).toBe('<div data-x="1,2"></div>')
        expect(html('div', {'data-ids': [atom(1), () => 2, 3]})).toBe('<div data-ids="1,2,3"></div>')
        expect(html('div', {'data-n': () => null, 'data-f': atom(false)})).toBe('<div data-f="false"></div>')
        // other attributes keep the overwrite semantics: last item wins
        expect(html('div', {title: ['a', 'b']})).toBe('<div title="b"></div>')
    })
})

describe('X6 <script> double-escape gate (Node)', () => {
    const script = (text: string) => renderToString(createElement('script', {type: 'application/json'}, text)).html
    test('payload that would leave the tokenizer double-escaped throws', () => {
        expect(() => script('{"x":"<!--<script>"}')).toThrow('would not be closed')
        expect(() => script('<!-- a --> ok <!--\n<SCRIPT ')).toThrow('would not be closed')
    })
    test('payloads that end in script data / escaped state are emitted unchanged', () => {
        for (const text of ['if (a<!--b) {}', '<!--<script>-->', '<!--<scripted>', '<!--><script>', 'x<script>y', '<!--<script', '<!-- <script x --> <script>']) {
            expect(script(text)).toBe(`<script type="application/json">${text}</script><!--root-->`)
        }
    })
})

describe('F8 names are emitted verbatim (Node)', () => {
    test('F8a attribute name with spaces / = / > is rejected or dropped', () => {
        let html = ''
        try {
            html = renderToString(createElement('div', {'x onmouseover=alert(1) y': 'v'})).html
        } catch {
            return // throwing is an acceptable outcome (CSR setAttribute throws InvalidCharacterError)
        }
        expect(html).not.toContain('onmouseover=alert(1)')
    })

    test('F8 regression: legal names are untouched; a hostile name with a removed value does not throw', () => {
        // CSR: null/false go through removeAttribute, which does not validate the name
        expect(renderToString(createElement('my-el', {
            'data-x': '1', 'aria-label': 'l', 'xlink:href': '#a', 'x y': null, 'a>b': false,
        })).html).toBe('<my-el data-x="1" aria-label="l" xlink:href="#a"></my-el><!--root-->')
        expect(() => renderToString(createElement('div', {'': 'v'}))).toThrow('invalid attribute name')
        expect(() => renderToString(createElement('1div', null))).toThrow('invalid tag name')
    })

    test('F8b tag name with > is rejected', () => {
        let html = ''
        try {
            html = renderToString(createElement('div><script>alert(1)</script', null)).html
        } catch {
            return
        }
        expect(html).not.toContain('<script>')
    })
})
