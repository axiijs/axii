/** @jsx createElement */
/**
 * 2026-07 第六轮深度 review 的致命问题回归测试（F22-F24）。
 * 每个测试都先在未修复代码上确认失败，再随修复转为回归测试。
 *
 * F22: RxListHost.handleSplice 直接用 data0 透传的原始 splice 参数（argv[0]）扫插入锚点，
 *  负数 start（splice(-1, 0, x) 是 Array#splice 的合法用法）会从错误的位置开始扫：
 *  新行插到错误的 DOM 位置（数据与 DOM 永久错位）；|start| 超过长度的负数还会读到
 *  undefined host，在 computed patch 里抛 TypeError（异步路径下变成 unhandled rejection，
 *  新行完全不渲染）。
 *
 * F23: Portal 渲染时 container 还没连入文档（最常见：container 本身就是外层组件树的
 *  一部分，或外层 root 尚未 attach）时，内层 root 永远等不到 attach：
 *  portal 内容里的 layoutEffect/ref 永不执行，依赖 DOM 测量的逻辑全部失效。
 *
 * F24: className 对象形式的 value 是 atom/函数（className={{active: isActive}}）时，
 *  被 isValidAttribute 判为静态属性：atom 从未被读取（没有任何响应性），
 *  且 atom 本身是 function（恒 truthy），class 永远挂在元素上。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, createElement, createRoot, RenderContext, RxList} from "@framework";

describe('fatal bug regression (2026-07 round-6 review)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('F22a: splice with negative start inserts at the right DOM position', () => {
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f22a">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)
        // 在最后一个之前插入
        list.splice(-1, 0, 'x')
        expect(list.data).toEqual(['a', 'b', 'x', 'c'])
        const texts = Array.from(document.querySelectorAll('#f22a span')).map(el => el.textContent)
        expect(texts).toEqual(['a', 'b', 'x', 'c'])
    })

    test('F22b: splice with |start| beyond length clamps to 0 and still renders the new row', () => {
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f22b">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)
        list.splice(-10, 0, 'x')
        expect(list.data).toEqual(['x', 'a', 'b', 'c'])
        const texts = Array.from(document.querySelectorAll('#f22b span')).map(el => el.textContent)
        expect(texts).toEqual(['x', 'a', 'b', 'c'])
    })

    test('F22c: splice with negative start deletes the right rows', () => {
        const list = new RxList(['a', 'b', 'c', 'd'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f22c">{list.map(item => <span>{item}</span>)}</div>
        }
        root.render(<App/>)
        list.splice(-2, 1)
        expect(list.data).toEqual(['a', 'b', 'd'])
        const texts = Array.from(document.querySelectorAll('#f22c span')).map(el => el.textContent)
        expect(texts).toEqual(['a', 'b', 'd'])
    })

    test('F23: portal into a container that connects with the outer tree still runs layoutEffect/ref', () => {
        const portalContainer = document.createElement('div')
        let refValue: any = null
        let layoutEffectRan = false
        function ModalContent({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { layoutEffectRan = true })
            return <div ref={(el: any) => refValue = el} id="f23-inner">portal</div>
        }
        function App({}: any, {createElement, createPortal}: RenderContext) {
            return <div>
                {createPortal(<ModalContent/>, portalContainer)}
                {portalContainer}
            </div>
        }
        root.render(<App/>)
        expect(portalContainer.isConnected).toBe(true)
        expect(layoutEffectRan).toBe(true)
        expect(refValue).toBe(document.getElementById('f23-inner'))
    })

    test('F23b: portal into an already-connected container keeps the old behavior', () => {
        const portalContainer = document.createElement('div')
        document.body.appendChild(portalContainer)
        let layoutEffectRan = false
        function ModalContent({}: any, {createElement, useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { layoutEffectRan = true })
            return <div id="f23b-inner">portal</div>
        }
        function App({}: any, {createElement, createPortal}: RenderContext) {
            return <div>{createPortal(<ModalContent/>, portalContainer)}</div>
        }
        root.render(<App/>)
        expect(layoutEffectRan).toBe(true)
    })

    test('F24: className object with atom values is reactive and respects truthiness', () => {
        const active = atom(false)
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f24" className={{active}}>x</div>
        }
        root.render(<App/>)
        const el = document.getElementById('f24')!
        expect(el.getAttribute('class')).toBe('')
        active(true)
        expect(el.getAttribute('class')).toBe('active')
        active(false)
        expect(el.getAttribute('class')).toBe('')
    })

    test('F24b: className array mixing string and reactive object stays reactive', () => {
        const active = atom(false)
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f24b" className={['base', {active}]}>x</div>
        }
        root.render(<App/>)
        const el = document.getElementById('f24b')!
        expect(el.getAttribute('class')).toBe('base')
        active(true)
        expect(el.getAttribute('class')).toBe('base active')
    })
})
