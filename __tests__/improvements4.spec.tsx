/** @jsx createElement */
/**
 * 2026-07 深度 review 第三轮的改进项（见 prompt/output/07-review-2026-07-round3.md）。
 * 编号与 review 报告一致（I19-I20）。
 */
import {
    createElement, createRoot, atom, RenderContext,
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('improvements (2026-07 review round 3)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I19: 响应式的带 namespace 属性（如 xlink:href）曾因 key 含 ':' 被
     * collectReactiveAttr 一刀切跳过（连初值都不设置）；同时 isSVG 曾按静态子树的根判断，
     * HTML 里嵌套的 SVG 元素拿不到 namespace/驼峰属性处理。
     */
    describe('I19: reactive namespaced attributes and per-element isSVG', () => {
        test('reactive xlink:href on nested svg use element is applied and reactive', async () => {
            const root = createRoot(rootEl)
            const href = atom('#icon-a')
            function App({}: any, {createSVGElement, createElement}: RenderContext) {
                return <div>
                    {createSVGElement('svg', {}, createSVGElement('use', {'xlink:href': () => href()}))}
                </div>
            }
            root.render(<App/>)
            const use = rootEl.querySelector('use')!
            expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#icon-a')

            href('#icon-b')
            await wait(10)
            expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#icon-b')
            root.destroy()
        })

        test('reactive camelCase svg attribute on svg nested in html subtree gets dash-style name', async () => {
            const root = createRoot(rootEl)
            const width = atom(2)
            function App({}: any, {createSVGElement, createElement}: RenderContext) {
                return <div>
                    {createSVGElement('svg', {}, createSVGElement('line', {strokeWidth: () => width()}))}
                </div>
            }
            root.render(<App/>)
            const line = rootEl.querySelector('line')!
            expect(line.getAttribute('stroke-width')).toBe('2')
            width(4)
            await wait(10)
            expect(line.getAttribute('stroke-width')).toBe('4')
            root.destroy()
        })

        test('prop:/$ prefixed keys are still not treated as DOM attributes', () => {
            const root = createRoot(rootEl)
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="item" id="inner">inner</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <Inner $item:data-x={() => 'v'}/>
            }
            // $ 前缀 key 走 AOP 配置而不是响应式 DOM 属性
            root.render(<App/>)
            expect((rootEl.querySelector('#inner') as HTMLElement).dataset.x).toBe('v')
            root.destroy()
        })
    })

    /**
     * I20: `$name:_eventTarget`（AOP 事件转发）曾只有解析端没有消费端，静默不生效。
     * 现在传入的函数会收到一个 dispatch 回调，把事件克隆后直接派发到目标元素的监听上。
     */
    test('I20: $item:_eventTarget forwards events to the inner element', () => {
        const root = createRoot(rootEl)
        const received: string[] = []
        let forward!: (e: Event) => any
        function Child({}: any, {createElement}: RenderContext) {
            return <div as="item" id="child" onKeyDown={(e: KeyboardEvent) => received.push(e.key)}>child</div>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <Child $item:_eventTarget={(dispatchToItem: (e: Event) => any) => { forward = dispatchToItem }}/>
        }
        root.render(<App/>)
        expect(typeof forward).toBe('function')
        forward(new KeyboardEvent('keydown', {key: 'Enter'}))
        expect(received).toEqual(['Enter'])
        root.destroy()
    })
})
