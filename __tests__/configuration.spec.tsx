/** @vitest-environment happy-dom */
/** @jsx createElement */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, Component, createElement, createRoot, N_ATTR, PropTypes, RenderContext} from "@framework";
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
            $hello:style={{color:'rgb(255, 0, 0)'}}
            $hello:onClick={() => helloClicked2 = true}
            $hello:ref={helloRef2}
        >
        </App>)

        expect(helloRef.current).toBeDefined()
        expect(getComputedStyle(helloRef.current! as HTMLElement).getPropertyValue('color')).toBe('rgb(255, 0, 0)')
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
        const innerProps1 = {value:undefined} as any
        const innerProps2 = {value:undefined} as any

        function GrandChild({propRef, ...props}:any, {createElement}: RenderContext) {
            propRef.value = props
            return <div>
                hello world
            </div>
        }

        const Child:Component = ({propRef}, {createElement}: RenderContext) => {
            return <GrandChild propRef={propRef} as="grandChild"/>
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
                <Child as="child" propRef={innerProps1} $grandChild:style={{fontSize:12}} $grandChild:overwrite1={'from app'}/>
                <Child as="child" propRef={innerProps2} $grandChild:style={{fontSize:13}} $grandChild:overwrite1={'from app2'}/>
            </div>
        }

        root.render(<App $child={{'$grandChild:style': {padding:10}, '$grandChild:overwrite2': 'from root'}}/>)

        expect(innerProps1.value.style).toMatchObject([{color:'red'}, {fontSize:12}, {padding:10}])
        expect(innerProps1.value.overwrite1).toBe('from app')
        expect(innerProps1.value.overwrite2).toBe('from root')
        expect(innerProps2.value.style).toMatchObject([{color:'red'}, {fontSize:13}, {padding:10}])
        expect(innerProps2.value.overwrite1).toBe('from app2')
        expect(innerProps2.value.overwrite2).toBe('from root')
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

    test('configure overwrite Component style should not affect each other', () => {
        function Child(props:any, {createElement}: RenderContext) {
            // 有 &:hover 才能被当做 unhandledAttr 走 StaticHost 生成 class 的分支
            return <div as={'root'} style={{color:'red', '&:hover': {color:'cyan'}}}>
                hello
            </div>
        }

        let childRef1:any
        let childRef2:any
        let childRef3:any

        function App(props:any, {createElement, createRef}: RenderContext) {
            childRef1 = createRef()
            childRef2 = createRef()
            childRef3 = createRef()
            return <div>
                <Child $root:ref={childRef1}/>
                <Child $root:ref={childRef2} $root:style={{color:'green'}}/>
                <Child $root:ref={childRef3} $root:style={{color:'blue'}}/>
            </div>
        }

        root.render(<App/>)

        expect(getComputedStyle(childRef1.current).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(childRef2.current).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(childRef3.current).color).toBe('rgb(0, 0, 255)')
    })

    test('configure overwrite Component with reactive style should not affect each other', () => {
        function Child(props:any, {createElement}: RenderContext) {
            return <div as={'root'} style={{color:'red'}}>
                hello
            </div>
        }

        let childRef1:any
        let childRef2:any
        let childRef3:any
        const style1 = atom({color:'green'})
        const style2 = atom({color:'blue'})

        function App(props:any, {createElement, createRef}: RenderContext) {
            childRef1 = createRef()
            childRef2 = createRef()
            childRef3 = createRef()
            return <div>
                <Child $root:ref={childRef1}/>
                <Child $root:ref={childRef2} $root:style={style1}/>
                <Child $root:ref={childRef3} $root:style={style2}/>
            </div>
        }

        root.render(<App/>)

        expect(getComputedStyle(childRef1.current).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(childRef2.current).color).toBe('rgb(0, 128, 0)')
        expect(getComputedStyle(childRef3.current).color).toBe('rgb(0, 0, 255)')
    })
})