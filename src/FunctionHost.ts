import {autorun, Notifier} from "data0";
import {createChildPathContext, Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {insertBefore} from './DOM'
import {withReactiveTrace} from "./diagnostics";

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
    textNode: Text|null = null
    constructor(public source: FunctionNode, public placeholder:Comment, public pathContext: PathContext) {
    }
    get element() : HTMLElement|Comment|Text|SVGElement{
        return this.innerHost?.element || this.textNode || this.placeholder
    }
    render(): void {


        let scheduleRecompute = false

        this.stopAutoRender = autorun(({ onCleanup, pauseCollectChild, resumeCollectChild }) => {
            withReactiveTrace({
                type: 'function-node',
                operation: 'render',
                hostType: 'FunctionHost',
                elementPath: this.pathContext.elementPath,
                source: this.pathContext.debugSource,
            }, () => {
                let cleanup: (() => any) | undefined
                const node = this.source({onCleanup: (fn) => cleanup = fn})
                this.renderNode(node, pauseCollectChild, resumeCollectChild)
                onCleanup(() => cleanup?.())
            })
        }, (recompute) => {
            if (scheduleRecompute) return
            scheduleRecompute = true
            queueMicrotask(() => {
                withReactiveTrace({
                    type: 'function-node-recompute',
                    operation: 'recompute',
                    hostType: 'FunctionHost',
                    elementPath: this.pathContext.elementPath,
                    source: this.pathContext.debugSource,
                }, recompute)
                scheduleRecompute = false
            })
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.stopAutoRender()
            this.cleanupRendered()
        }
        if (!parentHandle) {
            this.placeholder.remove()
        }
    }

    private renderNode(node: ReturnType<FunctionNode>, pauseCollectChild: () => void, resumeCollectChild: () => void) {
        if (node === null || node === undefined) {
            this.cleanupRendered()
            return
        }

        if (isPrimitiveText(node)) {
            const text = node.toString()
            if (this.textNode) {
                this.textNode.data = text
            } else {
                this.cleanupRendered()
                this.textNode = document.createTextNode(text)
                insertBefore(this.textNode, this.placeholder)
            }
            return
        }

        this.cleanupRendered()

        const newPlaceholder = document.createComment('computed node')
        insertBefore(newPlaceholder, this.placeholder)
        const host = createHost(node, newPlaceholder, createChildPathContext(this.pathContext, this))
        Notifier.instance.pauseTracking()
        pauseCollectChild()
        host.render()
        resumeCollectChild()
        Notifier.instance.resetTracking()
        this.innerHost = host
    }

    private cleanupRendered() {
        if (this.innerHost) {
            this.innerHost.destroy(false, false)
            this.innerHost = null
        }

        if (this.textNode) {
            this.textNode.remove()
            this.textNode = null
        }
    }
}

function isPrimitiveText(node: ReturnType<FunctionNode>): node is string | number | boolean {
    return typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean'
}
