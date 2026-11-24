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
