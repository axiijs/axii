/* @jsx createElement */
/**
 * 2026-07 深度 review 第十六轮：致命问题回归测试（F54-F55）。
 * 每个测试都先在未修复代码上确认失败，再随修复转为回归测试。
 */
import {beforeEach, describe, expect, it} from "vitest";
import {atom, createElement, createRoot, RenderContext} from "@framework";

function nextMicrotasks() {
    return Promise.resolve().then(() => Promise.resolve())
}

describe('fatal bug regression (2026-07 round-16 review)', () => {
    let container: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    // F54: 匿名组件（name === ''）的 stylesheet class id 以 typeId 数字开头，
    //  `.3PF0` 是非法 CSS selector，整张 stylesheet 被 insertRule 拒绝——
    //  嵌套样式/boundProps 样式全部静默丢失。
    it('F54a: anonymous component nested style still applies (class id must not start with a digit)', () => {
        // 数组字面量中的箭头函数不会推断出名字，name 是真正的 ''
        const components = [
            function ({}, {createElement}: RenderContext) {
                return <div id="f54a" style={{'& span': {color: 'rgb(255, 0, 0)'}}}><span>in</span></div>
            }
        ]
        const Anonymous = components[0]
        Object.defineProperty(Anonymous, 'name', {value: ''})
        expect(Anonymous.name).toBe('')

        const root = createRoot(container)
        root.render(createElement(Anonymous, {}))
        const el = container.querySelector('#f54a') as HTMLElement
        const span = el.querySelector('span')!
        expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
        // class 必须是合法可匹配的（不以数字开头）
        for (const cls of Array.from(el.classList)) {
            expect(/^[0-9]/.test(cls)).toBe(false)
        }
        root.destroy()
    })

    // F54b: 对象字面量 key 推断出的组件名可以带 '.'（{'ns.card': fn} 的注册表写法），
    //  `.ns.card0P...` 会被解析成「同时具有 ns 和 card0P... 两个 class」的复合选择器，
    //  永远匹配不上元素——样式静默丢失且没有任何报错（insertRule 成功）。
    it('F54b: dot in component name (object-literal registry) does not break the stylesheet selector', () => {
        const registry: Record<string, any> = {
            'ns.card': function ({}, {createElement}: RenderContext) {
                return <div id="f54b" style={{'& span': {color: 'rgb(255, 0, 0)'}}}><span>in</span></div>
            }
        }
        const Comp = registry['ns.card']
        expect(Comp.name).toBe('ns.card')

        const root = createRoot(container)
        root.render(createElement(Comp, {}))
        const span = container.querySelector('#f54b span')!
        expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
        root.destroy()
    })

    // 对照：unicode 名字是合法的 CSS identifier，必须保持可用（修复不能一刀切转 ASCII 丢掉唯一性来源）
    it('F54c: unicode component name keeps working (control)', () => {
        const 卡片十六 = function ({}, {createElement}: RenderContext) {
            return <div id="f54c" style={{'& span': {color: 'rgb(255, 0, 0)'}}}><span>in</span></div>
        }
        const root = createRoot(container)
        root.render(createElement(卡片十六, {}))
        const span = container.querySelector('#f54c span')!
        expect(getComputedStyle(span).color).toBe('rgb(255, 0, 0)')
        root.destroy()
    })

    // F55: 条件离场动画（detachStyle={() => cond() ? {...} : null}，
    //  prefers-reduced-motion 开关是自然写法）的 falsy 求值结果会让
    //  removeElements 里 Object.keys(null) 直接 TypeError——destroy 被中断，
    //  节点**永久残留在文档里**（诊断开关都一样）。静态 falsy 在注册时就被 guard，
    //  函数/atom 的 falsy 求值结果是唯一走到这里的形态。
    it('F55a: function detachStyle returning null removes the node without errors', async () => {
        const cond = atom(true)
        const wantExit = atom(false)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<div id="wrap">{() => cond() ?
            <div id="f55a" detachStyle={() => wantExit() ? {opacity: 0} : null}>content</div> :
            null}</div>)
        expect(container.querySelector('#f55a')).not.toBe(null)
        cond(false)
        await nextMicrotasks()
        await new Promise(r => setTimeout(r, 200))
        expect(errors.length).toBe(0)
        expect(container.querySelector('#f55a')).toBe(null)
        root.destroy()
    })

    it('F55b: atom detachStyle holding null removes the node without errors', async () => {
        const cond = atom(true)
        const exitStyle = atom<any>(null)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<div id="wrap">{() => cond() ?
            <div id="f55b" detachStyle={exitStyle}>content</div> :
            null}</div>)
        cond(false)
        await nextMicrotasks()
        await new Promise(r => setTimeout(r, 200))
        expect(errors.length).toBe(0)
        expect(container.querySelector('#f55b')).toBe(null)
        root.destroy()
    })

    // 对照：detachStyle 数组含 falsy 条件项本来就可用（Object.assign({}, false) 是 no-op）
    it('F55c: detachStyle array with a falsy conditional item keeps working (control)', async () => {
        const cond = atom(true)
        const extra = false
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<div id="wrap">{() => cond() ?
            <div id="f55c" detachStyle={[{opacity: 0}, extra && ({height: 0} as any)]}>content</div> :
            null}</div>)
        cond(false)
        await nextMicrotasks()
        await new Promise(r => setTimeout(r, 150))
        expect(errors.length).toBe(0)
        expect(container.querySelector('#f55c')).toBe(null)
        root.destroy()
    })
})
