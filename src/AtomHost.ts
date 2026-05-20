import {Atom, computed, destroyComputed, ReactiveEffect} from "data0";
import {Host, PathContext} from "./Host";
import {withReactiveTrace} from "./diagnostics";
import {LightReactiveBindingEffect, ProbeReactiveEffect} from "./LightReactiveBinding";


function stringValue(v: any) {
    return (v as string)?.toString ?
        (v as string).toString() :
        (v === undefined ? 'undefined' : JSON.stringify(v))
}

class ImmediateReactiveEffect extends ReactiveEffect {
    callGetter(): any {
        return this.getter?.()
    }
}

/**
 * @internal
 */
export class AtomHost extends LightReactiveBindingEffect implements Host{
    stopAutoRun: () => void = () => {}
    computed?: Atom<any>
    element: Text|Comment = this.placeholder
    protected retainedDiagnosticType = 'AtomTextBinding'
    private lightRunning = false
    private shouldProbeLightBinding = true

    constructor(public source: Atom, public placeholder:Comment, public pathContext: PathContext) {
        super()
    }
    get parentElement() {
        // CAUTION 这里必须用 parentNode，因为可能是在数组下，这个父节点是 staticArrayHost 创建的 frag
        return this.placeholder.parentNode || this.element.parentElement
    }

    replace(value: any) {
        if (this.element === this.placeholder) {
            const textNode = document.createTextNode(stringValue(value))
            this.parentElement!.replaceChild(textNode, this.placeholder)
            this.element = textNode
        } else {
            this.element.nodeValue = stringValue(value)
        }
    }

    render(): void {
        let firstValue: any
        const effect = new ImmediateReactiveEffect(() => {
            firstValue = this.source()
            this.replace(firstValue)
        })
        effect.run()

        if (effect.deps.length === 1) {
            const dep = effect.deps[0]!
            const canSkipProbe = Object.prototype.hasOwnProperty.call(this.source, 'raw')
            effect.destroy()
            this.shouldProbeLightBinding = !canSkipProbe
            this.startLightBinding(dep)
            return
        }

        effect.destroy()
        this.renderFull()
    }

    run() {
        if (!this.lightActive || this.lightRunning || this.pathContext.skipIndicator?.skip) return
        this.lightRunning = true
        try {
            if (!this.shouldProbeLightBinding) {
                this.updateText(this.source())
                return
            }

            let nextValue: any
            const probeEffect = new ProbeReactiveEffect(() => {
                nextValue = this.source()
            })
            probeEffect.run()
            const canStayLight = probeEffect.deps.length === 1 && probeEffect.deps[0] === this.lightDep
            probeEffect.destroy()

            if (!canStayLight) {
                this.stopLightBinding()
                this.renderFull()
                return
            }

            this.updateText(nextValue)
        } finally {
            this.lightRunning = false
        }
    }

    private renderFull() {
        this.computed = computed(() => {
            withReactiveTrace({
                type: 'atom-text',
                operation: 'update-text',
                hostType: 'AtomHost',
                elementPath: this.pathContext.elementPath,
                source: this.pathContext.debugSource,
            }, () => {
                this.replace(this.source())
            })
            },
            undefined,
            true,
            undefined,
            // CAUTION 是给富文本编辑器 contenteditable 来跳过 dom 变换的，
            this.pathContext.skipIndicator
        )

    }

    private updateText(value: any) {
        withReactiveTrace({
            type: 'atom-text',
            operation: 'update-text',
            hostType: 'AtomHost',
            elementPath: this.pathContext.elementPath,
            source: this.pathContext.debugSource,
        }, () => {
            this.replace(value)
        })
    }

    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            if (this.computed) destroyComputed(this.computed)
            this.stopLightBinding()
        }
        if (!parentHandle) {
            this.element.remove()
            this.placeholder.remove()
        }
    }

}