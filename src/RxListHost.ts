import {ExtendedElement, insertAfter, insertBefore, restoreSelectValueAfterRemoval, UnhandledPlaceholder} from './DOM'
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
    createListOrderError,
    isAxiiDiagnosticsEnabled,
    reportAxiiError,
    summarizeArgv,
    withReactiveTrace
} from "./diagnostics";
import {CompactElementHost, StaticHost} from "./StaticHost.js";
import {detachEffectFromCreationContext} from "./LightBindingEffect.js";
import {ReusableHost} from "./ComponentHost.js";
import {
    advanceCursorUntilComment,
    advancePastNode,
    claimCommentAtCursor,
    isHydrating,
    setChildCursor,
} from "./hydration";

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
    // 渲染或销毁还在调用栈上的行（见 renderNewHosts / handleExplicitKeyChange / destroy）：
    //  这期间列表自己被同步销毁时，destroy 不能碰它们。绝大多数时候是 undefined。
    rowsOnStack?: Host[]
    // undefined 表示存活，否则是 destroy 收到的 fromParentDestroy（见 destroy 的重入说明）。
    //  declare：存活的列表不付槽位
    declare destroyedWith?: boolean
    // 已经被删除、但顶层节点还留在列表区间里的行（离场动画播放中），见 removeRows
    leavingNodes?: Node[]
    constructor(public source: RxList<any>, public placeholder:UnhandledPlaceholder, public pathContext: PathContext) {
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hosts?.[0]?.element || this.placeholder
    }

    // CAUTION 行的 forceHandleElement（reusable 内容保留、离场动画）必须向上传播，
    //  与 ComponentHost/FunctionHost/StaticArrayHost 一致：列表挂在 fragment 里时，
    //  行的节点就是 fragment 区间的顶层节点，父级不透传就会把这些行整段拆散。
    //  只在销毁决策点被读取，不在渲染/patch 热路径上。
    get forceHandleElement(): boolean {
        const hosts = this.hosts
        if (!hosts) return false
        for (const host of hosts) {
            if (host.forceHandleElement) return true
        }
        return false
    }

    createChildHost(item: any) {
        // 紧凑行快速路径：行内容是单个元素（最常见）时不给行分配 comment 占位符
        if ((item instanceof HTMLElement || item instanceof SVGElement) && !(item as ExtendedElement).detachStyledChildren) {
            if (isHydrating()) {
                advancePastNode(item)
            }
            const host = new CompactElementHost(item, this.childContext!)
            if (isAxiiRetainedObjectDiagnosticsEnabled()) {
                trackHostCreated(host, 'CompactElementHost')
                trackCompactHostCreated(host)
            }
            return host
        }

        if (isHydrating()) {
            // G3-RL: hydrate inner rows first, then claim outer <!--rx list item-->
            if (item instanceof RxList) {
                const nested = new RxListHost(item, this.placeholder, this.childContext!)
                nested.childContext = {
                    ...this.childContext!,
                    hostPath: createLinkedNode<Host>(nested, this.childContext!.hostPath),
                }
                nested.hydrateRowsFromCursor()
                advanceCursorUntilComment('rx list item')
                nested.placeholder = claimCommentAtCursor('rx list item')
                ;(nested as any).__axiiHydrated = true
                if (isAxiiRetainedObjectDiagnosticsEnabled()) {
                    trackHostCreated(nested, 'RxListHost')
                }
                return nested
            }

    // G3-RU: content already claimed; claim <!--reusable--> + row placeholder
            if (item instanceof ReusableHost) {
                // StaticHost keeps the claimed element on `.source` until render() assigns `.element`
                const src = (item.innerHost as any)?.source
                if (src instanceof Node && src.parentNode) {
                    advancePastNode(src)
                }
                advanceCursorUntilComment('reusable')
                const reusablePh = claimCommentAtCursor('reusable')
                ;(item as any).innerPlaceholder = reusablePh
                if (item.innerHost) {
                    ;(item.innerHost as any).placeholder = reusablePh
                    // Field initializer set element=old Comment; reset so render()'s assert passes
                    ;(item.innerHost as any).element = reusablePh
                }
                advanceCursorUntilComment('rx list item')
                const rowPh = claimCommentAtCursor('rx list item')
                item.moveTo(rowPh)
                ;(item as any).__axiiHydrating = true
                if (isAxiiRetainedObjectDiagnosticsEnabled()) {
                    trackHostCreated(item, 'ReusableHost')
                }
                return item
            }

            advanceCursorUntilComment('rx list item')
            const ph = claimCommentAtCursor('rx list item')
            return createHost(item, ph, this.childContext!)
        }

        return createHost(item, document.createComment('rx list item'), this.childContext!)
    }

    /** Claim existing SSR row DOM from the active child cursor (no insert). */
    hydrateRowsFromCursor() {
        this.hosts = []
        const data = this.source.data
        for (let i = 0; i < data.length; i++) {
            this.hosts.push(this.createChildHost(data[i]))
        }
        for (const row of this.hosts) {
            row.render()
            // host.render() may strip axii:* or insert empty Text — resync cursor after row end
            const parent = this.placeholder.parentNode
            if (parent) {
                const last = hostLastNode(row)
                const kids = parent.childNodes
                for (let i = 0; i < kids.length; i++) {
                    if (kids[i] === last) {
                        setChildCursor(parent, i + 1)
                        break
                    }
                }
            }
        }
    }

    // CAUTION 调用方在拿到 fragment 之后必须先检查 destroyedWith：渲染某一行的过程中列表自己
    //  可能被同步销毁（行里的 effect / error 监听器调用 root.destroy() 等，见 destroy），
    //  那时这批行已经在这里回收，fragment 不能再插入。
    renderNewHosts(hosts: Host[]) {
        const frag = document.createDocumentFragment()
        const outerRowsOnStack = this.rowsOnStack
        this.rowsOnStack = hosts
        // CAUTION 每行都可能新建自己的 stylesheet（嵌套样式里带每行不同的数据），合并成一次
        //  document.adoptedStyleSheets 写入，否则挂载 N 行是 O(N²)（见 StyleManager.beginBatch）。
        //  写入发生在调用方把 frag 插入文档之前。每次 patch 只多一对计数，不是每行。
        const styleManager = StaticHost.styleManager
        const root = this.pathContext.root
        const outerRoot = styleManager.beginBatch(root)
        try {
            for (const host of hosts) {
                // 列表已被销毁：剩下的行不再渲染
                if (this.destroyedWith !== undefined) break
                if (host instanceof CompactElementHost) {
                    frag.appendChild(host.element)
                } else {
                    frag.appendChild(host.placeholder)
                }
                host.render()
            }
        } catch (error) {
            // 列表已被销毁：这批行马上整体丢弃，root 的监听器也已清空，它们的错误没有归属
            //  （与组件销毁后 async effect 的 rejection 不再上报同一语义）。
            if (this.destroyedWith === undefined) throw error
        } finally {
            this.rowsOnStack = outerRowsOnStack
            // destroy 跳过了这批行（当时渲染到一半），现在渲染栈已退出，统一销毁恰好一次。
            //  它们都还在脱离文档的 fragment 里，直接丢弃。
            if (this.destroyedWith !== undefined) {
                for (const host of hosts) host.destroy(true)
            }
            styleManager.endBatch(root, outerRoot)
        }
        return frag
    }

    render(): void {
        const host = this
        const source = this.source
        // 所有行共享同一个 childContext/hostPath 节点（内容完全相同），避免每行两次对象分配
        this.childContext = {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)}

        // Hydrate: claim SSR rows once; first computation only establishes tracking.
        let hydrateSkipInitial = false
        if (isHydrating()) {
            if (!(this as any).__axiiHydrated) {
                this.hosts = []
                const savedParent = (source as any).__axiiHydrateListParent as ParentNode | undefined
                const savedStart = (source as any).__axiiHydrateListStart as number | undefined
                if (savedParent != null && savedStart != null) {
                    setChildCursor(savedParent, savedStart)
                }
                this.hydrateRowsFromCursor()
                ;(this as any).__axiiHydrated = true
            }
            // Nested row may already have hosts from createChildHost; do not clear them.
            hydrateSkipInitial = true
        } else {
            this.hosts = []
        }

        let ownedByHost = false
        this.hostRenderComputed = computed(
            function computation(this:Computed) {
                // CAUTION 列表的 computed 由 RxListHost.destroy 显式销毁，不能被创建时恰好打开的
                //  collect frame / 父 effect 接管（归属不变量见 detachEffectFromCreationContext）。
                //  computed 在构造器里就同步跑第一次 computation，此刻它还是 frame 的最后一项。
                if (!ownedByHost) {
                    ownedByHost = true
                    detachEffectFromCreationContext(this)
                }
                this.manualTrack(source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                this.manualTrack(source, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE)
                // CAUTION 行 host 的 effect 不注册为本 computed 的子 effect：
                //  行 host 一定会被显式 destroy（splice 删除/列表销毁），不需要父子级联清理，
                //  这样每行创建/销毁都省一次父子登记与移除。
                this.pauseCollectChild()
                try {
                    const hosts = host.hosts!
                    if (hydrateSkipInitial) {
                        hydrateSkipInitial = false
                        return null
                    }
                    // CAUTION data0 >= 2.9 的错误恢复契约(data0Contract.spec 条款 8):
                    //  patch 抛错(rethrow 出口)后 data0 把该 computed 回退到全量重算阶段,
                    //  下一次源变更会**重跑本 computation**(而不是继续 patch)。重跑语义
                    //  即全量重建:先销毁上一轮的行(自摘 DOM),再按当前 data 重建。
                    //  旧实现假定 computation 只跑一次,重跑时残留 hosts 会让行组件撞上
                    //  "should never rerender" 断言,列表区域从此永久崩坏。
                    if (hosts.length) {
                        for (const previous of hosts) previous.destroy()
                        hosts.length = 0
                    }
                    const data = source.data
                    try {
                        for (let i = 0; i < data.length; i++) {
                            hosts.push(host.createChildHost(data[i]))
                        }
                        const rows = host.renderNewHosts(hosts)
                        // 渲染过程中列表被销毁：行已在 renderNewHosts 里回收，没有东西可插入
                        if (host.destroyedWith !== undefined) return null
                        insertBefore(rows, host.placeholder)
                    } catch (error) {
                        // CAUTION 初始行渲染发生在 data0 computed 的 computation 里。data0 >= 2.2
                        //  同步 computed 全程同步执行，向上抛会同步抛回变更/创建调用点；但错误
                        //  边界仍在这里：不回收的话该区域卡死，后续销毁还会对未初始化的
                        //  computed/hosts 再抛错。与 applyPatch 的错误出口对齐：已创建的行全部
                        //  回收（DOM 还在脱离文档的 fragment 里，直接丢弃），区域渲染为空；
                        //  错误交给 root error 钩子，未消费时先 reportAxiiError 输出结构化报告
                        //  再继续抛出保持可观测。
                        for (const created of hosts) created.destroy(true)
                        hosts.length = 0
                        if (!host.pathContext.root.dispatch('error', error)) {
                            reportAxiiError(error)
                            throw error
                        }
                        return null
                    }
                    // 行是在脱离文档的 fragment 里渲染的，插入完成后才执行行内登记的 layoutEffect/ref。
                    // 列表自身仍未连通（在更外层 fragment 里）时跳过，留给外层 flush。
                    if (host.placeholder.isConnected) {
                        host.pathContext.root.flushAttachQueue()
                    }
                } finally {
                    this.resumeCollectChild()
                }
                return null
            },
            function applyPatch(this: Computed, _, triggerInfos) {
                this.pauseCollectChild()
                try {
                    let patchFailed = false
                    for (const info of triggerInfos) {
                        // 上一个 patch 渲染的行同步销毁了列表自己：剩下的 patch 没有对象了
                        if (host.destroyedWith !== undefined) break
                        // CAUTION patch 在 data0 的 computed 里执行。data0 >= 2.2 同步 patch 是
                        //  同步执行的：向上抛会同步抛回到变更调用点（list.push 等）。外部通过
                        //  root.on('error') 注册了处理器时交给处理器（应用保持存活，该列表区域
                        //  可能处于不一致状态）；否则先 reportAxiiError 输出结构化报告，
                        //  再继续抛出保持可观测（data0Contract.spec 条款 7 锁定同步抛出行为）。
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
                            patchFailed = true
                            if (!host.pathContext.root.dispatch('error', error)) {
                                reportAxiiError(error)
                                throw error
                            }
                            // source 已经完成整批数据写入，但当前 DOM patch 失败后继续消费
                            // 后续 triggerInfo 只会在不一致状态上继续修改 hosts。错误被边界
                            // 消费时采用 fail-stop：保留最后一个完整 DOM，等待上层销毁/恢复。
                            break
                        }
                    }
                    // CAUTION 开发期列表不变量：每个 patch 批次结束后校验「hosts 数 === data 数」
                    //  与「行区间在 DOM 中按数组顺序排列」。这类破坏（契约外的稀疏 set、
                    //  外部代码搬动行节点等）不校验的话不会抛任何错，只会永远渲染错的顺序。
                    // patch 已经失败并交给 error 钩子时不再跑批末不变量，避免同一根因连续
                    // 上报两次错误；失败 patch 自身必须负责产出结构化错误。
                    if (!patchFailed && host.destroyedWith === undefined && isAxiiDiagnosticsEnabled()) {
                        try {
                            host.assertListInvariants()
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
    /**
     * 开发期不变量（只在诊断开启时由 applyPatch 调用）：
     * 1. hosts 数量与 source.data 数量一致；
     * 2. 已渲染行的 DOM 区间按 hosts 数组顺序排列，且都在 placeholder 之前。
     * 任一破坏说明数据与 DOM 已静默错位，抛出结构化的 AXII_LIST_ORDER_BROKEN。
     */
    assertListInvariants() {
        const hosts = this.hosts!
        const dataLength = this.source.data.length
        if (hosts.length !== dataLength) {
            throw createListOrderError({
                ownerHost: this,
                start: this.element,
                end: this.placeholder,
                operation: 'splice',
            }, `Axii list invariant is broken: ${hosts.length} row host(s) but list.data has ${dataLength} item(s). Out-of-contract RxList usage (e.g. sparse set()) can cause this.`)
        }
        let previous: Host|null = null
        for (let i = 0; i < hosts.length; i++) {
            const current = hosts[i]
            if (!current || !isHostRendered(current)) continue
            if (previous) {
                const prevLast = hostLastNode(previous)
                const currentFirst = hostFirstNode(current)
                const position = prevLast.compareDocumentPosition(currentFirst)
                // CAUTION 不同树（一个在 fragment、一个在文档）无法比较顺序，跳过而不是误报
                if (!(position & Node.DOCUMENT_POSITION_DISCONNECTED) &&
                    !(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
                    throw createListOrderError({
                        ownerHost: this,
                        start: hostFirstNode(current),
                        end: this.placeholder,
                        operation: 'splice',
                    }, `Axii list invariant is broken: row ${i} appears before its predecessor in the DOM. The rendered order no longer matches list.data.`)
                }
            }
            previous = current
        }
        if (previous && this.placeholder.parentNode) {
            const prevLast = hostLastNode(previous)
            const position = prevLast.compareDocumentPosition(this.placeholder)
            if (!(position & Node.DOCUMENT_POSITION_DISCONNECTED) &&
                !(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
                throw createListOrderError({
                    ownerHost: this,
                    start: this.element,
                    end: this.placeholder,
                    operation: 'splice',
                }, 'Axii list invariant is broken: the last row appears after the list placeholder in the DOM.')
            }
        }
    }
    applyTriggerInfo(info: TriggerInfo) {
        // CAUTION 一次 patch 里被删除的行各自释放 stylesheet（见 StyleManager.beginBatch）：
        //  不合并的话清空 N 行带独有嵌套样式的列表是 O(N²)。新行的表在行被插入文档之前写入
        //  （DOM.ts insertBefore），所以 patch 内部的 flushAttachQueue 看到的样式不变。
        const styleManager = StaticHost.styleManager
        const root = this.pathContext.root
        const outerRoot = styleManager.beginBatch(root)
        try {
            this.applyTriggerInfoInBatch(info)
        } finally {
            styleManager.endBatch(root, outerRoot)
        }
    }
    applyTriggerInfoInBatch(info: TriggerInfo) {
        const {method, argv, key, methodResult, type} = info
        if (method === 'splice') {
            this.handleSplice(argv!, methodResult as any[]|undefined)
            // 被删除的行可能是 select 里被选中的 option：整段删除不经过行 host 自己的移除路径，
            //  在这里按存值重放一次（见 restoreSelectValueAfterRemoval）。
            if ((methodResult as any[]|undefined)?.length) {
                restoreSelectValueAfterRemoval(this.placeholder.parentNode)
            }
        } else if(method === 'reorder') {
            this.handleReorder(argv![0], (info as any).reorderInfo)
        } else if(type === TriggerOpTypes.EXPLICIT_KEY_CHANGE) {
            // CAUTION 必须传 info.newValue（操作时的值），不能在 handler 里回读
            //  source.data[key]：key 是操作时位置，source.data 是重放时终态——
            //  batch 内 set+splice 时终态下标上已是别的元素（data0 RxList.map 同款注释）。
            this.handleExplicitKeyChange(key as number, info.newValue)
          /* v8 ignore next 3 */
        } else {
            throw new Error('unknown trigger info')
        }
    }
    /**
     * CAUTION 被删除的行和新行只有这一个顺序（splice / push / pop / shift / unshift / clear /
     *  整段替换都走这里），与 set（handleExplicitKeyChange）一致：
     *
     *  1. hosts 数组先改到位：删除的行摘出来，新行只创建 host 对象、不渲染。
     *  2. 先拆旧行（removeRows）：
     *     a. 逐行 destroy —— 清理函数、ref(null)、绑定销毁都在这一步，此刻行的 DOM 还连在文档里
     *        （I39：onCleanup 里测量 / 读 scrollTop 是自然写法）；
     *     b. 再摘 DOM。行都不需要自己处理 DOM（没有离场动画 / reusable）、列表区间里也没有
     *        还在离场的旧行时，用 replaceChildren / Range 一次删完；否则每行自己摘，
     *        离场动画照常播完。
     *  3. 再挂新行：在脱离文档的 fragment 里渲染 → 插入 → flush layoutEffect / ref。
     *
     *  这个顺序同时保证：
     *  - ref 契约：旧行的 ref(null) 一定早于新行的 ref(el)。新旧两行共用同一个 ref、或在
     *    cleanup / 函数体里用同一个名字注销 / 注册（表单项）时，结果停在新行上。
     *    之前是先挂新行再拆旧行：splice(i, 1, next) 之后 ref 是 null，而 set(i, next) 是对的。
     *  - 新行渲染抛错时旧行已经拆完，不会变成「既不在 hosts 里、也没被销毁」的孤儿
     *    （data0 的恢复重跑只认 hosts，孤儿行的 DOM 和 effect 会永久残留）。
     *  - 还在播放离场动画的旧行不会被后来的整段删除抹掉。
     */
    handleSplice(argv: any[], deletedItems?: any[]) {
        const hosts = this.hosts!
        // CAUTION data0 透传的是 splice 的原始参数，负数/越界/小数 start 都是 Array#splice 的
        //  合法用法（splice(-1, 0, x) 在最后一个之前插入；ToIntegerOrInfinity 把 1.5 截断成 1、
        //  NaN/undefined 归 0）。hosts.splice 自己会做同样的归一化，但下面「往后找插入锚点」
        //  的扫描用的是原始值：不归一化的话，负数/小数 start 会从错误（甚至不存在）的位置开始扫，
        //  读到 undefined host 直接抛错，或把新行插到错误的 DOM 位置（数据与 DOM 永久错位）。
        const rawStart = Math.trunc(argv[0] as number) || 0
        const start = rawStart < 0 ? Math.max(hosts.length + rawStart, 0) : Math.min(rawStart, hosts.length)
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

        // 1. hosts 改到位
        const deletedHosts = spliceHosts(hosts, start, deleteCount, newHosts)

        // 2. 先拆旧行。kept：这次 splice 之外仍然在列表里的行数
        if (deletedHosts.length) this.removeRows(deletedHosts, hosts.length - newHosts.length)

        // 3. 再挂新行（旧行的清理函数同步销毁了列表自己时，renderNewHosts 一行都不会渲染）
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
            const rows = this.renderNewHosts(newHosts)
            if (this.destroyedWith !== undefined) return
            insertBefore(rows, insertBeforeHost?.element || this.placeholder)
            // 新行是在脱离文档的 fragment 里渲染的，插入完成后才执行行内登记的 layoutEffect/ref。
            // 列表自身仍未连通时跳过，留给外层 flush。
            if (this.placeholder.isConnected) {
                this.pathContext.root.flushAttachQueue()
            }
        }
    }
    // 拆掉已经从 hosts 里摘出来的行，顺序见 handleSplice 的说明（先 destroy、后摘 DOM）。
    removeRows(deletedHosts: Host[], keptCount: number) {
        // 列表区间里有还在离场的旧行时不能整段删：replaceChildren / Range 会把它一起抹掉
        let canBulkRemove = !this.hasLeavingRows()
        if (canBulkRemove) {
            for (const deleted of deletedHosts) {
                if (deleted.forceHandleElement) {
                    canBulkRemove = false
                    break
                }
            }
        }
        const firstNode = canBulkRemove ? hostFirstNode(deletedHosts[0]) : null
        const lastNode = canBulkRemove ? hostLastNode(deletedHosts[deletedHosts.length - 1]) : null

        if (!(canBulkRemove && firstNode!.parentNode && firstNode!.parentNode === lastNode!.parentNode)) {
            const parent = this.placeholder.parentNode
            let destroyed = 0
            try {
                for (; destroyed < deletedHosts.length; destroyed++) {
                    const deleted = deletedHosts[destroyed]
                    if (parent && deleted.forceHandleElement) {
                        // 这一行自己处理 DOM，可能等离场动画播完才摘：destroy 之后仍留在父节点里的
                        //  顶层节点记下来，它们消失之前后续删除都不能走整段路径。
                        const nodes = rowNodes(deleted)
                        deleted.destroy()
                        for (const node of nodes) {
                            if (node.parentNode === parent) (this.leavingNodes ??= []).push(node)
                        }
                    } else {
                        deleted.destroy()
                    }
                }
            } finally {
                // 某一行的清理函数抛错（没有 error 钩子）：剩下的行已经不在 hosts 里，
                //  这里不拆就再也没有人拆了。
                if (destroyed < deletedHosts.length) destroyRowsBestEffort(deletedHosts, destroyed + 1, false)
            }
            return
        }

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
        const removeAllElementByParent = keptCount === 0 &&
            !this.placeholder.nextSibling && // 当前节点是父 Host 的最后一个
            !firstNode!.previousSibling // 删除的Host 是父 Host 的第一个，说明从头删到了尾
        // CAUTION Range 要在 destroy 之前建好：个别 host（PrimitiveHost）在 destroy(true) 里也会
        //  摘掉自己的文本节点，live Range 会跟着收缩，事后再用被摘掉的节点定边界会抛错。
        const parent = firstNode!.parentNode!
        let range: Range|undefined
        if (!removeAllElementByParent) {
            range = document.createRange()
            range.setStartBefore(firstNode!)
            range.setEndAfter(lastNode!)
        }
        let destroyed = 0
        try {
            // 先销毁：清理函数看到的 DOM 还连在文档里（I39）
            for (; destroyed < deletedHosts.length; destroyed++) deletedHosts[destroyed].destroy(true)
        } finally {
            if (destroyed < deletedHosts.length) destroyRowsBestEffort(deletedHosts, destroyed + 1, true)
            // 再摘 DOM。即使某一行的清理函数抛错也必须摘：这些行已经不在 hosts 里了
            if (removeAllElementByParent) {
                // 清理函数里列表自己可能已被同步销毁并摘掉了 placeholder（destroyedWith === false）：
                //  行的 DOM 照样要清，但不能再把 placeholder 放回去
                if (this.destroyedWith === false) parent.replaceChildren()
                else parent.replaceChildren(this.placeholder)
            } else {
                range!.deleteContents()
            }
        }
    }
    hasLeavingRows() {
        const nodes = this.leavingNodes
        if (!nodes) return false
        const parent = this.placeholder.parentNode
        let kept = 0
        for (const node of nodes) {
            if (node.parentNode === parent) nodes[kept++] = node
        }
        if (!kept) {
            this.leavingNodes = undefined
            return false
        }
        nodes.length = kept
        return true
    }
    handleReorder(pairs: [number, number][], reorderInfo?: ReorderInfo) {
        const hosts = this.hosts!
        // 1. 先把 hosts 数组调整到新顺序（语义同 data0 RxList.reorder：data[to] = old[from]）
        let minChanged = Infinity
        let maxChanged = -Infinity
        let movedCount = 0
        const movedHosts: Host[] = new Array(pairs.length)
        for (let i = 0; i < pairs.length; i++) {
            movedHosts[i] = hosts[pairs[i][0]]
        }
        for (let i = 0; i < pairs.length; i++) {
            const [from, to] = pairs[i]
            hosts[to] = movedHosts[i]
            if (from !== to) {
                movedCount++
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

        const rangeLength = maxChanged - minChanged + 1
        // CAUTION 稀疏 reorder（swap 两个相距很远的行是最常见的形态）：下面的 LIS 要为整个受影响
        //  区间分配数组并做 O(区间 · log) 的计算，而真正换了位置的只有 movedCount 行——
        //  swap(0, n-1) 在 20 万行的列表上每次 6ms，全花在没有动的行上。
        //  换位的行数相对区间足够少时直接安放这几行，成本只取决于换位的行数。
        //  阈值保证最坏情况下多做的 DOM 搬移（LIS 本可以省掉的那部分）不超过 LIS 自己的计算量级。
        if (movedCount * SPARSE_REORDER_RATIO <= rangeLength) {
            this.placeMovedRows(pairs, movedCount)
            return
        }

        // 2. 计算受影响区间内每个新位置对应的旧位置
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
    /**
     * 稀疏 reorder：hosts 已是新顺序，只安放换了位置的行。
     * 没换位置的行下标不变，彼此的 DOM 相对顺序本来就对；换了位置的行按新下标从大到小，
     * 逐个贴到「新顺序里后一行」的前面——处理到某一行时它后面的行都已就位，之后的操作
     * 只搬下标更小的行，不会再拆开这对相邻关系，所以结束时每一行都紧贴在后一行之前。
     */
    placeMovedRows(pairs: [number, number][], movedCount: number) {
        const hosts = this.hosts!
        const targets: number[] = new Array(movedCount)
        let count = 0
        for (let i = 0; i < pairs.length; i++) {
            if (pairs[i][0] !== pairs[i][1]) targets[count++] = pairs[i][1]
        }
        targets.sort(descending)
        for (let i = 0; i < targets.length; i++) {
            const to = targets[i]
            const row = hosts[to]
            const anchor = to + 1 < hosts.length ? hosts[to + 1].element : this.placeholder
            const last = hostLastNode(row)
            // 已经贴在后一行前面（例如相邻两行里只需要搬一行）就不动
            if (last.nextSibling !== anchor) insertBefore(row.element as any, anchor as any, last as any)
        }
    }
    handleExplicitKeyChange(index: number, newValue: any) {
        const hosts = this.hosts!
        // data0 的 set(index, value) 可以像数组赋值一样扩大 length，但 RxListHost 的
        // 增量替换契约只支持已有稠密索引。必须在销毁旧行/写 hosts[index] 之前拒绝，
        // 否则 hosts 会先变成稀疏数组，随后锚点查找以原生 TypeError 崩溃。
        if (!Number.isInteger(index) || index < 0 || index >= hosts.length || !hosts[index]) {
            throw createListOrderError({
                ownerHost: this,
                start: this.element,
                end: this.placeholder,
                operation: 'splice',
            }, `RxList.set received out-of-range index ${index}; rendered host count is ${hosts.length}. set() can only replace an existing dense row.`)
        }
        const oldHost = hosts[index]
        // CAUTION 旧行的清理函数是用户代码，可能同步销毁列表自己（行消失时关掉所在的弹层）。
        //  旧行此刻还在 hosts[index] 上：不登记的话 destroy 会把它再销毁一次（清理函数跑两遍）。
        const outerRowsOnStack = this.rowsOnStack
        this.rowsOnStack = [oldHost]
        try {
            oldHost.destroy()
        } finally {
            this.rowsOnStack = outerRowsOnStack
        }
        // 列表已被销毁：没有地方可以挂新行了
        if (this.destroyedWith !== undefined) return

        const newHost = this.createChildHost(newValue)
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
        // CAUTION 与 renderNewHosts 同一套重入处理：新行渲染到一半时列表被同步销毁，destroy 会
        //  跳过这一行，渲染栈退出后在这里销毁恰好一次（新行已经插在真实 DOM 里，按列表被销毁时的
        //  方式处理它的 DOM）。
        this.rowsOnStack = [newHost]
        try {
            newHost.render()
        } catch (error) {
            if (this.destroyedWith === undefined) throw error
        } finally {
            this.rowsOnStack = outerRowsOnStack
            if (this.destroyedWith !== undefined) newHost.destroy(this.destroyedWith)
        }
        if (this.destroyedWith !== undefined) return
        // compact host 的元素/ref 登记发生在 render 里（此时可能仍未连通），插入后统一 flush。
        // 列表自身仍未连通时跳过，留给外层 flush。
        if (this.placeholder.isConnected) {
            this.pathContext.root.flushAttachQueue()
        }
    }
    destroy(fromParentDestroy?: boolean) {
        trackHostDestroyed(this)
        this.destroyedWith = !!fromParentDestroy
        // CAUTION render 可能中途抛错（行渲染错误已交给 error 钩子/向上抛出），
        //  此时 hostRenderComputed/hosts 可能尚未初始化，destroy 必须容忍，
        //  否则错误恢复路径（函数节点重算、root.destroy）会二次崩溃。
        if (this.hostRenderComputed) destroyComputed(this.hostRenderComputed)
        // 理论上我们只需要处理自己的 placeholder 就行了，下面的 host 会处理各自的元素
        // 各行释放的 stylesheet 合并成一次写入（见 StyleManager.beginBatch）
        const styleManager = StaticHost.styleManager
        const root = this.pathContext.root
        const outerRoot = styleManager.beginBatch(root)
        try {
            this.destroyRows(fromParentDestroy)
        } finally {
            styleManager.endBatch(root, outerRoot)
        }
        if (!fromParentDestroy) this.placeholder.remove()
    }
    private destroyRows(fromParentDestroy?: boolean) {
        const rowsOnStack = this.rowsOnStack
        if (rowsOnStack) {
            // CAUTION 重入销毁：自己的 patch 还在调用栈上，正在渲染的新行里有人同步销毁了列表
            //  （行的 effect / error 监听器调用 root.destroy()，或销毁了包着列表的东西）。
            //  这批新行此刻渲染到一半或还没开始：现在销毁它们，渲染栈退出时它们会继续渲染、
            //  继续跑 effect，却再也没有人销毁（清理函数永不执行、绑定一直订阅）。
            //  所以跳过它们，由 renderNewHosts / handleExplicitKeyChange 在渲染栈退出后销毁恰好一次。
            //  正在销毁的旧行（set 的旧行）同理跳过：它的销毁已经在栈上，不能再来一次。
            const onStack = new Set(rowsOnStack)
            this.hosts?.forEach(host => {
                if (!onStack.has(host)) host.destroy(fromParentDestroy)
            })
        } else {
            this.hosts?.forEach(host => host.destroy(fromParentDestroy))
        }
    }
}

// 稀疏 reorder 的判定：换了位置的行数 × 这个比例 <= 受影响区间长度（见 handleReorder）
const SPARSE_REORDER_RATIO = 64
function descending(a: number, b: number) {
    return b - a
}

// CAUTION 不能写 hosts.splice(start, deleteCount, ...newHosts)：展开成实参的数量有上限，
//  一次 splice 带十几万行（getter 型 RxList 整体重算、派生列表转发、spliceArray）就是
//  RangeError: Maximum call stack size exceeded。data0 自己在 8192 项以上也不用展开。
const SPREAD_ARGUMENT_LIMIT = 8192
function spliceHosts(hosts: Host[], start: number, deleteCount: number, newHosts: Host[]): Host[] {
    if (newHosts.length <= SPREAD_ARGUMENT_LIMIT) return hosts.splice(start, deleteCount, ...newHosts)
    const tail = hosts.splice(start)
    const deleted = tail.splice(0, deleteCount)
    for (let i = 0; i < newHosts.length; i++) hosts.push(newHosts[i])
    for (let i = 0; i < tail.length; i++) hosts.push(tail[i])
    return deleted
}

// 一行当前占据的顶层节点（first ... last）
function rowNodes(host: Host): Node[] {
    const nodes: Node[] = []
    const last = hostLastNode(host)
    for (let node: Node|null = hostFirstNode(host); node; node = node.nextSibling) {
        nodes.push(node)
        if (node === last) break
    }
    return nodes
}

// 前面已经有一行的销毁抛了错（它会继续向上抛）：剩下的行尽力销毁，再出错只上报，不能盖掉第一个错误
function destroyRowsBestEffort(hosts: Host[], from: number, parentHandle: boolean) {
    for (let i = from; i < hosts.length; i++) {
        try {
            hosts[i].destroy(parentHandle)
        } catch (error) {
            reportAxiiError(error)
        }
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
