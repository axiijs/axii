/* @jsx createElement */
/* @jsxFrag Fragment */
/**
 * Audit of the host layer (ComponentHost / RxListHost / FunctionHost / render / Portal / lazy).
 * Every test in this file FAILS on v4.8.1 + the pending teardown/root-boundary PR.
 * F1..F8 are the reported findings, most severe first.
 */
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {
    atom,
    autorun,
    bindProps,
    computed,
    configureDiagnostics,
    createElement,
    createRef,
    createRoot,
    Form,
    FormContext,
    Fragment,
    lazy,
    Portal,
    RenderContext,
    RxDOMSize,
    RxList,
    RxMap,
} from "@framework";

async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('audit: hosts', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    // ------------------------------------------------------------------------------------------
    // F1  root.destroy() called by an error listener while root.render() is still on the stack
    // ------------------------------------------------------------------------------------------
    describe('F1: root.destroy() from an error listener during the initial render', () => {
        test('F1a: destroy + render a fallback into the same root leaves only the fallback', () => {
            function Bad(): any { throw new Error('bad') }
            function App() { return <div id="app"><Bad/></div> }
            let handled = false
            root.on('error', () => {
                if (handled) return
                handled = true
                root.destroy()
                root.render(<p id="fallback">something went wrong</p>)
            })
            root.render(<App/>)
            expect(rootEl.querySelector('#fallback')).not.toBe(null)
            expect(rootEl.querySelector('#app')).toBe(null)
        })

        test('F1b: after the listener destroyed the root, the container is empty', () => {
            function Bad(): any { throw new Error('bad') }
            function App() { return <div id="app"><span>good</span><Bad/></div> }
            root.on('error', () => { root.destroy() })
            root.render(<App/>)
            expect(root.host).toBe(undefined)
            expect(rootEl.innerHTML).toBe('')
        })

        test('F1c: an effect that runs after the destroy gets its cleanup', () => {
            const log: string[] = []
            function Bad(): any { throw new Error('bad') }
            function App(_: any, {useEffect}: RenderContext) {
                useEffect(() => { log.push('effect'); return () => log.push('cleanup') })
                return <div><Bad/></div>
            }
            root.on('error', () => { root.destroy() })
            root.render(<App/>)
            // either the effect never ran, or it was cleaned up
            expect(log.filter(l => l === 'cleanup').length).toBe(log.filter(l => l === 'effect').length)
        })
    })

    // ------------------------------------------------------------------------------------------
    // F2  framework bindings are captured by the collect frame of an unrelated component
    // ------------------------------------------------------------------------------------------
    describe('F2: bindings created while a component body runs are destroyed with that component', () => {
        test('F2a: a row pushed from a component body keeps its attribute binding', async () => {
            const cls = atom('x')
            const list = new RxList<any>([<li className={() => cls()}>a</li>])
            const show = atom(true)
            function Adder() {
                list.push(<li className={() => cls()}>b</li>)
                return <span>adder</span>
            }
            root.render(<div>
                <ul>{list}</ul>
                {() => show() ? <Adder/> : null}
            </div>)
            const classes = () => Array.from(rootEl.querySelectorAll('li')).map(li => li.className)
            expect(classes()).toEqual(['x', 'x'])
            show(false)
            await settle()
            expect(rootEl.querySelectorAll('li').length).toBe(2)
            cls('z')
            expect(classes()).toEqual(['z', 'z'])
        })

        test('F2b: a row holding a nested list, pushed from a component body, keeps rendering that list', async () => {
            const inner = new RxList<any>([<b>i1</b>])
            const list = new RxList<any>([])
            const show = atom(true)
            function Adder() {
                // no derived data is created here: both lists are plain source lists
                list.push(<li>{inner}</li>)
                return <span>adder</span>
            }
            root.render(<div>
                <ul>{list}</ul>
                {() => show() ? <Adder/> : null}
            </div>)
            expect(rootEl.querySelector('ul')!.textContent).toBe('i1')
            show(false)
            await settle()
            inner.push(<b>i2</b>)
            expect(rootEl.querySelector('ul')!.textContent).toBe('i1i2')
        })

        test('F2c: a root rendered from a component body (lazy singleton) outlives that component', async () => {
            const toastEl = document.createElement('div')
            document.body.appendChild(toastEl)
            const toasts = new RxList<string>([])
            // derived data lives outside any component, so no computed is created in a component body
            const toastRows = toasts.map(t => <li>{t}</li>)
            const theme = atom('light')
            let toastRoot: ReturnType<typeof createRoot> | undefined
            function showToast(message: string) {
                if (!toastRoot) {
                    toastRoot = createRoot(toastEl)
                    toastRoot.render(<ul className={() => theme()}>{toastRows}{() => `(${theme()})`}</ul>)
                }
                toasts.push(message)
            }
            const show = atom(true)
            function Page() {
                showToast('welcome')
                return <span>page</span>
            }
            root.render(<div>{() => show() ? <Page/> : null}</div>)
            expect(toastEl.textContent).toBe('welcome(light)')
            show(false)
            await settle()
            // toastRoot.destroy() was never called and its DOM is still there
            expect(toastEl.querySelector('ul')).not.toBe(null)
            showToast('second')
            theme('dark')
            await settle()
            const ul = toastEl.querySelector('ul')!
            expect([ul.textContent, ul.className]).toEqual(['welcomesecond(dark)', 'dark'])
        })

        test('F2d: Portal destroyOnUnmount=false keeps the content alive, not half of it', async () => {
            const portalEl = document.createElement('div')
            document.body.appendChild(portalEl)
            const show = atom(true)
            const color = atom('red')
            const text = atom('t1')
            root.render(<div>{() => show() ?
                <Portal destroyOnUnmount={false} container={portalEl} content={<p className={() => color()}>{() => text()}</p>}/> :
                null}</div>)
            show(false)
            await settle()
            const p = portalEl.querySelector('p')!
            expect(p).not.toBe(null)
            color('blue')
            text('t2')
            await settle()
            expect([p.className, p.textContent]).toEqual(['blue', 't2'])
        })
    })

    // ------------------------------------------------------------------------------------------
    // F3  FunctionHost destroyed while its new content is rendering
    // ------------------------------------------------------------------------------------------
    describe('F3: a function node destroyed while its new content renders', () => {
        test('F3a: content that removes its own list row in its mount effect is still destroyed', async () => {
            const list = new RxList<number>([1])
            const open = atom(false)
            const cleanup = vi.fn()
            const tick = atom(0)
            let seen = -1
            function Closer({onClose}: {onClose: () => void}, {useEffect}: RenderContext) {
                useEffect(() => {
                    onClose()
                    return cleanup
                })
                return <b>{() => { seen = tick(); return 'closing' }}</b>
            }
            root.render(<ul>{list.map(() => <li>{() => open() ? <Closer onClose={() => list.splice(0, 1)}/> : 'row'}</li>)}</ul>)
            open(true)
            await settle()
            expect(rootEl.querySelectorAll('li').length).toBe(0)
            // the bindings of the removed content must be gone
            tick(1)
            await settle()
            expect(seen).toBe(0)
            expect(cleanup).toHaveBeenCalledTimes(1)
        })

        test('F3b: an error listener that destroys the root: siblings rendered before the failure are destroyed', async () => {
            const cleanup = vi.fn()
            const bad = atom(false)
            function Good(_: any, {useEffect}: RenderContext) {
                useEffect(() => cleanup)
                return <span>good</span>
            }
            function Bad(): any { throw new Error('bad') }
            root.on('error', () => { root.destroy() })
            root.render(<div>{() => bad() ? <div><Good/><Bad/></div> : <i>ok</i>}</div>)
            bad(true)
            await settle()
            expect(rootEl.innerHTML).toBe('')
            expect(cleanup).toHaveBeenCalledTimes(1)
        })
    })

    // ------------------------------------------------------------------------------------------
    // F4  splice whose new row throws: the removed rows are never destroyed
    // ------------------------------------------------------------------------------------------
    test('F4: a splice whose new row throws (no error hook) does not leave the removed rows behind', () => {
        const list = new RxList<number>([1, 2])
        let throwFor: number | null = null
        const cleaned: number[] = []
        const Row = ({item}: {item: number}, {onCleanup}: RenderContext) => {
            if (item === throwFor) throw new Error('row render boom')
            onCleanup(() => cleaned.push(item))
            return <span>{item}</span>
        }
        root.render(<div>{list.map(item => <Row item={item}/>)}</div>)
        expect(rootEl.textContent).toBe('12')
        throwFor = 3
        expect(() => list.splice(0, 1, 3)).toThrow('row render boom')
        throwFor = null
        // data0 falls back to a full recompute on the next change (data0RecoveryRerun.spec)
        list.push(4)
        expect(list.data).toEqual([3, 2, 4])
        expect(rootEl.textContent).toBe('324')
        expect(cleaned).toContain(1)
    })

    // ------------------------------------------------------------------------------------------
    // F5  rows removed by splice / clear: cleanups run after the DOM is gone (I39)
    // ------------------------------------------------------------------------------------------
    test('F5: onCleanup of a list row sees connected DOM whichever way the row is removed (I39)', () => {
        const list = new RxList<string>(['set', 'splice', 'clear'])
        const connectedAtCleanup: Record<string, boolean | undefined> = {}
        function Row({item}: {item: string}, {createRef, onCleanup}: RenderContext) {
            const ref = createRef()
            onCleanup(() => { connectedAtCleanup[item] = ref.current?.isConnected })
            return <li ref={ref}>{item}</li>
        }
        root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
        list.set(0, 'other')
        list.splice(1, 1)
        list.clear()
        expect(connectedAtCleanup).toEqual({set: true, splice: true, other: true, clear: true})
    })

    test('F5b: onCleanup of a component inside an array child sees connected DOM (I39)', async () => {
        const connectedAtCleanup: Record<string, boolean | undefined> = {}
        function Item({name}: {name: string}, {createRef, onCleanup}: RenderContext) {
            const ref = createRef()
            onCleanup(() => { connectedAtCleanup[name] = ref.current?.isConnected })
            return <b ref={ref}>{name}</b>
        }
        const show = atom(true)
        const list = new RxList<any>([[<Item name="row"/>, ' ', false]])
        root.render(<div>
            {() => show() ? [false, <Item name="toggled"/>, 'text'] : null}
            <p>{list}</p>
        </div>)
        show(false)
        await settle()
        list.set(0, 'gone')
        expect(rootEl.textContent).toBe('gone')
        expect(connectedAtCleanup).toEqual({toggled: true, row: true})
    })

    // ------------------------------------------------------------------------------------------
    // F6  bulk removal wipes a row that is still playing its exit animation
    // ------------------------------------------------------------------------------------------
    test('F6: a row that is still leaving is not wiped when the remaining rows are removed', async () => {
        const list = new RxList<string>(['stay', 'leave'])
        root.render(<ul>{list.map(item => item === 'leave' ?
            <li id="leave" style={{opacity: 1, transition: 'opacity 1s'}} detachStyle={{opacity: 0}}>leave</li> :
            <li id="stay">stay</li>)}</ul>)
        await sleep(30)
        list.splice(1, 1)
        await sleep(30)
        // control: the exit transition is in flight, the row is still there
        expect(document.getElementById('leave')).not.toBe(null)
        list.splice(0, 1)
        expect(document.getElementById('stay')).toBe(null)
        expect(document.getElementById('leave')).not.toBe(null)
        await sleep(1300)
        expect(document.getElementById('leave')).toBe(null)
    })

    // ------------------------------------------------------------------------------------------
    // F7  lazy() wrapper is not transparent
    // ------------------------------------------------------------------------------------------
    describe('F7: lazy()', () => {
        test('F7a: the ref is not called with the handle of the wrapper before the component is loaded', async () => {
            let resolveLoad: (c: any) => void
            const Lazy = lazy((() => new Promise(r => { resolveLoad = r })) as any)
            const handles: any[] = []
            root.render(<div><Lazy ref={(handle: any) => handles.push(handle)}/></div>)
            await settle()
            const beforeLoad = handles.slice()
            resolveLoad!(function Input(_: any, {expose}: RenderContext) {
                expose({focus() {}})
                return <input/>
            })
            await settle()
            expect(typeof handles[handles.length - 1]?.focus).toBe('function')
            // `ref={h => h?.focus()}` must not see a handle without focus()
            expect(beforeLoad.filter(handle => handle && typeof handle.focus !== 'function')).toEqual([])
        })

        test('F7b: $name:prop configuration reaches the loaded component', async () => {
            function Loaded(_: any, {createElement}: RenderContext) {
                return <div as="main" data-x="orig">loaded</div>
            }
            function Direct(_: any, {createElement}: RenderContext) {
                return <Loaded $main:data-x="over"/>
            }
            const Lazy = lazy(() => Promise.resolve(Loaded))
            function ViaLazy(_: any, {createElement}: RenderContext) {
                return <Lazy $main:data-x="over"/>
            }
            root.render(<div><section id="direct"><Direct/></section><section id="lazy"><ViaLazy/></section></div>)
            await sleep(10)
            const value = (id: string) => (rootEl.querySelector(`#${id} [data-as="main"]`) as HTMLElement).dataset.x
            expect(value('direct')).toBe('over')   // control
            expect(value('lazy')).toBe('over')
        })
    })

    describe('F7 (more): lazy() behaves like the loaded component', () => {
        const loaded = async () => { await settle(); await sleep(10) }

        test('F7c: the ref gets the loaded handle once and null once on unmount', async () => {
            function Loaded(_: any, {expose}: RenderContext) {
                expose({focus() {}})
                return <input/>
            }
            const Lazy = lazy(() => Promise.resolve(Loaded))
            const handles: any[] = []
            const show = atom(true)
            root.render(<div>{() => show() ? <Lazy ref={(handle: any) => handles.push(handle)}/> : null}</div>)
            await loaded()
            expect(handles.map(h => h && typeof h.focus)).toEqual(['function'])
            show(false)
            await settle()
            expect(handles.map(h => h && typeof h.focus)).toEqual(['function', null])
        })

        test('F7d: a lazy component used as a named child: the parent refs and $name config reach the loaded component', async () => {
            function Loaded({title}: any, {createElement, expose}: RenderContext) {
                expose({kind: 'loaded'})
                return <p as="main" title={title}>loaded</p>
            }
            const Lazy = lazy(() => Promise.resolve(Loaded))
            let parentRefs: any
            function Parent(_: any, {createElement, refs}: RenderContext) {
                parentRefs = refs
                return <section><Lazy as="item" title="from parent"/></section>
            }
            function App(_: any, {createElement}: RenderContext) {
                // `$item:$main:data-x` (nested configuration) is not a valid JSX attribute name
                return <Parent {...{'$item:title': 'from app', '$item:$main:data-x': 'nested'}}/>
            }
            root.render(<App/>)
            await loaded()
            const p = rootEl.querySelector('p')!
            expect([p.title, p.dataset.x]).toEqual(['from app', 'nested'])
            expect(parentRefs.item?.kind).toBe('loaded')
        })

        test('F7e: bindProps(lazy) merges the bound props and is still transparent', async () => {
            const clicks: string[] = []
            function Loaded({title, onClick}: any, {createElement, expose}: RenderContext) {
                expose({kind: 'loaded'})
                return <button as="main" title={title} onClick={onClick}>loaded</button>
            }
            const Lazy = lazy(() => Promise.resolve(Loaded))
            const Bound = bindProps(Lazy, {title: 'bound', onClick: () => clicks.push('bound')})
            const handles: any[] = []
            function App(_: any, {createElement}: RenderContext) {
                return <div>
                    <Bound ref={(h: any) => handles.push(h)} onClick={() => clicks.push('input')} $main:data-x="over"/>
                    <Bound title="input"/>
                </div>
            }
            root.render(<App/>)
            await loaded()
            const [first, second] = Array.from(rootEl.querySelectorAll('button'))
            expect([first.title, first.dataset.x, second.title]).toEqual(['bound', 'over', 'input'])
            first.click()
            // same merge as for any bound component: the input handler runs before the bound one
            expect(clicks).toEqual(['input', 'bound'])
            expect(handles.map(h => h?.kind)).toEqual(['loaded'])
        })

        test('F7f: the fallback and a load error still work, the ref is never attached without a component', async () => {
            let reject!: (e: Error) => void
            const Lazy = lazy((() => new Promise((_, r) => { reject = r })) as any, (error?: unknown) => <i>{error ? 'failed' : 'loading'}</i>)
            const handles: any[] = []
            root.render(<div><Lazy ref={(h: any) => handles.push(h)}/></div>)
            expect(rootEl.textContent).toBe('loading')
            reject(new Error('offline'))
            await loaded()
            expect(rootEl.textContent).toBe('failed')
            root.destroy()
            expect(handles).toEqual([])
        })
    })

    // ------------------------------------------------------------------------------------------
    // F8  one splice carrying ~10^5 rows overflows the stack
    // ------------------------------------------------------------------------------------------
    test('F8: one splice that inserts 200 000 rows', () => {
        const list = new RxList<any>([])
        root.render(<div>{list}</div>)
        const items = Array.from({length: 200000}, () => document.createElement('i'))
        let error: any
        try {
            list.spliceArray(0, 0, items)
        } catch (e: any) {
            error = e
        }
        expect(String(error)).toBe('undefined')
        expect(rootEl.querySelectorAll('i').length).toBe(200000)
    })

    // ------------------------------------------------------------------------------------------
    // S   splice-replace: the removed rows are torn down before the new rows attach (same as set)
    //     S1 = ax-dom F2, S2 = ax-attrs X1, S3 = ax-attrs F3b (copied from the other reviewers)
    // ------------------------------------------------------------------------------------------
    describe('S: list.splice(i, 1, next) tears the old row down before the new row attaches', () => {
        test('S1: ref of a row replaced with RxList.splice(i, 1, next) must end up on the mounted element', async () => {
            const els: Record<string, HTMLElement | null> = {}
            const list = new RxList<{id: string, text: string}>([{id: 'a', text: 'A'}, {id: 'b', text: 'B'}])
            root.render(<ul>{list.map(item => <li ref={(el: any) => { els[item.id] = el }}>{item.text}</li>)}</ul>)
            expect(els.a?.textContent).toBe('A')
            // immutable update of row "a"
            list.splice(0, 1, {id: 'a', text: 'A2'})
            await settle()
            expect(rootEl.textContent).toBe('A2B')
            // the <li> of "a" is in the document, its ref must point at it
            expect(els.a).toBe(rootEl.querySelector('li'))
        })

        test('S2: a ref shared by the rows of a list points at the new row after splice-replace', async () => {
            const list = new RxList<number>([1])
            const ref = createRef()
            let size!: RxDOMSize
            function App({}, {createElement}: RenderContext) {
                size = new RxDOMSize()
                return <div>{list.map(item => <p ref={[size.ref, ref]} style={{width: 20, height: 20}}>{item}</p>)}</div>
            }
            root.render(<App/>)
            list.splice(0, 1, 2)
            await settle()
            expect(rootEl.querySelectorAll('p').length).toBe(1)
            expect(ref.current).toBe(rootEl.querySelector('p'))
            expect(size.value()).not.toBeNull()
        })

        test('S3: replacing a list row that holds a field keeps the field registered', async () => {
            // A form field written against the public FormContext contract
            function Field({name, value}: any, {context, onCleanup, createElement}: RenderContext) {
                const form = context.get(FormContext)
                const instance = {value, reset() {}, clear() {}}
                form.register(name, instance)
                onCleanup(() => form.unregister(name, instance))
                return <input/>
            }
            const values = new RxMap<string, any>({})
            const before = atom('A')
            const after = atom('B')
            const rows = new RxList<any>([{value: before}])
            root.render(
                <Form name="f" values={values}>
                    <div>{rows.map((row: any) => <Field name="x" value={row.value}/>)}</div>
                </Form>
            )
            expect(values.get('x')).toBe(before)
            rows.splice(0, 1, {value: after})
            await settle()
            expect(rootEl.querySelectorAll('input').length).toBe(1)
            expect(values.get('x')).toBe(after)
        })

        test('S4: one order for every way of replacing a row: old cleanup (DOM connected), then new mount', () => {
            const log: string[] = []
            const list = new RxList<string>(['a', 'b', 'c'])
            function Row({item}: {item: string}, {createRef, onCleanup, useLayoutEffect}: RenderContext) {
                const ref = createRef()
                onCleanup(() => log.push(`cleanup ${item} connected=${ref.current?.isConnected}`))
                useLayoutEffect(() => { log.push(`layout ${item} rows=${rootEl.querySelectorAll('li').length}`) })
                return <li ref={ref}>{item}</li>
            }
            root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
            log.length = 0
            list.set(0, 'A')
            list.splice(1, 1, 'B')
            list.splice(2, 1, 'C', 'D')
            expect(rootEl.textContent).toBe('ABCD')
            expect(log).toEqual([
                'cleanup a connected=true', 'layout A rows=3',
                'cleanup b connected=true', 'layout B rows=3',
                'cleanup c connected=true', 'layout C rows=4', 'layout D rows=4',
            ])
        })
    })

    // ------------------------------------------------------------------------------------------
    // F2 invariant, kind by kind
    // ------------------------------------------------------------------------------------------
    describe('F2 invariant: a binding the framework creates for a host is owned by the host tree', () => {
        // the bindings of each content are created while the body of an unrelated component (Opener) runs
        const kinds: Record<string, (v: () => string) => {content: any, read: (el: HTMLElement) => string | null}> = {
            'attribute bound to a function': v => ({content: <p className={() => v()}>x</p>, read: el => el.querySelector('p')!.className}),
            'attribute bound to an atom': () => {
                const a = atom('v0'); atoms.push(a)
                return {content: <p title={a}>x</p>, read: el => el.querySelector('p')!.title}
            },
            'reactive style': v => ({content: <p style={() => ({fontFamily: v()})}>x</p>, read: el => el.querySelector('p')!.style.fontFamily}),
            'atom text': () => {
                const a = atom('v0'); atoms.push(a)
                return {content: <p>{a}</p>, read: el => el.querySelector('p')!.textContent}
            },
            'function text': v => ({content: <p>{() => v()}</p>, read: el => el.querySelector('p')!.textContent}),
            'function structure': v => ({content: <p>{() => <b>{v()}</b>}</p>, read: el => el.querySelector('p b')!.textContent}),
            'list': () => {
                const rows = new RxList<any>(['v0']); lists.push(rows)
                return {content: <p>{rows}</p>, read: el => el.querySelector('p')!.textContent}
            },
            'component with reactive root attribute': v => {
                function Inner() { return <p data-v={() => v()}>x</p> }
                return {content: <Inner/>, read: el => el.querySelector('p')!.getAttribute('data-v')}
            },
        }
        let atoms: any[] = []
        let lists: RxList<any>[] = []
        beforeEach(() => { atoms = []; lists = [] })

        for (const via of ['a second root rendered in a component body', 'a row pushed to a rendered list in a component body'] as const) {
            for (const kind of Object.keys(kinds)) {
                test(`${kind}, created by ${via}`, async () => {
                    const v = atom('v0')
                    const otherEl = document.createElement('div')
                    document.body.appendChild(otherEl)
                    const other = createRoot(otherEl)
                    const outerList = new RxList<any>([])
                    other.render(<section>{outerList}</section>)
                    const second = createRoot(document.body.appendChild(document.createElement('div')))
                    // the JSX (plain DOM + source data) is made out here; only the bindings are created
                    // while Opener's body runs, by second.render() / outerList.push()
                    const made = kinds[kind](() => v())
                    const read = made.read
                    function Opener() {
                        if (via === 'a second root rendered in a component body') second.render(<div>{made.content}</div>)
                        else outerList.push(<div>{made.content}</div>)
                        return <span>opener</span>
                    }
                    const show = atom(true)
                    root.render(<div>{() => show() ? <Opener/> : null}</div>)
                    const target = via === 'a second root rendered in a component body' ? second.element : otherEl
                    expect(read(target)).toBe('v0')
                    show(false)
                    await settle()
                    v('v1')
                    atoms.forEach(a => a('v1'))
                    lists.forEach(l => l.set(0, 'v1'))
                    await settle()
                    expect(read(target)).toBe('v1')
                    second.destroy()
                    other.destroy()
                })
            }
        }

        test('control: what the user creates in a component body is still owned by that component', async () => {
            const source = atom(1)
            const items = new RxList<number>([1])
            let doubled!: () => number
            let mapped!: RxList<number>
            let runs = 0
            function Owner() {
                doubled = computed(() => { runs++; return source() * 2 })
                mapped = items.map(i => i * 10)
                return <span>{doubled}</span>
            }
            const show = atom(true)
            root.render(<div>{() => show() ? <Owner/> : null}</div>)
            source(2)
            items.push(2)
            expect([doubled(), mapped.data]).toEqual([4, [10, 20]])
            const runsBefore = runs
            show(false)
            await settle()
            source(3)
            items.push(3)
            // both were destroyed with Owner: no recompute, no patch
            expect(runs).toBe(runsBefore)
            expect(mapped.data).toEqual([10, 20])
        })
    })

    // ------------------------------------------------------------------------------------------
    // R   destroyed while its own render / patch is on the stack: torn down exactly once
    // ------------------------------------------------------------------------------------------
    describe('R: a host destroyed while its own render is on the stack', () => {
        const balanced = (log: string[], names: string[]) => {
            for (const name of names) {
                const effects = log.filter(l => l === `effect ${name}`).length
                const cleanups = log.filter(l => l === `cleanup ${name}`).length
                expect([name, cleanups]).toEqual([name, effects])
                expect(effects).toBeLessThanOrEqual(1)
            }
        }

        test('R1: list patch: rows rendered after an error listener destroyed the root are destroyed, each once', () => {
            const log: string[] = []
            const list = new RxList<string>(['first'])
            function Row({item}: {item: string}, {useEffect}: RenderContext) {
                if (item === 'bad') throw new Error('bad row')
                useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                return <li>{item}</li>
            }
            root.on('error', () => { root.destroy() })
            root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
            list.push('before', 'bad', 'after')
            expect(rootEl.innerHTML).toBe('')
            balanced(log, ['first', 'before', 'after'])
        })

        test('R2: list patch: a row component whose child fails does not run its effect after the destroy without a cleanup', () => {
            const log: string[] = []
            const list = new RxList<string>([])
            function Bad(): any { throw new Error('bad child') }
            function Row({item}: {item: string}, {useEffect}: RenderContext) {
                useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                return <li>{item === 'bad' ? <Bad/> : item}</li>
            }
            root.on('error', () => { root.destroy() })
            root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
            list.push('bad', 'after')
            expect(rootEl.innerHTML).toBe('')
            balanced(log, ['bad', 'after'])
        })

        test('R3: list set(): the new row is destroyed once when the root is destroyed while it renders', () => {
            const log: string[] = []
            const list = new RxList<string>(['a', 'b'])
            function Bad(): any { throw new Error('bad child') }
            function Row({item}: {item: string}, {useEffect}: RenderContext) {
                useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                return <li>{item === 'bad' ? <Bad/> : item}</li>
            }
            root.on('error', () => { root.destroy() })
            root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
            list.set(0, 'bad')
            expect(rootEl.innerHTML).toBe('')
            balanced(log, ['a', 'b', 'bad'])
        })

        test('R3b: the list is the root content (it removes its own DOM): push and set while a row destroys the root', () => {
            for (const op of ['push', 'set'] as const) {
                const log: string[] = []
                const list = new RxList<string>(['a', 'b'])
                function Bad(): any { throw new Error('bad child') }
                function Row({item}: {item: string}, {useEffect}: RenderContext) {
                    useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                    return <li>{item === 'bad' ? <Bad/> : item}</li>
                }
                const el = document.body.appendChild(document.createElement('div'))
                const r = createRoot(el)
                r.on('error', () => { r.destroy() })
                r.render(list.map(item => <Row item={item}/>))
                expect(el.textContent).toBe('ab')
                if (op === 'push') list.push('before', 'bad', 'after')
                else list.set(1, 'bad')
                expect([op, el.innerHTML]).toEqual([op, ''])
                balanced(log, ['a', 'b', 'before', 'bad', 'after'])
            }
        })

        test('R3c: the cleanup of a replaced row removes the group that holds the list: the new row is not rendered into it', () => {
            for (const op of ['splice', 'set'] as const) {
                const log: string[] = []
                type Group = {name: string, items: RxList<string>}
                const groups = new RxList<Group>([{name: 'g', items: new RxList<string>(['a', 'b'])}])
                function Item({group, item}: {group: Group, item: string}, {useEffect, onCleanup}: RenderContext) {
                    useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                    // "a" was the reason the group exists: when it goes, the group goes
                    if (item === 'a') onCleanup(() => { groups.splice(groups.data.indexOf(group), 1) })
                    return <li>{item}</li>
                }
                const el = document.body.appendChild(document.createElement('div'))
                const r = createRoot(el)
                r.render(<div>{groups.map(group => <ul>{group.items.map(item => <Item group={group} item={item}/>)}</ul>)}</div>)
                expect(el.textContent).toBe('ab')
                const items = groups.data[0].items
                if (op === 'splice') items.splice(0, 1, 'next')
                else items.set(0, 'next')
                expect([op, el.querySelectorAll('ul').length, el.textContent]).toEqual([op, 0, ''])
                balanced(log, ['a', 'b', 'next'])
                r.destroy()
            }
        })

        test('R3d: the cleanup of a replaced row destroys the root: the new row is not rendered into the destroyed list', () => {
            // the list inside an element (the parent removes the DOM) and as the root content (the list does)
            for (const where of ['in an element', 'as root content'] as const) {
                for (const op of ['splice', 'set', 'clear'] as const) {
                    const log: string[] = []
                    const list = new RxList<string>(['b', 'a', 'c'])
                    const el = document.body.appendChild(document.createElement('div'))
                    const r = createRoot(el)
                    let closed = false
                    function Item({item}: {item: string}, {useEffect, onCleanup}: RenderContext) {
                        useEffect(() => { log.push(`effect ${item}`); return () => log.push(`cleanup ${item}`) })
                        // "close the dialog when this row goes away"
                        if (item === 'a') onCleanup(() => { if (!closed) { closed = true; r.destroy() } })
                        return <li>{item}</li>
                    }
                    const rows = list.map(item => <Item item={item}/>)
                    r.render(where === 'in an element' ? <ul>{rows}</ul> : rows)
                    let thrown: any
                    try {
                        if (op === 'splice') list.splice(1, 1, 'next')
                        else if (op === 'set') list.set(1, 'next')
                        else list.clear()
                    } catch (e) {
                        thrown = e
                    }
                    expect([where, op, String(thrown), el.innerHTML]).toEqual([where, op, 'undefined', ''])
                    expect([where, op, log.filter(l => l === 'cleanup a').length]).toEqual([where, op, 1])
                    balanced(log, ['a', 'b', 'c', 'next'])
                }
            }
        })

        test('R4: initial render: a second failure after the listener destroyed the root; torn down once, nothing attached', () => {
            const log: string[] = []
            function Good(_: any, {useEffect}: RenderContext) {
                useEffect(() => { log.push('effect good'); return () => log.push('cleanup good') })
                return <span>good</span>
            }
            function Bad({name}: {name: string}): any { throw new Error(name) }
            const seen: string[] = []
            root.on('error', (e: any) => { seen.push(e.message); root.destroy() })
            let thrown: any
            try {
                root.render(<div><Good/><Bad name="first"/><Bad name="second"/></div>)
            } catch (e) {
                thrown = e
            }
            expect(rootEl.innerHTML).toBe('')
            expect(root.host).toBe(undefined)
            balanced(log, ['good'])
            expect(seen).toEqual(['first'])
            // the tree was already destroyed by the listener: its later errors have no owner
            expect(thrown).toBe(undefined)
        })

        test('R5: function node: a second failure after the listener destroyed the root is not an uncaught error', async () => {
            const log: string[] = []
            const bad = atom(false)
            function Good(_: any, {useEffect}: RenderContext) {
                useEffect(() => { log.push('effect good'); return () => log.push('cleanup good') })
                return <span>good</span>
            }
            function Bad({name}: {name: string}): any { throw new Error(name) }
            const uncaught: string[] = []
            const onError = (e: ErrorEvent) => { uncaught.push(e.message); e.preventDefault() }
            window.addEventListener('error', onError)
            root.on('error', () => { root.destroy() })
            root.render(<div>{() => bad() ? <div><Good/><Bad name="first"/><Bad name="second"/></div> : <i>ok</i>}</div>)
            bad(true)
            await settle()
            await sleep(0)
            window.removeEventListener('error', onError)
            expect(rootEl.innerHTML).toBe('')
            balanced(log, ['good'])
            expect(uncaught).toEqual([])
        })

        test('R6: function node: its own function destroys the root, nothing is rendered into the removed region', async () => {
            const leave = atom(false)
            const uncaught: string[] = []
            const onError = (e: ErrorEvent) => { uncaught.push(e.message); e.preventDefault() }
            window.addEventListener('error', onError)
            root.render(() => leave() ? (root.destroy(), 'gone') : <i>here</i>)
            leave(true)
            await settle()
            await sleep(0)
            window.removeEventListener('error', onError)
            expect(uncaught).toEqual([])
            expect(rootEl.innerHTML).toBe('')
        })

        test('R7: nested: fallback rendered by the listener stays, effects of the aborted tree are balanced', () => {
            const log: string[] = []
            function Bad(): any { throw new Error('bad') }
            function App(_: any, {useEffect, useLayoutEffect}: RenderContext) {
                useEffect(() => { log.push('effect app'); return () => log.push('cleanup app') })
                useLayoutEffect(() => { log.push('layout app') })
                return <div id="app"><Bad/></div>
            }
            function Fallback(_: any, {useLayoutEffect}: RenderContext) {
                useLayoutEffect(() => { log.push('layout fallback') })
                return <p id="fallback">sorry</p>
            }
            let handled = false
            root.on('error', () => {
                if (handled) return
                handled = true
                root.destroy()
                root.render(<Fallback/>)
            })
            root.render(<App/>)
            expect(rootEl.innerHTML).toBe('<p id="fallback">sorry</p><!--root-->')
            balanced(log, ['app'])
            expect(log.filter(l => l.startsWith('layout'))).toEqual(['layout fallback'])
            root.destroy()
            expect(rootEl.innerHTML).toBe('')
        })
    })

    // ------------------------------------------------------------------------------------------
    // More branches of the row teardown
    // ------------------------------------------------------------------------------------------
    test('F6b: a leaving row in the middle of the removed range is not wiped', async () => {
        const list = new RxList<string>(['a', 'leave', 'b', 'c'])
        root.render(<ul>{list.map(item => item === 'leave' ?
            <li id="leave" style={{opacity: 1, transition: 'opacity 1s'}} detachStyle={{opacity: 0}}>leave</li> :
            <li>{item}</li>)}</ul>)
        await sleep(30)
        list.splice(1, 1)
        await sleep(30)
        expect(document.getElementById('leave')).not.toBe(null)
        list.splice(0, 2)
        expect(rootEl.textContent).toBe('leavec')
        await sleep(1300)
        expect(rootEl.textContent).toBe('c')
        // the bulk paths work again once the leaving row is gone
        list.push('d', 'e')
        list.splice(0, 2)
        expect(rootEl.textContent).toBe('e')
        list.clear()
        expect(rootEl.querySelector('ul')!.innerHTML).toBe('<!--unhandledChild-->')
    })

    test('F8b: big splices keep the rows in order (insert in the middle, replace, remove)', () => {
        const list = new RxList<any>([<b>head</b>, <b>tail</b>])
        root.render(<div>{list}</div>)
        const make = (n: number, tag: string) => Array.from({length: n}, () => document.createElement(tag))
        const container = rootEl.firstElementChild!
        list.spliceArray(1, 0, make(150000, 'i'))
        expect(container.children.length).toBe(150002)
        expect([container.firstElementChild!.textContent, container.lastElementChild!.textContent]).toEqual(['head', 'tail'])
        list.spliceArray(1, 150000, make(130000, 'u'))
        expect([container.querySelectorAll('i').length, container.querySelectorAll('u').length]).toEqual([0, 130000])
        expect([container.children[0].textContent, container.children[130001].textContent]).toEqual(['head', 'tail'])
        list.spliceArray(1, 130000, [])
        expect(container.textContent).toBe('headtail')
    })

    // ------------------------------------------------------------------------------------------
    // N   Comment / Text nodes as content (the public JSXElement type allows Comment)
    // ------------------------------------------------------------------------------------------
    describe('N: a Comment or Text node returned as content', () => {
        test('N1: a component returns a Comment node, and it goes away with the component', async () => {
            const errors: unknown[] = []
            root.on('error', e => errors.push(e))
            const show = atom(true)
            function Marker() { return document.createComment('marker') }
            root.render(<div>{() => show() ? <Marker/> : null}</div>)
            expect(errors).toEqual([])
            expect(rootEl.innerHTML).toContain('<!--marker-->')
            show(false)
            await settle()
            expect(rootEl.innerHTML).not.toContain('<!--marker-->')
        })

        test('N2: a function node returns a Text node, then an element, then a Text node again', async () => {
            const errors: unknown[] = []
            root.on('error', e => errors.push(e))
            const step = atom(0)
            root.render(<div>{() => step() === 1 ? <b>element</b> : document.createTextNode(`text${step()}`)}</div>)
            expect(errors).toEqual([])
            expect(rootEl.textContent).toBe('text0')
            step(1)
            await settle()
            expect(rootEl.textContent).toBe('element')
            step(2)
            await settle()
            expect(rootEl.textContent).toBe('text2')
            root.destroy()
            expect(rootEl.innerHTML).toBe('')
        })

        test('N3: Text and Comment nodes as list rows follow splice, reorder and removal', () => {
            const text = (t: string) => document.createTextNode(t)
            const list = new RxList<any>([text('a'), document.createComment('c'), text('b')])
            root.render(<div>{list}</div>)
            expect(rootEl.textContent).toBe('ab')
            list.swap(0, 2)
            expect(rootEl.textContent).toBe('ba')
            list.splice(1, 1, text('-'))
            expect(rootEl.textContent).toBe('b-a')
            list.set(0, document.createComment('gone'))
            expect(rootEl.textContent).toBe('-a')
            list.clear()
            expect(rootEl.firstElementChild!.innerHTML).toBe('<!--unhandledChild-->')
        })
    })

    // ------------------------------------------------------------------------------------------
    // P1  reorder cost depends on the rows that move, not on the distance between them
    // ------------------------------------------------------------------------------------------
    describe('P1: handleReorder', () => {
        afterEach(() => configureDiagnostics({}))

        test('P1: swapping two distant rows costs the same at 2 000, 20 000 and 200 000 rows', () => {
            // production path: the dev-only list invariant check is O(rows) by design
            configureDiagnostics({enabled: false})
            const measure = (n: number, a: number, b: number) => {
                const list = new RxList<any>(Array.from({length: n}, () => document.createElement('i')))
                const r = createRoot(rootEl)
                r.render(<div>{list}</div>)
                const rounds = 200
                for (let i = 0; i < 10; i++) list.swap(a, b)
                const start = performance.now()
                for (let i = 0; i < rounds; i++) list.swap(a, b)
                const ms = (performance.now() - start) / rounds
                r.destroy()
                return ms
            }
            const far: Record<number, number> = {}
            const near: Record<number, number> = {}
            for (const n of [2000, 20000, 200000]) {
                far[n] = measure(n, 0, n - 1)
                near[n] = measure(n, 0, 1)
            }
            console.log('P1 ms per swap(0, n-1):', JSON.stringify(far), ' ms per swap(0, 1):', JSON.stringify(near))
            expect(far[200000]).toBeLessThan(Math.max(far[2000], 0.01) * 20)
        })

        test('P1b: sparse and dense reorders of rows of every shape end in list order', () => {
            // 700 rows: a reorder that moves k rows is "sparse" when k * 64 <= affected range
            function RowComponent({text}: any) { return <b>{text}</b> }
            const makeRow = (i: number) => {
                const t = `${i},`
                switch (i % 6) {
                    case 0: return <i>{t}</i>
                    case 1: return () => t
                    case 2: return <RowComponent text={t}/>
                    case 3: return <><u>{t}</u><s/></>
                    case 4: return [t, <em/>]
                    default: return t
                }
            }
            const ids = Array.from({length: 700}, (_, i) => i)
            const list = new RxList<any>(ids.map(makeRow))
            const mirror = ids.slice()
            root.render(<div>{list}</div>)
            const check = (what: string) => {
                if (rootEl.textContent !== mirror.map(i => `${i},`).join('')) throw new Error(`DOM order differs from list order after ${what}`)
            }
            const swap = (a: number, b: number) => {
                list.swap(a, b)
                const t = mirror[a]; mirror[a] = mirror[b]; mirror[b] = t
                check(`swap(${a}, ${b})`)
            }
            // far swaps (sparse path), near swaps (dense path), ends and neighbours of earlier moves
            swap(0, 699); swap(1, 698); swap(0, 698); swap(350, 351); swap(0, 1); swap(699, 0); swap(200, 600); swap(201, 600)
            // random sparse cycles of 2..5 rows through the public reorder()
            let seed = 12345
            const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
            for (let round = 0; round < 300; round++) {
                const positions = new Set<number>()
                const size = 2 + random(4)
                // every third round keeps the rows close together, so the dense path is covered too
                const base = round % 3 === 0 ? random(600) : 0
                const span = round % 3 === 0 ? 40 : 700
                while (positions.size < size) positions.add(base + random(span))
                const cycle = Array.from(positions)
                const pairs = cycle.map((from, i) => [from, cycle[(i + 1) % cycle.length]] as [number, number])
                const old = mirror.slice()
                for (const [from, to] of pairs) mirror[to] = old[from]
                list.reorder(pairs)
                check(`reorder(${JSON.stringify(pairs)}) in round ${round}`)
            }
            // dense: move a block across most of the list, then sort
            list.reposition(2, 650, 3); mirror.splice(650, 0, ...mirror.splice(2, 3)); check('reposition forward')
            list.reposition(690, 0, 4); mirror.splice(0, 0, ...mirror.splice(690, 4)); check('reposition backward')
            const idOf = new Map<any, number>(); list.data.forEach((row: any, i: number) => idOf.set(row, mirror[i]))
            list.sortSelf((x: any, y: any) => idOf.get(x)! - idOf.get(y)!); mirror.sort((x, y) => x - y); check('sort')
            // removal still finds every row where the list says it is
            list.splice(1, 698)
            expect(rootEl.textContent).toBe('0,699,')
        })
    })
})

// ------------------------------------------------------------------------------------------
// Follow-up review of the host commit: bulk removal now runs the row cleanups BEFORE the DOM goes,
//  so the cleanups can change the parent the bulk path was planned for.
// ------------------------------------------------------------------------------------------
describe('audit follow-up: bulk row removal and what the row cleanups did to the parent', () => {
    let el: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        el = document.body.appendChild(document.createElement('div'))
    })

    for (const op of ['clear', 'splice all', 'splice all with a new row'] as const) {
        test(`B1: the list is the root content, a row cleanup closes the root and renders a fallback into the same container (${op})`, () => {
            const r = createRoot(el)
            const list = new RxList<string>(['a', 'b'])
            let closed = false
            function Item({item}: {item: string}, {onCleanup}: RenderContext) {
                if (item === 'a') onCleanup(() => {
                    if (closed) return
                    closed = true
                    r.destroy()
                    r.render(<p id="fallback">empty</p>)
                })
                return <li>{item}</li>
            }
            r.render(list.map(item => <Item item={item}/>) as any)
            expect(el.textContent).toBe('ab')
            if (op === 'clear') list.clear()
            else if (op === 'splice all') list.splice(0, 2)
            else list.splice(0, 2, 'x')
            expect(el.querySelector('#fallback')?.textContent).toBe('empty')
            expect(el.textContent).toBe('empty')
            r.destroy()
            expect(el.innerHTML).toBe('')
        })
    }

    test('B2: a node a row cleanup appends to the parent survives clear()', () => {
        const r = createRoot(el)
        const list = new RxList<string>(['a', 'b'])
        function Item({item}: {item: string}, {onCleanup}: RenderContext) {
            if (item === 'a') onCleanup(() => { el.querySelector('ul')!.appendChild(document.createElement('hr')) })
            return <li>{item}</li>
        }
        r.render(<ul>{list.map(item => <Item item={item}/>)}</ul>)
        list.clear()
        expect(el.querySelector('ul')!.innerHTML).toBe('<!--unhandledChild--><hr>')
        list.push('c')
        expect(el.querySelector('ul')!.textContent).toBe('c')
        r.destroy()
    })

    test('B2b: a node a row cleanup inserts before the first removed row survives a partial removal', () => {
        const r = createRoot(el)
        const list = new RxList<string>(['keep', 'a', 'b'])
        function Item({item}: {item: string}, {onCleanup, createRef}: RenderContext) {
            const ref = createRef()
            if (item === 'a') onCleanup(() => { ref.current.before(document.createElement('hr')) })
            return <li ref={ref}>{item}</li>
        }
        r.render(<ul>{list.map(item => <Item item={item}/>)}</ul>)
        list.splice(1, 2)
        expect(Array.from(el.querySelector('ul')!.children).map(c => c.tagName)).toEqual(['LI', 'HR'])
        r.destroy()
    })

    test('B3: guard: clearing a list that is the only content of its parent still takes the replaceChildren path', () => {
        const r = createRoot(el)
        const list = new RxList<number>(Array.from({length: 50}, (_, i) => i))
        function Item({item}: {item: number}, {onCleanup}: RenderContext) {
            onCleanup(() => {})
            return <li>{item}</li>
        }
        r.render(<ul>{list.map(item => <Item item={item}/>)}</ul>)
        const original = Element.prototype.replaceChildren
        let calls = 0
        Element.prototype.replaceChildren = function (this: Element, ...nodes: any[]) {
            calls++
            return original.apply(this, nodes)
        }
        try {
            list.clear()
        } finally {
            Element.prototype.replaceChildren = original
        }
        expect(calls).toBe(1)
        expect(el.querySelector('ul')!.innerHTML).toBe('<!--unhandledChild-->')
        r.destroy()
    })
})

describe('audit follow-up: rows that are still leaving are not retained by the list', () => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    function renderLeaving(el: HTMLElement) {
        const r = createRoot(el)
        const list = new RxList<string>(['stay', 'leave'])
        r.render(<ul>{list.map(item => item === 'leave' ?
            <li id="leave" style={{opacity: 1, transition: 'opacity 0.1s'}} detachStyle={{opacity: 0}}>leave</li> :
            <li id="stay">stay</li>)}</ul>)
        const listHost = (r.host as any).reactiveHosts
        expect(Array.isArray(listHost.hosts)).toBe(true)
        return {r, list, listHost}
    }
    beforeEach(() => { document.body.innerHTML = '' })

    test('L1: the leaving row is released once its exit animation has removed it', async () => {
        const el = document.body.appendChild(document.createElement('div'))
        const {r, list, listHost} = renderLeaving(el)
        await sleep(30)
        const leave = document.getElementById('leave')!
        list.splice(1, 1)
        await sleep(30)
        // control: still playing, and the list knows (bulk removal must not wipe it)
        expect(leave.isConnected).toBe(true)
        expect(listHost.leavingNodes).toContain(leave)
        await sleep(500)
        expect(leave.isConnected).toBe(false)
        expect(listHost.leavingNodes).toBe(undefined)
        expect(listHost.leavingObserver).toBe(undefined)
        r.destroy()
    })

    test('L2: destroying the list releases the leaving rows', async () => {
        const el = document.body.appendChild(document.createElement('div'))
        const {r, list, listHost} = renderLeaving(el)
        await sleep(30)
        list.splice(1, 1)
        r.destroy()
        expect(listHost.leavingNodes).toBe(undefined)
        expect(listHost.leavingObserver).toBe(undefined)
    })
})

describe('audit follow-up: removing many options from a controlled select replays its value once, not per row', () => {
    async function settleAll() {
        for (let i = 0; i < 100; i++) await Promise.resolve()
    }
    // counts writes to select.value (what the stored-value replay does for a single select)
    function countSelectValueWrites<T>(run: () => T): {result: T, writes: () => number} {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!
        let writes = 0
        Object.defineProperty(HTMLSelectElement.prototype, 'value', {
            ...descriptor,
            set(this: HTMLSelectElement, value: string) {
                writes++
                descriptor.set!.call(this, value)
            },
        })
        const restore = () => Object.defineProperty(HTMLSelectElement.prototype, 'value', descriptor)
        try {
            const result = run()
            if (result instanceof Promise) {
                return {result: result.finally(restore) as any, writes: () => writes}
            }
            restore()
            return {result, writes: () => writes}
        } catch (e) {
            restore()
            throw e
        }
    }
    beforeEach(() => { document.body.innerHTML = '' })

    function Opt({v}: {v: number}) { return <option value={String(v)}>{v}</option> }
    const rowKinds = {
        'element rows': (o: number) => <option value={String(o)}>{o}</option>,
        'component rows': (o: number) => <Opt v={o}/>,
        'function rows': (o: number) => () => <option value={String(o)}>{o}</option>,
    }
    for (const [kind, makeRow] of Object.entries(rowKinds)) {
        test(`O1: tearing down a list of 400 options (${kind}) inside a controlled select`, async () => {
            const el = document.body.appendChild(document.createElement('div'))
            const r = createRoot(el)
            const show = atom(true)
            const opts = new RxList<number>(Array.from({length: 400}, (_, i) => i))
            r.render(<select value="none">{() => show() ? opts.map(makeRow as any) : null}</select>)
            const select = el.querySelector('select')!
            expect(select.options.length).toBe(400)
            const {result, writes} = countSelectValueWrites(async () => {
                show(false)
                await settleAll()
            })
            await result
            expect(select.options.length).toBe(0)
            // one replay per bulk removal, not one per row (was 400)
            expect(writes()).toBeLessThanOrEqual(2)
            r.destroy()
        })
    }

    test('O2: a patch that removes many rows one by one (a row is still leaving, so no bulk removal)', async () => {
        const el = document.body.appendChild(document.createElement('div'))
        const r = createRoot(el)
        const opts = new RxList<any>(['leave', ...Array.from({length: 200}, (_, i) => i)])
        r.render(<select value="none">{opts.map(o => o === 'leave' ?
            <option value="leave" style={{opacity: 1, transition: 'opacity 1s'}} detachStyle={{opacity: 0}}>leave</option> :
            <option value={String(o)}>{o}</option>)}</select>)
        const select = el.querySelector('select')!
        opts.splice(0, 1)
        // control: the leaving option is still there, so the next removal goes row by row
        expect(select.options.length).toBe(201)
        const {writes} = countSelectValueWrites(() => opts.splice(0, 200))
        expect(select.options.length).toBe(1)
        expect(writes()).toBeLessThanOrEqual(3)
        r.destroy()
    })

    test('O3: guard: tearing down every option (the selected one included) still replays the stored value', async () => {
        const el = document.body.appendChild(document.createElement('div'))
        const r = createRoot(el)
        const show = atom(true)
        const opts = new RxList<string>(['x', 'y'])
        r.render(<select id="s" value="x"><option value="a">a</option>{() => show() ? opts.map(o => <option value={o}>{o}</option>) : null}</select>)
        const s = el.querySelector('select')!
        expect(s.value).toBe('x')
        show(false)
        await settleAll()
        // same as a fresh render of the end state: the stored "x" matches nothing -> no selection
        expect(s.selectedIndex).toBe(-1)
        r.destroy()
    })
})

describe('audit follow-up: a function node destroyed while its OLD content is torn down', () => {
    async function settleAll() {
        for (let i = 0; i < 100; i++) await Promise.resolve()
    }
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    async function catchUncaught(run: () => Promise<void>) {
        const uncaught: string[] = []
        const onError = (e: ErrorEvent) => { uncaught.push(String(e.error ?? e.message)); e.preventDefault() }
        const onRejection = (e: PromiseRejectionEvent) => { uncaught.push(String(e.reason)); e.preventDefault() }
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)
        try {
            await run()
            await sleep(10)
        } finally {
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onRejection)
        }
        return uncaught
    }
    beforeEach(() => { document.body.innerHTML = '' })

    for (const next of ['text', 'element'] as const) {
        for (const where of ['the root content', 'inside an element'] as const) {
            test(`D1: the old content's cleanup closes the root (next content: ${next}, function node is ${where})`, async () => {
                const el = document.body.appendChild(document.createElement('div'))
                const r = createRoot(el)
                const show = atom(true)
                const log: string[] = []
                function Dialog(_: any, {onCleanup, useEffect}: RenderContext) {
                    useEffect(() => { log.push('effect dialog'); return () => log.push('cleanup dialog') })
                    onCleanup(() => r.destroy())
                    return <b>dialog</b>
                }
                function Closed(_: any, {useEffect}: RenderContext) {
                    useEffect(() => { log.push('effect closed'); return () => log.push('cleanup closed') })
                    return <i>closed</i>
                }
                const fn = () => show() ? <Dialog/> : (next === 'text' ? 'closed' : <Closed/>)
                r.render(where === 'the root content' ? fn : <div>{fn}</div>)
                expect(el.textContent).toBe('dialog')
                const uncaught = await catchUncaught(async () => {
                    show(false)
                    await settleAll()
                })
                expect(uncaught).toEqual([])
                expect(el.innerHTML).toBe('')
                // nothing was mounted for the destroyed node
                expect(log).toEqual(['effect dialog', 'cleanup dialog'])
            })
        }
    }

    test('D2: the previous run registered an onCleanup that closes the root: the function is not called again', async () => {
        const el = document.body.appendChild(document.createElement('div'))
        const r = createRoot(el)
        const count = atom(0)
        const calls: number[] = []
        r.render(({onCleanup}: any) => {
            const value = count()
            calls.push(value)
            onCleanup(() => { if (value === 1) r.destroy() })
            return String(value)
        })
        count(1)
        await settleAll()
        expect(el.textContent).toBe('1')
        count(2)
        await settleAll()
        expect(el.innerHTML).toBe('')
        expect(calls).toEqual([0, 1])
    })
})

describe('audit follow-up: a row cleanup that destroys the list destroys every row exactly once', () => {
    beforeEach(() => { document.body.innerHTML = '' })

    test('E1: rebuild after an unhandled patch error: a previous row cleanup closes the root', () => {
        const list = new RxList<string>(['a', 'b', 'c'])
        const log: string[] = []
        let closed = false
        const el = document.body.appendChild(document.createElement('div'))
        const r = createRoot(el)
        function Row({item}: {item: string}, {onCleanup}: RenderContext) {
            if (item === 'boom') throw new Error('boom row')
            onCleanup(() => {
                log.push(`cleanup ${item}`)
                if (item === 'b' && !closed) { closed = true; r.destroy() }
            })
            return <li>{item}</li>
        }
        r.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            expect(() => list.push('boom')).toThrow('boom row')
            // data0 >= 2.9: the next change re-runs the computation (full rebuild)
            list.splice(3, 1)
        } finally {
            consoleError.mockRestore()
        }
        expect(log.sort()).toEqual(['cleanup a', 'cleanup b', 'cleanup c'])
        expect(el.innerHTML).toBe('')
    })

    test('E2: splice(i, 1, next) whose old row closes the root: the new (never rendered) rows are destroyed once', () => {
        for (const where of ['in an element', 'as root content'] as const) {
            const list = new RxList<string>(['b', 'a', 'c'])
            const el = document.body.appendChild(document.createElement('div'))
            const r = createRoot(el)
            let closed = false
            function Item({item}: {item: string}, {onCleanup}: RenderContext) {
                if (item === 'a') onCleanup(() => { if (!closed) { closed = true; r.destroy() } })
                return <li>{item}</li>
            }
            const rows = list.map(item => <Item item={item}/>)
            r.render(where === 'in an element' ? <ul>{rows}</ul> : rows as any)
            const listHost = where === 'in an element' ? (r.host as any).reactiveHosts : r.host as any
            const rowProto = Object.getPrototypeOf(listHost.hosts[0])
            const destroyCalls = new Map<object, number>()
            const originalDestroy = rowProto.destroy
            rowProto.destroy = function (this: object, ...args: any[]) {
                destroyCalls.set(this, (destroyCalls.get(this) ?? 0) + 1)
                return originalDestroy.apply(this, args)
            }
            try {
                list.splice(1, 1, 'next', 'next2')
            } finally {
                rowProto.destroy = originalDestroy
            }
            expect([where, el.innerHTML]).toEqual([where, ''])
            // b, a, c, next, next2
            expect([where, destroyCalls.size]).toEqual([where, 5])
            expect([where, [...destroyCalls.values()]]).toEqual([where, [1, 1, 1, 1, 1]])
        }
    })
})

describe('audit follow-up: root.destroy() called again by the cleanups it runs', () => {
    beforeEach(() => { document.body.innerHTML = '' })

    test('G1: "close the dialog when this row goes away", then the dialog is closed normally', () => {
        const el = document.body.appendChild(document.createElement('div'))
        const r = createRoot(el)
        const list = new RxList<string>(['a', 'b'])
        const log: string[] = []
        function Item({item}: {item: string}, {onCleanup}: RenderContext) {
            onCleanup(() => { log.push(`cleanup ${item}`); r.destroy() })
            return <li>{item}</li>
        }
        r.render(<ul>{list.map(item => <Item item={item}/>)}</ul>)
        let thrown: any
        try { r.destroy() } catch (e) { thrown = e }
        expect(String(thrown)).toBe('undefined')
        expect(log).toEqual(['cleanup a', 'cleanup b'])
        expect(el.innerHTML).toBe('')
        expect(r.host).toBe(undefined)
    })

    test('G2: a cleanup closes the root and renders a replacement into it while the root is being destroyed', () => {
        const el = document.body.appendChild(document.createElement('div'))
        document.body.appendChild(el)
        const r = createRoot(el)
        const log: string[] = []
        let replaced = false
        function Dialog(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => {
                if (replaced) return
                replaced = true
                r.destroy()
                r.render(<Toast/>)
            })
            return <b>dialog</b>
        }
        function Toast(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { log.push('toast layout'); return () => log.push('toast cleanup') })
            return <i>closed</i>
        }
        r.render(<Dialog/>)
        r.destroy()
        expect(el.textContent).toBe('closed')
        expect(log).toEqual(['toast layout'])
        // the replacement owns the root now: destroying it tears it down
        r.destroy()
        expect(el.innerHTML).toBe('')
        expect(log).toEqual(['toast layout', 'toast cleanup'])
    })
})

describe('audit follow-up: effects created by content that dispatch("attach") runs belong to the content, not the dispatcher', () => {
    async function settleAll() {
        for (let i = 0; i < 100; i++) await Promise.resolve()
    }
    let rootEl: HTMLElement
    let root: ReturnType<typeof createRoot>
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        root = createRoot(rootEl)
    })

    test('A1: attach listener path: a layout effect creates an effect; the effect that re-attached the container re-runs', () => {
        const tick = atom(0)
        const other = atom(0)
        const visible = atom(false)
        const seen: number[] = []
        let stopInner: (() => void) | undefined
        function Child(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => {
                stopInner = autorun(() => { seen.push(tick()) }, true)
            })
            return <b>child</b>
        }
        root.render(<Child/>)   // container detached: the layout effect waits for attach
        const stop = autorun(() => {
            other()
            if (visible() && !rootEl.isConnected) {
                document.body.appendChild(rootEl)
                root.dispatch('attach')
            }
        }, true)
        visible(true)
        expect(seen).toEqual([0])
        other(1)              // the dispatcher re-runs
        tick(1)
        expect(seen).toEqual([0, 1])
        stopInner?.()
        stop()
        root.destroy()
    })

    test('A2: deferred attach queue path: same, for content rendered while the container was detached', async () => {
        const tick = atom(0)
        const other = atom(0)
        const visible = atom(false)
        const show = atom(false)
        const seen: number[] = []
        let stopInner: (() => void) | undefined
        function Child(_: any, {useLayoutEffect}: RenderContext) {
            useLayoutEffect(() => { stopInner = autorun(() => { seen.push(tick()) }, true) })
            return <b>child</b>
        }
        document.body.appendChild(rootEl)
        root.render(<div>{() => show() ? <Child/> : null}</div>)
        rootEl.remove()
        show(true)
        await settleAll()
        expect(seen).toEqual([])
        const stop = autorun(() => {
            other()
            if (visible() && !rootEl.isConnected) {
                document.body.appendChild(rootEl)
                root.dispatch('attach')
            }
        }, true)
        visible(true)
        expect(seen).toEqual([0])
        other(1)
        tick(1)
        expect(seen).toEqual([0, 1])
        stopInner?.()
        stop()
        root.destroy()
    })
})
