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

export function createContext<T>(name: string) {
    const contextType = {
        name,
        Provider({value, children}: ContextProviderProps, {context}: RenderContext) {
            context.set(contextType, value)
            return children
        },
        valueType: null as any as T
    }

    return contextType
}