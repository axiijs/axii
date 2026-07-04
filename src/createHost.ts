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
import {isAxiiRetainedObjectDiagnosticsEnabled, trackHostCreated, trackHostDestroyed} from "./diagnostics.js";

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
        trackHostDestroyed(this)
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
        trackHostDestroyed(this)
        if (!parentHandle) this.placeholder.remove()
        this.element.remove()
    }
}

const HOST_TYPE_NAMES = [
    'StaticHost',
    'PrimitiveHost',
    'StaticArrayHost',
    'EmptyHost',
    'RxListHost',
    'ReusableHost',
    'ComponentHost',
    'AtomHost',
    'FunctionHost',
]

/**
 * @internal
 */
export function createHost(source: any, placeholder: UnhandledPlaceholder, context: PathContext) {
    assert(placeholder instanceof Comment || placeholder instanceof Text, 'incorrect placeholder type')
    let host:Host
    let typeIndex: number
    // CAUTION 按出现频率排序分支：函数（响应式文本/结构）和元素是最常见的动态 child
    const sourceType = typeof source
    if (sourceType === 'function') {
        // atom 本身也是 function，必须先判断
        if (isAtom(source)) {
            host = new AtomHost(source, placeholder, context)
            typeIndex = 7
        } else {
            host = new FunctionHost(source, placeholder, context)
            typeIndex = 8
        }
    } else if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = new StaticHost(source, placeholder, context)
        typeIndex = 0
    } else if( sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean'){
        host = new PrimitiveHost(source, placeholder, context)
        typeIndex = 1
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, context)
        typeIndex = 2
    } else if (source === undefined || source === null) {
        host = new EmptyHost(context, placeholder)
        typeIndex = 3
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, context)
        typeIndex = 4
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        host = source
        typeIndex = 5
    } else if( sourceType === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, context)
        typeIndex = 6
    } else {
        assert(false, `unknown child type ${source}`)
    }

    if (isAxiiRetainedObjectDiagnosticsEnabled()) {
        trackHostCreated(host!, HOST_TYPE_NAMES[typeIndex!])
    }

    return host!
}