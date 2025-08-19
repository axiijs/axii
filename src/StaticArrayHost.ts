import { insertBefore} from "./DOM";
import {PathContext, Host} from "./Host";
import {createHost} from "./createHost";
import {removeNodesBetween} from "./util";
import {createLinkedNode} from "./LinkedList";


/**
 * @internal
 */
export class StaticArrayHost implements Host{
    computed = undefined

    childHosts: Host[] = []
    parentElement: HTMLElement|Comment|Text|SVGElement|null
    constructor(public source: any[], public placeholder: Comment, public pathContext: PathContext) {
        this.parentElement = placeholder.parentElement
    }
    // get parentElement() {
    //     return this.placeholder.parentElement
    // }

    firstChild?: HTMLElement|Comment|Text|SVGElement|Host
    get element(): HTMLElement|Comment|Text|SVGElement {
        return (this.firstChild as Host)?.element || (this.firstChild as HTMLElement|Comment|Text|SVGElement) || this.placeholder
    }
    render(): void {
        if (this.element === this.placeholder) {
            const frag = document.createDocumentFragment()

            this.source.forEach((item, index) => {
                if (typeof item === 'string' || typeof item === 'number') {
                    const el = document.createTextNode(item.toString())
                    frag.appendChild(el)
                    if (index === 0) this.firstChild = el
                } else if ( item instanceof Text) {
                    // Component 或者 Function 返回值可能会是 DocumentFragment，而 DocumentFragment.childNodes 也会使用 StaticArrayHost 处理，
                    //  这个时候的 this.source 就是 childNodes，已经是 DOM.js 处理过的了，所以直接是 Text 节点。
                    frag.appendChild(item)
                    if (index === 0) this.firstChild = item
                } else {
                    // 其他未知节点了
                    const newPlaceholder: Comment = document.createComment('array item')
                    frag.appendChild(newPlaceholder)
                    const newHost = createHost(item, newPlaceholder, {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
                    this.childHosts.push(newHost)
                    if (index === 0) this.firstChild = newHost
                }
            })
            this.childHosts.forEach(host => host.render())
            insertBefore(frag, this.placeholder)
            /* v8 ignore next 3 */
        } else {
            throw new Error('should never rerender')
        }
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandle) {
            removeNodesBetween(this.element, this.placeholder, true)
        }
        this.childHosts!.forEach(host => host.destroy(true, parentHandleComputed))
    }
}
