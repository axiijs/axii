/**
 * 激活（hydrateRoot）期间的短暂状态与共用的报告 / 工具函数。只在 hydrateRoot 运行期间有效；CSR 稳态至多付一次布尔读。
 * 认领模型（自顶向下，#55，docs/ssr-support/hydration-top-down.md）：游标与 R1–R5 在 hydrationCursor.ts，
 * 延迟描述在 hydrationElement.ts，入口是 hydrateRoot.ts。
 */

import {isAtom} from "data0"
import {isAxiiDiagnosticsEnabled, reportAxiiError} from "./diagnostics"
import {RAWTEXT_TAGS, RCDATA_TAGS} from "./markupNames"

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

/**
 * #55 §4.4 开发期不变量（只在诊断开启时检查）：激活结束后，Host 区间不可达、placeholder 还是 slot 常量、
 * 残留 axii:* 标记。只报告（reportAxiiError），不抛出。
 */
export class HydrationInvariantError extends Error {
    readonly code = 'AXII_HYDRATION_INVARIANT' as const
    readonly cause?: unknown
    constructor(detail: string, cause?: unknown) {
        super(`[axii] hydration invariant broken: ${detail} (AXII_HYDRATION_INVARIANT)`)
        this.name = 'HydrationInvariantError'
        if (cause !== undefined) this.cause = cause
    }
}

/**
 * #55 B4 只在开发期（诊断开启时）出现的报告（设计 §3.4、§2.6.8、§4.1、C10）。它们不是失配：结构已经与 CSR 相同，
 * 报告的是「这里的写法在激活中有代价或者有风险」。经 reportAxiiError 交给 onError，不抛出；生产环境不检测、不分配。
 *  - AXII_HYDRATION_ELEMENT_ACCESS：激活期间的 JSX 结果（描述）被当作节点读写（§3.1.1）；
 *  - AXII_HYDRATION_ELEMENT_LATE_RENDER：激活中建好、没有被渲染的描述在激活之后才第一次渲染，按 CSR 物化（C10）；
 *  - AXII_HYDRATION_LIVE_NODE：激活之外创建的现成节点按 CSR 插入，这个位置的服务端节点没有被复用（§2.6.8）；
 *  - AXII_HYDRATION_ATTRIBUTE_RESIDUE：干净认领的元素上有客户端 props 不写的服务端属性（§4.1「属性的边界」）。
 */
export type HydrationDevReportCode =
    | 'AXII_HYDRATION_ELEMENT_ACCESS'
    | 'AXII_HYDRATION_ELEMENT_LATE_RENDER'
    | 'AXII_HYDRATION_LIVE_NODE'
    | 'AXII_HYDRATION_ATTRIBUTE_RESIDUE'

export class HydrationDevReport extends Error {
    readonly code: HydrationDevReportCode
    constructor(code: HydrationDevReportCode, detail: string) {
        super(`[axii] ${detail} (${code})`)
        this.name = 'HydrationDevReport'
        this.code = code
    }
}

/** Report §3.7 mismatch (never silent wrong bindings — caller must rebuild or abort). */
export function reportHydrationMismatch(expected: string, actual: string): HydrationMismatchError {
    const err = new HydrationMismatchError(expected, actual)
    // onError always; console structured path follows isAxiiDiagnosticsEnabled inside reportAxiiError.
    reportAxiiError(err)
    return err
}

export function summarizeChild(node: ChildNode | null | undefined): string {
    if (!node) return 'eof'
    if (node.nodeType === Node.TEXT_NODE) return `Text(${JSON.stringify(node.nodeValue)})`
    if (node.nodeType === Node.COMMENT_NODE) return `Comment(${JSON.stringify((node as Comment).data)})`
    if (node.nodeType === Node.ELEMENT_NODE) return `Element(<${(node as Element).tagName.toLowerCase()}>)`
    return `nodeType=${node.nodeType}`
}

/**
 * 激活状态（#55 §7.1 第 2 点）：hydrateRoot 运行期间为 true。createElement 在开头读一次（为 true 时返回描述），
 * FunctionHost 在首次运行时读一次（认领），用户回调（useEffect、root.dispatch）据此退出激活上下文，
 * 滚动样式 id 据此从服务端写出的类上回收。
 */
let hydrating = false
let claimedRollingStyleBases: WeakMap<Element, string> | undefined

export function isHydrating(): boolean {
    return hydrating
}

/**
 * 激活的开始 / 结束（hydrateRoot.ts）。
 * 返回之前的状态交给 endHydration 恢复（回调里嵌套的激活返回后，外层照常继续）。
 */
type HydrationState = {hydrating: boolean, rollingStyleBases: WeakMap<Element, string> | undefined, devProxy: boolean}

// 激活期间 createElement 返回开发期 Proxy 还是描述本身（§3.4）：激活开始时按 isAxiiDiagnosticsEnabled() 定一次，
//  同一次激活内不变
let devProxy = false

export function beginHydration(): HydrationState {
    const saved = {hydrating, rollingStyleBases: claimedRollingStyleBases, devProxy}
    hydrating = true
    claimedRollingStyleBases = undefined
    devProxy = isAxiiDiagnosticsEnabled()
    return saved
}

/** 见 beginHydration。 */
export function endHydration(saved: HydrationState): void {
    hydrating = saved.hydrating
    claimedRollingStyleBases = saved.rollingStyleBases
    devProxy = saved.devProxy
}

/** @internal 这次激活里 createElement 是否返回开发期 Proxy（只在 createElement 的激活分支里读）。 */
export function isHydrationDevProxy(): boolean {
    return devProxy
}

// CAUTION 激活上下文只属于框架自己的渲染路径（组件函数体、各 Host 的 hydrate）。
//  用户回调——useEffect / useLayoutEffect、ref、root.on(...) 监听器、onError——虽然是在 hydrateRoot 的
//  同步过程里被调用的，但它们里面的 createElement / createRoot().render() 是在创建新的 DOM
//  （弹层、toast、命令式挂载的子树），不是在认领服务端节点：不退出上下文的话，这些 createElement 返回的是描述，
//  不是节点。这里关掉标志位，回调里甚至可以再完整地跑一次 hydrateRoot（begin / end 保存并恢复状态），
//  返回后原样恢复、外层激活继续。游标在 hydrationCursor.ts 里按栈保存，回调里再跑一次激活只压入自己的一层、返回前弹出。
export function runOutsideHydration<T>(run: () => T): T {
    if (!hydrating) return run()
    const savedRollingStyleBases = claimedRollingStyleBases
    hydrating = false
    try {
        return run()
    } finally {
        hydrating = true
        claimedRollingStyleBases = savedRollingStyleBases
    }
}

export function rememberHydrateRollingStyleBase(el: Element, base: string): void {
    (claimedRollingStyleBases ??= new WeakMap()).set(el, base)
}

export function getHydrateRollingStyleBase(el: Element): string | undefined {
    return claimedRollingStyleBases?.get(el)
}

/**
 * Portal 激活目标的唯一规则（#55 B4）：先 options.portals[key]，再 document.getElementById(key)，都没有就抛错。
 */
export function resolvePortalHydrateTarget(key: string, portals: Record<string, HTMLElement> | undefined): HTMLElement {
    const fromOpt = portals?.[key]
    if (fromOpt) return fromOpt
    const el = typeof document !== 'undefined' ? document.getElementById(key) : null
    if (!el) throw new Error(`[axii] hydrate Portal key "${key}" not found (pass options.portals or matching element id)`)
    return el
}

export function isCommentData(node: Node | null | undefined, data: string): node is Comment {
    return !!node && node.nodeType === Node.COMMENT_NODE && (node as Comment).data === data
}

export function staticAttrId(props: any): string | null {
    if (!props || !Object.prototype.hasOwnProperty.call(props, 'id')) return null
    let v = props.id
    if (typeof v === 'function' && !isAtom(v)) return null
    if (isAtom(v)) v = v()
    if (v == null || v === false) return null
    return String(v)
}

/**
 * 失配时按 CSR 新建的元素节点（R1 的新建，#55 B3）。
 * CAUTION 与 CSR createElement 建元素的分支同一规则：SVG 用 createElementNS；is（customized built-in，I64）只在创建时
 *  以选项生效，事后 setAttribute('is') 不会升级元素。
 */
export function createHydrateMismatchElementNode(tagName: string, isSVG: boolean | undefined, is: string | undefined): Element {
    return isSVG
        ? document.createElementNS('http://www.w3.org/2000/svg', tagName)
        : is === undefined ? document.createElement(tagName) : document.createElement(tagName, {is})
}

/**
 * After a hydrate container (hydrateRoot's container, a Portal container) is claimed, delete orphans on the
 * **container** itself (§3.7 / D11 / D13; render.hydrateContainerTopDown).
 *
 * CSR `createRoot` leaves only the Host interval `[host.element … <!--root-->]`.
 * Remove:
 * - leading nodes before `host.element`
 * - everything after the root placeholder
 *
 * Call after `migrateSsrStyleTags` so leftover STYLE/SCRIPT/LINK (no longer `data-axii-ssr`) are treated as
 * orphans (D13). The claim walk skips those tags at the container level; this post-migrate pass must not.
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

// CAUTION RCDATA / RAWTEXT 父节点（textarea / title / style / script…）里没有 axii:* 标记（§3.2.1 A3）：
//  服务端把各文本单元首尾相接成一段字符数据，空单元不留任何节点。认领时按客户端单元的长度把
//  这一个 Text 依次切开（splitText），正好是首尾相接的逆操作——各单元拿到自己的 Text，
//  第一段保持原节点 identity。不切的话第一个单元拿整段去比，必然「值漂移」，后面的单元全部重建。
export function isCharacterDataParent(parent: ParentNode): boolean {
    if (parent.nodeType !== Node.ELEMENT_NODE) return false
    const name = (parent as Element).localName.toLowerCase()
    return RCDATA_TAGS.has(name) || RAWTEXT_TAGS.has(name)
}
