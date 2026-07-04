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
let seenObjects = new WeakMap<object, string>()
let destroyedObjects = new WeakSet<object>()

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
    seenObjects = new WeakMap()
    destroyedObjects = new WeakSet()
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
    if (!enabled || seenObjects.has(host)) return
    seenObjects.set(host, type)
    increase(hostCounts.createdByType, type)
    increase(hostCounts.activeByType, type)
}

/**
 * @internal
 */
export function trackHostDestroyed(host: object) {
    if (!enabled || destroyedObjects.has(host)) return
    const type = seenObjects.get(host)
    if (type === undefined) return
    destroyedObjects.add(host)
    increase(hostCounts.destroyedByType, type)
    increase(hostCounts.activeByType, type, -1)
}

/**
 * @internal
 */
export function trackLightBindingCreated(binding: object, type: string) {
    if (!enabled || seenObjects.has(binding)) return
    seenObjects.set(binding, type)
    increase(lightBindingCounts.createdByType, type)
    increase(lightBindingCounts.activeByType, type)
}

/**
 * @internal
 */
export function trackLightBindingDestroyed(binding: object) {
    if (!enabled || destroyedObjects.has(binding)) return
    const type = seenObjects.get(binding)
    if (type === undefined) return
    destroyedObjects.add(binding)
    increase(lightBindingCounts.destroyedByType, type)
    increase(lightBindingCounts.activeByType, type, -1)
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
