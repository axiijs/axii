/**
 * @internal
 * #55 新激活模型的延迟描述与 Host 的 slot（设计 docs/ssr-support/hydration-top-down.md §2.2、§2.4）。
 *
 * CAUTION 这个模块在 axii/ssr 的导入链上（ssr.ts → ComponentHost → 这里）：模块顶层不能碰 document / Node。
 */
import type {AttributesArg, Fragment} from "./DOM"
import {HydrationMismatchError} from "./hydration"

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

/** 描述的预置字段名（§2.2）。B4 的开发期 Proxy 跳过它们；用例断言它们不在任何元素接口上。 */
export const HYDRATION_ELEMENT_FIELDS = ['tag', 'rawProps', 'rawChildren', 'isSVG', 'node', 'listenerBoundArgs'] as const

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
