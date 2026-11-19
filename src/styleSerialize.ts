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
export const SSR_STYLE_CLASSES_ATTRIBUTE = 'data-axii-ssr-style-classes'
const ACTIVE_STYLE_ANCHOR = `:where(:not([${SSR_STYLE_CLASSES_ATTRIBUTE}]))`
const PENDING_STYLE_ANCHOR = `:where([${SSR_STYLE_CLASSES_ATTRIBUTE}])`

export function contentStyleId(signature: string, entryIndex: number): string {
    return `${CONTENT_STYLE_ID_PREFIX}${hashStyleContent(signature)}F${entryIndex}`
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

type StylePreparationState = {isReactive: boolean, shareable: boolean}

function evaluateCssValue(value: any, state?: StylePreparationState): any {
    if (typeof value !== 'function') return value
    if (state) state.isReactive = true
    return value()
}

function hasUnsupportedOpaqueState(value: object, ancestors?: Set<object>): boolean {
    if (ancestors?.has(value)) return true
    for (const key of Object.keys(value)) {
        const property = Object.getOwnPropertyDescriptor(value, key)
        if (!property || !('value' in property)) return true
        const member = property.value
        if (member === value || typeof member === 'bigint') return true
        if (member && typeof member === 'object') {
            ancestors ??= new Set()
            ancestors.add(value)
            const unsupported = hasUnsupportedOpaqueState(member, ancestors)
            ancestors.delete(value)
            if (unsupported) return true
        }
    }
    return false
}

function resolveCssValue(value: any, state?: StylePreparationState): any {
    value = evaluateCssValue(value, state)
    // Preserve the rolling fallback for values that could not be serialized before,
    // without invoking getters or toJSON to build the identity.
    if (state?.shareable && (typeof value === 'bigint' || (
        value && typeof value === 'object' && !Array.isArray(value) && hasUnsupportedOpaqueState(value)
    ))) {
        state.shareable = false
    }
    return value
}

/** CSS value stringification shared by stylesheet rules and SSR inline styles. */
export function stringifyCssValue(k: string, v: any, state?: StylePreparationState): string {
    v = resolveCssValue(v, state)
    if (v === undefined || v === null || typeof v === 'boolean') return ''
    if (Array.isArray(v)) {
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            const parts: string[] = []
            for (const item of v) {
                const i = resolveCssValue(item, state)
                if (i === undefined || i === null || typeof i === 'boolean' || i === '') continue
                parts.push(String(i))
            }
            return parts.join(',')
        } else if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            return `${v[0]}${v[1]}`
        } else {
            return v.map((i: any) => stringifyCssValue(k, i ?? 0, state)).join(' ')
        }
    }
    if (v === '') return ''
    if (v && typeof v === 'object' && typeof v.toString === 'function' && !(typeof v === 'number')) {
        // StyleSize etc.
        if (!AUTO_ADD_UNIT_ATTR.test(k)) return v.toString()
    }
    return (typeof v === 'number' && AUTO_ADD_UNIT_ATTR.test(k)) ? autoUnit(v) : String(v)
}

function stringifyDeclaration(key: string, value: any, state?: StylePreparationState): string {
    const property = (key[0] === '-' && key[1] === '-')
        ? key
        : key.replace(/([A-Z])/g, '-$1').toLowerCase()
    return `${property}:${stringifyCssValue(key, value, state)};`
}

export function stringifyStyleObject(styleObject: StyleObject, state?: StylePreparationState): string {
    return Object.entries(styleObject).map(([key, value]) => stringifyDeclaration(key, value, state)).join('\n')
}

export function stringifyKeyFrameObject(keyframeObject: StyleObject, state?: StylePreparationState): string {
    return Object.entries(keyframeObject).map(([frame, body]) => `${frame} {
                ${stringifyStyleObject(body, state)}
            }`).join('\n')
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
        const value = styleObject[key]
        if (key === '@keyframes' || key === 'animation' || isNestedStyleObject(key, value)) {
            nestedStyles[key] = value
        } else {
            simpleStyles[key] = value
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
        if (ch === '\\') {
            i++
        } else if (quote) {
            if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === '/' && input[i + 1] === '*') {
            const end = input.indexOf('*/', i + 2)
            if (end < 0) break
            i = end + 1
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

function splitNestingReferences(selector: string, state: StylePreparationState): string[] {
    const segments: string[] = []
    let start = 0
    let functionDepth = 0
    let quote: string | null = null
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i]
        if (ch === '\\') {
            i++
        } else if (quote) {
            if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === '/' && selector[i + 1] === '*') {
            const end = selector.indexOf('*/', i + 2)
            if (end < 0) break
            i = end + 1
        } else if (ch === '(') {
            functionDepth++
        } else if (ch === ')') {
            functionDepth--
        } else if (ch === '&') {
            // Repeated references can match other instances. A reference in a
            // selector function can also change the matching set, e.g. :not(&)
            // and :nth-child(1 of &).
            if (functionDepth > 0 || segments.length > 0) state.shareable = false
            segments.push(selector.slice(start, i))
            start = i + 1
        }
    }
    segments.push(selector.slice(start))
    return segments
}

type PreparedStyleNode = {
    declarations: string
    keyframes?: string
    animation?: string
    nested?: {
        scope: string | string[][]
        node: PreparedStyleNode
    }[]
}

export type PreparedStyleContent = StylePreparationState & {node: PreparedStyleNode}

function prepareKeyframes(value: any, state?: StylePreparationState): string | undefined {
    const frames = evaluateCssValue(value, state)
    return frames ? stringifyKeyFrameObject(frames, state) : undefined
}

function prepareAnimation(value: any, state?: StylePreparationState): string | undefined {
    const animation = resolveCssValue(value, state)
    if (!animation) return undefined
    return Array.isArray(animation)
        ? animation.map(item => resolveCssValue(item, state)).join(', ')
        : String(animation)
}

function prepareStyleNode(styleObject: StyleObject, state: StylePreparationState): PreparedStyleNode {
    const declarations: string[] = []
    const node: PreparedStyleNode = {declarations: ''}
    for (const [key, value] of Object.entries(styleObject ?? {})) {
        if (key === '@keyframes') {
            node.keyframes = prepareKeyframes(value, state)
        } else if (key === 'animation') {
            node.animation = prepareAnimation(value, state)
        } else if (isNestedStyleObject(key, value)) {
            const selectors = key.startsWith('@') ? undefined
                : splitSelectorList(key).map(part => splitNestingReferences(part.trim(), state))
            const nested = node.nested ??= []
            nested.push({scope: selectors ?? key, node: prepareStyleNode(value, state)})
        } else if (value !== null && value !== undefined && typeof value !== 'boolean') {
            declarations.push(stringifyDeclaration(key, value, state))
        }
    }
    node.declarations = declarations.join('\n')
    return node
}

/** Snapshot each declaration once so the cache key and the emitted rules use the same CSS text. */
export function prepareStyleContent(styleObject: StyleObject): PreparedStyleContent {
    const state: StylePreparationState = {isReactive: false, shareable: true}
    const node = prepareStyleNode(styleObject, state)
    return {node, ...state}
}

export function serializePreparedStyle(prepared: PreparedStyleContent): string {
    // Serialize inert CSS text and selector structure, never the original values or their toJSON methods.
    return JSON.stringify(prepared.node)
}

function renderStyleAnimation(
    selector: string,
    keyframes: string | undefined,
    animation: string | undefined,
    animationName?: string,
): string[] {
    const contents: string[] = []
    const name = animationName ?? `animation-${hashStyleContent(JSON.stringify([
        selector.replaceAll(ACTIVE_STYLE_ANCHOR, '').replaceAll(PENDING_STYLE_ANCHOR, ''), keyframes, animation,
    ]))}`
    if (keyframes !== undefined) {
        contents.push(`@keyframes ${name} {
${keyframes}
}`)
    }
    if (animation !== undefined) {
        contents.push(`
${selector} {
    animation: ${animation.replace(/@self/g, name)};
}
`)
    }
    return contents
}

export function generateInlineAnimationContent(
    selector: string,
    styleObject: StyleObject,
    animationName?: string,
): string[] {
    return renderStyleAnimation(
        selector,
        prepareKeyframes(styleObject['@keyframes']),
        prepareAnimation(styleObject.animation),
        animationName,
    )
}

function renderStyleNode(selector: string, node: PreparedStyleNode): string[] {
    const contents = [`${selector} {
${node.declarations}
}`]

    if (node.keyframes !== undefined || node.animation !== undefined) {
        contents.push(...renderStyleAnimation(selector, node.keyframes, node.animation))
    }
    if (node.nested) {
        for (const nested of node.nested) {
            const {scope, node} = nested
            if (typeof scope !== 'string') {
                const scoped = scope.map(segments => segments.length > 1
                    ? segments.join(selector)
                    : `${selector} ${segments[0]}`).join(', ')
                contents.push(...renderStyleNode(scoped, node))
            } else {
                contents.push(`${scope} {
    ${renderStyleNode(selector, node).join('\n')}
}`)
            }
        }
    }
    return contents
}

export function renderPreparedStyle(selector: string, prepared: PreparedStyleContent, activation?: 'active' | 'pending'): string[] {
    // A mounted root can already own this content sheet when another root's SSR markup arrives.
    // Its adopted rules follow <style> in the cascade. Let pending anchors use their complete SSR
    // rule order until claimed, without changing selector specificity or restarting @self animations.
    // Pending SSR rolling classes can also have the same base as an independently adopted root.
    const anchor = activation === 'active' ? ACTIVE_STYLE_ANCHOR + selector :
        activation === 'pending' ? PENDING_STYLE_ANCHOR + selector : selector
    return renderStyleNode(anchor, prepared.node)
}

export function generateStyleContent(selector: string, styleObject: StyleObject): string[] {
    return renderPreparedStyle(selector, prepareStyleContent(styleObject))
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
