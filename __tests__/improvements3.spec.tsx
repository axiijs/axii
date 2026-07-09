/** @jsx createElement */
/**
 * 2026-07 深度 review 第二轮的改进项（见 prompt/output/06-review-2026-07-round2.md）。
 * 编号与 review 报告一致（I16-I18）。
 */
import {
    createElement, createRoot, atom, RenderContext, Component, RxList
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('improvements regression (2026-07 review round 2)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I16: boolean child 曾渲染出字面 "false"/"true"。
     * {cond && <el/>} / {() => cond() && <el/>} 是最常见的条件渲染写法，
     * falsy 的中间态不应该出现在页面上（与 I7 的 null/undefined 语义一致）。
     */
    describe('I16: boolean children render empty text instead of literal "false"/"true"', () => {
        test('function child () => cond() && <el/> renders empty when false', async () => {
            const root = createRoot(rootEl)
            const cond = atom(false)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{() => cond() && <span>yes</span>}</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('#t')!
            expect(el.textContent).toBe('')

            cond(true)
            await sleep(1)
            expect(el.textContent).toBe('yes')

            cond(false)
            await sleep(1)
            expect(el.textContent).toBe('')
            root.destroy()
        })

        test('static boolean child renders empty', () => {
            const root = createRoot(rootEl)
            const cond = false
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{cond && <span>yes</span>}</div>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('#t')!.textContent).toBe('')
            root.destroy()
        })

        test('atom(boolean) child renders empty', () => {
            const root = createRoot(rootEl)
            const flag = atom(true)
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{flag}</div>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('#t')!.textContent).toBe('')
            root.destroy()
        })

        test('boolean row in RxList renders empty (no literal false in list)', () => {
            const root = createRoot(rootEl)
            const list = new RxList<any>([false, 'a'])
            function App({}, {createElement}: RenderContext) {
                return <div id="t">{list}</div>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('#t')!.textContent).toBe('a')
            root.destroy()
        })
    })

    /**
     * I17: 响应式 data-* 属性的值变成 null/undefined 时，dataset 赋值会把它
     * 字符串化成字面 "undefined"/"null"。语义应该是移除该属性。
     */
    test('I17: reactive data-* attr with null/undefined removes the attribute', async () => {
        const root = createRoot(rootEl)
        const v = atom<string|undefined>('x')
        root.render(<div id="t" data-foo={() => v()}>x</div>)
        const el = rootEl.querySelector('#t') as HTMLElement
        expect(el.getAttribute('data-foo')).toBe('x')

        v(undefined)
        expect(el.hasAttribute('data-foo')).toBe(false)

        v('y')
        expect(el.getAttribute('data-foo')).toBe('y')
        root.destroy()
    })

    /**
     * I18: 动态 boundProps 函数返回 falsy（cond ? {...} : undefined 的条件写法）时，
     * markBoundProp 曾直接对 undefined 做 Object.defineProperty 抛 TypeError。
     * falsy 返回值应视为空 props。
     */
    test('I18: dynamic boundProps function returning falsy is treated as empty props', () => {
        const root = createRoot(rootEl)
        function Base(props: any, {createElement}: RenderContext) {
            return <div id="t">{props.a ?? 'none'}</div>
        }
        ;(Base as Component).boundProps = [() => undefined as any]
        expect(() => root.render(<Base/>)).not.toThrow()
        expect(rootEl.querySelector('#t')!.textContent).toBe('none')
        root.destroy()
    })
})
