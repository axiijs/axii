/** @vitest-environment happy-dom */
/** @jsx createElement */
import {
    bindProps,
    createContext,
    createElement,
    createRef,
    createRoot,
    JSXElement,
    PropTypes,
    RenderContext
} from "@framework";
import {type Atom, atom, computed, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";
import {ComponentHost} from "../src/ComponentHost.js";


function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('component render', () => {

    const wait = (time: number) => {
        return new Promise(resolve => {
            setTimeout(resolve, time)
        })
    }

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('function node', async () => {
        const renderText = atom(false)
        function App() {
            return <div>
                {() => renderText() ? <div>hello world</div> : <span>404</span>}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('404')
        renderText(true)
        await wait(10)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('hello world')
    })

    test('component with computed inside function node', () => {
        const insideAtom = atom(1)
        function Child() {
            const  text = computed(() => insideAtom() + 1)
            return <div>{text}</div>
        }

        let functionNodeRuns = 0
        function App() {
            return <div>
                {() => {
                    functionNodeRuns++
                    return <Child />
                }}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('2')
        expect(functionNodeRuns).toBe(1)

        // Component computed recomputed should not propagate to function node
        insideAtom(2)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('3')
        expect(functionNodeRuns).toBe(1)
    })

    test('static array node', () => {
        function App() {
            return <div>{
                [
                    <div>hello world</div>,
                    <span>404</span>
                ]
            }</div>
        }
        root.render(<App/>)

        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('hello world')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('404')
    })

    test('atom node', () => {
        const text = atom('hello world')
        function App() {
            return <div>{text}</div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.innerHTML).toBe('hello world')

        text('hello data0')
        expect(rootEl.firstElementChild!.innerHTML).toBe('hello data0')

        // 设置为 undefined
        text(undefined)
        expect(rootEl.firstElementChild!.innerHTML).toBe('undefined')

        // 设置为 null
        text(null)
        expect(rootEl.firstElementChild!.innerHTML).toBe('null')
    })

    test('reactive attribute should not leak to upper computed', () => {
        const rxStyle = atom({
            color: 'rgb(255, 0, 0)',
            fontSize: '12px'
        })

        let functionNodeRuns = 0
        function App() {
            return <div>
                {() => {
                    functionNodeRuns++
                    return <div style={rxStyle} />
                }}
            </div>
        }

        root.render(<App/>)
        const firstChild = () => (rootEl.firstElementChild!.children[0] as HTMLElement)
        expect(getComputedStyle(firstChild()).color).toBe('rgb(255, 0, 0)')

        rxStyle({
            ...rxStyle.raw,
            color: 'rgb(0, 0, 255)'
        })
        expect(getComputedStyle(firstChild()).color).toBe('rgb(0, 0, 255)')
        expect(functionNodeRuns).toBe(1)

    })

    test('function node inside function node', () => {
        function Child2() {
            const showName = atom(false)
            const text = atom('child2')
            return <div>{() => showName() ? text() : <div>anonymous</div>}</div>
        }

        function App() {
            return <div>
                {() => {
                    // const Component = dynamicComponent()
                    return <Child2 />
                }}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('anonymous')
    })



    test('dynamic Component', async () => {
        function Child1() {
            return <div>child1</div>
        }

        function Child2() {
            const showName = atom(false)
            const text = atom('child2')
            return <div>{() => showName() ? text() : <div>anonymous</div>}</div>
        }

        const dynamicComponent = atom<Function>(Child2)
        function App() {
            return <div>
                {() => {
                    const Component = dynamicComponent()
                    return <Component />
                }}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('anonymous')
        dynamicComponent(Child1)
        await wait(10)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('child1')
    })

    test('reusable nodes', async () => {
        const visible = atom(true)
        const innerText = atom('anonymous')

        function App({}, {createElement,reusable}: RenderContext) {
            const reusedNode = reusable(<div>{() => innerText() }</div>)
            return <div>
                {() => visible() ? reusedNode : null}
            </div>
        }

        const host = root.render(<App/>)
        expect((rootEl.firstElementChild!.children[0] as HTMLElement).innerText).toBe('anonymous')

        visible(false)
        await wait(10)
        expect(rootEl.firstElementChild!.children.length).toBe(0)

        innerText('hello world')
        visible(true)
        await wait(10)
        expect((rootEl.firstElementChild!.children[0] as HTMLElement).innerText).toBe('hello world')

        visible(false)
        await wait(10)
        visible(true)
        innerText('bravo')
        await wait(10)
        expect((rootEl.firstElementChild!.children[0] as HTMLElement).innerText).toBe('bravo')

        host.destroy()
        expect(rootEl.innerHTML).toBe('')
    })

    test('computed in Component should destroy when component destroyed', async () => {

        const name = atom('')
        let innerComputedRuns = 0

        function Child() {
            const nameWithPrefix = computed(() => {
                innerComputedRuns++
                return name() ? 'Mr.' + name() : 'anonymous'
            })
            return <div>{nameWithPrefix}</div>
        }

        const showChild = atom(true)
        function App() {
            return <div>
                {() => {
                    return showChild() ? <Child /> : null
                }}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('anonymous')
        name('data0')
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('Mr.data0')
        expect(innerComputedRuns).toBe(2)
        showChild(false)
        await wait(10)
        name('data1')
        expect(innerComputedRuns).toBe(2)
        expect(rootEl.firstElementChild!.children.length).toBe(0)
    })

    test('destroy', () => {
        function Child({name}: {name: Atom}) {
            const nameWithPrefix = computed(function nameWithPrefix() {
                return name ? 'Mr.' + name : 'anonymous'
            })
            return <div>{nameWithPrefix}</div>
        }

        const items = new RxList([1, 2, 3])

        function App() {
            return <div>
                {items.map((item: Atom) => {
                    return <Child name={item} />
                })}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('Mr.1')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('Mr.2')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('Mr.3')
        root.destroy()
        expect(rootEl.innerHTML).toBe('')
    })

    test('pass props to inner component',() => {
        let innerProps: any
        function Child(props:any) {
            innerProps = props
            return <div>{props.children}</div>
        }

        function Through(props:any) {
            return <Child {...props}/>
        }

        function App() {
            return <div>
                <Through name="hello">
                    hello children
                </Through>
            </div>
        }

        root.render(<App/>)
        expect(innerProps.name).toBe('hello')
        expect(innerProps.children).toMatchObject(['hello children'])
    })
})

describe('component ref', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })
    test('get ref of dom element', () => {
        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <div as="container">
                    app
                </div>
                <div as="container2">
                    app2
                </div>
            </div>
        }

        root.render(<App/>)

        expect(rootEl.firstElementChild!.firstElementChild!.innerHTML).toBe('app')
        expect((root.host as ComponentHost).refs.container).toBeDefined()
        expect((root.host as ComponentHost).refs.container.innerHTML).toBe('app')
        expect((root.host as ComponentHost).refs.container2.innerHTML).toBe('app2')
    })

    test('use ref to get component ref', async () => {
        const ref = createRef()
        const visible = atom(true)
        function Child() {
            return <div>child</div>
        }
        function App(props:any, {createElement}: RenderContext) {
            return <div>
                {() => visible() ? <Child ref={ref}></Child> : null}
            </div>
        }

        root.render(<App/>)
        await wait(10)
        expect(ref.current).not.toBeNull()
        visible(false)
        await wait(10)
        expect(ref.current).toBe(null)


    })

    test('use ref to get dom ref', () => {
        let innerRef: HTMLElement|undefined
        let innerRef2: JSXElement|undefined
        function App(props:any, {createElement}: RenderContext) {
            return <div>
                {innerRef2 = <span ref={(ref:HTMLElement) => innerRef = ref}>app</span> }
            </div>
        }

        root.render(<App/>)
        expect(innerRef).toBeDefined()
        expect(innerRef!.innerHTML).toBe('app')
        expect(innerRef?.isConnected).toBe(true)
        expect(innerRef).toBe(innerRef2)
    })

    test('use createRef/createRxRef in context to get dom ref', () => {
        let innerRef: any
        let innerRef2: any
        function App(props:any, {createElement, createRef, createRxRef}: RenderContext) {
            innerRef = createRef()
            innerRef2 = createRxRef()
            return <div>
                <span ref={[innerRef, innerRef2]}>app</span>
            </div>
        }

        root.render(<App/>)
        expect(innerRef.current).toBeDefined()
        expect(innerRef.current.innerHTML).toBe('app')
        expect(innerRef.current.isConnected).toBe(true)
        expect(innerRef2.current).toBeDefined()
        expect(innerRef2.current.innerHTML).toBe('app')
        expect(innerRef2.current.isConnected).toBe(true)
    })

    test('ref should be set to null when element removed', () => {
        let innerRef: HTMLElement|undefined|null
        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <span ref={(ref:HTMLElement|null) => innerRef = ref}>app</span>
            </div>
        }

        root.render(<App/>)
        expect(innerRef).toBeDefined()
        expect(innerRef!.innerHTML).toBe('app')
        root.destroy()
        expect(innerRef).toBe(null)
    })

    test('ref with exposed values in component', () => {
        let innerRef: any
        let clicked = 0
        function Child({}, {createElement, expose}: RenderContext) {
            const onClick=expose(() => {
                clicked += 1
            }, 'click')

            return <div id="clickTarget" onClick={onClick}></div>
        }

        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <Child ref={(ref:any)=>innerRef = ref}/>
            </div>
        }

        root.render(<App/>)
        document.getElementById('clickTarget')!.click()
        expect(clicked).toBe(1)

        innerRef.click()
        expect(clicked).toBe(2)

    })

})



describe('component data context', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('pass data context to children', () => {
        const data = atom('data0')
        const CustomContext = createContext('ContextType')

        function Child2(props:any, {createElement, context}: RenderContext) {
            return <div>{context.get(CustomContext).data}</div>
        }

        function Child(props:any, {createElement}: RenderContext) {
            return <div>ContextType
                <Child2 />
            </div>
        }

        function Child3(props:any, {createElement, context}: RenderContext) {
            return <div>{context.get(CustomContext)}</div>
        }

        function App(props:any, {createElement, context}: RenderContext) {
            context.set(CustomContext, {data})
            return <div>
                <Child />
                <CustomContext.Provider value={'data3'}>
                    <Child3 />
                </CustomContext.Provider>
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('data0')
        data('data1')
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('data1')
        console.log(rootEl.firstElementChild?.innerHTML)
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('data3')
    })
})

describe('component propTypes', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('pass data context to children', () => {

        let innerProps: any

        function App(props:any, {createElement, context}: RenderContext) {
            innerProps = props
            return <div>
            </div>
        }

        App.propTypes = {
            atomData: PropTypes.atom<string>().default(() => atom('data0')),
            rxListData: PropTypes.rxList<number>().default(() => new RxList([1, 2, 3])),
        }

        root.render(<App rxListData={[4,5,6]}/>)
        expect(innerProps.atomData()).toBe('data0')
        expect(innerProps.rxListData.data).toEqual([4,5,6])
    })


    test('bindProps should work',() => {
        let innerProps: any
        function RawApp(props:any, {createElement}: RenderContext) {
            innerProps = props
            return <div>
            </div>
        }

        const App = bindProps(RawApp, {
            name: 'hello',
            value: 'world'
        })

        root.render(<App another={[4,5,6]} value={'rewrite'}/>)

        expect(innerProps.name).toBe('hello')
        expect(innerProps.value).toBe('rewrite')
        expect(innerProps.another).toEqual([4,5,6])
    })


})

describe('component lifecycle', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })
    test('useLayoutEffect', async () => {
        let innerBoundingInfo:any
        function App({}, {useLayoutEffect, createElement, createRef}: RenderContext) {
            const ref = createRef()
            useLayoutEffect(() => {
                innerBoundingInfo= ref.current.getBoundingClientRect()
            })
            return <div ref={ref}>app</div>
        }

        root.render(<App/>)
        expect(innerBoundingInfo?.width).toBeTruthy()
    })

    test('call user onCleanup callback when destroy', () => {
        let cleanupCalled = false
        function App({}, {onCleanup}: RenderContext) {
            onCleanup(() => {
                cleanupCalled = true
            })
            return <div>app</div>
        }

        root.render(<App/>)
        root.destroy()
        expect(cleanupCalled).toBeTruthy()
    })

})