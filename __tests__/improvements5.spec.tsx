/** @jsx createElement */
/**
 * 2026-07 深度 review 第四轮的改进项（见 prompt/output/08-review-2026-07-round4.md）。
 * 修复后断言即为【正确行为】，本文件是这些问题的回归测试。
 *
 * 编号与 review 报告一致（I24-I25）。
 */
import {
    createElement, createRoot, RenderContext,
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

describe('improvements regression (2026-07 review round 4)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I24: AOP key 曾用 split(':') 一刀切，第二个 ':' 之后的部分被静默丢弃：
     * - $a:$b:prop 这类扁平写法的嵌套 AOP key（本应作为 prop '$b:prop' 传给子组件自己解析）
     * - $icon:xlink:href 这类带 namespace 的属性名
     */
    describe('I24: AOP keys with more than one colon', () => {
        test('flat nested AOP key $middle:$leaf:prop reaches the grandchild element', () => {
            const root = createRoot(rootEl)
            function Leaf({}: any, {createElement}: RenderContext) {
                return <div as="leaf">leaf</div>
            }
            function Middle({}: any, {createElement}: RenderContext) {
                return createElement(Leaf as any, {as: 'inner'})
            }
            root.render(createElement(Middle as any, {'$inner:$leaf:data-x': 'deep'}))
            const el = rootEl.querySelector('[data-as="leaf"]') as HTMLElement
            expect(el.dataset.x).toBe('deep')
            root.destroy()
        })

        test('flat nested AOP merge-handle key $middle:$leaf:prop_ reaches the grandchild', () => {
            const root = createRoot(rootEl)
            function Leaf({}: any, {createElement}: RenderContext) {
                return <div as="leaf" data-x="origin">leaf</div>
            }
            function Middle({}: any, {createElement}: RenderContext) {
                return createElement(Leaf as any, {as: 'inner'})
            }
            root.render(createElement(Middle as any, {
                '$inner:$leaf:data-x_': (origin: string) => `${origin}-patched`,
            }))
            const el = rootEl.querySelector('[data-as="leaf"]') as HTMLElement
            expect(el.dataset.x).toBe('origin-patched')
            root.destroy()
        })

        test('namespaced attribute name in AOP key ($icon:xlink:href)', () => {
            const root = createRoot(rootEl)
            function Icon({}: any, {createElement, createSVGElement}: RenderContext) {
                return createSVGElement('svg', {}, createSVGElement('use', {as: 'use'}))
            }
            root.render(createElement(Icon as any, {'$use:xlink:href': '#icon-a'}))
            const use = rootEl.querySelector('use')!
            expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#icon-a')
            root.destroy()
        })
    })

    /**
     * I25: mergeProp 对 class（与 className 同义）合并成数组，
     * 但 setAttribute 的数组分支只把 class 当「取最后一个」的覆盖属性处理：
     * AOP 的 $name:class 覆盖值被静默丢弃（原值永远获胜）。
     */
    describe('I25: class merges like className', () => {
        test('AOP $name:class merges with the origin class', () => {
            const root = createRoot(rootEl)
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="item" class="origin">inner</div>
            }
            root.render(<Inner $item:class={'override'}/>)
            const el = rootEl.querySelector('[data-as="item"]') as HTMLElement
            expect(el.classList.contains('origin')).toBe(true)
            expect(el.classList.contains('override')).toBe(true)
            root.destroy()
        })

        test('class supports the object form like className', () => {
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <div id="t" class={{a: true, b: false}}>x</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.classList.contains('a')).toBe(true)
            expect(el.classList.contains('b')).toBe(false)
            root.destroy()
        })
    })
})
