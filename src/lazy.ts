import { atom } from "data0"
import { Component, JSXElement, RenderContext } from "./types"

export function lazy(load: () => Promise<any>, fallback: () => JSXElement){
    const LazyComponent = atom<Component | null>(null)

    load().then(Component => {
        LazyComponent(Component)
    })

    return function LazyWrapper(props: {[k:string]: any}, {createElement}: RenderContext) {
        return () => {
            const LoadedLazyComponent = LazyComponent()
            if (LoadedLazyComponent) {
                return createElement(LoadedLazyComponent, props)
            } else {
                return fallback()
            }
        } 
    } as unknown as Component 
}   