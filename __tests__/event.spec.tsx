/** @vitest-environment jsdom */
/** @jsx createElement */
import {createElement, createEventTransfer, createRoot} from "@framework";
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

            const eventTransfer =createEventTransfer()

            let worldClicked = false
            const helloRef = {current:null}

            function App() {
                return <div>
                    <div onClick={eventTransfer.source} ref={helloRef}>hello</div>
                    <div ref={eventTransfer.target} onClick={() => worldClicked = true}>world</div>
                </div>
            }

            root.render(<App/>)

            await userEvent.click(helloRef.current!)
            expect(worldClicked).toBe(true)
        })
})
