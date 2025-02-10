/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {
    createElement,
    createReactivePosition,
    createRoot,
    PositionObject,
    reactiveMouseIn,
    reactiveSize,
    RenderContext,
    SizeObject
} from "@framework";
import {atom} from "data0";

function wait(time: number) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('ref', () => {

    let root: ReturnType<typeof createRoot>
    let rootEl: any
    let portalContainer: any
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        portalContainer = document.createElement('div')
        document.body.style.width = '800px'
        document.body.style.height = 'auto'
        document.body.appendChild(rootEl)
        document.body.appendChild(portalContainer)
        root = createRoot(rootEl)
    })

    test('create reactive size state', async () => {
        let size: any
        const innerText = atom('hello world')
        let spanRef
        function App({}, {createElement, createStateFromRef, createRef}: RenderContext) {
            size = createStateFromRef<SizeObject>(reactiveSize)
            spanRef = createRef()
            return (
                <span ref={[size.ref, spanRef]}>{innerText}</span>
            )
        }

        root.render(<App />)

        // await window.happyDOM.waitUntilComplete()

        expect(size()).not.toBeNull()
        expect(size()!.width).not.toBeNull()
        expect(size()!.height).not.toBeNull()

        const last = size()
        innerText('hello world 2222')

        await wait(100)
        expect(spanRef!.current.innerText === 'hello world 2222')
        expect(size().width).not.toEqual(last.width)
    })


    test('createRxRectRef with manual handled', async () => {
        const appRef = atom<any>(null)

        function App({}, {createElement,  createStateFromRef}: RenderContext) {

            const portalRectRef = createStateFromRef<SizeObject>(reactiveSize, portalContainer)

            return (
                <div>{portalRectRef()?.width}</div>
            )
        }

        root.render(<App __this={appRef}/>)

        // expect(rootEl.innerText).toBe('0')
        // 在浏览器中跑 vitest，应该有值
        expect(rootEl.innerText).not.toBe('0')
        const lastAppRef = appRef()
        expect(lastAppRef.cleanupsOfExternalTarget.size).toBe(1)

        root.destroy()
        expect(lastAppRef.cleanupsOfExternalTarget.size).toBe(0)

    })


    test('create reactive position', async () => {
        let position: any
        const style = atom({})
        function App({}, {createElement, createStateFromRef, createRef}: RenderContext) {
            position = createStateFromRef<PositionObject>(createReactivePosition({type:'interval', duration:50}))
            return (
                <div style={style} >
                    <span ref={position.ref}>Hello World</span>
                </div>
            )
        }

        root.render(<App/>)

        await wait(100)
        expect(position()).not.toBeNull()
        const last = position()
        style({paddingTop: 100})

        await wait(100)
        expect(position().top).not.toEqual(last.top)
    })

    test('reactive mouse in state', async () => {
        let container
        let mouseIn:any
        function App({}, {createElement, createStateFromRef, createRef}: RenderContext) {
            mouseIn = createStateFromRef<boolean>(reactiveMouseIn)
            container = createRef()
            return (
                <div ref={[mouseIn.ref, container]} >
                    Hello World
                </div>
            )
        }
        root.render(<App/>)

        container!.current.dispatchEvent(new MouseEvent('mouseenter'))
        expect(mouseIn()).toBe(true)

        container!.current.dispatchEvent(new MouseEvent('mouseleave'))
        expect(mouseIn()).toBe(false)

    })

})