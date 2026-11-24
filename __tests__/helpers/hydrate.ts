/**
 * 激活入口的测试辅助（#55，设计 docs/ssr-support/hydration-top-down.md §7.2、§3.4）。
 *
 * 调用激活的 spec 文件都经这里激活，不直接调用 hydrateRoot。vitest.config.ts 用 test.projects 把这些文件跑三遍：
 *  - 「default」一遍：TOP_DOWN_PASS 为 false，调用公开的 hydrateRoot（旧模型），诊断按各文件自己的配置；
 *  - 「top-down」一遍：define 了 __AXII_HYDRATE_TOP_DOWN__，调用不导出的内部入口 hydrateRootTopDown（新模型），
 *    激活期间诊断开启（__AXII_HYDRATE_DIAGNOSTICS__ 为 true：createElement 返回开发期 Proxy，开发期报告与不变量都在）；
 *  - 「top-down-diag-off」一遍：同上，激活期间诊断关闭（描述是裸对象，与生产相同）。
 * 诊断开关只覆盖激活这一次调用（§3.4「两遍验收」）：描述的种类在激活开始时定，文件里不经过激活的诊断断言不受影响。
 * configureDiagnostics 只能整体替换配置、没有读取接口，所以这些文件的 configureDiagnostics 从这里导入：这里记下最近一次配置，
 * 激活时只改 enabled，onError 等照旧，返回后恢复。
 * #55 S 把 hydrateRoot 切到新模型之后，删除这里的入口切换与旧入口那一遍，保留诊断开关两遍（§7.4 S）。
 */
import {configureDiagnostics as configureFrameworkDiagnostics, hydrateRoot} from '@framework'
import {hydrateRootTopDown} from '../../src/hydrateTopDown'

declare const __AXII_HYDRATE_TOP_DOWN__: boolean | undefined
declare const __AXII_HYDRATE_DIAGNOSTICS__: boolean | undefined

/** 这一遍是不是走内部入口（新模型）。 */
export const TOP_DOWN_PASS: boolean = typeof __AXII_HYDRATE_TOP_DOWN__ !== 'undefined' && __AXII_HYDRATE_TOP_DOWN__ === true

/** 这一遍激活期间诊断开没开（§3.4 两遍验收）。旧入口那一遍为 undefined：不覆盖，按文件自己的配置。 */
export const HYDRATE_DIAGNOSTICS: boolean | undefined = typeof __AXII_HYDRATE_DIAGNOSTICS__ !== 'undefined' ? __AXII_HYDRATE_DIAGNOSTICS__ : undefined

type DiagnosticsConfig = Parameters<typeof configureFrameworkDiagnostics>[0]
let currentDiagnostics: DiagnosticsConfig = {}

/** 同 @framework 的 configureDiagnostics，另外记下这次配置，激活时只覆盖 enabled。 */
export function configureDiagnostics(config: DiagnosticsConfig): void {
    currentDiagnostics = config
    configureFrameworkDiagnostics(config)
}

type HydrateOptions = { portals?: Record<string, HTMLElement> }

/** 按这一遍激活：旧入口那一遍是 hydrateRoot，内部入口那一遍是 hydrateRootTopDown。参数与返回值同 hydrateRoot。 */
export function hydrate(container: HTMLElement, source: any, options?: HydrateOptions): ReturnType<typeof hydrateRoot> {
    if (!TOP_DOWN_PASS) return hydrateRoot(container, source, options)
    if (HYDRATE_DIAGNOSTICS === undefined) return hydrateRootTopDown(container, source, options)
    const saved = currentDiagnostics
    configureFrameworkDiagnostics({...saved, enabled: HYDRATE_DIAGNOSTICS})
    try {
        return hydrateRootTopDown(container, source, options)
    } finally {
        configureFrameworkDiagnostics(saved)
    }
}
