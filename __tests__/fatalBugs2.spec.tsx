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

    /**
     * F3: detachStyle 的离场 transition/animation 可能实际不会发生
     * （离场样式与当前值相同、元素 display:none、prefers-reduced-motion 等），
     * 之前等待 transitionrun/transitionend 的 Promise 永不 resolve，节点永远留在 DOM。
     * 现在以声明的最长动画时长 + buffer 作为兜底超时。
     */
    test('F3a: exit style equal to current value (no transition fires) still removes the node', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? (
                <div id="leaving-noop"
                     style={{opacity: 1, transition: 'opacity 0.05s'}}
                     detachStyle={{opacity: 1}}
                >bye</div>
            ) : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.getElementById('leaving-noop')).toBeTruthy()
        show(false)
        // deadline = 0.05s + 100ms buffer
        await sleep(400)
        expect(document.getElementById('leaving-noop')).toBeNull()
        root.destroy()
    })

    test('F3b: exit transition inside display:none subtree still removes the node', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div style={{display: 'none'}}>{() => show() ? (
                <div id="leaving-hidden"
                     style={{opacity: 1, transition: 'opacity 0.05s'}}
                     detachStyle={{opacity: 0}}
                >bye</div>
            ) : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.getElementById('leaving-hidden')).toBeTruthy()
        show(false)
        await sleep(400)
        expect(document.getElementById('leaving-hidden')).toBeNull()
        root.destroy()
    })

    test('F3c: a real exit transition still plays fully before removal', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? (
                <div id="leaving-real"
                     style={{opacity: 1, transition: 'opacity 0.15s'}}
                     detachStyle={{opacity: 0}}
                >bye</div>
            ) : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        show(false)
        await sleep(30)
        // 动画进行中：节点应该还在
        expect(document.getElementById('leaving-real')).toBeTruthy()
        await sleep(500)
        expect(document.getElementById('leaving-real')).toBeNull()
        root.destroy()
    })

    /**
     * F4: 数组 child 中带 detachStyle 的元素，之前被 StaticArrayHost.destroy 无条件同步
     * removeNodesBetween 直接删除，离场动画被跳过。现在 StaticArrayHost 尊重子 host 的
     * forceHandleElement，把 DOM 处理委托给子 host（异步等待动画），自己只清理直接创建的
     * 文本节点和 placeholder。
     */
    test('F4: detachStyle exit animation plays when the node is inside an array child', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            // 函数节点返回数组 → StaticArrayHost；混入 string item 验证直接文本节点也被清理
            return <div>{() => show() ? [
                'plain text ',
                <span id="array-sibling">sibling</span>,
                <div id="leaving-array"
                     style={{opacity: 1, transition: 'opacity 0.15s'}}
                     detachStyle={{opacity: 0}}
                >bye</div>
            ] : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(rootEl.textContent).toContain('plain text')
        show(false)
        await sleep(30)
        // 动画进行中：detachStyle 元素还在；其他兄弟节点（文本/普通元素）已同步移除
        expect(document.getElementById('leaving-array')).toBeTruthy()
        expect(document.getElementById('array-sibling')).toBeNull()
        expect(rootEl.textContent).not.toContain('plain text')
        await sleep(500)
        expect(document.getElementById('leaving-array')).toBeNull()
        root.destroy()
    })
})
