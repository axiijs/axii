import {atomComputed, computed, Atom, destroyComputed, Notifier} from "data0";
import {Context, Host} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'

// CAUTION 纯粹的动态结构，有变化就重算，未来考虑做 dom diff, 现在不做
type FunctionNode = () => ChildNode|DocumentFragment|string|number|null|boolean

export class FunctionHost implements Host{
    renderComputed: ReturnType<typeof computed>
    fragmentParent = document.createDocumentFragment()
    innerHost?: Atom<Host>
    constructor(public source: FunctionNode, public placeholder:Comment, public context: Context) {
    }
    get parentElement() {
        return this.placeholder.parentElement || this.fragmentParent
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.().element || this.placeholder
    }
    render(): void {

        this.innerHost = atomComputed(() => {
                const node = this.source()
                const newPlaceholder = new Comment('computed node')
                insertBefore(newPlaceholder, this.placeholder)
                return createHost(node, newPlaceholder, this.context)
            }
        )

        let lastRenderedHost: Host|undefined
        this.renderComputed = computed(() => {
            // CAUTION 每次都清空上一次的结果
            if(lastRenderedHost) {
                lastRenderedHost.destroy(false, false)
            }

            lastRenderedHost = this.innerHost!()!
            Notifier.instance.pauseTracking()
            lastRenderedHost.render()
            Notifier.instance.resetTracking()
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        const innerHost = this.innerHost!()!
        if (!parentHandleComputed) {
            destroyComputed(this.renderComputed)
            destroyComputed(this.innerHost!)
        }
        innerHost?.destroy(parentHandle, !parentHandleComputed)
        if (!parentHandle) {
            this.placeholder.remove()
        }
    }
}