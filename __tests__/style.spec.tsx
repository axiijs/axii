/** @vitest-environment jsdom */
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

        return <div style={innerStyle}>
            <div>app</div>
            <a>test</a>
            <div style={randomStyle}>
                <p>p1</p>
                <p>p2</p>
            </div>
        </div>
    }

    test('psuedo class in js', () => {
        root.render(<App />)

        const appFirstEl = rootEl.firstElementChild!
        expect(appFirstEl.classList.contains('gen-0--')).toBe(true)

        const lastDiv = appFirstEl.lastElementChild!
        const classList = Array.from(lastDiv.classList)
        expect(classList.length).toBe(1)
        const lastP = lastDiv.lastElementChild as HTMLElement
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('rgb(255, 0, 0)')

        lastChildColor('green')
        expect(getComputedStyle(lastP).getPropertyValue('color')).toBe('rgb(0, 128, 0)')
    })

})