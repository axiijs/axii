/**
 * #68: RxList Compact 行判定（src/compactListRow.ts）在 Node 里加载与求值。
 *
 * 描述访问器是给 #55 B2 用的接口：激活期的 HydrationElement 读 `tag` / `rawProps` / `rawChildren`，
 * 这里用同形的普通对象驱动同一个判定，钉住「输入不限于服务端的 SsrElement」。
 * 浏览器侧的形状一致性（服务端 HTML ≡ CSR、激活不报告）见 __tests__/ssrCompactRow.spec.tsx。
 *
 * Run: npx vitest run --config vitest.node.config.ts __tests__/node/compactListRow.spec.ts
 */
import {describe, expect, test} from 'vitest'
import {atom, RxList} from 'data0'
import {
    isCompactListRowDescriptor,
    staticSubtreeHasDetachStyle,
    type ListRowDescriptorAccess,
} from '../../src/compactListRow.js'

const FRAGMENT = Symbol('fragment')

class Desc {
    constructor(public tag: string | typeof FRAGMENT, public rawProps: {[k: string]: any} | null, public rawChildren: any[]) {}
}
const h = (tag: string | typeof FRAGMENT, rawProps: {[k: string]: any} | null, ...rawChildren: any[]) =>
    new Desc(tag, rawProps, rawChildren)

// 模块级常量，与 ssr.ts 的 SSR_LIST_ROW_ACCESS 同一用法
const ACCESS: ListRowDescriptorAccess<Desc> = {
    asStaticNode: (value) => value instanceof Desc ? value : undefined,
    isFragment: (node) => node.tag === FRAGMENT,
    props: (node) => node.rawProps,
    children: (node) => node.rawChildren.length ? node.rawChildren : (node.rawProps?.children ?? []),
}

const EXIT = {opacity: 0}

describe('#68 isCompactListRowDescriptor with a HydrationElement-shaped accessor (Node)', () => {
    test('loads without DOM globals', () => {
        expect(typeof (globalThis as any).document).toBe('undefined')
        expect(typeof (globalThis as any).HTMLElement).toBe('undefined')
    })

    test('element row without detachStyle anywhere in its static subtree is Compact', () => {
        expect(isCompactListRowDescriptor(h('li', null, h('span', {id: 'a'}, 'x'), 'text', 1), ACCESS)).toBe(true)
    })

    test('own or descendant (any depth, through Fragment) detachStyle makes the row non-Compact', () => {
        expect(isCompactListRowDescriptor(h('li', {detachStyle: EXIT}), ACCESS)).toBe(false)
        expect(isCompactListRowDescriptor(h('li', null, h('span', {detachStyle: EXIT})), ACCESS)).toBe(false)
        expect(isCompactListRowDescriptor(
            h('li', null, h('i', null), h('div', null, h('p', null, h('b', {detachStyle: EXIT})))), ACCESS)).toBe(false)
        expect(isCompactListRowDescriptor(
            h('li', null, h(FRAGMENT, null, h('span', {detachStyle: EXIT}))), ACCESS)).toBe(false)
        // props.children（没有显式 children 时）同样是静态子树
        expect(isCompactListRowDescriptor(h('li', {children: [h('span', {detachStyle: EXIT})]}), ACCESS)).toBe(false)
    })

    test('truthiness ≡ createElement registration: function / atom count, falsy values do not', () => {
        expect(isCompactListRowDescriptor(h('li', null, h('span', {detachStyle: () => null})), ACCESS)).toBe(false)
        expect(isCompactListRowDescriptor(h('li', null, h('span', {detachStyle: atom(null)})), ACCESS)).toBe(false)
        for (const falsy of [null, undefined, false, 0, '']) {
            expect(isCompactListRowDescriptor(h('li', null, h('span', {detachStyle: falsy})), ACCESS)).toBe(true)
        }
    })

    test('Host children are not part of the static subtree', () => {
        const inner = h('span', {detachStyle: EXIT})
        expect(isCompactListRowDescriptor(h('li', null, () => inner), ACCESS)).toBe(true)
        expect(isCompactListRowDescriptor(h('li', null, [inner]), ACCESS)).toBe(true)
        expect(isCompactListRowDescriptor(h('li', null, new RxList([inner])), ACCESS)).toBe(true)
        // 组件描述（type 是函数）不是静态节点：它的 props.detachStyle 归组件自己
        expect(isCompactListRowDescriptor(
            h('li', null, {type: () => null, props: {detachStyle: EXIT}, children: []}), ACCESS)).toBe(true)
    })

    test('non-element rows are never Compact', () => {
        expect(isCompactListRowDescriptor(h(FRAGMENT, null, h('span', null)), ACCESS)).toBe(false)
        for (const row of [[h('li', null)], () => h('li', null), 'text', 1, null, undefined, new RxList([])]) {
            expect(isCompactListRowDescriptor(row, ACCESS)).toBe(false)
        }
    })

    test('staticSubtreeHasDetachStyle counts a Fragment\'s own detachStyle (createElement(Fragment) registers it too)', () => {
        expect(staticSubtreeHasDetachStyle(h('li', null, h(FRAGMENT, {detachStyle: EXIT}, h('span', null))), ACCESS)).toBe(true)
    })
})
