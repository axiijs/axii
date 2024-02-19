
// Global compile-time constants
import {Component, ComponentNode} from "@framework";

declare var __DEV__: boolean

type JSXElement = ComponentNode|HTMLElement|DocumentFragment|SVGElement
declare global {
    var __DEV__: boolean
    namespace JSX {
        interface IntrinsicElements {
            // allow arbitrary elements
            // @ts-ignore suppress ts:2374 = Duplicate string index signature.
            [name: string]: any
        }
        interface IntrinsicAttributes {
            ref?: any
        }
        type ElementClass = Component
        type Element =  JSXElement
    }
}

export {}
