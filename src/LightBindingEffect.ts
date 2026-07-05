import {
    isData0RetainedObjectDiagnosticsEnabled,
    ReactiveEffect,
    setRetainedReactiveEffectSource,
    trackRetainedReactiveEffectCreated
} from "data0";

type SkipIndicator = { skip: boolean }

/**
 * @internal
 *
 * 渲染热路径专用的轻量绑定 effect。
 *
 * data0 的 `computed`/`autorun` 每个实例都要分配 status/updatedAt 两个 atom（Proxy）、
 * triggerInfos/effectFramesArray/cachedValues 等集合以及十余个闭包字段。列表渲染场景下
 * 每行的文本/属性绑定都要一个响应式订阅，这些分配会成为创建/销毁的主要开销。
 *
 * LightBindingEffect 直接继承 data0 的 ReactiveEffect：
 * - 依赖追踪/触发/父子 effect 收集（destroyChildren、collectEffect frame）与 Computed 完全一致；
 * - 触发时同步重跑 update 函数（与之前 autorun(fn, true)/computed(fn, undefined, true) 的
 *   immediate 语义一致）；
 * - 没有 applyPatch/async/状态机，构造成本只有基类的字段初始化。
 */
export class LightBindingEffect extends ReactiveEffect {
    constructor(public update: (effect: LightBindingEffect) => void, public skipIndicator?: SkipIndicator) {
        // CAUTION 不传 getter：跳过基类构造器里对 getter 的 AsyncFunction/GeneratorFunction
        //  判断（两次 constructor.name 字符串比较，在长列表创建时可测量）。
        //  active 和 retained diagnostics 登记在下面手动补上。
        super()
        this.active = true
        if (isData0RetainedObjectDiagnosticsEnabled()) {
            trackRetainedReactiveEffectCreated(this)
            // 构建产物里 constructor.name 会被压缩，显式登记可读的 source 名
            setRetainedReactiveEffectSource(this, 'LightBindingEffect')
        }
    }
    callGetter() {
        return this.update(this)
    }
    run() {
        // 已销毁的 effect 不应再执行副作用（基类对 inactive 的 run 会退化成直接调用 getter）
        if (!this.active) return
        if (this.skipIndicator?.skip) return
        return super.run()
    }
}

/**
 * @internal
 *
 * 微任务批量版本：第一次 run 同步执行（初始渲染），之后的依赖触发合并到一个微任务里重算。
 * 与之前 FunctionHost 里 autorun + queueMicrotask 的调度语义一致
 * （同一 tick 内多次触发只重算一次）。
 */
export class DeferredBindingEffect extends LightBindingEffect {
    hasRun = false
    scheduled = false
    run() {
        if (!this.hasRun) {
            this.hasRun = true
            return super.run()
        }
        if (this.scheduled) return
        this.scheduled = true
        queueMicrotask(() => {
            this.scheduled = false
            if (this.active) super.run()
        })
    }
}
