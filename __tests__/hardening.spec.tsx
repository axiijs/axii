/** @jsx createElement */
/**
 * 同类假设猎杀（sibling sweep）的回归测试。
 *
 * 背景（见 prompt/output/11-contracts-and-invariants.md）：F17 修了「对原始值 defineProperty」
 * 的崩溃，但共享同一假设的兄弟形态——frozen/sealed 对象（Object.freeze 的静态 boundProps /
 * 样式常量是自然写法）——在 defineProperty 新属性时同样 TypeError。标记（__bound/__aop/
 * __dynamic）只是优化用元数据，丢标记的代价远小于渲染期崩溃。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {bindProps, createElement, createRoot, RenderContext} from "@framework";

describe('hardening regression (sibling sweep)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('frozen static boundProps object renders without crashing', () => {
        function Base({color}: any, {createElement}: RenderContext) {
            return <div id="hd1" style={{color}}>x</div>
        }
        const FROZEN_DEFAULTS = Object.freeze({color: 'rgb(255, 0, 0)'})
        const Bound = bindProps(Base, FROZEN_DEFAULTS)
        expect(() => root.render(<Bound/>)).not.toThrow()
        expect(getComputedStyle(document.getElementById('hd1')!).color).toBe('rgb(255, 0, 0)')
    })

    test('dynamic boundProps returning a frozen object renders without crashing', () => {
        function Base({label}: any, {createElement}: RenderContext) {
            return <div id="hd2">{label}</div>
        }
        const FROZEN_PROPS = Object.freeze({label: 'from-bound'})
        Base.boundProps = [() => FROZEN_PROPS]
        expect(() => root.render(<Base/>)).not.toThrow()
        expect(document.getElementById('hd2')!.textContent).toBe('from-bound')
    })

    test('frozen AOP style object ($name:style) renders without crashing', () => {
        function Inner({}: any, {createElement}: RenderContext) {
            return <div as="target" id="hd3">x</div>
        }
        const FROZEN_STYLE = Object.freeze({color: 'rgb(0, 128, 0)'})
        function App({}: any, {createElement}: RenderContext) {
            return <Inner $target:style={FROZEN_STYLE}/>
        }
        expect(() => root.render(<App/>)).not.toThrow()
        expect(getComputedStyle(document.getElementById('hd3')!).color).toBe('rgb(0, 128, 0)')
    })
})
