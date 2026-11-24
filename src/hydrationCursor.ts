/**
 * @internal
 * #55 新激活模型的节点指针游标（设计 docs/ssr-support/hydration-top-down.md §2.3、§2.5、§4.2）。只给新模型用；
 * 旧模型的下标游标（hydration.ts 的 childCursorParent / childCursorIndex）在 #55 S 随旧模型删除。
 *
 * 激活是 ssr.ts serialize 的逆过程：服务端按什么顺序写出节点，各 Host 就按什么顺序从游标处读回。
 *  - 每个被认领的 DOM 父节点一层：{parent, next}，next 是下一个未消费的服务端子节点。用节点指针而不是下标：
 *    在游标前插入（空 Text）或删除（axii:t 包边、axii:0 哨兵）都不会让游标漂移。
 *  - 进入一个被认领的元素时压一层，元素的子节点消费完之后检查剩余节点再弹出（§4.2 R5）。
 *  - 只在游标处认领，从不向前搜索；父级从不替子级找 placeholder，子级区域在哪里结束由子级自己决定。
 *
 * 失配（#55 B1 / B2）：游标处不是期望的节点时报告 HydrationMismatchError（reportHydrationMismatch：无论诊断是否开启
 *  都交给 onError）并抛出，不做修复。R1–R5 的修复在 B3 落地，到那时这里的「报告并抛出」换成各条规则。
 *  只容忍 ssr.ts 确实会写出的差异：非空文本单元可以带也可以不带 axii:t 包边（§3.2.1 A2），字符数据父节点里没有
 *  任何 axii:* 标记（各文本单元首尾相接，A3），textarea 的 value 子文本（认领元素时清掉，见 DOM.ts）。
 *
 * CAUTION 这个模块在 axii/ssr 的导入链之外，但仍不在模块顶层碰 document / Node（与 hydration.ts 一致）。
 */
import {
    isCharacterDataParent,
    isCommentData,
    reportHydrationMismatch,
    summarizeChild,
} from "./hydration"
import {COMMENT_NODE, ELEMENT_NODE, TEXT_NODE} from "./nodeType"

// 当前层
let cursorParent: ParentNode | null = null
let cursorNext: ChildNode | null = null
// 字符数据父节点（textarea / title / style / script…，§2.6.6）：各文本单元从同一个 Text 上依次切出自己的前缀，
//  空单元插入 Text('')，不认领任何 axii:*。判定与旧模型共用 hydration.isCharacterDataParent。
let cursorCharData = false
// 激活容器这一层：容器上的 STYLE / SCRIPT / LINK 留给 migrateSsrStyleTags 与之后的容器检查，认领时跳过（§2.3）
let cursorIsContainer = false
// 外层：每层 4 项（parent, next, charData, isContainer），平铺在一个数组里
const outerFrames: any[] = []

/** 激活中止时把错误抛出：失配已经报告过（onError），这里只负责中止。 */
function mismatch(expected: string, actual: ChildNode | null): never {
    throw reportHydrationMismatch(expected, summarizeChild(actual))
}

function pushFrame(parent: ParentNode, isContainer: boolean): void {
    if (cursorParent !== null) outerFrames.push(cursorParent, cursorNext, cursorCharData, cursorIsContainer)
    cursorParent = parent
    cursorNext = parent.firstChild
    cursorCharData = !isContainer && isCharacterDataParent(parent)
    cursorIsContainer = isContainer
}

function popFrame(): void {
    if (outerFrames.length) {
        cursorIsContainer = outerFrames.pop()
        cursorCharData = outerFrames.pop()
        cursorNext = outerFrames.pop()
        cursorParent = outerFrames.pop()
    } else {
        cursorParent = null
        cursorNext = null
        cursorCharData = false
        cursorIsContainer = false
    }
}

function isContainerAsset(node: ChildNode): boolean {
    if (node.nodeType !== ELEMENT_NODE) return false
    const name = (node as Element).localName
    return name === 'style' || name === 'script' || name === 'link'
}

/**
 * 游标处的节点。容器这一层先跳过 STYLE / SCRIPT / LINK（期望的正是同标签元素时不跳）：服务端样式通常写在
 * 激活内容前面，它们由 migrateSsrStyleTags 迁移，不属于任何 Host 区域。
 */
function peek(expectedElementName?: string): ChildNode | null {
    let node = cursorNext
    if (cursorIsContainer) {
        while (node !== null && isContainerAsset(node) && (node as Element).localName !== expectedElementName) {
            node = node.nextSibling
        }
        cursorNext = node
    }
    return node
}

// ───────────────────────── 层 ─────────────────────────

/**
 * 激活容器作为最外层（§2.3「根容器」）。返回进入之前外层的深度，交给 leaveTopDownContainer
 * （在 finally 里调用：失配中止时也要恢复，回调里嵌套的激活返回后外层照常继续）。
 */
export function enterTopDownContainer(container: ParentNode): number {
    const depth = cursorParent === null ? -1 : outerFrames.length
    pushFrame(container, true)
    return depth
}

/** 恢复到 enterTopDownContainer 之前的状态。 */
export function leaveTopDownContainer(depth: number): void {
    if (depth === -1) {
        outerFrames.length = 0
        cursorParent = null
        cursorNext = null
        cursorCharData = false
        cursorIsContainer = false
        return
    }
    outerFrames.length = depth + 4
    popFrame()
}

/**
 * 容器这一层消费完之后（根 Host 已认领 <!--root-->）：剩下的只能是 STYLE / SCRIPT / LINK，其余是失配（R5，B1 报告并抛出）。
 * 不弹出这一层：之后的 migrateSsrStyleTags 与容器检查不经过游标。
 */
export function finishTopDownContainer(): void {
    const node = peek()
    if (node !== null) mismatch('end of hydrate root children', node)
}

/** 进入一个被认领的元素（或 table 的隐含 tbody），游标从它的第一个子节点开始。 */
export function enterTopDownElement(parent: ParentNode): void {
    pushFrame(parent, false)
}

/**
 * 元素的子节点消费完：游标必须到达末尾，否则是失配（R5，B1 报告并抛出），然后回到父元素那一层。
 */
export function exitTopDownElement(): void {
    if (cursorNext !== null) mismatch('end of element children', cursorNext)
    popFrame()
}

/** 游标所在的父节点（激活之外为 null）。只给开发期诊断与用例用。 */
export function getTopDownCursorParent(): ParentNode | null {
    return cursorParent
}

// ───────────────────────── 认领 ─────────────────────────

/**
 * 非空文本单元（§2.5：元素的静态文本、Text-ph、Comment-ph 的文本、函数的文本态）：`axii:t` 包边的 Text 或裸 Text。
 * 包边随即删除，游标移到单元之后。字符数据父节点里从游标处的 Text 切出 expected 这一段，余下的留给后面的单元。
 * 值不同是失配（B1 报告并抛出；值漂移的替换是 B3 的 R2）。
 */
export function claimTopDownText(expected: string): Text {
    const node = peek()
    if (cursorCharData) {
        if (node !== null && node.nodeType === TEXT_NODE) {
            const text = node as Text
            const value = text.nodeValue!
            if (value !== expected && expected !== '' && value.startsWith(expected)) {
                // 首尾相接的字符数据：切出本单元，余下的成为下一个兄弟，留给后面的单元
                text.splitText(expected.length)
            }
            if (text.nodeValue === expected) {
                cursorNext = text.nextSibling
                return text
            }
        }
        return mismatch(`Text(${JSON.stringify(expected)})`, node)
    }
    if (node !== null && isCommentData(node, 'axii:t')) {
        const text = node.nextSibling
        const close = text?.nextSibling ?? null
        if (text === null || text.nodeType !== TEXT_NODE || !isCommentData(close, 'axii:/t')) {
            return mismatch(`Text(${JSON.stringify(expected)})`, node)
        }
        if (text.nodeValue !== expected) return mismatch(`Text(${JSON.stringify(expected)})`, text)
        cursorNext = close.nextSibling
        node.remove()
        close.remove()
        return text as Text
    }
    if (node !== null && node.nodeType === TEXT_NODE && node.nodeValue === expected) {
        cursorNext = node.nextSibling
        return node as Text
    }
    return mismatch(`Text(${JSON.stringify(expected)})`, node)
}

/**
 * 空的 Text-ph 单元（atom / 函数 child 的值为空，函数结构态的 FTS 尾）：服务端写 `<!--axii:0-->`，认领时在它的位置
 * 插入 Text('') 并删除哨兵。字符数据父节点里没有哨兵（A3），直接插入。缺少哨兵是失配（B1 报告并抛出；B3 的 R4）。
 */
export function claimTopDownEmptyTextPlaceholder(): Text {
    const node = peek()
    if (cursorCharData) return insertTopDownEmptyText()
    if (node === null || !isCommentData(node, 'axii:0')) return mismatch('Comment("axii:0")', node)
    const text = document.createTextNode('')
    cursorParent!.insertBefore(text, node)
    cursorNext = node.nextSibling
    node.remove()
    return text
}

/**
 * 多个 child 里的空字符串（ElementChildText）：CSR 追加一个空 Text。服务端写 `<!--axii:0-->`，
 * 但 null / undefined 之外只有这一个 child 时什么都不写（ssr.serializeChildren 的 soleChild），所以哨兵可有可无：
 * 有就换成 Text('')，没有就在游标处插入。空 Text 不可见，两种写法都不是失配。
 */
export function claimTopDownOptionalEmptyText(): Text {
    const node = peek()
    if (!cursorCharData && node !== null && isCommentData(node, 'axii:0')) return claimTopDownEmptyTextPlaceholder()
    return insertTopDownEmptyText()
}

/**
 * 在游标处插入一个 Text('')，不消费游标处的节点：空的 Comment-ph 文本（服务端在 placeholder 前面什么都不写，
 * §3.2.1 A1c，随后由调用方认领 placeholder），字符数据父节点里的空单元。
 */
export function insertTopDownEmptyText(): Text {
    const text = document.createTextNode('')
    cursorParent!.insertBefore(text, peek())
    return text
}

/**
 * 结构 Comment（Host 的 slot、`fragment start`、`empty`、`computed node`）：游标处必须是 data 相同的 Comment。
 * 不符是失配（B1 报告并抛出；向前查找与插入是 B3 的 R3）。
 */
export function claimTopDownComment(data: string): Comment {
    const node = peek()
    if (node !== null && node.nodeType === COMMENT_NODE && (node as Comment).data === data) {
        cursorNext = node.nextSibling
        return node as Comment
    }
    return mismatch(`Comment(${JSON.stringify(data)})`, node)
}

/**
 * 元素（§2.6.1 第 1 步）：游标处必须是同标签的元素；客户端有静态 id 时 id 也要相符（R1 的匹配行；
 * 近似认领与替换是 B3）。认领后游标移到元素之后，元素的子节点由调用方 enterTopDownElement 之后消费。
 * CAUTION 标签比较同旧模型 tryClaimElement：Element.tagName 只有 HTML 元素是大写，SVG 元素保持原始大小写
 *  （'svg'、'clipPath'）。SVG 按原样比，HTML 按大写比，大小写本身也区分了 HTML / SVG 的同名标签（a / title / style / script）。
 */
export function claimTopDownElement(tag: string, isSVG: boolean, wantId: string | null): Element {
    const expectedTagName = isSVG ? tag : tag.toUpperCase()
    const node = peek(tag.toLowerCase())
    if (node !== null && node.nodeType === ELEMENT_NODE && (node as Element).tagName === expectedTagName) {
        const el = node as Element
        if (wantId !== null && el.id !== wantId) {
            return mismatch(`Element(<${tag} id=${JSON.stringify(wantId)}>)`, el)
        }
        cursorNext = el.nextSibling
        return el
    }
    return mismatch(wantId === null ? `Element(<${tag}>)` : `Element(<${tag} id=${JSON.stringify(wantId)}>)`, node)
}

