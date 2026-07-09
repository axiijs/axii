import {ComponentNode, RenderContext} from "./types.js";
import {createRoot} from "./render.js";
/**
 * @category Basic
 */
type PortalProps = {
    container: HTMLElement
    content: JSX.Element|ComponentNode|Function
    destroyOnUnmount?: boolean
}

const renderedStaticContent = new WeakSet<any>
/**
 * @category Basic
 */
export function Portal({ container,content, destroyOnUnmount }: PortalProps, { useEffect, pathContext } : RenderContext) {
    if (typeof content !=='function') {
        if( renderedStaticContent.has(content)) {
            console.error('static portal content can only be rendered once. Use function content for content has reactive parts.')
        }
        renderedStaticContent.add(content)
    }

    const root = createRoot(container, pathContext)
    root.render(content)

    // CAUTION container 在 Portal 渲染时还没连入文档（最常见：container 本身就是外层组件树
    //  的一部分，或外层 root 还没 attach）时，内层 root 永远等不到 attach——portal 内容里的
    //  layoutEffect/ref 永不执行。这里桥接外层 root 的 attach 时机：外层连通且 container
    //  确实连入文档时，把 attach 转发给内层 root。container 挂在组件树之外（用户稍后手动
    //  append）的场景维持原语义，由用户自行 dispatch。
    let cancelAttachBridge: (() => void)|undefined
    if (!container.isConnected) {
        const outerRoot = pathContext.root
        const dispatchInnerAttach = () => {
            if (container.isConnected && !root.attached) root.dispatch('attach')
        }
        cancelAttachBridge = outerRoot.attached ?
            outerRoot.deferUntilAttached(container, dispatchInnerAttach) :
            outerRoot.on('attach', dispatchInnerAttach, {once: true})
    }

    useEffect(() => {
        return () => {
            cancelAttachBridge?.()
            // CAUTION destroyOnUnmount 默认为 true；显式传 false 时保留 portal 内容
            //  （典型场景：挂到 body 上的常驻弹层），由使用方自行负责后续清理。
            if (destroyOnUnmount !== false) {
                root.destroy()
            }
        }
    })

    return null
}
