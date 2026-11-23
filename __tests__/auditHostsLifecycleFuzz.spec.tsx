/* @jsx createElement */
/* @jsxFrag Fragment */
import {beforeEach, describe, expect, test} from "vitest";
import {atom, batch, createElement, createRoot, Fragment, RenderContext, RxList} from "@framework";

function mulberry32(seed: number) {
    let a = seed >>> 0
    return function () {
        a |= 0
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

type Ledger = {effect: number, layout: number, layoutConnected: boolean[], refAttach: number, refDetach: number, cleanup: number, cleanupConnected: boolean[], effectCleanup: number, layoutCleanup: number}
const ledgers = new Map<string, Ledger>()
function ledger(key: string) {
    let l = ledgers.get(key)
    if (!l) ledgers.set(key, l = {effect: 0, layout: 0, layoutConnected: [], refAttach: 0, refDetach: 0, cleanup: 0, cleanupConnected: [], effectCleanup: 0, layoutCleanup: 0})
    return l
}
let instance = 0
function Probe({name}: {name: string}, {useEffect, useLayoutEffect, onCleanup, createElement}: RenderContext) {
    const key = `${name}#${instance++}`
    const l = ledger(key)
    live.add(key)
    let el: HTMLElement | null = null
    useEffect(() => { l.effect++; return () => { l.effectCleanup++ } })
    useLayoutEffect(() => { l.layout++; l.layoutConnected.push(!!el?.isConnected); return () => { l.layoutCleanup++ } })
    onCleanup(() => { l.cleanup++; l.cleanupConnected.push(!!el?.isConnected); live.delete(key) })
    return <b ref={(e: HTMLElement | null) => { if (e) { el = e; l.refAttach++ } else l.refDetach++ }}>{name}</b>
}
const live = new Set<string>()

const KINDS = 8
type Row = {value: any, id: number, shape?: any}
let nextId = 1
function makeRow(rng: () => number): Row {
    const id = nextId++
    const kind = Math.floor(rng() * KINDS)
    const name = `r${id}k${kind}`
    switch (kind) {
        case 0: return {id, value: <Probe name={name}/>}
        case 1: return {id, value: () => <Probe name={name}/>}
        case 2: return {id, value: <li><Probe name={name}/></li>}
        case 3: return {id, value: [<Probe name={name}/>, 'x']}
        case 4: return {id, value: new RxList<any>([<Probe name={name}/>])}
        case 5: return {id, value: <Fragment><Probe name={name}/></Fragment>}
        case 6: return {id, value: <li>{() => <Probe name={name}/>}</li>}
        default: {
            const shape = atom(0)
            return {id, shape, value: () => {
                const s = shape()
                if (s === 0) return <Probe name={name}/>
                if (s === 1) return [<Probe name={name}/>]
                if (s === 2) return null
                if (s === 3) return <i><Probe name={name}/></i>
                return new RxList<any>([<Probe name={name}/>])
            }}
        }
    }
}

function randomOp(rng: () => number, list: RxList<any>, mirror: Row[]) {
    const length = mirror.length
    const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
    const rows = (n: number) => Array.from({length: n}, () => makeRow(rng))
    if (length && rng() < 0.3) {
        const candidates = mirror.filter(r => r.shape)
        if (candidates.length) candidates[int(0, candidates.length - 1)].shape(int(0, 4))
    }
    const op = length > 20 ? 0 : int(0, 8)
    switch (op) {
        case 0: {
            const start = int(-length - 1, length + 1)
            const del = int(0, 4)
            const add = length > 20 ? [] : rows(int(0, 3))
            list.splice(start, del, ...add.map(r => r.value))
            mirror.splice(start, del, ...add)
            return
        }
        case 1: { const add = rows(int(1, 3)); list.push(...add.map(r => r.value)); mirror.push(...add); return }
        case 2: { if (length) { list.pop(); mirror.pop() } return }
        case 3: { const add = rows(int(1, 2)); list.unshift(...add.map(r => r.value)); mirror.unshift(...add); return }
        case 4: {
            if (!length) return
            const i = int(0, length - 1); const [r] = rows(1)
            list.set(i, r.value); mirror[i] = r
            return
        }
        case 5: {
            if (length < 2) return
            const a = int(0, length - 1); const b = int(0, length - 1)
            if (a === b) return
            list.swap(a, b)
            const tmp = mirror[a]; mirror[a] = mirror[b]; mirror[b] = tmp
            return
        }
        case 6: {
            if (length < 2) return
            const limit = int(1, Math.min(3, length))
            const start = int(0, length - limit)
            const newStart = int(0, length - limit)
            if (start === newStart) return
            list.reposition(start, newStart, limit)
            const moved = mirror.splice(start, limit)
            mirror.splice(newStart, 0, ...moved)
            return
        }
        case 7: { if (rng() < 0.3) { list.clear(); mirror.length = 0 } return }
        default: {
            if (!length) return
            const count = int(1, Math.min(length, 3))
            const start = int(0, length - count)
            const add = rows(count)
            list.splice(start, count, ...add.map(r => r.value))
            mirror.splice(start, count, ...add)
            return
        }
    }
}

function check(where: string, attached: boolean) {
    for (const [key, l] of ledgers) {
        const alive = live.has(key)
        const problems: string[] = []
        if (l.effect !== 1) problems.push(`effect ran ${l.effect}x`)
        if (attached && l.layout !== 1) problems.push(`layout ran ${l.layout}x`)
        if (l.layoutConnected.some(c => !c)) problems.push('layout ran while disconnected')
        if (attached && l.refAttach !== 1) problems.push(`ref attached ${l.refAttach}x`)
        if (alive) {
            if (l.cleanup || l.effectCleanup || l.layoutCleanup || l.refDetach) problems.push('cleaned while alive')
        } else {
            if (l.cleanup !== 1) problems.push(`onCleanup ran ${l.cleanup}x`)
            if (l.effectCleanup !== 1) problems.push(`effect cleanup ran ${l.effectCleanup}x`)
            if (l.layoutCleanup !== l.layout) problems.push(`layout cleanup ran ${l.layoutCleanup}x for ${l.layout} layout`)
            if (l.refDetach !== 1) problems.push(`ref detached ${l.refDetach}x`)
            // I39: whichever way the row went away, its cleanup saw the DOM still connected
            if (attached && l.cleanupConnected.some(c => !c)) problems.push('cleanup ran after the DOM was removed')
        }
        if (problems.length) throw new Error(`${where}: ${key}: ${problems.join(', ')} ${JSON.stringify(l)}`)
    }
}

describe('audit fuzz: lifecycle exactly once', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })
    for (const mode of ['single', 'batch'] as const) {
        test(`${mode}: effect / layout effect / ref / cleanup run exactly once per row instance`, async () => {
            for (let seed = 1; seed <= 30; seed++) {
                ledgers.clear(); live.clear()
                const rng = mulberry32(seed * 104729)
                const list = new RxList<any>([])
                const mirror: Row[] = []
                const root = createRoot(rootEl)
                root.render(<div><h1>head</h1>{list}<h2>tail</h2></div>)
                for (let step = 0; step < 50; step++) {
                    if (mode === 'single') randomOp(rng, list, mirror)
                    else batch(() => { for (let i = 0; i < 3; i++) randomOp(rng, list, mirror) })
                    for (let i = 0; i < 20; i++) await Promise.resolve()
                    check(`seed ${seed} step ${step}`, true)
                }
                root.destroy()
                if (live.size) throw new Error(`seed ${seed}: ${live.size} rows not cleaned after root.destroy()`)
                check(`seed ${seed} after destroy`, true)
            }
            expect(true).toBe(true)
        })
    }

    test('detached container: layout effects wait for attach, run once, connected', async () => {
        for (let seed = 1; seed <= 20; seed++) {
            ledgers.clear(); live.clear()
            const rng = mulberry32(seed * 31337)
            const list = new RxList<any>([])
            const mirror: Row[] = []
            const container = document.createElement('div')
            const root = createRoot(container)
            root.render(<div><h1>head</h1>{list}<h2>tail</h2></div>)
            for (let step = 0; step < 25; step++) {
                randomOp(rng, list, mirror)
                for (let i = 0; i < 20; i++) await Promise.resolve()
                for (const [key, l] of ledgers) {
                    if (l.layout || l.refAttach) throw new Error(`seed ${seed} step ${step}: ${key} layout/ref ran before attach`)
                }
            }
            document.body.appendChild(container)
            root.dispatch('attach')
            for (const [key, l] of ledgers) {
                const alive = live.has(key)
                if (alive && (l.layout !== 1 || l.refAttach !== 1 || l.layoutConnected.some(c => !c))) throw new Error(`seed ${seed}: ${key} after attach ${JSON.stringify(l)}`)
                if (!alive && (l.layout !== 0 || l.refAttach !== 0)) throw new Error(`seed ${seed}: destroyed ${key} got layout/ref at attach ${JSON.stringify(l)}`)
            }
            for (let step = 0; step < 25; step++) {
                randomOp(rng, list, mirror)
                for (let i = 0; i < 20; i++) await Promise.resolve()
            }
            for (const [key, l] of ledgers) {
                if (l.layout > 1 || l.refAttach > 1 || l.layoutConnected.some(c => !c)) throw new Error(`seed ${seed}: ${key} ${JSON.stringify(l)}`)
                if (live.has(key) && l.layout !== 1) throw new Error(`seed ${seed}: alive ${key} has no layout ${JSON.stringify(l)}`)
            }
            root.destroy()
            if (live.size) throw new Error(`seed ${seed}: not cleaned`)
            container.remove()
        }
    })
})
