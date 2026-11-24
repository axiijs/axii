/**
 * @internal
 * #55 新激活模型的节点指针游标（设计 docs/ssr-support/hydration-top-down.md §2.3、§2.5、§4）。只给新模型用；
 * 旧模型的下标游标（hydration.ts 的 childCursorParent / childCursorIndex）在 #55 S 随旧模型删除。
 *
 * 激活是 ssr.ts serialize 的逆过程：服务端按什么顺序写出节点，各 Host 就按什么顺序从游标处读回。
 *  - 每个 DOM 父节点一层：{parent, next}，next 是下一个未消费的服务端子节点。用节点指针而不是下标：
 *    在游标前插入（空 Text、新建的节点）或删除（axii:t 包边、axii:0 哨兵、失配的单元）都不会让游标漂移。
 *  - 进入一个元素时压一层，元素的子节点消费完之后清扫剩余节点再弹出（R5）。
 *  - 父级从不替子级找 placeholder，子级区域在哪里结束由子级自己决定。
 *
 * 失配（#55 B3，§4.2 R1–R5）：游标处不是期望的节点时报告 HydrationMismatchError（reportHydrationMismatch：无论诊断
 *  是否开启都交给 onError），然后在游标处修复，不中止激活：
 *  - R1 元素：认领（同标签；客户端有静态 id 时 id 也相符）；id 不符时向前找 id 相符的同标签元素（D8），没有就按属性漂移认领
 *    （D2 / D9）；不同标签的元素带着期望的 id 时替换它（D4）；客户端有静态 id 且前方有 id 相符的同标签元素时删除两者之间的
 *    节点、认领它（D6）；否则替换游标处这一个单元（D5、文本单元）。游标处是结构 Comment 或 eof 时新建、插在它前面，
 *    不消费它（它可能是后面某个 Host 的 placeholder）。新建由调用方完成（claimTopDownElement 返回 null）。
 *  - R2 文本单元：值不符时替换 Text；游标处是元素、axii:0 时替换这一个单元；结构 Comment 或 eof 时插入新 Text。
 *  - R3 结构 Comment：在同一父节点向前找 data 相同的 Comment，找到就删除两者之间的节点并认领，找不到就新建、插入。
 *  - R4 axii:0：没有哨兵时插入 Text('')，不向前找（向前找会偷走后面单元的哨兵）。
 *  - R5 父节点结束：剩余节点全部删除，每个父节点报告一次。
 *  按 §4.1，这些选择只影响复用多少服务端节点，不影响结果：节点结构、文本、客户端 props 写下的属性都与 CSR 相同。
 *  向前查找只在同一个父节点内、只在失配时发生，最坏 O(该父节点剩余节点数)。
 *  只容忍 ssr.ts 确实会写出的差异，不报告：非空文本单元可以带也可以不带 axii:t 包边（§3.2.1 A2），字符数据父节点里没有
 *  任何 axii:* 标记（各文本单元首尾相接，A3），textarea 的 value 子文本（认领元素时清掉，见 DOM.ts）。
 *
 * 新建的层（enterTopDownFreshElement）：R1 新建的元素按 CSR 的语义建好——它的子节点在一层没有服务端节点的游标里消费，
 *  每个单元都直接新建、插到末尾（≡ CSR createElement 的 child 循环与各 Host 的 render），不报告（失配在新建处已经报告过一次）。
 *  这样子描述、预先构造的子 Host（含它们的组件、函数、列表）都经同一条认领路径落到新元素里，元数据按 CSR 的路径规则提升到
 *  所属 StaticHost（§4.2「并入所属 StaticHost 的收集表」）。
 *
 * CAUTION 这个模块在 axii/ssr 的导入链上（ssr.ts → ComponentHost → createHost → 这里）：模块顶层不能碰 document / Node。
 */
import {
    isCharacterDataParent,
    isCommentData,
    reportHydrationMismatch,
    runOutsideHydration,
    summarizeChild,
} from "./hydration"
import {COMMENT_NODE, ELEMENT_NODE, TEXT_NODE} from "./nodeType"
import {ROOT_SLOT} from "./hydrationElement"

// 当前层
let cursorParent: ParentNode | null = null
let cursorNext: ChildNode | null = null
// 字符数据父节点（textarea / title / style / script…，§2.6.6）：各文本单元从同一个 Text 上依次切出自己的前缀，
//  空单元插入 Text('')，不认领任何 axii:*。判定与旧模型共用 hydration.isCharacterDataParent。
let cursorCharData = false
// 激活容器这一层：容器上的 STYLE / SCRIPT / LINK 留给 migrateSsrStyleTags 与之后的容器清扫，认领、R3 / R5 的删除都跳过它们（§2.3、D13）
let cursorIsContainer = false
// 失配新建的元素这一层：没有服务端节点（cursorNext 恒为 null），各单元直接新建、插入，不报告
let cursorFresh = false
// 这一层已经报告过失配：R5 每层只报告一次；之后在这一层认领的元素可能跨了角色，认领步骤先清掉它的属性（§4.1）
let cursorMismatched = false
// 外层：每层 FRAME_SIZE 项，平铺在一个数组里
const FRAME_SIZE = 6
const outerFrames: any[] = []

function pushFrame(parent: ParentNode, isContainer: boolean, fresh: boolean, mismatched: boolean): void {
    if (cursorParent !== null) outerFrames.push(cursorParent, cursorNext, cursorCharData, cursorIsContainer, cursorFresh, cursorMismatched)
    cursorParent = parent
    cursorNext = fresh ? null : parent.firstChild
    cursorCharData = !isContainer && isCharacterDataParent(parent)
    cursorIsContainer = isContainer
    cursorFresh = fresh
    cursorMismatched = mismatched
}

function popFrame(): void {
    if (outerFrames.length) {
        cursorMismatched = outerFrames.pop()
        cursorFresh = outerFrames.pop()
        cursorIsContainer = outerFrames.pop()
        cursorCharData = outerFrames.pop()
        cursorNext = outerFrames.pop()
        cursorParent = outerFrames.pop()
    } else {
        cursorParent = null
        cursorNext = null
        cursorCharData = false
        cursorIsContainer = false
        cursorFresh = false
        cursorMismatched = false
    }
}

// 新模型报告过的失配条数（只增不减）：入口据此判断这次激活有没有失配（verifyTopDownRawElements）
let mismatchCount = 0

/** 报告一条失配（交给 onError，不抛出），并记下这一层已经失配。 */
function reportAt(expected: string, actual: ChildNode | null): void {
    cursorMismatched = true
    report(expected, summarizeChild(actual))
}

// onError 是用户代码，与 useEffect、事件监听器一样在激活上下文之外执行（runOutsideHydration）：它创建的 JSX 是真实节点，
//  它改动的已激活列表按 CSR 插入新行。B3 起激活在报告之后继续，回调里的改动会落在这次激活的树上（#55 B3 独立审查）
function report(expected: string, actual: string): void {
    mismatchCount++
    runOutsideHydration(() => reportHydrationMismatch(expected, actual))
}

/** 到目前为止报告过的失配条数，入口在激活前后各读一次。 */
export function getTopDownMismatchCount(): number {
    return mismatchCount
}

function isContainerAsset(node: ChildNode): boolean {
    if (node.nodeType !== ELEMENT_NODE) return false
    const name = (node as Element).localName
    return name === 'style' || name === 'script' || name === 'link'
}

/**
 * 文本单元的标记：axii:t 包边（含落单的 axii:/t）与空 Text-ph 的哨兵 axii:0。其余 Comment 是结构 Comment（Host 的 slot、
 * fragment start、empty、computed node……，或者来历不明的注释）：R1 / R2 不消费它，它可能是后面某个 Host 的 placeholder。
 */
function isTextUnitMarker(node: ChildNode): boolean {
    if (node.nodeType !== COMMENT_NODE) return false
    const data = (node as Comment).data
    return data === 'axii:t' || data === 'axii:/t' || data === 'axii:0'
}

/**
 * 游标处的节点。容器这一层先跳过 STYLE / SCRIPT / LINK（期望的正是同标签元素时不跳）：服务端样式通常写在
 * 激活内容前面，它们由 migrateSsrStyleTags 迁移，不属于任何 Host 区域。
 */
function peek(expectedElementName?: string): ChildNode | null {
    let node = cursorNext
    if (cursorIsContainer) {
        // 服务端样式（data-axii-ssr）永远跳过：期望的正是 <style> 时也不能把它当作应用自己的元素
        while (node !== null && isContainerAsset(node)
            && ((node as Element).localName !== expectedElementName || (node as Element).hasAttribute('data-axii-ssr'))) {
            node = node.nextSibling
        }
        cursorNext = node
    }
    return node
}

/** 在游标处插入一个新节点，游标不动（下一个单元仍从 cursorNext 开始）。 */
function insertAtCursor<T extends Node>(node: T): T {
    cursorParent!.insertBefore(node, cursorNext)
    return node
}

/** 删除游标处的节点，直到 target（不含），游标停在 target。容器这一层的 STYLE / SCRIPT / LINK 留下（D13）。 */
function removeUntil(target: ChildNode | null): void {
    let node = cursorNext
    while (node !== null && node !== target) {
        const next: ChildNode | null = node.nextSibling
        if (!(cursorIsContainer && isContainerAsset(node))) node.remove()
        node = next
    }
    cursorNext = target
}

/**
 * 删除游标处的一个单元（R1 的 D4 / D5、文本单元，R2 的元素 / axii:0）：axii:t 包边连同其中的 Text 与 axii:/t，
 * 或者一个节点。游标移到这个单元之后。
 */
function removeUnitAtCursor(): void {
    const node = cursorNext!
    let next = node.nextSibling
    if (isCommentData(node, 'axii:t')) {
        if (next !== null && next.nodeType === TEXT_NODE) {
            const text = next
            next = text.nextSibling
            text.remove()
        }
        if (next !== null && isCommentData(next, 'axii:/t')) {
            const close = next
            next = close.nextSibling
            close.remove()
        }
    }
    node.remove()
    cursorNext = next
}

/**
 * 容器这一层的向前查找不越过 `<!--root-->`：根 Host 的区域到它为止，后面只可能是杂节点——或者激活中 error 监听器销毁了 root、
 * 又往同一个容器渲染的新内容（root.render 追加在容器末尾）。被丢弃的树仍按 R1–R5 修复完自己（Host 都要拿到真实的
 * placeholder 才能销毁），越过去就会认领、删除新内容。找的就是 `root` 时不受限。
 */
function stopsLookAhead(node: ChildNode): boolean {
    return cursorIsContainer && node.nodeType === COMMENT_NODE && (node as Comment).data === ROOT_SLOT
}

/** 游标之后、同一父节点里第一个 data 相同的 Comment（R3 的向前查找）。 */
function findCommentAhead(from: ChildNode | null, data: string): Comment | null {
    for (let node = from; node !== null; node = node.nextSibling) {
        if (node.nodeType === COMMENT_NODE && (node as Comment).data === data) return node as Comment
        if (stopsLookAhead(node)) return null
    }
    return null
}

/** 游标之后、同一父节点里第一个同标签且 id 相符的元素（R1 的 D6 / D8）。 */
function findElementAhead(from: ChildNode | null, tagName: string, id: string): Element | null {
    for (let node = from; node !== null; node = node.nextSibling) {
        if (node.nodeType === ELEMENT_NODE && (node as Element).tagName === tagName && (node as Element).id === id) return node as Element
        if (stopsLookAhead(node)) return null
    }
    return null
}

/** R5：父节点结束时还有剩余节点，全部删除，报告一次。 */
function sweepRest(expected: string): void {
    const node = peek()
    if (node === null) return
    reportAt(expected, node)
    removeUntil(null)
}

// ───────────────────────── 层 ─────────────────────────

/**
 * 激活容器作为最外层（§2.3「根容器」）。返回进入之前外层的深度，交给 leaveTopDownContainer
 * （在 finally 里调用：激活中止时也要恢复，回调里嵌套的激活返回后外层照常继续）。
 */
export function enterTopDownContainer(container: ParentNode): number {
    const depth = cursorParent === null ? -1 : outerFrames.length
    pushFrame(container, true, false, false)
    return depth
}

/** 恢复到 enterTopDownContainer 之前的状态。 */
export function leaveTopDownContainer(depth: number): void {
    if (depth === -1) {
        // 最外层的激活：清空外层，popFrame 把当前层也复位
        outerFrames.length = 0
        popFrame()
        return
    }
    outerFrames.length = depth + FRAME_SIZE
    popFrame()
}

/**
 * 容器这一层消费完之后（根 Host 已认领 <!--root-->）：剩下的只能是 STYLE / SCRIPT / LINK，其余节点按 R5 删除并报告。
 * 不弹出这一层：之后的 migrateSsrStyleTags 与容器清扫（D13）不经过游标。
 */
export function finishTopDownContainer(): void {
    sweepRest('end of hydrate root children')
}

/**
 * 进入一个被认领的元素（或 table 的隐含 tbody），游标从它的第一个子节点开始。approximate：这个元素是近似认领的（§4.1），
 * 它可能跨了角色，子树里的认领也一样：这一层从「已失配」开始，子元素同样先清掉服务端的属性（#55 B3 独立审查）。
 */
export function enterTopDownElement(parent: ParentNode, approximate: boolean): void {
    pushFrame(parent, false, false, approximate)
}

/**
 * 进入一个失配新建的元素（R1）：这一层没有服务端节点，各单元直接新建、插到末尾，不报告。
 * 元素建好之后由调用方 placeTopDownFreshElement 放到外层的游标处。
 */
export function enterTopDownFreshElement(el: ParentNode): void {
    pushFrame(el, false, true, false)
}

/**
 * 元素的子节点消费完：游标之后的剩余节点按 R5 删除（每个父节点报告一次），然后回到父元素那一层。
 */
export function exitTopDownElement(): void {
    if (cursorNext !== null) sweepRest('end of element children')
    popFrame()
}

/** 游标所在的父节点（激活之外为 null）。只给开发期诊断与用例用。 */
export function getTopDownCursorParent(): ParentNode | null {
    return cursorParent
}

// ───────────────────────── 失配新建的元素：建好、绑定之后再插入（#73） ─────────────────────────

// 等待插入的新建元素：[占位, 元素] 平铺。占位在新建时就放在游标处（游标之前的节点之后不会再被删除或移动），
//  所属 StaticHost 绑定了响应式属性之后（insertTopDownFreshElements）把占位换成元素。
const pendingFresh: ChildNode[] = []

/**
 * R1 新建的元素（子节点、props 都已应用）放到游标处。父节点也是新建的：直接插入，随父节点一起连入文档。
 * 父节点在文档里：先放一个占位，元素等所属 StaticHost 绑定了响应式属性之后才连入文档——CSR 的 StaticHost 在插入之前
 * 绑定（#73）：已连入文档的 <script> 一拿到文本就按当时的 type 执行，<link rel=stylesheet> 一有 href 就按当时的 integrity
 * 请求，自定义元素的 connectedCallback 读到的是那一刻的属性。
 */
export function placeTopDownFreshElement(el: Element): void {
    if (cursorFresh) {
        insertAtCursor(el)
        return
    }
    pendingFresh.push(insertAtCursor(document.createComment('axii:fresh')), el)
}

/** 所属 StaticHost 开始消费之前的位置，交给 insertTopDownFreshElements。 */
export function markTopDownFreshElements(): number {
    return pendingFresh.length
}

/**
 * 所属 StaticHost 绑定了响应式属性之后（StaticHost.hydrate / CompactElementHost.hydrate 第 4 步之后）：把它的子树里
 * 新建的元素换到占位的位置。嵌套的 StaticHost 先于外层完成，各自只处理 mark 之后自己的那些。
 */
export function insertTopDownFreshElements(mark: number, insert: (el: HTMLElement, before: Comment) => unknown): void {
    for (let i = mark; i < pendingFresh.length; i += 2) {
        const anchor = pendingFresh[i] as Comment
        // CAUTION 经调用方传入的 DOM.insertBefore 插入（≡ CSR 的 Host 插入）：插入之前写入待生效的 stylesheet；插进 <select> 的
        //  <option> 按 select 记下的值重放选中状态——裸 replaceChild 会让浏览器选中第一项（select 的 props 在新建的 option
        //  连入之前就应用了）。模块不直接导入 DOM.ts：DOM.ts 导入这里。
        insert(pendingFresh[i + 1] as HTMLElement, anchor)
        anchor.remove()
    }
    pendingFresh.length = mark
}

/** 激活中止时丢弃还没插入的新建元素（入口的 finally 调用）。 */
export function dropTopDownFreshElements(mark: number): void {
    pendingFresh.length = mark
}

// ───────────────────────── 原始标记（dangerouslySetInnerHTML）的内容 ─────────────────────────

// 干净认领的原始元素：[元素, 客户端的原始标记] 平铺。原始标记的内容不透明（§2.6.2），干净认领保留服务端的节点；
//  但别处有失配时，按位置认领的可能是另一个角色的元素（列表少一行，后面的行整体前移），它的内容是另一段标记。
const claimedRaw: unknown[] = []

/** 认领步骤记下干净认领的原始元素（近似认领、新建的元素已经按客户端写入了标记）。 */
export function rememberTopDownRawElement(el: Element, markup: unknown): void {
    claimedRaw.push(el, markup)
}

/** 入口开始激活之前的位置，交给 verifyTopDownRawElements / dropTopDownRawElements。 */
export function markTopDownRawElements(): number {
    return claimedRaw.length
}

/**
 * 激活结束时，如果这次激活报告过失配（§4.1：失配之后按位置认领可能跨了角色）：逐个检查干净认领的原始元素，内容与客户端
 * 标记在同一个元素里解析的结果（≡ CSR 的 innerHTML 赋值）逐节点相同就保留，否则报告并换成客户端的标记。
 * 没有任何失配的激活不检查，匹配路径上不多解析一遍。
 */
export function verifyTopDownRawElements(mark: number, mismatchesBefore: number): void {
    if (mismatchCount !== mismatchesBefore) {
        for (let i = mark; i < claimedRaw.length; i += 2) {
            const el = claimedRaw[i] as Element
            const markup = claimedRaw[i + 1]
            const probe = el.cloneNode(false) as Element
            probe.innerHTML = markup as string
            if (!sameChildNodes(el, probe)) {
                report(`raw markup of <${el.localName}>`, summarizeChild(el.firstChild))
                el.innerHTML = markup as string
            }
        }
    }
    claimedRaw.length = mark
}

/** 激活中止时丢弃记下的原始元素（入口的 finally 调用）。 */
export function dropTopDownRawElements(mark: number): void {
    claimedRaw.length = mark
}

function sameChildNodes(a: Node, b: Node): boolean {
    const x = a.childNodes
    const y = b.childNodes
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) if (!x[i].isEqualNode(y[i])) return false
    return true
}

// ───────────────────────── 认领 ─────────────────────────

/**
 * 非空文本单元（§2.5：元素的静态文本、Text-ph、Comment-ph 的文本、函数的文本态）：`axii:t` 包边的 Text 或裸 Text。
 * 包边随即删除，游标移到单元之后。字符数据父节点里从游标处的 Text 切出 expected 这一段，余下的留给后面的单元。
 * 失配按 R2：值不同时换成新 Text；游标处是元素、axii:0 等时替换这一个单元；结构 Comment 或 eof 时插入新 Text。
 * 字符数据里不是剩余文本的前缀时分不出这一段的边界：剩余的整段换成本单元，后面的单元在末尾插入。
 */
export function claimTopDownText(expected: string): Text {
    if (cursorFresh) return insertAtCursor(document.createTextNode(expected))
    const node = peek()
    if (node !== null && node.nodeType === TEXT_NODE) {
        const text = node as Text
        if (cursorCharData) {
            const value = text.nodeValue!
            // 首尾相接的字符数据：切出本单元，余下的成为下一个兄弟，留给后面的单元
            if (value !== expected && expected !== '' && value.startsWith(expected)) text.splitText(expected.length)
        }
        cursorNext = text.nextSibling
        if (text.nodeValue === expected) return text
        return replaceDriftedText(text, expected)
    }
    if (node !== null && isCommentData(node, 'axii:t')) {
        const text = node.nextSibling
        const close = text?.nextSibling ?? null
        if (text !== null && text.nodeType === TEXT_NODE && isCommentData(close, 'axii:/t')) {
            cursorNext = close.nextSibling
            node.remove()
            close.remove()
            if (text.nodeValue === expected) return text as Text
            return replaceDriftedText(text as Text, expected)
        }
    }
    const description = `Text(${JSON.stringify(expected)})`
    reportAt(description, node)
    // 元素、axii:0、残缺的包边：替换这一个单元；结构 Comment 或 eof：插入
    if (node !== null && (node.nodeType !== COMMENT_NODE || isTextUnitMarker(node))) removeUnitAtCursor()
    return insertAtCursor(document.createTextNode(expected))
}

// R2：值漂移。游标已经在 text 之后；新 Text 换到它的位置（identity 是新的）
function replaceDriftedText(text: Text, expected: string): Text {
    reportAt(`Text(${JSON.stringify(expected)})`, text)
    const replacement = document.createTextNode(expected)
    text.replaceWith(replacement)
    return replacement
}

/**
 * 空的 Text-ph 单元（atom / 函数 child 的值为空，函数结构态的 FTS 尾）：服务端写 `<!--axii:0-->`，认领时在它的位置
 * 插入 Text('') 并删除哨兵。字符数据父节点里没有哨兵（A3），直接插入。缺少哨兵时按 R4 插入 Text('') 并报告，
 * 不向前找：向前找会偷走后面单元的哨兵。
 */
export function claimTopDownEmptyTextPlaceholder(): Text {
    if (cursorFresh || cursorCharData) return insertTopDownEmptyText()
    const node = peek()
    if (node === null || !isCommentData(node, 'axii:0')) {
        reportAt('Comment("axii:0")', node)
        return insertTopDownEmptyText()
    }
    const text = document.createTextNode('')
    cursorParent!.insertBefore(text, node)
    cursorNext = node.nextSibling
    node.remove()
    return text
}

/**
 * 在游标处插入一个 Text('')，不消费游标处的节点：空的 Comment-ph 文本（服务端在 placeholder 前面什么都不写，
 * §3.2.1 A1c，随后由调用方认领 placeholder），字符数据父节点里的空单元，以及服务端不写哨兵的空字符串 child
 * （null / undefined 之外唯一的 child，ssr.serializeChildren 的 soleChild，由调用方按 children 判定）。
 */
export function insertTopDownEmptyText(): Text {
    const text = document.createTextNode('')
    cursorParent!.insertBefore(text, peek())
    return text
}

/**
 * 结构 Comment（Host 的 slot、`fragment start`、`empty`、`computed node`）：游标处是 data 相同的 Comment 就认领。
 * 不符时按 R3：在同一父节点向前找第一个 data 相同的 Comment，找到就删除两者之间的节点并认领它，找不到就新建、插入。
 */
export function claimTopDownComment(data: string): Comment {
    // 字符数据父节点里服务端写不出注释（CSR 在这里为 boolean child 建的 PrimitiveHost 有 <!--unhandledChild-->，
    //  服务端跳过 boolean，ssr.serializeChildren）：与空单元一样在游标处插入，DOM ≡ CSR
    if (cursorFresh || cursorCharData) return insertAtCursor(document.createComment(data))
    const node = peek()
    if (node !== null && node.nodeType === COMMENT_NODE && (node as Comment).data === data) {
        cursorNext = node.nextSibling
        return node as Comment
    }
    reportAt(`Comment(${JSON.stringify(data)})`, node)
    const ahead = findCommentAhead(node, data)
    if (ahead === null) return insertAtCursor(document.createComment(data))
    removeUntil(ahead)
    cursorNext = ahead.nextSibling
    return ahead
}

function isWhitespaceText(node: ChildNode): boolean {
    return node.nodeType === TEXT_NODE && /^\s*$/.test(node.nodeValue!)
}

// 失配报告里的期望（只在失配时拼接，匹配路径不分配）
function describeElement(tag: string, wantId: string | null): string {
    return wantId === null ? `Element(<${tag}>)` : `Element(<${tag} id=${JSON.stringify(wantId)}>)`
}

// 最近一次 claimTopDownElement 是不是近似认领（§4.1）：id 漂移、向前查找后的认领，或者这一层已经报告过失配。
//  认领步骤据此先清掉元素的全部属性再应用 props（DOM.hydrateElementDescription）。
let lastClaimApproximate = false

/** 最近一次 claimTopDownElement 认领的元素是不是要先清掉属性（§4.1，见 lastClaimApproximate）。 */
export function isTopDownClaimApproximate(): boolean {
    return lastClaimApproximate
}

/**
 * 元素（§2.6.1 第 1 步，§4.2 R1）：认领游标处同标签的元素（客户端有静态 id 时 id 也相符），游标移到元素之后，
 * 元素的子节点由调用方 enterTopDownElement 之后消费。失配时按 R1（见模块说明）近似认领、删除之间的节点，
 * 或者返回 null：调用方按 CSR 新建这个元素（enterTopDownFreshElement），建好之后 placeTopDownFreshElement。
 * 新建的层里永远返回 null，不报告。
 * CAUTION 标签比较同旧模型 tryClaimElement：Element.tagName 只有 HTML 元素是大写，SVG 元素保持原始大小写
 *  （'svg'、'clipPath'）。SVG 按原样比，HTML 按大写比，大小写本身也区分了 HTML / SVG 的同名标签（a / title / style / script）。
 */
export function claimTopDownElement(tag: string, isSVG: boolean, wantId: string | null): Element | null {
    lastClaimApproximate = false
    if (cursorFresh) return null
    const expectedTagName = isSVG ? tag : tag.toUpperCase()
    let node = peek(tag.toLowerCase())
    // 容器这一层的空白 Text：页面模板里激活容器的缩进、换行（<div id="app">\n  ${html}\n</div>），服务端输出不会在期望元素的
    //  位置写出空白 Text。按杂节点删除（报告一次），继续在游标处认领；按 D5 替换的话，没有静态 id 的根元素会整棵新建，
    //  服务端的节点（输入状态、焦点、iframe）全部丢失（#55 B3 独立审查）
    if (cursorIsContainer && node !== null && isWhitespaceText(node)) {
        reportAt(describeElement(tag, wantId), node)
        do {
            const next: ChildNode | null = node!.nextSibling
            node!.remove()
            cursorNext = next
            node = peek(tag.toLowerCase())
        } while (node !== null && isWhitespaceText(node))
    }
    if (node !== null && node.nodeType === ELEMENT_NODE) {
        const el = node as Element
        if (el.tagName === expectedTagName) {
            if (wantId === null || el.id === wantId) {
                // 这一层已经报告过失配：这次认领可能跨了角色（§4.1）
                lastClaimApproximate = cursorMismatched
                cursorNext = el.nextSibling
                return el
            }
            // 同标签、id 不符：前方有 id 相符的同标签元素就删除两者之间的节点、认领它（D8），否则按属性漂移认领（D2 / D9）
            reportAt(describeElement(tag, wantId), el)
            const target = findElementAhead(el.nextSibling, expectedTagName, wantId) ?? el
            removeUntil(target)
            cursorNext = target.nextSibling
            lastClaimApproximate = true
            return target
        }
        if (wantId !== null && el.id === wantId) {
            // 不同标签的元素带着期望的 id：它就是这个角色，替换（D4）
            reportAt(describeElement(tag, wantId), el)
            removeUnitAtCursor()
            return null
        }
    }
    if (node === null || (node.nodeType === COMMENT_NODE && !isTextUnitMarker(node))) {
        // 结构 Comment 或 eof：新建、插在它前面，不消费（它可能是后面某个 Host 的 placeholder）
        reportAt(describeElement(tag, wantId), node)
        return null
    }
    // 不同标签的元素、文本单元：客户端有静态 id 且前方有 id 相符的同标签元素时，删除之间的节点、认领它（D6）；
    //  否则替换这一个单元（D5）。没有静态 id 时不向前找：那会偷走后面兄弟的元素
    reportAt(describeElement(tag, wantId), node)
    if (wantId !== null) {
        const ahead = findElementAhead(node.nextSibling, expectedTagName, wantId)
        if (ahead !== null) {
            removeUntil(ahead)
            cursorNext = ahead.nextSibling
            lastClaimApproximate = true
            return ahead
        }
    }
    removeUnitAtCursor()
    return null
}
