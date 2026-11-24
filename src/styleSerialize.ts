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

// ─── 样式值 → CSS 文本：唯一一份实现（#60） ───
//  客户端行内样式（DOM.setAttribute 的 style 分支，el.style[k] = …）、stylesheet 规则（declarationOf）、
//  axii/ssr 的行内样式都经 stringifyCssValue，补单位的名单、逗号列表的判定、[数字, 单位] 简写的单位表都只在这里。
//  DOM.ts 曾有一份自己的 stringifyStyleValue 与三张同样的表：#48 修 [300, 'ms'] 时要改两处，
//  名单内的非数字值两端写法也不同（见 stringifyCssValue）。DOM.ts 原样导出这里的名字，公开 API 不变。
//  CSS 自定义属性（--x）同样经过这里（#79）：客户端曾把求值后的原值直接交给 el.style.setProperty，数组按 String()
//  逗号连接（{'--gap': [4, 8]} 客户端 "4,8"、服务端 "4 8"；[300, 'ms'] 客户端 "300,ms"、服务端 "300ms"），激活前后不同。
//  现在两端都是空格连接、[数字, 单位] 拼成一个值；--x 不在补单位名单里，数字原样。

// CAUTION 数字自动补单位的名单（style 对象的驼峰 key）。口径：取值只由长度 / 百分比（以及关键字、函数）组成、
//  无单位的非零数字不合法的标准 CSS 属性，含只由这类分项组成的简写（margin / inset / gap / borderRadius …）。
//  在这些属性上补单位只会把浏览器丢弃的声明（width: 10）变成合法的长度，不会改变任何合法值的含义；
//  0 写成 0px，与原来的名单一致。__tests__/styleAutoUnit.spec.tsx 在真实浏览器里枚举 el.style 核对这张表。
//  不收的三类：
//  - 无单位数字本身合法的属性：lineHeight / flex / tabSize / columns / borderImageWidth / strokeWidth / zIndex …
//    补单位会改变含义（lineHeight: 1.5 是倍数，flex: 1 是 flex-grow）；
//  - 长度与其他类型混合的简写：border* / outline / columnRule / background / mask / offset / textDecoration，
//    它们不是长度属性（border: 1 本身没有意义），按长度属性的口径排除；
//  - 厂商前缀名（webkitXxx / WebkitXxx）：同一个属性有两种 JSX 写法，多数是名单里标准属性的旧别名。
//  曾经只有 36 个名字：borderTopLeftRadius: 4、outlineOffset: 2 这类长度属性写出 "4"，浏览器静默丢弃。
const AUTO_UNIT_STYLE_NAMES =
    // 盒尺寸
    'width height minWidth minHeight maxWidth maxHeight blockSize inlineSize minBlockSize minInlineSize ' +
    'maxBlockSize maxInlineSize flexBasis containIntrinsicSize containIntrinsicWidth containIntrinsicHeight ' +
    'containIntrinsicBlockSize containIntrinsicInlineSize ' +
    // 定位
    'top right bottom left inset insetBlock insetBlockStart insetBlockEnd insetInline insetInlineStart insetInlineEnd ' +
    // 外边距、内边距
    'margin marginTop marginRight marginBottom marginLeft marginBlock marginBlockStart marginBlockEnd ' +
    'marginInline marginInlineStart marginInlineEnd ' +
    'padding paddingTop paddingRight paddingBottom paddingLeft paddingBlock paddingBlockStart paddingBlockEnd ' +
    'paddingInline paddingInlineStart paddingInlineEnd ' +
    // 边框宽度、圆角、轮廓
    'borderWidth borderTopWidth borderRightWidth borderBottomWidth borderLeftWidth borderBlockWidth ' +
    'borderBlockStartWidth borderBlockEndWidth borderInlineWidth borderInlineStartWidth borderInlineEndWidth ' +
    'borderRadius borderTopLeftRadius borderTopRightRadius borderBottomRightRadius borderBottomLeftRadius ' +
    'borderStartStartRadius borderStartEndRadius borderEndStartRadius borderEndEndRadius ' +
    'outlineWidth outlineOffset borderSpacing ' +
    // 分栏、间隙、网格轨道
    'columnWidth columnRuleWidth gap rowGap columnGap gridGap gridRowGap gridColumnGap ' +
    'gridTemplateColumns gridTemplateRows gridAutoColumns gridAutoRows ' +
    // 文字
    'fontSize letterSpacing wordSpacing textIndent verticalAlign textDecorationThickness textUnderlineOffset ' +
    // 位置与尺寸：背景、遮罩、替换元素、变换、运动路径
    'backgroundPosition backgroundPositionX backgroundPositionY backgroundSize maskPosition maskSize objectPosition ' +
    'transformOrigin perspective perspectiveOrigin translate offsetDistance offsetPosition offsetAnchor ' +
    // 滚动吸附
    'scrollMargin scrollMarginTop scrollMarginRight scrollMarginBottom scrollMarginLeft scrollMarginBlock ' +
    'scrollMarginBlockStart scrollMarginBlockEnd scrollMarginInline scrollMarginInlineStart scrollMarginInlineEnd ' +
    'scrollPadding scrollPaddingTop scrollPaddingRight scrollPaddingBottom scrollPaddingLeft scrollPaddingBlock ' +
    'scrollPaddingBlockStart scrollPaddingBlockEnd scrollPaddingInline scrollPaddingInlineStart scrollPaddingInlineEnd ' +
    // 其他
    'shapeMargin overflowClipMargin size animationRange animationRangeStart animationRangeEnd viewTimelineInset'

/**
 * @internal
 * 数字自动补单位的属性名（见上面的 CAUTION）。热路径（行内样式的每次数字写入）按 Set 查表，不用正则：
 *  同页微基准（Chromium，压缩构建）里 Set.has 约 5ns，锚定多选正则约 11–14ns（36 个名字与 136 个名字相差无几）。
 *  改成别的查表形式前先跑同页微基准。
 */
export const autoUnitStyleNames: ReadonlySet<string> = /* @__PURE__ */ new Set(AUTO_UNIT_STYLE_NAMES.split(' '))

/** 补单位名单的正则形式（公开导出，由 DOM.ts 再导出；与 autoUnitStyleNames 是同一份名单）。 */
export const AUTO_ADD_UNIT_ATTR = /* @__PURE__ */ new RegExp(`^(${AUTO_UNIT_STYLE_NAMES.split(' ').join('|')})$`)

/** 数组值按逗号连接的属性（前缀匹配：transitionDuration / animationName … 都算）。 */
export const COMMA_MULTI_VALUE_ATTR = /^(boxShadow|textShadow|transition|animation|backgroundImage)/

// [number, string] 简写（[12, 'px'] => '12px'）只对真正的 CSS 单位生效：
// margin: [0, 'auto'] 这类「数字 + 关键字」的空格简写是自然写法，误判成单位会拼出
// "0auto" 这种非法值，浏览器静默拒绝整条声明（样式无效且没有任何报错）。
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

/**
 * 样式值 → CSS 文本（唯一一份，见上面的「样式值 → CSS 文本」）。返回 '' 表示「没有这个声明」：
 *  行内样式按 el.style[k] = '' 删除，stylesheet / SSR 不写出。
 *  - 函数 / atom 求值（style={{color: colorAtom}} 是自然写法）；调用点都在响应式绑定内，读取会建立依赖。
 *  - CAUTION boolean 与 null / undefined 一样是「没有」：{fontWeight: cond && 'bold'} 翻转为 false 时，
 *    'false' 是非法值，行内赋值被拒绝、旧值永久残留（F36）。
 *  - CAUTION 空字符串的语义同样是「没有」（与 React 一致），不能被塞成 "0px"。
 *  - 数字（number / bigint）在名单内的属性上补单位，其余原样字符串化。CAUTION 只看值的类型，不认对象：
 *    客户端曾对名单内的一切非字符串、非 StyleSize 的值接上单位，另一份 axii 副本里的 StyleSize（instanceof 认不出）
 *    写成 "2rempx" 被浏览器拒绝，而 stylesheet / SSR 写出 "2rem"——同一个值两端不同。StyleSize 自己的
 *    toString 已经带单位，原样字符串化即可。
 */
export function stringifyCssValue(k: string, v: any, state?: StylePreparationState): string {
    v = resolveCssValue(v, state)
    // CAUTION 热路径：行内样式的每次写入都经过这里。字符串（最常见）原样返回、不查名单；
    //  数字只查一次 Set。不要在这两个分支前面加判断。
    if (typeof v === 'string') return v
    if (typeof v === 'number') return autoUnitStyleNames.has(k) ? `${v}${autoUnitType}` : String(v)
    if (v === undefined || v === null || typeof v === 'boolean') return ''
    if (Array.isArray(v)) {
        // CAUTION [数字, 单位] 简写必须先于逗号列表判断：接受时间单位的属性（transitionDuration /
        //  transitionDelay / animationDuration / animationDelay）全部命中 COMMA_MULTI_VALUE_ATTR，
        //  先走逗号分支的话 [300, 'ms'] 被拼成 "300,ms"——非法值，浏览器静默拒绝整条声明，
        //  CSS_UNIT_VALUE 里的 s/ms 永远用不上。「数字 + 单位名」本身不可能是合法的逗号列表。
        if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            return `${v[0]}${v[1]}`
        }
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            // boxShadow / transition 这类逗号列表；数组项同样支持 atom / 函数值。
            // CAUTION 条件项（cond && '0 0 2px blue'）的 falsy 结果必须过滤掉：
            //  'false' 混进逗号列表会让整条声明非法，浏览器静默丢弃 => 旧值永远残留（F36）。
            const parts: string[] = []
            for (const item of v) {
                const i = resolveCssValue(item, state)
                if (i === undefined || i === null || typeof i === 'boolean' || i === '') continue
                parts.push(String(i))
            }
            return parts.join(',')
        }
        // padding / margin / translate 这类空格分隔的多值，每一项按同一属性补单位；undefined 项按 0 处理
        return v.map((i: any) => stringifyCssValue(k, i ?? 0, state)).join(' ')
    }
    if (typeof v === 'bigint') return autoUnitStyleNames.has(k) ? `${v}${autoUnitType}` : String(v)
    // StyleSize 与其他对象：它们的 toString 就是 CSS 文本
    return String(v)
}

/**
 * style 对象的 key → CSS 属性名（stylesheet 规则与 SSR 行内样式共用）。
 *
 * CAUTION 必须接受 el.style 接受的同一批 key，否则同一个 key 行内有效、一进 stylesheet / SSR 就失效
 *  （行内是 el.style[key] = v，由 CSSOM 认名字）：
 *  - cssFloat 是 float 的 CSSOM 名字（float 曾是保留字），朴素的驼峰转换得到非法的 css-float；
 *  - 小写开头的厂商前缀（webkitLineClamp / mozXxx / msXxx）要补上前导 '-'：-webkit-line-clamp。
 *    大写开头（WebkitLineClamp）经驼峰转换本来就得到 -webkit-line-clamp。
 */
export function cssPropertyName(key: string): string {
    if (key[0] === '-' && key[1] === '-') return key
    if (key === 'cssFloat') return 'float'
    const name = key.replace(/([A-Z])/g, '-$1').toLowerCase()
    return VENDOR_PREFIXED_KEY.test(key) ? `-${name}` : name
}
const VENDOR_PREFIXED_KEY = /^(webkit|moz|ms)[A-Z]/

// 一条声明写进规则的文本，不写出时为 undefined。stylesheet 规则（prepareStyleNode / keyframes）与
//  sheetDeclaredKeys 共用：
//  - null / undefined / boolean 不写（条件写法的「没有」）；空值（'' / [null]）写出来是 `prop:;`，
//    浏览器整条丢弃，等同没写；
//  - CAUTION 值必须过 isAcceptableInlineDeclaration（与 SSR 行内样式同一道门）：行内样式经 CSSOM
//    逐个属性赋值，值里带顶层 `;` / `!important` / 不配对的括号或引号时整次赋值被拒绝。规则文本是
//    字符串拼接，同样的值在这里会追加任意声明（color: 'red;position:fixed' 让元素 position:fixed）、
//    或用 `}` 让整条规则被拒、同一条目里的其他声明一起丢失。不合格的声明单独丢弃，与行内一致。
function declarationOf(key: string, value: any, state?: StylePreparationState): string | undefined {
    if (value === null || value === undefined || typeof value === 'boolean') return undefined
    const css = stringifyCssValue(key, value, state)
    if (css === '') return undefined
    const name = cssPropertyName(key)
    return isAcceptableInlineDeclaration(name, css) ? `${name}:${css};` : undefined
}

export function stringifyStyleObject(styleObject: StyleObject, state?: StylePreparationState): string {
    const declarations: string[] = []
    for (const key in styleObject) {
        const declaration = declarationOf(key, styleObject[key], state)
        if (declaration !== undefined) declarations.push(declaration)
    }
    return declarations.join('\n')
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
 * stylesheet 条目在自己的主规则里真正写出的顶层声明的 key（原样，与 style 对象里写的一致），
 * 没有则 undefined。CSR（StyleManager.update）与 SSR 共用：两边据此让排在它前面的行内声明
 * 「让位」（见 StyleManager.update 的 CAUTION）。
 *
 * 过滤规则必须与 prepareStyleNode 完全一致（同一个 declarationOf）：规则里没有写出的
 *  声明（null / boolean / 空值 / 被声明门闩拒绝的值）不能让位，否则前面的行内值被删掉、
 *  后面又没有值接手。
 *  animation 简写写在紧随主规则的那条规则里，同样算作顶层声明。
 * CAUTION 只在「前面确实有行内声明」时才调用（罕见路径）：值会被再求值一次。
 */
export function sheetDeclaredKeys(styleObject: StyleObject): string[] | undefined {
    let keys: string[] | undefined
    for (const key in styleObject) {
        const value = styleObject[key]
        if (key === '@keyframes') continue
        if (key === 'animation') {
            if (prepareAnimation(value) !== undefined) (keys ??= []).push(key)
        } else if (!isNestedStyleObject(key, value) && declarationOf(key, value) !== undefined) {
            (keys ??= []).push(key)
        }
    }
    return keys
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
    // 与其他声明同一道门（见 declarationOf）：animation 的值同样拼进规则文本
    if (!Array.isArray(animation)) return acceptedAnimation(String(animation))
    // CAUTION 条件项（cond && 'spin 1s' / cond ? '…' : null）的 falsy 结果必须过滤掉，与
    //  stringifyCssValue 的逗号列表分支一致（F36）：null/undefined 经 join 留下悬空逗号
    //  （"a 1s, "），整条 animation 声明非法、被浏览器静默丢弃。全部是 falsy 时等同没写。
    const parts: string[] = []
    for (const item of animation) {
        const resolved = resolveCssValue(item, state)
        if (resolved === undefined || resolved === null || typeof resolved === 'boolean' || resolved === '') continue
        parts.push(String(resolved))
    }
    return parts.length ? acceptedAnimation(parts.join(', ')) : undefined
}

function acceptedAnimation(text: string): string | undefined {
    return isAcceptableInlineDeclaration('animation', text) ? text : undefined
}

// animation 简写会重置的分项属性（animation-delay / animationPlayState / animation-timeline …）
function isAnimationLonghand(key: string): boolean {
    return key.charCodeAt(0) === 97 && /^animation[A-Z-]/.test(key)
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
        } else {
            const declaration = declarationOf(key, value, state)
            if (declaration === undefined) continue
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
            } else if (afterAnimation && isAnimationLonghand(key) && !isNestedStyleObject(key, styleObject[key])) {
                const declaration = declarationOf(key, styleObject[key])
                if (declaration !== undefined) (animationTail ??= []).push(declaration)
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

// ─────────────────────────── CSS 词法：声明门闩、规则门闩、SSR 字符串条目拆分共用（#78） ───────────────────────────
// CAUTION 样式值拼进规则文本或 style 属性之后，由浏览器的 CSS tokenizer 重新切分（CSS Syntax 3 §4）。
//  「这段文本在哪里结束、是不是恰好一条声明 / 一条规则」只能按同一套词法判断：朴素扫描与浏览器分界
//  不同的每一处都是注入口（#78：url(a(b);position:fixed;x:()) 在浏览器里是 bad-url 加两条声明）。
//  所以词法只有这一份（scanCssComponentValues），三个调用方都用它：
//  - 不带引号的 url( 是一个 url token，在第一个未转义的 ")" 处结束，里面的 "(" 与引号不配对、不成串。
//    含引号、"("、不可打印字符、内部空白、不合法转义（\ + 换行）的是 bad-url：它同样在第一个 ")" 处结束，
//    并且在任何属性里都无效（CSSOM 整条拒绝），这里一律返回 -1。url 后面（可隔空白）跟引号时才是普通函数。
//    函数名按转义解码后比较（\75rl( 与 u\72 l( 都是 url(）；#url( / @url( / 1url( / -url( 不是。
//  - 字符串：未转义的换行（\n、\r、\f 都是换行）让它成为 bad-string，在换行前结束，返回 -1；\ + 换行是续行。
//  - 转义：\ 后跟 1–6 个十六进制数字时连同其后的一个空白（\r\n 算一个）一起消耗；\ + 换行不是转义；
//    结尾的 \ 会转义拼在后面的 ";"，返回 -1。
//  - 注释只在 token 之间识别；未闭合的注释、字符串、url、块会一直吞到文本结尾，返回 -1
//    （CSSOM 会在值的末尾自动补齐，这里更严格，见 README「Style arrays」）。
//  - () [] {} 块按嵌套配对，块内的 ; ! 不是分隔符。
//  - "<!--"（CDO）是一个 token，之后另起一个 token；"-->"（CDC）以 ">" 结尾，名字在这里自然断开。
//  拿不准与浏览器分界是否相同的，一律返回 -1，由调用方拒绝或放弃，不做猜测性修补。
//  性能：逐字符一遍扫描 O(n)，只用 charCodeAt，不切片、不建正则匹配、不分配；块栈是模块级复用的数组
//  （扫描是同步的，不会重入）。stylesheet 条目每条声明都要过一次（declarationOf）。
//  块栈常驻内存，长度是扫描过的最大嵌套深度：嵌套超过 CSS_MAX_BLOCK_DEPTH 层的文本直接返回 -1，
//  一个恶意的值（百万个 "("）不能让它永久占用内存。
export const CSS_STOP_SEMICOLON = 1     // 顶层的 ";" 结束扫描，返回它的位置
export const CSS_STOP_BANG = 2          // 顶层的 "!" 结束扫描
export const CSS_STOP_OPEN_BRACE = 4    // 顶层的 "{" 结束扫描（块内的 {} 照常配对）
export const CSS_STOP_CLOSE_BRACE = 8   // 顶层多出来的 "}" 结束扫描（否则返回 -1）
export const CSS_NO_BRACES = 16         // 任何位置的 "{" / "}"（字符串、注释、url 之外）都返回 -1

const cssBlockClosers: number[] = []
const CSS_MAX_BLOCK_DEPTH = 1024

// ASCII 里的 name code point：字母、数字、"-"、"_"。U+0000 在进入 tokenizer 前被替换成 U+FFFD，同样算；
//  非 ASCII 一律是 name code point。
const CSS_ASCII_NAME_CODE_POINT = new Uint8Array(128)
for (let c = 0; c < 128; c++) {
    CSS_ASCII_NAME_CODE_POINT[c] = (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39)
        || c === 0x2D || c === 0x5F || c === 0 ? 1 : 0
}

/**
 * 从 start 开始按浏览器的 CSS 词法扫描一串 component value，返回第一个停止字符（flags 指定）的位置；
 * 扫到结尾且所有块都已闭合时返回 text.length；其余（未闭合、不配对、bad-string / bad-url、结尾的 \）返回 -1。
 */
export function scanCssComponentValues(text: string, start: number, flags: number): number {
    const length = text.length
    let depth = 0
    // 当前名字（ident、函数名、数字的单位）的起点：-1 不在名字里；-2 名字属于前面的 # / @
    //  （hash / at-keyword token，#url( 不是 url token）
    let name = -1
    // 当前名字里最后一个非 ASCII 字符（未转义）的位置。Chromium 把所有非 ASCII 都当名字字符，现行
    //  CSS Syntax 3 只认其中若干区段（U+00A0 等不在内）；SSR 的输出由各家引擎解析。名字在非 ASCII 字符
    //  之后的部分是 url 时（\u00A0url(），一种引擎里是普通函数、另一种里是 url token，两种分界不同，
    //  无法确定，返回 -1。
    let nonAscii = -1
    let i = start
    while (i < length) {
        const c = text.charCodeAt(i)
        if (c >= 0x80) {
            if (name === -1) name = i
            nonAscii = i
            i++
            continue
        }
        if (CSS_ASCII_NAME_CODE_POINT[c] === 1) {
            if (name === -1) name = i
            i++
            continue
        }
        if (c === 0x5C && isCssValidEscape(text, i)) {
            if (name === -1) name = i
            i = skipCssEscape(text, i)
            if (i < 0) return -1
            continue
        }
        const nameStart = name
        const nameNonAscii = nonAscii
        name = -1
        nonAscii = -1
        if (c === 0x28) {
            if (nameNonAscii >= 0 && isCssUrlName(text, nameNonAscii + 1, i)) return -1
            if (nameStart >= 0 && isCssUrlName(text, nameStart, i)) {
                let j = i + 1
                while (j < length && isCssWhitespace(text.charCodeAt(j))) j++
                const q = text.charCodeAt(j)
                if (q !== 0x22 && q !== 0x27) {
                    i = skipCssUrlToken(text, j)
                    if (i < 0) return -1
                    continue
                }
                // url("…")：普通函数，按块配对
            }
            if (depth === CSS_MAX_BLOCK_DEPTH) return -1
            cssBlockClosers[depth++] = 0x29
            i++
        } else if (c === 0x22 || c === 0x27) {
            i = skipCssString(text, i + 1, c)
            if (i < 0) return -1
        } else if (c === 0x2F && text.charCodeAt(i + 1) === 0x2A) {
            const end = text.indexOf('*/', i + 2)
            if (end < 0) return -1
            i = end + 2
        } else if (c === 0x23 || c === 0x40) {
            name = -2
            i++
        } else if (c === 0x3C && text.charCodeAt(i + 1) === 0x21 && text.charCodeAt(i + 2) === 0x2D && text.charCodeAt(i + 3) === 0x2D) {
            // "<!--" 是一个 CDO token：后面另起一个 token（<!--url( 是 url token，不是函数 --url(）
            i += 4
        } else if (c === 0x5B || c === 0x7B) {
            if (c === 0x7B) {
                if (flags & CSS_NO_BRACES) return -1
                if (depth === 0 && flags & CSS_STOP_OPEN_BRACE) return i
            }
            if (depth === CSS_MAX_BLOCK_DEPTH) return -1
            cssBlockClosers[depth++] = c === 0x5B ? 0x5D : 0x7D
            i++
        } else if (c === 0x29 || c === 0x5D || c === 0x7D) {
            if (c === 0x7D && flags & CSS_NO_BRACES) return -1
            if (depth === 0) return c === 0x7D && flags & CSS_STOP_CLOSE_BRACE ? i : -1
            if (cssBlockClosers[--depth] !== c) return -1
            i++
        } else if (depth === 0 && ((c === 0x3B && flags & CSS_STOP_SEMICOLON) || (c === 0x21 && flags & CSS_STOP_BANG))) {
            return i
        } else {
            // 其他单字符 token；\ + 换行不是转义，"\" 自己是一个 delim，换行在下一轮作为空白
            i++
        }
    }
    return depth === 0 ? length : -1
}

function isCssWhitespace(c: number): boolean {
    return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0C || c === 0x0D
}

function isCssNewline(c: number): boolean {
    return c === 0x0A || c === 0x0C || c === 0x0D
}

function isCssHexDigit(c: number): boolean {
    return (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)
}

// text[i] 是 "\"：后面不是换行就是合法转义（文本结尾也算，由 skipCssEscape 拒绝）
function isCssValidEscape(text: string, i: number): boolean {
    return !isCssNewline(text.charCodeAt(i + 1))
}

// text[i] 是合法转义的 "\"，返回转义之后的位置；"\" 在结尾时返回 -1（会转义拼在后面的字符）
function skipCssEscape(text: string, i: number): number {
    let j = i + 1
    if (j >= text.length) return -1
    if (!isCssHexDigit(text.charCodeAt(j))) return j + 1
    const max = j + 6
    do j++; while (j < max && j < text.length && isCssHexDigit(text.charCodeAt(j)))
    const c = text.charCodeAt(j)
    if (c === 0x0D && text.charCodeAt(j + 1) === 0x0A) return j + 2
    return isCssWhitespace(c) ? j + 1 : j
}

// [start, end) 这个名字解码转义之后是不是 url（ASCII 不区分大小写）
function isCssUrlName(text: string, start: number, end: number): boolean {
    let matched = 0
    for (let i = start; i < end; matched++) {
        let c = text.charCodeAt(i)
        if (c === 0x5C) {
            const next = skipCssEscape(text, i)
            if (isCssHexDigit(text.charCodeAt(i + 1))) {
                c = 0
                for (let j = i + 1; j < next && isCssHexDigit(text.charCodeAt(j)); j++) {
                    const h = text.charCodeAt(j)
                    c = c * 16 + (h <= 0x39 ? h - 0x30 : (h | 0x20) - 0x57)
                }
            } else {
                c = text.charCodeAt(i + 1)
            }
            i = next
        } else {
            i++
        }
        const lower = c | 0x20
        if (matched === 0 ? lower !== 0x75 : matched === 1 ? lower !== 0x72 : matched !== 2 || lower !== 0x6C) return false
    }
    return matched === 3
}

// url token 的内容（i 在 "url(" 之后、前导空白之后），返回 ")" 之后的位置；bad-url 或未闭合返回 -1
function skipCssUrlToken(text: string, i: number): number {
    while (i < text.length) {
        const c = text.charCodeAt(i)
        if (c === 0x29) return i + 1
        if (isCssWhitespace(c)) {
            do i++; while (i < text.length && isCssWhitespace(text.charCodeAt(i)))
            return text.charCodeAt(i) === 0x29 ? i + 1 : -1
        }
        // 引号、"("、不可打印字符：bad-url
        if (c === 0x22 || c === 0x27 || c === 0x28 || (c >= 0x01 && c <= 0x08) || c === 0x0B || (c >= 0x0E && c <= 0x1F) || c === 0x7F) return -1
        if (c === 0x5C) {
            if (!isCssValidEscape(text, i)) return -1
            i = skipCssEscape(text, i)
            if (i < 0) return -1
        } else {
            i++
        }
    }
    return -1
}

// 字符串的内容（i 在开引号之后），返回闭引号之后的位置；bad-string（未转义的换行）或未闭合返回 -1
function skipCssString(text: string, i: number, quote: number): number {
    while (i < text.length) {
        const c = text.charCodeAt(i)
        if (c === quote) return i + 1
        if (isCssNewline(c)) return -1
        if (c === 0x5C) {
            const n = text.charCodeAt(i + 1)
            if (n === 0x0D && text.charCodeAt(i + 2) === 0x0A) {
                i += 3
            } else if (isCssNewline(n)) {
                i += 2
            } else {
                i = skipCssEscape(text, i)
                if (i < 0) return -1
            }
        } else {
            i++
        }
    }
    return -1
}

/**
 * §3.6.1 CSS rule escape gate — dual of Chromium `CSSStyleSheet.insertRule` single-rule acceptance:
 *  前言（selector / at-rule prelude）之后恰好一个 {} 块，并且它在文本结尾闭合。按浏览器词法扫描（见上），
 *  字符串、注释、url token、转义里的 "{" / "}" 不计入；SSR 的 <style> 没有 insertRule 兜底，
 *  这里放行的规则不能在样式表里吞掉或长出别的规则。前言里顶层的 ";" 会结束一条 at-rule
 *  （@x;body {…} 是两条规则），一律拒绝。
 */
export function isAcceptableSingleCssRule(rule: string): boolean {
    let start = 0
    let end = rule.length
    while (start < end && isCssWhitespace(rule.charCodeAt(start))) start++
    while (end > start && isCssWhitespace(rule.charCodeAt(end - 1))) end--
    if (start === end) return false
    const open = scanCssComponentValues(rule, start, CSS_STOP_SEMICOLON | CSS_STOP_OPEN_BRACE | CSS_STOP_CLOSE_BRACE)
    if (open < 0 || open >= end || rule.charCodeAt(open) !== 0x7B) return false
    return scanCssComponentValues(rule, open + 1, CSS_STOP_CLOSE_BRACE) === end - 1
}

// CAUTION inline style 的声明门闩（与上面的规则门闩同一个思路：和 CSR 的拒绝行为对偶）。
//  CSR 的 inline style 是经 CSSOM 逐个属性写入的（node.style[k] = v / setProperty）：值里带顶层 `;`、
//  不配对的括号或引号、`!important` 时，浏览器拒绝整次赋值，什么都不生效；属性名不是合法标识符时
//  同样无效果。SSR 与 stylesheet 规则把同样的 k / v 拼成文本，`;` 就成了声明分隔符——
//  style={{color: userColor}} 的 userColor 可以追加任意声明（position:fixed、background:url(…)）。
//  不合格的声明整条不输出，与 CSR「该声明不生效」一致；不做改写。
//  值必须按浏览器的词法恰好是一条声明的值（scanCssComponentValues，#78）。顶层的 {} 块只允许出现在
//  自定义属性里（CSS Syntax 3「consume a declaration」）：别的属性的值带顶层 {} 时整条声明无效，
//  规则里的嵌套解析器会把它重新解析成一条嵌套规则（color: 'hover, & {position:fixed}' 让元素本身
//  position:fixed）。"--" 本身不是自定义属性名，同样会被重新解析。
const CSS_DECLARATION_NAME = /^[-_a-zA-Z0-9\u00A0-\uFFFF]+$/
export function isAcceptableInlineDeclaration(name: string, value: string): boolean {
    if (!CSS_DECLARATION_NAME.test(name)) return false
    const isCustomProperty = name.length > 2 && name.charCodeAt(0) === 0x2D && name.charCodeAt(1) === 0x2D
    const flags = isCustomProperty ? CSS_STOP_SEMICOLON | CSS_STOP_BANG : CSS_STOP_SEMICOLON | CSS_STOP_BANG | CSS_STOP_OPEN_BRACE
    return scanCssComponentValues(value, 0, flags) === value.length
}

/**
 * style 数组字符串条目里的一条声明：[属性名, 声明原文, 值, 是否 !important]。
 *  属性名按 CSSOM 的认法：自定义属性区分大小写，其余转小写。值是冒号之后、!important 之前的原文，
 *  不去首尾空白（CSSOM 解析值时自己忽略首尾的 CSS 空白；JS 的 trim 还会去掉 U+00A0，把非法值变成合法值）。
 */
export type InlineDeclaration = [name: string, text: string, value: string, important: boolean]

const INLINE_DECLARATION_NAME = /^(?:--|-?[_a-zA-Z\u00A0-\uFFFF])[-_a-zA-Z0-9\u00A0-\uFFFF]*$/
// "!" 之后只有 important（ASCII 不区分大小写），前后可以隔空白和注释（CSS Syntax 3「consume a declaration」）
const IMPORTANT_TAIL = /^(?:[ \t\n\r\f]|\/\*[^]*?\*\/)*important(?:[ \t\n\r\f]|\/\*[^]*?\*\/)*$/i

/**
 * 这条声明是不是「什么都不写」：普通属性的值只有 CSS 空白时声明无效，浏览器丢弃它、前面的值保留。
 *  自定义属性的空值合法（--x: 设为空值）。服务端据此判断后面的字符串条目是否覆盖前面的 !important 声明（ssr.ts）；
 *  客户端不需要判断：DOM.applyStyleText 把空值写成一个空白，setProperty 按同样的规则忽略或设为空值。
 */
export function isVoidInlineDeclaration(declaration: InlineDeclaration): boolean {
    const name = declaration[0]
    if (name.charCodeAt(0) === 0x2D && name.charCodeAt(1) === 0x2D) return false
    const value = declaration[2]
    for (let i = 0; i < value.length; i++) if (!isCssWhitespace(value.charCodeAt(i))) return false
    return true
}

let lastSplitText: string | undefined
let lastSplitResult: InlineDeclaration[] | null = null

/**
 * 把 style 数组的字符串条目拆成声明。唯一一份（#79），两端共用：
 *  - 客户端（DOM.setAttribute）：元素已有行内声明时逐条 setProperty，字符串条目只覆盖它自己声明的属性；
 *    StyleManager 按这里的属性名记账，下一次更新时删掉不再声明的属性（与对象条目的空值删除一致）。
 *  - 服务端（ssr.ts）：后面条目的让位、空值删除、对 !important 的覆盖要删到字符串条目里的声明，删过之后输出剩下的声明原文。
 *
 * CAUTION 只在拆法与浏览器的 CSS 词法确定一致时返回，否则返回 null，由调用方按原文处理（客户端交给浏览器解析，
 *  服务端原样输出）：浏览器里引号 / 括号 / 函数里的 ";" 不是分隔符，未闭合的引号 / 注释 / 括号一直吞到结尾，
 *  不带引号的 url( 一旦含引号、"("、内部空白就成为 bad-url、在第一个 ")" 处结束——
 *  一个朴素的扫描在这些地方与浏览器分界不同，删声明就会删错、或把后面的声明拼进前一条。
 *  分界用声明门闩的同一份词法（scanCssComponentValues，#78）。未闭合或不配对的结构、bad-string、
 *  bad-url、不是属性名的段，整个字符串放弃拆分。另外两类照旧放弃拆分（README「Style arrays」写明的约定）：
 *  带反斜杠（转义）的文本，以及字符串、注释、url 之外出现花括号的文本。
 *  首尾只去 CSS 空白（空格、\t、\n、\r、\f）：以 U+00A0 开头的「\u00A0color: red」在浏览器里不是 color 的声明（JS 的 trim 会把它变成 color）。
 *
 * CAUTION 返回值是共用的、只读的：记住最近一次的结果，客户端 StyleManager 记账与随后的 setAttribute 写入拆的是
 *  同一个字符串，第二次不再扫描。调用方不能改动返回的数组（服务端删声明前先复制，见 ssr.ts 的 removeInlineDeclaration）。
 */
export function splitInlineDeclarations(text: string): readonly InlineDeclaration[] | null {
    if (text === lastSplitText) return lastSplitResult
    const result = splitInlineDeclarationsOnce(text)
    lastSplitText = text
    lastSplitResult = result
    return result
}

function splitInlineDeclarationsOnce(text: string): InlineDeclaration[] | null {
    if (text.indexOf('\\') >= 0) return null
    const declarations: InlineDeclaration[] = []
    const length = text.length
    for (let start = 0; start <= length;) {
        // 一遍扫到这条声明结尾的 ";"，途中记下最后一个顶层的 "!"：!important 是值里最后一个 "!" 之后只有 important，
        //  "!" 也可以是自定义属性值的一部分（--x: a!b），所以要最后一个。"!" 是单独的 token，从它之后接着扫描与整体扫描分界相同。
        let bang = -1
        let end = scanCssComponentValues(text, start, CSS_STOP_SEMICOLON | CSS_STOP_BANG | CSS_NO_BRACES)
        while (end >= 0 && end < length && text.charCodeAt(end) === 0x21) {
            bang = end
            end = scanCssComponentValues(text, end + 1, CSS_STOP_SEMICOLON | CSS_STOP_BANG | CSS_NO_BRACES)
        }
        if (end < 0) return null
        let from = start
        let to = end
        while (from < to && isCssWhitespace(text.charCodeAt(from))) from++
        while (to > from && isCssWhitespace(text.charCodeAt(to - 1))) to--
        if (from < to) {
            const colon = text.indexOf(':', from)
            if (colon < 0 || colon >= to) return null
            let nameEnd = colon
            while (nameEnd > from && isCssWhitespace(text.charCodeAt(nameEnd - 1))) nameEnd--
            const name = text.slice(from, nameEnd)
            if (!INLINE_DECLARATION_NAME.test(name)) return null
            const important = bang > colon && IMPORTANT_TAIL.test(text.slice(bang + 1, to))
            declarations.push([
                name.charCodeAt(0) === 0x2D && name.charCodeAt(1) === 0x2D ? name : name.toLowerCase(),
                text.slice(from, to),
                text.slice(colon + 1, important ? bang : to),
                important,
            ])
        }
        start = end + 1
    }
    return declarations
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
