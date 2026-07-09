/** @jsx createElement */
/**
 * 2026-07 第五轮深度 review 的致命问题回归测试（F20-F21）。
 * 每个测试都先在未修复代码上确认失败，再随修复转为回归测试。
 *
 * F20: generateStyleContent 的 at-rule 分支把 string[] 直接内插进模板字符串，
 *  多条规则被逗号连接：at-rule（@media/@container/@supports）里第一条之后的所有
 *  规则（嵌套 selector、@keyframes/animation）全部变成非法 CSS 被浏览器静默丢弃。
 *
 * F21: 嵌套样式 key 的 '&' 只替换第一个（String.replace 单次替换），
 *  多 selector 写法（'& > .a, & > .b' / '&:hover, &:focus'）里第二个 selector
 *  的 '&' 残留在顶层 stylesheet 中：该 selector 永远不匹配目标元素，
 *  且残留的顶层 '&' 还会让整条规则的样式失效表现出不稳定（Chromium 失效集怪癖）。
 *  不含 '&' 的逗号列表（'.a, .b'）也只有第一个 selector 被作用域化。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, RenderContext} from "@framework";

describe('fatal bug regression (2026-07 round-5 review)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('F20a: nested selector inside an at-rule still applies', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                color: 'black',
                '@media (min-width: 1px)': {
                    color: 'red',
                    '& > a': {
                        color: 'green'
                    }
                }
            }
            return <div style={style} id="f20-target"><a id="f20-link">link</a></div>
        }
        root.render(<App/>)
        // at-rule 内的基础样式与嵌套 selector 样式都必须生效
        expect(getComputedStyle(document.getElementById('f20-target')!).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(document.getElementById('f20-link')!).color).toBe('rgb(0, 128, 0)')
    })

    test('F20b: @keyframes/animation inside an at-rule still applies', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                '@media (min-width: 1px)': {
                    animation: '@self 1s linear infinite',
                    '@keyframes': {
                        from: {opacity: 0},
                        to: {opacity: 1},
                    }
                }
            }
            return <div style={style} id="f20-anim">x</div>
        }
        root.render(<App/>)
        expect(getComputedStyle(document.getElementById('f20-anim')!).animationName).not.toBe('none')
    })

    test('F21a: every selector in a comma list gets the & substitution', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                '& > .a, & > .b': {
                    color: 'green'
                }
            }
            return <div style={style}>
                <span className="a" id="f21-a">a</span>
                <span className="b" id="f21-b">b</span>
            </div>
        }
        root.render(<App/>)
        // 生成的 stylesheet 中不允许残留顶层 '&'
        for (const sheet of document.adoptedStyleSheets) {
            for (const rule of Array.from(sheet.cssRules)) {
                expect(rule.cssText.includes('&')).toBe(false)
            }
        }
        expect(getComputedStyle(document.getElementById('f21-a')!).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(document.getElementById('f21-b')!).color).toBe('rgb(0, 128, 0)')
    })

    test('F21b: selectors without & in a comma list are all scoped', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                '.a, .b': {
                    color: 'green'
                }
            }
            return <div style={style}>
                <span className="a" id="f21b-a">a</span>
                <span className="b" id="f21b-b">b</span>
            </div>
        }
        root.render(<App/>)
        // 组件外的同名 class 不应被样式污染
        const outside = document.createElement('span')
        outside.className = 'b'
        outside.id = 'f21b-outside'
        document.body.appendChild(outside)

        expect(getComputedStyle(document.getElementById('f21b-a')!).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(document.getElementById('f21b-b')!).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(outside).color).not.toBe('rgb(0, 128, 0)')
    })

    test('F21c: commas inside :is()/attribute selectors are not split', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                '&:is(.on, .off) > [data-x="1,2"], & > .plain': {
                    color: 'green'
                }
            }
            return <div style={style} className="on">
                <span data-x="1,2" id="f21c-child">x</span>
                <span className="plain" id="f21c-plain">y</span>
            </div>
        }
        root.render(<App/>)
        expect(getComputedStyle(document.getElementById('f21c-child')!).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(document.getElementById('f21c-plain')!).color).toBe('rgb(0, 128, 0)')
    })

    test('F21d: & appearing in the middle of a selector is substituted', () => {
        function App({}: any, {createElement}: RenderContext) {
            const style = {
                '.wrapper &': {
                    color: 'green'
                }
            }
            return <div className="wrapper">
                <div style={style} id="f21d-target">x</div>
            </div>
        }
        root.render(<App/>)
        expect(getComputedStyle(document.getElementById('f21d-target')!).color).toBe('rgb(0, 128, 0)')
    })
})
