/**
 * Audit regressions for the DOM-free style serializer (styleSerialize.ts) and its SSR consumer.
 * Browser-side coverage lives in __tests__/audit-attrs.spec.tsx.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/auditStyleSerialize.spec.ts
 */
import {afterEach, describe, expect, test} from 'vitest'
import {createElement, renderToString} from '../../src/ssr.js'
import {generateStyleContent, setAutoUnitType} from '../../src/styleSerialize.js'

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

    test('without a later stylesheet entry nothing is taken back', () => {
        const plain = renderToString(createElement('div', {style: [{color: 'blue'}, {paddingTop: 7}]}))
        expect(plain.html).toBe('<div style="color:blue;padding-top:7px"></div><!--root-->')
        expect(plain.styles).toBe('')
        // a stylesheet entry first, plain entries after it: they stay inline
        const sheetFirst = renderToString(createElement('div', {style: [{'&:hover': {opacity: 0.8}}, {color: 'blue'}]}))
        expect(sheetFirst.html).toMatch(/ style="color:blue"/)
        expect(sheetFirst.styles).not.toContain('color:blue')
        // only nested rules after an inline entry: nothing to take back (known limitation: the hover rule
        //  does not beat the earlier inline value, same as v4.8.1)
        const nestedOnly = renderToString(createElement('div', {style: [{color: 'blue'}, {'&:hover': {color: 'red'}}]}))
        expect(nestedOnly.html).toMatch(/ style="color:blue"/)
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
})
