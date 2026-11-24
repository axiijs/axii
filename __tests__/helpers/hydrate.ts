/**
 * 激活入口的测试辅助（#55，设计 docs/ssr-support/hydration-top-down.md §3.4、§7.2）。
 *
 * 调用激活的 spec 文件都经这里激活，不直接调用 hydrateRoot。vitest.config.ts 用 test.projects 把这些文件跑两遍：
 *  - 「hydrate-diag-on」一遍：define 了 __AXII_HYDRATE_DIAGNOSTICS__ = true，激活期间诊断开启（createElement 返回开发期 Proxy，
 *    开发期报告与不变量都在）；
 *  - 「hydrate-diag-off」一遍：__AXII_HYDRATE_DIAGNOSTICS__ = false，激活期间诊断关闭（描述是裸对象，与生产相同）。
 * 诊断开关只覆盖激活这一次调用（§3.4「两遍验收」）：描述的种类在激活开始时定，文件里不经过激活的诊断断言不受影响。
 * configureDiagnostics 只能整体替换配置、没有读取接口，所以这些文件的 configureDiagnostics 从这里导入：这里记下最近一次配置，
 * 激活时只改 enabled，onError 等照旧，返回后恢复。
 * #55 S 之前还有一遍走旧模型的公开入口、两遍走内部入口；S 把 hydrateRoot 切到自顶向下认领，删掉了入口切换，诊断开关两遍保留。
 */
import {configureDiagnostics as configureFrameworkDiagnostics, hydrateRoot} from '@framework'

declare const __AXII_HYDRATE_DIAGNOSTICS__: boolean | undefined

/** 这一遍激活期间诊断开没开（§3.4 两遍验收）。不在这两个项目里（单独跑某个文件、没有 define）时为 undefined：不覆盖，按文件自己的配置。 */
export const HYDRATE_DIAGNOSTICS: boolean | undefined = typeof __AXII_HYDRATE_DIAGNOSTICS__ !== 'undefined' ? __AXII_HYDRATE_DIAGNOSTICS__ : undefined

type DiagnosticsConfig = Parameters<typeof configureFrameworkDiagnostics>[0]
let currentDiagnostics: DiagnosticsConfig = {}

/** 同 @framework 的 configureDiagnostics，另外记下这次配置，激活时只覆盖 enabled。 */
export function configureDiagnostics(config: DiagnosticsConfig): void {
    currentDiagnostics = config
    configureFrameworkDiagnostics(config)
}

type HydrateOptions = { portals?: Record<string, HTMLElement> }

/** 调用 hydrateRoot，激活期间按这一遍设置诊断开关。参数与返回值同 hydrateRoot。 */
export function hydrate(container: HTMLElement, source: any, options?: HydrateOptions): ReturnType<typeof hydrateRoot> {
    if (HYDRATE_DIAGNOSTICS === undefined) return hydrateRoot(container, source, options)
    const saved = currentDiagnostics
    configureFrameworkDiagnostics({...saved, enabled: HYDRATE_DIAGNOSTICS})
    try {
        return hydrateRoot(container, source, options)
    } finally {
        configureFrameworkDiagnostics(saved)
    }
}
