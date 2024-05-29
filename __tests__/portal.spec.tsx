/** @vitest-environment happy-dom */
/** @jsx createElement */
import {ContextProvider, createElement, createRoot, ModalContext, RenderContext} from "@framework";
import {atom, setDefaultScheduleRecomputedAsLazy} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

setDefaultScheduleRecomputedAsLazy(true)


describe('portal', () => {

    const wait = (time: number) => {
        return new Promise(resolve => {
            setTimeout(resolve, time)
        })
    }

    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    let portalContainer: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        portalContainer = document.createElement('div')
        document.body.appendChild(rootEl)
        document.body.appendChild(portalContainer)
        root = createRoot(rootEl)
    })


    test('portal should work', async () => {
        function InPortal({}, { context}: RenderContext) {
            return <div>{context.get(ModalContext)}</div>
        }

        const portalText = atom('portal content')
        const showPortal2 = atom(true)

        /* @jsx createElement*/
        function App({}, { createElement, createPortal }: RenderContext) {
            return <div >
                <ContextProvider contextType={ModalContext} value={'app context'}>
                    <div>app content</div>
                    {createPortal(<div>{portalText}</div>, portalContainer)}
                    {() => showPortal2() ? createPortal(<div>portal 2</div>, portalContainer):null}
                    {createPortal(<InPortal />, portalContainer)}
                </ContextProvider>
            </div>
        }

        root.render(<App />)
        expect(rootEl.innerText).toBe('app content')
        expect(portalContainer.innerText).toBe('portal content\nportal 2\napp context')

        portalText('portal content updated')
        showPortal2(false)
        await wait(10)
        expect(portalContainer.innerText).toBe('portal content updated\napp context')
    })
})