/* @jsx createElement */
/**
 * root 事件监听器不属于派发点所在的 effect。
 *
 * 绑定更新抛错时，FunctionHost/AtomHost/ReactiveAttributeEffect 在自己的 update 里派发 error，
 * 监听器就跑在出错绑定的追踪帧里：监听器读的 atom 会变成该绑定的依赖，监听器创建的 effect
 * 会变成它的子 effect。监听器读错误列表、再异步追加错误列表，就是无限重算。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    Atom,
    autorun,
    configureDiagnostics,
    createElement,
    createRoot,
    Notifier,
    Portal,
    RenderContext,
    RxList,
} from "@framework";

// 函数节点在微任务里重算；重算可能再次触发自己，多等几轮才能看到收敛后的状态
async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}

function expectTrackingRestored() {
    expect(Notifier.instance.shouldTrack).toBe(true)
    expect(Notifier.instance.trackStack.length).toBe(0)
}

type Binding = {
    content: any
    // 让绑定下一次更新抛错 / 恢复
    fail: () => void
    recover: () => void
    // 绑定已经更新的次数
    runs: () => number
    // 失败后每次重算都会再次派发 error
    persistent?: boolean
}

// 每一项是一种「自己的更新帧里派发 error」的绑定
const bindings: Record<string, () => Binding> = {
    'function node source': () => {
        const bad = atom(false)
        let runs = 0
        return {
            content: () => {
                runs++
                if (bad()) throw new Error('binding failed')
                return 'ok'
            },
            fail: () => bad(true),
            recover: () => bad(false),
            runs: () => runs,
            persistent: true,
        }
    },
    // source 之外的错误（DOM 锚点丢失）由 FunctionHost.update 兜底
    'function node anchor': () => {
        const bad = atom(false)
        let runs = 0
        return {
            content: () => {
                runs++
                return bad() ? <i/> : 'ok'
            },
            fail: () => {
                document.querySelector('[data-holder]')!.innerHTML = ''
                bad(true)
            },
            recover: () => bad(false),
            runs: () => runs,
            persistent: true,
        }
    },
    'function node onCleanup': () => {
        const bad = atom(false)
        let runs = 0
        return {
            content: ({onCleanup}: any) => {
                runs++
                const failing = !bad()
                onCleanup(() => {
                    if (failing) throw new Error('binding failed')
                })
                return 'ok'
            },
            fail: () => bad(true),
            recover: () => bad(false),
            runs: () => runs,
        }
    },
    'function node old content': () => {
        const bad = atom(false)
        let runs = 0
        function Child(_: any, {useEffect}: RenderContext) {
            useEffect(() => () => { throw new Error('binding failed') })
            return <b>child</b>
        }
        return {
            content: () => {
                runs++
                return bad() ? <i/> : <Child/>
            },
            fail: () => bad(true),
            recover: () => bad(false),
            runs: () => runs,
        }
    },
    'atom text': () => {
        const value: Atom<any> = atom('ok')
        let runs = 0
        const broken = {
            toString() {
                runs++
                throw new Error('binding failed')
            }
        }
        return {
            content: value,
            fail: () => value(broken),
            recover: () => value('ok'),
            runs: () => runs,
            persistent: true,
        }
    },
    'atom attribute': () => {
        const value: Atom<any> = atom('ok')
        let runs = 0
        const broken = {
            toString() {
                runs++
                throw new Error('binding failed')
            }
        }
        return {
            content: <b data-value={value}/>,
            fail: () => value(broken),
            recover: () => value('ok'),
            runs: () => runs,
            persistent: true,
        }
    },
}

// 函数属性：普通属性、class、style（含数组项）各走 updateAttribute 的不同分支
const attributes: Record<string, (read: () => any) => any> = {
    'attribute function': read => <b title={() => read() || 'ok'}/>,
    'class function': read => <b class={() => read() || 'ok'}/>,
    'style function': read => <b style={() => read() || ({color: 'red'})}/>,
    'style array function': read => <b style={[{margin: 0}, () => read() || ({color: 'red'})]}/>,
}
for (const [name, build] of Object.entries(attributes)) {
    bindings[name] = () => {
        const bad = atom(false)
        let runs = 0
        return {
            content: build(() => {
                runs++
                if (bad()) throw new Error('binding failed')
            }),
            fail: () => bad(true),
            recover: () => bad(false),
            runs: () => runs,
            persistent: true,
        }
    }
}

describe('root error listeners run outside the frame of the failing binding', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        configureDiagnostics({})
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    // 用户代码在 error 派发里执行的几种入口，probe 在里面读 atom
    const listeners: Record<string, (probe: () => void, content: any) => any> = {
        'listener': (probe, content) => {
            root.on('error', probe)
            return <div data-holder>{content}</div>
        },
        'once listener': (probe, content) => {
            root.on('error', probe, {once: true})
            // once 监听器退订后仍要有人消费后续错误，未修复时的额外重算才不会变成 uncaught
            root.on('error', () => {})
            return <div data-holder>{content}</div>
        },
        'listener of the outer root of a portal': (probe, content) => {
            root.on('error', probe)
            const container = document.createElement('div')
            document.body.appendChild(container)
            return <Portal container={container} content={<div data-holder>{content}</div>}/>
        },
        'diagnostics onError of a throwing listener': (probe, content) => {
            configureDiagnostics({onError: probe})
            root.on('error', () => { throw new Error('listener failed') })
            return <div data-holder>{content}</div>
        },
    }

    for (const [name, build] of Object.entries(bindings)) {
        for (const [entry, attach] of Object.entries(listeners)) {
            test(`${name}: what a ${entry} reads is not a dependency`, async () => {
                const read = atom(0)
                let calls = 0
                const binding = build()
                root.render(attach(() => {
                    calls++
                    read()
                }, binding.content))
                await settle()
                expect(calls).toBe(0)

                binding.fail()
                await settle()
                expect(calls).toBe(1)
                const runs = binding.runs()

                read(1)
                await settle()
                expect(binding.runs()).toBe(runs)
                expect(calls).toBe(1)
                expectTrackingRestored()
            })
        }

        // 读错误列表、异步追加错误列表：记录错误的监听器最自然的写法。
        // 未修复时每次追加都会让出错绑定重算并再次出错；到上限后不再追加，用例失败而不是卡死页面。
        if (build().persistent) {
            test(`${name}: a listener that appends to the error list it reads does not loop`, async () => {
                const LIMIT = 20
                const errors = atom<any[]>([])
                let calls = 0
                root.on('error', (e: any) => {
                    calls++
                    if (errors().length < LIMIT) queueMicrotask(() => errors([...errors.raw, e]))
                })
                const binding = build()
                root.render(<div data-holder>{binding.content}</div>)
                await settle()

                binding.fail()
                await settle()
                expect(calls).toBe(1)
                expect(errors.raw.length).toBe(1)
            })
        }

        test(`${name}: bindings created by a listener survive the next update of the binding`, async () => {
            const color = atom('red')
            const rows = new RxList<string>(['x'])
            const toastEl = document.createElement('div')
            document.body.appendChild(toastEl)
            const toast = createRoot(toastEl)
            let shown = false
            root.on('error', () => {
                if (shown) return
                shown = true
                toast.render(<p class={() => color()}>{rows}</p>)
            })
            const binding = build()
            root.render(<div data-holder>{binding.content}</div>)
            await settle()
            binding.fail()
            await settle()
            expect(toastEl.querySelector('p')!.className).toBe('red')

            binding.recover()
            await settle()
            color('blue')
            rows.push('y')
            await settle()
            expect(toastEl.querySelector('p')!.className).toBe('blue')
            expect(toastEl.textContent).toBe('xy')
            toast.destroy()
        })

        test(`${name}: own dependencies still update the binding after an error`, async () => {
            const read = atom(0)
            const errors: any[] = []
            root.on('error', (e: any) => {
                read()
                errors.push(e)
            })
            const binding = build()
            root.render(<div data-holder>{binding.content}</div>)
            await settle()
            binding.fail()
            await settle()
            expect(errors.length).toBe(1)
            const runs = binding.runs()

            binding.recover()
            await settle()
            binding.fail()
            await settle()
            expect(binding.runs()).toBeGreaterThan(runs)
        })
    }

    test('a throwing onCleanup does not stop the function node from tracking its source', async () => {
        const value = atom('a')
        let calls = 0
        root.on('error', () => {
            calls++
            throw new Error('listener failed')
        })
        root.render((({onCleanup}: any) => {
            onCleanup(() => { throw new Error('cleanup failed') })
            return value()
        }) as any)

        value('b')
        await settle()
        expect(calls).toBe(1)
        expect(rootEl.textContent).toBe('b')

        value('c')
        await settle()
        expect(calls).toBe(2)
        expect(rootEl.textContent).toBe('c')
    })

    /**
     * 这些错误派发时追踪本来就处于暂停状态（函数节点的结构重建、RxList 的 patch）。
     * 派发必须恢复到派发前的状态，而不是无条件打开追踪。
     */
    const isolated: Record<string, (read: () => void) => {content: any, fail: () => void}> = {
        'component rendered by a function node': read => {
            const bad = atom(false)
            function Broken(): any { throw new Error('render failed') }
            function Reader() {
                read()
                return <b>reader</b>
            }
            return {
                content: () => bad() ? <p><Broken/><Reader/></p> : 'ok',
                fail: () => bad(true),
            }
        },
        'structure of a function node': () => {
            const bad = atom(false)
            return {
                content: () => bad() ? ({plain: 'object'} as any) : 'ok',
                fail: () => bad(true),
            }
        },
        'RxList row': read => {
            const list = new RxList<any>([])
            function Broken(): any { throw new Error('render failed') }
            function Reader() {
                read()
                return <b>reader</b>
            }
            return {
                content: list,
                fail: () => list.push(<Broken/>, <Reader/>),
            }
        },
    }

    for (const [name, build] of Object.entries(isolated)) {
        test(`error of a ${name} leaves tracking paused for the rest of the rendering`, async () => {
            const read = atom(0)
            const errors: any[] = []
            root.on('error', (e: any) => {
                read()
                errors.push(e)
            })
            const {content, fail} = build(() => { read() })
            root.render(<div>{content}</div>)
            fail()
            await settle()
            expect(errors.length).toBe(1)
            const nodes = Array.from(rootEl.querySelectorAll('*'))

            read(1)
            await settle()
            expect(errors.length).toBe(1)
            expect(Array.from(rootEl.querySelectorAll('*'))).toEqual(nodes)
            expectTrackingRestored()
        })
    }

    // 组件 render 出错时，派发还在该组件的 collect frame 里：监听器创建的 effect 会随失败的 render 立即销毁
    function Broken(): any { throw new Error('render failed') }
    const failingComponents: Record<string, () => any> = {
        'root component': () => <Broken/>,
        'component rendered by a function node': () => <div>{() => <Broken/>}</div>,
        'component in an RxList row': () => <div>{new RxList([<Broken/>])}</div>,
    }
    for (const [name, build] of Object.entries(failingComponents)) {
        test(`bindings created by a listener for the error of a ${name} stay alive`, async () => {
            const color = atom('red')
            const rows = new RxList<string>(['x'])
            const toastEl = document.createElement('div')
            document.body.appendChild(toastEl)
            const toast = createRoot(toastEl)
            root.on('error', () => {
                toast.render(<p class={() => color()}>{rows}</p>)
            })
            root.render(build())
            await settle()

            color('blue')
            rows.push('y')
            await settle()
            expect(toastEl.querySelector('p')!.className).toBe('blue')
            expect(toastEl.textContent).toBe('xy')
            toast.destroy()
        })
    }
})

describe('attach, detach and custom root events are not tracked by the effect that dispatches them', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        configureDiagnostics({})
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        root = createRoot(rootEl)
    })

    // 在 effect 里派发：返回派发次数，写 atom 后看 effect 有没有重跑
    function dispatchInEffect(dispatch: () => void) {
        let runs = 0
        const stop = autorun(() => {
            runs++
            dispatch()
        }, true)
        return {runs: () => runs, stop}
    }

    test('attach listener', () => {
        const read = atom(0)
        let calls = 0
        root.on('attach', () => {
            calls++
            read()
        })
        root.render(<b/>)
        document.body.appendChild(rootEl)
        const effect = dispatchInEffect(() => root.dispatch('attach'))
        expect(calls).toBe(1)

        read(1)
        expect(effect.runs()).toBe(1)
        effect.stop()
        expectTrackingRestored()
    })

    // layoutEffect/ref 有两条补执行的路径：attach 之前渲染的走 attach 监听，
    // attach 之后、连通之前渲染的走 deferred 队列。两条路径语义必须一致。
    const waiting: Record<string, (content: () => any) => Promise<void>> = {
        'registered on attach': async content => {
            root.render(content())
        },
        'queued until attached': async content => {
            const show = atom(false)
            document.body.appendChild(rootEl)
            root.render(<div>{() => show() ? content() : null}</div>)
            rootEl.remove()
            show(true)
            await settle()
        },
    }

    for (const [name, prepare] of Object.entries(waiting)) {
        test(`layout effect and refs ${name}`, async () => {
            const read = atom(0)
            const calls: string[] = []
            const probe = (id: string) => {
                calls.push(id)
                read()
            }
            function Child(_: any, {useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => { probe('layoutEffect') })
                return <b ref={(el: any) => { if (el) probe('elementRef') }}>child</b>
            }
            await prepare(() => <Child ref={(value: any) => { if (value) probe('componentRef') }}/>)
            expect(calls).toEqual([])
            document.body.appendChild(rootEl)
            const effect = dispatchInEffect(() => root.dispatch('attach'))
            expect([...calls].sort()).toEqual(['componentRef', 'elementRef', 'layoutEffect'])

            read(1)
            expect(effect.runs()).toBe(1)
            effect.stop()
            expectTrackingRestored()
        })

        test(`effects created by a layout effect ${name} track their own dependencies`, async () => {
            const value = atom(0)
            const list = new RxList<string>(['x'])
            const seen: number[] = []
            function Child(_: any, {useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => {
                    const stop = autorun(() => { seen.push(value()) }, true)
                    const innerEl = document.createElement('div')
                    rootEl.appendChild(innerEl)
                    const inner = createRoot(innerEl)
                    inner.render(<p title={() => `${value()}`}>{list}</p>)
                    return () => {
                        stop()
                        inner.destroy()
                    }
                })
                return <b>child</b>
            }
            await prepare(() => <Child/>)
            document.body.appendChild(rootEl)
            root.dispatch('attach')
            value(1)
            list.push('y')
            await settle()
            expect(seen).toEqual([0, 1])
            expect(rootEl.querySelector('p')!.title).toBe('1')
            expect(rootEl.querySelector('p')!.textContent).toBe('xy')
        })

        test(`tracking is restored when a layout effect ${name} throws without an error hook`, async () => {
            function Child(_: any, {useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => { throw new Error('layout failed') })
                return <b>child</b>
            }
            const reported: any[] = []
            configureDiagnostics({onError: e => { reported.push(e) }})
            await prepare(() => <Child/>)
            document.body.appendChild(rootEl)
            let thrown: any
            try {
                root.dispatch('attach')
            } catch (e) {
                thrown = e
            }
            // 监听路径的错误收敛到 reportAxiiError，队列路径在批次完成后抛给派发方
            expect((thrown ?? reported[0]).message).toBe('layout failed')
            expectTrackingRestored()

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

    test('attach runs its listeners first and the queue second, with the root already attached', async () => {
        const order: any[] = []
        function Child(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { order.push(['queue', root.attached]) })
            return <b>child</b>
        }
        await waiting['queued until attached'](() => <Child/>)
        root.dispatch('detach')
        root.on('attach', () => { order.push(['listener', root.attached]) })
        document.body.appendChild(rootEl)
        expect(root.dispatch('attach')).toBe(true)
        expect(order).toEqual([['listener', true], ['queue', true]])
        root.dispatch('attach')
        expect(order).toEqual([['listener', true], ['queue', true], ['listener', true]])
    })

    test('layout effects of content mounted by a function node are not its dependencies', async () => {
        const show = atom(false)
        const read = atom(0)
        let runs = 0
        let calls = 0
        function Child(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                calls++
                read()
            })
            return <b>child</b>
        }
        document.body.appendChild(rootEl)
        root.render(<div>{() => {
            runs++
            return show() ? <p><Child/></p> : null
        }}</div>)
        show(true)
        await settle()
        expect(runs).toBe(2)
        expect(calls).toBe(1)

        read(1)
        await settle()
        expect(runs).toBe(2)
        expect(calls).toBe(1)
    })

    // attach 不改变 effect 的归属：Portal 在组件 render 里同步渲染内层 root，内容的 layoutEffect
    // 创建的 effect 由 Portal 组件收集，必须随 Portal 一起销毁
    test('effects created by layout effects of portal content are destroyed with the portal', async () => {
        const show = atom(true)
        const value = atom(0)
        let runs = 0
        function Inner(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                autorun(() => {
                    runs++
                    value()
                }, true)
            })
            return <b>inner</b>
        }
        const container = document.createElement('div')
        document.body.append(rootEl, container)
        root.render(<div>{() => show() ? <Portal container={container} content={<Inner/>}/> : null}</div>)
        await settle()
        value(1)
        expect(runs).toBe(2)

        show(false)
        await settle()
        value(2)
        expect(runs).toBe(2)
    })

    test('detach listener', () => {
        const read = atom(0)
        let calls = 0
        root.on('detach', () => {
            calls++
            read()
        })
        document.body.appendChild(rootEl)
        root.render(<b/>)
        const effect = dispatchInEffect(() => root.destroy())
        expect(calls).toBe(1)

        read(1)
        expect(effect.runs()).toBe(1)
        effect.stop()
    })

    test('custom event: listener reads are not tracked, the dispatching function node keeps its own', async () => {
        const read = atom(0)
        const value = atom('a')
        let runs = 0
        root.on('custom', () => { read() })
        document.body.appendChild(rootEl)
        root.render(<div>{() => {
            runs++
            root.dispatch('custom')
            return value()
        }}</div>)
        expect(runs).toBe(1)

        read(1)
        await settle()
        expect(runs).toBe(1)

        value('b')
        await settle()
        expect(runs).toBe(2)
        expect(rootEl.textContent).toBe('b')
    })
})
