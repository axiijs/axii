/**
 * Short-lived hydration claim context.
 * Active only while hydrateRoot runs; CSR steady-state pays at most a boolean read.
 */

import {isAtom, RxList} from "data0"
import {reportAxiiError} from "./diagnostics"

const claimedElements = new WeakSet<Element>()

/**
 * §3.7 hydration mismatch — expected vs actual at the claim cursor.
 * DEV/diagnostics: reported via reportAxiiError (structured / onError).
 * Production: same report path when onError is set; claim sites rebuild locally (CSR) without aborting the page.
 */
export class HydrationMismatchError extends Error {
    readonly code = 'AXII_HYDRATION_MISMATCH' as const
    readonly expected: string
    readonly actual: string

    constructor(expected: string, actual: string) {
        super(`[axii] hydration mismatch: expected ${expected}, got ${actual}`)
        this.name = 'HydrationMismatchError'
        this.expected = expected
        this.actual = actual
    }
}

/** Report §3.7 mismatch (never silent wrong bindings — caller must rebuild or abort). */
export function reportHydrationMismatch(expected: string, actual: string): HydrationMismatchError {
    const err = new HydrationMismatchError(expected, actual)
    // onError always; console structured path follows isAxiiDiagnosticsEnabled inside reportAxiiError.
    reportAxiiError(err)
    return err
}

function summarizeChild(node: ChildNode | null | undefined): string {
    if (!node) return 'eof'
    if (node.nodeType === Node.TEXT_NODE) return `Text(${JSON.stringify(node.nodeValue)})`
    if (node.nodeType === Node.COMMENT_NODE) return `Comment(${JSON.stringify((node as Comment).data)})`
    if (node.nodeType === Node.ELEMENT_NODE) return `Element(<${(node as Element).tagName.toLowerCase()}>)`
    return `nodeType=${node.nodeType}`
}

/**
 * Local CSR rebuild of a text unit at the child cursor (§3.7 production path).
 * Removes the mismatched node(s) at cursor (one unit), inserts a fresh Text, advances cursor.
 * Identity of the returned Text is always new (≠ pre-hydrate SSR node).
 */
function rebuildTextAtCursor(value: string, expectedDesc: string, actualDesc: string): Text {
    reportHydrationMismatch(expectedDesc, actualDesc)
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate rebuildTextAtCursor without element cursor')

    const node = currentChild()
    if (node) {
        // Drop one mismatched unit: axii:t pair, axii:0, or a single node
        if (isCommentData(node, 'axii:t')) {
            const open = node
            const text = open.nextSibling
            const close = text?.nextSibling ?? null
            open.remove()
            if (text) text.remove()
            if (close && isCommentData(close, 'axii:/t')) close.remove()
            else if (close) close.remove()
        } else {
            node.remove()
        }
        // After remove, childCursorIndex already points at the next sibling
    }

    const text = document.createTextNode(value)
    const before = parent.childNodes[childCursorIndex] ?? null
    parent.insertBefore(text, before)
    childCursorIndex++
    return text
}

let hydrating = false
let hydrateRootEl: ParentNode | null = null
/** hydrateRoot options.portals — key → already-filled container (§3.3.d) */
let hydratePortalEls: Record<string, HTMLElement> | undefined
/** Nested Portal hydrate: outer container stack while claiming portal subtree */
const hydrateRootStack: ParentNode[] = []
/** Per-element child cursor while processing that element's createElement children */
let childCursorParent: ParentNode | null = null
let childCursorIndex = 0
const childCursorStack: {parent: ParentNode, index: number}[] = []
/**
 * Depth of enterElementChildCursor / exitElementChildCursor only.
 * RxList/StaticArray setChildCursor must not count — otherwise Component/Function row
 * createElement would cursor-first against the list placeholder and steal/rebuild.
 */
let elementChildCursorDepth = 0

export function isHydrating(): boolean {
    return hydrating
}

/** Outermost hydrate root (not inside pushHydrateRoot / Portal container). */
export function isHydrateOnMainRoot(): boolean {
    return hydrating && hydrateRootStack.length === 0
}

export function beginHydration(container: ParentNode, portals?: Record<string, HTMLElement>): void {
    hydrating = true
    hydrateRootEl = container
    hydratePortalEls = portals
    hydrateRootStack.length = 0
    childCursorParent = null
    childCursorIndex = 0
    childCursorStack.length = 0
    elementChildCursorDepth = 0
}

export function endHydration(): void {
    hydrating = false
    hydrateRootEl = null
    hydratePortalEls = undefined
    hydrateRootStack.length = 0
    childCursorParent = null
    childCursorIndex = 0
    childCursorStack.length = 0
    elementChildCursorDepth = 0
}

/** Switch claim root to a Portal container; must be paired with popHydrateRoot. */
export function pushHydrateRoot(container: ParentNode): void {
    if (!hydrateRootEl) throw new Error('[axii] pushHydrateRoot without active hydration')
    hydrateRootStack.push(hydrateRootEl)
    hydrateRootEl = container
    childCursorParent = null
    childCursorIndex = 0
    childCursorStack.length = 0
    elementChildCursorDepth = 0
}

export function popHydrateRoot(): void {
    const prev = hydrateRootStack.pop()
    if (!prev) throw new Error('[axii] popHydrateRoot with empty stack')
    hydrateRootEl = prev
    childCursorParent = null
    childCursorIndex = 0
    childCursorStack.length = 0
    elementChildCursorDepth = 0
}

/**
 * Resolve Portal hydrate target: options.portals[key] first, else document.getElementById(key).
 * Throws when still missing (§3.3.d).
 */
export function resolveHydratePortalContainer(key: string): HTMLElement {
    const fromOpt = hydratePortalEls?.[key]
    if (fromOpt) return fromOpt
    const el = typeof document !== 'undefined' ? document.getElementById(key) : null
    if (!el) throw new Error(`[axii] hydrate Portal key "${key}" not found (pass options.portals or matching element id)`)
    return el
}

function isCommentData(node: Node | null | undefined, data: string): node is Comment {
    return !!node && node.nodeType === Node.COMMENT_NODE && (node as Comment).data === data
}

/** Carrier for HTML createElement that must claim under a later hydrate root (Portal). */
export const AXII_HYDRATE_DEFERRED = '__axiiHydrateDeferred'
/** Claimed under main root but destined for Portal — payload to rematerialize after unclaim. */
export const AXII_HYDRATE_RECLAIM = '__axiiHydrateReclaim'

export type HydrateDeferredPayload = {
    type: string
    rawProps: any
    rawChildren: any[]
}

export function isHydrateDeferredElement(el: unknown): boolean {
    return !!(el && typeof el === 'object' && (el as any)[AXII_HYDRATE_DEFERRED])
}

export function createHydrateDeferredElement(
    type: string,
    rawProps: any,
    rawChildren: any[],
): HTMLElement {
    // Detached stub — not claimed; materialize under the correct root via createElement.
    const stub = document.createElement(type)
    ;(stub as any)[AXII_HYDRATE_DEFERRED] = {type, rawProps, rawChildren} satisfies HydrateDeferredPayload
    return stub
}

export function takeHydrateDeferredPayload(el: Element): HydrateDeferredPayload {
    const payload = (el as any)[AXII_HYDRATE_DEFERRED] as HydrateDeferredPayload
    delete (el as any)[AXII_HYDRATE_DEFERRED]
    return payload
}

/** Peek without consuming — ensureHydrateDeferredPortalContent walks nested rawChildren. */
export function peekHydrateDeferredPayload(el: Element): HydrateDeferredPayload | null {
    return ((el as any)[AXII_HYDRATE_DEFERRED] as HydrateDeferredPayload | undefined) ?? null
}

export function markHydrateReclaimPayload(
    el: Element,
    type: string,
    rawProps: any,
    rawChildren: any[],
): void {
    ;(el as any)[AXII_HYDRATE_RECLAIM] = {type, rawProps, rawChildren} satisfies HydrateDeferredPayload
}

export function takeHydrateReclaimPayload(el: Element): HydrateDeferredPayload | null {
    const payload = (el as any)[AXII_HYDRATE_RECLAIM] as HydrateDeferredPayload | undefined
    if (!payload) return null
    delete (el as any)[AXII_HYDRATE_RECLAIM]
    return payload
}

export function unclaimHydrateElement(el: Element): void {
    claimedElements.delete(el)
}

function staticAttrId(props: any): string | null {
    if (!props || !Object.prototype.hasOwnProperty.call(props, 'id')) return null
    let v = props.id
    if (typeof v === 'function' && !isAtom(v)) return null
    if (isAtom(v)) v = v()
    if (v == null || v === false) return null
    return String(v)
}

/**
 * Eager DOM / host children mean this element's SSR node cannot be a bare Portal
 * EmptyHost-only site. Portal content evaluated under the main tree must defer until
 * hydratePortalContent (§3.3.d).
 *
 * Array / RxList count as defer-content (k17-audit D1). ComponentNode-only kids are
 * checked separately so layout parents that mix Portal + element siblings still claim.
 */
function hasPortalDeferContent(children: any[] | undefined): boolean {
    if (!children || !children.length) return false
    for (const c of children) {
        if (c == null || typeof c === 'boolean') continue
        if (isHydrateDeferredElement(c)) continue
        if (c instanceof RxList || Array.isArray(c)) return true
        // ComponentNode alone: handled by isComponentNodeOnly in candidateFitsChildren
        if (typeof c === 'object' && !(c instanceof Node) && typeof (c as any).type === 'function') {
            continue
        }
        const t = typeof c
        if (t === 'string' || t === 'number' || t === 'bigint' || t === 'function') return true
        if (typeof Node !== 'undefined' && c instanceof Node) return true
    }
    return false
}

function isComponentNodeOnlyChildren(children: any[] | undefined): boolean {
    if (!children || !children.length) return false
    let saw = false
    for (const c of children) {
        if (c == null || typeof c === 'boolean') continue
        if (typeof c === 'object' && !(c instanceof Node) && typeof (c as any).type === 'function') {
            saw = true
            continue
        }
        return false
    }
    return saw
}

/** True when every non-null child is a Portal ComponentNode (layout that is portal-only). */
function isPortalOnlyComponentChildren(children: any[] | undefined): boolean {
    if (!children || !children.length) return false
    let saw = false
    for (const c of children) {
        if (c == null || typeof c === 'boolean') continue
        if (typeof c === 'object' && !(c instanceof Node) && typeof (c as any).type === 'function') {
            if (!(c as any).type.__axiiPortal) return false
            saw = true
            continue
        }
        return false
    }
    return saw
}

/** True if `el` has a direct child Comment with the given data. */
function hasDirectComment(el: Element, data: string): boolean {
    const kids = el.childNodes
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i]
        if (n.nodeType === Node.COMMENT_NODE && (n as Comment).data === data) return true
    }
    return false
}

function candidateFitsChildren(el: Element, children: any[] | undefined): boolean {
    const deferContent = hasPortalDeferContent(children)
    const cnOnly = isComponentNodeOnlyChildren(children)
    if (!deferContent && !cnOnly) return true

    const first = el.firstChild
    if (first && first.nodeType === Node.COMMENT_NODE && (first as Comment).data === 'empty') {
        // Bare EmptyHost (no host markers): reject. G3-E keeps `rx list item`.
        if (!hasDirectComment(el, 'unhandledChild')
            && !hasDirectComment(el, 'rx list item')
            && !hasDirectComment(el, 'array item')) {
            return false
        }
    }
    // Text/atom portal content cannot claim an empty element (k16-audit).
    if (!first) return false

    // ComponentNode-only: need <!--unhandledChild-->.
    // Portal-only layout (`<div>{createPortal(...)}</div>`) starts with <!--empty--> — allow.
    // Non-Portal ComponentNode wrappers (eager portal content) must not steal that layout root.
    if (cnOnly) {
        if (!hasDirectComment(el, 'unhandledChild')) return false
        if (first.nodeType === Node.COMMENT_NODE && (first as Comment).data === 'empty'
            && !isPortalOnlyComponentChildren(children)) {
            return false
        }
        return true
    }

    // Structural host children need matching comments. Same-tag main siblings (plain text)
    // and Portal layout roots (`<!--empty--><!--unhandledChild-->…`) must not be claimed —
    // createElement would throw / steal before reclaim can run (k17-audit D1).
    for (let i = 0; i < (children?.length ?? 0); i++) {
        const c = children![i]
        if (c == null || typeof c === 'boolean') continue
        if (Array.isArray(c)) {
            if (hasDirectComment(el, 'array item')) continue
            // DirectNodes-only arrays end with unhandledChild but do not start with empty.
            if (hasDirectComment(el, 'unhandledChild')
                && !(first.nodeType === Node.COMMENT_NODE && (first as Comment).data === 'empty')) {
                continue
            }
            return false
        }
        if (c instanceof RxList) {
            if (hasDirectComment(el, 'rx list item')) continue
            if (hasDirectComment(el, 'unhandledChild')
                && !(first.nodeType === Node.COMMENT_NODE && (first as Comment).data === 'empty')) {
                continue
            }
            return false
        }
    }
    return true
}

/**
 * True when an earlier unclaimed Element sibling under the same parent blocks claiming `el`
 * (excluding STYLE/SCRIPT/LINK):
 * - Different tag → D4/D5/D6 interstitial / wrong-tag unit
 * - Same tag with `id !== wantId` (when wantId set) → D8 same-tag interstitial / D9 swap partner
 *
 * Children-first createElement (no cursor) must not deep-claim past such units.
 * Same-tag blockers: clear via blockedExact + removeEarlierBlockingSiblings.
 * Different-tag blockers: defer → cursor-first (D4/D6/middle) — do not early-claim later
 * siblings (would leave the wrong-tag role with nothing to rebuild against).
 *
 * Ignore STYLE/SCRIPT/LINK (SSR `<style data-axii-ssr>` sits before the app root).
 */
function hasBlockingEarlierSibling(el: Element, wantUpper: string, wantId: string | null): boolean {
    const parent = el.parentNode
    if (!parent) return false
    const kids = parent.childNodes
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i]
        if (n === el) return false
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        const sib = n as Element
        const tag = sib.tagName
        if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') continue
        if (claimedElements.has(sib)) continue
        if (tag !== wantUpper) return true
        if (wantId != null && sib.id !== wantId) return true
    }
    return false
}

/** Same-tag wrong-id earlier sibling only (D8/D9) — not different-tag (D4/D6). */
function hasSameTagWrongIdEarlierSibling(el: Element, wantUpper: string, wantId: string | null): boolean {
    if (wantId == null) return false
    const parent = el.parentNode
    if (!parent) return false
    const kids = parent.childNodes
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i]
        if (n === el) return false
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        const sib = n as Element
        if (sib.tagName === 'STYLE' || sib.tagName === 'SCRIPT' || sib.tagName === 'LINK') continue
        if (claimedElements.has(sib)) continue
        if (sib.tagName === wantUpper && sib.id !== wantId) return true
    }
    return false
}

/**
 * Remove earlier unclaimed same-tag wrong-id siblings that blocked an exact-id claim (D8),
 * so the exact match can be claimed without leaving orphan interstitial nodes.
 * Does not remove different-tag siblings (those stay on the D6 cursor-defer path).
 */
function removeEarlierSameTagWrongIdSiblings(el: Element, wantUpper: string, wantId: string): void {
    const parent = el.parentNode
    if (!parent) return
    const kids = Array.from(parent.childNodes)
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i]
        if (n === el) return
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        const sib = n as Element
        if (sib.tagName === 'STYLE' || sib.tagName === 'SCRIPT' || sib.tagName === 'LINK') continue
        if (claimedElements.has(sib)) continue
        if (sib.tagName === wantUpper && sib.id !== wantId) {
            sib.remove()
        }
    }
}

/**
 * True when `el` shares a parent with another unclaimed Element sibling whose tag ≠
 * `wantUpper` (excluding STYLE/SCRIPT/LINK). Used to block no-cursor wrongIdMiss from
 * claiming a same-tag wrong-id node that belongs to a different createElement role
 * (swapped tags: client span#a+p#b vs DOM p#a+span#b — D7).
 */
function hasConflictingUnclaimedSibling(el: Element, wantUpper: string): boolean {
    const parent = el.parentNode
    if (!parent) return false
    const kids = parent.childNodes
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i]
        if (n === el) continue
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        const sib = n as Element
        const tag = sib.tagName
        if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') continue
        if (claimedElements.has(sib)) continue
        if (tag !== wantUpper) return true
    }
    return false
}

/**
 * Remove child nodes from the active cursor up to (not including) `target`, then leave
 * the cursor on `target`. Used for interstitial junk before an exact-id same-tag claim (D6).
 */
function removeCursorNodesUntil(target: ChildNode): void {
    const parent = childCursorParent
    if (!parent) return
    while (true) {
        const n = parent.childNodes[childCursorIndex]
        if (!n || n === target) return
        n.remove()
        // Indices after removal: next node slides into childCursorIndex.
    }
}

/**
 * Claim a same-tag element at the active child cursor (§3.7 / milestone-review).
 * Same-tag at cursor:
 * - Exact id → claim (incl. empty / marker-miss shells).
 * - Wrong id + later exact-id same-tag → interstitial junk: remove until exact, claim (D8).
 * - Wrong id + no exact ahead → attribute drift on this unit (D2/D9).
 * Wrong tag at cursor:
 * - If it carries `wantId` → wrong-tag substitute of this role (D4/middle) → null (rebuild).
 * - Else if `wantId` is set → treat as interstitial junk: remove nodes until the next
 *   unclaimed same-tag with exact id, claim that (D6). No such candidate → null.
 * - No `wantId` → null (rebuild; never steal next same-tag — D5).
 */
function tryClaimElementAtCursor(
    tagName: string,
    upper: string,
    wantId: string | null,
    children?: any[],
): Element | null {
    const node = currentChild()
    if (!node) return null

    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (!claimedElements.has(el) && el.tagName === upper) {
            if (wantId != null && el.id !== wantId) {
                // Empty id → Portal EmptyHost defer.
                if (el.id === '') return null
                // Same-tag wrong id: prefer later exact-id (D8 interstitial) over drift.
                const parent = childCursorParent
                if (parent) {
                    const kids = parent.childNodes
                    for (let i = childCursorIndex + 1; i < kids.length; i++) {
                        const n = kids[i]
                        if (n.nodeType !== Node.ELEMENT_NODE) continue
                        const ahead = n as Element
                        if (claimedElements.has(ahead) || ahead.tagName !== upper) continue
                        if (ahead.id !== wantId) continue
                        reportHydrationMismatch(
                            `Element(<${tagName} id=${JSON.stringify(wantId)}>)`,
                            summarizeChild(node),
                        )
                        removeCursorNodesUntil(ahead)
                        claimedElements.add(ahead)
                        return ahead
                    }
                }
                // No exact ahead: attribute drift at this cursor site (D2 / D9).
                reportHydrationMismatch(
                    `Element(<${tagName} id=${JSON.stringify(wantId)}>)`,
                    `Element(<${tagName} id=${JSON.stringify(el.id)}>)`,
                )
                claimedElements.add(el)
                return el
            }
            if (wantId != null && el.id === wantId) {
                // Exact id: accept empty / marker-miss shells (D3).
                claimedElements.add(el)
                return el
            }
            if (candidateFitsChildren(el, children)) {
                claimedElements.add(el)
                return el
            }
            return null
        }

        // Wrong tag at cursor.
        if (wantId != null && el.id === wantId) {
            // Wrong-tag substitute of this role (D4 / middle) — rebuild, do not steal next.
            return null
        }
    }

    // Interstitial junk (D6): only with a static id — look ahead for exact-id same-tag.
    // Without wantId, looking ahead would steal the next sibling role (D5).
    if (wantId == null) return null

    const parent = childCursorParent
    if (!parent) return null
    const kids = parent.childNodes
    for (let i = childCursorIndex + 1; i < kids.length; i++) {
        const n = kids[i]
        if (n.nodeType !== Node.ELEMENT_NODE) continue
        const el = n as Element
        if (claimedElements.has(el) || el.tagName !== upper) continue
        if (el.id !== wantId) continue
        // Exact-id same-tag ahead: drop interstitial nodes, claim.
        reportHydrationMismatch(
            `Element(<${tagName} id=${JSON.stringify(wantId)}>)`,
            summarizeChild(node),
        )
        removeCursorNodesUntil(el)
        claimedElements.add(el)
        return el
    }
    return null
}

/**
 * Try to claim an unmatched element with matching tag.
 * Returns null when no compatible candidate exists (caller may defer for Portal content
 * that lives in options.portals, or locally CSR-rebuild under a parent child cursor — §3.7).
 *
 * Claim modes:
 * - **Active child cursor**: cursor-first only (`currentChild`). Wrong tag → null (no
 *   sibling steal). Same-tag wrong-id + exact ahead → interstitial remove (D8).
 * - **No cursor** (JSX children-before-parent, root, portal pushHydrateRoot): deepest
 *   unmatched same-tag in the hydrate root (ties: first in tree order), but **skip**
 *   candidates that sit after an earlier unclaimed wrong-tag or same-tag-wrong-id sibling
 *   (D4/D5/D8/D9). Blocked exact-id → remove blockers then claim (preserves exact identity).
 *
 * Id matching:
 * - Exact `id` match claims even when the element is empty (missing `axii:0` / Text-ph
 *   markers): claimEmptyTextPh / claimTextUnit rebuild under the child cursor.
 * - Static `id` prop with wrong-id same-tag at the claim site: claim the near-miss, report
 *   §3.7 mismatch; setAttribute reapplies the client id (no orphan + empty deferred).
 *   No-cursor wrongIdMiss is suppressed when a different-tag unclaimed sibling exists (D7).
 */
export function tryClaimElement(
    tagName: string,
    props?: any,
    children?: any[],
): Element | null {
    const root = hydrateRootEl
    if (!root) throw new Error('[axii] hydrate claimElement without active hydration')
    const upper = tagName.toUpperCase()
    const wantId = staticAttrId(props)

    // Cursor-first only inside enterElementChildCursor (element children), not list/array
    // setChildCursor — otherwise Component/Function rows rebuild against placeholders.
    if (elementChildCursorDepth > 0) {
        return tryClaimElementAtCursor(tagName, upper, wantId, children)
    }

    // No parent cursor: deep walk (children-first nested claim / root / portal).
    let best: Element | null = null
    let bestDepth = -1
    let blockedExact: Element | null = null
    let blockedExactDepth = -1
    let wrongIdMiss: Element | null = null
    let wrongIdDepth = -1

    function walk(node: Node, depth: number) {
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const el = node as Element
        if (!claimedElements.has(el) && el.tagName === upper) {
            const blocked = hasBlockingEarlierSibling(el, upper, wantId)
            if (wantId != null && el.id !== wantId) {
                // Attribute drift candidate — used only if no exact id match exists.
                // Skip when a different-tag unclaimed sibling exists (role swap — D7):
                // that node belongs to another createElement call; defer → cursor rebuild.
                if (!blocked && !hasConflictingUnclaimedSibling(el, upper) && depth > wrongIdDepth) {
                    wrongIdMiss = el
                    wrongIdDepth = depth
                }
            } else if (wantId != null && el.id === wantId) {
                // Strong id match: accept empty / marker-miss shells (D3); Text-ph rebuilds.
                if (!blocked) {
                    if (depth > bestDepth) {
                        best = el
                        bestDepth = depth
                    }
                } else if (hasSameTagWrongIdEarlierSibling(el, upper, wantId)
                    && depth > blockedExactDepth) {
                    // Exact id behind same-tag interstitial / swap partner (D8/D9).
                    // Different-tag blockers alone → leave deferred for cursor (D4/D6).
                    blockedExact = el
                    blockedExactDepth = depth
                }
            } else if (!blocked && candidateFitsChildren(el, children)) {
                if (depth > bestDepth) {
                    best = el
                    bestDepth = depth
                }
            }
        }
        const kids = el.childNodes
        for (let i = 0; i < kids.length; i++) {
            walk(kids[i], depth + 1)
        }
    }

    const top = root.childNodes
    for (let i = 0; i < top.length; i++) {
        walk(top[i], 0)
    }

    if (best) {
        claimedElements.add(best)
        return best
    }

    if (blockedExact && wantId != null) {
        // D8 same-tag interstitial / D9 swap: drop same-tag wrong-id blockers, keep exact
        // identity. For pure id-swap the removed earlier node is the other role — that role
        // rematerializes via local CSR under the parent cursor (§3.7).
        reportHydrationMismatch(
            `Element(<${tagName} id=${JSON.stringify(wantId)}>)`,
            `Element(<${tagName}> with same-tag interstitial/swap before exact id)`,
        )
        removeEarlierSameTagWrongIdSiblings(blockedExact, upper, wantId)
        claimedElements.add(blockedExact)
        return blockedExact
    }

    if (wrongIdMiss && wantId != null && (wrongIdMiss as Element).id !== '') {
        // Attribute drift (e.g. id tampered to a non-empty wrong value). Do NOT claim
        // EmptyHost / layout shells with empty id — those are Portal defer targets (k15/k16).
        reportHydrationMismatch(
            `Element(<${tagName} id=${JSON.stringify(wantId)}>)`,
            `Element(<${tagName} id=${JSON.stringify((wrongIdMiss as Element).id)}>)`,
        )
        claimedElements.add(wrongIdMiss)
        return wrongIdMiss
    }

    return null
}

/**
 * §3.7: element claim miss under an active parent child cursor → report + local CSR create.
 * Removes the mismatched child at the cursor (wrong tag / leftover SSR unit), inserts a
 * fresh element, leaves the cursor on that element so the parent `advancePastNode` finds it.
 * Must not be used without a parent cursor (Portal defer path returns null from tryClaim).
 */
export function createElementForHydrateMismatch(tagName: string, isSVG?: boolean): Element {
    const parent = childCursorParent
    if (!parent) {
        throw new Error('[axii] hydrate createElementForHydrateMismatch without element cursor')
    }
    reportHydrationMismatch(
        `Element(<${tagName}>)`,
        summarizeChild(currentChild()),
    )
    const node = currentChild()
    if (node) {
        // Drop one mismatched unit at cursor (wrong tag shell + leftover axii:t, etc.)
        node.remove()
    }
    const el = isSVG
        ? document.createElementNS('http://www.w3.org/2000/svg', tagName)
        : document.createElement(tagName)
    const before = parent.childNodes[childCursorIndex] ?? null
    parent.insertBefore(el, before)
    // Cursor stays on `el`; caller returns it and parent advancePastNode advances past.
    return el
}

/**
 * Claim the deepest unmatched element with matching tag (ties: first in tree order).
 * Matches JSX createElement evaluation order (children before parent).
 */
export function claimElement(tagName: string): Element {
    const best = tryClaimElement(tagName)
    if (!best) {
        throw new Error(`[axii] hydrate mismatch: no unmatched <${tagName}> to claim`)
    }
    return best
}

export function enterElementChildCursor(el: ParentNode): void {
    if (childCursorParent) {
        childCursorStack.push({parent: childCursorParent, index: childCursorIndex})
    }
    childCursorParent = el
    childCursorIndex = 0
    elementChildCursorDepth++
}

/** Set child cursor without stacking (RxList hydrate region restore). */
export function setChildCursor(parent: ParentNode, index: number): void {
    childCursorParent = parent
    childCursorIndex = index
}

export function getChildCursor(): {parent: ParentNode | null, index: number} {
    return {parent: childCursorParent, index: childCursorIndex}
}

/** True while createElement is processing an element's children (not list/array cursor). */
export function isElementChildCursorActive(): boolean {
    return elementChildCursorDepth > 0
}

/**
 * True when a host-structure Comment remains at/after the cursor. createElement may have
 * stopped on an inner `<!--unhandledChild-->` (e.g. Fragment boolean) while row markers /
 * outer host placeholders still lie ahead — stripping would delete Host content (D10 guard).
 */
function hasHostStructureAfterCursor(): boolean {
    const parent = childCursorParent
    if (!parent) return false
    const kids = parent.childNodes
    for (let i = childCursorIndex; i < kids.length; i++) {
        const n = kids[i]
        if (n.nodeType !== Node.COMMENT_NODE) continue
        const data = (n as Comment).data
        if (data === 'rx list item' || data === 'array item' || data === 'fragment start'
            || data === 'computed node' || data === 'empty' || data === 'reusable'
            || data === 'unhandledChild') {
            return true
        }
    }
    return false
}

/**
 * After element children are claimed, remove trailing unclaimed Element/Text still at
 * or after the cursor (§3.7 / D10). Structure Comments and already-claimed Elements
 * (plus STYLE/SCRIPT/LINK) stay; cursor advances past them so junk after is still cleared.
 * Skips entirely when host-structure markers remain (Host interval not finished).
 */
function removeTrailingOrphansAtCursor(): void {
    const parent = childCursorParent
    if (!parent) return
    if (hasHostStructureAfterCursor()) return
    let reported = false
    while (true) {
        const n = parent.childNodes[childCursorIndex]
        if (!n) return
        if (n.nodeType === Node.COMMENT_NODE) {
            childCursorIndex++
            continue
        }
        if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element
            const tag = el.tagName
            if (claimedElements.has(el) || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') {
                childCursorIndex++
                continue
            }
            if (!reported) {
                reportHydrationMismatch('end of element children', summarizeChild(n))
                reported = true
            }
            el.remove()
            continue
        }
        if (n.nodeType === Node.TEXT_NODE) {
            if (!reported) {
                reportHydrationMismatch('end of element children', summarizeChild(n))
                reported = true
            }
            n.remove()
            continue
        }
        childCursorIndex++
    }
}

/**
 * After hydrateRoot / hydratePortalContent claim, delete orphans on the hydrate
 * **container** itself (§3.7 / D11). Element-child trailing cleanup
 * (`removeTrailingOrphansAtCursor`) never runs on the container — the top-level Host
 * anchors on `<!--root-->` and does not `enterElementChildCursor(container)`.
 *
 * CSR `createRoot` leaves only the Host interval `[host.element … <!--root-->]`.
 * Remove:
 * - leading nodes before `host.element` (skip STYLE/SCRIPT/LINK)
 * - everything after the root placeholder
 *
 * Do **not** strip Elements between `host.element` and the placeholder by
 * `claimedElements`: Compact / Fragment portal rows may sit in that span without a
 * claim mark (RxList Compact advances past already-built nodes). StaticHost
 * `insertBefore(element, placeholder)` moves the app root to just before
 * `<!--root-->`, so interstitial junk that was between app root and root becomes
 * leading and is cleared above. Call after `migrateSsrStyleTags` so leftover
 * STYLE/SCRIPT/LINK (no longer `data-axii-ssr`) are treated as orphans (D13).
 * Claim-period deep scans may still skip those tags; this post-migrate pass must not.
 */
export function removeHydrateContainerOrphans(
    container: ParentNode,
    host: {element: Node, placeholder: Node},
): void {
    const first = host.element
    const ph = host.placeholder
    let reported = false
    const reportOnce = (n: ChildNode) => {
        if (!reported) {
            reportHydrationMismatch('hydrate root children', summarizeChild(n))
            reported = true
        }
    }

    // Trailing: nothing belongs after <!--root-->.
    while (ph.parentNode === container && ph.nextSibling) {
        const n = ph.nextSibling as ChildNode
        reportOnce(n)
        n.remove()
    }

    // Leading: before host.element (app root / fragment start / empty / text).
    // After migrate, STYLE/SCRIPT/LINK are orphans — do not skip (D13).
    if (first.parentNode === container) {
        let i = 0
        while (i < container.childNodes.length) {
            const n = container.childNodes[i]
            if (n === first) break
            reportOnce(n)
            n.remove()
            // do not advance — next sibling slid into i
        }
    }
}

export function exitElementChildCursor(): void {
    // D10: claim path only clears interstitial/ahead blockers; trailing siblings never claimed.
    removeTrailingOrphansAtCursor()
    if (elementChildCursorDepth > 0) elementChildCursorDepth--
    const prev = childCursorStack.pop()
    if (prev) {
        childCursorParent = prev.parent
        childCursorIndex = prev.index
    } else {
        childCursorParent = null
        childCursorIndex = 0
    }
}

function currentChild(): ChildNode | null {
    const parent = childCursorParent
    if (!parent) return null
    return parent.childNodes[childCursorIndex] ?? null
}

function advanceChild(): void {
    childCursorIndex++
}

/** Skip an already-claimed element child that JSX appended as a Node argument. */
export function advancePastNode(node: Node): void {
    const parent = childCursorParent
    if (!parent) return
    const children = parent.childNodes
    for (let i = childCursorIndex; i < children.length; i++) {
        if (children[i] === node) {
            childCursorIndex = i + 1
            return
        }
    }
}

function removeAxiiBoundaryPair(open: Comment, close: Comment): void {
    open.remove()
    close.remove()
}

/**
 * Claim ElementChildText or Text-ph non-empty unit (optional axii:t wrappers).
 * Returns the Text node; strips boundaries immediately.
 * §3.7: value/structure mismatch → report + local CSR Text rebuild (new identity).
 */
export function claimTextUnit(expected?: string): Text {
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate claimTextUnit without element cursor')

    let node = currentChild()
    if (!node) {
        if (expected !== undefined) {
            return rebuildTextAtCursor(expected, `Text(${JSON.stringify(expected)})`, 'eof')
        }
        throw new Error('[axii] hydrate mismatch: expected text unit')
    }

    if (isCommentData(node, 'axii:t')) {
        const open = node as Comment
        advanceChild()
        const text = currentChild()
        if (!text || text.nodeType !== Node.TEXT_NODE) {
            // Rewind conceptually: rebuild from the open comment still at previous index
            childCursorIndex--
            return rebuildTextAtCursor(
                expected ?? '',
                expected !== undefined ? `Text(${JSON.stringify(expected)})` : 'Text',
                summarizeChild(text),
            )
        }
        advanceChild()
        const close = currentChild()
        if (!close || !isCommentData(close, 'axii:/t')) {
            childCursorIndex -= 2
            return rebuildTextAtCursor(
                expected ?? (text as Text).nodeValue ?? '',
                expected !== undefined ? `Text(${JSON.stringify(expected)})` : 'axii:t pair',
                summarizeChild(close),
            )
        }
        advanceChild()
        const textNode = text as Text
        const closeComment = close as Comment
        removeAxiiBoundaryPair(open, closeComment)
        childCursorIndex -= 2
        if (expected !== undefined && textNode.nodeValue !== expected) {
            // Boundaries already stripped; replace Text identity (§3.7)
            reportHydrationMismatch(
                `Text(${JSON.stringify(expected)})`,
                `Text(${JSON.stringify(textNode.nodeValue)})`,
            )
            const replacement = document.createTextNode(expected)
            parent.replaceChild(replacement, textNode)
            return replacement
        }
        return textNode
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text
        advanceChild()
        if (expected !== undefined && textNode.nodeValue !== expected) {
            reportHydrationMismatch(
                `Text(${JSON.stringify(expected)})`,
                `Text(${JSON.stringify(textNode.nodeValue)})`,
            )
            const replacement = document.createTextNode(expected)
            parent.replaceChild(replacement, textNode)
            return replacement
        }
        return textNode
    }

    if (expected !== undefined) {
        return rebuildTextAtCursor(
            expected,
            `Text(${JSON.stringify(expected)})`,
            summarizeChild(node),
        )
    }
    throw new Error('[axii] hydrate mismatch: expected Text or axii:t unit')
}

/**
 * Text-ph empty: <!--axii:0--> → insert Text('') before sentinel, remove sentinel.
 * §3.7: missing sentinel → report + insert fresh Text('') at cursor.
 */
export function claimEmptyTextPh(): Text {
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate claimEmptyTextPh without element cursor')

    const node = currentChild()
    if (!node || !isCommentData(node, 'axii:0')) {
        return rebuildTextAtCursor('', 'Comment("axii:0")→Text("")', summarizeChild(node))
    }
    const sentinel = node as Comment
    const text = document.createTextNode('')
    parent.insertBefore(text, sentinel)
    sentinel.remove()
    childCursorIndex++
    return text
}

/**
 * Peek whether current child is empty Text-ph sentinel.
 */
export function peekAxii0(): boolean {
    const node = currentChild()
    return !!node && isCommentData(node, 'axii:0')
}

/** Advance child cursor until current node is Comment(data); do not consume it. */
export function advanceCursorUntilComment(data: string): void {
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate advanceCursorUntilComment without cursor')
    const children = parent.childNodes
    while (childCursorIndex < children.length) {
        if (isCommentData(children[childCursorIndex], data)) return
        childCursorIndex++
    }
    throw new Error(`[axii] hydrate mismatch: <!--${data}--> not found from cursor`)
}

/**
 * Advance to the element-child RxList Host placeholder `<!--unhandledChild-->`.
 * Row content may itself contain `<!--unhandledChild-->` (Fragment boolean / PrimitiveHost);
 * those always appear *before* their row's `<!--rx list item-->`. The list Host placeholder
 * is the first `<!--unhandledChild-->` immediately after `<!--rx list item-->`, or — when the
 * list is empty / Compact-only (no row markers) — the first `<!--unhandledChild-->`.
 */
export function advanceCursorUntilRxListHostPlaceholder(): void {
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate advanceCursorUntilRxListHostPlaceholder without cursor')
    const children = parent.childNodes
    const start = childCursorIndex
    for (let i = start; i < children.length; i++) {
        if (!isCommentData(children[i], 'unhandledChild')) continue
        const prev = i > 0 ? children[i - 1] : null
        if (prev && isCommentData(prev, 'rx list item')) {
            childCursorIndex = i
            return
        }
    }
    // Empty or Compact-only: no row marker before the host placeholder.
    advanceCursorUntilComment('unhandledChild')
}

/**
 * Scan from cursor for FTS pattern: … <!--computed node--> <!--axii:0-->
 * Advances cursor to the axii:0, claims it as FunctionHost Text placeholder.
 * Content + computed stay for FunctionHost / claimElement / claimComputedNode.
 */
export function claimFunctionTextPlaceholder(): Text {
    const parent = childCursorParent
    if (!parent) throw new Error('[axii] hydrate claimFunctionTextPlaceholder without cursor')

    const children = parent.childNodes
    // Look ahead for computed + axii:0 (FTS structure)
    for (let i = childCursorIndex; i < children.length; i++) {
        if (isCommentData(children[i], 'computed node')) {
            const next = children[i + 1]
            if (isCommentData(next, 'axii:0')) {
                childCursorIndex = i + 1
                return claimEmptyTextPh()
            }
        }
    }

    // Text state H1: axii:0 or text unit at cursor
    if (peekAxii0()) return claimEmptyTextPh()
    return claimTextUnit()
}

/**
 * Claim Comment `data==='computed node'` immediately before `before` (FunctionHost.placeholder).
 */
export function claimComputedNodeBefore(before: Node): Comment {
    const prev = before.previousSibling
    if (!isCommentData(prev, 'computed node')) {
        throw new Error('[axii] hydrate mismatch: expected <!--computed node--> before FunctionHost placeholder')
    }
    return prev as Comment
}

/**
 * Claim <!--fragment start--> immediately before first content / or at cursor under parent.
 * When hydrating StaticHost(DocumentFragment), the comment is already in the parent of placeholder.
 */
export function claimFragmentStartBefore(before: Node): Comment {
    // Walk left from `before` skipping content that belongs to the fragment until fragment start
    // Simpler: previous structure — fragment start is the first node of the fragment region.
    // For FunctionHost FTS: [fragment start, ...content, computed, placeholder]
    // Find the fragment start that is a sibling before `before`, after walking back past content.
    let node: ChildNode | null = before.previousSibling
    // Skip computed node if present (caller may pass placeholder which has computed as prev)
    if (isCommentData(node, 'computed node')) {
        node = node.previousSibling
    }
    // Walk back to find fragment start — content nodes are between start and computed
    let found: Comment | null = null
    while (node) {
        if (isCommentData(node, 'fragment start')) {
            found = node as Comment
            break
        }
        node = node.previousSibling
    }
    if (!found) {
        throw new Error('[axii] hydrate mismatch: expected <!--fragment start-->')
    }
    return found
}

/**
 * Claim EmptyHost element Comment('empty') immediately before its outer placeholder.
 */
export function claimEmptyHostCommentBefore(placeholder: Comment): Comment {
    const prev = placeholder.previousSibling
    if (isCommentData(prev, 'empty')) {
        return prev as Comment
    }
    throw new Error('[axii] hydrate mismatch: expected <!--empty--> before EmptyHost placeholder')
}

/**
 * Claim EmptyHost element Comment('empty') from the hydrate root (sibling of <!--root-->).
 * Prefer claimEmptyHostCommentBefore when placeholder is known (list rows).
 */
export function claimEmptyHostComment(): Comment {
    const root = hydrateRootEl
    if (!root) throw new Error('[axii] hydrate claimEmptyHostComment without active hydration')
    const children = root.childNodes
    for (let i = 0; i < children.length; i++) {
        const n = children[i]
        if (isCommentData(n, 'empty') && n.nextSibling && isCommentData(n.nextSibling as ChildNode, 'root')) {
            return n as Comment
        }
        if (isCommentData(n, 'empty')) {
            // Also allow empty before other placeholders (array item etc.)
            return n as Comment
        }
    }
    throw new Error('[axii] hydrate mismatch: expected <!--empty-->')
}

/**
 * Find and return the <!--root--> comment under container (must already exist).
 */
export function findRootComment(container: ParentNode): Comment {
    const children = container.childNodes
    for (let i = children.length - 1; i >= 0; i--) {
        const n = children[i]
        if (isCommentData(n, 'root')) return n as Comment
    }
    throw new Error('[axii] hydrate mismatch: container missing <!--root-->')
}

/**
 * Build Text-ph placeholder during hydrate createElement for atom child.
 */
export function claimAtomTextPlaceholder(value: string): Text {
    if (value === '') {
        return claimEmptyTextPh()
    }
    return claimTextUnit(value)
}

/**
 * Claim a structural Comment with exact data at the current child cursor (or search from cursor).
 */
export function claimCommentAtCursor(data: string): Comment {
    const node = currentChild()
    if (!isCommentData(node, data)) {
        throw new Error(`[axii] hydrate mismatch: expected <!--${data}-->`)
    }
    advanceChild()
    return node as Comment
}

/**
 * Claim text before a Comment placeholder (AtomHost / PrimitiveHost / FunctionHost Comment-ph).
 * Handles optional axii:t wrappers (strip immediately); empty Comment-ph has no text (insert Text).
 * §3.7 / D12: when `expected` is provided and the claimed Text value differs, report
 * HydrationMismatchError and replace with a fresh Text (new identity) — aligned with claimTextUnit.
 */
export function claimTextBeforeCommentPlaceholder(placeholder: Comment, expected?: string): Text {
    const parent = placeholder.parentNode!
    let prev = placeholder.previousSibling
    if (isCommentData(prev, 'axii:/t')) {
        const close = prev as Comment
        const text = close.previousSibling
        const open = text?.previousSibling
        if (!text || text.nodeType !== Node.TEXT_NODE || !isCommentData(open, 'axii:t')) {
            throw new Error('[axii] hydrate mismatch: malformed axii:t pair before Comment placeholder')
        }
        ;(open as Comment).remove()
        close.remove()
        return reconcileCommentPhText(text as Text, expected, parent)
    }
    if (!prev || prev.nodeType === Node.COMMENT_NODE) {
        // Empty Comment-ph: HTML omitted Text. Non-empty expected → missing text = mismatch (D12).
        if (expected !== undefined && expected !== '') {
            reportHydrationMismatch(
                `Text(${JSON.stringify(expected)})`,
                'eof',
            )
            const replacement = document.createTextNode(expected)
            parent.insertBefore(replacement, placeholder)
            return replacement
        }
        const text = document.createTextNode('')
        parent.insertBefore(text, placeholder)
        return text
    }
    if (prev.nodeType === Node.TEXT_NODE) {
        return reconcileCommentPhText(prev as Text, expected, parent)
    }
    throw new Error('[axii] hydrate mismatch: expected Text before Comment placeholder')
}

function reconcileCommentPhText(textNode: Text, expected: string | undefined, parent: ParentNode): Text {
    if (expected !== undefined && textNode.nodeValue !== expected) {
        reportHydrationMismatch(
            `Text(${JSON.stringify(expected)})`,
            `Text(${JSON.stringify(textNode.nodeValue)})`,
        )
        const replacement = document.createTextNode(expected)
        parent.replaceChild(replacement, textNode)
        return replacement
    }
    return textNode
}

/**
 * DirectNodes: claim text unit or axii:0 into an array (StaticArrayHost).
 */
export function claimDirectNodeText(): Text {
    if (peekAxii0()) return claimEmptyTextPh()
    return claimTextUnit()
}

/**
 * Strip leftover `<!--axii:t-->` / `<!--axii:/t-->` pairs between `start` and `end` (exclusive).
 * Used when Fragment children were created before a parent child-cursor existed, so
 * claimTextUnit could not run during createElement.
 */
export function stripAxiiTextBoundariesBetween(start: Node, end: Node): void {
    let node: ChildNode | null = start.nextSibling
    while (node && node !== end) {
        if (isCommentData(node, 'axii:t')) {
            const open = node
            const text = open.nextSibling
            const close = text?.nextSibling ?? null
            const after = close?.nextSibling ?? null
            if (text && text.nodeType === Node.TEXT_NODE && isCommentData(close, 'axii:/t')) {
                open.remove()
                close!.remove()
                node = after
                continue
            }
        }
        if (isCommentData(node, 'axii:0')) {
            const parent = node.parentNode
            if (parent) {
                const text = document.createTextNode('')
                parent.insertBefore(text, node)
                const next = node.nextSibling
                node.remove()
                node = next
                continue
            }
        }
        node = node.nextSibling
    }
}

/**
 * Walk one Fragment children list under the active parent cursor, assigning
 * real placeholders via `assignPlaceholder` (outer Fragment's lifted unhandledChildren).
 * Nested DocumentFragments are flattened in CSR (appendChild moves contents); SSR emits
 * no second `<!--fragment start-->` for element-child Fragment — recurse hydrate children.
 */
function walkFragmentHydrateChildren(
    children: any[],
    assignPlaceholder: (ph: Comment | Text) => void,
): void {
    for (let index = 0; index < children.length; index++) {
        const child = children[index]
        if (child == null) continue

        const childType = typeof child
        if (childType === 'string' || childType === 'number' || childType === 'bigint') {
            const text = child.toString()
            if (text === '') {
                if (peekAxii0()) claimEmptyTextPh()
            } else {
                claimTextUnit(text)
            }
        } else if (childType === 'boolean') {
            // PrimitiveHost Comment-ph: empty content omitted in HTML; claim <!--unhandledChild-->.
            // PrimitiveHost.render inserts Text('') before the Comment (claimTextBeforeCommentPlaceholder).
            assignPlaceholder(claimCommentAtCursor('unhandledChild'))
        } else if (child instanceof DocumentFragment) {
            // Nested Fragment: contents already under parent; DF itself is not a sibling.
            // Recurse into deferred hydrate children so lifted unhandled (atom/fn/…) bind.
            const nested = (child as any).__axiiFragmentHydrateChildren as any[] | undefined
            delete (child as any).__axiiFragmentHydrateChildren
            if (nested?.length) {
                walkFragmentHydrateChildren(nested, assignPlaceholder)
            }
        } else if (child instanceof Node) {
            // Element already claimElement'd during arg eval; advance so later claims stay aligned.
            advancePastNode(child)
        } else if (typeof child === 'function') {
            if (isAtom(child)) {
                const snapshot = child()
                // Same stringValue semantics as AtomHost / ssr.ts (toString-less objects → JSON)
                const text = (snapshot === undefined || snapshot === null || typeof snapshot === 'boolean')
                    ? ''
                    : String((snapshot as any)?.toString ? (snapshot as any).toString() : JSON.stringify(snapshot))
                assignPlaceholder(claimAtomTextPlaceholder(text))
            } else {
                assignPlaceholder(claimFunctionTextPlaceholder())
            }
        } else if (Array.isArray(child)) {
            // Same as createElement array hydrate, with cursor already in the fragment region.
            // Must stash DirectNodes — StaticArrayHost no-stash findArrayContentStart would
            // walk past <!--fragment start--> (not an array-region boundary).
            const hydrateDirectNodes: Text[] = []
            for (const item of child) {
                const it = typeof item
                if (it === 'string' || it === 'number' || it === 'bigint') {
                    hydrateDirectNodes.push(claimDirectNodeText())
                } else if (typeof item === 'function') {
                    advanceCursorUntilComment('array item')
                    const itemPh = claimCommentAtCursor('array item')
                    ;((child as any).__axiiHydrateItemHosts ||= []).push({
                        placeholder: itemPh,
                        child: item,
                        path: [index],
                    })
                } else if (item instanceof Node) {
                    if (item instanceof DocumentFragment) {
                        advanceCursorUntilComment('array item')
                    } else {
                        advancePastNode(item)
                    }
                    const itemPh = claimCommentAtCursor('array item')
                    ;((child as any).__axiiHydrateItemHosts ||= []).push({
                        placeholder: itemPh,
                        child: item,
                        path: [index],
                    })
                } else if (item instanceof RxList) {
                    const cursor = getChildCursor()
                    ;(item as any).__axiiHydrateListParent = cursor.parent
                    ;(item as any).__axiiHydrateListStart = cursor.index
                    advanceCursorUntilComment('array item')
                    const itemPh = claimCommentAtCursor('array item')
                    ;((child as any).__axiiHydrateItemHosts ||= []).push({
                        placeholder: itemPh,
                        child: item,
                        path: [index],
                    })
                } else if (item != null && typeof item === 'object') {
                    advanceCursorUntilComment('array item')
                    const itemPh = claimCommentAtCursor('array item')
                    ;((child as any).__axiiHydrateItemHosts ||= []).push({
                        placeholder: itemPh,
                        child: item,
                        path: [index],
                    })
                } else {
                    throw new Error('[axii] hydrate Fragment array item type not supported')
                }
            }
            ;(child as any).__axiiHydrateDirectNodes = hydrateDirectNodes
            assignPlaceholder(claimCommentAtCursor('unhandledChild'))
        } else if (child instanceof RxList) {
            const cursor = getChildCursor()
            ;(child as any).__axiiHydrateListParent = cursor.parent
            ;(child as any).__axiiHydrateListStart = cursor.index
            advanceCursorUntilRxListHostPlaceholder()
            assignPlaceholder(claimCommentAtCursor('unhandledChild'))
        } else {
            // ComponentNode / other object — content already before <!--unhandledChild-->
            advanceCursorUntilComment('unhandledChild')
            assignPlaceholder(claimCommentAtCursor('unhandledChild'))
        }
    }
}

function assignFragmentHydratePlaceholders(
    frag: DocumentFragment,
    children: any[],
): void {
    const unhandled = (frag as {unhandledChildren?: {placeholder: Comment | Text, child: any}[]}).unhandledChildren
    let uIdx = 0

    const assignPlaceholder = (ph: Comment | Text) => {
        if (!unhandled || uIdx >= unhandled.length) {
            throw new Error('[axii] hydrate Fragment reconcile: unhandledChildren mismatch')
        }
        unhandled[uIdx].placeholder = ph
        uIdx++
    }

    walkFragmentHydrateChildren(children, assignPlaceholder)
}

/**
 * After claimFragmentStartBefore: walk Fragment children with a cursor in
 * [fragmentStart, placeholder) and assign real placeholders onto unhandledChildren.
 * createElement(Fragment) must not claim via the parent list/array cursor (or with no cursor).
 */
export function reconcileFragmentHydrateChildren(
    frag: DocumentFragment,
    fragmentStart: Comment,
    placeholder: Node,
): void {
    const children = (frag as any).__axiiFragmentHydrateChildren as any[] | undefined
    delete (frag as any).__axiiFragmentHydrateChildren
    if (!children?.length) return

    const parent = placeholder.parentNode
    if (!parent) {
        throw new Error('[axii] hydrate Fragment reconcile without parent')
    }
    const kids = parent.childNodes
    let startIdx = -1
    for (let i = 0; i < kids.length; i++) {
        if (kids[i] === fragmentStart) {
            startIdx = i + 1
            break
        }
    }
    if (startIdx < 0) {
        throw new Error('[axii] hydrate Fragment reconcile: fragment start not in parent')
    }
    setChildCursor(parent, startIdx)

    assignFragmentHydratePlaceholders(frag, children)
}

/**
 * Element-child Fragment flatten path (no `<!--fragment start-->`).
 * SSR flattens into the parent element; createElement(Fragment) only deferred stubs.
 * Call while the parent element's child cursor is active so walk claims under that parent.
 */
export function reconcileFlattenedFragmentHydrateChildren(frag: DocumentFragment): void {
    const children = (frag as any).__axiiFragmentHydrateChildren as any[] | undefined
    delete (frag as any).__axiiFragmentHydrateChildren
    if (!children?.length) return

    if (!childCursorParent) {
        throw new Error('[axii] hydrate flattened Fragment reconcile without parent cursor')
    }

    assignFragmentHydratePlaceholders(frag, children)
}
