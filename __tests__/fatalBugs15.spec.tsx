/** @jsx createElement */
/**
 * 2026-07 深度 review 第十四轮回归测试（F52-F53）。
 *
 * 每个用例都先在未修复代码上确认失败；覆盖：
 * - fragment 源 StaticHost 的整段删除把 reusable 子树的内容节点逐个拆散
 *   （内容顶层散布在 fragment 区间里，兄弟链被打断，下一次挂载崩溃/内容永久丢失）；
 * - RxList 的 fragment 行走 Range 批量删除时同样拆散 reusable 内容；
 * - 组件销毁时 render 期 computed 的用户 cleanup 抛错中断 frame 兄弟销毁与
 *   innerHost 的 DOM 拆除（I43 同类残留）。
 */
import {
    createElement,
    createRoot,
    RenderContext,
} from "@framework";
import {atom, computed, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe('fatal bug regression (2026-07 round-14 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    describe('F52: reusable content must survive the teardown of a fragment subtree', () => {
        test('moving a reusable between two fragment branches keeps the content alive', async () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))

            const useFirst = atom(true)
            function App({}: any, {createElement, reusable, Fragment}: RenderContext) {
                const moved = reusable(<div id="moved">M</div>)
                return <div id="container">
                    {() => useFirst() ?
                        <Fragment>{moved}<b>A</b></Fragment> :
                        <Fragment>{moved}<i>B</i></Fragment>}
                </div>
            }

            root.render(<App/>)
            expect(document.getElementById('moved')!.textContent).toBe('M')
            expect(rootEl.querySelector('b')!.textContent).toBe('A')

            useFirst(false)
            await wait(20)
            // 旧 fragment 分支销毁时，reusable 的内容节点散布在 fragment 区间顶层，
            // 曾被 removeNodesBetween 逐个拆散——再次挂载时区间兄弟链已断，
            // 移动循环直接崩溃（错误钩子收到 AxiiError），内容永久丢失。
            expect(errors).toHaveLength(0)
            expect(document.getElementById('moved')?.textContent).toBe('M')
            expect(rootEl.querySelector('i')?.textContent).toBe('B')
            expect(rootEl.querySelector('b')).toBeNull()

            // 再翻回来，内容仍然存活
            useFirst(true)
            await wait(20)
            expect(errors).toHaveLength(0)
            expect(document.getElementById('moved')?.textContent).toBe('M')
            expect(rootEl.querySelector('b')?.textContent).toBe('A')
            root.destroy()
        })

        test('a reusable row of an RxList mounted inside a fragment survives the fragment teardown', async () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))

            const useFirst = atom(true)
            function App({}: any, {createElement, reusable, Fragment}: RenderContext) {
                const moved = reusable(<div id="moved-list">L</div>)
                const list = new RxList<any>([moved])
                return <div id="container">
                    {() => useFirst() ?
                        <Fragment><span>first</span>{list}</Fragment> :
                        <p id="second">second</p>}
                </div>
            }

            root.render(<App/>)
            await wait(10)
            expect(document.getElementById('moved-list')!.textContent).toBe('L')

            // fragment 分支销毁：RxListHost 不透传行的 forceHandleElement 时，
            // 列表行（reusable 内容）会被 fragment 的整段删除逐个拆散
            useFirst(false)
            await wait(20)
            expect(errors).toHaveLength(0)
            expect(document.getElementById('second')?.textContent).toBe('second')

            // 翻回来，reusable 内容必须还能挂载
            useFirst(true)
            await wait(20)
            expect(errors).toHaveLength(0)
            expect(document.getElementById('moved-list')?.textContent).toBe('L')
            root.destroy()
        })

        test('a reusable inside a fragment RxList row survives row removal and can be mounted again', async () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))

            const list = new RxList<any>([])
            let moved: any
            function App({}: any, {createElement, reusable, Fragment}: RenderContext) {
                moved = reusable(<div id="moved-row">R</div>)
                list.push(<Fragment><span>row head</span>{moved}</Fragment>)
                return <div id="container">{list}</div>
            }

            root.render(<App/>)
            await wait(10)
            expect(document.getElementById('moved-row')!.textContent).toBe('R')

            // 删除 fragment 行：批量 Range 删除会把 reusable 内容一起物理删除
            list.splice(0, 1)
            await wait(10)
            expect(errors).toHaveLength(0)
            expect(document.getElementById('moved-row')).toBeNull()

            // 内容应该已被搬出保留，可以再次挂载
            list.push(moved)
            await wait(10)
            expect(errors).toHaveLength(0)
            expect(document.getElementById('moved-row')?.textContent).toBe('R')
            root.destroy()
        })
    })

    describe('F53: a throwing user cleanup of a render-time computed must not break component teardown', () => {
        test('sibling computed cleanups still run and the DOM is fully removed', async () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))

            let siblingCleanupRan = false
            const show = atom(true)

            function Comp() {
                // render 期创建的 computed 进入组件 frame，组件销毁时由 frame 逐个 destroy。
                // 第一个 computed 的用户 cleanup 抛错，曾中断兄弟 computed 的销毁与
                // innerHost 的 DOM 拆除（区域残留旧内容、新分支永远渲染不出来）。
                computed(({onCleanup}: any) => {
                    onCleanup(() => {
                        throw new Error('cleanup boom')
                    })
                    return 1
                })
                computed(({onCleanup}: any) => {
                    onCleanup(() => {
                        siblingCleanupRan = true
                    })
                    return 2
                })
                return <div id="inner">on</div>
            }

            root.render(<div>{() => show() ? <Comp/> : <p id="fallback">off</p>}</div>)
            expect(document.getElementById('inner')!.textContent).toBe('on')

            show(false)
            await wait(20)
            expect(errors).toHaveLength(1)
            expect(String(errors[0])).toContain('cleanup boom')
            // 兄弟 computed 的 cleanup 照常执行
            expect(siblingCleanupRan).toBe(true)
            // 旧 DOM 被完整拆除，新分支正常渲染
            expect(document.getElementById('inner')).toBeNull()
            expect(document.getElementById('fallback')?.textContent).toBe('off')
            root.destroy()
        })
    })
})
