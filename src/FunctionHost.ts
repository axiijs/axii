import {Notifier, ReactiveEffect} from "data0";
import {Host, PathContext} from "./Host";
import {createHost, HostPosition} from "./createHost";
import {insertBefore, resetOptionOwnerSelect} from './DOM'
import {createLinkedNode} from "./LinkedList";
import {trackHostDestroyed, trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {DeferredBindingEffect} from "./LightBindingEffect.js";
import {isAxiiDiagnosticsEnabled, withReactiveTrace} from "./diagnostics";
import {claimComputedNodeBefore, claimTextBeforeCommentPlaceholder, isHydrating} from "./hydration";

type FunctionNodeContext = {
    onCleanup: (cleanup:()=> any) => void
}
// CAUTION 动态结构节点。返回原始值（string/number/boolean/null）时走文本快速路径，原地更新
//  Text 节点；返回结构节点时整体重建（未来考虑做 dom diff）。
type FunctionNode = (context:FunctionNodeContext) => ChildNode|DocumentFragment|string|number|bigint|null|boolean
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
    // undefined 表示存活，否则是 destroy 收到的 parentHandle（见 renderSourceWithoutTrace 的重入说明）。
    //  declare：存活的节点不付槽位
    declare destroyedWith?: boolean
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
    // CAUTION 旧内容的销毁（onCleanup、innerHost 里的 effect 清理/ref(null)/detachStyle 求值等）
    //  会执行用户代码，而重算时本 effect 已在作用域栈顶。不隔离的话销毁里的 atom 读取会成为
    //  函数节点的依赖：之后写那个 atom 就重建整个新内容，新内容挂载时正好写它就是无限重挂。
    //  销毁里创建的 effect 也不属于本节点，被收集为子 effect 会在下一次重算时被误销毁。
    //  与 createHost/render 的隔离对称；放在这两个方法里，重算与 destroy 的所有入口都覆盖到。
    // CAUTION 子 effect 收集用「保存原值、还原」，不能用 resumeCollectChild()（无条件置 true）：
    //  本节点可能在收集已暂停的区间里被重入销毁——新内容渲染中途、或 error 监听器的
    //  createDetached 区间里，监听器调用 root.destroy()。那时置回 true，监听器随后创建的
    //  effect（渲染到另一个 root 的错误提示等）会被本节点收集，随它的延迟销毁一起销毁。
    runCleanups() {
        const cleanups = this.cleanups
        if (cleanups?.length) {
            this.cleanups = undefined
            const collectChild = this.shouldCollectChild
            Notifier.instance.pauseTracking()
            this.pauseCollectChild()
            try {
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
            } finally {
                this.shouldCollectChild = collectChild
                Notifier.instance.resetTracking()
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
        // CAUTION 与 AtomHost/ReactiveAttributeEffect 的 update 对齐错误钩子语义（I58）：
        //  renderSource 内部已对 source()/结构重建的错误做了钩子处理，但文本快速路径与
        //  结构路径的 DOM 锚点操作（placeholder 被外部清空后 text->结构 切换的 insertBefore）
        //  会直接抛原生 TypeError——重算发生在微任务里，不接钩子就是 uncaught error，
        //  FunctionHost 是唯一分叉的绑定更新路径。注册了钩子时报告并跳过本次重算
        //  （effect 保持活跃），未注册时保持向上抛出。内部已消费的错误不会再到达这里。
        try {
            this.renderSource(this)
        } catch (e) {
            if (!this.pathContext.root.dispatch('error', e)) throw e
        }
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
        if (this.cleanups !== undefined) {
            this.runCleanups()
            // 重入销毁之零：上一次登记的清理函数同步销毁了本节点（「这块内容消失就关掉弹层」）。
            //  不能再调用 source：它是为一个已经不存在的节点求值。只在有清理函数时检查。
            if (this.destroyedWith !== undefined) return
        }
        let node: ReturnType<FunctionNode>|null = null
        try {
            // 零参 source 用不到 context，直接传 undefined，省掉每实例的 context 分配
            node = this.source(this.sourceContext!)
        } catch (e) {
            // 函数节点重算抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并把该区域渲染为空
            // （effect 保持活跃，依赖恢复后该区域可以恢复渲染），否则保持向上抛出的行为。
            if (this.destroyedWith === undefined && !this.pathContext.root.dispatch('error', e)) throw e
        }
        // CAUTION 重入销毁之一：source 自己（或它调用的回调）同步销毁了本节点（关掉所在的弹层、
        //  root.destroy()、删掉所在的列表行）。占位符可能已经被摘掉，没有地方可渲染：
        //  继续往下走，文本路径会对已脱离的占位符 insertBefore（TypeError），结构路径会渲染出
        //  一棵没有人销毁的子树。destroy 之后才登记的 onCleanup 在这里补跑。
        if (this.destroyedWith !== undefined) {
            this.runCleanups()
            return
        }

        const valueType = typeof node
        if (node == null || valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
            // 文本快速路径：不需要 comment 占位和完整的 host 子树，
            //  依赖变化时只更新 Text.nodeValue。
            // CAUTION boolean 渲染为空文本而不是字面 "true"/"false"：
            //  () => cond() && <el/> 是最常见的条件渲染写法，false 不应该出现在页面上。
            // CAUTION bigint 与 string/number 同为文本形态（I61），String(10n) === '10'。
            const text = (node == null || valueType === 'boolean') ? '' : String(node)
            if (this.textNode) {
                this.textNode.nodeValue = text
                // CAUTION 没有 value attr 的 option 以文本为 value，原地更新文本后
                //  必须触发 select 的 value 恢复（F37），非 option 场景零额外分配。
                resetOptionOwnerSelect(this.placeholder)
                return
            }
            this.destroyInnerHost()
            // 重入销毁之一（续）：旧内容的清理函数同步销毁了本节点。占位符可能已被摘掉，
            //  下面的 insertBefore 会 TypeError（见 destroyInnerHost 之后结构路径的同一检查）。
            if (this.destroyedWith !== undefined) return
            if (this.placeholder instanceof Text) {
                // 占位符本身就是 Text 节点（创建于 createElement 的函数 child 快速路径），直接复用
                this.placeholder.nodeValue = text
                this.textNode = this.placeholder
            } else if (isHydrating()) {
                // Comment-ph（G4-F / H3）：认领 placeholder 前 Text（含 axii:t），或插入空 Text
                // §3.7 / D12: pass expected so drift reports + rebuilds (aligned with Text-ph)
                this.textNode = claimTextBeforeCommentPlaceholder(this.placeholder as Comment, text)
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
        // 旧内容（innerHost）的清理函数同步销毁了本节点：占位符可能已被摘掉，不能再在它前面
        //  建新内容（insertBefore 会 TypeError；就算没被摘掉，新内容也没有人销毁）。
        if (this.destroyedWith !== undefined) return
        // Hydrate FTS/FCS：认领已有 <!--computed node-->，禁止新建（§3.2.4 FS2 / §3.2.5）
        const hydrating = isHydrating()
        const newPlaceholder = hydrating
            ? claimComputedNodeBefore(this.placeholder)
            : document.createComment('computed node')
        if (!hydrating) {
            insertBefore(newPlaceholder, this.placeholder)
        }
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
            } else if (!hydrating) {
                newPlaceholder.remove()
            }
            // 本节点在新内容渲染到一半时已被销毁：这棵子树马上丢弃，root 的监听器也已清空，
            //  它的错误没有归属（与组件销毁后 async effect 的 rejection 不再上报同一语义）。
            if (this.destroyedWith !== undefined) {
                this.destroyInnerHost(this.destroyedWith)
                return
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
        // CAUTION 重入销毁之二：新内容渲染到一半时本节点被同步销毁（内容里的组件在 effect 里删掉了
        //  自己所在的列表行 / 关掉了所在的 root，或 error 监听器调用了 root.destroy()）。
        //  那一刻 innerHost 还没有赋值（新 host 只在局部变量里），destroy 够不到新内容；
        //  渲染栈退出后如果不在这里补销毁，这棵子树的清理函数永不执行、绑定一直订阅。
        //  此时子树已经完整，按本节点被销毁时的方式（parentHandle）销毁恰好一次。
        if (this.destroyedWith !== undefined) this.destroyInnerHost(this.destroyedWith)
    }
    destroyInnerHost(parentHandle = false) {
        const host = this.innerHost
        if (host) {
            this.innerHost = null
            // 隔离追踪与子 effect 收集，见 runCleanups
            const collectChild = this.shouldCollectChild
            Notifier.instance.pauseTracking()
            this.pauseCollectChild()
            try {
                // CAUTION 内层 host 的 effect 是在 pauseCollectChild 下创建的（没有父 effect），必须显式销毁
                host.destroy(parentHandle)
            } finally {
                this.shouldCollectChild = collectChild
                Notifier.instance.resetTracking()
            }
        }
    }
    destroy(parentHandle?: boolean) {
        this.destroyedWith = !!parentHandle
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
