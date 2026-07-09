/** @jsx createElement */
/**
 * 2026-07 深度 review 第九轮的致命问题回归测试（F33-F34）。
 * 每个测试都先在未修复代码上确认失败（复现），修复后转为回归测试。
 * 详见 prompt/output/14-review-2026-07-round9.md。
 */
import {createElement, createRoot} from "@framework";
import {atom, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('fatal bug regression (2026-07 round-9 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F33: select 的 value 恢复逻辑（dataset 存值 + option 渲染后 reset）只识别
     * 「option/占位符的直接父级是 select」的形态。options 包在 optgroup 里
     * （合法且常见的 HTML）时，动态渲染的 option 不触发恢复，选中值静默丢失
     * （浏览器默认选中第一个 option）。
     */
    describe('F33: select value must survive options rendered inside optgroup', () => {
        test('F33a: RxList options inside optgroup', async () => {
            const options = new RxList<string>(['a', 'b', 'c'])
            const root = createRoot(rootEl)
            root.render(
                <select value="b">
                    <optgroup label="group">
                        {options.map((o: string) => <option value={o}>{o}</option>)}
                    </optgroup>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')!
            expect(select.value).toBe('b')
            root.destroy()
        })

        test('F33b: reactive option value inside optgroup re-applies select value', async () => {
            const optValue = atom('x')
            const selected = atom('b')
            const root = createRoot(rootEl)
            root.render(
                <select value={selected}>
                    <optgroup label="group">
                        <option value={optValue}>dynamic</option>
                        <option value="a">a</option>
                    </optgroup>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')!
            // 此刻没有匹配 'b' 的 option，浏览器回落到默认选中
            optValue('b')
            await sleep(10)
            expect(select.value).toBe('b')
            root.destroy()
        })

        test('F33c: function child options inside optgroup keep select value', async () => {
            const show = atom(true)
            const root = createRoot(rootEl)
            root.render(
                <select value="two">
                    <optgroup label="g">
                        {() => show() ? [<option value="one">one</option>, <option value="two">two</option>] : null}
                    </optgroup>
                </select>
            )
            await sleep(10)
            const select = rootEl.querySelector('select')!
            expect(select.value).toBe('two')
            root.destroy()
        })

        test('F33d: options directly under select keep working (no regression)', async () => {
            const options = new RxList<string>(['a', 'b'])
            const root = createRoot(rootEl)
            root.render(
                <select value="b">
                    {options.map((o: string) => <option value={o}>{o}</option>)}
                </select>
            )
            await sleep(10)
            expect(rootEl.querySelector('select')!.value).toBe('b')
            root.destroy()
        })
    })

    /**
     * F34: `form` 是合法的 HTML attribute（把控件关联到非祖先的 form），
     * 但 HTMLInputElement.form 等是只读 accessor：`name in node` 分支对它做 property
     * 赋值在严格模式下抛 TypeError（被 setProperty 吞掉打日志），attribute 永远设不上去，
     * 控件与 form 的关联静默失效（提交/校验都收集不到该控件）。
     */
    describe('F34: form attribute must land on the DOM', () => {
        test('F34a: static form attribute associates input with a non-ancestor form', () => {
            const root = createRoot(rootEl)
            root.render(
                <div>
                    <form id="f34-form" name="f34form"></form>
                    <input id="f34-input" form="f34-form" name="field" value="v"/>
                </div>
            )
            const input = rootEl.querySelector('input')!
            const form = rootEl.querySelector('form')!
            expect(input.getAttribute('form')).toBe('f34-form')
            expect(input.form).toBe(form)
            root.destroy()
        })

        test('F34b: reactive form attribute updates and removes', async () => {
            const formId = atom<string|null>('f34b-1')
            const root = createRoot(rootEl)
            root.render(
                <div>
                    <form id="f34b-1"></form>
                    <form id="f34b-2"></form>
                    <button form={formId}>submit</button>
                </div>
            )
            const button = rootEl.querySelector('button')!
            expect(button.getAttribute('form')).toBe('f34b-1')
            expect(button.form?.id).toBe('f34b-1')
            formId('f34b-2')
            await sleep(10)
            expect(button.form?.id).toBe('f34b-2')
            formId(null)
            await sleep(10)
            expect(button.getAttribute('form')).toBe(null)
            root.destroy()
        })

        test('F34c: readonly property on a custom element falls back to attribute (sibling of form)', () => {
            // 与 form 同类的形态：与只读 property 同名的 attribute。
            //  显式排除表覆盖不了自定义元素，必须由 setProperty 的回退兜底。
            class F34ReadonlyEl extends HTMLElement {
                get part2() { return 'readonly' }
            }
            if (!customElements.get('f34-readonly-el')) {
                customElements.define('f34-readonly-el', F34ReadonlyEl)
            }
            const root = createRoot(rootEl)
            root.render(<f34-readonly-el part2="from-attr">x</f34-readonly-el>)
            const el = rootEl.querySelector('f34-readonly-el')!
            expect(el.getAttribute('part2')).toBe('from-attr')
            root.destroy()
        })
    })
})
