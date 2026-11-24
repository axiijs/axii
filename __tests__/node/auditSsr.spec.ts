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
            cb({checked: atom(true), value: atom(undefined)}),
        ]).toEqual([
            '<input type="checkbox" value="true" checked="true"/><!--root-->',
            '<input type="checkbox" value="0"/><!--root-->',
            '<input type="checkbox" checked="true"/><!--root-->',
            '<input type="checkbox" value="v"/><!--root-->',
            // #52：显式的 checked 永远生效，与书写顺序无关
            '<input type="checkbox" value="true"/><!--root-->',
            '<input type="checkbox" value="" checked="true"/><!--root-->',
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

    test('R3 checkbox: only a boolean value is a checked state, and only without a checked prop (#52)', () => {
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
        // boolean value without a checked prop: unchanged dual channel (§3.6.2 CB)
        expect([cb({value: true}), cb({value: false}), cb({value: null}), cb({value: undefined})]).toEqual([
            '<input type="checkbox" value="true" checked="true"/>', '<input type="checkbox" value="false"/>',
            '<input type="checkbox" value=""/>', '<input type="checkbox" value=""/>',
        ])
        // #52：显式的 checked 永远生效，与书写顺序无关；nullish 的 value 不触碰勾选状态
        expect([
            cb({value: true, checked: false}), cb({checked: false, value: true}),
            cb({value: false, checked: true}), cb({checked: true, value: false}),
            cb({checked: true, value: undefined}), cb({value: undefined, checked: true}),
            cb({checked: true, value: null}), cb({value: null, checked: true}),
            cb({checked: undefined, value: true}),
        ]).toEqual([
            '<input type="checkbox" value="true"/>', '<input type="checkbox" value="true"/>',
            '<input type="checkbox" value="false" checked="true"/>', '<input type="checkbox" value="false" checked="true"/>',
            '<input type="checkbox" value="" checked="true"/>', '<input type="checkbox" value="" checked="true"/>',
            '<input type="checkbox" value="" checked="true"/>', '<input type="checkbox" value="" checked="true"/>',
            '<input type="checkbox" value="true"/>',
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

// Follow-up review of #48: style / script text is RAWTEXT only in HTML content. Under <svg> / <math> the
// parser creates foreign elements and tokenizes their text as normal data — `<img …>` becomes an element.
describe('F9 raw-text elements inside foreign content (Node)', () => {
    const hostile = 'a>b{} <img src=x onerror=alert(1)> &amp;'
    const escaped = 'a&gt;b{} &lt;img src=x onerror=alert(1)&gt; &amp;amp;'
    const h = createElement as any
    const html = (el: any) => renderToString(el).html

    test('F9a <svg><style> / <svg><script> / <math><style> text is escaped, without axii:* markers', () => {
        expect(html(h('svg', null, h('style', null, hostile))))
            .toBe(`<svg><style>${escaped}</style></svg><!--root-->`)
        expect(html(h('svg', null, h('g', null, h('script', {_isSVG: true}, hostile, '</script>')))))
            .toBe(`<svg><g><script>${escaped}&lt;/script&gt;</script></g></svg><!--root-->`)
        expect(html(h('math', null, h('style', null, hostile))))
            .toBe(`<math><style>${escaped}</style></math><!--root-->`)
        // a component rendered inside <svg> inherits the context
        function Icon(_: any, {createElement}: RenderContext) {
            return createElement('style', null as any, hostile)
        }
        expect(html(h('svg', null, h(Icon, {}))))
            .toBe(`<svg><style>${escaped}</style><!--unhandledChild--></svg><!--root-->`)
    })

    test('F9 regression: HTML integration points and HTML content keep RAWTEXT (and its gate)', () => {
        const css = 'a>b{}'
        // (SVG <title> is also an integration point, but its own text is RCDATA-escaped by tag name either way)
        for (const point of ['foreignObject', 'desc']) {
            expect(html(h('svg', null, h(point, null, h('div', null, h('style', null, css))))))
                .toBe(`<svg><${point}><div><style>${css}</style></div></${point}></svg><!--root-->`)
        }
        expect(html(h('math', null, h('mi', null, h('style', null, css)))))
            .toBe(`<math><mi><style>${css}</style></mi></math><!--root-->`)
        expect(html(h('math', null, h('annotation-xml', {encoding: 'text/html'}, h('style', null, css)))))
            .toBe(`<math><annotation-xml encoding="text/html"><style>${css}</style></annotation-xml></math><!--root-->`)
        // createSVGElement('style') outside <svg> is parsed as an HTML <style>: still RAWTEXT
        expect(html(h('div', null, h('style', {_isSVG: true}, css)))).toBe(`<div><style>${css}</style></div><!--root-->`)
        expect(() => html(h('svg', null, h('foreignObject', null, h('style', null, '</style><b>')))))
            .toThrow('RAWTEXT termination sequence')
        // back in HTML after the svg closes; a nested <svg> inside foreignObject is foreign again
        expect(html(h('div', null, h('svg', null, h('foreignObject', null, h('svg', null, h('style', null, '<x>')))), h('style', null, css))))
            .toBe(`<div><svg><foreignObject><svg><style>&lt;x&gt;</style></svg></foreignObject></svg><style>${css}</style></div><!--root-->`)
        // MathML text integration point: mglyph stays MathML
        expect(html(h('math', null, h('mi', null, h('mglyph', null, h('style', null, '<x>'))))))
            .toBe('<math><mi><mglyph><style>&lt;x&gt;</style></mglyph></mi></math><!--root-->')
    })

    test('F9b <plaintext> in HTML content is refused; inside <svg> it is an ordinary element', () => {
        expect(() => html(h('div', null, h('plaintext', null, 'x'), h('p', null, 'after'))))
            .toThrow('<plaintext> cannot be serialized')
        expect(html(h('svg', null, h('plaintext', null, '<x>'))))
            .toBe('<svg><plaintext><!--axii:t-->&lt;x&gt;<!--axii:/t--></plaintext></svg><!--root-->')
    })
})

// #49：名字以 on 开头（不区分大小写）、但不是合法事件处理器的 prop 在服务端同样不写；
//  值是函数时也不能被当成响应式属性求值（ONCLICK: fn 曾经在服务端被调用、返回值写进 HTML）。
describe('#49 on* props that are not event handlers are never serialized (Node)', () => {
    test('case variants, plain on* names and function values are dropped; a bare `on` is kept', () => {
        const calls: string[] = []
        const fn = (name: string) => () => { calls.push(name); return 'alert(1)' }
        const node = createElement('div', null,
            createElement('div', {ONCLICK: 'alert(1)', oNclick: 'alert(1)', onclick: 'alert(1)', OnClick: 'alert(1)'}),
            createElement('div', {once: 'x', online: 'y', 'on-click': 'z'}),
            createElement('svg', {ONCLICK: fn('ONCLICK'), oNclick: fn('oNclick'), onclick: atom('alert(1)')}),
            createElement('button', {on: 'tap:lightbox', onClick: fn('onClick')}),
        )
        const original = console.error
        console.error = () => {}
        try {
            expect({html: renderToString(node).html, calls}).toEqual({
                html: '<div><div></div><div></div><svg></svg><button on="tap:lightbox"></button></div><!--root-->',
                calls: [],
            })
        } finally {
            console.error = original
        }
    })
})
