/* @jsx createElement */
/**
 * 生命周期的几处边角（#58）。
 *
 * 1. 重入的 root.destroy()（清理函数 / detach 监听器里再调用）不重复派发 detach：同一次销毁只派发一次。
 * 2. 销毁之后才抛出的错误（渲染到一半被丢弃的树、被同步销毁的函数节点 / 列表）经 reportAxiiError
 *    报告（diagnostics / onError），不抛出，也不静默丢弃。
 * 3. 离场动画结束后异步移除 option 时，受控 select 按存值重放。
 * 4. 来自另一个 realm（同源 iframe）的节点按 nodeType 识别。
 * 5. 列表整段删除时，首行自己摘掉了文本节点，行的清理函数插在父节点最前面的节点不被一起清掉。
 */
import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    configureDiagnostics,
    createElement,
    createHost,
    createRoot,
    RenderContext,
    RxList,
} from "@framework";
import {renderToString} from '../src/ssr.js'
import {hydrate, pendingTopDown} from './helpers/hydrate'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}

let rootEl: HTMLElement
let reported: unknown[]
beforeEach(() => {
    document.body.innerHTML = ''
    rootEl = document.body.appendChild(document.createElement('div'))
    reported = []
    configureDiagnostics({onError: error => { reported.push(error) }})
})
afterEach(() => {
    configureDiagnostics({})
})
const messages = (errors: unknown[]) => errors.map(error => (error as Error).message)

describe('#58-1: a re-entrant destroy() dispatches detach once', () => {
    test('a cleanup that calls root.destroy() again', () => {
        const root = createRoot(rootEl)
        let detach = 0
        root.on('detach', () => { detach++ })
        function Dialog(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => { root.destroy() })
            return <b>dialog</b>
        }
        root.render(<Dialog/>)
        root.destroy()
        expect(detach).toBe(1)
        expect(rootEl.innerHTML).toBe('')
        expect(root.host).toBe(undefined)
    })

    test('a detach listener that calls root.destroy() again', () => {
        const root = createRoot(rootEl)
        let detach = 0
        let cleanups = 0
        root.on('detach', () => {
            detach++
            root.destroy()
        })
        function Dialog(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => { cleanups++ })
            return <b>dialog</b>
        }
        root.render(<Dialog/>)
        root.destroy()
        expect(detach).toBe(1)
        expect(cleanups).toBe(1)
        expect(rootEl.innerHTML).toBe('')
    })

    // 销毁过程中清理函数往同一个 root 渲染了新内容：新内容被销毁时照常派发它自己的 detach
    test('content rendered into the root during the teardown still gets its own detach', () => {
        const root = createRoot(rootEl)
        const events: string[] = []
        root.on('attach', () => { events.push('attach') })
        // 记下被 detach 的是哪一份内容（root.host 在 detach 派发之后才交出）
        root.on('detach', () => { events.push(`detach ${(root.host as any)?.element?.textContent ?? 'nothing'}`) })
        let step = 0
        function Dialog(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => {
                root.destroy()
                root.render(<i>toast</i>)
            })
            onCleanup(() => {
                // 同一次销毁里再关掉刚渲染的提示
                if (step === 1) root.destroy()
            })
            return <b>dialog</b>
        }
        root.render(<Dialog/>)
        root.destroy()
        expect(events).toEqual(['attach', 'detach dialog', 'attach'])
        expect(rootEl.textContent).toBe('toast')
        root.destroy()
        expect(events).toEqual(['attach', 'detach dialog', 'attach', 'detach toast'])

        step = 1
        events.length = 0
        root.render(<Dialog/>)
        root.destroy()
        expect(events).toEqual(['attach', 'detach dialog', 'attach', 'detach toast'])
        expect(rootEl.innerHTML).toBe('')
    })

    // 渲染中途被 error 监听器销毁的树，在渲染栈退出时才真正销毁：那是同一次销毁的后半段，
    //  里面的清理函数再调用 root.destroy() 不再派发 detach；监听器往同一个 root 渲染了错误提示时，
    //  错误提示被这个调用销毁，照常派发它自己的 detach。
    test('a cleanup that calls root.destroy() while a tree discarded mid-render is torn down', () => {
        const root = createRoot(rootEl)
        const events: string[] = []
        root.on('detach', () => { events.push(`detach ${(root.host as any)?.element?.textContent ?? 'nothing'}`) })
        let fallback = false
        root.on('error', () => {
            root.destroy()
            if (fallback) root.render(<i>fallback</i>)
        })
        function Dialog(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => { root.destroy() })
            return <b>dialog</b>
        }
        function Broken(): any { throw new Error('render failed') }
        root.render(<div><Dialog/><Broken/></div>)
        expect(events).toEqual(['detach dialog'])
        expect(rootEl.innerHTML).toBe('')

        fallback = true
        events.length = 0
        root.render(<div><Dialog/><Broken/></div>)
        expect(events).toEqual(['detach dialog', 'detach fallback'])
        expect(rootEl.innerHTML).toBe('')
    })

    // 不是重入：两次独立的 destroy 各派发一次（与之前一致）
    test('guard: two separate destroy() calls each dispatch detach', () => {
        const root = createRoot(rootEl)
        let detach = 0
        root.on('detach', () => { detach++ })
        root.render(<b>x</b>)
        root.destroy()
        root.destroy()
        expect(detach).toBe(2)
    })
})

describe('#58-2: errors thrown after their content was destroyed are reported, neither thrown nor dropped', () => {
    // render 路径：渲染到一半被丢弃的树之后的错误。没有经过 dispatch 的错误（非法 child 的断言）
    //  沿渲染栈抛到 render，经过 dispatch 的错误（组件抛错）在 dispatch 里报告。
    test('render: errors of a tree the error listener discarded mid-render', () => {
        const root = createRoot(rootEl)
        const fallbackEl = document.body.appendChild(document.createElement('div'))
        const fallback = createRoot(fallbackEl)
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            root.destroy()
            fallback.render(<p>{error.message}</p>)
        })
        function Broken({message}: any): any { throw new Error(message) }
        expect(() => root.render(<div>
            <Broken message="first"/>
            <Broken message="second"/>
        </div>)).not.toThrow()
        expect(seen).toEqual(['first'])
        expect(messages(reported)).toEqual(['second'])
        expect(fallbackEl.textContent).toBe('first')
        expect(rootEl.innerHTML).toBe('')

        // 不经过 dispatch 的错误：元素里的非法 child 在 StaticHost 里直接断言失败
        //  （放在组件里，等 Broken 之后才渲染）
        reported.length = 0
        seen.length = 0
        fallback.destroy()
        function Later() { return <section>{{} as any}</section> }
        expect(() => root.render(<div>
            <Broken message="third"/>
            <Later/>
        </div>)).not.toThrow()
        expect(seen).toEqual(['third'])
        expect(reported).toHaveLength(1)
        expect(String(reported[0])).toContain('unknown child type')
        expect(rootEl.innerHTML).toBe('')
        fallback.destroy()
    })

    // 被丢弃的树在渲染栈退出时销毁：它的清理函数抛错不再从 root.render 抛出，兄弟清理函数照常执行
    test('render: teardown errors of the discarded tree do not stop the teardown', () => {
        const root = createRoot(rootEl)
        const cleaned: string[] = []
        function Leaky({name}: any, {useEffect}: RenderContext) {
            useEffect(() => () => {
                cleaned.push(name)
                throw new Error(`${name} cleanup failed`)
            })
            return <b>{name}</b>
        }
        function Broken(): any { throw new Error('render failed') }
        const seen: string[] = []
        root.on('error', (error: any) => {
            seen.push(error.message)
            root.destroy()
        })
        expect(() => root.render(<div><Leaky name="a"/><Leaky name="b"/><Broken/></div>)).not.toThrow()
        expect(seen).toEqual(['render failed'])
        expect(cleaned).toEqual(['a', 'b'])
        expect(messages(reported)).toEqual(['a cleanup failed', 'b cleanup failed'])
        expect(rootEl.innerHTML).toBe('')
    })

    // 被丢弃的树在销毁时抛出不经过 dispatch 的错误（DOM 区间被用户代码搬乱）：同样报告，不从 root.render 抛出
    test('render: a teardown error of the discarded tree that bypasses dispatch', () => {
        const root = createRoot(rootEl)
        function Moved(_: any, {useEffect}: RenderContext) {
            const element = <b>moved</b> as HTMLElement
            // 把自己的元素搬到 root 占位符后面：区间 [元素, 占位符] 断开
            useEffect(() => { element.parentNode!.appendChild(element) })
            return element
        }
        function App(_: any, {useEffect}: RenderContext) {
            useEffect(() => { throw new Error('app effect failed') })
            return <Moved/>
        }
        root.on('error', () => { root.destroy() })
        expect(() => root.render(<App/>)).not.toThrow()
        expect(reported).toHaveLength(1)
        expect((reported[0] as any).code).toBe('AXII_DOM_BOUNDARY_BROKEN')
        expect(rootEl.innerHTML).toBe('')
    })

    // FunctionHost：函数节点重算时 source 自己同步销毁了本节点再抛错（root 上没有 error 监听器）
    test('FunctionHost: a source that destroys its own node and then throws', async () => {
        const root = createRoot(rootEl)
        const closing = atom(false)
        root.render(<div>{() => {
            if (closing()) {
                root.destroy()
                throw new Error('after own destroy')
            }
            return 'open'
        }}</div>)
        closing(true)
        await settle()
        expect(messages(reported)).toEqual(['after own destroy'])
        expect(rootEl.innerHTML).toBe('')
    })

    // FunctionHost：结构重建时新内容同步销毁了本节点再抛错
    test('FunctionHost: new structural content that destroys the node and then throws', async () => {
        const root = createRoot(rootEl)
        const show = atom(false)
        function Closer(): any {
            root.destroy()
            throw new Error('closer failed')
        }
        root.render(<div>{() => show() ? <Closer/> : 'idle'}</div>)
        show(true)
        await settle()
        expect(messages(reported)).toEqual(['closer failed'])
        expect(rootEl.innerHTML).toBe('')
    })

    // RxListHost：新行渲染到一半时列表被同步销毁，新行再抛错（push 与 set 两条路径）
    for (const op of ['push', 'set'] as const) {
        test(`RxListHost: a new row (${op}) that destroys the list and then throws`, async () => {
            const root = createRoot(rootEl)
            const list = new RxList<string>(['a'])
            function Row({item}: any): any {
                if (item === 'closer') {
                    root.destroy()
                    throw new Error(`row failed on ${op}`)
                }
                return <li>{item}</li>
            }
            root.render(<ul>{list.map(item => <Row item={item}/>)}</ul>)
            if (op === 'push') {
                expect(() => list.push('closer')).not.toThrow()
            } else {
                expect(() => list.set(0, 'closer')).not.toThrow()
            }
            await settle()
            expect(messages(reported)).toEqual([`row failed on ${op}`])
            expect(rootEl.innerHTML).toBe('')
        })
    }
})

describe('#58-3: a controlled select replays its stored value after a leaving option is removed', () => {
    const read = (s: HTMLSelectElement) => `${s.selectedIndex}:${s.value}`

    test('function child and list row with detachStyle', async () => {
        const root = createRoot(rootEl)
        const show = atom(true)
        const options = new RxList(['a', 'b'])
        root.render(<div>
            <select id="fn" value="b">
                <option value="a">a</option>
                {() => show() ? <option value="b" detachStyle={{opacity: 0}}>b</option> : null}
            </select>
            <select id="list" value="b">
                {options.map(o => <option value={o} detachStyle={{opacity: 0}}>{o}</option>)}
            </select>
        </div>)
        const fn = document.getElementById('fn') as HTMLSelectElement
        const list = document.getElementById('list') as HTMLSelectElement
        expect([read(fn), read(list)]).toEqual(['1:b', '1:b'])

        show(false)
        options.splice(1, 1)
        await settle()
        // 离场动画期间 option 还在，仍然选中
        expect([read(fn), read(list)]).toEqual(['1:b', '1:b'])
        await sleep(400)
        expect(fn.options.length).toBe(1)
        expect(list.options.length).toBe(1)

        // 与全新渲染（存值 "b" 没有匹配的 option）一致
        const freshEl = document.body.appendChild(document.createElement('div'))
        const fresh = createRoot(freshEl)
        fresh.render(<select id="fresh" value="b"><option value="a">a</option></select>)
        const expected = read(document.getElementById('fresh') as HTMLSelectElement)
        expect(expected).toBe('-1:')
        expect([read(fn), read(list)]).toEqual([expected, expected])
        fresh.destroy()

        // option 回来之后照常选中
        show(true)
        options.push('b')
        await settle()
        expect([read(fn), read(list)]).toEqual(['1:b', '1:b'])
        root.destroy()
    })
})

describe('#58-4: nodes from another realm (same-origin iframe)', () => {
    let foreign: Document
    beforeEach(() => {
        const iframe = document.body.appendChild(document.createElement('iframe'))
        foreign = iframe.contentDocument!
    })

    // 同一份内容分别用当前 realm 和 iframe 的节点渲染：入口覆盖组件返回值、函数节点、数组项、
    //  JSX child、列表行，DOM 形态（占位注释、紧凑行、数组里的直接文本节点）逐字相同。
    function renderWith(doc: Document, container: HTMLElement) {
        const el = (tag: string, text: string) => {
            const element = doc.createElement(tag)
            element.textContent = text
            return element as any
        }
        const text = doc.createTextNode('text')
        const comment = doc.createComment('comment')
        const element = el('b', 'element')
        const fragment = doc.createDocumentFragment()
        fragment.append(doc.createElement('i'), doc.createTextNode('fragment'))
        // <form> 的同名控件遮蔽 form.nodeType（[LegacyOverrideBuiltIns]），读到的是那个控件
        const form = doc.createElement('form')
        const input = doc.createElement('input')
        input.name = 'nodeType'
        form.appendChild(input)
        function ReturnsText() { return text as any }
        function ReturnsComment() { return comment as any }
        function ReturnsElement() { return element }
        function ReturnsFragment() { return fragment as any }
        function ReturnsForm() { return form as any }
        const which = atom<'text' | 'element'>('text')
        const fnText = doc.createTextNode('fn text')
        const fnElement = el('u', 'fn element')
        const rows = new RxList(['x', 'y'])
        const root = createRoot(container)
        root.render(<div>
            <p><ReturnsText/><ReturnsComment/><ReturnsElement/><ReturnsFragment/><ReturnsForm/></p>
            <p>{() => which() === 'text' ? fnText : fnElement}</p>
            <p>{[doc.createTextNode('array text'), el('s', 'array element')] as any}</p>
            <p>{doc.createTextNode('jsx text') as any}{el('q', 'jsx element')}</p>
            <ul>{rows.map(item => el('li', item))}</ul>
        </div>)
        return {root, which, rows, text, form}
    }

    test('components, function children, array items, JSX children and list rows render them like local nodes', async () => {
        const localEl = document.body.appendChild(document.createElement('div'))
        const local = renderWith(document, localEl)
        const remote = renderWith(foreign, rootEl)
        expect(remote.text instanceof Text).toBe(false)
        expect(typeof (remote.form as any).nodeType).toBe('object')
        expect(rootEl.textContent).toBe('textelementfragmentfn textarray textarray elementjsx textjsx elementxy')
        expect(rootEl.querySelectorAll('form input').length).toBe(1)
        expect(rootEl.innerHTML).toBe(localEl.innerHTML)

        for (const {which, rows} of [local, remote]) {
            which('element')
            rows.push('z')
            rows.splice(0, 1)
        }
        await settle()
        expect(rootEl.querySelector('u')!.textContent).toBe('fn element')
        expect(rootEl.querySelector('ul')!.textContent).toBe('yz')
        expect(rootEl.innerHTML).toBe(localEl.innerHTML)

        local.root.destroy()
        remote.root.destroy()
        expect(rootEl.innerHTML).toBe('')
        expect(localEl.innerHTML).toBe('')
    })

    // createHost（公开导出）收到另一个 realm 的 Text 占位符：atom 文本与函数文本直接复用它，
    //  与当前 realm 的 Text 占位符（createElement 的函数 / atom child 快速路径）相同。
    test('a Text placeholder from another realm is reused by atom and function text', async () => {
        const root = createRoot(rootEl)
        root.render(<div id="slot"/>)
        const slot = document.getElementById('slot')!
        const value = atom('a')
        const hosts = [value, () => `${value()}!`].map(source => {
            const placeholder = foreign.createTextNode('')
            slot.appendChild(placeholder)
            const host = createHost(source, placeholder, root.pathContext)
            host.render()
            return host
        })
        expect(slot.childNodes.length).toBe(2)
        expect(slot.textContent).toBe('aa!')
        value('b')
        await settle()
        expect(slot.childNodes.length).toBe(2)
        expect(slot.textContent).toBe('bb!')
        hosts.forEach(host => host.destroy())
        expect(slot.childNodes.length).toBe(0)
        root.destroy()
    })

    // 组件的 $item:_use 覆写成另一个 realm 的元素
    test('an element from another realm as a $item:_use override', () => {
        const root = createRoot(rootEl)
        function App(_: any, {createElement}: RenderContext) {
            return <div><span as="inner">original</span></div>
        }
        const replacement = foreign.createElement('em')
        replacement.textContent = 'replaced'
        root.render(<App $inner:_use={replacement}/>)
        expect(rootEl.querySelector('div')!.innerHTML).toBe('<em>replaced</em>')
        root.destroy()
    })

    // 激活 iframe 文档里的服务端标记：认领到的节点（<!--root-->、元素、atom / 函数文本的 Text 占位符）
    //  都来自 iframe 的 realm，节点种类同样按 nodeType 判断。
    test.skipIf(pendingTopDown('B2'))('hydrating a container inside an iframe document', async () => {
        const count = atom(1)
        const label = atom('a')
        const items = new RxList(['x', 'y'])
        function App({}, {createElement, Fragment}: RenderContext) {
            return <section>
                <span>{count}</span>
                <em>{() => `${label()}!`}</em>
                {[<s>array</s>, 'text']}
                <ul>{items.map(item => <li>{item}</li>)}</ul>
                <Fragment>
                    <b>{count}</b>
                    <i>{() => label()}</i>
                </Fragment>
            </section>
        }
        const container = foreign.body.appendChild(foreign.createElement('div'))
        container.innerHTML = renderToString(createElement(App, null as any)).html
        const span = container.querySelector('span')!
        const em = container.querySelector('em')!
        const firstLi = container.querySelector('li')!
        const root = hydrate(container, createElement(App, null as any))
        expect(container.querySelector('span')).toBe(span)
        expect(container.querySelector('em')).toBe(em)
        expect(container.querySelector('li')).toBe(firstLi)
        const b = container.querySelector('b')!
        expect(container.querySelector('section')!.textContent).toBe('1a!arraytextxy1a')
        count(2)
        label('b')
        items.push('z')
        await settle()
        expect(span.textContent).toBe('2')
        expect(em.textContent).toBe('b!')
        expect(container.querySelector('ul')!.textContent).toBe('xyz')
        expect(container.querySelector('b')).toBe(b)
        expect(container.querySelector('section')!.textContent).toBe('2b!arraytextxyz2b')
        root.destroy()
        expect(container.querySelector('section')).toBe(null)
    })

    // 当前 realm 的 <form> 有名为 nodeType 的控件：form.nodeType 读到的是控件，仍然识别为元素
    test('guard: a form whose control is named "nodeType" is still an element', () => {
        const root = createRoot(rootEl)
        function Local() { return <form id="local"><input name="nodeType"/></form> }
        root.render(<div><Local/></div>)
        const form = rootEl.querySelector('form')!
        expect(typeof (form as any).nodeType).toBe('object')
        expect(form.parentElement!.tagName).toBe('DIV')
        root.destroy()
        expect(rootEl.innerHTML).toBe('')
    })
})

describe('#58-5: bulk row removal keeps a node a cleanup prepended when the first row removed its own text', () => {
    function Item({item}: {item: string}, {onCleanup}: RenderContext) {
        onCleanup(() => { document.getElementById('ul')!.prepend(document.createElement('hr')) })
        return <li>{item}</li>
    }

    test('replaceChildren path: the list is the only content of its parent', () => {
        const root = createRoot(rootEl)
        const list = new RxList<string>(['text', 'item'])
        root.render(<ul id="ul">{list.map(item => item === 'text' ? item : <Item item={item}/>)}</ul>)
        expect(rootEl.textContent).toBe('textitem')
        list.clear()
        expect(document.getElementById('ul')!.innerHTML).toBe('<hr><!--unhandledChild-->')
        list.push('again')
        expect(document.getElementById('ul')!.textContent).toBe('again')
        root.destroy()
    })

    test('Range path: the list has a static sibling after it', () => {
        const root = createRoot(rootEl)
        const list = new RxList<string>(['text', 'item'])
        root.render(<ul id="ul">{list.map(item => item === 'text' ? item : <Item item={item}/>)}<li>tail</li></ul>)
        list.clear()
        expect(document.getElementById('ul')!.innerHTML).toBe('<hr><!--unhandledChild--><li>tail</li>')
        root.destroy()
    })

    // 同一处理也在数组内容的整段删除里：第一项是 boolean（PrimitiveHost，destroy(true) 摘掉自己的空文本）
    test('array content: the first item removed its own text', async () => {
        const root = createRoot(rootEl)
        const show = atom(true)
        function Cleanup(_: any, {onCleanup}: RenderContext) {
            onCleanup(() => { document.getElementById('d')!.prepend(document.createElement('hr')) })
            return <i>item</i>
        }
        root.render(<div id="d">{() => show() ? [false, <Cleanup/>] : null}</div>)
        expect(document.getElementById('d')!.textContent).toBe('item')
        show(false)
        await settle()
        const d = document.getElementById('d')!
        expect(d.firstChild!.nodeName).toBe('HR')
        expect(d.textContent).toBe('')
        root.destroy()
    })

    test('Range path: a partial removal from the front', () => {
        const root = createRoot(rootEl)
        const list = new RxList<string>(['text', 'item', 'kept'])
        root.render(<ul id="ul">{list.map(item => item === 'text' ? item : <Item item={item}/>)}</ul>)
        list.splice(0, 2)
        const ul = document.getElementById('ul')!
        expect(ul.firstChild!.nodeName).toBe('HR')
        expect(ul.textContent).toBe('kept')
        root.destroy()
    })
})
