/** @jsx createElement */
/**
 * 2026-07 深度 review 第八轮的致命问题回归测试（F29-F32）。
 * 每个测试都先在未修复代码上确认失败（复现），修复后转为回归测试。
 * 详见 prompt/output/13-review-2026-07-round8.md。
 */
import {createElement, createRoot, RenderContext} from "@framework";
import {atom, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('fatal bug regression (2026-07 round-8 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F29: 元素的 hostPath 上没有任何 ComponentHost（root.render 直接渲染元素/函数节点/列表）时，
     * generateComponentElementStaticId 把 path[0]（普通 host）当 ComponentHost 读 .type.name，
     * 任何响应式/嵌套 style 直接 TypeError——初始渲染崩溃，函数节点重算时变成 unhandled rejection。
     */
    describe('F29: style id generation must not assume a component ancestor exists', () => {
        test('F29a: reactive style on element inside a function node directly under root', async () => {
            const color = atom('red')
            const root = createRoot(rootEl)
            root.render(<div>{() => <span id="f29a" style={{color: color}}>x</span>}</div>)
            await sleep(10)
            const el = document.getElementById('f29a')!
            expect(el.style.color).toBe('red')
            color('blue')
            await sleep(10)
            expect(el.style.color).toBe('blue')
            root.destroy()
        })

        test('F29b: nested style on RxList rows directly under root', () => {
            const list = new RxList<number>([1, 2])
            const root = createRoot(rootEl)
            root.render(<div>{list.map(item => <span class="f29b" style={{color: 'rgb(255, 0, 0)', '&:hover': {color: 'blue'}}}>{item}</span>)}</div>)
            const rows = rootEl.querySelectorAll('.f29b')
            expect(rows.length).toBe(2)
            expect(getComputedStyle(rows[0]).color).toBe('rgb(255, 0, 0)')
            root.destroy()
        })

        test('F29c: per-row dynamic style directly under root updates and cleans up', async () => {
            const colors = [atom('rgb(255, 0, 0)'), atom('rgb(0, 0, 255)')]
            const list = new RxList<any>(colors)
            const root = createRoot(rootEl)
            root.render(<div>{list.map((c: any) => <span class="f29c" style={() => ({color: c(), '&:hover': {opacity: 0.5}})}>r</span>)}</div>)
            await sleep(10)
            const rows = rootEl.querySelectorAll('.f29c')
            expect(rows.length).toBe(2)
            expect(getComputedStyle(rows[0]).color).toBe('rgb(255, 0, 0)')
            expect(getComputedStyle(rows[1]).color).toBe('rgb(0, 0, 255)')
            colors[0]('rgb(0, 128, 0)')
            await sleep(10)
            expect(getComputedStyle(rows[0]).color).toBe('rgb(0, 128, 0)')
            root.destroy()
        })
    })

    /**
     * F30: 静态嵌套样式的 stylesheet id 按「元素 path」跨实例共享，但静态样式对象可以携带
     * 每实例不同的数据（style={{'& b': {color: item.color}}}）：列表行、同类型兄弟组件的
     * 不同内容全部静默塌缩成第一个实例的样式。现在第一个实例登记内容签名，
     * 签名不一致的实例退化为元素独享的 stylesheet。
     */
    describe('F30: same-path static nested styles with different content must not collapse', () => {
        test('F30a: list rows with per-item static nested style', () => {
            const list = new RxList([
                {id: 'f30-a', color: 'rgb(255, 0, 0)'},
                {id: 'f30-b', color: 'rgb(0, 0, 255)'},
            ])
            function App({}: any, {createElement}: RenderContext) {
                return <div>{list.map(item => <span id={item.id} style={{'& b': {color: item.color}}}><b>t</b></span>)}</div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            expect(getComputedStyle(document.querySelector('#f30-a b')!).color).toBe('rgb(255, 0, 0)')
            expect(getComputedStyle(document.querySelector('#f30-b b')!).color).toBe('rgb(0, 0, 255)')
            root.destroy()
        })

        test('F30b: sibling components of the same type with prop-parameterized static nested style', () => {
            function Item({color}: any, {createElement}: RenderContext) {
                return <span class="f30b" style={{'& b': {color}}}><b>t</b></span>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <Item color="rgb(255, 0, 0)"/>
                    <Item color="rgb(0, 0, 255)"/>
                </div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            const els = document.querySelectorAll('.f30b b')
            expect(getComputedStyle(els[0]).color).toBe('rgb(255, 0, 0)')
            expect(getComputedStyle(els[1]).color).toBe('rgb(0, 0, 255)')
            root.destroy()
        })

        test('F30c: identical static nested styles still share one stylesheet', () => {
            const list = new RxList([1, 2, 3])
            const sheetsBefore = document.adoptedStyleSheets.length
            function App({}: any, {createElement}: RenderContext) {
                return <div>{list.map(item => <span class="f30c" style={{'& b': {color: 'rgb(255, 0, 0)'}}}><b>{item}</b></span>)}</div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            const els = document.querySelectorAll('.f30c b')
            expect(els.length).toBe(3)
            for (const el of els) {
                expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
            }
            // 内容相同的静态嵌套样式仍然共享一张 stylesheet（性能设计不回退）
            expect(document.adoptedStyleSheets.length).toBe(sheetsBefore + 1)
            root.destroy()
            expect(document.adoptedStyleSheets.length).toBe(sheetsBefore)
        })
    })

    /**
     * F31: stylesheet 路径（嵌套样式/boundProps）的 style 对象里，atom 出现在 simple 部分
     * （{color: colorAtom, '&:hover': {...}}）时，动态性扫描只扫 nestedStyles：
     * 整个对象被当静态 stylesheet 处理，atom 第一次生效后样式永远不再更新。
     */
    test('F31: atom in the simple part of a nested-style object stays reactive', async () => {
        const color = atom('rgb(255, 0, 0)')
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f31" style={{color: color, '&:hover': {opacity: 0.5}}}>x</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        const el = document.getElementById('f31')!
        expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
        color('rgb(0, 0, 255)')
        await sleep(10)
        expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        root.destroy()
    })

    /**
     * F32: Array#splice 对 start 做 ToIntegerOrInfinity（1.5 → 1），data0 透传原始 argv。
     * F22 只归一化了负数，小数 start 让「往后找插入锚点」的扫描读 hosts[2.5] 得到 undefined
     * 直接 TypeError，且 DOM 与数据永久错位。
     */
    test('F32: fractional splice start (legal Array#splice input) keeps DOM aligned', () => {
        const list = new RxList(['a', 'b', 'c'])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="f32">{list.map(item => <span>{item}</span>)}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        list.splice(1.5 as any, 1, 'X')
        expect(document.getElementById('f32')!.textContent).toBe('aXc')
        // NaN start 归 0（与 Array#splice 一致）
        list.splice(NaN as any, 1, 'Y')
        expect(document.getElementById('f32')!.textContent).toBe('YXc')
        expect(list.data).toEqual(['Y', 'X', 'c'])
        root.destroy()
    })
})
