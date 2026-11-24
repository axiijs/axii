/* @jsx createElement */
/* @jsxFrag Fragment */
/**
 * 函数节点重算时，旧内容的销毁不属于函数节点的依赖。
 *
 * 销毁会执行用户代码（effect 清理、onCleanup、ref(null)、detachStyle 求值……）。这些代码
 * 在函数节点的追踪帧里运行时，其中的 atom 读取会变成函数节点的依赖：之后写那个 atom
 * 就把新内容整个重建；新内容挂载时正好写它，就是无限重挂。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    Atom,
    autorun,
    Component,
    createElement,
    createRoot,
    createRxRef,
    Fragment,
    ManualCleanup,
    Notifier,
    Portal,
    ReactiveEffect,
    RenderContext,
    RxList,
} from "@framework";

// 函数节点在微任务里重算；重算可能再次触发自己，多等几轮才能看到收敛后的状态
async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}

describe('teardown of replaced function node content is not tracked', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    class ProbeResource extends ManualCleanup {
        constructor(public probe: () => void) {
            super()
        }
        destroy() {
            super.destroy()
            this.probe()
        }
    }

    // 移除 DOM 会同步执行用户代码：规范保证的 disconnectedCallback，
    // 以及 Chromium 移除聚焦元素时派发的 blur
    class DisconnectProbe extends HTMLElement {
        probe?: () => void
        disconnectedCallback() {
            this.probe?.()
        }
    }
    if (!customElements.get('teardown-probe')) customElements.define('teardown-probe', DisconnectProbe)

    // 每一项是一种「销毁时会执行用户代码」的内容，probe 在销毁里读 atom
    const contents: Record<string, (probe: () => void) => any> = {
        'useEffect cleanup': probe => {
            function Child(_: any, {useEffect}: RenderContext) {
                useEffect(() => probe)
                return <b>child</b>
            }
            return <Child/>
        },
        'useLayoutEffect cleanup': probe => {
            function Child(_: any, {useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => probe)
                return <b>child</b>
            }
            return <Child/>
        },
        'component onCleanup': probe => {
            function Child(_: any, {onCleanup}: RenderContext) {
                onCleanup(probe)
                return <b>child</b>
            }
            return <Child/>
        },
        'component ref(null)': probe => {
            function Child() {
                return <b>child</b>
            }
            return <Child ref={(value: any) => { if (value === null) probe() }}/>
        },
        'element ref(null)': probe => <b ref={(el: any) => { if (el === null) probe() }}>child</b>,
        'collected ManualCleanup': probe => {
            function Child() {
                new ProbeResource(probe)
                return <b>child</b>
            }
            return <Child/>
        },
        'collected autorun onCleanup': probe => {
            function Child() {
                autorun(({onCleanup}: any) => { onCleanup(probe) }, true)
                return <b>child</b>
            }
            return <Child/>
        },
        'function detachStyle': probe => <b detachStyle={() => { probe(); return null }}>child</b>,
        'disconnectedCallback of removed DOM': probe => {
            const el = createElement('teardown-probe', {}, 'child') as unknown as DisconnectProbe
            el.probe = probe
            return el
        },
        'fragment child': probe => <><i/><b ref={(el: any) => { if (el === null) probe() }}>child</b></>,
        'array child': probe => [<i/>, <b ref={(el: any) => { if (el === null) probe() }}>child</b>],
        'RxList row': probe => new RxList([<b ref={(el: any) => { if (el === null) probe() }}>child</b>]),
        'nested function node onCleanup': probe => ({onCleanup}: any) => { onCleanup(probe); return 'child' },
        'portal content': probe => {
            const container = document.createElement('div')
            document.body.appendChild(container)
            function Inner(_: any, {useEffect}: RenderContext) {
                useEffect(() => probe)
                return <b>child</b>
            }
            return <Portal container={container} content={<Inner/>}/>
        },
    }

    for (const [name, content] of Object.entries(contents)) {
        for (const next of ['structure', 'text'] as const) {
            test(`${name}: replaced by ${next}`, async () => {
                const replaced = atom(false)
                const read = atom(0)
                let teardowns = 0
                let runs = 0
                const probe = () => {
                    teardowns++
                    read()
                }
                root.render((() => {
                    runs++
                    if (!replaced()) return content(probe)
                    return next === 'text' ? 'next' : <p>next</p>
                }) as any)
                await settle()
                expect(runs).toBe(1)
                expect(teardowns).toBe(0)

                replaced(true)
                await settle()
                expect(runs).toBe(2)
                expect(teardowns).toBeGreaterThan(0)
                // 有 detachStyle 的旧内容要等离场动画，此刻仍在 DOM 里
                expect(rootEl.textContent).toContain('next')

                const node = rootEl.querySelector('p')
                read(1)
                await settle()
                expect(runs).toBe(2)
                expect(rootEl.querySelector('p')).toBe(node)
            })
        }
    }

    test('onCleanup of the function node itself is not tracked', async () => {
        const value = atom('a')
        const read = atom(0)
        let cleanups = 0
        let runs = 0
        root.render((({onCleanup}: any) => {
            runs++
            onCleanup(() => {
                cleanups++
                read()
            })
            return value()
        }) as any)

        value('b')
        await settle()
        expect(runs).toBe(2)
        expect(cleanups).toBe(1)
        expect(rootEl.textContent).toBe('b')

        read(1)
        await settle()
        expect(runs).toBe(2)
    })

    // 「挂载写、销毁读同一个 atom」。写发生在函数节点自己的作用域之外才会触发它重算
    // （data0 不触发栈顶 effect），所以覆盖三种自然写法。mounts 到上限后不再写，
    // 未修复时用例失败而不是卡死页面。
    const MOUNT_LIMIT = 20
    const claims: Record<string, (claim: () => void, context: RenderContext) => any> = {
        'in an autorun': claim => {
            autorun(() => { claim() }, true)
        },
        'after an async step': (claim, {useEffect}) => {
            useEffect(() => { queueMicrotask(claim) })
        },
        'in a nested function node': claim => () => {
            claim()
            return null
        },
    }

    for (const [name, mountClaim] of Object.entries(claims)) {
        test(`content that claims an atom ${name} and releases it on destroy is not remounted forever`, async () => {
            const active: Atom<number|null> = atom(null)
            const version = atom(0)
            let mounts = 0
            function Session(_: any, context: RenderContext) {
                const id = ++mounts
                const node = mountClaim(() => { if (id < MOUNT_LIMIT) active(id) }, context)
                context.useEffect(() => () => {
                    if (active() === id) active(null)
                })
                return <b>session {id}{node}</b>
            }
            root.render((() => <Session version={version()}/>) as any)
            await settle()
            expect(mounts).toBe(1)
            expect(active()).toBe(1)

            version(1)
            await settle()
            expect(mounts).toBe(2)
            expect(active()).toBe(2)
            expect(rootEl.textContent).toBe('session 2')
        })
    }

    test('content that reads its reactive ref on destroy is not remounted when the ref moves', async () => {
        const version = atom(0)
        const strong = atom(true)
        const ref = createRxRef()
        let mounts = 0
        let seen: any
        function Child(_: any, {useEffect}: RenderContext) {
            mounts++
            useEffect(() => () => {
                if (mounts < MOUNT_LIMIT) seen = ref.current
            })
            return <div>{() => strong() ? <b ref={ref}>child</b> : <i ref={ref}>child</i>}</div>
        }
        root.render((() => <Child version={version()}/>) as any)
        await settle()
        const first = rootEl.querySelector('b')
        expect(ref.current).toBe(first)

        version(1)
        await settle()
        expect(mounts).toBe(2)
        expect(seen).toBe(first)

        strong(false)
        await settle()
        expect(mounts).toBe(2)
        expect(ref.current).toBe(rootEl.querySelector('i'))
    })

    test('a dependency also read during teardown still re-runs the function node exactly once per change', async () => {
        const value = atom('a')
        let runs = 0
        function Child(_: any, {useEffect}: RenderContext) {
            useEffect(() => () => { value() })
            return <b>{value()}</b>
        }
        root.render((() => {
            runs++
            return <Child key={value()}/>
        }) as any)

        value('b')
        await settle()
        expect(runs).toBe(2)
        expect(rootEl.textContent).toBe('b')

        value('c')
        await settle()
        expect(runs).toBe(3)
        expect(rootEl.textContent).toBe('c')
    })

    // 销毁代码的两个入口：函数节点自己的 onCleanup，和旧内容里的组件清理
    const teardowns: Record<string, (onTeardown: () => void, version: Atom<number>) => any> = {
        'function node onCleanup': (onTeardown, version) => ({onCleanup}: any) => {
            onCleanup(onTeardown)
            return version()
        },
        'component cleanup': (onTeardown, version) => {
            function Child(_: any, {useEffect}: RenderContext) {
                useEffect(() => onTeardown)
                return <b>child</b>
            }
            return () => <Child version={version()}/>
        },
    }

    for (const [name, build] of Object.entries(teardowns)) {
        test(`bindings created in ${name} are not destroyed by the next re-run`, async () => {
            const version = atom(0)
            const color = atom('red')
            const rows = new RxList<string>(['x'])
            const exitEl = document.createElement('div')
            document.body.appendChild(exitEl)
            const exitRoot = createRoot(exitEl)
            let left = false
            root.render(build(() => {
                if (left) return
                left = true
                exitRoot.render(<p class={() => color()}>{rows}</p>)
            }, version))

            version(1)
            await settle()
            expect(exitEl.querySelector('p')!.className).toBe('red')

            version(2)
            await settle()
            color('blue')
            rows.push('y')
            await settle()
            expect(exitEl.querySelector('p')!.className).toBe('blue')
            expect(exitEl.textContent).toBe('xy')
            exitRoot.destroy()
        })

        test(`tracking state is restored when ${name} throws without an error hook`, async () => {
            const version = atom(0)
            const uncaught: any[] = []
            const onError = (e: ErrorEvent) => { uncaught.push(e.error); e.preventDefault() }
            window.addEventListener('error', onError)
            try {
                root.render(build(() => { throw new Error('teardown failed') }, version))
                version(1)
                await settle()
                await new Promise(resolve => setTimeout(resolve, 10))
            } finally {
                window.removeEventListener('error', onError)
            }
            expect(uncaught.map(e => e.message)).toEqual(['teardown failed'])
            expect(Notifier.instance.shouldTrack).toBe(true)
            expect(Notifier.instance.trackStack.length).toBe(0)

            const value = atom('a')
            const otherEl = document.createElement('div')
            document.body.appendChild(otherEl)
            const other = createRoot(otherEl)
            other.render((() => value()) as any)
            value('b')
            await settle()
            expect(otherEl.textContent).toBe('b')
            other.destroy()
        })
    }

    test('a throwing onCleanup does not stop the function node from tracking its own dependencies', async () => {
        const value = atom('a')
        const errors: any[] = []
        root.on('error', (e: any) => errors.push(e))
        let shouldThrow = true
        root.render((({onCleanup}: any) => {
            onCleanup(() => {
                if (shouldThrow) throw new Error('cleanup failed')
            })
            return value()
        }) as any)

        value('b')
        await settle()
        expect(errors.length).toBe(1)
        expect(rootEl.textContent).toBe('b')

        shouldThrow = false
        value('c')
        await settle()
        expect(rootEl.textContent).toBe('c')
    })

    // 归属：销毁里创建的 effect 不是函数节点的子 effect，否则节点下一次重算就把它销毁。
    // 两个入口分别对应 destroyInnerHost（旧内容的 useEffect 清理）和 runCleanups（节点自己的 onCleanup）。
    for (const entry of ['useEffect cleanup of the old content', 'onCleanup of the function node'] as const) {
        test(`an effect created by teardown is not owned by the function node (${entry})`, async () => {
            const version = atom(0)
            const tick = atom(0)
            const seen: number[] = []
            let stopCreated: (() => void) | undefined
            const create = () => { if (!stopCreated) stopCreated = autorun(() => { seen.push(tick()) }, true) }
            function Child(_: any, {useEffect}: RenderContext) {
                if (entry === 'useEffect cleanup of the old content') useEffect(() => () => { create() })
                return <b>child</b>
            }
            root.render(<div>{(context: any) => {
                if (entry === 'onCleanup of the function node') context.onCleanup(() => { create() })
                return <Child version={version()}/>
            }}</div>)
            version(1)
            await settle()
            expect(seen).toEqual([0])

            // 节点再重算一次：上一次销毁里创建的 effect 还活着
            version(2)
            await settle()
            tick(1)
            expect(seen).toEqual([0, 1])
            stopCreated!()
        })
    }

    // 重入销毁：本节点在「收集已暂停」的区间里被销毁。销毁结束后收集必须还原成暂停，
    // 而不是无条件打开，否则销毁之后创建的 effect 会被这个正在销毁的节点收集、随它一起销毁。
    test('an error listener that destroys the root while new content renders still owns what it creates', async () => {
        const noticeEl = document.createElement('div')
        document.body.appendChild(noticeEl)
        const notice = createRoot(noticeEl)
        const failing = atom(false)
        const color = atom('red')
        root.on('error', () => {
            root.destroy()
            notice.render(<p class={() => color()}>failed</p>)
        })
        function Failing(_: any, {useEffect}: RenderContext) {
            useEffect(() => { throw new Error('effect failed') })
            return <b>failing</b>
        }
        // 新内容在暂停收集的区间里渲染，Failing 的 effect 抛错时监听器销毁整个 root
        root.render(<div>{({onCleanup}: any) => {
            onCleanup(() => {})
            return failing() ? <Failing/> : <i>ok</i>
        }}</div>)
        failing(true)
        await settle()
        expect(noticeEl.querySelector('p')!.className).toBe('red')

        color('blue')
        await settle()
        expect(noticeEl.querySelector('p')!.className).toBe('blue')
        notice.destroy()
    })

    for (const entry of ['runCleanups', 'destroyInnerHost'] as const) {
        test(`re-entrant destroy inside createDetached restores paused collection (${entry})`, async () => {
            const noticeEl = document.createElement('div')
            document.body.appendChild(noticeEl)
            const notice = createRoot(noticeEl)
            const leave = atom(false)
            const color = atom('red')
            root.render(<div>{(context: any) => {
                if (entry === 'runCleanups') context.onCleanup(() => {})
                if (leave()) {
                    ReactiveEffect.createDetached(() => {
                        // 销毁本节点：runCleanups / destroyInnerHost（旧的 <i>）在 createDetached 区间里执行
                        root.destroy()
                        notice.render(<p class={() => color()}>left</p>)
                    })
                }
                return <i>content</i>
            }}</div>)
            leave(true)
            await settle()
            expect(noticeEl.querySelector('p')!.className).toBe('red')

            color('blue')
            await settle()
            expect(noticeEl.querySelector('p')!.className).toBe('blue')
            notice.destroy()
        })
    }
})

/**
 * 对照项：列表的行销毁本来就不被追踪（data0 的 computation/applyPatch 都在暂停追踪下运行），
 * 这里把它固化成契约，防止 data0 升级或重构时退化。
 */
describe('teardown of RxList rows is not tracked', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    const patches: Record<string, (list: RxList<any>) => void> = {
        splice: list => list.splice(0, 1),
        set: list => list.set(0, 'replaced'),
        clear: list => list.clear(),
    }

    for (const [name, patch] of Object.entries(patches)) {
        test(`${name} does not subscribe the list to what a removed row reads`, async () => {
            const read = atom(0)
            let teardowns = 0
            let renders = 0
            const Row: Component = ({id}: any, {useEffect}: RenderContext) => {
                renders++
                useEffect(() => () => {
                    teardowns++
                    read()
                })
                return <b>{id}</b>
            }
            const list = new RxList<any>(['a', 'b'])
            root.render(<div>{list.map((id: any) => <Row id={id}/>)}</div>)
            expect(renders).toBe(2)

            patch(list)
            await settle()
            expect(teardowns).toBeGreaterThan(0)
            const html = rootEl.innerHTML
            const rendersAfterPatch = renders

            read(1)
            await settle()
            expect(renders).toBe(rendersAfterPatch)
            expect(rootEl.innerHTML).toBe(html)
        })
    }

    test('recovery re-run of the list does not subscribe it to what the previous rows read', async () => {
        const read = atom(0)
        let teardowns = 0
        let renders = 0
        let broken = false
        const Row: Component = ({id}: any, {useEffect}: RenderContext) => {
            if (id === 'bad' && broken) throw new Error('row failed')
            renders++
            useEffect(() => () => {
                teardowns++
                read()
            })
            return <b>{id}</b>
        }
        const list = new RxList<any>(['a'])
        root.render(<div>{list.map((id: any) => <Row id={id}/>)}</div>)
        broken = true
        // 没有错误钩子：patch 抛错后 data0 回退到全量重算阶段，下一次变更重跑 computation
        expect(() => list.push('bad')).toThrow('row failed')
        broken = false
        list.push('c')
        await settle()
        expect(teardowns).toBeGreaterThan(0)
        const html = rootEl.innerHTML
        const rendersAfterRecovery = renders

        read(1)
        await settle()
        expect(renders).toBe(rendersAfterRecovery)
        expect(rootEl.innerHTML).toBe(html)
    })
})
