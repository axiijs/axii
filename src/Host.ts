import {computed} from "data0";
import {Root} from "./render";
import {LinkedNode} from "./LinkedList";
import type {AxiiSource} from "./diagnostics";
/**
 * @internal
 */
export interface Host {
    element: HTMLElement|Comment|Text|SVGElement
    // CAUTION 函数/atom child 的占位符是 Text（见 DOM.ts createElement），其余是 Comment
    placeholder:Comment|Text
    pathContext: PathContext
    computed?: ReturnType<typeof computed>
    render: () => void
    // 声明是否强制由自己来处理 element，例如 StaticHost 在有 detachStyledChildren 的时候，就需要自己处理 element
    forceHandleElement?: boolean
    // CAUTION 曾经还有第二个参数 parentHandleComputed（父级 computed rerun 时级联清理 effect），
    //  自从所有绑定 effect 都 detachFromCreationContext（不再挂在父 effect 下）后，
    //  它在整个代码库中永远不会以 true 传入，已删除。
    destroy : (parentHandleElement?: boolean) => void
    revoke?: () => void
}
/**
 * @internal
 */
export type PathContext = {
    [k:string]:any,
    root: Root,
    // hostPath: Host[],
    hostPath: LinkedNode<Host>,
    elementPath: number[],
    // 开发期 JSX source（文件/行/列），用于错误报告中的源码定位
    debugSource?: AxiiSource,
}