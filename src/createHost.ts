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
import {getAxiiSource} from "./diagnostics";

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
    // 节点自带的 JSX source 优先，否则沿用（继承自最近父级的）context.debugSource。
    // CAUTION 只有 source 真的更具体时才克隆 context，createHost 是高频路径，生产环境（无 __axiiSource）零额外分配。
    const ownSource = getAxiiSource(source)
    const pathContext = ownSource && ownSource !== context.debugSource ?
        {...context, debugSource: ownSource} :
        context
    let host:Host
    if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = new StaticHost(source, placeholder, pathContext)
    } else if( typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean'){
        host = new PrimitiveHost(source, placeholder, pathContext)
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, pathContext)
    } else if (source === undefined || source === null) {
        host = new EmptyHost(pathContext, placeholder)
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, pathContext)
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        // 复用的 Host 被移动到了新位置，错误归因要落在新位置的上下文上
        source.pathContext = pathContext
        host = source
    } else if( typeof source === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, pathContext)
    } else if (isAtom(source)) {
        host = new AtomHost(source, placeholder, pathContext)
    } else if (typeof source === 'function'){
        host  = new FunctionHost(source, placeholder, pathContext)
    } else {
        assert(false, `unknown child type ${source}`)
    }

    return host!
}