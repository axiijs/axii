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
 *  4. 容器上剩下的只能是 STYLE / SCRIPT / LINK；迁移服务端样式之后，激活区间之外不能再有节点；
 *  5. 诊断开启时检查开发期不变量（§4.4）。
 * 失配报告 HydrationMismatchError 并抛出（修复在 B3）；还没有实现的形态（列表、数组在 B2；Portal、reusable、lazy、
 * 现成节点在 B4）显式抛出 TopDownPendingError。
 */
import {beginTopDownHydration, endTopDownHydration, HydrationInvariantError, isCommentData, reportHydrationMismatch, summarizeChild} from "./hydration"
import {createRootInternal} from "./render"
import type {Root} from "./render"
import {enterTopDownContainer, finishTopDownContainer, leaveTopDownContainer} from "./hydrationCursor"
import {migrateSsrStyleTags} from "./StaticHost"
import {assertRangeReachable, isAxiiDiagnosticsEnabled, reportAxiiError} from "./diagnostics"
import type {Host} from "./Host"
import {isHydrationSlot} from "./hydrationElement"

export function hydrateRootTopDown(
    container: HTMLElement,
    source: any,
    _options?: { portals?: Record<string, HTMLElement> },
): Root {
    const saved = beginTopDownHydration()
    const depth = enterTopDownContainer(container)
    try {
        const root = createRootInternal(container, undefined, undefined, true)
        const host = root.render(source)
        // 激活中 root 被销毁（error 监听器 root.destroy()，可能随后渲染了别的内容）：激活的树已整体丢弃（root.render 的重入
        //  说明），游标停在中途，容器检查与不变量都不适用
        if (root.host !== host) return root
        finishTopDownContainer()
        // Adopted stylesheets are live; drop SSR <style data-axii-ssr> without FOUC.
        migrateSsrStyleTags(container)
        if (root.host) assertTopDownContainerClean(container, root.host)
        if (root.host && isAxiiDiagnosticsEnabled()) checkTopDownInvariants(container, root.host)
        return root
    } finally {
        leaveTopDownContainer(depth)
        endTopDownHydration(saved)
    }
}

/**
 * CSR 的 createRoot 之后，容器里只有根 Host 的区间 [host.element … <!--root-->]。服务端样式迁移之后，区间之外还有节点
 * （不带 data-axii-ssr 的 STYLE / SCRIPT / LINK、杂节点）是失配：B1 报告并抛出（清扫是 B3 的 R5 / D13）。
 */
function assertTopDownContainerClean(container: ParentNode, host: Host): void {
    const first = host.element as ChildNode
    const last = host.placeholder as ChildNode
    if (last.nextSibling !== null) {
        throw reportHydrationMismatch('end of hydrate root children (top-down)', summarizeChild(last.nextSibling))
    }
    if (container.firstChild !== first) {
        throw reportHydrationMismatch('hydrate root children (top-down)', summarizeChild(container.firstChild))
    }
}

/**
 * §4.4 开发期不变量（O(n)，只在诊断开启时运行）：
 *  1. 每个 Host 的 placeholder 都是真实节点，不是 slot 常量；
 *  2. 每个 Host 的 [element … placeholder] 区间可达、在文档中（复用 assertRangeReachable）；
 *  3. 容器里没有残留的 axii:t / axii:/t / axii:0 标记。
 * 违反时报告 AXII_HYDRATION_INVARIANT（HydrationInvariantError），不抛出。
 */
function checkTopDownInvariants(container: ParentNode, rootHost: Host): void {
    const pending: Host[] = [rootHost]
    while (pending.length) {
        const host = pending.pop()!
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
        // 内层 Host：ComponentHost / FunctionHost 的 innerHost，StaticHost 的 reactiveHosts（单个或数组）
        const inner = (host as {innerHost?: Host | null}).innerHost
        if (inner) pending.push(inner)
        const hosts = (host as {reactiveHosts?: Host | Host[]}).reactiveHosts
        if (Array.isArray(hosts)) pending.push(...hosts)
        else if (hosts) pending.push(hosts)
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (isCommentData(node, 'axii:t') || isCommentData(node, 'axii:/t') || isCommentData(node, 'axii:0')) {
            reportAxiiError(new HydrationInvariantError(`a leftover <!--${(node as Comment).data}--> marker`))
        }
    }
}
