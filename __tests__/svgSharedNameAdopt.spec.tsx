/** @jsx createElement */
/**
 * #56 后续：SVG 父元素把 HTML / SVG 同名的子元素（a / title / style / script）改建到 SVG 命名空间（CSR）。
 *  #72 用一个单独的函数（adoptSvgChildren）在 createElement 原有的子节点循环之外再扫一遍 children，
 *  每个 SVG 元素子节点多读两次 nodeType、一次 namespaceURI：生产构建下 SVG 图标的创建慢约 3%、
 *  一个 <g> 下 40 个 <path> 慢约 5%（同页、随机交替、带 A/A 对照的微基准）。
 *  改法是把检查并进 createElement 的子节点循环，并在读 DOM getter 之前先用 class string 排除 SVG 元素。
 *
 * 这里钉住两件事：
 *  1. 行为（与 #72 相同，改动前后都通过）：改建发生在哪些形状上（元素 child、数组项、Fragment 的子元素、
 *     同名标签里的同名标签），哪些不改建（integration point 之下、HTML 父元素之下），判定看的是元素本身的
 *     命名空间而不是它怎么来的（document.createElement、cloneNode、别的 realm、customized built-in），
 *     ref / 事件 / 响应式属性 / 响应式子节点都转交给新元素。
 *  2. 性能约束：SVG 父元素的子节点循环对每个 SVG 元素子节点只读一次 nodeType（分发本来就要读），数组项与 Fragment 的
 *     子元素不读 nodeType，都不读 namespaceURI / localName。改动前的代码上这一条失败（直接子元素每个 3 次 nodeType、
 *     1 次 namespaceURI；数组项、Fragment 子元素每个 1 次 nodeType、1 次 namespaceURI）。
 * Run: npx vitest run __tests__/svgSharedNameAdopt.spec.tsx
 */
import {createElement, createRoot, createRef, createSVGElement, Fragment, RenderContext} from '@framework'
import {atom} from 'data0'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

const SVG = 'http://www.w3.org/2000/svg'
const XHTML = 'http://www.w3.org/1999/xhtml'

beforeEach(() => {
    document.body.innerHTML = ''
})

function mount(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
}
const tick = () => new Promise(r => setTimeout(r, 0))
const ns = (el: Element | null) => el === null ? 'missing' : el.namespaceURI === SVG ? 'svg' : el.namespaceURI === XHTML ? 'html' : String(el.namespaceURI)
/** 按文档顺序列出 root 下所有同名标签的 `id:命名空间`（没有 id 的用 localName）。 */
function sharedNamespaces(root: Element): string[] {
    return Array.from(root.querySelectorAll('a, title, style, script')).map(el => `${el.id || el.localName}:${ns(el)}`)
}

describe('#56 SVG 父元素改建同名子元素：形状（与 #72 相同）', () => {
    test('元素 child、数组项、Fragment 的子元素、同名标签里的同名标签改建为 SVG；integration point 与 HTML 父元素之下保持 HTML', () => {
        const root = mount()
        createRoot(root).render(<div>
            <svg>
                <title id="direct-title">t</title>
                <a id="direct-a" href="#a"><title id="nested-title">n</title><text>x</text></a>
                <style id="direct-style">{'text{fill:red}'}</style>
                <script id="direct-script" type="text/plain">{'not run'}</script>
                {[<a id="array-a" href="#arr"><text>i</text></a>, <title id="array-title">arr</title>, 'text item']}
                <><title id="fragment-title">f</title><path d="M0 0"/><a id="fragment-a" href="#f"><text>f</text></a></>
                <g><title id="in-g-title">g</title></g>
                <title id="title-ip"><a id="html-in-title" href="#t">t</a></title>
                <foreignObject><a id="html-in-foreign" href="#h">h</a></foreignObject>
                <desc><title id="html-in-desc">d</title></desc>
            </svg>
            <nav><a id="html-outside" href="#o">o</a><title id="html-title-outside">o</title></nav>
        </div>)
        expect(sharedNamespaces(root)).toEqual([
            'direct-title:svg', 'direct-a:svg', 'nested-title:svg', 'direct-style:svg', 'direct-script:svg',
            'array-a:svg', 'array-title:svg', 'fragment-title:svg', 'fragment-a:svg', 'in-g-title:svg',
            'title-ip:svg', 'html-in-title:html', 'html-in-foreign:html', 'html-in-desc:html',
            'html-outside:html', 'html-title-outside:html',
        ])
        // 非元素的数组项与 Fragment 里的 SVG 元素原样保留
        expect(root.querySelector('svg')!.textContent).toContain('text item')
        expect(ns(root.querySelector('svg path'))).toBe('svg')
    })

    test('判定看元素本身：document.createElement / cloneNode / 别的 realm / customized built-in 的同名 HTML 元素同样改建', () => {
        const iframe = document.createElement('iframe')
        document.body.appendChild(iframe)
        const foreignDoc = iframe.contentDocument!
        const created = document.createElement('title')
        created.id = 'created'
        created.textContent = 'c'
        const template = document.createElement('a')
        template.id = 'cloned'
        template.setAttribute('href', '#c')
        const cloned = template.cloneNode(true) as HTMLAnchorElement
        const crossRealm = foreignDoc.createElement('title')
        crossRealm.id = 'cross-realm'
        crossRealm.textContent = 'x'
        const name = 'x-svg-shared-link'
        if (!customElements.get(name)) customElements.define(name, class extends HTMLAnchorElement {}, {extends: 'a'})

        const root = mount()
        createRoot(root).render(<svg>
            {created}
            {cloned}
            {crossRealm}
            <a id="customized" is={name} href="#cb"><text>cb</text></a>
            {[document.createElement('style')]}
        </svg>)
        expect(sharedNamespaces(root)).toEqual(['created:svg', 'cloned:svg', 'cross-realm:svg', 'customized:svg', 'style:svg'])
        expect(root.querySelector('#created')!.textContent).toBe('c')
        expect(root.querySelector('#cloned')!.getAttribute('href')).toBe('#c')
        expect(root.querySelector('#customized')!.getAttribute('is')).toBe(name)
        // 显式的 SVG 元素、SVG 专有标签不动
        const explicit = createSVGElement('a', {id: 'explicit', href: '#e'}) as unknown as Element
        const root2 = mount()
        createRoot(root2).render(<svg>{explicit}<path d="M1 1"/></svg>)
        expect(root2.querySelector('#explicit')).toBe(explicit)
        expect(ns(explicit)).toBe('svg')
    })

    test('ref、事件、响应式属性与响应式子节点转交给改建后的元素（直接 child、数组项、Fragment 子元素）', async () => {
        const clicks: string[] = []
        const href = atom('#one')
        const tip = atom('tip')
        const refs = {direct: createRef(), array: createRef(), fragment: createRef(), nested: createRef()}
        function App({}: any, {createElement}: RenderContext) {
            return <svg>
                <a id="d" ref={refs.direct} href={href} onClick={(e: Event) => { e.preventDefault(); clicks.push('direct') }}>
                    <title ref={refs.nested}>{tip}</title>
                    <text>d</text>
                </a>
                {[<a id="arr" ref={refs.array} href={href} onClick={(e: Event) => { e.preventDefault(); clicks.push('array') }}><text>a</text></a>]}
                <><a id="frag" ref={refs.fragment} href={href} onClick={(e: Event) => { e.preventDefault(); clicks.push('fragment') }}><text>f</text></a></>
            </svg>
        }
        const root = mount()
        createRoot(root).render(<App/>)
        const d = root.querySelector('#d')!, arr = root.querySelector('#arr')!, frag = root.querySelector('#frag')!
        expect([ns(d), ns(arr), ns(frag), ns(d.querySelector('title'))]).toEqual(['svg', 'svg', 'svg', 'svg'])
        expect([refs.direct.current, refs.array.current, refs.fragment.current, refs.nested.current])
            .toEqual([d, arr, frag, d.querySelector('title')])
        for (const el of [d, arr, frag]) el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
        expect(clicks).toEqual(['direct', 'array', 'fragment'])
        href('#two')
        tip('tip2')
        await tick()
        expect([d, arr, frag].map(el => el.getAttribute('href'))).toEqual(['#two', '#two', '#two'])
        expect(d.querySelector('title')!.textContent).toBe('tip2')
    })
})

/**
 * 对 prototype 上的 DOM getter 计数（只在本组用例里替换，afterEach 还原）。
 * 计的是 JS 层面对 getter 的调用：createElementNS / appendChild 这些 DOM 内部操作不经过它们。
 */
type GetterCounts = {nodeType: number, namespaceURI: number, localName: number}
const counted: {target: object, key: string, descriptor: PropertyDescriptor}[] = []
let counts: GetterCounts
function countGetter(target: object, key: keyof GetterCounts) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!
    counted.push({target, key, descriptor})
    const get = descriptor.get!
    Object.defineProperty(target, key, {...descriptor, get(this: any) { counts[key]++; return get.call(this) }})
}

describe('#56 性能约束：改建的判定并进 createElement 的子节点循环', () => {
    beforeEach(() => {
        counts = {nodeType: 0, namespaceURI: 0, localName: 0}
    })
    afterEach(() => {
        while (counted.length) {
            const {target, key, descriptor} = counted.pop()!
            Object.defineProperty(target, key, descriptor)
        }
    })

    test('SVG 父元素对每个 SVG 元素子节点只读一次 nodeType（数组项、Fragment 的子元素不读），不读 namespaceURI / localName；HTML 父元素同样', () => {
        // 子元素先建好（JSX 先求值子节点），只计父元素 createElement 里的读取
        const paths = () => Array.from({length: 8}, (_, i) => createElement('path', {d: `M${i} 0`}))
        const direct = paths()
        const arrayItems = paths()
        const fragment = createElement(Fragment, null, ...paths())
        const htmlChildren = Array.from({length: 8}, () => createElement('span', null))
        countGetter(Node.prototype, 'nodeType')
        countGetter(Element.prototype, 'namespaceURI')
        countGetter(Element.prototype, 'localName')
        const measure = (create: () => unknown) => {
            counts = {nodeType: 0, namespaceURI: 0, localName: 0}
            create()
            return {...counts}
        }

        expect({
            // 分发本来就要读的一次 nodeType
            svgDirect: measure(() => createElement('g', {fill: 'red'}, ...direct)),
            // 数组项在 CSR 的这条循环里不读 nodeType（StaticArrayHost 稍后渲染）
            svgArray: measure(() => createElement('svg', null, arrayItems)),
            // Fragment 本身一次；它的子元素按元素兄弟走，不读 nodeType
            svgFragment: measure(() => createElement('svg', null, fragment)),
            htmlDirect: measure(() => createElement('div', {className: 'x'}, ...htmlChildren)),
        }).toEqual({
            svgDirect: {nodeType: 8, namespaceURI: 0, localName: 0},
            svgArray: {nodeType: 0, namespaceURI: 0, localName: 0},
            svgFragment: {nodeType: 1, namespaceURI: 0, localName: 0},
            htmlDirect: {nodeType: 8, namespaceURI: 0, localName: 0},
        })
    })
})
