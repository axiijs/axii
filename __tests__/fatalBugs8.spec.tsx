/** @jsx createElement */
/**
 * 2026-07 第七轮深度 review 的致命问题回归测试（F25-F28）。
 * 每个测试都先在未修复代码上确认失败，再随修复转为回归测试。
 *
 * 本轮问题集中在 StyleManager 的「样式形态」处理上：
 *
 * F25: 响应式 style 函数返回数组（style={() => [base, extra]} 是自然写法）时，
 *  数组被 splitStyleObject 当成 {0: {...}, 1: {...}} 的嵌套样式，
 *  生成 `.cls 0 {...}` 这类非法 selector——整个样式静默失效。
 *
 * F26: style 数组中的条件项翻转为 null/undefined（style={[base, () => cond() ? {...} : null]}）时，
 *  splitStyleObject 对 null 返回空字符串，patch 阶段 cssText='' 把数组里
 *  其他 style 对象刚写入的值一起清掉。
 *
 * F27: 响应式 style 从「嵌套样式（stylesheet 路径）」翻转为纯 inline/null 时，
 *  上一轮挂上的 rolling stylesheet class 永远留在元素上：
 *  旧 stylesheet 里的嵌套规则（:hover、属性选择器、子元素选择器等）永久生效。
 *
 * F28: stylesheet 路径（嵌套样式/boundProps/keyframes）把 CSS 自定义属性小写化
 *  （--mainColor → --maincolor）。自定义属性大小写敏感，var(--mainColor) 永远读不到值；
 *  inline 路径本来就保留原样，两条路径行为不一致。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, createElement, createRoot, RenderContext} from "@framework";

describe('fatal bug regression (2026-07 round-7 review)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        document.adoptedStyleSheets = []
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('F25: reactive style function returning an array works like a static style array', async () => {
        const size = atom(12)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f25"
                style={() => [{color: 'rgb(255, 0, 0)'}, {fontSize: size()}]}
            />
        }
        root.render(<App/>)

        const el = document.querySelector('#f25') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(el).fontSize).toBe('12px')

        size(20)
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).fontSize).toBe('20px')
        expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
    })

    test('F26: falsy conditional item in a style array must not wipe earlier styles', async () => {
        const cond = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f26"
                style={[{color: 'rgb(255, 0, 0)'}, () => cond() ? {fontSize: 20} : null]}
            />
        }
        root.render(<App/>)
        const el = document.querySelector('#f26') as HTMLElement
        expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(el).fontSize).toBe('20px')

        cond(false)
        await new Promise(r => setTimeout(r, 10))
        // 条件项翻转只应该移除自己的 fontSize，不能把前面的 color 一起清掉
        expect(getComputedStyle(el).fontSize).not.toBe('20px')
        expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
    })

    test('F27a: nested style flipping to plain inline style removes the stale stylesheet class', async () => {
        const useNested = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f27a"
                style={() => useNested() ? {color: 'red', '&:hover': {color: 'blue'}} : {color: 'green'}}
            />
        }
        root.render(<App/>)

        const el = document.querySelector('#f27a') as HTMLElement
        const initialClasses = Array.from(el.classList)
        expect(initialClasses.length).toBeGreaterThan(0)

        useNested(false)
        await new Promise(r => setTimeout(r, 10))

        expect(el.style.color).toBe('green')
        // 旧的 rolling stylesheet class 不应该残留（残留的话 :hover 规则永久生效）
        const stale = Array.from(el.classList).filter(c => initialClasses.includes(c))
        expect(stale).toEqual([])
    })

    test('F27b: nested rule (attribute selector) must stop applying after the flip', async () => {
        const useNested = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f27b"
                style={() => useNested() ? {'&[data-x]': {backgroundColor: 'rgb(255, 0, 0)'}} : {color: 'green'}}
            />
        }
        root.render(<App/>)

        const el = document.querySelector('#f27b') as HTMLElement
        el.setAttribute('data-x', '1')
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).backgroundColor).toBe('rgb(255, 0, 0)')

        useNested(false)
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).backgroundColor).not.toBe('rgb(255, 0, 0)')
    })

    test('F27c: conditional nested style flipping to null deactivates nested rules', async () => {
        const active = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f27c"
                style={() => active() && {'&[data-x]': {backgroundColor: 'rgb(255, 0, 0)'}}}
            />
        }
        root.render(<App/>)

        const el = document.querySelector('#f27c') as HTMLElement
        el.setAttribute('data-x', '1')
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).backgroundColor).toBe('rgb(255, 0, 0)')

        active(false)
        await new Promise(r => setTimeout(r, 10))
        expect(getComputedStyle(el).backgroundColor).not.toBe('rgb(255, 0, 0)')
    })

    test('F27d: repeated shape flips must not grow adoptedStyleSheets unboundedly', async () => {
        const useNested = atom(true)
        function App({}: any, {createElement}: RenderContext) {
            return <div
                id="f27d"
                style={() => useNested() ? {color: 'red', '&:hover': {color: 'blue'}} : {color: 'green'}}
            />
        }
        root.render(<App/>)

        for (let i = 0; i < 20; i++) {
            useNested(!useNested.raw)
            await new Promise(r => setTimeout(r, 0))
        }
        // 滚动 buffer 语义下 stylesheet 数量应该保持 O(1)
        expect(document.adoptedStyleSheets.length).toBeLessThanOrEqual(3)
    })

    test('F28: camelCase CSS custom property in nested style keeps its case', () => {
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f28" style={{
                '--mainColor': 'rgb(0, 128, 0)',
                '& span': {color: 'var(--mainColor)'},
            }}><span>x</span></div>
        }
        root.render(<App/>)
        const span = document.querySelector('#f28 span') as HTMLElement
        expect(getComputedStyle(span).color).toBe('rgb(0, 128, 0)')
    })
})
