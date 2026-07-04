/** @jsx createElement */
/**
 * 本文件用于复现代码 review 中发现的致命问题。
 *
 * CAUTION 每个测试断言的是【当前的错误行为】，测试通过 = bug 确实存在。
 * 每个测试的注释中标明了正确行为应该是什么。
 * 修复对应 bug 后，这里的断言应当反转。
 *
 * 编号与 review 报告一致：
 * - BUG 1a/1b, 2, 3, 4a/4b, 5, 8 在本文件（浏览器环境）中复现；
 * - BUG 6（仓库无法独立构建/测试：data0 只以 ../data0 兄弟目录源码 alias 存在、
 *   不在 devDependencies 中，package.json main 指向不存在的 index.js）
 *   由本分支对 vitest.config.ts 的修改 + devDependencies 补充 data0 所证实：
 *   修改前在没有兄弟目录 data0 的全新 clone 上，npm install && npm test 无法运行；
 * - BUG 7（模块加载即执行浏览器 API，Node/SSR 环境 import 即崩）在
 *   __tests__/node/importInNode.spec.ts 中复现，需用 node 环境运行：
 *   npx vitest run --config vitest.node.config.ts
 */
import {createElement, createRoot, Form, FormContext, RenderContext} from "@framework";
import {atom, RxList, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

function nextMicrotask() {
    return new Promise<void>(resolve => queueMicrotask(resolve))
}

describe('fatal bug reproduction', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * BUG 1a: ComponentHost.render 中 root.on('attach', ...) 的返回值（退订函数）没有保存到
     * this.deleteLayoutEffectCallback（该字段在全仓库中从未被赋值），destroy 时无法退订。
     * 导致：渲染到 detached 容器时，组件销毁后 attach 事件仍会执行它的 layoutEffect。
     * 正确行为：组件销毁后 layoutEffect 不应再执行（runs 应保持 0）。
     */
    test('BUG 1a: layoutEffect of a destroyed component still runs when root attaches later', async () => {
        const detachedEl = document.createElement('div')
        const root = createRoot(detachedEl)

        const show = atom(true)
        let layoutEffectRuns = 0

        function Inner({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                layoutEffectRuns++
            })
            return <div>inner</div>
        }

        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <Inner/> : null}</div>
        }

        root.render(<App/>)
        // root 未 attach，layoutEffect 尚未执行，符合预期
        expect(layoutEffectRuns).toBe(0)

        // 在 attach 之前销毁 Inner（FunctionHost 的重算是 microtask 异步的）
        show(false)
        await nextMicrotask()
        expect(detachedEl.textContent).not.toContain('inner')

        // 之后容器才真正挂载，按框架约定手动派发 attach
        document.body.appendChild(detachedEl)
        root.dispatch('attach')

        // BUG：已销毁组件的 layoutEffect 仍然被执行了。正确行为应为 0。
        expect(layoutEffectRuns).toBe(1)

        root.destroy()
    })

    /**
     * BUG 1b: StaticHost 同样没有保存 attach 监听的退订函数（removeAttachListener 从未被赋值）。
     * 导致：元素销毁后 attach 事件仍会把已从 DOM 移除的元素再次附加到 ref 上。
     * 正确行为：destroy 时 ref 已被置 null，此后不应再被赋值。
     */
    test('BUG 1b: ref of a destroyed element is re-attached when root attaches later', async () => {
        const detachedEl = document.createElement('div')
        const root = createRoot(detachedEl)

        const show = atom(true)
        const refCalls: any[] = []

        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <span ref={(el: any) => refCalls.push(el)}>x</span> : null}</div>
        }

        root.render(<App/>)
        expect(refCalls).toEqual([])

        show(false)
        await nextMicrotask()
        // destroy 时 detachRef 被调用，ref 收到 null
        expect(refCalls).toEqual([null])

        document.body.appendChild(detachedEl)
        root.dispatch('attach')

        // BUG：attach 后，已销毁元素又被附加到 ref 上（且该元素已不在文档中）。
        // 正确行为：refCalls 应保持 [null]。
        expect(refCalls.length).toBe(2)
        expect(refCalls[1]).toBeInstanceOf(HTMLElement)
        expect((refCalls[1] as HTMLElement).isConnected).toBe(false)

        root.destroy()
    })

    /**
     * BUG 2: Root.destroy() 先执行 eventCallbacks.clear() 再 dispatch('detach')，
     * 所有 detach 监听器都在派发前被清空。
     * 正确行为：destroy 时 detach 监听器应被调用。
     */
    test('BUG 2: detach event is never dispatched on root.destroy()', () => {
        const root = createRoot(rootEl)
        root.render(<div>hello</div>)

        let detachFired = false
        root.on('detach', () => {
            detachFired = true
        })

        root.destroy()

        // BUG：detach 永远不会触发。正确行为应为 true。
        expect(detachFired).toBe(false)
    })

    /**
     * BUG 3: Form.tsx register() 的 multiple 分支存在 ASI（自动分号插入）陷阱：
     *     values.get(name).push(instance.value)
     *     (instances[name] as Array<FormItemInstance>).push(instance)
     * 两行被解析为一个表达式：push(...) 的返回值被当作函数调用，抛出 TypeError。
     * 正确行为：multiple 注册应正常把 instance 推入列表，不抛错。
     */
    test('BUG 3: Form register with multiple=true throws TypeError (ASI hazard)', () => {
        const root = createRoot(rootEl)
        let registerError: any = null

        function Item({}: any, {createElement, context}: RenderContext) {
            const formContext = context.get(FormContext)
            try {
                formContext.register('field', {value: atom(1), reset() {}, clear() {}}, true)
            } catch (e) {
                registerError = e
            }
            return <div>item</div>
        }

        root.render(<Form name="test" values={new RxMap<string, any>({})}><Item/></Form>)

        // BUG：必然抛 TypeError（push 的返回值不是函数）。正确行为应为 registerError === null。
        expect(registerError).toBeInstanceOf(TypeError)
        expect(String(registerError)).toMatch(/is not a function/)

        root.destroy()
    })

    /**
     * BUG 4a: RxListHost 的 reorder 分支用 placeholder.parentElement.firstChild 作为插入锚点，
     * 隐含假设列表独占父元素。当列表前面有兄弟节点（如标题）时，排序会把所有列表项搬到兄弟节点之前。
     * 正确行为：排序只改变列表项之间的相对顺序，<h1> 仍应是第一个子元素。
     */
    test('BUG 4a: sorting an RxList that has a preceding sibling moves items before the sibling', () => {
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

        // 列表项之间的顺序是对的……
        expect(Array.from(container.querySelectorAll('span')).map(el => el.textContent)).toEqual(['1', '2', '3'])
        // BUG：……但所有 span 被搬到了 h1 前面。
        // 正确行为应为 ['H1', 'SPAN', 'SPAN', 'SPAN']。
        expect(Array.from(container.children).map(el => el.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN', 'H1'])

        root.destroy()
    })

    /**
     * BUG 4b: EXPLICIT_KEY_CHANGE（list.set(0, ...)）分支同样用 parentElement.firstChild 作为
     * index === 0 的插入锚点，新元素会被插到兄弟节点之前。
     * 正确行为：替换后的元素应保持在 h1 之后的列表区域内。
     */
    test('BUG 4b: list.set(0, ...) with a preceding sibling inserts the new item before the sibling', () => {
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
        // BUG：新的第 0 项被插到了 h1 前面。
        // 正确行为应为 ['H1', 'SPAN', 'SPAN', 'SPAN']。
        expect(container.children[0].tagName).toBe('SPAN')
        expect(container.children[0].textContent).toBe('9')
        expect(container.children[1].tagName).toBe('H1')

        root.destroy()
    })

    /**
     * BUG 5: setAttribute 把 onChange 别名成 input 事件后，与 onInput 在 _listeners 上撞 key，
     * assert(listeners[eventName] === undefined) 直接抛错。
     * 且 util.assert 的 throw 不受 __DEV__ 控制，生产构建同样会崩。
     * 正确行为：同时监听 onChange 和 onInput 是合理写法，不应崩溃。
     */
    test('BUG 5: element with both onChange and onInput throws "already listened"', () => {
        expect(() => {
            createElement('input', {
                onChange: () => {},
                onInput: () => {},
            })
        }).toThrow(/already listened/)
    })

    /**
     * BUG 8: 动态样式（函数/atom + 嵌套 selector）每次更新都会生成新的 CSSStyleSheet 追加到
     * document.adoptedStyleSheets，旧的只减引用计数、不删除（源码中有 TODO 承认此问题），
     * 要等 host destroy 才批量清理。长期存活、样式高频变化的组件会导致 stylesheet 无限累积。
     * 正确行为：同一元素的动态样式更新应复用/回收 stylesheet，数量应保持 O(1)。
     */
    test('BUG 8: dynamic style with nested selector leaks one stylesheet per update', () => {
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

        const growth = document.adoptedStyleSheets.length - countAfterRender
        // BUG：每次更新泄漏一个 stylesheet。正确行为 growth 应为 0（或至多一个小常数）。
        expect(growth).toBe(UPDATE_COUNT)

        // destroy 后才会批量清理
        root.destroy()
    })
})
