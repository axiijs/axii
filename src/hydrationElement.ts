/**
 * @internal
 * #55 新激活模型的延迟描述与 Host 的 slot（设计 docs/ssr-support/hydration-top-down.md §2.2、§2.4）。
 *
 * CAUTION 这个模块在 axii/ssr 的导入链上（ssr.ts → ComponentHost → 这里）：模块顶层不能碰 document / Node。
 */
import type {AttributesArg, Fragment} from "./DOM"
import {HydrationDevReport, HydrationMismatchError, runOutsideHydration} from "./hydration"
import {reportAxiiError} from "./diagnostics"

/**
 * 新模型激活期间，字符串标签与 Fragment 的 createElement / createSVGElement 返回它，而不是 DOM 节点（§2.2）。
 * 不碰 DOM：不创建元素、不认领、不应用 props、不提升元数据。消费它的 Host 在自己的位置按文档顺序认领服务端节点
 * （DOM.hydrateElementDescription），子节点之后再应用 props，与 CSR 的 createElement 同一套规则。
 *
 * - tag 不叫 type：Fragment 是函数，叫 type 会被 createHost 的 ComponentNode 判定（typeof source.type === 'function'）误认。
 * - isSVG：创建时按 CSR 的规则（显式 _isSVG，否则 SVG 专有标签）；HTML / SVG 同名的标签作为 SVG 元素（不是 HTML
 *   integration point）的静态子元素时，认领时改为 true（≡ CSR 的 DOM.adoptSvgChild，#56）。
 * - node：认领或新建后的真实节点；认领后 rawProps / rawChildren 置为 undefined（瘦身，§2.2），描述本身永远不变成节点（§3.1.1）。
 * - listenerBoundArgs：ComponentHost.createHTMLOrSVGElement 写入，认领时转交给 node。
 *
 * CAUTION 字段全部在构造器里按同一顺序赋值，然后 preventExtensions：形状单态；严格模式下往描述上写未知属性抛 TypeError
 *  （框架代码都是 ES module，写错名字在开发期与生产都会抛错）。字段名不得出现在任何元素接口上（用户读 el.<名字> 会拿到
 *  描述的内部数据），新增字段要同时加进 HYDRATION_ELEMENT_FIELDS，由 hydrationElement.spec 钉住。
 */
export class HydrationElement {
    tag: string | typeof Fragment
    rawProps: AttributesArg | null | undefined
    rawChildren: any[] | undefined
    isSVG: boolean
    node: Element | DocumentFragment | null
    listenerBoundArgs: any[] | undefined
    constructor(tag: string | typeof Fragment, rawProps: AttributesArg | null | undefined, rawChildren: any[], isSVG: boolean) {
        this.tag = tag
        this.rawProps = rawProps
        this.rawChildren = rawChildren
        this.isSVG = isSVG
        this.node = null
        this.listenerBoundArgs = undefined
        Object.preventExtensions(this)
    }
}

/** 描述的预置字段名（§2.2）。开发期 Proxy 跳过它们；用例断言它们不在任何元素接口上。 */
export const HYDRATION_ELEMENT_FIELDS = ['tag', 'rawProps', 'rawChildren', 'isSVG', 'node', 'listenerBoundArgs'] as const

// ───────────────────────── 开发期 Proxy（§3.4） ─────────────────────────

const PRESET_FIELDS: ReadonlySet<string> = new Set<string>(HYDRATION_ELEMENT_FIELDS)
/**
 * 框架自己探测值的种类时读的名字，它们恰好也是元素接口名，读它们不报告（§3.4「框架探测名表」）：
 *  - type：createHost / createHydrateHost 用 typeof source?.type === 'function' 判定 ComponentNode（<input> / <button> 的接口名）；
 *  - nodeType：nodeType.ts 的 nodeTypeOf（createHost、RxListHost.createChildHost、createElement 的 child 循环按它分派；
 *    设计稿写成时分派还是 instanceof，#58 之后改成了 nodeType，所以表里补上它）。
 * 代价：开发期不报告用户读 el.type / el.nodeType，读到的仍是 undefined。
 */
const FRAMEWORK_PROBES: ReadonlySet<string> = new Set(['type', 'nodeType'])
// 标签的元素接口：按命名空间与标签缓存一个实例的原型（只在开发期、第一次报告判断时创建）
const elementInterfaces = new Map<string, object>()
// 描述的 JSX source：瘦身之后 rawProps 没了，Proxy 创建时记下（只在开发期）
const descriptionSources = new WeakMap<HydrationElement, {fileName: string, lineNumber: number, columnNumber: number}>()
// 同一个 JSX 位置和属性名只报告一次；没有 JSX source（没有开发期 JSX 转换）时按描述去重
const reportedAccesses = new Set<string>()
const reportedAccessesWithoutSource = new WeakMap<HydrationElement, Set<string>>()

function elementInterfaceOf(desc: HydrationElement): object {
    const tag = desc.tag
    if (typeof tag !== 'string') return DocumentFragment.prototype
    const key = (desc.isSVG ? 'svg:' : 'html:') + tag
    let proto = elementInterfaces.get(key)
    if (proto === undefined) {
        const probe = desc.isSVG ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag)
        elementInterfaces.set(key, proto = Object.getPrototypeOf(probe) as object)
    }
    return proto
}

function reportAccess(desc: HydrationElement, key: string, write: boolean): void {
    const source = descriptionSources.get(desc)
    const where = source ? `${source.fileName}:${source.lineNumber}:${source.columnNumber}` : ''
    const tag = typeof desc.tag === 'string' ? `<${desc.tag}>` : 'Fragment'
    const access = `${key}#${write ? 'w' : 'r'}`
    if (where) {
        const dedupe = `${where}#${access}`
        if (reportedAccesses.has(dedupe)) return
        reportedAccesses.add(dedupe)
    } else {
        let seen = reportedAccessesWithoutSource.get(desc)
        if (seen === undefined) reportedAccessesWithoutSource.set(desc, seen = new Set())
        if (seen.has(access)) return
        seen.add(access)
    }
    // onError 是用户代码，在激活上下文之外执行（同失配报告）
    runOutsideHydration(() => reportAxiiError(new HydrationDevReport('AXII_HYDRATION_ELEMENT_ACCESS',
        `"${key}" was ${write ? 'written to' : 'read from'} the result of JSX ${tag}${where ? ` at ${where}` : ''} created during hydration. ` +
        'During hydration JSX returns a description, not a DOM node, and it stays a description afterwards. ' +
        'Use a ref (ref={el => ...}) and work with the node in the ref callback or useLayoutEffect')))
}

/**
 * 开发期 Proxy 的 trap：先判断要不要报告，再把操作原样交给目标（Reflect），开发期与生产的行为相同，只多一条报告。
 *  - 读：属性名是字符串、不是预置字段、不在 Object.prototype 上、不在框架探测名表里，并且属于这个标签的元素接口时报告；
 *  - 写：预置字段以外的写入都报告，然后写到同一个不可扩展的目标上，目标拒绝时返回 false（严格模式下调用方得到与生产相同的
 *    TypeError，非严格模式静默丢失）。
 * 共用一个 handler，不为每个描述分配闭包。
 */
const DEV_PROXY_HANDLER: ProxyHandler<HydrationElement> = {
    get(target, key, receiver) {
        if (typeof key === 'string' && !PRESET_FIELDS.has(key) && !FRAMEWORK_PROBES.has(key) && !(key in Object.prototype)
            && key in elementInterfaceOf(target)) {
            reportAccess(target, key, false)
        }
        return Reflect.get(target, key, receiver)
    },
    set(target, key, value) {
        if (typeof key !== 'string' || !PRESET_FIELDS.has(key)) reportAccess(target, String(key), true)
        return Reflect.set(target, key, value)
    },
}

/**
 * @internal 新模型激活期间、诊断开启时（beginTopDownHydration 定一次），createElement 返回包着描述的 Proxy（§3.4）。
 * 框架对它的判定、读写与描述本身相同（isHydrationElement 经原型判断，预置字段不报告）。
 */
export function createHydrationElementDevProxy(desc: HydrationElement): HydrationElement {
    const source = desc.rawProps?.__source
    if (source) descriptionSources.set(desc, source as {fileName: string, lineNumber: number, columnNumber: number})
    return new Proxy(desc, DEV_PROXY_HANDLER)
}

/** 「这个值是不是激活期间的描述」的唯一判定（§2.2）。 */
export function isHydrationElement(value: unknown): value is HydrationElement {
    return value instanceof HydrationElement
}

/**
 * Host 的 slot（§2.4）：placeholder 的种类，构造时就作为 placeholder 传入，认领后换成真实节点。
 * 按种类共享的字符串常量，不分配；它不是 DOM 节点，认领之前在 placeholder 上调用节点方法立即 TypeError。
 * Comment 种类的 slot 就是那个 Comment 的 data；TEXT_SLOT 是元素子节点里函数 / atom child 的 Text 占位符（Text-ph）。
 */
export const TEXT_SLOT = '#text'
export const UNHANDLED_CHILD_SLOT = 'unhandledChild'
export const COMPUTED_NODE_SLOT = 'computed node'
export const ROOT_SLOT = 'root'
/** RxListHost 的非 Compact 行（≡ RxListHost.createChildHost 的 `<!--rx list item-->`）。 */
export const RX_LIST_ITEM_SLOT = 'rx list item'
/** StaticArrayHost 的非 DirectNodes 项（≡ StaticArrayHost.render 的 `<!--array item-->`）。 */
export const ARRAY_ITEM_SLOT = 'array item'
/** ReusableHost 的 innerHost（≡ reusable() 的 innerPlaceholder `<!--reusable-->`，服务端 ssr.serializeReusable）。 */
export const REUSABLE_SLOT = 'reusable'
export type HydrationSlot = typeof TEXT_SLOT | typeof UNHANDLED_CHILD_SLOT | typeof COMPUTED_NODE_SLOT | typeof ROOT_SLOT
    | typeof RX_LIST_ITEM_SLOT | typeof ARRAY_ITEM_SLOT | typeof REUSABLE_SLOT

/** 值是不是还没有认领的 slot（placeholder 还不是节点）。开发期不变量用（§4.4）。 */
export function isHydrationSlot(value: unknown): value is HydrationSlot {
    return typeof value === 'string'
}

/**
 * 新模型激活的中止。B1 / B2 的失配报告并抛出 HydrationMismatchError，B4 之前未实现的形态抛出「待实现」错误；B3 起失配按
 * R1–R5 修复，B4 起全部形态都已实现，这两种都不再抛出，这里仍把 HydrationMismatchError 算作中止（万一有，也不能被组件的
 * 监听器吞掉）。剩下的中止是函数结构态的内容渲染抛错（markTopDownAbort）。
 * root.dispatch('error') 在激活期间不把它们当作已消费：注册了 root.on('error') 也不能让激活在错位的游标上继续。
 */
export function isTopDownAbort(error: unknown): boolean {
    return error instanceof HydrationMismatchError
        || (abortingError !== NOT_ABORTING && error === abortingError)
}

const NOT_ABORTING: unique symbol = Symbol('not aborting')
// 新模型激活中正在向上中止的渲染错误（FunctionHost 结构态的内容渲染抛错，见 markTopDownAbort）
let abortingError: unknown = NOT_ABORTING

/**
 * FunctionHost 结构态的内容在激活中渲染抛错：新模型不「渲染为空」（服务端节点没有消费完、元素层已经压栈，游标接不上），
 * 向上中止激活（§7.6「激活中止」）。FunctionHost 自己的 update 会把这个错误交给 root.dispatch('error')；记下它，
 * dispatch 就按未消费处理，注册了 error 监听器也不会在错位的游标上继续（#55 B3 独立审查）。错误可以是任意值，所以记值而不是标记对象。
 */
export function markTopDownAbort(error: unknown): void {
    abortingError = error
}

/** 入口结束（包括中止）时清掉。 */
export function clearTopDownAbort(): void {
    abortingError = NOT_ABORTING
}
