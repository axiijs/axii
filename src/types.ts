import {AttributesArg, Fragment, JSXElementType, RefObject} from "./DOM";
import {PathContext} from "./Host";
import {DataContext, StateTransformer, StateFromRef} from './ComponentHost.js'
import {PropTypes} from "./propTypes.js";

export type Props = {
    [k: string]: any,
    children?: any[]
}

export type EffectHandle = () => (any)

/**
 * @category Basic
 */
export type CreateStateFromRefFn = <T>(transform:StateTransformer<T>, options?: any, externalTarget?: any) => StateFromRef<T>
/**
 * @category Basic
 */
export type CreatePortalFn = (children: JSXElement|Function, container: HTMLElement) => JSXElement
/**
 * @category Basic
 */
export type CreateRefFn = () => RefObject
/**
 * @category Basic
 */
export type CreateRxRefFn = () => RefObject

/**
 * @category Basic
 */
export type UseEffectFn = (arg: EffectHandle) => void

/**
 * @category Basic
 */
export type OnCleanupFn = (arg: () => any) => void

/**
 * @category Basic
 */
export type UseLayoutEffectFn = (arg: EffectHandle) => void


/**
 * @category Miscellaneous
 */
export type CreateElementFn = (type: JSXElementType, rawProps : AttributesArg, ...children: any[]) => JSXElement

/**
 * @category Basic
 */
export type CreateSVGElementFn = (type: string, rawProps : AttributesArg, ...children: any[]) => JSXElement


/**
 * @category Basic
 */
export type ExposeFn = <T>(value: T, name?: string) => T

/**
 * @category Basic
 */
export type ReuseFn = (value: any) => any

export type JSXElement = ComponentNode|HTMLElement|Comment|DocumentFragment|SVGElement|string|number|undefined|null
/**
 * @category Basic
 */
export type RenderContext = {
    createElement: CreateElementFn,
    createSVGElement: CreateSVGElementFn,
    Fragment: typeof Fragment,
    useLayoutEffect: UseLayoutEffectFn,
    useEffect: UseEffectFn,
    onCleanup: OnCleanupFn,
    refs: {
        [k: string]: HTMLElement
    },
    context: DataContext,
    pathContext: PathContext,
    /**
     * @internal
     */
    createPortal: CreatePortalFn
    createRef: CreateRefFn,
    createRxRef: CreateRxRefFn,
    expose: ExposeFn,
    reusable: ReuseFn
}
/**
 * @category Basic
 */
export type Component = {
    (props: any, injectHandles: RenderContext): JSXElement,
    propTypes?: PropTypes,
    boundProps?: ({[k: string]: any}|((props: Props, renderContext: RenderContext) => ({[k: string]: any})))[],
}


export type ComponentNode = {
    type: Component,
    props : Props,
    children: any
}

export { type FixedCompatiblePropsType, type PropTypes, type PropType, type PropsType } from './propTypes.js'
export { type StateFromRef, type StateTransformer } from './ComponentHost.js'
