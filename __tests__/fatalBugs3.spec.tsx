/** @jsx createElement */
/**
 * 2026-07 深度 review 第二轮发现的致命问题（见 prompt/output/06-review-2026-07-round2.md）。
 * 与 fatalBugs.spec.tsx / fatalBugs2.spec.tsx 一样，修复后断言即为【正确行为】，
 * 本文件是这些 bug 的回归测试。
 *
 * 编号与 review 报告一致（F7-F10）。
 */
import {
    createElement, createRoot, atom, bindProps, RenderContext, Component
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('fatal bug regression (2026-07 review round 2)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * F7: style={cond && {...}} / style={undefined} 这类最常见的条件样式写法，
     * falsy 值曾直接命中 assert 抛 "style can only be string or object."，初次渲染即崩溃。
     */
    describe('F7: falsy style values are treated as "no style" instead of throwing', () => {
        test('style={false} (cond && obj pattern) renders without throwing', () => {
            const root = createRoot(rootEl)
            const cond = false
            expect(() => {
                root.render(<div id="t" style={cond && {color: 'red'}}>hello</div>)
            }).not.toThrow()
            expect((rootEl.querySelector('#t') as HTMLElement).style.cssText).toBe('')
            root.destroy()
        })

        test('style={undefined} renders without throwing', () => {
            const root = createRoot(rootEl)
            expect(() => {
                root.render(<div style={undefined}>hello</div>)
            }).not.toThrow()
            root.destroy()
        })

        test('style array with falsy entries applies only truthy entries', () => {
            const root = createRoot(rootEl)
            const cond = false
            root.render(<div id="t" style={[{color: 'red'}, cond && {fontSize: 12}]}>hello</div>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.color).toBe('red')
            expect(el.style.fontSize).toBe('')
            root.destroy()
        })

        test('reactive style flipping to false clears inline style instead of throwing', async () => {
            const root = createRoot(rootEl)
            const active = atom(true)
            root.render(<div id="t" style={() => active() && {color: 'red'}}>hello</div>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.color).toBe('red')
            expect(() => active(false)).not.toThrow()
            await sleep(1)
            expect(el.style.color).toBe('')
            root.destroy()
        })

        test('reactive style switching key sets does not leave stale inline styles', async () => {
            const root = createRoot(rootEl)
            const mode = atom<'a'|'b'>('a')
            root.render(<div id="t" style={() => mode() === 'a' ? {color: 'red'} : {fontSize: 12}}>x</div>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.style.color).toBe('red')

            mode('b')
            await sleep(1)
            // 旧 key（color）必须被清除，而不是与新 key 叠加残留
            expect(el.style.color).toBe('')
            expect(el.style.fontSize).toBe('12px')
            root.destroy()
        })

        test('wrong style type still throws (assert kept for real mistakes)', () => {
            const root = createRoot(rootEl)
            expect(() => {
                root.render(<div style={12}>style</div>)
            }).toThrowError('style can only be string or object.')
        })
    })

    /**
     * F8: className={cond && 'x'} 的 falsy 结果曾抛
     * "className can only be string or {[k:string]:boolean}"。
     * 静态写法初次渲染即崩溃；响应式写法在 atom 翻转为 false 的一瞬间抛错，
     * 打断整条响应式更新链。
     */
    describe('F8: falsy className values clear class instead of throwing', () => {
        test('static className={false} renders without throwing', () => {
            const root = createRoot(rootEl)
            const cond = false
            expect(() => {
                root.render(<div id="t" className={cond && 'active'}>hello</div>)
            }).not.toThrow()
            expect((rootEl.querySelector('#t') as HTMLElement).className).toBe('')
            root.destroy()
        })

        test('reactive className flipping to false clears class instead of throwing', () => {
            const root = createRoot(rootEl)
            const active = atom(true)
            root.render(<div id="t" className={() => active() && 'active'}>x</div>)
            const el = rootEl.querySelector('#t') as HTMLElement
            expect(el.className).toBe('active')
            expect(() => active(false)).not.toThrow()
            expect(el.className).toBe('')
            root.destroy()
        })

        test('className array with falsy entries keeps truthy entries', () => {
            const root = createRoot(rootEl)
            const cond = false
            root.render(<div id="t" className={['base', cond && 'active']}>x</div>)
            expect((rootEl.querySelector('#t') as HTMLElement).className).toBe('base')
            root.destroy()
        })

        test('wrong className type still throws (assert kept for real mistakes)', () => {
            const root = createRoot(rootEl)
            expect(() => {
                root.render(<div className={12}>class</div>)
            }).toThrowError('className can only be string or {[k:string]:boolean}')
        })
    })

    /**
     * F9: 没有 value prop 的 select（非受控），动态渲染 option（函数 child / RxList）时，
     * insertBefore 的 resetOptionParentSelectValue 曾把 undefined 字符串化成 "undefined"
     * 赋给 select.value，没有 option 匹配，浏览器的默认选中（第一个 option）被清掉，
     * selectedIndex 变成 -1。
     */
    describe('F9: select without value prop keeps browser default selection', () => {
        test('uncontrolled select with dynamic options keeps first option selected', () => {
            const root = createRoot(rootEl)
            const options = atom(['a', 'b'])
            function App({}, {createElement}: RenderContext) {
                return <select>
                    {() => options().map(o => <option value={o}>{o}</option>)}
                </select>
            }
            root.render(<App/>)
            const select = rootEl.querySelector('select')!
            expect(select.selectedIndex).toBe(0)
            expect(select.value).toBe('a')
            root.destroy()
        })

        test('controlled select with dynamic options still applies value (regression guard)', () => {
            const root = createRoot(rootEl)
            const value = atom('b')
            function App({}, {createElement}: RenderContext) {
                const options = atom(['a', 'b'])
                return <select value={value}>
                    {() => options().map(o => <option value={o}>{o}</option>)}
                </select>
            }
            root.render(<App/>)
            const select = rootEl.querySelector('select')!
            expect(select.value).toBe('b')
            expect(select.selectedIndex).toBe(1)
            root.destroy()
        })

        test('controlled select with null value renders no selection, not literal "null" match', () => {
            const root = createRoot(rootEl)
            const value = atom<string|null>(null)
            function App({}, {createElement}: RenderContext) {
                const options = atom(['null', 'a'])
                return <select value={value}>
                    {() => options().map(o => <option value={o}>{o}</option>)}
                </select>
            }
            root.render(<App/>)
            const select = rootEl.querySelector('select')!
            // 不能因为 dataset 把 null 字符串化而意外选中 value="null" 的 option
            expect(select.value).toBe('')
            root.destroy()
        })
    })

    /**
     * F10: Function.prototype.bind 产生的函数不继承原函数的静态属性，
     * bindProps 曾从 bind 结果上读 boundProps（永远是 undefined）：
     * 嵌套 bindProps 会静默丢掉前一层绑定的 props，postBoundProps 也整个丢失。
     */
    describe('F10: bindProps preserves existing boundProps/postBoundProps', () => {
        test('nested bindProps accumulates props from every layer', () => {
            const root = createRoot(rootEl)
            function Base(props: any, {createElement}: RenderContext) {
                return <div id="base">{props.a}-{props.b}</div>
            }
            const WithA = bindProps(Base as Component, {a: '1'})
            const WithAB = bindProps(WithA, {b: '2'})
            root.render(<WithAB/>)
            expect(rootEl.querySelector('#base')!.textContent).toBe('1-2')
            root.destroy()
        })

        test('bindProps keeps postBoundProps of the original component', () => {
            const root = createRoot(rootEl)
            function Base(props: any, {createElement}: RenderContext) {
                return <div id="base">{props.a}-{props.b}</div>
            }
            ;(Base as Component).postBoundProps = [{b: 'post'}]
            const Bound = bindProps(Base as Component, {a: 'bound'})
            root.render(<Bound/>)
            expect(rootEl.querySelector('#base')!.textContent).toBe('bound-post')
            root.destroy()
        })

        test('inputProps still override boundProps (priority unchanged)', () => {
            const root = createRoot(rootEl)
            function Base(props: any, {createElement}: RenderContext) {
                return <div id="base">{props.a}</div>
            }
            const Bound = bindProps(Base as Component, {a: 'bound'})
            root.render(<Bound a="input"/>)
            expect(rootEl.querySelector('#base')!.textContent).toBe('input')
            root.destroy()
        })
    })
})
