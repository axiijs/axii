/** @jsx createElement */
import {ComponentHost, createElement, createRoot, StaticHost} from "@framework";
import {atom, RxList, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";
import {RxListHost} from "../src/RxListHost";


describe('rxList render', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })


    test('basic list', () => {
        const arr = new RxList<number>([])

        function App() {
            return <div>
                {arr.map((item) => <div>{item}</div>)}
            </div>
        }

        const host = root.render(<App/>) as ComponentHost

        expect(rootEl.firstElementChild!.children.length).toBe(0)
        arr.push(1,2,3)

        expect(rootEl.firstElementChild!.children.length).toBe(3)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('1')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('2')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('3')

        arr.push(4, 5)
        expect(rootEl.firstElementChild!.children.length).toBe(5)
        expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('4')
        expect(rootEl.firstElementChild!.children[4].innerHTML).toBe('5')

        arr.pop()
        expect(arr.length()).toBe(4)
        expect(rootEl.firstElementChild!.children.length).toBe(4)
        expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('4')
        expect(rootEl.firstElementChild!.children[4]).toBeUndefined()

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

        const rxListHost = (host.innerHost as StaticHost).reactiveHosts![0] as RxListHost
        expect((rxListHost.element as HTMLElement).innerHTML).toBe('0')

    })

    test('list with outer reactive value', () => {
        const arr = new RxList<number>([1,2,3])
        const base = atom(0)
        function App() {
            return <div>
                {arr.map((item) => <div>{base() + item}</div>)}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children.length).toBe(3)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('1')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('2')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('3')

        base(1)
        expect(rootEl.firstElementChild!.children.length).toBe(3)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('2')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('3')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('4')
    })

    test('chained list', () => {

        const map1 = new RxMap<string, string>({})
        const keys = map1.keys()

        function App() {
            return <div>
                {keys.map((key) => <div>{key}</div>)}
            </div>
        }
        root.render(<App/>)
        expect(rootEl.firstElementChild!.children.length).toBe(0)

        map1.replace({name1:true, name2:true})
        expect(rootEl.firstElementChild!.children.length).toBe(2)
    })

    test('delete item at tail and head', () => {
        const arr = new RxList<number>([1,2])

        function App() {
            return <div>
                {arr.map((item) => <div>{item}</div>)}
            </div>
        }

        root.render(<App/>)

        expect(rootEl.firstElementChild!.children.length).toBe(2)
        arr.splice(1, 1)

        expect(arr.data.length).toBe(1)
        expect(rootEl.firstElementChild!.children.length).toBe(1)

        arr.splice(0, 1)
        expect(rootEl.firstElementChild!.children.length).toBe(0)
    })

    test('delete all items at once', () => {
        const arr = new RxList<number>([1,2])

        function App() {
            return <div>
                {arr.map((item) => <div>{item}</div>)}
            </div>
        }

        root.render(<App/>)
        arr.splice(0, Infinity)
        expect(rootEl.firstElementChild!.children.length).toBe(0)

        // 重新插入
        arr.push(1,2)
        expect(rootEl.firstElementChild!.children.length).toBe(2)
    })

    test('list with inner reactive', () => {
        const arr = new RxList<any>([
            {id:1, deleted:atom(false)},
            {id:2, deleted:atom(false)},
            {id:3, deleted:atom(false)},
            {id:4, deleted:atom(false)},
            {id:5, deleted:atom(false)},
        ])

        function App() {
            return <div>
                {arr.map((item, index) => <div>{item.id}:{index()}</div>)}
            </div>
        }
        debugger

        root.render(<App/>)
        arr.splice(2,1)
        expect(rootEl.firstElementChild!.children.length).toBe(4)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('1:0')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('2:1')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('4:2')
        expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('5:3')

    })

    test('filtered list', () => {
        const arr = new RxList<any>([
            {id:1, deleted:atom(false)},
            {id:2, deleted:atom(false)},
            {id:3, deleted:atom(false)},
            {id:4, deleted:atom(false)},
            {id:5, deleted:atom(false)},
        ])

        const notDeleted = arr.filter((item) => !item.deleted())

        function App() {
            return <div>
                {notDeleted.map((item, index) => <div>{item.id}:{index()}</div>)}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children.length).toBe(5)
        arr.at(2).deleted(true)
        expect(rootEl.firstElementChild!.children.length).toBe(4)
        expect(rootEl.firstElementChild!.children[0].innerHTML).toBe('1:0')
        expect(rootEl.firstElementChild!.children[1].innerHTML).toBe('2:1')
        expect(rootEl.firstElementChild!.children[2].innerHTML).toBe('4:2')
        expect(rootEl.firstElementChild!.children[3].innerHTML).toBe('5:3')

    })

    test('use rxList to render select options and insert new items', () =>  {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
        ])

        const newItem = {id:4, name:'d'}

        function App() {
            return <div>
                <select value={newItem.id.toString()}>
                    {arr.map((item) => <option value={item.id.toString()}>{item.name}</option>)}
                </select>
            </div>
        }

        root.render(<App/>)
        const select = rootEl.querySelector('select')! as HTMLSelectElement
        expect(select.children.length).toBe(3)
        expect(select.children[0].innerHTML).toBe('a')
        expect(select.children[1].innerHTML).toBe('b')
        expect(select.children[2].innerHTML).toBe('c')
        //
        arr.push(newItem)
        expect(select.children.length).toBe(4)
        expect(select.children[3].innerHTML).toBe('d')
        expect((select.children[3] as HTMLOptionElement).value).toBe('4')
        expect(select.value).toBe('4')
        // new item 已插入就应该被选中了
        expect(select.selectedIndex).toBe(3)

        // explicit key change
        arr.set(3, {id:5, name:'e'})
        expect(select.children.length).toBe(4)
        expect(select.selectedIndex).toBe(-1)

        arr.set(2, {id:4, name:'f'})
        expect(select.selectedIndex).toBe(2)
    })

    test('render rxList as root', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
        ])

        const host = root.render(arr.map(item => <span>{item.name}</span>) as unknown as Function) as RxListHost
        expect(rootEl.children.length).toBe(3)
        expect(rootEl.children[0].innerHTML).toBe('a')
        expect(rootEl.children[1].innerHTML).toBe('b')
        expect(rootEl.children[2].innerHTML).toBe('c')

        expect(host.element.textContent).toBe('a')

    })

})
