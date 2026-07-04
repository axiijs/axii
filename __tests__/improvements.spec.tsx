/** @jsx createElement */
/**
 * 本文件是 prompt/output/03-improvements.md 中各改进项的回归测试。
 * 测试编号与文档条目编号一致。
 *
 * - 条目 11（死代码删除）由 tsc 编译与全量测试保障，无独立断言；
 * - 条目 14（coverage 配置）由 vitest.config.ts 修改 + form.spec.tsx 等新增用例体现；
 * - 条目 15 的 package.json 元数据部分在 __tests__/node/packageJson.spec.ts 中验证。
 */
import {
    bindProps,
    createElement,
    createRoot,
    dispatchEvent,
    ExtendedElement,
    insertBefore,
    lazy,
    mergeProp,
    Portal,
    PropTypes,
    RenderContext,
} from "@framework";
import {atom, ReactiveEffect, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

function nextMicrotask() {
    return new Promise<void>(resolve => queueMicrotask(resolve))
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))

describe('improvements regression', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * 条目 1：mergeProp 曾用 startsWith('on') 判断事件（误伤 once/onlyIcon 等普通 prop），
     * 且 className 写成了小写 'classname' 永远匹配不上（合并变成覆盖）。
     */
    describe('1. mergeProp event detection and className merge', () => {
        test('normal props starting with "on" are overridden, not merged', () => {
            expect(mergeProp('once', 'a', 'b')).toBe('b')
            expect(mergeProp('onlyIcon', true, false)).toBe(false)
        })
        test('real events are merged with new handler first', () => {
            const f1 = () => 1
            const f2 = () => 2
            expect(mergeProp('onClick', f1, f2)).toEqual([f2, f1])
        })
        test('className is merged, not overridden', () => {
            expect(mergeProp('className', 'c1', 'c2')).toEqual(['c2', 'c1'])
        })
        test('bound props className is merged with input className on a real component', () => {
            function Base({className}: any, {createElement}: RenderContext) {
                return <div className={className}>x</div>
            }
            const Styled = bindProps(Base as any, {className: 'base'})

            const root = createRoot(rootEl)
            root.render(<Styled className="extra"/>)

            const el = rootEl.querySelector('div')!
            expect(el.classList.contains('base')).toBe(true)
            expect(el.classList.contains('extra')).toBe(true)
            root.destroy()
        })
    })

    /**
     * 条目 2：style={null} 曾在 StyleManager.update 里执行 null['__dynamic'] 抛 TypeError。
     * 条件样式 style={cond ? {...} : null} 是很自然的写法，不应崩溃。
     */
    describe('2. style={null} must not crash', () => {
        test('static null style renders without error', () => {
            const root = createRoot(rootEl)
            expect(() => {
                root.render(<div style={null as any}>text</div>)
            }).not.toThrow()
            expect(rootEl.textContent).toBe('text')
            root.destroy()
        })
        test('conditional function style returning null works and toggles back', () => {
            const cond = atom(true)
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <div style={() => cond() ? {color: 'rgb(255, 0, 0)'} : null}>text</div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('div')!
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')

            expect(() => cond(false)).not.toThrow()

            cond(true)
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
            root.destroy()
        })
    })

    /**
     * 条目 3：checked 曾只写 attribute 不写 property。
     * 用户交互（dirty state）之后 attribute 不再影响显示，响应式 checked 会失灵。
     */
    test('3. reactive checked keeps working after user interaction (dirty state)', () => {
        const checked = atom(false)
        const root = createRoot(rootEl)
        function App({}: any, {createElement}: RenderContext) {
            return <input type="checkbox" checked={checked}/>
        }
        root.render(<App/>)
        const el = rootEl.querySelector('input')! as HTMLInputElement
        expect(el.checked).toBe(false)

        // 用户点击，进入 dirty state
        el.click()
        expect(el.checked).toBe(true)

        // 响应式状态依然要能控制勾选
        checked(true)
        expect(el.checked).toBe(true)
        checked(false)
        expect(el.checked).toBe(false)
        root.destroy()
    })

    /**
     * 条目 4：FunctionHost 的重算是 queueMicrotask 异步的，微任务入队后 host 可能已被 destroy。
     * 销毁后的重算不能再执行（不依赖 data0 对已 stop autorun 的容错）。
     */
    test('4. queued recompute after destroy must not run', async () => {
        const cond = atom(true)
        let computeCount = 0
        const root = createRoot(rootEl)
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => {
                computeCount++
                return cond() ? 'yes' : 'no'
            }}</div>
        }
        root.render(<App/>)
        expect(computeCount).toBe(1)

        // 触发重算（入队微任务），随即销毁
        cond(false)
        root.destroy()

        await sleep(10)
        expect(computeCount).toBe(1)
    })

    /**
     * 条目 5a：removeElements 等待离场动画期间，DOM 可能被其他路径清掉，
     * 之前 removeNodesBetween 会 throw 成 unhandled rejection。
     */
    test('5a. external DOM cleanup during exit transition must not cause unhandled rejection', async () => {
        const rejections: any[] = []
        const onRejection = (e: PromiseRejectionEvent) => {
            rejections.push(e.reason)
            e.preventDefault()
        }
        window.addEventListener('unhandledrejection', onRejection)

        try {
            const visible = atom(true)
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    {() => visible() ? <div style={{height: 10, transition: 'all 0.1s'}} detachStyle={{height: 50}}>x</div> : null}
                </div>
            }
            root.render(<App/>)
            const el = rootEl.querySelector('div > div')! as HTMLElement
            // 先于框架的 transitionend 监听清空父节点，模拟等待动画期间 DOM 被其他路径清掉
            el.addEventListener('transitionend', () => {
                el.parentElement?.replaceChildren()
            })

            visible(false)
            await sleep(500)

            expect(rejections).toEqual([])
            root.destroy()
        } finally {
            window.removeEventListener('unhandledrejection', onRejection)
        }
    })

    /**
     * 条目 5b：RxListHost 的"整段 replaceChildren 快速删除"只检查直接子 host 的 forceHandleElement，
     * ComponentHost 曾不透传该标记，包在组件里的离场动画会被静默跳过。
     */
    test('5b. exit transition of component-wrapped list items is not skipped by fast bulk delete', async () => {
        function Item({text}: any, {createElement}: RenderContext) {
            return <div style={{height: 10, transition: 'all 0.1s'}} detachStyle={{height: 50}}>{text}</div>
        }
        const list = new RxList<number>([1, 2, 3])
        const root = createRoot(rootEl)
        function App({}: any, {createElement}: RenderContext) {
            return <div>{list.map(i => <Item text={i}/>)}</div>
        }
        root.render(<App/>)
        const container = rootEl.firstElementChild!
        expect(container.querySelectorAll('div').length).toBe(3)

        list.splice(0, 3)
        // 快速删除路径会立刻清空；正确行为是等待离场动画完成后再删除
        expect(container.querySelectorAll('div').length).toBe(3)

        await sleep(500)
        expect(container.querySelectorAll('div').length).toBe(0)
        root.destroy()
    })

    /**
     * 条目 6：createHTMLOrSVGElement 里 itemConfig 合并曾用 rawProps 而不是 separateProps
     * 处理过的 finalProps，导致元素同时有 $self:/prop: 前缀 props 又被外部 AOP 配置时，
     * $self: 的合并结果被丢弃、prop: 键以原始形态混回 props。
     */
    test('6. $self: merge survives when the element is also configured externally', () => {
        function Inner({}: any, {createElement}: RenderContext) {
            return <div as="item" prop:foo={42} $self:style={{fontSize: 12}}>inner</div>
        }
        const root = createRoot(rootEl)
        root.render(<Inner $item:style={{color: 'rgb(255, 0, 0)'}}/>)

        const el = rootEl.querySelector('[data-as="item"]')! as HTMLElement
        // $self:style 的 fontSize 和外部 AOP 的 color 都应生效
        expect(el.style.fontSize).toBe('12px')
        expect(el.style.color).toBe('rgb(255, 0, 0)')
        // prop: 前缀的 key 不应以原始形态出现在 DOM 属性上
        expect(el.hasAttribute('prop:foo')).toBe(false)
        root.destroy()
    })

    /**
     * 条目 7：createRoot(element, parentContext) 曾原地改写传入 context 的 root 字段。
     * Portal 传入的是自己组件的 pathContext，被改写后组件的 pathContext.root 指向内层 root，
     * layoutEffect/ref 会错误地注册到内层 root 的 attach 事件上。
     */
    describe('7. createRoot must not mutate the passed parentContext', () => {
        test('parentContext.root stays untouched', () => {
            const outerRoot = createRoot(rootEl)
            const parentContext = {hostPath: null, elementPath: [], root: outerRoot} as any
            const innerRoot = createRoot(document.createElement('div'), parentContext)

            expect(parentContext.root).toBe(outerRoot)
            expect(innerRoot.pathContext.root).toBe(innerRoot)
        })
        test('ref of a Portal into a detached container is attached when the outer root attaches', () => {
            const container = document.createElement('div')
            const refCalls: any[] = []
            const root = createRoot(rootEl)
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <Portal container={container} content={<div>portal content</div>} ref={(r: any) => refCalls.push(r)}/>
                </div>
            }
            root.render(<App/>)
            expect(container.textContent).toBe('portal content')
            // Portal 组件自身的 ref 应随外层 root attach 被附加，
            // 而不是错误地挂在（永不 attach 的）内层 root 上。
            expect(refCalls.length).toBe(1)
            root.destroy()
        })
    })

    /**
     * 条目 8：Root.render 曾可重入，连调两次会往容器追加两棵树。
     */
    test('8. root.render is not re-entrant, but can render again after destroy', () => {
        const root = createRoot(rootEl)
        root.render(<div>a</div>)
        expect(() => root.render(<div>b</div>)).toThrow(/destroy the root/)
        expect(rootEl.textContent).toBe('a')

        root.destroy()
        root.render(<div>c</div>)
        expect(rootEl.textContent).toBe('c')
        root.destroy()
    })

    /**
     * 条目 9：框架曾没有任何错误处理机制。
     * 现在支持 root.on('error') 全局钩子：注册后组件 render / 函数节点重算抛错会被报告、
     * 该区域渲染为空且可恢复；未注册时保持原有向上抛出的行为，且不再破坏 effect 收集栈。
     */
    describe('9. render error handling', () => {
        test('function node error is reported to root error hook and the region recovers', async () => {
            const errors: any[] = []
            const cond = atom(false)
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))

            function App({}: any, {createElement}: RenderContext) {
                return <div>{() => {
                    if (cond()) throw new Error('function node boom')
                    return <span>ok</span>
                }}</div>
            }
            root.render(<App/>)
            expect(rootEl.querySelector('span')!.textContent).toBe('ok')

            cond(true)
            await nextMicrotask()
            expect(errors.length).toBe(1)
            expect(String(errors[0])).toContain('function node boom')
            // 出错区域渲染为空
            expect(rootEl.querySelector('span')).toBeNull()

            // 依赖恢复后区域可以恢复渲染
            cond(false)
            await nextMicrotask()
            expect(rootEl.querySelector('span')!.textContent).toBe('ok')
            root.destroy()
        })
        test('component render error is reported to root error hook and the rest of the tree renders', () => {
            const errors: any[] = []
            function Bad(): any {
                throw new Error('bad component')
            }
            const root = createRoot(rootEl)
            root.on('error', (e: any) => errors.push(e))
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <Bad/>
                    <span>alive</span>
                </div>
            }
            expect(() => root.render(<App/>)).not.toThrow()
            expect(errors.length).toBe(1)
            expect(String(errors[0])).toContain('bad component')
            expect(rootEl.querySelector('span')!.textContent).toBe('alive')
            root.destroy()
        })
        test('without an error hook the error still propagates, and the effect collect stack stays intact', () => {
            function Bad(): any {
                throw new Error('bad component')
            }
            const root = createRoot(rootEl)
            expect(() => root.render(<Bad/>)).toThrow('bad component')
            // collect frame 必须被弹出，否则后续渲染收集的 effect 会泄漏到错误的 frame 里
            expect((ReactiveEffect as any).collectFrames.length).toBe(0)

            // 后续渲染不受影响
            const rootEl2 = document.createElement('div')
            document.body.appendChild(rootEl2)
            const root2 = createRoot(rootEl2)
            function Good({}: any, {createElement}: RenderContext) {
                return <div>good</div>
            }
            root2.render(<Good/>)
            expect(rootEl2.textContent).toBe('good')
            root2.destroy()
        })
    })

    /**
     * 条目 10：parseItemConfigFromProp 的 assert 报错信息曾打印元素名（itemName）
     * 而不是非法的配置项名（itemProp）。
     */
    test('10. unsupported config item error message names the invalid config item', () => {
        function Inner({}: any, {createElement}: RenderContext) {
            return <div as="item">inner</div>
        }
        const root = createRoot(rootEl)
        expect(() => {
            root.render(<Inner $item:_unknown={1}/>)
        }).toThrow(/_unknown/)
    })

    /**
     * 条目 12：propTypes 曾是半成品：shapeOf.check 恒返回 true、
     * arrayOf/shapeOf 的 stringify/parse 是空 TODO、coerce 的合法 falsy 返回值会被 || 吞掉。
     */
    describe('12. propTypes', () => {
        test('shapeOf.check actually validates the shape', () => {
            const shape = PropTypes.shapeOf({name: PropTypes.string, age: PropTypes.number})
            expect(shape.check({name: 'a', age: 1})).toBe(true)
            expect(shape.check({name: 'a', age: 'x'})).toBe(false)
            expect(shape.check({name: 1})).toBe(false)
            expect(shape.check(null)).toBe(false)
            expect(shape.check('str')).toBe(false)
            expect(shape.check([1])).toBe(false)
        })
        test('arrayOf/shapeOf stringify and parse round-trip via JSON', () => {
            const arr = PropTypes.arrayOf(PropTypes.number)
            expect(arr.stringify!([1, 2, 3])).toBe('[1,2,3]')
            expect(arr.parse!('[1,2,3]')).toEqual([1, 2, 3])
            expect(() => arr.parse!('["a"]')).toThrow(/can not parse/)

            const shape = PropTypes.shapeOf({name: PropTypes.string})
            expect(shape.parse!(shape.stringify!({name: 'a'}))).toEqual({name: 'a'})
            expect(() => shape.parse!('{"name":1}')).toThrow(/can not parse/)
        })
        test('coerce returning a legal falsy value is not swallowed', () => {
            function Flag({flag}: any, {createElement}: RenderContext) {
                return <div>{String(flag)}</div>
            }
            Flag.propTypes = {flag: {coerce: (v: any) => v === 'yes'}} as any

            const root = createRoot(rootEl)
            root.render(<Flag flag="no"/>)
            expect(rootEl.textContent).toBe('false')
            root.destroy()
        })
    })

    /**
     * 条目 13：insertBefore 的区间搬移曾是逐节点递归，长区间会栈溢出。
     */
    test('13. insertBefore moves a very long range without stack overflow', () => {
        const N = 50000
        const source = document.createElement('div')
        for (let i = 0; i < N; i++) {
            source.appendChild(document.createTextNode('x'))
        }
        const target = document.createElement('div')
        const ref = document.createComment('ref')
        target.appendChild(ref)

        insertBefore(source.firstChild as Text, ref, source.lastChild as Text)

        expect(target.childNodes.length).toBe(N + 1)
        expect(source.childNodes.length).toBe(0)
        // 顺序保持，ref 在最后
        expect(target.lastChild).toBe(ref)
    })

    /**
     * 条目 15：eventProxy 对数组 listener 曾用 forEach，吞掉了所有返回值。
     */
    test('15. event proxy preserves return values of array listeners', () => {
        const el = createElement('div', {
            onClick: [() => 'a', () => 'b'],
        }) as ExtendedElement
        expect(dispatchEvent(el, new Event('click'))).toEqual(['a', 'b'])

        const el2 = createElement('div', {
            onClick: () => 'single',
        }) as ExtendedElement
        expect(dispatchEvent(el2, new Event('click'))).toBe('single')
    })

    /**
     * 条目 15：lazy 组件此前没有任何测试（LazyComonent 拼写错误也已修正）。
     */
    test('15. lazy component renders fallback first, then the loaded component', async () => {
        function Loaded({}: any, {createElement}: RenderContext) {
            return <div>loaded</div>
        }
        const LazyComp = lazy(() => Promise.resolve(Loaded), () => <div>loading</div>)

        const root = createRoot(rootEl)
        root.render(<LazyComp/>)
        expect(rootEl.textContent).toBe('loading')

        await sleep(10)
        expect(rootEl.textContent).toBe('loaded')
        root.destroy()
    })
})
