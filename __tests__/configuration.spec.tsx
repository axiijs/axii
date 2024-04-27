/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, RenderContext, N_ATTR} from "@framework";
import userEvent from "@testing-library/user-event";

describe('component configuration', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('get inner ref and attach listener', async () => {

        let helloClicked = false
        const helloRef = {current: null}

        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <div as="hello" onClick={() => helloClicked = true} ref={helloRef}>
                    hello world
                </div>
            </div>
        }

        let helloClicked2 = false
        const helloRef2 = {current: null}

        root.render(<App
            $hello:style={{color:'red'}}
            $hello:onClick={() => helloClicked2 = true}
            $hello:ref={helloRef2}
        >
        </App>)

        expect(helloRef.current).toBeDefined()
        expect(getComputedStyle(helloRef.current! as HTMLElement).getPropertyValue('color')).toBe('red')
        expect(helloRef.current).toBe(helloRef2.current)

        await userEvent.click(helloRef.current!)
        expect(helloClicked).toBe(true)
        expect(helloClicked2).toBe(true)
    })

    test('pass configuration into children of component', async () => {

        let helloClicked = false
        const helloRef = {current: null}

        function Child(props:any, {createElement}: RenderContext) {
            return <div as="hello" ref={helloRef}>
                hello world
            </div>
        }

        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <Child as="child" />
            </div>
        }

        root.render(<App
            $child = {{
                "$hello:onClick": () => helloClicked = true,
            }}
        />)

        await userEvent.click(helloRef.current!)
        expect(helloClicked).toBe(true)
    })

    test('use component to rewrite element', async () => {

        let childOuterProps:any = null
        let nativeAttrs:any = {}

        function Child(props:any, {createElement}: RenderContext) {
            childOuterProps = props.outer
            nativeAttrs = props[N_ATTR]
            return <div >
                hello world
            </div>
        }

        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <div as="inner" style={{color:'red'}} prop:outer={props} />
            </div>
        }

        const appProps = {
            hello: 'world'
        }
        root.render(<App
            {...appProps}
            $inner:_use = {Child}
        />)

        expect(childOuterProps.hello).toEqual(appProps.hello)
        expect(nativeAttrs.style).toEqual({color:'red'})

    })

    test('rewrite with element', () => {
        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <div as="inner" style={{color:'red'}} prop:outer={props} />
            </div>
        }

        const appProps = {
            hello: 'world'
        }
        root.render(<App
            {...appProps}
            $inner:_use = {<div>hello world</div>}
        />)
        expect(rootEl.querySelector('div')!.textContent).toBe('hello world')
    })
})