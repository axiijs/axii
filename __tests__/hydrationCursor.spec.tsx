/**
 * #55：新激活模型的节点指针游标（src/hydrationCursor.ts）的白盒用例，设计 docs/ssr-support/hydration-top-down.md §2.3、§4.2、§7.2。
 * 文本单元（axii:t 包边 / 裸 Text / axii:0）、字符数据父节点、结构 Comment、元素与 id、容器层、元素末尾的清扫，
 * 以及失配规则 R1–R5（B3）：每条偏离都报告 HydrationMismatchError（交给 onError，不抛出），然后在游标处修复。
 * B1 / B2 的「报告并抛出」用例在 B3 换成了这里各条规则的用例（§7.2「白盒用例」）。
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
    enterTopDownFreshElement,
    exitTopDownElement,
    finishTopDownContainer,
    getTopDownCursorParent,
    insertTopDownEmptyText,
    insertTopDownFreshElements,
    isTopDownClaimApproximate,
    leaveTopDownContainer,
    markTopDownFreshElements,
    placeTopDownFreshElement,
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
    enterTopDownElement(el, false)
    return el
}
/** 测试里代替 DOM.insertBefore 的插入（StaticHost 传 DOM.insertBefore） */
const insertAt = (el: Element, before: Comment) => before.parentNode!.insertBefore(el, before)
function nodes(parent: Node): string[] {
    return Array.from(parent.childNodes).map(n => n.nodeType === Node.TEXT_NODE ? `"${n.nodeValue}"`
        : n.nodeType === Node.COMMENT_NODE ? `<!--${(n as Comment).data}-->`
            : `<${(n as Element).localName}${(n as Element).id ? '#' + (n as Element).id : ''}>`)
}
/** 报告过的失配（expected → actual），按顺序 */
function mismatches(): string[] {
    return reports.map(e => {
        expect(e).toBeInstanceOf(HydrationMismatchError)
        return `${(e as HydrationMismatchError).expected} → ${(e as HydrationMismatchError).actual}`
    })
}

describe('text units (R2)', () => {
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
        expect(reports).toEqual([])
    })

    test('value drift: the Text is replaced by a new one (wrapped and bare), reported, and the next unit is still claimed', () => {
        const p = element('p', '<!--axii:t-->server<!--axii:/t-->stale<!--axii:t-->ok<!--axii:/t-->')
        const [wrapped, bare] = [p.childNodes[1], p.childNodes[3]]
        const a = claimTopDownText('client')
        const b = claimTopDownText('fresh')
        // 这时：[client, fresh, axii:t, ok, axii:/t]
        const ok = p.childNodes[3]
        expect(claimTopDownText('ok')).toBe(ok)
        exitTopDownElement()
        expect({a: a === wrapped, b: b === bare, nodes: nodes(p), mismatches: mismatches()}).toEqual({
            a: false, b: false,
            nodes: ['"client"', '"fresh"', '"ok"'],
            mismatches: ['Text("client") → Text("server")', 'Text("fresh") → Text("stale")'],
        })
    })

    test('a malformed wrapper, an element or an axii:0 where text is expected: that one unit is replaced', () => {
        const p = element('p', '<!--axii:t-->x<!--other--><b></b><!--axii:0--><!--axii:/t-->')
        claimTopDownText('x')
        claimTopDownComment('other')
        claimTopDownText('y')
        claimTopDownText('z')
        claimTopDownText('w')
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()}).toEqual({
            nodes: ['"x"', '<!--other-->', '"y"', '"z"', '"w"'],
            mismatches: [
                'Text("x") → Comment("axii:t")',
                'Text("y") → Element(<b>)',
                'Text("z") → Comment("axii:0")',
                'Text("w") → Comment("axii:/t")',
            ],
        })
    })

    test('a structure Comment or eof where text is expected: a new Text is inserted, the Comment is not consumed', () => {
        const p = element('p', '<!--unhandledChild-->')
        const slot = p.firstChild
        claimTopDownText('a')
        expect(claimTopDownComment('unhandledChild')).toBe(slot)
        claimTopDownText('b')
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()}).toEqual({
            nodes: ['"a"', '<!--unhandledChild-->', '"b"'],
            mismatches: ['Text("a") → Comment("unhandledChild")', 'Text("b") → eof'],
        })
    })

    test('empty Text-ph: axii:0 becomes Text(""), the sentinel is removed', () => {
        const p = element('p', '<!--axii:0--><!--computed node-->')
        const text = claimTopDownEmptyTextPlaceholder()
        expect(text.nodeValue).toBe('')
        expect(p.firstChild).toBe(text)
        expect(claimTopDownComment('computed node')).toBe(p.lastChild)
        exitTopDownElement()
        expect(nodes(p)).toEqual(['""', '<!--computed node-->'])
        expect(reports).toEqual([])
    })

    test('R4: a missing sentinel inserts Text("") at the cursor and does not take a later unit\'s axii:0', () => {
        const p = element('p', '<!--computed node--><!--axii:0-->')
        const [slot, later] = [p.childNodes[0], p.childNodes[1]]
        const text = claimTopDownEmptyTextPlaceholder()
        expect(p.firstChild).toBe(text)
        expect(claimTopDownComment('computed node')).toBe(slot)
        expect(claimTopDownEmptyTextPlaceholder().nextSibling).toBe(null)
        exitTopDownElement()
        expect({later: later.parentNode, nodes: nodes(p), mismatches: mismatches()})
            .toEqual({later: null, nodes: ['""', '<!--computed node-->', '""'], mismatches: ['Comment("axii:0") → Comment("computed node")']})
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

    test('R2: a unit that is not a prefix of the remaining text replaces it (no boundary to split at); later units are inserted', () => {
        const textarea = element('textarea', 'abc')
        claimTopDownText('x')
        claimTopDownText('y')
        exitTopDownElement()
        expect({nodes: nodes(textarea), mismatches: mismatches()})
            .toEqual({nodes: ['"x"', '"y"'], mismatches: ['Text("x") → Text("abc")', 'Text("y") → eof']})
    })

    test('R5: server text longer than the client units is removed at the end of the parent', () => {
        const title = element('title', 'ab')
        claimTopDownText('a')
        exitTopDownElement()
        expect({nodes: nodes(title), mismatches: mismatches()}).toEqual({nodes: ['"a"'], mismatches: ['end of element children → Text("b")']})
    })
})

describe('structure comments (R3)', () => {
    test('a structure Comment is claimed when its data matches', () => {
        const p = element('p', '<!--fragment start--><!--empty-->')
        expect(claimTopDownComment('fragment start')).toBe(p.firstChild)
        expect(claimTopDownComment('empty')).toBe(p.lastChild)
        exitTopDownElement()
        expect(reports).toEqual([])
    })

    test('otherwise the first Comment with that data ahead in the same parent is claimed and the nodes in between are removed', () => {
        const p = element('p', '<b></b>t<!--axii:0--><!--empty--><!--unhandledChild--><i></i>')
        const slot = p.childNodes[4]
        expect(claimTopDownComment('unhandledChild')).toBe(slot)
        expect(claimTopDownElement('i', false, null)).toBe(p.lastChild)
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()})
            .toEqual({nodes: ['<!--unhandledChild-->', '<i>'], mismatches: ['Comment("unhandledChild") → Element(<b>)']})
    })

    test('no such Comment ahead: a new one is inserted and nothing is consumed', () => {
        const p = element('p', '<b></b><!--empty-->')
        const inserted = claimTopDownComment('unhandledChild')
        expect(claimTopDownElement('b', false, null)).toBe(p.childNodes[1])
        expect(claimTopDownComment('empty')).toBe(p.lastChild)
        exitTopDownElement()
        expect({first: p.firstChild === inserted, nodes: nodes(p), mismatches: mismatches()})
            .toEqual({first: true, nodes: ['<!--unhandledChild-->', '<b>', '<!--empty-->'], mismatches: ['Comment("unhandledChild") → Element(<b>)']})
    })

    test('the look-ahead stays in the parent: a matching Comment inside a child element is not taken', () => {
        const p = element('p', '<b><!--unhandledChild--></b>')
        const inserted = claimTopDownComment('unhandledChild')
        expect(inserted.parentNode).toBe(p)
        expect(p.firstChild).toBe(inserted)
    })
})

describe('elements (R1)', () => {
    test('HTML tags compare case-insensitively, SVG tags exactly; the case also tells HTML <a> from SVG <a>', () => {
        const host = container('<svg><clipPath></clipPath><a></a></svg><a></a>')
        const svg = claimTopDownElement('svg', true, null)!
        enterTopDownElement(svg, false)
        expect(claimTopDownElement('clipPath', true, null)!.localName).toBe('clipPath')
        // HTML <a> 期望、游标处是 SVG <a>：不同标签，没有静态 id，替换这一个单元（D5）
        expect(claimTopDownElement('a', false, null)).toBe(null)
        expect(nodes(svg)).toEqual(['<clipPath>'])
        exitTopDownElement()
        expect(claimTopDownElement('a', false, null)!.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
        expect(getTopDownCursorParent()).toBe(host)
        expect(mismatches()).toEqual(['Element(<a>) → Element(<a>)'])
    })

    test('a client static id must match; no static id claims any same-tag element', () => {
        container('<i id="a"></i><i id="b"></i>')
        expect(claimTopDownElement('i', false, 'a')!.id).toBe('a')
        expect(isTopDownClaimApproximate()).toBe(false)
        expect(claimTopDownElement('i', false, null)!.id).toBe('b')
        expect(isTopDownClaimApproximate()).toBe(false)
        expect(reports).toEqual([])
    })

    test('same tag, wrong id: the same-tag element with that id ahead is claimed and the nodes in between removed (D8)', () => {
        const p = element('p', '<i id="x"></i>junk<i id="a"></i><b></b>')
        const target = p.childNodes[2]
        expect(claimTopDownElement('i', false, 'a')).toBe(target)
        expect(isTopDownClaimApproximate()).toBe(true)
        expect(claimTopDownElement('b', false, null)).toBe(p.lastChild)
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()}).toEqual({nodes: ['<i#a>', '<b>'], mismatches: ['Element(<i id="a">) → Element(<i>)']})
    })

    test('same tag, wrong id, none ahead: claimed as attribute drift (D2 / D9)', () => {
        const p = element('p', '<i id="b"></i>')
        expect(claimTopDownElement('i', false, 'a')).toBe(p.firstChild)
        expect(isTopDownClaimApproximate()).toBe(true)
        exitTopDownElement()
        expect(mismatches()).toEqual(['Element(<i id="a">) → Element(<i>)'])
    })

    test('a different tag that carries the expected id is that role: it is removed and the element is to be rebuilt (D4)', () => {
        const p = element('p', '<b id="a"></b><i id="a"></i>')
        expect(claimTopDownElement('i', false, 'a')).toBe(null)
        expect(nodes(p)).toEqual(['<i#a>'])
        expect(mismatches()).toEqual(['Element(<i id="a">) → Element(<b>)'])
    })

    test('a different tag or a text unit with a client static id: the same-tag element with that id ahead is claimed (D6)', () => {
        const p = element('p', '<b></b><!--axii:t-->t<!--axii:/t--><i id="a"></i>')
        expect(claimTopDownElement('i', false, 'a')).toBe(p.lastChild)
        expect(isTopDownClaimApproximate()).toBe(true)
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()}).toEqual({nodes: ['<i#a>'], mismatches: ['Element(<i id="a">) → Element(<b>)']})
    })

    test('without a client static id nothing ahead is taken: that one unit is replaced (D5), the next sibling stays for its own role', () => {
        const p = element('p', '<b></b><i></i><!--axii:t-->t<!--axii:/t--><i></i>')
        const [second, fourth] = [p.childNodes[1], p.childNodes[5]]
        expect(claimTopDownElement('i', false, null)).toBe(null)
        expect(claimTopDownElement('i', false, null)).toBe(second)
        expect(claimTopDownElement('i', false, null)).toBe(null)
        expect(claimTopDownElement('i', false, null)).toBe(fourth)
        exitTopDownElement()
        expect({nodes: nodes(p), mismatches: mismatches()}).toEqual({
            nodes: ['<i>', '<i>'],
            mismatches: ['Element(<i>) → Element(<b>)', 'Element(<i>) → Comment("axii:t")'],
        })
    })

    test('a structure Comment or eof: the element is to be rebuilt in front of it; nothing is consumed', () => {
        const p = element('p', '<!--unhandledChild-->')
        const slot = p.firstChild
        expect(claimTopDownElement('li', false, 'x')).toBe(null)
        expect(claimTopDownComment('unhandledChild')).toBe(slot)
        expect(claimTopDownElement('li', false, null)).toBe(null)
        exitTopDownElement()
        expect(mismatches()).toEqual(['Element(<li id="x">) → Comment("unhandledChild")', 'Element(<li>) → eof'])
    })

    test('after a mismatch was reported in a parent, later claims there are approximate (§4.1), and so is the subtree of an approximate claim; a clean parent is not', () => {
        const outer = element('section', '<b></b><p><i></i></p><u></u><div><s></s></div>')
        claimTopDownText('t')
        // section 这一层已经失配：之后在这一层认领的 <p> 是近似认领，进入它时子树也按近似认领处理
        const p = claimTopDownElement('p', false, null)!
        expect(isTopDownClaimApproximate()).toBe(true)
        enterTopDownElement(p, true)
        claimTopDownElement('i', false, null)
        expect(isTopDownClaimApproximate()).toBe(true)
        exitTopDownElement()
        claimTopDownElement('u', false, null)
        expect(isTopDownClaimApproximate()).toBe(true)
        // 干净认领的元素（这里按调用方传入的 approximate = false 进入）里没有失配过：子元素是干净认领
        const div = claimTopDownElement('div', false, null)!
        enterTopDownElement(div, false)
        claimTopDownElement('s', false, null)
        expect(isTopDownClaimApproximate()).toBe(false)
        exitTopDownElement()
        exitTopDownElement()
        expect(nodes(outer)).toEqual(['"t"', '<p>', '<u>', '<div>'])
    })
})

describe('a rebuilt element: the fresh layer and its insertion (R1, #73)', () => {
    test('in a fresh layer every unit is created and appended, nothing is reported, element claims return null', () => {
        const fresh = document.createElement('div')
        depth = enterTopDownContainer(document.createElement('div'))
        enterTopDownFreshElement(fresh)
        claimTopDownText('a')
        claimTopDownEmptyTextPlaceholder()
        insertTopDownEmptyText()
        expect(claimTopDownElement('b', false, 'x')).toBe(null)
        claimTopDownComment('unhandledChild')
        exitTopDownElement()
        expect({nodes: nodes(fresh), reports}).toEqual({nodes: ['"a"', '""', '""', '<!--unhandledChild-->'], reports: []})
    })

    test('a fresh character-data parent gets its units as separate Texts, like CSR', () => {
        const title = document.createElement('title')
        depth = enterTopDownContainer(document.createElement('div'))
        enterTopDownFreshElement(title)
        claimTopDownText('a')
        claimTopDownText('b')
        exitTopDownElement()
        expect({nodes: nodes(title), reports}).toEqual({nodes: ['"a"', '"b"'], reports: []})
    })

    test('placed in a fresh parent it is inserted at once; in a parent in the document it waits behind a marker until its StaticHost inserts it', () => {
        const p = element('p', '<b></b><!--unhandledChild-->')
        const mark = markTopDownFreshElements()
        expect(claimTopDownElement('i', false, null)).toBe(null)
        const outerFresh = document.createElement('i')
        enterTopDownFreshElement(outerFresh)
        expect(claimTopDownElement('u', false, null)).toBe(null)
        const innerFresh = document.createElement('u')
        placeTopDownFreshElement(innerFresh)
        exitTopDownElement()
        // 父节点也是新建的：直接插入
        expect(innerFresh.parentNode).toBe(outerFresh)
        placeTopDownFreshElement(outerFresh)
        // 父节点在文档里：先放占位，游标不动
        expect(outerFresh.parentNode).toBe(null)
        expect(claimTopDownComment('unhandledChild')).toBe(p.lastChild)
        exitTopDownElement()
        expect(nodes(p)).toEqual(['<!--axii:fresh-->', '<!--unhandledChild-->'])
        insertTopDownFreshElements(mark, insertAt)
        expect(nodes(p)).toEqual(['<i>', '<!--unhandledChild-->'])
        expect(mismatches()).toEqual(['Element(<i>) → Element(<b>)'])
    })

    test('nested owners insert only their own elements: the inner one first, the outer one later', () => {
        const p = element('p', '<b></b><s></s>')
        const outerMark = markTopDownFreshElements()
        claimTopDownElement('i', false, null)
        const first = document.createElement('i')
        placeTopDownFreshElement(first)
        const innerMark = markTopDownFreshElements()
        claimTopDownElement('u', false, null)
        const second = document.createElement('u')
        placeTopDownFreshElement(second)
        insertTopDownFreshElements(innerMark, insertAt)
        expect({first: first.parentNode, second: second.parentNode === p}).toEqual({first: null, second: true})
        insertTopDownFreshElements(outerMark, insertAt)
        exitTopDownElement()
        expect(nodes(p)).toEqual(['<i>', '<u>'])
    })
})

describe('the end of a parent (R5) and the container level', () => {
    test('leftover nodes at the end of an element are removed and reported once for that parent', () => {
        const ul = element('ul', '<li></li><li></li>x<!--c--><b></b>')
        claimTopDownElement('li', false, null)
        exitTopDownElement()
        expect({nodes: nodes(ul), mismatches: mismatches()}).toEqual({nodes: ['<li>'], mismatches: ['end of element children → Element(<li>)']})
    })

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

    test('anything else after the root content is removed and reported once; STYLE / SCRIPT / LINK stay for the migration and the container sweep', () => {
        const root = container('<!--root--><p></p>x<script></script><b></b>')
        claimTopDownComment('root')
        finishTopDownContainer()
        expect({nodes: nodes(root), mismatches: mismatches()}).toEqual({nodes: ['<!--root-->', '<script>'], mismatches: ['end of hydrate root children → Element(<p>)']})
    })

    test('R3 on the container keeps STYLE / SCRIPT / LINK in between', () => {
        const root = container('<b></b><style data-axii-ssr></style><i></i><!--root-->')
        expect(claimTopDownComment('root')).toBe(root.lastChild)
        expect(nodes(root)).toEqual(['<style>', '<!--root-->'])
    })

    test('a nested activation restores the outer cursor and its mismatch state when it leaves (also after a throw)', () => {
        const outer = container('<!--axii:t-->a<!--axii:/t--><!--axii:t-->b<!--axii:/t--><i></i>')
        claimTopDownText('a')
        const inner = document.createElement('div')
        inner.innerHTML = '<i></i>'
        const innerDepth = enterTopDownContainer(inner)
        try {
            expect(claimTopDownElement('b', false, null)).toBe(null)
            throw new Error('abort')
        } catch {
            // 激活中止：入口的 finally 恢复外层
        } finally {
            leaveTopDownContainer(innerDepth)
        }
        expect(getTopDownCursorParent()).toBe(outer)
        claimTopDownText('b')
        // 内层的失配不算外层的：外层这一层没有失配过，认领不是近似认领
        claimTopDownElement('i', false, null)
        expect(isTopDownClaimApproximate()).toBe(false)
        finishTopDownContainer()
        expect(mismatches()).toEqual(['Element(<b>) → Element(<i>)'])
    })
})
