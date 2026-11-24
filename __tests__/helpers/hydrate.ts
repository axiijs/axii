/**
 * 激活入口的测试辅助（#55，设计 docs/ssr-support/hydration-top-down.md §7.2）。
 *
 * 调用激活的 spec 文件都经这里激活，不直接调用 hydrateRoot。vitest.config.ts 用 test.projects 把这些文件跑两遍：
 *  - 「default」一遍：TOP_DOWN_PASS 为 false，调用公开的 hydrateRoot（旧模型）；
 *  - 「top-down」一遍：define 了 __AXII_HYDRATE_TOP_DOWN__，调用不导出的内部入口 hydrateRootTopDown（新模型）。
 * #55 S 把 hydrateRoot 切到新模型之后，删除这里的入口切换（§7.4 S）。
 */
import {hydrateRoot} from '@framework'
import {hydrateRootTopDown} from '../../src/hydrateTopDown'

declare const __AXII_HYDRATE_TOP_DOWN__: boolean | undefined

/** 这一遍是不是走内部入口（新模型）。 */
export const TOP_DOWN_PASS: boolean = typeof __AXII_HYDRATE_TOP_DOWN__ !== 'undefined' && __AXII_HYDRATE_TOP_DOWN__ === true

type HydrateOptions = { portals?: Record<string, HTMLElement> }

/** 按这一遍激活：旧入口那一遍是 hydrateRoot，内部入口那一遍是 hydrateRootTopDown。参数与返回值同 hydrateRoot。 */
export function hydrate(container: HTMLElement, source: any, options?: HydrateOptions): ReturnType<typeof hydrateRoot> {
    return TOP_DOWN_PASS
        ? hydrateRootTopDown(container, source, options)
        : hydrateRoot(container, source, options)
}

/**
 * 内部入口那一遍里还没有实现的形态（§7.2「待实现标记」）：返回 true 表示这一遍跳过这条用例，旧入口那一遍照常运行。
 * 用法：`test.skipIf(pendingTopDown('B2'))(name, fn)`、`describe.skipIf(pendingTopDown('B3'))(name, fn)`。
 * 参数是落地它的 PR（B2 列表与数组、B3 失配规则、B4 Portal / reusable / 现成节点 / lazy / 开发期 Proxy），
 * 那个 PR 去掉对应的标记；B4 结束时标记数为 0。只标两种失败：内部入口显式抛出的「not implemented yet」，
 * 以及对故意改动过的服务端 HTML 报告并抛出的 HydrationMismatchError（失配修复在 B3）。
 * 未改动的 renderToString 输出在内部入口上失配，是实现的缺陷，不能用这个标记盖住。
 */
export function pendingTopDown(_pr: 'B2' | 'B3' | 'B4'): boolean {
    return TOP_DOWN_PASS
}
