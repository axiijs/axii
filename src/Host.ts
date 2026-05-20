import {computed} from "data0";
import {Root} from "./render";
import {createLinkedNode, LinkedNode} from "./LinkedList";
import type {AxiiSource} from "./diagnostics";
/**
 * @internal
 */
export interface Host {
    element: HTMLElement|Comment|Text|SVGElement
    placeholder:Comment
    pathContext: PathContext
    computed?: ReturnType<typeof computed>
    render: () => void
    // 声明是否强制由自己来处理 element，例如 StaticHost 在有 detachStyledChildren 的时候，就需要自己处理 element
    forceHandleElement?: boolean
    destroy : (parentHandleElement?: boolean, parentHandleComputed?: boolean) => void
    revoke?: () => void
}
/**
 * @internal
 */
export type PathContext = {
    [k:string]:any,
    root: Root,
    // hostPath: Host[],
    hostPath?: LinkedNode<Host>|null,
    hostPathOwner?: Host,
    parentPathContext?: PathContext,
    elementPath: number[],
    debugSource?: AxiiSource,
}

function shouldStoreDebugSource() {
    return typeof __DEV__ === 'undefined' || __DEV__
}

/**
 * @internal
 */
export function createPathContextWithDebugSource(
    context: PathContext,
    debugSource: AxiiSource | undefined,
): PathContext {
    if (!shouldStoreDebugSource() || !debugSource || debugSource === context.debugSource) {
        return context
    }
    return {
        ...context,
        debugSource,
    }
}

/**
 * @internal
 */
export function createChildPathContext(
    parent: PathContext,
    hostPathOwner: Host,
    elementPath: number[] = parent.elementPath,
    debugSource: AxiiSource | undefined = parent.debugSource,
): PathContext {
    const context: PathContext = {
        root: parent.root,
        parentPathContext: parent,
        hostPathOwner,
        elementPath,
    }
    if (shouldStoreDebugSource() && debugSource) {
        context.debugSource = debugSource
    }
    return context
}

/**
 * @internal
 */
export function getHostPath(pathContext: PathContext): LinkedNode<Host>|null {
    if ('hostPath' in pathContext) return pathContext.hostPath ?? null
    if (!pathContext.hostPathOwner) return null

    const hostPath = createLinkedNode<Host>(
        pathContext.hostPathOwner,
        pathContext.parentPathContext ? getHostPath(pathContext.parentPathContext) : null,
    )

    pathContext.hostPath = hostPath
    pathContext.parentPathContext = undefined
    pathContext.hostPathOwner = undefined
    return hostPath
}
