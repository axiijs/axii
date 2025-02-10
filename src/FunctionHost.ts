import {autorun, Notifier} from "data0";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'
import {createLinkedNode} from "./LinkedList";

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
    constructor(public source: FunctionNode, public placeholder:Comment, public pathContext: PathContext) {
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.element || this.placeholder
    }
    render(): void {


        let scheduleRecompute = false

        this.stopAutoRender = autorun(({ onCleanup, pauseCollectChild, resumeCollectChild }) => {
            // CAUTION 每次都清空上一次的结果
            const node = this.source({onCleanup})
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
                recompute()
                scheduleRecompute = false
            })
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.stopAutoRender()
        }
        // 这里不需要处理 innerHost 是因为在 stopAutoRender 的时候就会触发 innerHost 的 destroy
        if (!parentHandle) {
            this.placeholder.remove()
        }
    }
}