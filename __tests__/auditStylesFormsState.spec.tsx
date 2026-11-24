/** @jsx createElement */
/** @jsxFrag Fragment */
/**
 * Audit of reactiveDOMState / styleSerialize / styleCascade / eventAlias / propTypes / Form /
 * util / diagnostics / retainedObjectDiagnostics, and regression tests for the fixes.
 *
 * - "findings" (F1-F8), "confirmed, below the cut" (B1-B5) and "cross-area" (X1, X2): each of
 *   these FAILS on the audited tree (v4.8.1 + pending PR). With the fixes
 *   (audit-prototype/final.patch, already applied to src/) all of them pass except X1, which is
 *   RxListHost.handleSplice ordering and belongs to another reviewer: it is expected to fail.
 * - "regressions for the fixes": extra branches the fixes touch. Most fail on the audited tree;
 *   a few are controls that pass on both trees (unchanged behaviour that must stay unchanged).
 *
 * Related specs in one process: sh audit-prototype/run-related.sh
 * DOM-free counterpart: __tests__/node/auditStyleSerialize.spec.ts (sh audit-prototype/run-node.sh)
 */
import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {
    atom,
    bindProps,
    configureDiagnostics,
    createElement,
    createRef,
    createRoot,
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    Form,
    FormContext,
    Fragment,
    generateStyleContent,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    hydrateRoot,
    PropTypes,
    RenderContext,
    resetAxiiRetainedObjectDiagnostics,
    RxDOMDragState,
    RxDOMFocused,
    RxDOMSize,
    RxList,
    RxMap,
    RxSet,
    setAutoUnitType,
    StaticHost,
    StyleSize,
} from "@framework";
import {renderToString} from "../src/ssr.js";

async function settle() {
    for (let i = 0; i < 100; i++) await Promise.resolve()
}

function frames() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
}

let root: ReturnType<typeof createRoot>
let rootEl: HTMLElement
beforeEach(() => {
    document.body.innerHTML = ''
    rootEl = document.createElement('div')
    document.body.appendChild(rootEl)
    root = createRoot(rootEl)
})
afterEach(() => {
    setAutoUnitType('px')
})

// A form field written against the public FormContext contract
function Field({name, value}: any, {context, onCleanup, createElement}: RenderContext) {
    const form = context.get(FormContext)
    const instance = {value, reset() {}, clear() {}}
    form.register(name, instance)
    onCleanup(() => form.unregister(name, instance))
    return <input/>
}

describe('audit attrs: findings', () => {
    test('F1: a selector nested under a selector-list parent applies under every parent', () => {
        // CSS Nesting: `& span` under `&.a, &.b` means `:is(<el>.a, <el>.b) span`
        root.render(
            <div className="a" style={{'&.a, &.b': {'& span': {backgroundColor: 'rgb(255, 0, 0)'}}}}>
                <span>x</span>
            </div>
        )
        const div = rootEl.firstElementChild as HTMLElement
        const span = div.firstElementChild as HTMLElement
        expect(getComputedStyle(span).backgroundColor).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(div).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    })

    test('F2a: a later style entry overrides an earlier plain entry', () => {
        root.render(
            <div style={[
                {color: 'rgb(0, 0, 255)'},
                {color: 'rgb(255, 0, 0)', '&:hover': {textDecoration: 'underline'}},
            ]}>x</div>
        )
        expect(getComputedStyle(rootEl.firstElementChild!).color).toBe('rgb(255, 0, 0)')
    })

    test('F2b: an AOP style override keeps overriding once it contains a nested selector', () => {
        function Button({}: any, {createElement}: RenderContext) {
            return <button as="root" style={{color: 'rgb(0, 0, 255)'}}>ok</button>
        }
        root.render(<div>
            <Button $root:style={{color: 'rgb(255, 0, 0)'}}/>
            <Button $root:style={{color: 'rgb(255, 0, 0)', '&:hover': {opacity: 0.8}}}/>
        </div>)
        const [plain, nested] = Array.from(rootEl.querySelectorAll('button'))
        expect(getComputedStyle(plain).color).toBe('rgb(255, 0, 0)')
        expect(getComputedStyle(nested).color).toBe('rgb(255, 0, 0)')
    })

    test('F3a: unmounting one of two same-name fields keeps the other one registered', async () => {
        const showFirst = atom(true)
        const values = new RxMap<string, any>({})
        const first = atom('A')
        const second = atom('B')
        root.render(
            <Form name="f" values={values}>
                <div>
                    {() => showFirst() ? <Field name="x" value={first}/> : null}
                    <Field name="x" value={second}/>
                </div>
            </Form>
        )
        expect(values.get('x')).toBe(second)
        showFirst(false)
        await settle()
        expect(rootEl.querySelectorAll('input').length).toBe(1)
        expect(values.get('x')).toBe(second)
    })

    test('F3b: replacing a list row that holds a field keeps the field registered', async () => {
        const values = new RxMap<string, any>({})
        const before = atom('A')
        const after = atom('B')
        const rows = new RxList<any>([{value: before}])
        root.render(
            <Form name="f" values={values}>
                <div>{rows.map((row: any) => <Field name="x" value={row.value}/>)}</div>
            </Form>
        )
        expect(values.get('x')).toBe(before)
        rows.splice(0, 1, {value: after})
        await settle()
        expect(rootEl.querySelectorAll('input').length).toBe(1)
        expect(values.get('x')).toBe(after)
    })

    test('F4: a reactive data-* attribute is written under the name the author wrote', () => {
        const id = atom('5')
        root.render(<div>
            <p data-item_id="5" data-level-1="5">static</p>
            <p data-item_id={id} data-level-1={id}>reactive</p>
        </div>)
        const [fixed, reactive] = Array.from(rootEl.querySelectorAll('p'))
        expect(fixed.getAttribute('data-item_id')).toBe('5')
        expect(fixed.getAttribute('data-level-1')).toBe('5')
        expect(reactive.getAttribute('data-item_id')).toBe('5')
        expect(reactive.getAttribute('data-level-1')).toBe('5')
    })

    test('F5a: animation longhands written after the `animation` shorthand survive', () => {
        root.render(
            <div style={{
                '@keyframes': {from: {opacity: 0}, to: {opacity: 1}},
                animation: '@self 10s linear',
                animationDelay: '2s',
                animationPlayState: 'paused',
            }}>x</div>
        )
        const style = getComputedStyle(rootEl.firstElementChild!)
        expect(style.animationName).not.toBe('none')
        expect(style.animationDelay).toBe('2s')
        expect(style.animationPlayState).toBe('paused')
    })

    test('F5b: a nullish conditional item in an animation array does not void the declaration', () => {
        const keyframes = document.createElement('style')
        keyframes.textContent = '@keyframes auditSpin { from { opacity: 0 } to { opacity: 1 } }'
        document.head.appendChild(keyframes)
        try {
            const reduced = false
            root.render(<div style={{animation: ['auditSpin 10s linear', reduced ? 'auditSpin 1s' : null]}}>x</div>)
            expect(getComputedStyle(rootEl.firstElementChild!).animationName).toBe('auditSpin')
        } finally {
            keyframes.remove()
        }
    })

    test('F6a: RxDOMDragState destroyed in the middle of a drag releases its listeners', () => {
        let drag!: RxDOMDragState
        function App({}, {createElement}: RenderContext) {
            drag = new RxDOMDragState()
            return <div ref={drag.ref} style={{width: 50, height: 50}}>drag</div>
        }
        root.render(<App/>)
        const el = rootEl.firstElementChild as HTMLElement
        el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 5, clientY: 5}))
        document.body.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 10, clientY: 10}))
        expect(drag.value()).not.toBeNull()
        root.destroy()
        expect(drag.value()).toBeNull()
        document.body.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 20, clientY: 20}))
        expect(drag.value()).toBeNull()
    })

    test('F6b: a press without a move does not emit dragend', () => {
        let drag!: RxDOMDragState
        function App({}, {createElement}: RenderContext) {
            drag = new RxDOMDragState()
            return <div ref={drag.ref} style={{width: 50, height: 50}}>drag</div>
        }
        root.render(<App/>)
        const events: any[] = []
        drag.addEventListener('dragstart', (e: any) => events.push(['dragstart', e.detail]))
        drag.addEventListener('dragend', (e: any) => events.push(['dragend', e.detail]))
        const el = rootEl.firstElementChild as HTMLElement
        el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 5, clientY: 5}))
        el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: 5, clientY: 5}))
        expect(events).toEqual([])
    })

    test('F7: a bound prop that evaluates to undefined keeps the declared default', () => {
        const seen: any[] = []
        function Comp({size}: any, {createElement}: RenderContext) {
            seen.push(size)
            return <div/>
        }
        Comp.propTypes = {size: PropTypes.string.default(() => 'medium')}
        // same "not provided" input, without and with a bindProps wrapper
        root.render(<Comp size={undefined}/>)
        expect(seen).toEqual(['medium'])
        const Bound = bindProps(Comp, (props: any) => ({size: props.compact ? 'small' : undefined}))
        createRoot(document.body.appendChild(document.createElement('div'))).render(<Bound/>)
        expect(seen).toEqual(['medium', 'medium'])
    })

    test('F8: setAutoUnitType applies to stylesheet rules as it does to inline styles', () => {
        setAutoUnitType('em')
        root.render(
            <div style={{fontSize: '10px'}}>
                <p style={{width: 10}}>inline</p>
                <p style={{width: 10, '&:hover': {color: 'red'}}}>stylesheet</p>
            </div>
        )
        const [inline, sheet] = Array.from(rootEl.querySelectorAll('p'))
        expect(getComputedStyle(inline).width).toBe('100px')
        expect(getComputedStyle(sheet).width).toBe('100px')
    })
})

describe('audit attrs: confirmed, below the cut', () => {
    test('B1a: PropTypes.number.parse throws for text that is not a number', () => {
        expect(() => PropTypes.number.parse('abc1')).toThrow()
    })

    test('B1b: oneOfType([number, string]) round-trips a string that contains a digit', () => {
        const type = PropTypes.oneOfType([PropTypes.number, PropTypes.string])
        expect(type.parse(type.stringify('abc1'))).toBe('abc1')
    })

    test('B1c: reactive prop types can be checked and combined', () => {
        expect(() => PropTypes.oneOfType([PropTypes.atom<number>(), PropTypes.number]).check(1)).not.toThrow()
        expect(PropTypes.atom<number>()(atom(1))).toBeUndefined()
    })

    test('B1d: PropTypes.map(...).check(null) answers false like shapeOf', () => {
        expect(PropTypes.shapeOf({a: PropTypes.string}).check(null)).toBe(false)
        expect(() => PropTypes.map({a: PropTypes.string}).check(null)).not.toThrow()
    })

    test('B2: the style host state counter does not go negative for hosts created before enabling', () => {
        root.render(<div style={{'&:hover': {color: 'red'}}}>x</div>)
        enableAxiiRetainedObjectDiagnostics()
        try {
            root.destroy()
            expect(getAxiiRetainedObjectDiagnosticsSnapshot().styles.activeHostStyleStates).toBe(0)
        } finally {
            disableAxiiRetainedObjectDiagnostics()
        }
    })

    test('B3: RxDOMFocused reports false (attached, not focused) again after a remount', async () => {
        const visible = atom(true)
        let focused!: RxDOMFocused
        function App({}, {createElement}: RenderContext) {
            focused = new RxDOMFocused()
            return <div>{() => visible() ? <input ref={focused.ref}/> : null}</div>
        }
        root.render(<App/>)
        expect(focused.value()).toBe(false)
        visible(false)
        await settle()
        expect(focused.value()).toBeNull()
        visible(true)
        await settle()
        expect(rootEl.querySelector('input')).not.toBeNull()
        expect(focused.value()).toBe(false)
    })

    // The invariant: what RxDOMSize reports synchronously on attach is what the observer then
    //  delivers. (The first version of this test also required the inline element's synchronous
    //  width to be > 0; that part was dropped when the fix took the observer as the reference:
    //  ResizeObserver reports 0x0 for non-replaced inline elements.)
    test('B4: RxDOMSize of an inline element reports the same size before and after the first observer delivery', async () => {
        let inline!: RxDOMSize
        let block!: RxDOMSize
        function App({}, {createElement}: RenderContext) {
            inline = new RxDOMSize()
            block = new RxDOMSize()
            return <div>
                <span ref={inline.ref}>hello world</span>
                <span ref={block.ref} style={{display: 'inline-block'}}>hello world</span>
            </div>
        }
        root.render(<App/>)
        const initialInline = {...inline.value()!}
        const initialBlock = {...block.value()!}
        expect(initialBlock.width).toBeGreaterThan(0)
        await frames()
        await frames()
        expect(block.value()).toEqual(initialBlock)
        expect(inline.value()).toEqual(initialInline)
    })

    test('B5: the [number, unit] shorthand works for time units', () => {
        root.render(<div style={{transitionDuration: [300, 'ms']}}>x</div>)
        expect((rootEl.firstElementChild as HTMLElement).style.transitionDuration).toBe('300ms')
    })
})

describe('audit attrs: cross-area observations', () => {
    test('X1: a ref shared by the rows of a list points at the new row after splice-replace', async () => {
        const list = new RxList<number>([1])
        const ref = createRef()
        let size!: RxDOMSize
        function App({}, {createElement}: RenderContext) {
            size = new RxDOMSize()
            return <div>{list.map(item => <p ref={[size.ref, ref]} style={{width: 20, height: 20}}>{item}</p>)}</div>
        }
        root.render(<App/>)
        list.splice(0, 1, 2)
        await settle()
        expect(rootEl.querySelectorAll('p').length).toBe(1)
        expect(ref.current).toBe(rootEl.querySelector('p'))
        expect(size.value()).not.toBeNull()
    })

    test('X2: StyleSize.add(number) on a mixed-unit size uses a real unit', () => {
        expect(new StyleSize(10, 'px').add(5, 'rem').add(2).toString()).toBe('calc((10px + 5rem) + 2px)')
    })
})

function lastSelector(rules: string[]) {
    return rules.at(-1)!.split('{')[0].trim()
}

describe('audit attrs: regressions for the fixes', () => {
    describe('F1 selector lists', () => {
        test('a list in the middle of three levels is expanded on every level', () => {
            const rules = generateStyleContent('.x', {'& .a': {'& .b, & .c': {'&:hover': {color: 'red'}}}})
            expect(lastSelector(rules)).toBe('.x .a .b:hover, .x .a .c:hover')
        })

        test('two lists multiply', () => {
            const rules = generateStyleContent('.x', {'&.a, &.b': {'& i, & b': {color: 'red'}}})
            expect(lastSelector(rules)).toBe('.x.a i, .x.a b, .x.b i, .x.b b')
        })

        test('a selector without & under a list parent is a descendant of every parent', () => {
            const rules = generateStyleContent('.x', {'&.a, &.b': {'span': {color: 'red'}}})
            expect(lastSelector(rules)).toBe('.x.a span, .x.b span')
        })

        test('a single parent keeps the previous text', () => {
            const rules = generateStyleContent('.x', {'&:hover': {'& > a, .wrap &': {color: 'red'}}})
            expect(lastSelector(rules)).toBe('.x:hover > a, .wrap .x:hover')
        })

        test('the selector handed to generateStyleContent may itself be a list', () => {
            const rules = generateStyleContent('.p, .q', {'& span': {color: 'red'}})
            expect(lastSelector(rules)).toBe('.p span, .q span')
        })

        test('an at-rule between a list parent and its nested selector', () => {
            root.render(
                <div className="a" style={{'&.a, &.b': {'@media (min-width: 1px)': {'& span': {backgroundColor: 'rgb(255, 0, 0)'}}}}}>
                    <span>x</span>
                </div>
            )
            const div = rootEl.firstElementChild as HTMLElement
            expect(getComputedStyle(div.firstElementChild!).backgroundColor).toBe('rgb(255, 0, 0)')
            expect(getComputedStyle(div).backgroundColor).toBe('rgba(0, 0, 0, 0)')
        })
    })

    describe('F2 entry order', () => {
        // stylesheet classes StyleManager puts on an element (static `…F<n>` and content `axs-…F<n>`)
        // (sorted: the order inside the class attribute carries no meaning and differs between SSR and CSR)
        function styleClassesOf(el: Element) {
            return Array.from(el.classList).filter(c => /F\d+/.test(c)).sort()
        }

        // 「后写的条目赢」只对顶层声明成立：stylesheet 条目把它顶层声明的属性从前面的行内样式里拿走。
        //  更早的行内值 vs 后面条目里的**嵌套**规则仍是行内赢——已知局限，与 v4.8.1 相同
        //  （修它需要把前面的行内条目搬进 stylesheet，代价是每行/每帧一张表，见下面的计数用例）。
        test.fails('known limitation: a later nested rule does not beat an earlier plain declaration', () => {
            root.render(
                <div className="on" style={[{color: 'rgb(0, 0, 255)'}, {'&.on': {color: 'rgb(255, 0, 0)'}}]}>x</div>
            )
            expect(getComputedStyle(rootEl.firstElementChild!).color).toBe('rgb(255, 0, 0)')
        })

        test('a stylesheet entry takes its own properties back from earlier inline entries; later inline entries win again', () => {
            root.render(
                <div style={[
                    {color: 'rgb(0, 0, 255)', marginTop: 1, paddingTop: 1},
                    {marginTop: 2, paddingTop: 2, '&:hover': {opacity: 0.8}},
                    {paddingTop: 3},
                ]}>x</div>
            )
            const el = rootEl.firstElementChild as HTMLElement
            const computed = getComputedStyle(el)
            expect(computed.color).toBe('rgb(0, 0, 255)')
            expect(computed.marginTop).toBe('2px')
            expect(computed.paddingTop).toBe('3px')
            // the earlier plain entry stays inline, minus what the stylesheet entry declares
            expect(el.style.cssText).toBe('color: rgb(0, 0, 255); padding-top: 3px;')
            expect(styleClassesOf(el).length).toBe(1)
        })

        test('shorthands and longhands: the browser decides what is taken back', () => {
            root.render(<div>
                <p id="a" style={[{margin: 4}, {marginTop: 5, '&:hover': {opacity: 0.8}}]}>a</p>
                <p id="b" style={[{marginTop: 7, marginLeft: 7}, {margin: 1, '&:hover': {opacity: 0.8}}]}>b</p>
                <p id="c" style={[{border: '2px solid rgb(255, 0, 0)'}, {borderColor: 'rgb(0, 0, 255)', '&:hover': {opacity: 0.8}}]}>c</p>
            </div>)
            const a = getComputedStyle(rootEl.querySelector('#a')!)
            expect([a.marginTop, a.marginRight, a.marginBottom, a.marginLeft]).toEqual(['5px', '4px', '4px', '4px'])
            const b = getComputedStyle(rootEl.querySelector('#b')!)
            expect([b.marginTop, b.marginLeft]).toEqual(['1px', '1px'])
            const c = getComputedStyle(rootEl.querySelector('#c')!)
            expect([c.borderTopWidth, c.borderTopStyle, c.borderTopColor]).toEqual(['2px', 'solid', 'rgb(0, 0, 255)'])
        })

        test('a declaration the stylesheet does not write does not take the inline value away', async () => {
            const on = atom(false)
            // (opacity 0.61: content-addressed sheets are shared across tests that are not destroyed)
            root.render(<div style={[{color: 'rgb(0, 0, 255)'}, () => ({color: on() ? 'rgb(255, 0, 0)' : null, '&:hover': {opacity: 0.61}})]}>x</div>)
            const el = rootEl.firstElementChild as HTMLElement
            expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
            on(true)
            await settle()
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
            on(false)
            await settle()
            expect(getComputedStyle(el).color).toBe('rgb(0, 0, 255)')
        })

        test('a string entry before a stylesheet entry yields too', () => {
            root.render(<div style={['color: rgb(0, 0, 255); margin-top: 3px', {color: 'rgb(255, 0, 0)', '&:hover': {opacity: 0.8}}]}>x</div>)
            const el = rootEl.firstElementChild as HTMLElement
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
            expect(getComputedStyle(el).marginTop).toBe('3px')
        })

        // Chain on one element: inner JSX style < bound `$name:style` < the caller's `$name:style`.
        //  An all-static plain chain is written inline by createElement (later wins). Once one entry is
        //  reactive the chain goes through StyleManager, where the bound entry is a stylesheet entry:
        //  before the fix the inner plain style then stayed inline and beat it (marginTop was 1px).
        test('a bound style overrides the inner plain style whether or not the chain is reactive', () => {
            function Box({}: any, {createElement}: RenderContext) {
                return <div as="root" style={{color: 'rgb(0, 0, 255)', marginTop: 1, paddingTop: 1}}>x</div>
            }
            const Styled = bindProps(Box, {'$root:style': {marginTop: 2, paddingTop: 2}})
            const pad = atom(3)
            root.render(<div>
                <Styled $root:style={{paddingTop: 3}}/>
                <Styled $root:style={() => ({paddingTop: pad()})}/>
            </div>)
            const [fixed, reactive] = Array.from(rootEl.firstElementChild!.children) as HTMLElement[]
            for (const el of [fixed, reactive]) {
                const computed = getComputedStyle(el)
                expect(computed.color).toBe('rgb(0, 0, 255)')
                expect(computed.marginTop).toBe('2px')
                expect(computed.paddingTop).toBe('3px')
            }
            // reactive chain: inner entry inline minus what the bound entry declares, the caller's entry after it
            expect(reactive.style.cssText).toBe('color: rgb(0, 0, 255); padding-top: 3px;')
            expect(styleClassesOf(reactive).length).toBe(1)
        })

        test('app CSS and ancestor rules keep losing to the inline value when a nested entry follows it', () => {
            const css = document.createElement('style')
            css.textContent = '.card .title { color: rgb(0, 128, 0) }'
            document.head.appendChild(css)
            try {
                root.render(<div class="card" style={{'& .t': {color: 'rgb(0, 128, 0)'}}}>
                    <div id="a" class="title" style={[{color: 'rgb(255, 0, 0)'}, {'&:hover': {opacity: 0.8}}]}>x</div>
                    <div id="b" class="t" style={[{color: 'rgb(255, 0, 0)'}, {'&:hover': {opacity: 0.8}}]}>x</div>
                </div>)
                expect(getComputedStyle(rootEl.querySelector('#a')!).color).toBe('rgb(255, 0, 0)')
                expect(getComputedStyle(rootEl.querySelector('#b')!).color).toBe('rgb(255, 0, 0)')
            } finally {
                css.remove()
            }
        })

        test('a reactive array flips between yielding and not without leaving classes, sheets or inline keys', async () => {
            const baseline = document.adoptedStyleSheets.length
            const nested = atom(true)
            root.render(
                <div style={[
                    {color: 'rgb(0, 0, 255)', marginTop: 3},
                    () => nested() ? {color: 'rgb(255, 0, 0)', '&:hover': {opacity: 0.79}} : {paddingTop: 4},
                ]}>x</div>
            )
            const el = rootEl.firstElementChild as HTMLElement
            const expectYielded = () => {
                expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
                expect(getComputedStyle(el).marginTop).toBe('3px')
                expect(getComputedStyle(el).paddingTop).toBe('0px')
                expect(el.style.cssText).toBe('margin-top: 3px;')
                expect(styleClassesOf(el).length).toBe(1)
                expect(document.adoptedStyleSheets.length - baseline).toBe(1)
            }
            const expectInline = () => {
                expect(styleClassesOf(el)).toEqual([])
                expect(document.adoptedStyleSheets.length - baseline).toBe(0)
                // (order inside cssText is CSSOM's: a property taken away and written again goes last)
                expect([el.style.color, el.style.marginTop, el.style.paddingTop]).toEqual(['rgb(0, 0, 255)', '3px', '4px'])
                expect(el.style.length).toBe(3)
            }
            expectYielded()
            nested(false)
            await settle()
            expectInline()
            nested(true)
            await settle()
            expectYielded()
            nested(false)
            await settle()
            expectInline()
            nested(true)
            await settle()
            root.destroy()
            expect(document.adoptedStyleSheets.length - baseline).toBe(0)
        })

        test('an earlier inline entry with a reactive value stays inline and follows the value', async () => {
            const color = atom('rgb(0, 0, 255)')
            root.render(
                <div style={[{backgroundColor: color}, {'&:hover': {opacity: 0.8}}]}>x</div>
            )
            const el = rootEl.firstElementChild as HTMLElement
            expect(el.style.backgroundColor).toBe('rgb(0, 0, 255)')
            color('rgb(0, 128, 0)')
            await settle()
            expect(getComputedStyle(el).backgroundColor).toBe('rgb(0, 128, 0)')
            expect(el.style.backgroundColor).toBe('rgb(0, 128, 0)')
            expect(styleClassesOf(el).length).toBe(1)
        })

        test('SSR emits the same classes and inline style as CSR when a stylesheet entry yields; hydration claims them', () => {
            const saved = document.adoptedStyleSheets
            document.adoptedStyleSheets = []
            let hydrated: ReturnType<typeof hydrateRoot> | undefined
            try {
                function App({}: any, {createElement}: RenderContext) {
                    return <div id="t" style={[
                        {color: 'rgb(0, 0, 255)', marginTop: 3},
                        {color: 'rgb(255, 0, 0)', '&:hover': {opacity: 0.78}},
                        {paddingTop: 7},
                    ]}>x</div>
                }
                root.render(<App/>)
                const csr = rootEl.querySelector('#t')!
                const csrClasses = styleClassesOf(csr)
                const csrInline = (csr as HTMLElement).style.cssText
                expect(csrClasses.length).toBe(1)
                expect(csrInline).toBe('margin-top: 3px; padding-top: 7px;')
                root.destroy()

                const {html, styles} = renderToString(createElement(App, null as any))
                const wrap = document.createElement('div')
                wrap.innerHTML = html
                const ssr = wrap.querySelector('#t') as HTMLElement
                expect(styleClassesOf(ssr)).toEqual(csrClasses)
                expect(ssr.style.cssText).toBe(csrInline)

                // before hydrate only the SSR <style> applies
                rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
                expect(getComputedStyle(rootEl.querySelector('#t')!).color).toBe('rgb(255, 0, 0)')
                hydrated = hydrateRoot(rootEl, createElement(App, null as any))
                const el = rootEl.querySelector('#t') as HTMLElement
                expect(styleClassesOf(el)).toEqual(csrClasses)
                expect(el.style.cssText).toBe(csrInline)
                expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
                expect(getComputedStyle(el).marginTop).toBe('3px')
                expect(getComputedStyle(el).paddingTop).toBe('7px')
                expect(document.adoptedStyleSheets.length).toBe(1)
            } finally {
                hydrated?.destroy()
                document.adoptedStyleSheets = saved
            }
        })

        // 服务端不解析简写：删分项时保留简写（激活前这一个分项不对），激活后 CSR 重写行内样式，与纯 CSR 一致
        test('shorthand/longhand corners the server cannot resolve are corrected by hydration', () => {
            const saved = document.adoptedStyleSheets
            document.adoptedStyleSheets = []
            let hydrated: ReturnType<typeof hydrateRoot> | undefined
            try {
                function App({}: any, {createElement}: RenderContext) {
                    return <p id="t" style={[{margin: 4}, {marginTop: 5, '&:hover': {opacity: 0.76}}]}>x</p>
                }
                const {html, styles} = renderToString(createElement(App, null as any))
                rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
                hydrated = hydrateRoot(rootEl, createElement(App, null as any))
                const computed = getComputedStyle(rootEl.querySelector('#t')!)
                expect([computed.marginTop, computed.marginRight, computed.marginBottom, computed.marginLeft]).toEqual(['5px', '4px', '4px', '4px'])
            } finally {
                hydrated?.destroy()
                document.adoptedStyleSheets = saved
            }
        })

        test('a hydrated element flips between yielding and plain inline and back', async () => {
            const saved = document.adoptedStyleSheets
            document.adoptedStyleSheets = []
            let hydrated: ReturnType<typeof hydrateRoot> | undefined
            try {
                const nested = atom(true)
                function App({}: any, {createElement}: RenderContext) {
                    return <div id="t" style={[
                        {color: 'rgb(0, 0, 255)', marginTop: 3},
                        () => nested() ? {color: 'rgb(255, 0, 0)', '&:hover': {opacity: 0.77}} : {paddingTop: 4},
                    ]}>x</div>
                }
                const {html, styles} = renderToString(createElement(App, null as any))
                rootEl.innerHTML = `<style data-axii-ssr>${styles}</style>${html}`
                hydrated = hydrateRoot(rootEl, createElement(App, null as any))
                const el = rootEl.querySelector('#t') as HTMLElement
                expect(styleClassesOf(el).length).toBe(1)
                expect(el.style.cssText).toBe('margin-top: 3px;')
                expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')

                nested(false)
                await settle()
                expect(styleClassesOf(el)).toEqual([])
                expect(document.adoptedStyleSheets.length).toBe(0)
                expect([el.style.color, el.style.marginTop, el.style.paddingTop]).toEqual(['rgb(0, 0, 255)', '3px', '4px'])
                expect(el.style.length).toBe(3)

                nested(true)
                await settle()
                expect(el.style.cssText).toBe('margin-top: 3px;')
                expect(styleClassesOf(el).length).toBe(1)
                expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)')
            } finally {
                hydrated?.destroy()
                document.adoptedStyleSheets = saved
            }
        })
    })

    describe('F3 same-name form fields', () => {
        test('unmounting the field registered last hands the name back to the one still mounted', async () => {
            const showSecond = atom(true)
            const showThird = atom(true)
            const values = new RxMap<string, any>({})
            const first = atom('A')
            const second = atom('B')
            const third = atom('C')
            root.render(
                <Form name="f" values={values}>
                    <div>
                        <Field name="x" value={first}/>
                        {() => showSecond() ? <Field name="x" value={second}/> : null}
                        {() => showThird() ? <Field name="x" value={third}/> : null}
                    </div>
                </Form>
            )
            expect(values.get('x')).toBe(third)
            // a field that is not the registered one goes away: nothing changes
            showSecond(false)
            await settle()
            expect(values.get('x')).toBe(third)
            // the registered one goes away: the remaining mounted field owns the name again
            showThird(false)
            await settle()
            expect(rootEl.querySelectorAll('input').length).toBe(1)
            expect(values.get('x')).toBe(first)
        })

        test('the last field of a name still removes the value', async () => {
            const show = atom(true)
            const values = new RxMap<string, any>({})
            root.render(
                <Form name="f" values={values}>
                    <div>{() => show() ? <Field name="x" value={atom('A')}/> : null}</div>
                </Form>
            )
            expect(values.get('x')).not.toBeUndefined()
            show(false)
            await settle()
            expect(values.get('x')).toBeUndefined()
            expect(Array.from(values.data.keys())).toEqual([])
        })
    })

    describe('F4 data-* attributes', () => {
        const NAMES = ['data-item_id', 'data-level-1', 'data-foo-bar', 'data-foobar']
        const dataAttributes = (el: Element) =>
            Array.from(el.attributes).map(attr => `${attr.name}=${attr.value}`).sort()

        const cases: [string, any, string | null][] = [
            ['false', false, 'false'],
            ['true', true, 'true'],
            ['zero', 0, '0'],
            ['a number', 5, '5'],
            ['NaN', NaN, 'NaN'],
            ['an empty string', '', ''],
            ['text', 'a b', 'a b'],
            ['an array', [1, 2], '1,2'],
            ['a nested array', [0, [1, 2, 3]], '0,1,2,3'],
            ['null', null, null],
            ['undefined', undefined, null],
        ]
        test.each(cases)('static and reactive paths write the same attributes for %s', async (_label, value, expected) => {
            const current = atom<any>('initial')
            root.render(<div>
                <p data-item_id={value} data-level-1={value} data-foo-bar={value} data-fooBar={value}>static</p>
                <p data-item_id={() => value} data-level-1={() => value} data-foo-bar={() => value}
                   data-fooBar={() => value}>reactive, first value</p>
                <p data-item_id={() => current()} data-level-1={() => current()} data-foo-bar={() => current()}
                   data-fooBar={() => current()}>reactive, after an update</p>
            </div>)
            const [fixed, first, updated] = Array.from(rootEl.querySelectorAll('p'))
            expect(dataAttributes(updated)).toEqual(NAMES.map(name => `${name}=initial`).sort())
            current(value)
            await settle()
            for (const name of NAMES) expect(fixed.getAttribute(name)).toBe(expected)
            expect(dataAttributes(first)).toEqual(dataAttributes(fixed))
            expect(dataAttributes(updated)).toEqual(dataAttributes(fixed))
        })

        test('a reactive data-* attribute is removed and written again under the same name', async () => {
            const id = atom<any>('5')
            root.render(<p data-item_id={id}>x</p>)
            const el = rootEl.firstElementChild as HTMLElement
            expect(dataAttributes(el)).toEqual(['data-item_id=5'])
            id(null)
            await settle()
            expect(el.attributes.length).toBe(0)
            id(false)
            await settle()
            expect(dataAttributes(el)).toEqual(['data-item_id=false'])
            id(undefined)
            await settle()
            expect(el.attributes.length).toBe(0)
        })

        test('an array with reactive items keeps being written whole (staticHost.spec "update array attribute")', async () => {
            const tail = atom([1, 2, 3])
            root.render(<p data-arr={[0, tail]}>x</p>)
            const el = rootEl.firstElementChild as HTMLElement
            expect(el.getAttribute('data-arr')).toBe('0,1,2,3')
            tail([9])
            await settle()
            expect(el.getAttribute('data-arr')).toBe('0,9')
        })
    })

    describe('F5 animation', () => {
        let keyframes: HTMLStyleElement
        beforeEach(() => {
            keyframes = document.createElement('style')
            keyframes.textContent = '@keyframes auditSpin { from { opacity: 0 } to { opacity: 1 } }'
            document.head.appendChild(keyframes)
        })
        afterEach(() => keyframes.remove())

        // the same declarations once inline (plain static object) and once as stylesheet rules
        function renderBoth(style: Record<string, any>) {
            root.render(<div>
                <p style={style}>inline</p>
                <p style={{...style, '&:hover': {opacity: 0.9}}}>stylesheet</p>
            </div>)
            const [inline, sheet] = Array.from(rootEl.querySelectorAll('p')) as HTMLElement[]
            expect(inline.style.cssText).not.toBe('')
            expect(sheet.style.cssText).toBe('')
            return [getComputedStyle(inline), getComputedStyle(sheet)]
        }

        test('longhands after the shorthand: the stylesheet path agrees with the inline path', () => {
            const [inline, sheet] = renderBoth({
                animation: 'auditSpin 10s linear',
                animationDelay: '2s',
                'animation-iteration-count': 3,
                animationPlayState: 'paused',
            })
            for (const computed of [inline, sheet]) {
                expect(computed.animationName).toBe('auditSpin')
                expect(computed.animationDuration).toBe('10s')
                expect(computed.animationDelay).toBe('2s')
                expect(computed.animationIterationCount).toBe('3')
                expect(computed.animationPlayState).toBe('paused')
            }
        })

        test('longhands before the shorthand are reset by it on both paths', () => {
            const [inline, sheet] = renderBoth({
                animationDelay: '2s',
                animation: 'auditSpin 10s linear',
                animationPlayState: 'paused',
            })
            for (const computed of [inline, sheet]) {
                expect(computed.animationName).toBe('auditSpin')
                expect(computed.animationDelay).toBe('0s')
                expect(computed.animationPlayState).toBe('paused')
            }
        })

        test('a reactive longhand after the shorthand keeps following its value', async () => {
            const paused = atom(true)
            root.render(
                <div style={{
                    '@keyframes': {from: {opacity: 0}, to: {opacity: 1}},
                    animation: '@self 10s linear infinite',
                    animationPlayState: () => paused() ? 'paused' : 'running',
                }}>x</div>
            )
            const el = rootEl.firstElementChild!
            expect(getComputedStyle(el).animationPlayState).toBe('paused')
            paused(false)
            await settle()
            expect(getComputedStyle(el).animationPlayState).toBe('running')
            expect(getComputedStyle(el).animationIterationCount).toBe('infinite')
            paused(true)
            await settle()
            expect(getComputedStyle(el).animationPlayState).toBe('paused')
        })

        test('animation with longhands inside a nested selector', () => {
            root.render(
                <div className="on" style={{'&.on': {animation: 'auditSpin 10s', animationFillMode: 'forwards'}}}>x</div>
            )
            const computed = getComputedStyle(rootEl.firstElementChild!)
            expect(computed.animationName).toBe('auditSpin')
            expect(computed.animationFillMode).toBe('forwards')
        })

        test('falsy items of an animation array are skipped; an all-falsy array is no animation', () => {
            root.render(<div>
                <p style={{animation: [false, 'auditSpin 10s linear', undefined, '', null]}}>one</p>
                <p style={{animation: [null, false, undefined], color: 'rgb(1, 2, 3)'}}>none</p>
                <p style={{animation: ['auditSpin 10s', () => 'auditSpin 20s']}}>two</p>
            </div>)
            const [one, none, two] = Array.from(rootEl.querySelectorAll('p'))
            expect(getComputedStyle(one).animationName).toBe('auditSpin')
            expect(getComputedStyle(none).animationName).toBe('none')
            expect(getComputedStyle(none).color).toBe('rgb(1, 2, 3)')
            expect(getComputedStyle(two).animationName).toBe('auditSpin, auditSpin')
            expect(getComputedStyle(two).animationDuration).toBe('10s, 20s')
            for (const sheet of document.adoptedStyleSheets) {
                for (const rule of Array.from(sheet.cssRules)) expect(rule.cssText).not.toMatch(/animation:\s*;|,\s*;/)
            }
        })

        test('the StyleManager helpers stay consistent when longhands follow the shorthand', () => {
            const manager = StaticHost.styleManager
            const style = {width: 12, '@keyframes': {to: {opacity: 1}}, animation: '1s @self', animationDelay: '2s'}
            const rules = manager.generateStyleContent('.audit-helper', style)
            expect(manager.generateInlineAnimationContent('.audit-helper', style)).toEqual(rules.slice(1))
            expect(rules.at(-1)).toMatch(/animation: animation-\w+ ?1s|animation: 1s animation-\w+/)
            expect(rules.at(-1)).toContain('animation-delay:2s;')
        })
    })

    describe('F7 declared defaults', () => {
        function setup() {
            const seen: any[] = []
            function Comp(props: any, {createElement}: RenderContext) {
                seen.push(props)
                return <div/>
            }
            Comp.propTypes = {
                size: PropTypes.string.default(() => 'medium'),
                count: PropTypes.atom<number>().default(() => atom(7)),
                values: PropTypes.rxMap<string, any>().default(() => new RxMap<string, any>({})),
                title: PropTypes.string,
            }
            return {Comp: Comp as any, seen}
        }
        const expectDefaults = (props: any) => {
            expect(props.size).toBe('medium')
            expect(props.count()).toBe(7)
            expect(props.values).toBeInstanceOf(RxMap)
        }

        test('a bound object or function that yields undefined', () => {
            const {Comp, seen} = setup()
            let boundSaw: any
            const WithObject = bindProps(Comp, {size: undefined, count: undefined, values: undefined})
            const WithFunction = bindProps(Comp, (props: any) => {
                boundSaw = props
                return {size: props.compact ? 'small' : undefined, values: undefined}
            })
            root.render(<div><WithObject/><WithFunction/><WithFunction compact/></div>)
            expectDefaults(seen[0])
            expectDefaults(seen[1])
            expect(seen[2].size).toBe('small')
            // the default instance the bound function saw is the one the component receives
            root.destroy()
            const one = createRoot(document.body.appendChild(document.createElement('div')))
            one.render(<WithFunction/>)
            expect(seen[3].values).toBe(boundSaw.values)
            one.destroy()
        })

        test('post-bound props: undefined keeps the default, and post-bound functions see the default', () => {
            const {Comp, seen} = setup()
            let postBoundSaw: any
            const Bound = bindProps(Comp, () => ({size: undefined}))
            Bound.postBoundProps = [(props: any) => {
                postBoundSaw = {...props}
                return {size: undefined, count: undefined}
            }]
            root.render(<Bound/>)
            expect(postBoundSaw.size).toBe('medium')
            expectDefaults(seen[0])
        })

        test('$self: and AOP layers that carry undefined', () => {
            const {Comp, seen} = setup()
            function Parent({}: any, {createElement}: RenderContext) {
                return <Comp as="child"/>
            }
            root.render(<div>
                <Comp $self:size={undefined} $self:count={undefined}/>
                <Parent $child:size={undefined} $child:count={undefined}/>
                <Parent $child={{size: undefined, values: undefined}}/>
            </div>)
            expect(seen.length).toBe(3)
            seen.forEach(expectDefaults)
        })

        test('a layer that provides a value still wins, and props without a default are left alone', () => {
            const {Comp, seen} = setup()
            const Bound = bindProps(Comp, {size: 'large', title: 'bound'})
            root.render(<div>
                <Bound/>
                <Bound size="small" title={undefined}/>
                <Bound $self:size="tiny"/>
            </div>)
            expect(seen[0].size).toBe('large')
            expect(seen[0].title).toBe('bound')
            expect(seen[1].size).toBe('small')
            // explicit undefined for a prop without a default keeps overriding (unchanged merge semantics)
            expect(seen[1].title).toBeUndefined()
            expect(seen[2].size).toBe('tiny')
        })
    })

    describe('F6 RxDOMDragState', () => {
        // records every listener a target receives together with the AbortSignal that removes it
        function recordListeners(target: EventTarget) {
            const records: {type: string, signal?: AbortSignal}[] = []
            const original = target.addEventListener
            target.addEventListener = function (this: EventTarget, type: string, listener: any, options?: any) {
                records.push({type, signal: options?.signal})
                return original.call(this, type, listener, options)
            } as any
            return {
                records,
                live: () => records.filter(record => !record.signal?.aborted).map(record => record.type),
                restore: () => { target.addEventListener = original },
            }
        }
        const mouse = (target: EventTarget, type: string, x = 0) =>
            target.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: x, clientY: x}))

        function mount(visible = atom(true)) {
            const boundary = createRef()
            const events: string[] = []
            let drag!: RxDOMDragState
            function App({}: any, {createElement}: RenderContext) {
                drag = new RxDOMDragState(atom(null), {boundary})
                drag.addEventListener('dragstart', () => events.push('dragstart'))
                drag.addEventListener('dragend', () => events.push('dragend'))
                return <section ref={boundary}>
                    {() => visible() ? <div ref={drag.ref} style={{width: 50, height: 50}}>drag</div> : null}
                </section>
            }
            root.render(<App/>)
            return {drag, events, boundary: boundary.current as HTMLElement, handle: () => rootEl.querySelector('section > div') as HTMLElement}
        }

        test('destroy during a drag leaves no listener on the boundary or on window', () => {
            const {drag, events, boundary, handle} = mount()
            const onBoundary = recordListeners(boundary)
            const onWindow = recordListeners(window)
            try {
                mouse(handle(), 'mousedown', 5)
                mouse(boundary, 'mousemove', 10)
                expect(onBoundary.live().sort()).toEqual(['mouseleave', 'mousemove', 'mouseup'])
                expect(onWindow.live()).toEqual(['blur'])
                expect(drag.value()).not.toBeNull()

                root.destroy()
                expect(onBoundary.live()).toEqual([])
                expect(onWindow.live()).toEqual([])
                expect(drag.value()).toBeNull()
                mouse(boundary, 'mousemove', 20)
                mouse(boundary, 'mouseup', 20)
                boundary.dispatchEvent(new MouseEvent('mouseleave'))
                window.dispatchEvent(new Event('blur'))
                expect(drag.value()).toBeNull()
                expect(events).toEqual(['dragstart'])
            } finally {
                onBoundary.restore()
                onWindow.restore()
            }
        })

        test('unmounting only the dragged element during a drag releases them too', async () => {
            const visible = atom(true)
            const {drag, events, boundary, handle} = mount(visible)
            const onBoundary = recordListeners(boundary)
            const onWindow = recordListeners(window)
            try {
                mouse(handle(), 'mousedown', 5)
                mouse(boundary, 'mousemove', 10)
                visible(false)
                await settle()
                expect(handle()).toBeNull()
                expect(onBoundary.live()).toEqual([])
                expect(onWindow.live()).toEqual([])
                mouse(boundary, 'mousemove', 20)
                expect(drag.value()).toBeNull()
                expect(events).toEqual(['dragstart'])
            } finally {
                onBoundary.restore()
                onWindow.restore()
            }
        })

        test('complete drags still pair dragstart/dragend and release their listeners every time', () => {
            const {drag, events, boundary, handle} = mount()
            const onBoundary = recordListeners(boundary)
            const onWindow = recordListeners(window)
            const details: any[] = []
            drag.addEventListener('dragend', (e: any) => details.push(e.detail))
            try {
                // a click first: no drag events, nothing left behind
                mouse(handle(), 'mousedown', 5)
                mouse(boundary, 'mouseup', 5)
                expect(events).toEqual([])
                expect(onBoundary.live()).toEqual([])
                expect(onWindow.live()).toEqual([])
                for (const end of ['mouseup', 'mouseleave', 'blur']) {
                    mouse(handle(), 'mousedown', 5)
                    mouse(boundary, 'mousemove', 10)
                    mouse(boundary, 'mousemove', 30)
                    expect(drag.value()!.clientX).toBe(30)
                    if (end === 'blur') window.dispatchEvent(new Event('blur'))
                    else if (end === 'mouseleave') boundary.dispatchEvent(new MouseEvent('mouseleave'))
                    else mouse(boundary, 'mouseup', 30)
                    expect(drag.value()).toBeNull()
                    expect(onBoundary.live()).toEqual([])
                    expect(onWindow.live()).toEqual([])
                }
                expect(events).toEqual(['dragstart', 'dragend', 'dragstart', 'dragend', 'dragstart', 'dragend'])
                expect(details.map(detail => detail?.clientX)).toEqual([30, 30, 30])
            } finally {
                onBoundary.restore()
                onWindow.restore()
            }
        })
    })

    describe('F8 auto unit', () => {
        test.each(['em', 'rem', 'px'] as const)('inline, stylesheet and SSR output all use %s', (unit) => {
            setAutoUnitType(unit)
            const plain = {width: 10, padding: [1, 2]}
            const nested = {width: 10, padding: [1, 2], '&:hover': {marginLeft: 3}}
            root.render(<div><p style={plain}>inline</p><p style={nested}>stylesheet</p></div>)
            const [inline, sheet] = Array.from(rootEl.querySelectorAll('p')) as HTMLElement[]
            expect(inline.style.width).toBe(`10${unit}`)
            expect(inline.style.padding).toBe(`1${unit} 2${unit}`)
            expect(getComputedStyle(sheet).width).toBe(getComputedStyle(inline).width)
            expect(getComputedStyle(sheet).paddingLeft).toBe(getComputedStyle(inline).paddingLeft)
            const rules = generateStyleContent('.x', nested).join('\n')
            expect(rules).toContain(`width:10${unit};`)
            expect(rules).toContain(`margin-left:3${unit};`)
            expect(new StyleSize(4).toString()).toBe(`4${unit}`)

            function App({}: any, {createElement}: RenderContext) {
                return <div><p style={plain}>inline</p><p style={nested}>stylesheet</p></div>
            }
            const {html, styles} = renderToString(createElement(App, null as any))
            expect(html).toContain(`width:10${unit};padding:1${unit} 2${unit}`)
            expect(styles).toContain(`width:10${unit};`)
            expect(styles).toContain(`margin-left:3${unit};`)
        })
    })

    describe('B1 PropTypes helpers', () => {
        test('number.parse round-trips every finite number form and rejects the rest', () => {
            for (const n of [0, 12, -1.5, 0.5, 1e21, 1.5e-7, -3e+30, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE]) {
                expect(PropTypes.number.parse(PropTypes.number.stringify(n))).toBe(n)
            }
            expect(PropTypes.number.parse('.5')).toBe(0.5)
            expect(PropTypes.number.parse('5.')).toBe(5)
            expect(PropTypes.number.parse(' +7 ')).toBe(7)
            expect(PropTypes.number.parse('1E3')).toBe(1000)
            for (const text of ['abc1', '1px', '"12"', '12abc', '1 2', '', ' ', '.', 'e5', '--1', '1e', 'NaN', 'Infinity']) {
                expect(() => PropTypes.number.parse(text), text).toThrow()
            }
        })

        test('oneOfType([number, string]) round-trips numbers and number-like strings to their own type', () => {
            const type = PropTypes.oneOfType([PropTypes.number, PropTypes.string])
            for (const value of [12, -1.5, '12', 'abc1', '1px', '']) {
                expect(type.parse(type.stringify(value))).toBe(value)
            }
        })

        test('PropTypes.map keeps its round trip and rejects non objects', () => {
            const type = PropTypes.map({a: PropTypes.string, b: PropTypes.number})
            const value = {a: 'x1', b: 12.5}
            expect(type.parse(type.stringify(value))).toEqual(value)
            expect(type.check(value)).toBe(true)
            for (const bad of [null, undefined, 1, 'a', []]) expect(type.check(bad)).toBe(false)
        })

        test('reactive types: check accepts what coerce accepts, alone and inside combinators', () => {
            const atomType = PropTypes.atom<number>()
            for (const value of [atom(1), 1, 0, '', null, undefined, false]) {
                expect(atomType.check(value)).toBe(true)
                expect(atomType(value)).toBeUndefined()
            }
            const list = PropTypes.rxList<number>()
            const set = PropTypes.rxSet<number>()
            const map = PropTypes.rxMap<string, number>()
            expect(list.check(new RxList([1]))).toBe(true)
            expect(list.check([1])).toBe(true)
            expect(list.check(null)).toBe(true)
            expect(list.check('abc')).toBe(false)
            expect(list.check(new RxSet([1]))).toBe(false)
            expect(set.check(new RxSet([1]))).toBe(true)
            expect(set.check([1])).toBe(true)
            expect(set.check(1)).toBe(false)
            expect(map.check(new RxMap({a: 1}))).toBe(true)
            expect(map.check({a: 1})).toBe(true)
            expect(map.check([['a', 1]])).toBe(true)
            expect(map.check('a')).toBe(false)
            expect(map.check(undefined)).toBe(false)

            expect(PropTypes.oneOfType([list, PropTypes.string]).check('abc')).toBe(true)
            expect(PropTypes.oneOfType([list, PropTypes.string]).check(5)).toBe(false)
            expect(PropTypes.arrayOf(atomType).check([atom(1), 2])).toBe(true)
            expect(PropTypes.shapeOf({items: list, total: atomType}).check({items: [1], total: 1})).toBe(true)
            expect(PropTypes.shapeOf({items: list}).check({items: 'x'})).toBe(false)
            // derived checkers keep the check
            expect(PropTypes.rxList<number>().isRequired.check([1])).toBe(true)
            expect(PropTypes.rxMap<string, number>().default(() => new RxMap({})).check({})).toBe(true)
        })
    })

    describe('B2 retained style host state counter', () => {
        afterEach(() => disableAxiiRetainedObjectDiagnostics())
        const active = () => getAxiiRetainedObjectDiagnosticsSnapshot().styles.activeHostStyleStates
        const styled = () => <div>
            <p style={{'&:hover': {color: 'red'}}}>a</p>
            <p style={() => ({color: 'blue', '&:hover': {color: 'red'}})}>b</p>
        </div>

        test('counts hosts created while enabled and returns to zero', () => {
            enableAxiiRetainedObjectDiagnostics()
            root.render(styled())
            expect(active()).toBeGreaterThan(0)
            root.destroy()
            expect(active()).toBe(0)
        })

        test('a reset between create and destroy does not push it below zero', () => {
            enableAxiiRetainedObjectDiagnostics()
            root.render(styled())
            resetAxiiRetainedObjectDiagnostics()
            expect(active()).toBe(0)
            root.destroy()
            expect(active()).toBe(0)
        })

        test('hosts created while disabled are ignored after re-enabling without reset', () => {
            enableAxiiRetainedObjectDiagnostics()
            const other = createRoot(document.body.appendChild(document.createElement('div')))
            other.render(styled())
            const counted = active()
            expect(counted).toBeGreaterThan(0)
            disableAxiiRetainedObjectDiagnostics()
            root.render(styled())
            enableAxiiRetainedObjectDiagnostics({reset: false})
            root.destroy()
            expect(active()).toBe(counted)
            other.destroy()
            expect(active()).toBe(0)
        })
    })

    describe('B3 RxDOMFocused', () => {
        test('attaching to a focused element reports true, moving to an unfocused one reports false', () => {
            const a = document.body.appendChild(document.createElement('input'))
            const b = document.body.appendChild(document.createElement('input'))
            a.focus()
            const focused = new RxDOMFocused()
            expect(focused.value()).toBe(false)
            focused.ref(a)
            expect(focused.value()).toBe(true)
            // straight from one element to another, no null in between
            focused.ref(b)
            expect(focused.value()).toBe(false)
            b.focus()
            expect(focused.value()).toBe(true)
            b.blur()
            expect(focused.value()).toBe(false)
            focused.ref(null)
            expect(focused.value()).toBeNull()
            focused.destroy()
        })

        test('a container reports focus inside it when it is attached', () => {
            const box = document.body.appendChild(document.createElement('div'))
            const inner = box.appendChild(document.createElement('input'))
            inner.focus()
            const focused = new RxDOMFocused()
            focused.ref(box)
            expect(focused.value()).toBe(true)
            focused.destroy()
            expect(focused.value()).toBeNull()
        })
    })

    describe('B4 RxDOMSize and inline elements', () => {
        const ZERO = {width: 0, height: 0, borderBoxWidth: 0, borderBoxHeight: 0, contentBoxWidth: 0, contentBoxHeight: 0}
        let errors: any[]
        let originalError: typeof console.error
        beforeEach(() => {
            errors = []
            originalError = console.error
            console.error = (...args: any[]) => { errors.push(args[0]) }
        })
        afterEach(() => {
            console.error = originalError
            configureDiagnostics({})
        })
        const inlineWarnings = () => errors.filter(e => typeof e === 'string' && e.includes('RxDOMSize is attached to a non-replaced inline element'))

        function attach(html: string) {
            document.body.insertAdjacentHTML('beforeend', html)
            const el = document.body.lastElementChild as HTMLElement
            const target = (el.querySelector('[data-target]') ?? el) as HTMLElement
            const size = new RxDOMSize()
            size.ref(target)
            return {size, target}
        }

        test.each([
            ['span', '<span>hello world</span>'],
            ['a', '<a>hello world</a>'],
            ['span with padding and border', '<span style="padding:5px;border:2px solid">hello</span>'],
        ])('non-replaced inline %s: all zero synchronously and after delivery, with a dev warning', async (_label, html) => {
            const {size} = attach(html)
            expect(size.value()).toEqual(ZERO)
            expect(inlineWarnings().length).toBe(1)
            await frames()
            await frames()
            expect(size.value()).toEqual(ZERO)
            size.destroy()
            expect(size.value()).toBeNull()
        })

        test.each([
            ['inline-block span', '<span style="display:inline-block">hello world</span>'],
            ['inline replaced canvas', '<canvas width="40" height="20"></canvas>'],
            ['blockified span in a flex container', '<div style="display:flex"><span data-target>flex item</span></div>'],
            ['padded block', '<div style="width:100px;height:50px;padding:5px;border:2px solid;box-sizing:border-box">x</div>'],
        ])('%s: measured synchronously, same after delivery, no warning', async (_label, html) => {
            const {size} = attach(html)
            const initial = {...size.value()!}
            expect(initial.borderBoxWidth).toBeGreaterThan(0)
            expect(initial.borderBoxHeight).toBeGreaterThan(0)
            expect(inlineWarnings()).toEqual([])
            await frames()
            await frames()
            expect(size.value()).toEqual(initial)
            size.destroy()
        })

        test('the warning is diagnostics-only', () => {
            configureDiagnostics({enabled: false})
            const {size} = attach('<span>hello</span>')
            expect(size.value()).toEqual(ZERO)
            expect(inlineWarnings()).toEqual([])
            size.destroy()
        })

        test('an inline element that gets a box later is observed from then on', async () => {
            const {size, target} = attach('<span>hello world</span>')
            expect(size.value()).toEqual(ZERO)
            target.style.display = 'inline-block'
            await frames()
            await frames()
            const measured = size.value()!.width
            expect(measured).toBeGreaterThan(0)
            target.textContent = 'hello world, a longer text'
            await frames()
            await frames()
            expect(size.value()!.width).toBeGreaterThan(measured)
            size.destroy()
        })
    })

    describe('B5 [number, unit] with time units', () => {
        test('inline and stylesheet paths accept time tuples and keep real comma lists', () => {
            const style = {
                transitionProperty: ['opacity', 'transform'],
                transitionDuration: [300, 'ms'],
                transitionDelay: [0.5, 's'],
                animationDuration: [2, 's'],
                animationIterationCount: [1, 'infinite'],
                padding: [1, 'px'],
            }
            root.render(<div>
                <p style={style}>inline</p>
                <p style={{...style, '&:hover': {opacity: 0.9}}}>stylesheet</p>
            </div>)
            const [inline, sheet] = Array.from(rootEl.querySelectorAll('p')) as HTMLElement[]
            expect(inline.style.transitionDuration).toBe('300ms')
            for (const computed of [getComputedStyle(inline), getComputedStyle(sheet)]) {
                expect(computed.transitionProperty).toBe('opacity, transform')
                expect(computed.transitionDuration).toBe('0.3s')
                expect(computed.transitionDelay).toBe('0.5s')
                expect(computed.animationDuration).toBe('2s')
                expect(computed.animationIterationCount).toBe('1, infinite')
                expect(computed.paddingTop).toBe('1px')
            }
        })

        test('comma lists of durations are still comma lists', () => {
            root.render(<p style={{transitionDuration: ['1s', '2s'], transitionDelay: ['100ms', '0s']}}>x</p>)
            const el = rootEl.firstElementChild as HTMLElement
            expect(el.style.transitionDuration).toBe('1s, 2s')
            expect(el.style.transitionDelay).toBe('100ms, 0s')
        })
    })

    describe('X2 StyleSize with mixed units', () => {
        test('unit-less numbers added to or subtracted from a calc expression get the auto unit', () => {
            expect(new StyleSize(10, 'px').add(5, 'rem').sub(2).toString()).toBe('calc((10px + 5rem) - 2px)')
            expect(new StyleSize('100% - 4px').add(8).toString()).toBe('calc((100% - 4px) + 8px)')
            setAutoUnitType('rem')
            expect(new StyleSize(10, 'px').add(5, '%').add(2).toString()).toBe('calc((10px + 5%) + 2rem)')
            // explicit units and same-unit arithmetic are unchanged
            expect(new StyleSize(10, 'px').add(5, 'rem').add(2, 'em').toString()).toBe('calc((10px + 5rem) + 2em)')
            expect(new StyleSize(1, 'rem').add(2).sub(1).toString()).toBe('2rem')
        })

        test('the result is a value the browser accepts', () => {
            const width = new StyleSize(10, 'px').add(50, '%').add(2)
            root.render(<div style={{width: 200}}><p style={{width}}>x</p></div>)
            expect(getComputedStyle(rootEl.querySelector('p')!).width).toBe('112px')
        })
    })
})

// 一个行内条目后面跟着 stylesheet 条目时，行内条目不能被搬进 stylesheet：每行/每帧不同的值会各自
//  建一张表，响应式更新在批次外逐张写 adoptedStyleSheets（O(表数)），2000 行的一次更新从 ~20ms
//  变成 ~1s。这里断言表的数量与 adoptedStyleSheets 的赋值次数，不断言耗时。
describe('style entry order: no stylesheet per inline value', () => {
    const N = 200
    // unique content: stylesheets of earlier (not destroyed) roots in this file must not be reused
    const hover = {'&:hover': {opacity: 0.42}}
    let setterCalls = 0
    let sheetsCreated = 0
    let restore: (() => void) | undefined
    beforeEach(() => {
        const accessor = Object.getOwnPropertyDescriptor(Document.prototype, 'adoptedStyleSheets')!
        Object.defineProperty(document, 'adoptedStyleSheets', {
            configurable: true,
            get() { return accessor.get!.call(this) },
            set(v) { setterCalls++; accessor.set!.call(this, v) },
        })
        const Original = window.CSSStyleSheet
        ;(window as any).CSSStyleSheet = class extends Original {
            constructor(...args: any[]) { super(...args); sheetsCreated++ }
        }
        restore = () => {
            delete (document as any).adoptedStyleSheets
            ;(window as any).CSSStyleSheet = Original
        }
        setterCalls = 0
        sheetsCreated = 0
    })
    afterEach(() => {
        root.destroy()
        restore?.()
    })
    const counts = () => {
        const result = {setterCalls, sheetsCreated}
        setterCalls = 0
        sheetsCreated = 0
        return result
    }

    test('one element: reactive updates of the inline entry create no stylesheet', async () => {
        const x = atom(0)
        root.render(<div style={[() => ({transform: `translateX(${x()}px)`}), hover]}>x</div>)
        const el = rootEl.firstElementChild as HTMLElement
        expect(counts().sheetsCreated).toBeLessThanOrEqual(1)
        for (let i = 1; i <= 20; i++) {
            x(i)
            await settle()
        }
        expect(counts()).toEqual({setterCalls: 0, sheetsCreated: 0})
        expect(el.style.transform).toBe('translateX(20px)')
    })

    test('list rows with per-row reactive inline values share one stylesheet and update without new ones', async () => {
        const y = atom(0)
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        root.render(<div>{list.map(i => <div class="row" style={[() => ({top: y() * 10000 + i, position: 'relative'}), hover]}>{i}</div>)}</div>)
        expect(counts().sheetsCreated).toBeLessThanOrEqual(1)
        for (let k = 1; k <= 3; k++) {
            y(k)
            await settle()
        }
        expect(counts()).toEqual({setterCalls: 0, sheetsCreated: 0})
        expect((rootEl.querySelectorAll('.row')[N - 1] as HTMLElement).style.top).toBe(`${3 * 10000 + N - 1}px`)
    })

    test('list rows with per-row static inline values share one stylesheet', () => {
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        root.render(<div>{list.map(i => <div class="row" style={[{top: i, position: 'relative'}, hover]}>{i}</div>)}</div>)
        expect(counts().sheetsCreated).toBeLessThanOrEqual(1)
    })

    test('bindProps style after a reactive inner style: one stylesheet, updates create none', async () => {
        const y = atom(0)
        function Row({i}: any, {createElement}: RenderContext) {
            return <div as="root" class="row" style={() => ({top: y() * 10000 + i, position: 'relative', paddingTop: 1})}>{i}</div>
        }
        const Styled = bindProps(Row, {'$root:style': {paddingTop: 2}})
        const list = new RxList<number>(Array.from({length: N}, (_, i) => i))
        root.render(<div>{list.map(i => <Styled i={i}/>)}</div>)
        expect(counts().sheetsCreated).toBeLessThanOrEqual(1)
        for (let k = 1; k <= 3; k++) {
            y(k)
            await settle()
        }
        expect(counts()).toEqual({setterCalls: 0, sheetsCreated: 0})
        const last = rootEl.querySelectorAll('.row')[N - 1] as HTMLElement
        expect(getComputedStyle(last).paddingTop).toBe('2px')
        expect(last.style.top).toBe(`${3 * 10000 + N - 1}px`)
    })
})

// 同一个声明，行内（CSSOM 逐个属性赋值）与 stylesheet 规则（文本拼接）必须得到同样的结果：
//  属性名按 el.style 的认法（cssFloat、小写厂商前缀），值过同一道门（顶层 `;` / `!important` /
//  不配对的括号引号整条不生效，而不是追加声明或让整条规则被拒）。
describe('stylesheet declarations behave like inline declarations', () => {
    const corpus: [string, Record<string, any>][] = [
        ['cssFloat', {cssFloat: 'left', width: 10}],
        ['lower-case vendor prefix', {display: '-webkit-box', webkitLineClamp: 2, webkitBoxOrient: 'vertical', overflow: 'hidden'}],
        ['upper-case vendor prefix', {display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'}],
        ['custom property', {'--x': '7px', width: 'var(--x)'}],
        ['a value that appends a declaration', {color: 'rgb(1, 2, 3); position: fixed; background-color: rgb(0, 0, 255)'}],
        ['!important', {color: 'rgb(1, 2, 3) !important'}],
        ['a brace does not take the other declarations with it', {color: 'rgb(1, 2, 3)', fontFamily: 'a}b', marginTop: 3}],
        ['quoted and parenthesised separators are fine', {fontFamily: '"a;b", serif', backgroundImage: 'url("data:image/png;base64,AAAA")', color: 'rgb(1, 2, 3)'}],
    ]
    for (const [name, declarations] of corpus) {
        test(name, () => {
            root.render(<div>
                <div id="inline" style={declarations}>x</div>
                <div id="sheet" style={{...declarations, '&:hover': {outlineColor: 'rgb(255, 0, 0)'}}}>x</div>
            </div>)
            const inline = getComputedStyle(rootEl.querySelector('#inline')!)
            const sheet = getComputedStyle(rootEl.querySelector('#sheet')!)
            const diffs: string[] = []
            for (let i = 0; i < inline.length; i++) {
                const property = inline[i]
                if (inline.getPropertyValue(property) !== sheet.getPropertyValue(property)) {
                    diffs.push(`${property}: inline=${inline.getPropertyValue(property)} sheet=${sheet.getPropertyValue(property)}`)
                }
            }
            expect(diffs).toEqual([])
        })
    }

    // CSSOM 在值的末尾自动补齐未闭合的括号（行内 url(a.png 有效）；规则文本里它会吞掉后面的声明，
    //  所以 stylesheet / SSR 整条丢弃它（更严格），但同一条目里的其他声明不受影响。
    test('an unbalanced parenthesis is dropped alone', () => {
        root.render(<div id="t" style={{color: 'rgb(1, 2, 3)', backgroundImage: 'url(a.png', marginTop: 3, '&:hover': {opacity: 0.8}}}>x</div>)
        const computed = getComputedStyle(rootEl.querySelector('#t')!)
        expect([computed.color, computed.marginTop, computed.backgroundImage]).toEqual(['rgb(1, 2, 3)', '3px', 'none'])
    })

    test('an injected declaration in a nested rule or in keyframes is dropped too', () => {
        root.render(<div id="t" className="on" style={{
            '&.on': {color: 'rgb(1, 2, 3); position: fixed'},
            '@keyframes': {from: {opacity: '0; position: fixed'}, to: {opacity: 1}},
            animation: '@self 10s linear paused; position: fixed',
        }}>x</div>)
        const computed = getComputedStyle(rootEl.querySelector('#t')!)
        expect(computed.position).toBe('static')
        expect(computed.color).toBe('rgb(0, 0, 0)')
        expect(computed.animationName).toBe('none')
    })
})
