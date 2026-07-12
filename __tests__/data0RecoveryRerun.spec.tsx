/**
 * data0 >= 2.9 错误恢复语义下 RxListHost 的全量重建回归。
 *
 * 契约(data0Contract.spec 条款 8):patch 抛错(rethrow 出口)后 data0 把该
 * computed 回退到全量重算阶段,下一次源变更**重跑 computation**(不是增量 patch)。
 * 缺陷(2026-H2 复现):RxListHost 的 computation 假定只跑一次,重跑时残留 hosts
 * 未清理——行组件撞上 "should never rerender" 断言,列表区域永久崩坏。
 * 修复:computation 开头销毁上一轮 hosts(自摘 DOM)再全量重建。
 *
 * 兼容:npm 安装的 data0 2.8 是旧语义(错误后仍走增量 patch,抛错批次丢失),
 * 运行时探测语义代,旧代下断言 fail-stop 的旧行为(丢失批次不恢复)。
 */
import {describe, expect, test} from "vitest";
import {createElement, createRoot} from "../src/index.js";
import {computed, Computed, destroyComputed, RxList, TrackOpTypes, TriggerOpTypes} from "data0";

// 运行时探测 data0 的错误恢复语义代(sibling checkout 是 2.9+,npm 安装是 2.8):
// 2.9+ 在 patch 抛错后回退全量阶段,下一次变更重跑 computation。
function detectRerunSemantics(): boolean {
    const list = new RxList([1])
    let runs = 0
    let shouldThrow = true
    const c = computed(
        function computation(this: Computed) {
            runs++
            this.manualTrack(list, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
            return null
        },
        function applyPatch() {
            if (shouldThrow) throw new Error('probe boom')
        },
        true
    )
    try { list.push(2) } catch { /* expected */ }
    shouldThrow = false
    list.push(3)
    const reruns = runs > 1
    destroyComputed(c)
    list.destroy()
    return reruns
}
const HAS_RERUN_RECOVERY = detectRerunSemantics()

describe('RxListHost × data0 错误恢复(computation 重跑)', () => {
    test('rethrow 出口(无 error 钩子):恢复语义按 data0 代际,DOM 始终不崩坏', () => {
        const list = new RxList<number>([1, 2])
        let throwFor: number | null = null
        const Row = ({item}: {item: number}) => {
            if (item === throwFor) throw new Error('row render boom')
            return <span>{item}</span>
        }
        const root = document.createElement('div')
        document.body.appendChild(root)
        const app = createRoot(root)
        app.render(<div>
            {list.map(item => <Row item={item}/>)}
        </div>)
        expect(root.textContent).toBe('12')

        throwFor = 3
        expect(() => list.push(3)).toThrow('row render boom')
        // fail-stop:保留最后一个完整 DOM
        expect(root.textContent).toBe('12')

        throwFor = null
        list.push(4)
        if (HAS_RERUN_RECOVERY) {
            // data0 >= 2.9:全量恢复 → computation 重跑 → 旧行销毁 + 全量重建。
            // 修复前:残留 hosts 撞 "should never rerender",这里直接抛错。
            expect(root.textContent).toBe('1234')
            expect(root.querySelectorAll('span').length).toBe(4)
            // 恢复后回到增量
            list.splice(0, 1)
            expect(root.textContent).toBe('234')
        } else {
            // data0 <= 2.8:抛错批次(3)丢失,后续增量继续应用(已知旧语义)
            expect(root.textContent).toBe('124')
        }

        app.destroy()
        document.body.removeChild(root)
    })

    test('error 钩子消费出口:错误不经 data0,fail-stop 契约不变(不恢复、不崩坏)', () => {
        // 对照组:错误被 root error 钩子**消费**时 RxListHost 的 applyPatch 正常返回,
        // data0 视为 patch 成功——不回退全量阶段、不重跑 computation。恢复责任在
        // 上层(RxListHost 注释声明的 fail-stop:保留最后一个完整 DOM,后续增量在
        // 不一致状态上继续,等待上层销毁/恢复)。此行为与 data0 代际无关。
        const list = new RxList<number>([1, 2])
        let throwFor: number | null = null
        const Row = ({item}: {item: number}) => {
            if (item === throwFor) throw new Error('row render boom')
            return <span>{item}</span>
        }
        const root = document.createElement('div')
        document.body.appendChild(root)
        const app = createRoot(root)
        const errors: unknown[] = []
        app.on('error', (e: unknown) => { errors.push(e) })
        app.render(<div>
            {list.map(item => <Row item={item}/>)}
        </div>)

        throwFor = 3
        list.push(3) // 行渲染错误被钩子消费,不上抛
        expect(errors.length).toBe(1)
        expect(root.textContent).toBe('12')

        throwFor = null
        list.push(4)
        // 抛错批次(3)按 fail-stop 丢失;后续增量仍能应用,系统不崩
        expect(root.textContent).toBe('124')
        expect(errors.length).toBe(1) // 无新错误

        app.destroy()
        document.body.removeChild(root)
    })
})
