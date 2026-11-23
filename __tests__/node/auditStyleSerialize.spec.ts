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

    test('SSR moves a plain entry that precedes a stylesheet entry into the stylesheet', () => {
        const {html, styles} = renderToString(createElement('div', {style: [
            {color: 'blue', marginTop: 3},
            {color: 'red', '&:hover': {opacity: 0.8}},
            {paddingTop: 7},
        ]}))
        // only the entry after the last stylesheet entry is inline
        expect(html).toMatch(/ style="padding-top:7px"/)
        expect(html).not.toContain('color:blue')
        const classes = /class="([^"]+)"/.exec(html)![1].split(' ')
        expect(classes.length).toBe(2)
        expect(classes.some(id => /^axs-[0-9a-z]+F0$/.test(id))).toBe(true)
        // entry 0 comes before entry 1 in the emitted CSS
        const first = styles.indexOf('color:blue')
        expect(first).toBeGreaterThanOrEqual(0)
        expect(styles.indexOf('color:red')).toBeGreaterThan(first)
        expect(styles).toContain('margin-top:3px;')
    })

    test('without a later stylesheet entry nothing is promoted', () => {
        const plain = renderToString(createElement('div', {style: [{color: 'blue'}, {paddingTop: 7}]}))
        expect(plain.html).toBe('<div style="color:blue;padding-top:7px"></div><!--root-->')
        expect(plain.styles).toBe('')
        // a stylesheet entry first, plain entries after it: they stay inline
        const sheetFirst = renderToString(createElement('div', {style: [{'&:hover': {opacity: 0.8}}, {color: 'blue'}]}))
        expect(sheetFirst.html).toMatch(/ style="color:blue"/)
        expect(sheetFirst.styles).not.toContain('color:blue')
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
