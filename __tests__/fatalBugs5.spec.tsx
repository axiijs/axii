/** @jsx createElement */
/**
 * 2026-07 深度 review 第四轮发现的致命问题（见 prompt/output/08-review-2026-07-round4.md）。
 * 与 fatalBugs.spec.tsx ~ fatalBugs4.spec.tsx 一样，
 * 修复后断言即为【正确行为】，本文件是这些 bug 的回归测试。
 *
 * 编号与 review 报告一致（F16-F19）。
 */
import {
    createElement, createRoot, atom, RenderContext,
} from "@framework";
import {RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('fatal bug regression (2026-07 review round 4)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F16: root attach 之后动态创建的组件/元素（列表新行、动态重建的静态子树）是先在
     * 脱离文档的 fragment 里渲染、再整体插入的。layoutEffect/ref 曾在渲染时立即执行，
     * 此刻 DOM 还不在文档里：getBoundingClientRect 等测量全部拿到 0，isConnected 为 false。
     * 修复后 layoutEffect/ref 推迟到子树真正插入文档后（同一个同步任务内）执行。
     */
    describe('F16: layoutEffect/ref of dynamically created hosts must run after DOM insertion', () => {
        test('component layoutEffect in a list row runs connected and can measure', async () => {
            const root = createRoot(rootEl)
            const list = new RxList<number>([1])
            const connectedRecords: boolean[] = []
            const measuredWidths: number[] = []
            function Row({n}: any, {createElement, useLayoutEffect, createRef}: RenderContext) {
                const ref = createRef()
                useLayoutEffect(() => {
                    connectedRecords.push((ref.current as HTMLElement).isConnected)
                    measuredWidths.push((ref.current as HTMLElement).getBoundingClientRect().width)
                })
                return <div ref={ref} style={{width: 55}}>{n}</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>{list.map((n: number) => createElement(Row as any, {n}))}</div>
            }
            root.render(<App/>)
            expect(connectedRecords).toEqual([true])
            expect(measuredWidths[0]).toBe(55)

            // 动态插入的新行（renderNewHosts 先渲染进 fragment 再插入）
            list.push(2)
            list.splice(1, 0, 3)
            expect(connectedRecords).toEqual([true, true, true])
            expect(measuredWidths.every(w => w === 55)).toBe(true)
            root.destroy()
        })

        test('element ref in a list row is attached after insertion (synchronously within the patch)', () => {
            const root = createRoot(rootEl)
            const list = new RxList<number>([1])
            const refConnected: boolean[] = []
            function App({}: any, {createElement}: RenderContext) {
                return <div>{list.map((n: number) =>
                    <div ref={(el: HTMLElement|null) => { if (el) refConnected.push(el.isConnected) }}>{n}</div>
                )}</div>
            }
            root.render(<App/>)
            expect(refConnected).toEqual([true])
            list.push(2)
            // ref 挂载仍然是同步的（在 splice patch 返回之前完成）
            expect(refConnected).toEqual([true, true])
            root.destroy()
        })

        test('nested component layoutEffect inside a re-rendered function child runs connected', async () => {
            const root = createRoot(rootEl)
            const show = atom(false)
            let connected: boolean|null = null
            function Inner({}: any, {createElement, useLayoutEffect, createRef}: RenderContext) {
                const ref = createRef()
                useLayoutEffect(() => {
                    connected = (ref.current as HTMLElement).isConnected
                })
                return <span ref={ref}>inner</span>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => show() ? <div><Inner/></div> : null}</div>
            }
            root.render(<App/>)
            show(true)
            await wait(10)
            expect(connected).toBe(true)
            root.destroy()
        })

        test('component layoutEffect inside an array child runs connected', async () => {
            const root = createRoot(rootEl)
            const show = atom(false)
            let connected: boolean|null = null
            function Inner({}: any, {createElement, useLayoutEffect, createRef}: RenderContext) {
                const ref = createRef()
                useLayoutEffect(() => {
                    connected = (ref.current as HTMLElement).isConnected
                })
                return <span ref={ref}>inner</span>
            }
            function Wrap({}: any, {createElement}: RenderContext) {
                return <div>{['text', <Inner/>]}</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => show() ? <Wrap/> : null}</div>
            }
            root.render(<App/>)
            show(true)
            await wait(10)
            expect(connected).toBe(true)
            root.destroy()
        })

        test('nested list rows (detached fragment inside detached fragment) still run connected', () => {
            // 门控优化（自己未连通时跳过 flush）下，内层条目必须由最外层完成插入的 flush 兜底
            const root = createRoot(rootEl)
            const outer = new RxList<number>([])
            const connectedRecords: boolean[] = []
            function Cell({n}: any, {createElement, useLayoutEffect, createRef}: RenderContext) {
                const ref = createRef()
                useLayoutEffect(() => {
                    connectedRecords.push((ref.current as HTMLElement).isConnected)
                })
                return <span ref={ref}>{n}</span>
            }
            function Row({n}: any, {createElement}: RenderContext) {
                const inner = new RxList<number>([n * 10, n * 10 + 1])
                return <div>{inner.map((m: number) => createElement(Cell as any, {n: m}))}</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>{outer.map((n: number) => createElement(Row as any, {n}))}</div>
            }
            root.render(<App/>)
            outer.splice(0, 0, 1, 2)
            expect(connectedRecords).toEqual([true, true, true, true])
            root.destroy()
        })

        test('initial render before root attach still defers to attach event', () => {
            const detachedContainer = document.createElement('div')
            const root = createRoot(detachedContainer)
            let ran = 0
            let connectedAtRun: boolean|null = null
            function App({}: any, {createElement, useLayoutEffect, createRef}: RenderContext) {
                const ref = createRef()
                useLayoutEffect(() => {
                    ran++
                    connectedAtRun = (ref.current as HTMLElement).isConnected
                })
                return <div ref={ref}>x</div>
            }
            root.render(<App/>)
            expect(ran).toBe(0)
            document.body.appendChild(detachedContainer)
            root.dispatch('attach')
            expect(ran).toBe(1)
            expect(connectedAtRun).toBe(true)
            root.destroy()
        })
    })

    /**
     * F17: $name:style 传入字符串（style 的合法形态之一）时，
     * markAopProp 对原始值 Object.defineProperty 直接 TypeError，初次渲染即崩溃。
     */
    describe('F17: AOP $name:style with string value must not crash', () => {
        test('string style via AOP renders and applies', () => {
            const root = createRoot(rootEl)
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="item">inner</div>
            }
            expect(() => {
                root.render(<Inner $item:style={'color: rgb(255, 0, 0);'}/>)
            }).not.toThrow()
            const el = rootEl.querySelector('[data-as="item"]') as HTMLElement
            expect(el.style.color).toBe('rgb(255, 0, 0)')
            root.destroy()
        })

        test('string style via AOP merges with origin object style (string overwrites)', () => {
            const root = createRoot(rootEl)
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="item" style={{fontSize: 12}}>inner</div>
            }
            expect(() => {
                root.render(<Inner $item:style={'color: rgb(0, 0, 255);'}/>)
            }).not.toThrow()
            const el = rootEl.querySelector('[data-as="item"]') as HTMLElement
            expect(el.style.color).toBe('rgb(0, 0, 255)')
            root.destroy()
        })
    })

    /**
     * F18: 命名子组件（as=xxx）会把用户 ref 与内部收集 refs[name] 的回调合并成数组，
     * 但 ComponentHost.attachRef/detachRef 不处理数组：曾把 refValue 赋到数组对象的
     * .current 上——用户 ref 永远拿不到值，父组件的 refs[name] 也永远不会被填充。
     */
    describe('F18: named child component (as=) with external ref', () => {
        test('user ref and parent refs[name] both attached, detach on destroy', async () => {
            const root = createRoot(rootEl)
            let leafExposed: any = null
            function Leaf({}: any, {createElement, expose}: RenderContext) {
                expose(() => 42, 'answer')
                return <div>leaf</div>
            }
            let parentRefs: any
            function Parent({}: any, {createElement, refs}: RenderContext) {
                parentRefs = refs
                return createElement(Leaf as any, {as: 'leaf', ref: (v: any) => leafExposed = v})
            }
            root.render(createElement(Parent as any, {}))
            expect(leafExposed).not.toBe(null)
            expect(typeof leafExposed.answer).toBe('function')
            expect(leafExposed.answer()).toBe(42)
            expect(parentRefs.leaf).toBeDefined()
            expect(typeof parentRefs.leaf.answer).toBe('function')

            root.destroy()
            expect(leafExposed).toBe(null)
        })

        test('RefObject inside the merged array also gets the value', () => {
            const root = createRoot(rootEl)
            const refObj = {current: null as any}
            function Leaf({}: any, {createElement, expose}: RenderContext) {
                expose('leaf-value', 'tag')
                return <div>leaf</div>
            }
            function Parent({}: any, {createElement}: RenderContext) {
                return createElement(Leaf as any, {as: 'leaf', ref: refObj})
            }
            root.render(createElement(Parent as any, {}))
            expect(refObj.current).not.toBe(null)
            expect(refObj.current.tag).toBe('leaf-value')
            root.destroy()
            expect(refObj.current).toBe(null)
        })
    })

    /**
     * F19: style 对象的值为 atom/函数（style={{color: colorAtom}} 是自然写法）时，
     * 曾把函数源码字符串化成非法 CSS（样式静默丢失），且 atom 从未被读取——没有任何响应性。
     * 嵌套样式（stylesheet 路径）同样中招，且静态 stylesheet 不会随 atom 变化重建。
     */
    describe('F19: atom/function values inside style objects', () => {
        test('inline style with atom value applies and tracks', async () => {
            const root = createRoot(rootEl)
            const color = atom('rgb(255, 0, 0)')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" style={{color}}>x</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.color).toBe('rgb(255, 0, 0)')
            color('rgb(0, 0, 255)')
            await wait(10)
            expect(el.style.color).toBe('rgb(0, 0, 255)')
            root.destroy()
        })

        test('nested style with atom value applies and tracks (stylesheet path)', async () => {
            const root = createRoot(rootEl)
            const color = atom('rgb(255, 0, 0)')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" style={{'& span': {color}}}><span id="inner">x</span></div>
            }
            root.render(<App/>)
            const span = rootEl.querySelector('#inner') as HTMLElement
            expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
            color('rgb(0, 0, 255)')
            await wait(20)
            expect(getComputedStyle(span).color).toBe('rgb(0, 0, 255)')
            root.destroy()
        })

        test('css custom property with atom value applies and tracks', async () => {
            const root = createRoot(rootEl)
            const size = atom('11px')
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" style={{'--my-size': size}}>x</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.getPropertyValue('--my-size')).toBe('11px')
            size('22px')
            await wait(10)
            expect(el.style.getPropertyValue('--my-size')).toBe('22px')
            root.destroy()
        })

        test('atom value with auto-unit number applies unit', () => {
            const root = createRoot(rootEl)
            const width = atom(60)
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" style={{width}}>x</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.width).toBe('60px')
            root.destroy()
        })
    })
})
