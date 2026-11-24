/* @jsx createElement */
/**
 * root 监听器的生命周期（#53）。
 *
 * 用户通过 root.on() 注册的监听器属于 root，不属于某一次渲染：root.destroy() 之后保留，
 * 同一个 root 重新 render 的内容抛错仍然交给原来的 error 监听器。destroy 只重置每次渲染的状态
 * （attach 队列、attached 标记，以及内容在 attach 之前登记的 layoutEffect / ref / Portal 桥接）。
 * 框架内部这些每次渲染登记的监听不能随 render / destroy 循环累积，也不能在 destroy 之后
 * 被下一棵树的 attach 触发。
 */
import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    configureDiagnostics,
    createElement,
    createRoot,
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    Portal,
    RenderContext,
} from "@framework";

async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('user listeners survive root.destroy()', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('an error listener registered before destroy receives errors of the next render', () => {
        const root = createRoot(rootEl)
        const seen: unknown[] = []
        root.on('error', e => { seen.push(e) })
        root.render(<div>ok</div>)
        root.destroy()

        const error = new Error('render failed')
        function Broken(): any { throw error }
        expect(() => root.render(<div><Broken/>after</div>)).not.toThrow()
        expect(seen).toEqual([error])
        expect(rootEl.textContent).toBe('after')
        root.destroy()
    })

    test('errors of bindings created by the next render still reach the error listener', async () => {
        const root = createRoot(rootEl)
        const seen: unknown[] = []
        root.on('error', e => { seen.push(e) })
        root.render(<div>first</div>)
        root.destroy()

        const value = atom<any>('a')
        root.render(<p>{() => value()}</p>)
        const error = new Error('toString failed')
        value({toString() { throw error }})
        await settle()
        expect(seen).toEqual([error])
        root.destroy()
    })

    test('attach, detach and custom listeners keep firing across render / destroy cycles', () => {
        const root = createRoot(rootEl)
        const calls: string[] = []
        root.on('attach', () => { calls.push('attach') })
        root.on('detach', () => { calls.push('detach') })
        root.on('attach', () => { calls.push('attach once') }, {once: true})
        root.on('custom', () => { calls.push('custom') })

        root.render(<div>1</div>)
        root.destroy()
        root.render(<div>2</div>)
        root.destroy()
        expect(root.dispatch('custom')).toBe(true)
        expect(calls).toEqual(['attach', 'attach once', 'detach', 'attach', 'detach', 'custom'])
    })

    test('unsubscribing after destroy still removes the listener', () => {
        const root = createRoot(rootEl)
        const seen: unknown[] = []
        const off = root.on('error', e => { seen.push(e) })
        root.render(<div>ok</div>)
        root.destroy()
        off()

        function Broken(): any { throw new Error('unhandled') }
        expect(() => root.render(<Broken/>)).toThrow('unhandled')
        expect(seen).toEqual([])
    })
})

describe('per-render internal attach callbacks belong to their render', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        configureDiagnostics({})
        rootEl = document.createElement('div')
    })
    afterEach(() => {
        disableAxiiRetainedObjectDiagnostics()
        configureDiagnostics({})
    })

    // 用户 attach 监听器与内容的 layoutEffect / ref 在同一张表里按登记顺序执行：
    //  render 之前注册的先于内容执行，render 之后注册的晚于内容执行（可以读到 ref）。
    test('user attach listeners and content callbacks keep their registration order', () => {
        const root = createRoot(rootEl)
        const calls: string[] = []
        function Child(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('layoutEffect') })
            return <b ref={(el: any) => { if (el) calls.push('ref') }}>child</b>
        }
        root.on('attach', () => { calls.push('registered before render') })
        root.render(<Child/>)
        root.on('attach', () => { calls.push('registered after render') })
        document.body.appendChild(rootEl)
        expect(root.dispatch('attach')).toBe(true)
        expect(calls).toEqual(['registered before render', 'ref', 'layoutEffect', 'registered after render'])
    })

    // 渲染到一半时 error 监听器销毁 root、再往同一个 root 渲染错误提示（render 的重入说明里
    //  最常见的写法）。被丢弃的那棵树在出错之前登记的 layoutEffect / ref 只属于它自己，
    //  错误提示 attach 时不能执行；它之后抛出的错误也不属于错误提示，不能再交给监听器，
    //  而是经 reportAxiiError 报告（#58）。
    test('a tree discarded mid-render neither runs its callbacks nor hands later errors to the listener', () => {
        document.body.appendChild(rootEl)
        const reported: any[] = []
        configureDiagnostics({onError: error => { reported.push(error) }})
        const root = createRoot(rootEl)
        const calls: string[] = []
        let fallbackRenders = 0
        function Before(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('discarded layoutEffect') })
            return <b ref={(el: any) => { if (el) calls.push('discarded ref') }}>before</b>
        }
        function Broken({message}: any): any { throw new Error(message) }
        function Fallback({error}: any, {useLayoutEffect}: RenderContext) {
            fallbackRenders++
            useLayoutEffect(() => { calls.push('fallback layoutEffect') })
            return <i>{error.message}</i>
        }
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            root.destroy()
            root.render(<Fallback error={error}/>)
        })
        root.render(<div><Before/><Broken message="first"/><Before/><Broken message="second"/></div>)
        expect(seen).toEqual(['first'])
        expect(reported.map(error => error.message)).toEqual(['second'])
        expect(fallbackRenders).toBe(1)
        expect(calls).toEqual(['fallback layoutEffect'])
        expect(rootEl.textContent).toBe('first')

        // 监听器仍然属于 root：错误提示之后的内容抛错照常交给它
        root.destroy()
        root.render(<Broken message="third"/>)
        expect(seen).toEqual(['first', 'third'])
        expect(rootEl.textContent).toBe('third')
        root.destroy()
    })

    // 渲染完成之后的绑定错误：监听器销毁 root。它启动的这次销毁里清理函数抛出的错误仍然交给它
    //  （与之前一致），销毁不会因为一个清理函数抛错而中途停下。
    test('a listener that destroys the root still receives errors of the teardown it started', async () => {
        document.body.appendChild(rootEl)
        const root = createRoot(rootEl)
        const value = atom<any>('a')
        const cleaned: string[] = []
        function Leaky(_: any, {useEffect}: RenderContext) {
            useEffect(() => () => { throw new Error('cleanup failed') })
            return <b>leaky</b>
        }
        function Sibling(_: any, {useEffect}: RenderContext) {
            useEffect(() => () => { cleaned.push('sibling') })
            return <i>sibling</i>
        }
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            if (seen.length === 1) root.destroy()
        })
        root.render(<div><p>{() => value()}</p><Leaky/><Sibling/></div>)
        value({toString() { throw new Error('binding failed') }})
        await settle()
        expect(seen).toEqual(['binding failed', 'cleanup failed'])
        expect(cleaned).toEqual(['sibling'])
        expect(rootEl.textContent).toBe('')
    })

    // 渲染到一半被丢弃的树要等渲染栈退出才销毁：它的清理函数抛出的错误同样不属于 root 现在的内容，
    //  不交给监听器（不会为一棵已丢弃的树把错误提示销毁重建），经 reportAxiiError 报告，
    //  不再从 root.render 抛出（#58）。
    test('teardown errors of a tree discarded mid-render are not given to the listener', () => {
        document.body.appendChild(rootEl)
        const reported: any[] = []
        configureDiagnostics({onError: error => { reported.push(error) }})
        const root = createRoot(rootEl)
        let fallbackRenders = 0
        function Before(_: any, {useEffect}: RenderContext) {
            useEffect(() => () => { throw new Error('discarded cleanup failed') })
            return <b>before</b>
        }
        function Broken(): any { throw new Error('render failed') }
        function Fallback({error}: any) {
            fallbackRenders++
            return <i>{error.message}</i>
        }
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            root.destroy()
            root.render(<Fallback error={error}/>)
        })
        let thrown: any
        try {
            root.render(<div><Before/><Broken/></div>)
        } catch (error) {
            thrown = error
        }
        expect(seen).toEqual(['render failed'])
        expect(fallbackRenders).toBe(1)
        expect(rootEl.textContent).toBe('render failed')
        expect(thrown).toBe(undefined)
        expect(reported.map(error => error.message)).toEqual(['discarded cleanup failed'])
        root.destroy()
    })

    // 错误提示本身渲染就抛错：监听器在自己销毁 root 之后、返回之前不会再被同一个 root 调用，
    //  错误提示的错误经 reportAxiiError 报告，而不是一直递归到栈溢出。
    test('an error listener that re-renders a failing fallback is not re-entered', () => {
        document.body.appendChild(rootEl)
        const root = createRoot(rootEl)
        const reported: any[] = []
        configureDiagnostics({onError: error => { reported.push(error) }})
        function Broken({message}: any): any { throw new Error(message) }
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            root.destroy()
            root.render(<Broken message="fallback failed"/>)
        })
        root.render(<Broken message="content failed"/>)
        expect(seen).toEqual(['content failed'])
        expect(reported.map(error => error.message)).toEqual(['fallback failed'])

        // 那一次通知结束之后，监听器照常接收 root 之后渲染的内容的错误
        root.destroy()
        root.render(<Broken message="later"/>)
        expect(seen).toEqual(['content failed', 'later'])
        expect(reported.map(error => error.message)).toEqual(['fallback failed', 'fallback failed'])
        root.destroy()
    })

    // 容器一直不连通：内容的 layoutEffect / ref / Portal 桥接都登记成等待 root attach 的回调。
    //  同一个 root 反复 render / destroy，它们不累积；宿主与绑定计数回到基线。
    test('repeated render / destroy on a detached root does not accumulate attach callbacks', () => {
        const portalEl = document.createElement('div')
        rootEl.appendChild(portalEl)
        const calls: string[] = []
        function Content(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('layoutEffect') })
            return <div>
                <b ref={(el: any) => { if (el) calls.push('ref') }}>content</b>
                <Portal container={portalEl} content={() => <i>portal</i>}/>
            </div>
        }
        const root = createRoot(rootEl)
        root.on('error', () => {})
        root.render(<div>warm up</div>)
        root.destroy()

        enableAxiiRetainedObjectDiagnostics()
        const before = getAxiiRetainedObjectDiagnosticsSnapshot()
        for (let i = 0; i < 5; i++) {
            root.render(<Content/>)
            root.destroy()
        }
        const after = getAxiiRetainedObjectDiagnosticsSnapshot()
        expect(after.hosts.createdByType.ComponentHost).toBeGreaterThan(0)
        expect(after.hosts.totalActive).toBe(before.hosts.totalActive)
        expect(after.lightBindings.totalActive).toBe(before.lightBindings.totalActive)

        // 表里只剩用户的 error 监听器：五棵树没有一个 attach 回调残留
        document.body.appendChild(rootEl)
        expect(root.dispatch('attach')).toBe(false)
        expect(calls).toEqual([])

        // 之后的一次渲染只执行它自己的 layoutEffect / ref
        root.destroy()
        root.render(<Content/>)
        expect([...calls].sort()).toEqual(['layoutEffect', 'ref'])
        expect(portalEl.textContent).toBe('portal')
        root.destroy()
        expect(portalEl.textContent).toBe('')
    })

    // 每一轮都在渲染中途丢弃一棵带 layoutEffect / ref / Portal 桥接的树：
    //  被丢弃的回调既不执行，也不随循环累积；宿主与绑定计数回到基线。
    test('repeated discard-mid-render cycles leave nothing behind', () => {
        document.body.appendChild(rootEl)
        const portalEl = document.createElement('div')
        const calls: string[] = []
        function Before(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('discarded layoutEffect') })
            return <div>
                <b ref={(el: any) => { if (el) calls.push('discarded ref') }}>before</b>
                <Portal container={portalEl} content={() => <i>portal</i>}/>
            </div>
        }
        function Broken(): any { throw new Error('render failed') }
        function Fallback(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('fallback layoutEffect') })
            return <i>fallback</i>
        }
        const root = createRoot(rootEl)
        root.on('error', () => {
            root.destroy()
            root.render(<Fallback/>)
        })
        root.render(<div>warm up</div>)
        root.destroy()

        enableAxiiRetainedObjectDiagnostics()
        const before = getAxiiRetainedObjectDiagnosticsSnapshot()
        for (let i = 0; i < 5; i++) {
            root.render(<div><Before/><Broken/></div>)
            expect(rootEl.textContent).toBe('fallback')
            root.destroy()
        }
        const after = getAxiiRetainedObjectDiagnosticsSnapshot()
        expect(after.hosts.createdByType.ComponentHost).toBeGreaterThan(0)
        expect(after.hosts.totalActive).toBe(before.hosts.totalActive)
        expect(after.lightBindings.totalActive).toBe(before.lightBindings.totalActive)
        expect(calls).toEqual(Array(5).fill('fallback layoutEffect'))
        expect(portalEl.textContent).toBe('')
        // 表里只剩用户的 error 监听器：没有任何 attach 回调
        expect(root.dispatch('attach')).toBe(false)
    })

    // 没有 error 钩子时清理函数抛错，树的销毁中途停下：没有走到的 host 来不及退订。
    //  它们等待 attach 的回调不能留到下一次渲染 attach 时执行，也不能随循环累积。
    test('a destroy that throws part way leaves no attach callbacks behind', () => {
        const root = createRoot(rootEl)
        const calls: string[] = []
        function Leaky(_: any, {useEffect, useLayoutEffect}: RenderContext) {
            useEffect(() => () => { throw new Error('cleanup failed') })
            useLayoutEffect(() => { calls.push('leaky layoutEffect') })
            return <b ref={(el: any) => { if (el) calls.push('leaky ref') }}>leaky</b>
        }
        function After(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('after layoutEffect') })
            return <i ref={(el: any) => { if (el) calls.push('after ref') }}>after</i>
        }
        for (let i = 0; i < 3; i++) {
            root.render(<div><Leaky/><After/></div>)
            expect(() => root.destroy()).toThrow('cleanup failed')
        }
        document.body.appendChild(rootEl)
        expect(root.dispatch('attach')).toBe(false)
        expect(calls).toEqual([])

        function Fresh(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { calls.push('fresh layoutEffect') })
            return <p>fresh</p>
        }
        root.destroy()
        rootEl.innerHTML = ''
        root.render(<Fresh/>)
        expect(calls).toEqual(['fresh layoutEffect'])
        root.destroy()
    })
})
