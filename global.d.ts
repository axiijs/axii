type DOMElement = Element

// Global compile-time constants
declare var __DEV__: boolean


declare global {
    var __DEV__: boolean
    namespace JSX {
        interface IntrinsicElements {
            // allow arbitrary elements
            // @ts-ignore suppress ts:2374 = Duplicate string index signature.
            [name: string]: any
        }
        interface Element extends  DOMElement {}
    }
}

export {}
