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

// CAUTION 数字补全用的单位只有这一份状态，行内样式（DOM.ts）与 stylesheet / SSR（本文件）共用。
//  这里曾有一份写死 px 的 autoUnit 副本：setAutoUnitType('rem') 之后同一个 {width: 10}
//  行内是 10rem，一旦对象里多了一个 &:hover（或来自 bindProps / SSR）就变成 10px。
//  setAutoUnitType / autoUnit 仍然只从 DOM.ts 对外导出（本文件不进 index.ts）。
let autoUnitType: 'px' | 'rem' | 'em' = 'px'

export function setAutoUnitType(type: 'px' | 'rem' | 'em') {
    autoUnitType = type
}

export function getAutoUnitType() {
    return autoUnitType
}

export function autoUnit(num: number | string): string {
    if (typeof num === 'string') return num
    return `${num}${autoUnitType}`
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
        // [数字, 单位] 简写先于逗号列表判断，时间单位才用得上（与 DOM.stringifyStyleValue 一致，原因见那里）
        if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            return `${v[0]}${v[1]}`
        }
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            const parts: string[] = []
            for (const item of v) {
                const i = resolveCssValue(item, state)
                if (i === undefined || i === null || typeof i === 'boolean' || i === '') continue
                parts.push(String(i))
            }
            return parts.join(',')
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

/**
 * 条目数组里最后一个「必须走 stylesheet」（bound / 含嵌套 selector、at-rule、animation）的
 * 条目下标，没有则 -1。CSR（StyleManager.update）与 SSR 共用，两边对「谁被提升」的判断必须一致。
 *
 * CAUTION 行内声明永远压过 stylesheet 规则，所以排在某个 stylesheet 条目**之前**的普通条目
 *  不能留在行内：style 数组的契约是「后面的条目覆盖前面的」（mergeProp 把 AOP/外部传入的
 *  style 放在后面正是为了覆写），留在行内的话 [{color:'blue'}, {color:'red', '&:hover':{…}}]
 *  得到的是 blue——外部覆盖一旦带上 &:hover，它的基础声明就静默失效。调用方把这些
 *  「在它之前」的普通条目也提升进 stylesheet（见 isPromotedStyleEntry），顺序统一由条目序号决定。
 * CAUTION 这是样式更新的热路径：只有一个条目（绝大多数）时调用方直接跳过；多个条目时
 *  从后往前扫，不分配任何对象。下标 0 之前没有条目，不需要看。
 */
export function lastStyleSheetEntryIndex(entries: EvaluatedStyleEntry[]): number {
    for (let i = entries.length - 1; i > 0; i--) {
        const {value, isBound} = entries[i]
        if (!value || typeof value !== 'object') continue
        if (isBound) return i
        for (const key in value) {
            if (key === '@keyframes' || key === 'animation' || isNestedStyleObject(key, value[key])) return i
        }
    }
    return -1
}

/** 自己不需要 stylesheet、但排在某个 stylesheet 条目之前的普通对象条目（见 lastStyleSheetEntryIndex）。 */
export function isPromotedStyleEntry(value: any, index: number, lastSheetIndex: number, ownsStyleSheet: boolean): boolean {
    if (ownsStyleSheet || index >= lastSheetIndex || !value || typeof value !== 'object') return false
    // 空对象没有可提升的声明，不为它建一张空表
    for (const _ in value) return true
    return false
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
    // 写在 animation 之后的 animation-* 分项声明（见 prepareStyleNode）
    animationTail?: string
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
    if (!Array.isArray(animation)) return String(animation)
    // CAUTION 条件项（cond && 'spin 1s' / cond ? '…' : null）的 falsy 结果必须过滤掉，与
    //  stringifyCssValue 的逗号列表分支一致（F36）：null/undefined 经 join 留下悬空逗号
    //  （"a 1s, "），整条 animation 声明非法、被浏览器静默丢弃。全部是 falsy 时等同没写。
    const parts: string[] = []
    for (const item of animation) {
        const resolved = resolveCssValue(item, state)
        if (resolved === undefined || resolved === null || typeof resolved === 'boolean' || resolved === '') continue
        parts.push(String(resolved))
    }
    return parts.length ? parts.join(', ') : undefined
}

// animation 简写会重置的分项属性（animation-delay / animationPlayState / animation-timeline …）
function isAnimationLonghand(key: string): boolean {
    return key.charCodeAt(0) === 97 && /^animation[A-Z-]/.test(key)
}

function isDeclarationValue(value: any): boolean {
    return value !== null && value !== undefined && typeof value !== 'boolean'
}

function prepareStyleNode(styleObject: StyleObject, state: StylePreparationState): PreparedStyleNode {
    const declarations: string[] = []
    // CAUTION animation 简写不在主规则里，而是由 renderStyleAnimation 输出在主规则**之后**的
    //  一条同特异性规则里（@self 要替换成 keyframes 名）。简写会重置全部 animation-* 分项，
    //  所以作者写在 animation 之后的分项（animationDelay / animationPlayState /
    //  animationIterationCount … 都是自然写法）会被这条靠后的简写整体冲掉。把这些分项在简写
    //  后面再输出一遍，让对象里的书写顺序就是层叠顺序（与行内路径逐 key 赋值的结果一致）；
    //  写在 animation 之前的分项按 CSS 语义本来就该被简写重置，不重复。
    //  每个值只求值一次：复用同一份声明文本，缓存 key 与实际规则才一致。
    let animationTail: string[] | undefined
    const node: PreparedStyleNode = {declarations: ''}
    for (const [key, value] of Object.entries(styleObject ?? {})) {
        if (key === '@keyframes') {
            node.keyframes = prepareKeyframes(value, state)
        } else if (key === 'animation') {
            node.animation = prepareAnimation(value, state)
            animationTail = node.animation !== undefined ? [] : undefined
        } else if (isNestedStyleObject(key, value)) {
            const selectors = key.startsWith('@') ? undefined
                : splitSelectorList(key).map(part => splitNestingReferences(part.trim(), state))
            const nested = node.nested ??= []
            nested.push({scope: selectors ?? key, node: prepareStyleNode(value, state)})
        } else if (isDeclarationValue(value)) {
            const declaration = stringifyDeclaration(key, value, state)
            declarations.push(declaration)
            if (animationTail && isAnimationLonghand(key)) animationTail.push(declaration)
        }
    }
    node.declarations = declarations.join('\n')
    if (animationTail?.length) node.animationTail = animationTail.join('\n')
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
    identitySelector = selector,
    animationTail?: string,
): string[] {
    const contents: string[] = []
    const name = animationName ?? `animation-${hashStyleContent(JSON.stringify([identitySelector, keyframes, animation]))}`
    if (keyframes !== undefined) {
        contents.push(`@keyframes ${name} {
${keyframes}
}`)
    }
    if (animation !== undefined) {
        contents.push(`
${selector} {
    animation: ${animation.replace(/@self/g, name)};${animationTail ? '\n' + animationTail : ''}
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
    const animation = prepareAnimation(styleObject.animation)
    // 与 prepareStyleNode 同一条规则：写在 animation 之后的分项跟在简写后面
    let animationTail: string[] | undefined
    if (animation !== undefined) {
        let afterAnimation = false
        for (const key in styleObject) {
            if (key === 'animation') {
                afterAnimation = true
            } else if (afterAnimation && isAnimationLonghand(key) && isDeclarationValue(styleObject[key]) &&
                !isNestedStyleObject(key, styleObject[key])) {
                (animationTail ??= []).push(stringifyDeclaration(key, styleObject[key]))
            }
        }
    }
    return renderStyleAnimation(
        selector,
        prepareKeyframes(styleObject['@keyframes']),
        animation,
        animationName,
        selector,
        animationTail?.join('\n'),
    )
}

// CAUTION 父级 selector 必须以「列表」（string[]）向下传，不能传逗号拼好的文本：
//  CSS Nesting 里 `&` 代表整个父级列表（'&.a, &.b' 下的 '& span' 等价于
//  `:is(P.a, P.b) span`）。对拼好的文本做 join/前缀，子 selector 只会接到列表的最后
//  一项上（`P.a, P.b span`）：前面的父级自己吃到了这些声明，它们的后代却永远匹配不上，
//  样式静默落到错误的元素上。这里按「父级 × 子级」展开，单个父级时输出与之前逐字相同。
function renderStyleNode(selectors: string[], node: PreparedStyleNode, activationGuard: string): string[] {
    const selector = selectors.join(', ')
    const contents = [`${selector} {
${node.declarations}
}`]

    if (node.keyframes !== undefined || node.animation !== undefined) {
        const identitySelector = activationGuard ? selector.replaceAll(activationGuard, '') : selector
        contents.push(...renderStyleAnimation(selector, node.keyframes, node.animation, undefined, identitySelector, node.animationTail))
    }
    if (node.nested) {
        for (const nested of node.nested) {
            const {scope, node} = nested
            if (typeof scope !== 'string') {
                const scoped: string[] = []
                for (const parent of selectors) {
                    for (const segments of scope) {
                        scoped.push(segments.length > 1 ? segments.join(parent) : `${parent} ${segments[0]}`)
                    }
                }
                contents.push(...renderStyleNode(scoped, node, activationGuard))
            } else {
                contents.push(`${scope} {
    ${renderStyleNode(selectors, node, activationGuard).join('\n')}
}`)
            }
        }
    }
    return contents
}

export function renderPreparedStyle(selector: string, prepared: PreparedStyleContent, activation?: 'active' | `!${string}`): string[] {
    // A mounted root can already own this content sheet when another root's SSR markup arrives.
    // Its adopted rules follow <style> in the cascade. Let pending anchors use their complete SSR
    // rule order until claimed, without changing selector specificity or restarting @self animations.
    // Pending rolling classes can repeat across SSR payloads, so also match their CSS token.
    let activationGuard = ''
    if (activation === 'active') activationGuard = ACTIVE_STYLE_ANCHOR
    else if (activation) activationGuard = `:where([${SSR_STYLE_CLASSES_ATTRIBUTE}~="${activation}"])`
    // 调用方（generateStyleContent 是公开导出的）传进来的 selector 自己也可以是列表，同样按列表处理
    const selectors = splitSelectorList(selector).map(part => activationGuard + part.trim())
    return renderStyleNode(selectors, prepared.node, activationGuard)
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
// CAUTION inline style 的声明门闩（与上面的规则门闩同一个思路：和 CSR 的拒绝行为对偶）。
//  CSR 的 inline style 是经 CSSOM 逐个属性写入的（node.style[k] = v / setProperty）：值里带顶层 `;`、
//  不配对的括号或引号、`!important` 时，浏览器拒绝整次赋值，什么都不生效；属性名不是合法标识符时
//  同样无效果。SSR 把同样的 k / v 拼进 style="…"，`;` 就成了声明分隔符——
//  style={{color: userColor}} 的 userColor 可以追加任意声明（position:fixed、background:url(…)）。
//  不合格的声明整条不输出，与 CSR「该声明不生效」一致；不做改写。
export function isAcceptableInlineDeclaration(name: string, value: string): boolean {
    if (!/^[-_a-zA-Z0-9\u00A0-\uFFFF]+$/.test(name)) return false
    const closers: string[] = []
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]
        if (ch === '\\') {
            // 结尾的反斜杠会把后面拼上的 `;` 转义掉，吞并下一条声明
            if (i === value.length - 1) return false
            i++
        } else if (ch === '"' || ch === "'") {
            let j = i + 1
            for (; j < value.length && value[j] !== ch; j++) {
                if (value[j] === '\n') return false
                if (value[j] === '\\') j++
            }
            if (j >= value.length) return false
            i = j
        } else if (ch === '/' && value[i + 1] === '*') {
            const end = value.indexOf('*/', i + 2)
            if (end === -1) return false
            i = end + 1
        } else if (ch === '(' || ch === '[' || ch === '{') {
            closers.push(ch === '(' ? ')' : ch === '[' ? ']' : '}')
        } else if (ch === ')' || ch === ']' || ch === '}') {
            if (closers.pop() !== ch) return false
        } else if (closers.length === 0 && (ch === ';' || ch === '!')) {
            return false
        }
    }
    return closers.length === 0
}

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
