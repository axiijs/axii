import { createElement, Fragment } from "./DOM";
import {Context} from "./Host";

export type Props = {
    [k: string]: any,
    children?: ChildNode[]
}

export type EffectHandle = () => (void | (() => void))

export type InjectHandles = {
    createElement: typeof createElement,
    Fragment: typeof createElement,
    useLayoutEffect: (arg: EffectHandle) => void
    ref: {
        [k: string]: HTMLElement
    },
    context: Context
}

export type Component = (props?: Props, injectHandles?: InjectHandles) => HTMLElement|Text|DocumentFragment|null|undefined|string|number|Function|JSX.Element
export type ComponentNode = {
    type: Component,
    props : Props,
    children: any
}