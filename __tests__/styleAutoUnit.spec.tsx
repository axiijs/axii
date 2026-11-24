/** @jsx createElement */
/**
 * #60：样式值 → CSS 文本只有一份实现（styleSerialize.stringifyCssValue），客户端行内样式、stylesheet 规则、
 * axii/ssr 的行内样式与 stylesheet 共用；数字自动补单位只有一张名单（styleSerialize.autoUnitStyleNames）。
 * 名单在真实浏览器里核对：凡是浏览器拒绝无单位数字、接受长度的标准属性，要么在名单里，要么在下面写明理由的排除表里。
 * Run: npx vitest run __tests__/styleAutoUnit.spec.tsx
 */
import {AUTO_ADD_UNIT_ATTR, createElement, createRoot, setAutoUnitType} from '@framework'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {createElement as createSsrElement, renderToString} from '../src/ssr.js'
import * as styleSerialize from '../src/styleSerialize.js'

let root: ReturnType<typeof createRoot>
let rootEl: HTMLElement
beforeEach(() => {
    document.body.innerHTML = ''
    document.adoptedStyleSheets = []
    rootEl = document.createElement('div')
    document.body.appendChild(rootEl)
    root = createRoot(rootEl)
})
afterEach(() => {
    root.destroy()
    setAutoUnitType('px')
})

function accepts(name: string, text: string): boolean {
    const el = document.createElement('div')
    ;(el.style as any)[name] = text
    return (el.style as any)[name] !== ''
}

// el.style 上的驼峰属性名（不含连字符写法、cssText / cssFloat 与方法）
function styleNames(): string[] {
    const names: string[] = []
    const style = document.createElement('div').style as any
    for (const name in style) {
        if (name.includes('-') || name === 'cssText' || name === 'cssFloat' || typeof style[name] !== 'string') continue
        names.push(name)
    }
    return names.sort()
}

// 取值混合了长度与其他类型（线型、颜色、图片、路径……）的简写：它们不是长度属性，名单不收。
//  浏览器同样拒绝无单位数字（border: 1 不合法），但简写里的数字写法本来就不自然，按名单「长度属性」的口径排除。
const MIXED_SHORTHANDS = [
    'background', 'border', 'borderBlock', 'borderBlockEnd', 'borderBlockStart', 'borderBottom', 'borderInline',
    'borderInlineEnd', 'borderInlineStart', 'borderLeft', 'borderRight', 'borderTop', 'columnRule', 'mask', 'offset',
    'outline', 'textDecoration',
]
// 无单位数字本身合法、含义不同的属性：补单位会改变含义（lineHeight: 1.5 是倍数，flex: 1 是 flex-grow）
const UNITLESS_PINS = [
    'aspectRatio', 'borderImageOutset', 'borderImageWidth', 'columns', 'flex', 'flexGrow', 'fontWeight', 'lineHeight',
    'opacity', 'order', 'scale', 'strokeWidth', 'tabSize', 'zIndex',
]

function declaredIn(declaration: CSSStyleDeclaration, name: string): string {
    return (declaration as any)[name]
}

// 规则表里属于这些 class、且不是嵌套（:hover）的规则
function ownRules(sheets: Iterable<CSSStyleSheet>, classes: string[]): CSSStyleRule[] {
    const found: CSSStyleRule[] = []
    const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
                if (!rule.selectorText.includes(':hover') && classes.some(c => rule.selectorText.includes(`.${c}`))) found.push(rule)
            }
            if ((rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules)
        }
    }
    for (const sheet of sheets) visit(sheet.cssRules)
    return found
}

// 同一个 style 对象在四条路径上写出的值，按浏览器解析后的结果比较
function fourPaths(style: Record<string, unknown>, names: string[]) {
    const nested = {...style, '&:hover': {opacity: 0.5}}
    root.render(<div>
        <p id="inline" style={style}>inline</p>
        <p id="sheet" style={nested}>sheet</p>
    </div>)
    const csrInline = rootEl.querySelector('#inline') as HTMLElement
    const csrSheet = rootEl.querySelector('#sheet') as HTMLElement
    const csrRules = ownRules(document.adoptedStyleSheets, Array.from(csrSheet.classList))

    const ssrInlineHost = document.createElement('div')
    ssrInlineHost.innerHTML = renderToString(createSsrElement('p', {style})).html
    const ssrInline = ssrInlineHost.querySelector('p') as HTMLElement
    const ssrSheetResult = renderToString(createSsrElement('p', {style: nested}))
    const ssrSheetHost = document.createElement('div')
    ssrSheetHost.innerHTML = ssrSheetResult.html
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(ssrSheetResult.styles.replace(/<\/?style[^>]*>/g, '\n'))
    const ssrRules = ownRules([sheet], Array.from((ssrSheetHost.querySelector('p') as HTMLElement).classList))

    const result: Record<string, Record<string, string>> = {}
    for (const name of names) {
        result[name] = {
            csrInline: declaredIn(csrInline.style, name),
            csrSheet: csrRules.map(r => declaredIn(r.style, name)).join('|'),
            ssrInline: declaredIn(ssrInline.style, name),
            ssrSheet: ssrRules.map(r => declaredIn(r.style, name)).join('|'),
        }
    }
    return result
}

function same(value: string) {
    return {csrInline: value, csrSheet: value, ssrInline: value, ssrSheet: value}
}

describe('#60 one auto-unit list, one value conversion', () => {
    test('#60a: the list is every standard length property that rejects unitless numbers (checked in this browser)', () => {
        const names = styleNames()
        const isListed = (name: string) => AUTO_ADD_UNIT_ATTR.test(name)
        const needsUnit = names.filter(n => !n.startsWith('webkit') &&
            ['7', '1', '0.5', '-3'].every(t => !accepts(n, t)) && accepts(n, '7px'))
        const listedNames: string[] = [...((styleSerialize as any).autoUnitStyleNames ?? [])]
        expect({
            // 名单里的每个名字都要补单位（不会把合法的无单位数字改坏），也不含厂商前缀名
            listedButUnitless: names.filter(n => isListed(n) && !needsUnit.includes(n)),
            // 要补单位、却不在名单里的只剩混合简写
            unlisted: needsUnit.filter(n => !isListed(n)),
            // 名单里没有拼错、浏览器不认识的名字；公开的正则与名单是同一份
            unknownToBrowser: listedNames.filter(n => !names.includes(n)),
            regexDisagrees: names.filter(n => isListed(n) !== listedNames.includes(n)),
            // 无单位数字合法的属性一个都不补
            unitlessPins: UNITLESS_PINS.filter(n => isListed(n) || !accepts(n, '7')),
        }).toEqual({
            listedButUnitless: [],
            unlisted: MIXED_SHORTHANDS,
            unknownToBrowser: [],
            regexDisagrees: [],
            unitlessPins: [],
        })
    })

    test('#60b: newly listed properties get the unit on all four paths (CSR inline / sheet, SSR inline / sheet)', () => {
        const style = {
            borderTopLeftRadius: 4,
            outlineOffset: 2,
            scrollMarginTop: 7,
            textUnderlineOffset: 3,
            insetInlineStart: 9,
            verticalAlign: -2,
            translate: [5, 6],
            gridTemplateColumns: [10, 20],
            // 原有名单与无单位属性不变
            marginTop: 1,
            lineHeight: 1.5,
        }
        expect(fourPaths(style, Object.keys(style))).toEqual({
            borderTopLeftRadius: same('4px'),
            outlineOffset: same('2px'),
            scrollMarginTop: same('7px'),
            textUnderlineOffset: same('3px'),
            insetInlineStart: same('9px'),
            verticalAlign: same('-2px'),
            translate: same('5px 6px'),
            gridTemplateColumns: same('10px 20px'),
            marginTop: same('1px'),
            lineHeight: same('1.5'),
        })
    })

    test('#60c: the configured unit applies to the new names on both sides', () => {
        setAutoUnitType('rem')
        expect(fourPaths({borderTopLeftRadius: 2, outlineOffset: 1}, ['borderTopLeftRadius', 'outlineOffset'])).toEqual({
            borderTopLeftRadius: same('2rem'),
            outlineOffset: same('1rem'),
        })
    })

    // 客户端行内样式曾有自己的一份转换：名单内的属性上，除 StyleSize 以外的对象也被接上单位
    //  （另一份 axii 副本里的 StyleSize、任何带 toString 的尺寸对象都写成 "2rempx"，被浏览器拒绝），
    //  而 stylesheet / SSR 原样写出 "2rem"。现在两端同一个规则：数字（number / bigint）补单位，其余原样字符串化。
    test('#60d: non-number values in unit properties are written the same way on both sides', () => {
        // 另一份 axii 副本里的 StyleSize 就是这样一个类实例（instanceof 认不出来）。普通对象会被当成嵌套选择器，不能用来代替。
        class SizeLike {
            constructor(private text: string) {}
            toString() { return this.text }
        }
        expect(fourPaths({width: new SizeLike('2rem'), height: BigInt(10)}, ['width', 'height'])).toEqual({
            width: same('2rem'),
            height: same('10px'),
        })
    })
})
