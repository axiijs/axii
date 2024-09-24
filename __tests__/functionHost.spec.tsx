/** @vitest-environment happy-dom */
/** @jsx createElement */
import {createElement, createRoot, Fragment} from "@framework";
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
