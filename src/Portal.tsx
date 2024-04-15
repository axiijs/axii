import {ComponentNode, RenderContext} from "./types.js";
import { createRoot} from "./render.js";

type PortalProps = {
    container: HTMLElement
    children: (JSX.Element|ComponentNode)[]

}
export function Portal({ container, children }: PortalProps, { useEffect, pathContext } : RenderContext) {

    const root = createRoot(container, pathContext)
    root.render(children[0])

    useEffect(() => {
        return () => {
            root.destroy()
        }
    })

    return null
}
