/** @jsx createElement */
/**
 * 2026-07 深度 review 的显著改进项（见 prompt/output/05-review-2026-07.md）。
 * 编号与 review 报告一致（I7-I15）。
 */
import {
    createElement, createRoot, RenderContext, atom, lazy, jsx, setAttribute,
    RxDOMRect, RxDOMSize, ComponentHost, RectObject, Portal, RxList,
    enableAxiiRetainedObjectDiagnostics, disableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
} from "@framework";
import {beforeEach, describe, expect, test, vi} from "vitest";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const nextMicrotask = () => new Promise<void>(resolve => queueMicrotask(resolve))
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))

describe('improvements regression (2026-07 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I7: atom(null)/atom(undefined) 作为 child 渲染为空文本，
     * 与函数 child 返回 null 的语义一致，不再输出字面 "null"/"undefined"。
     */
    test('I7: atom(null)/atom(undefined) as child renders empty text', async () => {
        const a = atom<any>(null)
        const b = atom<any>(undefined)
        function App() {
            return <div><span>{a}</span><span>{b}</span></div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        const spans = rootEl.querySelectorAll('span')
        expect(spans[0].textContent).toBe('')
        expect(spans[1].textContent).toBe('')
        // 有值 → 显示；回到 null → 清空
        a('hello')
        expect(spans[0].textContent).toBe('hello')
        a(null)
        expect(spans[0].textContent).toBe('')
        root.destroy()
    })

    /**
     * I8: 响应式 value 变为 undefined/null 时，所有 input 类型（不只 type=text）
     * 和 textarea 都应显示空字符串，而不是字面 "undefined"。
     */
    test('I8: input (any type) and textarea show empty string for undefined/null value', async () => {
        const v = atom<any>('abc')
        let passwordRef: any, textareaRef: any
        function App({}: any, {createElement, createRef}: RenderContext) {
            passwordRef = createRef()
            textareaRef = createRef()
            return <div>
                <input ref={passwordRef} type="password" value={v}/>
                <textarea ref={textareaRef} value={v}/>
            </div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect((passwordRef.current as HTMLInputElement).value).toBe('abc')
        expect((textareaRef.current as HTMLTextAreaElement).value).toBe('abc')
        v(undefined)
        await nextMicrotask()
        expect((passwordRef.current as HTMLInputElement).value).toBe('')
        expect((textareaRef.current as HTMLTextAreaElement).value).toBe('')
        v('again')
        await nextMicrotask()
        expect((passwordRef.current as HTMLInputElement).value).toBe('again')
        root.destroy()
    })

    /**
     * I9a: lazy() 定义时不应调用 load()（否则模块加载即发起网络请求，违背代码分割初衷），
     * 首次渲染时才开始加载。
     */
    test('I9a: lazy() defers load() until first render', async () => {
        let resolveLoad: (c: any) => void
        const load = vi.fn(() => new Promise<any>(resolve => { resolveLoad = resolve }))
        const LazyComp = lazy(load, () => <div>loading</div>)
        expect(load).not.toHaveBeenCalled()

        function Loaded({}: any, {createElement}: RenderContext) {
            return <div>loaded</div>
        }
        const root = createRoot(rootEl)
        root.render(<LazyComp/>)
        expect(load).toHaveBeenCalledTimes(1)
        expect(rootEl.textContent).toBe('loading')
        resolveLoad!(Loaded)
        await sleep(10)
        expect(rootEl.textContent).toBe('loaded')
        root.destroy()
    })

    /**
     * I9b: load() 失败不应产生 unhandled rejection，fallback 能拿到 error 展示错误态。
     */
    test('I9b: lazy load() rejection is handled and passed to fallback', async () => {
        let unhandled = false
        const onUnhandled = () => { unhandled = true }
        window.addEventListener('unhandledrejection', onUnhandled)

        const LazyComp = lazy(
            () => Promise.reject(new Error('network fail')),
            (error?: any) => <div>{error ? `error:${error.message}` : 'loading'}</div>
        )
        const root = createRoot(rootEl)
        root.render(<LazyComp/>)
        expect(rootEl.textContent).toBe('loading')
        await sleep(50)
        expect(rootEl.textContent).toBe('error:network fail')
        window.removeEventListener('unhandledrejection', onUnhandled)
        expect(unhandled).toBe(false)
        root.destroy()
    })

    /**
     * I10: RxDOMRect 的 requestAnimationFrame/requestIdleCallback 模式应持续跟踪，
     * 之前只调度一次、更新一次后就停止。
     */
    test('I10: RxDOMRect requestAnimationFrame option keeps tracking position changes', async () => {
        const el = document.createElement('div')
        el.style.cssText = 'position:absolute;top:10px;left:10px;width:10px;height:10px;'
        document.body.appendChild(el)
        const value = atom<RectObject|null>(null)
        const rx = new RxDOMRect(value, 'requestAnimationFrame')
        rx.ref(el)
        await nextFrame(); await nextFrame()
        expect(value()?.top).toBe(10)
        el.style.top = '50px'
        await nextFrame(); await nextFrame(); await sleep(50)
        expect(value()?.top).toBe(50)
        rx.ref(null)
        // 注销后不再更新
        el.style.top = '90px'
        await nextFrame(); await nextFrame(); await sleep(50)
        expect(value()).toBeNull()
        el.remove()
    })

    /**
     * I11a: RxDOMRect 的 window 分支应提供完整的 RectObject 形状（top/left/x/y = 0）。
     */
    test('I11a: RxDOMRect on window produces full RectObject shape', () => {
        const value = atom<RectObject|null>(null)
        const rx = new RxDOMRect(value, 'manual' as any)
        rx.ref(window as any)
        const rect = value()!
        expect(rect.top).toBe(0)
        expect(rect.left).toBe(0)
        expect(rect.x).toBe(0)
        expect(rect.y).toBe(0)
        expect(rect.width).toBe(window.innerWidth)
        expect(rect.height).toBe(window.innerHeight)
        rx.destroy()
    })

    /**
     * I11b: RxDOMSize 的初始值应与 SizeObject 类型一致（包含 borderBox/contentBox 字段）。
     */
    test('I11b: RxDOMSize initial value matches SizeObject shape', () => {
        const el = document.createElement('div')
        el.style.cssText = 'width:100px;height:50px;padding:5px;border:2px solid black;box-sizing:border-box;'
        document.body.appendChild(el)
        const size = new RxDOMSize()
        size.ref(el)
        const v = size.value()!
        expect(v.borderBoxWidth).toBe(100)
        expect(v.borderBoxHeight).toBe(50)
        expect(v.contentBoxWidth).toBe(100 - 2 * 2 - 2 * 5)
        expect(v.contentBoxHeight).toBe(50 - 2 * 2 - 2 * 5)
        expect(v.width).toBe(v.contentBoxWidth)
        expect(v.height).toBe(v.contentBoxHeight)
        size.ref(null)
        el.remove()
    })

    /**
     * I12: 同一元素上的多个 RxDOMSize 之前共用 WeakMap 单值槽互相覆盖，
     * 其中一个注销会把另一个也打死。
     */
    test('I12: multiple RxDOMSize instances on the same element work independently', async () => {
        const el = document.createElement('div')
        el.style.cssText = 'width:100px;height:50px;'
        document.body.appendChild(el)
        const s1 = new RxDOMSize()
        const s2 = new RxDOMSize()
        s1.ref(el)
        s2.ref(el)
        await sleep(50)
        expect(s1.value()?.width).toBe(100)
        expect(s2.value()?.width).toBe(100)
        // s2 注销后，s1 仍能收到 resize 更新
        s2.ref(null)
        el.style.width = '200px'
        await sleep(100)
        expect(s1.value()?.width).toBe(200)
        expect(s2.value()).toBeNull()
        s1.ref(null)
        el.remove()
    })

    /**
     * I13: Portal 的 destroyOnUnmount prop 之前声明了但完全没实现。
     * 默认（未传/true）卸载即销毁；显式 false 时保留 portal 内容。
     */
    test('I13: Portal destroyOnUnmount=false keeps content after unmount; default destroys', async () => {
        const containerA = document.createElement('div')
        const containerB = document.createElement('div')
        document.body.appendChild(containerA)
        document.body.appendChild(containerB)
        const show = atom(true)
        function Inner({}: any, {createElement}: RenderContext) {
            return <div>
                {createElement(Portal as any, {
                    container: containerA,
                    content: () => <span class="portal-default">default</span>,
                })}
                {createElement(Portal as any, {
                    container: containerB,
                    content: () => <span class="portal-kept">kept</span>,
                    destroyOnUnmount: false,
                })}
            </div>
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>{() => show() ? <Inner/> : null}</div>
        }
        const root = createRoot(rootEl)
        root.render(<App/>)
        expect(containerA.querySelector('.portal-default')).toBeTruthy()
        expect(containerB.querySelector('.portal-kept')).toBeTruthy()
        show(false)
        await sleep(10)
        // 默认：销毁；destroyOnUnmount=false：保留
        expect(containerA.querySelector('.portal-default')).toBeNull()
        expect(containerB.querySelector('.portal-kept')).toBeTruthy()
        root.destroy()
        containerA.remove()
        containerB.remove()
    })

    /**
     * I14: ComponentHost.typeIds 之前是普通 Map，bindProps/lazy/HOC 等动态创建组件时
     * 无上限增长且组件函数被永久 pin 住。现在改用 WeakMap + 计数器，id 依旧稳定唯一。
     */
    test('I14: ComponentHost.typeIds is a WeakMap with stable unique ids', () => {
        expect(ComponentHost.typeIds).toBeInstanceOf(WeakMap)
        function A({}: any, {createElement}: RenderContext) { return <div/> }
        function B({}: any, {createElement}: RenderContext) { return <div/> }
        const root = createRoot(rootEl)
        root.render(<div><A/><B/><A/></div> as any)
        const idA = ComponentHost.typeIds.get(A as any)
        const idB = ComponentHost.typeIds.get(B as any)
        expect(typeof idA).toBe('number')
        expect(typeof idB).toBe('number')
        expect(idA).not.toBe(idB)
        root.destroy()
    })

    /**
     * I15: automatic runtime 的 jsx()（单个/无 children）之前给组件传 children=[undefined]。
     */
    test('I15: jsx() with no children passes children=[] to component', () => {
        let seenChildren: any = 'unset'
        function Comp({children}: any, {createElement}: RenderContext) {
            seenChildren = children
            return <div/>
        }
        const node = jsx(Comp as any, {})
        const root = createRoot(rootEl)
        root.render(node as any)
        expect(seenChildren).toEqual([])
        root.destroy()

        // 有单个 child 时行为不变
        const root2 = createRoot(rootEl)
        root2.render(jsx(Comp as any, {children: 'x'}) as any)
        expect(seenChildren).toEqual(['x'])
        root2.destroy()
    })

    /**
     * O3: onChange 被别名成 input 事件后与 onInput 共享同一个事件名，
     * 之前解绑（传 falsy）会把整个事件名下的监听全部删除；
     * 现在按来源分槽，解绑 onInput 不影响 onChange，反之亦然。
     */
    test('O3: unbinding onInput does not remove the merged onChange listener', () => {
        const calls: string[] = []
        const el = createElement('input', {
            onChange: () => calls.push('change'),
            onInput: () => calls.push('input'),
        }) as HTMLInputElement

        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['change', 'input'])

        // 解绑 onInput：onChange 的监听必须保留
        setAttribute(el as any, 'onInput', null)
        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['change', 'input', 'change'])

        // 再解绑 onChange：事件名下已无监听
        setAttribute(el as any, 'onChange', null)
        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['change', 'input', 'change'])

        // 重新绑定（重绑语义：同一来源覆盖）
        setAttribute(el as any, 'onInput', () => calls.push('rebound'))
        el.dispatchEvent(new Event('input'))
        expect(calls).toEqual(['change', 'input', 'change', 'rebound'])
    })

    /**
     * O1a: root.on('error') 之前只覆盖组件 render 和函数节点重算，
     * 响应式属性更新抛错不经过钩子。现在属性更新（含初始求值）抛错也会被报告，
     * effect 保持活跃，依赖恢复后可以继续更新。
     */
    test('O1a: root.on(error) catches reactive attribute update errors and binding recovers', () => {
        const errors: any[] = []
        const ok = atom(true)
        let ref: any
        function App({}: any, {createElement, createRef}: RenderContext) {
            ref = createRef()
            return <div ref={ref} className={() => {
                if (!ok()) throw new Error('attr boom')
                return 'fine'
            }}>x</div>
        }
        const root = createRoot(rootEl)
        root.on('error', (e: any) => errors.push(e))
        root.render(<App/>)
        expect(ref.current.className).toBe('fine')
        ok(false)
        expect(errors.length).toBe(1)
        expect(errors[0].message).toBe('attr boom')
        // 依赖恢复后继续更新
        ok(true)
        expect(ref.current.className).toBe('fine')
        root.destroy()
    })

    /**
     * O1b: atom 文本更新抛错（如用户对象的 toString 抛错）也应经过 root.on('error')，
     * 保留上一次的文本，依赖恢复后继续更新。
     */
    test('O1b: root.on(error) catches atom text update errors and binding recovers', () => {
        const errors: any[] = []
        const val = atom<any>('ok')
        function App() {
            return <span id="atom-err">{val}</span>
        }
        const root = createRoot(rootEl)
        root.on('error', (e: any) => errors.push(e))
        root.render(<App/>)
        const span = document.getElementById('atom-err')!
        expect(span.textContent).toBe('ok')
        val({toString() { throw new Error('text boom') }})
        expect(errors.length).toBe(1)
        expect(errors[0].message).toBe('text boom')
        // 保留上一次的文本
        expect(span.textContent).toBe('ok')
        val('recovered')
        expect(span.textContent).toBe('recovered')
        root.destroy()
    })

    /**
     * O1c: RxList patch 中的错误（如外部破坏了列表管理的 DOM 区间导致
     * AXII_DOM_BOUNDARY_BROKEN）之前 reportAxiiError 后继续 rethrow，
     * 在 data0 computed 里变成 unhandled rejection。现在注册了 root.on('error')
     * 时交给处理器，应用保持存活。
     */
    test('O1c: root.on(error) catches RxList patch errors without unhandled rejection', async () => {
        let unhandled = false
        const onUnhandled = () => { unhandled = true }
        window.addEventListener('unhandledrejection', onUnhandled)

        const errors: any[] = []
        const list = new RxList([1, 2, 3])
        function App({}: any, {createElement}: RenderContext) {
            return <div id="list-parent">{list.map((n: number) => <div class="err-row">{'' + n}</div>)}</div>
        }
        const root = createRoot(rootEl)
        root.on('error', (e: any) => errors.push(e))
        root.render(<App/>)

        // 外部破坏列表 DOM 区间：把第二行搬到第一行前面
        const parent = document.getElementById('list-parent')!
        const rows = parent.querySelectorAll('.err-row')
        parent.insertBefore(rows[1], rows[0])

        // 删除前两行 → 整段删除路径的区间校验抛 AxiiError
        list.splice(0, 2)
        expect(errors.length).toBe(1)
        expect((errors[0] as any).code).toBe('AXII_DOM_BOUNDARY_BROKEN')

        await sleep(30)
        window.removeEventListener('unhandledrejection', onUnhandled)
        expect(unhandled).toBe(false)
        root.destroy()
    })

    /**
     * O2: Host.destroy 的第二个参数 parentHandleComputed 已删除（代码库中不再有以 true
     * 传入的起点）。回归验证：destroy 后所有 host / 绑定 effect 无条件清理，无泄漏。
     */
    test('O2: destroy always cleans up all hosts and binding effects (no leak)', async () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const list = new RxList([1, 2, 3])
            const title = atom('t')
            const show = atom(true)
            function Row({n}: any, {createElement}: RenderContext) {
                return <div className={() => 'row-' + n}>{'' + n}</div>
            }
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <span>{title}</span>
                    {() => show() ? <em>{() => title() + '!'}</em> : null}
                    {list.map((n: number) => <Row n={n}/>)}
                </div>
            }
            const root = createRoot(rootEl)
            root.render(<App/>)
            list.push(4)
            show(false)
            await nextMicrotask()
            list.splice(0, 2)
            root.destroy()

            const snapshot = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(snapshot.hosts.totalActive).toBe(0)
            expect(snapshot.lightBindings.totalActive).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })
})
