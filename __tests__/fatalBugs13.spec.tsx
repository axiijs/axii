/** @jsx createElement */
/**
 * 2026-07 深度 review 第十二轮回归测试（F42-F48）。
 *
 * 每个用例都先在未修复代码上确认失败；覆盖 SVG runtime、错误恢复、表单约束、
 * RxList 契约边界与异步 effect。
 */
import {
    AxiiError,
    createElement,
    createRoot,
    createSVGElement,
    jsx,
    jsxDEV,
    jsxs,
    RenderContext,
    RxList,
} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('fatal bug regression (2026-07 round-12 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    describe('F42: SVG factories preserve namespace without synthetic children', () => {
        test('createSVGElement spreads children and leaves leaf elements empty', () => {
            const circle = createSVGElement('circle', {id: 'circle'})
            const rect = createSVGElement('rect', {id: 'rect'})
            const svg = createSVGElement('svg', {}, circle, rect)
            const root = createRoot(rootEl)

            root.render(svg)

            expect(Array.from(svg.childNodes)).toEqual([circle, rect])
            expect(circle.childNodes).toHaveLength(0)
            expect(rect.childNodes).toHaveLength(0)
            root.destroy()
        })

        test('automatic JSX runtime creates common SVG tags in the SVG namespace', () => {
            const circle = jsxDEV('circle', {id: 'circle'}, undefined, false)
            const line = jsx('line', {strokeWidth: 2})
            const svg = jsxs('svg', {children: [circle, line]})
            const root = createRoot(rootEl)

            root.render(svg as JSX.Element)

            expect(svg).toBeInstanceOf(SVGElement)
            expect(circle).toBeInstanceOf(SVGElement)
            expect(line).toBeInstanceOf(SVGElement)
            expect((svg as SVGElement).namespaceURI).toBe('http://www.w3.org/2000/svg')
            expect((line as SVGElement).getAttribute('stroke-width')).toBe('2')
            expect((line as SVGElement).getAttribute('strokeWidth')).toBeNull()
            // SVG-only detection must not change ordinary HTML elements.
            expect(jsx('div', {})).toBeInstanceOf(HTMLDivElement)
            expect(jsx('a', {})).toBeInstanceOf(HTMLAnchorElement)
            root.destroy()
        })
    })

    describe('F43: FunctionHost cleanup errors use the root error boundary', () => {
        test('destroy continues sibling cleanups and removes the complete root', () => {
            const root = createRoot(rootEl)
            const errors: unknown[] = []
            let siblingCleanupRan = false
            root.on('error', error => errors.push(error))
            root.render(<div>{({onCleanup}: any) => {
                onCleanup(() => { throw new Error('function cleanup failed') })
                onCleanup(() => { siblingCleanupRan = true })
                return 'dynamic'
            }}</div>)

            expect(() => root.destroy()).not.toThrow()
            expect(errors).toHaveLength(1)
            expect(String(errors[0])).toContain('function cleanup failed')
            expect(siblingCleanupRan).toBe(true)
            expect(root.host).toBeUndefined()
            expect(rootEl.childNodes).toHaveLength(0)
        })

        test('recompute continues after a previous cleanup throws', async () => {
            const root = createRoot(rootEl)
            const value = atom('first')
            const errors: unknown[] = []
            let siblingCleanupCount = 0
            let generation = 0
            root.on('error', error => errors.push(error))
            root.render(<div>{({onCleanup}: any) => {
                const currentGeneration = generation++
                const currentValue = value()
                onCleanup(() => {
                    if (currentGeneration === 0) throw new Error('recompute cleanup failed')
                })
                onCleanup(() => { siblingCleanupCount++ })
                return currentValue
            }}</div>)

            value('second')
            await sleep()

            expect(rootEl.textContent).toBe('second')
            expect(errors).toHaveLength(1)
            expect(siblingCleanupCount).toBe(1)
            root.destroy()
            expect(siblingCleanupCount).toBe(2)
        })
    })

    describe('F44: failed component renders never commit effects', () => {
        test('consumed render errors skip effects/refs and immediately release render resources', () => {
            const root = createRoot(rootEl)
            const errors: unknown[] = []
            let effectRuns = 0
            let layoutEffectRuns = 0
            let renderCleanupRuns = 0
            let attachedRef: unknown = 'not-attached'
            root.on('error', error => errors.push(error))

            function Broken(
                {}: any,
                {createElement, useEffect, useLayoutEffect, onCleanup}: RenderContext
            ) {
                useEffect(() => { effectRuns++ })
                useLayoutEffect(() => { layoutEffectRuns++ })
                onCleanup(() => { renderCleanupRuns++ })
                throw new Error('component render failed')
            }

            expect(() => root.render(
                <Broken ref={(value: unknown) => { attachedRef = value }}/>
            )).not.toThrow()
            expect(errors).toHaveLength(1)
            expect(effectRuns).toBe(0)
            expect(layoutEffectRuns).toBe(0)
            expect(renderCleanupRuns).toBe(1)
            expect(attachedRef).toBe('not-attached')
            expect(rootEl.textContent).toBe('')

            root.destroy()
            expect(renderCleanupRuns).toBe(1)
            expect(rootEl.childNodes).toHaveLength(0)
        })
    })

    describe('F45: invalid component output uses the root error boundary', () => {
        test('unknown child output becomes an empty region instead of poisoning root.render', () => {
            const root = createRoot(rootEl)
            const errors: unknown[] = []
            root.on('error', error => errors.push(error))
            function InvalidChild() {
                return {bad: true} as unknown as JSX.Element
            }

            expect(() => root.render(<InvalidChild/>)).not.toThrow()
            expect(errors).toHaveLength(1)
            expect(String(errors[0])).toContain('unknown child type')
            expect(rootEl.textContent).toBe('')
            expect(() => root.destroy()).not.toThrow()
            expect(root.host).toBeUndefined()
        })
    })

    describe('F46: reactive range constraints replay the declared value', () => {
        test.each([
            ['max', 100, 200, 150, '100', '150'],
            ['min', 100, 0, 50, '100', '50'],
            ['step', 4, 1, 5, '4', '5'],
        ] as const)(
            '%s changes restore a value previously sanitized by the browser',
            async (constraint, initialConstraint, nextConstraint, declaredValue, initialValue, finalValue) => {
                const reactiveConstraint = atom<number>(initialConstraint)
                const root = createRoot(rootEl)
                root.render(createElement('input', {
                    type: 'range',
                    min: constraint === 'step' ? 0 : undefined,
                    max: constraint === 'step' ? 10 : undefined,
                    value: declaredValue,
                    [constraint]: reactiveConstraint,
                }))
                const input = rootEl.querySelector('input')!

                expect(input.value).toBe(initialValue)
                reactiveConstraint(nextConstraint)
                await sleep()
                expect(input.value).toBe(finalValue)
                root.destroy()
            }
        )
    })

    describe('F47: sparse RxList.set reports a structured contract error', () => {
        test('out-of-range set never crashes inside host anchor lookup', async () => {
            const root = createRoot(rootEl)
            const errors: unknown[] = []
            root.on('error', error => errors.push(error))
            const list = new RxList([
                <span>a</span>,
                <span>b</span>,
            ])
            root.render(list as unknown as JSX.Element)

            list.set(4, <span>z</span>)
            await sleep()

            expect(errors).toHaveLength(1)
            expect(errors[0]).toBeInstanceOf(AxiiError)
            expect((errors[0] as AxiiError).code).toBe('AXII_LIST_ORDER_BROKEN')
            expect(String(errors[0])).toContain('out-of-range')
            expect(rootEl.textContent).toBe('ab')
            root.destroy()
        })
    })

    describe('F48: async effect rejections use the root error boundary', () => {
        test('an async useEffect rejection is consumed without unhandledrejection', async () => {
            const root = createRoot(rootEl)
            const errors: unknown[] = []
            const unhandled: unknown[] = []
            const onUnhandled = (event: PromiseRejectionEvent) => {
                event.preventDefault()
                unhandled.push(event.reason)
            }
            window.addEventListener('unhandledrejection', onUnhandled)
            root.on('error', error => errors.push(error))

            function App({}: any, {createElement, useEffect}: RenderContext) {
                useEffect(async () => {
                    await Promise.resolve()
                    throw new Error('async effect failed')
                })
                return <div>mounted</div>
            }

            try {
                root.render(<App/>)
                await sleep()
                expect(errors).toHaveLength(1)
                expect(String(errors[0])).toContain('async effect failed')
                expect(unhandled).toHaveLength(0)
            } finally {
                window.removeEventListener('unhandledrejection', onUnhandled)
                root.destroy()
            }
        })
    })
})
