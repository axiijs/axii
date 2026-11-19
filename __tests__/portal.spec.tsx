/** @jsx createElement */
import {ContextProvider, createElement, createRoot, ModalContext, RenderContext} from "@framework";
import {atom} from "data0";
import {beforeEach, describe, expect, test, vi} from "vitest";


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

    test('container element from another same-origin document (iframe) is used as is', async () => {
        // 同源 iframe 的元素来自另一个 realm，instanceof HTMLElement 为 false；
        //  4.7.0 把它当成 {id} 去本文档 getElementById，找不到就抛错。
        const frame = document.createElement('iframe')
        document.body.appendChild(frame)
        const foreignDocument = frame.contentDocument!
        const foreignContainer = foreignDocument.createElement('div')
        foreignContainer.id = 'only-in-the-other-document'
        foreignDocument.body.appendChild(foreignContainer)
        expect(foreignContainer instanceof HTMLElement).toBe(false)

        const text = atom('in the other document')
        function App({}, { createElement, createPortal }: RenderContext) {
            return <div>{createPortal(() => <span>{text}</span>, foreignContainer)}</div>
        }
        root.render(<App />)
        expect(foreignContainer.textContent).toBe('in the other document')
        text('updated')
        expect(foreignContainer.textContent).toBe('updated')
        root.destroy()
        expect(foreignContainer.textContent).toBe('')
        frame.remove()
    })

    test('should warn if reuse content', async () => {
        const warn = vi.spyOn(console, 'error')
        const visible = atom(true)
        function App({}, { createPortal }: RenderContext) {
            const inner = <div>portal content</div>
            return <div>
                {() => visible() ? createPortal(inner, portalContainer) : null}
            </div>
        }

        root.render(<App />)
        expect(warn).toBeCalledTimes(0)
        visible(false)
        await wait(10)
        visible(true)
        await wait(10)
        expect(warn).toBeCalledTimes(1)
        expect(warn).toBeCalledWith('static portal content can only be rendered once. Use function content for content has reactive parts.')
    })
})