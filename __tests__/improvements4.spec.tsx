/** @jsx createElement */
/**
 * 2026-07 深度 review 第三轮的改进项（见 prompt/output/07-review-2026-07-round3.md）。
 * 编号与 review 报告一致（I19-I23，其中 I21-I23 是原报告观察项 O4-O6 的落地）。
 */
import {
    createElement, createRoot, atom, RenderContext, Form, FormContext, FormItemInstance,
} from "@framework";
import {
    RxMap,
    enableData0RetainedObjectDiagnostics,
    disableData0RetainedObjectDiagnostics,
    getData0RetainedObjectDiagnosticsSnapshot,
} from "data0";
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

    /**
     * I21: DataContext.get 曾只沿父级 hostPath 查找（不含当前组件），
     * 组件自己 context.set 之后自己 context.get 拿不到。
     */
    test('I21: a component can read the context value it set itself', () => {
        const root = createRoot(rootEl)
        const ContextType = Symbol('SelfContext')
        let ownValue: any = null
        let childValue: any = null

        function Child({}: any, {createElement, context}: RenderContext) {
            childValue = context.get(ContextType)
            return <div>child</div>
        }
        function App({}: any, {createElement, context}: RenderContext) {
            context.set(ContextType, 'v1')
            ownValue = context.get(ContextType)
            return <div><Child/></div>
        }
        root.render(<App/>)
        expect(ownValue).toBe('v1')
        // 子组件的查找（父链）不受影响
        expect(childValue).toBe('v1')
        root.destroy()
    })

    /**
     * I22: $self: 前缀的值里再嵌套 $ 配置 key（如 $self:$inner:style）
     * 曾被 separateProps 解析进一个被丢弃的临时 itemConfig，静默失效。
     * 现在应作为普通 prop 合并进目标组件的 props，由目标组件解析。
     */
    test('I22: $self:-prefixed nested AOP config keys reach the inner component', () => {
        const root = createRoot(rootEl)
        function Leaf({}: any, {createElement}: RenderContext) {
            return <div as="inner" id="leaf">leaf</div>
        }
        // Middle 包装 Leaf，并用 $self: 声明「合并到自己 props」的透传配置
        // （JSX 属性名只允许一个冒号，多段配置 key 用 createElement 直接传）
        function Middle(props: any, {createElement}: RenderContext) {
            return createElement(Leaf as any, {as: 'leaf', '$self:$inner:data-x': 'from-middle'})
        }
        function App({}: any, {createElement}: RenderContext) {
            return <Middle/>
        }
        root.render(<App/>)
        expect((rootEl.querySelector('#leaf') as HTMLElement).dataset.x).toBe('from-middle')
        root.destroy()
    })

    /**
     * I23: Form 多值（multiple）unregister 曾用 RxList.findIndex 做一次性位置查询，
     * 每次调用都会创建一个永不销毁的响应式 computed（订阅泄漏）。
     */
    test('I23: Form multiple unregister does not leak reactive effects', () => {
        const values = new RxMap<string, any>({})
        let formContext: any = null
        function Item({}: any, {createElement, context}: RenderContext) {
            formContext = context.get(FormContext)
            return <div>item</div>
        }
        const root = createRoot(rootEl)
        root.render(<Form name="test" values={values}><Item/></Form>)

        const makeInstance = (v: any) => ({value: atom(v), reset() {}, clear() {}}) as unknown as FormItemInstance
        const a = makeInstance(1)
        const b = makeInstance(2)
        formContext.register('multi', a, true)
        formContext.register('multi', b, true)

        enableData0RetainedObjectDiagnostics()
        const before = getData0RetainedObjectDiagnosticsSnapshot().reactiveEffects.totalActive
        formContext.unregister('multi', a, true)
        formContext.unregister('multi', b, true)
        const after = getData0RetainedObjectDiagnosticsSnapshot().reactiveEffects.totalActive
        disableData0RetainedObjectDiagnostics()

        // unregister 是一次性操作，不应该留下任何存活的响应式 effect
        expect(after - before).toBe(0)
        // 行为不变：值被正确移除
        expect((values.get('multi') as any).data.length).toBe(0)
        root.destroy()
    })
})
