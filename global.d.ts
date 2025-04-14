// Global compile-time constants
import { Component, JSXElement } from "@framework";

declare var __DEV__: boolean

declare global {
    var __DEV__: boolean
    namespace JSX {
        interface IntrinsicElements {
            fragment: { children?: JSXElement | JSXElement[] };
            // allow arbitrary elements
            // @ts-ignore suppress ts:2374 = Duplicate string index signature.
            [name: string]: any
        }
        
        interface FragmentAttributes {
            children?: JSXElement | JSXElement[];
        }
        
        interface IntrinsicAttributes {
            // [key: `$${string}`]: boolean;
            // name an element inside component so it can be overwritten
            as?: string
            ref?: any
            // for test usage
            __this?: any
            // pass props to an element inside component
            [key: `$${string}`]: any
            children?: JSXElement | JSXElement[];
            // FIXME type
            // [key: `$${string}`]: {[key: string]: any}
            // [key: `$${string}:${string}`]: any
        }
        
        // Add this to support JSX fragments with children
        // This allows the fragment syntax to work with TypeScript
        interface IntrinsicClassAttributes<T> {
            children?: JSXElement | JSXElement[];
        }
        
        interface ElementChildrenAttribute {
            children: {}; // specify children name to use
        }
        
        type ElementClass = Component
        type Element = JSXElement
    }
}

export {}
