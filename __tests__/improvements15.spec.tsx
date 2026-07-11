/** @jsx createElement */
/**
 * 2026-07 深度 review 第十五轮改进项回归测试（I55-I56）。
 *
 * 每个用例都先在未修复代码上确认失败（对照项除外）。覆盖：
 * - 事件回调聚合点的兄弟错误隔离（invokeEventEntries 是 I43/I51 错误隔离体系的
 *   最后一个缺口，onChange 别名到 input 后与 onInput 落到同一事件名下相互影响）；
 * - children 是 boundProps/bindProps 里唯一被 render 无条件覆盖而静默失效的 prop。
 */
import {
    createElement,
    createRoot,
    dispatchEvent,
    bindProps,
    RenderContext,
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

describe('improvements regression (2026-07 round-15 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    describe('I55: event handler error isolation across sibling handlers', () => {
        test('a throwing handler in a handler array does not skip its siblings', () => {
            const root = createRoot(rootEl)
            const calls: string[] = []
            let ref: any
            function App({}: any, {createRef, createElement}: RenderContext) {
                ref = createRef()
                return <div ref={ref} onCustomevent={[
                    () => calls.push('a'),
                    () => { calls.push('b'); throw new Error('boom') },
                    () => calls.push('c'),
                ]}>x</div>
            }
            root.render(<App/>)
            // 错误仍然可观测（首个错误在批次结束后重新抛出）
            expect(() => dispatchEvent(ref.current, new CustomEvent('customevent'))).toThrow('boom')
            // 但每一个兄弟 handler 都执行了（曾经 'c' 会被跳过）
            expect(calls).toEqual(['a', 'b', 'c'])
            root.destroy()
        })

        test('a throwing onChange does not skip the sibling onInput (aliased to the same event)', () => {
            const root = createRoot(rootEl)
            const calls: string[] = []
            let ref: any
            function App({}: any, {createRef, createElement}: RenderContext) {
                ref = createRef()
                return <input ref={ref}
                    onChange={() => { calls.push('change'); throw new Error('boom') }}
                    onInput={() => calls.push('input')}
                />
            }
            root.render(<App/>)
            expect(() => dispatchEvent(ref.current, new Event('input'))).toThrow('boom')
            // onChange 与 onInput 是两个独立的 prop，一个抛错不应静默跳过另一个
            expect(calls).toContain('change')
            expect(calls).toContain('input')
            root.destroy()
        })

        test('a single throwing handler still propagates its error (behavior unchanged)', () => {
            const root = createRoot(rootEl)
            let ref: any
            function App({}: any, {createRef, createElement}: RenderContext) {
                ref = createRef()
                return <div ref={ref} onCustomevent={() => { throw new Error('solo') }}>x</div>
            }
            root.render(<App/>)
            expect(() => dispatchEvent(ref.current, new CustomEvent('customevent'))).toThrow('solo')
            root.destroy()
        })

        test('return values are still collected when no handler throws', () => {
            const root = createRoot(rootEl)
            let ref: any
            function App({}: any, {createRef, createElement}: RenderContext) {
                ref = createRef()
                return <div ref={ref} onCustomevent={[() => 1, () => 2]}>x</div>
            }
            root.render(<App/>)
            const result = dispatchEvent(ref.current, new CustomEvent('customevent'))
            expect(result).toEqual([1, 2])
            root.destroy()
        })
    })

    describe('I56: bindProps can provide children when the JSX usage site omits them', () => {
        test('bound children render when no JSX children are given', () => {
            const root = createRoot(rootEl)
            function Sub({children}: any, {createElement}: RenderContext) {
                return <div id="c">{children}</div>
            }
            const Bound = bindProps(Sub, {children: [createElement('b', null, 'bound')]})
            // JSX 使用点没有提供任何 children——曾经 render 里 normalizedProps.children = this.children([])
            // 会无条件覆盖 boundProps 提供的 children，导致 bound children 静默丢失。
            root.render(createElement(Bound, {}) as any)
            expect(rootEl.querySelector('b')?.textContent).toBe('bound')
            root.destroy()
        })

        test('JSX children still win over bound children', () => {
            const root = createRoot(rootEl)
            function Sub({children}: any, {createElement}: RenderContext) {
                return <div id="c">{children}</div>
            }
            const Bound = bindProps(Sub, {children: [createElement('b', null, 'bound')]})
            root.render(createElement(Bound, null, createElement('i', null, 'jsx')) as any)
            // 使用点显式提供 children 时，JSX children 优先（覆盖 bound children）
            expect(rootEl.querySelector('i')?.textContent).toBe('jsx')
            expect(rootEl.querySelector('b')).toBeNull()
            root.destroy()
        })

        test('a plain component with JSX children is unaffected (control)', () => {
            const root = createRoot(rootEl)
            function Sub({children}: any, {createElement}: RenderContext) {
                return <div id="c">{children}</div>
            }
            root.render(createElement(Sub, null, createElement('span', null, 'plain')) as any)
            expect(rootEl.querySelector('span')?.textContent).toBe('plain')
            root.destroy()
        })
    })
})
