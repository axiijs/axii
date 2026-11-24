/** @jsx createElement */
import {createElement, hydrateRoot, type RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {expect, test} from 'vitest'
import {hydrate} from './helpers/hydrate'

test('hydrating one root preserves the stylesheet of another pending server root', () => {
    function App({color}: {color: string}, {createElement}: RenderContext) {
        return <div style={() => ({'& span': {color}})}><span>text</span></div>
    }

    const containers = ['red', 'blue'].map(color => {
        const container = document.body.appendChild(document.createElement('div'))
        const {html, styles} = renderToString(<App color={color}/>)
        container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        return container
    })
    const roots = []
    try {
        roots.push(hydrate(containers[0], <App color="red"/>))
        expect(getComputedStyle(containers[1].querySelector('span')!).color).toBe('rgb(0, 0, 255)')
        roots.push(hydrate(containers[1], <App color="blue"/>))
        for (const container of containers) expect(container.querySelector('style')).toBeNull()
    } finally {
        for (const root of roots) root.destroy()
        for (const container of containers) container.remove()
    }
})

test.each([[0, 1], [1, 0]])('pending rolling CSS stays isolated when hydrating roots in order %i, %i', (first, second) => {
    function App({index}: {index: number}, {createElement}: RenderContext) {
        return <div style={() => ({zIndex: BigInt(index), '&:hover': {opacity: 0.5}})}>text</div>
    }

    const indexes = [1, 2]
    const containers = indexes.map(index => {
        const container = document.body.appendChild(document.createElement('div'))
        const {html, styles} = renderToString(<App index={index}/>)
        container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
        return container
    })
    const roots: ReturnType<typeof hydrateRoot>[] = []
    try {
        const nodes = containers.map(container => container.querySelector('div')!)
        expect(nodes.map(node => getComputedStyle(node).zIndex)).toEqual(['1', '2'])
        for (const i of [first, second]) {
            roots.push(hydrate(containers[i], <App index={indexes[i]}/>))
            expect(nodes.map(node => getComputedStyle(node).zIndex)).toEqual(['1', '2'])
        }
    } finally {
        for (const root of roots) root.destroy()
        for (const container of containers) container.remove()
    }
})

test.each([
    {mode: 'content', index: 1},
    {mode: 'rolling', index: BigInt(1)},
])('activating a $mode stylesheet preserves its nested @self animation name', ({index}) => {
    const style = () => ({
        zIndex: index,
        '& > span': {
            '@keyframes': {from: {opacity: 0}, to: {opacity: 1}},
            animation: '1s linear @self',
        },
    })
    function App({}, {createElement}: RenderContext) {
        return <div style={style}><span>animated</span></div>
    }
    const container = document.body.appendChild(document.createElement('div'))
    const {html, styles} = renderToString(<App/>)
    container.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
    const span = container.querySelector('span')!
    const serverName = getComputedStyle(span).animationName
    const root = hydrate(container, <App/>)
    try {
        expect(serverName).toMatch(/^animation-/)
        expect(getComputedStyle(span).animationName).toBe(serverName)
    } finally {
        root.destroy()
        container.remove()
    }
})
