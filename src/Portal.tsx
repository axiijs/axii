import {ComponentNode, RenderContext} from "./types.js";
import {createRoot, hydratePortalContent} from "./render.js";
import {isHydrating, resolveHydratePortalContainer} from "./hydration";
/**
 * @category Basic
 */
export type PortalContainerRef = HTMLElement | string | { id: string }

/**
 * @category Basic
 */
type PortalProps = {
    container: PortalContainerRef
    content: JSX.Element|ComponentNode|Function
    destroyOnUnmount?: boolean
    /** Prefer over container.id when exporting SSR portals / resolving hydrate targets (§3.3.d). */
    portalKey?: string
}

const renderedStaticContent = new WeakSet<any>

/** Shared with axii/ssr serializeComponent — do not rename. */
export function isAxiiPortalComponent(type: unknown): boolean {
    return !!(type && (type as any).__axiiPortal)
}

/**
 * Resolve Portal export key per §3.3.d (portalKey → string container → container.id).
 * Throws when no legal key exists (row 6).
 */
export function resolvePortalExportKey(container: PortalContainerRef, portalKey?: string): string {
    if (typeof portalKey === 'string' && portalKey !== '') return portalKey
    if (typeof container === 'string') {
        if (container === '') throw new Error('[axii] Portal container string key must be non-empty')
        return container
    }
    if (container != null && typeof container === 'object') {
        const id = (container as {id?: unknown}).id
        if (typeof id === 'string' && id !== '') return id
    }
    throw new Error('[axii] Portal has no export key (need portalKey, string container, or non-empty container.id)')
}

function resolveCsrContainer(container: PortalContainerRef): HTMLElement {
    if (typeof HTMLElement !== 'undefined' && container instanceof HTMLElement) {
        return container
    }
    if (typeof container === 'string') {
        const el = document.getElementById(container)
        if (!el) throw new Error(`[axii] Portal container "#${container}" not found`)
        return el
    }
    if (container != null && typeof container === 'object' && typeof (container as {id?: unknown}).id === 'string') {
        const id = (container as {id: string}).id
        if (!id) throw new Error('[axii] Portal container.id must be non-empty')
        const el = document.getElementById(id)
        if (!el) throw new Error(`[axii] Portal container "#${id}" not found`)
        return el
    }
    throw new Error('[axii] Portal container must be HTMLElement | string | { id: string }')
}

/**
 * @category Basic
 */
export function Portal({ container, content, destroyOnUnmount, portalKey }: PortalProps, { useEffect, pathContext } : RenderContext) {
    if (typeof content !=='function') {
        if( renderedStaticContent.has(content)) {
            console.error('static portal content can only be rendered once. Use function content for content has reactive parts.')
        }
        renderedStaticContent.add(content)
    }

    let portalEl: HTMLElement
    let root: ReturnType<typeof createRoot>

    if (isHydrating()) {
        const key = resolvePortalExportKey(container, portalKey)
        portalEl = resolveHydratePortalContainer(key)
        root = hydratePortalContent(portalEl, content as any, pathContext)
    } else {
        portalEl = resolveCsrContainer(container)
        root = createRoot(portalEl, pathContext)
        root.render(content)
    }

    // CAUTION container 在 Portal 渲染时还没连入文档（最常见：container 本身就是外层组件树
    //  的一部分，或外层 root 还没 attach）时，内层 root 永远等不到 attach——portal 内容里的
    //  layoutEffect/ref 永不执行。这里桥接外层 root 的 attach 时机：外层连通且 container
    //  确实连入文档时，把 attach 转发给内层 root。container 挂在组件树之外（用户稍后手动
    //  append）的场景维持原语义，由用户自行 dispatch。
    let cancelAttachBridge: (() => void)|undefined
    if (!portalEl.isConnected) {
        const outerRoot = pathContext.root
        const dispatchInnerAttach = () => {
            if (portalEl.isConnected && !root.attached) root.dispatch('attach')
        }
        cancelAttachBridge = outerRoot.attached ?
            outerRoot.deferUntilAttached(portalEl, dispatchInnerAttach) :
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
;(Portal as any).__axiiPortal = true
