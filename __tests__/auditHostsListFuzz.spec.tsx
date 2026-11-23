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

function RowComponent({text}: any, {createElement}: RenderContext) {
    return <b>{text}</b>
}
function NullComponent() { return null }
function FnComponent({fn}: any) { return fn }
function shapeText(t: string, s: number) { return s === 2 ? `${t}.` : s === 4 ? '' : s === 6 ? `${t};` : t }
function FragComponent({text}: any, {createElement, Fragment}: RenderContext) {
    return <Fragment>{() => text}<i>!</i></Fragment>
}
function ListComponent({text}: any) {
    return new RxList<any>([<u>{text}</u>, () => '~'])
}

let toggles = 0
const KINDS = 17
const dynamicRows = new Map<number, {shape: any, t: string, kind: number}>()
type Row = {value: any, text: string, id: number, kind?: number, dyn?: boolean}
let nextId = 1
function makeRow(rng: () => number): Row {
    const id = nextId++
    const kind = Math.floor(rng() * KINDS)
    const t = `${id};`
    const row = makeRowOfKind(kind, id, t, rng)
    row.kind = kind
    return row
}
function makeRowOfKind(kind: number, id: number, t: string, rng: () => number): Row {
    switch (kind) {
        case 0: return {id, value: <span>{t}</span>, text: t}
        case 1: return {id, value: () => t, text: t}
        case 2: return {id, value: <RowComponent text={t}/>, text: t}
        case 3: return {id, value: <Fragment><i>{t}</i></Fragment>, text: t}
        case 4: return {id, value: atom(t), text: t}
        case 5: return {id, value: t, text: t}
        case 6: return {id, value: [t, <i>+</i>, () => '-'], text: `${t}+-`}
        case 7: return {id, value: new RxList<any>([<span>{t}</span>, <span>n</span>]), text: `${t}n`}
        case 8: return {id, value: () => <em>{t}</em>, text: t}
        case 9: return {id, value: rng() < 0.5 ? null : <NullComponent/>, text: ''}
        case 10: return {id, value: <FragComponent text={t}/>, text: `${t}!`}
        case 11: return {id, value: <ListComponent text={t}/>, text: `${t}~`}
        case 15: return {id, value: document.createTextNode(t), text: t}
        case 16: return {id, value: document.createComment(t), text: ''}
        default: {
            // dynamic shape rows: 12 = function row, 13 = element with function child, 14 = component with function root
            const shape = atom(0)
            dynamicRows.set(id, {shape, t, kind})
            const fn = () => {
                const s = shape()
                if (s === 0) return t
                if (s === 1) return <em>{t}</em>
                if (s === 2) return [t, <i>.</i>]
                if (s === 3) return <RowComponent text={t}/>
                if (s === 4) return null
                if (s === 5) return new RxList<any>([<span>{t}</span>])
                return <Fragment>{t}<i>;</i></Fragment>
            }
            const value = kind === 12 ? fn : kind === 13 ? <p>{fn}</p> : <FnComponent fn={fn}/>
            return {id, value, text: t, dyn: true}
        }
    }
}

function randomOp(rng: () => number, list: RxList<any>, mirror: Row[]): string {
    const length = mirror.length
    const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
    const rows = (n: number) => Array.from({length: n}, () => makeRow(rng))
    if (length && rng() < 0.25) {
        const candidates = mirror.filter(r => r.dyn)
        if (candidates.length) {
            const r = candidates[int(0, candidates.length - 1)]
            const d = dynamicRows.get(r.id)!
            const next = int(0, 6)
            d.shape(next)
            toggles++
            r.text = shapeText(d.t, next)
            // fall through to also run a list op in the same tick
        }
    }
    const op = length > 30 ? 0 : int(0, 10)
    switch (op) {
        case 0: {
            const start = int(-length - 2, length + 2)
            const del = int(0, 4)
            const add = length > 30 ? [] : rows(int(0, 3))
            list.splice(start, del, ...add.map(r => r.value))
            mirror.splice(start, del, ...add)
            return `splice(${start},${del},+${add.length})`
        }
        case 1: { const add = rows(int(1, 3)); list.push(...add.map(r => r.value)); mirror.push(...add); return 'push' }
        case 2: { if (length) { list.pop(); mirror.pop() } return 'pop' }
        case 3: { if (length) { list.shift(); mirror.shift() } return 'shift' }
        case 4: { const add = rows(int(1, 2)); list.unshift(...add.map(r => r.value)); mirror.unshift(...add); return 'unshift' }
        case 5: {
            if (!length) return 'noop'
            const i = int(0, length - 1); const [r] = rows(1)
            list.set(i, r.value); mirror[i] = r
            return `set(${i})`
        }
        case 6: {
            if (length < 2) return 'noop'
            const a = int(0, length - 1); const b = int(0, length - 1)
            if (a === b) return 'noop'
            list.swap(a, b)
            const tmp = mirror[a]; mirror[a] = mirror[b]; mirror[b] = tmp
            return `swap(${a},${b})`
        }
        case 7: {
            if (length < 2) return 'noop'
            const limit = int(1, Math.min(3, length))
            const start = int(0, length - limit)
            const newStart = int(0, length - limit)
            if (start === newStart) return 'noop'
            list.reposition(start, newStart, limit)
            const moved = mirror.splice(start, limit)
            mirror.splice(newStart, 0, ...moved)
            return `reposition(${start},${newStart},${limit})`
        }
        case 8: {
            // sort by id desc / asc alternately using the mirror as the key source
            const dir = rng() < 0.5 ? 1 : -1
            const idOf = new Map<any, number>()
            mirror.forEach(r => idOf.set(r.value, r.id))
            // values may repeat only for null rows; sort is stable so order of equal keys is kept
            const key = (v: any) => v === null ? 0 : (idOf.get(v) ?? 0)
            const sortedMirror = mirror.slice().sort((x, y) => dir * ((x.value === null ? 0 : x.id) - (y.value === null ? 0 : y.id)))
            list.sortSelf((x: any, y: any) => dir * (key(x) - key(y)))
            mirror.splice(0, mirror.length, ...sortedMirror)
            return `sort(${dir})`
        }
        case 9: {
            if (rng() < 0.3) { list.clear(); mirror.length = 0; return 'clear' }
            return 'noop'
        }
        default: {
            if (!length) return 'noop'
            const count = int(1, Math.min(length, 3))
            const start = int(0, length - count)
            const add = rows(count)
            list.splice(start, count, ...add.map(r => r.value))
            mirror.splice(start, count, ...add)
            return `replace(${start},${count})`
        }
    }
}

describe('audit fuzz: RxListHost with every row kind, single ops and batches', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })
    for (const mode of ['single', 'batch'] as const) {
        test(`${mode}: DOM text equals list data`, async () => {
            for (let seed = 1; seed <= 40; seed++) {
                const rng = mulberry32(seed * 7919)
                const list = new RxList<any>([])
                const mirror: Row[] = []
                const root = createRoot(rootEl)
                root.render(<div><h1>head</h1>{list}<h2>tail</h2></div>)
                const history: string[] = []
                for (let step = 0; step < 60; step++) {
                    if (mode === 'single') {
                        history.push(randomOp(rng, list, mirror))
                    } else {
                        const n = 2 + Math.floor(rng() * 3)
                        const descs: string[] = []
                        batch(() => {
                            for (let i = 0; i < n; i++) descs.push(randomOp(rng, list, mirror))
                        })
                        history.push(`[${descs.join(' ')}]`)
                    }
                    for (let i = 0; i < 20; i++) await Promise.resolve()
                    const expected = 'head' + mirror.map(r => r.text).join('') + 'tail'
                    const dataOk = list.data.length === mirror.length && list.data.every((v: any, i: number) => v === mirror[i].value)
                    if (!dataOk) throw new Error(`oracle bug seed ${seed} step ${step} history: ${history.slice(-3).join(' | ')}`)
                    if (rootEl.textContent !== expected) {
                        throw new Error(`seed ${seed} step ${step}: dataMatchesMirror=${dataOk} expected ${expected} got ${rootEl.textContent}\nrows: ${mirror.map(r => `${r.id}k${r.kind}`).join(',')}\nhtml: ${rootEl.innerHTML}\nhistory: ${history.slice(-6).join(' | ')}`)
                    }
                }
                root.destroy()
                if (rootEl.innerHTML !== '') throw new Error(`seed ${seed}: leftovers after destroy: ${rootEl.innerHTML}`)
            }
            expect(toggles).toBeGreaterThan(200)
        })
    }
})
