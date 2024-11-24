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

    useEffect(() => {
        return () => {
            root.destroy()
        }
    })

    return null
}
