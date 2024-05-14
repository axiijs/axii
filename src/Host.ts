import {computed} from "data0";
import {Root} from "./render";

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

export type PathContext = {
    [k:string]:any,
    root: Root,
    hostPath: Host[],
    elementPath: number[],
}