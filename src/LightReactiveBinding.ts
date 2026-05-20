import {ReactiveEffect} from "data0";
import {
    trackRetainedLightBindingStarted,
    trackRetainedLightBindingStopped
} from "./retainedDiagnostics";

export type ReactiveDep = Iterable<ReactiveEffect> & {
    add(effect: ReactiveEffect): unknown
    delete(effect: ReactiveEffect): boolean
    has(effect: ReactiveEffect): boolean
}

export class ProbeReactiveEffect extends ReactiveEffect {
    callGetter(): any {
        return this.getter?.()
    }
}

export abstract class LightReactiveBindingEffect {
    dispatch() {}

    protected startLightBinding(dep: ReactiveDep) {
        this.lightDep = dep
        this.lightActive = true
        dep.add(this as unknown as ReactiveEffect)
        trackRetainedLightBindingStarted(this, this.retainedDiagnosticType)
    }

    protected stopLightBinding() {
        this.lightActive = false
        this.lightDep?.delete(this as unknown as ReactiveEffect)
        this.lightDep = undefined
        trackRetainedLightBindingStopped(this)
    }

    protected lightDep?: ReactiveDep
    protected lightActive = false
    protected retainedDiagnosticType = 'LightReactiveBinding'
}

