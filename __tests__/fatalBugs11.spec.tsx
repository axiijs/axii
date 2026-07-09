/** @jsx createElement */
/**
 * 2026-07 深度 review 第十轮的致命问题回归测试（F35-F38）。
 * 每个测试都先在未修复代码上确认失败（复现），修复后转为回归测试。
 * 详见 prompt/output/15-review-2026-07-round10.md。
 */
import {createElement, createRoot, RenderContext} from "@framework";
import {atom, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('fatal bug regression (2026-07 round-10 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F35: multiple select 的 value 天然是数组（HTML 多选的用户本意），但 setAttribute 的
     * 「数组取最后一个」覆盖语义把它塌成单值；存值恢复路径又把数组经 dataset 字符串化成
     * "a,c"，没有任何 option 匹配，动态渲染 option 后选中被整体清空。
     */
    describe('F35: multiple select array value', () => {
        test('F35a: static options select all matching values', () => {
            const root = createRoot(rootEl)
            root.render(
                <select multiple value={['a', 'c']}>
                    <option value="a">a</option>
                    <option value="b">b</option>
                    <option value="c">c</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            root.destroy()
        })

        test('F35b: RxList options keep multi-selection after dynamic render', async () => {
            const options = new RxList<string>(['a', 'b', 'c'])
            const root = createRoot(rootEl)
            root.render(
                <select multiple value={['a', 'c']}>
                    {options.map((o: string) => <option value={o}>{o}</option>)}
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            // 后插入的匹配 option 也要被选中
            options.push('d')
            options.push('e')
            await sleep(10)
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a', 'c'])
            root.destroy()
        })

        test('F35c: reactive array value updates multi-selection', async () => {
            const selected = atom<string[]>(['a'])
            const root = createRoot(rootEl)
            root.render(
                <select multiple value={selected}>
                    <option value="a">a</option>
                    <option value="b">b</option>
                    <option value="c">c</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['a'])
            selected(['b', 'c'])
            await sleep(10)
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['b', 'c'])
            root.destroy()
        })

        test('F35d: number values in the array match string option values', () => {
            const root = createRoot(rootEl)
            root.render(
                <select multiple value={[1, 3]}>
                    <option value={1}>one</option>
                    <option value={2}>two</option>
                    <option value={3}>three</option>
                </select>
            )
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['1', '3'])
            root.destroy()
        })

        test('F35e: single-value select is unaffected', async () => {
            const options = new RxList<string>(['a', 'b'])
            const root = createRoot(rootEl)
            root.render(
                <select value="b">
                    {options.map((o: string) => <option value={o}>{o}</option>)}
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            expect(select.value).toBe('b')
            root.destroy()
        })
    })

    /**
     * F36: 条件 style 值（{fontWeight: cond && 'bold'}）翻转为 false 时，
     * 'false' 是非法 CSS 值，浏览器静默拒绝这次赋值——旧值不会被清除，样式永久残留。
     * boxShadow 等逗号列表里混入 'false' 会让整条声明非法，同样导致旧值残留。
     */
    describe('F36: boolean style values must clear instead of leaving stale styles', () => {
        test('F36a: reactive style function with conditional value flipping to false', async () => {
            const bold = atom(true)
            const root = createRoot(rootEl)
            root.render(<div style={() => ({fontWeight: bold() && 'bold'})}>t</div>)
            const el = rootEl.querySelector('div')! as HTMLElement
            expect(el.style.fontWeight).toBe('bold')
            bold(false)
            await sleep(10)
            expect(el.style.fontWeight).toBe('')
            bold(true)
            await sleep(10)
            expect(el.style.fontWeight).toBe('bold')
            root.destroy()
        })

        test('F36b: atom style value flipping to false inside a static style object', async () => {
            const underline = atom<any>('underline')
            const root = createRoot(rootEl)
            root.render(<div style={{textDecoration: underline}}>t</div>)
            const el = rootEl.querySelector('div')! as HTMLElement
            expect(el.style.textDecoration).toBe('underline')
            underline(false)
            await sleep(10)
            expect(el.style.textDecoration).toBe('')
            root.destroy()
        })

        test('F36c: falsy conditional item in a comma multi-value list (boxShadow)', async () => {
            const glow = atom(true)
            const root = createRoot(rootEl)
            root.render(<div style={() => ({boxShadow: ['0 0 1px red', glow() && '0 0 2px blue']})}>t</div>)
            const el = rootEl.querySelector('div')! as HTMLElement
            expect(el.style.boxShadow).toContain('blue')
            glow(false)
            await sleep(10)
            expect(el.style.boxShadow).toContain('red')
            expect(el.style.boxShadow).not.toContain('blue')
            expect(el.style.boxShadow).not.toContain('false')
            root.destroy()
        })

        test('F36d: CSS custom property flipping to false is removed', async () => {
            const on = atom(true)
            const root = createRoot(rootEl)
            root.render(<div style={() => ({'--main-color': on() && 'red'})}>t</div>)
            const el = rootEl.querySelector('div')! as HTMLElement
            expect(el.style.getPropertyValue('--main-color')).toBe('red')
            on(false)
            await sleep(10)
            expect(el.style.getPropertyValue('--main-color')).toBe('')
            root.destroy()
        })
    })

    /**
     * F37: 没有 value attr 的 option 以文本为 value。atom/函数 text child 的更新是
     * 原地改 nodeValue（不走 insertBefore），不触发 select 的 value 恢复——
     * 存值匹配的 option 此刻才出现时选中静默丢失。
     */
    describe('F37: select value must survive reactive option text updates', () => {
        test('F37a: atom text child', async () => {
            const text = atom('')
            const root = createRoot(rootEl)
            root.render(
                <select value="loaded">
                    <option value="">empty</option>
                    <option>{text}</option>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            text('loaded')
            await sleep(10)
            expect(select.value).toBe('loaded')
            root.destroy()
        })

        test('F37b: function text child', async () => {
            const text = atom('')
            const root = createRoot(rootEl)
            root.render(
                <select value="ready">
                    <option value="">empty</option>
                    <option>{() => text()}</option>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            text('ready')
            await sleep(10)
            expect(select.value).toBe('ready')
            root.destroy()
        })

        test('F37c: atom text child inside optgroup', async () => {
            const text = atom('')
            const root = createRoot(rootEl)
            root.render(
                <select value="g1">
                    <optgroup label="g">
                        <option value="">empty</option>
                        <option>{text}</option>
                    </optgroup>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')! as HTMLSelectElement
            text('g1')
            await sleep(10)
            expect(select.value).toBe('g1')
            root.destroy()
        })
    })

    /**
     * F38: $name:_children 的值会被展开传入 createElement（...finalChildren），
     * 传单个节点（非数组）时展开非 iterable 直接 TypeError，整个组件渲染崩溃。
     */
    describe('F38: $name:_children with a single (non-array) node', () => {
        test('single node child override', () => {
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="wrap"><span>orig</span></div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <Inner $wrap:_children={<b>replaced</b>} />
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            expect(rootEl.querySelector('b')?.textContent).toBe('replaced')
            expect(rootEl.querySelector('span')).toBe(null)
            root.destroy()
        })

        test('array children override still works', () => {
            function Inner({}: any, {createElement}: RenderContext) {
                return <div as="wrap"><span>orig</span></div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <Inner $wrap:_children={[<b>one</b>, <i>two</i>]} />
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            expect(rootEl.querySelector('b')?.textContent).toBe('one')
            expect(rootEl.querySelector('i')?.textContent).toBe('two')
            root.destroy()
        })
    })
})
