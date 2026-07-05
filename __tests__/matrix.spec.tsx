/** @jsx createElement */
/** @jsxFrag Fragment */
/**
 * 矩阵式组合测试：行类型 × 列表操作 / FunctionHost 返回值类型迁移 / 随机操作序列一致性。
 *
 * 设计目标（补齐"示例式"测试没有覆盖的组合空间）：
 * 1. RxList 行内容可能是 元素/Fragment/组件/函数/字符串/atom/数组/嵌套 RxList，
 *    每种都要在 插入/删除/替换/交换/排序/区间搬移 等 patch 下保持 DOM 与数据一致。
 * 2. FunctionHost 的返回值可能在 文本/元素/Fragment/数组/null/atom/组件/嵌套函数 之间任意切换。
 * 3. 用带种子的随机操作序列对照普通数组参照模型做一致性校验（fuzz），
 *    并用 retained-object 诊断断言销毁后无泄漏。
 */
import {
    createElement,
    createRoot,
    Fragment,
    disableAxiiRetainedObjectDiagnostics,
    enableAxiiRetainedObjectDiagnostics,
    getAxiiRetainedObjectDiagnosticsSnapshot,
} from "@framework";
import {atom, batch, RxList} from "data0";
import {afterEach, beforeEach, describe, expect, test} from "vitest";

function nextMicrotask() {
    return Promise.resolve()
}

// 带种子的确定性 PRNG，保证 fuzz 失败可复现
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

function RowComponent({v}: { v: number }) {
    return <span>{String(v)}</span>
}

// 行类型：make 生成行内容（作为 list.map 的返回值），text 是该行对 textContent 的贡献
const ROW_TYPES: { [k: string]: { make: (v: number) => any, text: (v: number) => string } } = {
    element: {
        make: (v) => <span>{String(v)}</span>,
        text: (v) => `${v}`,
    },
    fragment: {
        make: (v) => <><span>{String(v)}</span><span>#</span></>,
        text: (v) => `${v}#`,
    },
    component: {
        make: (v) => <RowComponent v={v}/>,
        text: (v) => `${v}`,
    },
    functionText: {
        make: (v) => () => String(v),
        text: (v) => `${v}`,
    },
    functionElement: {
        make: (v) => () => <span>{String(v)}</span>,
        text: (v) => `${v}`,
    },
    string: {
        make: (v) => String(v),
        text: (v) => `${v}`,
    },
    atomRow: {
        make: (v) => atom(String(v)),
        text: (v) => `${v}`,
    },
    array: {
        make: (v) => [String(v), <span>#</span>],
        text: (v) => `${v}#`,
    },
    nestedList: {
        make: (v) => new RxList([String(v), '#']),
        text: (v) => `${v}#`,
    },
}

// 参照模型的 reposition：把 [start, start+limit) 的块移动到 newStart（与 data0 语义一致）
function repositionRef(ref: number[], start: number, newStart: number, limit = 1) {
    if (start === newStart) return
    const moved = ref.splice(start, limit)
    ref.splice(newStart, 0, ...moved)
}

// 列表操作：同时作用于 RxList 和参照数组。初始长度固定为 6。
const OPERATIONS: { [k: string]: (list: RxList<number>, ref: number[]) => void } = {
    'push tail': (list, ref) => {
        list.push(100, 101)
        ref.push(100, 101)
    },
    'unshift head': (list, ref) => {
        list.unshift(100, 101)
        ref.unshift(100, 101)
    },
    'insert middle': (list, ref) => {
        list.splice(3, 0, 100)
        ref.splice(3, 0, 100)
    },
    'remove head': (list, ref) => {
        list.splice(0, 1)
        ref.splice(0, 1)
    },
    'remove middle': (list, ref) => {
        list.splice(2, 2)
        ref.splice(2, 2)
    },
    'remove tail': (list, ref) => {
        list.splice(ref.length - 1, 1)
        ref.splice(ref.length - 1, 1)
    },
    'replace via set (explicit key change)': (list, ref) => {
        list.set(2, 100)
        ref[2] = 100
    },
    'replace head via set': (list, ref) => {
        list.set(0, 100)
        ref[0] = 100
    },
    'clear then push': (list, ref) => {
        list.clear()
        ref.length = 0
        list.push(7, 8)
        ref.push(7, 8)
    },
    'swap ends': (list, ref) => {
        list.swap(0, ref.length - 1)
        const last = ref.length - 1
        ;[ref[0], ref[last]] = [ref[last], ref[0]]
    },
    'swap adjacent': (list, ref) => {
        list.swap(1, 2)
        ;[ref[1], ref[2]] = [ref[2], ref[1]]
    },
    'sort desc (full reverse)': (list, ref) => {
        list.sortSelf((a, b) => b - a)
        ref.sort((a, b) => b - a)
    },
    'reposition forward': (list, ref) => {
        list.reposition(1, 3, 2)
        repositionRef(ref, 1, 3, 2)
    },
    'reposition backward': (list, ref) => {
        list.reposition(3, 1, 2)
        repositionRef(ref, 3, 1, 2)
    },
    'move head to tail': (list, ref) => {
        list.reposition(0, ref.length - 1, 1)
        repositionRef(ref, 0, ref.length - 1, 1)
    },
    'move tail to head': (list, ref) => {
        list.reposition(ref.length - 1, 0, 1)
        repositionRef(ref, ref.length - 1, 0, 1)
    },
    'batched insert + remove (multi-info patch)': (list, ref) => {
        batch(() => {
            list.push(100)
            list.splice(0, 1)
            list.splice(2, 0, 101)
        })
        ref.push(100)
        ref.splice(0, 1)
        ref.splice(2, 0, 101)
    },
}

describe('matrix: list row types x list operations', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    afterEach(() => {
        disableAxiiRetainedObjectDiagnostics()
    })

    const rowTypeNames = Object.keys(ROW_TYPES)
    const operationNames = Object.keys(OPERATIONS)

    const cases: [string, string][] = []
    for (const rowType of rowTypeNames) {
        for (const operation of operationNames) {
            cases.push([rowType, operation])
        }
    }

    test.each(cases)('%s rows / %s', (rowTypeName, operationName) => {
        const rowType = ROW_TYPES[rowTypeName]
        const operation = OPERATIONS[operationName]

        enableAxiiRetainedObjectDiagnostics({reset: true})

        const list = new RxList<number>([0, 1, 2, 3, 4, 5])
        const ref = [0, 1, 2, 3, 4, 5]

        function App() {
            // CAUTION 列表前后都有静态兄弟节点：确保列表不是父元素的唯一内容，
            //  逼出 Range 批量删除路径与真实的锚点查找（而不是 replaceChildren 快速路径）。
            return <div>{'HEAD|'}{list.map((v) => rowType.make(v))}{'|TAIL'}</div>
        }

        const expectedText = () => `HEAD|${ref.map(rowType.text).join('')}|TAIL`

        root.render(<App/>)
        const container = rootEl.firstElementChild! as HTMLElement
        expect(container.textContent).toBe(expectedText())

        // 执行操作
        operation(list, ref)
        expect(container.textContent).toBe(expectedText())

        // 操作后列表仍然可用（追加一行，验证锚点/占位符没有被破坏）
        list.push(99)
        ref.push(99)
        expect(container.textContent).toBe(expectedText())

        // 头部再插一行（依赖 index 0 的锚点判断）
        list.unshift(98)
        ref.unshift(98)
        expect(container.textContent).toBe(expectedText())

        // 销毁后没有任何 host / light binding / compact host 存活
        root.destroy()
        expect(rootEl.textContent).toBe('')
        const snapshot = getAxiiRetainedObjectDiagnosticsSnapshot()
        expect(snapshot.hosts.totalActive).toBe(0)
        expect(snapshot.lightBindings.totalActive).toBe(0)
        expect(snapshot.compactListHosts.active).toBe(0)
    })
})

describe('matrix: FunctionHost return type transitions', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    function TransitionComponent() {
        return <em>C</em>
    }

    // 每种返回值形态：make 必须每次调用都产出新的节点（DOM 节点不可复用）
    const KINDS: { [k: string]: { make: () => any, text: string } } = {
        string: {make: () => 'S', text: 'S'},
        number: {make: () => 42, text: '42'},
        nullish: {make: () => null, text: ''},
        element: {make: () => <b>E</b>, text: 'E'},
        fragment: {make: () => <><i>F1</i><i>F2</i></>, text: 'F1F2'},
        array: {make: () => ['A1', <u>A2</u>], text: 'A1A2'},
        atomValue: {make: () => atom('AT'), text: 'AT'},
        component: {make: () => <TransitionComponent/>, text: 'C'},
        nestedFunction: {make: () => () => 'NF', text: 'NF'},
    }

    const kindNames = Object.keys(KINDS)
    const transitions: [string, string][] = []
    for (const from of kindNames) {
        for (const to of kindNames) {
            if (from !== to) transitions.push([from, to])
        }
    }

    test.each(transitions)('%s -> %s -> back', async (fromName, toName) => {
        const from = KINDS[fromName]
        const to = KINDS[toName]
        const flipped = atom(false)

        root.render(<div>{() => flipped() ? to.make() : from.make()}</div>)
        const container = rootEl.firstElementChild! as HTMLElement

        expect(container.textContent).toBe(from.text)

        // from -> to
        flipped(true)
        await nextMicrotask()
        expect(container.textContent).toBe(to.text)

        // to -> from（反向切换，验证文本/结构两种模式互相清理干净）
        flipped(false)
        await nextMicrotask()
        expect(container.textContent).toBe(from.text)

        root.destroy()
        expect(rootEl.textContent).toBe('')
    })
})

describe('matrix: randomized operation sequences (fuzz)', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    afterEach(() => {
        disableAxiiRetainedObjectDiagnostics()
    })

    // 行类型由值决定，让同一个列表里混合多种行形态
    const MIXED_KIND_COUNT = 6
    function mixedRow(v: number) {
        switch (v % MIXED_KIND_COUNT) {
            case 0: return <span>{String(v)}</span>
            case 1: return <><span>{String(v)}</span><span>#</span></>
            case 2: return String(v)
            case 3: return () => String(v)
            case 4: return atom(String(v))
            default: return <RowComponent v={v}/>
        }
    }
    function mixedRowText(v: number) {
        return v % MIXED_KIND_COUNT === 1 ? `${v}#` : `${v}`
    }

    test('300 random ops per round keep DOM in sync with reference model', () => {
        const random = mulberry32(0xA711)
        const randomInt = (max: number) => Math.floor(random() * max)

        for (let round = 0; round < 3; round++) {
            enableAxiiRetainedObjectDiagnostics({reset: true})

            let nextValue = 0
            const list = new RxList<number>([])
            const ref: number[] = []
            const seed = () => nextValue++

            root.render(<div>{'HEAD|'}{list.map((v) => mixedRow(v))}{'|TAIL'}</div> as any)
            const container = rootEl.firstElementChild! as HTMLElement
            const expectedText = () => `HEAD|${ref.map(mixedRowText).join('')}|TAIL`

            for (let step = 0; step < 300; step++) {
                const len = ref.length
                const pick = randomInt(10)
                if (len === 0 || pick === 0) {
                    // push 1-3 个
                    const count = 1 + randomInt(3)
                    const values = Array.from({length: count}, seed)
                    list.push(...values)
                    ref.push(...values)
                } else if (pick === 1) {
                    const v = seed()
                    list.unshift(v)
                    ref.unshift(v)
                } else if (pick === 2) {
                    const at = randomInt(len + 1)
                    const v = seed()
                    list.splice(at, 0, v)
                    ref.splice(at, 0, v)
                } else if (pick === 3) {
                    const at = randomInt(len)
                    const count = 1 + randomInt(Math.min(3, len - at))
                    list.splice(at, count)
                    ref.splice(at, count)
                } else if (pick === 4) {
                    const at = randomInt(len)
                    const v = seed()
                    list.set(at, v)
                    ref[at] = v
                } else if (pick === 5 && len >= 2) {
                    const a = randomInt(len)
                    let b = randomInt(len)
                    if (b === a) b = (a + 1) % len
                    list.swap(a, b)
                    ;[ref[a], ref[b]] = [ref[b], ref[a]]
                } else if (pick === 6 && len >= 2) {
                    const limit = 1 + randomInt(Math.min(3, len))
                    const start = randomInt(len - limit + 1)
                    const newStart = randomInt(len - limit + 1)
                    list.reposition(start, newStart, limit)
                    repositionRef(ref, start, newStart, limit)
                } else if (pick === 7) {
                    const desc = random() < 0.5
                    const cmp = desc ? (a: number, b: number) => b - a : (a: number, b: number) => a - b
                    list.sortSelf(cmp)
                    ref.sort(cmp)
                } else if (pick === 8 && random() < 0.15) {
                    list.clear()
                    ref.length = 0
                } else {
                    // 混合 batch：一次 digest 内多条 triggerInfo
                    const v1 = seed()
                    const v2 = seed()
                    batch(() => {
                        list.push(v1)
                        list.unshift(v2)
                    })
                    ref.push(v1)
                    ref.unshift(v2)
                }

                if (container.textContent !== expectedText()) {
                    // 打印可复现现场再断言，方便定位
                    throw new Error(
                        `fuzz mismatch at round ${round} step ${step} pick ${pick}\n` +
                        `expected: ${expectedText()}\n` +
                        `actual:   ${container.textContent}`
                    )
                }
            }

            root.destroy()
            expect(rootEl.textContent).toBe('')
            const snapshot = getAxiiRetainedObjectDiagnosticsSnapshot()
            expect(snapshot.hosts.totalActive).toBe(0)
            expect(snapshot.lightBindings.totalActive).toBe(0)
            expect(snapshot.compactListHosts.active).toBe(0)

            disableAxiiRetainedObjectDiagnostics()
            document.body.innerHTML = ''
            rootEl = document.createElement('div')
            document.body.appendChild(rootEl)
            root = createRoot(rootEl)
        }
    })
})
