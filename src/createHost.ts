import {insertBefore, UnhandledPlaceholder} from "./DOM";
import {createPathContextWithDebugSource, Host, PathContext} from "./Host";
import {isAtom, RxList} from "data0";
import {ComponentHost, ReusableHost} from "./ComponentHost";
import {AtomHost} from "./AtomHost";
import {FunctionHost} from "./FunctionHost";
import {createStaticHost, SimpleElementHost} from "./StaticHost";
import {StaticArrayHost} from "./StaticArrayHost";
import {assert} from "./util";
import {RxListHost} from "./RxListHost.js";
import {getAxiiSource} from "./diagnostics";
import {
    isAxiiRetainedObjectDiagnosticsEnabled,
    trackRetainedHostCreated,
    trackRetainedHostDestroyed
} from "./retainedDiagnostics";

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
    assert(placeholder instanceof Comment, 'incorrect placeholder type')
    const pathContext = createPathContextWithDebugSource(context, getAxiiSource(source))
    let host:Host
    let diagnosticType: string
    if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = createStaticHost(source, placeholder, pathContext)
        diagnosticType = host instanceof SimpleElementHost ? 'SimpleElementHost' : 'StaticHost'
    } else if( typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean'){
        host = new PrimitiveHost(source, placeholder, pathContext)
        diagnosticType = 'PrimitiveHost'
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, pathContext)
        diagnosticType = 'StaticArrayHost'
    } else if (source === undefined || source === null) {
        host = new EmptyHost(pathContext, placeholder)
        diagnosticType = 'EmptyHost'
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, pathContext)
        diagnosticType = 'RxListHost'
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        source.pathContext = pathContext
        host = source
        diagnosticType = 'ReusableHost'
    } else if( typeof source === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, pathContext)
        diagnosticType = 'ComponentHost'
    } else if (isAtom(source)) {
        host = new AtomHost(source, placeholder, pathContext)
        diagnosticType = 'AtomHost'
    } else if (typeof source === 'function'){
        host  = new FunctionHost(source, placeholder, pathContext)
        diagnosticType = 'FunctionHost'
    } else {
        assert(false, `unknown child type ${source}`)
    }

    if (isAxiiRetainedObjectDiagnosticsEnabled() && !(source instanceof ReusableHost)) {
        trackRetainedHostCreated(host!, diagnosticType!)
        const destroy = host!.destroy
        host!.destroy = (parentHandleElement?: boolean, parentHandleComputed?: boolean) => {
            try {
                return destroy.call(host, parentHandleElement, parentHandleComputed)
            } finally {
                trackRetainedHostDestroyed(host!)
            }
        }
    }

    return host!
}