import {Notifier} from "data0";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'
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
 */
export class FunctionHost implements Host{
    effect?: DeferredBindingEffect
    innerHost: Host|null = null
    // 文本快速路径：函数返回原始值时直接复用一个 Text 节点
    textNode: Text|null = null
    cleanups?: (() => any)[]
    sourceContext?: FunctionNodeContext
    destroyed = false
    constructor(public source: FunctionNode, public placeholder:Comment|Text, public pathContext: PathContext) {
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
            for (const cleanup of cleanups) cleanup()
        }
    }
    render(): void {
        const host = this
        // context 对象整个 host 生命周期只创建一次，避免每次重算都分配
        this.sourceContext = {
            onCleanup(cleanup: () => any) {
                (host.cleanups ||= []).push(cleanup)
            }
        }
        this.effect = new DeferredBindingEffect((effect) => this.renderSource(effect as DeferredBindingEffect))
        trackLightBindingCreated(this.effect, 'FunctionNodeBinding')
        this.effect.run()
    }
    // 是否已经完成过一次渲染，诊断 trace 用它区分初次 render 和 recompute
    renderedOnce = false
    renderSource(effect: DeferredBindingEffect) {
        // CAUTION 诊断关闭（生产环境）时不分配 trace frame 对象，函数节点重算是热路径
        if (isAxiiDiagnosticsEnabled()) {
            withReactiveTrace(this.renderedOnce ? {
                type: 'function-node-recompute',
                operation: 'recompute',
                hostType: 'FunctionHost',
                elementPath: this.pathContext.elementPath,
                source: this.pathContext.debugSource,
            } : {
                type: 'function-node',
                operation: 'render',
                hostType: 'FunctionHost',
                elementPath: this.pathContext.elementPath,
                source: this.pathContext.debugSource,
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
            const text = node == null ? '' : String(node)
            if (this.textNode) {
                this.textNode.nodeValue = text
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
                //  直接用 parentNode.insertBefore，跳过 DOM.ts insertBefore 的 select/option 处理
                //  （文本节点不影响 select 的 value）。
                this.placeholder.parentNode!.insertBefore(this.textNode, this.placeholder)
            }
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
        const host = createHost(node, newPlaceholder, {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
        // 内部 host 的渲染不应该被当前 effect 追踪依赖/收集子 effect，
        //  否则内层的响应式内容变化会导致整个函数节点重算。
        Notifier.instance.pauseTracking()
        effect.pauseCollectChild()
        host.render()
        effect.resumeCollectChild()
        Notifier.instance.resetTracking()
        this.innerHost = host
    }
    destroyInnerHost(parentHandle = false) {
        const host = this.innerHost
        if (host) {
            this.innerHost = null
            // CAUTION 内层 host 的 effect 是在 pauseCollectChild 下创建的（没有父 effect），
            //  必须显式销毁，所以 parentHandleComputed 恒为 false。
            host.destroy(parentHandle, false)
        }
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        trackHostDestroyed(this)
        if (this.effect) trackLightBindingDestroyed(this.effect)
        this.destroyed = true
        if (!parentHandleComputed) {
            this.effect?.destroy()
        }
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
