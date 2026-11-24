/**
 * @internal
 * 节点种类的判定（#58）：按 DOM 自己的 nodeType，不对当前窗口的 DOM 构造器做 instanceof。
 *
 * CAUTION 跨 realm：同源 iframe 里创建或解析出来的节点，原型链上是那个窗口的 Text / Comment /
 *  HTMLElement / DocumentFragment，对当前窗口的构造器做 instanceof 恒为 false。组件、函数节点、
 *  数组项、列表行都可以返回这样的节点（从 iframe 里取内容、往 iframe 里渲染的编辑器 / 预览），
 *  激活 iframe 文档里的容器（hydrateRoot）时认领到的占位符也来自那个 realm。nodeType 与 realm 无关，
 *  与 #44 对 Portal 容器的处理一致。节点种类的判定（createHost 的分发、各 host 对 source / 占位符
 *  种类的判断、createElement 的 JSX child、激活时对 JSX 值的判断、诊断摘要）都用这里的函数，
 *  不要再写 instanceof Node / Text / Comment / Element / DocumentFragment。
 *  不归这里的：元素的具体类型（HTMLSelectElement、SVGElement 这类按标签 / 命名空间的区分）。
 * CAUTION 性能：createHost / StaticHost.render 是热路径。Chromium 里对 DOM 构造器做 instanceof 比读
 *  nodeType 慢（同页、随机交替、带 A/A 对照的微基准，ns/次：createHost 式的分发 24.8 → 5.5，
 *  元素 / 片段判断 12.5 → 4.8，占位符 Text / Comment 判断 37 → 4.8）。这里是一次 typeof、
 *  一次属性读和整数比较，不分配。
 * CAUTION <form> 的同名控件：name / id 为 "nodeType" 的控件会遮蔽 form.nodeType（HTMLFormElement 是
 *  [LegacyOverrideBuiltIns]），读到的是那个控件或 RadioNodeList（对象）。只有读到对象时才改用
 *  Node.prototype 上的原生 getter：它对任何 realm 的节点都返回真实值，对非节点抛错。#44 最终也是
 *  用原生 getter 绕开同名控件。普通节点和非节点值都不走这条路径。
 *  getter 惰性取：模块顶层不能碰 Node（node 环境 import / SSR 入口）。
 */
export const ELEMENT_NODE = 1
export const TEXT_NODE = 3
export const COMMENT_NODE = 8
export const DOCUMENT_FRAGMENT_NODE = 11

let nativeNodeTypeGetter: ((this: object) => number) | undefined

/**
 * @internal
 * 节点返回它的 nodeType，其他值（原始值、函数、普通对象、null）返回 undefined。
 */
export function nodeTypeOf(value: unknown): number | undefined {
    if (value === null || typeof value !== 'object') return undefined
    const type = (value as {nodeType?: unknown}).nodeType
    if (typeof type === 'number') return type
    return type !== null && typeof type === 'object' ? shadowedNodeType(value) : undefined
}

// 被同名控件遮蔽的 form.nodeType，见文件头的说明
function shadowedNodeType(value: object): number | undefined {
    if (typeof Node === 'undefined') return undefined
    nativeNodeTypeGetter ??= Object.getOwnPropertyDescriptor(Node.prototype, 'nodeType')!.get as (this: object) => number
    try {
        return nativeNodeTypeGetter.call(value)
    } catch {
        return undefined
    }
}

/** @internal */
export function isElementNode(value: unknown): value is Element {
    return nodeTypeOf(value) === ELEMENT_NODE
}

/** @internal */
export function isTextNode(value: unknown): value is Text {
    return nodeTypeOf(value) === TEXT_NODE
}

/** @internal */
export function isCommentNode(value: unknown): value is Comment {
    return nodeTypeOf(value) === COMMENT_NODE
}

/** @internal */
export function isFragmentNode(value: unknown): value is DocumentFragment {
    return nodeTypeOf(value) === DOCUMENT_FRAGMENT_NODE
}

/** @internal */
export function isDomNode(value: unknown): value is Node {
    return nodeTypeOf(value) !== undefined
}
