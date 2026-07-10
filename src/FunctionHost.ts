import {Notifier, ReactiveEffect} from "data0";
import {Host, PathContext} from "./Host";
import {createHost, HostPosition} from "./createHost";
import {insertBefore, resetOptionOwnerSelect} from './DOM'
import {createLinkedNode} from "./LinkedList";
import {trackHostDestroyed, trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {DeferredBindingEffect} from "./LightBindingEffect.js";
import {isAxiiDiagnosticsEnabled, withReactiveTrace} from "./diagnostics";

type FunctionNodeContext = {
    onCleanup: (cleanup:()=> any) => void
}
// CAUTION 动态结构节点。返回原始值（string/number/boolean/null）时走文本快速路径，原地更新
//  Text 节点；返回结构节点时整体重建（未来考虑做 dom diff）。
type FunctionNode = (context:FunctionNodeContext) => ChildNode|DocumentFragment|string|number|null|boolean
/**
 * @internal
 *
 * CAUTION FunctionHost 自己就是绑定 effect（继承 DeferredBindingEffect），不再为每个函数
 *  节点单独分配一个 effect 对象 + update 闭包；同时自己实现 onCleanup，直接把自己作为
 *  source 的 context 传入，省掉每实例的 context 对象 + 闭包。
 *  长列表里每行的函数文本绑定都会经过这里，合并后每行少两个对象和两个闭包的常驻内存。
 */
export class FunctionHost extends DeferredBindingEffect implements Host{
    innerHost: Host|null = null
    // 文本快速路径：函数返回原始值时直接复用一个 Text 节点
    textNode: Text|null = null
    cleanups?: (() => any)[]
    sourceContext?: FunctionNodeContext
    // 「跳过 pathContext 克隆」时的轻量位置信息（见 createHost/collectInnerHost）：
    //  文本快速路径（绝大多数函数节点）从不消费 hostPath，函数返回结构内容时才用它
    //  惰性物化完整的子 context（见 childPathContext）。declare：不走该路径的实例不付槽位
    declare position?: HostPosition
    constructor(public source: FunctionNode, public placeholder:Comment|Text, public pathContext: PathContext, position?: HostPosition) {
        super()
        if (position) this.position = position
        // Host 的生命周期由宿主树显式管理，不能被创建时的 collect frame/父 effect 接管
        this.detachFromCreationContext()
    }
    // 结构路径的子 context：与旧实现（父元素 host 为每个 child 克隆 context）逐字段等价，
    //  hostPath 链为 [...父链, 宿主元素 host, this]
    childPathContext(): PathContext {
        const base = this.pathContext
        const parentChain = this.position ? createLinkedNode<Host>(this.position.owner, base.hostPath) : base.hostPath
        const context: PathContext = {...base, hostPath: createLinkedNode<Host>(this, parentChain)}
        if (this.position) {
            context.elementPath = this.position.elementPath
            if (this.position.debugSource) context.debugSource = this.position.debugSource
        }
        return context
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.textNode || this.innerHost?.element || this.placeholder
    }
    // 透传内层的 forceHandleElement（离场动画等），同 ComponentHost
    get forceHandleElement(): boolean {
        return !!this.innerHost?.forceHandleElement
    }
    runCleanups() {
        const cleanups = this.cleanups
        if (cleanups?.length) {
            this.cleanups = undefined
            // CAUTION 与 ComponentHost cleanup 的错误语义一致：注册了 root error
            // 钩子时，一个 cleanup 抛错不能中断兄弟 cleanup、函数节点重算或整棵
            // root 的销毁。未注册钩子时仍保持向上抛出的旧行为。
            for (const cleanup of cleanups) {
                try {
                    cleanup()
                } catch (error) {
                    if (!this.pathContext.root.dispatch('error', error)) throw error
                }
            }
        }
    }
    render(): void {
        // CAUTION 绝大多数函数节点是 () => atom() 这类零参函数，不会用到 context，
        //  只有 source 声明了参数（含解构 ({onCleanup})，length 为 1）才分配 context 对象 + 闭包。
        //  onCleanup 必须是独立闭包而不是方法引用，用户可能解构后脱离 this 调用。
        if (this.source.length > 0) {
            const host = this
            this.sourceContext = {
                onCleanup(cleanup: () => any) {
                    (host.cleanups ||= []).push(cleanup)
                }
            }
        }
        trackLightBindingCreated(this, 'FunctionNodeBinding')
        this.run()
    }
    // 是否已经完成过一次渲染，诊断 trace 用它区分初次 render 和 recompute
    renderedOnce = false
    // DeferredBindingEffect 触发时的回调（以原型方法提供，替代构造器闭包）
    update() {
        this.renderSource(this)
    }
    renderSource(effect: DeferredBindingEffect) {
        // CAUTION 诊断关闭（生产环境）时不分配 trace frame 对象，函数节点重算是热路径
        if (isAxiiDiagnosticsEnabled()) {
            const elementPath = this.position?.elementPath ?? this.pathContext.elementPath
            const source = this.position?.debugSource ?? this.pathContext.debugSource
            withReactiveTrace(this.renderedOnce ? {
                type: 'function-node-recompute',
                operation: 'recompute',
                hostType: 'FunctionHost',
                elementPath,
                source,
            } : {
                type: 'function-node',
                operation: 'render',
                hostType: 'FunctionHost',
                elementPath,
                source,
            }, () => {
                this.renderSourceWithoutTrace(effect)
            })
        } else {
            this.renderSourceWithoutTrace(effect)
        }
        this.renderedOnce = true
    }
    renderSourceWithoutTrace(effect: DeferredBindingEffect) {
        // CAUTION 每次都清空上一次的结果
        this.runCleanups()
        let node: ReturnType<FunctionNode>|null = null
        try {
            // 零参 source 用不到 context，直接传 undefined，省掉每实例的 context 分配
            node = this.source(this.sourceContext!)
        } catch (e) {
            // 函数节点重算抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并把该区域渲染为空
            // （effect 保持活跃，依赖恢复后该区域可以恢复渲染），否则保持向上抛出的行为。
            if (!this.pathContext.root.dispatch('error', e)) throw e
        }

        const valueType = typeof node
        if (node == null || valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
            // 文本快速路径：不需要 comment 占位和完整的 host 子树，
            //  依赖变化时只更新 Text.nodeValue。
            // CAUTION boolean 渲染为空文本而不是字面 "true"/"false"：
            //  () => cond() && <el/> 是最常见的条件渲染写法，false 不应该出现在页面上。
            const text = (node == null || valueType === 'boolean') ? '' : String(node)
            if (this.textNode) {
                this.textNode.nodeValue = text
                // CAUTION 没有 value attr 的 option 以文本为 value，原地更新文本后
                //  必须触发 select 的 value 恢复（F37），非 option 场景零额外分配。
                resetOptionOwnerSelect(this.placeholder)
                return
            }
            this.destroyInnerHost()
            if (this.placeholder instanceof Text) {
                // 占位符本身就是 Text 节点（创建于 createElement 的函数 child 快速路径），直接复用
                this.placeholder.nodeValue = text
                this.textNode = this.placeholder
            } else {
                this.textNode = document.createTextNode(text)
                // CAUTION 保留 placeholder 在 DOM 中，外层（列表 reorder/anchor 查找等）依赖它。
                //  直接用 parentNode.insertBefore，跳过 DOM.ts insertBefore 的 select/option 区间处理，
                //  option 文本（= 没有 value attr 时的 option value）的恢复由下面的
                //  resetOptionOwnerSelect 统一负责。
                this.placeholder.parentNode!.insertBefore(this.textNode, this.placeholder)
            }
            resetOptionOwnerSelect(this.placeholder)
            return
        }

        // 结构路径：重建子树
        if (this.textNode) {
            if (this.textNode === this.placeholder) {
                // 占位符复用为文本节点的情况：内容清空，节点保留在 DOM 中做锚点
                this.textNode.nodeValue = ''
            } else {
                this.textNode.remove()
            }
            this.textNode = null
        }
        this.destroyInnerHost()
        const newPlaceholder = document.createComment('computed node')
        insertBefore(newPlaceholder, this.placeholder)
        // CAUTION 内部 host 的渲染不应该被当前 effect 追踪依赖/收集子 effect，
        //  否则内层的响应式内容变化会导致整个函数节点重算。
        //  AtomHost/FunctionHost 这类 host 本身就是 effect，对象创建时就可能被父 effect
        //  收集，所以 pauseCollectChild 必须在 createHost 之前。
        Notifier.instance.pauseTracking()
        effect.pauseCollectChild()
        let host: Host | undefined
        try {
            host = createHost(node, newPlaceholder, this.childPathContext())
            host.render()
        } catch (e) {
            // CAUTION 结构重建抛错（unknown child type 断言等）：重算发生在微任务里，
            //  向上抛只会变成 uncaught error。注册了 root error 钩子时报告错误并把该区域
            //  渲染为空（effect 保持活跃，依赖恢复后可以恢复渲染），否则保持向上抛出。
            //  组件/属性等内层错误已由各自的错误钩子消费，这里只兜底真正逃逸的错误。
            if (host) {
                // render 中途抛错：部分渲染的子树交给下一次重建/销毁做尽力清理
                this.innerHost = host
            } else {
                newPlaceholder.remove()
            }
            if (!this.pathContext.root.dispatch('error', e)) throw e
            return
        } finally {
            // CAUTION 无论成败都必须恢复 tracking/collect 状态：
            //  pauseTracking 不恢复的话全局 Notifier 停止追踪，整个应用的响应式全部失效。
            effect.resumeCollectChild()
            Notifier.instance.resetTracking()
        }
        this.innerHost = host
    }
    destroyInnerHost(parentHandle = false) {
        const host = this.innerHost
        if (host) {
            this.innerHost = null
            // CAUTION 内层 host 的 effect 是在 pauseCollectChild 下创建的（没有父 effect），必须显式销毁
            host.destroy(parentHandle)
        }
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        trackLightBindingDestroyed(this)
        // CAUTION 用静态 destroy 而不是 super.destroy()：Host.destroy 的第一个参数
        //  （parentHandle）与 ReactiveEffect.destroy 的 ignoreChildren 语义不同，不能透传
        ReactiveEffect.destroy(this)
        this.runCleanups()
        this.destroyInnerHost(parentHandle)
        if (!parentHandle) {
            if (this.textNode && this.textNode !== this.placeholder) {
                this.textNode.remove()
            }
            this.textNode = null
            this.placeholder.remove()
        }
    }
}
