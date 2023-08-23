import {insertBefore, UnhandledPlaceholder} from "./DOM";
import {Context, Host} from "./Host";
import { isAtom, isReactive} from "rata";
import {ReactiveArrayHost} from "./ReactiveArrayHost";
import {ComponentHost} from "./ComponentHost";
import {AtomHost} from "./AtomHost";
import {FunctionHost} from "./FunctionHost";
import {StaticHost} from "./StaticHost";
import {StaticArrayHost} from "./StaticArrayHost";
import {assert} from "./util";

class EmptyHost implements Host{
    element = new Comment('empty')
    placeholder = this.element
    context = {}
    render() { return }
    destroy(parentHandle?: boolean) {
        if (!parentHandle) this.placeholder.remove()
    }
}

class PrimitiveHost implements Host{
    element = this.placeholder
    constructor(public source: string|number|boolean, public placeholder:Comment, public context: Context) {
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


export function createHost(source: any, placeholder: UnhandledPlaceholder, context: Context) {
    if (!(placeholder instanceof Comment)) throw new Error('incorrect placeholder type')
    let host:Host
    if ( Array.isArray(source)  ) {
        if(isReactive(source) ) {
            host = new ReactiveArrayHost(source, placeholder, context)
        } else {
            host = new StaticArrayHost(source, placeholder, context)
        }

    } else if( typeof source === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, context)
    } else if (isAtom(source)) {
        host = new AtomHost(source, placeholder, context)
    } else if (typeof source === 'function'){
        host  = new FunctionHost(source, placeholder, context)
    } else if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = new StaticHost(source, placeholder, context)
    } else if (source === undefined || source === null) {
        host = new EmptyHost()
    }else if( typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean'){
        host = new PrimitiveHost(source, placeholder, context)
    } else {
        assert(false, `unknown child type ${source}`)
    }

    return host!
}