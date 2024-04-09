import {AttributesArg, Fragment, JSXElementType} from "./DOM";
import {PathContext} from "./Host";

export type Props = {
    [k: string]: any,
    children?: any[]
}

export type EffectHandle = () => (any)

export type JSXElement = ComponentNode|HTMLElement|Comment|DocumentFragment|SVGElement|string|number|undefined|null

export type RenderContext = {
    createElement: (type: JSXElementType, rawProps : AttributesArg, ...children: any[]) => JSXElement,
    createSVGElement: (type: string, rawProps : AttributesArg, ...children: any[]) => JSXElement,
    Fragment: typeof Fragment,
    useLayoutEffect: (arg: EffectHandle) => void,
    useEffect: (arg: EffectHandle) => void,
    refs: {
        [k: string]: HTMLElement
    },
    pathContext: PathContext
}

export type Component = (props: any, injectHandles?: RenderContext) => JSXElement
export type ComponentNode = {
    type: Component,
    props : Props,
    children: any
}