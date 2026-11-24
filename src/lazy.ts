import { atom } from "data0"
import { Component, JSXElement, RenderContext } from "./types"
import { isSsrPass } from "./ssrContext.js"

/**
 * 懒加载组件。
 *
 * CAUTION load 必须推迟到组件首次渲染时才调用（多个 LazyWrapper 实例共享同一次加载）：
 *  lazy() 通常在模块顶层调用，如果定义时就 load()，模块加载即发起请求，违背代码分割的初衷。
 *
 * load 失败时不会产生 unhandled rejection：错误存入 error atom 并传给 fallback，
 * 由 fallback 决定如何展示错误态（不传参数的旧签名 fallback 不受影响）。
 *
 * CAUTION fallback 是可选的（I63）：React.lazy 根本没有 fallback 参数，`lazy(load)`
 *  是自然写法。不传时加载期间渲染为空（null），不能对 undefined 调用
 *  （否则加载期间每次渲染都 TypeError，钩子噪音/无钩子直接崩）。
 *
 * CAUTION SSR（§3.3.a）：renderToString 同步输出 fallback（或 null），不得调用 startLoad()，
 *  否则会污染模块级 started / LazyComponent，导致随后客户端 hydrate 跳过真实加载。
 */
export function lazy(load: () => Promise<any>, fallback?: (error?: unknown) => JSXElement){
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

    function LazyWrapper(props: {[k:string]: any}, {createElement}: RenderContext) {
        if (!isSsrPass()) startLoad()
        return () => {
            const LoadedLazyComponent = LazyComponent()
            if (LoadedLazyComponent) {
                return createElement(LoadedLazyComponent, props)
            } else {
                return fallback ? fallback(loadError()) : null
            }
        }
    }
    // CAUTION 包装必须是透明的：ref、`$name:xxx` 配置、透传的 config 属于加载出来的组件。
    //  标记让包装自己的 host 不消费它们、原样留在 props 里（见 ComponentHost 的 forwardsProps），
    //  上面的 createElement(LoadedLazyComponent, props) 才能把它们交到真正的组件手里。
    ;(LazyWrapper as any).__axiiForwardProps = true
    return LazyWrapper as unknown as Component
}
