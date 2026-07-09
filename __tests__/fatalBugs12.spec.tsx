/** @jsx createElement */
/**
 * 2026-07 深度 review 第十一轮的致命问题回归测试（F39-F41）。
 * 每个测试都先在未修复代码上确认失败（复现），修复后转为回归测试。
 * 详见 prompt/output/16-review-2026-07-round11.md。
 */
import {createElement, createRoot, RenderContext, createRef, RxDOMRect, bindProps} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('fatal bug regression (2026-07 round-11 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F39: value/checked 的语义依赖同元素的其他 prop 已经就位（select 的数组 value 依赖
     * multiple、input 的 value 解释依赖 type、range 按 min/max 截断），而 prop 是按 JSX
     * 书写顺序应用的——value 写在 multiple/type/max 之前时选中/勾选/数值被静默破坏。
     */
    describe('F39: value/checked application order on form controls', () => {
        test('F39a: select array value written before multiple keeps full selection', () => {
            const root = createRoot(rootEl)
            root.render(
                <select value={['a', 'c']} multiple>
                    <option value="a">a</option>
                    <option value="b">b</option>
                    <option value="c">c</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            root.destroy()
        })

        test('F39b: reactive multiple flipping to true re-applies stored array value', async () => {
            const multiple = atom(false)
            const root = createRoot(rootEl)
            root.render(
                <select multiple={multiple} value={['a', 'c']}>
                    <option value="a">a</option>
                    <option value="b">b</option>
                    <option value="c">c</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            multiple(true)
            await sleep(1)
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            root.destroy()
        })

        test('F39c: checkbox value written before type is interpreted as checked', () => {
            const root = createRoot(rootEl)
            root.render(<input value={true} type="checkbox"/>)
            const input = rootEl.querySelector('input')! as HTMLInputElement
            expect(input.checked).toBe(true)
            root.destroy()
        })

        test('F39d: range value written before type/max is not clamped by the default max', () => {
            const root = createRoot(rootEl)
            root.render(<input value={150} type="range" max={200}/>)
            const input = rootEl.querySelector('input')! as HTMLInputElement
            expect(input.value).toBe('150')
            root.destroy()
        })

        test('F39e: reactive type flipping to checkbox re-interprets the stored value', async () => {
            const type = atom('text')
            const root = createRoot(rootEl)
            root.render(<input type={type} value={true}/>)
            const input = rootEl.querySelector('input')! as HTMLInputElement
            type('checkbox')
            await sleep(1)
            expect(input.checked).toBe(true)
            root.destroy()
        })

        test('F39f: multiple static selected options survive (multiple applied before options)', () => {
            const root = createRoot(rootEl)
            root.render(
                <select multiple>
                    <option selected value="a">a</option>
                    <option value="b">b</option>
                    <option selected value="c">c</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            root.destroy()
        })
    })

    /**
     * F40: RxDOMRect 的事件重算目标（滚动容器等）的 ref 在被测元素之后才 attach
     * （refs 按文档顺序附加，目标写在后面是自然写法）时，listen 里直接读
     * target.current.addEventListener 抛 TypeError，整个渲染崩溃。
     */
    describe('F40: RxDOMRect event target ref attaching later', () => {
        test('F40a: render does not crash and the listener still works after attach', async () => {
            const trackedRef = createRef()
            const scrollerRef = createRef()
            const rect = new RxDOMRect(atom(null), [{target: scrollerRef, event: 'scroll'}])
            function App({}, {createElement}: RenderContext) {
                return <div>
                    <div ref={[rect.ref, (el: any) => trackedRef.current = el]} style={{width: 30, height: 30}}>tracked</div>
                    <div ref={scrollerRef} style={{overflow: 'auto', height: 50}}>scroller</div>
                </div>
            }
            const root = createRoot(rootEl)
            expect(() => root.render(<App/>)).not.toThrow()
            expect(rect.value()?.height).toBe(30)

            // 微任务之后监听器已经绑定：目标事件触发重算
            await sleep(1)
            trackedRef.current!.style.height = '60px'
            scrollerRef.current!.dispatchEvent(new Event('scroll'))
            expect(rect.value()?.height).toBe(60)
            root.destroy()
        })
    })

    /**
     * F41: propTypes 声明的 prop 在没有输入时被写成显式的 undefined key（幽灵 key），
     * 或按输入优先级填充默认值——两种形态都会把 bindProps/boundProps 提供的值静默覆盖，
     * 组件拿到 undefined 或默认值而不是 bound 值，没有任何报错。
     */
    describe('F41: propTypes ghost undefined / default value overriding bound props', () => {
        test('F41a: declared prop without default does not override bound value with undefined', () => {
            let received: any
            function Comp(props: any, {createElement}: RenderContext) {
                received = props.size
                return <div/>
            }
            Comp.propTypes = {
                size: { coerce: (v: any) => v } as any,
            }
            const Bound = bindProps(Comp as any, {size: 'large'})
            const root = createRoot(rootEl)
            root.render(<Bound/>)
            expect(received).toBe('large')
            root.destroy()
        })

        test('F41b: bound value wins over the declared default value', () => {
            let received: any
            function Comp(props: any, {createElement}: RenderContext) {
                received = props.size
                return <div/>
            }
            Comp.propTypes = {
                size: {
                    createDefaultValue: () => 'medium',
                    get defaultValue() { return 'medium' },
                } as any,
            }
            const Bound = bindProps(Comp as any, {size: 'large'})
            const root = createRoot(rootEl)
            root.render(<Bound/>)
            expect(received).toBe('large')
            root.destroy()
        })

        test('F41c: default value still fills when nobody provides the prop', () => {
            let received: any
            let boundReceived: any
            function Comp(props: any, {createElement}: RenderContext) {
                received = props.size
                return <div/>
            }
            Comp.propTypes = {
                size: {
                    createDefaultValue: () => 'medium',
                    get defaultValue() { return 'medium' },
                } as any,
            }
            // boundProps 求值函数仍然能看到（含默认值的）输入 props
            ;(Comp as any).boundProps = [(inputProps: any) => {
                boundReceived = inputProps.size
                return {}
            }]
            const root = createRoot(rootEl)
            root.render(createElement(Comp as any, {}))
            expect(received).toBe('medium')
            expect(boundReceived).toBe('medium')
            root.destroy()
        })

        test('F41d: input value still wins over bound value', () => {
            let received: any
            function Comp(props: any, {createElement}: RenderContext) {
                received = props.size
                return <div/>
            }
            Comp.propTypes = {
                size: {
                    createDefaultValue: () => 'medium',
                    get defaultValue() { return 'medium' },
                } as any,
            }
            const Bound = bindProps(Comp as any, {size: 'large'})
            const root = createRoot(rootEl)
            root.render(<Bound size="small"/>)
            expect(received).toBe('small')
            root.destroy()
        })
    })
})
