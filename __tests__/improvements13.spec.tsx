/** @jsx createElement */
/**
 * 2026-07 深度 review 第十三轮改进项回归测试（I43-I49）。
 *
 * 每个用例都先在未修复代码上确认失败（对照项除外）；覆盖 root 事件监听器的错误隔离、
 * style 值形态（[number, keyword] 简写、animation 数组、空字符串清除）、
 * 事件包装器返回值、已消费元素重复渲染的开发期警告、Form 的 values 默认值。
 */
import {
    createElement,
    createRoot,
    RenderContext,
    withCurrentRange,
    withPreventDefault,
    withStopPropagation,
    Form,
    FormContext,
    FormContextValue,
} from "@framework";
import {atom, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('improvements regression (2026-07 round-13 review)', () => {
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    describe('I43: user callbacks must not break framework error/attach paths', () => {
        test('a throwing error handler does not prevent later handlers or re-crash the app', () => {
            const root = createRoot(rootEl)
            const seen: string[] = []
            root.on('error', () => {
                seen.push('first')
                throw new Error('handler exploded')
            })
            root.on('error', () => {
                seen.push('second')
            })

            function Broken(): any {
                throw new Error('render failed')
            }

            // handler 自己的错误收敛到 reportAxiiError，不覆盖原始错误、不打断 fail-stop
            expect(() => root.render(<Broken/>)).not.toThrow()
            expect(seen).toEqual(['first', 'second'])
            root.destroy()
        })

        test('a throwing element ref attach does not starve sibling layoutEffects in the same flush', async () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e) => errors.push(e))
            const ran: string[] = []

            function Bad({}: any, {createElement}: RenderContext) {
                // 元素 ref attach 是 flushAttachQueue 条目的直接内容（没有组件级错误钩子包装）
                const throwingRef = (el: HTMLElement | null) => {
                    if (el) {
                        ran.push('bad-ref')
                        throw new Error('ref attach exploded')
                    }
                }
                return <div ref={throwingRef}>bad</div>
            }

            function Good({}: any, {createElement, useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => {
                    ran.push('good')
                })
                return <div>good</div>
            }

            // 两个组件动态插入同一批 attach flush：曾经 Bad 的 ref 抛错会把
            // 快照后的整批条目（含 Good 的 layoutEffect）一起中断丢失
            const show = atom(false)
            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => show() ? <div><Bad/><Good/></div> : null}</div>
            }
            root.render(<App/>)
            show(true)
            await sleep(0)
            expect(ran).toEqual(['bad-ref', 'good'])
            expect(errors.length).toBe(1)
            root.destroy()
        })

        test('a throwing element ref detach does not leak the subtree DOM', () => {
            const root = createRoot(rootEl)
            const errors: any[] = []
            root.on('error', (e) => errors.push(e))
            const cond = atom(true)

            function App({}: any, {createElement}: RenderContext) {
                const throwingRef = (el: HTMLElement | null) => {
                    if (el === null) throw new Error('detach exploded')
                }
                return <div>{() => cond() ? <div ref={throwingRef} id="inner">present</div> : null}</div>
            }

            root.render(<App/>)
            expect(rootEl.querySelector('#inner')).toBeTruthy()
            cond(false)
            return sleep(0).then(() => {
                // ref detach 抛错交给 error 钩子，DOM 拆除照常完成
                expect(rootEl.querySelector('#inner')).toBeNull()
                expect(errors.length).toBe(1)
                root.destroy()
            })
        })
    })

    describe('I44: [number, keyword] style shorthand must not be parsed as [value, unit]', () => {
        test('margin: [0, "auto"] centers instead of producing invalid "0auto"', () => {
            const root = createRoot(rootEl)
            root.render(<div style={{margin: [0, 'auto'], width: [100, 'px']}}>x</div>)
            const el = rootEl.querySelector('div')!
            expect(el.style.margin).toBe('0px auto')
            // 真正的 [number, unit] 简写仍然生效
            expect(el.style.width).toBe('100px')
            root.destroy()
        })
    })

    describe('I45: animation arrays join with commas and @self replaces globally', () => {
        test('animation: [a, b] both referencing @self produce a valid declaration', () => {
            const root = createRoot(rootEl)
            root.render(<div style={{
                '@keyframes': {from: {opacity: 0.99}, to: {opacity: 1}},
                animation: ['@self 10s linear', '@self 20s ease'],
            }}>x</div>)
            const el = rootEl.querySelector('div')!
            const names = getComputedStyle(el).animationName.split(',').map(s => s.trim())
            // 空格连接会让整条声明非法（animationName 为 none）；@self 必须全部替换
            expect(names.length).toBe(2)
            expect(names[0]).not.toBe('none')
            expect(names[0]).toBe(names[1])
            root.destroy()
        })
    })

    describe('I46: empty string style value clears the key', () => {
        test('width flipping from number to "" restores default instead of 0px', () => {
            const root = createRoot(rootEl)
            const w = atom<number | string>(100)
            root.render(<div style={() => ({width: w()})}>x</div>)
            const el = rootEl.querySelector('div')!
            expect(el.style.width).toBe('100px')
            w('')
            expect(el.style.width).toBe('')
            root.destroy()
        })
    })

    describe('I47: event wrapper helpers preserve handler return values', () => {
        test('withPreventDefault / withStopPropagation / withCurrentRange pass through results', () => {
            const clickEvent = new Event('click', {cancelable: true})
            expect(withPreventDefault(() => 'result')(clickEvent)).toBe('result')
            expect(withStopPropagation(() => 42)(new Event('click'))).toBe(42)
            expect(withCurrentRange(() => 'ranged')(new Event('mouseup'))).toBe('ranged')
        })
    })

    describe('I48: rendering an already-consumed element warns in dev', () => {
        test('re-rendering a cached element with reactive bindings prints a console.error', async () => {
            const root = createRoot(rootEl)
            const text = atom('one')
            const cond = atom(true)
            const warnings: string[] = []
            const originalError = console.error
            console.error = (...args: any[]) => { warnings.push(args.join(' ')) }
            try {
                function App({}: any, {createElement}: RenderContext) {
                    // 反模式：缓存元素跨条件分支复用（绑定元数据只会被消费一次）
                    const cached = <div id="cached">{() => text()}</div>
                    return <div>{() => cond() ? cached : <span>other</span>}</div>
                }
                root.render(<App/>)
                cond(false)
                await sleep(0)
                cond(true)
                await sleep(0)
                expect(warnings.some(w => w.includes('already been rendered'))).toBe(true)
            } finally {
                console.error = originalError
                root.destroy()
            }
        })

        test('normal single render of reactive elements does not warn (control)', () => {
            const root = createRoot(rootEl)
            const warnings: string[] = []
            const originalError = console.error
            console.error = (...args: any[]) => { warnings.push(args.join(' ')) }
            try {
                const text = atom('x')
                function App({}: any, {createElement}: RenderContext) {
                    return <div title={() => text()}>{() => text()}</div>
                }
                root.render(<App/>)
                expect(warnings.length).toBe(0)
            } finally {
                console.error = originalError
                root.destroy()
            }
        })
    })

    describe('I49: Form works without an external values map', () => {
        test('omitting values does not crash item registration', () => {
            const root = createRoot(rootEl)

            function Item({}: any, {createElement, context, onCleanup}: RenderContext) {
                const formContext = context.get(FormContext) as FormContextValue
                const value = atom('preset')
                const instance = {value, reset: () => value('preset'), clear: () => value('')}
                formContext.register('field', instance)
                onCleanup(() => formContext.unregister('field', instance))
                return <input value={value}/>
            }

            expect(() => {
                root.render(
                    <Form name="test-form">
                        <Item/>
                    </Form>
                )
            }).not.toThrow()
            expect(rootEl.querySelector('input')).toBeTruthy()
            root.destroy()
        })

        test('an explicit values map is still used (control)', () => {
            const root = createRoot(rootEl)
            const values = new RxMap<string, any>({})

            function Item({}: any, {createElement, context}: RenderContext) {
                const formContext = context.get(FormContext) as FormContextValue
                const value = atom('preset')
                formContext.register('field', {value, reset: () => {}, clear: () => {}})
                return <input value={value}/>
            }

            root.render(
                <Form name="test-form" values={values}>
                    <Item/>
                </Form>
            )
            expect(values.get('field')).toBeTruthy()
            root.destroy()
        })
    })
})
