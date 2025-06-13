/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {
    createElement,
    RxDOMRect,
    RxDOMSize,
    createRoot,
    RectObject,
    RxDOMHovered,
    RenderContext, RxDOMFocused, createRef, RxDOMScrollPosition,
} from "@framework";
import {atom, RxList} from "data0";

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
        let rxSize: any
        const innerText = atom('hello world')
        let spanRef
        function App({}, {createElement,  createRef}: RenderContext) {
            rxSize = new RxDOMSize()
            spanRef = createRef()
            return (
                <span ref={[rxSize.ref, spanRef]}>{innerText}</span>
            )
        }

        root.render(<App />)

        // await window.happyDOM.waitUntilComplete()

        expect(rxSize.value()).not.toBeNull()
        expect(rxSize.value()!.width).not.toBeNull()
        expect(rxSize.value()!.height).not.toBeNull()

        const last = rxSize.value()
        innerText('hello world 2222')

        await wait(100)
        expect(spanRef!.current.innerText === 'hello world 2222')
        expect(rxSize.value().width).not.toEqual(last.width)
    })

    test('create reactive rect state of window', async () => {
        let rxSize: any
        const innerText = atom('hello world')
        function App({}, {createElement,  createRef}: RenderContext) {
            rxSize = new RxDOMRect(atom<RectObject>(null), {type:'interval', duration:50})
            rxSize.ref(window)
            return (
                <span>{innerText}</span>
            )
        }

        root.render(<App />)

        await wait(100)
        expect(rxSize.value()).not.toBeNull()
        root.destroy()
        expect(rxSize.value()).toBeNull()

    })

    test('create reactive rect state of element using events', async () => {
        const container1 = createRef()
        const container2 = createRef()
        let rect1:RxDOMRect
        function App({}, {createElement,  createRef}: RenderContext) {
            rect1 = new RxDOMRect(atom<RectObject>(null), [{event:'scroll', target:container1}, {event:'scroll', target:container2}])
            return <div style={{height: 100, overflow: 'auto'}} ref={container1}>
                <div style={{height:200, overflow: 'auto'}} ref={container2}>
                    <div style={{height:300, overflow: 'auto'}} ref={rect1.ref}></div>
                </div>
            </div>
        }

        root.render(<App />)
        expect(rect1!.value()).not.toBeNull()
        const lastTop = rect1!.value()!.top
        container1.current.scrollTop = 100
        await wait(30)
        const lastTop2 = rect1!.value()!.top
        expect(lastTop2).not.toEqual(lastTop)

        container2.current.scrollTop = 100
        await wait(30)
        const lastTop3 = rect1!.value()!.top
        expect(lastTop3).not.toEqual(lastTop2)

        root.destroy()
        expect(rect1!.value()).toBeNull()
    })

    test('create reactive rect state of element using signal', async () => {
        const signal = atom(false)
        const content = new RxList<any>(['hello world'])
        let rxSize: any
        function App({}, {createElement}: RenderContext) {
            rxSize = new RxDOMRect(atom<RectObject>(null), {type:'signal', signal})
            return <span ref={rxSize.ref}>{content}</span>
        }

        root.render(<App />)
        const lastSize = rxSize.value()
        expect(lastSize).not.toBeNull()
        signal(false)

        content.push('hello world 2')
        const lastSize2 = rxSize.value()
        expect(lastSize2).toEqual(lastSize)

        signal(true)
        await wait(100)
        const lastSize3 = rxSize.value()
        expect(lastSize3).not.toEqual(lastSize2)
    })

    test('create reactive size state of window', async () => {
        let rxSize: any
        const innerText = atom('hello world')
        function App({}, {createElement,  createRef}: RenderContext) {
            rxSize = new RxDOMSize()
            rxSize.ref(window)
            return (
                <span>{innerText}</span>
            )
        }

        root.render(<App />)

        expect(rxSize.value()).not.toBeNull()
        root.destroy()
        expect(rxSize.value()).toBeNull()
    })


    test('create RxSize with manual handled', async () => {
        let portalSize: any
        function App({}, {createElement}: RenderContext) {

            portalSize = new RxDOMSize()
            portalSize.ref(portalContainer)

            return (
                <div>{portalSize.value()?.width}</div>
            )
        }

        root.render(<App />)

        // expect(rootEl.innerText).toBe('0')
        // 在浏览器中跑 vitest，应该有值
        expect(rootEl.innerText).not.toBe('0')
        root.destroy()
        expect(portalSize.value()).toBeNull()
        expect(portalSize.abort).toBeUndefined()

    })


    test('create reactive position', async () => {
        let rxPosition: RxDOMRect
        const style = atom({})
        function App({}, {createElement, createRef}: RenderContext) {
            rxPosition = new RxDOMRect(atom<RectObject>(null), {type:'interval', duration:50})
            return (
                <div style={style} >
                    <span ref={rxPosition.ref}>Hello World</span>
                </div>
            )
        }

        root.render(<App/>)

        await wait(100)
        expect(rxPosition!.value()).not.toBeNull()
        const last = rxPosition!.value()!
        style({paddingTop: 100})

        await wait(100)
        expect(rxPosition!.value()?.top).not.toEqual(last.top)
    })

    test('reactive mouse in state', async () => {
        let container
        let mouseIn:any
        function App({}, {createElement, createRef}: RenderContext) {
            const rxHovered = new RxDOMHovered()
            mouseIn = rxHovered.value
            container = createRef()
            return (
                <div ref={[rxHovered.ref, container]} >
                    Hello World
                </div>
            )
        }
        root.render(<App/>)

        container!.current.dispatchEvent(new MouseEvent('mouseenter'))
        expect(mouseIn()).toBe(true)

        container!.current.dispatchEvent(new MouseEvent('mouseleave'))
        expect(mouseIn()).toBe(false)

        root.destroy()
        expect(mouseIn()).toBeNull()

    })


    test('create reactive size state inside function node', async () => {
        let rxSize: any
        const innerText = atom('hello world')
        const visible = atom(true)
        function App({}, {createElement,  createRef}: RenderContext) {
            rxSize = new RxDOMSize()
            return (
                <div>
                    {() => visible() ? <span ref={[rxSize.ref]}>{innerText}</span> : null}
                </div>
            )
        }

        root.render(<App />)
        expect(rxSize.value()).not.toBeNull()

        visible(false)
        await wait(100)
        expect(rxSize.value()).toBeNull()

    })

    test('create reactive focused state', async () => {
        let focused: any
        const ref = createRef()
        const innerText = atom('hello world')
        function App({}, {createElement, createRef}: RenderContext) {
            focused = new RxDOMFocused()
            return (
                <div>
                    <input ref={[focused.ref, ref]} />
                    <span>{innerText}</span>
                </div>
            )
        }

        root.render(<App />)
        expect(focused.value()).toBe(false)

        ref.current.focus()
        await wait(100)
        expect(focused.value()).toBe(true)

        ref.current.blur()
        await wait(100)
        expect(focused.value()).toBe(false)

        root.destroy()
        expect(focused.value()).toBeNull()
    })

    test('create reactive scroll position', async () => {
        let scroll: any
        const containerRef = createRef()
        function App({}, {createElement,  createRef}: RenderContext) {
            scroll = new RxDOMScrollPosition()
            return (
                <div ref={[scroll.ref, containerRef]} style={{height:100, overflow:'auto'}}>
                    <div style={{height:200}}></div>
                </div>
            )
        }

        root.render(<App />)

        expect(scroll.value()).not.toBeNull()
        expect(scroll.value().scrollTop).toBe(0)
        containerRef.current.scrollTop = 100
        await wait(100)
        expect(scroll.value().scrollTop).toBe(100)
        root.destroy()
        expect(scroll.value()).toBeNull()
    })

})