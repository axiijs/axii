/**
 * hydrateRoot：激活（hydration）的入口。设计：docs/ssr-support/hydration-top-down.md（#55）。
 *
 * 激活是 ssr.ts serialize 的逆过程（自顶向下认领）：激活期间 createElement 返回延迟描述（HydrationElement），各 Host 在自己的
 * 位置按文档顺序从游标处读回服务端节点，先消费自己的内容、再认领自己的 placeholder（§2.1、§2.4）。
 * 过程（§2.5「根」）：
 *  1. 进入激活状态：激活期间的 createElement 返回描述；记下 options.portals（Portal 按 key 找容器）；
 *  2. 根容器按 render.hydrateContainerTopDown 激活（游标、根 Host、容器层的 R5、原始标记核对、样式迁移、D13），
 *     Portal 在自己的位置对它的容器走同一个过程（§2.6.5）；
 *  3. 诊断开启时对每个激活完的容器检查开发期不变量（§4.4）。
 * 失配：报告 HydrationMismatchError（交给 onError），按 R1–R5 在游标处修复，不中止（hydrationCursor.ts，§4）。
 * 剩下的中止只有渲染错误（§7.8）。
 */
import {beginHydration, endHydration, HydrationInvariantError, isCommentData} from "./hydration"
import {hydrateContainerTopDown} from "./render"
import type {Root} from "./render"
import type {ComponentNode} from "./types"
import {enterTopDownActivation, getTopDownContainers, leaveTopDownActivation} from "./hydrationCursor"
import {CompactElementHost} from "./StaticHost"
import {RxListHost} from "./RxListHost"
import {StaticArrayHost} from "./StaticArrayHost"
import {assertRangeReachable, isAxiiDiagnosticsEnabled, reportAxiiError} from "./diagnostics"
import type {Host} from "./Host"
import {clearTopDownAbort, isHydrationSlot} from "./hydrationElement"

/**
 * Activate a server-rendered DOM tree in place: claim the existing nodes top-down, in document order; do not rebuild.
 * Container children must include `renderToString` output ending with `<!--root-->`.
 * During hydration JSX evaluates to deferred descriptions, not DOM nodes (see `isHydrationElement`); use `ref` to reach nodes.
 * @category Basic
 */
export function hydrateRoot(
    container: HTMLElement,
    source: JSX.Element|ComponentNode|Function|null|undefined,
    options?: { portals?: Record<string, HTMLElement> },
): Root {
    const saved = beginHydration()
    const activation = enterTopDownActivation(options?.portals)
    try {
        // 根容器与各 Portal 容器（§2.6.5）走同一个过程：render.hydrateContainerTopDown
        const root = hydrateContainerTopDown(container, source, undefined)
        // 激活中 root 被销毁时激活的树已整体丢弃，没有记下容器；Portal 的容器在各自的 Portal 里记下（它们的 root 属于 Portal）
        const containers = getTopDownContainers(activation)
        // 根容器在自己的激活完成之后最后记下；没有它就是激活的树被丢弃了（其中 Portal 的 root 随之销毁），不检查
        if (isAxiiDiagnosticsEnabled() && containers[containers.length - 2] === container) {
            for (let i = 0; i < containers.length; i += 2) {
                checkTopDownInvariants(containers[i] as ParentNode, containers[i + 1] as Host)
            }
        }
        return root
    } finally {
        clearTopDownAbort()
        leaveTopDownActivation(activation)
        endHydration(saved)
    }
}

/**
 * §4.4 开发期不变量（O(n)，只在诊断开启时运行）：
 *  1. 每个 Host 的 placeholder 都是真实节点，不是 slot 常量；
 *  2. 每个 Host 的 [element … placeholder] 区间可达、在文档中（复用 assertRangeReachable）；
 *  3. 容器里没有残留的 axii:t / axii:/t / axii:0 标记，也没有没换成新建元素的占位 axii:fresh。
 * 违反时报告 AXII_HYDRATION_INVARIANT（HydrationInvariantError），不抛出。
 */
function pushAll(into: Host[], hosts: Host[]): void {
    for (let i = 0; i < hosts.length; i++) into.push(hosts[i])
}

function checkTopDownInvariants(container: ParentNode, rootHost: Host): void {
    const pending: Host[] = [rootHost]
    while (pending.length) {
        const host = pending.pop()!
        if (host instanceof CompactElementHost) {
            // Compact 行没有自己的 placeholder（共享的 COMPACT_SHARED_PLACEHOLDER 不在文档里），区间就是行元素本身
            if (!(host.element as ChildNode).isConnected) {
                reportAxiiError(new HydrationInvariantError('CompactElementHost.element is not in the document'))
            }
        } else {
            const placeholder = host.placeholder as unknown
            if (isHydrationSlot(placeholder)) {
                reportAxiiError(new HydrationInvariantError(`${host.constructor.name}.placeholder is still the slot "${placeholder}"`))
                continue
            }
            const start = host.element as ChildNode
            const end = host.placeholder as ChildNode
            if (!end.isConnected) {
                reportAxiiError(new HydrationInvariantError(`${host.constructor.name}.placeholder is not in the document`))
            } else if (start !== end) {
                try {
                    assertRangeReachable({ownerHost: host, start, end, boundaryKind: 'range', operation: 'render'})
                } catch (cause) {
                    reportAxiiError(new HydrationInvariantError(`${host.constructor.name} range [element … placeholder] is not reachable`, cause))
                }
            }
        }
        // 内层 Host：ComponentHost / FunctionHost 的 innerHost，StaticHost 的 reactiveHosts（单个或数组），
        //  RxListHost 的行（hosts），StaticArrayHost 的项（childHosts）
        const inner = (host as {innerHost?: Host | null}).innerHost
        if (inner) pending.push(inner)
        // CAUTION 逐个 push，不用展开参数：长列表的行数可以超过函数参数个数的上限（RangeError，同 RxListHost.spliceHosts）
        const hosts = (host as {reactiveHosts?: Host | Host[]}).reactiveHosts
        if (Array.isArray(hosts)) pushAll(pending, hosts)
        else if (hosts) pending.push(hosts)
        if (host instanceof RxListHost) pushAll(pending, host.hosts!)
        else if (host instanceof StaticArrayHost) pushAll(pending, host.childHosts)
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (isCommentData(node, 'axii:t') || isCommentData(node, 'axii:/t') || isCommentData(node, 'axii:0') || isCommentData(node, 'axii:fresh')) {
            reportAxiiError(new HydrationInvariantError(`a leftover <!--${(node as Comment).data}--> marker`))
        }
    }
}
