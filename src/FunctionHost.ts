import {computed, destroyComputed} from "data0";
import {Context, Host} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'

// CAUTION 纯粹的动态结构，有变化就重算，未来考虑做 dom diff, 现在不做
type FunctionNode = () => ChildNode|DocumentFragment|string|number|null|boolean

export class FunctionHost implements Host{
    computed: ReturnType<typeof computed>
    fragmentParent = document.createDocumentFragment()
    innerHost?: Host
    constructor(public source: FunctionNode, public placeholder:Comment, public context: Context) {
    }
    get parentElement() {
        return this.placeholder.parentElement || this.fragmentParent
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.element || this.placeholder
    }
    render(): void {
        this.computed = computed(() => {
                // CAUTION 每次都清空上一次的结果
                this.innerHost?.destroy()

                const node = this.source()

                const newPlaceholder = new Comment('computed node')
                insertBefore(newPlaceholder, this.placeholder)
                this.innerHost = createHost(node, newPlaceholder, this.context)
                this.innerHost.render()
            }
        )
    }
    destroy(parentHandle?: boolean) {
        destroyComputed(this.computed)
        this.innerHost!.destroy(parentHandle)
        if (!parentHandle) this.placeholder.remove()
    }
}