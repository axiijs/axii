/** @jsx createElement */
import {afterEach, beforeEach, expect, test} from 'vitest'
import {atom, createElement, createRoot, hydrateRoot, RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {hydrate} from './helpers/hydrate'

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

test('reclaimed rolling classes stay independent across hydrated and client roots', () => {
    function App({index, order}: {index: bigint, order?: bigint}, {createElement}: RenderContext) {
        return <div id="rolling" style={() => ({...hover, zIndex: index, order})}/>
    }
    const first = renderToString(<App index={BigInt(1)}/>)
    container.innerHTML = `<style data-axii-ssr>${first.styles}</style>${first.html}`
    const firstNode = container.querySelector('#rolling')!
    const firstId = firstNode.className
    root = hydrate(container, <App index={BigInt(1)}/>)
    expect(firstNode.className).toBe(firstId)

    const clientContainer = document.body.appendChild(document.createElement('div'))
    const serverContainer = document.body.appendChild(document.createElement('div'))
    const clientRoot = createRoot(clientContainer)
    let secondRoot: ReturnType<typeof hydrateRoot> | undefined
    try {
        clientRoot.render(<App index={BigInt(2)}/>)
        const clientNode = clientContainer.querySelector('#rolling')!
        expect.soft(getComputedStyle(clientNode).zIndex).toBe('2')

        const second = renderToString(<App index={BigInt(3)} order={BigInt(5)}/>)
        serverContainer.innerHTML = `<style data-axii-ssr>${second.styles}</style>${second.html}`
        const secondNode = serverContainer.querySelector('#rolling')!
        expect.soft(getComputedStyle(secondNode).zIndex).toBe('3')
        expect(getComputedStyle(firstNode).order).toBe('0')
        secondRoot = hydrate(serverContainer, <App index={BigInt(3)} order={BigInt(5)}/>)

        expect(getComputedStyle(firstNode).zIndex).toBe('1')
        expect(getComputedStyle(clientNode).zIndex).toBe('2')
        expect(getComputedStyle(secondNode).zIndex).toBe('3')
        expect(secondNode.classList.contains(firstId)).toBe(false)

        root.destroy()
        root = undefined
        container.innerHTML = `<style data-axii-ssr>${first.styles}</style>${first.html}`
        root = hydrate(container, <App index={BigInt(1)}/>)
        expect(container.querySelector('#rolling')!.className).toBe(firstId)
    } finally {
        secondRoot?.destroy()
        clientRoot.destroy()
        serverContainer.remove()
        clientContainer.remove()
    }
})

test('SSR reclaims one base for all rolling entries despite a static user class', () => {
    let authorClass = 'authored'
    function App({}: any, {createElement}: RenderContext) {
        return <div id="rolling" class={authorClass} style={[
            () => ({...hover, zIndex: BigInt(12)}),
            () => ({...hover, order: BigInt(15)}),
        ]}/>
    }
    container.innerHTML = renderToString(<App/>).html
    authorClass += ` ${container.querySelector('#rolling')!.classList[1]}`
    const {html, styles} = renderToString(<App/>)
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const element = container.querySelector('#rolling')!
    const initialClasses = Array.from(element.classList)
    const [, firstId, secondId] = initialClasses
    const base = firstId.replace(/F0I0$/, '')
    expect.soft(secondId).toBe(`${base}F1I0`)

    root = hydrate(container, <App/>)
    expect(Array.from(element.classList)).toEqual(initialClasses)
    expect(getComputedStyle(element).zIndex).toBe('12')
    expect(getComputedStyle(element).order).toBe('15')
})

test('interleaved content and rolling entries keep only current and previous rolling sheets', () => {
    const tick = atom(0)
    function App({}: any, {createElement}: RenderContext) {
        return <div id="mixed" style={[
            () => ({...hover, zIndex: tick() % 3 === 0 ? BigInt(tick()) : tick()}),
            () => ({...hover, order: BigInt(tick())}),
        ]}/>
    }
    const baseline = document.adoptedStyleSheets.length
    root = createRoot(container)
    root.render(<App/>)
    const original = container.querySelector('#mixed')!
    const clone = container.appendChild(original.cloneNode(true) as Element)

    tick(1)
    expect(getComputedStyle(original).zIndex).toBe('1')
    expect(getComputedStyle(clone).zIndex).toBe('0')
    tick(2)
    expect.soft(getComputedStyle(clone).zIndex).toBe('auto')
    clone.remove()

    for (let i = 3; i <= 60; i++) tick(i)
    expect(document.adoptedStyleSheets.length - baseline).toBeLessThanOrEqual(4)
    expect(getComputedStyle(original).zIndex).toBe('60')
    expect(getComputedStyle(original).order).toBe('60')
    root.destroy()
    root = undefined
    expect(document.adoptedStyleSheets.length).toBe(baseline)
})

test('hydrate drops the old content class when a sibling still uses its stylesheet', () => {
    const color = atom('red')
    function App({}: any, {createElement}: RenderContext) {
        return <section>
            <div id="changed" style={() => ({...hover, color: color()})}/>
            <div id="unchanged" style={() => ({...hover, color: 'red'})}/>
        </section>
    }
    const {html, styles} = renderToString(createElement(App, null as any))
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const changed = container.querySelector('#changed')!
    const unchanged = container.querySelector('#unchanged')!
    const oldStyleClass = changed.classList[0]
    changed.classList.add('axs-authoredF0')

    color('blue')
    root = hydrate(container, createElement(App, null as any))
    expect(container.querySelector('#changed')).toBe(changed)
    expect(getComputedStyle(changed).color).toBe('rgb(0, 0, 255)')
    expect(getComputedStyle(unchanged).color).toBe('rgb(255, 0, 0)')
    expect(changed.classList.contains(oldStyleClass)).toBe(false)
    expect(changed.classList.contains('axs-authoredF0')).toBe(true)
    expect(unchanged.classList.contains(oldStyleClass)).toBe(true)
})

test('hydrate reconciles content classes when client styles are inline or absent', () => {
    const red = () => ({...hover, color: 'red'})
    let server = true
    let authoredStyleClass: string | undefined
    function App({}: any, {createElement}: RenderContext) {
        return <section>
            <div id="inline" class={server ? 'server' : 'client'} style={server ? red : {color: 'blue'}}/>
            <div id="removed" {...(server ? {style: red} : {})}/>
            <div id="authored" {...(server ? {style: red, class: authoredStyleClass} : {})}/>
            <div id="unchanged" style={red}/>
        </section>
    }
    container.innerHTML = renderToString(createElement(App, null as any)).html
    authoredStyleClass = container.querySelector('#unchanged')!.classList[0]
    const {html, styles} = renderToString(createElement(App, null as any))
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`

    server = false
    root = hydrate(container, createElement(App, null as any))
    const inline = container.querySelector('#inline')!
    const removed = container.querySelector('#removed')!
    const authored = container.querySelector('#authored')!
    expect(getComputedStyle(inline).color).toBe('rgb(0, 0, 255)')
    expect(Array.from(inline.classList)).toEqual(['client'])
    expect(removed.hasAttribute('class')).toBe(false)
    expect(authored.classList.contains(authoredStyleClass)).toBe(true)
    expect(getComputedStyle(container.querySelector('#unchanged')!).color).toBe('rgb(255, 0, 0)')
})
