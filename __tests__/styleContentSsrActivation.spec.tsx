/** @jsx createElement */
import {createElement, hydrateRoot, type RenderContext} from '@framework'
import {renderToString} from '../src/ssr.js'
import {expect, test} from 'vitest'

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
        roots.push(hydrateRoot(containers[0], <App color="red"/>))
        expect(getComputedStyle(containers[1].querySelector('span')!).color).toBe('rgb(0, 0, 255)')
        roots.push(hydrateRoot(containers[1], <App color="blue"/>))
        for (const container of containers) expect(container.querySelector('style')).toBeNull()
    } finally {
        for (const root of roots) root.destroy()
        for (const container of containers) container.remove()
    }
})

test('activating a content stylesheet preserves its nested @self animation name', () => {
    const style = () => ({
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
    const root = hydrateRoot(container, <App/>)
    try {
        expect(serverName).toMatch(/^animation-/)
        expect(getComputedStyle(span).animationName).toBe(serverName)
    } finally {
        root.destroy()
        container.remove()
    }
})
