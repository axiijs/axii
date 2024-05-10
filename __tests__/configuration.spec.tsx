/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {Component, createElement, createRoot, N_ATTR, PropTypes, RenderContext, atom} from "@framework";
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

    test('use $self to merge props', () => {
        function App(props:any, {createElement}: RenderContext) {
            const {children, ...otherProps} = props
            return <div {...otherProps} $self:style={{color:'blue'}}>
            </div>
        }

        root.render(<App
            style={{fontSize:24}}
        />)

        const style=rootEl.querySelector('div')!.style
        expect(style.color).toBe('blue')
        expect(style.fontSize).toBe('24px')
    })

    test('configuration should overwrite bound props', () => {
        let innerProps: any

        function GrandChild(props:any, {createElement}: RenderContext) {
            innerProps = props
            return <div>
                hello world
            </div>

        }

        const Child:Component = ({}, {createElement}: RenderContext) => {
            return <GrandChild as="grandChild"/>
        }

        Child.boundProps = [{
            //  should combine
            '$grandChild:style': {
                color: 'red'
            },
            // should overwrite
            '$grandChild:overwrite1': 'from child',
            '$grandChild:overwrite2': 'from child'
        }]


        function App({}, {createElement}: RenderContext) {
            return <div>
                <Child as="child" $grandChild:style={{fontSize:12}} $grandChild:overwrite1={'from app'}/>
            </div>
        }

        root.render(<App $child={{'$grandChild:style': {padding:10}, '$grandChild:overwrite2': 'from root'}}/>)

        expect(innerProps.style).toMatchObject([{color:'red'}, {fontSize:12}, {padding:10}])
        expect(innerProps.overwrite1).toBe('from app')
        expect(innerProps.overwrite2).toBe('from root')
    })

    test('configure component rewrite element', () => {
        let childOuterProps:any = null
        let nativeAttrs:any = {}

        function Child(props:any, {createElement}: RenderContext) {
            childOuterProps = props.outer
            nativeAttrs = props[N_ATTR]
            return <div >
                hello
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
            $inner:style={{color:'blue'}}
        />)

        expect(childOuterProps.hello).toEqual(appProps.hello)
        expect(nativeAttrs.style).toMatchObject([{color:'red'},{color:'blue'}])
    })

    test('configure component rewrite component with propTypes defaultValue', () => {
        let childProps:any = null

        function Child(props:any, {createElement}: RenderContext) {
            childProps = props
            return <div >
                hello
            </div>
        }

        Child.propTypes = {
            color: PropTypes.atom<string>().default(() => atom('red')),
            color2: PropTypes.atom<string>().default(() => atom('red'))
        }

        function App(props:any, {createElement}: RenderContext) {
            return <div>
                <Child as="child" />
            </div>
        }

        root.render(<App
            $child:color='blue'
        />)

        expect(childProps.color()).toBe('blue')
        expect(childProps.color2()).toBe('red')

    })
})