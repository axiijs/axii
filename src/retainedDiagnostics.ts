import * as data0RetainedDiagnostics from "data0";
import type {Host} from "./Host";

type Data0RetainedObjectDiagnosticsSnapshot = {
    enabled: boolean
    reactiveEffects: {
        activeByType: Record<string, number>
        createdByType: Record<string, number>
        destroyedByType: Record<string, number>
        activeBySource: Record<string, number>
        createdBySource: Record<string, number>
        destroyedBySource: Record<string, number>
        totalActive: number
    }
    primitiveAtomDeps: {
        activeDeps: number
        createdDeps: number
        activeEffects: number
    }
}

type OptionalData0RetainedDiagnostics = {
    enableData0RetainedObjectDiagnostics?: (options?: { reset?: boolean }) => void
    disableData0RetainedObjectDiagnostics?: () => void
    resetData0RetainedObjectDiagnostics?: () => void
    getData0RetainedObjectDiagnosticsSnapshot?: () => Data0RetainedObjectDiagnosticsSnapshot
}

const data0Diagnostics = data0RetainedDiagnostics as OptionalData0RetainedDiagnostics

export type AxiiRetainedObjectDiagnosticsSnapshot = {
    enabled: boolean
    hosts: {
        activeByType: Record<string, number>
        createdByType: Record<string, number>
        destroyedByType: Record<string, number>
        totalActive: number
    }
    lightBindings: {
        activeByType: Record<string, number>
        createdByType: Record<string, number>
        destroyedByType: Record<string, number>
        totalActive: number
    }
    styles: {
        activeStyleIds: number
        createdStyleIds: number
        activeHostStyleStates: number
        createdHostStyleStates: number
        activeAdoptedSheets: number
    }
    compactListHosts: {
        active: number
        created: number
        destroyed: number
    }
    data0: Data0RetainedObjectDiagnosticsSnapshot
}

type CountersByType = Record<string, number>

const hostTypes = new WeakMap<Host, { type: string, generation: number }>()
const lightBindingTypes = new WeakMap<object, { type: string, generation: number }>()
let enabled = false
let generation = 0

const hostCounters = createTypedCounterGroup()
const lightBindingCounters = createTypedCounterGroup()
const styleCounters = {
    activeStyleIds: 0,
    createdStyleIds: 0,
    activeHostStyleStates: 0,
    createdHostStyleStates: 0,
}
const compactListHostCounters = {
    active: 0,
    created: 0,
    destroyed: 0,
}

function createTypedCounterGroup() {
    return {
        activeByType: {} as CountersByType,
        createdByType: {} as CountersByType,
        destroyedByType: {} as CountersByType,
    }
}

function increment(counters: CountersByType, key: string, delta = 1) {
    counters[key] = (counters[key] ?? 0) + delta
    if (counters[key] === 0) delete counters[key]
}

function cloneCounters(counters: CountersByType) {
    return {...counters}
}

function totalCounters(counters: CountersByType) {
    return Object.values(counters).reduce((total, value) => total + value, 0)
}

function resetTypedCounterGroup(group: ReturnType<typeof createTypedCounterGroup>) {
    Object.keys(group.activeByType).forEach(key => delete group.activeByType[key])
    Object.keys(group.createdByType).forEach(key => delete group.createdByType[key])
    Object.keys(group.destroyedByType).forEach(key => delete group.destroyedByType[key])
}

export function enableAxiiRetainedObjectDiagnostics(options: { reset?: boolean } = {}) {
    if (options.reset ?? true) resetAxiiRetainedObjectDiagnostics()
    enabled = true
    data0Diagnostics.enableData0RetainedObjectDiagnostics?.({reset: options.reset ?? true})
}

export function disableAxiiRetainedObjectDiagnostics() {
    enabled = false
    data0Diagnostics.disableData0RetainedObjectDiagnostics?.()
}

export function resetAxiiRetainedObjectDiagnostics() {
    generation++
    resetTypedCounterGroup(hostCounters)
    resetTypedCounterGroup(lightBindingCounters)
    styleCounters.activeStyleIds = 0
    styleCounters.createdStyleIds = 0
    styleCounters.activeHostStyleStates = 0
    styleCounters.createdHostStyleStates = 0
    compactListHostCounters.active = 0
    compactListHostCounters.created = 0
    compactListHostCounters.destroyed = 0
    data0Diagnostics.resetData0RetainedObjectDiagnostics?.()
}

export function isAxiiRetainedObjectDiagnosticsEnabled() {
    return enabled
}

export function trackRetainedHostCreated(host: Host, type = host.constructor.name) {
    if (!enabled) return
    hostTypes.set(host, {type, generation})
    increment(hostCounters.activeByType, type)
    increment(hostCounters.createdByType, type)
}

export function trackRetainedHostDestroyed(host: Host) {
    if (!enabled) return
    const record = hostTypes.get(host)
    if (!record || record.generation !== generation) return
    increment(hostCounters.activeByType, record.type, -1)
    increment(hostCounters.destroyedByType, record.type)
    hostTypes.delete(host)
}

export function trackRetainedLightBindingStarted(binding: object, type = binding.constructor.name) {
    if (!enabled) return
    const record = lightBindingTypes.get(binding)
    if (record?.generation === generation) return
    lightBindingTypes.set(binding, {type, generation})
    increment(lightBindingCounters.activeByType, type)
    increment(lightBindingCounters.createdByType, type)
}

export function trackRetainedLightBindingStopped(binding: object) {
    if (!enabled) return
    const record = lightBindingTypes.get(binding)
    if (!record || record.generation !== generation) return
    increment(lightBindingCounters.activeByType, record.type, -1)
    increment(lightBindingCounters.destroyedByType, record.type)
    lightBindingTypes.delete(binding)
}

export function trackRetainedStyleIdCreated() {
    if (!enabled) return
    styleCounters.activeStyleIds++
    styleCounters.createdStyleIds++
}

export function trackRetainedStyleIdDestroyed() {
    if (!enabled) return
    styleCounters.activeStyleIds--
}

export function trackRetainedHostStyleStateCreated() {
    if (!enabled) return
    styleCounters.activeHostStyleStates++
    styleCounters.createdHostStyleStates++
}

export function trackRetainedHostStyleStateDestroyed() {
    if (!enabled) return
    styleCounters.activeHostStyleStates--
}

export function trackRetainedCompactListHostCreated() {
    if (!enabled) return
    compactListHostCounters.active++
    compactListHostCounters.created++
}

export function trackRetainedCompactListHostDestroyed() {
    if (!enabled) return
    compactListHostCounters.active--
    compactListHostCounters.destroyed++
}

export function getAxiiRetainedObjectDiagnosticsSnapshot(): AxiiRetainedObjectDiagnosticsSnapshot {
    const hostActiveByType = cloneCounters(hostCounters.activeByType)
    const lightBindingActiveByType = cloneCounters(lightBindingCounters.activeByType)
    return {
        enabled,
        hosts: {
            activeByType: hostActiveByType,
            createdByType: cloneCounters(hostCounters.createdByType),
            destroyedByType: cloneCounters(hostCounters.destroyedByType),
            totalActive: totalCounters(hostActiveByType),
        },
        lightBindings: {
            activeByType: lightBindingActiveByType,
            createdByType: cloneCounters(lightBindingCounters.createdByType),
            destroyedByType: cloneCounters(lightBindingCounters.destroyedByType),
            totalActive: totalCounters(lightBindingActiveByType),
        },
        styles: {
            ...styleCounters,
            activeAdoptedSheets: styleCounters.activeStyleIds,
        },
        compactListHosts: {...compactListHostCounters},
        data0: data0Diagnostics.getData0RetainedObjectDiagnosticsSnapshot?.() ?? createEmptyData0Snapshot(),
    }
}

function createEmptyData0Snapshot(): Data0RetainedObjectDiagnosticsSnapshot {
    return {
        enabled: false,
        reactiveEffects: {
            activeByType: {},
            createdByType: {},
            destroyedByType: {},
            activeBySource: {},
            createdBySource: {},
            destroyedBySource: {},
            totalActive: 0,
        },
        primitiveAtomDeps: {
            activeDeps: 0,
            createdDeps: 0,
            activeEffects: 0,
        },
    }
}
