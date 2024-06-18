/** @vitest-environment happy-dom */
/** @jsx createElement */
import {bindProps, createElement, createRoot, JSXElement, PropTypes, RenderContext} from "@framework";
import {type Atom, atom, computed, incMap, reactive, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";
import {ComponentHost} from "../src/ComponentHost.js";


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


    test('basic component & reactive frag',
        () => {
            const arr = reactive([1, 2, 3])

            function App() {
                return <div>
                    {incMap(arr, (item: Atom) => <div>{item}</div>)}
                </div>
            }

            root.render(<App/>)
            expect(rootEl.firstElementChild!.children.length).toBe(3)
            expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('1')
            expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('2')
            expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('3')


            arr.push(4, 5)
            expect(rootEl.firstElementChild!.children.length).toBe(5)
            expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('4')
            expect(rootEl.firstElementChild!.children[4].innerHTML).toBe('5')

            arr.pop()
            expect(arr.length).toBe(4)
            expect(rootEl.firstElementChild!.children.length).toBe(4)
            expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('4')

            arr.unshift(-1, 0)
            expect(rootEl.firstElementChild!.children.length).toBe(6)
            expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('-1')
            expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('0')
            expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('1')
            expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('2')
            expect(rootEl.firstElementChild!.children[4].innerHTML).toBe('3')
            expect(rootEl.firstElementChild!.children[5].innerHTML).toBe('4')

            arr.shift()
            expect(rootEl.firstElementChild!.children.length).toBe(5)
            expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('0')
            //
            arr.splice(2, 1, 9, 99, 999)
            expect(rootEl.firstElementChild!.children.length).toBe(7)
            expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('0')
            expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('1')
            expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('9')
            expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('99')
            expect(rootEl.firstElementChild!.children[4].innerHTML).toBe('999')
            expect(rootEl.firstElementChild!.children[5].innerHTML).toBe('3')
            expect(rootEl.firstElementChild!.children[6].innerHTML).toBe('4')

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
        const rxStyle = reactive({
            color: 'red',
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
        expect(getComputedStyle(firstChild()).color).toBe('red')

        rxStyle.color = 'blue'
        expect(getComputedStyle(firstChild()).color).toBe('blue')
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

    test('computed in Component should destroy when component destroyed', () => {
        const name = atom('')
        let innerComputedRuns = 0

        function Child() {
            const nameWithPrefix = computed(function nameWithPrefix() {
                innerComputedRuns++
                return name() ? 'Mr.' + name() : 'anonymous'
            })
            return <div>{nameWithPrefix}</div>
        }

        const items = reactive([1, 2, 3])

        function App() {
            return <div>
                {incMap(items, (item: Atom) => {
                    return <Child />
                })}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('anonymous')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('anonymous')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('anonymous')
        name('data0')
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('Mr.data0')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('Mr.data0')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('Mr.data0')
        expect(innerComputedRuns).toBe(6)
        //
        // name('data1')
        // expect(innerComputedRuns).toBe(2)
        // expect(rootEl.firstElementChild!.children.length).toBe(0)
        items.pop()
        expect(rootEl.firstElementChild!.children.length).toBe(2)
        expect(innerComputedRuns).toBe(6)

        name('data1')
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('Mr.data1')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('Mr.data1')
        expect(innerComputedRuns).toBe(8)

    })

    test('destroy', () => {
        function Child({name}: {name: Atom}) {
            const nameWithPrefix = computed(function nameWithPrefix() {
                return name ? 'Mr.' + name : 'anonymous'
            })
            return <div>{nameWithPrefix}</div>
        }

        const items = reactive([1, 2, 3])

        function App() {
            return <div>
                {incMap(items, (item: Atom) => {
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
        expect(innerRef).toBe(innerRef2)
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
        const ContextType = Symbol('ContextType')

        function Child2(props:any, {createElement, context}: RenderContext) {
            return <div>{context.get(ContextType).data}</div>
        }

        function Child(props:any, {createElement}: RenderContext) {
            return <div>
                <Child2 />
            </div>
        }

        function App(props:any, {createElement, context}: RenderContext) {
            context.set(ContextType, {data})
            return <div>
                <Child />
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('data0')
        data('data1')
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('data1')
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
