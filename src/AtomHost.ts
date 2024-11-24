import {Atom, computed, destroyComputed} from "data0";
import {Host, PathContext} from "./Host";


function stringValue(v: any) {
    return (v as string)?.toString ?
        (v as string).toString() :
        (v === undefined ? 'undefined' : JSON.stringify(v))
}
/**
 * @internal
 */
export class AtomHost implements Host{
    stopAutoRun: () => void = () => {}
    computed: Atom<any>
    element: Text|Comment = this.placeholder
    constructor(public source: Atom, public placeholder:Comment, public pathContext: PathContext) {
    }
    get parentElement() {
        // CAUTION 这里必须用 parentNode，因为可能是在数组下，这个父节点是 staticArrayHost 创建的 frag
        return this.placeholder.parentNode || this.element.parentElement
    }

    replace(value: any) {
        if (this.element === this.placeholder) {
            const textNode = document.createTextNode(stringValue(value))
            this.parentElement!.replaceChild(textNode, this.placeholder)
            this.element = textNode
        } else {
            this.element.nodeValue = stringValue(value)
        }
    }

    render(): void {
        this.computed = computed(() => {
                this.replace(this.source())
            },
            undefined,
            true,
            undefined,
            // CAUTION 是给富文本编辑器 contenteditable 来跳过 dom 变换的，
            this.pathContext.skipIndicator
        )

    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            destroyComputed(this.computed)
        }
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }

}