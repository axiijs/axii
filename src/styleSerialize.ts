/**
 * DOM-free style serialization helpers shared by StyleManager (CSR) and axii/ssr.
 * No document / CSSStyleSheet access — safe for Node.
 */

import {isPlainObject} from './util'

export type StyleObject = {[k: string]: any}

/** Shared Component type → stylesheet id registry (must match CSR ComponentHost). */
export const componentTypeIds = new WeakMap<Function, number>()
let nextComponentTypeId = 0

export function getComponentTypeId(type: Function): number {
    let id = componentTypeIds.get(type)
    if (id === undefined) {
        id = nextComponentTypeId++
        componentTypeIds.set(type, id)
    }
    return id
}

const CSS_UNSAFE_IDENT_CHARS = /[^a-zA-Z0-9_\u00A0-\uFFFF-]/g

export function toCssSafeComponentName(name: string) {
    const safe = name.replace(CSS_UNSAFE_IDENT_CHARS, '_')
    return /^[a-zA-Z_\u00A0-\uFFFF]/.test(safe) ? safe : `C${safe}`
}

/**
 * Build static stylesheet class base id (matches StaticHost.generateComponentElementStaticId).
 * `pathHosts` are hosts between the ComponentHost and the style owner (elementPath hosts),
 * each contributing their `elementPath` segments; `elementPath` is the attr path inside the StaticHost.
 */
export function generateStyleStaticId(
    componentName: string,
    typeId: number | string | undefined,
    pathHostElementPaths: number[][],
    elementPath: number[],
): string {
    const name = toCssSafeComponentName(componentName || 'GLOBAL')
    const pathPart = pathHostElementPaths
        .map(p => p.join('_'))
        .concat(elementPath.join('_'))
        .join('-')
    return `${name}${typeId ?? ''}P${pathPart}`
}

// F30：静态样式对象 → 内容签名。boundProps 等跨实例共享引用直接命中；
//  JSX 字面量随元素同生共死，WeakMap 不延长其生命周期。
//  key 顺序不同的等价对象会得到不同签名——代价只是退化为元素独享 stylesheet。
const styleSignatureCache = new WeakMap<object, string>()
export function computeStyleSignature(styleObject: any): string | undefined {
    if (typeof styleObject !== 'object' || styleObject === null) return undefined
    const cached = styleSignatureCache.get(styleObject)
    if (cached !== undefined) return cached
    let signature: string | undefined
    try {
        signature = JSON.stringify(styleObject)
        /* v8 ignore next 3 */
    } catch {
        signature = undefined
    }
    if (signature !== undefined) styleSignatureCache.set(styleObject, signature)
    return signature
}

// ─── content-addressed stylesheet ids ───
//
// Entries that cannot share a path-based id (function styles, bound styles, static nested
// styles under a function child, F30-diverged static entries) are keyed by their evaluated
// content instead: same content ⇒ same class ⇒ one shared stylesheet. CSR (StyleManager) and
// SSR (collectElementStyles) both call contentStyleId, so the ids match and hydrate just reuses
// the SSR class.

// CAUTION 用 JSON 序列化求值后的样式对象，不用 computeStyleSignature 的按对象身份缓存：
//  - 样式里可以有 atom/函数值（F31），JSON.stringify 会把函数值整个丢掉，
//    两个不同 atom 值会算出同一个签名、共用同一张表（静默用错样式）。replacer 把函数值
//    解开成当前值；这与 generateStyleContent → stringifyCssValue 对函数值的读法相同，
//    读 atom 发生在 update 的追踪上下文里，依赖照常建立。
//  - 动态条目每次重算都可能返回同一个被原地改过的对象，按身份缓存会拿到旧签名。
//  序列化失败（循环引用、BigInt 等）返回 undefined，调用方退回逐元素路径。
function resolveReactiveStyleValue(_key: string, value: any) {
    return typeof value === 'function' ? value() : value
}

export function serializeStyleContent(styleObject: any): string | undefined {
    try {
        return JSON.stringify(styleObject, resolveReactiveStyleValue)
    } catch {
        return undefined
    }
}

// cyrb53：53 位、Node 与浏览器结果相同。32 位哈希在几千种内容时碰撞概率已到千分之几，
//  碰撞的后果是两种内容共用一张表（静默用错样式），所以用 53 位。
export function hashStyleContent(str: string): string {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const CONTENT_STYLE_ID_PREFIX = 'axs-'

/** `axs-<hash>F<entryIndex>`, or undefined when the content cannot be serialized. */
export function contentStyleId(styleObject: any, entryIndex: number): string | undefined {
    const serialized = serializeStyleContent(styleObject)
    if (serialized === undefined) return undefined
    return `${CONTENT_STYLE_ID_PREFIX}${hashStyleContent(serialized)}F${entryIndex}`
}

// CAUTION 判定只此一份：markBoundProp / markDynamicProp（StaticHost）写的不可枚举标记。
//  必须对 null/undefined 安全，条件样式 style={cond ? {...} : null} 是很自然的写法。
export function isBoundProp(obj: any) {
    return !!(obj && obj['__bound'])
}

export function isDynamicProp(obj: any) {
    return !!(obj && obj['__dynamic'])
}

export type EvaluatedStyleEntry = {value: any, entryIsDynamic: boolean, isBound: boolean}

/**
 * Evaluate + flatten a `style` value into entries. The entry's position in the returned
 * array is its entry index (`F<n>` in class ids, cascade group in adoptedStyleSheets).
 * Shared by StyleManager (CSR) and SSR so both number entries identically.
 */
export function evaluateStyleEntries(styleValue: any): EvaluatedStyleEntry[] {
    // CAUTION 先求值再展开：响应式 style 函数可以返回数组（() => [base, extra] 是自然写法）。
    //  不展开的话数组会被 splitStyleObject 当成 {0: {...}, 1: {...}} 的嵌套样式，
    //  生成 `.cls 0 {...}` 这类非法 selector，整个样式静默失效。
    const rawStyleObjects = Array.isArray(styleValue) ? styleValue : [styleValue]
    const entries: EvaluatedStyleEntry[] = []
    for (const raw of rawStyleObjects) {
        const isBound = isBoundProp(raw)
        const entryIsDynamic = typeof raw === 'function' || isDynamicProp(raw)
        const evaluated = typeof raw === 'function' ? raw() : raw
        if (Array.isArray(evaluated)) {
            for (const item of evaluated) {
                // 函数返回的数组项自身也可能是函数/atom
                const evaluatedItem = typeof item === 'function' ? item() : item
                entries.push({value: evaluatedItem, entryIsDynamic: true, isBound: isBound || isBoundProp(item)})
            }
        } else {
            entries.push({value: evaluated, entryIsDynamic, isBound})
        }
    }
    return entries
}

const AUTO_ADD_UNIT_ATTR = /^(width|height|top|left|right|bottom|margin|marginTop|marginRight|marginBottom|marginLeft|padding|paddingTop|paddingRight|paddingBottom|paddingLeft|borderWidth|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|outlineWidth|borderRadius|fontSize|letterSpacing|wordSpacing|textIndent|maxWidth|maxHeight|minHeight|minWidth|gap|flexBasis|columnGap|rowGap|columnWidth)$/
const COMMA_MULTI_VALUE_ATTR = /^(boxShadow|textShadow|transition|animation|backgroundImage)/
const CSS_UNIT_VALUE = /^(px|em|rem|%|vw|vh|vmin|vmax|pt|pc|in|cm|mm|q|ex|ch|ic|cap|lh|rlh|fr|s|ms|deg|rad|grad|turn|dpi|dpcm|dppx|cqw|cqh|cqi|cqb|cqmin|cqmax|svw|svh|lvw|lvh|dvw|dvh)$/i

function autoUnit(num: number | string): string {
    if (typeof num === 'string') return num
    return `${num}px`
}

/** CSS value stringification for stylesheet rules (atom/fn already evaluated by caller). */
export function stringifyCssValue(k: string, v: any): string {
    if (typeof v === 'function') v = v()
    if (v === undefined || v === null || typeof v === 'boolean') return ''
    if (Array.isArray(v)) {
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            const parts: string[] = []
            for (let i of v) {
                if (typeof i === 'function') i = i()
                if (i === undefined || i === null || typeof i === 'boolean' || i === '') continue
                parts.push(String(i))
            }
            return parts.join(',')
        } else if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            return `${v[0]}${v[1]}`
        } else {
            return v.map((i: any) => stringifyCssValue(k, i ?? 0)).join(' ')
        }
    }
    if (v === '') return ''
    if (v && typeof v === 'object' && typeof v.toString === 'function' && !(typeof v === 'number')) {
        // StyleSize etc.
        if (!AUTO_ADD_UNIT_ATTR.test(k)) return v.toString()
    }
    return (typeof v === 'number' && AUTO_ADD_UNIT_ATTR.test(k)) ? autoUnit(v) : String(v)
}

export function stringifyStyleObject(styleObject: StyleObject): string {
    return Object.entries(styleObject).map(([key, value]) => {
        const property = (key[0] === '-' && key[1] === '-')
            ? key
            : key.replace(/([A-Z])/g, '-$1').toLowerCase()
        return `${property}:${stringifyCssValue(key, value)};`
    }).join('\n')
}

export function isNestedStyleObject(key: string, styleObject: any): boolean {
    return key !== '@keyframes' && isPlainObject(styleObject)
}

export function splitStyleObject(styleObject: StyleObject): {simpleStyles: StyleObject, nestedStyles: StyleObject} {
    if (typeof styleObject === 'string') {
        return {simpleStyles: styleObject as any, nestedStyles: {}}
    }
    if (styleObject === null || styleObject === undefined) {
        return {simpleStyles: {}, nestedStyles: {}}
    }
    const simpleStyles: StyleObject = {}
    const nestedStyles: StyleObject = {}
    for (const key in styleObject) {
        if (key === '@keyframes' || key === 'animation' || isNestedStyleObject(key, styleObject[key])) {
            nestedStyles[key] = styleObject[key]
        } else {
            simpleStyles[key] = styleObject[key]
        }
    }
    return {simpleStyles, nestedStyles}
}

function splitSelectorList(input: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote: string | null = null
    let start = 0
    for (let i = 0; i < input.length; i++) {
        const ch = input[i]
        if (quote) {
            if (ch === quote && input[i - 1] !== '\\') quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === '(' || ch === '[') {
            depth++
        } else if (ch === ')' || ch === ']') {
            depth--
        } else if (ch === ',' && depth === 0) {
            parts.push(input.slice(start, i))
            start = i + 1
        }
    }
    parts.push(input.slice(start))
    return parts
}

export function scopeNestedSelector(selector: string, key: string): string {
    return splitSelectorList(key).map(part => {
        const trimmed = part.trim()
        return trimmed.includes('&') ? trimmed.replaceAll('&', selector) : `${selector} ${trimmed}`
    }).join(', ')
}

function stringifyKeyFrameObject(keyframeObject: StyleObject): string {
    return Object.entries(keyframeObject).map(([key, value]) => {
        return `${key} {
                ${stringifyStyleObject(value)}
            }`
    }).join('\n')
}

/**
 * Deterministic animation name from selector + keyframes signature (no Math.random).
 */
export function deterministicAnimationName(selector: string, keyframeObj: StyleObject): string {
    const sig = JSON.stringify(keyframeObj['@keyframes'] ?? null) + String(keyframeObj.animation ?? '')
    let h = 2166136261
    const s = selector + sig
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return `animation-${(h >>> 0).toString(36)}`
}

export function generateInlineAnimationContent(
    selector: string,
    styleObject: StyleObject,
    animationName?: string,
): string[] {
    const animationContent: string[] = []
    const name = animationName ?? deterministicAnimationName(selector, styleObject)
    if (styleObject['@keyframes']) {
        animationContent.push(`@keyframes ${name} {
${stringifyKeyFrameObject(styleObject['@keyframes'])}
}`)
    }
    if (styleObject.animation) {
        const animationValue = (Array.isArray(styleObject.animation)
            ? styleObject.animation.join(', ')
            : styleObject.animation)!.replace(/@self/g, name)
        animationContent.push(`
${selector} {
    animation: ${animationValue};
}
`)
    }
    return animationContent
}

export function generateStyleContent(selector: string, styleObject: StyleObject): string[] {
    const valueStyleObject = {...styleObject}
    const nestedStyleEntries: [string, any][] = []
    const keyframeObj: StyleObject = {}

    for (const key in valueStyleObject) {
        if (key === '@keyframes' || key === 'animation') {
            keyframeObj[key] = valueStyleObject[key]
            delete valueStyleObject[key]
        } else if (isNestedStyleObject(key, valueStyleObject[key])) {
            nestedStyleEntries.push([key, valueStyleObject[key]])
            delete valueStyleObject[key]
        } else if (
            valueStyleObject[key] === null ||
            valueStyleObject[key] === undefined ||
            typeof valueStyleObject[key] === 'boolean'
        ) {
            delete valueStyleObject[key]
        }
    }

    const contents: string[] = [`${selector} {
${stringifyStyleObject(valueStyleObject)}
}`]

    contents.push(...generateInlineAnimationContent(selector, keyframeObj))

    return nestedStyleEntries.reduce((acc, [key, nestedObject]: [string, any]) => {
        if (key.startsWith('@')) {
            return acc.concat(`${key} {
    ${generateStyleContent(selector, nestedObject).join('\n')}
}`)
        }
        return acc.concat(generateStyleContent(scopeNestedSelector(selector, key), nestedObject))
    }, contents)
}

/**
 * §3.6.1 CSS rule escape gate — dual of Chromium `CSSStyleSheet.insertRule` single-rule acceptance.
 * Rejects multi-rule breakout strings; accepts quoted `}` inside a single rule.
 */
export function isAcceptableSingleCssRule(rule: string): boolean {
    const s = rule.trim()
    if (!s) return false
    let depth = 0
    let quote: string | null = null
    let sawOpen = false
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (quote) {
            if (ch === '\\') {
                i++
                continue
            }
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }
        if (ch === '{') {
            depth++
            sawOpen = true
        } else if (ch === '}') {
            depth--
            if (depth < 0) return false
            if (depth === 0) {
                const rest = s.slice(i + 1).trim()
                return sawOpen && rest.length === 0
            }
        }
    }
    return false
}

/** Filter generateStyleContent rules through the escape gate; join survivors with newlines. */
export function gateStyleRules(rules: string[]): string {
    const kept: string[] = []
    for (const r of rules) {
        if (isAcceptableSingleCssRule(r)) kept.push(r)
    }
    return kept.join('\n')
}

/**
 * Deep scan for atom/function values inside a style object (F31).
 * Shared by StyleManager (CSR) and SSR collectElementStyles — must stay identical.
 * Atoms are functions in data0, so `typeof === 'function'` covers them.
 */
export function containsReactiveStyleValue(styleObject: any): boolean {
    if (styleObject == null || typeof styleObject !== 'object') return false
    for (const key in styleObject) {
        const value = styleObject[key]
        if (typeof value === 'function') return true
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'function') return true
            }
        } else if (isPlainObject(value) && containsReactiveStyleValue(value)) {
            return true
        }
    }
    return false
}

/** True when a style value must go through StyleManager stylesheet path (not plain inline). */
export function styleValueNeedsStylesheet(value: any): boolean {
    if (value == null || typeof value === 'boolean') return false
    if (typeof value === 'function') return true
    if (typeof value === 'string') return false
    if (Array.isArray(value)) return value.some(styleValueNeedsStylesheet)
    if (typeof value === 'object') {
        if (isBoundProp(value)) return true
        const {nestedStyles} = splitStyleObject(value)
        return Object.keys(nestedStyles).length > 0
    }
    return false
}

/** Evaluate style entry for SSR snapshot (one-shot read of atoms/functions). */
export function evaluateStyleSnapshot(raw: any): any {
    if (typeof raw === 'function') {
        const evaluated = raw()
        if (Array.isArray(evaluated)) {
            return evaluated.map(item => typeof item === 'function' ? item() : item)
        }
        return evaluated
    }
    return raw
}
