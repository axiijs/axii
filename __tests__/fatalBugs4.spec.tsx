/** @jsx createElement */
/**
 * 2026-07 深度 review 第三轮发现的致命问题（见 prompt/output/07-review-2026-07-round3.md）。
 * 与 fatalBugs.spec.tsx / fatalBugs2.spec.tsx / fatalBugs3.spec.tsx 一样，
 * 修复后断言即为【正确行为】，本文件是这些 bug 的回归测试。
 *
 * 编号与 review 报告一致（F11-F15）。
 */
import {
    createElement, createRoot, atom, RenderContext,
} from "@framework";
import {RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('fatal bug regression (2026-07 review round 3)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F11: 响应式 className 更新是整体覆写 class attribute，
     * 曾把 StyleManager 通过 classList.add 挂上的 stylesheet class（嵌套样式/boundProps 样式）
     * 一并抹掉，样式静默永久丢失。
     */
    describe('F11: reactive className update must not wipe StyleManager stylesheet classes', () => {
        test('className listed before nested style', async () => {
            const root = createRoot(rootEl)
            const cls = atom('a')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" className={() => cls()} style={{'& span': {color: 'rgb(255, 0, 0)'}}}>
                    <span id="inner">x</span>
                </div>
            }
            root.render(<App/>)
            const span = rootEl.querySelector('#inner') as HTMLElement
            expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')

            cls('b')
            await wait(10)
            expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
            expect((rootEl.querySelector('#t') as HTMLElement).classList.contains('b')).toBe(true)
            expect((rootEl.querySelector('#t') as HTMLElement).classList.contains('a')).toBe(false)
            root.destroy()
        })

        test('className listed after nested style', async () => {
            const root = createRoot(rootEl)
            const cls = atom('a')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" style={{'& span': {color: 'rgb(255, 0, 0)'}}} className={() => cls()}>
                    <span id="inner">x</span>
                </div>
            }
            root.render(<App/>)
            const span = rootEl.querySelector('#inner') as HTMLElement
            expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
            cls('b')
            await wait(10)
            expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
            root.destroy()
        })

        test('rolling dynamic style keeps only the latest stylesheet class after className update', async () => {
            const root = createRoot(rootEl)
            const cls = atom('a')
            const color = atom('rgb(255, 0, 0)')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" className={() => cls()} style={() => ({'& span': {color: color()}})}>
                    <span id="inner">x</span>
                </div>
            }
            root.render(<App/>)
            const span = rootEl.querySelector('#inner') as HTMLElement
            // 滚动生成新的 stylesheet class
            color('rgb(0, 128, 0)')
            await wait(10)
            expect(getComputedStyle(span).color).toBe('rgb(0, 128, 0)')
            // className 更新后，最新的 stylesheet class 被补回，且不会把已滚动淘汰的旧 class 也补回来
            cls('b')
            await wait(10)
            expect(getComputedStyle(span).color).toBe('rgb(0, 128, 0)')
            root.destroy()
        })
    })

    /**
     * F12: 长期存活的列表在稳态 churn（始终非空）下，行级动态样式的 stylesheet
     * 记账曾按共享的 hostPath 父级（RxListHost）计数，计数永远到不了 0，
     * 被销毁行的 stylesheet 引用计数从不释放，document.adoptedStyleSheets 随删除行数无上限增长。
     */
    test('F12: steady-state list churn does not leak adopted stylesheets', async () => {
        const root = createRoot(rootEl)
        const list = new RxList<number>([0])
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(item => (
                    <div style={() => ({'& span': {color: 'rgb(255, 0, 0)'}})}>
                        <span>{item}</span>
                    </div>
                ))}
            </div>
        }
        root.render(<App/>)
        await wait(10)
        const baseline = document.adoptedStyleSheets.length

        for (let i = 1; i <= 20; i++) {
            list.push(i)
            list.splice(0, 1)
            await wait(1)
        }
        await wait(20)
        expect(document.adoptedStyleSheets.length - baseline).toBeLessThan(5)

        root.destroy()
        await wait(10)
        // 全部销毁后 stylesheet 应全部释放
        expect(document.adoptedStyleSheets.length).toBeLessThanOrEqual(baseline)
    })

    /**
     * F13: reusable 节点作为 RxList 行时：
     * - ReusableHost 对外的 placeholder 曾是 innerHost 的 placeholder 而不是挂载点
     *   （moveTo 传入的 reusePlaceholder），列表把它插入 DOM 后 render 直接
     *   TypeError（reusePlaceholder 不在 DOM 中）；
     * - element 曾是构造时固定的字段（指向区间末尾），在它前面插入新行会取错锚点。
     */
    describe('F13: reusable node as an RxList row', () => {
        test('renders and keeps DOM order when inserting before it', async () => {
            const root = createRoot(rootEl)
            const list = new RxList<any>([])
            function App({}: any, {createElement, reusable}: RenderContext) {
                const reused = reusable(<div id="reused">R</div>)
                list.push(reused)
                return <div id="container">{list}</div>
            }
            root.render(<App/>)
            await wait(10)
            expect(rootEl.textContent).toBe('R')

            list.unshift(<div id="new">N</div>)
            await wait(10)
            expect(rootEl.textContent).toBe('NR')
            root.destroy()
        })

        test('content survives row removal (moved out for reuse) and can be mounted again', async () => {
            const root = createRoot(rootEl)
            const list = new RxList<any>([])
            let reused: any
            function App({}: any, {createElement, reusable}: RenderContext) {
                reused = reusable(<div id="reused">R</div>)
                list.push(reused)
                return <div id="container">{list}</div>
            }
            root.render(<App/>)
            await wait(10)
            expect(rootEl.textContent).toBe('R')

            // 行被 splice 移除：内容应被搬移保留（forceHandleElement），而不是被整段物理删除
            list.splice(0, 1)
            await wait(10)
            expect(rootEl.textContent).toBe('')

            // 再次挂载
            list.push(reused)
            await wait(10)
            expect(rootEl.textContent).toBe('R')
            root.destroy()
        })
    })

    /**
     * F14: render 到 detached 容器、随后手动 dispatch('attach') 后，
     * root.attached 曾保持 false：之后动态创建的组件/元素会重新注册 once 的 attach 监听，
     * 永远等不到下一次 attach，layoutEffect/ref 永不执行。
     */
    test('F14: dynamically created component after manual attach dispatch runs layoutEffect', async () => {
        const container = document.createElement('div')
        const root = createRoot(container)
        const show = atom(false)
        let layoutEffectRuns = 0
        const refCalls: any[] = []

        function Child({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { layoutEffectRuns++ })
            return <div ref={(el: any) => el && refCalls.push(el)}>child</div>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <Child/> : null}</div>
        }
        root.render(<App/>)
        expect(root.attached).toBe(false)
        // 用户随后把容器挂到文档并手动派发 attach（公开用法，见 fatalBugs.spec）
        document.body.appendChild(container)
        root.dispatch('attach')
        expect(root.attached).toBe(true)

        show(true)
        await wait(20)
        expect(container.textContent).toBe('child')
        expect(layoutEffectRuns).toBe(1)
        expect(refCalls.length).toBe(1)
        root.destroy()
        expect(root.attached).toBe(false)
    })

    /**
     * F15: root 级（不在任何组件内）元素带嵌套样式时，
     * StyleManager.collect 曾对 null hostPath 读 .node 直接 TypeError，初次渲染即崩溃。
     */
    test('F15: nested style on a root-level element renders without crashing', () => {
        const root = createRoot(rootEl)
        expect(() => {
            root.render(<div style={{'& span': {color: 'rgb(255, 0, 0)'}}}><span id="inner">x</span></div>)
        }).not.toThrow()
        const span = rootEl.querySelector('#inner') as HTMLElement
        expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
        root.destroy()
    })
})
