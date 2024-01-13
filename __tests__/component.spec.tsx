/** @vitest-environment jsdom */
/** @jsx createElement */
import {createElement, createRoot} from "@framework";
import {reactive, incMap, type Atom, atom, computed} from "data0";
import {describe, test, beforeEach, expect} from "vitest";

describe('component render', () => {

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


    test('function node', () => {
        const renderText = atom(false)
        function App() {
            return <div>
                {() => renderText() ? <div>hello world</div> : <span>404</span>}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('404')

        renderText(true)
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
                    debugger
                    functionNodeRuns++
                    return <div style={rxStyle} />
                }}
            </div>
        }

        root.render(<App/>)
        const firstChild = () => (rootEl.firstElementChild!.children[0] as HTMLElement)
        expect(firstChild().style.color).toBe('red')

        rxStyle.color = 'blue'
        expect(firstChild().style.color).toBe('blue')
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
        console.log(rootEl.innerHTML)
        expect(rootEl.firstElementChild!.children[0].children[0].innerHTML).toBe('anonymous')
    })



    test('dynamic Component', () => {
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
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('child1')

    })

    test('computed in Component should destroy when component destroyed', () => {

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
        name('data1')
        expect(innerComputedRuns).toBe(2)
        expect(rootEl.firstElementChild!.children.length).toBe(0)
    })
})
