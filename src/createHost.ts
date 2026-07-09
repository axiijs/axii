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
import {isAxiiRetainedObjectDiagnosticsEnabled, trackHostCreated, trackHostDestroyed} from "./retainedObjectDiagnostics.js";
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
    constructor(public source: string|number|boolean, public placeholder:Comment|Text, public pathContext: PathContext) {
    }
    render() {
        // CAUTION boolean 渲染为空文本：{cond && <el/>} 的 falsy 结果不应该出现字面 "false"，
        //  与 FunctionHost/AtomHost 的语义一致。
        const text = typeof this.source === 'boolean' ? '' : this.source.toString()
        this.element = document.createTextNode(text);
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
    // 节点自带的 JSX source 优先，否则沿用（继承自最近父级的）context.debugSource。
    // CAUTION 只有 source 真的更具体时才克隆 context，createHost 是高频路径，生产环境（无 __axiiSource）零额外分配。
    const ownSource = getAxiiSource(source)
    const pathContext = ownSource && ownSource !== context.debugSource ?
        {...context, debugSource: ownSource} :
        context
    let host:Host
    let typeIndex: number
    // CAUTION 按出现频率排序分支：函数（响应式文本/结构）和元素是最常见的动态 child
    const sourceType = typeof source
    if (sourceType === 'function') {
        // atom 本身也是 function，必须先判断
        if (isAtom(source)) {
            host = new AtomHost(source, placeholder, pathContext)
            typeIndex = 7
        } else {
            host = new FunctionHost(source, placeholder, pathContext)
            typeIndex = 8
        }
    } else if( source instanceof HTMLElement || source instanceof SVGElement || source instanceof DocumentFragment){
        host = new StaticHost(source, placeholder, pathContext)
        typeIndex = 0
    } else if( sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean'){
        host = new PrimitiveHost(source, placeholder, pathContext)
        typeIndex = 1
    } else if ( Array.isArray(source)  ) {
        host = new StaticArrayHost(source, placeholder, pathContext)
        typeIndex = 2
    } else if (source === undefined || source === null) {
        host = new EmptyHost(pathContext, placeholder)
        typeIndex = 3
    } else if (source instanceof RxList) {
        host = new RxListHost(source, placeholder, pathContext)
        typeIndex = 4
    } else if( source instanceof ReusableHost) {
        source.moveTo(placeholder)
        // 复用的 Host 被移动到了新位置，错误归因要落在新位置的上下文上
        source.pathContext = pathContext
        host = source
        typeIndex = 5
    } else if( sourceType === 'object' && typeof source?.type === 'function') {
        host = new ComponentHost(source, placeholder, pathContext)
        typeIndex = 6
    } else {
        assert(false, `unknown child type ${source}`)
    }

    if (isAxiiRetainedObjectDiagnosticsEnabled()) {
        trackHostCreated(host!, HOST_TYPE_NAMES[typeIndex!])
    }

    return host!
}
