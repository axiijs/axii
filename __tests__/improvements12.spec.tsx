/** @jsx createElement */
/**
 * 2026-07 深度 review 第十一轮的改进项回归测试（I42）。
 * 详见 prompt/output/16-review-2026-07-round11.md。
 */
import {createElement, createRoot, RenderContext, bindProps} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

describe('improvements regression (2026-07 round-11 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I42: propTypes 的 coerce 曾被执行两次（normalizePropsByPropTypes 一次、render 里
     * normalizePropsWithCoerceValue 再一次）。coerce 不一定幂等（coerce: v => [v] 这类
     * 包装写法是自然写法），双重执行会得到双层包装的静默错误值。
     */
    describe('I42: coerce runs exactly once per prop', () => {
        test('fast path: non-idempotent coerce runs once', () => {
            let coerceCount = 0
            let received: any
            function Comp(props: any, {createElement}: RenderContext) {
                received = props.x
                return <div/>
            }
            Comp.propTypes = {
                x: { coerce: (v: any) => { coerceCount++; return [v] } } as any,
            }
            const root = createRoot(rootEl)
            root.render(<Comp x={5}/>)
            expect(coerceCount).toBe(1)
            expect(received).toEqual([5])
            root.destroy()
        })

        test('slow path (with boundProps): input value coerced once, bound value coerced too', () => {
            let receivedX: any
            let receivedY: any
            function Comp(props: any, {createElement}: RenderContext) {
                receivedX = props.x
                receivedY = props.y
                return <div/>
            }
            Comp.propTypes = {
                x: { coerce: (v: any) => [v] } as any,
                y: { coerce: (v: any) => Array.isArray(v) ? v : [v] } as any,
            }
            const Bound = bindProps(Comp as any, {y: 9})
            const root = createRoot(rootEl)
            root.render(<Bound x={5}/>)
            // 输入值只被 coerce 一次（[5] 而不是 [[5]]）
            expect(receivedX).toEqual([5])
            // boundProps 提供的固定值也要被 coerce
            expect(receivedY).toEqual([9])
            root.destroy()
        })
    })
})
