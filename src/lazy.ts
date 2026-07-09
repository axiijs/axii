import { atom } from "data0"
import { Component, JSXElement, RenderContext } from "./types"

/**
 * 懒加载组件。
 *
 * CAUTION load 必须推迟到组件首次渲染时才调用（多个 LazyWrapper 实例共享同一次加载）：
 *  lazy() 通常在模块顶层调用，如果定义时就 load()，模块加载即发起请求，违背代码分割的初衷。
 *
 * load 失败时不会产生 unhandled rejection：错误存入 error atom 并传给 fallback，
 * 由 fallback 决定如何展示错误态（不传参数的旧签名 fallback 不受影响）。
 */
export function lazy(load: () => Promise<any>, fallback: (error?: unknown) => JSXElement){
    const LazyComponent = atom<Component | null>(null)
    const loadError = atom<unknown>(null)
    let started = false

    const startLoad = () => {
        if (started) return
        started = true
        load().then(
            Component => LazyComponent(Component),
            error => loadError(error ?? new Error('lazy load failed'))
        )
    }

    return function LazyWrapper(props: {[k:string]: any}, {createElement}: RenderContext) {
        startLoad()
        return () => {
            const LoadedLazyComponent = LazyComponent()
            if (LoadedLazyComponent) {
                return createElement(LoadedLazyComponent, props)
            } else {
                return fallback(loadError())
            }
        }
    } as unknown as Component
}
