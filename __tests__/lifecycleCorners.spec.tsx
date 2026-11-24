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
    createRoot,
    hydrateRoot,
    RenderContext,
    RxList,
} from "@framework";
import {renderToString} from '../src/ssr.js'

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

    test('components, function children, array items and list rows may return them', async () => {
        const text = foreign.createTextNode('text')
        const comment = foreign.createComment('comment')
        const element = foreign.createElement('b')
        element.textContent = 'element'
        const fragment = foreign.createDocumentFragment()
        fragment.append(foreign.createElement('i'), foreign.createTextNode('fragment'))
        expect(text instanceof Text).toBe(false)

        const root = createRoot(rootEl)
        function ReturnsText() { return text as any }
        function ReturnsComment() { return comment as any }
        function ReturnsElement() { return element as any }
        function ReturnsFragment() { return fragment as any }
        const which = atom<'text' | 'element'>('text')
        const fnText = foreign.createTextNode('fn text')
        const fnElement = foreign.createElement('u')
        fnElement.textContent = 'fn element'
        const arrayText = foreign.createTextNode('array text')
        const arrayElement = foreign.createElement('s')
        arrayElement.textContent = 'array element'
        const rows = new RxList(['x', 'y'])
        // <form> 的同名控件遮蔽 form.nodeType（[LegacyOverrideBuiltIns]），读到的是那个控件
        const form = foreign.createElement('form')
        const input = foreign.createElement('input')
        input.name = 'nodeType'
        form.appendChild(input)
        expect(typeof (form as any).nodeType).toBe('object')
        function ReturnsForm() { return form as any }
        root.render(<div>
            <p id="components"><ReturnsText/><ReturnsComment/><ReturnsElement/><ReturnsFragment/><ReturnsForm/></p>
            <p id="fn">{() => which() === 'text' ? fnText : fnElement}</p>
            <p id="array">{[arrayText, arrayElement] as any}</p>
            <ul id="rows">{rows.map(item => {
                const li = foreign.createElement('li')
                li.textContent = item
                return li as any
            })}</ul>
        </div>)
        const html = (id: string) => document.getElementById(id)!.innerHTML.replace(/<!--(?!comment)[^>]*-->/g, '')
        expect(html('components')).toBe('text<!--comment--><b>element</b><i></i>fragment<form><input name="nodeType"></form>')
        expect(html('fn')).toBe('fn text')
        expect(html('array')).toBe('array text<s>array element</s>')
        expect(html('rows')).toBe('<li>x</li><li>y</li>')

        which('element')
        rows.push('z')
        rows.splice(0, 1)
        await settle()
        expect(html('fn')).toBe('<u>fn element</u>')
        expect(html('rows')).toBe('<li>y</li><li>z</li>')

        root.destroy()
        expect(rootEl.innerHTML).toBe('')
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

    // 激活 iframe 文档里的服务端标记：认领到的占位符（<!--root-->、atom / 函数文本的 Text）都来自
    //  iframe 的 realm，占位符的种类同样按 nodeType 判断。
    test('hydrating a container inside an iframe document', async () => {
        const count = atom(1)
        const label = atom('a')
        function App({}, {createElement}: RenderContext) {
            return <p>
                <span>{count}</span>
                <em>{() => `${label()}!`}</em>
            </p>
        }
        const container = foreign.body.appendChild(foreign.createElement('div'))
        container.innerHTML = renderToString(createElement(App, null as any)).html
        const span = container.querySelector('span')!
        const em = container.querySelector('em')!
        const root = hydrateRoot(container, createElement(App, null as any))
        expect(container.querySelector('span')).toBe(span)
        expect(container.querySelector('em')).toBe(em)
        expect(span.textContent).toBe('1')
        expect(em.textContent).toBe('a!')
        count(2)
        label('b')
        await settle()
        expect(span.textContent).toBe('2')
        expect(em.textContent).toBe('b!')
        root.destroy()
        expect(container.querySelector('p')).toBe(null)
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
