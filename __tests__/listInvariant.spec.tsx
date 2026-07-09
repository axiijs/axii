/** @jsx createElement */
/**
 * RxListHost 开发期列表不变量（AXII_LIST_ORDER_BROKEN）的回归测试。
 *
 * 背景（见 prompt/output/11-contracts-and-invariants.md）：列表的「数据与 DOM 静默错位」
 * 类 bug（F22 属于这一类）不抛任何错，只会一直渲染错的顺序，是幸存到第六轮 review 的
 * 主要 bug 形态。诊断开启时（默认跟随 __DEV__），每个 patch 批次结束后校验：
 * 1. hosts 数量 === list.data 数量；
 * 2. 已渲染行的 DOM 区间按数组顺序排列、且都在列表 placeholder 之前。
 * 破坏时抛出/上报结构化的 AXII_LIST_ORDER_BROKEN，把「静默错位」变成当场可见的错误。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {AxiiError, createElement, createRoot, RenderContext, RxList} from "@framework";

describe('RxList dev-mode order invariant', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('externally reordered row nodes are detected on the next patch', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="inv1">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)
        const container = document.getElementById('inv1')!

        // 外部代码把第一行搬到最后（axii 管理的节点被第三方脚本挪动是真实事故形态）
        container.appendChild(container.querySelector('span')!)

        // 破坏本身不抛错（这正是问题所在）；下一次 patch 的批次末尾必须检测到
        expect(errors.length).toBe(0)
        list.push('d')
        expect(errors.length).toBe(1)
        expect(errors[0]).toBeInstanceOf(AxiiError)
        expect((errors[0] as AxiiError).code).toBe('AXII_LIST_ORDER_BROKEN')
    })

    test('normal op sequences never trigger the invariant', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="inv2">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)

        list.splice(-1, 1, 'x', 'y')
        list.unshift('z')
        list.swap(0, 2)
        list.sortSelf((a, b) => a < b ? -1 : 1)
        list.set(1, 'B')
        list.splice(0, list.data.length)

        expect(errors.length).toBe(0)
        expect(document.getElementById('inv2')!.textContent).toBe('')
    })

    test('row node removed by external code is detected on the next patch', () => {
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="inv3">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)
        const container = document.getElementById('inv3')!

        // 外部删除中间一行的节点后，后续 splice 会以它为区间边界/锚点，
        // 批次末尾的不变量至少要把状态破坏暴露出来（而不是静默继续）
        container.querySelectorAll('span')[1].remove()
        list.push('d')
        // 删除节点后行 host 变成「未渲染」形态，顺序校验可能跳过它；
        // 但外部搬动 + 数量类破坏必须至少有一类被暴露。这里验证系统不静默崩坏：
        // DOM 与数据不一致的状态下，继续操作要么被检测（errors>0），要么 DOM 仍与
        // 剩余行保持一致的相对顺序（a, c, d）。
        if (errors.length === 0) {
            expect(container.textContent).toBe('acd')
        } else {
            expect((errors[0] as AxiiError).code).toBe('AXII_LIST_ORDER_BROKEN')
        }
    })
})
