/* @jsx createElement */
/**
 * root 是归属边界：在用户 effect 里调用 root.render() / root.destroy()（按一个 atom 打开 / 关闭
 * 弹层的常见写法）时，里面执行的代码不属于那个 effect。
 *
 *  - 追踪：组件函数体、useEffect 回调与清理、ref 里读的 atom 不是那个 effect 的依赖，
 *    否则之后写它就把整个 root 再渲染或再销毁一次；
 *  - 归属：里面创建的绑定 effect 不是那个 effect 的子 effect，否则它下一次重跑就把绑定销毁，
 *    DOM 还在却不再更新。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    autorun,
    computed,
    createElement,
    createRoot,
    destroyComputed,
    Notifier,
    Portal,
    ReactiveEffect,
    RenderContext,
} from "@framework";

async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}

function expectTrackingRestored() {
    expect(Notifier.instance.shouldTrack).toBe(true)
    expect(Notifier.instance.trackStack.length).toBe(0)
    expect(ReactiveEffect.activeScopes.length).toBe(0)
}

// 调用 root.render() / root.destroy() 的 effect 形态
const callers: Record<string, (body: () => void) => () => void> = {
    'autorun': body => autorun(body, true),
    'scheduled autorun': body => autorun(body),
    'computed': body => {
        const c = computed(() => { body(); return 0 })
        c()
        return () => destroyComputed(c)
    },
}

describe('root.render() and root.destroy() are a boundary for the effect that calls them', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    // 在 root.render() 里执行、会读 atom 的用户代码
    const renderReads: Record<string, (probe: () => void) => any> = {
        'component body': probe => {
            function App() { probe(); return <b>app</b> }
            return <App/>
        },
        'useEffect callback': probe => {
            function App(_: any, {useEffect}: RenderContext) { useEffect(() => { probe() }); return <b>app</b> }
            return <App/>
        },
        'useLayoutEffect callback': probe => {
            function App(_: any, {useLayoutEffect}: RenderContext) { useLayoutEffect(() => { probe() }); return <b>app</b> }
            return <App/>
        },
        'element ref': probe => <b ref={() => { probe() }}>app</b>,
    }
    // 在 root.destroy() 里执行、会读 atom 的用户代码
    const destroyReads: Record<string, (probe: () => void) => any> = {
        'useEffect cleanup': probe => {
            function App(_: any, {useEffect}: RenderContext) { useEffect(() => () => { probe() }); return <b>app</b> }
            return <App/>
        },
        'element ref(null)': probe => <b ref={(el: any) => { if (!el) probe() }}>app</b>,
        'detach listener': probe => {
            root.on('detach', () => { probe() })
            return <b>app</b>
        },
    }

    for (const [callerName, createCaller] of Object.entries(callers)) {
        for (const [readName, createContent] of Object.entries(renderReads)) {
            test(`render: ${readName} is not tracked by ${callerName}`, async () => {
                const open = atom(false)
                const read = atom(0)
                let probes = 0
                let runs = 0
                const content = createContent(() => { probes++; read() })
                const stop = createCaller(() => {
                    runs++
                    if (open() && !root.host) root.render(content)
                })
                open(true)
                await settle()
                expect(probes).toBe(1)
                expect(rootEl.textContent).toBe('app')
                const runsAfterRender = runs

                read(1)
                await settle()
                expect(runs).toBe(runsAfterRender)
                expectTrackingRestored()
                stop()
                root.destroy()
            })
        }

        for (const [readName, createContent] of Object.entries(destroyReads)) {
            test(`destroy: ${readName} is not tracked by ${callerName}`, async () => {
                const open = atom(true)
                const read = atom(0)
                let probes = 0
                let runs = 0
                root.render(createContent(() => { probes++; read() }))
                const stop = createCaller(() => {
                    runs++
                    if (!open() && root.host) root.destroy()
                })
                open(false)
                await settle()
                expect(probes).toBe(1)
                expect(rootEl.textContent).toBe('')
                const runsAfterDestroy = runs

                read(1)
                await settle()
                expect(runs).toBe(runsAfterDestroy)
                expectTrackingRestored()
                stop()
            })
        }

        test(`render: bindings of the content survive the next run of ${callerName}`, async () => {
            const tick = atom(0)
            const color = atom('red')
            const label = atom('a')
            let runs = 0
            const stop = createCaller(() => {
                runs++
                tick()
                if (!root.host) root.render(<p class={() => color()}>{label}</p>)
            })
            await settle()
            tick(1)
            await settle()
            expect(runs).toBe(2)

            // 那个 effect 重跑过了：内容的属性绑定和文本绑定还活着
            color('blue')
            label('b')
            await settle()
            expect(rootEl.querySelector('p')!.className).toBe('blue')
            expect(rootEl.textContent).toBe('b')

            // root.destroy() 才是内容的终点
            root.destroy()
            color('green')
            await settle()
            expect(rootEl.textContent).toBe('')
            stop()
        })

        test(`destroy: an effect created by teardown survives the next run of ${callerName}`, async () => {
            const open = atom(true)
            const tick = atom(0)
            const seen: number[] = []
            let stopCreated: (() => void) | undefined
            function App(_: any, {useEffect}: RenderContext) {
                useEffect(() => () => { stopCreated = autorun(() => { seen.push(tick()) }, true) })
                return <b>app</b>
            }
            root.render(<App/>)
            const again = atom(0)
            const stop = createCaller(() => {
                again()
                if (!open() && root.host) root.destroy()
            })
            open(false)
            await settle()
            expect(seen).toEqual([0])
            again(1)
            await settle()

            tick(1)
            expect(seen).toEqual([0, 1])
            stopCreated!()
            stop()
        })
    }

    test('the reads of the calling effect itself are still tracked, before and after the call', async () => {
        const before = atom(0)
        const after = atom(0)
        let runs = 0
        const stop = autorun(() => {
            runs++
            before()
            if (!root.host) root.render(<b>app</b>)
            after()
        }, true)
        before(1)
        expect(runs).toBe(2)
        after(1)
        expect(runs).toBe(3)
        stop()
        root.destroy()
    })

    test('an effect the caller creates after root.render() is still its child', async () => {
        const dep = atom(0)
        const tick = atom(0)
        let innerRuns = 0
        const stop = autorun(() => {
            dep()
            if (!root.host) root.render(<b>app</b>)
            autorun(() => { tick(); innerRuns++ }, true)
        }, true)
        dep(1)
        // 上一轮创建的 autorun 随重跑销毁，只剩这一轮的
        innerRuns = 0
        tick(1)
        expect(innerRuns).toBe(1)
        stop()
        innerRuns = 0
        tick(2)
        expect(innerRuns).toBe(0)
        root.destroy()
    })

    test('a paused caller stays paused: collection is restored, not forced on', async () => {
        const tick = atom(0)
        let innerRuns = 0
        let stopInner: (() => void) | undefined
        const dep = atom(0)
        const stop = autorun(() => {
            dep()
            ReactiveEffect.createDetached(() => {
                if (!root.host) root.render(<b>app</b>)
                if (!stopInner) stopInner = autorun(() => { tick(); innerRuns++ }, true)
            })
        }, true)
        dep(1)
        innerRuns = 0
        tick(1)
        // createDetached 区间里、root.render() 之后创建的 effect 不是调用方的子 effect
        expect(innerRuns).toBe(1)
        stopInner!()
        stop()
        root.destroy()
    })

    test('a render that throws restores tracking and collection', async () => {
        const dep = atom(0)
        const tick = atom(0)
        let innerRuns = 0
        function Broken(): any { throw new Error('render failed') }
        let caught: unknown
        const stop = autorun(() => {
            dep()
            if (dep() === 1) {
                try { root.render(<Broken/>) } catch (e) { caught = e }
            }
            autorun(() => { tick(); innerRuns++ }, true)
        }, true)
        dep(1)
        expect((caught as Error).message).toBe('render failed')
        expectTrackingRestored()
        dep(2)
        innerRuns = 0
        tick(1)
        expect(innerRuns).toBe(1)
        stop()
    })

    test('Portal content rendered through a root inside a component still goes away with the Portal', async () => {
        const portalEl = document.createElement('div')
        document.body.appendChild(portalEl)
        const show = atom(true)
        const color = atom('red')
        root.render(<div>{() => show() ? <Portal container={portalEl} content={() => <p class={() => color()}>in portal</p>}/> : null}</div>)
        await settle()
        expect(portalEl.querySelector('p')!.className).toBe('red')
        color('blue')
        await settle()
        expect(portalEl.querySelector('p')!.className).toBe('blue')
        show(false)
        await settle()
        expect(portalEl.querySelector('p')).toBe(null)
        expectTrackingRestored()
        root.destroy()
    })
})
