import {
    disableData0RetainedObjectDiagnostics,
    enableData0RetainedObjectDiagnostics,
    getData0RetainedObjectDiagnosticsSnapshot,
} from "data0";

/**
 * Opt-in retained object diagnostics for axii.
 *
 * When enabled, host/light-binding creations and destroys are counted so that
 * leak hunting tools (e.g. the axii-benchmark repo) can assert that
 * "afterClear" returns every counter to zero. All tracking calls are behind a
 * single `enabled` flag check so the render hot path pays almost nothing when
 * diagnostics are off (the default).
 */

type CountMap = Record<string, number>

const hostCounts = {
    createdByType: {} as CountMap,
    destroyedByType: {} as CountMap,
    activeByType: {} as CountMap,
}

const lightBindingCounts = {
    createdByType: {} as CountMap,
    destroyedByType: {} as CountMap,
    activeByType: {} as CountMap,
}

let enabled = false
let activeStyleHostStates = 0
let activeCompactHosts = 0

// 已经计数过的对象，防止重复 destroy 导致计数为负。
// value 是创建时登记的类型名，destroy 时直接取用，调用方无需再提供。
// CAUTION host 与 light binding 分开登记：AtomHost/FunctionHost 把 Host 和绑定 effect
//  合并成同一个对象后，同一个对象需要同时计入 hosts 和 lightBindings 两套计数。
let seenHosts = new WeakMap<object, string>()
let destroyedHosts = new WeakSet<object>()
let seenBindings = new WeakMap<object, string>()
let destroyedBindings = new WeakSet<object>()

function increase(map: CountMap, key: string, delta = 1) {
    const next = (map[key] ?? 0) + delta
    if (next === 0) {
        delete map[key]
    } else {
        map[key] = next
    }
}

function resetCounts() {
    for (const group of [hostCounts, lightBindingCounts]) {
        group.createdByType = {}
        group.destroyedByType = {}
        group.activeByType = {}
    }
    activeStyleHostStates = 0
    activeCompactHosts = 0
    seenHosts = new WeakMap()
    destroyedHosts = new WeakSet()
    seenBindings = new WeakMap()
    destroyedBindings = new WeakSet()
}

export function isAxiiRetainedObjectDiagnosticsEnabled() {
    return enabled
}

export function enableAxiiRetainedObjectDiagnostics({reset = true}: { reset?: boolean } = {}) {
    if (reset) resetCounts()
    enabled = true
    enableData0RetainedObjectDiagnostics({reset})
}

export function disableAxiiRetainedObjectDiagnostics() {
    enabled = false
    disableData0RetainedObjectDiagnostics()
}

export function resetAxiiRetainedObjectDiagnostics() {
    resetCounts()
}

/**
 * @internal
 */
export function trackHostCreated(host: object, type: string) {
    if (!enabled || seenHosts.has(host)) return
    seenHosts.set(host, type)
    increase(hostCounts.createdByType, type)
    increase(hostCounts.activeByType, type)
}

/**
 * @internal
 */
export function trackHostDestroyed(host: object) {
    if (!enabled || destroyedHosts.has(host)) return
    const type = seenHosts.get(host)
    if (type === undefined) return
    destroyedHosts.add(host)
    increase(hostCounts.destroyedByType, type)
    increase(hostCounts.activeByType, type, -1)
}

/**
 * @internal
 */
export function trackLightBindingCreated(binding: object, type: string) {
    if (!enabled || seenBindings.has(binding)) return
    seenBindings.set(binding, type)
    increase(lightBindingCounts.createdByType, type)
    increase(lightBindingCounts.activeByType, type)
}

/**
 * @internal
 */
export function trackLightBindingDestroyed(binding: object) {
    if (!enabled || destroyedBindings.has(binding)) return
    const type = seenBindings.get(binding)
    if (type === undefined) return
    destroyedBindings.add(binding)
    increase(lightBindingCounts.destroyedByType, type)
    increase(lightBindingCounts.activeByType, type, -1)
}

/**
 * @internal
 */
export function trackCompactHostCreated(host: object) {
    if (!enabled) return
    activeCompactHosts++
}

/**
 * @internal
 */
export function trackCompactHostDestroyed(host: object) {
    if (!enabled) return
    // 只有 create 阶段被登记过的对象才计数，避免 enable 之前创建的 host 把计数减成负数
    if (!seenHosts.has(host) || destroyedHosts.has(host)) return
    activeCompactHosts--
}

/**
 * @internal
 */
export function trackStyleHostStateCreated() {
    if (!enabled) return
    activeStyleHostStates++
}

/**
 * @internal
 */
export function trackStyleHostStateDestroyed() {
    if (!enabled) return
    activeStyleHostStates--
}

function total(map: CountMap) {
    let sum = 0
    for (const key in map) sum += map[key]
    return sum
}

export type AxiiRetainedObjectDiagnosticsSnapshot = {
    enabled: boolean,
    hosts: {
        totalActive: number,
        activeByType: CountMap,
        createdByType: CountMap,
        destroyedByType: CountMap,
    },
    lightBindings: {
        totalActive: number,
        activeByType: CountMap,
        createdByType: CountMap,
        destroyedByType: CountMap,
    },
    data0: ReturnType<typeof getData0RetainedObjectDiagnosticsSnapshot>,
    compactListHosts: { active: number },
    styles: { activeHostStyleStates: number },
}

export function getAxiiRetainedObjectDiagnosticsSnapshot(): AxiiRetainedObjectDiagnosticsSnapshot {
    return {
        enabled,
        hosts: {
            totalActive: total(hostCounts.activeByType),
            activeByType: {...hostCounts.activeByType},
            createdByType: {...hostCounts.createdByType},
            destroyedByType: {...hostCounts.destroyedByType},
        },
        lightBindings: {
            totalActive: total(lightBindingCounts.activeByType),
            activeByType: {...lightBindingCounts.activeByType},
            createdByType: {...lightBindingCounts.createdByType},
            destroyedByType: {...lightBindingCounts.destroyedByType},
        },
        data0: getData0RetainedObjectDiagnosticsSnapshot(),
        compactListHosts: {active: activeCompactHosts},
        styles: {activeHostStyleStates: activeStyleHostStates},
    }
}
