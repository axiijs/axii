import { atom } from "data0"
import { Component, JSXElement, RenderContext } from "./types"

export function lazy(load: () => Promise<any>, fallback: () => JSXElement){
    const LazyComonent = atom<Component | null>(null)

    load().then(Component => {
        LazyComonent(Component)
    })

    return function LazyWrapper(props: {[k:string]: any}, {createElement}: RenderContext) {
        return () => {
            const LoadedLazyComponent = LazyComonent()
            if (LoadedLazyComponent) {
                return createElement(LoadedLazyComponent, props)
            } else {
                return fallback()
            }
        } 
    } as unknown as Component 
}   