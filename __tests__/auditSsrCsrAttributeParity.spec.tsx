/** @jsx createElement */
/**
 * SSR ≡ CSR for the attribute rules: the server markup, parsed by the browser, must give the same
 * attributes as a client render of the same JSX. The server has no DOM to ask for a property's
 * type, so it follows a static table; this spec is what keeps the two sides from drifting apart.
 */
import {atom, configureDiagnostics, createElement, createRoot, hydrateRoot, RenderContext} from '@framework'
import {describe, expect, test, vi} from 'vitest'
import {renderToString} from '../src/ssr.js'

function attributesOf(root: Element): string[] {
    const out: string[] = []
    const walk = (el: Element, path: string) => {
        // style 比较解析后的声明（CSSOM 序列化），不比较属性里的原始文本：服务端写 `color:red`，
        // 客户端经 CSSOM 写出 `color: red;`，两者是同一份声明。
        const attrs = Array.from(el.attributes).map(a =>
            `${a.name}=${JSON.stringify(a.name === 'style' ? (el as HTMLElement).style.cssText : a.value)}`
        ).sort().join(' ')
        out.push(`${path}<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`)
        Array.from(el.children).forEach((child, i) => walk(child, `${path}${i}.`))
    }
    Array.from(root.children).forEach((child, i) => walk(child, `${i}.`))
    return out
}
function both(App: any) {
    const server = document.createElement('div')
    server.innerHTML = renderToString(createElement(App, null as any)).html
    const client = document.createElement('div')
    document.body.appendChild(client)
    const root = createRoot(client)
    root.render(createElement(App, null as any))
    const result = {server: attributesOf(server), client: attributesOf(client)}
    root.destroy()
    client.remove()
    return result
}
function expectParity(App: any) {
    const {server, client} = both(App)
    expect(server).toEqual(client)
}

describe('server markup parses to the attributes a client render writes', () => {
    test('true on string-typed properties; keyword attributes keep their keyword', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <a download href title>x</a>
                <div popover>p</div>
                <img alt/>
                <input placeholder/>
                <div contentEditable aria-hidden draggable spellcheck data-on>k</div>
            </div>
        })
    })
    test('false / undefined', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <a title={false} href={undefined} download={false} hidden={false}>x</a>
                <div spellCheck={false} contentEditable={false} draggable={false} aria-expanded={false} data-on={false}>k</div>
                <p spellcheck={false} contenteditable={false}>p</p>
            </div>
        })
    })
    test('checkbox: only a boolean or nullish value is a checked state', () => {
        const checkedOf = (root: Element) => Array.from(root.querySelectorAll('input')).map(i => [i.value, i.checked])
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input type="checkbox" value="red"/>
                <input type="checkbox" value={1}/>
                <input type="checkbox" value={true}/>
                <input type="checkbox" value={false}/>
                <input type="checkbox" value="red" checked/>
                <input type="checkbox" checked={false} value="red"/>
                <input type="checkbox" value={() => 'red'} checked={atom(true)}/>
            </div>
        }
        const server = document.createElement('div')
        server.innerHTML = renderToString(createElement(App, null as any)).html
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(createElement(App, null as any))
        expect(checkedOf(server)).toEqual(checkedOf(client))
        root.destroy()
        client.remove()
    })
    test('SVG presentation attributes are dash-converted by exact name on both sides', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <svg viewBox="0 0 10 10" preserveAspectRatio="none">
                <path d="M0 0h10" fillRule="evenodd" clipRule="evenodd" strokeWidth={2} strokeLinecap="round" fillOpacity={0.5}/>
                <linearGradient gradientUnits="userSpaceOnUse"><stop stopColor="red" stopOpacity={0.5}/></linearGradient>
                <text textAnchor="middle" dominantBaseline="central" fontSize={12}>t</text>
            </svg>
        })
    })
    test('uuid, htmlFor, hidden, ariaLabel', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <i uuid="u1"/>
                <i uuid={null}/>
                <label htmlFor="q">l</label>
                <label htmlFor={false}>l</label>
                <div hidden>h</div>
                <button ariaLabel="close">x</button>
            </div>
        })
    })
    test('data-*: literal authored name, arrays stringified whole', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <i data-item_id={atom('7')} data-level-1={() => 'x'} data-camelCase={atom(1)}/>
                <i data-x={[1, 2]} data-n={() => null} data-f={atom(false)}/>
            </div>
        })
    })
    test('class and style shapes', () => {
        expectParity(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <i className={['a', 'b']}/>
                <i className={{active: atom(false), base: true}}/>
                <i className={['card', ['x', false && 'y', 'z']]}/>
                <i className={['base', () => ['x', 'y']]}/>
                <i style={{color: 'red', width: 10}}/>
            </div>
        })
    })
})

/**
 * #49：名字以 on 开头（不区分大小写）、但不是合法事件处理器（isEventName 且值为函数 / 函数数组）的 prop，
 * 两端都不写——HTML 的属性名大小写不敏感，ONCLICK / oNclick 写出去解析后就是可执行的 onclick。
 * spread 不可信对象（<div {...untrusted}/>）是这一类的入口。每个名字单独放在一个元素上：
 * ONCLICK / oNclick / onclick 解析成同一个 onclick，放在一起会互相覆盖、掩盖其中某一个的写出。
 */
describe('#49 on* props that are not event handlers are written on neither side', () => {
    const HIT = '__axii49hit'
    const SCRIPT = `window.${HIT}=(window.${HIT}||0)+1`
    // 名字长于 2 的 on* 属性（单独的 on 不是事件属性，见下面的 AMP 用例）
    const ON_ATTR = /^on./i
    const STRING_NAMES = ['ONCLICK', 'oNclick', 'onclick', 'OnClick', 'once', 'online', 'on-click']
    const FUNCTION_NAMES = ['ONCLICK', 'oNclick', 'onclick', 'OnClick', 'once']
    function onAttributesOf(root: Element): string[] {
        const out: string[] = []
        for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            for (const a of Array.from(el.attributes)) {
                if (ON_ATTR.test(a.name)) out.push(`${el.tagName.toLowerCase()}#${el.id} ${a.name}=${a.value}`)
            }
        }
        return out
    }
    // 元素上的事件处理器 IDL property（onclick）也不能被设上：小写 onclick 在 HTML 元素上走的是 property 分支
    function liveHandlersOf(root: Element): string[] {
        return Array.from(root.querySelectorAll('[id]'))
            .filter(el => (el as HTMLElement).onclick != null)
            .map(el => el.id)
    }
    function clickAll(root: Element) {
        for (const el of Array.from(root.querySelectorAll('[id]'))) {
            el.dispatchEvent(new MouseEvent('click', {bubbles: false}))
        }
    }
    function renderClient(node: any) {
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(node)
        return {client, root}
    }
    function renderServer(node: any) {
        const server = document.createElement('div')
        server.innerHTML = renderToString(node).html
        return server
    }
    function quietly<T>(run: () => T): T {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            return run()
        } finally {
            consoleError.mockRestore()
        }
    }

    test('string values: no on* attribute on the client, no handler runs on click', () => {
        delete (window as any)[HIT]
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {STRING_NAMES.map(name => <div id={`div-${name}`} {...{[name]: SCRIPT}}/>)}
                {STRING_NAMES.map(name => <svg id={`svg-${name}`} {...{[name]: SCRIPT}}/>)}
                {STRING_NAMES.map(name => <x-axii-49 id={`ce-${name}`} {...{[name]: SCRIPT}}/>)}
            </div>
        }
        quietly(() => {
            const {client, root} = renderClient(<App/>)
            clickAll(client)
            expect({attrs: onAttributesOf(client), live: liveHandlersOf(client), hit: (window as any)[HIT]})
                .toEqual({attrs: [], live: [], hit: undefined})
            root.destroy()
            client.remove()
        })
    })

    test('string values: the server HTML parses to an element without any on* attribute', () => {
        delete (window as any)[HIT]
        const untrusted = Object.fromEntries(STRING_NAMES.map(name => [name, SCRIPT]))
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {STRING_NAMES.map(name => <div id={`div-${name}`} {...{[name]: SCRIPT}}/>)}
                {STRING_NAMES.map(name => <svg id={`svg-${name}`} {...{[name]: SCRIPT}}/>)}
                {STRING_NAMES.map(name => <x-axii-49 id={`ce-${name}`} {...{[name]: SCRIPT}}/>)}
                <p id="spread" {...untrusted}/>
            </div>
        }
        quietly(() => {
            const server = renderServer(<App/>)
            document.body.appendChild(server)
            clickAll(server)
            expect({attrs: onAttributesOf(server), live: liveHandlersOf(server), hit: (window as any)[HIT]})
                .toEqual({attrs: [], live: [], hit: undefined})
            server.remove()
        })
    })

    test('function values: never called, never bound, never written (client and server)', () => {
        delete (window as any)[HIT]
        const calls: string[] = []
        // 返回一个函数：曾经被当成响应式属性求值，返回值赋给 el.onclick 成为真正生效的 handler
        const valueOf = (name: string) => () => {
            calls.push(`render:${name}`)
            return () => calls.push(`click:${name}`)
        }
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                {FUNCTION_NAMES.map(name => <div id={`div-${name}`} {...{[name]: valueOf(name)}}/>)}
                {FUNCTION_NAMES.map(name => <svg id={`svg-${name}`} {...{[name]: valueOf(name)}}/>)}
                <div id="div-array" onclick={[valueOf('array-a'), valueOf('array-b')]}/>
            </div>
        }
        quietly(() => {
            const server = renderServer(<App/>)
            const {client, root} = renderClient(<App/>)
            clickAll(client)
            expect({
                server: onAttributesOf(server),
                client: onAttributesOf(client),
                live: liveHandlersOf(client),
                calls,
            }).toEqual({server: [], client: [], live: [], calls: []})
            root.destroy()
            client.remove()
        })
    })

    test('reactive values are not bound as attributes: atom / function never read, updates never written', () => {
        let reads = 0
        const script = atom(SCRIPT)
        const flag = atom('yes')
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <div id="atom-lower" onclick={script}/>
                <div id="atom-upper" ONCLICK={script}/>
                <svg id="atom-svg" onclick={script}/>
                <div id="atom-online" online={flag}/>
                <div id="fn-upper" ONCLICK={() => { reads++; return script() }}/>
            </div>
        }
        quietly(() => {
            const {client, root} = renderClient(<App/>)
            const before = onAttributesOf(client)
            script(`${SCRIPT};1`)
            flag('no')
            expect({before, after: onAttributesOf(client), live: liveHandlersOf(client), reads})
                .toEqual({before: [], after: [], live: [], reads: 0})
            root.destroy()
            client.remove()
        })
    })

    test('server and client agree: on* names dropped on both sides, a bare `on` (AMP on="tap:…") kept on both', () => {
        quietly(() => {
            const {server, client} = both(function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <div once="x" online="y" onlyIcon="z" on-click="w"/>
                    <div ONCLICK={SCRIPT}/>
                    <button on="tap:lightbox"/>
                </div>
            })
            expect({server, client}).toEqual({
                server: client,
                client: ['0.<div>', '0.0.<div>', '0.1.<div>', '0.2.<button on="tap:lightbox">'],
            })
        })
    })

    test('SVG xlink-prefixed names that become on* once the prefix is stripped are dropped on both sides', () => {
        delete (window as any)[HIT]
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <svg id="xlink-fn" xlinkOnclick={() => () => { (window as any)[HIT] = 'fn' }}/>
                <svg id="xlink-colon-fn" {...{'xlink:onclick': () => () => { (window as any)[HIT] = 'fn' }}}/>
                <svg id="xlink-str" xlinkOnclick={SCRIPT}/>
                <svg id="xlink-colon-str" {...{'xlink:ONCLICK': SCRIPT}}/>
            </div>
        }
        quietly(() => {
            const server = renderServer(<App/>)
            const {client, root} = renderClient(<App/>)
            clickAll(client)
            expect({
                client: onAttributesOf(client),
                live: liveHandlersOf(client),
                parity: attributesOf(server),
            }).toEqual({client: [], live: [], parity: attributesOf(client)})
            root.destroy()
            client.remove()
        })
    })

    test('hydrateRoot over the server HTML leaves no on* attribute and still binds real events', () => {
        delete (window as any)[HIT]
        const calls: string[] = []
        const script = atom(SCRIPT)
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <div id="h-upper" ONCLICK={SCRIPT}/>
                <div id="h-mixed" oNclick={() => { calls.push('render'); return () => calls.push('click') }}/>
                <div id="h-once" once="x"/>
                <svg id="h-svg" onclick={script}/>
                <button id="h-event" onClick={() => calls.push('onClick')}/>
            </div>
        }
        quietly(() => {
            const container = renderServer(<App/>)
            document.body.appendChild(container)
            const root = hydrateRoot(container, <App/>)
            clickAll(container)
            expect({
                attrs: onAttributesOf(container),
                live: liveHandlersOf(container),
                hit: (window as any)[HIT],
                calls,
            }).toEqual({attrs: [], live: [], hit: undefined, calls: ['onClick']})
            root.destroy()
            container.remove()
        })
    })

    test('real event handlers still bind: function, function array, capture, conditional falsy', () => {
        const calls: string[] = []
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <button id="single" onClick={() => calls.push('single')}/>
                <button id="array" onClick={[() => calls.push('a'), false, () => calls.push('b')]}/>
                <button id="capture" onClickCapture={() => calls.push('capture')}/>
                <button id="falsy" onClick={false}/>
                <button id="nullish" onClick={null}/>
                <button id="array-conditions" onClick={[() => calls.push('cond'), true, null, [false, undefined]]}/>
            </div>
        }
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const server = renderServer(<App/>)
            const {client, root} = renderClient(<App/>)
            clickAll(client)
            expect({
                server: onAttributesOf(server),
                client: onAttributesOf(client),
                calls,
                warned: consoleError.mock.calls.length,
            }).toEqual({server: [], client: [], calls: ['single', 'a', 'b', 'capture', 'cond'], warned: 0})
            root.destroy()
            client.remove()
        } finally {
            consoleError.mockRestore()
        }
    })

    test('dev warning: exactly once per prop name on the client, also for an event name with a non-function value', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <div onclientwarn49="a"/>
                    <div onclientwarn49="b"/>
                    <svg onclientwarn49={() => 'c'}/>
                    <div onAuxClick="alert(1)"/>
                    <div onAuxClick="alert(2)"/>
                    <div onPointerLeave={[() => {}, 0]}/>
                </div>
            }
            const {client, root} = renderClient(<App/>)
            root.destroy()
            client.remove()
            const second = renderClient(<App/>)
            second.root.destroy()
            second.client.remove()
            const messages = consoleError.mock.calls.map(args => String(args[0]))
            expect({
                dropped: messages.filter(m => m.includes('"onclientwarn49"')).length,
                eventName: messages.filter(m => m.includes('"onAuxClick"')).length,
                calledFalsyItem: messages.filter(m => m.includes('"onPointerLeave"')).length,
                prefixed: messages.every(m => m.startsWith('[axii]')),
            }).toEqual({dropped: 1, eventName: 1, calledFalsyItem: 1, prefixed: true})
        } finally {
            consoleError.mockRestore()
        }
    })

    test('dev warning: exactly once per prop name on the server', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            // 组件里的 createElement 是 SSR 自己的（RenderContext），不会在浏览器里先建出 DOM 元素
            function App({}: any, {createElement}: RenderContext) {
                return <div>
                    <div ONSERVERWARN49="a"/>
                    <div ONSERVERWARN49="b"/>
                </div>
            }
            renderToString(<App/>)
            renderToString(<App/>)
            const messages = consoleError.mock.calls.map(args => String(args[0]))
            expect(messages.filter(m => m.includes('"ONSERVERWARN49"')).length).toBe(1)
        } finally {
            consoleError.mockRestore()
        }
    })

    test('diagnostics off (production): no warning, names still dropped on both sides', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        configureDiagnostics({enabled: false})
        try {
            function App({}: any, {createElement}: RenderContext) {
                return <div><div id="off" onprodwarn49={SCRIPT} ONCLICK={SCRIPT}/></div>
            }
            const server = renderServer(<App/>)
            const {client, root} = renderClient(<App/>)
            expect({
                server: onAttributesOf(server),
                client: onAttributesOf(client),
                warned: consoleError.mock.calls.length,
            }).toEqual({server: [], client: [], warned: 0})
            root.destroy()
            client.remove()
        } finally {
            configureDiagnostics({})
            consoleError.mockRestore()
        }
    })
})
