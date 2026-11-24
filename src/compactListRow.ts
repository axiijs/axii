/**
 * RxList 的 Compact 行判定（#68）。规则只在这里定义：服务端（axii/ssr 的 serializeRxListRow）与激活
 * （#55 B2 的 RxListHost.hydrate）对描述的判定都从这里取，不另写一份。
 *
 * 规则：行是元素（不是 Fragment），并且它的**静态子树**里没有任何生效的 detachStyle。
 *  - 静态子树：行元素自己，加上经元素 / Fragment 子节点递归可达的元素与 Fragment。不进入 Host child
 *    （函数 / atom、数组、RxList、组件、reusable）：那些 child 各有自己的 Host，内容里的 detachStyle
 *    由那个 Host 自己处理。这与 DOM.ts createElement 只从 DOM 节点 child（元素 / DocumentFragment）提升元数据一致。
 *  - 生效的 detachStyle：值为真，与 createElement 的登记条件（props 循环里 `if (value)`）一致。
 *    函数 / atom 总是生效（登记时不求值，即使之后求值为 null）；null / undefined / false / 0 / '' 不生效。
 *  满足规则的行走 CompactElementHost，没有行级 Comment；否则行尾有 `<!--rx list item-->`。
 *
 * 同一条规则有两种输入形态：
 *  - 已创建的节点（CSR、激活后的 patch 新行）：createElement 已经把静态子树里生效的 detachStyle 提升进
 *    detachStyledChildren（DOM.ts 的 child 循环与 props 循环），判定是「元素且 detachStyledChildren 为空」。
 *    这个形态内联在 RxListHost.createChildHost 里（列表 patch 的热路径，不经函数调用、不遍历子树）；
 *    改那里的条件要同步这里的规则。
 *  - 描述（服务端的 SsrElement；#55 B2 的 HydrationElement）：没有提升结果，按同一规则遍历描述的静态子树，
 *    即下面的 isCompactListRowDescriptor。描述的形状由调用方用访问器给出。
 *  两种形态的结果一致由 __tests__/ssrCompactRow.spec.tsx（服务端 HTML ≡ CSR、激活不报告、行 Host 种类 ≡ CSR）守住。
 *
 * CAUTION 本模块在 Node 里加载（axii/ssr 直接引入）：不能访问 document / window / Node。
 */

/**
 * 描述形态的访问器。实现要做成模块级常量，不要每行分配。
 * #55 B2 的 HydrationElement 用 `tag` / `rawProps` / `rawChildren` 实现同一组访问器即可。
 */
export interface ListRowDescriptorAccess<D> {
    /** value 是元素或 Fragment 描述时返回它（静态子树里的节点），否则返回 undefined（Host child、文本、nullish）。 */
    asStaticNode(value: unknown): D | undefined
    isFragment(node: D): boolean
    props(node: D): {readonly [key: string]: any} | null | undefined
    /** 与 createElement 收到的 children 同一来源（显式 children 优先，否则 props.children）。 */
    children(node: D): readonly unknown[]
}

/** 描述（服务端 / 激活）形态的行是不是 Compact 行。规则见文件头。 */
export function isCompactListRowDescriptor<D>(row: unknown, access: ListRowDescriptorAccess<D>): boolean {
    const node = access.asStaticNode(row)
    return node !== undefined && !access.isFragment(node) && !staticSubtreeHasDetachStyle(node, access)
}

/**
 * 描述的静态子树（含 node 自己）里有没有生效的 detachStyle，即 CSR 的 createElement 之后
 * detachStyledChildren 是否非空。Fragment 自己的 detachStyle 也计入（createElement(Fragment) 同样登记）。
 */
export function staticSubtreeHasDetachStyle<D>(node: D, access: ListRowDescriptorAccess<D>): boolean {
    const props = access.props(node)
    if (props && props.detachStyle) return true
    const children = access.children(node)
    for (let i = 0; i < children.length; i++) {
        const child = access.asStaticNode(children[i])
        if (child !== undefined && staticSubtreeHasDetachStyle(child, access)) return true
    }
    return false
}
