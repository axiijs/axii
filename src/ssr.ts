/**
 * Node-safe SSR entry (`axii/ssr`). String serialization only — no DOM globals.
 * M-02: attrs/forms/escape/FTS/FCS/context/DirectNodes/ElementChildText.
 * M-03: RxList / Compact / G3-* / G4-F / table tbody.
 * M-04: StyleManager nested/@ styles → `styles` + deterministic class ids.
 * M-05: Portal bypass (§3.3.d), lazy sync fallback, lifecycle no-ops / isolation.
 */
import {isAtom, RxList} from 'data0'
import type {Component, ComponentNode, RenderContext} from './types'
import type {PathContext} from './Host'
import {ComponentHost, INNER_CONFIG_PROP, N_ATTR} from './ComponentHost.js'
import {isAxiiPortalComponent, resolvePortalExportKey, Portal} from './Portal.js'
import {beginSsrPass, endSsrPass} from './ssrContext.js'
import {
    SSR_STYLE_CLASSES_ATTRIBUTE,
    contentStyleId,
    evaluateStyleEntries,
    gateStyleRules,
    generateStyleStaticId,
    getComponentTypeId,
    hashStyleContent,
    isAcceptableInlineDeclaration,
    isAcceptableSingleCssRule,
    cssPropertyName,
    sheetDeclaredKeys,
    prepareStyleContent,
    renderPreparedStyle,
    serializePreparedStyle,
    splitStyleObject,
    stringifyCssValue,
    styleValueNeedsStylesheet,
    toCssSafeComponentName,
} from './styleSerialize'
import {compareStyleSheetOrder, getStyleSheetOrder, type StyleSheetOrder} from './styleCascade'
import {RAWTEXT_TAGS, RCDATA_TAGS, hasOnPrefix, isAriaReflectionProperty, svgAttributeName, svgOnlyElementNames} from './markupNames'
import {warnInvalidOnProp} from './diagnostics'

/**
 * SSR 自己的 Fragment 标记：服务端的 JSX 走 createSsrElement / 组件 renderContext，从不调用 DOM.ts 的
 * createElement / Fragment，Fragment 描述按与这个标记的引用相等来识别。
 * CAUTION 这不等于「SSR 入口不加载 DOM.ts」：组件的 props / AOP 计算借用 ComponentHost（见
 *  invokeComponent），它把 DOM.ts、StaticHost、hydration 等客户端模块一起带进来（构建产物里它们本来就
 *  和 Portal 共用一个 chunk）。所以这条 import 链上的模块在加载时都不能访问 document / window；
 *  node/importInNode.spec.ts 在没有 DOM 全局的 Node 里加载 axii/ssr 守住这一点。
 */
export function Fragment(_props?: any): any {
    return null
}
;(Fragment as any).__axiiFragment = true

export type RenderToStringResult = {
    html: string
    styles: string
    portals: Record<string, {html: string, styles: string}>
}

export {isAcceptableSingleCssRule}

const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// CAUTION 解析器会吞掉紧跟在这几个开始标签后面的第一个换行（HTML 的书写便利规则）。
//  内容本身以换行开头时必须多写一个，否则 textarea 的值 / pre 的内容在解析后少一行。
const LEADING_NEWLINE_TAGS = new Set(['textarea', 'pre', 'listing'])

const SSR_ELEMENT = Symbol.for('axii.ssr.element')
const SSR_REUSABLE = Symbol.for('axii.ssr.reusable')

type SsrElement = {
    [SSR_ELEMENT]: true
    type: string | typeof Fragment
    props: AttributesLike | null
    children: any[]
}

type SsrReusable = {
    [SSR_REUSABLE]: true
    source: any
}

type AttributesLike = {[k: string]: any}

function isSsrElement(v: any): v is SsrElement {
    return !!v && typeof v === 'object' && v[SSR_ELEMENT] === true
}

function isSsrReusable(v: any): v is SsrReusable {
    return !!v && typeof v === 'object' && v[SSR_REUSABLE] === true
}

function isComponentNode(v: any): v is ComponentNode {
    return !!v && typeof v === 'object' && typeof v.type === 'function' && 'props' in v && 'children' in v && !isSsrElement(v)
}

/** ≡ FunctionHost.ts text fast path (~144–145) */
export function isFunctionHostTextSnapshot(node: unknown): boolean {
    const t = typeof node
    return node == null || t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}

function stringValue(v: any): string {
    if (v === undefined || v === null || typeof v === 'boolean') return ''
    return (v as any)?.toString ? (v as any).toString() : JSON.stringify(v)
}

function escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// CAUTION 名字（属性名 / 标签名）是原样拼进 HTML 的，值和文本的转义管不到它们：
//  `<div {...untrusted}>` 的 key、动态标签名里一旦有空白、`/`、`>`、`=`，就能在名字的位置上
//  结束当前属性或标签，凭空造出新的属性（onmouseover=…）甚至新的元素（<script>）。
//  同样的名字在 CSR 下被 DOM 拒绝（setAttribute / createElement 抛 InvalidCharacterError），
//  这里对齐为抛错（可观测）。不做静默丢弃——丢弃会把调用方的 bug 藏起来。
//  判定集合就是 HTML tokenizer 在名字状态下的终止字符（ASCII 空白、`/`、`>`，属性名另加 `=`）
//  再加 NUL，与 DOM 标准的 valid attribute local name / valid element local name 一致；
//  标签名还必须以 ASCII 字母开头，否则 `<` 之后根本不会进入标签状态。
const INVALID_ATTR_NAME_CHARS = /[\t\n\f\r \/=>\u0000]/
const VALID_TAG_NAME = /^[a-zA-Z][^\t\n\f\r \/>\u0000]*$/

function assertAttrName(name: string): void {
    if (name === '' || INVALID_ATTR_NAME_CHARS.test(name)) {
        throw new Error(`[axii/ssr] invalid attribute name: ${JSON.stringify(name)}`)
    }
}

function assertTagName(name: string): void {
    if (!VALID_TAG_NAME.test(name)) {
        throw new Error(`[axii/ssr] invalid tag name: ${JSON.stringify(name)}`)
    }
}

// CAUTION 响应式属性值的快照，与 CSR 的求值逐条对齐（StaticHost.updateAttribute + DOM.setAttribute）：
//  函数 / atom 调用一次取当前值；数组逐项求值，除 select 的多选 value 外按覆盖语义只取最后一项。
//  只能用在「值」上：调用方必须已经排除事件、ref 这类本身就是函数的 prop——
//  它们在服务端不执行（§3.4），在这里调用就是把用户的事件处理函数当成取值函数跑了一遍。
function snapshotAttrValue(value: any, keepArray = false): any {
    if (Array.isArray(value)) {
        const evaluated = value.map(v => typeof v === 'function' ? v() : v)
        return keepArray ? evaluated : evaluated[evaluated.length - 1]
    }
    return typeof value === 'function' ? value() : value
}

// CAUTION class 的取值与 DOM.setAttribute 的 className 分支同形：字符串、对象、以及两者的数组；
//  数组里的 null / boolean 条件项跳过；对象的 value 可以是 atom / 函数，要求值后再判断真假。
//  曾经把数组当对象 for…in（输出下标 "0 1"），对象 value 不求值（atom 恒为真，class 永远挂着）。
function classNameSnapshot(value: any): string {
    const names: string[] = []
    collectClassNames(value, names)
    return names.join(' ')
}
// 逐层展开：整个 className、数组项都可以是函数 / atom（先取值），取到的仍可以是字符串、对象或数组；
// 数组可以再嵌数组（组件把调用方传进来的数组包进自己的数组），与 DOM.ts 的 flattenNestedArray 一致。
function collectClassNames(option: any, names: string[]): void {
    if (typeof option === 'function') option = option()
    if (option == null || typeof option === 'boolean') return
    if (Array.isArray(option)) {
        for (let i = 0; i < option.length; i++) collectClassNames(option[i], names)
    } else if (typeof option === 'object') {
        for (const name in option) {
            const flag = option[name]
            if (typeof flag === 'function' ? flag() : flag) names.push(name)
        }
    } else {
        names.push(String(option))
    }
}

/** §3.6.1 RAWTEXT / SSR `<style>` termination sequence gate */
export function assertNoRawTextTerminator(payload: string, tagName: string): void {
    const lower = tagName.toLowerCase()
    const re = new RegExp(`</${lower}(?=[\\s/>]|$)`, 'i')
    if (re.test(payload)) {
        throw new Error(`[axii/ssr] RAWTEXT termination sequence in <${lower}> payload`)
    }
    if (lower === 'script' && scriptDataEndsDoubleEscaped(payload)) {
        throw new Error('[axii/ssr] <script> payload has "<!--" followed by "<script": the element would not be closed')
    }
}

// CAUTION <script> 的内容除了「提前关闭」还有一种相反的破坏方式：`<!--` 之后再出现 `<script`
//  （后跟空白 / `/` / `>`）会让解析器进入 script data double escaped 状态，在这个状态里
//  `</script>` 不关闭元素。载荷结束时仍停在该状态的话，序列化器自己写的 `</script>` 也关不上——
//  后面整页内容都被吞进脚本文本（内联 JSON 数据里带上这串字符就能触发）。
//  这里按 HTML tokenizer 的三个状态走一遍载荷，只回答「结束时是否停在 double escaped」；
//  命中同样抛错：RAWTEXT 不解码实体，没有通用的转义可用（§3.6.1）。
function scriptDataEndsDoubleEscaped(payload: string): boolean {
    const s = payload.toLowerCase()
    const endsTagName = (ch: string | undefined) =>
        ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r' || ch === ' ' || ch === '/' || ch === '>'
    // 0: script data；1: escaped（`<!--` 之后）；2: double escaped（其后又出现 `<script`）
    let state = 0
    let i = 0
    while (i < s.length) {
        if (state === 0) {
            const open = s.indexOf('<!--', i)
            if (open === -1) break
            state = 1
            // `<!--` 的两个 `-` 本身就算进 `-->`：`<!-->` 立即回到 script data
            i = open + 2
            continue
        }
        const tag = state === 1 ? '<script' : '</script'
        let at = s.indexOf(tag, i)
        while (at !== -1 && !endsTagName(s[at + tag.length])) at = s.indexOf(tag, at + 1)
        const close = s.indexOf('-->', i)
        if (close !== -1 && (at === -1 || close < at)) {
            state = 0
            i = close + 3
        } else if (at === -1) {
            break
        } else {
            state = state === 1 ? 2 : 1
            i = at + tag.length + 1
        }
    }
    return state === 2
}

// ─── M-04 style collection ───

type SsrComponentFrame = {
    name: string
    typeId: number
    /** Saved when entering nested ComponentHost (GetPathToLastComponent stops at it). */
    savedPathHostEps: number[][]
    savedStaticHostEp: number[]
    savedFunctionHostDepth: number
}

type SsrStyleSheet = StyleSheetOrder & {css: string}

type SsrStyleState = {
    /** Stylesheet id → gated CSS, deduped within the currently rendered payload. */
    sheets: Map<string, SsrStyleSheet>
    rollingSeq: number
    componentStack: SsrComponentFrame[]
    /** >0 while serializing FunctionHost structure under current ComponentHost (forces rolling). */
    functionHostDepth: number
    /**
     * Hosts between last ComponentHost and style owner (exclusive of leaf StaticHost),
     * each contributing pathContext.elementPath — mirrors generateComponentElementStaticId.
     */
    pathHostEps: number[][]
    /** Current conceptual StaticHost.pathContext.elementPath */
    staticHostEp: number[]
    /** F30: shared static id+Findex → content signature */
    idToStaticStyleSignature: Map<string, string>
}

let ssrStyle: SsrStyleState | null = null
/** Active portals map for the current renderToString call (§3.3.d) */
let ssrPortals: Record<string, {html: string, styles: string}> | null = null

function beginSsrStyles() {
    ssrStyle = {
        sheets: new Map(),
        rollingSeq: 0,
        componentStack: [],
        functionHostDepth: 0,
        pathHostEps: [],
        staticHostEp: [],
        idToStaticStyleSignature: new Map(),
    }
}

function endSsrStyles(): string {
    const state = ssrStyle
    ssrStyle = null
    return state ? serializeStyleSheets(state.sheets) : ''
}

function serializeStyleSheets(sheets: Map<string, SsrStyleSheet>): string {
    if (sheets.size === 0) return ''
    const sorted = Array.from(sheets.values()).sort(compareStyleSheetOrder)
    const css = sorted.map(sheet => sheet.css).join('\n')
    assertNoRawTextTerminator(css, 'style')
    return css
}

function pushSsrComponent(type: Function) {
    if (!ssrStyle) return
    ssrStyle.componentStack.push({
        name: toCssSafeComponentName(type.name?.toString?.() || 'Anonymous'),
        typeId: getComponentTypeId(type),
        savedPathHostEps: ssrStyle.pathHostEps,
        savedStaticHostEp: ssrStyle.staticHostEp,
        savedFunctionHostDepth: ssrStyle.functionHostDepth,
    })
    // Nested ComponentHost: path / FunctionHost depth restart (GetPathToLastComponent)
    ssrStyle.pathHostEps = []
    ssrStyle.staticHostEp = []
    ssrStyle.functionHostDepth = 0
}

function popSsrComponent() {
    const state = ssrStyle
    if (!state) return
    const frame = state.componentStack.pop()
    if (!frame) return
    state.pathHostEps = frame.savedPathHostEps
    state.staticHostEp = frame.savedStaticHostEp
    state.functionHostDepth = frame.savedFunctionHostDepth
}

function currentStyleStaticId(elementPath: number[]): string {
    const state = ssrStyle
    if (!state || state.componentStack.length === 0) {
        return generateStyleStaticId('GLOBAL', '', state?.pathHostEps ?? [], elementPath)
    }
    const top = state.componentStack[state.componentStack.length - 1]
    return generateStyleStaticId(top.name, top.typeId, state.pathHostEps, elementPath)
}

/**
 * Emit StyleManager-equivalent stylesheet classes + collect gated CSS for a style prop.
 * Returns class ids to merge into the element's class attribute; simple inline styles returned separately.
 */
function collectElementStyles(
    styleValue: any,
    elementPath: number[],
): {classIds: string[], styleMarkers?: string[], inline: string} {
    const state = ssrStyle
    if (!state) return {classIds: [], inline: ''}

    // 与 CSR StyleManager.update 共用求值 + 展开：条目序号（F<n>）两边必须一致
    const entries = evaluateStyleEntries(styleValue)
    const classIds: string[] = []
    let styleMarkers: string[] | undefined
    let rollingBaseId: string | undefined
    const staticBase = currentStyleStaticId(elementPath)
    const sharedStaticBaseId = state.functionHostDepth > 0 ? null : staticBase

    // 行内样式按条目顺序合成，≡ CSR StyleManager.update 逐条写 el.style（见那里的 CAUTION）：
    //  对象条目逐个属性写入（同名属性原位更新），空值删除该属性；stylesheet 条目把它顶层声明的
    //  属性从前面的行内声明里删掉（让位给它的规则）。字符串条目按原样依次拼接（不解析）：
    //  写到它之前的声明先落成文本，之后不再参与让位。
    let inline = ''
    let inlineDecls: Map<string, string> | undefined

    entries.forEach(({value: item, entryIsDynamic, isBound}, index) => {
        if (item == null || typeof item === 'boolean') return
        if (typeof item === 'string') {
            inline = joinInline(joinInline(inline, serializeInlineDeclarations(inlineDecls)), item)
            inlineDecls = undefined
            return
        }
        if (typeof item !== 'object') return

        const {simpleStyles, nestedStyles} = splitStyleObject(item)
        const usesSheet = isBound || Object.keys(nestedStyles).length > 0
        if (!usesSheet) {
            // Pure inline (no nested/bound): snapshot atom/function values (no FOUC)
            for (const sk in simpleStyles) {
                const sv = (simpleStyles as any)[sk]
                const cssKey = cssPropertyName(sk)
                const cssVal = (sv == null || typeof sv === 'boolean' || sv === '') ? '' : stringifyCssValue(sk, sv)
                if (!cssVal) {
                    // CSR: el.style[k] = '' 删除前面条目写过的同名属性
                    inlineDecls?.delete(cssKey)
                    continue
                }
                // CSR 里不合格的值整次赋值被拒绝，前面的值保留
                if (!isAcceptableInlineDeclaration(cssKey, cssVal)) continue
                ;(inlineDecls ??= new Map()).set(cssKey, cssVal)
            }
            return
        }
        if (inlineDecls) {
            const yielded = sheetDeclaredKeys(item)
            if (yielded) for (const key of yielded) removeInlineDeclaration(inlineDecls, cssPropertyName(key))
        }

        const prepared = prepareStyleContent(item)
        const signature = prepared.shareable ? serializePreparedStyle(prepared) : undefined
        let isDynamic = entryIsDynamic || prepared.isReactive || !prepared.shareable
        if (signature !== undefined && !isDynamic && sharedStaticBaseId) {
            const sharedIdWithIndex = `${sharedStaticBaseId}F${index}`
            const existingSignature = state.idToStaticStyleSignature.get(sharedIdWithIndex)
            if (existingSignature === undefined) {
                state.idToStaticStyleSignature.set(sharedIdWithIndex, signature)
            } else if (existingSignature !== signature) {
                isDynamic = true
            }
        }

        // Keep CSR and SSR aligned when a static path cannot identify a sheet.
        const contentId = signature !== undefined && (isDynamic || !sharedStaticBaseId) ? contentStyleId(signature, index) : undefined
        const isRolling = contentId === undefined && isDynamic
        let finalId = contentId
        if (isRolling) {
            rollingBaseId ??= `${staticBase}R${state.rollingSeq++}`
            finalId = `${rollingBaseId}F${index}I0`
        } else {
            finalId ??= `${staticBase}F${index}`
        }
        const cssSignature = signature ?? serializePreparedStyle(prepared)
        const pendingMarker = isRolling
            ? `!${hashStyleContent(finalId + ':' + cssSignature)}` as const
            : undefined
        if (!state.sheets.has(finalId)) {
            const css = gateStyleRules(renderPreparedStyle(`.${finalId}`, prepared, pendingMarker))
            if (!css) return
            state.sheets.set(finalId, {...getStyleSheetOrder(index, prepared, cssSignature), css})
        }
        classIds.push(finalId)
        if (pendingMarker) (styleMarkers ??= []).push(finalId, pendingMarker)
        else if (contentId !== undefined) (styleMarkers ??= []).push(finalId)
    })

    return {classIds, styleMarkers, inline: joinInline(inline, serializeInlineDeclarations(inlineDecls))}
}

function joinInline(a: string, b: string): string {
    return a && b ? `${a};${b}` : (a || b)
}

function serializeInlineDeclarations(decls: Map<string, string> | undefined): string {
    let text = ''
    if (decls) for (const [name, value] of decls) text += `${text ? ';' : ''}${name}:${value}`
    return text
}

// CSR 用 CSSOM 删除（el.style[k] = ''），简写与分项由浏览器展开。服务端不解析简写，尽力而为：
//  - 删除简写（margin）时连同已写入的分项（margin-top …）一起删，分项按 SHORTHAND_LONGHANDS 的显式表；
//    不在表里的简写和自定义属性只删同名。
//  - 删除分项（margin-top）而行内写的是简写（margin）时保留简写：激活前这一个分项显示为行内值，
//    其余分项正确；激活时 CSR 按同样的顺序重写行内样式，结果与纯 CSR 一致。
//  - 字符串条目里的声明不解析、不删除，同样由激活时的 CSR 重写修正。
function removeInlineDeclaration(decls: Map<string, string>, name: string) {
    decls.delete(name)
    const longhands = SHORTHAND_LONGHANDS[name]
    if (longhands) for (const longhand of longhands) removeInlineDeclaration(decls, longhand)
}

// CAUTION 删简写时连带删除的分项只能按显式的表，不能按名字前缀：前缀既会多删（flex 不重置
//  flex-direction，border 不重置 border-radius / border-collapse，border-top 不重置
//  border-top-left-radius，outline 不重置 outline-offset，margin 不重置 margin-inline-start），
//  也会漏删（inset、gap、place-* 的分项不带简写的名字）。多删会让没有激活的纯 SSR 页面丢掉声明，
//  漏删只是回到 v4.8.1 的「行内值压过 stylesheet」，激活时由 CSR 修正——所以表里只收确定会被
//  简写重置的分项，嵌套简写（border → border-top → border-top-width）递归展开。不在表里的简写只删同名。
const SHORTHAND_LONGHANDS: {[shorthand: string]: string[]} = Object.assign(Object.create(null), {
    margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
    inset: ['top', 'right', 'bottom', 'left'],
    gap: ['row-gap', 'column-gap'],
    flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
    'flex-flow': ['flex-direction', 'flex-wrap'],
    overflow: ['overflow-x', 'overflow-y'],
    outline: ['outline-color', 'outline-style', 'outline-width'],
    'place-items': ['align-items', 'justify-items'],
    'place-content': ['align-content', 'justify-content'],
    'place-self': ['align-self', 'justify-self'],
    'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
    columns: ['column-width', 'column-count'],
    'column-rule': ['column-rule-width', 'column-rule-style', 'column-rule-color'],
    'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color'],
    font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
    background: ['background-color', 'background-image', 'background-repeat', 'background-attachment',
        'background-position', 'background-size', 'background-origin', 'background-clip'],
    'background-position': ['background-position-x', 'background-position-y'],
    transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
    animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
        'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
    'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
    border: ['border-top', 'border-right', 'border-bottom', 'border-left',
        'border-width', 'border-style', 'border-color', 'border-image'],
    'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
    'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
    'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
    'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
    'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
    'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
    'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
    'border-image': ['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'],
})

/** Emit one NORMAL non-empty text unit (always wrap — allowed by §3.2.1 A2). */
function emitNonEmptyText(text: string, out: string[]): void {
    out.push('<!--axii:t-->', escapeText(text), '<!--axii:/t-->')
}

function emitTextPh(text: string, out: string[]): void {
    if (text.length === 0) {
        out.push('<!--axii:0-->')
    } else {
        emitNonEmptyText(text, out)
    }
}

function emitElementChildText(text: string, out: string[]): void {
    if (text.length === 0) {
        out.push('<!--axii:0-->')
    } else {
        emitNonEmptyText(text, out)
    }
}

// CAUTION 「style / script 的内容是原文（RAWTEXT）」只在 HTML 内容里成立。解析器在 <svg> / <math> 之下
//  （外来内容，foreign content）创建的是 SVG / MathML 元素，tokenizer 不切换状态：其中的文本是普通数据，
//  `&` 解码、`<` 开始标签，而且 <img> / <p> 这类开始标签会跳出外来内容、成为真正的 HTML 元素。
//  按标签名一律原样写出的话，<svg><style>{userCss}</style></svg> 里的 `<img src=x onerror=…>`
//  在解析后就是一个会执行的 <img>（CSR 下同样的 JSX 只是一段文本）。
//  所以序列化时跟踪「当前元素被插入到哪种内容里」，按 HTML 解析器的规则（tree construction 的
//  foreign content 与 integration point）推导：
//   - HTML 内容里只有标签名 svg / math 开启外来内容（_isSVG 不算：createSVGElement('style') 在 HTML
//     内容里解析出来仍是 HTML 的 style，元素是否为外来元素由解析器按祖先决定，不由我们的标记决定）；
//   - SVG 的 foreignObject / desc / title 是 HTML integration point，子内容回到 HTML；
//   - MathML 的 mi / mo / mn / ms / mtext 是 text integration point（子内容按 HTML 规则，mglyph /
//     malignmark 除外）；annotation-xml 的 encoding 为 text/html / application/xhtml+xml 时回到 HTML。
//  外来元素上的 RAWTEXT 标签按 RCDATA 写（转义 & < >、不写 axii:* 标记——hydration 按 localName
//  把它当字符数据父节点，结构不变）。
//  没有建模「跳出外来内容」（<svg><p> 让解析器弹出 svg）：那是无效的嵌套，按外来内容转义只会让文本
//  多出字面实体，不会产生标签——方向是安全的。
type MarkupContext = 'html' | 'svg' | 'math' | 'mathText'
/** 下一个元素被插入到的内容类型（随 serializeSsrElement 的子内容进出而保存 / 恢复） */
let insertionContext: MarkupContext = 'html'
/** 正在序列化子内容的那个元素本身是不是外来元素（决定 style / script 等的文本按哪种规则写） */
let parentIsForeignElement = false

function isForeignInsertion(context: MarkupContext, tagLower: string): boolean {
    if (context === 'svg' || context === 'math') return true
    return context === 'mathText' && (tagLower === 'mglyph' || tagLower === 'malignmark')
}

function childContextOf(context: MarkupContext, tagLower: string, props: AttributesLike | null): MarkupContext {
    if (context === 'html' || (context === 'mathText' && !isForeignInsertion(context, tagLower))) {
        if (tagLower === 'svg') return 'svg'
        if (tagLower === 'math') return 'math'
        return 'html'
    }
    if (context === 'svg') {
        return (tagLower === 'foreignobject' || tagLower === 'desc' || tagLower === 'title') ? 'html' : 'svg'
    }
    // MathML（含 text integration point 里的 mglyph / malignmark）
    if (tagLower === 'mi' || tagLower === 'mo' || tagLower === 'mn' || tagLower === 'ms' || tagLower === 'mtext') {
        return 'mathText'
    }
    if (tagLower === 'annotation-xml') {
        const encoding = snapshotAttrValue(props?.encoding)
        const lower = typeof encoding === 'string' ? encoding.toLowerCase() : ''
        if (lower === 'text/html' || lower === 'application/xhtml+xml') return 'html'
    }
    return 'math'
}

function parentTextMode(tag?: string): 'normal' | 'rcdata' | 'rawtext' {
    if (!tag) return 'normal'
    const t = tag.toLowerCase()
    if (RCDATA_TAGS.has(t)) return 'rcdata'
    // 外来元素不切换 tokenizer 状态：文本是普通数据，按 RCDATA 规则转义（见 insertionContext）
    if (RAWTEXT_TAGS.has(t)) return parentIsForeignElement ? 'rcdata' : 'rawtext'
    return 'normal'
}

function emitParentText(text: string, out: string[], parentTag?: string): void {
    const mode = parentTextMode(parentTag)
    if (mode === 'rcdata') {
        out.push(escapeText(text))
        return
    }
    if (mode === 'rawtext') {
        assertNoRawTextTerminator(text, parentTag!)
        out.push(text)
        return
    }
    emitElementChildText(text, out)
}

// ─── Form / attr serialization (§3.6.2) ───

// CAUTION prop 名不等于 attribute 名的情况，必须与 DOM.setAttribute 写出的结果一致：
//  SVG 元素上 strokeWidth 这类 prop 写成 stroke-width、xlinkHref / xlink:href 写成 xlink:href
//  （CSR 用 setAttributeNS，解析器在外来内容里把 xlink:href 还原成同一个 namespace 属性）。
//  原样写出 strokeWidth 的话解析后是不认识的 strokewidth——激活前图形的描边、引用全部无效，
//  激活后还多留一个没人管的属性。
//  HTML 元素上 CSR 走 property 赋值（`name in node`），绝大多数 IDL 名与 attribute 名只差大小写
//  （HTML attribute 名大小写不敏感），下面这几个是真正不同名的：原样写出 htmlFor 的话 label 在
//  激活前不关联控件，激活后 DOM 上还多一个 htmlfor。className 另有专门分支。
const HTML_PROP_ATTRIBUTE_NAMES: {[k: string]: string} = {
    htmlFor: 'for',
    httpEquiv: 'http-equiv',
    acceptCharset: 'accept-charset',
}

function attributeNameOf(key: string, isSVG: boolean): string {
    if (isSVG) {
        const xlinkName = key.replace(/^xlink\:?/, '')
        return xlinkName !== key ? `xlink:${xlinkName.toLowerCase()}` : svgAttributeName(key)
    }
    if (hasOwnProp(HTML_PROP_ATTRIBUTE_NAMES, key)) return HTML_PROP_ATTRIBUTE_NAMES[key]
    // ARIA 反射属性：ariaLabel -> aria-label（CSR 对它做 property 赋值，反射出的就是这个名字）
    return isAriaReflectionProperty(key) ? `aria-${key.slice(4).toLowerCase()}` : key
}

// CAUTION boolean 值怎么写，CSR 取决于「这个名字是不是元素的 property、property 是什么类型」
//  （规则表在 DOM.ts setEmptyOrBooleanProperty 上方，attribute 分支在 setAttribute 末尾）：
//   - string 类型的 property：true 等价于 HTML 里只写属性名（download / popover / alt -> x=""），
//     false 是「没写这个属性」；
//   - 取值是关键字的名字原样保留 true / false：contenteditable、spellcheck、draggable、
//     writingSuggestions、aria-* / data-*（attribute 写法）与 ariaXxx（property 写法）；
//     translate 的关键字是 yes / no；
//   - hidden：true -> hidden=""，false 不输出；
//   - 其余（真正的 boolean attribute、不认识的名字、SVG 与自定义元素上的任何名字）：
//     true -> x="true"（§3.6.1 的布尔属性约定），false 不输出。
//  服务端没有 DOM 可以问 property 的类型，string 类型的 property 只能列一张静态表：
//  这里收的是各元素上类型没有歧义的常用反射属性（width / height / min / max 这类在不同元素上
//  类型不同的名字不收；type / list / form 在 CSR 走 attribute 分支，也不收）。
//  表里漏掉的名字退回 x="true"——对 download / popover / alt 这样「true 有专门含义」的属性
//  才有实际差别，它们都在表里。
const STRING_TYPED_PROPERTIES = new Set([
    // 全局
    'title', 'lang', 'dir', 'id', 'slot', 'accessKey', 'nonce', 'popover', 'role',
    'autocapitalize', 'inputMode', 'enterKeyHint',
    // 链接 / 资源 / 媒体
    'href', 'target', 'download', 'rel', 'hreflang', 'ping', 'referrerPolicy', 'src', 'srcset', 'sizes',
    'alt', 'useMap', 'crossOrigin', 'loading', 'decoding', 'fetchPriority', 'poster', 'preload', 'kind',
    'srclang', 'label', 'media', 'integrity', 'charset', 'content', 'cite', 'dateTime',
    // 表单
    'name', 'placeholder', 'pattern', 'accept', 'autocomplete', 'dirName', 'action', 'method', 'enctype',
    'formAction', 'formMethod', 'formEnctype', 'formTarget', 'wrap', 'htmlFor', 'httpEquiv', 'acceptCharset',
    // 表格
    'abbr', 'scope', 'headers',
])

/** boolean 值写出的 attribute 值；null 表示不输出该属性。 */
function booleanAttributeValue(key: string, value: boolean, isSVG: boolean, isCustomElement: boolean): string | null {
    // disabled 在 CSR 有专门分支：真 -> "true"
    if (key === 'disabled') return value ? 'true' : null
    const lower = key.toLowerCase()
    // property 写法（contentEditable / spellcheck）和 attribute 写法（contenteditable / spellCheck）
    //  都保留关键字；aria-* / data-* 的 false 是有语义的值，不是移除
    if (lower === 'contenteditable' || lower === 'spellcheck' ||
        ((key[0] === 'a' || key[0] === 'd') && (/^aria-/.test(key) || /^data-/.test(key)))) {
        return value ? 'true' : 'false'
    }
    // SVG 元素不走 property 分支；自定义元素的 property 语义由组件自己定义，服务端按 attribute 写
    if (isSVG || isCustomElement) return value ? 'true' : null
    if (key === 'draggable' || key === 'writingSuggestions' || isAriaReflectionProperty(key)) {
        return value ? 'true' : 'false'
    }
    if (key === 'translate') return value ? 'yes' : 'no'
    if (key === 'hidden' || STRING_TYPED_PROPERTIES.has(key)) return value ? '' : null
    return value ? 'true' : null
}

/** §3.6.2 SO: select value snapshot driving option `selected` (not a select content attr). */
type SelectSoCtx = {value: string | any[]}

function inputTypeOf(props: AttributesLike | null | undefined): string {
    // type 也可以是响应式的（type={visible ? 'text' : 'password'} 的函数写法），按快照判断通道
    const t = snapshotAttrValue(props?.type)
    return t == null || t === false ? 'text' : String(t).toLowerCase()
}

function hasOwnProp(props: AttributesLike, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(props, key)
}

/** Snapshot select `value` for SO (≡ CSR `__axiiSelectValue__` / `applySelectValue`). */
function extractSelectSo(props: AttributesLike | null | undefined): SelectSoCtx | null {
    if (!props || !hasOwnProp(props, 'value')) return null
    // 多选的数组 value 整体保留（≡ applySelectValue），其余与普通属性同样求值
    const v = snapshotAttrValue(props.value, true)
    return {value: v ?? ''}
}

function optionMatchesSo(optionValue: string, so: SelectSoCtx): boolean {
    if (Array.isArray(so.value)) {
        return so.value.some(v => String(v) === optionValue)
    }
    return String(so.value) === optionValue
}

/** Effective option.value: prop value, else text content (HTML / CSR). */
function optionEffectiveValue(el: SsrElement): string {
    const props = el.props
    if (props && hasOwnProp(props, 'value')) {
        const v = snapshotAttrValue(props.value)
        if (v != null) return String(v)
        // null/undefined → CSR removes attr; value falls back to text
    }
    const children = el.children.length
        ? el.children
        : (props?.children ? (Array.isArray(props.children) ? props.children : [props.children]) : [])
    let text = ''
    for (const c of children) {
        if (c == null || typeof c === 'boolean') continue
        if (isAtom(c)) text += stringValue(c())
        else if (typeof c === 'string' || typeof c === 'number' || typeof c === 'bigint') text += String(c)
    }
    return text
}

function serializeAttrs(
    props: AttributesLike | null | undefined,
    tag: string,
    /** When set, option `selected` is driven by SO match (ignore prop `selected`). */
    optionSelectedBySo?: boolean | null,
    elementPath: number[] = [],
    /** 元素落在 SVG namespace（≡ DOM.createElement 的 _isSVG 判定），决定属性名的写法 */
    isSVG = false,
): string {
    if (!props) {
        if (optionSelectedBySo === true) return ' selected="true"'
        return ''
    }
    const tagLower = tag.toLowerCase()
    const isCustomElement = tag.indexOf('-') !== -1
    const type = inputTypeOf(props)
    const isCheckbox = tagLower === 'input' && type === 'checkbox'
    const isRadio = tagLower === 'input' && type === 'radio'
    const hasValue = hasOwnProp(props, 'value')
    const hasChecked = hasOwnProp(props, 'checked')

    let s = ''
    const skip = new Set<string>([
        'children', 'ref', 'key', '_isSVG', '__source', '__self', 'dangerouslySetInnerHTML',
        // detachStyle 是框架 prop（离场样式，见 DOM.createElement），不是 attribute
        'detachStyle',
        // style handled below (may be function/nested → stylesheet)
        'style', SSR_STYLE_CLASSES_ATTRIBUTE,
    ])

    // textarea value → child text only (TA); skip value attr
    if (tagLower === 'textarea') skip.add('value')
    // select value → option selected only (SO); never emit select value content attr
    if (tagLower === 'select') skip.add('value')
    // SO-driven option: selected comes from match, not prop
    if (optionSelectedBySo != null && tagLower === 'option') skip.add('selected')

    // Deferred value/checked for checkbox CB/CK ordering
    const deferredKeys: string[] = []
    if (tagLower === 'input' && (hasValue || hasChecked)) {
        skip.add('value')
        skip.add('checked')
        for (const key in props) {
            if (key === 'value' || key === 'checked') deferredKeys.push(key)
        }
    }

    // Style first so we can merge stylesheet classes with className
    const styleExtraClasses: string[] = []
    let styleMarkers: string[] | undefined
    let inlineStyle = ''
    if (hasOwnProp(props, 'style') && props.style != null && props.style !== false) {
        const styleVal = props.style
        if (styleValueNeedsStylesheet(styleVal) || typeof styleVal === 'function' || Array.isArray(styleVal)) {
            const collected = collectElementStyles(styleVal, elementPath)
            styleExtraClasses.push(...collected.classIds)
            styleMarkers = collected.styleMarkers
            inlineStyle = collected.inline
        } else if (typeof styleVal === 'object') {
            // Simple inline object: snapshot atom/function values into style attr (Task req 1 / no FOUC)
            const parts: string[] = []
            for (const sk in styleVal) {
                const sv = (styleVal as any)[sk]
                if (sv == null || sv === false || sv === '') continue
                const cssVal = stringifyCssValue(sk, sv)
                const cssKey = cssPropertyName(sk)
                if (!cssVal || !isAcceptableInlineDeclaration(cssKey, cssVal)) continue
                parts.push(`${cssKey}:${cssVal}`)
            }
            inlineStyle = parts.join(';')
        } else if (typeof styleVal === 'string') {
            inlineStyle = styleVal
        }
    }

    let classAttr = ''
    for (const key in props) {
        if (skip.has(key)) continue
        // CAUTION 以 on 开头（不区分大小写）的名字一个都不写（≡ DOM.setAttribute 的 hasOnPrefix 分支，#49）：
        //  事件（isEventName + 函数）只在客户端绑定；其余（ONCLICK / oNclick / once / onclick）两端都丢弃——
        //  这里原来只跳过严格以小写 o、n 开头的 key，ONCLICK / oNclick 原样写进 HTML，解析后就是可执行的 onclick，
        //  ONCLICK={fn} 还会在下面被当成响应式属性调用。必须在取快照之前跳过。
        //  SVG 上的 xlink 前缀名（xlinkOnclick / xlink:onclick）剥掉前缀后是 on* 名字的，客户端同样丢弃（DOM.setAttribute）。
        if (hasOnPrefix(key) ||
            (isSVG && key.charCodeAt(0) === 120 && key.startsWith('xlink') && hasOnPrefix(key.replace(/^xlink\:?/, '')))) {
            warnInvalidOnProp(key, props[key])
            continue
        }
        let value = props[key]
        if (key === 'className' || key === 'class') {
            if (value != null && typeof value !== 'boolean') classAttr = classNameSnapshot(value)
            continue
        }
        // CAUTION 函数 / atom 值是响应式属性（createElement.isValidAttribute 为 false 的那一类），
        //  CSR 首帧就会把它们的当前值写到元素上。这里曾经整个跳过、留给激活后的绑定去补：
        //  服务端 HTML 里 href / src / id / disabled / hidden 全部缺席（激活前链接不可点、内容闪现），
        //  激活又拿响应式 id 的值去匹配一个没有 id 的服务端元素——必然判成失配并重建。
        //  事件（on*）、ref 等本身就是函数的 prop 在上面已经排除；prop: / $ 前缀是组件配置 key，
        //  CSR 不为它们建立绑定（StaticHost.collectReactiveAttr），这里同样不求值。
        if (typeof value === 'function' || (Array.isArray(value) && value.some(v => typeof v === 'function'))) {
            if (key[0] === '$' || key.startsWith('prop:')) continue
        }
        // data-* 的数组是用户给的值，整体字符串化（data-ids={[1, 2]} -> "1,2"）；其余数组取最后一项
        value = snapshotAttrValue(value, key.charCodeAt(0) === 100 && key.startsWith('data-'))
        if (value == null || typeof value === 'function') continue
        if (key === 'uuid') {
            // ≡ DOM.setAttribute：uuid 写成 data-uuid（nullish 表示没有 uuid，上面已经跳过）
            s += ` data-uuid="${escapeAttr(String(value))}"`
            continue
        }
        if (value === true || value === false) {
            const written = booleanAttributeValue(key, value, isSVG, isCustomElement)
            if (written !== null) {
                // 只校验真正会写出去的名字：不输出的属性在 CSR 走 removeAttribute，同样不校验、不抛错
                assertAttrName(key)
                s += ` ${attributeNameOf(key, isSVG)}="${written}"`
            }
            continue
        }
        assertAttrName(key)
        if (key === 'selected' && tagLower === 'option') {
            if (value) s += ` selected="true"`
            continue
        }
        s += ` ${attributeNameOf(key, isSVG)}="${escapeAttr(String(value))}"`
    }

    const allClasses = [classAttr, ...styleExtraClasses].filter(Boolean).join(' ')
    if (allClasses) s += ` class="${escapeAttr(allClasses)}"`
    // A token explicitly present in the author class stays owned by it. A leading + keeps
    // an authored rolling token available for reclaim without asking hydration to remove it.
    if (styleMarkers) {
        let markers = styleMarkers
        if (classAttr) {
            const authoredClasses = classAttr.split(/[\t\n\f\r ]+/)
            markers = []
            for (const marker of styleMarkers) {
                if (marker[0] === '!' || !authoredClasses.includes(marker)) markers.push(marker)
                else if (marker.endsWith('I0')) markers.push(`+${marker}`)
            }
        }
        s += ` ${SSR_STYLE_CLASSES_ATTRIBUTE}="${escapeAttr(markers.join(' '))}"`
    }
    if (inlineStyle) s += ` style="${escapeAttr(inlineStyle)}"`

    // §3.6.2 deferred form props (IV / CK / CB)
    if (tagLower === 'input' && deferredKeys.length) {
        // CAUTION value / checked 是最常见的响应式属性（受控输入：value={atom}、checked={atom}、
        //  value={() => …}）。必须先取快照再套 IV / CK / CB：直接用 prop 本身的话，
        //  atom / 函数恒为真（checked={atom(false)} 输出 checked="true"），
        //  String(fn) 还会把函数源码写进 HTML。
        const valueSnapshot = hasValue ? snapshotAttrValue(props.value) : undefined
        const checkedSnapshot = hasChecked ? snapshotAttrValue(props.checked) : undefined
        if (isCheckbox && hasValue) {
            // CB channel
            // CAUTION 只有 boolean / nullish 的 value 才是「勾选状态」（≡ DOM.setAttribute 的 checkbox 分支）。
            //  string / number 是 checkbox 的表单提交值（<input type="checkbox" value="red" checked={isRed}/>
            //  是标准的 checkbox 组写法），不参与 checked 的判定。
            let finalChecked = false
            let appliedValue: any = valueSnapshot
            for (const key of deferredKeys) {
                if (key === 'value') {
                    appliedValue = valueSnapshot
                    if (valueSnapshot == null || typeof valueSnapshot === 'boolean') finalChecked = !!valueSnapshot
                } else if (key === 'checked') {
                    finalChecked = !!checkedSnapshot
                }
            }
            const applied = appliedValue == null ? '' : appliedValue
            s += ` value="${escapeAttr(String(applied))}"`
            if (finalChecked) s += ` checked="true"`
        } else if ((isCheckbox || isRadio) && hasChecked && !hasValue) {
            // CK-only
            if (checkedSnapshot) s += ` checked="true"`
        } else {
            // IV (+ radio checked as separate)
            for (const key of deferredKeys) {
                const value = key === 'value' ? valueSnapshot : checkedSnapshot
                if (key === 'value') {
                    const applied = value == null ? '' : value
                    s += ` value="${escapeAttr(String(applied))}"`
                } else if (key === 'checked') {
                    if (value) s += ` checked="true"`
                }
            }
        }
    }

    if (optionSelectedBySo === true) s += ` selected="true"`

    return s
}


// ─── children / host serialization ───

function serializeChildren(
    children: any[],
    out: string[],
    parentTag?: string,
    selectSo: SelectSoCtx | null = null,
    parentElementPath: number[] = [],
): void {
    // Keep original indices (incl. null holes) so style elementPath matches CSR createElement paths.
    const isSingleEmptyString = children.length === 1 && children[0] === ''
    if (isSingleEmptyString) {
        // ElementChildText single empty fast path — emit nothing (EE0)
        return
    }

    const mode = parentTextMode(parentTag)
    if (mode === 'rcdata' || mode === 'rawtext') {
        // Flatten to a single text payload; no axii:* markers
        let text = ''
        for (const child of children) {
            if (child == null) continue
            if (isAtom(child)) text += stringValue(child())
            else if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') text += String(child)
            else if (typeof child === 'boolean') continue
            else throw new Error(`[axii/ssr] unsupported child in <${parentTag}>`)
        }
        emitParentText(text, out, parentTag)
        return
    }

    const nonNullCount = children.reduce((n, c) => n + (c != null ? 1 : 0), 0)
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child == null) continue
        if (isSsrElement(child) && child.type !== Fragment) {
            serializeSsrElement(child, out, selectSo, parentElementPath.concat(i))
        } else {
            serializeChild(child, out, parentTag, nonNullCount === 1, selectSo, parentElementPath.concat(i))
        }
    }
}

function serializeStructureResult(
    result: any,
    out: string[],
    selectSo: SelectSoCtx | null = null,
): void {
    if (isAtom(result)) {
        // AtomHost Comment-ph content before computed — not adjacent to other text (A2 optional)
        const text = stringValue(result())
        if (text.length) out.push(escapeText(text))
        return
    }
    if (isSsrElement(result) && result.type === Fragment) {
        out.push('<!--fragment start-->')
        serializeChildren(result.children, out, undefined, selectSo)
        return
    }
    if (isComponentNode(result)) {
        serializeComponent(result, out, selectSo)
        return
    }
    if (Array.isArray(result)) {
        serializeStaticArray(result, out, undefined, null, selectSo)
        return
    }
    // result cannot be null/undefined here — serializeFunctionHost only calls this on
    // the non-text-snapshot path (isFunctionHostTextSnapshot(null|undefined) === true).
    serializeChild(result, out, undefined, true, selectSo)
}

/** FunctionHost: Text-ph (FTS/H1) or Comment-ph (FCS/H3) */
function serializeFunctionHost(
    fn: Function,
    out: string[],
    placeholderKind: 'text' | 'comment',
    selectSo: SelectSoCtx | null = null,
    /**
     * FunctionHost.position.elementPath when created as element/array child.
     * Becomes inner StaticHost.pathContext.elementPath after structure materialization.
     * Omit for top-level Comment-ph (no position / no owner StaticHost push).
     */
    positionEp?: number[],
    /** When false, FunctionHost has no position.owner — only push FunctionHost itself. */
    hasOwner: boolean = positionEp !== undefined,
): void {
    const state = ssrStyle
    const ownerEp = state?.staticHostEp ?? []
    // FunctionHost.pathContext.elementPath ≡ base context ep (owner StaticHost / StaticArrayHost ep)
    const fnEp = ownerEp
    if (state) {
        if (hasOwner) state.pathHostEps.push(ownerEp)
        state.pathHostEps.push(fnEp)
        state.functionHostDepth++
    }
    const savedStaticHostEp = state?.staticHostEp
    if (state && positionEp) state.staticHostEp = positionEp
    try {
        const result = fn.length === 0 ? (fn as () => any)() : (fn as (ctx: any) => any)({})
        if (isFunctionHostTextSnapshot(result)) {
            if (placeholderKind === 'text') {
                emitTextPh(stringValue(result), out)
            } else {
                // Comment-ph text: empty → nothing; non-empty → text (placeholder Comment by caller)
                const text = stringValue(result)
                if (text.length) emitNonEmptyText(text, out)
            }
            return
        }
        // Structure: FTS or FCS
        serializeStructureResult(result, out, selectSo)
        out.push('<!--computed node-->')
        if (placeholderKind === 'text') {
            out.push('<!--axii:0-->')
        }
    } finally {
        if (state) {
            if (savedStaticHostEp !== undefined) state.staticHostEp = savedStaticHostEp
            state.functionHostDepth--
            state.pathHostEps.pop()
            if (hasOwner) state.pathHostEps.pop()
        }
    }
}

function serializeStaticArrayItemContent(
    item: any,
    out: string[],
    parentTag: string | undefined,
    selectSo: SelectSoCtx | null,
): void {
    const itemType = typeof item
    if (itemType === 'string' || itemType === 'number' || itemType === 'bigint') {
        const text = item.toString()
        if (text === '') out.push('<!--axii:0-->')
        else emitNonEmptyText(text, out)
        return
    }
    if (itemType === 'boolean') {
        // PrimitiveHost Comment-ph: boolean → empty text (content omitted)
        return
    }
    if (item instanceof Object && itemType === 'object' && (item as any).nodeType === 3) {
        const text = (item as any).nodeValue ?? ''
        if (text === '') out.push('<!--axii:0-->')
        else emitNonEmptyText(text, out)
        return
    }
    if (isAtom(item)) {
        emitTextPh(stringValue(item()), out)
        return
    }
    if (itemType === 'function') {
        // StaticArray function item: position.elementPath = StaticArrayHost.pathContext.elementPath
        // childPathContext adds owner (StaticArrayHost) + FunctionHost — do not pre-push array host.
        const arrayEp = ssrStyle?.staticHostEp ?? []
        serializeFunctionHost(item, out, 'comment', selectSo, arrayEp, true)
        return
    }
    if (item == null) {
        out.push('<!--empty-->')
        return
    }

    // Non-function host items: CSR createHost adds StaticArrayHost to hostPath
    const state = ssrStyle
    if (state) state.pathHostEps.push(state.staticHostEp)
    try {
        if (Array.isArray(item)) {
            // Nested StaticArrayHost: recursive content; its own placeholder is caller's array item
            serializeStaticArray(item, out, parentTag, null, selectSo)
            return
        }
        if (item instanceof RxList) {
            serializeRxListRows(item, out, selectSo, {kind: 'hostRoot'})
            return
        }
        if (isComponentNode(item)) {
            serializeComponent(item, out, selectSo)
            return
        }
        if (isSsrReusable(item)) {
            serializeReusable(item, out, selectSo)
            return
        }
        if (isSsrElement(item)) {
            if (item.type === Fragment) {
                // StaticArray Fragment item → StaticHost(DocumentFragment): emit fragment start
                out.push('<!--fragment start-->')
                serializeChildren(item.children, out, undefined, selectSo)
                return
            }
            serializeSsrElement(item, out, selectSo)
            return
        }
        throw new Error(`[axii/ssr] unsupported StaticArray item type: ${Object.prototype.toString.call(item)}`)
    } finally {
        if (state) state.pathHostEps.pop()
    }
}

function serializeStaticArray(
    items: any[],
    out: string[],
    parentTag?: string,
    /** Element-child arrays emit `unhandledChild`; G3-A / nested array share outer placeholder (null) */
    tailComment: string | null = 'unhandledChild',
    selectSo: SelectSoCtx | null = null,
): void {
    for (const item of items) {
        const itemType = typeof item
        // DirectNodes: no per-item <!--array item-->
        const isDirectNode =
            itemType === 'string' || itemType === 'number' || itemType === 'bigint'
            || (item instanceof Object && itemType === 'object' && (item as any).nodeType === 3)
        serializeStaticArrayItemContent(item, out, parentTag, selectSo)
        if (!isDirectNode) out.push('<!--array item-->')
    }
    if (tailComment) out.push(`<!--${tailComment}-->`)
}

function serializeChild(
    child: any,
    out: string[],
    parentTag?: string,
    soleChild = false,
    selectSo: SelectSoCtx | null = null,
    /** Child index path within current StaticHost (for FunctionHost/RxList position). */
    childPath?: number[],
): void {
    if (child == null) return

    if (isAtom(child)) {
        const mode = parentTextMode(parentTag)
        if (mode !== 'normal') {
            emitParentText(stringValue(child()), out, parentTag)
            return
        }
        emitTextPh(stringValue(child()), out)
        return
    }

    const t = typeof child
    if (t === 'string' || t === 'number' || t === 'bigint') {
        const text = child.toString()
        if (parentTextMode(parentTag) !== 'normal') {
            emitParentText(text, out, parentTag)
            return
        }
        if (soleChild && text === '') return
        if (text === '') {
            emitElementChildText('', out)
        } else {
            emitElementChildText(text, out)
        }
        return
    }
    if (t === 'boolean') {
        // createElement skips only null/undefined; boolean → PrimitiveHost Comment-ph (empty text).
        // HTML omits empty Text; emit structure Comment only (hydrate inserts Text before it).
        out.push('<!--unhandledChild-->')
        return
    }

    if (isSsrElement(child)) {
        serializeSsrElement(child, out, selectSo)
        return
    }

    if (isComponentNode(child)) {
        serializeComponent(child, out, selectSo)
        // Element-child ComponentNode → ComponentHost placeholder is <!--unhandledChild-->
        out.push('<!--unhandledChild-->')
        return
    }

    if (t === 'function') {
        // Element-position function child → Text-ph (H1/H2 FTS); position.ep = childPath
        serializeFunctionHost(child, out, 'text', selectSo, childPath ?? ssrStyle?.staticHostEp ?? [], true)
        return
    }

    if (Array.isArray(child)) {
        serializeStaticArray(child, out, parentTag, 'unhandledChild', selectSo)
        return
    }

    if (child instanceof RxList) {
        // Element-child RxList: hostPath includes parent StaticHost + RxListHost(ep=childPath)
        serializeRxListRows(child, out, selectSo, {
            kind: 'elementChild',
            childPath: childPath ?? [],
        })
        out.push('<!--unhandledChild-->')
        return
    }

    if (isSsrReusable(child)) {
        serializeReusable(child, out, selectSo)
        out.push('<!--unhandledChild-->')
        return
    }

    throw new Error(`[axii/ssr] unsupported child type: ${Object.prototype.toString.call(child)}`)
}

/**
 * §3.2.3 — serialize one RxList row (Compact / G2 / G3-* / G4 / G4-F).
 * Does not emit the list Host placeholder (`unhandledChild` / outer row ph).
 */
function serializeRxListRow(item: any, out: string[], selectSo: SelectSoCtx | null): void {
    // G1 / G2: single-element row (SSR descriptor ≡ createElement element)
    if (isSsrElement(item) && typeof item.type === 'string') {
        serializeSsrElement(item, out, selectSo)
        if (item.props?.detachStyle) {
            out.push('<!--rx list item-->') // G2
        }
        // G1 Compact: no row-level comment
        return
    }

    // G3-Fr: Fragment row
    if (isSsrElement(item) && item.type === Fragment) {
        out.push('<!--fragment start-->')
        serializeChildren(item.children, out, undefined, selectSo)
        out.push('<!--rx list item-->')
        return
    }

    if (typeof item === 'function') {
        if (isAtom(item)) {
            // G4 Comment-ph
            const text = stringValue(item())
            if (text.length) emitNonEmptyText(text, out)
            out.push('<!--rx list item-->')
            return
        }
        // G3-F / G4-F: RxList createHost(fn) passes no position → FunctionHost without owner
        serializeFunctionHost(item, out, 'comment', selectSo, undefined, false)
        out.push('<!--rx list item-->')
        return
    }

    const t = typeof item
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
        // G4′ PrimitiveHost Comment-ph
        const text = t === 'boolean' ? '' : item.toString()
        if (text.length) emitNonEmptyText(text, out)
        out.push('<!--rx list item-->')
        return
    }

    if (Array.isArray(item)) {
        // G3-A: array content + row placeholder (StaticArrayHost.placeholder === rx list item)
        serializeStaticArray(item, out, undefined, null, selectSo)
        out.push('<!--rx list item-->')
        return
    }

    if (item === undefined || item === null) {
        // G3-E EmptyHost
        out.push('<!--empty-->')
        out.push('<!--rx list item-->')
        return
    }

    if (item instanceof RxList) {
        // G3-RL: inner rows + outer row placeholder
        serializeRxListRows(item, out, selectSo)
        out.push('<!--rx list item-->')
        return
    }

    if (isSsrReusable(item)) {
        // G3-RU
        serializeReusable(item, out, selectSo)
        out.push('<!--rx list item-->')
        return
    }

    if (isComponentNode(item)) {
        // G3-C
        serializeComponent(item, out, selectSo)
        out.push('<!--rx list item-->')
        return
    }

    throw new Error(`[axii/ssr] unsupported RxList row type: ${Object.prototype.toString.call(item)}`)
}

function serializeRxListRows(
    list: RxList<any>,
    out: string[],
    selectSo: SelectSoCtx | null,
    pathMode: {kind: 'elementChild', childPath: number[]} | {kind: 'hostRoot'} = {kind: 'hostRoot'},
): void {
    const state = ssrStyle
    if (state) {
        if (pathMode.kind === 'elementChild') {
            // CSR: createHost for non-fn child adds StaticHost; RxListHost.ep = childPath
            state.pathHostEps.push(state.staticHostEp)
            state.pathHostEps.push(pathMode.childPath)
        } else {
            // Component/structure root RxListHost: only itself (ep = current staticHostEp)
            state.pathHostEps.push(state.staticHostEp)
        }
    }
    const savedEp = state?.staticHostEp
    if (state) {
        state.staticHostEp = pathMode.kind === 'elementChild' ? pathMode.childPath : state.staticHostEp
    }
    try {
        const data = list.data
        for (let i = 0; i < data.length; i++) {
            serializeRxListRow(data[i], out, selectSo)
        }
    } finally {
        if (state) {
            if (savedEp !== undefined) state.staticHostEp = savedEp
            state.pathHostEps.pop()
            if (pathMode.kind === 'elementChild') state.pathHostEps.pop()
        }
    }
}

function serializeReusable(node: SsrReusable, out: string[], selectSo: SelectSoCtx | null): void {
    // Content + <!--reusable--> (innerPlaceholder); caller adds outer host placeholder
    serialize(node.source, out, selectSo)
    // serialize() of element does not add trailing structure comment; reusable marker is innerPlaceholder
    out.push('<!--reusable-->')
}

function serializeSsrElement(
    el: SsrElement,
    out: string[],
    /** Inherited from ancestor <select> for SO (also through <optgroup>). */
    selectSo: SelectSoCtx | null = null,
    /** Path from nearest Component StaticHost root (matches unhandledAttr path). */
    elementPath: number[] = [],
): void {
    if (el.type === Fragment) {
        // Element-child Fragment: flatten (no fragment start) — CSR appends DocumentFragment
        serializeChildren(el.children, out, undefined, selectSo, elementPath)
        return
    }
    const tag = el.type as string
    assertTagName(tag)
    const tagLower = tag.toLowerCase()
    const outerContext = insertionContext
    const elementIsForeign = isForeignInsertion(outerContext, tagLower)
    // CAUTION HTML 内容里的 <plaintext> 把 tokenizer 永久切到 PLAINTEXT：它自己的结束标签和之后整页的
    //  标记都变成文本（<!--root-->、后面的兄弟、页面其余部分），没有任何写法能关上它。
    //  与 RAWTEXT 终止序列同一策略（§3.6.1）：无法安全序列化时抛错。外来内容里它只是普通元素。
    if (tagLower === 'plaintext' && !elementIsForeign) {
        throw new Error('[axii/ssr] <plaintext> cannot be serialized: the parser would treat the rest of the page as text')
    }

    let optionSelectedBySo: boolean | null = null
    if (tagLower === 'option' && selectSo) {
        optionSelectedBySo = optionMatchesSo(optionEffectiveValue(el), selectSo)
    }

    // ≡ DOM.createElement：显式 _isSVG（createSVGElement）优先，否则按 svg 专有标签名兜底
    const isSVG = el.props?._isSVG ?? svgOnlyElementNames.has(tag)
    const attrs = serializeAttrs(el.props, tag, optionSelectedBySo, elementPath, isSVG)
    // CAUTION CSR 的契约是 node.innerHTML = value ?? ''（DOM.setAttribute）：value 是字符串，
    //  或求值得到字符串的函数 / atom；只要这个 key 出现，children 就被 innerHTML 覆盖（含 nullish = 清空）。
    //  这里曾经只认 React 形状的 {__html}（CSR 下它渲染成字面 "[object Object]"），
    //  真正的 CSR 写法在服务端输出为空。{__html} 的透传保持不变。
    const hasDangerously = !!el.props && hasOwnProp(el.props, 'dangerouslySetInnerHTML')
    const dangerously = hasDangerously ? snapshotAttrValue(el.props!.dangerouslySetInnerHTML) : undefined

    if (VOID_TAGS.has(tagLower)) {
        out.push('<', tag, attrs, '/>')
        return
    }

    out.push('<', tag, attrs, '>')
    const contentStart = out.length
    const outerParentIsForeign = parentIsForeignElement
    insertionContext = childContextOf(outerContext, tagLower, el.props)
    parentIsForeignElement = elementIsForeign
    try {
        serializeElementContent(el, tag, tagLower, out, selectSo, elementPath, hasDangerously, dangerously)
    } finally {
        insertionContext = outerContext
        parentIsForeignElement = outerParentIsForeign
    }
    // 外来内容里的 textarea 是普通的外来元素，解析器不吞开始标签后的换行
    if (LEADING_NEWLINE_TAGS.has(tagLower) && !(elementIsForeign && tagLower === 'textarea')) {
        for (let i = contentStart; i < out.length; i++) {
            if (out[i] === '') continue
            if (out[i][0] === '\n') out.splice(i, 0, '\n')
            break
        }
    }
    out.push('</', tag, '>')
}

function serializeElementContent(
    el: SsrElement,
    tag: string,
    tagLower: string,
    out: string[],
    selectSo: SelectSoCtx | null,
    elementPath: number[],
    hasDangerously: boolean,
    dangerously: any,
): void {
    if (dangerously && typeof dangerously === 'object' && '__html' in dangerously) {
        out.push(String((dangerously as {__html: string}).__html))
    } else if (hasDangerously) {
        out.push(dangerously == null ? '' : String(dangerously))
    } else if (tagLower === 'textarea' && !!el.props && hasOwnProp(el.props, 'value')) {
        // TA 通道（§3.6.2）：value 写成子文本。没有 value prop 的 textarea 走下面的通用 children 路径，
        //  与 title 一样按 RCDATA 首尾相接——曾经只认「恰好一个 child」，
        //  <textarea>Hello {name}</textarea> 这类两个文本单元的写法静默输出为空。
        out.push(escapeText(stringValue(snapshotAttrValue(el.props.value))))
    } else {
        const children = el.children.length
            ? el.children
            : (el.props?.children ? (Array.isArray(el.props.children) ? el.props.children : [el.props.children]) : [])
        // SO: this select's value drives descendant options; nested select starts its own ctx
        const childSo = tagLower === 'select'
            ? extractSelectSo(el.props)
            : (tagLower === 'optgroup' || tagLower === 'option' ? selectSo : null)

        // §3.2: table must emit parsed-stable structure (explicit tbody for bare tr / list rows)
        if (tagLower === 'table' && tableNeedsTbodyWrap(children)) {
            out.push('<tbody>')
            serializeChildren(children, out, 'tbody', childSo, elementPath)
            out.push('</tbody>')
        } else {
            serializeChildren(children, out, tag, childSo, elementPath)
        }
    }
}

/** True when table children would rely on browser-implied tbody (bare tr / dynamic rows). */
function tableNeedsTbodyWrap(children: any[]): boolean {
    for (const c of children) {
        if (isSsrElement(c) && typeof c.type === 'string') {
            const t = c.type.toLowerCase()
            if (t === 'tbody' || t === 'thead' || t === 'tfoot' || t === 'caption' || t === 'colgroup') {
                return false
            }
        }
    }
    for (const c of children) {
        if (isSsrElement(c) && typeof c.type === 'string' && c.type.toLowerCase() === 'tr') return true
        if (c instanceof RxList) return true
        if (typeof c === 'function' && !isAtom(c)) return true
        if (Array.isArray(c)) return true
    }
    return false
}

function createSsrElement(type: any, rawProps: AttributesLike | null, ...rawChildren: any[]): any {
    if (typeof type !== 'string' && type !== Fragment) {
        const children: any[] = rawChildren.length ? rawChildren : (rawProps?.children || [])
        let props = rawProps || {}
        if (rawProps && ('__source' in rawProps || '__self' in rawProps)) {
            props = {...rawProps}
            delete props.__source
            delete props.__self
        }
        return {type, props, children} as ComponentNode
    }
    const children: any[] = rawChildren.length ? rawChildren : []
    return {
        [SSR_ELEMENT]: true,
        type,
        props: rawProps,
        children,
    } as SsrElement
}

/** Stack of context maps for SSR ContextProvider / createContext */
const contextStack: Map<any, any>[] = []

// CAUTION 组件里的 createElement 在服务端必须走和 CSR 相同的 as / AOP 流水线
//  （≡ ComponentHost.createHTMLOrSVGElement，props 调整的三步直接调用它的 applyItemPropsConfig）：
//  as="name" 不是 attribute（写出的是 data-as），$name:prop / $name:_use / $name:_children 等外部配置
//  要应用到命名元素上，prop: / $self: 前缀要拆出去。曾经这里就是裸的 createSsrElement——
//  `as`、`prop:x`、`$self:className` 原样变成 HTML 属性，所有 AOP 覆盖在服务端输出里缺席。
//  只属于客户端的部分不做：ref 收集、事件参数绑定、_eventTarget 转发（§3.4 事件仅客户端）。
function createSsrComponentElement(
    host: ComponentHost,
    isSVG: boolean,
    type: any,
    rawProps: AttributesLike | null,
    ...children: any[]
): any {
    const isComponent = typeof type === 'function'
    const name = rawProps ? rawProps['as'] : undefined

    if (!name && !isComponent && (!rawProps || !ComponentHost.hasPrefixedProps(rawProps))) {
        return createSsrElement(type, isSVG ? {...rawProps, _isSVG: true} : rawProps, ...children)
    }

    if (name !== undefined) delete rawProps!['as']
    if (name === 'self') throw new Error('"self" is reserved, please use another element name.')

    const thisItemConfig = name ? host.itemConfig[name] : undefined
    // _use 传入现成节点覆写整个元素：CSR 认 Element，这里对应一个已经建好的元素描述
    if (thisItemConfig?.use && isSsrElement(thisItemConfig.use)) return thisItemConfig.use

    let {props: finalProps, componentProps} = host.separateProps(rawProps as AttributesLike)
    let finalChildren = children
    if (thisItemConfig) {
        finalProps = host.applyItemPropsConfig(thisItemConfig, isComponent, finalProps, componentProps)
        if (thisItemConfig.children) {
            finalChildren = Array.isArray(thisItemConfig.children) ? thisItemConfig.children : [thisItemConfig.children]
        }
    }

    const finalType = thisItemConfig?.use || type
    // 用 Component 覆写了普通元素：组件的 props 是 prop:xxx 标记的那部分
    if (typeof finalType === 'function' && !isComponent) {
        componentProps[N_ATTR] = finalProps
        finalProps = componentProps
    }
    if (typeof finalType === 'function' && thisItemConfig?.configProps?.length) {
        Object.assign(finalProps, {[INNER_CONFIG_PROP]: thisItemConfig.configProps})
    }
    if (name) finalProps['data-as'] = name

    return createSsrElement(finalType, isSVG ? {...finalProps, _isSVG: true} : finalProps, ...finalChildren)
}

// 服务端的 ComponentHost 只借用它的 props / AOP 计算，不参与任何 Host 路径
const SSR_COMPONENT_PATH_CONTEXT = {hostPath: null, elementPath: []} as unknown as PathContext

function createSsrRenderContext(host: ComponentHost): RenderContext {
    const refs: {[k: string]: any} = {}
    const context: RenderContext = {
        createElement: ((type: any, props: any, ...children: any[]) =>
            createSsrComponentElement(host, false, type, props, ...children)) as any,
        createSVGElement: ((type: string, props: any, ...children: any[]) =>
            createSsrComponentElement(host, true, type, props, ...children)) as any,
        Fragment,
        useLayoutEffect() {},
        useEffect() {},
        onCleanup() {},
        refs,
        context: {
            get(contextType: any) {
                for (let i = contextStack.length - 1; i >= 0; i--) {
                    if (contextStack[i].has(contextType)) return contextStack[i].get(contextType)
                }
                return undefined
            },
            set(contextType: any, value: any) {
                const top = contextStack[contextStack.length - 1]
                if (!top) throw new Error('[axii/ssr] context.set outside component')
                top.set(contextType, value)
            },
        } as any,
        createRef: () => ({current: null}),
        createRxRef: () => ({current: null}),
        createPortal: ((content: any, container: any) => ({
            type: Portal,
            props: {content, container},
            children: [],
        })) as any,
        createStateFromRef: () => {
            // §3.4: no layout subscription on server — return inert atom-like stub
            const stub: any = () => null
            stub.ref = () => {}
            return stub
        },
        expose: (v: any) => v,
        reusable: (v: any) => ({[SSR_REUSABLE]: true, source: v} as SsrReusable),
    } as any
    return context
}

function invokeComponent(node: ComponentNode): any {
    const map = new Map()
    contextStack.push(map)
    try {
        // CAUTION 最终 props 由 ComponentHost.prepareProps 计算（propTypes 默认值 / coerce、
        //  boundProps / postBoundProps、AOP 配置），与 CSR 是同一个方法，见那里的说明。
        const host = new ComponentHost(node, null as any, SSR_COMPONENT_PATH_CONTEXT)
        const ctx = createSsrRenderContext(host)
        host.renderContext = ctx
        return (node.type as Component)(host.prepareProps(), ctx)
    } finally {
        // Keep map on stack until serializeComponent finishes — caller pops
    }
}

function serializePortal(
    node: ComponentNode,
    out: string[],
): void {
    if (!ssrPortals || !ssrStyle) throw new Error('[axii/ssr] portals map not initialized')
    const props = node.props || {}
    const key = resolvePortalExportKey(props.container, props.portalKey)
    if (Object.prototype.hasOwnProperty.call(ssrPortals, key)) {
        throw new Error(`[axii/ssr] duplicate Portal key: ${JSON.stringify(key)}`)
    }
    // Reserve the key before descending so a nested Portal cannot replace its parent.
    const payload = {html: '', styles: ''}
    Object.defineProperty(ssrPortals, key, {
        value: payload,
        enumerable: true,
        writable: true,
        configurable: true,
    })

    // Main tree: EmptyHost element only; parent serializeChild adds <!--unhandledChild--> (§3.2.6 / §3.3.d)
    out.push('<!--empty-->')

    // Portal content under Portal ComponentHost path (style ids align with CSR createRoot(parentContext)).
    // Root Fragment ≡ CSR StaticHost(DocumentFragment): emit <!--fragment start--> (not element-child flatten).
    const state = ssrStyle
    const parentSheets = state.sheets
    const portalSheets = new Map<string, SsrStyleSheet>()
    state.sheets = portalSheets
    pushSsrComponent(node.type as Function)
    const portalOut: string[] = []
    // Portal 内容进入独立的容器（HTML 元素），与主树里 Portal 所在位置的 svg / math 祖先无关
    const outerContext = insertionContext
    const outerParentIsForeign = parentIsForeignElement
    insertionContext = 'html'
    parentIsForeignElement = false
    try {
        const content = props.content
        if (isSsrElement(content) && content.type === Fragment) {
            portalOut.push('<!--fragment start-->')
            serializeChildren(content.children, portalOut, undefined, null, [])
        } else {
            serialize(content, portalOut)
        }
        portalOut.push('<!--root-->')
    } finally {
        insertionContext = outerContext
        parentIsForeignElement = outerParentIsForeign
        popSsrComponent()
        state.sheets = parentSheets
    }

    payload.html = portalOut.join('')
    payload.styles = serializeStyleSheets(portalSheets)
}

function serializeComponent(
    node: ComponentNode,
    out: string[],
    selectSo: SelectSoCtx | null = null,
): void {
    if (isAxiiPortalComponent(node.type)) {
        serializePortal(node, out)
        return
    }
    const depthBefore = contextStack.length
    pushSsrComponent(node.type as Function)
    const result = invokeComponent(node)
    try {
        if (result === undefined || result === null) {
            out.push('<!--empty-->')
            return
        }
        if (isSsrElement(result) && result.type === Fragment) {
            out.push('<!--fragment start-->')
            serializeChildren(result.children, out, undefined, selectSo, [])
            return
        }
        // Component root element: elementPath [] (StaticHost root)
        if (isSsrElement(result) && typeof result.type === 'string') {
            serializeSsrElement(result, out, selectSo, [])
            return
        }
        serialize(result, out, selectSo)
    } finally {
        popSsrComponent()
        while (contextStack.length > depthBefore) contextStack.pop()
    }
}

function serialize(source: any, out: string[], selectSo: SelectSoCtx | null = null): void {
    if (source === undefined || source === null) {
        out.push('<!--empty-->')
        return
    }
    if (isAtom(source)) {
        // Top-level atom: Comment-ph (placeholder=root)
        const text = stringValue(source())
        if (text.length) emitNonEmptyText(text, out)
        return
    }
    if (isComponentNode(source)) {
        serializeComponent(source, out, selectSo)
        return
    }
    if (isSsrElement(source)) {
        serializeSsrElement(source, out, selectSo)
        return
    }
    if (typeof source === 'function') {
        // Top-level function → FunctionHost with Comment placeholder `root` (FCS / H3)
        serializeFunctionHost(source, out, 'comment', selectSo)
        return
    }
    const t = typeof source
    if (t === 'string' || t === 'number' || t === 'bigint') {
        const text = source.toString()
        if (text.length) emitNonEmptyText(text, out)
        return
    }
    if (t === 'boolean') {
        return
    }
    if (Array.isArray(source)) {
        serializeStaticArray(source, out, undefined, null, selectSo)
        return
    }
    if (source instanceof RxList) {
        serializeRxListRows(source, out, selectSo)
        return
    }
    if (isSsrReusable(source)) {
        serializeReusable(source, out, selectSo)
        return
    }
    throw new Error(`[axii/ssr] unsupported render source: ${Object.prototype.toString.call(source)}`)
}

/**
 * Synchronously render a component tree to an HTML string in a DOM-free environment.
 */
export function renderToString(
    source: any,
    _options?: Record<string, never>,
): RenderToStringResult {
    const out: string[] = []
    contextStack.length = 0
    const portals: Record<string, {html: string, styles: string}> = {}
    ssrPortals = portals
    insertionContext = 'html'
    parentIsForeignElement = false
    beginSsrStyles()
    beginSsrPass()
    try {
        serialize(source, out)
        out.push('<!--root-->')
        const styles = endSsrStyles()
        return {
            html: out.join(''),
            styles,
            portals,
        }
    } catch (e) {
        ssrStyle = null
        throw e
    } finally {
        endSsrPass()
        ssrPortals = null
    }
}

// Re-export SSR createElement for Node tests that cannot use DOM createElement for host tags.
export {createSsrElement as createElement}
