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
 * 3. set(index, v) 以 EXPLICIT_KEY_CHANGE 到达：key 是 index（数字），newValue 是操作时新值，
 *    methodResult 是旧值。RxListHost 必须用 newValue 建行，禁止回读 source.data[key]
 *    （batch 多 info 重放时 source 已是终态）。CAUTION index 越界的 set 会产生稀疏数组，
 *    属于契约外用法（由 dev 模式的列表不变量兜底报错）。
 * 4. reorder(pairs) 以 method === 'reorder' 到达：argv[0] 是 pairs（语义 data[to] = old[from]），
 *    并携带 reorderInfo（kind/affectedRange），swap/reposition/sortSelf 都收敛到它。
 * 5. 派生列表（map）收到的 patch 形态与源列表一致（axii 渲染 list.map(...) 时依赖这一点）。
 * 6.（见条款 7/8 的测试）data0 >= 2.2 的错误传播契约：同步 computed 的 applyPatch 抛出的
 *    异常**同步传播到变更调用点**（list.splice(...) 等），不再变成 unhandled rejection；
 *    全局追踪状态在抛错后保持完好；computed 复位为 dirty，失败批次的 triggerInfos 不重放。
 *    RxListHost 的错误出口（catch -> root error 钩子 -> rethrow）与 fail-stop 恢复策略、
 *    errorHandling.spec 的断言方式都依赖这些条款。
 */
import {describe, expect, test} from "vitest";
import {
    atom,
    autorun,
    batch,
    computed,
    Computed,
    destroyComputed,
    ManualCleanup,
    ReactiveEffect,
    RxList,
    TrackOpTypes,
    TriggerInfo,
    TriggerOpTypes
} from "data0";
import {detachEffectFromCreationContext} from "../src/LightBindingEffect";

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

    test('3. set() arrives as EXPLICIT_KEY_CHANGE with numeric key, newValue, and old value as methodResult', () => {
        const list = new RxList(['a', 'b', 'c'])
        const sub = captureTriggerInfos(list)

        list.set(1, 'B')
        const infos = sub.take()
        const keyChange = infos.find(info => info.type === TriggerOpTypes.EXPLICIT_KEY_CHANGE)!
        expect(keyChange).toBeTruthy()
        expect(keyChange.key).toBe(1)
        expect(typeof keyChange.key).toBe('number')
        expect(keyChange.newValue).toBe('B')
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

    test('7. sync patch errors propagate synchronously to the mutation site and tracking state survives', () => {
        // data0 >= 2.2：同步 computed 的 patch/getter 在同步路径上执行，未被消费的错误
        //  同步抛回到变更调用点（旧版本是 async fullRecompute/patchRecompute，只能变成
        //  unhandled rejection）。RxListHost 的「未注册 error 钩子时 report + throw 保持
        //  可观测」出口依赖这一点（errorHandling.spec 的 AxiiError trace 用例）。
        const list = new RxList(['a'])
        const c = computed(
            function computation(this: Computed) {
                this.manualTrack(list, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                return null
            },
            function applyPatch() {
                throw new Error('patch failed')
            }
        )
        expect(() => list.push('b')).toThrow('patch failed')

        // 抛错后全局追踪状态必须完好：后续 reactive 依赖照常工作
        const other = new RxList([1])
        const doubled = other.map(x => x * 2)
        other.push(2)
        expect(doubled.data).toEqual([2, 4])

        destroyComputed(c)
        doubled.destroy()
        other.destroy()
    })

    test('8. after a throwing patch the failed batch is NOT replayed; recovery is version-dependent (2.9+: rerun computation)', () => {
        // 恢复语义按 data0 版本分两代：
        // - data0 <= 2.8：错误后 computed 复位 dirty，下一次变更继续走增量 patch。
        //   CAUTION 抛错批次的 triggerInfos 已丢失——派生数据可能与 source 永久分叉
        //   （data0 2026-H2 review 的缺陷类 4）。
        // - data0 >= 2.9（缺陷类 4 修复）：错误后回退到全量重算阶段，下一次变更
        //   **重跑 computation**（applyPatch 不收 info），保证派生 ≡ 终态 source；
        //   再下一次恢复增量。消费方必须支持 computation 重跑（RxListHost 的重跑
        //   语义 = 销毁旧行 + 全量重建，见 data0RecoveryRerun.spec）。
        // 本测试运行时探测语义代，双代都锁定「失败批次不重放」这一共同条款。
        const list = new RxList(['a', 'b'])
        const received: TriggerInfo[] = []
        let computationRuns = 0
        let shouldThrow = true
        const c = computed(
            function computation(this: Computed) {
                computationRuns++
                this.manualTrack(list, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                return null
            },
            function applyPatch(this: Computed, _, triggerInfos) {
                if (shouldThrow) throw new Error('patch boom')
                received.push(...triggerInfos)
            },
            true
        )
        expect(computationRuns).toBe(1)

        expect(() => list.push('c')).toThrow('patch boom')
        // source 数据已写入（patch 失败不回滚 source）
        expect(list.data).toEqual(['a', 'b', 'c'])

        shouldThrow = false
        expect(() => list.push('d')).not.toThrow()
        expect(list.data).toEqual(['a', 'b', 'c', 'd'])

        const rerunsAfterError = computationRuns > 1
        if (rerunsAfterError) {
            // data0 >= 2.9：错误后第一次变更全量重跑，applyPatch 不收 info
            expect(computationRuns).toBe(2)
            expect(received.length).toBe(0)
            // 再下一次变更恢复增量 patch
            list.push('e')
            expect(computationRuns).toBe(2)
            expect(received.length).toBe(1)
            expect(received[0]).toMatchObject({method: 'splice', argv: [4, 0, 'e']})
        } else {
            // data0 <= 2.8：错误后下一次变更仍走增量 patch；失败批次('c')不重放
            expect(received.length).toBe(1)
            expect(received[0]).toMatchObject({method: 'splice', argv: [3, 0, 'd']})
        }

        destroyComputed(c)
    })
})

/**
 * 归属契约（axii 依赖的 data0 内部行为，不是文档化的 API）：
 * 9. 新建的 effect（ReactiveEffect 子类、computed）在基类构造器里被压进「当前打开的」
 *    ManualCleanup 收集帧的末尾；作用域栈顶的 effect 允许收集子 effect 时，它成为栈顶的
 *    最后一个 child（`parent` / `index` / `_children[index]`）。computed(getter, applyPatch, true)
 *    在 computed() 调用里同步执行第一次 getter，getter 的 this 是 Computed 实例，此刻它仍然是
 *    收集帧和父 effect children 的最后一项、getter 期间 data0 不另开收集帧。
 *    → `detachEffectFromCreationContext` 只看「末尾那一项」，ReactiveAttributeEffect（构造器里）
 *      和列表的 computed（第一次 getter 里）都依赖这一点（见 LightBindingEffect.ts）。
 * 10. 只有作用域栈顶的 effect 收集子 effect；把栈顶的 shouldCollectChild 置为 false 就不收集，
 *     不会落到更外层的 effect 上。→ root.render / destroy / dispatch 的隔离（render.ts）。
 * 11. ReactiveEffect.createDetached(fn) 里创建的 effect 既不进栈顶 effect 的 children，
 *     也不进当前打开的收集帧；返回后两者恢复原状。→ dispatch('error') 的监听器隔离。
 * 12. 正在运行的 computed（patch 执行中）被 destroyComputed 不会抛错，销毁推迟到它退出作用域栈后，
 *     之后的变更不再调用它。→ RxListHost 在自己的 patch 里被同步销毁（重入销毁）。
 */
describe('data0 -> axii ownership contract', () => {
    const top = () => ReactiveEffect.activeScopes[ReactiveEffect.activeScopes.length - 1]
    const childrenOf = (effect: ReactiveEffect) => (effect as any)._children as ReactiveEffect[] | undefined

    test('9a. a new effect is the last item of the open collect frame and the last child of the running effect', () => {
        let running: ReactiveEffect | undefined
        let created: ReactiveEffect | undefined
        let frame: unknown[] = []
        const stop = autorun(() => {
            running = top()
            const end = ManualCleanup.collectEffect()
            created = new ReactiveEffect()
            frame = end()
        }, true)
        expect(frame[frame.length - 1]).toBe(created)
        expect(created!.parent).toBe(running)
        const children = childrenOf(running!)!
        expect(children[children.length - 1]).toBe(created)
        expect(children[created!.index]).toBe(created)
        stop()
    })

    test('9b. computed(getter, applyPatch, true) runs its first getter synchronously, as the last item of both', () => {
        const source = new RxList<number>([1])
        let seen: Record<string, boolean> | undefined
        let running: ReactiveEffect | undefined
        let frame: unknown[] = []
        let c: any
        const stop = autorun(() => {
            running = top()
            const end = ManualCleanup.collectEffect()
            c = computed(function getter(this: Computed) {
                if (!seen) {
                    const frames = ManualCleanup.collectFrames
                    const openFrame = frames[frames.length - 1] as unknown[]
                    const children = childrenOf(running!)
                    seen = {
                        isComputedInstance: this instanceof Computed,
                        lastInOpenFrame: openFrame[openFrame.length - 1] === this,
                        parentIsRunning: this.parent === running,
                        lastChild: !!children && children[children.length - 1] === this,
                        indexMatches: !!children && children[this.index] === this,
                    }
                }
                this.manualTrack(source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                return null
            }, function applyPatch() {}, true)
            // the getter already ran inside computed()
            expect(seen).not.toBe(undefined)
            frame = end()
        }, true)
        expect(seen).toEqual({isComputedInstance: true, lastInOpenFrame: true, parentIsRunning: true, lastChild: true, indexMatches: true})
        expect(frame.length).toBe(1)
        destroyComputed(c)
        stop()
    })

    test('9c. detachEffectFromCreationContext leaves neither the frame nor the running effect owning the effect', () => {
        let running: ReactiveEffect | undefined
        let created: ReactiveEffect | undefined
        let sibling: ReactiveEffect | undefined
        let frame: unknown[] = []
        const stop = autorun(() => {
            running = top()
            const end = ManualCleanup.collectEffect()
            sibling = new ReactiveEffect()
            created = new ReactiveEffect()
            detachEffectFromCreationContext(created)
            frame = end()
        }, true)
        expect(frame).toEqual([sibling])
        expect(created!.parent).toBe(undefined)
        const children = childrenOf(running!)!
        expect(children.includes(created!)).toBe(false)
        expect(children[sibling!.index]).toBe(sibling)
        stop()
    })

    test('10. only the top of the scope stack collects, and pausing it does not fall through to an outer effect', () => {
        let outer: ReactiveEffect | undefined
        let inner: ReactiveEffect | undefined
        let collected: ReactiveEffect | undefined
        let paused: ReactiveEffect | undefined
        const stopOuter = autorun(() => {
            outer = top()
            const stopInner = autorun(() => {
                inner = top()
                collected = new ReactiveEffect()
                const saved = inner.shouldCollectChild
                inner.shouldCollectChild = false
                try {
                    paused = new ReactiveEffect()
                } finally {
                    inner.shouldCollectChild = saved
                }
            }, true)
            stopInner()
        }, true)
        expect(collected!.parent).toBe(inner)
        expect(paused!.parent).toBe(undefined)
        expect((childrenOf(outer!) ?? []).includes(paused!)).toBe(false)
        stopOuter()
    })

    test('11. createDetached isolates both the running effect and the open collect frame, then restores them', () => {
        let running: ReactiveEffect | undefined
        let detached: ReactiveEffect | undefined
        let after: ReactiveEffect | undefined
        let frame: unknown[] = []
        const stop = autorun(() => {
            running = top()
            const end = ManualCleanup.collectEffect()
            detached = ReactiveEffect.createDetached(() => new ReactiveEffect())
            after = new ReactiveEffect()
            frame = end()
        }, true)
        expect(detached!.parent).toBe(undefined)
        expect(frame).toEqual([after])
        expect(after!.parent).toBe(running)
        stop()
    })

    test('12. destroying a computed from inside its own applyPatch is deferred and does not throw', () => {
        const source = new RxList<number>([])
        const value = atom(0)
        let patches = 0
        const c: any = computed(
            function computation(this: Computed) {
                this.manualTrack(source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                value()
                return null
            },
            function applyPatch(this: Computed) {
                patches++
                destroyComputed(c)
            },
            true
        )
        expect(() => source.push(1)).not.toThrow()
        expect(patches).toBe(1)
        source.push(2)
        value(1)
        expect(patches).toBe(1)
    })
})

/**
 * 写回契约（#55 设计 §3.3，axii 依赖的 data0 内部行为，不是文档化的 API）：
 * 新的激活模型里，RxList 的行在激活期间是描述（HydrationElement）。RxListHost 认领一行后，
 * 如果 source.data[i] 仍是这个描述，就用普通下标赋值把它换成认领到的元素（`source.data[i] = node`），
 * 绕过 RxList 的方法、不派发任何 patch。这依赖：
 * 13a. RxList.data 是普通数组：按下标赋值不触发任何 effect（patch 订阅、at(i)、迭代、length、
 *      下游 map 都收不到通知），不改变 length。根列表与 map 派生列表都如此
 *      （RxListHost 的 source 通常是 list.map(...) 的派生列表）。
 * 13b. map 派生列表的增量 patch 与 effectFramesArray 按下标平行维护，不按 item 身份缓存：
 *      写回的值与行 effect 一起随 splice / 重排按下标移动；行 effect 重跑时按该行现在的下标
 *      替换这一行（重新对 source.data[下标] 求值，与 CSR 一样替换掉旧行）；带下标 atom 的
 *      多 info 批次退回全量重算，同样从 source 重新求值。
 * 13c. 之后的 splice / set / 重排以 data 为准：patch 的 methodResult / set 的旧值里是写回后的值，
 *      重排移动的也是写回后的值。
 * 本组只钉 RxList 本身与 map。filter / concat / slice 等把上游 item 原样放进自己 data 的派生
 * 操作，写回只改到被渲染的那一个列表，上游仍持有描述——不在本契约内。
 */
describe('data0 -> axii write-back contract (#55 §3.3)', () => {
    const toBeEach = (actual: readonly unknown[], expected: readonly unknown[]) => {
        expect(actual.length).toBe(expected.length)
        expected.forEach((value, i) => expect(actual[i]).toBe(value))
    }

    test('13a. a raw index write to RxList.data notifies no effect and keeps length (root list and map-derived list)', () => {
        const source = new RxList<string>(['a', 'b', 'c'])
        const mapped = source.map(item => ({desc: item}))
        const downstream = mapped.map(row => row)
        const observe = (list: RxList<any>) => {
            const patches = captureTriggerInfos(list)
            const runs = {at: 0, iterate: 0, length: 0}
            const length = list.length
            const stops = [
                autorun(() => { list.at(1); runs.at++ }, true),
                autorun(() => { list.forEach(() => {}); runs.iterate++ }, true),
                autorun(() => { length(); runs.length++ }, true),
            ]
            return {list, patches, runs, length, stops}
        }
        const observers = [observe(source), observe(mapped)]
        const mappedBefore = mapped.data.slice()
        const downstreamBefore = downstream.data.slice()

        // 根列表：下游 map 不重算，派生行原样保留
        source.data[1] = 'B'
        toBeEach(mapped.data, mappedBefore)
        // map 派生列表：RxListHost.hydrate 的写回
        const claimed = {claimed: 1}
        mapped.data[1] = claimed

        for (const {list, patches, runs, length} of observers) {
            expect(patches.take()).toEqual([])
            expect(runs).toEqual({at: 1, iterate: 1, length: 1})
            expect(list.data.length).toBe(3)
            expect(length()).toBe(3)
        }
        toBeEach(downstream.data, downstreamBefore)
        expect(source.at(1)).toBe('B')
        expect(mapped.at(1)).toBe(claimed)

        for (const {patches, stops} of observers) {
            patches.destroy()
            stops.forEach(stop => stop())
        }
        downstream.destroy()
        mapped.destroy()
        source.destroy()
    })

    test('13b. map keeps rows and effectFramesArray parallel by index, not by item identity', () => {
        const labels = ['a', 'b', 'c', 'd'].map(label => atom(label))
        // CAUTION RxList 直接把传入的数组当作自己的 data：传副本，labels[i] 才一直指向同一个 atom
        const source = new RxList(labels.slice())
        // 行里读 atom：每行有自己的行 effect（effectFramesArray 的项非空），data0 同时启用下标 atom
        const mapped = source.map(label => ({label: label()}))
        const frames = () => (mapped as any).effectFramesArray as unknown[][]
        expect(frames().length).toBe(4)
        for (const frame of frames()) expect(frame.length).toBe(1)

        // RxListHost.hydrate 认领每一行后写回
        const claimed = mapped.data.map((_, i) => ({claimed: i}))
        claimed.forEach((node, i) => { mapped.data[i] = node })
        const rowEffects = frames().slice()

        // splice：写回的值与行 effect 一起按下标移动
        source.splice(0, 0, atom('x'))
        expect(mapped.data[0]).toEqual({label: 'x'})
        toBeEach(mapped.data.slice(1), claimed)
        expect(frames().length).toBe(mapped.data.length)
        toBeEach(frames().slice(1), rowEffects)

        source.splice(2, 1) // 删掉 'b' 那一行
        toBeEach(mapped.data.slice(1), [claimed[0], claimed[2], claimed[3]])
        toBeEach(frames().slice(1), [rowEffects[0], rowEffects[2], rowEffects[3]])

        // 重排：同一组下标对搬移行值与行 effect
        source.swap(1, 3)
        toBeEach(mapped.data.slice(1), [claimed[3], claimed[2], claimed[0]])
        toBeEach(frames().slice(1), [rowEffects[3], rowEffects[2], rowEffects[0]])

        // 行 effect 重跑：按该行现在的下标（'d' 在 1）替换，其余写回的行不动
        const sub = captureTriggerInfos(mapped)
        labels[3]('D')
        expect(mapped.data[1]).toEqual({label: 'D'})
        toBeEach(mapped.data.slice(2), [claimed[2], claimed[0]])
        const keyChanges = sub.take().filter(info => info.type === TriggerOpTypes.EXPLICIT_KEY_CHANGE)
        expect(keyChanges.length).toBe(1)
        expect(keyChanges[0].key).toBe(1)
        expect(keyChanges[0].methodResult).toBe(claimed[3])
        expect(frames()[1]).toBe(rowEffects[3])
        // 已删除行的 atom 不再影响列表
        labels[1]('B')
        expect(sub.take()).toEqual([])

        // 带下标 atom 的多 info 批次：退回全量重算，每一行都从 source 重新求值（与 CSR 相同，旧行被替换）
        batch(() => {
            source.push(atom('y'))
            source.splice(0, 1)
        })
        expect(mapped.data).toEqual([{label: 'D'}, {label: 'c'}, {label: 'a'}, {label: 'y'}])
        for (const node of claimed) expect(mapped.data.includes(node as any)).toBe(false)
        expect(frames().length).toBe(mapped.data.length)

        sub.destroy()
        mapped.destroy()
        source.destroy()
    })

    test('13c. after a write-back, splice / set / reorder operate on data and carry the written-back values', () => {
        // 根列表直接作为 child（行本身就是描述）
        const root = new RxList<any>([{desc: 0}, {desc: 1}, {desc: 2}, {desc: 3}])
        const claimed = root.data.map((_, i) => ({claimed: i}))
        claimed.forEach((node, i) => { root.data[i] = node })
        const sub = captureTriggerInfos(root)

        root.swap(0, 2)
        toBeEach(root.data, [claimed[2], claimed[1], claimed[0], claimed[3]])
        expect(sub.take()[0].method).toBe('reorder')

        toBeEach(root.splice(1, 1), [claimed[1]])
        let infos = sub.take()
        expect(infos[0].method).toBe('splice')
        toBeEach(infos[0].methodResult as any[], [claimed[1]])

        const fresh = {desc: 'fresh'}
        expect(root.set(0, fresh)).toBe(claimed[2])
        const keyChange = sub.take().find(info => info.type === TriggerOpTypes.EXPLICIT_KEY_CHANGE)!
        expect(keyChange.methodResult).toBe(claimed[2])
        expect(keyChange.newValue).toBe(fresh)
        toBeEach(root.data, [fresh, claimed[0], claimed[3]])
        sub.destroy()

        // map 派生列表：源列表的操作到达派生列表时，patch 里同样是写回后的值
        const source = new RxList(['a', 'b', 'c'])
        const mapped = source.map(item => ({desc: item}))
        const rows = mapped.data.map((_, i) => ({claimed: i}))
        rows.forEach((node, i) => { mapped.data[i] = node })
        const mappedSub = captureTriggerInfos(mapped)

        source.splice(0, 1)
        infos = mappedSub.take()
        toBeEach(infos[0].methodResult as any[], [rows[0]])
        toBeEach(mapped.data, [rows[1], rows[2]])

        source.set(0, 'B')
        const mappedKeyChange = mappedSub.take().find(info => info.type === TriggerOpTypes.EXPLICIT_KEY_CHANGE)!
        expect(mappedKeyChange.key).toBe(0)
        expect(mappedKeyChange.methodResult).toBe(rows[1])
        expect(mapped.data[0]).toEqual({desc: 'B'})

        source.swap(0, 1)
        expect(mappedSub.take()[0].method).toBe('reorder')
        expect(mapped.data[0]).toBe(rows[2])
        expect(mapped.data[1]).toEqual({desc: 'B'})

        mappedSub.destroy()
        mapped.destroy()
        source.destroy()
        root.destroy()
    })
})
