/** @vitest-environment happy-dom */
/** @jsx createElement */
import {
    createElement,
    createEventTransfer,
    createRoot,
    eventAlias, jsx, jsxDEV, jsxs,
    RenderContext, withCurrentRange,
    withPreventDefault, withStopPropagation
} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";


describe('component render', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('render svg', async () => {

        function Icon(
            {},
            { createSVGElement: createElement }: RenderContext
        ) {
            return (
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M14.4688 1C15.3125 1 15.9688 1.6875 15.9688 2.5V13.5C15.9688 14.3438 15.2812 15 14.4688 15H1.46875C0.65625 15 0 14.3438 0 13.5V2.5C0 1.6875 0.65625 1 1.46875 1H14.4688ZM3.46875 12.75L3.4375 11.25C3.4375 11.125 3.3125 11 3.1875 11H1.71875C1.5625 11 1.46875 11.125 1.46875 11.25V12.75C1.46875 12.9062 1.5625 13 1.71875 13H3.21875C3.34375 13 3.46875 12.9062 3.46875 12.75ZM3.46875 8.75H3.4375V7.25C3.4375 7.125 3.3125 7 3.1875 7H1.71875C1.5625 7 1.46875 7.125 1.46875 7.25V8.75C1.46875 8.90625 1.5625 9 1.71875 9H3.21875C3.34375 9 3.46875 8.90625 3.46875 8.75ZM3.46875 4.75L3.4375 3.25C3.4375 3.125 3.3125 3 3.1875 3H1.71875C1.5625 3 1.46875 3.125 1.46875 3.25V4.75C1.46875 4.90625 1.5625 5 1.71875 5H3.21875C3.34375 5 3.46875 4.90625 3.46875 4.75ZM10.9688 12.5V9.5C10.9688 9.25 10.7188 9 10.4688 9H5.46875C5.1875 9 4.96875 9.25 4.96875 9.5V12.5C4.96875 12.7812 5.1875 13 5.46875 13H10.4688C10.7188 13 10.9688 12.7812 10.9688 12.5ZM10.9688 6.5V3.5C10.9688 3.25 10.7188 3 10.4688 3H5.46875C5.1875 3 4.96875 3.25 4.96875 3.5V6.5C4.96875 6.78125 5.1875 7 5.46875 7H10.4688C10.7188 7 10.9688 6.78125 10.9688 6.5ZM14.4688 12.75H14.5V11.25C14.5 11.125 14.375 11 14.25 11H12.75C12.625 11 12.5 11.125 12.5 11.25V12.75C12.5 12.9062 12.5938 13 12.75 13H14.2188C14.3438 13 14.4688 12.9062 14.4688 12.75ZM14.4688 8.75V7.25C14.4688 7.125 14.3438 7 14.2188 7H12.75C12.5938 7 12.5 7.125 12.5 7.25V8.75C12.5 8.90625 12.5938 9 12.75 9H14.2188C14.3438 9 14.4688 8.90625 14.4688 8.75ZM14.4688 4.75H14.4375V3.25C14.4375 3.125 14.3125 3 14.1875 3H12.7188C12.5938 3 12.5 3.125 12.5 3.25V4.75C12.5 4.90625 12.5938 5 12.75 5H14.2188C14.3438 5 14.4688 4.90625 14.4688 4.75Z"
                        fill="white"
                    />
                </svg>
            )
        }
        function App() {
            return <div>
                <Icon />
            </div>
        }

        root.render(<App/>)
        expect(rootEl.firstElementChild!.children[0]).instanceOf(SVGElement)
    })


    test('event alias', () => {
        let called = false
        const onCustomEvent = eventAlias((e:CustomEvent) => e.detail === 'custom event')(() => called = true)
        let ref:any
        function App({}, {createRef}: RenderContext) {
            ref = createRef()
            return <div ref={ref}>
            </div>
        }
        root.render(<App/>)

        ref.current.addEventListener('custom', onCustomEvent)
        ref.current.dispatchEvent(new CustomEvent('custom', {detail: 'custom event'}))
        expect(called).toBeTruthy()
    })

    test('event transfer', () => {
        let called = false
        let ref:any
        let ref2:any
        const {source, target} = createEventTransfer()

        function App({}, {createRef}: RenderContext) {
            ref = createRef()
            ref2 = createRef()

            return <div >
                <div ref={ref}>1</div>
                <div ref={[ref2, target]}>2</div>
            </div>
        }
        root.render(<App/>)

        ref.current.addEventListener('custom', source)
        ref2.current.addEventListener('custom', () => called = true)
        ref.current.dispatchEvent(new CustomEvent('custom', {detail: 'custom event'}))
        expect(called).toBeTruthy()
    })

    test('event utils', () =>{
        let ref:any
        function App({}, {createRef}: RenderContext) {
            ref = createRef()

            return <div >
                <div ref={ref}>1</div>
            </div>
        }
        root.render(<App/>)

        let event1:any
        let event2:any
        let passedInRange: any
        ref.current.addEventListener('custom', withPreventDefault((e:Event) => event1 = e))
        ref.current.addEventListener('custom', withStopPropagation((e:Event) => event2 = e))
        ref.current.addEventListener('custom', withCurrentRange((e:any, range:any) => passedInRange = range))
        ref.current.dispatchEvent(new CustomEvent('custom', {
            cancelable:true,
            detail: 'custom event',
            bubbles: true
        }))
        expect(event1.defaultPrevented).toBeTruthy()
        expect(event2.bubbling).toBeFalsy()
        expect(passedInRange).toBeUndefined()
    })

    test('jsx runtime', () => {
        const jsxEl = jsx('div', {id: 'jsx', children: 'child'}) as HTMLElement
        expect(jsxEl).instanceOf(HTMLElement)
        expect(jsxEl.innerHTML).toBe('child')

        const jsxEls = jsxs('div', {id: 'jsx',  children: ['1', '2']}) as HTMLElement
        expect(jsxEls).instanceOf(HTMLElement)
        expect(jsxEls.innerHTML).toBe('12')


        const jsxDevEl = jsxDEV('div', {id: 'jsx', children: 'child'}) as HTMLElement
        expect(jsxDevEl).instanceOf(HTMLElement)
        expect(jsxDevEl.innerHTML).toBe('child')
    })

    test('render select', () => {
        function App() {
            return <div>
                <select value={"1"}>
                    <option value="1">1</option>
                    <option value="2">2</option>
                </select>
            </div>
        }
        root.render(<App/>)
        expect(rootEl.firstElementChild!.firstElementChild).instanceOf(HTMLSelectElement)
        // 判断是否选中了1
        expect((rootEl.firstElementChild!.firstElementChild as HTMLSelectElement).selectedIndex).toBe(0)
    })

})
