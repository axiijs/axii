/** @jsx createElement */
/**
 * 2026-07 第五轮深度 review 的改进项回归测试（I26）。
 *
 * I26: root.on('error') 此前覆盖 组件 render / 属性绑定更新 / atom 文本更新 / RxList patch，
 *  但 useEffect / useLayoutEffect / onCleanup（含 effect 返回的清理函数）抛错不经过该钩子：
 *  - 初次渲染时一个抛错的 useEffect 会让 root.render 中断，整棵已渲染好的树永远不会
 *    被挂到容器上（白屏），且后续 effect 不再执行；
 *  - useLayoutEffect 抛错会打断同批其他 layoutEffect/ref 的执行；
 *  - destroy 时抛错的清理函数会中断兄弟清理函数与剩余销毁流程（泄漏）。
 *  修复后：注册了 error 钩子时错误交给钩子、兄弟回调照常执行；未注册时保持向上抛出的旧行为。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, RenderContext} from "@framework";
import {atom} from "data0";

describe('improvements regression (2026-07 round-5 review)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('I26a: useEffect throwing goes through the error hook and does not blank the app', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        let secondEffectRan = false
        function App({}: any, {createElement, useEffect}: RenderContext) {
            useEffect(() => { throw new Error('effect boom') })
            useEffect(() => { secondEffectRan = true })
            return <div id="i26a">ok</div>
        }
        root.render(<App/>)
        expect(document.getElementById('i26a')).not.toBe(null)
        expect(errors.length).toBe(1)
        expect(String(errors[0])).toContain('effect boom')
        expect(secondEffectRan).toBe(true)
    })

    test('I26b: useLayoutEffect throwing goes through the error hook, sibling layout effects still run', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        let secondLayoutEffectRan = false
        function App({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { throw new Error('layout effect boom') })
            useLayoutEffect(() => { secondLayoutEffectRan = true })
            return <div id="i26b">ok</div>
        }
        root.render(<App/>)
        expect(document.getElementById('i26b')).not.toBe(null)
        expect(errors.length).toBe(1)
        expect(String(errors[0])).toContain('layout effect boom')
        expect(secondLayoutEffectRan).toBe(true)
    })

    test('I26c: throwing cleanup goes through the error hook, sibling cleanups and destroy still complete', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        let onCleanupRan = false
        let effectCleanupRan = false
        let layoutEffectCleanupRan = false
        function App({}: any, {createElement, useEffect, useLayoutEffect, onCleanup}: RenderContext) {
            onCleanup(() => { throw new Error('cleanup boom') })
            onCleanup(() => { onCleanupRan = true })
            useEffect(() => () => { effectCleanupRan = true })
            useLayoutEffect(() => () => {
                throw new Error('layout cleanup boom')
            })
            useLayoutEffect(() => () => { layoutEffectCleanupRan = true })
            return <div id="i26c">ok</div>
        }
        root.render(<App/>)
        root.destroy()
        expect(onCleanupRan).toBe(true)
        expect(effectCleanupRan).toBe(true)
        expect(layoutEffectCleanupRan).toBe(true)
        expect(errors.length).toBe(2)
        // destroy 流程完整走完：DOM 已清空
        expect(rootEl.textContent).toBe('')
    })

    test('I26d: without an error hook, effect errors still propagate (old behavior preserved)', () => {
        function App({}: any, {createElement, useEffect}: RenderContext) {
            useEffect(() => { throw new Error('effect boom') })
            return <div>ok</div>
        }
        expect(() => root.render(<App/>)).toThrowError('effect boom')
    })

    /**
     * I27: Portal 内容运行在框架私有创建的内层 root 上，用户无法在它上面注册监听，
     *  内层未消费的 error 事件必须冒泡到父 root：否则 portal 内容里的错误永远到不了
     *  用户的 root.on('error') 钩子（函数节点重算等异步路径下直接变成 unhandled rejection）。
     */
    test('I27: error inside portal content bubbles to the outer root error hook', async () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        const container = document.createElement('div')
        document.body.appendChild(container)
        const broken = atom<any>({toString() { return 'ok' }})
        function App({}: any, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(() => <div>{() => broken().toString()}</div>, container)}
            </div>
        }
        root.render(<App/>)
        expect(container.textContent).toContain('ok')
        // 让 portal 内的函数节点重算抛错（重算在微任务中执行）
        broken(null)
        await new Promise(r => setTimeout(r, 10))
        expect(errors.length).toBe(1)
        expect(String(errors[0])).toContain('toString')
    })
})
