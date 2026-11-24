/**
 * #55 B1：激活期间的延迟描述 HydrationElement（src/hydrationElement.ts，设计 docs/ssr-support/hydration-top-down.md §2.2）。
 */
import {describe, expect, test} from 'vitest'
import {createElement, createSVGElement, Fragment} from '@framework'
import {HYDRATION_ELEMENT_FIELDS, HydrationElement, isHydrationElement} from '../src/hydrationElement'
import {beginTopDownHydration, endTopDownHydration} from '../src/hydration'

describe('HydrationElement preset fields', () => {
    // 预置字段名不得出现在任何元素接口上：用户读 el.<名字> 会拿到描述的内部数据，开发期的读探测（B4）又跳过预置字段，
    //  这种误用就静默了。第一版草稿的 children 与 Element.children 重名，改成了 rawChildren（§2.2）。
    test('no preset field name is a member of any *Element interface on window', () => {
        const prototypes: [string, object][] = []
        for (const name of Object.getOwnPropertyNames(window)) {
            if (!name.endsWith('Element')) continue
            const ctor = (window as any)[name]
            if (typeof ctor !== 'function' || !ctor.prototype) continue
            if (ctor !== Element && !(ctor.prototype instanceof Element)) continue
            prototypes.push([name, ctor.prototype])
        }
        // HTMLElement、SVGElement、MathMLElement 与它们的全部具体接口
        expect(prototypes.length).toBeGreaterThan(100)
        const hits = prototypes.flatMap(([name, proto]) => HYDRATION_ELEMENT_FIELDS.filter(f => f in proto).map(f => `${name}.${f}`))
        expect(hits).toEqual([])
        // 检查本身有效：旧名 children 在每一个元素接口上
        expect(prototypes.every(([, proto]) => 'children' in proto)).toBe(true)
    })

    test('the field list is exactly the own fields of a description, which is not extensible', () => {
        const desc = new HydrationElement('div', null, [], false)
        expect(Object.keys(desc)).toEqual([...HYDRATION_ELEMENT_FIELDS])
        expect(Object.isExtensible(desc)).toBe(false)
        // ES module 是严格模式：写未知属性抛 TypeError
        expect(() => { (desc as any).className = 'x' }).toThrow(TypeError)
    })
})

describe('createElement during a top-down activation returns descriptions', () => {
    test('string tags and Fragment give descriptions (no DOM); components still give ComponentNode', () => {
        function Comp() { return null }
        const saved = beginTopDownHydration()
        let el: any, frag: any, svg: any, svgOnly: any, comp: any
        try {
            el = createElement('div', {id: 'a'}, 'x', createElement('b', null))
            frag = createElement(Fragment, null, 'y')
            svg = createSVGElement('title', null)
            svgOnly = createElement('circle', null)
            comp = createElement(Comp, {p: 1})
        } finally {
            endTopDownHydration(saved)
        }
        expect(isHydrationElement(el)).toBe(true)
        expect({tag: el.tag, rawProps: el.rawProps, isSVG: el.isSVG, node: el.node}).toEqual({tag: 'div', rawProps: {id: 'a'}, isSVG: false, node: null})
        expect(el.rawChildren[0]).toBe('x')
        expect(isHydrationElement(el.rawChildren[1])).toBe(true)
        expect(isHydrationElement(frag) && frag.tag === Fragment).toBe(true)
        // isSVG ≡ CSR：显式 _isSVG（createSVGElement），否则 SVG 专有标签
        expect([svg.isSVG, svgOnly.isSVG]).toEqual([true, true])
        expect(isHydrationElement(comp)).toBe(false)
        expect(comp.type).toBe(Comp)
        // 激活之外照常是元素
        expect(createElement('div', null) instanceof HTMLDivElement).toBe(true)
    })
})
