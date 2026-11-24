import {insertBefore, UnhandledPlaceholder, materializeHydrateDeferred, rematerializeDeferredFragmentChildren, resolveHydrationElement} from "./DOM";
import {Host, PathContext} from "./Host";
import {isAtom, RxList} from "data0";
import {ComponentHost, ReusableHost} from "./ComponentHost";
import {AtomHost} from "./AtomHost";
import {FunctionHost} from "./FunctionHost";
import {StaticHost} from "./StaticHost";
import {StaticArrayHost} from "./StaticArrayHost";
import {assert} from "./util";
import {RxListHost} from "./RxListHost.js";
import {isAxiiRetainedObjectDiagnosticsEnabled, trackHostCreated, trackHostDestroyed} from "./retainedObjectDiagnostics.js";
import {getAxiiSource} from "./diagnostics";
import {claimEmptyHostComment, claimEmptyHostCommentBefore, isHydrateDeferredElement, isHydrating} from "./hydration";
import {claimTextBeforeCommentPlaceholder} from "./hydration";
import {COMMENT_NODE, DOCUMENT_FRAGMENT_NODE, ELEMENT_NODE, isCommentNode, nodeTypeOf, TEXT_NODE} from "./nodeType";
import {HydrationSlot, isHydrationElement} from "./hydrationElement";
import {claimTopDownComment, claimTopDownText, insertTopDownEmptyText, markTopDownHostPlaced, removeTopDownCounterpart, reportTopDownLiveNode} from "./hydrationCursor";

/**
 * @internal
 */
class EmptyHost implements Host{
    element: Comment
    constructor(public pathContext: PathContext, public placeholder: UnhandledPlaceholder,) {
        // CAUTION 不在字段初始化器里碰 document：hydrate 时改为认领已有 <!--empty-->。
        this.element = document.createComment('empty')
    }
    render() {
        if (isHydrating()) {
            // List / array rows: empty is immediately before this Host's placeholder.
            // Root EmptyHost: empty is sibling of <!--root-->.
            if (this.placeholder.parentNode) {
                try {
                    this.element = claimEmptyHostCommentBefore(this.placeholder as Comment)
                    return
                } catch {
                    // fall through to root search (top-level null → <!--empty--><!--root-->)
                }
            }
            this.element = claimEmptyHostComment()
            return
        }
        this.placeholder.parentNode?.insertBefore(this.element, this.placeholder)
    }
    // #55 新模型（§2.5）：认领 <!--empty-->，然后认领 slot
    hydrate(slot: HydrationSlot) {
        this.element = claimTopDownComment('empty')
        this.placeholder = claimTopDownComment(slot)
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }
}
/**
 * @internal
 */
class PrimitiveHost implements Host{
    element = this.placeholder
    constructor(public source: string|number|boolean|bigint, public placeholder:Comment|Text, public pathContext: PathContext) {
    }
    render() {
        if (isHydrating() && isCommentNode(this.placeholder)) {
            const text = typeof this.source === 'boolean' ? '' : this.source.toString()
            // §3.7 / D12: expected snapshot → report + identity rebuild on drift
            this.element = claimTextBeforeCommentPlaceholder(this.placeholder, text)
            return
        }
        // CAUTION boolean 渲染为空文本：{cond && <el/>} 的 falsy 结果不应该出现字面 "false"，
        //  与 FunctionHost/AtomHost 的语义一致。
        const text = typeof this.source === 'boolean' ? '' : this.source.toString()
        this.element = document.createTextNode(text);
        insertBefore(this.element, this.placeholder)
    }
    // #55 新模型（§2.5）：非空时认领文本单元，空时（服务端什么都不写）在游标处插入 Text('')，然后认领 slot。
    //  PrimitiveHost 只有 Comment 种类的 slot（元素子节点里的文本是 createElement 的静态文本，不建 Host）。
    hydrate(slot: HydrationSlot) {
        const text = typeof this.source === 'boolean' ? '' : this.source.toString()
        this.element = text === '' ? insertTopDownEmptyText() : claimTopDownText(text)
        this.placeholder = claimTopDownComment(slot)
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        if (!parentHandle) this.placeholder.remove()
        this.element.remove()
    }
}

/**
 * @internal
 *
 * Comment / Text 节点直接作为内容：组件、函数节点、列表行返回一个现成的节点。
 * 公开的 JSXElement 类型包含 Comment，Text 作为数组项、静态 child 本来就支持，
 * 这里补上「作为 host 的 source」这个入口，否则同一个值换个入口就是 unknown child type。
 */
class NodeHost implements Host{
    element: Comment|Text
    constructor(public source: Comment|Text, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        // 与其余 host 一致：渲染之前 element 就是占位符
        this.element = placeholder
    }
    render() {
        this.element = this.source
        insertBefore(this.source, this.placeholder)
    }
    // #55 新模型（§2.5 NodeHost 行、§2.6.8）：服务端不可能产出客户端的现成节点，它是仅客户端的内容。游标处是它的对应物
    //  （它是 Text 时的文本单元）就删除，然后按 R3 认领 slot（服务端在 slot 前写下的其余内容由 R3 删除并报告），
    //  source 按 CSR 插在 slot 前面
    hydrate(slot: HydrationSlot) {
        reportTopDownLiveNode(this.source)
        markTopDownHostPlaced(this.source)
        removeTopDownCounterpart(this.source)
        this.placeholder = claimTopDownComment(slot)
        this.render()
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }
}

const HOST_TYPE_NAMES = [
    'StaticHost',
    'PrimitiveHost',
    'StaticArrayHost',
    'EmptyHost',
    'RxListHost',
    'ReusableHost',
    'ComponentHost',
    'AtomHost',
    'FunctionHost',
    'NodeHost',
]

/**
 * @internal
 *
 * position 参数只服务于 atom/函数 child（AtomHost/FunctionHost）：它们从不消费
 * context.hostPath（文本快速路径），所以父元素 host 不再为每个这样的 child 克隆
 * pathContext，而是把「宿主元素 host + child 在其中的 elementPath + JSX source」
 * 作为轻量位置信息传进来，由 host 按需（诊断/结构渲染）读取。
 * 其余 host 类型仍然接收已就绪的完整 context，position 被忽略。
 */
export type HostPosition = {
    owner: Host,
    elementPath: number[],
    debugSource?: ReturnType<typeof getAxiiSource>,
}

// CAUTION 新激活模型的分派 createHydrateHost 在下面，是同一条分派链的另一份（#55 §2.4.1）：新增一种 source 两处一起改。
export function createHost(source: any, placeholder: UnhandledPlaceholder, context: PathContext, position?: HostPosition) {
    // CAUTION 节点种类一律按 nodeType 判断（见 nodeType.ts）：组件 / 函数节点返回的、激活时认领到的
    //  节点可能来自另一个 realm（同源 iframe），instanceof 恒为 false（#58）。
    const placeholderType = nodeTypeOf(placeholder)
    assert(placeholderType === COMMENT_NODE || placeholderType === TEXT_NODE, 'incorrect placeholder type')
    // 节点自带的 JSX source 优先，否则沿用（继承自最近父级的）context.debugSource。
    // CAUTION 只有 source 真的更具体时才克隆 context，createHost 是高频路径，生产环境（无 __axiiSource）零额外分配。
    const ownSource = getAxiiSource(source)
    const pathContext = ownSource && ownSource !== context.debugSource ?
        {...context, debugSource: ownSource} :
        context
    let host:Host
    let typeIndex: number
    // CAUTION 按出现频率排序分支：函数（响应式文本/结构）和元素是最常见的动态 child
    const sourceType = typeof source
    // 对象 source 的 nodeType 只读一次，元素 / 片段分支和最后的 Text / Comment 分支共用
    let nodeType: number | undefined
    if (sourceType === 'function') {
        // atom 本身也是 function，必须先判断
        if (isAtom(source)) {
            host = new AtomHost(source, placeholder, pathContext, position)
            typeIndex = 7
        } else {
            host = new FunctionHost(source, placeholder, pathContext, position)
            typeIndex = 8
        }
    } else if ((nodeType = nodeTypeOf(source)) === ELEMENT_NODE || nodeType === DOCUMENT_FRAGMENT_NODE) {
        // 任何 Element（HTML / SVG / MathML）与 DocumentFragment，不论来自哪个 realm
        // Deferred stubs are Element carriers only (never DocumentFragment).
        if (isHydrating() && nodeType === ELEMENT_NODE && isHydrateDeferredElement(source)) {
            source = materializeHydrateDeferred(source) as typeof source
        } else if (isHydrating() && nodeType === DOCUMENT_FRAGMENT_NODE) {
            rematerializeDeferredFragmentChildren(source)
        }
        host = new StaticHost(source, placeholder, pathContext)
        typeIndex = 0
    // CAUTION bigint 与 string/number 同为文本形态（后端 bigint id 是自然输入，I61）
    } else if( sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean' || sourceType === 'bigint'){
        host = new PrimitiveHost(source, placeholder, pathContext)
        typeIndex = 1
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, pathContext)
        typeIndex = 2
    } else if (source === undefined || source === null) {
        host = new EmptyHost(pathContext, placeholder)
        typeIndex = 3
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, pathContext)
        typeIndex = 4
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        // 复用的 Host 被移动到了新位置，错误归因要落在新位置的上下文上
        source.pathContext = pathContext
        host = source
        typeIndex = 5
    } else if( sourceType === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, pathContext)
        typeIndex = 6
    } else if (nodeType === TEXT_NODE || nodeType === COMMENT_NODE) {
        host = new NodeHost(source, placeholder, pathContext)
        typeIndex = 9
    } else if (isHydrationElement(source)) {
        // #55：激活期间的描述（新模型）走到了 CSR 的分派：激活中存下的 JSX 之后才渲染（C6 / C10）、派生列表重新放进来的行
        //  （§3.3）。已有 node 就是那个节点，否则按 CSR 物化（DOM.resolveHydrationElement）。在链尾判定，常见类型永远到不了
        //  这里（§2.2「事后渲染」）。≡ 元素分支的 StaticHost，种类表下标相同
        host = new StaticHost(resolveHydrationElement(source), placeholder, pathContext)
        typeIndex = 0
    } else {
        assert(false, `unknown child type ${source}`)
    }

    if (isAxiiRetainedObjectDiagnosticsEnabled()) {
        trackHostCreated(host!, HOST_TYPE_NAMES[typeIndex!])
    }

    return host!
}

/**
 * @internal
 * #55 新激活模型的分派（设计 docs/ssr-support/hydration-top-down.md §2.4、§2.4.1）：激活期间由各 Host 调用，
 * 创建的 Host 随后由调用方 hydrate(slot)，从游标处消费自己的区域与 placeholder。构造时的 placeholder 就是 slot 常量。
 * CAUTION 与上面的 createHost 是同一条分派链的两份：类型判定的顺序相同，用同一张 HOST_TYPE_NAMES 登记 trackHostCreated。
 *  新增一种 source 必须同时改两处。区别只有：元素分支先收描述（HydrationElement，不是 DOM 节点），现成的元素 / 片段
 *  （激活之外创建的节点，§2.6.8）与 CSR 一样落到 StaticHost，由它的 hydrate 按 CSR 渲染。
 *  RxListHost 的 Compact 行（CompactElementHost）不经过这里：它由 RxListHost.hydrate 按 #68 的判定直接构造并登记，
 *  ≡ CSR 的 RxListHost.createChildHost（§2.4.1 的种类计数把它也算在内）。
 */
export function createHydrateHost(source: any, slot: HydrationSlot, context: PathContext, position?: HostPosition): Host {
    // 描述的 JSX source 在 rawProps 上（CSR 的元素由 applyElementProps 写到 __axiiSource）
    const ownSource = isHydrationElement(source) ? source.rawProps?.__source as ReturnType<typeof getAxiiSource> : getAxiiSource(source)
    const pathContext = ownSource && ownSource !== context.debugSource ?
        {...context, debugSource: ownSource} :
        context
    const placeholder = slot as unknown as UnhandledPlaceholder
    let host: Host
    let typeIndex: number
    const sourceType = typeof source
    let nodeType: number | undefined
    if (sourceType === 'function') {
        if (isAtom(source)) {
            host = new AtomHost(source, placeholder, pathContext, position)
            typeIndex = 7
        } else {
            host = new FunctionHost(source, placeholder, pathContext, position)
            typeIndex = 8
        }
    } else if (isHydrationElement(source)) {
        // 元素 / Fragment 描述 ≡ createHost 的元素 / 片段分支
        host = new StaticHost(source as any, placeholder, pathContext)
        typeIndex = 0
    } else if ((nodeType = nodeTypeOf(source)) === ELEMENT_NODE || nodeType === DOCUMENT_FRAGMENT_NODE) {
        // 激活之外创建的现成元素 / 片段（§2.6.8）：StaticHost.hydrate 按 CSR 渲染它（≡ createHost 的元素分支）
        host = new StaticHost(source, placeholder, pathContext)
        typeIndex = 0
    } else if (sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean' || sourceType === 'bigint') {
        host = new PrimitiveHost(source, placeholder, pathContext)
        typeIndex = 1
    } else if (Array.isArray(source)) {
        host = new StaticArrayHost(source, placeholder as unknown as Comment, pathContext)
        typeIndex = 2
    } else if (source === undefined || source === null) {
        host = new EmptyHost(pathContext, placeholder)
        typeIndex = 3
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, pathContext)
        typeIndex = 4
    } else if (source instanceof ReusableHost) {
        // ≡ createHost：复用的 Host 放到这个位置，错误归因落在新位置；它的 placeholder（reusePlaceholder）由 hydrate 认领 slot
        source.pathContext = pathContext
        host = source
        typeIndex = 5
    } else if (sourceType === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, pathContext)
        typeIndex = 6
    } else if (nodeType === TEXT_NODE || nodeType === COMMENT_NODE) {
        host = new NodeHost(source, placeholder, pathContext)
        typeIndex = 9
    } else {
        assert(false, `unknown child type ${source}`)
    }

    if (isAxiiRetainedObjectDiagnosticsEnabled()) {
        trackHostCreated(host!, HOST_TYPE_NAMES[typeIndex!])
    }

    return host!
}
