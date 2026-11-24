import { insertBefore, restoreSelectValueAfterRemoval, resumeSelectReplay, suspendSelectReplay} from "./DOM";
import {PathContext, Host} from "./Host";
import {createHost, createHydrateHost} from "./createHost";
import {removeNodesBetween} from "./util";
import {createLinkedNode} from "./LinkedList";
import {isAxiiRetainedObjectDiagnosticsEnabled, trackHostCreated, trackHostDestroyed} from "./retainedObjectDiagnostics.js";
import {
    advanceCursorUntilComment,
    advancePastNode,
    claimCommentAtCursor,
    claimDirectNodeText,
    getChildCursor,
    isHydrating,
    setChildCursor,
} from "./hydration";
import type {UnhandledChildInfo} from "./DOM";
import {RxList} from "data0";
import {isDomNode, isElementNode, isFragmentNode, isTextNode} from "./nodeType";
import {ReusableHost} from "./ComponentHost";
import {ARRAY_ITEM_SLOT, HydrationSlot, isHydrationElement, throwTopDownPending} from "./hydrationElement";
import {claimTopDownComment, claimTopDownEmptyTextPlaceholder, claimTopDownText} from "./hydrationCursor";

/** Previous-host boundary comments (not part of this StaticArray content). */
function isArrayRegionBoundaryComment(data: string): boolean {
    // Only true inter-host separators. Do NOT treat `reusable` / `fragment start` /
    // `array item` as boundaries — they belong to items inside this array's own region.
    return data === 'rx list item'
        || data === 'unhandledChild'
        || data === 'root'
        || data === 'empty'
        || data === 'computed node'
}

/**
 * Leftmost DOM node of this array's content (siblings before `placeholder`),
 * or null when the array is empty (placeholder-only).
 */
function findArrayContentStart(placeholder: Comment): ChildNode | null {
    let n: ChildNode | null = placeholder.previousSibling
    let first: ChildNode | null = null
    while (n) {
        if (n.nodeType === Node.COMMENT_NODE && isArrayRegionBoundaryComment((n as Comment).data)) {
            break
        }
        first = n
        n = n.previousSibling
    }
    return first
}

/**
 * @internal
 */
export class StaticArrayHost implements Host{

    childHosts: Host[] = []
    // 直接由本 host 创建的 Text 节点（string/number/Text 类型的 item），
    //  子 host 自行处理 DOM 时（离场动画路径）需要单独移除。
    directNodes?: Text[]
    constructor(public source: any[], public placeholder: Comment, public pathContext: PathContext) {
    }

    firstChild?: HTMLElement|Comment|Text|SVGElement|Host
    get element(): HTMLElement|Comment|Text|SVGElement {
        return (this.firstChild as Host)?.element || (this.firstChild as HTMLElement|Comment|Text|SVGElement) || this.placeholder
    }
    // 透传内层的 forceHandleElement（离场动画等），同 ComponentHost
    get forceHandleElement(): boolean {
        return this.childHosts.some(host => host.forceHandleElement)
    }
    render(): void {
        if (this.element === this.placeholder) {
            // Hydrate DirectNodes / item hosts claimed during createElement
            if (isHydrating()) {
                const hydrateDirect = (this.source as any).__axiiHydrateDirectNodes as Text[] | undefined
                const hydrateItems = (this.source as any).__axiiHydrateItemHosts as UnhandledChildInfo[] | undefined
                if (hydrateDirect || hydrateItems) {
                    if (hydrateDirect) {
                        this.directNodes = hydrateDirect
                        if (hydrateDirect.length) this.firstChild = hydrateDirect[0]
                    }
                    if (hydrateItems?.length) {
                        let hostPath: ReturnType<typeof createLinkedNode<Host>>|undefined
                        for (const info of hydrateItems) {
                            const item = info.child
                            const newHost = typeof item === 'function' ?
                                createHost(item, info.placeholder, this.pathContext, {
                                    owner: this,
                                    elementPath: this.pathContext.elementPath,
                                }) :
                                createHost(item, info.placeholder, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                            this.childHosts.push(newHost)
                            if (!this.firstChild) this.firstChild = newHost
                        }
                        this.childHosts.forEach(host => host.render())
                    }
                    if (!this.firstChild) this.firstChild = this.placeholder
                    delete (this.source as any).__axiiHydrateDirectNodes
                    delete (this.source as any).__axiiHydrateItemHosts
                    if (this.placeholder.isConnected) {
                        this.pathContext.root.flushAttachQueue()
                    }
                    return
                }
                // No createElement stash (e.g. G3-A RxList row): forward-claim from content start → placeholder
                const parent = this.placeholder.parentNode
                if (!parent) throw new Error('[axii] hydrate StaticArrayHost without parent')
                const startNode = findArrayContentStart(this.placeholder)
                let startIdx = 0
                if (startNode) {
                    const kids = parent.childNodes
                    let found = false
                    for (let i = 0; i < kids.length; i++) {
                        if (kids[i] === startNode) {
                            startIdx = i
                            found = true
                            break
                        }
                    }
                    if (!found) throw new Error('[axii] hydrate mismatch: StaticArray content start not in parent')
                } else {
                    // Empty array: cursor at placeholder
                    const kids = parent.childNodes
                    for (let i = 0; i < kids.length; i++) {
                        if (kids[i] === this.placeholder) {
                            startIdx = i
                            break
                        }
                    }
                }
                setChildCursor(parent, startIdx)

                let hostPath: ReturnType<typeof createLinkedNode<Host>>|undefined
                this.source.forEach((item, index) => {
                    const itemType = typeof item
                    if (itemType === 'string' || itemType === 'number' || itemType === 'bigint') {
                        const text = claimDirectNodeText()
                        ;(this.directNodes ??= []).push(text)
                        if (index === 0) this.firstChild = text
                    } else if (isTextNode(item)) {
                        advancePastNode(item)
                        ;(this.directNodes ??= []).push(item)
                        if (index === 0) this.firstChild = item
                    } else if (isFragmentNode(item)) {
                        // Fragment content lives under parent (<!--fragment start-->…), not on the DF
                        advanceCursorUntilComment('array item')
                        const itemPh = claimCommentAtCursor('array item')
                        const newHost = createHost(item, itemPh, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                        this.childHosts.push(newHost)
                        if (index === 0) this.firstChild = newHost
                    } else if (isElementNode(item)) {
                        advancePastNode(item)
                        const itemPh = claimCommentAtCursor('array item')
                        const newHost = createHost(item, itemPh, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                        this.childHosts.push(newHost)
                        if (index === 0) this.firstChild = newHost
                    } else if (item instanceof RxList) {
                        // Mark content start so RxListHost.render can hydrateRowsFromCursor (same as element-child RxList)
                        const cursor = getChildCursor()
                        ;(item as any).__axiiHydrateListParent = cursor.parent
                        ;(item as any).__axiiHydrateListStart = cursor.index
                        advanceCursorUntilComment('array item')
                        const itemPh = claimCommentAtCursor('array item')
                        const newHost = createHost(item, itemPh, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                        this.childHosts.push(newHost)
                        if (index === 0) this.firstChild = newHost
                    } else if (item instanceof ReusableHost) {
                        const src = (item.innerHost as any)?.source
                        if (isDomNode(src) && src.parentNode) {
                            advancePastNode(src)
                        }
                        advanceCursorUntilComment('reusable')
                        const reusablePh = claimCommentAtCursor('reusable')
                        ;(item as any).innerPlaceholder = reusablePh
                        if (item.innerHost) {
                            ;(item.innerHost as any).placeholder = reusablePh
                            ;(item.innerHost as any).element = reusablePh
                        }
                        advanceCursorUntilComment('array item')
                        const itemPh = claimCommentAtCursor('array item')
                        item.moveTo(itemPh)
                        item.pathContext = {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)}
                        ;(item as any).__axiiHydrating = true
                        if (isAxiiRetainedObjectDiagnosticsEnabled()) {
                            trackHostCreated(item, 'ReusableHost')
                        }
                        this.childHosts.push(item)
                        if (index === 0) this.firstChild = item
                    } else if (typeof item === 'function') {
                        advanceCursorUntilComment('array item')
                        const itemPh = claimCommentAtCursor('array item')
                        const newHost = createHost(item, itemPh, this.pathContext, {
                            owner: this,
                            elementPath: this.pathContext.elementPath,
                        })
                        this.childHosts.push(newHost)
                        if (index === 0) this.firstChild = newHost
                    } else {
                        // ComponentNode / nested Array / null / etc. — content then <!--array item-->
                        advanceCursorUntilComment('array item')
                        const itemPh = claimCommentAtCursor('array item')
                        const newHost = createHost(item, itemPh, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                        this.childHosts.push(newHost)
                        if (index === 0) this.firstChild = newHost
                    }
                })
                this.childHosts.forEach(host => host.render())
                if (!this.firstChild) this.firstChild = this.placeholder
                if (this.placeholder.isConnected) {
                    this.pathContext.root.flushAttachQueue()
                }
                return
            }

            const frag = document.createDocumentFragment()

            // 所有（非函数）子 host 共享同一个 hostPath 节点；全函数/atom 项时一个都不分配
            let hostPath: ReturnType<typeof createLinkedNode<Host>>|undefined
            this.source.forEach((item, index) => {
                const itemType = typeof item
                // bigint 与 string/number 同为文本形态（I61）
                if (itemType === 'string' || itemType === 'number' || itemType === 'bigint') {
                    const el = document.createTextNode(item.toString())
                    frag.appendChild(el)
                    ;(this.directNodes ??= []).push(el)
                    if (index === 0) this.firstChild = el
                } else if (isTextNode(item)) {
                    // Component 或者 Function 返回值可能会是 DocumentFragment，而 DocumentFragment.childNodes 也会使用 StaticArrayHost 处理，
                    //  这个时候的 this.source 就是 childNodes，已经是 DOM.js 处理过的了，所以直接是 Text 节点。
                    //  按 nodeType 判断：数组项也可以是另一个 realm 的 Text（见 nodeType.ts，#58）。
                    frag.appendChild(item)
                    ;(this.directNodes ??= []).push(item)
                    if (index === 0) this.firstChild = item
                } else {
                    // 其他未知节点了
                    const newPlaceholder: Comment = document.createComment('array item')
                    frag.appendChild(newPlaceholder)
                    // CAUTION atom/函数项与 StaticHost.collectInnerHost 同款：不克隆 pathContext，
                    //  位置信息通过 position 传入（数组项没有独立 elementPath，沿用父级的）
                    const newHost = typeof item === 'function' ?
                        createHost(item, newPlaceholder, this.pathContext, {
                            owner: this,
                            elementPath: this.pathContext.elementPath,
                        }) :
                        createHost(item, newPlaceholder, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
                    this.childHosts.push(newHost)
                    if (index === 0) this.firstChild = newHost
                }
            })
            this.childHosts.forEach(host => host.render())
            insertBefore(frag, this.placeholder)
            // 子 host 是在脱离文档的 fragment 里渲染的，插入完成后才执行其中登记的 layoutEffect/ref。
            // 自己仍未连通（整体在更外层 fragment 里）时跳过，避免无效重扫，留给外层 flush。
            if (this.placeholder.isConnected) {
                this.pathContext.root.flushAttachQueue()
            }
            /* v8 ignore next 3 */
        } else {
            throw new Error('should never rerender')
        }
    }
    /**
     * #55 新模型（设计 §2.5 StaticArrayHost 行、§3.3）：从游标处逐项认领服务端节点，然后认领自己的 slot。
     * 项的分类、子 Host 的 context / position 与 render 逐项相同（CAUTION 改其中一处两处一起改）：
     *  - 字符串 / 数字 / bigint 是 DirectNodes：认领文本单元，空串认领 `<!--axii:0-->`（插入 Text('')；
     *    服务端 ssr.serializeStaticArrayItemContent 对空串写哨兵），没有 `<!--array item-->`；
     *  - 现成的 Text（激活之外创建的节点，§2.6.8）在 render 里也是 DirectNodes，新模型在 B4 落地，之前显式抛错；
     *  - 其余项 createHydrateHost(项, 'array item')：函数（含 atom）不克隆 pathContext、以 position 传位置，
     *    其余共享一个 hostPath 节点。
     * 先构造全部子 Host，再按文档顺序认领（≡ render：forEach 构造，再逐个 render），组件类型 id 的分配顺序与 CSR 相同；
 * 与 forEach 一样跳过稀疏数组的空位。
     * 项是描述时，认领之后把 source[index] 写回为认领到的节点（§3.3；Fragment 项是那个空的 DocumentFragment）；
 * 冻结的数组不写回（CSR 照常渲染它）。
     */
    hydrate(slot: HydrationSlot): void {
        const source = this.source
        const length = source.length
        let hostPath: ReturnType<typeof createLinkedNode<Host>>|undefined
        for (let index = 0; index < length; index++) {
            // ≡ render 的 forEach：稀疏数组的空位跳过（服务端的 for…of 却为空位写 <!--empty--><!--array item-->，
            //  见设计 §11；这里与 CSR 一致，服务端多写的部分在认领处报告失配，不静默）
            if (!(index in source)) continue
            const item = source[index]
            const itemType = typeof item
            if (itemType === 'string' || itemType === 'number' || itemType === 'bigint') continue
            if (isTextNode(item)) throwTopDownPending('a DOM node created outside hydration used as an array item', 'B4')
            const newHost = itemType === 'function' ?
                createHydrateHost(item, ARRAY_ITEM_SLOT, this.pathContext, {
                    owner: this,
                    elementPath: this.pathContext.elementPath,
                }) :
                createHydrateHost(item, ARRAY_ITEM_SLOT, {...this.pathContext, hostPath: hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)})
            this.childHosts.push(newHost)
            if (index === 0) this.firstChild = newHost
        }
        // 冻结的数组（Object.freeze([...])）CSR 照常渲染；写回在严格模式下会 TypeError，这种数组不写回，项留在描述壳上
        const writeBack = !Object.isFrozen(source)
        let next = 0
        for (let index = 0; index < length; index++) {
            if (!(index in source)) continue
            const item = source[index]
            const itemType = typeof item
            if (itemType === 'string' || itemType === 'number' || itemType === 'bigint') {
                const text = item.toString()
                const node = text === '' ? claimTopDownEmptyTextPlaceholder() : claimTopDownText(text)
                ;(this.directNodes ??= []).push(node)
                if (index === 0) this.firstChild = node
            } else {
                this.childHosts[next++].hydrate!(ARRAY_ITEM_SLOT)
                if (writeBack && isHydrationElement(item) && source[index] === item) source[index] = item.node
            }
        }
        this.placeholder = claimTopDownComment(slot)
        // ≡ render：子 host 登记的 layoutEffect / ref 在自己的区间完成之后执行
        if (this.placeholder.isConnected) {
            this.pathContext.root.flushAttachQueue()
        }
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        // CAUTION 只要有子 host 声明了 forceHandleElement（离场动画等），
        //  就不能整段同步 removeNodesBetween，必须把 DOM 处理委托给各个子 host
        //  （它们各自的 element..placeholder 区间可能要等动画结束才异步移除），
        //  自己只负责直接创建的 Text 节点和 placeholder。
        if (!parentHandle && this.forceHandleElement) {
            // 子 host 各自摘 DOM：select 重放合并成一次（见 suspendSelectReplay）
            suspendSelectReplay()
            try {
                this.childHosts!.forEach(host => host.destroy(false))
                this.directNodes?.forEach(node => node.remove())
            } finally {
                resumeSelectReplay()
            }
            this.placeholder.remove()
            return
        }
        if (parentHandle) {
            this.childHosts!.forEach(host => host.destroy(true))
            return
        }
        // CAUTION 先销毁子 host、再摘 DOM（I39）：子组件的清理函数（onCleanup 里测量、读 scrollTop、
        //  unobserve(ref.current)）必须看到还连在文档里的 DOM。之前是先 removeNodesBetween 再销毁，
        //  `() => show() ? [<A/>, <B/>] : null` 这类数组内容里的组件清理时节点已经脱离文档。
        // CAUTION 区间起点要在销毁之前取：子 host 销毁后 element getter 会退回到自己的占位符；
        //  个别子 host（PrimitiveHost，第一项是 boolean / 返回原始值的组件）在 destroy(true) 里还会摘掉
        //  自己的文本节点。起点恰好是它时改用起点后面的那个节点：PrimitiveHost 的文本后面紧跟着它自己的
        //  <!--array item--> 占位符（destroy(true) 不摘）。不能用「起点前一个兄弟的下一个 / 父节点的第一个」
        //  重新定位：子 host 的清理函数插在那里的节点（插在父节点最前面的提示等）会被当成区间一起删掉
        //  （与 RxListHost.removeRows 的同一处理，#58）。两个都不在了才退回旧的定位。
        const first = this.element
        const parent = first.parentNode
        const before = first.previousSibling
        const afterFirst = first !== this.placeholder ? first.nextSibling : null
        this.childHosts!.forEach(host => host.destroy(true))
        const start = first.parentNode === parent ?
            first :
            afterFirst !== null && afterFirst.parentNode === parent ?
                afterFirst as typeof first :
                ((before ? before.nextSibling : parent?.firstChild) as typeof first | null) ?? this.placeholder
        removeNodesBetween(start, this.placeholder, true, {
            ownerHost: this,
            operation: 'destroy',
        })
        // 整段移除的可能是 option 数组，select 要按存值重放（见 restoreSelectValueAfterRemoval）
        restoreSelectValueAfterRemoval(parent)
    }
}
