/** @jsx createElement */
/**
 * 2026-07 深度 review 第十三轮回归测试（F49-F51）。
 *
 * 每个用例都先在未修复代码上确认失败；覆盖 value 的 null/undefined 形态空间
 * （progress/meter 的 WebIDL double 崩溃、option/button 的字面量字符串）、
 * reusable 子树的 context 可见性、以及 classic pragma / renderContext 下的 SVG namespace。
 */
import {
    createElement,
    createRoot,
    RenderContext,
} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

describe('fatal bug regression (2026-07 round-13 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    describe('F49: null/undefined value must be safe on every element kind', () => {
        test('static undefined value on progress renders instead of throwing', () => {
            const root = createRoot(rootEl)
            // progress.value 是 WebIDL double：undefined（NaN）赋值曾直接 TypeError 崩溃渲染
            expect(() => {
                root.render(<progress value={undefined} max={100}/>)
            }).not.toThrow()
            const progress = rootEl.querySelector('progress')!
            // 无 value 的 progress 是不确定态（没有 value attribute）
            expect(progress.hasAttribute('value')).toBe(false)
            root.destroy()
        })

        test('reactive progress value flipping to undefined keeps the app alive', () => {
            const root = createRoot(rootEl)
            const percent = atom<number | undefined>(50)
            root.render(<progress value={() => percent()} max={100}/>)
            const progress = rootEl.querySelector('progress')!
            expect(progress.value).toBe(50)
            expect(() => percent(undefined)).not.toThrow()
            expect(progress.hasAttribute('value')).toBe(false)
            // 依赖恢复后继续更新
            percent(80)
            expect(progress.value).toBe(80)
            root.destroy()
        })

        test('undefined value on meter renders instead of throwing', () => {
            const root = createRoot(rootEl)
            expect(() => {
                root.render(<meter value={undefined} max={10}/>)
            }).not.toThrow()
            root.destroy()
        })

        test('null value on option falls back to its text, keeping select match alive', () => {
            const root = createRoot(rootEl)
            root.render(
                <select value="apple">
                    <option value={null}>apple</option>
                    <option value="banana">banana</option>
                </select>
            )
            const select = rootEl.querySelector('select')!
            const option = select.querySelector('option')!
            // value attr 为 null 的语义是「没有 value」，option.value 回退为文本；
            // 曾字符串化成字面 "null"，select 的存值永远匹配不上，选中静默丢失
            expect(option.value).toBe('apple')
            expect(select.value).toBe('apple')
            root.destroy()
        })

        test('reactive option value flipping to undefined falls back to text and re-matches select value', () => {
            const root = createRoot(rootEl)
            const v = atom<string | undefined>('a-value')
            root.render(
                <select value="fallback-text">
                    <option value={() => v()}>fallback-text</option>
                    <option value="other">other</option>
                </select>
            )
            const select = rootEl.querySelector('select')!
            const option = select.querySelector('option')!
            expect(option.value).toBe('a-value')
            v(undefined)
            expect(option.value).toBe('fallback-text')
            // 移除 value attr 后 option 文本才与 select 存值匹配，选中必须恢复
            expect(select.value).toBe('fallback-text')
            root.destroy()
        })

        test('undefined value on button removes the attribute instead of literal "undefined"', () => {
            const root = createRoot(rootEl)
            root.render(<button value={undefined}>x</button>)
            const btn = rootEl.querySelector('button')!
            expect(btn.value).toBe('')
            expect(btn.hasAttribute('value')).toBe(false)
            root.destroy()
        })

        test('null value on checkbox unchecks without polluting the submit value', () => {
            const root = createRoot(rootEl)
            root.render(<input type="checkbox" value={null}/>)
            const checkbox = rootEl.querySelector('input')!
            expect(checkbox.checked).toBe(false)
            // checkbox 的 value property 是表单提交值，不能残留 "null"
            expect(checkbox.value).not.toBe('null')
            root.destroy()
        })
    })

    describe('F50: reusable subtree must see the owner component context', () => {
        test('context.set in the owner component is visible inside reusable content', () => {
            const root = createRoot(rootEl)
            const ContextType = Symbol('ctx')
            let received: any = 'NOT_SET'

            function Inner({}: any, {context, createElement}: RenderContext) {
                received = context.get(ContextType)
                return <span>inner</span>
            }

            function Owner({}: any, {context, createElement, reusable}: RenderContext) {
                context.set(ContextType, 'owner-value')
                const part = reusable(<Inner/>)
                return <div>{part}</div>
            }

            root.render(<Owner/>)
            expect(received).toBe('owner-value')
            root.destroy()
        })

        test('reusable content still sees ancestor contexts through the owner', () => {
            const root = createRoot(rootEl)
            const OuterContext = Symbol('outer')
            let received: any = 'NOT_SET'

            function Inner({}: any, {context, createElement}: RenderContext) {
                received = context.get(OuterContext)
                return <span>inner</span>
            }

            function Middle({}: any, {createElement, reusable}: RenderContext) {
                const part = reusable(<Inner/>)
                return <div>{part}</div>
            }

            function Outer({children}: any, {context, createElement}: RenderContext) {
                context.set(OuterContext, 'outer-value')
                return <div><Middle/></div>
            }

            root.render(<Outer/>)
            expect(received).toBe('outer-value')
            root.destroy()
        })
    })

    describe('F51: svg-only tags land in the SVG namespace from every entry point', () => {
        test('classic pragma (global createElement) creates real SVG elements', () => {
            const root = createRoot(rootEl)
            // 本文件顶部就是 classic pragma：<svg> 直接走全局 createElement，
            // 曾被创建成 HTMLUnknownElement，整个图形静默不显示
            root.render(<svg width={100} height={100}><circle cx={50} cy={50} r={40}/></svg>)
            expect(rootEl.querySelector('svg') instanceof SVGElement).toBe(true)
            expect(rootEl.querySelector('circle') instanceof SVGElement).toBe(true)
            root.destroy()
        })

        test('component renderContext createElement also routes svg-only tags', () => {
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <svg viewBox="0 0 10 10"><rect x={1} y={1} width={8} height={8}/></svg>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('svg') instanceof SVGElement).toBe(true)
            expect(rootEl.querySelector('rect') instanceof SVGElement).toBe(true)
            root.destroy()
        })

        test('ambiguous html/svg tags (a/script/style/title) stay on the HTML path', () => {
            const root = createRoot(rootEl)
            root.render(<a href="#x">link</a>)
            expect(rootEl.querySelector('a') instanceof HTMLAnchorElement).toBe(true)
            root.destroy()
        })

        test('html inside foreignObject stays HTML', () => {
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <svg viewBox="0 0 10 10"><foreignObject><div id="fo-div">x</div></foreignObject></svg>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('foreignObject') instanceof SVGElement).toBe(true)
            expect(rootEl.querySelector('#fo-div') instanceof HTMLDivElement).toBe(true)
            root.destroy()
        })
    })
})
