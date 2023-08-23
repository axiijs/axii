import {expect} from '@jest/globals'
import { ComponentNode } from "./src/types";

// Global compile-time constants
declare var __DEV__: boolean

// for tests
declare module 'expect' {
    interface AsymmetricMatchers extends expect{
        toShallowEqual(toMatch: string|number): void;
    }
    interface Matchers<R> {
        toShallowEqual(toMatch: string|number): R;
    }
}



declare global {
    var __DEV__: boolean
    namespace JSX {
        interface IntrinsicElements {
            // allow arbitrary elements
            // @ts-ignore suppress ts:2374 = Duplicate string index signature.
            [name: string]: any
        }
        interface Element extends  ComponentNode {}
    }
}

