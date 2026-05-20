/** @jsx createElement */
import {
    atom,
    createChildPathContext,
    createElement,
    createRef,
    createRoot,
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    SimpleElementHost,
    StaticHost,
    StaticHostConfig
} from "@framework";
import {beforeEach, describe, expect, test, vi} from "vitest";

// function eventToPromise(el: HTMLElement, event: string) {
//     return new Promise(resolve => {
//         el.addEventListener(event, resolve, { once: true })
//     })
// }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))
function commentTexts(root: Node) {
    const comments: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    let node = walker.nextNode()
    while (node) {
        comments.push(node.textContent ?? '')
        node = walker.nextNode()
    }
    return comments
}
function logDocumentAdoptedStyleSheets() {
  console.log(
    Array.from(document.adoptedStyleSheets)
      .map(s => Array.from(s.cssRules)
        .map(rule => rule.cssText)
        .join('\n'))
      .join('--------\n')
  )
}

describe('static host render', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
        document.adoptedStyleSheets = []
        StaticHostConfig.autoGenerateTestId = false
    })

    test('element should remove after transition done', async () => {

        const visible = atom(true)
        const style2 = {height:50}
        let ref = createRef()
        function App() {
            const style = {
                height:10,
                transition: 'all .5s',
            }
            return <div>
                {()=> visible() ? <div ref={ref} style={[style]} detachStyle={style2}>visible</div> : null}
            </div>
        }
        root.render(<App/>)

        //  transition start
        visible(false)
        // function node 不是立即移除，所以还要先等个 100 才能验证
        await new Promise(resolve => setTimeout(resolve, 50))
        expect((rootEl.firstElementChild!.firstElementChild! as HTMLElement).style.height).toBe('50px')
        expect(rootEl.firstElementChild!.firstElementChild!).not.toBeUndefined()
        //
        await new Promise(resolve => setTimeout(resolve, 500))
        expect(rootEl.firstElementChild!.firstElementChild!).toBeNull()
        expect(ref.current).toBeNull()

        // expect(rootEl.firstElementChild!.firstElementChild!).not.toBeUndefined()
    })

    test('render animated element', async () => {
        let ref = createRef()
        function App() {
            const animationStyle = {
                'animation': '@self 1s infinite',
                '@keyframes' : {
                    '0%': {opacity: 0},
                    '100%': {opacity: 1}
                }
            }
            return <div>
                <div ref={ref} style={[animationStyle]}>visible</div>
            </div>
        }
        root.render(<App/>)
        expect((rootEl.firstElementChild!.firstElementChild! as HTMLElement).getAnimations().length).toBe(1)
        const opacity = getComputedStyle(rootEl.firstElementChild!.firstElementChild! as HTMLElement).opacity
        await new Promise(resolve => setTimeout(resolve, 100))
        const currentOpacity = getComputedStyle(rootEl.firstElementChild!.firstElementChild! as HTMLElement).opacity
        expect(currentOpacity).not.toBe(opacity)
    })

    test('generate static test-id on element have reactive attribute', () => {
        StaticHostConfig.autoGenerateTestId = true
        function App() {
            return <div>
                <div style={()=>({})}>visible</div>
            </div>
        }
        root.render(<App/>)
        expect(rootEl.firstElementChild!.firstElementChild!.getAttribute('data-testid')).not.toBeNull
    })

    test('update array attribute', () => {
        const arr = atom([1,2,3])
        function App() {
            return <div>
                <div data-arr={[0, arr]}>visible</div>
            </div>
        }
        root.render(<App/>)
        expect((rootEl.firstElementChild!.firstElementChild! as HTMLElement).dataset.arr).toBe('0,1,2,3')
    })

    test('light dynamic attribute updates single dep primitive value and stops on destroy', async () => {
        const className = atom('a')
        let runs = 0
        function App() {
            return <div>
                <div className={() => {
                    runs++
                    return className()
                }}>visible</div>
            </div>
        }

        root.render(<App/>)
        const el = rootEl.firstElementChild!.firstElementChild! as HTMLElement
        expect(el.getAttribute('class')).toBe('a')
        expect(runs).toBe(1)

        className('b')
        await sleep(1)
        expect(el.getAttribute('class')).toBe('b')
        expect(runs).toBe(2)

        root.destroy()
        className('c')
        await sleep(1)
        expect(runs).toBe(2)
        expect(el.getAttribute('class')).toBe('b')
    })

    test('retained diagnostics count hosts and light bindings without retaining destroyed objects', () => {
        enableAxiiRetainedObjectDiagnostics({reset: true})
        try {
            const label = atom('a')
            function App() {
                return <div>
                    <div className={() => label()}>{() => label()}</div>
                </div>
            }

            root.render(<App/>)
            const afterCreate = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(afterCreate.enabled).toBe(true)
            expect(afterCreate.hosts.totalActive).toBeGreaterThan(0)
            expect(afterCreate.lightBindings.totalActive).toBeGreaterThan(0)
            expect(afterCreate.lightBindings.activeByType.LightReactiveAttributeBinding).toBe(1)
            expect(afterCreate.lightBindings.activeByType.InlineFunctionTextBinding).toBe(1)

            root.destroy()
            const afterDestroy = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(afterDestroy.hosts.totalActive).toBe(0)
            expect(afterDestroy.lightBindings.totalActive).toBe(0)
            expect(afterDestroy.data0.reactiveEffects.totalActive).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })

    test('light dynamic attribute falls back when dependency shape changes', async () => {
        const mode = atom('single')
        const extra = atom('extra')
        function App() {
            return <div>
                <div className={() => mode() === 'multi' ? extra() : mode()}>visible</div>
            </div>
        }

        root.render(<App/>)
        const el = rootEl.firstElementChild!.firstElementChild! as HTMLElement
        expect(el.getAttribute('class')).toBe('single')

        mode('multi')
        await sleep(1)
        expect(el.getAttribute('class')).toBe('extra')

        extra('changed')
        await sleep(1)
        expect(el.getAttribute('class')).toBe('changed')
    })

    test('direct atom dynamic attribute uses light primitive path', async () => {
        const disabled = atom(false)
        function App() {
            return <div>
                <button disabled={disabled}>submit</button>
            </div>
        }

        root.render(<App/>)
        const el = rootEl.firstElementChild!.firstElementChild! as HTMLButtonElement
        expect(el.hasAttribute('disabled')).toBe(false)

        disabled(true)
        await sleep(1)
        expect(el.hasAttribute('disabled')).toBe(true)
    })

    test('single dynamic attribute uses packed host without array or stop closure', async () => {
        const title = atom('a')
        const host = root.render(<div title={title}>visible</div>)
        const el = rootEl.firstElementChild as HTMLElement

        expect(host).toBeInstanceOf(SimpleElementHost)
        expect(Array.isArray((host as any).attrBinding)).toBe(false)
        expect((host as any).attrBinding).toBeTruthy()
        expect((host as any).attrBinding.stopAutoRender).toBeUndefined()
        expect(el.getAttribute('title')).toBe('a')

        title('b')
        await sleep(1)
        expect(el.getAttribute('title')).toBe('b')

        root.destroy()
        title('c')
        await sleep(1)
        expect(el.getAttribute('title')).toBe('b')
        expect((host as any).attrBinding).toBeUndefined()
    })

    test('multiple dynamic attributes still store and destroy all bindings', async () => {
        const title = atom('a')
        const ariaLabel = atom('label-a')
        const host = root.render(<div title={title} aria-label={ariaLabel}>visible</div>) as StaticHost
        const el = rootEl.firstElementChild as HTMLElement

        expect((host as any).attrBindings).toHaveLength(2)
        expect(el.getAttribute('title')).toBe('a')
        expect(el.getAttribute('aria-label')).toBe('label-a')

        title('b')
        ariaLabel('label-b')
        await sleep(1)
        expect(el.getAttribute('title')).toBe('b')
        expect(el.getAttribute('aria-label')).toBe('label-b')

        root.destroy()
        title('c')
        ariaLabel('label-c')
        await sleep(1)
        expect(el.getAttribute('title')).toBe('b')
        expect(el.getAttribute('aria-label')).toBe('label-b')
        expect((host as any).attrBindings).toBeUndefined()
    })

    test('simple root metadata reuses shared path arrays', () => {
        const titleA = atom('a')
        const titleB = atom('b')
        const firstDynamicAttr = <div title={titleA}>first</div> as any
        const secondDynamicAttr = <div title={titleB}>second</div> as any
        const firstInlineChild = <span>{() => 'first'}</span> as any
        const secondInlineChild = <span>{() => 'second'}</span> as any

        expect(firstDynamicAttr.unhandledAttr[0].path).toEqual([])
        expect(firstDynamicAttr.unhandledAttr[0].path).toBe(secondDynamicAttr.unhandledAttr[0].path)
        expect(firstInlineChild.inlineFunctionChild.path).toEqual([0])
        expect(firstInlineChild.inlineFunctionChild.path).toBe(secondInlineChild.inlineFunctionChild.path)
    })

    test('simple element shape uses packed host and complex shape falls back', () => {
        const simpleHost = root.render(<span>simple</span>)
        expect(simpleHost).toBeInstanceOf(SimpleElementHost)
        root.destroy()

        root = createRoot(rootEl)
        const ref = createRef<HTMLElement>()
        const refHost = root.render(<span ref={ref}>with ref</span>)
        expect(refHost).toBeInstanceOf(StaticHost)
        root.destroy()

        root = createRoot(rootEl)
        const title = atom('title')
        const attrHost = root.render(<span title={title}>dynamic attr</span>)
        expect(attrHost).toBeInstanceOf(SimpleElementHost)
        root.destroy()

        root = createRoot(rootEl)
        StaticHostConfig.autoGenerateTestId = true
        const testIdHost = root.render(<span title={title}>dynamic attr</span>)
        expect(testIdHost).toBeInstanceOf(StaticHost)
    })

    test('path context stays compact when no debug source is present', () => {
        const host = root.render(<span>simple</span>)
        expect(host.pathContext).toBe(root.pathContext)

        const childContext = createChildPathContext(host.pathContext, host)
        expect('debugSource' in childContext).toBe(false)
    })

    test('static host releases retained metadata after destroy', () => {
        const title = atom('title')
        const ref = createRef<HTMLElement>()

        const host = root.render(<div ref={ref} title={title}>{() => 'child'}</div>) as StaticHost

        expect((host as any).attrBindings).toBeTruthy()
        expect(host.inlineFunctionTextBindings?.length).toBe(1)
        expect(host.refHandles?.length).toBe(1)

        root.destroy()

        expect(ref.current).toBeNull()
        expect((host as any).attrBindings).toBeUndefined()
        expect(host.inlineFunctionTextBindings).toBeUndefined()
        expect(host.refHandles).toBeUndefined()
        expect(host.detachStyledChildren).toBeUndefined()
    })

    test('inline single function child primitive text without function host comment', async () => {
        const label = atom<string | null>('a')
        const createComment = vi.spyOn(document, 'createComment')

        const host = root.render(<span>{() => label()}</span>)
        const span = rootEl.firstElementChild!
        const textNode = span.firstChild

        expect(host).toBeInstanceOf(SimpleElementHost)
        expect((host as any).textBinding.childPathContext).toBeUndefined()
        expect((host as any).textBinding.stopAutoRender).toBeUndefined()
        expect(textNode?.nodeType).toBe(Node.TEXT_NODE)
        expect(span.textContent).toBe('a')
        expect(commentTexts(span)).not.toContain('unhandledChild')
        expect(createComment).not.toHaveBeenCalledWith('unhandledChild')

        label('b')
        await sleep(1)
        expect(span.firstChild).toBe(textNode)
        expect(span.textContent).toBe('b')
        expect(commentTexts(span)).not.toContain('unhandledChild')

        label(null)
        await sleep(1)
        expect(span.childNodes.length).toBe(0)
        expect(commentTexts(span)).not.toContain('unhandledChild')
        createComment.mockRestore()
    })

    test('inline single function child can fall back to generic host output', async () => {
        const rich = atom(false)

        const host = root.render(<span>{() => rich() ? <strong>rich</strong> : 'plain'}</span>)
        const span = rootEl.firstElementChild!

        expect(span.textContent).toBe('plain')
        expect((host as any).textBinding.childPathContext).toBeUndefined()
        expect(commentTexts(span)).not.toContain('unhandledChild')

        rich(true)
        await sleep(1)
        expect((host as any).textBinding.childPathContext).toBeDefined()
        expect(span.firstElementChild?.tagName).toBe('STRONG')
        expect(span.textContent).toBe('rich')

        rich(false)
        await sleep(1)
        expect(span.firstChild?.nodeType).toBe(Node.TEXT_NODE)
        expect(span.textContent).toBe('plain')
        expect(commentTexts(span)).not.toContain('unhandledChild')
    })

    test('inline single function child coalesces primitive text updates and stops on destroy', async () => {
        const label = atom('a')
        const extraTrigger = atom(0)
        let runs = 0

        root.render(<span>{() => {
            runs++
            extraTrigger()
            return label()
        }}</span>)
        const span = rootEl.firstElementChild!

        expect(span.textContent).toBe('a')
        expect(runs).toBe(1)

        label('b')
        extraTrigger(1)
        await sleep(1)
        expect(span.textContent).toBe('b')
        expect(runs).toBe(2)

        root.destroy()
        label('c')
        extraTrigger(2)
        await sleep(1)
        expect(runs).toBe(2)
    })

    test('direct atom child uses light text binding and stops on destroy', async () => {
        const label = atom('a')

        root.render(<span>{label}</span>)
        const span = rootEl.firstElementChild!
        const textNode = span.firstChild

        expect(textNode?.nodeType).toBe(Node.TEXT_NODE)
        expect(span.textContent).toBe('a')

        label('b')
        expect(span.firstChild).toBe(textNode)
        expect(span.textContent).toBe('b')

        root.destroy()
        label('c')
        await sleep(1)
        expect(span.textContent).toBe('b')
    })

    test('derived atom child falls back to full computed binding', async () => {
        const visible = atom(true)
        const label = atom('a')
        const derived = atom.lazy(() => visible() ? label() : 'hidden')

        root.render(<span>{derived}</span>)
        const span = rootEl.firstElementChild!

        expect(span.textContent).toBe('a')

        label('b')
        await sleep(1)
        expect(span.textContent).toBe('b')

        visible(false)
        await sleep(1)
        expect(span.textContent).toBe('hidden')
    })

    test('inline single function child preserves nested effect ownership for structural output', async () => {
        const visible = atom(true)
        const label = atom('a')

        root.render(<span>{() => visible() ? <strong>{() => label()}</strong> : null}</span>)
        const span = rootEl.firstElementChild!

        expect(span.firstElementChild?.tagName).toBe('STRONG')
        expect(span.textContent).toBe('a')

        visible(false)
        await sleep(1)
        expect(span.childNodes.length).toBe(0)

        label('b')
        visible(true)
        await sleep(1)
        expect(span.firstElementChild?.tagName).toBe('STRONG')
        expect(span.textContent).toBe('b')
    })

    test('inline single function child runs user cleanup on destroy', () => {
        const cleanup = vi.fn()

        root.render(<span>{({onCleanup}: any) => {
                onCleanup(cleanup)
                return 'text'
            }}</span>)
        root.destroy()

        expect(cleanup).toHaveBeenCalledTimes(1)
    })

    test('camelize ^data-* attribute to use dataset correctly', () => {
        const value = 'hello-world'
        function App() {
            return <div>
                <div data-foo-bar={value}>visible</div>
            </div>
        }
        root.render(<App/>)
        expect((rootEl.firstElementChild!.firstElementChild! as HTMLElement).dataset.fooBar).toBe('hello-world')
    })

    test('cleanup dynamic style sheets after host destroyed', async () => {
        const shown = atom(true)
        function App() {
            return <div>
                {() => shown() ? <div style={{ background: 'red', '&:hover': { background: 'blue' }}}>inner</div> : null}
                test
            </div>
        }
        root.render(<App />)
        expect(Array.from(document.adoptedStyleSheets).length).toBe(1)

        shown(false)
        await sleep(10)
        expect(Array.from(document.adoptedStyleSheets).length).toBe(0)
    })

    test('cleanup stylesheet by ref counting', async () => {
        const shown1 = atom(true)
        const shown2 = atom(true)

        function Comp({ children }: any) {
          return <div style={{ background: 'red', '&:hover': { background: 'blue' }}}>{children}</div>
        }

        function App() {
            return <div>
                {() => shown1() ? <Comp>1</Comp> : null}
                {() => shown2() ? <Comp>2</Comp> : null}
            </div>
        }
        root.render(<App />)
        expect(Array.from(document.adoptedStyleSheets).length).toBe(1)
        
        shown1(false)
        await sleep(10)
        // 按照引用计数，这里 style 还有引用，故而不该被删除
        expect(Array.from(document.adoptedStyleSheets).length).toBe(1)

        shown2(false)
        await sleep(10)
        // 这里删除 style sheet
        expect(Array.from(document.adoptedStyleSheets).length).toBe(0)
    })
})
