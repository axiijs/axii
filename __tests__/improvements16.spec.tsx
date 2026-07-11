/* @jsx createElement */
/**
 * 2026-07 深度 review 第十六轮：改进项回归测试（I58-I65）。
 * 每个测试都先在未修复代码上确认失败（对照项除外），再随修复转为回归测试。
 */
import {beforeEach, describe, expect, it, vi} from "vitest";
import {atom, createElement, createRef, createRoot, lazy, RenderContext, RxList} from "@framework";

function nextMicrotasks() {
    return Promise.resolve().then(() => Promise.resolve())
}

async function withWindowErrorCapture(run: () => Promise<void> | void) {
    const unhandled: any[] = []
    const onUnhandled = (e: PromiseRejectionEvent) => { unhandled.push(e.reason); e.preventDefault() }
    const onError = (e: ErrorEvent) => { unhandled.push(e.error ?? e.message); e.preventDefault() }
    window.addEventListener('unhandledrejection', onUnhandled)
    window.addEventListener('error', onError)
    try {
        await run()
        // 未派发完的微任务/事件循环错误
        await nextMicrotasks()
        await new Promise(r => setTimeout(r, 10))
    } finally {
        window.removeEventListener('unhandledrejection', onUnhandled)
        window.removeEventListener('error', onError)
    }
    return unhandled
}

describe('improvements regression (2026-07 round-16 review)', () => {
    let container: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    // I58: FunctionHost 重算路径的 DOM 操作错误（区间被外部清空后 text->结构 切换等）
    //  没有走 root error 钩子——AtomHost/ReactiveAttributeEffect 的 update 都有错误钩子
    //  语义，FunctionHost 是唯一分叉的绑定更新路径（错误变成 uncaught microtask error）。
    it('I58: function node recompute DOM error goes to the root error hook, not uncaught', async () => {
        const cond = atom(false)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render((() => cond() ? <b>structural</b> : 'text') as any)
        expect(container.textContent).toContain('text')

        // 外部整体清空容器（框架对该状态在 destroy 路径有明确容忍语义）
        container.innerHTML = ''

        const unhandled = await withWindowErrorCapture(async () => {
            cond(true)
        })

        expect(unhandled.length).toBe(0)
        expect(errors.length).toBeGreaterThan(0)
        root.destroy()
    })

    // I59: 事件 handler 数组中的条件项（onClick={[a, cond && b]}）翻转为 falsy 时，
    //  每次事件触发都会 TypeError（style/className 数组的 falsy 条件项都是跳过语义，
    //  单个 falsy handler 也是解绑语义，唯独数组项会崩）。
    it('I59: falsy conditional item in an event handler array is skipped, siblings still run', async () => {
        const calls: string[] = []
        const cond = false
        const root = createRoot(container)
        root.render(<div id="i59" onClick={[() => calls.push('a'), cond && ((() => calls.push('b')) as any), null as any, undefined as any]}/>)
        const el = container.querySelector('#i59') as HTMLElement

        const unhandled = await withWindowErrorCapture(() => {
            el.click()
        })
        expect(calls).toEqual(['a'])
        expect(unhandled.length).toBe(0)
        root.destroy()
    })

    // I60a: 元素 ref 数组中的条件项（ref={[r, cond && r2]}）falsy 时不应产生错误
    it('I60a: falsy conditional item in an element ref array is skipped', () => {
        const ref1 = createRef()
        const cond = false
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<div id="i60a" ref={[ref1, cond && (createRef() as any)]}/>)
        expect(ref1.current?.id).toBe('i60a')
        expect(errors.length).toBe(0)
        root.destroy()
        expect(ref1.current).toBe(null)
        expect(errors.length).toBe(0)
    })

    // I60b: 组件 ref 数组中的条件项 falsy 时不应产生错误
    it('I60b: falsy conditional item in a component ref array is skipped', () => {
        function Child({}, {createElement, expose}: RenderContext) {
            expose(1, 'x')
            return <div>c</div>
        }
        const ref1 = createRef()
        const cond = false
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(createElement(Child, {ref: [ref1, cond && (createRef() as any)]}))
        expect(ref1.current?.x).toBe(1)
        expect(errors.length).toBe(0)
        root.destroy()
        expect(ref1.current).toBe(null)
        expect(errors.length).toBe(0)
    })

    // I61: bigint child 的形态空间——atom 入口碰巧可用（stringValue 走 toString），
    //  静态 child / 静态数组 / RxList 行直接崩溃渲染，函数 child 渲染为空 + 错误，
    //  同一个值换个入口行为分叉。后端 id（数据库 bigint id）是自然输入。
    it('I61a: static bigint child renders as text', () => {
        const root = createRoot(container)
        expect(() => root.render(<div id="i61a">{10n as any}</div>)).not.toThrow()
        expect(container.querySelector('#i61a')!.textContent).toBe('10')
        root.destroy()
    })
    it('I61b: function child returning bigint renders as text', () => {
        const n = atom(1)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<div id="i61b">{() => (n() > 0 ? 10n : 20n) as any}</div>)
        expect(container.querySelector('#i61b')!.textContent).toBe('10')
        expect(errors.length).toBe(0)
        root.destroy()
    })
    it('I61c: bigint in a static array child renders as text', () => {
        const root = createRoot(container)
        expect(() => root.render(<div id="i61c">{[10n as any, 'x']}</div>)).not.toThrow()
        expect(container.querySelector('#i61c')!.textContent).toBe('10x')
        root.destroy()
    })
    it('I61d: RxList row holding bigint renders as text', () => {
        const list = new RxList<any>([1n, 2n])
        const root = createRoot(container)
        expect(() => root.render(<div id="i61d">{list}</div>)).not.toThrow()
        expect(container.querySelector('#i61d')!.textContent).toBe('12')
        list.push(3n)
        expect(container.querySelector('#i61d')!.textContent).toBe('123')
        root.destroy()
    })
    it('I61e: atom holding bigint keeps working (control)', () => {
        const v = atom(10n as any)
        const root = createRoot(container)
        root.render(<div id="i61e">{v}</div>)
        expect(container.querySelector('#i61e')!.textContent).toBe('10')
        root.destroy()
    })

    // I62: value 的非数字字符串在 progress/meter（WebIDL double property）上直接 TypeError
    //  崩溃渲染——F49 处理了 nullish，这个分支仍是「绕过 setProperty try/catch 的裸赋值」，
    //  同元素的 max（走 setProperty）对垃圾值能优雅降级，value 却崩溃。
    it('I62a: progress with a non-numeric string value degrades gracefully instead of crashing', () => {
        const root = createRoot(container)
        expect(() => {
            root.render(<progress id="i62a" value={'abc' as any} max={100}/>)
        }).not.toThrow()
        expect(container.querySelector('#i62a')).not.toBe(null)
        root.destroy()
    })
    it('I62b: meter reactive value flipping to a non-numeric string does not report an error', async () => {
        const v = atom<any>(0.5)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        root.render(<meter id="i62b" value={() => v()}/>)
        v('abc')
        await nextMicrotasks()
        expect(errors.length).toBe(0)
        root.destroy()
    })
    it('I62c: numeric value on progress keeps working (control)', () => {
        const root = createRoot(container)
        root.render(<progress id="i62c" value={0.5} max={1}/>)
        expect((container.querySelector('#i62c') as HTMLProgressElement).value).toBe(0.5)
        root.destroy()
    })

    // I63: lazy() 不传 fallback（React.lazy 本来就没有 fallback 参数，省略是自然写法）
    //  时，加载期间每次渲染都会 TypeError（fallback is not a function）。
    it('I63: lazy without fallback renders empty while loading, then shows the component', async () => {
        let resolveLoad: (c: any) => void
        const Lazy = lazy((() => new Promise(r => { resolveLoad = r })) as any)
        const root = createRoot(container)
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        expect(() => root.render(<div id="i63"><Lazy/></div>)).not.toThrow()
        await nextMicrotasks()
        expect(errors.length).toBe(0)
        expect(container.querySelector('#i63')!.textContent).toBe('')

        resolveLoad!(function Loaded({}, {createElement}: RenderContext) {
            return <b>loaded</b>
        })
        await nextMicrotasks()
        expect(container.querySelector('#i63 b')?.textContent).toBe('loaded')
        root.destroy()
    })

    // I64: is 属性（customized built-in element）必须在 createElement 时作为选项传入，
    //  事后 setAttribute 不会触发升级——元素静默缺少自定义行为。
    it('I64: is prop creates a customized built-in element', () => {
        const invoked: string[] = []
        const name = 'my-btn-' + Math.random().toString(36).slice(2)
        class MyButton extends HTMLButtonElement {
            connectedCallback() { invoked.push('connected') }
        }
        customElements.define(name, MyButton, {extends: 'button'})
        const root = createRoot(container)
        root.render(<button is={name} id="i64">x</button>)
        const el = container.querySelector('#i64')!
        expect(el instanceof MyButton).toBe(true)
        expect(invoked).toContain('connected')
        // attribute 也要在（HTML 序列化/CSS 选择器语义）
        expect(el.getAttribute('is')).toBe(name)
        root.destroy()
    })

    // I65: atom 被直接绑定为事件 handler 时，事件分发会以「写入」形态调用 atom
    //  （atom(event)），事件对象被静默写进 atom——handler 丢失 + 状态损坏且没有任何提示。
    //  事件按设计是非响应式的（README），开发期应给出明确警告。
    it('I65: binding an atom as an event handler warns in dev instead of silently corrupting it', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const handler = atom<any>(() => {})
            const root = createRoot(container)
            root.render(<div id="i65" onClick={handler as any}/>)
            const warned = consoleError.mock.calls.some(args => args.some(a => typeof a === 'string' && a.includes('atom')))
            expect(warned).toBe(true)
            root.destroy()
        } finally {
            consoleError.mockRestore()
        }
    })

    // I66: dangerouslySetInnerHTML 与 children 并存时，innerHTML 赋值把刚 append 的
    //  children（含响应式 child 的占位符）整体抹掉——atom/函数 child 从此写进脱离文档的
    //  占位符，「更新不生效」且没有任何报错（React 对这个组合直接抛错）。开发期应警告。
    it('I66: dangerouslySetInnerHTML together with children warns in dev', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const text = atom('a')
            const root = createRoot(container)
            root.render(<div id="i66" dangerouslySetInnerHTML="<b>html</b>">{text}</div>)
            const warned = consoleError.mock.calls.some(args =>
                args.some(a => typeof a === 'string' && a.includes('dangerouslySetInnerHTML')))
            expect(warned).toBe(true)
            // 渲染语义保持：innerHTML 胜出
            expect(container.querySelector('#i66')!.innerHTML).toBe('<b>html</b>')
            root.destroy()
        } finally {
            consoleError.mockRestore()
        }
    })

    // I66 对照：只有 dangerouslySetInnerHTML（无 children）不应警告
    it('I66-control: dangerouslySetInnerHTML alone does not warn', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const root = createRoot(container)
            root.render(<div id="i66c" dangerouslySetInnerHTML="<b>html</b>"/>)
            const warned = consoleError.mock.calls.some(args =>
                args.some(a => typeof a === 'string' && a.includes('dangerouslySetInnerHTML')))
            expect(warned).toBe(false)
            root.destroy()
        } finally {
            consoleError.mockRestore()
        }
    })
})
