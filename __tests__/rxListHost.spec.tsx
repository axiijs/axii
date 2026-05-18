/** @jsx createElement */
/** @jsxFrag Fragment */
import {ComponentHost, createElement, createRoot, Fragment, StaticHost} from "@framework";
import {atom, RxList, RxMap} from "data0";
import {beforeEach, describe, expect, test, vi} from "vitest";
import {RxListHost} from "../src/RxListHost";

function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

function commentTexts(root: Node) {
    const comments: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    let node = walker.nextNode()
    while (node) {
        comments.push(node.textContent ?? '')
        node = walker.nextNode()
    }
    return comments
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

    test('rxList host skips item effects without breaking child reactivity', async () => {
        const arr = new RxList([
            {id: 1, name: atom('a')},
            {id: 2, name: atom('b')},
        ])

        function Item({item}: { item: { name: ReturnType<typeof atom<string>> } }) {
            return <span>{() => item.name()}</span>
        }

        function App() {
            return <div>
                {arr.map((item) => <Item item={item}/>)}
            </div>
        }

        const host = root.render(<App/>) as ComponentHost
        const rxListHost = (host.innerHost as StaticHost).reactiveHosts![0] as RxListHost

        expect(rootEl.firstElementChild!.textContent).toBe('ab')
        expect(rxListHost.hosts!.effectFramesArray).toEqual([[], []])

        arr.at(0)!.name('A')
        await wait(1)
        expect(rootEl.firstElementChild!.textContent).toBe('Ab')
        expect(rxListHost.hosts!.effectFramesArray).toEqual([[], []])

        arr.push({id: 3, name: atom('c')})
        expect(rootEl.firstElementChild!.textContent).toBe('Abc')
        expect(rxListHost.hosts!.effectFramesArray).toEqual([[], [], []])

        const firstNode = rootEl.firstElementChild!.children[0]
        arr.reposition(0, 2)
        expect(rootEl.firstElementChild!.textContent).toBe('bcA')
        expect(rootEl.firstElementChild!.children[2]).toBe(firstNode)
        expect(rxListHost.hosts!.effectFramesArray).toEqual([[], [], []])

        arr.at(2)!.name('AA')
        await wait(1)
        expect(rootEl.firstElementChild!.textContent).toBe('bcAA')
    })

    test('function child primitive output reuses text node without computed placeholder', async () => {
        const label = atom('a')

        function App() {
            return <div>
                <span>{() => label()}</span>
            </div>
        }

        root.render(<App/>)
        const span = rootEl.querySelector('span')!
        const textNode = span.firstChild

        expect(textNode?.nodeType).toBe(Node.TEXT_NODE)
        expect(span.textContent).toBe('a')
        expect(commentTexts(span)).not.toContain('computed node')

        label('b')
        await wait(1)

        expect(span.firstChild).toBe(textNode)
        expect(span.textContent).toBe('b')
        expect(commentTexts(span)).not.toContain('computed node')
    })

    test('function child can switch between primitive fast path and generic host path', async () => {
        const showText = atom(true)

        function App() {
            return <div>
                {() => showText() ? 'plain' : <strong>rich</strong>}
            </div>
        }

        root.render(<App/>)
        const container = rootEl.firstElementChild!
        const textNode = container.firstChild

        expect(textNode?.nodeType).toBe(Node.TEXT_NODE)
        expect(container.textContent).toBe('plain')
        expect(commentTexts(container)).not.toContain('computed node')

        showText(false)
        await wait(1)

        expect(container.firstElementChild?.tagName).toBe('STRONG')
        expect(container.textContent).toBe('rich')
        expect(commentTexts(container)).toContain('computed node')

        showText(true)
        await wait(1)

        expect(container.firstChild?.nodeType).toBe(Node.TEXT_NODE)
        expect(container.firstChild).not.toBe(textNode)
        expect(container.textContent).toBe('plain')
        expect(commentTexts(container)).not.toContain('computed node')
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

    test('rxList swap items', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
        ])

        
        root.render(arr.map(item => <span>{item.name}</span>) as unknown as Function) as RxListHost
        expect(rootEl.children.length).toBe(3)
        expect(rootEl.children[0].innerHTML).toBe('a')
        expect(rootEl.children[1].innerHTML).toBe('b')
        expect(rootEl.children[2].innerHTML).toBe('c')

        arr.swap(0, 1)
        expect(rootEl.children[0].innerHTML).toBe('b')
        expect(rootEl.children[1].innerHTML).toBe('a')
        expect(rootEl.children[2].innerHTML).toBe('c')

        arr.swap(1, 2)
        expect(rootEl.children[0].innerHTML).toBe('b')
        expect(rootEl.children[1].innerHTML).toBe('c')
        expect(rootEl.children[2].innerHTML).toBe('a')

        arr.swap(0, 2)
        expect(rootEl.children[0].innerHTML).toBe('a')
    })

    test('rxList sort reuses existing dom nodes', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'c'},
            {id:3, name:'b'},
        ])

        root.render(arr.map(item => <span>{item.name}</span>) as unknown as Function)

        const aNode = rootEl.children[0]
        const cNode = rootEl.children[1]
        const bNode = rootEl.children[2]

        arr.sortSelf((a, b) => b.name.localeCompare(a.name))

        expect(rootEl.children.length).toBe(3)
        expect(rootEl.children[0]).toBe(cNode)
        expect(rootEl.children[1]).toBe(bNode)
        expect(rootEl.children[2]).toBe(aNode)
        expect(rootEl.textContent).toBe('cba')
    })

    test('rxList sort rebuilds large reorder ranges without temporary comments', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
            {id:4, name:'d'},
        ])

        root.render(arr.map(item => <span>{item.name}</span>) as unknown as Function)

        const nodes = Array.from(rootEl.children)
        const createComment = vi.spyOn(document, 'createComment')

        arr.sortSelf((a, b) => b.name.localeCompare(a.name))

        expect(createComment).not.toHaveBeenCalled()
        expect(Array.from(rootEl.children)).toEqual([nodes[3], nodes[2], nodes[1], nodes[0]])
        expect(rootEl.textContent).toBe('dcba')
        createComment.mockRestore()
    })

    test('rxList reorder moves fragment child ranges', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
        ])

        function App() {
            return <div>
                {arr.map(item => <Fragment><span>{item.name}</span><span>!</span></Fragment>)}
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.textContent).toBe('a!b!c!')

        arr.swap(0, 2)

        expect(rootEl.firstElementChild!.children.length).toBe(6)
        expect(rootEl.firstElementChild!.textContent).toBe('c!b!a!')
    })

    test('rxList reposition moves child ranges from reorder metadata', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
            {id:4, name:'d'},
        ])

        function App() {
            return <div>
                {arr.map(item => <Fragment><span>{item.name}</span><span>!</span></Fragment>)}
            </div>
        }

        root.render(<App/>)
        const firstRangeNode = rootEl.firstElementChild!.children[0]
        expect(rootEl.firstElementChild!.textContent).toBe('a!b!c!d!')

        arr.reposition(0, 2)

        expect(rootEl.firstElementChild!.children.length).toBe(8)
        expect(rootEl.firstElementChild!.children[4]).toBe(firstRangeNode)
        expect(rootEl.firstElementChild!.textContent).toBe('b!c!a!d!')
    })

    test('rxList reposition moves multiple child ranges forward and backward', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
            {id:4, name:'d'},
            {id:5, name:'e'},
            {id:6, name:'f'},
        ])

        function App() {
            return <div>
                {arr.map(item => <Fragment><span>{item.name}</span><span>!</span></Fragment>)}
            </div>
        }

        root.render(<App/>)
        const bNode = rootEl.firstElementChild!.children[2]
        const cNode = rootEl.firstElementChild!.children[4]
        expect(rootEl.firstElementChild!.textContent).toBe('a!b!c!d!e!f!')

        arr.reposition(1, 4, 2)

        expect(rootEl.firstElementChild!.textContent).toBe('a!d!e!f!b!c!')
        expect(rootEl.firstElementChild!.children[8]).toBe(bNode)
        expect(rootEl.firstElementChild!.children[10]).toBe(cNode)

        const bNodeAfterForwardMove = rootEl.firstElementChild!.children[8]
        const cNodeAfterForwardMove = rootEl.firstElementChild!.children[10]
        arr.reposition(4, 0, 2)

        expect(rootEl.firstElementChild!.textContent).toBe('b!c!a!d!e!f!')
        expect(rootEl.firstElementChild!.children[0]).toBe(bNodeAfterForwardMove)
        expect(rootEl.firstElementChild!.children[2]).toBe(cNodeAfterForwardMove)
    })

    test('rxList reposition moves child ranges at head and tail boundaries', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
            {id:4, name:'d'},
        ])

        function App() {
            return <div>
                {arr.map(item => <Fragment><span>{item.name}</span><span>!</span></Fragment>)}
            </div>
        }

        root.render(<App/>)
        const aNode = rootEl.firstElementChild!.children[0]
        const dNode = rootEl.firstElementChild!.children[6]

        arr.reposition(0, 3)

        expect(rootEl.firstElementChild!.textContent).toBe('b!c!d!a!')
        expect(rootEl.firstElementChild!.children[6]).toBe(aNode)

        arr.reposition(2, 0)

        expect(rootEl.firstElementChild!.textContent).toBe('d!b!c!a!')
        expect(rootEl.firstElementChild!.children[0]).toBe(dNode)
    })

    test('rxList reorder keeps component and function children reactive', async () => {
        const arr = new RxList<any>([
            {id:1, name:atom('a')},
            {id:2, name:atom('b')},
        ])

        function Item({item}: { item: { name: ReturnType<typeof atom<string>> } }) {
            return <span>{() => item.name()}</span>
        }

        root.render(arr.map(item => <Item item={item}/>) as unknown as Function)
        expect(rootEl.textContent).toBe('ab')

        arr.swap(0, 1)
        expect(rootEl.textContent).toBe('ba')

        arr.at(0)!.name('B')
        await wait(1)
        expect(rootEl.textContent).toBe('Ba')
    })

    test('rxList reorder does not create temporary comment placeholders', () => {
        const arr = new RxList<any>([
            {id:1, name:'a'},
            {id:2, name:'b'},
            {id:3, name:'c'},
        ])

        root.render(arr.map(item => <span>{item.name}</span>) as unknown as Function)

        const createComment = vi.spyOn(document, 'createComment')
        arr.swap(0, 2)

        expect(createComment).not.toHaveBeenCalled()
        expect(rootEl.textContent).toBe('cba')
        createComment.mockRestore()
    })

})
