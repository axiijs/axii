/**
 * data0 → axii 的 patch 协议契约测试。
 *
 * 背景（见 prompt/output/11-contracts-and-invariants.md）：F22（负数 splice 索引错位）的根源
 * 是 axii 对 data0 透传的 triggerInfo 形态做了没写下来的假设。这里把 RxListHost 实际依赖的
 * 协议逐条固化成测试：data0 升级后任何一条形态变化都会在这里先报警，而不是在渲染层
 * 以「DOM 静默错位」的方式暴露。
 *
 * 契约条款（RxListHost.applyTriggerInfo 的全部输入形态）：
 * 1. splice 的 argv 是用户传入的原始参数：start 可以是负数、可以越界（Array#splice 语义），
 *    消费方必须自行归一化；methodResult 是真实删除的元素数组（长度即真实删除数）。
 * 2. push/pop/shift/unshift 等便捷方法一律以 splice patch 的形态到达，argv 已换算成索引。
 * 3. set(index, v) 以 EXPLICIT_KEY_CHANGE 到达：key 是 index（数字），methodResult 是旧值。
 *    CAUTION index 越界的 set 会产生稀疏数组，属于契约外用法（由 dev 模式的列表不变量兜底报错）。
 * 4. reorder(pairs) 以 method === 'reorder' 到达：argv[0] 是 pairs（语义 data[to] = old[from]），
 *    并携带 reorderInfo（kind/affectedRange），swap/reposition/sortSelf 都收敛到它。
 * 5. 派生列表（map）收到的 patch 形态与源列表一致（axii 渲染 list.map(...) 时依赖这一点）。
 */
import {describe, expect, test} from "vitest";
import {
    computed,
    Computed,
    destroyComputed,
    RxList,
    TrackOpTypes,
    TriggerInfo,
    TriggerOpTypes
} from "data0";

// 与 RxListHost.render 完全相同的订阅方式，捕获 axii 实际会收到的 triggerInfos
function captureTriggerInfos(source: RxList<any>) {
    const captured: TriggerInfo[] = []
    const c = computed(
        function computation(this: Computed) {
            this.manualTrack(source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
            this.manualTrack(source, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE)
            return null
        },
        function applyPatch(this: Computed, _, triggerInfos) {
            captured.push(...triggerInfos)
        },
        true
    )
    return {
        captured,
        take() {
            const result = captured.slice()
            captured.length = 0
            return result
        },
        destroy: () => destroyComputed(c)
    }
}

describe('data0 -> axii trigger info contract', () => {
    test('1a. splice forwards the raw user argv: negative start is NOT normalized', () => {
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.splice(-1, 1)
        let infos = sub.take()
        expect(infos.length).toBe(1)
        expect(infos[0].method).toBe('splice')
        // 契约核心：argv 是原始参数，消费方必须自行按 Array#splice 语义归一化
        expect(infos[0].argv).toEqual([-1, 1])
        expect(infos[0].methodResult).toEqual(['c'])

        list.splice(-10, 0, 'x')
        infos = sub.take()
        expect(infos[0].argv).toEqual([-10, 0, 'x'])
        expect(infos[0].methodResult).toEqual([])
        expect(list.data).toEqual(['x', 'a', 'b'])

        sub.destroy()
    })

    test('1a-2. splice forwards the raw user argv: fractional/NaN start is NOT normalized either', () => {
        // Array#splice 对 start 做 ToIntegerOrInfinity：1.5 截断成 1、NaN 归 0。
        // data0 的 data.splice 按该语义生效，但 argv 仍是原始输入（F32 的契约前提）。
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.splice(1.5 as any, 1, 'X')
        let infos = sub.take()
        expect(infos[0].argv).toEqual([1.5, 1, 'X'])
        expect(infos[0].methodResult).toEqual(['b'])
        expect(list.data).toEqual(['a', 'X', 'c'])

        list.splice(NaN as any, 1, 'Y')
        infos = sub.take()
        expect(Number.isNaN(infos[0].argv![0])).toBe(true)
        expect(infos[0].methodResult).toEqual(['a'])
        expect(list.data).toEqual(['Y', 'X', 'c'])

        sub.destroy()
    })

    test('1b. methodResult length is the real delete count (deleteCount argv can overshoot)', () => {
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.splice(1, 100)
        const infos = sub.take()
        expect(infos[0].argv).toEqual([1, 100])
        // 真实删除数以 methodResult 为准，argv[1] 只是用户输入
        expect(infos[0].methodResult).toEqual(['b', 'c'])

        sub.destroy()
    })

    test('2. convenience methods arrive as splice patches with index-resolved argv', () => {
        const list = new RxList(['a', 'b'])
        const sub = captureTriggerInfos(list)

        list.push('c')
        expect(sub.take()[0]).toMatchObject({method: 'splice', argv: [2, 0, 'c']})

        list.pop()
        expect(sub.take()[0]).toMatchObject({method: 'splice', argv: [2, 1], methodResult: ['c']})

        list.unshift('z')
        expect(sub.take()[0]).toMatchObject({method: 'splice', argv: [0, 0, 'z']})

        list.shift()
        expect(sub.take()[0]).toMatchObject({method: 'splice', argv: [0, 1], methodResult: ['z']})

        sub.destroy()
    })

    test('3. set() arrives as EXPLICIT_KEY_CHANGE with numeric key and old value as methodResult', () => {
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.set(1, 'B')
        const infos = sub.take()
        const keyChange = infos.find(info => info.type === TriggerOpTypes.EXPLICIT_KEY_CHANGE)!
        expect(keyChange).toBeTruthy()
        expect(keyChange.key).toBe(1)
        expect(typeof keyChange.key).toBe('number')
        expect(keyChange.methodResult).toBe('b')
        expect(list.data).toEqual(['a', 'B', 'c'])

        sub.destroy()
    })

    test('4. reorder family (reorder/swap/reposition/sortSelf) arrives as one reorder patch with pairs + reorderInfo', () => {
        const list = new RxList(['b', 'a', 'c'])
        const sub = captureTriggerInfos(list)

        list.swap(0, 1)
        let infos = sub.take()
        expect(infos.length).toBe(1)
        expect(infos[0].method).toBe('reorder')
        // pairs 语义：data[to] = old[from]
        const pairs = infos[0].argv![0] as [number, number][]
        for (const [from, to] of pairs) {
            expect(typeof from).toBe('number')
            expect(typeof to).toBe('number')
        }
        expect((infos[0] as any).reorderInfo).toBeTruthy()
        expect((infos[0] as any).reorderInfo.kind).toBe('swap')
        expect(list.data).toEqual(['a', 'b', 'c'])

        list.sortSelf((x, y) => x < y ? 1 : -1)
        infos = sub.take()
        expect(infos[0].method).toBe('reorder')
        expect((infos[0] as any).reorderInfo.kind).toBe('sort')
        expect(list.data).toEqual(['c', 'b', 'a'])

        list.reposition(2, 0)
        infos = sub.take()
        expect(infos[0].method).toBe('reorder')
        expect(list.data).toEqual(['a', 'c', 'b'])

        sub.destroy()
    })

    test('5. derived list (map) receives the same splice patch shapes as the source', () => {
        const source = new RxList(['a', 'b', 'c'])
        const mapped = source.map(item => item.toUpperCase())
        const sub = captureTriggerInfos(mapped)

        source.splice(-1, 1, 'x', 'y')
        const infos = sub.take()
        expect(infos.length).toBe(1)
        expect(infos[0].method).toBe('splice')
        // 派生列表的 argv 已被 map 归一化处理过（data0 内部换算），
        // 但 methodResult/新增项数量的关系必须与源 patch 一致
        const argv = infos[0].argv!
        expect(argv.length - 2).toBe(2)
        expect(argv.slice(2)).toEqual(['X', 'Y'])
        expect((infos[0].methodResult as any[]).length).toBe(1)
        expect(mapped.data).toEqual(['A', 'B', 'X', 'Y'])

        sub.destroy()
    })

    test('6. clear-style splice (fast path) still delivers a splice patch with raw argv', () => {
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.splice(0, list.data.length)
        const infos = sub.take()
        expect(infos[0].method).toBe('splice')
        expect(infos[0].argv).toEqual([0, 3])
        expect(infos[0].methodResult).toEqual(['a', 'b', 'c'])
        expect(list.data).toEqual([])

        sub.destroy()
    })
})
