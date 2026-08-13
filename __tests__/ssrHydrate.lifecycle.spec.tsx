/** @jsx createElement */
/**
 * M-05: Portal + lifecycle hydrate — effects/layoutEffect/ref timing vs CSR; portal identity.
 * Run: npx vitest run __tests__/ssrHydrate.lifecycle.spec.tsx
 */
import {
    createElement,
    createRoot,
    hydrateRoot,
    RenderContext,
    Portal,
} from '@framework'
import {atom, RxList} from 'data0'
import {beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {lazy} from '../src/lazy.js'

describe('M-05 hydrate Portal + lifecycle', () => {
    let rootEl: HTMLElement
    let portalEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        portalEl = document.createElement('div')
        portalEl.id = 'portal-target'
        document.body.appendChild(rootEl)
        document.body.appendChild(portalEl)
        document.adoptedStyleSheets = []
    })

    test('Portal duck/string SSR → hydrate into options.portals; content identity + updates', () => {
        const text = atom('hello')
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div id="main">
                app
                {createPortal(() => <div id="pc">{text}</div>, {id: 'portal-target'} as any)}
            </div>
        }

        const {html, portals, styles} = renderToString(createElement(App, null as any))
        expect(html).toContain('<!--empty--><!--unhandledChild-->')
        expect(portals['portal-target']).toBeTruthy()

        if (styles) {
            rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        } else {
            rootEl.innerHTML = html
        }
        const pStyles = portals['portal-target'].styles
        portalEl.innerHTML = pStyles
            ? `<style data-axii-ssr>${pStyles}</style>${portals['portal-target'].html}`
            : portals['portal-target'].html

        const pcBefore = portalEl.querySelector('#pc')!
        const textBefore = Array.from(pcBefore.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text

        const root = hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })

        expect(rootEl.querySelector('#main')!.textContent).toContain('app')
        expect(portalEl.querySelector('#pc')).toBe(pcBefore)
        expect(portalEl.querySelector('#pc')!.textContent).toBe('hello')
        if (textBefore) {
            expect(Array.from(pcBefore.childNodes).find(n => n.nodeType === Node.TEXT_NODE)).toBe(textBefore)
        }

        text('world')
        expect(portalEl.querySelector('#pc')!.textContent).toBe('world')

        root.destroy()
        expect(portalEl.querySelector('#pc')).toBeNull()
    })

    test('Portal via getElementById when options.portals omitted', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            // Function content so createElement runs under portal hydrate claim root
            return <div>
                {createPortal(() => <div id="only">p</div>, 'portal-target' as any)}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(portalEl.querySelector('#only')!.textContent).toBe('p')
    })

    test('portalKey hydrate with options.portals', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>
                <Portal
                    container={{id: 'ignored'} as any}
                    portalKey="custom-key"
                    content={() => <div id="ck">keyed</div>}
                />
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        expect(portals['custom-key']).toBeTruthy()
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['custom-key'].html
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'custom-key': portalEl},
        })
        expect(portalEl.querySelector('#ck')!.textContent).toBe('keyed')
    })

    test('layoutEffect + ref after hydrate match CSR attach timing', async () => {
        const layoutHydrate: string[] = []
        const layoutCsr: string[] = []
        const refHydrate: any[] = []
        const refCsr: any[] = []

        function makeApp(logLayout: string[], logRef: any[]) {
            return function App({}, {createElement, useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => {
                    logLayout.push('layout')
                    return () => { logLayout.push('cleanup') }
                })
                return <div id="box" ref={(el: any) => logRef.push(el)}>hi</div>
            }
        }

        const HydrateApp = makeApp(layoutHydrate, refHydrate)
        const {html} = renderToString(createElement(HydrateApp, null as any))
        expect(layoutHydrate.length).toBe(0)
        expect(refHydrate.length).toBe(0)

        rootEl.innerHTML = html
        const root = hydrateRoot(rootEl, createElement(HydrateApp, null as any))
        expect(layoutHydrate).toEqual(['layout'])
        expect(refHydrate.length).toBe(1)
        expect(refHydrate[0]).toBe(rootEl.querySelector('#box'))

        const csrEl = document.createElement('div')
        document.body.appendChild(csrEl)
        const CsrApp = makeApp(layoutCsr, refCsr)
        const csrRoot = createRoot(csrEl)
        csrRoot.render(createElement(CsrApp, null as any))
        expect(layoutCsr).toEqual(['layout'])
        expect(refCsr.length).toBe(1)

        root.destroy()
        expect(layoutHydrate).toEqual(['layout', 'cleanup'])
        csrRoot.destroy()
        expect(layoutCsr).toEqual(['layout', 'cleanup'])
    })

    test('useEffect runs after hydrate (async), not during SSR', async () => {
        let effectCount = 0
        function App({}, {createElement, useEffect}: RenderContext) {
            useEffect(() => {
                effectCount++
                return () => { effectCount-- }
            })
            return <div>e</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(effectCount).toBe(0)
        rootEl.innerHTML = html
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        await new Promise(r => setTimeout(r, 0))
        expect(effectCount).toBe(1)
        root.destroy()
        expect(effectCount).toBe(0)
    })

    test('lazy: SSR fallback → hydrate starts load → swaps to loaded', async () => {
        // Fallback uses span so claimElement('div') for App wrapper is unambiguous
        function Fallback({}, {createElement}: RenderContext) {
            return <span id="fb">loading</span>
        }
        function Loaded({}, {createElement}: RenderContext) {
            return <span id="done">ready</span>
        }
        let resolveLoad!: (c: any) => void
        const Lazy = lazy(
            () => new Promise(r => { resolveLoad = r }),
            () => ({type: Fallback, props: {}, children: []} as any),
        )
        function App({}, {createElement}: RenderContext) {
            return <div id="wrap">{createElement(Lazy as any, null)}</div>
        }
        const {html} = renderToString(createElement(App, null as any))
        expect(html).toContain('id="fb"')
        expect(html).toContain('<!--computed node--><!--unhandledChild-->')
        rootEl.innerHTML = html
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#fb')!.textContent).toBe('loading')

        resolveLoad(Loaded)
        await new Promise(r => setTimeout(r, 20))
        expect(rootEl.querySelector('#done')!.textContent).toBe('ready')
        expect(rootEl.querySelector('#fb')).toBeNull()
    })

    // D1 (k15-audit): eager HTML element portal content is claimed under the main
    // hydrate root, but SSR emitted it into portals[k].html — mismatch. Same class:
    // createPortal(createElement('div',...)) and <Portal content={<div/>} />.
    // Function / ComponentNode content defers createElement into hydratePortalContent (OK).
    test('static element portal content hydrates + updates (Node SSR pattern)', () => {
        const t = atom('a')
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(createElement('div', {id: 'st'}, t), 'portal-target' as any)}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        expect(portals['portal-target'].html).toContain('id="st"')
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#st')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#st')).toBe(before)
        expect(before.textContent).toBe('a')
        t('b')
        expect(before.textContent).toBe('b')
    })

    test('JSX eager element as Portal content hydrates with identity', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>
                <Portal
                    container={'portal-target' as any}
                    content={<div id="jx">x</div>}
                />
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#jx')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#jx')).toBe(before)
        expect(before.textContent).toBe('x')
    })

    test('hydrate throws when portal container missing (§3.3.d)', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>{createPortal(() => <div id="x">p</div>, 'missing-portal' as any)}</div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        expect(portals['missing-portal']).toBeTruthy()
        expect(() => hydrateRoot(rootEl, createElement(App, null as any))).toThrow(/not found|Portal/)
    })

    test('destroyOnUnmount false keeps portal DOM after outer destroy', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>
                <Portal
                    container={'portal-target' as any}
                    destroyOnUnmount={false}
                    content={() => <div id="keep">k</div>}
                />
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const root = hydrateRoot(rootEl, createElement(App, null as any))
        expect(portalEl.querySelector('#keep')).toBeTruthy()
        root.destroy()
        expect(portalEl.querySelector('#keep')).toBeTruthy()
    })
})

// D1 (k16-audit): k16 deferred only when tryClaimElement finds *no* candidate.
// Eager portal createElement runs as an arg *before* pushHydrateRoot; if a later
// same-tag main sibling exists in SSR HTML, deep claim steals it (atom binds wrong
// node / text-unit mismatch). Same domain as k15 D1 → domain-review.
describe('M-05 portal-static-content hydrate (k16-audit locks)', () => {
    let rootEl: HTMLElement
    let portalEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        portalEl = document.createElement('div')
        portalEl.id = 'portal-target'
        document.body.appendChild(rootEl)
        document.body.appendChild(portalEl)
        document.adoptedStyleSheets = []
    })

    // Green when main sibling is claimed first (left-to-right) — regression guard.
    test('same-tag sibling before portal: eager content defers + updates', () => {
        const t = atom('portal')
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                <span id="main-span">main</span>
                {createPortal(createElement('span', null, t), 'portal-target' as any)}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const mainBefore = rootEl.querySelector('#main-span')!
        const portalBefore = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(rootEl.querySelector('#main-span')).toBe(mainBefore)
        expect(portalEl.querySelector('span')).toBe(portalBefore)
        t('updated')
        expect(portalBefore.textContent).toBe('updated')
        expect(mainBefore.textContent).toBe('main')
    })

    // Was RED (k16-audit): portal createElement must not claim later same-tag main sibling.
    test('same-tag sibling after portal: eager content must not claim main', () => {
        const t = atom('portal')
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(createElement('span', null, t), 'portal-target' as any)}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const mainBefore = rootEl.querySelector('#main-span')!
        const portalBefore = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(rootEl.querySelector('#main-span')).toBe(mainBefore)
        expect(mainBefore.textContent).toBe('main')
        expect(portalEl.querySelector('span')).toBe(portalBefore)
        expect(portalBefore.textContent).toBe('portal')
        t('updated')
        expect(portalBefore.textContent).toBe('updated')
        expect(mainBefore.textContent).toBe('main')
    })

    // Was RED (k16-audit): empty main span still "fits" portal content with text children.
    test('empty same-tag sibling after portal: must not claim main', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(createElement('span', null, 'p'), 'portal-target' as any)}
                <span id="empty-main"></span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const mainBefore = rootEl.querySelector('#empty-main')!
        const portalBefore = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(rootEl.querySelector('#empty-main')).toBe(mainBefore)
        expect(portalEl.querySelector('span')).toBe(portalBefore)
        expect(portalBefore.textContent).toBe('p')
    })

    test('eager nested portal content (parent+child) identity', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'outer'},
                        createElement('span', {id: 'inner'}, 'n'),
                    ),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const outer = portalEl.querySelector('#outer')!
        const inner = portalEl.querySelector('#inner')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#outer')).toBe(outer)
        expect(portalEl.querySelector('#inner')).toBe(inner)
    })

    test('ComponentNode portal content still hydrates', () => {
        function P({}, {createElement}: RenderContext) {
            return <div id="comp">c</div>
        }
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(createElement(P as any, null), 'portal-target' as any)}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#comp')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#comp')).toBe(before)
    })

    // Same class as createPortal(eager): JSX content={<span/>} evaluates before Portal.
    // Unique ids mask the bug — use tag-only match against later main sibling.
    // Identity-only asserts can false-pass if the stolen main node is moved; require contains + atom.
    test('JSX Portal content before same-tag sibling must not claim main', () => {
        const t = atom('p')
        function App({}, {createElement}: RenderContext) {
            return <div>
                <Portal
                    container={'portal-target' as any}
                    content={<span>{t}</span>}
                />
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const mainBefore = rootEl.querySelector('#main-span')!
        const portalBefore = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(rootEl.contains(mainBefore)).toBe(true)
        expect(portalEl.contains(portalBefore)).toBe(true)
        expect(rootEl.querySelector('#main-span')).toBe(mainBefore)
        expect(portalEl.querySelector('span')).toBe(portalBefore)
        expect(portalBefore.textContent).toBe('p')
        expect(mainBefore.textContent).toBe('main')
        t('q')
        expect(portalBefore.textContent).toBe('q')
        expect(mainBefore.textContent).toBe('main')
    })

    test('portal content with styles migrates without FOUC identity', () => {
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'styled', style: {color: 'rgb(1, 2, 3)'}}, 's'),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const pStyles = portals['portal-target'].styles
        portalEl.innerHTML = pStyles
            ? `<style data-axii-ssr>${pStyles}</style>${portals['portal-target'].html}`
            : portals['portal-target'].html
        const before = portalEl.querySelector('#styled') as HTMLElement
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#styled')).toBe(before)
        expect(getComputedStyle(before).color).toBe('rgb(1, 2, 3)')
    })

    // D1 (k17-audit): shouldMarkHydrateReclaim only marks string/number/function/Node kids.
    // Array / ComponentNode / RxList-only children skip reclaim → no-payload path drops kids
    // or wrong main claim continues under cursor → mismatch. Unique id still green (control).
    test('array-only eager portal + same-tag after must not claim main', () => {
        const t = atom('arr')
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', null, [createElement('span', null, t)]),
                    'portal-target' as any,
                )}
                <div id="main-div">main</div>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const portalSpan = portalEl.querySelector('span')!
        const mainBefore = rootEl.querySelector('#main-div')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.contains(portalSpan)).toBe(true)
        expect(rootEl.contains(mainBefore)).toBe(true)
        t('arr2')
        expect(portalSpan.textContent).toBe('arr2')
        expect(mainBefore.textContent).toBe('main')
    })

    test('ComponentNode-only eager portal child + same-tag after must not claim main', () => {
        const t = atom('c')
        function Inner({}, {createElement}: RenderContext) {
            return <span id="inner">{t}</span>
        }
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', null, createElement(Inner as any, null)),
                    'portal-target' as any,
                )}
                <div id="main-div">main</div>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const inner = portalEl.querySelector('#inner')!
        const mainBefore = rootEl.querySelector('#main-div')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#inner')).toBe(inner)
        expect(rootEl.contains(mainBefore)).toBe(true)
        t('c2')
        expect(inner.textContent).toBe('c2')
        expect(mainBefore.textContent).toBe('main')
    })

    test('RxList-only eager portal child + same-tag after must not claim main', () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', null, list.map((x: any) => <span>{x}</span>)),
                    'portal-target' as any,
                )}
                <div id="main-div">main</div>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const first = portalEl.querySelectorAll('span')[0]!
        const mainBefore = rootEl.querySelector('#main-div')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelectorAll('span')[0]).toBe(first)
        expect(rootEl.contains(mainBefore)).toBe(true)
        list.push('c')
        expect(portalEl.querySelectorAll('span').length).toBe(3)
        expect(mainBefore.textContent).toBe('main')
    })

    // Separate from reclaim mark: eager Fragment portal root must SSR <!--fragment start-->
    // (CSR StaticHost) and hydrate without stealing later same-tag main siblings.
    test('context Fragment eager portal content + same-tag after', () => {
        const t = atom('f')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null, createElement('span', null, t)),
                    'portal-target' as any,
                )}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        expect(portals['portal-target'].html).toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const portalBefore = portalEl.querySelector('span')!
        const mainBefore = rootEl.querySelector('#main-span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.contains(portalBefore)).toBe(true)
        expect(rootEl.contains(mainBefore)).toBe(true)
        t('g')
        expect(portalBefore.textContent).toBe('g')
        expect(mainBefore.textContent).toBe('main')
    })

    // D1 (k18-audit): k18 Fragment lock only covers element/atom child. Portal root Fragment
    // with Array / ComponentNode / RxList children: ensure clears Fragment unhandledChildren
    // then rematerialize/reconcile under portal root fails (main-tree Fragment+same shapes green).
    test('Fragment + Array-only portal content hydrates + updates', () => {
        const t = atom('arr')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null, [createElement('span', null, t)]),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        expect(portals['portal-target'].html).toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('span')).toBe(before)
        t('arr2')
        expect(before.textContent).toBe('arr2')
    })

    test('Fragment + ComponentNode-only portal content hydrates + updates', () => {
        const t = atom('c')
        function Inner({}, {createElement}: RenderContext) {
            return <span id="inner">{t}</span>
        }
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null, createElement(Inner as any, null)),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#inner')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#inner')).toBe(before)
        t('c2')
        expect(before.textContent).toBe('c2')
    })

    test('Fragment + RxList-only portal content hydrates + push', () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null, list.map((x: any) => <span>{x}</span>)),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const first = portalEl.querySelectorAll('span')[0]!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelectorAll('span')[0]).toBe(first)
        list.push('c')
        expect(portalEl.querySelectorAll('span').length).toBe(3)
    })

    // D2 (k18-audit): nested Fragment as portal root — identity may hold but atom host not bound.
    test('nested Fragment portal content hydrates + updates', () => {
        const t = atom('n')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null,
                        createElement(F, null, createElement('span', null, t)),
                    ),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        expect(portals['portal-target'].html).toContain('<!--fragment start-->')
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('span')).toBe(before)
        t('n2')
        expect(before.textContent).toBe('n2')
    })

    // k19-audit: nested Fragment + Array/CN/RxList — rematerialize lifts structural unhandled onto
    // outer Fragment; StaticArrayHost/Component/RxList placeholders stay detached (main SSR hydrate
    // same shapes also red; CSR main-tree green). Portal locks below; main-tree locks for class.
    test('nested Fragment + Array portal content hydrates + updates', () => {
        const t = atom('a')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null,
                        createElement(F, null, [createElement('span', null, t)]),
                    ),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('span')).toBe(before)
        t('a2')
        expect(before.textContent).toBe('a2')
    })

    test('nested Fragment + ComponentNode portal content hydrates + updates', () => {
        const t = atom('c')
        function Inner({}, {createElement}: RenderContext) {
            return <span id="inner">{t}</span>
        }
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null,
                        createElement(F, null, createElement(Inner as any, null)),
                    ),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#inner')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#inner')).toBe(before)
        t('c2')
        expect(before.textContent).toBe('c2')
    })

    test('nested Fragment + RxList portal content hydrates + push', () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement(F, null,
                        createElement(F, null, list.map((x: any) => <span>{x}</span>)),
                    ),
                    'portal-target' as any,
                )}
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const first = portalEl.querySelectorAll('span')[0]!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelectorAll('span')[0]).toBe(first)
        list.push('c')
        expect(portalEl.querySelectorAll('span').length).toBe(3)
    })

    test('main-tree nested Fragment + Array SSR hydrate + updates', () => {
        const t = atom('a')
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F, null,
                createElement(F, null, [createElement('span', null, t)]),
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const before = rootEl.querySelector('span')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('span')).toBe(before)
        t('a2')
        expect(before.textContent).toBe('a2')
    })

    test('main-tree nested Fragment + ComponentNode SSR hydrate + updates', () => {
        const t = atom('c')
        function Inner({}, {createElement}: RenderContext) {
            return <span id="inner">{t}</span>
        }
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F, null,
                createElement(F, null, createElement(Inner as any, null)),
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const before = rootEl.querySelector('#inner')!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelector('#inner')).toBe(before)
        t('c2')
        expect(before.textContent).toBe('c2')
    })

    test('main-tree nested Fragment + RxList SSR hydrate + push', () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement, Fragment: F}: RenderContext) {
            return createElement(F, null,
                createElement(F, null, list.map((x: any) => <span>{x}</span>)),
            )
        }
        const {html} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        const first = rootEl.querySelectorAll('span')[0]!
        hydrateRoot(rootEl, createElement(App, null as any))
        expect(rootEl.querySelectorAll('span')[0]).toBe(first)
        list.push('c')
        expect(rootEl.querySelectorAll('span').length).toBe(3)
    })

    // Element portal root + nested Fragment child: reclaim/defer rematerialize leaves atom unbound
    // (main-tree SSR hydrate of same shape is green).
    test('element portal + nested Fragment child hydrates + updates', () => {
        const t = atom('ef')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'pc'},
                        createElement(F, null, createElement('span', null, t)),
                    ),
                    'portal-target' as any,
                )}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('span')!
        const mainBefore = rootEl.querySelector('#main-span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.contains(before)).toBe(true)
        expect(rootEl.contains(mainBefore)).toBe(true)
        t('ef2')
        expect(before.textContent).toBe('ef2')
        expect(mainBefore.textContent).toBe('main')
    })

    // k20-audit verification strengthen: D1×D2 intersection — element portal root + nested F +
    // structural Array/CN/RxList (atom-only lock above does not cover rematerialize-through-defer).
    test('element portal + nested Fragment + Array hydrates + updates', () => {
        const t = atom('ea')
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'pc'},
                        createElement(F, null, [createElement('span', null, t)]),
                    ),
                    'portal-target' as any,
                )}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('span')!
        const mainBefore = rootEl.querySelector('#main-span')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.contains(before)).toBe(true)
        expect(rootEl.contains(mainBefore)).toBe(true)
        t('ea2')
        expect(before.textContent).toBe('ea2')
    })

    test('element portal + nested Fragment + ComponentNode hydrates + updates', () => {
        const t = atom('ec')
        function Inner({}, {createElement}: RenderContext) {
            return <span id="inner">{t}</span>
        }
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'pc'},
                        createElement(F, null, createElement(Inner as any, null)),
                    ),
                    'portal-target' as any,
                )}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const before = portalEl.querySelector('#inner')!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelector('#inner')).toBe(before)
        t('ec2')
        expect(before.textContent).toBe('ec2')
    })

    test('element portal + nested Fragment + RxList hydrates + push', () => {
        const list = new RxList(['a', 'b'])
        function App({}, {createElement, createPortal, Fragment: F}: RenderContext) {
            return <div>
                {createPortal(
                    createElement('div', {id: 'pc'},
                        createElement(F, null, list.map((x: any) => <span>{x}</span>)),
                    ),
                    'portal-target' as any,
                )}
                <span id="main-span">main</span>
            </div>
        }
        const {html, portals} = renderToString(createElement(App, null as any))
        rootEl.innerHTML = html
        portalEl.innerHTML = portals['portal-target'].html
        const first = portalEl.querySelectorAll('span')[0]!
        hydrateRoot(rootEl, createElement(App, null as any), {
            portals: {'portal-target': portalEl},
        })
        expect(portalEl.querySelectorAll('span')[0]).toBe(first)
        list.push('c')
        expect(portalEl.querySelectorAll('span').length).toBe(3)
    })
})
