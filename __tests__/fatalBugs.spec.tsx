/** @jsx createElement */
/**
 * 本文件最初用于复现代码 review 中发现的致命问题（见 prompt/output/02-fatal-issues.md），
 * 对应的 bug 修复后，断言已经反转为【正确行为】，本文件即为这些 bug 的回归测试。
 *
 * 编号与 review 报告一致：
 * - BUG 1a/1b, 2, 3, 4a/4b, 5, 8 在本文件（浏览器环境）中验证；
 * - BUG 6（仓库无法独立构建/测试 + package.json main 指向不存在的文件）
 *   由 vitest.config.ts 的 data0 fallback alias、devDependencies 中的 data0、
 *   以及 __tests__/node/packageJson.spec.ts 验证；
 * - BUG 7（模块加载即执行浏览器 API，Node/SSR 环境 import 即崩）在
 *   __tests__/node/importInNode.spec.ts 中验证，需用 node 环境运行：
 *   npx vitest run --config vitest.node.config.ts
 */
import {createElement, createRoot, Form, FormContext, RenderContext, setAttribute, ExtendedElement} from "@framework";
import {atom, RxList, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

function nextMicrotask() {
    return new Promise<void>(resolve => queueMicrotask(resolve))
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))

describe('fatal bug regression', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * BUG 1a: ComponentHost.render 中 root.on('attach', ...) 的返回值（退订函数）必须保存到
     * this.deleteLayoutEffectCallback，destroy 时退订。
     * 正确行为：渲染到 detached 容器时，组件在 root attach 之前被销毁，
     * 它的 layoutEffect 不应再执行；仍然存活的组件的 layoutEffect 应正常执行。
     */
    test('BUG 1a: layoutEffect of a destroyed component must not run when root attaches later', async () => {
        const detachedEl = document.createElement('div')
        const root = createRoot(detachedEl)

        const show = atom(true)
        let destroyedLayoutEffectRuns = 0
        let aliveLayoutEffectRuns = 0

        function Inner({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                destroyedLayoutEffectRuns++
            })
            return <div>inner</div>
        }

        function Alive({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                aliveLayoutEffectRuns++
            })
            return <div>alive</div>
        }

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {() => show() ? <Inner/> : null}
                <Alive/>
            </div>
        }

        root.render(<App/>)
        // root 未 attach，layoutEffect 尚未执行，符合预期
        expect(destroyedLayoutEffectRuns).toBe(0)
        expect(aliveLayoutEffectRuns).toBe(0)

        // 在 attach 之前销毁 Inner（FunctionHost 的重算是 microtask 异步的）
        show(false)
        await nextMicrotask()
        expect(detachedEl.textContent).not.toContain('inner')

        // 之后容器才真正挂载，按框架约定手动派发 attach
        document.body.appendChild(detachedEl)
        root.dispatch('attach')

        // 已销毁组件的 layoutEffect 不应执行，存活组件的应正常执行
        expect(destroyedLayoutEffectRuns).toBe(0)
        expect(aliveLayoutEffectRuns).toBe(1)

        root.destroy()
    })

    /**
     * BUG 1b: StaticHost 同样必须保存 attach 监听的退订函数（removeAttachListener）。
     * 正确行为：元素在 root attach 之前被销毁时，ref 收到 null 之后不应再被赋值；
     * 存活元素的 ref 应在 attach 时正常附加。
     */
    test('BUG 1b: ref of a destroyed element must not be re-attached when root attaches later', async () => {
        const detachedEl = document.createElement('div')
        const root = createRoot(detachedEl)

        const show = atom(true)
        const refCalls: any[] = []
        const aliveRefCalls: any[] = []

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {() => show() ? <span ref={(el: any) => refCalls.push(el)}>x</span> : null}
                <span ref={(el: any) => aliveRefCalls.push(el)}>alive</span>
            </div>
        }

        root.render(<App/>)
        expect(refCalls).toEqual([])
        expect(aliveRefCalls).toEqual([])

        show(false)
        await nextMicrotask()
        // destroy 时 detachRef 被调用，ref 收到 null
        expect(refCalls).toEqual([null])

        document.body.appendChild(detachedEl)
        root.dispatch('attach')

        // 已销毁元素的 ref 不应再被赋值
        expect(refCalls).toEqual([null])
        // 存活元素的 ref 应正常附加
        expect(aliveRefCalls.length).toBe(1)
        expect((aliveRefCalls[0] as HTMLElement).isConnected).toBe(true)

        root.destroy()
    })

    /**
     * BUG 2: Root.destroy() 必须先派发 detach 再清空监听器。
     * 正确行为：destroy 时 detach 监听器应被调用（且只调用一次）。
     */
    test('BUG 2: detach event is dispatched on root.destroy()', () => {
        const root = createRoot(rootEl)
        root.render(<div>hello</div>)

        let detachFired = 0
        root.on('detach', () => {
            detachFired++
        })

        root.destroy()
        expect(detachFired).toBe(1)

        // destroy 之后监听器已被清空，再次 dispatch 不应重复触发
        root.dispatch('detach')
        expect(detachFired).toBe(1)
    })

    /**
     * BUG 3: Form.tsx register() 的 multiple 分支曾存在 ASI（自动分号插入）陷阱，
     * push(...) 的返回值被当作函数调用而抛 TypeError。
     * 正确行为：multiple 注册应正常把 value/instance 推入列表，不抛错；
     * unregister 应能把对应项移除。
     */
    test('BUG 3: Form register with multiple=true works without error', () => {
        const root = createRoot(rootEl)
        let registerError: any = null
        let formContextValue: any = null

        const instance1 = {value: atom(1), reset() {}, clear() {}}
        const instance2 = {value: atom(2), reset() {}, clear() {}}

        const values = new RxMap<string, any>({})

        function Item({}: any, {createElement, context}: RenderContext) {
            const formContext = context.get(FormContext)
            formContextValue = formContext
            try {
                formContext.register('field', instance1, true)
                formContext.register('field', instance2, true)
            } catch (e) {
                registerError = e
            }
            return <div>item</div>
        }

        root.render(<Form name="test" values={values}><Item/></Form>)

        expect(registerError).toBe(null)
        const valueList = values.get('field') as RxList<any>
        expect(valueList.raw.length).toBe(2)
        expect(valueList.raw[0]).toBe(instance1.value)
        expect(valueList.raw[1]).toBe(instance2.value)

        // unregister 应能把对应项移除
        formContextValue.unregister('field', instance1, true)
        expect(valueList.raw.length).toBe(1)
        expect(valueList.raw[0]).toBe(instance2.value)

        root.destroy()
    })

    /**
     * BUG 4a: RxListHost 的 reorder 分支曾用 placeholder.parentElement.firstChild 作为插入锚点，
     * 隐含假设列表独占父元素。
     * 正确行为：排序只改变列表项之间的相对顺序，前面的兄弟节点（如 <h1>）位置不受影响。
     */
    test('BUG 4a: sorting an RxList that has a preceding sibling keeps the sibling in place', () => {
        const root = createRoot(rootEl)
        const list = new RxList<number>([3, 1, 2])

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <h1>title</h1>
                {list.map(item => <span>{item}</span>)}
            </div>
        }

        root.render(<App/>)
        const container = rootEl.firstElementChild!
        // 初始渲染顺序正确：h1 在前
        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['H1', 'SPAN', 'SPAN', 'SPAN'])
        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['3', '1', '2'])

        list.sortSelf((a, b) => a - b)

        // 列表项之间排序正确，且 h1 仍是第一个子元素
        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['1', '2', '3'])
        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['H1', 'SPAN', 'SPAN', 'SPAN'])

        root.destroy()
    })

    test('BUG 4a: sorting an RxList that is the only child of its parent still works', () => {
        const root = createRoot(rootEl)
        const list = new RxList<number>([3, 1, 2])

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {list.map(item => <span>{item}</span>)}
            </div>
        }

        root.render(<App/>)
        const container = rootEl.firstElementChild!
        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['3', '1', '2'])

        list.sortSelf((a, b) => a - b)
        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['1', '2', '3'])

        root.destroy()
    })

    /**
     * BUG 4b: EXPLICIT_KEY_CHANGE（list.set(0, ...)）分支曾用 parentElement.firstChild 作为
     * index === 0 的插入锚点。
     * 正确行为：替换后的元素应保持在 h1 之后的列表区域内。
     */
    test('BUG 4b: list.set(0, ...) with a preceding sibling keeps the new item inside the list region', () => {
        const root = createRoot(rootEl)
        const list = new RxList<number>([1, 2, 3])

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <h1>title</h1>
                {list.map(item => <span>{item}</span>)}
            </div>
        }

        root.render(<App/>)
        const container = rootEl.firstElementChild!
        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['H1', 'SPAN', 'SPAN', 'SPAN'])

        list.set(0, 9)

        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['9', '2', '3'])
        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['H1', 'SPAN', 'SPAN', 'SPAN'])
        expect(container.children[1].textContent).toBe('9')

        root.destroy()
    })

    test('BUG 4b: explicit key change of the last item of a single-item list works', () => {
        const root = createRoot(rootEl)
        const list = new RxList<number>([1])

        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <h1>title</h1>
                {list.map(item => <span>{item}</span>)}
            </div>
        }

        root.render(<App/>)
        const container = rootEl.firstElementChild!

        list.set(0, 9)

        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['H1', 'SPAN'])
        expect(container.children[1].textContent).toBe('9')

        root.destroy()
    })

    /**
     * BUG 5: setAttribute 把 onChange 别名成 input 事件后，曾与 onInput 在 _listeners 上撞 key，
     * assert 直接抛错（生产构建同样会崩）。
     * 正确行为：同时监听 onChange 和 onInput 是合理写法，两个 handler 都应被触发。
     */
    test('BUG 5: element with both onChange and onInput works and both handlers fire', () => {
        const calls: string[] = []
        const el = createElement('input', {
            onChange: () => calls.push('change'),
            onInput: () => calls.push('input'),
        }) as HTMLInputElement

        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['change', 'input'])
    })

    test('BUG 5: unbinding an event by setting it to null does not throw', () => {
        const calls: string[] = []
        const el = createElement('input', {
            onInput: () => calls.push('input'),
        }) as HTMLInputElement

        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['input'])

        // 再次 setAttribute 置空来解绑，不应命中 "already listened" 断言
        expect(() => {
            setAttribute(el as ExtendedElement, 'onInput', null)
        }).not.toThrow()

        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['input'])
    })

    /**
     * BUG 8: 动态样式（函数/atom + 嵌套 selector）每次更新都会以新的滚动 id 生成新的 CSSStyleSheet，
     * 旧的曾经只减引用计数、不从 document.adoptedStyleSheets 移除，导致无上限累积。
     * 正确行为：使用长度为 2 的滚动 buffer（上一个留给 cloneNode），数量保持 O(1)；
     * host destroy 后全部清理。
     */
    test('BUG 8: dynamic style with nested selector keeps adoptedStyleSheets bounded', async () => {
        const initialCount = document.adoptedStyleSheets.length
        const root = createRoot(rootEl)
        const color = atom('rgb(0, 0, 0)')

        function App({}: any, {createElement}: RenderContext) {
            return <div style={() => ({color: color(), '&:hover': {color: 'blue'}})}>text</div>
        }

        root.render(<App/>)
        const countAfterRender = document.adoptedStyleSheets.length

        const UPDATE_COUNT = 20
        for (let i = 1; i <= UPDATE_COUNT; i++) {
            color(`rgb(${i}, 0, 0)`)
        }

        // 滚动 buffer 之外的 stylesheet 应被及时清除，数量保持 O(1)
        const growth = document.adoptedStyleSheets.length - countAfterRender
        expect(growth).toBeLessThanOrEqual(1)

        // 最新的样式应仍然生效
        const el = rootEl.querySelector('div')!
        expect(getComputedStyle(el).color).toBe(`rgb(${UPDATE_COUNT}, 0, 0)`)

        // destroy 后全部清理
        root.destroy()
        await sleep(10)
        expect(document.adoptedStyleSheets.length).toBe(initialCount)
    })
})
