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
                this.parentElement!.replaceChild(textNode, this.placeholder)
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
