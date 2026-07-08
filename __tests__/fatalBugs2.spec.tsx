/** @jsx createElement */
/**
 * 2026-07 深度 review 发现的致命问题（见 prompt/output/05-review-2026-07.md）。
 * 与 fatalBugs.spec.tsx 一样，修复后断言即为【正确行为】，本文件是这些 bug 的回归测试。
 *
 * 编号与 review 报告一致（F1-F6）。
 */
import {
    createElement, createRoot, createEventTransfer, onSpaceKey, dispatchEvent, atom, RenderContext, PropTypes
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('fatal bug regression (2026-07 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F1: createEventTransfer 的 target 作为 ref 使用时，卸载阶段框架会以 null 回调
     * （createElement.detachRef），target 必须把 null 当作解绑处理，而不是抛
     * "event transfer can only have one target"。
     */
    test('F1: createEventTransfer target used as ref must not throw on unmount, and can re-attach', async () => {
        const transfer = createEventTransfer(() => new CustomEvent('ccclick'))
        let clicked = 0
        const sourceRef: {current: any} = {current: null}

        function App() {
            return <div>
                <div onClick={transfer.source} ref={sourceRef}>source</div>
                <div ref={transfer.target} onCcclick={() => clicked++}>target</div>
            </div>
        }

        const root = createRoot(rootEl)
        root.render(<App/>)
        sourceRef.current!.click()
        expect(clicked).toBe(1)

        // 卸载不能抛错
        expect(() => root.destroy()).not.toThrow()

        // 重新挂载后 transfer 仍然可用
        const root2 = createRoot(rootEl)
        root2.render(<App/>)
        sourceRef.current!.click()
        expect(clicked).toBe(2)
        expect(() => root2.destroy()).not.toThrow()
    })

    /**
     * F2: 空格键的 KeyboardEvent.key 是 ' '（'Space' 只是 e.code），
     * onSpaceKey 之前比较 e.key === 'Space'，真实按键永远不会命中。
     */
    test('F2: onSpaceKey fires on real space keydown (e.key is " ")', () => {
        let called = 0
        let ref: any
        function App({}: any, {createElement, createRef}: RenderContext) {
            ref = createRef()
            return <div ref={ref} onKeyDown={onSpaceKey(() => called++)}>x</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key: ' ', code: 'Space'}))
        expect(called).toBe(1)
        // 非空格键不触发
        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key: 'a', code: 'KeyA'}))
        expect(called).toBe(1)
        root.destroy()
    })
})
