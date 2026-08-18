/**
 * Node-safe SSR entry (`axii/ssr`). String serialization only — no DOM globals.
 * M-02: attrs/forms/escape/FTS/FCS/context/DirectNodes/ElementChildText.
 * M-03: RxList / Compact / G3-* / G4-F / table tbody.
 * M-04: StyleManager nested/@ styles → `styles` + deterministic class ids.
 * M-05: Portal bypass (§3.3.d), lazy sync fallback, lifecycle no-ops / isolation.
 */
import {isAtom, RxList} from 'data0'
import type {Component, ComponentNode, Props, RenderContext} from './types'
import {isAxiiPortalComponent, resolvePortalExportKey, Portal} from './Portal.js'
import {beginSsrPass, endSsrPass} from './ssrContext.js'
import {
    computeStyleSignature,
    containsReactiveStyleValue,
    evaluateStyleSnapshot,
    gateStyleRules,
    generateStyleContent,
    generateStyleStaticId,
    getComponentTypeId,
    isAcceptableSingleCssRule,
    splitStyleObject,
    stringifyCssValue,
    styleValueNeedsStylesheet,
    toCssSafeComponentName,
} from './styleSerialize'

/** Local Fragment sentinel — avoid importing DOM.ts (browser createElement) into the SSR entry. */
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

const RCDATA_TAGS = new Set(['textarea', 'title'])
const RAWTEXT_TAGS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])

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

/** §3.6.1 RAWTEXT / SSR `<style>` termination sequence gate */
export function assertNoRawTextTerminator(payload: string, tagName: string): void {
    const lower = tagName.toLowerCase()
    const re = new RegExp(`</${lower}(?=[\\s/>]|$)`, 'i')
    if (re.test(payload)) {
        throw new Error(`[axii/ssr] RAWTEXT termination sequence in <${lower}> payload`)
    }
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

type SsrStyleState = {
    /** stylesheet id → gated CSS text (deduped) */
    sheets: Map<string, string>
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
    if (!state || state.sheets.size === 0) return ''
    const css = Array.from(state.sheets.values()).join('\n')
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
): {classIds: string[], inline: string} {
    const state = ssrStyle
    if (!state) return {classIds: [], inline: ''}

    const rawEntries = Array.isArray(styleValue) ? styleValue : [styleValue]
    const classIds: string[] = []
    const inlinePatches: string[] = []
    const staticBase = currentStyleStaticId(elementPath)
    const forceRolling = state.functionHostDepth > 0
    // CSR: FunctionHost in path ⇒ no shared static base (getStyleSheetId always rolling)
    const sharedStaticBaseId = forceRolling ? null : staticBase

    rawEntries.forEach((raw, index) => {
        if (raw == null || raw === false) return
        const isBound = !!(raw && (raw as any).__bound)
        const entryIsDynamic = typeof raw === 'function' || !!(raw && (raw as any).__dynamic)
        const evaluated = evaluateStyleSnapshot(raw)
        if (evaluated == null || evaluated === false) return
        const items = Array.isArray(evaluated) ? evaluated : [evaluated]

        for (const item of items) {
            if (item == null || typeof item === 'boolean') continue
            if (typeof item === 'string') {
                inlinePatches.push(item)
                continue
            }
            if (typeof item !== 'object') continue

            const {simpleStyles, nestedStyles} = splitStyleObject(item)
            const usesSheet = isBound || Object.keys(nestedStyles).length > 0
            if (!usesSheet) {
                // Pure inline (no nested/bound): snapshot atom/function values (no FOUC)
                const parts: string[] = []
                for (const sk in simpleStyles) {
                    const sv = (simpleStyles as any)[sk]
                    if (sv == null || sv === false || sv === '') continue
                    const cssVal = stringifyCssValue(sk, sv)
                    if (!cssVal) continue
                    const cssKey = (sk[0] === '-' && sk[1] === '-')
                        ? sk
                        : sk.replace(/([A-Z])/g, '-$1').toLowerCase()
                    parts.push(`${cssKey}:${cssVal}`)
                }
                if (parts.length) inlinePatches.push(parts.join(';'))
                continue
            }

            // Mirror CSR StyleManager: F31 reactive-in-stylesheet → isDynamic (I-itor);
            // FunctionHost path (forceRolling) only forces rolling base id, not I0.
            let isDynamic = entryIsDynamic || (usesSheet && containsReactiveStyleValue(item))
            // F30: shared static id content-signature divergence → rolling + I0
            if (usesSheet && !isDynamic && sharedStaticBaseId) {
                const sharedIdWithIndex = `${sharedStaticBaseId}F${index}`
                const signature = computeStyleSignature(item)
                const existingSignature = state.idToStaticStyleSignature.get(sharedIdWithIndex)
                if (signature === undefined || (existingSignature !== undefined && existingSignature !== signature)) {
                    isDynamic = true
                } else if (existingSignature === undefined) {
                    state.idToStaticStyleSignature.set(sharedIdWithIndex, signature)
                }
            }

            let styleSheetId: string
            if (isDynamic || forceRolling) {
                styleSheetId = `${staticBase}R${state.rollingSeq++}`
            } else {
                styleSheetId = sharedStaticBaseId ?? staticBase
            }
            // CSR first frame for isDynamic uses …F{i}I0; emit the same so hydrate reclaims one class
            const finalId = isDynamic ? `${styleSheetId}F${index}I0` : `${styleSheetId}F${index}`
            const rules = generateStyleContent(`.${finalId}`, item)
            const gated = gateStyleRules(rules)
            if (gated) {
                if (!state.sheets.has(finalId)) state.sheets.set(finalId, gated)
                classIds.push(finalId)
            }
        }
    })

    return {classIds, inline: inlinePatches.join(';')}
}

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

function parentTextMode(tag?: string): 'normal' | 'rcdata' | 'rawtext' {
    if (!tag) return 'normal'
    const t = tag.toLowerCase()
    if (RCDATA_TAGS.has(t)) return 'rcdata'
    if (RAWTEXT_TAGS.has(t)) return 'rawtext'
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

/** §3.6.2 SO: select value snapshot driving option `selected` (not a select content attr). */
type SelectSoCtx = {value: string | any[]}

function inputTypeOf(props: AttributesLike | null | undefined): string {
    const t = props?.type
    return t == null || t === false ? 'text' : String(t).toLowerCase()
}

function hasOwnProp(props: AttributesLike, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(props, key)
}

/** Snapshot select `value` for SO (≡ CSR `__axiiSelectValue__` / `applySelectValue`). */
function extractSelectSo(props: AttributesLike | null | undefined): SelectSoCtx | null {
    if (!props || !hasOwnProp(props, 'value')) return null
    let v = props.value
    if (isAtom(v)) v = v()
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
        let v = props.value
        if (isAtom(v)) v = v()
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
): string {
    if (!props) {
        if (optionSelectedBySo === true) return ' selected="true"'
        return ''
    }
    const tagLower = tag.toLowerCase()
    const type = inputTypeOf(props)
    const isCheckbox = tagLower === 'input' && type === 'checkbox'
    const isRadio = tagLower === 'input' && type === 'radio'
    const hasValue = hasOwnProp(props, 'value')
    const hasChecked = hasOwnProp(props, 'checked')

    let s = ''
    const skip = new Set<string>([
        'children', 'ref', 'key', '_isSVG', '__source', '__self', 'dangerouslySetInnerHTML',
        // style handled below (may be function/nested → stylesheet)
        'style',
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
    let inlineStyle = ''
    if (hasOwnProp(props, 'style') && props.style != null && props.style !== false) {
        const styleVal = props.style
        if (styleValueNeedsStylesheet(styleVal) || typeof styleVal === 'function' || Array.isArray(styleVal)) {
            const collected = collectElementStyles(styleVal, elementPath)
            styleExtraClasses.push(...collected.classIds)
            inlineStyle = collected.inline
        } else if (typeof styleVal === 'object') {
            // Simple inline object: snapshot atom/function values into style attr (Task req 1 / no FOUC)
            const parts: string[] = []
            for (const sk in styleVal) {
                const sv = (styleVal as any)[sk]
                if (sv == null || sv === false || sv === '') continue
                const cssVal = stringifyCssValue(sk, sv)
                if (!cssVal) continue
                const cssKey = (sk[0] === '-' && sk[1] === '-')
                    ? sk
                    : sk.replace(/([A-Z])/g, '-$1').toLowerCase()
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
        if (key[0] === 'o' && key[1] === 'n') continue // events — client only
        const value = props[key]
        if (value == null || value === false) continue
        if (typeof value === 'function' || isAtom(value)) continue // reactive — LightBinding on hydrate
        if (value === true) {
            s += ` ${key}="true"`
            continue
        }
        if (key === 'className' || key === 'class') {
            if (typeof value === 'object') {
                const parts: string[] = []
                for (const ck in value) {
                    if ((value as any)[ck]) parts.push(ck)
                }
                classAttr = parts.join(' ')
            } else {
                classAttr = String(value)
            }
            continue
        }
        if (key === 'selected' && tagLower === 'option') {
            if (value) s += ` selected="true"`
            continue
        }
        s += ` ${key}="${escapeAttr(String(value))}"`
    }

    const allClasses = [classAttr, ...styleExtraClasses].filter(Boolean).join(' ')
    if (allClasses) s += ` class="${escapeAttr(allClasses)}"`
    if (inlineStyle) s += ` style="${escapeAttr(inlineStyle)}"`

    // §3.6.2 deferred form props (IV / CK / CB)
    if (tagLower === 'input' && deferredKeys.length) {
        if (isCheckbox && hasValue) {
            // CB channel
            let finalChecked = false
            let appliedValue: any = props.value
            for (const key of deferredKeys) {
                if (key === 'value') {
                    appliedValue = props.value
                    finalChecked = !!props.value
                } else if (key === 'checked') {
                    finalChecked = !!props.checked
                }
            }
            const applied = appliedValue == null ? '' : appliedValue
            s += ` value="${escapeAttr(String(applied))}"`
            if (finalChecked) s += ` checked="true"`
        } else if ((isCheckbox || isRadio) && hasChecked && !hasValue) {
            // CK-only
            if (props.checked) s += ` checked="true"`
        } else {
            // IV (+ radio checked as separate)
            for (const key of deferredKeys) {
                const value = props[key]
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

function textareaChildText(props: AttributesLike | null | undefined, children: any[]): string {
    if (props && Object.prototype.hasOwnProperty.call(props, 'value')) {
        const v = props.value
        if (isAtom(v)) return stringValue(v())
        return stringValue(v)
    }
    if (children.length === 1) {
        const c = children[0]
        if (isAtom(c)) return stringValue(c())
        if (typeof c === 'string' || typeof c === 'number' || typeof c === 'bigint') return String(c)
    }
    return ''
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
    const tagLower = tag.toLowerCase()

    let optionSelectedBySo: boolean | null = null
    if (tagLower === 'option' && selectSo) {
        optionSelectedBySo = optionMatchesSo(optionEffectiveValue(el), selectSo)
    }

    const attrs = serializeAttrs(el.props, tag, optionSelectedBySo, elementPath)
    const dangerously = el.props?.dangerouslySetInnerHTML

    if (VOID_TAGS.has(tagLower)) {
        out.push('<', tag, attrs, '/>')
        return
    }

    out.push('<', tag, attrs, '>')
    if (dangerously && typeof dangerously === 'object' && '__html' in dangerously) {
        out.push(String((dangerously as {__html: string}).__html))
    } else if (tagLower === 'textarea') {
        const children = el.children.length
            ? el.children
            : (el.props?.children ? (Array.isArray(el.props.children) ? el.props.children : [el.props.children]) : [])
        const text = textareaChildText(el.props, children)
        out.push(escapeText(text))
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
    out.push('</', tag, '>')
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

function createSsrRenderContext(): RenderContext {
    const refs: {[k: string]: any} = {}
    const context: RenderContext = {
        createElement: createSsrElement as any,
        createSVGElement: ((type: string, props: any, ...children: any[]) =>
            createSsrElement(type, props ? {...props, _isSVG: true} : {_isSVG: true}, ...children)) as any,
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
        const ctx = createSsrRenderContext()
        const props: Props = {...(node.props || {})}
        if ((node.children && node.children.length) || props.children === undefined) {
            props.children = node.children
        }
        return (node.type as Component)(props, ctx)
    } finally {
        // Keep map on stack until serializeComponent finishes — caller pops
    }
}

function serializePortal(
    node: ComponentNode,
    out: string[],
): void {
    if (!ssrPortals) throw new Error('[axii/ssr] portals map not initialized')
    const props = node.props || {}
    const key = resolvePortalExportKey(props.container, props.portalKey)
    if (Object.prototype.hasOwnProperty.call(ssrPortals, key)) {
        throw new Error(`[axii/ssr] duplicate Portal key: ${JSON.stringify(key)}`)
    }

    // Main tree: EmptyHost element only; parent serializeChild adds <!--unhandledChild--> (§3.2.6 / §3.3.d)
    out.push('<!--empty-->')

    // Portal content under Portal ComponentHost path (style ids align with CSR createRoot(parentContext)).
    // Root Fragment ≡ CSR StaticHost(DocumentFragment): emit <!--fragment start--> (not element-child flatten).
    const state = ssrStyle
    const sheetsBefore = state ? new Set(state.sheets.keys()) : new Set<string>()
    pushSsrComponent(node.type as Function)
    const portalOut: string[] = []
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
        popSsrComponent()
    }

    const portalStyleParts: string[] = []
    if (state) {
        for (const [id, css] of state.sheets) {
            if (!sheetsBefore.has(id)) {
                portalStyleParts.push(css)
                state.sheets.delete(id)
            }
        }
    }
    const portalStyles = portalStyleParts.join('\n')
    if (portalStyles) assertNoRawTextTerminator(portalStyles, 'style')
    ssrPortals[key] = {html: portalOut.join(''), styles: portalStyles}
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
