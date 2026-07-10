/** @jsx createElement */
/**
 * 2026-07 深度 review 第十四轮改进项回归测试（I50-I52）。
 */
import {
    bindProps,
    createElement,
    createRoot,
    RenderContext,
} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test, vi} from "vitest";

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe('improvements regression (2026-07 round-14 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I50: fragment 在第一次渲染时内容节点被整体搬进文档，fragment 自身从此变空。
     * 缓存 fragment 跨渲染复用（<>...</> 存变量在条件分支间复用）时第二次渲染出来的是
     * 空白，且没有任何报错——比元素复用（I48）更隐蔽：纯静态元素复用碰巧可用，
     * 纯静态 fragment 复用一定是空白。开发期必须给出明确警告。
     */
    describe('I50: rendering an already-consumed fragment warns in dev', () => {
        test('re-rendering a static fragment warns instead of silently rendering nothing', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            try {
                const root = createRoot(rootEl)
                const cond = atom(true)
                function App({}: any, {createElement, Fragment}: RenderContext) {
                    const cached = <Fragment><b>static</b></Fragment>
                    return <div>{() => cond() ? cached : cached}</div>
                }
                root.render(<App/>)
                expect(rootEl.querySelector('b')!.textContent).toBe('static')

                cond(false)
                await wait(20)
                // 第二次渲染 fragment 已是空的：开发期要有明确警告
                expect(errorSpy.mock.calls.some(args => String(args[0]).includes('fragment'))).toBe(true)
                root.destroy()
            } finally {
                errorSpy.mockRestore()
            }
        })
    })

    /**
     * I51: 元素 ref 的 attach（同步连通路径）抛错会中断同元素的兄弟 ref、
     * styleManager mount 与后续渲染流程。flush 队列路径（I43）已经逐条隔离，
     * 同步路径必须对齐：有 error 钩子时上报并继续。
     */
    describe('I51: a throwing element ref does not break sibling refs on the sync attach path', () => {
        test('sibling ref still receives the element and rendering continues', () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))

            let sibling: HTMLElement | null = null
            const throwingRef = () => {
                throw new Error('ref boom')
            }
            const okRef = (el: HTMLElement | null) => {
                sibling = el
            }

            expect(() => {
                root.render(<div ref={[throwingRef, okRef]} id="with-ref">x</div>)
            }).not.toThrow()
            expect(errors).toHaveLength(1)
            expect(String(errors[0])).toContain('ref boom')
            expect(sibling).not.toBeNull()
            expect((sibling as unknown as HTMLElement).id).toBe('with-ref')
            root.destroy()
        })
    })

    /**
     * I53: $self: 前缀在组件 renderContext 的 createElement（separateProps）里被消费，
     * 但 classic pragma / automatic runtime 等不经过组件包装的入口（root.render 的顶层 JSX）
     * 会把它原样送进组件 inputProps——parseAndMergeProps 把它解析进 itemConfig['self']，
     * 而 'self' 是保留名永远不会被应用：merge 语义静默丢失，同一份 JSX 挂在组件里和
     * 挂在 root 顶层行为分叉。
     */
    describe('I53: $self: props reaching ComponentHost inputProps keep merge semantics', () => {
        test('root-level $self:className merges with boundProps className', () => {
            function Comp({className}: any, {createElement}: RenderContext) {
                return <div id="self-merge" className={className}/>
            }
            const Bound = bindProps(Comp, {className: 'base'})
            const root = createRoot(rootEl)
            root.render(<Bound $self:className="extra"/>)
            const el = document.getElementById('self-merge')!
            expect(el.classList.contains('base')).toBe(true)
            expect(el.classList.contains('extra')).toBe(true)
            root.destroy()
        })
    })

    /**
     * I52: reusable 当前挂载区间被外部整体清空（container.innerHTML = '' 等）后，
     * 其所在宿主树销毁时 ReusableHost.destroy 的搬移循环曾直接崩溃
     * （诊断开启是 AxiiError、关闭是原生 TypeError），中断整棵 root 的销毁。
     * StaticHost 对同类情况的容忍语义（区间已脱离 DOM 则跳过删除）必须对齐。
     */
    describe('I52: externally cleared reusable region does not break root.destroy', () => {
        test('root.destroy survives after container was cleared externally', async () => {
            const root = createRoot(rootEl)
            // 让 reusable 成为函数节点的直接 innerHost：销毁走 ReusableHost.destroy(false)
            //  的搬移路径（区间被外部清空后，搬移循环曾直接崩溃）。
            function App({}: any, {createElement, reusable, Fragment}: RenderContext) {
                const moved = reusable(<Fragment><div id="moved">M</div><span>tail</span></Fragment>)
                return () => moved
            }
            root.render(<App/>)
            await wait(10)
            expect(document.getElementById('moved')!.textContent).toBe('M')

            // 外部粗暴清空（真实场景：第三方库/测试工具直接清 DOM）
            rootEl.innerHTML = ''

            expect(() => root.destroy()).not.toThrow()
        })
    })
})
