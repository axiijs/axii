/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, RenderContext} from "@framework";
import {Atom, atom, RxList} from "data0";
import {StyleSize} from "../src/DOM.js";


describe('component render', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    const lastChildColor = atom<string>('red')
    function App({}, {createElement}: RenderContext) {
        const innerStyle=  {
            '&:hover': {
                color: 'blue'
            },
            '& > a': {
                color: 'green'
            },
            '&:hover > a': {
                color: 'yellow'
            }
        }

        const randomStyle = () => ({
            'p:last-child': {
                color: lastChildColor()
            }
        })

        const containerStyle = {
            containerName: 'container1',
            containerType: 'inline-size',
            width:1200
        }

        const mediaQueryStyle = {
            'color': 'black',
            '@container container1 (width < 2000px)': {
                color: 'red'
            }
        }

        return <div style={innerStyle}>
            <div>app</div>
            <a>test</a>
            <div style={randomStyle} id="pContainer">
                <p>p1</p>
                <p>p2</p>
            </div>
            <div style={containerStyle} id="container1">
                <div style={mediaQueryStyle} id="mediaQueryDiv"></div>
            </div>
        </div>
    }

    test('psuedo class in js', () => {
        root.render(<App />)

        const appFirstEl = rootEl.firstElementChild!
        expect(appFirstEl.classList.contains('gen-0--')).toBe(true)

        const lastDiv = document.getElementById('pContainer')!
        const classList = Array.from(lastDiv.classList)
        expect(classList.length).toBe(1)
        const lastP = lastDiv.lastElementChild as HTMLElement
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('red')

        lastChildColor('green')
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('green')
    })

    // TODO happy-dom media query not working
    // test('at-rule style', () => {
    //     root.render(<App />)
    //     const testDiv = rootEl.querySelector('#mediaQueryDiv')!
    //     expect(getComputedStyle(testDiv).getPropertyValue('color')).toBe('black')
    //     const container1 = rootEl.querySelector('#container1')! as HTMLElement
    //     container1.style.width = '900px'
    //     expect(getComputedStyle(testDiv).getPropertyValue('color')).toBe('red')
    // })

    test('StyleSize', () => {
        const base = new StyleSize(1, 'rem')
        expect(base.toString()).toBe('1rem')
        const size1 = base.add(2, 'rem')
        expect(size1.toString()).toBe('3rem')
        const size2 = size1.mul(2)
        expect(size2.toString()).toBe('6rem')
        const size3 = size2.sub(1)
        expect(size3.toString()).toBe('5rem')

        const size4 = size3.div(2)
        expect(size4.toString()).toBe('2.5rem')

        const size5 = size4.add(2, 'px')
        expect(size5.toString()).toBe('calc(2.5rem + 2px)')

        const size6 = size5.mul(2)
        expect(size6.toString()).toBe('calc((2.5rem + 2px) * 2)')

        const sizeA = new StyleSize(1, 'rem')
        const sizeB = new StyleSize(2, 'rem')
        sizeB.sub(1, 'px')
        expect(sizeB.toString()).toBe('calc(2rem - 1px)')

        sizeA.add(sizeB)
        expect(sizeA.toString()).toBe('calc(1rem + (2rem - 1px))')
    })

})

describe('complex style', () => {
    function App({selected}: {selected:Atom<string>}, {createElement}: RenderContext) {
        const list = new RxList(['a', 'b', 'c'])
        const uniqueMatch = list.createSelection(selected)

        return <div id='app'>
            {uniqueMatch.map(([item, isSelected]) => {
                const style = () => ({
                    color: isSelected() ? 'red' : 'blue'
                })
                return <div style={style}>{item}</div>
            })}
        </div>
    }

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('complex style', () => {
        const selected = atom('b')
        root.render(<App selected={selected} />)

        const app = rootEl.querySelector('#app')!
        expect(app.children.length).toBe(3)
        expect(app.children[0].textContent).toBe('a')
        expect(app.children[1].textContent).toBe('b')
        expect(app.children[2].textContent).toBe('c')
        expect(getComputedStyle(app.children[0]).getPropertyValue('color')).toBe('blue')
        expect(getComputedStyle(app.children[1]).getPropertyValue('color')).toBe('red')
        expect(getComputedStyle(app.children[2]).getPropertyValue('color')).toBe('blue')

        selected('a')
        expect(getComputedStyle(app.children[0]).getPropertyValue('color')).toBe('red')
        expect(getComputedStyle(app.children[1]).getPropertyValue('color')).toBe('blue')
        expect(getComputedStyle(app.children[2]).getPropertyValue('color')).toBe('blue')
    })
})