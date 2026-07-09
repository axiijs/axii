/** @jsx createElement */
/**
 * 2026-07 深度 review 第十轮的改进项回归测试（I39-I41）。
 * 详见 prompt/output/15-review-2026-07-round10.md。
 */
import {createElement, createRoot, RenderContext} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('improvements regression (2026-07 round-10 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I39: 清理函数（onCleanup / useEffect / useLayoutEffect 返回值）必须在 DOM 拆除、
     * ref 置空之前执行：onCleanup(() => observer.unobserve(ref.current)) 是最自然的写法，
     * 拆完 DOM 再跑清理时 ref.current 已是 null。
     */
    describe('I39: cleanup callbacks run before DOM teardown', () => {
        test('onCleanup can read element ref and connected DOM', () => {
            let refAtCleanup: any = 'not-called'
            let connectedAtCleanup: boolean | undefined
            function App({}: any, {createElement, createRef, onCleanup}: RenderContext) {
                const ref = createRef()
                onCleanup(() => {
                    refAtCleanup = ref.current
                    connectedAtCleanup = ref.current?.isConnected
                })
                return <div ref={ref}>x</div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            root.destroy()
            expect(refAtCleanup).not.toBe(null)
            expect(connectedAtCleanup).toBe(true)
        })

        test('useEffect / useLayoutEffect cleanup handles can read element ref', () => {
            let effectCleanupRef: any = 'not-called'
            let layoutCleanupRef: any = 'not-called'
            function App({}: any, {createElement, createRef, useEffect, useLayoutEffect}: RenderContext) {
                const ref = createRef()
                useEffect(() => () => { effectCleanupRef = ref.current })
                useLayoutEffect(() => () => { layoutCleanupRef = ref.current })
                return <div ref={ref}>x</div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            root.destroy()
            expect(effectCleanupRef).not.toBe(null)
            expect(layoutCleanupRef).not.toBe(null)
        })
    })

    /**
     * I40: _props / prop_ merge 函数「就地修改、不 return」是自然写法，
     * 返回 undefined 时必须回退到累积值，否则后续读 finalProps 直接 TypeError。
     */
    describe('I40: mutate-in-place merge handles', () => {
        test('$name:_props handle returning undefined keeps mutated props', () => {
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="inner" data-x="orig">inner</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <Inner $inner:_props={(props: any) => { props['data-y'] = 'added' }} />
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            const el = rootEl.querySelector('[data-as="inner"]')! as HTMLElement
            expect(el.dataset.x).toBe('orig')
            expect(el.dataset.y).toBe('added')
            root.destroy()
        })

        test('$name:prop_ handle returning undefined keeps original value', () => {
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="inner" data-x="orig">inner</div>
            }
            let seen: any
            function App({}: any, {createElement}: RenderContext) {
                return <Inner $inner:data-x_={(origin: any) => { seen = origin }} />
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            expect(seen).toBe('orig')
            const el = rootEl.querySelector('[data-as="inner"]')! as HTMLElement
            expect(el.dataset.x).toBe('orig')
            root.destroy()
        })
    })

    /**
     * I41: dangerouslySetInnerHTML 的 nullish 值表示清空，
     * undefined 不能被字符串化成字面 "undefined" 渲染到页面。
     */
    describe('I41: nullish dangerouslySetInnerHTML clears content', () => {
        test('reactive html flipping to undefined', async () => {
            const html = atom<any>('<b>hi</b>')
            const root = createRoot(rootEl)
            root.render(<div dangerouslySetInnerHTML={() => html()}></div>)
            const el = rootEl.querySelector('div')! as HTMLElement
            expect(el.innerHTML).toBe('<b>hi</b>')
            html(undefined)
            await sleep(10)
            expect(el.innerHTML).toBe('')
            root.destroy()
        })
    })
})
