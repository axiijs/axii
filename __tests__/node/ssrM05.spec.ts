/**
 * M-05: Portal / lazy / lifecycle isolation — Node-side renderToString.
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/ssrM05.spec.ts
 */
import {describe, expect, test} from 'vitest'
import {atom} from 'data0'
import {createElement, renderToString} from '../../src/ssr.js'
import {lazy} from '../../src/lazy.js'
import {Portal} from '../../src/Portal.js'
import type {RenderContext} from '../../src/types.js'

describe('M-05 Portal SSR (Node)', () => {
    test('row1: duck {id} → portals[id]; main tree EmptyHost + unhandledChild + root', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', {id: 'main'},
                'app',
                createPortal(createElement('div', {id: 'p'}, 'portal'), {id: 'portal-a'} as any),
            )
        }
        const {html, portals, styles} = renderToString(createElement(App, null))
        expect(html).toBe(
            '<div id="main"><!--axii:t-->app<!--axii:/t--><!--empty--><!--unhandledChild--></div><!--root-->',
        )
        expect(Object.keys(portals)).toEqual(['portal-a'])
        expect(portals['portal-a'].html).toBe('<div id="p"><!--axii:t-->portal<!--axii:/t--></div><!--root-->')
        expect(portals['portal-a'].styles).toBe('')
        expect(styles).toBe('')
        expect(typeof globalThis.document).toBe('undefined')
    })

    test('row3: string container key', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('span', null, 'x'), 'key-str' as any),
            )
        }
        const {html, portals} = renderToString(createElement(App, null))
        expect(html).toContain('<!--empty--><!--unhandledChild-->')
        expect(portals['key-str'].html).toContain('>x<')
        expect(portals['key-str'].html.endsWith('<!--root-->')).toBe(true)
    })

    test('row2: portalKey prop wins over container.id', () => {
        function App({}, {createElement}: RenderContext) {
            return createElement('div', null,
                createElement(Portal as any, {
                    container: {id: 'duck-id'},
                    portalKey: 'override-k',
                    content: createElement('div', null, 'c'),
                }),
            )
        }
        const {portals} = renderToString(createElement(App, null))
        expect(Object.keys(portals)).toEqual(['override-k'])
        expect(portals['override-k'].html).toContain('>c<')
        expect(portals['duck-id']).toBeUndefined()
    })

    test('row6: missing key throws', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('div', null, 'x'), {} as any),
            )
        }
        expect(() => renderToString(createElement(App, null))).toThrow(/export key|Portal/)
    })

    test('row6: empty string id throws', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('div', null, 'x'), {id: ''} as any),
            )
        }
        expect(() => renderToString(createElement(App, null))).toThrow(/export key|Portal/)
    })

    test('nested portals export both keys; outer html has EmptyHost for inner', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(
                    createElement('div', null,
                        'outer',
                        createPortal(createElement('span', null, 'inner'), {id: 'inner'} as any),
                    ),
                    {id: 'outer'} as any,
                ),
            )
        }
        const {html, portals} = renderToString(createElement(App, null))
        expect(html).toContain('<!--empty-->')
        expect(portals['outer'].html).toContain('outer')
        expect(portals['outer'].html).toContain('<!--empty-->')
        expect(portals['inner'].html).toContain('inner')
        expect(portals['inner'].html.endsWith('<!--root-->')).toBe(true)
    })

    test('ref / onClick are no-ops in SSR output (lifecycle §3.4)', () => {
        let refs = 0
        function App({}, {createElement}: RenderContext) {
            return createElement('button', {
                id: 'b',
                ref: () => { refs++ },
                onClick: () => {},
            }, 'go')
        }
        const {html} = renderToString(createElement(App, null))
        expect(refs).toBe(0)
        expect(html).toContain('id="b"')
        expect(html).not.toMatch(/onClick|onclick/i)
    })

    test('row7: duplicate portal key throws', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('div', null, 'a'), {id: 'same'} as any),
                createPortal(createElement('div', null, 'b'), {id: 'same'} as any),
            )
        }
        expect(() => renderToString(createElement(App, null))).toThrow(/duplicate Portal key/)
    })

    test('portal styles isolated from main styles', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', {
                style: {color: 'rgb(1, 2, 3)', '&:hover': {opacity: '0.5'}},
            },
                createPortal(
                    createElement('div', {
                        style: {color: 'rgb(9, 9, 9)', '&:hover': {opacity: '0.9'}},
                    }, 'p'),
                    {id: 'styled-p'} as any,
                ),
            )
        }
        const {styles, portals} = renderToString(createElement(App, null))
        expect(styles).toMatch(/rgb\(1,\s*2,\s*3\)/)
        expect(styles).not.toMatch(/rgb\(9,\s*9,\s*9\)/)
        expect(portals['styled-p'].styles).toMatch(/rgb\(9,\s*9,\s*9\)/)
        expect(portals['styled-p'].styles).not.toMatch(/rgb\(1,\s*2,\s*3\)/)
    })
})

describe('M-05 lazy SSR (Node)', () => {
    test('sync fallback without calling load()', async () => {
        let loadCalls = 0
        function Fallback({}, {createElement}: RenderContext) {
            return createElement('div', {id: 'fb'}, 'loading')
        }
        const Lazy = lazy(
            () => {
                loadCalls++
                return new Promise(() => {})
            },
            () => ({type: Fallback, props: {}, children: []} as any),
        )
        function App({}, {createElement}: RenderContext) {
            return createElement(Lazy as any, null)
        }
        const {html} = renderToString(createElement(App, null))
        expect(loadCalls).toBe(0)
        expect(html).toContain('id="fb"')
        expect(html).toContain('loading')
        expect(html).toContain('<!--root-->')

        // After SSR pass ends, invoking LazyWrapper must start load (no started pollution)
        const fakeCtx = {createElement} as any
        const inner = (Lazy as any)({}, fakeCtx)
        expect(loadCalls).toBe(1)
        expect(typeof inner).toBe('function')
    })

    test('lazy without fallback renders empty structure + root', () => {
        let loadCalls = 0
        const Lazy = lazy(() => {
            loadCalls++
            return new Promise(() => {})
        })
        function App({}, {createElement}: RenderContext) {
            return createElement(Lazy as any, null)
        }
        const {html} = renderToString(createElement(App, null))
        expect(loadCalls).toBe(0)
        expect(html).toContain('<!--root-->')
        expect(html).not.toContain('loading')
    })
})

describe('M-05 lifecycle isolation (Node)', () => {
    test('useEffect / useLayoutEffect do not run during renderToString', () => {
        let effect = 0
        let layout = 0
        function App({}, {createElement, useEffect, useLayoutEffect}: RenderContext) {
            useEffect(() => { effect++ })
            useLayoutEffect(() => { layout++ })
            return createElement('div', null, 'x')
        }
        renderToString(createElement(App, null))
        expect(effect).toBe(0)
        expect(layout).toBe(0)
    })

    test('consecutive renderToString do not leak portal keys / styles', () => {
        const color = atom('rgb(1, 1, 1)')
        function App({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', {style: {color: color as any, '&:hover': {opacity: '1'}}},
                createPortal(createElement('span', null, 'p'), {id: 'once'} as any),
            )
        }
        const r1 = renderToString(createElement(App, null))
        color('rgb(2, 2, 2)')
        const r2 = renderToString(createElement(App, null))
        expect(Object.keys(r1.portals)).toEqual(['once'])
        expect(Object.keys(r2.portals)).toEqual(['once'])
        expect(r1.styles).toMatch(/rgb\(1,\s*1,\s*1\)/)
        expect(r2.styles).toMatch(/rgb\(2,\s*2,\s*2\)/)
        expect(r2.styles).not.toMatch(/rgb\(1,\s*1,\s*1\)/)
    })

    test('parallel renderToString portal isolation', async () => {
        function AppA({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('div', null, 'A'), {id: 'pa'} as any),
            )
        }
        function AppB({}, {createElement, createPortal}: RenderContext) {
            return createElement('div', null,
                createPortal(createElement('div', null, 'B'), {id: 'pb'} as any),
            )
        }
        const [a, b] = await Promise.all([
            Promise.resolve(renderToString(createElement(AppA, null))),
            Promise.resolve(renderToString(createElement(AppB, null))),
        ])
        expect(a.portals['pa'].html).toContain('>A<')
        expect(a.portals['pb']).toBeUndefined()
        expect(b.portals['pb'].html).toContain('>B<')
        expect(b.portals['pa']).toBeUndefined()
    })
})
