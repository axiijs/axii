/** @jsx createElement */
/**
 * 2026-07 第六轮深度 review 的改进项回归测试（I28-I30）。
 *
 * I28: DOM 层的事件判断此前是宽松的 startsWith('on')：once/online 这类普通 on* prop
 *  会被吞进事件分支——属性永远设不到 DOM 上，还会挂上一个永不触发的假监听器
 *  （mergeProp 早已按 /^on[A-Z]/ 约定修复，DOM.ts 的 setAttribute/isValidAttribute
 *  一直没有对齐）。修复后普通 on* prop 走属性路径，atom 值还能建立响应式绑定。
 *
 * I29: PropTypes.any 的 check 直接抛错：oneOfType/arrayOf/shapeOf 组合中含 any
 *  （shapeOf({x: any}) 是自然写法）时 check 调用即崩溃。any 的 check 语义应为恒真。
 *
 * I30: RxDOMState 的 ref 从一个元素直接切换到另一个元素（中间没有 null）时，
 *  旧元素的 abort 被新 listen 覆盖：旧监听/ResizeObserver 观察永久泄漏，
 *  旧元素的变化还会继续写进同一个 value atom。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, createElement, createRoot, RenderContext, RxDOMSize} from "@framework";
import PropTypes from "../src/propTypes";

describe('improvements regression (2026-07 round-6 review)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('I28a: lowercase on* non-event props are set as attributes, not swallowed as events', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="i28a" once="true">x</div>
        }
        root.render(<App/>)
        expect(document.getElementById('i28a')!.getAttribute('once')).toBe('true')
    })

    test('I28b: atom-valued on* non-event prop becomes a reactive attribute binding', () => {
        const online = atom('yes')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="i28b" online={online}>x</div>
        }
        root.render(<App/>)
        const el = document.getElementById('i28b')!
        expect(el.getAttribute('online')).toBe('yes')
        online('no')
        expect(el.getAttribute('online')).toBe('no')
    })

    test('I28c: real events (on + uppercase) still bind, including Capture', () => {
        let clicked = 0
        let captured = 0
        function App({}: any, {createElement}: RenderContext) {
            return <div id="i28c" onClick={() => clicked++} onClickCapture={() => captured++}>x</div>
        }
        root.render(<App/>)
        document.getElementById('i28c')!.dispatchEvent(new MouseEvent('click'))
        expect(clicked).toBe(1)
        expect(captured).toBe(1)
    })

    test('I29: PropTypes.any inside combinators does not throw', () => {
        expect(() => PropTypes.oneOfType([PropTypes.string, PropTypes.any]).check(1)).not.toThrow()
        expect(PropTypes.oneOfType([PropTypes.string, PropTypes.any]).check(1)).toBe(true)
        expect(PropTypes.arrayOf(PropTypes.any).check([1, 'a'])).toBe(true)
        expect(PropTypes.shapeOf({x: PropTypes.any}).check({x: 1})).toBe(true)
        expect(PropTypes.any.check(undefined)).toBe(true)
    })

    test('I30: RxDOMSize ref moved directly between elements unobserves the old element', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)
        document.body.appendChild(el2)
        const size = new RxDOMSize()
        size.ref(el1)
        expect(RxDOMSize.resizeTargetToStates.get(el1)?.size).toBe(1)
        // 直接切换到另一个元素（中间没有 null）
        size.ref(el2)
        expect(RxDOMSize.resizeTargetToStates.get(el2)?.size).toBe(1)
        // 旧元素必须被取消观察，否则观察集合与 value 订阅永久泄漏
        expect(RxDOMSize.resizeTargetToStates.get(el1)).toBeUndefined()
        size.ref(null)
        expect(RxDOMSize.resizeTargetToStates.get(el2)).toBeUndefined()
    })
})
