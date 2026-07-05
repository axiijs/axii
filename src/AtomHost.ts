import {Atom} from "data0";
import {Host, PathContext} from "./Host";
import {trackHostDestroyed, trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {LightBindingEffect} from "./LightBindingEffect.js";
import {isAxiiDiagnosticsEnabled, withReactiveTrace} from "./diagnostics";


function stringValue(v: any) {
    return (v as string)?.toString ?
        (v as string).toString() :
        (v === undefined ? 'undefined' : JSON.stringify(v))
}
/**
 * @internal
 */
export class AtomHost implements Host{
    effect?: LightBindingEffect
    element: Text|Comment = this.placeholder
    constructor(public source: Atom, public placeholder:Comment|Text, public pathContext: PathContext) {
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

    render(): void {
        // CAUTION skipIndicator 是给富文本编辑器 contenteditable 来跳过 dom 变换的
        this.effect = new LightBindingEffect(() => {
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
        }, this.pathContext.skipIndicator)
        trackLightBindingCreated(this.effect, 'AtomTextBinding')
        this.effect.run()
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        trackHostDestroyed(this)
        if (this.effect) trackLightBindingDestroyed(this.effect)
        if (!parentHandleComputed) {
            this.effect?.destroy()
        }
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }

}
