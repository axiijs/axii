/** @jsx createElement */
import {atom, createElement, createRoot, RenderContext} from '@framework'
import {afterEach, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {hydrate} from './helpers/hydrate'

const red = 'rgb(255, 0, 0)'
const blue = 'rgb(0, 0, 255)'
const green = 'rgb(0, 128, 0)'
const nested = () => ({'& > *': {color: red}})
const direct = () => ({color: blue, '&:hover': {opacity: 0.5}})

const containers: HTMLElement[] = []
const roots: ReturnType<typeof createRoot>[] = []

function addContainer() {
    const container = document.body.appendChild(document.createElement('div'))
    containers.push(container)
    return container
}

function mount(node: JSX.Element) {
    const container = addContainer()
    const root = createRoot(container)
    roots.push(root)
    root.render(node)
    return container
}

afterEach(() => {
    for (const root of roots.splice(0).reverse()) root.destroy()
    for (const container of containers.splice(0)) container.remove()
})

function ParentAndChild({}, {createElement}: RenderContext) {
    return <div style={nested}><div id="child" style={direct}/></div>
}

function Prewarm({style}: {style: typeof nested | typeof direct}, {createElement}: RenderContext) {
    return <div style={style}/>
}

function mountColor() {
    const container = mount(<ParentAndChild/>)
    const value = getComputedStyle(container.querySelector('#child')!).color
    roots.pop()!.destroy()
    return value
}

test.each([['parent', nested], ['child', direct]] as const)(
    'a separate root prewarming the %s rule preserves the cold cascade',
    (_, style) => {
        expect(mountColor()).toBe(red)
        mount(<Prewarm style={style}/>)
        expect(mountColor()).toBe(red)
    },
)

test('opposite rule discovery orders give the same cascade for two nested rules', () => {
    const outer = () => ({'& *': {color: red}})
    const inner = () => ({'& *': {color: blue}})
    function App({reverse}: {reverse: boolean}, {createElement}: RenderContext) {
        return <div style={reverse ? inner : outer}>
            <div style={reverse ? outer : inner}><div data-target=""/></div>
        </div>
    }

    const first = mount(<App reverse={false}/>)
    const coldColor = getComputedStyle(first.querySelector('[data-target]')!).color
    roots.pop()!.destroy()

    const second = mount(<App reverse={true}/>)
    expect(getComputedStyle(second.querySelector('[data-target]')!).color).toBe(coldColor)
})

test('a later stylesheet entry wins after hydration and reactive reevaluation', () => {
    const color = atom(red)
    const earlier = () => ({'&': {color: color()}})
    function App({}, {createElement}: RenderContext) {
        return <div id="styled" style={[earlier, direct]}/>
    }

    const {html, styles} = renderToString(<App/>)
    const container = addContainer()
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const element = container.querySelector('#styled')!
    expect(getComputedStyle(element).color).toBe(blue)
    roots.push(hydrate(container, <App/>))
    expect(container.querySelector('#styled')).toBe(element)
    expect(getComputedStyle(element).color).toBe(blue)
    color(green)
    expect(getComputedStyle(element).color).toBe(blue)
})

test.each([['parent', nested], ['child', direct]] as const)(
    'hydration with a separate %s rule already adopted preserves the server cascade',
    (_, style) => {
        const {html, styles} = renderToString(<ParentAndChild/>)
        const container = addContainer()
        container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        const element = container.querySelector('#child')!
        expect(getComputedStyle(element).color).toBe(red)
        mount(<Prewarm style={style}/>)
        roots.push(hydrate(container, <ParentAndChild/>))
        expect(container.querySelector('#child')).toBe(element)
        expect(getComputedStyle(element).color).toBe(red)
    },
)

test.each([['parent', nested], ['child', direct]] as const)(
    'an already mounted %s rule preserves SSR styling before hydration',
    (_, style) => {
        const {html, styles} = renderToString(<ParentAndChild/>)
        const payload = `<style data-axii-ssr>${styles}</style>${html}`
        const isolated = addContainer().attachShadow({mode: 'open'})
        isolated.innerHTML = payload
        const serverColor = getComputedStyle(isolated.querySelector('#child')!).color

        mount(<Prewarm style={style}/>)
        const container = addContainer()
        container.innerHTML = payload
        expect(getComputedStyle(container.querySelector('#child')!).color).toBe(serverColor)
    },
)

test('main and nested Portal SSR payloads each include shared rules and only their own rules', () => {
    const main = () => ({'&:hover': {opacity: 0.11}})
    const outer = () => ({'&:hover': {opacity: 0.22}})
    const inner = () => ({'&:hover': {opacity: 0.33}})
    const sibling = () => ({'&:hover': {opacity: 0.44}})

    function OuterPortal({}, {createElement, createPortal}: RenderContext) {
        return <div style={[direct, outer]} data-target="">
            {createPortal(() => <div style={[direct, inner]} data-target=""/>, 'inner')}
        </div>
    }

    function App({}, {createElement, createPortal}: RenderContext) {
        return <div style={[direct, main]} data-target="">
            {createPortal(() => <OuterPortal/>, 'outer')}
            {createPortal(() => <div style={[direct, sibling]} data-target=""/>, 'sibling')}
        </div>
    }

    const {html, styles, portals} = renderToString(<App/>)
    const hydratedContainers = {
        main: addContainer(),
        outer: addContainer(),
        inner: addContainer(),
        sibling: addContainer(),
    }
    const serverNodes: Element[] = []
    for (const [key, payload, opacity] of [
        ['main', {html, styles}, 0.11],
        ['outer', portals.outer, 0.22],
        ['inner', portals.inner, 0.33],
        ['sibling', portals.sibling, 0.44],
    ] as const) {
        const markup = `<style data-axii-ssr>${payload.styles}</style>${payload.html}`
        const isolated = addContainer().attachShadow({mode: 'open'})
        isolated.innerHTML = markup
        expect(getComputedStyle(isolated.querySelector('[data-target]')!).color).toBe(blue)
        for (const marker of [0.11, 0.22, 0.33, 0.44]) {
            expect(payload.styles.includes(`opacity:${marker}`)).toBe(marker === opacity)
        }
        const container = hydratedContainers[key]
        container.innerHTML = markup
        serverNodes.push(container.querySelector('[data-target]')!)
    }

    const {main: mainContainer, ...portalContainers} = hydratedContainers
    roots.push(hydrate(mainContainer, <App/>, {portals: portalContainers}))
    for (const [index, container] of Object.values(hydratedContainers).entries()) {
        const node = serverNodes[index]
        expect(container.querySelector('[data-target]')).toBe(node)
        expect(getComputedStyle(node).color).toBe(blue)
    }
})

test('a nested Portal cannot overwrite its enclosing Portal payload at the same key', () => {
    function OuterPortal({}, {createElement, createPortal}: RenderContext) {
        return <div>{createPortal(() => <div style={direct}/>, 'shared')}</div>
    }

    function App({}, {createElement, createPortal}: RenderContext) {
        return <div>{createPortal(() => <OuterPortal/>, 'shared')}</div>
    }

    expect(() => renderToString(<App/>)).toThrow('duplicate Portal key: "shared"')
})
