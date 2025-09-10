/** @jsx createElement */
import {atom, createElement, createRef, createRoot, StaticHostConfig} from "@framework";
import {beforeEach, describe, expect, test} from "vitest";

// function eventToPromise(el: HTMLElement, event: string) {
//     return new Promise(resolve => {
//         el.addEventListener(event, resolve, { once: true })
//     })
// }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))
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
