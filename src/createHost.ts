import {insertBefore, UnhandledPlaceholder} from "./DOM";
import {Host, PathContext} from "./Host";
import {isAtom, RxList} from "data0";
import {ComponentHost, ReusableHost} from "./ComponentHost";
import {AtomHost} from "./AtomHost";
import {FunctionHost} from "./FunctionHost";
import {StaticHost} from "./StaticHost";
import {StaticArrayHost} from "./StaticArrayHost";
import {assert} from "./util";
import {RxListHost} from "./RxListHost.js";

/**
 * @internal
 */
class EmptyHost implements Host{
    element = document.createComment('empty')
    constructor(public pathContext: PathContext, public placeholder: UnhandledPlaceholder,) {
    }
    render() {
        this.placeholder.parentNode?.insertBefore(this.element, this.placeholder)
    }
    destroy(parentHandle?: boolean) {
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }
}
/**
 * @internal
 */
class PrimitiveHost implements Host{
    element = this.placeholder
    constructor(public source: string|number|boolean, public placeholder:Comment, public pathContext: PathContext) {
    }
    render() {
        this.element = document.createTextNode(this.source.toString());
        insertBefore(this.element, this.placeholder)
    }
    destroy(parentHandle?: boolean) {
        if (!parentHandle) this.placeholder.remove()
        this.element.remove()
    }
}

/**
 * @internal
 */
export function createHost(source: any, placeholder: UnhandledPlaceholder, context: PathContext) {
    if (!(placeholder instanceof Comment)) throw new Error('incorrect placeholder type')
    let host:Host
    if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = new StaticHost(source, placeholder, context)
    } else if( typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean'){
        host = new PrimitiveHost(source, placeholder, context)
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, context)
    } else if (source === undefined || source === null) {
        host = new EmptyHost(context, placeholder)
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, context)
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        host = source
    } else if( typeof source === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, context)
    } else if (isAtom(source)) {
        host = new AtomHost(source, placeholder, context)
    } else if (typeof source === 'function'){
        host  = new FunctionHost(source, placeholder, context)
    } else {
        assert(false, `unknown child type ${source}`)
    }

    return host!
}