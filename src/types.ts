import {AttributesArg, Fragment, JSXElementType} from "./DOM";
import {Context} from "./Host";

export type Props = {
    [k: string]: any,
    children?: any[]
}

export type EffectHandle = () => (any)

export type JSXElement = ComponentNode|HTMLElement|Comment|DocumentFragment|SVGElement|string|number|undefined|null

export type RenderContext = {
    createElement: (type: JSXElementType, rawProps : AttributesArg, ...children: any[]) => JSXElement,
    Fragment: typeof Fragment,
    useLayoutEffect: (arg: EffectHandle) => void
    ref: {
        [k: string]: HTMLElement
    },
    context: Context
}

export type Component = (props?: Props, injectHandles?: RenderContext) => JSXElement
export type ComponentNode = {
    type: Component,
    props : Props,
    children: any
}