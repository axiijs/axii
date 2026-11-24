/**
 * Audit regressions for the DOM-free style serializer (styleSerialize.ts) and its SSR consumer.
 * Browser-side coverage lives in __tests__/audit-attrs.spec.tsx.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/auditStyleSerialize.spec.ts
 */
import {afterEach, describe, expect, test} from 'vitest'
import {createElement, renderToString} from '../../src/ssr.js'
import {generateStyleContent, isAcceptableInlineDeclaration, setAutoUnitType} from '../../src/styleSerialize.js'

const lastSelector = (rules: string[]) => rules.at(-1)!.split('{')[0].trim()

describe('audit: style serialization without a DOM', () => {
    afterEach(() => setAutoUnitType('px'))

    test('a selector nested under a selector list is expanded against every parent', () => {
        expect(lastSelector(generateStyleContent('.x', {'&.a, &.b': {'& span': {color: 'red'}}})))
            .toBe('.x.a span, .x.b span')
        expect(lastSelector(generateStyleContent('.x', {'& .a': {'& .b, & .c': {'&:hover': {color: 'red'}}}})))
            .toBe('.x .a .b:hover, .x .a .c:hover')
        // single parents keep the previous text
        expect(lastSelector(generateStyleContent('.x', {'&:hover': {'& > a': {color: 'red'}}}))).toBe('.x:hover > a')
    })

    test('animation: later longhands follow the shorthand, falsy array items are skipped', () => {
        const rules = generateStyleContent('.x', {
            animationDelay: '1s',
            animation: ['spin 1s', null, false && 'never', undefined],
            animationPlayState: 'paused',
            'animation-iteration-count': 2,
            color: 'red',
        })
        expect(rules[0]).toContain('animation-delay:1s;')
        const animationRule = rules.at(-1)!
        expect(animationRule).toContain('animation: spin 1s;')
        expect(animationRule).toContain('animation-play-state:paused;')
        expect(animationRule).toContain('animation-iteration-count:2;')
        // the longhand written before the shorthand and unrelated declarations are not repeated
        expect(animationRule).not.toContain('animation-delay')
        expect(animationRule).not.toContain('color')
        // an all-falsy array is no animation at all
        expect(generateStyleContent('.x', {animation: [null, false], color: 'red'}).length).toBe(1)
    })

    test('[number, unit] tuples work for time units; real comma lists stay comma lists', () => {
        const {html} = renderToString(createElement('div', {style: {
            transitionDuration: [300, 'ms'],
            transitionDelay: ['1s', '2s'],
            animationIterationCount: [1, 'infinite'],
            padding: [1, 'px'],
        }}))
        expect(html).toContain('transition-duration:300ms;transition-delay:1s,2s;animation-iteration-count:1,infinite;padding:1px')
    })

    // 「后写的条目赢」：stylesheet 条目把它的顶层属性从前面的行内声明里拿走，
    //  前面的行内条目本身留在行内（不搬进 stylesheet，不为它建表）。
    test('SSR: a stylesheet entry takes its top-level properties back from earlier inline entries', () => {
        const {html, styles} = renderToString(createElement('div', {style: [
            {color: 'blue', marginTop: 3},
            {color: 'red', '&:hover': {opacity: 0.8}},
            {paddingTop: 7},
        ]}))
        expect(html).toMatch(/ style="margin-top:3px;padding-top:7px"/)
        const classes = /class="([^"]+)"/.exec(html)![1].split(' ')
        expect(classes.length).toBe(1)
        expect(styles).toContain('color:red;')
        expect(styles).not.toContain('color:blue')
        expect(styles).not.toContain('margin-top')
    })

    test('SSR inline composition: same property updated in place, empty values remove, shorthand yields its longhands', () => {
        const render = (style: any) => /style="([^"]*)"/.exec(renderToString(createElement('div', {style})).html)?.[1]
        expect(render([{color: 'blue', marginTop: 1}, () => ({color: 'red'})])).toBe('color:red;margin-top:1px')
        expect(render([{color: 'blue', marginTop: 1}, () => ({color: null})])).toBe('margin-top:1px')
        // a later inline entry writes the property back
        expect(render([{color: 'blue'}, {color: 'red', '&:hover': {opacity: 1}}, {color: 'green'}])).toBe('color:green')
        // removing a shorthand removes the longhands written inline before it
        expect(render([{marginTop: 1, marginLeft: 2, padding: 3}, {margin: 0, '&:hover': {opacity: 1}}])).toBe('padding:3px')
        // a declaration the stylesheet does not write does not take anything back
        expect(render([{color: 'blue'}, {color: null, '&:hover': {opacity: 1}}])).toBe('color:blue')
        // custom properties only remove themselves
        expect(render([{'--a': '1', '--a-b': '2'}, {'--a': '3', '&:hover': {opacity: 1}}])).toBe('--a-b:2')
    })

    test('SSR inline composition: a yielding shorthand removes only its own longhands, never same-prefix properties', () => {
        const render = (style: any) => /style="([^"]*)"/.exec(renderToString(createElement('div', {style})).html)?.[1]
        const hover = {'&:hover': {opacity: 1}}
        // flex resets flex-grow / flex-shrink / flex-basis, not flex-direction / flex-wrap
        expect(render([{display: 'flex', flexDirection: 'column', flexGrow: 2}, {flex: 1, ...hover}]))
            .toBe('display:flex;flex-direction:column')
        // border resets the side / width / style / color / image longhands, not border-radius / border-collapse
        expect(render([{borderRadius: 4, borderTopColor: 'red', borderCollapse: 'collapse'}, {border: '1px solid', ...hover}]))
            .toBe('border-radius:4px;border-collapse:collapse')
        // border-top resets its three longhands, not the corner radii that share its prefix
        expect(render([{borderTopLeftRadius: '4px', borderTopWidth: 2}, {borderTop: '1px solid', ...hover}]))
            .toBe('border-top-left-radius:4px')
        // outline does not reset outline-offset; margin does not reset the logical margin-inline-start
        expect(render([{outlineOffset: '2px', outlineColor: 'red'}, {outline: '1px solid', ...hover}])).toBe('outline-offset:2px')
        expect(render([{marginInlineStart: '3px', marginTop: 1}, {margin: 0, ...hover}])).toBe('margin-inline-start:3px')
        // shorthands whose longhands do not share their name
        expect(render([{top: 1, left: 2, color: 'red'}, {inset: 0, ...hover}])).toBe('color:red')
        expect(render([{rowGap: 1, columnGap: 2, color: 'red'}, {gap: 0, ...hover}])).toBe('color:red')
    })

    test('without a later stylesheet entry nothing is taken back', () => {
        const plain = renderToString(createElement('div', {style: [{color: 'blue'}, {paddingTop: 7}]}))
        expect(plain.html).toBe('<div style="color:blue;padding-top:7px"></div><!--root-->')
        expect(plain.styles).toBe('')
        // a stylesheet entry first, plain entries after it: they stay inline
        const sheetFirst = renderToString(createElement('div', {style: [{'&:hover': {opacity: 0.8}}, {color: 'blue'}]}))
        expect(sheetFirst.html).toMatch(/ style="color:blue"/)
        expect(sheetFirst.styles).not.toContain('color:blue')
        // only nested rules after an inline entry: nothing to take back (known limitation, README
        //  "Style arrays": the hover rule does not beat the earlier inline value, same as v4.8.1)
        const nestedOnly = renderToString(createElement('div', {style: [{color: 'blue'}, {'&:hover': {color: 'red'}}]}))
        expect(nestedOnly.html).toMatch(/ style="color:blue"/)
    })

    // #57：服务端把字符串条目当作不透明文本，后面条目的让位 / 空值删除够不到它里面的声明
    //  （也够不到排在字符串条目之前、已经落成文本的对象条目）。CSR 经 CSSOM 删除，都能删掉。
    test('SSR: later removals reach declarations written by string entries and by entries before them', () => {
        const render = (style: any) => /style="([^"]*)"/.exec(renderToString(createElement('div', {style})).html)?.[1]
        const hover = {'&:hover': {opacity: 1}}
        // a stylesheet entry takes its property back from a string entry (names are case-insensitive)
        expect(render(['color: blue; margin-top: 3px', {color: 'red', ...hover}])).toBe('margin-top: 3px')
        expect(render(['COLOR: blue;margin-top:3px', {color: 'red', ...hover}])).toBe('margin-top:3px')
        // !important in the string does not keep it (CSSOM el.style[k] = '' removes it too)
        expect(render(['color: blue !important; margin-top: 3px', {color: 'red', ...hover}])).toBe('margin-top: 3px')
        // a yielding shorthand removes the string's longhands, as for object entries
        expect(render(['margin-top: 1px; padding: 2px', {margin: 0, ...hover}])).toBe('padding: 2px')
        // an object entry before a string entry is reached too
        expect(render([{color: 'blue', paddingTop: 1}, 'margin-top: 3px', {color: 'red', ...hover}]))
            .toBe('padding-top:1px;margin-top: 3px')
        // an empty value in a later plain entry removes the string's declaration
        expect(render(['color: blue; margin-top: 3px', {color: null}])).toBe('margin-top: 3px')
        expect(render(['--a: 1; --A: 2', {'--a': null}])).toBe('--A: 2')
        // nothing removed: the string stays exactly as written
        expect(render(['color: blue ;  margin-top:3px;', {paddingTop: 1, ...hover}])).toBe('color: blue ;  margin-top:3px;')
    })

    test('SSR: a string entry the server cannot split exactly stays as written', () => {
        const render = (style: any) => /style="([^"]*)"/.exec(renderToString(createElement('div', {style})).html)?.[1]
        const yieldColor = {color: 'red', '&:hover': {opacity: 1}}
        // quoted and parenthesised separators are not declaration boundaries
        expect(render(['font-family: "a;b"; color: blue; background: url(data:a;b)', yieldColor]))
            .toBe('font-family: &quot;a;b&quot;;background: url(data:a;b)')
        expect(render(['background: url( "x;y" ); color: blue', yieldColor])).toBe('background: url( &quot;x;y&quot; )')
        // anything the browser tokenizes differently from a plain scan is left alone
        for (const text of [
            'content: "a\\"b"; color: blue',          // escape
            'font-family: a\\;color: blue; margin-top: 1px',           // escaped ";" outside a string
            'content: "\\"; color: blue; margin-top: 1px; quotes: "x"', // escaped quote inside a string
            'color: blue; content: "abc',              // unterminated string
            'color: blue /* x',                        // unterminated comment
            'color: blue; width: calc(1px',            // unclosed parenthesis
            'color: blue; width: calc(1px]',           // mismatched bracket
            'color: blue; background: url(a(b)',       // bad url: the browser ends it at the first ")"
            'color: blue; background: url(a b)',       // bad url
            'color: blue; --x: {a}',                   // block
            'color: blue; 1x: y',                      // not a property name
            'color: blue; /* only a comment */',
        ]) {
            expect(render([text, yieldColor])).toBe(text.replace(/"/g, '&quot;'))
        }
    })

    test('stylesheet and SSR declarations pass the same gate as inline declarations', () => {
        const rules = generateStyleContent('.x', {
            color: 'red;position:fixed',
            width: '1px !important',
            fontFamily: 'a}b',
            backgroundImage: 'url("data:image/png;base64,AA")',
            marginTop: 3,
            '&:hover': {color: 'blue}body{display:none'},
            '@keyframes': {from: {opacity: '0;position:fixed'}},
            animation: '@self 1s;position:fixed',
        }).join('\n')
        expect(rules).not.toContain('position')
        expect(rules).not.toContain('important')
        expect(rules).not.toContain('a}b')
        expect(rules).not.toContain('display:none')
        expect(rules).not.toContain('animation:')
        expect(rules).toContain('background-image:url("data:image/png;base64,AA");')
        expect(rules).toContain('margin-top:3px;')

        const {html, styles} = renderToString(createElement('div', {style: {color: 'red;position:fixed', '&:hover': {opacity: 1}}}))
        expect(styles).not.toContain('position')
        expect(html).not.toContain('position')
    })

    // #78：门闩按浏览器的 CSS 词法判断（浏览器侧的 computed 对照见 __tests__/styleDeclarationGate.spec.tsx）
    test('values the browser tokenizes into more than one declaration never reach a rule or a style attribute', () => {
        const hostile: [string, string][] = [
            ['backgroundImage', 'url(a(b);position:fixed;x:())'],   // bad-url ends at the first ")"
            ['backgroundImage', 'url(a"b);position:fixed;x:("c)'],
            ['backgroundImage', 'url(a b(c);position:fixed;x:())'],
            ['backgroundImage', '\\75rl(a(b);position:fixed;x:())'], // an escaped name is still url(
            ['backgroundImage', 'u\\72 l(a(b);position:fixed;x:())'],
            ['backgroundImage', 'u\\72\r\nl(a(b);position:fixed;x:())'],
            ['content', '"a\r;position:fixed;x:"'],                  // \r and \f end a string like \n
            ['content', '"a\f;position:fixed;x:"'],
            ['color', 'hover, & {position:fixed}'],                  // re-parsed as a nested rule
            ['--', 'hover, & {position:fixed}'],                     // "--" alone is not a custom property
            ['color', '(<!--url(/*));position:fixed;*/))'],          // "<!--" is one token: url( after it is a url token
            ['color', 'f(<!--url(a")"))'],
            ['color', 'f(<!--url(/*));}body{display:none}x{*/))'],
        ]
        for (const [key, value] of hostile) {
            const style = {[key]: value, marginTop: 3}
            const rules = generateStyleContent('.x', style).join('\n')
            expect({key, value, rules}).toEqual({key, value, rules: '.x {\nmargin-top:3px;\n}'})
            const sheetPath = renderToString(createElement('div', {style: {...style, '&:hover': {opacity: 1}}}))
            const inlinePath = renderToString(createElement('div', {style}))
            expect([sheetPath.styles, sheetPath.html, inlinePath.html].join('\n')).not.toMatch(/position|display/)
            expect(inlinePath.html).toContain('style="margin-top:3px"')
        }
    })

    test('style keys cannot make the SSR stylesheet grow another rule', () => {
        for (const key of [
            '@media <!--url(/*){}body{display:none}@media x{*/)',
            '& <!--url(/*){}body{display:none}x{*/)',
            '@x;body',                                               // ";" ends an at-rule prelude
        ]) {
            const {styles} = renderToString(createElement('div', {style: {marginTop: 3, [key]: {color: 'red'}}}))
            expect({key, styles}).toEqual({key, styles: expect.not.stringMatching(/body|color/)})
            expect(styles).toContain('margin-top:3px;')
        }
    })

    test('legal values the browser reads as one declaration are kept, and their rules survive the SSR rule gate', () => {
        const legal: Record<string, string> = {
            backgroundImage: 'url(a}b.png)',
            listStyleImage: 'url(a\\29 b.png)',
            fontFamily: 'a\\}b',
            color: 'rgb(1, 2, 3) /* } */',
            quotes: '"{" "}"',
            content: '"a\\\r\nb"',
            '--json': '{"k": [1, 2]}',
            '--y': 'a {b} c',
        }
        const rules = generateStyleContent('.x', legal).join('\n')
        for (const value of Object.values(legal)) expect(rules).toContain(`:${value};`)
        const {styles} = renderToString(createElement('div', {style: {...legal, marginTop: 3, '&:hover': {opacity: 1}}}))
        for (const value of Object.values(legal)) expect(styles).toContain(`:${value};`)
        expect(styles).toContain('margin-top:3px;')
    })

    // Chromium 把所有非 ASCII 当名字字符；现行 CSS Syntax 3 只认其中若干区段，U+00A0 不在内。SSR 的输出由各家
    //  引擎解析：名字在非 ASCII 字符之后的部分是 url 时，两种引擎的分界不同（函数 / url token），一律拒绝。
    test('a url( right after a non-ASCII character is rejected: engines disagree on where that token ends', () => {
        expect(isAcceptableInlineDeclaration('background-image', '\u00A0url(a(b);position:fixed;x:())')).toBe(false)
        expect(isAcceptableInlineDeclaration('--x', 'a\u00A0URL(a"b);position:fixed;x:("c)')).toBe(false)
        expect(isAcceptableInlineDeclaration('--x', '#\u00A0url(a(b);c)')).toBe(false)
        expect(isAcceptableInlineDeclaration('background-image', '\u00A0url(a.png)')).toBe(false)
        expect(isAcceptableInlineDeclaration('content', 'caf\u00e9url( a/*)')).toBe(false)
        expect(isAcceptableInlineDeclaration('--x', 'caf\u00e9(a(b);c)')).toBe(true)
        expect(isAcceptableInlineDeclaration('--x', '#url(a(b);c)')).toBe(true)
    })

    test('the gate rejects nesting deeper than its block stack holds, so a hostile value cannot grow it', () => {
        const nested = (depth: number) => `${'calc('.repeat(depth)}1px${')'.repeat(depth)}`
        expect(isAcceptableInlineDeclaration('width', nested(1024))).toBe(true)
        expect(isAcceptableInlineDeclaration('width', nested(1025))).toBe(false)
        expect(isAcceptableInlineDeclaration('--x', `${'{'.repeat(200000)}${'}'.repeat(200000)}`)).toBe(false)
        expect(isAcceptableInlineDeclaration('width', 'calc(1px + (2px * 3))')).toBe(true)
    })

    test('property names follow what el.style accepts: cssFloat and lower-case vendor prefixes', () => {
        const sheet = generateStyleContent('.x', {cssFloat: 'left', webkitLineClamp: 2, WebkitBoxOrient: 'vertical', mozAppearance: 'none', '--a-B': '1'}).join('\n')
        expect(sheet).toContain('float:left;')
        expect(sheet).toContain('-webkit-line-clamp:2;')
        expect(sheet).toContain('-webkit-box-orient:vertical;')
        expect(sheet).toContain('-moz-appearance:none;')
        expect(sheet).toContain('--a-B:1;')
        expect(sheet).not.toContain('css-float')
        const inline = (style: any) => /style="([^"]*)"/.exec(renderToString(createElement('div', {style})).html)?.[1]
        expect(inline({cssFloat: 'left', webkitLineClamp: 2})).toBe('float:left;-webkit-line-clamp:2')
        expect(inline([{cssFloat: 'left'}, () => ({webkitLineClamp: 2})])).toBe('float:left;-webkit-line-clamp:2')
    })

    test('the auto unit set through the public entry reaches SSR inline styles and rules', async () => {
        (globalThis as any).__DEV__ = true
        const framework = await import('../../src/index.js')
        expect(framework.setAutoUnitType).toBe(setAutoUnitType)
        framework.setAutoUnitType('rem')
        const {html, styles} = renderToString(createElement('div', null,
            createElement('p', {style: {width: 10}}),
            createElement('p', {style: {width: 10, '&:hover': {marginLeft: 3}}}),
        ))
        expect(html).toContain('style="width:10rem"')
        expect(styles).toContain('width:10rem;')
        expect(styles).toContain('margin-left:3rem;')
        expect(new framework.StyleSize(2).toString()).toBe('2rem')
    })

    // #60：补单位名单只有一份（浏览器侧的完整核对见 __tests__/styleAutoUnit.spec.tsx）
    test('#60: length properties outside the old list get the unit in SSR inline styles and rules; unitless ones do not', () => {
        const style = {borderTopLeftRadius: 4, outlineOffset: 2, translate: [5, 6], height: BigInt(10), lineHeight: 1.5, zIndex: 2}
        const {html, styles} = renderToString(createElement('div', null,
            createElement('p', {style}),
            createElement('p', {style: {...style, '&:hover': {scrollMarginTop: 7}}}),
        ))
        const declarations = 'border-top-left-radius:4px;outline-offset:2px;translate:5px 6px;height:10px;line-height:1.5;z-index:2'
        expect(html).toContain(`style="${declarations}"`)
        expect(styles).toContain(declarations.replace(/;/g, ';\n') + ';')
        expect(styles).toContain('scroll-margin-top:7px;')
        // 混合简写（border / outline）不在名单里：0 原样写出
        expect(generateStyleContent('.x', {border: 0, outline: 0, inset: 0})[0]).toContain('border:0;\noutline:0;\ninset:0px;')
    })
})
