import {autorun, Notifier} from "data0";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'
import {createLinkedNode} from "./LinkedList";
import {trackHostDestroyed} from "./diagnostics.js";

type FunctionNodeContext = {
    onCleanup: (cleanup:()=> any) => void
}
// CAUTION 纯粹的动态结构，有变化就重算，未来考虑做 dom diff, 现在不做
type FunctionNode = (context:FunctionNodeContext) => ChildNode|DocumentFragment|string|number|null|boolean
/**
 * @internal
 */
export class FunctionHost implements Host{
    stopAutoRender!: () => any
    fragmentParent = document.createDocumentFragment()
    innerHost: Host|null = null
    destroyed = false
    constructor(public source: FunctionNode, public placeholder:Comment, public pathContext: PathContext) {
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.element || this.placeholder
    }
    // 透传内层的 forceHandleElement（离场动画等），同 ComponentHost
    get forceHandleElement(): boolean {
        return !!this.innerHost?.forceHandleElement
    }
    render(): void {


        let scheduleRecompute = false

        this.stopAutoRender = autorun(({ onCleanup, pauseCollectChild, resumeCollectChild }) => {
            // CAUTION 每次都清空上一次的结果
            let node: ReturnType<FunctionNode>|null = null
            try {
                node = this.source({onCleanup})
            } catch (e) {
                // 函数节点重算抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并把该区域渲染为空
                // （autorun 保持活跃，依赖恢复后该区域可以恢复渲染），否则保持向上抛出的行为。
                if (!this.pathContext.root.dispatch('error', e)) throw e
            }
            const newPlaceholder = document.createComment('computed node')
            insertBefore(newPlaceholder, this.placeholder)
            const host = createHost(node, newPlaceholder, {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
            Notifier.instance.pauseTracking()
            pauseCollectChild()
            host.render()
            resumeCollectChild()
            Notifier.instance.resetTracking()
            this.innerHost = host
            onCleanup(() => {
                this.innerHost = null
                host.destroy(false, false)
            })
        }, (recompute) => {
            if (scheduleRecompute) return
            scheduleRecompute = true
            queueMicrotask(() => {
                // CAUTION 微任务入队后 host 可能已经被 destroy，
                //  不要依赖 data0 对已 stop 的 autorun 的容错，这里显式检查销毁标志。
                if (!this.destroyed) {
                    recompute()
                }
                scheduleRecompute = false
            })
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        trackHostDestroyed(this)
        this.destroyed = true
        if (!parentHandleComputed) {
            this.stopAutoRender()
        }
        // 这里不需要处理 innerHost 是因为在 stopAutoRender 的时候就会触发 innerHost 的 destroy
        if (!parentHandle) {
            this.placeholder.remove()
        }
    }
}