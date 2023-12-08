import {computed, destroyComputed, Atom} from "data0";
import {Context, Host} from "./Host";

export class AtomHost implements Host{
    computed: ReturnType<typeof computed>
    element: Text|Comment = this.placeholder
    constructor(public source: Atom, public placeholder:Comment, public context: Context) {
    }
    get parentElement() {
        // CAUTION 这里必须用 parentNode，因为可能是在数组下，这个父节点是 staticArrayHost 创建的 frag
        return this.placeholder.parentNode || this.element.parentElement
    }

    replace(value: any) {
        if (this.element === this.placeholder) {
            const textNode = new Text((value as string)?.toString ? (value as string).toString() : JSON.stringify(value))
            this.parentElement!.replaceChild(textNode, this.placeholder)
            this.element = textNode
        } else {
            this.element.nodeValue = (value as string).toString()
        }
    }

    render(): void {
        this.computed = computed(() => {
                this.replace(this.source())
            },
            undefined,
            undefined,
            undefined,
            this.context.skipIndicator
        )
    }
    destroy(parentHandle?: boolean) {
        destroyComputed(this.computed)
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }

}