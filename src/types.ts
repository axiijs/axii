import {AttributesArg, Fragment, JSXElementType, RefObject} from "./DOM";
import {PathContext} from "./Host";
import {DataContext, StateTransformer, StateFromRef} from './ComponentHost.js'
import {PropTypes} from "./propTypes.js";

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
    onCleanup: (arg: () => any) => void,
    refs: {
        [k: string]: HTMLElement
    },
    context: DataContext,
    pathContext: PathContext,
    createPortal: (children: JSXElement|Function, container: HTMLElement) => JSXElement
    createRef: () => RefObject,
    createRxRef: () => RefObject,
    createStateFromRef: <T>(transform:StateTransformer<T>, options?: any, externalTarget?: any)=>StateFromRef<T>,
    expose: <T>(value: T, name?: string) => T,
}

export type Component = {
    (props: any, injectHandles: RenderContext): JSXElement,
    propTypes?: PropTypes,
    boundProps?: ({[k: string]: any}|(() => ({[k: string]: any})))[],
}


export type ComponentNode = {
    type: Component,
    props : Props,
    children: any
}

export { type ToAllowFixedPropsType, type PropTypes, type PropType, type ToPropsType } from './propTypes.js'
export { type StateFromRef, type StateTransformer } from './ComponentHost.js'