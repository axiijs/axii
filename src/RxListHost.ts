import {insertAfter, insertBefore, UnhandledPlaceholder} from './DOM'
import {computed, destroyComputed, RxList, TrackOpTypes, TriggerOpTypes, Computed} from "data0";
import {PathContext, Host} from "./Host";
import {createHost} from "./createHost";
import {createLinkedNode} from "./LinkedList";
import {reportAxiiError, withReactiveTrace} from "./diagnostics";
/**
 * @internal
 */
export class RxListHost implements Host{
    hosts?: RxList<any>
    hostRenderComputed?:  ReturnType<typeof computed>
    constructor(public source: RxList<any>, public placeholder:UnhandledPlaceholder, public pathContext: PathContext) {
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hosts?.data[0]?.element || this.placeholder
    }

    renderNewHosts(hosts: Host[]|RxList<Host>) {
        const frag = document.createDocumentFragment()
        hosts.forEach(host => {
            frag.appendChild(host.placeholder)
            host.render()
        })
        return frag
    }

    render(): void {
        const host = this

        this.hosts = this.source.map((item) => {
            return createHost(item, document.createComment('rx list item'), {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
        }, { ignoreIndex: true, skipItemEffect: true })

        this.hostRenderComputed = computed(
            function computation(this:Computed) {
                this.manualTrack(host.hosts!, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                this.manualTrack(host.hosts!, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE)
                insertBefore(host.renderNewHosts(host.hosts!), host.placeholder)
                return null
            },
            function applyPatch(_, triggerInfos) {
                triggerInfos.forEach((triggerInfo) => {
                    const {method, argv, key, methodResult, type} = triggerInfo
                    const reorderInfo = (triggerInfo as { reorderInfo?: ReorderPatchInfo }).reorderInfo
                    try {
                        withReactiveTrace({
                            type: 'rx-list-patch',
                            operation: 'apply-patch',
                            hostType: 'RxListHost',
                            elementPath: host.pathContext.elementPath,
                            source: host.pathContext.debugSource,
                            method: method ?? String(type),
                            key: key as string | number | undefined,
                            argvSummary: argv ? argv.map(summarizePatchArg).join(',') : undefined,
                            createdCount: method === 'splice' ? argv!.slice(2).length : undefined,
                            deletedCount: Array.isArray(methodResult) ? methodResult.length : methodResult ? 1 : 0,
                        }, () => {
                        if (method === 'splice') {
                            // 这里的 this.hosts 是已经插入好的。
                            // CAUTION 因为 hosts 中的元素可能也是一个一个插进来的。例如 groupBy 中的 patch。
                            //  我们的下一个元素可能也是新的还没渲染，所以要一直往后找到第一个已经渲染过的元素。
                            let insertBeforeHost:Host|null = null
                            const newHosts = argv!.slice(2)!

                            let startIndex = argv![0] + newHosts.length
                            while(startIndex < host.hosts!.data.length){
                                if (host.hosts!.data[startIndex]!.placeholder.parentNode) {
                                    insertBeforeHost = host.hosts!.data[startIndex]
                                    break;
                                }
                                startIndex++
                            }

                            if (newHosts.length) {
                                const newHostsFrag =  host.renderNewHosts(newHosts)
                                insertBefore(newHostsFrag, insertBeforeHost?.element || host.placeholder)
                            }


                            const deletedHosts = methodResult as Host[]

                            // CAUTION 如果是删除所有节点，并且自己就是 parent 的唯一 child，并且没有子节点强制要求自己来清理。那么直接清空 parent，这样比较快。
                            if (deletedHosts.length) {

                                const removeAllElementByParent = host.hosts!.data.length===0 &&
                                    !host.placeholder.nextSibling && // 当前节点是父 Host 的最后一个
                                    !deletedHosts[0].element.previousSibling &&  // 删除的Host 是父 Host 的第一个，说明从头删到了尾
                                    deletedHosts.every(inner => !inner.forceHandleElement)

                                if(removeAllElementByParent) {
                                    const parent = host.placeholder.parentNode!
                                    parent.replaceChildren(host.placeholder)

                                    deletedHosts.forEach((host: Host) => host.destroy(true))
                                } else {
                                    deletedHosts.forEach((host: Host) => host.destroy())
                                }
                            }

                        } else if(method === 'reorder') {
                            reorderHostRanges(host.hosts!.raw, argv![0] as Order[], host.placeholder, reorderInfo as ReorderPatchInfo | undefined)

                        } else if(type === TriggerOpTypes.EXPLICIT_KEY_CHANGE) {
                            // explicit key change
                            const oldHost = methodResult as Host
                            oldHost?.destroy()

                            // 会回收之前 placeholder，完全重新执行
                            const index = key as number
                            // CAUTION 因为有可能发生了连续的 explicit_key_change 的情况，后面的 host 可能都是新的，所以这里应该使用 insertAfter 往前面找确定的。
                            // placeholder 一定是最后一个元素
                            if (index === 0) {
                                insertBefore(host.hosts!.raw.at(index)!.placeholder, host.placeholder.parentElement!.firstChild! as HTMLElement)
                            } else {
                                insertAfter(host.hosts!.raw.at(index)!.placeholder, host.hosts!.raw.at(index-1)?.placeholder)
                            }
                            host.hosts!.raw.at(index)!.render()
                          /* v8 ignore next 3 */
                        } else {
                            throw new Error('unknown trigger info')
                        }
                        })
                    } catch (error) {
                        reportAxiiError(error)
                        throw error
                    }
                })
            },
            true
        )
    }
    destroy(fromParentDestroy?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.hosts?.destroy()
            destroyComputed(this.hostRenderComputed)
        }
        // 理论上我们只需要处理自己的 placeholder 就行了，下面的 host 会处理各自的元素
        this.hosts!.forEach(host => host.destroy(fromParentDestroy))
        if (!fromParentDestroy) this.placeholder.remove()
    }
}

function summarizePatchArg(arg: unknown) {
    if (arg && typeof arg === 'object') return Object.getPrototypeOf(arg)?.constructor?.name ?? 'object'
    return String(arg)
}

type Order = [number, number]
type ReorderPatchInfo = {
    kind: 'swap' | 'move' | 'sort' | 'reorder',
    newStart?: number,
    limit?: number,
}

function reorderHostRanges(hosts: Host[], newOrder: Order[], placeholder: Comment, reorderInfo?: ReorderPatchInfo) {
    if (hosts.length < 2 || newOrder.length === 0) return

    if (reorderInfo?.kind === 'move' && moveHostRanges(hosts, reorderInfo, placeholder)) {
        return
    }

    if (isTwoItemSwap(newOrder)) {
        swapTwoHostRanges(hosts, newOrder, placeholder)
        return
    }

    const oldIndexesByTargetIndex = hosts.map((_, index) => index)
    newOrder.forEach(([oldIndex, newIndex]) => {
        oldIndexesByTargetIndex[newIndex] = oldIndex
    })

    const stableTargetIndexes = findStableTargetIndexes(oldIndexesByTargetIndex)
    if (hosts.length - stableTargetIndexes.size > hosts.length / 2) {
        rebuildHostRanges(hosts, placeholder)
        return
    }

    let refEl: Host['element'] | Comment = placeholder

    for (let targetIndex = hosts.length - 1; targetIndex >= 0; targetIndex--) {
        const childHost = hosts[targetIndex]!
        if (!stableTargetIndexes.has(targetIndex)) {
            insertBefore(childHost.element, refEl, childHost.placeholder)
        }
        refEl = childHost.element
    }
}

function moveHostRanges(hosts: Host[], reorderInfo: ReorderPatchInfo, placeholder: Comment) {
    const {newStart, limit} = reorderInfo
    if (newStart === undefined || limit === undefined || limit < 1) return false

    const firstMovedHost = hosts[newStart]
    const lastMovedHost = hosts[newStart + limit - 1]
    if (!firstMovedHost || !lastMovedHost) return false

    insertBefore(firstMovedHost.element, hosts[newStart + limit]?.element || placeholder, lastMovedHost.placeholder)
    return true
}

function isTwoItemSwap(newOrder: Order[]) {
    return newOrder.length === 2 &&
        newOrder[0]![0] === newOrder[1]![1] &&
        newOrder[0]![1] === newOrder[1]![0] &&
        newOrder[0]![0] !== newOrder[0]![1]
}

function swapTwoHostRanges(hosts: Host[], newOrder: Order[], placeholder: Comment) {
    const firstTargetIndex = Math.min(newOrder[0]![1], newOrder[1]![1])
    const secondTargetIndex = Math.max(newOrder[0]![1], newOrder[1]![1])
    const firstHost = hosts[firstTargetIndex]!
    const secondHost = hosts[secondTargetIndex]!

    insertBefore(firstHost.element, secondHost.element, firstHost.placeholder)
    if (secondTargetIndex > firstTargetIndex + 1) {
        insertBefore(secondHost.element, hosts[secondTargetIndex + 1]?.element || placeholder, secondHost.placeholder)
    }
}

function rebuildHostRanges(hosts: Host[], placeholder: Comment) {
    const fragment = document.createDocumentFragment()
    hosts.forEach(host => appendHostRange(fragment, host))
    insertBefore(fragment, placeholder)
}

function appendHostRange(fragment: DocumentFragment, host: Host) {
    let node: ChildNode | null = host.element
    while (node) {
        const next: ChildNode | null = node.nextSibling
        fragment.appendChild(node)
        if (node === host.placeholder) break
        node = next
    }
}

function findStableTargetIndexes(oldIndexesByTargetIndex: number[]) {
    const tailPositions: number[] = []
    const previousPositions = new Array<number>(oldIndexesByTargetIndex.length).fill(-1)

    oldIndexesByTargetIndex.forEach((oldIndex, targetIndex) => {
        let low = 0
        let high = tailPositions.length

        while (low < high) {
            const mid = (low + high) >> 1
            if (oldIndexesByTargetIndex[tailPositions[mid]!] < oldIndex) {
                low = mid + 1
            } else {
                high = mid
            }
        }

        if (low > 0) {
            previousPositions[targetIndex] = tailPositions[low - 1]!
        }
        tailPositions[low] = targetIndex
    })

    const stableIndexes = new Set<number>()
    let current = tailPositions[tailPositions.length - 1]
    while (current !== undefined && current !== -1) {
        stableIndexes.add(current)
        current = previousPositions[current]
    }

    return stableIndexes
}
