/** @jsx createElement */
/**
 * 2026-07 深度 review 第九轮的改进项回归测试（I36-I38）。
 * 每个测试都先在未修复代码上确认失败（复现），修复后转为回归测试。
 * 详见 prompt/output/14-review-2026-07-round9.md。
 */
import {bindProps, createElement, createRoot, RenderContext} from "@framework";
import {atom, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('improvements regression (2026-07 round-9 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I36: RxList 初始行渲染发生在 data0 computed 的 computation 里（fullRecompute 是
     * async 函数），行渲染抛错向上抛只会变成 unhandled rejection：root error 钩子拿不到
     * 错误；hostRenderComputed/hosts 停留在未初始化状态，后续销毁（函数节点重算换掉该区域、
     * root.destroy）对 undefined 调 destroyComputed 二次崩溃，区域永远无法恢复。
     */
    describe('I36: initial RxList row render errors must reach the root error hook and stay recoverable', () => {
        test('I36a: error hook receives the row render error', async () => {
            const badList = new RxList<any>([{bad: 'row'}]) // 平面对象行 -> unknown child type
            const errors: any[] = []
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))
            root.render(<div>{() => badList}</div>)
            await sleep(10)
            expect(errors.length).toBe(1)
            expect(String(errors[0])).toContain('unknown child type')
            root.destroy()
        })

        test('I36b: region recovers after the failed list is swapped out', async () => {
            const showList = atom(true)
            const badList = new RxList<any>([{bad: 'row'}])
            const errors: any[] = []
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))
            root.render(<div id="i36b">{() => showList() ? badList : 'recovered'}</div>)
            await sleep(10)
            expect(errors.length).toBeGreaterThan(0)
            showList(false)
            await sleep(10)
            expect(rootEl.textContent).toContain('recovered')
            root.destroy()
        })

        test('I36c: root.destroy does not crash after a row render threw', async () => {
            const badList = new RxList<any>([{bad: 'row'}])
            const errors: any[] = []
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))
            root.render(<div>{() => badList}</div>)
            await sleep(10)
            expect(() => root.destroy()).not.toThrow()
        })

        test('I36d: rows created before the failing row are rolled back (no leaked DOM)', async () => {
            const badList = new RxList<any>([<span class="i36d">ok</span>, {bad: 'row'}])
            const errors: any[] = []
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))
            root.render(<div>{() => badList}</div>)
            await sleep(10)
            expect(errors.length).toBe(1)
            // 整个列表区域渲染为空：失败行之前的行不应该残留
            expect(rootEl.querySelectorAll('.i36d').length).toBe(0)
            root.destroy()
        })
    })

    /**
     * I37: ComponentHost 构造期只从 inputProps 捕获 ref，boundProps（bindProps 包装的 HOC）
     * 提供的 ref 在 props 合并后被静默丢弃——attachRef 从未被调用。
     */
    describe('I37: ref provided through bindProps must be attached', () => {
        test('I37a: bound ref receives exposed values and detaches on destroy', () => {
            const got: any[] = []
            function Inner({}: any, {createElement, expose}: RenderContext) {
                expose('inner-value', 'tag')
                return <div>inner</div>
            }
            const Bound = bindProps(Inner, {ref: (v: any) => got.push(v)})
            const root = createRoot(rootEl)
            root.render(<Bound/>)
            expect(got.length).toBe(1)
            expect(got[0]?.tag).toBe('inner-value')
            root.destroy()
            expect(got.length).toBe(2)
            expect(got[1]).toBe(null)
        })

        test('I37b: user ref and bound ref are both attached', () => {
            const fromUser: any[] = []
            const fromBound: any[] = []
            function Inner({}: any, {createElement, expose}: RenderContext) {
                expose('v', 'tag')
                return <div>inner</div>
            }
            const Bound = bindProps(Inner, {ref: (v: any) => fromBound.push(v)})
            const root = createRoot(rootEl)
            root.render(<Bound ref={(v: any) => fromUser.push(v)}/>)
            expect(fromUser.length).toBe(1)
            expect(fromBound.length).toBe(1)
            expect(fromUser[0]?.tag).toBe('v')
            expect(fromBound[0]?.tag).toBe('v')
            root.destroy()
        })
    })

    /**
     * I38: onDoubleClick（React 拼法）对应的 DOM 事件是 dblclick。
     * 不别名的话监听器挂在不存在的 doubleclick 事件上，永远不触发且没有任何报错。
     */
    test('I38: onDoubleClick listens to the dblclick DOM event', () => {
        const received: string[] = []
        const root = createRoot(rootEl)
        root.render(<div id="i38" onDoubleClick={() => received.push('double')} onDblClick={() => received.push('dbl')}>x</div>)
        const el = rootEl.querySelector('#i38')!
        el.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
        // 两种拼法都应触发，且互不影响
        expect(received.sort()).toEqual(['dbl', 'double'])
        root.destroy()
    })
})
