/** @jsx createElement */
/**
 * createElement 挂在元素上的元数据（unhandledChildren / unhandledAttr / refHandles / detachStyledChildren）
 * 的形状契约（#55 PR-A）。
 *
 * 元数据路径的拼接（DOM.ts liftElementMetadata）与「应用 props」（DOM.ts applyElementProps）各收成一个函数，
 * createElement（CSR 与旧模型激活分支）用它们；#55 的新激活模型（B1 的认领步骤）复用它们，必须得到逐位相同的结果
 * （旧模型专用的 rematerializeDeferredFragmentChildren 另有一份提升，随旧模型在 S 删除）。
 * 其中 unhandledChildren / unhandledAttr 的 path 由 StaticHost 消费（elementPath、样式 id），已有用例覆盖；
 * refHandles / detachStyledChildren 的 path 以及「自己的 ref 排在子元素的 ref 之前」此前没有用例钉住，
 * 改错了全量用例照样通过。这里直接断言元数据的形状，并断言 ref 回调的可观察顺序。
 */
import {describe, expect, test} from "vitest";
import {createElement, createRoot} from "@framework";
import type {ExtendedElement} from "@framework";

const S_OUTER = {fileName: 'outer.tsx', lineNumber: 1, columnNumber: 1}
const S_MID = {fileName: 'mid.tsx', lineNumber: 2, columnNumber: 2}

const pick = (entries: any[] | undefined, keys: string[]) =>
    entries?.map(entry => Object.fromEntries(keys.map(key => [key, entry[key]])))

describe('createElement metadata shape (#55 PR-A)', () => {
    test('paths are JSX children indexes (null / boolean count), prefixed once per level; only children / attr entries inherit source', () => {
        const fnChild = () => 'f'
        const fnChild2 = () => 'g'
        const attrFn = () => 'c'
        const r1 = () => {}
        const r2 = {current: null}
        const exitStyle = {opacity: 0}

        const span = createElement('span', {className: attrFn, detachStyle: exitStyle}, fnChild) as ExtendedElement
        const b = createElement('b', {ref: r2}) as ExtendedElement
        const div = createElement('div', {__source: S_MID, ref: r1}, 'text', span) as ExtendedElement
        const p = createElement('p', null, fnChild2, b) as ExtendedElement
        // section 的 children：null（下标 0）、false（下标 1，PrimitiveHost 占位）、div（2）、p（3）
        const section = createElement('section', {__source: S_OUTER}, null, false, div, p) as ExtendedElement

        expect(pick(section.unhandledChildren, ['child', 'path', 'source'])).toEqual([
            {child: false, path: [1], source: S_OUTER},
            // span 自己的占位没有 source，div 提升时继承 div 的 source，section 提升时不再覆盖
            {child: fnChild, path: [2, 1, 0], source: S_MID},
            // p 没有 source：section 提升时继承 section 的 source
            {child: fnChild2, path: [3, 0], source: S_OUTER},
        ])
        expect(pick(section.unhandledAttr, ['el', 'key', 'path', 'source'])).toEqual([
            {el: span, key: 'className', path: [2, 1], source: S_MID},
        ])
        expect(pick(section.refHandles, ['el', 'handle', 'path'])).toEqual([
            {el: div, handle: r1, path: [2]},
            {el: b, handle: r2, path: [3, 1]},
        ])
        expect(pick(section.detachStyledChildren, ['el', 'style', 'path'])).toEqual([
            {el: span, style: exitStyle, path: [2, 1]},
        ])
        // ref / detachStyle 的项没有 source 字段（提升时不给它们新增字段）
        for (const entry of [...section.refHandles!, ...section.detachStyledChildren!]) {
            expect('source' in entry).toBe(false)
        }
        // 提升一次后子元素上的引用被清空（所有权唯一）
        for (const el of [span, b, div, p]) {
            expect(el.unhandledChildren).toBe(undefined)
            expect(el.unhandledAttr).toBe(undefined)
            expect(el.refHandles).toBe(undefined)
            expect(el.detachStyledChildren).toBe(undefined)
        }
        expect(section.__axiiSource).toBe(S_OUTER)
        expect(div.__axiiSource).toBe(S_MID)
        expect('__axiiSource' in p).toBe(false)
    })

    test("an element's own ref comes before its descendants' refs; own attr / detachStyle entries come after the lifted ones", () => {
        const outer = () => {}
        const inner = () => {}
        const innerAttr = () => 'i'
        const outerAttr = () => 'o'
        const innerExit = {opacity: 0}
        const outerExit = {opacity: 0.5}
        const span = createElement('span', {ref: inner, title: innerAttr, detachStyle: innerExit}) as ExtendedElement
        // ref 写在最后、属性写在前：顺序不取决于 JSX 的 key 顺序
        const div = createElement('div', {title: outerAttr, detachStyle: outerExit, ref: outer}, span) as ExtendedElement

        expect(pick(div.refHandles, ['el', 'handle', 'path'])).toEqual([
            {el: div, handle: outer, path: []},
            {el: span, handle: inner, path: [0]},
        ])
        expect(pick(div.unhandledAttr, ['el', 'value', 'path'])).toEqual([
            {el: span, value: innerAttr, path: [0]},
            {el: div, value: outerAttr, path: []},
        ])
        expect(pick(div.detachStyledChildren, ['el', 'style', 'path'])).toEqual([
            {el: span, style: innerExit, path: [0]},
            {el: div, style: outerExit, path: []},
        ])
    })

    test('ref callbacks run parent first on attach and on detach', () => {
        const calls: string[] = []
        const container = document.createElement('div')
        document.body.appendChild(container)
        const root = createRoot(container)
        root.render(
            <section ref={(el: any) => calls.push(`section:${el ? 'el' : 'null'}`)}>
                <div ref={(el: any) => calls.push(`div:${el ? 'el' : 'null'}`)}>
                    <span ref={(el: any) => calls.push(`span:${el ? 'el' : 'null'}`)}/>
                </div>
            </section>
        )
        expect(calls).toEqual(['section:el', 'div:el', 'span:el'])
        calls.length = 0
        root.destroy()
        expect(calls).toEqual(['section:null', 'div:null', 'span:null'])
        container.remove()
    })
})
