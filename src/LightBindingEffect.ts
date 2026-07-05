import {
    isData0RetainedObjectDiagnosticsEnabled,
    ManualCleanup,
    ReactiveEffect,
    setRetainedReactiveEffectSource,
    trackRetainedReactiveEffectCreated
} from "data0";

type SkipIndicator = { skip: boolean }

// CAUTION 下面三个共享函数用来覆盖 data0 ReactiveEffect 构造器里逐实例分配的
//  pauseCollectChild/resumeCollectChild/dispatch 箭头函数字段。
//  长列表里每个文本/属性绑定都是一个 effect，3 个闭包 × 每实例 ≈ 数百 KB 的常驻内存。
//  覆盖后实例字段指向共享函数（hidden class 不变），构造器里创建的闭包立即变成垃圾。
//  这依赖 data0 内部始终以方法调用形式使用它们（effect.dispatch(...) 等），
//  data0 的 L.destroy/prepareTracking 均满足。
//  data0 >= 2.0.1 已把这三个函数改为原型方法（不再逐实例分配闭包），此时无需覆盖，
//  覆盖反而会新增实例槽位，所以用模块级探测做一次性判断。
function sharedPauseCollectChild(this: ReactiveEffect) {
    this.shouldCollectChild = false
}
function sharedResumeCollectChild(this: ReactiveEffect) {
    this.shouldCollectChild = true
}
function sharedDispatch(this: ReactiveEffect, event: string, ...args: any[]) {
    // 与 data0 实例版 dispatch 行为完全一致（_eventToCallbacks 是惰性创建的私有字段）
    const callbacks = (this as any)._eventToCallbacks?.get(event)
    if (callbacks) callbacks.forEach((callback: Function) => callback.call(this, ...args))
}
const effectHelpersOnPrototype = typeof (ReactiveEffect.prototype as any).pauseCollectChild === 'function'

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
 *
 * update 可以通过构造器闭包传入，也可以由子类以原型方法提供（AtomHost/FunctionHost
 * 把自己和 effect 合并成同一个对象时用后者，省掉一个闭包 + 一个对象）。
 */
export class LightBindingEffect extends ReactiveEffect {
    // 可选方法声明（而不是属性声明），子类既可以用原型方法覆写，也可以由构造器闭包赋值
    update?(effect: LightBindingEffect): void
    skipIndicator?: SkipIndicator
    constructor(update?: (effect: LightBindingEffect) => void, skipIndicator?: SkipIndicator) {
        // CAUTION 不传 getter：跳过基类构造器里对 getter 的 AsyncFunction/GeneratorFunction
        //  判断（两次 constructor.name 字符串比较，在长列表创建时可测量）。
        //  active 和 retained diagnostics 登记在下面手动补上。
        super()
        // 用共享函数覆盖基类构造器里逐实例分配的三个闭包字段，降低每绑定的常驻内存
        // （data0 >= 2.0.1 已是原型方法，无需覆盖）
        if (!effectHelpersOnPrototype) {
            this.pauseCollectChild = sharedPauseCollectChild
            this.resumeCollectChild = sharedResumeCollectChild
            this.dispatch = sharedDispatch
        }
        if (update) this.update = update
        if (skipIndicator) this.skipIndicator = skipIndicator
        this.active = true
        if (isData0RetainedObjectDiagnosticsEnabled()) {
            trackRetainedReactiveEffectCreated(this)
            // 构建产物里 constructor.name 会被压缩，显式登记可读的 source 名
            setRetainedReactiveEffectSource(this, 'LightBindingEffect')
        }
    }
    callGetter() {
        return this.update!(this)
    }
    run() {
        // 已销毁的 effect 不应再执行副作用（基类对 inactive 的 run 会退化成直接调用 getter）
        if (!this.active) return
        if (this.skipIndicator?.skip) return
        return super.run()
    }
    /**
     * 把（AtomHost/FunctionHost 这类同时也是 Host 的）effect 从创建时的上下文中摘除：
     * - ManualCleanup collect frame：Host 对象的销毁由宿主树显式管理（destroy(parentHandle,
     *   parentHandleComputed) 带 DOM 语义），绝不能被组件 frame 的 forEach(x => x.destroy())
     *   以无参形式误销毁；
     * - 父 effect 收集：Host 的生命周期与创建它的 effect 无关（列表行由 splice 显式销毁），
     *   不能挂在父 effect 的 children 里被 destroyChildren 提前 deactivate。
     */
    detachFromCreationContext() {
        const frames = ManualCleanup.collectFrames as unknown as object[][]
        if (frames.length) {
            const frame = frames[frames.length - 1]
            if (frame[frame.length - 1] === this) frame.pop()
        }
        const parent = this.parent
        if (parent) {
            const children = (parent as any)._children as ReactiveEffect[] | undefined
            if (children?.length) {
                const last = children.pop()!
                if (last !== this) {
                    children[this.index] = last
                    last.index = this.index
                }
            }
            this.parent = undefined
            this.index = 0
        }
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
