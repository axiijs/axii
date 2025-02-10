import {RenderContext} from "./types.js";
/**
 * @category Basic
 */
export type ContextProviderProps = {
    contextType: any
    value: any
    children: any
}
/**
 * @category Basic
 */
export function ContextProvider({contextType, value, children}: ContextProviderProps, {context}: RenderContext) {
    context.set(contextType, value)
    return children
}
/**
 * @category Basic
 */
export function createContext<T>(name: string) {
    const contextType = {
        name,
        Provider({value, children}: Omit<ContextProviderProps, 'contextType'>, {context}: RenderContext) {
            context.set(contextType, value)
            return children
        },
        valueType: null as any as T
    }

    return contextType
}