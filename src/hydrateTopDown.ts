/**
 * @internal
 * #55 新激活模型（自顶向下认领）的内部入口。设计：docs/ssr-support/hydration-top-down.md §7。
 *
 * CAUTION 这个模块不从 src/index.ts、ssr.ts 导出，src/ 里也没有别的模块导入它，只有用例导入
 *  （__tests__/helpers/hydrate.ts）。构建时它被 tree-shaking 去掉，它用到的 beginTopDownHydration 也一起去掉：
 *  公开产物里没有任何代码把激活模式置为「新」，公开的 hydrateRoot 在 #55 S 之前一直走旧模型（§7.1 第 4 点）。
 *  每个实现 PR 的验收都检查 dist 里找不到本模块独有的字符串（下面的报错文本）。
 *
 * 过程（§2.1、§2.5「根」）：
 *  1. 模式置为「新」：激活期间的 createElement 返回描述（HydrationElement）；
 *  2. 游标从容器的第一个子节点开始（容器上的 STYLE / SCRIPT / LINK 跳过）；
 *  3. 根 Host 由 createHydrateHost(source, 'root') 创建，hydrate('root') 按文档顺序逐个读回服务端节点，最后认领 <!--root-->；
 *  4. 容器上 <!--root--> 之后的节点（STYLE / SCRIPT / LINK 除外）按 R5 删除；这次激活有失配时核对干净认领的原始元素
 *     （§4.1 末段）；迁移服务端样式之后，激活区间之外剩下的节点删除（D13）；
 *  5. 诊断开启时检查开发期不变量（§4.4）。
 * 失配（B3）：报告 HydrationMismatchError（交给 onError），按 R1–R5 在游标处修复，不中止（hydrationCursor.ts）。
 * 还没有实现的形态（Portal、reusable、lazy、现成节点在 B4）显式抛出 TopDownPendingError。
 */
import {beginTopDownHydration, endTopDownHydration, HydrationInvariantError, isCommentData, removeHydrateContainerOrphans} from "./hydration"
import {createRootInternal} from "./render"
import type {Root} from "./render"
import {
    dropTopDownFreshElements,
    dropTopDownRawElements,
    enterTopDownContainer,
    finishTopDownContainer,
    getTopDownMismatchCount,
    leaveTopDownContainer,
    markTopDownFreshElements,
    markTopDownRawElements,
    verifyTopDownRawElements,
} from "./hydrationCursor"
import {CompactElementHost, migrateSsrStyleTags} from "./StaticHost"
import {RxListHost} from "./RxListHost"
import {StaticArrayHost} from "./StaticArrayHost"
import {assertRangeReachable, isAxiiDiagnosticsEnabled, reportAxiiError} from "./diagnostics"
import type {Host} from "./Host"
import {clearTopDownAbort, isHydrationSlot} from "./hydrationElement"

export function hydrateRootTopDown(
    container: HTMLElement,
    source: any,
    _options?: { portals?: Record<string, HTMLElement> },
): Root {
    const saved = beginTopDownHydration()
    const depth = enterTopDownContainer(container)
    const freshMark = markTopDownFreshElements()
    const rawMark = markTopDownRawElements()
    const mismatchesBefore = getTopDownMismatchCount()
    try {
        // 激活的树完整之后、派发 attach（ref / layoutEffect 是用户代码，可能改动原始标记的内容）之前：
        //  R5：容器这一层在 <!--root--> 之后剩下的节点（STYLE / SCRIPT / LINK 除外）删除并报告；
        //  这次激活有失配时，干净认领的原始元素可能跨了角色：核对它们的内容（§4.1、§2.6.2）。
        //  root.render 只在激活的树没有被丢弃时调用它
        const root = createRootInternal(container, undefined, undefined, true, () => {
            finishTopDownContainer()
            verifyTopDownRawElements(rawMark, mismatchesBefore)
        })
        const host = root.render(source)
        // 激活中 root 被销毁（error 监听器 root.destroy()，可能随后渲染了别的内容）：激活的树已整体丢弃（root.render 的重入
        //  说明，丢弃的树在那里销毁），容器清扫与不变量都不适用
        if (root.host !== host) return root
        // Adopted stylesheets are live; drop SSR <style data-axii-ssr> without FOUC.
        migrateSsrStyleTags(container)
        // D13：CSR 的 createRoot 之后容器里只有根 Host 的区间 [host.element … <!--root-->]。服务端样式迁移之后，
        //  区间之外的节点（不带 data-axii-ssr 的 STYLE / SCRIPT / LINK、前导的杂节点）删除并报告一次（与旧模型同一个函数）
        if (root.host) removeHydrateContainerOrphans(container, root.host as {element: Node, placeholder: Node})
        if (root.host && isAxiiDiagnosticsEnabled()) checkTopDownInvariants(container, root.host)
        return root
    } finally {
        // 中止时还没插入的新建元素、记下的原始元素随激活的树丢弃
        dropTopDownFreshElements(freshMark)
        dropTopDownRawElements(rawMark)
        clearTopDownAbort()
        leaveTopDownContainer(depth)
        endTopDownHydration(saved)
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
