import { insertBefore} from "./DOM";
import {PathContext, Host} from "./Host";
import {createHost} from "./createHost";
import {removeNodesBetween} from "./util";
import {createLinkedNode} from "./LinkedList";
import {trackHostDestroyed} from "./retainedObjectDiagnostics.js";


/**
 * @internal
 */
export class StaticArrayHost implements Host{
    computed = undefined

    childHosts: Host[] = []
    constructor(public source: any[], public placeholder: Comment, public pathContext: PathContext) {
    }

    firstChild?: HTMLElement|Comment|Text|SVGElement|Host
    get element(): HTMLElement|Comment|Text|SVGElement {
        return (this.firstChild as Host)?.element || (this.firstChild as HTMLElement|Comment|Text|SVGElement) || this.placeholder
    }
    // 透传内层的 forceHandleElement（离场动画等），同 ComponentHost
    get forceHandleElement(): boolean {
        return this.childHosts.some(host => host.forceHandleElement)
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
        trackHostDestroyed(this)
        if (!parentHandle) {
            removeNodesBetween(this.element, this.placeholder, true, {
                ownerHost: this,
                operation: 'destroy',
            })
        }
        this.childHosts!.forEach(host => host.destroy(true, parentHandleComputed))
    }
}
