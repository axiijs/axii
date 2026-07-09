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

    childHosts: Host[] = []
    // 直接由本 host 创建的 Text 节点（string/number/Text 类型的 item），
    //  子 host 自行处理 DOM 时（离场动画路径）需要单独移除。
    directNodes?: Text[]
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
                    ;(this.directNodes ??= []).push(el)
                    if (index === 0) this.firstChild = el
                } else if ( item instanceof Text) {
                    // Component 或者 Function 返回值可能会是 DocumentFragment，而 DocumentFragment.childNodes 也会使用 StaticArrayHost 处理，
                    //  这个时候的 this.source 就是 childNodes，已经是 DOM.js 处理过的了，所以直接是 Text 节点。
                    frag.appendChild(item)
                    ;(this.directNodes ??= []).push(item)
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
            // 子 host 是在脱离文档的 fragment 里渲染的，插入完成后才执行其中登记的 layoutEffect/ref。
            // 自己仍未连通（整体在更外层 fragment 里）时跳过，避免无效重扫，留给外层 flush。
            if (this.placeholder.isConnected) {
                this.pathContext.root.flushAttachQueue()
            }
            /* v8 ignore next 3 */
        } else {
            throw new Error('should never rerender')
        }
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        // CAUTION 只要有子 host 声明了 forceHandleElement（离场动画等），
        //  就不能整段同步 removeNodesBetween，必须把 DOM 处理委托给各个子 host
        //  （它们各自的 element..placeholder 区间可能要等动画结束才异步移除），
        //  自己只负责直接创建的 Text 节点和 placeholder。
        if (!parentHandle && this.forceHandleElement) {
            this.childHosts!.forEach(host => host.destroy(false))
            this.directNodes?.forEach(node => node.remove())
            this.placeholder.remove()
            return
        }
        if (!parentHandle) {
            removeNodesBetween(this.element, this.placeholder, true, {
                ownerHost: this,
                operation: 'destroy',
            })
        }
        this.childHosts!.forEach(host => host.destroy(true))
    }
}
