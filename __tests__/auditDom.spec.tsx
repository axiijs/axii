/** @jsx createElement */
/** @jsxFrag Fragment */
import {atom, createElement, createRoot, Fragment, RxList, setAutoUnitType, StaticHost} from "@framework";
import {afterEach, beforeEach, describe, expect, test} from "vitest";

async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve() }

describe('audit: DOM.ts / StaticHost.ts', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })
    afterEach(() => {
        try { root.destroy() } catch {}
        setAutoUnitType('px')
    })

    // ---------------------------------------------------------------- F1
    describe('F1: an array-valued prop forwarded inside another array', () => {
        test('F1a: style (static) - render must not throw and must apply every entry', () => {
            function Card({style}: any) {
                return <div id="card" style={[{color: 'red'}, style]}>card</div>
            }
            root.render(<Card style={[{fontSize: '20px'}, false && {width: 10}]}/>)
            expect(document.getElementById('card')!.style.cssText).toBe('color: red; font-size: 20px;')
        })

        test('F1b: className - no "0 2" index classes', () => {
            function Card({className}: any) {
                return <div id="card" className={['card', className]}>card</div>
            }
            root.render(<Card className={['x', false && 'y', 'z']}/>)
            expect(document.getElementById('card')!.getAttribute('class')).toBe('card x z')
        })

        test('F1c: event handlers - every handler runs, no TypeError', () => {
            const calls: string[] = []
            function Button({onClick}: any) {
                return <button id="b" onClick={[() => calls.push('own'), onClick]}>b</button>
            }
            root.render(<Button onClick={[() => calls.push('x'), () => calls.push('y')]}/>)
            const errors: string[] = []
            const onError = (e: ErrorEvent) => { errors.push(e.message); e.preventDefault() }
            window.addEventListener('error', onError)
            document.getElementById('b')!.click()
            window.removeEventListener('error', onError)
            expect({calls, errors}).toEqual({calls: ['own', 'x', 'y'], errors: []})
        })
    })

    describe('F1 regression: branches touched by the fix', () => {
        test('F1d: reactive items inside a forwarded className array stay reactive', async () => {
            const active = atom(false)
            function Card({className}: any) {
                return <div id="card" className={['card', className]}>card</div>
            }
            root.render(<Card className={['x', () => active() && 'on', {flag: active}]}/>)
            const card = document.getElementById('card')!
            expect(card.getAttribute('class')).toBe('card x')
            active(true)
            await settle()
            expect(card.getAttribute('class')).toBe('card x on flag')
            active(false)
            await settle()
            expect(card.getAttribute('class')).toBe('card x')
        })

        test('F1e: three levels of nesting, static and reactive style', async () => {
            const calls: string[] = []
            const width = atom(10)
            root.render(<div>
                <div id="s" className={['a', ['b', ['c', null, {d: true}]]]}
                     style={[{color: 'red'}, [{fontSize: '20px'}, [{width: 10}, false]]]}
                     onClick={[() => calls.push('1'), [() => calls.push('2'), [null, () => calls.push('3')]]]}>s</div>
                <div id="r" style={[{color: 'red'}, [{fontSize: '20px'}, () => ({width: width()})]]}>r</div>
            </div>)
            const s = document.getElementById('s')!
            const r = document.getElementById('r')!
            s.click()
            expect({cls: s.getAttribute('class'), css: s.style.cssText, calls, reactive: r.style.cssText}).toEqual({
                cls: 'a b c d',
                css: 'color: red; font-size: 20px; width: 10px;',
                calls: ['1', '2', '3'],
                reactive: 'color: red; font-size: 20px; width: 10px;',
            })
            width(30)
            await settle()
            expect(r.style.cssText).toBe('color: red; font-size: 20px; width: 30px;')
        })

        test('F1f: flat arrays are passed through untouched (no copy on the common path)', () => {
            const handlers = [() => 1, () => 2]
            root.render(<button id="b" onClick={handlers}>b</button>)
            const b = document.getElementById('b') as any
            expect(b._listeners.click.click).toBe(handlers)
        })

        test('F1g: a forwarded detachStyle array with a function item still removes the node', async () => {
            const show = atom(true)
            const forwarded = [() => ({opacity: 0})]
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))
            root.render(<div id="host">{() => show() ? <p id="exit" detachStyle={[{color: 'red'}, forwarded]}>x</p> : null}</div>)
            show(false)
            await new Promise(resolve => setTimeout(resolve, 300))
            expect({errors, left: document.getElementById('exit')}).toEqual({errors: [], left: null})
        })
    })

    // ---------------------------------------------------------------- F2
    test('F2: ref of a row replaced with RxList.splice(i, 1, next) must end up on the mounted element', async () => {
        const els: Record<string, HTMLElement | null> = {}
        const list = new RxList<{id: string, text: string}>([{id: 'a', text: 'A'}, {id: 'b', text: 'B'}])
        root.render(<ul>{list.map(item => <li ref={(el: any) => { els[item.id] = el }}>{item.text}</li>)}</ul>)
        expect(els.a?.textContent).toBe('A')
        // immutable update of row "a"
        list.splice(0, 1, {id: 'a', text: 'A2'})
        await settle()
        expect(rootEl.textContent).toBe('A2B')
        // the <li> of "a" is in the document, its ref must point at it
        expect(els.a).toBe(rootEl.querySelector('li'))
    })

    // ---------------------------------------------------------------- F3
    test('F3: a dash-converted SVG attribute is removed when its value becomes null/undefined/false', async () => {
        const dash = atom<string | undefined>('4 2')
        const width = atom<number | null>(3)
        const opacity = atom<number | false>(0.5)
        root.render(<svg>
            <path id="p" d="M0 0h10" strokeDasharray={dash} strokeWidth={width} fillOpacity={() => opacity()}/>
        </svg>)
        const p = document.getElementById('p')!
        expect(p.getAttributeNames().sort()).toEqual(['d', 'fill-opacity', 'id', 'stroke-dasharray', 'stroke-width'])
        dash(undefined)
        width(null)
        opacity(false)
        await settle()
        // same as a fresh render with the final values
        expect(p.getAttributeNames().sort()).toEqual(['d', 'id'])
    })

    describe('F3/X2 regression: SVG attribute names', () => {
        test('X2b: presentation attributes are dashed, native camelCase attributes are left alone', () => {
            root.render(<svg id="svg" viewBox="0 0 10 10" preserveAspectRatio="none" width="10" height="10">
                <linearGradient id="grad" gradientUnits="userSpaceOnUse" gradientTransform="rotate(1)"/>
                <clipPath id="clip" clipPathUnits="objectBoundingBox"/>
                <marker id="marker" markerWidth="4" markerHeight="4" refX="1"/>
                <text id="text" textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight="bold"
                      clipPath="url(#clip)" markerEnd="url(#marker)" pointerEvents="none" stroke-linecap="round">t</text>
            </svg>)
            const names = (id: string) => document.getElementById(id)!.getAttributeNames().sort()
            expect({svg: names('svg'), grad: names('grad'), clip: names('clip'), marker: names('marker'), text: names('text')}).toEqual({
                svg: ['height', 'id', 'preserveAspectRatio', 'viewBox', 'width'],
                grad: ['gradientTransform', 'gradientUnits', 'id'],
                clip: ['clipPathUnits', 'id'],
                marker: ['id', 'markerHeight', 'markerWidth', 'refX'],
                text: ['clip-path', 'dominant-baseline', 'font-size', 'font-weight', 'id', 'marker-end', 'pointer-events', 'stroke-linecap', 'text-anchor'],
            })
            expect(getComputedStyle(document.getElementById('text')!).textAnchor).toBe('middle')
        })

        test('X2c: a newly covered attribute updates and is removed reactively; html elements are not affected', async () => {
            const rule = atom<string | null>('evenodd')
            root.render(<div>
                <svg><path id="p" d="M0 0h10v10H0z" fillRule={rule}/></svg>
                <span id="html" fillRule="evenodd"/>
            </div>)
            const p = document.getElementById('p')!
            expect(p.getAttribute('fill-rule')).toBe('evenodd')
            rule('nonzero')
            await settle()
            expect(p.getAttribute('fill-rule')).toBe('nonzero')
            rule(null)
            await settle()
            expect(p.getAttributeNames().sort()).toEqual(['d', 'id'])
            // setAttribute on an HTML element lowercases the name; nothing is dash-converted there
            expect(document.getElementById('html')!.getAttributeNames().sort()).toEqual(['fillrule', 'id'])
        })
    })

    // ---------------------------------------------------------------- F4
    test('F4: a reactive data-* attribute writes (and removes) the attribute it was given', async () => {
        const v = atom<any>('a')
        root.render(<div>
            <i id="static" data-foo_bar="a" data-step-1="a" data-a--b="a"/>
            <i id="reactive" data-foo_bar={v} data-step-1={v} data-a--b={v}/>
        </div>)
        const s = document.getElementById('static')!
        const r = document.getElementById('reactive')!
        expect(r.getAttributeNames().sort()).toEqual(s.getAttributeNames().sort())
        v(null)
        await settle()
        expect(r.getAttributeNames()).toEqual(['id'])
    })

    // ---------------------------------------------------------------- F5
    describe('F5: value type versus IDL type on the generic property path', () => {
        test('F5a: false on a non-boolean property means "not set", like on every attribute-path name', () => {
            const cond = false
            root.render(<div>
                <span id="attr" foo={cond && 'x'}>attribute path (control)</span>
                <input id="i" placeholder={cond && 'Search'} title={cond && 'tip'}/>
                <a id="l" href={cond && '/file'} download={cond}>x</a>
                <div id="p" popover={cond}>pop</div>
            </div>)
            const i = document.getElementById('i')!
            const l = document.getElementById('l')!
            const p = document.getElementById('p')!
            expect(document.getElementById('attr')!.hasAttribute('foo')).toBe(false)
            expect({
                placeholder: i.getAttribute('placeholder'),
                title: i.getAttribute('title'),
                href: l.getAttribute('href'),
                download: l.getAttribute('download'),
                popover: p.getAttribute('popover'),
            }).toEqual({placeholder: null, title: null, href: null, download: null, popover: null})
        })

        test('F5b: keyword strings of enumerated attributes with a boolean IDL property', () => {
            root.render(<div>
                <div id="a" draggable="false" spellcheck="false" translate="no">x</div>
                <textarea id="t" spellCheck={false}/>
            </div>)
            const a = document.getElementById('a') as HTMLElement
            const t = document.getElementById('t') as HTMLTextAreaElement
            expect({draggable: a.draggable, spellcheck: a.spellcheck, translate: a.translate, textarea: t.spellcheck})
                .toEqual({draggable: false, spellcheck: false, translate: false, textarea: false})
        })

        test('F5c: boolean shorthand on download / popover', () => {
            root.render(<div>
                <a id="l" href="/file" download>x</a>
                <div id="p" popover>pop</div>
            </div>)
            const l = document.getElementById('l') as HTMLAnchorElement
            const p = document.getElementById('p') as any
            expect({download: l.getAttribute('download'), popover: p.popover}).toEqual({download: '', popover: 'auto'})
        })
    })

    // ---------------------------------------------------------------- F6
    test('F6: checkbox with a submit value - explicit checked wins, a string value is not a checked state', () => {
        root.render(<div>
            <input id="a" type="checkbox" name="color" value="red" checked={false}/>
            <input id="b" type="checkbox" name="color" checked={false} value="red"/>
            <input id="c" type="checkbox" name="color" value="red"/>
        </div>)
        const get = (id: string) => (document.getElementById(id) as HTMLInputElement).checked
        expect({a: get('a'), b: get('b'), c: get('c')}).toEqual({a: false, b: false, c: false})
    })

    test('F6b: boolean value still drives checked; a reactive submit value never touches the checked state', async () => {
        const on = atom<boolean | null>(true)
        const submit = atom<string | number>('red')
        const type = atom('text')
        root.render(<div>
            <input id="bool" type="checkbox" value={on}/>
            <input id="submit" type="checkbox" name="color" value={submit}/>
            <input id="flip" type={type} value={7}/>
        </div>)
        const get = (id: string) => document.getElementById(id) as HTMLInputElement
        expect({bool: get('bool').checked, submit: get('submit').checked, submitValue: get('submit').value})
            .toEqual({bool: true, submit: false, submitValue: 'red'})
        on(false)
        await settle()
        expect(get('bool').checked).toBe(false)
        on(null)
        await settle()
        expect(get('bool').checked).toBe(false)
        on(true)
        await settle()
        expect(get('bool').checked).toBe(true)
        // the user checks the box, then the submit value changes: the tick must survive
        get('submit').checked = true
        submit(3)
        await settle()
        expect({checked: get('submit').checked, value: get('submit').value}).toEqual({checked: true, value: '3'})
        get('submit').checked = false
        submit('blue')
        await settle()
        expect({checked: get('submit').checked, value: get('submit').value}).toEqual({checked: false, value: 'blue'})
        // type flipping to checkbox replays the stored value: a number is a submit value, not a tick
        type('checkbox')
        await settle()
        expect({checked: get('flip').checked, value: get('flip').value}).toEqual({checked: false, value: '7'})
    })

    // ---------------------------------------------------------------- F7
    describe('F7: undefined must not be rendered as the literal "undefined"', () => {
        test('F7a: htmlFor (static and reactive)', async () => {
            const target = atom<string | undefined>('x')
            root.render(<div>
                <label id="s" htmlFor={undefined}>s</label>
                <label id="r" htmlFor={target}>r</label>
            </div>)
            const s = document.getElementById('s')!
            const r = document.getElementById('r')!
            expect(r.getAttribute('for')).toBe('x')
            target(undefined)
            await settle()
            expect({s: s.getAttribute('for'), r: r.getAttribute('for')}).toEqual({s: null, r: null})
        })

        test('F7b: defaultValue / innerHTML / uuid', async () => {
            const html = atom<string | undefined>('<b>x</b>')
            root.render(<div>
                <input id="i" defaultValue={undefined}/>
                <div id="h" innerHTML={html}/>
                <div id="u" uuid={undefined}/>
            </div>)
            html(undefined)
            await settle()
            expect({
                input: (document.getElementById('i') as HTMLInputElement).value,
                html: document.getElementById('h')!.innerHTML,
                uuid: document.getElementById('u')!.getAttribute('data-uuid'),
            }).toEqual({input: '', html: '', uuid: null})
        })
    })

    describe('F5/F7 regression: the rule table of the property path', () => {
        function snap(el: any, props: string[]) {
            const attrs: Record<string, string> = {}
            for (const name of el.getAttributeNames().sort()) attrs[name] = el.getAttribute(name)
            const out: any = {attrs}
            for (const p of props) out[p] = el[p]
            return JSON.stringify(out)
        }
        function mount(make: () => any) {
            const host = document.createElement('div')
            document.body.appendChild(host)
            const r = createRoot(host)
            r.render(make())
            return {host, r, el: host.firstElementChild as any}
        }

        test('F5d: every row of the table', () => {
            root.render(<div>
                <div id="bool" hidden={false} draggable={false} inert={true}>boolean property, boolean value: as before</div>
                <div id="kw" contentEditable={false} ariaExpanded={false} ariaHidden={true}>keyword properties keep the literal</div>
                <div id="num" tabIndex={false}>number property</div>
                <input id="input" maxLength={false} size={false} alt={true} min={false}/>
                <img id="img" width={false} crossOrigin={false} alt={true}/>
                <a id="a" href={true} ariaLabel={null} role={false}>bare href</a>
                <iframe id="frame" sandbox={false}/>
                <div id="text" textContent={false}>replaced</div>
                <div id="kw2" draggable="auto" spellcheck="" translate="yes">keywords</div>
                <div id="nullish" title={null} id2={null} lang={undefined} dir={undefined} tabIndex={undefined} hidden={undefined}>n</div>
                <label id="label" htmlFor={null}>l</label>
            </div>)
            const get = (id: string) => document.getElementById(id) as any
            const attrs = (id: string) => {
                const out: Record<string, string> = {}
                for (const name of get(id).getAttributeNames().sort()) if (name !== 'id') out[name] = get(id).getAttribute(name)
                return out
            }
            expect({
                bool: attrs('bool'), kw: attrs('kw'), num: attrs('num'), input: attrs('input'), maxLength: get('input').maxLength,
                img: attrs('img'), a: attrs('a'), frame: attrs('frame'), text: get('text').textContent, kw2: attrs('kw2'),
                nullish: attrs('nullish'), label: attrs('label'),
            }).toEqual({
                bool: {draggable: 'false', inert: ''},
                kw: {contenteditable: 'false', 'aria-expanded': 'false', 'aria-hidden': 'true'},
                num: {},
                input: {alt: ''}, maxLength: -1,
                img: {alt: ''},
                a: {href: ''},
                frame: {},
                text: '',
                kw2: {draggable: 'auto', spellcheck: '', translate: 'yes'},
                nullish: {},
                label: {},
            })
        })

        test('F5e: static path, reactive path and reactive transitions agree', async () => {
            const V: any[] = ['a', '', null, undefined, false, true, 0, 1]
            const cases: [string, string, string[], any[]][] = [
                ['div', 'title', [], V], ['div', 'id', [], V], ['div', 'tabIndex', ['tabIndex'], V], ['div', 'hidden', ['hidden'], V],
                ['div', 'draggable', ['draggable'], [...V, 'true', 'false']], ['div', 'spellcheck', ['spellcheck'], [...V, 'true', 'false']],
                ['div', 'translate', ['translate'], [...V, 'yes', 'no']], ['div', 'contentEditable', ['contentEditable'], [null, undefined, false, true, 'true', 'false']],
                ['div', 'popover', ['popover'], ['auto', 'manual', null, undefined, false, true]], ['div', 'role', [], V],
                ['div', 'ariaLabel', [], V], ['div', 'ariaExpanded', [], V], ['div', 'innerHTML', ['innerHTML'], ['<b>x</b>', '', null, undefined, false, true]],
                ['a', 'href', [], ['#a', '', null, undefined, false, true]], ['a', 'download', [], V], ['a', 'target', [], V],
                ['input', 'placeholder', [], V], ['input', 'maxLength', ['maxLength'], [5, null, undefined, false]], ['input', 'required', ['required'], V],
                ['input', 'defaultValue', ['value'], V], ['input', 'name', [], V],
                ['img', 'alt', [], V], ['img', 'width', ['width'], [5, null, undefined, false]], ['img', 'crossOrigin', ['crossOrigin'], ['anonymous', null, undefined, false, true]],
                ['label', 'htmlFor', ['htmlFor'], V], ['td', 'colSpan', ['colSpan'], [2, null, undefined, false]],
                ['iframe', 'sandbox', [], ['allow-scripts', '', null, undefined, false]], ['textarea', 'spellCheck', ['spellcheck'], [null, undefined, false, true]],
            ]
            const report: string[] = []
            for (const [tag, key, props, values] of cases) {
                const fresh = new Map<any, string>()
                for (const b of values) {
                    const st = mount(() => createElement(tag, {[key]: b}))
                    const re = mount(() => createElement(tag, {[key]: atom(b)}))
                    const a = snap(st.el, props), c = snap(re.el, props)
                    if (a !== c) report.push(`<${tag} ${key}=${String(b)}> static ${a} != reactive ${c}`)
                    fresh.set(b, a)
                    st.r.destroy(); re.r.destroy(); st.host.remove(); re.host.remove()
                }
                for (const a of values) for (const b of values) {
                    if (a === b) continue
                    const value = atom<any>(a)
                    const m = mount(() => createElement(tag, {[key]: value}))
                    value(b)
                    await settle()
                    const got = snap(m.el, props)
                    if (got !== fresh.get(b)) report.push(`<${tag} ${key}> ${String(a)} -> ${String(b)}: ${got} != fresh ${fresh.get(b)}`)
                    m.r.destroy(); m.host.remove()
                }
            }
            expect(report.slice(0, 12).join('\n')).toBe('')
        })

        test('F5f: custom elements receive booleans and undefined untouched', () => {
            if (!customElements.get('audit-flag-el')) {
                customElements.define('audit-flag-el', class extends HTMLElement {
                    label: any = 'initial'
                    count: any = 1
                    mode: any = null
                })
            }
            root.render(<audit-flag-el id="ce" label={false} count={true} mode={undefined}/>)
            const ce = document.getElementById('ce') as any
            expect({label: ce.label, count: ce.count, mode: ce.mode, attrs: ce.getAttributeNames().sort()})
                .toEqual({label: false, count: true, mode: undefined, attrs: ['id']})
        })
    })

    // ---------------------------------------------------------------- F8
    test('F8: onGotPointerCapture / onLostPointerCapture listen to the pointer-capture events', () => {
        const calls: string[] = []
        root.render(<div id="e"
            onGotPointerCapture={() => calls.push('got')}
            onLostPointerCapture={() => calls.push('lost')}
            onGotPointerCaptureCapture={() => calls.push('got(capture phase)')}
        >x</div>)
        const e = document.getElementById('e')!
        e.dispatchEvent(new PointerEvent('gotpointercapture', {bubbles: true}))
        e.dispatchEvent(new PointerEvent('lostpointercapture', {bubbles: true}))
        expect(calls).toEqual(['got(capture phase)', 'got', 'lost'])
    })

    test('F8b: ordinary Capture variants are unchanged; pointer-capture handlers merge and unbind by their own key', () => {
        const calls: string[] = []
        root.render(<div id="outer" onClickCapture={() => calls.push('outer capture')} onClick={() => calls.push('outer bubble')}
                         onLostPointerCaptureCapture={() => calls.push('lost capture')}>
            <button id="inner" onClick={() => calls.push('inner')}
                    onLostPointerCapture={[() => calls.push('lost 1'), () => calls.push('lost 2')]}>b</button>
        </div>)
        const inner = document.getElementById('inner')!
        inner.click()
        inner.dispatchEvent(new PointerEvent('lostpointercapture', {bubbles: true}))
        expect(calls).toEqual(['outer capture', 'inner', 'outer bubble', 'lost capture', 'lost 1', 'lost 2'])
    })

    // ---------------------------------------------------------------- F9 (performance)
    test('F9: rows whose nested style content is unique per row mount and unmount in linear time', () => {
        function measure(n: number) {
            const host = document.createElement('div')
            document.body.appendChild(host)
            const r = createRoot(host)
            const list = new RxList<number>(Array.from({length: n}, (_, i) => i))
            const t0 = performance.now()
            r.render(<ul>{list.map(i =>
                <li style={{'&:hover': {color: `rgb(${i % 256}, ${(i >> 8) % 256}, 7)`}}}>{i}</li>
            )}</ul>)
            const t1 = performance.now()
            list.splice(0, n)
            const t2 = performance.now()
            r.destroy()
            host.remove()
            return {mount: t1 - t0, clear: t2 - t1}
        }
        measure(200) // warm up
        const small = measure(1000)
        const large = measure(4000)
        const report = {
            mount1000: Math.round(small.mount), mount4000: Math.round(large.mount),
            clear1000: Math.round(small.clear), clear4000: Math.round(large.clear),
            mountRatio: Math.round(large.mount / small.mount), clearRatio: Math.round(large.clear / small.clear),
        }
        // 4x the rows: linear is ~4x, quadratic is ~16x
        expect(report.mountRatio < 8 && report.clearRatio < 8, JSON.stringify(report)).toBe(true)
    })

    describe('F9 regression: coalesced adoptedStyleSheets writes are invisible to user code', () => {
        const unique = (i: number) => ({'& b': {color: `rgb(${i % 256}, ${(i >> 8) % 256}, 7)`}})
        const colorOf = (el: Element) => getComputedStyle(el.querySelector('b')!).color

        beforeEach(() => { document.adoptedStyleSheets = [] })

        test('F9b: layout effects, refs and synchronous reads see the styles of a render and of every kind of list patch', async () => {
            const seen: string[] = []
            const list = new RxList<number>([1, 2, 3])
            function Row({i}: any, {useLayoutEffect, createElement}: any) {
                let el: any
                useLayoutEffect(() => { seen.push(`effect ${i}:${colorOf(el)}`) })
                return <li ref={(e: any) => { el = e }} style={unique(i)}><b>{i}</b></li>
            }
            root.render(<ul id="ul">
                {list.map(i => i >= 100 ?
                    <li ref={(e: any) => { if (e) seen.push(`ref ${i}:${colorOf(e)}`) }} style={unique(i)}><b>{i}</b></li> :
                    <Row i={i}/>)}
            </ul>)
            // right after root.render returns
            const ul = document.getElementById('ul')!
            expect(Array.from(ul.children).map(colorOf)).toEqual(['rgb(1, 0, 7)', 'rgb(2, 0, 7)', 'rgb(3, 0, 7)'])
            expect(seen).toEqual(['effect 1:rgb(1, 0, 7)', 'effect 2:rgb(2, 0, 7)', 'effect 3:rgb(3, 0, 7)'])
            expect(document.adoptedStyleSheets.length).toBe(3)
            seen.length = 0

            list.push(4, 100)                       // splice insert: component row + compact row
            expect(Array.from(ul.children).map(colorOf).slice(3)).toEqual(['rgb(4, 0, 7)', 'rgb(100, 0, 7)'])
            expect(seen).toEqual(['effect 4:rgb(4, 0, 7)', 'ref 100:rgb(100, 0, 7)'])
            expect(document.adoptedStyleSheets.length).toBe(5)
            seen.length = 0

            list.set(0, 101)                        // explicit key change: the row is inserted before it renders
            expect(colorOf(ul.children[0])).toBe('rgb(101, 0, 7)')
            expect(seen).toEqual(['ref 101:rgb(101, 0, 7)'])
            expect(document.adoptedStyleSheets.length).toBe(5)
            seen.length = 0

            list.splice(1, 2, 102, 5)               // replace: deletions and insertions in one patch
            expect(Array.from(ul.children).map(colorOf)).toEqual(['rgb(101, 0, 7)', 'rgb(102, 0, 7)', 'rgb(5, 0, 7)', 'rgb(4, 0, 7)', 'rgb(100, 0, 7)'])
            expect(seen).toEqual(['ref 102:rgb(102, 0, 7)', 'effect 5:rgb(5, 0, 7)'])
            expect(document.adoptedStyleSheets.length).toBe(5)

            list.splice(0, 4)                       // pure deletion is visible synchronously too
            expect(document.adoptedStyleSheets.length).toBe(1)
            root.destroy()
            expect(document.adoptedStyleSheets.length).toBe(0)
        })

        test('F9c: one batched write produces the same sheet order as one write per sheet', async () => {
            const rules = () => document.adoptedStyleSheets.map(sheet => Array.from(sheet.cssRules).map(r => r.cssText).join('|'))
            const items = [5, 3, 9, 1, 7, 8, 2, 6, 4]
            const styleOf = (i: number) => [
                {'& b': {color: `rgb(${i}, 0, 0)`}},
                i % 2 ? {'&:hover': {opacity: `0.${i}`}} : {fontSize: 10 + i, '& i': {width: i}},
            ]
            // batched: every sheet is created inside one render
            root.render(<ul>{items.map(i => <li style={() => styleOf(i)}><b>{i}</b></li>)}</ul>)
            const batched = rules()
            expect(batched.length).toBe(items.length * 2)
            root.destroy()
            expect(document.adoptedStyleSheets.length).toBe(0)
            // one write per sheet: the same styles arrive through separate reactive updates, outside any batch
            const styles = items.map(() => atom<any>(null))
            root = createRoot(rootEl)
            root.render(<ul>{items.map((i, k) => <li style={() => styles[k]()}><b>{i}</b></li>)}</ul>)
            expect(document.adoptedStyleSheets.length).toBe(0)
            items.forEach((i, k) => {
                styles[k](styleOf(i))
                expect(document.adoptedStyleSheets.length).toBe((k + 1) * 2)
            })
            expect(rules()).toEqual(batched)
            // creation order is not the cascade order here, so the comparison is meaningful
            expect(batched).not.toEqual([...batched].sort((a, b) => items.findIndex(i => a.includes(`rgb(${i}, 0, 0)`)) - items.findIndex(i => b.includes(`rgb(${i}, 0, 0)`))))
        })

        test('F9d: portal content rendered inside an outer render, a detached root attached later, a connected element updated mid-render', async () => {
            const seen: string[] = []
            const portalContainer = document.createElement('div')
            document.body.appendChild(portalContainer)
            const existing = atom(1)
            function PortalContent({}: any, {useLayoutEffect, createElement}: any) {
                let el: any
                useLayoutEffect(() => { seen.push(`portal effect:${colorOf(el)}`) })
                return <p ref={(e: any) => { el = e }} style={unique(50)}><b>p</b></p>
            }
            function Late({}: any, {createElement}: any) {
                // a component body that updates an already connected element and reads it back at once
                existing(2)
                seen.push(`connected update:${colorOf(document.getElementById('existing')!)}`)
                return <span style={unique(60)}><b>late</b></span>
            }
            const show = atom(false)
            const {Portal} = await import('@framework')
            root.render(<div>
                <div id="existing" style={() => unique(existing())}><b>e</b></div>
                {() => show() ? <section>
                    <i style={unique(70)}><b>first</b></i>
                    <Portal container={portalContainer} content={<PortalContent/>}/>
                    <Late/>
                </section> : null}
            </div>)
            show(true)
            await settle()
            expect(seen).toEqual(['portal effect:rgb(50, 0, 7)', 'connected update:rgb(2, 0, 7)'])
            expect(colorOf(rootEl.querySelector('section span')!.parentElement!.querySelector('span')!)).toBe('rgb(60, 0, 7)')

            // a root rendered into a detached container: its sheets are live when the caller attaches it
            const detached = document.createElement('div')
            const other = createRoot(detached)
            const rows = new RxList<number>([80, 81])
            other.render(<ul>{rows.map(i => <li style={unique(i)}><b>{i}</b></li>)}</ul>)
            rows.push(82)
            document.body.appendChild(detached)
            expect(Array.from(detached.querySelectorAll('li')).map(colorOf)).toEqual(['rgb(80, 0, 7)', 'rgb(81, 0, 7)', 'rgb(82, 0, 7)'])
            other.destroy()
            portalContainer.remove()
        })

        test('F9g: the number of document.adoptedStyleSheets assignments does not grow with the number of rows', () => {
            const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'adoptedStyleSheets')!
            let writes = 0
            Object.defineProperty(document, 'adoptedStyleSheets', {
                configurable: true,
                get() { return descriptor.get!.call(document) },
                set(value) { writes++; descriptor.set!.call(document, value) },
            })
            try {
                const counts: Record<string, number> = {}
                const step = (name: string, run: () => void) => { writes = 0; run(); counts[name] = writes }
                for (const kind of ['unique', 'identical'] as const) {
                    const list = new RxList<number>(Array.from({length: 300}, (_, i) => i))
                    const r = createRoot(rootEl)
                    const style = (i: number) => ({'&:hover': {color: kind === 'unique' ? `rgb(${i % 256}, ${i >> 8}, 9)` : 'red'}})
                    step(`${kind} mount`, () => r.render(<ul>{list.map(i => <li style={style(i)}>{i}</li>)}</ul>))
                    expect(document.adoptedStyleSheets.length).toBe(kind === 'unique' ? 300 : 1)
                    step(`${kind} push`, () => list.push(...Array.from({length: 300}, (_, i) => 1000 + i)))
                    expect(document.adoptedStyleSheets.length).toBe(kind === 'unique' ? 600 : 1)
                    step(`${kind} replace`, () => list.splice(0, 300, ...Array.from({length: 300}, (_, i) => 2000 + i)))
                    step(`${kind} clear`, () => list.splice(0, list.data.length))
                    expect(document.adoptedStyleSheets.length).toBe(0)
                    list.push(...Array.from({length: 300}, (_, i) => i))
                    step(`${kind} destroy`, () => r.destroy())
                    expect(document.adoptedStyleSheets.length).toBe(0)
                }
                // replace = insert + delete in one patch: 2 writes today (new rows are inserted before the old ones
                // are destroyed), 1 once the old rows are torn down first (F2); never one per row
                expect(counts['unique replace']).toBeLessThanOrEqual(2)
                delete counts['unique replace']
                expect(counts).toEqual({
                    'unique mount': 1, 'unique push': 1, 'unique clear': 1, 'unique destroy': 1,
                    'identical mount': 1, 'identical push': 0, 'identical replace': 0, 'identical clear': 1, 'identical destroy': 1,
                })
            } finally {
                delete (document as any).adoptedStyleSheets
            }
        })

        test('F9f: createStyleSheet / deleteStyleSheet called by user code inside a render take effect at once', () => {
            const manager = (StaticHost as any).styleManager
            const seen: any[] = []
            function Uses({}: any, {createElement}: any) {
                const probe = document.getElementById('probe')!
                const sheet = manager.createStyleSheet('audit-direct', {width: 12})
                manager.styleScripts.set('audit-direct', sheet)
                seen.push(getComputedStyle(probe).width)
                manager.deleteStyleSheet('audit-direct')
                seen.push(document.adoptedStyleSheets.includes(sheet), getComputedStyle(probe).width === '12px')
                return <span style={unique(1)}><b>x</b></span>
            }
            const probe = document.createElement('div')
            probe.id = 'probe'
            probe.className = 'audit-direct'
            probe.style.display = 'inline-block'
            document.body.appendChild(probe)
            root.render(<div><i style={unique(2)}><b>y</b></i><Uses/></div>)
            expect(seen).toEqual(['12px', false, false])
        })

        test('F9e: a throwing row leaves no open batch behind (later writes are immediate again)', () => {
            const list = new RxList<number>([1])
            const errors: any[] = []
            root.on('error', (e: any) => errors.push(e))
            function Row({i}: any, {createElement}: any) {
                if (i === 13) throw new Error('row failed')
                return <li style={unique(i)}><b>{i}</b></li>
            }
            root.render(<ul id="ul">{list.map(i => <Row i={i}/>)}</ul>)
            list.push(13)
            expect(errors.length).toBe(1)
            list.push(2)
            const ul = document.getElementById('ul')!
            expect(colorOf(ul.lastElementChild!)).toBe('rgb(2, 0, 7)')
            const manager = (StaticHost as any).styleManager
            expect({depth: manager.batchDepth, inserts: manager.pendingInserts, deletes: manager.pendingDeletes})
                .toEqual({depth: 0, inserts: undefined, deletes: undefined})
        })
    })

    // ---------------------------------------------------------------- lower value, still failing
    describe('X: lower value', () => {
        test('X1: setAutoUnitType applies to the stylesheet path too', () => {
            setAutoUnitType('em')
            root.render(<div style="font-size: 10px">
                <i id="inline" style={{display: 'block', width: 2}}>a</i>
                <i id="sheet" style={{display: 'block', width: 2, '&:hover': {color: 'red'}}}>b</i>
            </div>)
            const inline = document.getElementById('inline')!
            const sheet = document.getElementById('sheet')!
            // same declaration, only one of them has a nested rule next to it
            expect({inline: getComputedStyle(inline).width, sheet: getComputedStyle(sheet).width})
                .toEqual({inline: '20px', sheet: '20px'})
        })

        test('X2: camelCase SVG presentation attributes outside the 9 hard-coded prefixes', () => {
            root.render(<svg width="10" height="10">
                <path id="p" d="M0 0h10v10H0z M3 3h4v4H3z" fillRule="evenodd" clipRule="evenodd"/>
                <linearGradient id="g"><stop id="st" offset="0" stopColor="red" stopOpacity="0.5"/></linearGradient>
            </svg>)
            const p = document.getElementById('p')!
            const st = document.getElementById('st')!
            expect({fillRule: getComputedStyle(p).fillRule, stop: st.getAttributeNames().sort()})
                .toEqual({fillRule: 'evenodd', stop: ['id', 'offset', 'stop-color', 'stop-opacity']})
        })

        test('X3: select with a stored value after its selected option is removed equals a fresh render', async () => {
            const options = new RxList(['a', 'b', 'c'])
            root.render(<select id="s" value="b">{options.map(o => <option value={o}>{o}</option>)}</select>)
            const s = document.getElementById('s') as HTMLSelectElement
            expect(s.value).toBe('b')
            options.splice(1, 1)
            await settle()
            const freshEl = document.createElement('div')
            document.body.appendChild(freshEl)
            const fresh = createRoot(freshEl)
            fresh.render(<select id="f" value="b"><option value="a">a</option><option value="c">c</option></select>)
            const f = document.getElementById('f') as HTMLSelectElement
            expect(s.selectedIndex).toBe(f.selectedIndex)
            fresh.destroy()
        })

        test('X3b: every removal path, re-adding the option, multiple and uncontrolled selects', async () => {
            const show = atom(true)
            const multi = new RxList(['a', 'b', 'c'])
            const compact = new RxList(['a', 'b', 'c'])
            function Opt() { return <option value="b">b</option> }
            root.render(<div>
                <select id="fn" value="b"><option value="a">a</option>{() => show() ? <option value="b">b</option> : null}</select>
                <select id="group" value="b"><option value="a">a</option>{() => show() ? <optgroup label="g"><option value="b">b</option></optgroup> : null}</select>
                <select id="arr" value="b"><option value="a">a</option>{() => show() ? [<option value="b">b</option>, <option value="c">c</option>] : null}</select>
                <select id="frag" value="b"><option value="a">a</option>{() => show() ? <><option value="b">b</option><option value="c">c</option></> : null}</select>
                <select id="comp" value="b"><option value="a">a</option>{() => show() ? <Opt/> : null}</select>
                <select id="ingroup" value="b"><optgroup label="g">{compact.map(o => <option value={o}>{o}</option>)}</optgroup></select>
                <select id="multi" multiple value={['a', 'b']}>{multi.map(o => <option value={o}>{o}</option>)}</select>
                <select id="uncontrolled"><option value="a">a</option>{() => show() ? <option value="b" selected>b</option> : null}</select>
            </div>)
            const read = () => {
                const out: Record<string, string> = {}
                for (const s of Array.from(document.querySelectorAll('select'))) {
                    out[s.id] = `${s.selectedIndex}:${Array.from(s.selectedOptions).map(o => o.value).join(',')}`
                }
                return out
            }
            expect(read()).toEqual({fn: '1:b', group: '1:b', arr: '1:b', frag: '1:b', comp: '1:b', ingroup: '1:b', multi: '0:a,b', uncontrolled: '1:b'})
            show(false)
            multi.splice(1, 1)
            compact.splice(1, 1)
            await settle()
            // stored value "b" has no option any more: nothing is selected, exactly like a fresh render;
            // the select without a value prop keeps the browser default
            expect(read()).toEqual({fn: '-1:', group: '-1:', arr: '-1:', frag: '-1:', comp: '-1:', ingroup: '-1:', multi: '0:a', uncontrolled: '0:a'})
            show(true)
            multi.splice(1, 0, 'b')
            compact.splice(1, 0, 'b')
            await settle()
            expect(read()).toEqual({fn: '1:b', group: '1:b', arr: '1:b', frag: '1:b', comp: '1:b', ingroup: '1:b', multi: '0:a,b', uncontrolled: '1:b'})
        })

        test('X4: a function item of a className array may return an array', () => {
            const active = atom(true)
            root.render(<div id="c" className={['base', () => active() ? ['x', 'y'] : null]}>c</div>)
            expect(document.getElementById('c')!.getAttribute('class')).toBe('base x y')
        })
    })

    // ---------------------------------------------------------------- review of #48
    describe('R: review of the property rule table', () => {
        test('R1: null / false / undefined clear an object-typed nullable property (srcObject, valueAsDate, relList)', async () => {
            const stream = new MediaStream()
            const on = atom(true)
            const day = new Date(Date.UTC(2026, 0, 2))
            root.render(<div>
                <video id="and" srcObject={() => on() && stream}/>
                <video id="null" srcObject={() => on() ? stream : null}/>
                <video id="undef" srcObject={() => on() ? stream : undefined}/>
                <input id="date" type="date" valueAsDate={() => on() ? day : null}/>
                <a id="rel" relList={() => on() ? 'noopener' : null}>a</a>
                <div id="pop" popover={() => on() ? 'manual' : false}>p</div>
                <img id="img" crossOrigin={() => on() ? 'anonymous' : null}/>
            </div>)
            const get = (id: string) => document.getElementById(id) as any
            const attrs = (id: string) => get(id).getAttributeNames().filter((n: string) => n !== 'id' && n !== 'type').sort()
            expect([get('and').srcObject, get('null').srcObject, get('undef').srcObject, get('date').value, get('rel').rel])
                .toEqual([stream, stream, stream, '2026-01-02', 'noopener'])
            on(false)
            await settle()
            expect({
                srcObject: ['and', 'null', 'undef'].map(id => get(id).srcObject),
                date: get('date').value,
                attrs: ['and', 'null', 'undef', 'date', 'rel', 'pop', 'img'].map(attrs),
            }).toEqual({
                srcObject: [null, null, null],
                date: '',
                attrs: [[], [], [], [], [], [], []],
            })
            // true on a nullable reflected string still means "attribute present, empty value"
            on(true)
            await settle()
            expect([get('pop').getAttribute('popover'), get('img').getAttribute('crossorigin')]).toEqual(['manual', 'anonymous'])
            const other = document.createElement('div')
            document.body.appendChild(other)
            const otherRoot = createRoot(other)
            otherRoot.render(<div><div id="t" popover={true}>t</div><img id="ti" crossOrigin={true}/></div>)
            expect([get('t').getAttribute('popover'), get('ti').getAttribute('crossorigin')]).toEqual(['', ''])
            otherRoot.destroy()
        })
    })
})
