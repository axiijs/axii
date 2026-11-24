/** @jsx createElement */
/**
 * #79：style 数组的字符串条目，客户端渲染、解析服务端 HTML、在服务端 HTML 上 hydrate 三方一致。
 *
 * 曾经客户端把字符串条目整体赋给 node.style.cssText，清掉前面条目写下的全部行内样式；服务端按原样拼接，
 *  浏览器逐属性解析（后面的声明覆盖前面的）。[{color: 'blue', paddingTop: 1}, 'margin-top: 3px'] 客户端只剩
 *  margin-top，服务端三条声明都在，激活后变成客户端的结果，页面在激活前后不同。
 *  决定（维护者已定）：两端统一为按属性拼接——字符串条目只覆盖它自己声明的属性；响应式更新时删掉它上一次写下、
 *  这次不再声明的属性。字符串的拆分只有一份（styleSerialize.splitInlineDeclarations），两端共用。
 *
 * 同一单还有 CSS 自定义属性（--x）的值：客户端曾把原值交给 setProperty（[4, 8] → "4,8"），服务端经 stringifyCssValue
 *  （"4 8"）。现在客户端也经 stringifyCssValue。
 *
 * 比较的是元素自己的行内声明（逐个分项的值与优先级）和几项计算值，不比较 style 属性的原始文本。
 * Run: npx vitest run __tests__/styleStringEntries.spec.tsx
 */
import {atom, createElement, createRoot, RenderContext, setAttribute} from '@framework'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate} from './helpers/hydrate'

let container: HTMLElement
beforeEach(() => {
    document.body.innerHTML = ''
    document.adoptedStyleSheets = []
    container = document.createElement('div')
    // var(--p) 的取值来源：放在容器上，三方都一样
    container.style.setProperty('--p', '7px')
    document.body.appendChild(container)
})
afterEach(() => {
    container.remove()
})

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const COMPUTED = ['color', 'margin-top', 'margin-right', 'margin-left', 'padding-top', 'padding-right', 'padding-left', 'background-image']

// 行内声明：逐个分项，值 + 优先级（待代入的分项值为空，也照样列出），排序后比较；外加几项计算值
function stateOf(el: HTMLElement) {
    const inline: string[] = []
    for (let i = 0; i < el.style.length; i++) {
        const name = el.style[i]
        inline.push(`${name}: ${el.style.getPropertyValue(name)}${el.style.getPropertyPriority(name) ? ' !important' : ''}`)
    }
    const computed = getComputedStyle(el)
    return {inline: inline.sort(), computed: COMPUTED.map(name => `${name}: ${computed.getPropertyValue(name)}`)}
}

function target() {
    return container.querySelector('#t') as HTMLElement
}

function appOf(style: any) {
    return function App({}: any, {createElement}: RenderContext) {
        return <div id="t" style={style}>x</div>
    }
}

function clientState(style: any) {
    const root = createRoot(container)
    root.render(createElement(appOf(style), null as any))
    const state = stateOf(target())
    root.destroy()
    container.innerHTML = ''
    return state
}

function serverHTML(style: any) {
    const {html, styles} = renderToString(createElement(appOf(style), null as any))
    return `${styles ? `<style data-axii-ssr>${styles}</style>` : ''}${html}`
}

function serverState(style: any) {
    container.innerHTML = serverHTML(style)
    const state = stateOf(target())
    container.innerHTML = ''
    return state
}

function hydratedState(style: any) {
    container.innerHTML = serverHTML(style)
    const root = hydrate(container, createElement(appOf(style), null as any))
    const state = stateOf(target())
    root.destroy()
    container.innerHTML = ''
    return state
}

function threeWay(style: any) {
    return {client: clientState(style), server: serverState(style), hydrated: hydratedState(style)}
}

function expectThreeWay(style: any) {
    const {client, server, hydrated} = threeWay(style)
    expect({server, hydrated}).toEqual({server: client, hydrated: client})
    return client
}

const BLUE = 'rgb(0, 0, 255)'
const RED = 'rgb(255, 0, 0)'

describe('#79 string entries: client render, parsed server HTML and hydrate agree', () => {
    test('the issue example: a string after an object entry keeps the object entry', () => {
        const client = expectThreeWay([{color: BLUE, paddingTop: 1}, 'margin-top: 3px'])
        expect(client.inline).toEqual([`color: ${BLUE}`, 'margin-top: 3px', 'padding-top: 1px'])
    })

    const cases: [string, any][] = [
        ['string first', ['margin-top: 3px; color: rgb(255, 0, 0)', {color: BLUE, paddingTop: 1}]],
        ['string in the middle', [{color: BLUE, marginTop: 1}, 'margin-top: 3px; padding-top: 2px', {paddingLeft: 4}]],
        ['string overrides an object property of the same name', [{color: BLUE, marginTop: 1}, `color: ${RED}`]],
        ['two strings', [`color: ${RED}; margin-top: 1px`, `color: ${BLUE}`]],
        ['a shorthand in the string over an earlier longhand', [{marginTop: 5, paddingTop: 1}, 'margin: 1px']],
        ['a longhand object entry over a shorthand in the string', ['margin: 1px', {marginTop: 5}]],
        ['longhands in the string over an object shorthand', [{margin: 1}, 'margin-top: 5px; margin-left: 6px']],
        ['nested arrays and falsy entries', [{color: BLUE}, false, [null, 'margin-top: 3px'], ['padding-top: 2px'], undefined]],
        ['invalid and empty declarations keep the earlier value', [{color: BLUE, marginTop: 1}, 'color: notacolor; margin-top: ; padding-top: 2px']],
        ['a value that is only a comment keeps the earlier value', [{color: BLUE}, 'color: /* none */; padding-top: 2px']],
        ['a var() shorthand partially overridden before a string', [{padding: 'var(--p)', paddingTop: 0}, `color: ${RED}`]],
        ['a var() shorthand in the string', [{paddingTop: 1}, 'padding: var(--p); color: rgb(255, 0, 0)', {paddingLeft: 0}]],
        ['custom property names keep their case; empty custom value', [{'--a': '1', color: BLUE}, '--A: 2; --b:; --c: x']],
        ['comments in values and odd spacing', [{color: BLUE}, ' \n margin-top :3px ;; padding-top: /* c */ 2px ; ']],
        ['a comment before a property name (unsplittable)', [{color: BLUE, paddingTop: 1}, '/* lead */ margin-top: 3px']],
        ['a sole string (written in one assignment)', `color: ${RED}; margin-top: 1px`],
        ['uppercase property names', [{color: BLUE}, 'MARGIN-TOP: 3px; Padding-Top: 2px']],
        ['functions and quoted semicolons stay inside one declaration', [{color: BLUE}, 'background-image: url("a;b.png"); margin-top: 2px']],
        // 拆不准（转义）：客户端交给浏览器解析「已有声明 + 文本」，服务端原样拼接
        ['an unsplittable string (escape) as the last entry', [{color: BLUE, paddingTop: 1}, 'background-image: url("a\\"b.png"); margin-top: 2px']],
        ['an unsplittable string (unclosed url) as the last entry', [{color: BLUE}, 'margin-top: 2px; background-image: url(a.png']],
        ['a string before a stylesheet entry (#57 yield)', [`color: ${BLUE}; margin-top: 3px`, {color: RED, '&:hover': {opacity: 0.74}}]],
    ]
    test.each(cases)('%s', (_label, style) => {
        expectThreeWay(style)
    })

    describe('!important: a later entry replaces it, inside one string the browser rules apply', () => {
        test('an object entry after an !important string declaration', () => {
            const client = expectThreeWay([`color: ${RED} !important; margin-top: 1px`, {color: BLUE}])
            expect(client.inline).toContain(`color: ${BLUE}`)
        })
        test('a string after an !important string declaration', () => {
            const client = expectThreeWay([`color: ${RED} !important`, `color: ${BLUE}`])
            expect(client.inline).toEqual([`color: ${BLUE}`])
        })
        test('an object shorthand after !important longhands and shorthands in a string', () => {
            expectThreeWay(['margin-top: 1px !important; padding: 3px !important', {margin: 2, padding: 4}])
        })
        test('an !important string declaration after an object entry', () => {
            const client = expectThreeWay([{color: BLUE}, `color: ${RED} !important`])
            expect(client.inline).toEqual([`color: ${RED} !important`])
        })
        test('inside one string a later normal declaration does not replace an !important one', () => {
            // 单独的字符串（整体赋值）与跟在对象条目后面（逐条写入）两条路径
            expect(expectThreeWay(`color: ${RED} !important; color: ${BLUE}`).inline).toEqual([`color: ${RED} !important`])
            expect(expectThreeWay([{marginTop: 1}, `color: ${RED} !important; color: ${BLUE}`]).inline)
                .toEqual(['margin-top: 1px', `color: ${RED} !important`].sort())
        })
        test('an empty declaration does not replace an earlier !important one', () => {
            const client = expectThreeWay([`color: ${RED} !important`, 'color: ; margin-top: 1px'])
            expect(client.inline).toContain(`color: ${RED} !important`)
        })
        test('"! important" with spaces and comments', () => {
            expectThreeWay([{color: BLUE}, `color: ${RED} ! /* c */ IMPORTANT; margin-top: 1px`])
        })
    })

    describe('known gaps: the server markup differs until hydration, hydrate equals the client render', () => {
        // 服务端不展开简写：后面的分项对象条目删不掉字符串里 !important 简写的这一个分项
        test('a longhand object entry after an !important shorthand in a string', () => {
            const {client, server, hydrated} = threeWay(['margin: 1px !important', {marginTop: 5}])
            expect(hydrated).toEqual(client)
            expect(client.inline).toContain('margin-top: 5px')
            expect(server.inline).toContain('margin-top: 1px !important')
        })
        // 拆不准的字符串原样拼接：未闭合的 url 吞掉后面条目的声明，激活时由客户端重写
        test('an unsplittable string followed by another entry', () => {
            const {client, server, hydrated} = threeWay([{color: BLUE}, 'background-image: url(a.png', {marginTop: 2}])
            expect(hydrated).toEqual(client)
            expect(client.inline).toContain('margin-top: 2px')
            expect(server.inline).not.toContain('margin-top: 2px')
        })
    })
})

describe('#79 reactive string entries: every update equals a fresh render of the new value', () => {
    // 每一步之后：客户端（以及在服务端 HTML 上 hydrate 的那一份）的行内声明 = 用这一步的值重新渲染的结果
    async function expectSteps(make: (value: any) => any, values: any[]) {
        const current = atom(values[0])
        const style = make(current)
        const expected = values.map(value => clientState(make(value)))
        // 服务端首屏同样要和客户端一致
        expect(serverState(make(values[0]))).toEqual(expected[0])
        for (const mode of ['client', 'hydrated'] as const) {
            current(values[0])
            let root
            if (mode === 'client') {
                root = createRoot(container)
                root.render(createElement(appOf(style), null as any))
            } else {
                container.innerHTML = serverHTML(make(values[0]))
                root = hydrate(container, createElement(appOf(style), null as any))
            }
            const seen = [stateOf(target())]
            for (const value of values.slice(1)) {
                current(value)
                await settle()
                seen.push(stateOf(target()))
            }
            expect({mode, seen}).toEqual({mode, seen: expected})
            root.destroy()
            container.innerHTML = ''
        }
    }
    const strings = [
        `color: ${RED}; margin-top: 1px`,
        `color: ${RED}`,
        'margin-top: 2px; padding-top: 3px',
        null,
        `color: ${BLUE}; margin: 4px`,
        'margin-top: 5px',
    ]

    test('a string entry adds and removes properties, earlier entries stay', async () => {
        await expectSteps(s => [{paddingLeft: 1, marginLeft: 9}, typeof s === 'function' ? () => s() : s], strings)
    })
    test('a string entry before an object entry', async () => {
        await expectSteps(s => [typeof s === 'function' ? () => s() : s, {paddingLeft: 1}], strings)
    })
    test('flipping between a string and an object entry', async () => {
        await expectSteps(s => [{paddingLeft: 1}, typeof s === 'function' ? () => s() : s],
            ['margin-top: 3px; color: rgb(255, 0, 0)', {color: BLUE}, 'color: rgb(255, 0, 0)', {marginTop: 2}, 'margin-top: 4px'])
    })
    test('a property the string stops declaring is still written by an earlier entry', async () => {
        await expectSteps(s => [{color: BLUE, marginTop: 1}, typeof s === 'function' ? () => s() : s],
            [`color: ${RED}; margin-top: 3px`, 'padding-top: 2px', `color: ${RED}`, 'margin: 6px', 'padding-top: 2px'])
    })
    test('the whole style is a reactive string', async () => {
        await expectSteps(s => typeof s === 'function' ? () => s() : s, strings.filter(Boolean))
    })
    test('!important across updates', async () => {
        await expectSteps(s => [{marginTop: 1}, typeof s === 'function' ? () => s() : s],
            [`color: ${RED} !important`, `color: ${BLUE}`, `color: ${RED} !important; margin-top: 3px`, {color: BLUE}])
    })
    test('an unsplittable string across updates', async () => {
        await expectSteps(s => [{color: BLUE}, typeof s === 'function' ? () => s() : s],
            ['background-image: url("a\\"b.png"); margin-top: 1px', 'padding-top: 2px', 'margin-top: 3px; background-image: url(a.png', null])
    })
    test('a string next to a stylesheet entry', async () => {
        await expectSteps(s => [typeof s === 'function' ? () => s() : s, {color: RED, '&:hover': {opacity: 0.73}}],
            [`color: ${BLUE}; margin-top: 3px`, 'margin-top: 4px', `color: ${BLUE}`])
    })
})

describe('#79 string styles written outside a render keep the other inline properties', () => {
    test('setAttribute with a string on an element that already has inline styles', () => {
        const el = document.createElement('div')
        el.style.color = BLUE
        setAttribute(el as any, 'style', 'margin-top: 3px')
        expect(stateOf(el).inline).toEqual([`color: ${BLUE}`, 'margin-top: 3px'])
    })
    test('a string detachStyle only changes the properties it declares', async () => {
        const show = atom(true)
        const root = createRoot(container)
        root.render(<div>{() => show() ? <span id="t" style={{color: BLUE, opacity: 1, transition: 'opacity 0.2s'}}
            detachStyle="opacity: 0">bye</span> : null}</div>)
        const el = target()
        show(false)
        await settle()
        // 离场样式只写 opacity，原有的 color 不被抹掉（字符串 detachStyle 不登记 transition，节点随即移除，样式留在元素上）
        expect(el.style.opacity).toBe('0')
        expect(el.style.color).toBe(BLUE)
        root.destroy()
    })
})

describe('#79 CSS custom properties: values go through the shared stringifyCssValue', () => {
    const values: [string, any, string | undefined][] = [
        ['number', 4, '--x: 4'],
        ['string', 'a b', '--x: a b'],
        ['array', [4, 8], '--x: 4 8'],
        ['[number, unit]', [300, 'ms'], '--x: 300ms'],
        ['array with a function item', [() => 2, 3], '--x: 2 3'],
        ['function', () => [2, 3], '--x: 2 3'],
        ['false', false, undefined],
        ['null', null, undefined],
        ['empty string', '', undefined],
    ]
    test.each(values)('%s', (_label, value, expected) => {
        const client = expectThreeWay({'--x': value, color: BLUE})
        expect(client.inline.find(line => line.startsWith('--x:'))).toBe(expected)
    })
    test('arrays are joined with spaces, [number, unit] becomes one value', () => {
        expect(expectThreeWay([{'--gap': [4, 8], '--t': [300, 'ms']}, 'margin-top: 1px']).inline)
            .toEqual(['--gap: 4 8', '--t: 300ms', 'margin-top: 1px'])
    })
    test('a reactive custom property', async () => {
        const gap = atom<any>([4, 8])
        const root = createRoot(container)
        root.render(<div id="t" style={{'--gap': () => gap()}}>x</div>)
        expect(target().style.getPropertyValue('--gap')).toBe('4 8')
        gap([300, 'ms'])
        await settle()
        expect(target().style.getPropertyValue('--gap')).toBe('300ms')
        gap(false)
        await settle()
        expect(target().style.getPropertyValue('--gap')).toBe('')
        root.destroy()
    })
})
