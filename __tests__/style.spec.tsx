/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {createRoot, RenderContext, createElement} from "@framework";
import {atom} from "data0";

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

})