/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, RenderContext, setAutoUnitType} from "@framework";
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
        expect(Array.from(appFirstEl.classList).length).toBe(1)

        const lastDiv = document.getElementById('pContainer')!
        const classList = Array.from(lastDiv.classList)
        expect(classList.length).toBe(1)
        const lastP = lastDiv.lastElementChild as HTMLElement
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('rgb(255, 0, 0)')

        lastChildColor('rgb(0, 128, 0)')
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('rgb(0, 128, 0)')
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

    test('more StyleSize', () => {
        const base = new StyleSize(1, 'rem')
        const size1 = base.add(1, 'px')
        const size2 = size1.div(2)
        expect(size2.toString()).toBe('calc((1rem + 1px) / 2)')


        const size3 = size2.clone()
        expect(size3.toString()).toBe('calc((1rem + 1px) / 2)')
        expect(size3.valueOf()).toBe('calc((1rem + 1px) / 2)')

        const size4 = new StyleSize(2, 'rem')
        const size5 = new StyleSize(1, 'rem')
        size4.sub(size5)
        expect(size4.toString()).toBe('1rem')

        const size6 = new StyleSize(1, 'rem')
        size6.add(size5)
        expect(size6.toString()).toBe('2rem')
    })

    test('support object style classname by default', () => {
        function App({}, {createElement}: RenderContext) {
            const classnames = {
                'class1': true,
                'class2': false,
                'class3': true
            }
            return <div className={[classnames, 'class4']}>app</div>
        }

        root.render(<App />)
        const app = rootEl.firstElementChild!
        expect(app.classList.contains('class1')).toBeTruthy()
        expect(app.classList.contains('class2')).toBeFalsy()
        expect(app.classList.contains('class3')).toBeTruthy()
        expect(app.classList.contains('class4')).toBeTruthy()

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
        expect(getComputedStyle(app.children[0]).getPropertyValue('color')).toBe('rgb(0, 0, 255)')
        expect(getComputedStyle(app.children[1]).getPropertyValue('color')).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(app.children[2]).getPropertyValue('color')).toBe('rgb(0, 0, 255)')

        selected('a')
        expect(getComputedStyle(app.children[0]).getPropertyValue('color')).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(app.children[1]).getPropertyValue('color')).toBe('rgb(0, 0, 255)')
        expect(getComputedStyle(app.children[2]).getPropertyValue('color')).toBe('rgb(0, 0, 255)')
    })


    test('set global auto unit type', () => {
        setAutoUnitType('em')
        const style = new StyleSize(1)
        expect(style.toString()).toBe('1em')
    })

    test('use string type as style content',() => {
        const style = 'color: red'
        const App = () => {
            return <div style={style}>app</div>
        }
        root.render(<App />)
        const app = rootEl.firstElementChild!
        expect(getComputedStyle(app).getPropertyValue('color')).toBe('rgb(255, 0, 0)')
    })

    test('remove style if value set to falsy value', () => {
        const style = atom({color: 'red'})
        const App = () => {
            return <div style={style}>app</div>
        }
        root.render(<App />)
        const app = rootEl.firstElementChild!
        expect(getComputedStyle(app).getPropertyValue('color')).toBe('rgb(255, 0, 0)')

        style(undefined)
        expect(getComputedStyle(app).getPropertyValue('color')).not.toBe('rgb(255, 0, 0)')
    })

    test('multiple value style prop should accept array', () => {
        // boxShadow 可以用
        const style = atom({
            boxShadow: ['1px 1px 1px red', '2px 2px 2px blue'],
            padding: ['1px', '2px'],
            margin: [undefined, '2px']
        })
        const App = () => {
            return <div style={style}>app</div>
        }
        root.render(<App />)
        const app = rootEl.firstElementChild!
        expect(getComputedStyle(app).getPropertyValue('box-shadow')).toBe('rgb(255, 0, 0) 1px 1px 1px 0px, rgb(0, 0, 255) 2px 2px 2px 0px')
        expect(getComputedStyle(app).getPropertyValue('padding')).toBe('1px 2px')
        expect(getComputedStyle(app).getPropertyValue('margin')).toBe('0px 2px')
    })

    test('accept array of number and string unit as size value', () => {
        const style = atom({
            padding: [1, 'px'],
            margin: [2, 'px']
        })
        const App = () => {
            return <div style={style}>app</div>
        }
        root.render(<App />)
        const app = rootEl.firstElementChild!
        expect(getComputedStyle(app).getPropertyValue('padding')).toBe('1px')
        expect(getComputedStyle(app).getPropertyValue('margin')).toBe('2px')
    })

})

