/** @jsx createElement */
/**
 * SSR ≡ CSR for the attribute rules: the server markup, parsed by the browser, must give the same
 * attributes as a client render of the same JSX. The server has no DOM to ask for a property's
 * type, so it follows a static table; this spec is what keeps the two sides from drifting apart.
 */
import {atom, configureDiagnostics, createElement, createRoot, RenderContext} from '@framework'
import {describe, expect, test, vi} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {htmlPropertyTypeEntries, type HtmlPropertyType} from '../src/htmlPropertyTypes.js'
import {hydrate, pendingTopDown} from './helpers/hydrate'

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
    test('checkbox: only a boolean value is a checked state, and only without a checked prop (#52)', () => {
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
            const root = hydrate(container, <App/>)
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

/**
 * #52：复选框 / 单选框上 nullish 的 value 不触碰勾选状态；只有 boolean 的 value 仍是复选框旧的勾选通道；
 * 显式的 checked 永远生效，与书写顺序无关（value 在前或在后、静态或响应式都一样）。
 * 静态矩阵同时比对三份结果：客户端渲染、解析服务端 HTML、在服务端 HTML 上 hydrate。
 * 单选框的 value 从来不是勾选通道（§3.6.2 F-F5），同一组场景在单选框上作对照。
 */
describe('#52 checkbox / radio: a nullish value never touches the checked state, an explicit checked always wins', () => {
    async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve() }
    const stateOf = (root: Element) => Object.fromEntries(
        Array.from(root.querySelectorAll('input')).map(i => [i.id, [i.value, i.checked]]))
    // 失败时直接列出哪个 id 的 [.value, .checked] 不对
    function expectMatrix(root: Element) {
        const actual = stateOf(root)
        expect(Object.keys(actual).sort()).toEqual(Object.keys(EXPECTED).sort())
        expect(Object.keys(EXPECTED)
            .filter(id => JSON.stringify(actual[id]) !== JSON.stringify(EXPECTED[id]))
            .map(id => `${id}: ${JSON.stringify(actual[id])}, expected ${JSON.stringify(EXPECTED[id])}`)).toEqual([])
    }

    // [id 后缀, props（键序即书写顺序）, 复选框的 .checked, 单选框的 .checked, .value]
    const MATRIX: [string, any, boolean, boolean, string][] = [
        ['ck1-vu', {checked: true, value: undefined}, true, true, ''],
        ['vu-ck1', {value: undefined, checked: true}, true, true, ''],
        ['ck1-vn', {checked: true, value: null}, true, true, ''],
        ['vn-ck1', {value: null, checked: true}, true, true, ''],
        ['ck0-vu', {checked: false, value: undefined}, false, false, ''],
        ['vu-ck0', {value: undefined, checked: false}, false, false, ''],
        ['ckU-vu', {checked: undefined, value: undefined}, false, false, ''],
        // 显式 checked 与 boolean value 冲突：checked 胜出，与书写顺序无关
        ['ck0-v1', {checked: false, value: true}, false, false, 'true'],
        ['v1-ck0', {value: true, checked: false}, false, false, 'true'],
        ['ck1-v0', {checked: true, value: false}, true, true, 'false'],
        ['v0-ck1', {value: false, checked: true}, true, true, 'false'],
        // checked={undefined} 也是显式的 checked prop：boolean value 不再参与（转发组件 <Check value={true}/> 是未勾选）
        ['ckU-v1', {checked: undefined, value: true}, false, false, 'true'],
        ['v1-ckU', {value: true, checked: undefined}, false, false, 'true'],
        // 只有 value：boolean 是复选框旧的勾选通道（行为不变），nullish 不勾选
        ['v1', {value: true}, true, false, 'true'],
        ['v0', {value: false}, false, false, 'false'],
        ['vu', {value: undefined}, false, false, ''],
        ['vn', {value: null}, false, false, ''],
        ['red-ck1', {value: 'red', checked: true}, true, true, 'red'],
        // 响应式值的首帧（服务端取快照，客户端是绑定的初始求值）
        ['rck1-rvu', {checked: atom(true), value: atom(undefined)}, true, true, ''],
        ['rvu-rck1', {value: () => undefined, checked: () => true}, true, true, ''],
        ['rck0-rv1', {checked: atom(false), value: atom(true)}, false, false, 'true'],
        ['rv1-rck0', {value: atom(true), checked: atom(false)}, false, false, 'true'],
    ]
    // 组件把 checked / value 原样转发给 input：调用方不传的那个就是 undefined（issue 的场景 2）
    function CheckedFirst({id, type, checked, value}: any, {createElement}: RenderContext) {
        return <input id={id} type={type} checked={checked} value={value}/>
    }
    function ValueFirst({id, type, checked, value}: any, {createElement}: RenderContext) {
        return <input id={id} type={type} value={value} checked={checked}/>
    }
    function App({}: any, {createElement}: RenderContext) {
        return <div>
            {MATRIX.map(([id, props]) => <input id={`cb-${id}`} type="checkbox" {...props}/>)}
            {MATRIX.map(([id, props]) => <input id={`ra-${id}`} type="radio" {...props}/>)}
            <CheckedFirst id="cb-fwd-ck-first" type="checkbox" checked={true}/>
            <ValueFirst id="cb-fwd-v-first" type="checkbox" checked={true}/>
            <CheckedFirst id="ra-fwd-ck-first" type="radio" checked={true}/>
            <ValueFirst id="ra-fwd-v-first" type="radio" checked={true}/>
        </div>
    }
    const EXPECTED: Record<string, any> = {
        ...Object.fromEntries(MATRIX.map(([id, , cb, , value]) => [`cb-${id}`, [value, cb]])),
        ...Object.fromEntries(MATRIX.map(([id, , , ra, value]) => [`ra-${id}`, [value, ra]])),
        'cb-fwd-ck-first': ['', true], 'cb-fwd-v-first': ['', true],
        'ra-fwd-ck-first': ['', true], 'ra-fwd-v-first': ['', true],
    }

    test('client render', () => {
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(<App/>)
        expectMatrix(client)
        root.destroy()
        client.remove()
    })

    test('server HTML parsed by the browser', () => {
        const server = document.createElement('div')
        server.innerHTML = renderToString(<App/>).html
        expectMatrix(server)
    })

    test.skipIf(pendingTopDown('B2'))('hydrateRoot over the server HTML', () => {
        const container = document.createElement('div')
        container.innerHTML = renderToString(<App/>).html
        document.body.appendChild(container)
        const root = hydrate(container, <App/>)
        expectMatrix(container)
        root.destroy()
        container.remove()
    })

    test('reactive submit value going nullish keeps the tick: explicit checked, user tick, after hydration', async () => {
        const values = {a: atom<any>('red'), b: atom<any>('red'), c: atom<any>('red'), r: atom<any>('red'), h: atom<any>('red')}
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(<div>
            <input id="a" type="checkbox" checked={true} value={values.a}/>
            <input id="b" type="checkbox" value={values.b} checked={true}/>
            <input id="c" type="checkbox" value={values.c}/>
            <input id="r" type="radio" checked={true} value={values.r}/>
        </div>)
        ;(client.querySelector('#c') as HTMLInputElement).checked = true
        values.a(undefined)
        values.b(null)
        values.c(undefined)
        values.r(undefined)
        await settle()
        expect(stateOf(client)).toEqual({a: ['', true], b: ['', true], c: ['', true], r: ['', true]})
        root.destroy()
        client.remove()

        function Hydrated({}: any, {createElement}: RenderContext) {
            return <div><input id="h" type="checkbox" value={values.h} checked={true}/></div>
        }
        const container = document.createElement('div')
        container.innerHTML = renderToString(<Hydrated/>).html
        document.body.appendChild(container)
        const hydrated = hydrate(container, <Hydrated/>)
        values.h(undefined)
        await settle()
        expect(stateOf(container)).toEqual({h: ['', true]})
        hydrated.destroy()
        container.remove()
    })

    test('reactive boolean value never overrides an explicit checked, in either order or after a type flip', async () => {
        const b1 = atom(true), b2 = atom(true), b3 = atom(false)
        const ck = atom(false)
        const type = atom('text')
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(<div>
            <input id="a" type="checkbox" checked={false} value={b1}/>
            <input id="b" type="checkbox" value={b2} checked={false}/>
            <input id="c" type="checkbox" checked={true} value={b3}/>
            <input id="d" type="checkbox" value={true} checked={ck}/>
            <input id="e" type={type} checked={false} value={true}/>
        </div>)
        const checkedOf = () => Object.fromEntries(Object.entries(stateOf(client)).map(([id, [, c]]) => [id, c]))
        expect(checkedOf()).toEqual({a: false, b: false, c: true, d: false, e: false})
        b1(false); b2(false); b3(true)
        await settle()
        b1(true); b2(true); b3(false)
        await settle()
        ck(true)
        await settle()
        expect(checkedOf()).toEqual({a: false, b: false, c: true, d: true, e: false})
        ck(false)
        // type 翻转成 checkbox 会按新 type 重放存下的 value（true）：显式 checked={false} 仍然胜出
        type('checkbox')
        await settle()
        expect(checkedOf()).toEqual({a: false, b: false, c: true, d: false, e: false})
        root.destroy()
        client.remove()
    })

    test('boolean value as the only checked channel: unchanged, except that going nullish leaves the tick alone', async () => {
        const on = atom<boolean | null | undefined>(true)
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(<div><input id="a" type="checkbox" value={on}/></div>)
        const checked = () => (client.querySelector('#a') as HTMLInputElement).checked
        const seen = [checked()]
        on(false); await settle(); seen.push(checked())
        on(true); await settle(); seen.push(checked())
        on(null); await settle(); seen.push(checked())
        on(undefined); await settle(); seen.push(checked())
        on(false); await settle(); seen.push(checked())
        expect(seen).toEqual([true, false, true, true, true, false])
        root.destroy()
        client.remove()
    })
})

/**
 * #51：服务端的属性写法以「客户端会产生什么」为准。客户端按 property 的运行时类型写 boolean
 * （setEmptyOrBooleanProperty），服务端没有 DOM，用 markupNames 里同一条写入规则 + 一份按元素区分的静态类型表。
 * 每个场景比对三份结果：客户端渲染、浏览器解析服务端 HTML、在服务端 HTML 上 hydrate。
 * 比对内容是 attribute（名字 + 值）与表单相关的 IDL（value / checked / defaultValue / defaultChecked / selected …）。
 */
describe('#51 one attribute rule for both sides: server markup parses to what the client writes', () => {
    // 比对的范围：'full' = attribute + 全部表单 IDL；'idl' = 全部表单 IDL；'live' = 只比当前状态
    //  （value / checked / selected / muted）——default* 与驱动同一状态的 prop 同时出现时，HTML 只能写出一个，
    //  解析后的 defaultValue / defaultChecked / defaultMuted 无法同时与客户端一致。
    type Scope = 'full' | 'idl' | 'live'
    function idlOf(el: Element, scope: Scope): string {
        const out: string[] = []
        const any = el as any
        const defaults = scope !== 'live'
        if (el instanceof HTMLInputElement) {
            out.push(`value=${JSON.stringify(el.value)}`, `checked=${el.checked}`)
            if (defaults) out.push(`defaultValue=${JSON.stringify(el.defaultValue)}`, `defaultChecked=${el.defaultChecked}`)
        } else if (el instanceof HTMLTextAreaElement) {
            out.push(`value=${JSON.stringify(el.value)}`)
            if (defaults) out.push(`defaultValue=${JSON.stringify(el.defaultValue)}`)
        } else if (el instanceof HTMLSelectElement) {
            out.push(`value=${JSON.stringify(el.value)}`)
        } else if (el instanceof HTMLOptionElement) {
            out.push(`selected=${el.selected}`, `value=${JSON.stringify(el.value)}`)
        } else if (el instanceof HTMLMediaElement) {
            // 解析器创建的媒体元素按创建时的 muted attribute 设 .muted，脚本创建的不会（attribute 后加不影响 .muted）：
            //  attribute 相同时 .muted 也可能不同，HTML 表达不了。只在 'live' 里比 .muted（muted prop 两端都设了它）。
            out.push(defaults ? `defaultMuted=${el.defaultMuted}` : `muted=${el.muted}`)
        } else if (any.open !== undefined && (el instanceof HTMLDetailsElement || el instanceof HTMLDialogElement)) {
            out.push(`open=${any.open}`)
        }
        return out.join(' ')
    }
    // 按 id 收集：attribute（排序后的 name=value）与 IDL
    function stateOf(root: Element, scope: Scope): Record<string, string> {
        const out: Record<string, string> = {}
        for (const el of Array.from(root.querySelectorAll('[id]'))) {
            const attrs = scope === 'full'
                ? Array.from(el.attributes).filter(a => a.name !== 'id')
                    .map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
                : ''
            out[el.id] = `${attrs} | ${idlOf(el, scope)}`
        }
        return out
    }
    function clientState(App: any, scope: Scope) {
        const client = document.createElement('div')
        document.body.appendChild(client)
        const root = createRoot(client)
        root.render(createElement(App, null as any))
        const state = stateOf(client, scope)
        root.destroy()
        client.remove()
        return state
    }
    function serverState(App: any, scope: Scope) {
        const server = document.createElement('div')
        server.innerHTML = renderToString(createElement(App, null as any)).html
        return stateOf(server, scope)
    }
    function hydratedState(App: any, scope: Scope) {
        const errors: unknown[] = []
        configureDiagnostics({enabled: true, onError: e => { errors.push(e) }})
        try {
            const container = document.createElement('div')
            container.innerHTML = renderToString(createElement(App, null as any)).html
            document.body.appendChild(container)
            const root = hydrate(container, createElement(App, null as any))
            const state = stateOf(container, scope)
            root.destroy()
            container.remove()
            return {state, errors: errors.map(e => String((e as any)?.message ?? e))}
        } finally {
            configureDiagnostics({})
        }
    }
    // 服务端按 serverScope 比对；hydrate 之后客户端把所有 prop 重新应用一遍，按 hydratedScope 比对
    function expectThreeWay(App: any, serverScope: Scope = 'full', hydratedScope: Scope = serverScope) {
        expect(serverState(App, serverScope)).toEqual(clientState(App, serverScope))
        expect(hydratedState(App, hydratedScope)).toEqual({state: clientState(App, hydratedScope), errors: []})
    }

    test('the issue table: boolean attributes, defaultValue / defaultChecked, tabIndex, min / step, href on a div', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input id="required" required/>
                <input id="readOnly" readOnly/>
                <details id="open" open><summary>s</summary></details>
                <input id="defaultValue" defaultValue="x"/>
                <textarea id="textarea" defaultValue="t"/>
                <input id="defaultChecked" type="checkbox" defaultChecked/>
                <div id="tabIndex" tabIndex={true}>t</div>
                <input id="minStep" type="number" min={true} step={true}/>
                <div id="href" href={true}>h</div>
            </div>
        })
    })

    test('the same names with false: omitted on both sides', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input id="required" required={false} readOnly={false} min={false} step={false}/>
                <details id="open" open={false}><summary>s</summary></details>
                <input id="defaultValue" defaultValue={false}/>
                <textarea id="textarea" defaultValue={false}/>
                <input id="defaultChecked" type="checkbox" defaultChecked={false}/>
                <div id="tabIndex" tabIndex={false}>t</div>
                <div id="href" href={false}>h</div>
            </div>
        })
    })

    test('number-typed properties write 1 for true; string-typed ones write ""; the type depends on the element', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input id="maxLength" maxLength={true} size={true}/>
                <textarea id="rows" rows={true} cols={true}/>
                <img id="img" width={true} height={true}/>
                <iframe id="iframe" width={true} height={true}/>
                <meter id="meter" min={true} max={true} low={true}/>
                <ol id="ol" start={true} reversed><li>a</li></ol>
                <table><tbody><tr><td id="td" colSpan={true} rowSpan={true}>c</td></tr></tbody></table>
            </div>
        })
    })

    test('aliases are written under the real attribute name, and only on the elements that have the property', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <label id="label" htmlFor="q">l</label>
                <div id="divFor" htmlFor="q">d</div>
                <li id="liDefault" defaultValue="x">li</li>
                <div id="divChecked" defaultChecked={true}>d</div>
                <form id="form" acceptCharset="utf-8" encoding="text/plain"/>
                <meta id="meta" httpEquiv="refresh"/>
                <a id="relList" relList="noopener" href="#">a</a>
                <output id="output" htmlFor={true}>o</output>
                <select id="select"><option id="option" defaultSelected={true} value="b">B</option><option value="a">A</option></select>
                <video id="video" defaultMuted={true}/>
            </div>
        })
    })

    test('boolean value on elements whose value goes through the value branch: written as the property converts it', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <select id="select"><option id="yes" value={true}>Yes</option><option id="no" value={false}>No</option></select>
                <button id="button" value={false}>b</button>
                <data id="data" value={true}>d</data>
                <ul><li id="li" value={true}>l</li></ul>
                <progress id="progress" value={false}/>
                <meter id="meter" value={true}/>
            </div>
        })
    })

    test('non-boolean values on boolean-typed properties: present exactly when the client would set them', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input id="required0" required={0}/>
                <input id="requiredEmpty" required=""/>
                <input id="requiredFalseString" required="false"/>
                <button id="disabled0" disabled={0}>b</button>
                <button id="disabledEmpty" disabled="">b</button>
                <button id="disabledString" disabled="disabled">b</button>
                <details id="open0" open={0}><summary>s</summary></details>
                <details id="open1" open={1}><summary>s</summary></details>
                <div id="hidden0" hidden={0}>h</div>
                <div id="hiddenEmpty" hidden="">h</div>
                <div id="hiddenUntilFound" hidden="until-found">h</div>
                <div id="hiddenString" hidden="yes">h</div>
                <div id="draggable0" draggable={0} spellcheck={1} translate={0}>d</div>
                <select id="multiple0" multiple={0}><option>a</option></select>
            </div>
        })
    })

    test('custom elements: the client assigns booleans to the inherited properties as they are', () => {
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <x-axii-51 id="t" title={true} tabIndex={true} hidden={true} inert={true} draggable={true} translate={true} role={true}/>
                <x-axii-51 id="f" title={false} tabIndex={false} hidden={false} inert={false} draggable={false} translate={false} role={false} lang={false}/>
                <x-axii-51 id="unknown" download={true} href={false}/>
            </div>
        })
    })

    test('default* next to the prop that drives the same state: the parsed state follows the client (IDL)', () => {
        // HTML 只能写出一个 value / checked / selected：同时出现时以客户端最终的 IDL 为准（React 同样以 value / checked 为准）
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <input id="dv-v" defaultValue="d" value="v"/>
                <input id="v-dv" value="v" defaultValue="d"/>
                <textarea id="ta-dv-v" defaultValue="d" value="v"/>
                <input id="cb-dc-c0" type="checkbox" defaultChecked checked={false}/>
                <input id="cb-c0-dc" type="checkbox" checked={false} defaultChecked/>
                <input id="cb-dc0-c1" type="checkbox" defaultChecked={false} checked/>
                <input id="cb-dc-v0" type="checkbox" defaultChecked value={false}/>
                <input id="cb-dc-v1" type="checkbox" defaultChecked={false} value={true}/>
                <input id="cb-dc-red" type="checkbox" defaultChecked value="red"/>
                <input id="ra-dc" type="radio" name="r1" defaultChecked/>
                <input id="ra-dc-c0" type="radio" name="r2" defaultChecked checked={false}/>
                <input id="ra-dc-va" type="radio" name="r3" defaultChecked value="a"/>
                <select id="so" value="a"><option id="so-a" value="a">A</option><option id="so-b" value="b" defaultSelected>B</option></select>
                <select id="plain"><option id="plain-a" value="a">A</option><option id="plain-b" value="b" defaultSelected>B</option></select>
                <video id="muted" muted defaultMuted={false}/>
                {/* 转发组件里调用方不传的 value / checked 是 undefined：prop 存在，同样决定状态（#52 的形状） */}
                <input id="vu-dv" value={undefined} defaultValue="d"/>
                <input id="cb-cu-dc" type="checkbox" checked={undefined} defaultChecked/>
                <input id="ra-cu-dc" type="radio" name="r4" checked={undefined} defaultChecked/>
            </div>
        }, 'live', 'idl')
    })

    test('textarea defaultValue: server child text, hydrated without a mismatch, reactive and nullish values', () => {
        const text = atom<any>('r')
        expectThreeWay(function App({}: any, {createElement}: RenderContext) {
            return <div>
                <textarea id="static" defaultValue="line"/>
                <textarea id="leadingNewline" defaultValue={'\nsecond'}/>
                <textarea id="reactive" defaultValue={text}/>
                <textarea id="fn" defaultValue={() => 'f'}/>
                <textarea id="nullish" defaultValue={null}/>
                <textarea id="number" defaultValue={3}/>
                <textarea id="true" defaultValue={true}/>
            </div>
        })
    })

    // 静态类型表的每一项都在真实浏览器里核对：解析服务端 HTML 得到的 attribute 与客户端 createElement 写出的完全一致。
    //  只核对表里的项（表 → 浏览器），不反向枚举浏览器的全部 property：浏览器私有扩展不进表，升级 Playwright 不会因此变红。
    test('every entry of the static property type table: server attributes equal the client\'s, per element', () => {
        const SAMPLES: {[type in HtmlPropertyType]: any[]} = {
            s: [true, false, 'x', '', 0],
            z: [true, false, 'x', '', 0],
            t: [true, false, 'x', ''],
            b: [true, false, 0, 1, '', 'x'],
            // 数值型 property 对非 boolean 值的 WebIDL 转换（progress max={0} -> "1"、textarea cols={0} -> "20"）不模拟
            n: [true, false, 3],
            k: [true, false, 0, 1, 'false'],
            y: [true, false, 0, 1, 'no'],
            h: [true, false, 0, 1, '', 'x', 'until-found', 'UNTIL-FOUND'],
        }
        const {global, elements} = htmlPropertyTypeEntries()
        const cases: [string, string, any][] = []
        for (const tag in elements) {
            for (const name in elements[tag]) for (const v of SAMPLES[elements[tag][name]]) cases.push([tag, name, v])
        }
        const globals: [string, HtmlPropertyType][] = [
            ...Object.entries(global), ['ariaLabel', 'z'], ['ariaChecked', 'z'], ['ariaValueNow', 'z'],
        ]
        for (const tag of ['div', 'input', 'a', 'td', 'x-axii-51']) {
            for (const [name, type] of globals) for (const v of SAMPLES[type]) cases.push([tag, name, v])
        }
        const attrs = (el: Element) => Array.from(el.attributes).map(a => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ')
        // 两端都经过组件的 createElement（as 这类组件层的 prop 两端同样处理）。客户端渲染进不在文档里的容器：
        //  script / iframe 不会加载
        const client = document.createElement('div')
        const root = createRoot(client)
        root.render(createElement(function Cases({}: any, {createElement}: RenderContext) {
            return <div>{cases.map(([tag, name, v]) => createElement(tag, {[name]: v}))}</div>
        }, null as any))
        const clientElements = Array.from(client.firstElementChild!.children)
        const template = document.createElement('template')
        const mismatches: string[] = []
        cases.forEach(([tag, name, v], i) => {
            // <template> 的解析上下文接受 td / tr / col 这类只能出现在表格里的元素
            template.innerHTML = renderToString(createElement(function Case({}: any, {createElement}: RenderContext) {
                return createElement(tag, {[name]: v})
            }, null as any)).html
            const server = attrs(template.content.firstElementChild!)
            const clientAttrs = attrs(clientElements[i])
            if (server !== clientAttrs) mismatches.push(`<${tag} ${name}={${JSON.stringify(v)}}> client: ${clientAttrs} | server: ${server}`)
        })
        root.destroy()
        expect({checked: cases.length > 1000, mismatches}).toEqual({checked: true, mismatches: []})
    })

    test('removal: a reactive aliased property going nullish / false removes the real attribute (client)', async () => {
        const cases: [string, string, any][] = [
            ['input', 'defaultValue', 'x'], ['input', 'defaultChecked', true], ['option', 'defaultSelected', true],
            ['video', 'defaultMuted', true], ['label', 'htmlFor', 'q'], ['output', 'htmlFor', 'q'],
            ['form', 'acceptCharset', 'utf-8'], ['form', 'encoding', 'text/plain'], ['meta', 'httpEquiv', 'refresh'],
            ['a', 'relList', 'noopener'], ['td', 'ch', '.'], ['td', 'chOff', '1'], ['col', 'ch', '.'], ['tr', 'chOff', '1'],
        ]
        for (const next of [null, undefined, false]) {
            const atoms = cases.map(([, , initial]) => atom<any>(initial))
            const client = document.createElement('div')
            document.body.appendChild(client)
            const root = createRoot(client)
            root.render(<div>{cases.map(([tag, name], i) => createElement(tag, {[name]: atoms[i]}))}</div>)
            const elements = Array.from(client.firstElementChild!.children)
            const before = elements.map(el => el.attributes.length)
            atoms.forEach(a => a(next))
            for (let i = 0; i < 100; i++) await Promise.resolve()
            const left = elements.map((el, i) => el.attributes.length
                ? `${cases[i][0]}.${cases[i][1]} -> ${next}: ${Array.from(el.attributes).map(a => `${a.name}=${JSON.stringify(a.value)}`).join(' ')}`
                : '').filter(Boolean)
            root.destroy()
            client.remove()
            expect({set: before, left}).toEqual({set: cases.map(() => 1), left: []})
        }
    })
})
