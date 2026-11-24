/** @jsx createElement */
/**
 * hydrateRoot 的端到端边角：没有包边的文本单元（§3.2.1 A2）、数组的 DirectNodes、Comment-ph 的文本漂移、
 * <!--root--> 前面的元素、缺 <!--root--> 的容器。
 * 子先于父认领的旧模型的白盒用例（直接调用 hydration.ts 的认领函数）曾在本文件，#55 S 随旧模型删除；
 * 逐条对应的替换用例见设计 docs/ssr-support/hydration-top-down.md §7.11。游标规则的白盒用例在 hydrationCursor.spec.tsx。
 * Run: npx vitest run __tests__/ssrHydrate.claimCorners.spec.tsx
 */
import {
    createElement,
    createRoot,
    RenderContext,
} from '@framework'
import {atom} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {renderToString} from '../src/ssr.js'
import {HydrationMismatchError} from '../src/hydration.js'
import {hydrate, configureDiagnostics} from './helpers/hydrate'

function captureMismatches(): unknown[] {
    const errors: unknown[] = []
    configureDiagnostics({enabled: true, onError: (e) => { errors.push(e) }})
    return errors
}

afterEach(() => {
    configureDiagnostics({})
    document.body.innerHTML = ''
})

describe('hydrateRoot end-to-end claim corners', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('real Text nodes in array children serialize as DirectNodes (empty Text → axii:0)', () => {
        // Real Texts must be passed via ctx.createElement inside the SSR pass —
        // host-tag createElement outside it produces real DOM elements.
        function TextItems({}, ctx: RenderContext) {
            return ctx.createElement('div', null,
                [document.createTextNode('a'), document.createTextNode('')])
        }
        const {html} = renderToString(createElement(TextItems, null))
        expect(html).toBe('<div><!--axii:t-->a<!--axii:/t--><!--axii:0--><!--unhandledChild--></div><!--root-->')
    })

    test('bare unwrapped SSR text is claimed with identity kept (A2 omission is valid input)', () => {
        const name = atom('hello')
        function App({}, {createElement}: RenderContext) {
            return <div>{name}</div>
        }
        rootEl.innerHTML = '<div>hello</div><!--root-->'
        const divBefore = rootEl.querySelector('div')!
        const textBefore = divBefore.firstChild as Text
        const root = hydrate(rootEl, createElement(App, null))
        expect(rootEl.querySelector('div')).toBe(divBefore)
        expect(divBefore.firstChild).toBe(textBefore)
        name('world')
        expect(divBefore.firstChild?.nodeValue).toBe('world')
        root.destroy()
    })

    test('component-root element with array child claims DirectNodes layout', () => {
        function App({}, {createElement}: RenderContext) {
            return <div>{['a', 'b']}</div>
        }
        const {html} = renderToString(createElement(App, null))
        rootEl.innerHTML = html
        const divBefore = rootEl.querySelector('div')!
        const root = hydrate(rootEl, createElement(App, null))
        expect(rootEl.querySelector('div')).toBe(divBefore)
        expect(divBefore.textContent).toBe('ab')
        root.destroy()
    })

    // #55 S：旧模型白盒用例「toString-less atom snapshot stringifies via JSON — parity with CSR/SSR stringValue」的对应
    test('an atom whose value has no toString (Object.create(null)) in a Fragment: server, CSR and the claim stringify it alike', () => {
        const weird = atom(Object.create(null))
        function App({}, {createElement, Fragment}: RenderContext) {
            return <Fragment>{weird}<b>x</b></Fragment>
        }
        rootEl.innerHTML = renderToString(createElement(App, null)).html
        const serverText = Array.from(rootEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE)
        const errors = captureMismatches()
        const root = hydrate(rootEl, createElement(App, null))
        const client = document.createElement('div')
        createRoot(client).render(createElement(App, null))
        expect({text: rootEl.textContent, kept: serverText?.isConnected, errors}).toEqual({text: client.textContent, kept: true, errors: []})
        expect(rootEl.textContent).toBe('{}x')
        root.destroy()
    })

    test('Comment-ph drift: SSR text missing while expected non-empty reports + inserts fresh Text', () => {
        const name = atom('x')
        const {html} = renderToString(name)
        rootEl.innerHTML = html.replace('<!--axii:t-->x<!--axii:/t-->', '')
        const errors = captureMismatches()
        const root = hydrate(rootEl, name)
        const text = rootEl.firstChild
        expect(text?.nodeType).toBe(Node.TEXT_NODE)
        expect((text as Text).nodeValue).toBe('x')
        expect(rootEl.lastChild?.nodeType).toBe(Node.COMMENT_NODE)
        expect(errors.some(e => e instanceof HydrationMismatchError)).toBe(true)
        name('y')
        expect((rootEl.firstChild as Text).nodeValue).toBe('y')
        root.destroy()
    })

    // 子先于父认领的旧模型在这里抛错（'expected Text before Comment placeholder'）；#55 S 起按 R2 替换这个单元并报告
    //  （设计 §8「元素紧挨在 placeholder 前面时抛错」→ R2）
    test('root atom: an Element before <!--root--> is replaced by the Text and reported (R2, #55 B3)', () => {
        const name = atom('x')
        rootEl.innerHTML = '<span></span><!--root-->'
        const errors = captureMismatches()
        const root = hydrate(rootEl, name)
        expect(Array.from(rootEl.childNodes).map(n => n.nodeType === Node.TEXT_NODE ? `"${n.nodeValue}"` : n.nodeName))
            .toEqual(['"x"', '#comment'])
        expect(errors.filter(e => e instanceof HydrationMismatchError).length).toBe(1)
        name('y')
        expect((rootEl.firstChild as Text).nodeValue).toBe('y')
        root.destroy()
    })

    // 子先于父认领的旧模型在这里抛错（findRootComment：'container missing <!--root-->'）；#55 S 起按 R3 插入 <!--root-->
    //  并报告（B3 的漂移 fuzz「删除一个标记注释」也会删到它）
    test('a container missing <!--root-->: the comment is inserted and reported (R3, #55 B4); a live root element replaces its server counterpart (§2.6.8)', () => {
        rootEl.innerHTML = '<span>s</span>'
        const errors = captureMismatches()
        const live = createElement('span', null, 'c') as HTMLElement
        const root = hydrate(rootEl, live)
        expect(Array.from(rootEl.childNodes).map(n => n.nodeType === Node.COMMENT_NODE ? `<!--${(n as Comment).data}-->` : (n as Element).outerHTML))
            .toEqual(['<span>c</span>', '<!--root-->'])
        expect(rootEl.firstChild).toBe(live)
        expect(errors.filter(e => e instanceof HydrationMismatchError).length).toBe(1)
        root.destroy()
        expect(rootEl.childNodes.length).toBe(0)
    })
})
