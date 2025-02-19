/** @jsx createElement */
/** @jsxFrag Fragment */
import {ComponentHost, createElement, createRef, createRoot, Fragment, StaticHost} from "@framework";
import {RxList, atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";


function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('function render', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })


    test('function host element and parentElement', async() => {
        const name = atom('world')
        const ref = createRef()
        function App() {
            return <div>
                {() => {
                    const nameText = name()
                    return <span>hello {nameText}</span>
                }}
            </div>
        }

        const host = root.render(<App ref={ref}/>)
        await wait(50)
        expect((((host as ComponentHost).innerHost as StaticHost)!.reactiveHosts![0].element as HTMLElement).innerText).toBe('hello world')
    })

    test('function returns a atom', async() => {
        const name = atom('world')
        const visible = atom(true)
        function App() {
            return <div>
                {() => visible() ? name : null}
            </div>
        }
        root.render(<App />)
        const ref = rootEl.firstElementChild as HTMLElement
        await wait(50)
        expect(ref.innerText).toBe('world')
        name('world2')
        expect(ref.innerText).toBe('world2')
        name(undefined)
        expect(ref.innerText).toBe('undefined')
        name({name: 'world3'})
        expect(ref.innerText).toBe('[object Object]')

        visible(false)
        await wait(50)
        expect(ref.innerText).toBe('')
    })

    test('function returns a function node', async ()=> {
        const visible = atom(true)
        const name = atom('world')
        function App() {
            return <div>
                {() => visible() ? () => {
                    const nameText = name()
                    return <span>hello {nameText}</span>
                } : null}
            </div>
        }
        root.render(<App />)
        const ref = rootEl.firstElementChild as HTMLElement
        await wait(50)
        expect(ref.innerText).toBe('hello world')
        name('world2')
        await wait(50)
        expect(ref.innerText).toBe('hello world2')

        visible(false)
        await wait(50)
        expect(ref.innerText).toBe('')
    })

    test('multiple trigger, should rerun only once', async () => {
        const name = atom('world')
        const trigger = atom(0)
        let runs = 0
        function App() {
            return <div>
                {() => {
                    runs++
                    trigger()
                    return name()
                }}
            </div>
        }
        root.render(<App />)
        const ref = rootEl.firstElementChild as HTMLElement
        await wait(50)
        expect(ref.innerText).toBe('world')
        expect(runs).toBe(1)
        
        name('world2')
        trigger(1)
        await wait(50)
        expect(ref.innerText).toBe('world2')
        expect(runs).toBe(2)
    })

    test('function with Fragment', async () => {
        const name = atom('world')

        function App() {
            return <div>
                {() => {
                    const nameText = name()
                    return <><span>hello</span><span>{nameText}</span></>
                }}
            </div>
        }

        root.render(<App/>)

        expect(rootEl.firstElementChild!.children.length).toBe(2)
        expect((rootEl.firstElementChild! as HTMLElement).innerText).toBe("helloworld")

        name('world2')
        // 延迟渲染的
        await wait(1)
        expect((rootEl.firstElementChild! as HTMLElement).innerText).toBe("helloworld2")
    })

    test('function with RxList and Fragment', async() => {
        const list = new RxList([
            {name: 'a', gender:'male'},
            {name: 'b', gender:'male'},
            {name: 'e', gender:'female'},
        ])

        const gender = atom('male')
        const grouped = list.groupBy(item => {
            return item.gender
        })

        function App() {
            return <div>
                {() => {
                    const items = grouped.get(gender())!
                    return items.map(item => (
                        <><span>{item.name}</span><span>{item.gender}</span></>
                    ))
                }}
            </div>
        }

        root.render(<App/>)

        expect(rootEl!.firstElementChild!.children.length).toBe(4)
        expect((rootEl!.firstElementChild! as HTMLElement).innerText).toBe(grouped.get(gender())!.data.map(i => `${i.name}${i.gender}`).join(''))

        gender('female')
        // 延迟渲染的
        await wait(1)
        expect(rootEl.firstElementChild!.children.length).toBe(2)
        expect((rootEl!.firstElementChild! as HTMLElement).innerText).toBe(grouped.get(gender())!.data.map(i => `${i.name}${i.gender}`).join(''))
    })

})
