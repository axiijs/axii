// import '../scripts/test.setup.js'
/** @vitest-environment happy-dom */
/** @jsx createElement */
import {createElement, createRoot} from "@framework";
import {atom, RxList} from "data0";
import {beforeEach, describe, expect, test} from "vitest";


function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('complex combination', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })


    test('groupBy + list', async () => {
        let id= 1
        const arr = new RxList<{type:string, id:number}>([])
        const grouped = arr.groupBy((item) => item.type)
        const currentType = atom<string>('image')

        const createItem = (type:string) => {
            return {type, id: id++}
        }

        let listRenderRuns = 0
        function App() {
            return <div>
                {() => {
                    listRenderRuns++
                    return grouped.get(currentType())?.map(item => (
                        <div>{item.id}</div>
                    ))
                }}
            </div>
        }

        root.render(<App/>)
        expect(listRenderRuns).toBe(1)

        expect(rootEl.firstElementChild!.children.length).toBe(0)
        arr.splice(
            0,
            Infinity,
            createItem('image'),
            createItem('image'),
            createItem('image'),
            createItem('image'),
            createItem('video'),
            createItem('video'),
            createItem('video'),
            createItem('video'),
        )

        expect(listRenderRuns).toBe(1)
        expect(grouped.get('image')!.length()).toBe(4)
        expect(grouped.get('video')!.length()).toBe(4)

        await wait(1)
        expect(rootEl.firstElementChild!.children.length).toBe(4)
        expect(rootEl.firstElementChild!.textContent).toBe('1234')

        currentType('video')
        expect(listRenderRuns).toBe(2)
        await wait(1)
        expect(rootEl.firstElementChild!.textContent).toBe('5678')

        expect(grouped.get('video')!.toArray()).toMatchObject([
            {type:'video', id:5},
            {type:'video', id:6},
            {type:'video', id:7},
            {type:'video', id:8},
        ])
        arr.splice(
            0,
            Infinity,
            createItem('image'),
            createItem('image'),
            createItem('image'),
            createItem('image'),
            createItem('video'),
            createItem('video'),
            createItem('video'),
            createItem('video'),
        )
        await wait(1)

        currentType('image')

        await wait(1)
        expect(rootEl.firstElementChild!.textContent).toBe('9101112')

        currentType('video')
        await wait(1)
        expect(rootEl.firstElementChild!.textContent).toBe('13141516')

    })


})
