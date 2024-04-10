/**
 * @vitest-environment jsdom
 */
import {ComponentNode, createElement, createRoot} from "@framework";
import { assertType } from 'vitest'

const el = <div></div>

assertType<JSX.Element>(el)
assertType<HTMLElement>(el as HTMLElement)


createRoot(el as HTMLElement).render(<div></div>)


const App:JSX.ElementClass = function () {
    return null
}
assertType<JSX.ElementClass>(App)

const AppWithProps:JSX.ElementClass = function (props: {a: number}) {
    return null
}
assertType<JSX.ElementClass>(AppWithProps)

const AppWithMultipleReturnType:JSX.ElementClass = function (props: {a: number}) {
    return null as ComponentNode|HTMLElement|Comment|DocumentFragment|SVGElement|string|number|undefined|null
}

assertType<JSX.ElementClass>(AppWithMultipleReturnType)
