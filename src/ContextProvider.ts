import {RenderContext} from "./types.js";

export type ContextProviderProps = {
    contextType: any
    value: any
    children: any
}

export function ContextProvider({contextType, value, children}: ContextProviderProps, {context}: RenderContext) {
    context.set(contextType, value)
    return children
}