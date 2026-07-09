/** @jsx createElement */
/**
 * 2026-07 第七轮深度 review 的改进项回归测试（I31-I33）。
 * 每个测试都先在未修复代码上确认失败，再随修复转为回归测试。
 *
 * I31: 响应式 style 从字符串形态（style={() => 'color:red;font-size:20px'}）翻转为
 *  对象/null 形态时，字符串里写过的 key 无从得知，旧值永久残留在 inline style 上。
 *
 * I32: detachStyle 是函数/atom 且返回数组时，removeElements 先判数组再求值：
 *  函数返回的数组被当成对象，styleKeys 变成数组下标——transition 检测失效，
 *  离场动画被直接跳过（节点瞬间删除）。
 *
 * I33: 容器脱离文档（root.attached 仍为 true）期间动态创建的组件/元素登记在
 *  deferred-attach 队列里；容器重新连通后手动 root.dispatch('attach')（公开用法）
 *  不 flush 该队列，layoutEffect/ref 永不执行。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, createElement, createRoot, RenderContext} from "@framework";

describe('improvements regression (2026-07 round-7 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('I31: reactive style flipping from string form to object form clears stale string keys', async () => {
        const useString = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="i31"
                style={() => useString() ? 'color: rgb(255, 0, 0); font-size: 20px' : {color: 'rgb(0, 0, 255)'}}
            />
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        const el = document.querySelector('#i31') as HTMLElement
        expect(getComputedStyle(el).fontSize).toBe('20px')

        useString(false)
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        // 字符串形态里的 font-size 不应该残留
        expect(el.style.fontSize).toBe('')
        root.destroy()
    })

    test('I32: function detachStyle returning an array still waits for the exit transition', async () => {
        const show = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <span
                id="i32"
                style={{opacity: 1, transition: 'opacity 0.2s'}}
                detachStyle={() => [{opacity: 0}]}
            >bye</span> : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(document.querySelector('#i32')).not.toBe(null)

        show(false)
        await new Promise(r => setTimeout(r, 50))
        // 离场 transition 进行中，节点应该还在
        expect(document.querySelector('#i32')).not.toBe(null)
        await new Promise(r => setTimeout(r, 400))
        expect(document.querySelector('#i32')).toBe(null)
        root.destroy()
    })

    test('I33: manual re-attach dispatch flushes pending layoutEffect/ref of nodes created while detached', async () => {
        const root = createRoot(rootEl)
        const show = atom(false)
        let effectRan = 0
        let refEl: HTMLElement|null = null
        function Inner({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { effectRan++ })
            return <span ref={(el: HTMLElement|null) => { if (el) refEl = el }}>inner</span>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <Inner/> : null}</div>
        }
        root.render(<App/>)
        expect(root.attached).toBe(true)

        // 容器被搬出文档（attached 状态仍为 true），此时动态创建带 layoutEffect/ref 的组件
        rootEl.remove()
        show(true)
        await new Promise(r => setTimeout(r, 10))
        expect(effectRan).toBe(0)

        // 重新连通并手动 dispatch attach（公开用法），deferred 队列必须被 flush
        document.body.appendChild(rootEl)
        root.dispatch('attach')
        expect(effectRan).toBe(1)
        expect(refEl).not.toBe(null)
        root.destroy()
    })
})
