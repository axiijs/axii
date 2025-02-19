/** @jsx createElement */
import {createElement, createEventTransfer, createRoot, dispatchEvent, onKey, RenderContext} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";
import userEvent from "@testing-library/user-event";

describe('event transfer', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })


    test('basic component & reactive frag',
        async () => {

            const eventTransfer =createEventTransfer(() =>{
                return new CustomEvent('ccclick')
            })

            let worldClicked = false
            const helloRef = {current:null}

            function App() {
                return <div>
                    <div onClick={eventTransfer.source} ref={helloRef}>hello</div>
                    <div ref={eventTransfer.target} onCcclick={() => worldClicked = true}>world</div>
                </div>
            }

            root.render(<App/>)

            await userEvent.click(helloRef.current!)
            expect(worldClicked).toBe(true)
        })

    test('manual dispatch event on element with multiple listener', () => {
        let called = false
        let called2 = false
        let ref:any

        function App({}, {createRef}: RenderContext) {
            ref = createRef()

            return <div >
                <div ref={ref} onCustomevent={[() => called = true, () => called2 =true]}>1</div>
            </div>
        }
        root.render(<App/>)
        dispatchEvent(ref.current, new CustomEvent('customevent'))
        expect(called).toBeTruthy()
        expect(called2).toBeTruthy()
    })

    test('keyboard event', () => {
        let called = false
        let ref:any
        function App({}, {createRef}: RenderContext) {
            ref = createRef()

            return <div >
                <div ref={ref} onKeyDown={onKey('a', {meta:true, ctrl:true, alt:true, shift:true})(() => called = true)}>1</div>
            </div>
        }
        root.render(<App/>)
        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key:'a', altKey:false, ctrlKey:true, metaKey:true, shiftKey:true}))
        expect(called).toBeFalsy()

        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key:'a', altKey:true, ctrlKey:false, metaKey:true, shiftKey:true}))
        expect(called).toBeFalsy()

        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key:'a', altKey:true, ctrlKey:true, metaKey:false, shiftKey:true}))
        expect(called).toBeFalsy()


        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key:'a', altKey:true, ctrlKey:true, metaKey:true, shiftKey:false}))
        expect(called).toBeFalsy()

        dispatchEvent(ref.current, new KeyboardEvent('keydown', {key:'a', altKey:true, ctrlKey:true, metaKey:true, shiftKey:true}))
        expect(called).toBeTruthy()
    })

    test('use event captrue', async () => {
        let ref:any
        const info:string[] = []
        function App({}, {createRef}: RenderContext) {
            ref = createRef()

            return <div >
                <div ref={ref} onClickCapture={() => info.push('capture')} onClick={() => info.push('click')}>1</div>
            </div>
        }
        root.render(<App/>)

        await userEvent.click(ref.current)
        expect(info).toEqual(['capture', 'click'])
    })
})
