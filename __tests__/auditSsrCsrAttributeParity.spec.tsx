/** @jsx createElement */
/**
 * SSR ≡ CSR for the attribute rules: the server markup, parsed by the browser, must give the same
 * attributes as a client render of the same JSX. The server has no DOM to ask for a property's
 * type, so it follows a static table; this spec is what keeps the two sides from drifting apart.
 */
import {atom, createElement, createRoot, RenderContext} from '@framework'
import {describe, expect, test} from 'vitest'
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
