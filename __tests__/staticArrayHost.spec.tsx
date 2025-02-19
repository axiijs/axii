/** @jsx createElement */
import {createElement, createRoot} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test} from "vitest";


function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('rxList render', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })


    test('list in function with null object', async () => {

        const show = atom(false)
        const list = [0,1,2]

        function App() {
            return <div>
                {() => show()? list.map(item => (item === 0? null : <span>{item}</span>)) : null}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children.length).toBe(0)
        show(true)
        await wait(1)
        expect(rootEl.firstElementChild!.children.length).toBe(2)

        show(false)
        await wait(1)
        expect(rootEl.firstElementChild!.children.length).toBe(0)

    })

    test('render simple array', () => {
        const arr = [1,2,3]

        function App() {
            return <div>
                {arr.map(item => new Text(item.toString()))}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.textContent).toBe('123')

    })
})
