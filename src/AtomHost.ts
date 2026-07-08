import {Atom, ReactiveEffect} from "data0";
import {Host, PathContext} from "./Host";
import {trackHostDestroyed, trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {LightBindingEffect} from "./LightBindingEffect.js";
import {isAxiiDiagnosticsEnabled, withReactiveTrace} from "./diagnostics";


function stringValue(v: any) {
    // CAUTION null/undefined 渲染为空文本，与函数 child（FunctionHost 返回 null 渲染为空）语义一致，
    //  atom(null) 是"暂无数据"的自然写法，不应该把字面 "null"/"undefined" 渲染到页面上。
    if (v === undefined || v === null) return ''
    return (v as string)?.toString ?
        (v as string).toString() :
        /* v8 ignore next */
        JSON.stringify(v)
}
/**
 * @internal
 *
 * CAUTION AtomHost 自己就是绑定 effect（继承 LightBindingEffect），不再为每个 atom 文本
 *  单独分配一个 effect 对象 + update 闭包。长列表里每行的文本绑定都会经过这里，
 *  合并后每行少一个对象和一个闭包的常驻内存。
 */
export class AtomHost extends LightBindingEffect implements Host{
    element: Text|Comment
    constructor(public source: Atom, public placeholder:Comment|Text, public pathContext: PathContext) {
        super(undefined, pathContext.skipIndicator as {skip: boolean}|undefined)
        this.element = placeholder
        // Host 的生命周期由宿主树显式管理，不能被创建时的 collect frame/父 effect 接管
        this.detachFromCreationContext()
    }
    get parentElement() {
        // CAUTION 这里必须用 parentNode，因为可能是在数组下，这个父节点是 staticArrayHost 创建的 frag
        return this.placeholder.parentNode || this.element.parentElement
    }

    replace(value: any) {
        if (this.element === this.placeholder) {
            if (this.placeholder instanceof Text) {
                // 占位符本身就是 Text 节点（创建于 createElement 的函数/atom child 快速路径），直接复用
                this.placeholder.nodeValue = stringValue(value)
            } else {
                const textNode = document.createTextNode(stringValue(value))
                // CAUTION 必须保留 comment 占位符在 DOM 中（插入到它前面而不是替换掉它）：
                //  atom 作为列表行时，RxListHost 的锚点查找（placeholder.parentNode）和
                //  reorder 的区间搬移（element ... placeholder）都依赖占位符仍然在位。
                //  旧实现用 replaceChild 会让占位符脱离 DOM，导致在 atom 行前插入新行时
                //  锚点判断失效、新行落到列表末尾。
                this.parentElement!.insertBefore(textNode, this.placeholder)
                this.element = textNode
            }
        } else {
            this.element.nodeValue = stringValue(value)
        }
    }

    // LightBindingEffect 触发时的回调（以原型方法提供，替代构造器闭包）
    update() {
        // CAUTION 诊断关闭（生产环境）时不分配 trace frame 对象，文本更新是最热的路径之一
        if (isAxiiDiagnosticsEnabled()) {
            withReactiveTrace({
                type: 'atom-text',
                operation: 'update-text',
                hostType: 'AtomHost',
                elementPath: this.pathContext.elementPath,
                source: this.pathContext.debugSource,
            }, () => {
                this.replace(this.source())
            })
        } else {
            this.replace(this.source())
        }
    }

    render(): void {
        trackLightBindingCreated(this, 'AtomTextBinding')
        this.run()
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        trackHostDestroyed(this)
        trackLightBindingDestroyed(this)
        if (!parentHandleComputed) {
            // CAUTION 用静态 destroy 而不是 super.destroy()：Host.destroy 的第一个参数
            //  （parentHandle）与 ReactiveEffect.destroy 的 ignoreChildren 语义不同，不能透传
            ReactiveEffect.destroy(this)
        }
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }

}
