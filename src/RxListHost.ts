import {ExtendedElement, insertAfter, insertBefore, UnhandledPlaceholder} from './DOM'
import {computed, destroyComputed, RxList, TrackOpTypes, TriggerOpTypes, Computed, TriggerInfo} from "data0";
import {PathContext, Host} from "./Host";
import {createHost} from "./createHost";
import {createLinkedNode} from "./LinkedList";
import {
    isAxiiRetainedObjectDiagnosticsEnabled,
    trackCompactHostCreated,
    trackHostCreated,
    trackHostDestroyed
} from "./retainedObjectDiagnostics.js";
import {
    assertRangeReachable,
    isAxiiDiagnosticsEnabled,
    reportAxiiError,
    summarizeArgv,
    withReactiveTrace
} from "./diagnostics";
import {CompactElementHost} from "./StaticHost.js";

function isHostRendered(host: Host): boolean {
    return host instanceof CompactElementHost ? !!host.element.parentNode : !!host.placeholder.parentNode
}

// host 对应 DOM 区间的最后一个节点（普通 host 是 placeholder，compact host 就是元素本身）
function hostLastNode(host: Host): HTMLElement|Comment|Text|SVGElement {
    return host instanceof CompactElementHost ? host.element : host.placeholder
}

// host 对应 DOM 区间的第一个节点
function hostFirstNode(host: Host): HTMLElement|Comment|Text|SVGElement {
    return host.element
}

type ReorderInfo = {
    kind: string,
    affectedRange: [number, number] | null,
    movedCount: number,
    oldIndexToNewIndex: Map<number, number>,
}

/**
 * @internal
 *
 * 直接订阅 source RxList 的 patch（splice/reorder/explicit key change），
 * 用普通数组维护每个 item 对应的 Host。
 *
 * 相比旧实现（this.source.map(...) 再订阅派生 RxList 的 patch），少了一整层
 * 派生 RxList：不再为每一行分配/运行/销毁一个 data0 Computed（map 的行级 effect），
 * 也不再让每个 patch 经过两次 trigger 分发。
 */
export class RxListHost implements Host{
    hosts?: Host[]
    childContext?: PathContext
    hostRenderComputed?:  ReturnType<typeof computed>
    constructor(public source: RxList<any>, public placeholder:UnhandledPlaceholder, public pathContext: PathContext) {
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hosts?.[0]?.element || this.placeholder
    }

    createChildHost(item: any) {
        // 紧凑行快速路径：行内容是单个元素（最常见）时不给行分配 comment 占位符
        if ((item instanceof HTMLElement || item instanceof SVGElement) && !(item as ExtendedElement).detachStyledChildren) {
            const host = new CompactElementHost(item, this.childContext!)
            if (isAxiiRetainedObjectDiagnosticsEnabled()) {
                trackHostCreated(host, 'CompactElementHost')
                trackCompactHostCreated(host)
            }
            return host
        }
        return createHost(item, document.createComment('rx list item'), this.childContext!)
    }

    renderNewHosts(hosts: Host[]) {
        const frag = document.createDocumentFragment()
        for (const host of hosts) {
            if (host instanceof CompactElementHost) {
                frag.appendChild(host.element)
            } else {
                frag.appendChild(host.placeholder)
            }
            host.render()
        }
        return frag
    }

    render(): void {
        const host = this
        const source = this.source
        // 所有行共享同一个 childContext/hostPath 节点（内容完全相同），避免每行两次对象分配
        this.childContext = {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)}
        this.hosts = []

        this.hostRenderComputed = computed(
            function computation(this:Computed) {
                this.manualTrack(source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                this.manualTrack(source, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE)
                // CAUTION 行 host 的 effect 不注册为本 computed 的子 effect：
                //  行 host 一定会被显式 destroy（splice 删除/列表销毁），不需要父子级联清理，
                //  这样每行创建/销毁都省一次父子登记与移除。
                this.pauseCollectChild()
                try {
                    const hosts = host.hosts!
                    const data = source.data
                    for (let i = 0; i < data.length; i++) {
                        hosts.push(host.createChildHost(data[i]))
                    }
                    insertBefore(host.renderNewHosts(hosts), host.placeholder)
                    // 行是在脱离文档的 fragment 里渲染的，插入完成后才执行行内登记的 layoutEffect/ref
                    host.pathContext.root.flushAttachQueue()
                } finally {
                    this.resumeCollectChild()
                }
                return null
            },
            function applyPatch(this: Computed, _, triggerInfos) {
                this.pauseCollectChild()
                try {
                    for (const info of triggerInfos) {
                        // CAUTION patch 在 data0 的 computed 里执行，向上抛只会变成 unhandled rejection。
                        //  外部通过 root.on('error') 注册了处理器时交给处理器（应用保持存活，
                        //  该列表区域可能处于不一致状态）；否则先 reportAxiiError 输出结构化报告，
                        //  再继续抛出保持可观测。
                        try {
                            if (isAxiiDiagnosticsEnabled()) {
                                const {method, argv, key, methodResult, type} = info
                                withReactiveTrace({
                                    type: 'rx-list-patch',
                                    operation: 'apply-patch',
                                    hostType: 'RxListHost',
                                    elementPath: host.pathContext.elementPath,
                                    source: host.pathContext.debugSource,
                                    method: method ?? String(type),
                                    key: key as PropertyKey | undefined,
                                    argvSummary: argv ? summarizeArgv(argv) : undefined,
                                    createdCount: method === 'splice' ? argv!.length - 2 : undefined,
                                    deletedCount: Array.isArray(methodResult) ? methodResult.length : methodResult ? 1 : 0,
                                }, () => {
                                    host.applyTriggerInfo(info)
                                })
                            } else {
                                // CAUTION 诊断关闭（生产环境）时不分配 trace frame 对象，列表 patch 是热路径
                                host.applyTriggerInfo(info)
                            }
                        } catch (error) {
                            if (!host.pathContext.root.dispatch('error', error)) {
                                reportAxiiError(error)
                                throw error
                            }
                        }
                    }
                } finally {
                    this.resumeCollectChild()
                }
            },
            true
        )
    }
    applyTriggerInfo(info: TriggerInfo) {
        const {method, argv, key, methodResult, type} = info
        if (method === 'splice') {
            this.handleSplice(argv!, methodResult as any[]|undefined)
        } else if(method === 'reorder') {
            this.handleReorder(argv![0], (info as any).reorderInfo)
        } else if(type === TriggerOpTypes.EXPLICIT_KEY_CHANGE) {
            this.handleExplicitKeyChange(key as number)
          /* v8 ignore next 3 */
        } else {
            throw new Error('unknown trigger info')
        }
    }
    handleSplice(argv: any[], deletedItems?: any[]) {
        const hosts = this.hosts!
        const start = argv[0] as number
        const deleteCount = deletedItems ? deletedItems.length : 0
        let newHosts: Host[]
        if (argv.length > 2) {
            newHosts = new Array(argv.length - 2)
            for (let i = 2; i < argv.length; i++) {
                newHosts[i - 2] = this.createChildHost(argv[i])
            }
        } else {
            newHosts = []
        }

        const deletedHosts = hosts.splice(start, deleteCount, ...newHosts)

        if (newHosts.length) {
            // CAUTION 一次 batch 中可能有连续 patch（例如 groupBy 一个一个插入），
            //  后面的 host 可能还没渲染，所以要往后找到第一个已经渲染过的元素作为插入锚点。
            let insertBeforeHost: Host|null = null
            for (let i = start + newHosts.length; i < hosts.length; i++) {
                if (isHostRendered(hosts[i])) {
                    insertBeforeHost = hosts[i]
                    break
                }
            }
            insertBefore(this.renderNewHosts(newHosts), insertBeforeHost?.element || this.placeholder)
            // 新行是在脱离文档的 fragment 里渲染的，插入完成后才执行行内登记的 layoutEffect/ref
            this.pathContext.root.flushAttachQueue()
        }

        if (deletedHosts.length) {
            let canBulkRemove = true
            for (const deleted of deletedHosts) {
                if (deleted.forceHandleElement) {
                    canBulkRemove = false
                    break
                }
            }
            const firstNode = canBulkRemove ? hostFirstNode(deletedHosts[0]) : null
            const lastNode = canBulkRemove ? hostLastNode(deletedHosts[deletedHosts.length - 1]) : null

            if (canBulkRemove && firstNode!.parentNode && firstNode!.parentNode === lastNode!.parentNode) {
                // CAUTION 开发期先做区间可达性校验：Range 对「终点在起点之前」这类被破坏的区间会
                //  静默塌缩、误删或漏删节点，诊断开启时把它变成可解释的 AxiiError。
                if (isAxiiDiagnosticsEnabled()) {
                    assertRangeReachable({
                        ownerHost: deletedHosts[0],
                        start: firstNode!,
                        end: lastNode!,
                        operation: 'splice',
                    })
                }
                // CAUTION 如果是删除所有节点，并且自己就是 parent 的唯一内容，直接 replaceChildren 清空 parent 最快；
                //  否则用 Range 一次性删除整个连续区间，避免逐节点 remove。
                const removeAllElementByParent = hosts.length === 0 &&
                    !this.placeholder.nextSibling && // 当前节点是父 Host 的最后一个
                    !firstNode!.previousSibling // 删除的Host 是父 Host 的第一个，说明从头删到了尾

                if (removeAllElementByParent) {
                    const parent = this.placeholder.parentNode!
                    parent.replaceChildren(this.placeholder)
                } else {
                    const range = document.createRange()
                    range.setStartBefore(firstNode!)
                    range.setEndAfter(lastNode!)
                    range.deleteContents()
                }
                for (const deleted of deletedHosts) deleted.destroy(true)
            } else {
                for (const deleted of deletedHosts) deleted.destroy()
            }
        }
    }
    handleReorder(pairs: [number, number][], reorderInfo?: ReorderInfo) {
        const hosts = this.hosts!
        // 1. 先把 hosts 数组调整到新顺序（语义同 data0 RxList.reorder：data[to] = old[from]）
        let minChanged = Infinity
        let maxChanged = -Infinity
        const movedHosts: Host[] = new Array(pairs.length)
        for (let i = 0; i < pairs.length; i++) {
            movedHosts[i] = hosts[pairs[i][0]]
        }
        for (let i = 0; i < pairs.length; i++) {
            const [from, to] = pairs[i]
            hosts[to] = movedHosts[i]
            if (from !== to) {
                if (from < minChanged) minChanged = from
                if (to < minChanged) minChanged = to
                if (from > maxChanged) maxChanged = from
                if (to > maxChanged) maxChanged = to
            }
        }
        if (reorderInfo?.affectedRange) {
            minChanged = reorderInfo.affectedRange[0]
            maxChanged = reorderInfo.affectedRange[1]
        }
        if (maxChanged < minChanged) return // 没有实际移动

        // 2. 计算受影响区间内每个新位置对应的旧位置
        const rangeLength = maxChanged - minChanged + 1
        const oldPositions = new Array(rangeLength)
        for (let i = 0; i < rangeLength; i++) oldPositions[i] = minChanged + i
        for (const [from, to] of pairs) {
            if (to >= minChanged && to <= maxChanged) oldPositions[to - minChanged] = from
        }

        // 3. 求旧位置序列的最长递增子序列（LIS），LIS 中的 host 相对顺序不变、无需移动，
        //  其余 host 用 insertBefore 区间搬移。相比旧实现（为整个列表创建 N 个 comment
        //  占位再逐个搬移），DOM 操作数从 O(N) 降到 O(移动数)。
        const lisIndexes = longestIncreasingSubsequenceIndexes(oldPositions)

        let anchor: Node = maxChanged + 1 < hosts.length ? hosts[maxChanged + 1].element : this.placeholder
        let lisPointer = lisIndexes.length - 1
        for (let i = rangeLength - 1; i >= 0; i--) {
            const childHost = hosts[minChanged + i]
            if (lisPointer >= 0 && lisIndexes[lisPointer] === i) {
                // 已在正确相对位置
                lisPointer--
            } else {
                insertBefore(childHost.element as any, anchor as any, hostLastNode(childHost) as any)
            }
            anchor = childHost.element
        }
    }
    handleExplicitKeyChange(index: number) {
        const hosts = this.hosts!
        const oldHost = hosts[index]
        oldHost?.destroy()

        const newHost = this.createChildHost(this.source.data[index])
        hosts[index] = newHost
        // compact host 没有独立占位符，直接定位元素本身
        const newHostAnchorNode = newHost instanceof CompactElementHost ? newHost.element : newHost.placeholder
        // CAUTION 因为有可能发生了连续的 explicit_key_change 的情况，后面的 host 可能都是新的，所以这里应该使用 insertAfter 往前面找确定的。
        // placeholder 一定是最后一个元素
        if (index === 0) {
            // CAUTION 锚点必须在列表自身区域内，不能使用 parentElement.firstChild，
            //  列表可能不是父元素的第一个孩子。
            //  连续 explicit_key_change 时后面的 host 可能也是新的（还没渲染），
            //  所以要往后找到第一个已渲染的 host，以它的起始节点为锚点。
            let anchor: HTMLElement|Comment|SVGElement|Text = this.placeholder
            for(let i = index + 1; i < hosts.length; i++) {
                if (isHostRendered(hosts[i])) {
                    anchor = hosts[i].element
                    break
                }
            }
            insertBefore(newHostAnchorNode, anchor)
        } else {
            insertAfter(newHostAnchorNode, hostLastNode(hosts[index-1]))
        }
        newHost.render()
        // compact host 的元素/ref 登记发生在 render 里（此时可能仍未连通），插入后统一 flush
        this.pathContext.root.flushAttachQueue()
    }
    destroy(fromParentDestroy?: boolean) {
        trackHostDestroyed(this)
        destroyComputed(this.hostRenderComputed)
        // 理论上我们只需要处理自己的 placeholder 就行了，下面的 host 会处理各自的元素
        this.hosts!.forEach(host => host.destroy(fromParentDestroy))
        if (!fromParentDestroy) this.placeholder.remove()
    }
}

/**
 * 返回最长严格递增子序列在输入序列中的下标（升序）。O(n log n)。
 */
function longestIncreasingSubsequenceIndexes(sequence: number[]): number[] {
    const n = sequence.length
    if (n === 0) return []
    const predecessors = new Array(n)
    // tails[k] = 长度为 k+1 的递增子序列的最小结尾元素下标
    const tails: number[] = []
    for (let i = 0; i < n; i++) {
        const value = sequence[i]
        // 二分查找第一个结尾元素 >= value 的位置
        let low = 0
        let high = tails.length
        while (low < high) {
            const mid = (low + high) >> 1
            if (sequence[tails[mid]] < value) {
                low = mid + 1
            } else {
                high = mid
            }
        }
        predecessors[i] = low > 0 ? tails[low - 1] : -1
        tails[low] = i
    }
    const result = new Array(tails.length)
    let current = tails[tails.length - 1]
    for (let k = tails.length - 1; k >= 0; k--) {
        result[k] = current
        current = predecessors[current]
    }
    return result
}
