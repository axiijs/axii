/** @jsx createElement */
/**
 * RxList 渲染的性质测试（fuzz）。
 *
 * 背景（见 prompt/output/11-contracts-and-invariants.md）：六轮 review 证明手写用例
 * 追不上「输入形态 × 操作序列」的组合空间——F22（负数 splice 索引）这类 bug 用随机
 * 操作序列是分钟级发现。这里用确定性 PRNG（seed 固化，失败信息带 seed/step/op，
 * 可精确复现）对 RxList 的全部列表操作做随机序列，以普通数组为镜像 oracle，
 * 每步之后断言「DOM 文本序列 === 镜像」。
 *
 * 覆盖面：
 * - 操作：splice（含负数/越界 start）、push/pop/shift/unshift、set、swap/reposition/sortSelf；
 * - 行 host 类型：CompactElementHost（单元素行）、FunctionHost（函数文本行）、
 *   ComponentHost（组件行）、StaticHost（fragment 行），由 item id 决定、随移动保持稳定；
 * - 诊断默认开启（__DEV__），RxListHost 的列表不变量校验在每个 patch 批次后同步执行，
 *   fuzz 同时也是不变量校验自身的「无误报」验证。
 */
import {beforeEach, describe, expect, test} from "vitest";
import {createElement, createRoot, Fragment, RenderContext, RxList} from "@framework";

// mulberry32：确定性 PRNG，同 seed 严格同序列
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

// item 形如 `${id};`，行类型由 id 决定：item 移动时行类型稳定不变
function rowKind(item: string) {
    return parseInt(item, 10) % 4
}

function renderRow(item: string) {
    const kind = rowKind(item)
    if (kind === 0) return <span>{item}</span>              // CompactElementHost
    if (kind === 1) return () => item                        // FunctionHost（函数文本行）
    if (kind === 2) return <RowComponent text={item}/>      // ComponentHost
    return <Fragment><i>{item}</i></Fragment>                // StaticHost（fragment 行）
}

const MAX_LENGTH = 40

type Step = {desc: string}

function randomStep(rng: () => number, list: RxList<string>, mirror: string[], nextId: () => string): Step {
    const length = mirror.length
    const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
    const newItems = (count: number) => Array.from({length: count}, () => `${nextId()};`)

    // 超过上限强制收缩，保证运行时间有界
    const opIndex = length >= MAX_LENGTH ? 0 : int(0, 9)

    switch (opIndex) {
        case 0: { // splice：start 故意允许负数与越界（Array#splice 的合法输入域）
            const start = int(-(length + 2), length + 2)
            const deleteCount = int(0, 3)
            const items = newItems(int(0, length >= MAX_LENGTH ? 0 : 2))
            list.splice(start, deleteCount, ...items)
            mirror.splice(start, deleteCount, ...items)
            return {desc: `splice(${start}, ${deleteCount}, ${items.join(',')})`}
        }
        case 1: {
            const items = newItems(1)
            list.push(items[0])
            mirror.push(items[0])
            return {desc: `push(${items[0]})`}
        }
        case 2: {
            list.pop()
            mirror.pop()
            return {desc: 'pop()'}
        }
        case 3: {
            const items = newItems(1)
            list.unshift(items[0])
            mirror.unshift(items[0])
            return {desc: `unshift(${items[0]})`}
        }
        case 4: {
            list.shift()
            mirror.shift()
            return {desc: 'shift()'}
        }
        case 5: { // set：契约要求 index 在界内
            if (!length) return {desc: 'set skipped (empty)'}
            const index = int(0, length - 1)
            const item = `${nextId()};`
            list.set(index, item)
            mirror[index] = item
            return {desc: `set(${index}, ${item})`}
        }
        case 6: { // swap
            if (length < 2) return {desc: 'swap skipped'}
            const i = int(0, length - 2)
            const j = int(i + 1, length - 1)
            list.swap(i, j)
            const tmp = mirror[i]; mirror[i] = mirror[j]; mirror[j] = tmp
            return {desc: `swap(${i}, ${j})`}
        }
        case 7: { // reposition：镜像语义 = 先移除再在 newStart 插入
            if (length < 2) return {desc: 'reposition skipped'}
            const from = int(0, length - 1)
            let to = int(0, length - 1)
            if (to === from) to = (to + 1) % length
            list.reposition(from, to)
            const [moved] = mirror.splice(from, 1)
            mirror.splice(to, 0, moved)
            return {desc: `reposition(${from}, ${to})`}
        }
        case 8: { // sortSelf：两侧同为稳定排序，等价
            const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0
            list.sortSelf(compare)
            mirror.sort(compare)
            return {desc: 'sortSelf(asc)'}
        }
        default: { // 批量 splice：一次删 + 多插
            const start = int(0, length)
            const deleteCount = int(0, Math.min(3, length - Math.max(start, 0)))
            const items = newItems(int(1, 3))
            list.splice(start, deleteCount, ...items)
            mirror.splice(start, deleteCount, ...items)
            return {desc: `splice(${start}, ${deleteCount}, ${items.join(',')})`}
        }
    }
}

function runFuzz(seed: number, steps: number, rowRenderer: (item: string) => any, rootEl: HTMLElement) {
    const rng = mulberry32(seed)
    let counter = 0
    const nextId = () => `${counter++}`
    const initial = Array.from({length: 5}, () => `${nextId()};`)
    const list = new RxList(initial)
    const mirror = initial.slice()

    const root = createRoot(rootEl)
    function App({}: any, {createElement}: RenderContext) {
        return <div id={`fuzz-${seed}`}>{list.map(rowRenderer)}</div>
    }
    root.render(<App/>)
    const container = document.getElementById(`fuzz-${seed}`)!
    expect(container.textContent).toBe(mirror.join(''))

    for (let step = 0; step < steps; step++) {
        const {desc} = randomStep(rng, list, mirror, nextId)
        expect(
            container.textContent,
            `seed=${seed} step=${step} op=${desc} data=[${list.data.join(' ')}]`
        ).toBe(mirror.join(''))
        expect(list.data, `seed=${seed} step=${step} op=${desc} (mirror out of sync)`).toEqual(mirror)
    }

    root.destroy()
    expect(rootEl.childNodes.length, `seed=${seed} leftover nodes after destroy`).toBe(0)
}

describe('RxList rendering fuzz (mirror-array oracle)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    test('compact rows: random op sequences keep DOM identical to list.data', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            runFuzz(seed, 80, item => <span>{item}</span>, rootEl)
        }
    })

    test('mixed row host types: random op sequences keep DOM identical to list.data', () => {
        for (const seed of [11, 12, 13, 14, 15]) {
            runFuzz(seed, 80, renderRow, rootEl)
        }
    })
})
