import {Atom, autorun, Notifier} from "data0";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'

// CAUTION 纯粹的动态结构，有变化就重算，未来考虑做 dom diff, 现在不做
type FunctionNode = () => ChildNode|DocumentFragment|string|number|null|boolean

export class FunctionHost implements Host{
    stopAutoRender!: () => any
    fragmentParent = document.createDocumentFragment()
    innerHost?: Atom<Host>
    constructor(public source: FunctionNode, public placeholder:Comment, public pathContext: PathContext) {
    }
    get parentElement() {
        return this.placeholder.parentElement || this.fragmentParent
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.().element || this.placeholder
    }
    render(): void {


        let scheduleRecompute = false

        this.stopAutoRender = autorun(({ onCleanup }) => {
            // CAUTION 每次都清空上一次的结果
            const node = this.source()
            const newPlaceholder = document.createComment('computed node')
            insertBefore(newPlaceholder, this.placeholder)
            const host = createHost(node, newPlaceholder, {...this.pathContext, hostPath: [...this.pathContext.hostPath, this]})
            Notifier.instance.pauseTracking()
            host.render()
            Notifier.instance.resetTracking()
            onCleanup(() => {
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
        if (!parentHandle) {
            this.placeholder.remove()
        }
    }
}