/**
 * #55 B1：新激活模型的节点指针游标（src/hydrationCursor.ts）的白盒用例，设计 docs/ssr-support/hydration-top-down.md §2.3、§7.2。
 * 文本单元（axii:t 包边 / 裸 Text / axii:0）、字符数据父节点、结构 Comment、元素与 id、容器层、元素末尾检查。
 * B1 的失配一律报告 HydrationMismatchError 并抛出（修复规则 R1–R5 在 B3，到那时这里的「抛出」用例换成各条规则的用例）。
 * 旧模型游标的白盒用例在 ssrHydrate.claimCorners.spec.tsx，#55 S 删除时按设计 §8 逐条对应。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {configureDiagnostics} from '@framework'
import {HydrationMismatchError} from '../src/hydration'
import {
    claimTopDownComment,
    claimTopDownElement,
    claimTopDownEmptyTextPlaceholder,
    claimTopDownText,
    enterTopDownContainer,
    enterTopDownElement,
    exitTopDownElement,
    finishTopDownContainer,
    getTopDownCursorParent,
    insertTopDownEmptyText,
    leaveTopDownContainer,
} from '../src/hydrationCursor'

let reports: unknown[]
let depth: number
beforeEach(() => {
    reports = []
    configureDiagnostics({enabled: false, onError: (e: unknown) => { reports.push(e) }})
})
afterEach(() => {
    leaveTopDownContainer(depth)
    configureDiagnostics({})
})

/** 以 html 为内容的容器，游标停在容器这一层 */
function container(html: string): HTMLElement {
    const el = document.createElement('div')
    el.innerHTML = html
    depth = enterTopDownContainer(el)
    return el
}
/** 以 html 为内容的元素（在容器里，游标进入元素这一层） */
function element(tag: string, html: string): HTMLElement {
    const host = document.createElement('div')
    const el = document.createElement(tag)
    el.innerHTML = html
    host.appendChild(el)
    depth = enterTopDownContainer(host)
    claimTopDownElement(tag, false, null)
    enterTopDownElement(el)
    return el
}
function nodes(parent: Node): string[] {
    return Array.from(parent.childNodes).map(n => n.nodeType === Node.TEXT_NODE ? `"${n.nodeValue}"`
        : n.nodeType === Node.COMMENT_NODE ? `<!--${(n as Comment).data}-->` : `<${(n as Element).localName}>`)
}
function expectMismatch(run: () => unknown, expected: RegExp) {
    let thrown: unknown
    try { run() } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(HydrationMismatchError)
    expect((thrown as Error).message).toMatch(expected)
    // 报告与抛出的是同一个错误（无论诊断是否开启都交给 onError）
    expect(reports).toEqual([thrown])
}

describe('text units', () => {
    test('axii:t-wrapped text: the Text is claimed in place, the wrapper is removed, the cursor moves past it', () => {
        const p = element('p', '<!--axii:t-->hi<!--axii:/t--><!--axii:t-->there<!--axii:/t-->')
        const first = p.childNodes[1]
        expect(claimTopDownText('hi')).toBe(first)
        expect(claimTopDownText('there')).toBe(p.childNodes[1])
        exitTopDownElement()
        expect(nodes(p)).toEqual(['"hi"', '"there"'])
        expect(reports).toEqual([])
    })

    test('a bare Text (wrapper omitted, §3.2.1 A2) is claimed as is', () => {
        const p = element('p', 'bare<!--x-->')
        const text = p.firstChild
        expect(claimTopDownText('bare')).toBe(text)
        expect(claimTopDownComment('x')).toBe(p.lastChild)
        exitTopDownElement()
    })

    test('value drift is reported and thrown (B1; R2 replaces it in B3)', () => {
        element('p', '<!--axii:t-->server<!--axii:/t-->')
        expectMismatch(() => claimTopDownText('client'), /expected Text\("client"\), got Text\("server"\)/)
    })

    test('a malformed wrapper (no closing axii:/t) is a mismatch', () => {
        element('p', '<!--axii:t-->x<!--other-->')
        expectMismatch(() => claimTopDownText('x'), /expected Text\("x"\), got Comment\("axii:t"\)/)
    })

    test('an element or eof where text is expected is a mismatch', () => {
        element('p', '<b></b>')
        expectMismatch(() => claimTopDownText('x'), /got Element\(<b>\)/)
    })

    test('empty Text-ph: axii:0 becomes Text(""), the sentinel is removed; a missing sentinel is a mismatch', () => {
        const p = element('p', '<!--axii:0--><!--computed node-->')
        const text = claimTopDownEmptyTextPlaceholder()
        expect(text.nodeValue).toBe('')
        expect(p.firstChild).toBe(text)
        expect(claimTopDownComment('computed node')).toBe(p.lastChild)
        exitTopDownElement()
        expect(nodes(p)).toEqual(['""', '<!--computed node-->'])
        reports = []
        element('p', '<!--computed node-->')
        expectMismatch(() => claimTopDownEmptyTextPlaceholder(), /expected Comment\("axii:0"\), got Comment\("computed node"\)/)
    })

    test('an empty unit without a sentinel (sole "" child, empty Comment-ph text) is inserted at the cursor; the next unit\'s axii:0 is left alone', () => {
        // <p><>{''}</>{atom('')}</p>：Fragment 里唯一的 '' 服务端不写哨兵，后面的 axii:0 属于 atom（DOM.hydrateDescriptionChildren 按 children 判定）
        const p = element('p', '<!--axii:0-->')
        const sole = insertTopDownEmptyText()
        const atomText = claimTopDownEmptyTextPlaceholder()
        exitTopDownElement()
        expect(p.firstChild).toBe(sole)
        expect(p.lastChild).toBe(atomText)
        expect(nodes(p)).toEqual(['""', '""'])
        expect(reports).toEqual([])
    })

    test('an inserted empty Text does not move the cursor: the next unit is still claimed (node pointer, not index)', () => {
        const p = element('p', '<!--axii:t-->x<!--axii:/t--><!--unhandledChild-->')
        const empty = insertTopDownEmptyText()
        claimTopDownText('x')
        claimTopDownComment('unhandledChild')
        exitTopDownElement()
        expect(p.firstChild).toBe(empty)
        expect(nodes(p)).toEqual(['""', '"x"', '<!--unhandledChild-->'])
    })
})

describe('character-data parents (textarea / title / style / script, §2.6.6)', () => {
    test('concatenated units are split back in order; the first keeps the server Text; empty units insert Text("")', () => {
        const title = element('title', 'Inbox (3) - Site')
        const server = title.firstChild
        expect(claimTopDownText('Inbox (')).toBe(server)
        expect(claimTopDownText('3')).toBe(title.childNodes[1])
        const empty = claimTopDownEmptyTextPlaceholder()
        expect(empty.nodeValue).toBe('')
        expect(insertTopDownEmptyText().nodeValue).toBe('')
        claimTopDownText(') - ')
        claimTopDownText('Site')
        exitTopDownElement()
        expect(nodes(title)).toEqual(['"Inbox ("', '"3"', '""', '""', '") - "', '"Site"'])
        expect(reports).toEqual([])
    })

    test('structure Comments have no server form there either: they are inserted at the cursor (a boolean child\'s PrimitiveHost)', () => {
        // <title>{false}x</title>：服务端跳过 boolean，CSR 有 Text('') + <!--unhandledChild-->
        const title = element('title', 'x')
        insertTopDownEmptyText()
        const comment = claimTopDownComment('unhandledChild')
        claimTopDownText('x')
        exitTopDownElement()
        expect(comment.parentNode).toBe(title)
        expect(nodes(title)).toEqual(['""', '<!--unhandledChild-->', '"x"'])
        expect(reports).toEqual([])
    })

    test('no axii:* markers are expected there: a unit that is not a prefix of the remaining text is a mismatch', () => {
        element('textarea', 'abc')
        expectMismatch(() => claimTopDownText('x'), /expected Text\("x"\), got Text\("abc"\)/)
    })

    test('server text longer than the client units is caught at the end of the parent', () => {
        element('title', 'ab')
        claimTopDownText('a')
        expectMismatch(() => exitTopDownElement(), /expected end of element children, got Text\("b"\)/)
    })
})

describe('structure comments and elements', () => {
    test('a structure Comment is claimed only when its data matches', () => {
        const p = element('p', '<!--fragment start--><!--empty-->')
        expect(claimTopDownComment('fragment start')).toBe(p.firstChild)
        expectMismatch(() => claimTopDownComment('unhandledChild'), /expected Comment\("unhandledChild"\), got Comment\("empty"\)/)
    })

    test('HTML tags compare case-insensitively, SVG tags exactly; the case also tells HTML <a> from SVG <a>', () => {
        const host = container('<svg><clipPath></clipPath><a></a></svg><a></a>')
        const svg = claimTopDownElement('svg', true, null)
        enterTopDownElement(svg)
        expect(claimTopDownElement('clipPath', true, null).localName).toBe('clipPath')
        expectMismatch(() => claimTopDownElement('a', false, null), /expected Element\(<a>\), got Element\(<a>\)/)
        reports = []
        expect(claimTopDownElement('a', true, null).namespaceURI).toBe('http://www.w3.org/2000/svg')
        exitTopDownElement()
        expect(claimTopDownElement('a', false, null).namespaceURI).toBe('http://www.w3.org/1999/xhtml')
        expect(getTopDownCursorParent()).toBe(host)
    })

    test('a client static id must match; no static id claims any same-tag element', () => {
        container('<i id="a"></i><i id="b"></i>')
        expect(claimTopDownElement('i', false, 'a').id).toBe('a')
        expect(claimTopDownElement('i', false, null).id).toBe('b')
        leaveTopDownContainer(depth)
        container('<i id="b"></i>')
        expectMismatch(() => claimTopDownElement('i', false, 'a'), /expected Element\(<i id="a">\), got Element\(<i>\)/)
    })

    test('leftover nodes at the end of an element are a mismatch (R5: reported and thrown in B1)', () => {
        element('ul', '<li></li><li></li>')
        claimTopDownElement('li', false, null)
        expectMismatch(() => exitTopDownElement(), /expected end of element children, got Element\(<li>\)/)
    })
})

describe('the container level', () => {
    test('STYLE / SCRIPT / LINK on the container are skipped unless that very tag is expected', () => {
        const root = container('<style data-axii-ssr>.a{}</style><link rel="x"><div></div><style></style><!--root--><script></script>')
        expect(claimTopDownElement('div', false, null)).toBe(root.childNodes[2])
        expect(claimTopDownElement('style', false, null)).toBe(root.childNodes[3])
        expect(claimTopDownComment('root')).toBe(root.childNodes[4])
        finishTopDownContainer()
        expect(reports).toEqual([])
    })

    test('the server style payload (data-axii-ssr) is skipped even when a <style> element is expected', () => {
        const root = container('<style data-axii-ssr>.a{}</style><style>.own{}</style><!--root-->')
        expect(claimTopDownElement('style', false, null)).toBe(root.childNodes[1])
        claimTopDownComment('root')
        finishTopDownContainer()
        expect(reports).toEqual([])
    })

    test('anything else after the root content is a mismatch', () => {
        container('<!--root--><p></p>')
        claimTopDownComment('root')
        expectMismatch(() => finishTopDownContainer(), /expected end of hydrate root children, got Element\(<p>\)/)
    })

    test('a nested activation restores the outer cursor when it leaves (also after a throw)', () => {
        const outer = container('<!--axii:t-->a<!--axii:/t--><!--axii:t-->b<!--axii:/t-->')
        claimTopDownText('a')
        const inner = document.createElement('div')
        inner.innerHTML = '<i></i>'
        const innerDepth = enterTopDownContainer(inner)
        expect(() => claimTopDownElement('b', false, null)).toThrow(HydrationMismatchError)
        leaveTopDownContainer(innerDepth)
        expect(getTopDownCursorParent()).toBe(outer)
        claimTopDownText('b')
        finishTopDownContainer()
    })
})
