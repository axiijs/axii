/** @jsx createElement */
import {atom, createElement, createRoot, hydrateRoot, RenderContext, StaticHost} from '@framework'
import {afterEach, beforeEach, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'

const hover = {'&:hover': {opacity: 0.5}}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | undefined

beforeEach(() => {
    container = document.body.appendChild(document.createElement('div'))
})

afterEach(() => {
    root?.destroy()
    root = undefined
    container.remove()
})

test('function styles distinguish the CSS text of native CSS values', () => {
    function App({}, {createElement}: RenderContext) {
        return <section>
            <div id="a" style={() => ({width: CSS.px(12), ...hover})}/>
            <div id="b" style={() => ({width: CSS.px(24), ...hover})}/>
        </section>
    }

    const render = () => createElement(App, {})
    const {html, styles} = renderToString(render())
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const a = container.querySelector('#a')!
    const b = container.querySelector('#b')!
    expect(getComputedStyle(a).width).toBe('12px')
    expect(getComputedStyle(b).width).toBe('24px')

    root = hydrateRoot(container, render())
    expect(getComputedStyle(a).width).toBe('12px')
    expect(getComputedStyle(b).width).toBe('24px')
})

test('static styles on the same component path distinguish native CSS values', () => {
    function Row({width}: {width: number}, {createElement}: RenderContext) {
        return <div style={{width: CSS.px(width), ...hover}}/>
    }
    function App({}, {createElement}: RenderContext) {
        return <section><Row width={12}/><Row width={24}/></section>
    }

    root = createRoot(container)
    root.render(<App/>)
    const rows = container.querySelectorAll('section > div')
    expect(getComputedStyle(rows[0]).width).toBe('12px')
    expect(getComputedStyle(rows[1]).width).toBe('24px')
})

test('reactive declarations are read once when determining identity and writing stylesheet rules', () => {
    const width = atom(12)
    let reads = 0
    function App({}, {createElement}: RenderContext) {
        return <div style={{
            '@media all': {
                width: () => {
                    reads++
                    return width()
                },
            },
        }}/>
    }

    const render = () => createElement(App, {})
    const {html, styles} = renderToString(render())
    expect(reads).toBe(1)
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    expect(getComputedStyle(container.querySelector('div')!).width).toBe('12px')

    reads = 0
    root = hydrateRoot(container, render())
    expect(reads).toBe(1)
    width(24)
    expect(reads).toBe(2)
    expect(getComputedStyle(container.querySelector('div')!).width).toBe('24px')
})

test.each([false, true])('relationship selectors use per-element classes (dynamic=%s)', dynamic => {
    const style = {
        '@media all': {
            '& + &': {opacity: 0.25},
        },
    }
    function Row({}, {createElement}: RenderContext) {
        return <div style={dynamic ? () => style : style}/>
    }
    function App({}, {createElement}: RenderContext) {
        return <section><Row/><Row/></section>
    }

    const render = () => createElement(App, {})
    const {html, styles} = renderToString(render())
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const rows = container.querySelectorAll('section > div')
    const ssrClasses = Array.from(rows, row => row.className)
    expect(ssrClasses[0]).not.toBe(ssrClasses[1])
    expect(getComputedStyle(rows[1]).opacity).toBe('1')

    root = hydrateRoot(container, render())
    expect(Array.from(rows, row => row.className)).toEqual(ssrClasses)
    expect(getComputedStyle(rows[1]).opacity).toBe('1')
})

test.each([':nth-child(1 of &)', 'section > :not(&)'])('selector functions preserve each instance scope in %s', selector => {
    const style = () => ({
        '@media all': {
            [selector]: {opacity: 0.25},
        },
    })
    function App({}, {createElement}: RenderContext) {
        return <section><div style={style}/><div style={style}/></section>
    }

    root = createRoot(container)
    root.render(createElement(App, {}))
    const [a, b] = Array.from(container.querySelectorAll('section > div'))
    expect(getComputedStyle(a).opacity).toBe('0.25')
    expect(getComputedStyle(b).opacity).toBe('0.25')
    expect(a.className).not.toBe(b.className)
})

test.each([
    '&:not([data-disabled])',
    '&:nth-child(2)',
    '&:not([data-disabled="a&b"])',
    '&:not([data-disabled=a\\&b])',
])('an outer scope shares rules for %s', selector => {
    const style = () => ({[selector]: {opacity: 0.25}})
    function App({}, {createElement}: RenderContext) {
        return <section><div data-disabled="a&b" style={style}/><div style={style}/></section>
    }

    root = createRoot(container)
    root.render(createElement(App, {}))
    const [a, b] = Array.from(container.querySelectorAll('section > div'))
    expect(a.className).toBe(b.className)
    expect(getComputedStyle(a).opacity).toBe('1')
    expect(getComputedStyle(b).opacity).toBe('0.25')
})

test('selector lists with one scope per branch share a class and keep literal ampersands', () => {
    const style = () => ({
        '&[data-match="a&b"], &:focus': {opacity: 0.25},
    })
    function App({}, {createElement}: RenderContext) {
        return <section>
            <div data-match="a&b" style={style}/>
            <div style={style}/>
        </section>
    }

    root = createRoot(container)
    root.render(createElement(App, {}))
    const [a, b] = Array.from(container.querySelectorAll('section > div'))
    expect(a.className).toBe(b.className)
    expect(getComputedStyle(a).opacity).toBe('0.25')
    expect(getComputedStyle(b).opacity).toBe('1')
})

test('StyleManager helpers still accept style objects', () => {
    const manager = StaticHost.styleManager
    const id = 'style-manager-existing-api'
    const frames = {to: {opacity: 1}}
    const style = {width: 12, '@keyframes': frames, animation: '1s @self'}
    expect(manager.stringifyStyleObject({width: 12})).toBe('width:12px;')
    expect(manager.stringifyKeyFrameObject(frames)).toContain('opacity:1;')
    expect(manager.generateInlineAnimationContent(`.${id}`, style))
        .toEqual(manager.generateStyleContent(`.${id}`, style).slice(1))

    const sheet = manager.createStyleSheet(id, style)
    manager.styleScripts.set(id, sheet)
    try {
        const element = container.appendChild(document.createElement('div'))
        element.className = id
        expect(getComputedStyle(element).width).toBe('12px')
    } finally {
        expect(manager.deleteStyleSheet(id)).toBe(sheet)
    }
    expect(document.adoptedStyleSheets).not.toContain(sheet)
})
