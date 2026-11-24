import {
    createElement,
    DetachStyledInfo,
    ExtendedElement,
    Fragment,
    insertBefore,
    RefHandleInfo,
    restoreSelectValueAfterRemoval,
    setAttribute,
    setPendingStyleSheetFlush,
    UnhandledChildInfo,
    UnhandledPlaceholder
} from "./DOM";
import {Host, PathContext} from "./Host";
import {isAtom} from "data0";
import {hasOnPrefix} from "./markupNames";
import {LightBindingEffect} from "./LightBindingEffect.js";
import {trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {createHost} from "./createHost";
import {assert, isPlainObject, removeNodesBetween} from "./util";
import {ComponentHost} from "./ComponentHost.js";
import {createLinkedNode, LinkedNode} from "./LinkedList";
import {FunctionHost} from "./FunctionHost";
import {
    trackCompactHostDestroyed,
    trackHostDestroyed,
    trackStyleHostStateCreated,
    trackStyleHostStateDestroyed
} from "./retainedObjectDiagnostics.js";
import {isAxiiDiagnosticsEnabled, reportAxiiError, withReactiveTrace} from "./diagnostics";
import type {AxiiSource} from "./diagnostics";
import {claimFragmentStartBefore, getHydrateRollingStyleBase, isAnyHydrating, isHydrating, reconcileFragmentHydrateChildren, runOutsideHydration, stripAxiiTextBoundariesBetween} from "./hydration";
import {hydrateElementDescription, rematerializeDeferredFragmentChildren, type TopDownInnerHosts} from "./DOM";
import {createHydrateHost} from "./createHost";
import {HydrationElement, HydrationSlot, isHydrationElement, isHydrationSlot, TEXT_SLOT, UNHANDLED_CHILD_SLOT} from "./hydrationElement";
import {
    claimTopDownComment,
    insertTopDownFreshElements,
    markTopDownFreshElements,
    markTopDownHostPlaced,
    placeTopDownExistingNode,
    removeTopDownCounterpart,
    reportTopDownLiveNode,
} from "./hydrationCursor";
import {innerHTMLOf} from "./markupNames";
import {isDomNode} from "./nodeType";
import {compareStyleSheetOrder, getStyleSheetOrder, type StyleSheetOrder} from "./styleCascade";
import {isFragmentNode} from "./nodeType";
import {
    contentStyleId,
    evaluateStyleEntries,
    isBoundProp,
    isDynamicProp,
    generateInlineAnimationContent as generateInlineAnimationContentShared,
    generateStyleContent as generateStyleContentShared,
    getComponentTypeId,
    isNestedStyleObject as isNestedStyleObjectShared,
    sheetDeclaredKeys,
    splitInlineDeclarations,
    splitStyleObject as splitStyleObjectShared,
    prepareStyleContent,
    renderPreparedStyle,
    serializePreparedStyle,
    stringifyKeyFrameObject as stringifyKeyFrameObjectShared,
    stringifyStyleObject as stringifyStyleObjectShared,
    SSR_STYLE_CLASSES_ATTRIBUTE,
    toCssSafeComponentName,
} from "./styleSerialize";

// CAUTION 覆盖原来的判断，增加关于 isReactiveValue 的判断。这样就不会触发响应式值的读行为，不会泄漏到上层的 computed。
// data0 2.0 移除了 reactive() 深层代理，响应式值只剩 atom 和 function 两种形态。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function (name: string, value: any) {
    // CAUTION 以 on 开头（不区分大小写）的名字一律直接放行给 setAttribute，从不建立响应式属性绑定（#49）：
    //  真正的事件（isEventName）在那里绑定；once / onclick / ONCLICK 这类非事件的 on* prop 在那里丢弃。
    //  判成响应式属性的话，ReactiveAttributeEffect 会在渲染时调用 onclick={fn} 的 fn、读 ONCLICK={atom}，
    //  再把结果写成 attribute（ONCLICK 被 HTML 转成可执行的 onclick）。
    //  hasOnPrefix 替换了原来的 isEventName 判断，首字符不是 o/O 的名字代价不变。
    if (hasOnPrefix(name)) return true

    if (Array.isArray(value) && value.some(isReactiveValue)) {
        return false
    } else if (isReactiveValue(value)) {
        return false
    }
    // CAUTION className 对象形式的 value 可以是 atom/函数（className={{active: isActive}}），
    //  必须按响应式属性处理（走 LightBindingEffect），否则依赖永远建立不起来。
    if ((name === 'className' || name === 'class') && isClassNameWithReactiveValue(value)) {
        return false
    }
    return originalIsValidAttribute(name, value)
}

function isClassNameWithReactiveValue(value: any): boolean {
    if (Array.isArray(value)) return value.some(isClassNameWithReactiveValue)
    if (!isPlainObject(value)) return false
    for (const key in value as {[k:string]:any}) {
        if (isReactiveValue((value as {[k:string]:any})[key])) return true
    }
    return false
}

// CAUTION 分类谓词只保留一份（atom 本身也是 function，先判断 typeof 更便宜）。
//  曾经存在语义完全相同的 isReactiveValue/isAtomLike 两个副本——同一个判定存在两份，
//  未来行为分叉时就是新的 bug 面。
function isReactiveValue(v: any) {
    return typeof v === 'function' || isAtom(v)
}

const isAtomLike = isReactiveValue

// CAUTION 响应式数组 prop 的逐项求值要递归进嵌套数组（见 DOM.ts flattenNestedArray 的说明）：
//  转发进来的内层数组里同样可以有 atom/函数项（组件写 className={['card', props.className]}，
//  调用方传 ['x', () => active() && 'on']）。只求值一层的话内层的函数项原样落到
//  setAttribute，触发 "className can only be string or ..." 断言。
//  模块级函数而不是每次更新新建的闭包；atom/函数的返回值不再往下求值（与之前一致）。
function evaluateReactiveItem(v: any): any {
    return Array.isArray(v) ? v.map(evaluateReactiveItem) : isAtomLike(v) ? v() : v
}


function generateGlobalElementStaticId(hostPath: LinkedNode<Host>, elementPath: number[]) {
    const hosts: Host[] = []
    let current: LinkedNode<Host>|null = hostPath
    while (current) {
        hosts.unshift(current.node)
        current = current.prev
    }
    return `${hosts.map(host => host.pathContext.elementPath.join('_')).join('-')}-${elementPath.join('_')}`
}

function GetPathToLastComponent(hostPath: LinkedNode<Host>) {
    const pathToGenerateId: Host[] = []
    let current: LinkedNode<Host>|null = hostPath
    while (current) {
        pathToGenerateId.unshift(current.node)
        if (current.node instanceof ComponentHost) {
            break
        }
        current = current.prev
    }
    return pathToGenerateId
}

// CAUTION 组件名要作为 stylesheet 的 CSS class 使用，而 JS 的函数名远比 CSS identifier
//  宽（F54）：对象字面量 key 推断的 name 可以是任意字符串（{'ns.card': fn} 的注册表写法
//  推断出带 '.' 的名字），HOC/工厂返回的箭头函数 name 是 ''：
//  - 名字里的 '.' 会让 selector 变成复合选择器（.ns.card0P... 要求同时具有两个 class），
//    永远匹配不上元素——嵌套样式/boundProps 样式静默丢失且没有任何报错（insertRule 成功）；
//  - 空名让 id 以 typeId 数字开头，`.3P...` 是非法 selector，整张 stylesheet 被 insertRule
//    整条拒绝——样式全部静默丢失。
//  归一化逻辑见 styleSerialize.toCssSafeComponentName。

function generateComponentElementStaticId(path: Host[], elementPath: number[]) {
    // CAUTION path[0] 只有在 GetPathToLastComponent 真的找到组件时才是 ComponentHost：
    //  整棵子树都不在任何组件里（root.render 直接渲染元素/函数节点/列表）时，
    //  path[0] 是普通 host（StaticHost/RxListHost 等）甚至路径为空（F15），
    //  绝不能对它读 .type/.typeId——普通 host 没有 type 字段，直接 TypeError。
    const lastComponentHost = path[0] instanceof ComponentHost ? path[0] as ComponentHost : undefined
    const pathToGenerateId = lastComponentHost ? path.slice(1) : path
    const componentName = lastComponentHost ? toCssSafeComponentName(lastComponentHost.type.name.toString()) : 'GLOBAL'
    const typeId = lastComponentHost ? getComponentTypeId(lastComponentHost.type) : ''
    return `${componentName}${typeId}P${pathToGenerateId.map(host => host.pathContext.elementPath.join('_')).concat(elementPath.join('_')).join('-')}`
}

// CAUTION 只有 object/function 才能 defineProperty。style 的合法取值还包括字符串
//  （style="color:red" / $item:style={'color:red'}），对原始值标记直接跳过，
//  否则 AOP 传入字符串 style 会在 defineProperty 处 TypeError（F17）。
//  同类假设：frozen/sealed 的对象（Object.freeze 的静态 boundProps/样式常量是自然写法）
//  defineProperty 新属性同样直接 TypeError，必须一并跳过——标记只是优化用元数据，
//  丢标记的代价（按覆盖语义处理）远小于渲染期崩溃。
function canMarkProp(obj: any) {
    return !!obj && (typeof obj === 'object' || typeof obj === 'function') && Object.isExtensible(obj)
}

export function markBoundProp(obj: any) {
    if (canMarkProp(obj)) {
        Object.defineProperty(obj, '__bound', {
            value: true,
            enumerable: false
        })
    }
    return obj
}

export function markAopProp(obj: any) {
    if (canMarkProp(obj)) {
        Object.defineProperty(obj, '__aop', {
            value: true,
            enumerable: false
        })
    }
    return obj
}

export function markDynamicProp(obj: any) {
    if (canMarkProp(obj)) {
        Object.defineProperty(obj, '__dynamic', {
            value: true,
            enumerable: false
        })
    }
    return obj
}

// CAUTION 这些判断必须对 null/undefined 安全，
//  条件样式 style={cond ? {...} : null} 是很自然的写法，value 可能是 null。
// isBoundProp / isDynamicProp 定义在 styleSerialize（CSR 与 SSR 共用的唯一一份），这里再导出保持公开 API 不变
export {isBoundProp, isDynamicProp}

export function isAopProp(obj: any) {
    return !!(obj && obj['__aop'])
}


/** Reclaim SSR rolling base id (`${staticId}R…`) from element classList during hydrate. */
function reclaimRollingStyleId(el: HTMLElement, staticId: string): string | null {
    const prefix = staticId + 'R'
    for (const cls of Array.from(el.classList)) {
        if (!cls.startsWith(prefix)) continue
        // Class forms: `${base}F${i}` or `${base}F${i}I${n}` — base is `${staticId}R${seq}`
        const fIndex = cls.indexOf('F', prefix.length)
        if (fIndex < 0) continue
        const base = cls.slice(0, fIndex)
        if (/^R\d+$/.test(base.slice(staticId.length))) return base
    }
    return null
}

/**
 * After hydrate adoptedStyleSheets are live, remove SSR `<style data-axii-ssr>` tags.
 */
export function migrateSsrStyleTags(container?: ParentNode | null) {
    const selector = 'style[data-axii-ssr]'
    container?.querySelectorAll(selector).forEach(tag => tag.remove())
    // Applications may also place SSR styles in the document head. Those tags can serve
    // several separately hydrated roots, so wait for their stylesheet classes to be claimed.
    if (typeof document !== 'undefined' && !document.querySelector(`[${SSR_STYLE_CLASSES_ATTRIBUTE}]`)) {
        document.querySelectorAll(selector).forEach(tag => tag.remove())
    }
}

// class name 中的字母含义
// P path
// R random chars
// F fragment
// I iterator count

class StyleManager {
    public styleScripts = new Map<string, CSSStyleSheet>()
    public elToStyleId = new WeakMap<HTMLElement, string>()
    public elToStyleIdItorNum = new WeakMap<HTMLElement, number>()
    // 上一次 update 写入的 inline style key，用于清除本次不再出现的残留 key
    public elToInlineStyleKeys = new WeakMap<HTMLElement, Set<string>>()
    // 上一次 update 里字符串条目声明的属性名（#79）：下一次更新时先全部删掉再重写；null = 有拆不准的字符串，整体清空
    public elToInlineStringNames = new WeakMap<HTMLElement, string[] | null>()
    // 当前挂在元素 class 上的 stylesheet class id：响应式 className 整体覆写 class attribute 后，
    //  必须能把这些框架管理的 class 补回去，否则 stylesheet 样式静默丢失。
    public elToStyleClassIds = new WeakMap<HTMLElement, Set<string>>()
    // Rolling entries retain the previous frame's sheets for cloneNode. Track actual ids so
    // switching an entry to content or inline styles cannot strand a sheet in an older frame.
    private elToRollingStyleFrames = new WeakMap<HTMLElement, {
        active: Set<string> | undefined
        previous: Set<string> | undefined
    }>()
    // CAUTION 记账 key 是「拥有这些样式的元素 host」（StaticHost/CompactElementHost 自身），
    //  而不是 hostPath 上的父级 host：列表行共享同一个 hostPath 节点（RxListHost），
    //  按父级记账时稳态 churn（列表始终非空）的行永远等不到计数归零，
    //  被销毁行的 stylesheet 引用计数不释放，adoptedStyleSheets 无上限增长。
    //  值是「id → 本 host 内的使用次数」：内容 id 跨元素共用，同一个 host 里的多个元素
    //  （或同一元素先后换回同一份内容）会多次引用同一个 id，按 Set 记账会让引用计数只减一次、表永远不删。
    public hostToStyleIds = new WeakMap<Host, Map<string, number>>()
    // 元素 → 各条目当前挂着的内容 id（下标 = 条目序号）。内容 id 不进 elToStyleClassIds，
    //  只用这一份数组记账：重算时同一下标换了 id 就释放旧的，条目消失/改走行内就释放。
    public elToContentStyleIds = new WeakMap<HTMLElement, (string | undefined)[]>()
    private sheetToOrder = new WeakMap<CSSStyleSheet, StyleSheetOrder>()
    public hostMountCount = new WeakMap<Host, number>()
    public idToRefCount = new Map<string, number>()
    // 共享静态 stylesheet id -> 内容签名。「相同 path ⇒ 相同样式内容」只是猜测：
    //  静态样式对象可以携带每实例不同的数据（style={{'& b': {color: item.color}}}），
    //  签名不一致时该实例必须退化为元素独享的 rolling id，否则所有实例都套用第一个实例的样式。
    public idToStaticStyleSignature = new Map<string, string>()
    /** Deterministic rolling-id sequence (replaces Math.random); hydrate reclaims SSR classes. */
    private nextRollingSeq = 0
    private rollingBaseOwners = new Map<string, HTMLElement>()
    private hostToRollingBaseIds = new WeakMap<Host, Set<string>>()
    // document.adoptedStyleSheets 的写入合并，见 beginBatch
    private batchDepth = 0
    private batchRoot: object | undefined
    private pendingInserts: Set<CSSStyleSheet> | undefined
    private pendingDeletes: Set<CSSStyleSheet> | undefined
    // 单例上唯一的一个闭包，登记给 DOM.ts 的插入路径
    private flushPending = () => this.flushStyleSheetWrites()

    /**
     * 合并一段同步渲染/销毁里对 document.adoptedStyleSheets 的写入。
     *
     * CAUTION 每建/删一张表就整体赋值一次 adoptedStyleSheets，浏览器 setter 的开销是 O(表数)。
     *  内容共用之后表数通常很小，但嵌套规则里带「每行不同的数据」（每行一个 hover 颜色）时
     *  表数 = 行数，挂载/清空 N 行就是 O(N²)：4000 行各约 1.5s，而内容相同的 4000 行是 18ms / 2ms。
     *  批次内只排队，批次结束时一次赋值（仍然走 setter，宿主的 setter 钩子照常看到）。
     *
     *  不变量——样式对用户代码的可见性与逐张写入完全一样：
     *  1. 没有打开批次时立即写入（响应式样式更新、直接调用 createStyleSheet/deleteStyleSheet）；
     *  2. 最外层批次结束时写入：批次都是同步的（元素子树的 render、RxList 的行渲染/patch/销毁），
     *     结束点在返回用户代码、执行 flushAttachQueue（layoutEffect/ref）之前；
     *  3. 框架把节点插入已连通的父节点之前写入（DOM.ts insertBefore/insertAfter）——
     *     待写入的表只可能属于还没连入文档的元素；
     *  4. 已连通的元素更新样式时立即写入（StyleManager.update）；
     *  5. 批次不跨 root：内层 root（Portal）的批次结束时写入，它随后自己 appendChild 并派发 attach。
     *  hydrate 时元素本来就在文档里，StaticHost.render 不打开批次。
     *
     * 返回外层批次的 root，原样传给 endBatch。必须配对调用（try/finally）。
     * @internal
     */
    beginBatch(root: object): object | undefined {
        const outerRoot = this.batchRoot
        this.batchRoot = root
        this.batchDepth++
        return outerRoot
    }
    /** @internal */
    endBatch(root: object, outerRoot: object | undefined) {
        this.batchRoot = outerRoot
        if (--this.batchDepth === 0 || outerRoot !== root) this.flushStyleSheetWrites()
    }
    private flushStyleSheetWrites() {
        const inserts = this.pendingInserts
        const deletes = this.pendingDeletes
        if (inserts === undefined && deletes === undefined) return
        this.pendingInserts = undefined
        this.pendingDeletes = undefined
        if (inserts !== undefined) setPendingStyleSheetFlush(undefined)
        const current = document.adoptedStyleSheets
        // CAUTION 必须在副本上操作再整体赋值：current 是 ObservableArray，原地改动绕过 setter
        let sheets: CSSStyleSheet[] | undefined
        if (deletes !== undefined && deletes.size) {
            sheets = current.filter(sheet => !deletes.has(sheet))
        }
        if (inserts !== undefined && inserts.size) {
            sheets ??= [...current]
            // 按创建顺序逐张定位，结果与逐张写入完全相同（顺序相等的表保持创建顺序）
            for (const styleSheet of inserts) {
                const index = this.locateStyleSheet(sheets, this.sheetToOrder.get(styleSheet)!)
                if (index === sheets.length) {
                    sheets.push(styleSheet)
                } else {
                    sheets.splice(index, 0, styleSheet)
                }
            }
        }
        if (sheets !== undefined) document.adoptedStyleSheets = sheets
    }
    // 批次内返回 true：表已排队（或同一批里创建又删除，从未写进过 document）
    private deferStyleSheetDelete(styleSheet: CSSStyleSheet): boolean {
        if (this.pendingInserts !== undefined && this.pendingInserts.delete(styleSheet)) return true
        if (this.batchDepth === 0) return false
        ;(this.pendingDeletes ??= new Set()).add(styleSheet)
        return true
    }

    getStyleSheetId(hostPath: LinkedNode<Host>, elementPath: number[], el: ExtendedElement | null, hydrateReclaimEl?: ExtendedElement | null) {
        const pathToLastComponent = GetPathToLastComponent(hostPath)
        const staticId = generateComponentElementStaticId(pathToLastComponent, elementPath)
        if (!el && !pathToLastComponent.some(host => host instanceof FunctionHost)) return staticId
        if (!el) return this.allocateRollingStyleId(staticId, hydrateReclaimEl)

        const assignedId = this.elToStyleId.get(el)
        const assignedOwner = assignedId && this.rollingBaseOwners.get(assignedId)
        if (assignedId && (!assignedOwner || assignedOwner === el)) return assignedId
        const id = this.allocateRollingStyleId(staticId, el)
        this.elToStyleId.set(el, id)
        return id
    }

    private allocateRollingStyleId(staticId: string, reclaimEl?: ExtendedElement | null): string {
        // Separate SSR payloads can start their sequences at R0. A mounted owner reserves
        // its base through inline/content transitions, even after its last frame expires.
        let id = reclaimEl && isAnyHydrating()
            ? getHydrateRollingStyleBase(reclaimEl) ?? reclaimRollingStyleId(reclaimEl, staticId)
            : null
        while (!id || this.rollingBaseOwners.has(id)) {
            id = `${staticId}R${this.nextRollingSeq++}`
        }
        return id
    }

    private getRollingStyleId(owner: Host, staticId: string, el: ExtendedElement): string {
        const assignedId = this.elToStyleId.get(el)
        const assignedOwner = assignedId && this.rollingBaseOwners.get(assignedId)
        if (assignedId && assignedOwner === el) return assignedId

        const id = assignedId && !assignedOwner ? assignedId : this.allocateRollingStyleId(staticId, el)
        this.rollingBaseOwners.set(id, el)
        let ownedIds = this.hostToRollingBaseIds.get(owner)
        if (!ownedIds) this.hostToRollingBaseIds.set(owner, ownedIds = new Set())
        ownedIds.add(id)
        this.elToStyleId.set(el, id)
        return id
    }
    public createStyleSheet(id: string, styleObject: StyleObject, group: number = 0) {
        const prepared = prepareStyleContent(styleObject)
        const styleSheet = this.installStyleSheet(renderPreparedStyle(`.${id}`, prepared), getStyleSheetOrder(group, prepared))
        // 直接调用方（不经过 update）期望表立即生效，即使正处在某个批次里（见 beginBatch）
        if (this.pendingInserts !== undefined) this.flushStyleSheetWrites()
        return styleSheet
    }
    private installStyleSheet(rules: string[], order: StyleSheetOrder) {
        const styleSheet = new CSSStyleSheet()
        // CAUTION 逐条 insertRule，而不是把所有规则拼成一个字符串 replaceSync：
        //  stylesheet 路径（嵌套样式/boundProps/keyframes）的值经 stringifyStyleObject
        //  直接字符串拼接，样式值里的 '}' 能闭合当前规则、把后面的字符当成新的全局规则注入
        //  （style={{'&:hover': {width: untrusted}}} 逃逸成 `.x:hover{width:100px} body{...}`）。
        //  insertRule 只接受单条规则，这种「一个字符串里多条规则」会被浏览器判为语法错误
        //  整条拒绝，注入无法越界成全局样式。generateStyleContent 已把内容拆成「每个元素
        //  恰好一条规则 / 一个 @-rule 块」，逐条插入与之前 join 的语义一致；合法的带引号
        //  值（content: "a}b"）浏览器解析时 '}' 在引号内不闭合规则，照常保留。
        for (const rule of rules) {
            try {
                styleSheet.insertRule(rule, styleSheet.cssRules.length)
            } catch (e) {
                // 被拒绝的规则（注入企图产生的多规则、浏览器不认的 at-rule 等）跳过而不是
                //  让整个 stylesheet 构建崩溃。开发期给出可见提示，帮助定位是哪条样式出了问题。
                if (__DEV__) {
                    /* eslint-disable no-console */
                    console.error('[axii] skipped an invalid CSS rule while building a stylesheet. ' +
                        'A style value may contain characters that break out of its rule (e.g. "}"): ', rule, e)
                    /* eslint-enable no-console */
                }
            }
        }
        this.insertStyleSheet(styleSheet, order)
        return styleSheet
    }
    // CAUTION 仍用 setter 整体赋值（不用 push/splice）：宿主会挂 adoptedStyleSheets 的 setter
    //  钩子做跨文档镜像，绕过 setter 的写法它看不到。内容共用之后表数是「不同内容的种数」，
    //  整体赋值的开销不再随元素数增长。
    private insertStyleSheet(styleSheet: CSSStyleSheet, order: StyleSheetOrder) {
        this.sheetToOrder.set(styleSheet, order)
        if (this.batchDepth > 0) {
            if (this.pendingInserts === undefined) {
                this.pendingInserts = new Set()
                setPendingStyleSheetFlush(this.flushPending)
            }
            this.pendingInserts.add(styleSheet)
            return
        }
        const current = document.adoptedStyleSheets
        const first = this.locateStyleSheet(current, order)
        document.adoptedStyleSheets = first === current.length ?
            [...current, styleSheet] :
            [...current.slice(0, first), styleSheet, ...current.slice(first)]
    }
    // 新表在 current 里的插入位置（current.length 表示追加到末尾）
    private locateStyleSheet(current: readonly CSSStyleSheet[], order: StyleSheetOrder): number {
        const lastOrder = this.sheetToOrder.get(current[current.length - 1])
        let first = 0
        let last = current.length
        if (lastOrder && compareStyleSheetOrder(lastOrder, order) <= 0) first = last
        // Find the first Axii sheet with greater precedence. Leave foreign sheets in
        // place and check only as far left as necessary to find an ordered midpoint.
        while (first < last) {
            const middle = Math.floor((first + last) / 2)
            let index = middle
            let existingOrder = this.sheetToOrder.get(current[index])
            while (!existingOrder && index > first) {
                existingOrder = this.sheetToOrder.get(current[--index])
            }
            if (existingOrder && compareStyleSheetOrder(existingOrder, order) > 0) {
                last = index
            } else {
                first = middle + 1
            }
        }
        return first
    }
    deleteStyleSheet(id: string): CSSStyleSheet | null {
        const styleSheet = this.removeStyleSheet(id)
        // 直接调用方期望表立即从 document 上消失，即使正处在某个批次里（见 beginBatch）
        if (styleSheet && this.pendingDeletes !== undefined) this.flushStyleSheetWrites()
        return styleSheet
    }
    // 引用计数归零时的内部移除：批次内只排队
    private removeStyleSheet(id: string): CSSStyleSheet | null {
        const styleSheet = this.styleScripts.get(id)
        if (!styleSheet) return null

        this.styleScripts.delete(id)
        if (!this.deferStyleSheetDelete(styleSheet)) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== styleSheet)
        }
        return styleSheet
    }
    collect(host: Host, id: string) {
        let ids = this.hostToStyleIds.get(host)
        if (!ids) {
            ids = new Map()
            this.hostToStyleIds.set(host, ids)
            trackStyleHostStateCreated(host)
        }
        ids.set(id, (ids.get(id) ?? 0) + 1)
        this.updateRefCount(id, +1)
    }
    // Release one host reference when a content class goes away or a rolling frame expires.
    release(host: Host, id: string) {
        const ids = this.hostToStyleIds.get(host)
        if (!ids) return
        const uses = ids.get(id)
        if (uses === undefined) return
        if (uses > 1) ids.set(id, uses - 1)
        else ids.delete(id)
        if (this.updateRefCount(id, -1) <= 0) {
            this.removeStyleSheet(id)
        }
    }
    mount(host: Host) {
        const count = ((this.hostMountCount.get(host) ?? 0) + 1)
        this.hostMountCount.set(host, count)
        return count
    }
    unmount(host: Host) {
        const count = ((this.hostMountCount.get(host) ?? 0) - 1)
        if (count > 0) {
            this.hostMountCount.set(host, count)
            return count
        }

        this.cleanup(host)
        this.hostMountCount.delete(host)
    }
    cleanup(host: Host) {
        const rollingBases = this.hostToRollingBaseIds.get(host)
        if (rollingBases) {
            for (const base of rollingBases) this.rollingBaseOwners.delete(base)
            this.hostToRollingBaseIds.delete(host)
        }
        if (this.hostToStyleIds.has(host)) {
            trackStyleHostStateDestroyed(host)
        }
        const ids = this.hostToStyleIds.get(host)
        if (!ids) return
        let styleSheetsToDelete: Set<CSSStyleSheet> | undefined
        for (const [id, uses] of ids) {
            const count = this.updateRefCount(id, -uses)
            if (count <= 0) {
                const styleSheet = this.styleScripts.get(id)
                if (styleSheet) {
                    (styleSheetsToDelete ??= new Set()).add(styleSheet)
                }
                this.styleScripts.delete(id);
                // 共享静态 id 的内容签名随 stylesheet 一起退役（rolling id 不在签名表里，delete 无害）
                this.idToStaticStyleSignature.delete(id)
            }
        }
        this.hostToStyleIds.delete(host)
        // CAUTION 没有要删的表就不赋值：共用之后列表行卸载时绝大多数只是减引用，
        //  每行都整体赋值一次会让卸载 N 行变成 O(N × 表数)，并让宿主的 setter 钩子白跑 N 次。
        if (styleSheetsToDelete) {
            const toDelete = styleSheetsToDelete
            if (this.batchDepth > 0 || this.pendingInserts !== undefined) {
                // 批次内排队，由 flushStyleSheetWrites 一次写入（见 beginBatch）
                for (const styleSheet of toDelete) {
                    if (!this.deferStyleSheetDelete(styleSheet)) {
                        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== styleSheet)
                    }
                }
            } else {
                document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => !toDelete.has(sheet))
            }
        }
    }
    updateRefCount(id: string, delta: number): number {
        const count = (this.idToRefCount.get(id) ?? 0) + delta
        if (count <= 0) {
            this.idToRefCount.delete(id)
        } else {
            this.idToRefCount.set(id, count)
        }
        return count
    }
    trackStyleClassAdded(el: ExtendedElement, id: string) {
        let ids = this.elToStyleClassIds.get(el)
        if (!ids) this.elToStyleClassIds.set(el, ids = new Set())
        ids.add(id)
    }
    // 响应式 className/class 更新整体覆写了 class attribute 之后，
    //  把 StyleManager 管理的 stylesheet class 补回去。
    reapplyStyleClasses(el: ExtendedElement) {
        const ids = this.elToStyleClassIds.get(el)
        if (ids) {
            for (const id of ids) el.classList.add(id)
        }
        const contentIds = this.elToContentStyleIds.get(el)
        if (contentIds) {
            for (const id of contentIds) if (id !== undefined) el.classList.add(id)
        }
    }
    update(owner: Host, hostPath: LinkedNode<Host>, elementPath: number[], styleObject: StyleObject | StyleObject[], el: ExtendedElement) {
        // style 中有嵌套写法/animation/at-rules 等原生不能识别的，都会当做 unhandledAttr 走到这里。当然也包括 atom 和 function
        // 求值 + 展开与 SSR 共用一份（条目序号两边必须一致，内容 id 里带序号）。
        const evaluatedEntries = evaluateStyleEntries(styleObject)

        const styleItorNum = this.elToStyleIdItorNum.get(el) ?? 0
        // 路径信息对所有条目相同，只算一次（之前每个条目都重新走一遍 hostPath）
        const pathToLastComponent = GetPathToLastComponent(hostPath)
        const hasFunctionHostInPath = pathToLastComponent.some(host => host instanceof FunctionHost)
        // 跨元素共享的静态 id 基础（路径含 FunctionHost 时不共享）
        const sharedStaticBaseId = hasFunctionHostInPath ? null : generateComponentElementStaticId(pathToLastComponent, elementPath)
        let rollingBaseId: string | undefined
        // 前面是否已经有行内声明：之后的 stylesheet 条目要让它们让位（见下面 stylePatches 的 CAUTION）
        let sawInline = false
        const splitStyleObjects = evaluatedEntries.map(({value: evaluatedStyleObject, entryIsDynamic, isBound}, index) => {
            // 分离普通和嵌套样式
            const { simpleStyles, nestedStyles } = this.splitStyleObject(evaluatedStyleObject)
            const usesStyleSheet = isBound || Object.keys(nestedStyles).length > 0
            let yieldPatch: StyleObject | undefined
            if (usesStyleSheet) {
                if (sawInline) yieldPatch = inlineYieldPatchOf(evaluatedStyleObject, entryIsDynamic)
            } else if (!sawInline) {
                sawInline = hasInlineDeclarations(simpleStyles)
            }
            const prepared = usesStyleSheet ? prepareStyleContent(evaluatedStyleObject) : undefined
            const signature = prepared?.shareable ? serializePreparedStyle(prepared) : undefined
            let isDynamic = entryIsDynamic || !!prepared && (prepared.isReactive || !prepared.shareable)

            // A component path can produce different CSS for different instances (F30).
            if (signature !== undefined && !isDynamic && sharedStaticBaseId) {
                const sharedIdWithIndex = `${sharedStaticBaseId}F${index}`
                const existingSignature = this.idToStaticStyleSignature.get(sharedIdWithIndex)
                if (existingSignature === undefined) {
                    this.idToStaticStyleSignature.set(sharedIdWithIndex, signature)
                } else if (existingSignature !== signature) {
                    isDynamic = true
                }
            }
            // Multi-subject selectors and unsupported values retain a per-element rolling id.
            const contentId = signature !== undefined && (isDynamic || !sharedStaticBaseId) ?
                contentStyleId(signature, index) : undefined
            let styleSheetIdWithIndex: string | undefined
            let styleSheetIdWithItorNum: string | undefined
            if (usesStyleSheet && contentId === undefined) {
                const styleSheetId = isDynamic ? (rollingBaseId ??= this.getRollingStyleId(
                    owner, sharedStaticBaseId ?? generateComponentElementStaticId(pathToLastComponent, elementPath), el,
                )) : sharedStaticBaseId!
                styleSheetIdWithIndex = `${styleSheetId}F${index}`
                styleSheetIdWithItorNum = `${styleSheetIdWithIndex}I${styleItorNum}`
            }
            return {
              index,
              isDynamic,
              usesStyleSheet,
              contentId,
              styleSheetIdWithIndex,
              styleSheetIdWithItorNum,
              prepared,
              signature,
              simpleStyles,
              yieldPatch,
            }
        })
        // 是否应该更新 itor？
        // 如果使用了 itor-based style id，就要更新
        let shouldUpdateItor = false
        const stylePatches: StyleObject[] = []
        // Record the classes actually applied this frame, including when entries switch modes.
        let activeRollingClassIds: Set<string>|undefined
        let contentIds = this.elToContentStyleIds.get(el)
        splitStyleObjects.forEach(so => {
            // CAUTION style 数组的契约是「后写的条目赢」（mergeProp 把 AOP / bindProps / 外部传入的 style
            //  放在后面正是为了覆写），但行内声明永远压过 stylesheet 规则：[{color:'blue'}, {color:'red',
            //  '&:hover':{…}}] 里先写的 blue 会赢，外部覆盖一旦带上 &:hover（或来自 bindProps）就静默失效。
            //  这里按条目顺序写行内样式，stylesheet 条目在自己的位置上把它顶层声明的属性从行内删掉
            //  （值为 '' 的 patch，el.style[k] = '' 即 removeProperty），交给它的规则；更靠后的行内条目
            //  还能再写回来。删除由 CSSOM 完成，简写/分项天然正确（{margin: 0} 之后的 {marginTop: 5}
            //  只删 margin-top）。不把前面的行内条目搬进 stylesheet：那会让每行/每帧不同的行内值各自
            //  建一张表（列表里 O(N) 张表、每次更新都换表），也会改变它们与外部 CSS 的特异性关系。
            //  已知局限（与 v4.8.1 相同，#57）：更早的行内值仍然压过后面条目里的**嵌套**规则
            //  （[{color:'red'}, {'&:hover': {color:'blue'}}] 的 hover 不生效）。用户文档与推荐写法见
            //  README「Style arrays」；为什么不用 !important / var(--…) 绕过，见 auditStylesFormsState.spec 的 test.fails。
            if (so.yieldPatch) stylePatches.push(so.yieldPatch)
            // 如果是 boundProps，优先使用 stylesheet，因为 boundProps 通常是组件级别的基础样式
            // 如果包含 nested style，只能使用 stylesheet，因为依赖于 CSS selector
            if (so.contentId !== undefined) {
                const previousId = contentIds?.[so.index]
                // 内容没变：class、引用、表都不动
                if (previousId === so.contentId) return
                if (!this.styleScripts.has(so.contentId)) {
                    const rules = renderPreparedStyle(`.${so.contentId}`, so.prepared!, 'active')
                    const order = getStyleSheetOrder(so.index, so.prepared!, so.signature)
                    this.styleScripts.set(so.contentId, this.installStyleSheet(rules, order))
                }
                el.classList.add(so.contentId)
                this.collect(owner, so.contentId)
                if (!contentIds) this.elToContentStyleIds.set(el, contentIds = [])
                contentIds[so.index] = so.contentId
                if (previousId !== undefined) {
                    el.classList.remove(previousId)
                    this.release(owner, previousId)
                }
            } else if (so.usesStyleSheet) {
                // 如果样式是动态的，则使用 itor 滚动 classname
                // 这里「动态」意味着它可能是
                // - Atom 或者 function
                // - 来自 boundProps 并且是通过 function evaluate 获得
                // （内容 id 能算出来时不会走到这里，只剩序列化失败的条目）
                const shouldUseRollingStyleId = so.isDynamic
                const finalStyleSheetId = shouldUseRollingStyleId ? so.styleSheetIdWithItorNum! : so.styleSheetIdWithIndex!
                if (shouldUseRollingStyleId) {
                    (activeRollingClassIds ??= new Set()).add(finalStyleSheetId)
                }
                if (styleItorNum === 0 || shouldUseRollingStyleId) {
                    shouldUpdateItor = true

                    // 如果是第一次应用样式，或者需要滚动生成样式，则生成 stylesheet
                    const styleSheet = this.styleScripts.get(finalStyleSheetId) ?? this.installStyleSheet(
                        renderPreparedStyle(`.${finalStyleSheetId}`, so.prepared!, shouldUseRollingStyleId ? 'active' : undefined),
                        getStyleSheetOrder(so.index, so.prepared!, so.signature),
                    )
                    el.classList.add(finalStyleSheetId)
                    this.trackStyleClassAdded(el, finalStyleSheetId)
                    // 保存 stylesheet，更新引用计数
                    this.styleScripts.set(finalStyleSheetId, styleSheet)
                    this.collect(owner, finalStyleSheetId)
                }
            } else {
                // 收集普通样式，最后统一赋值
                stylePatches.push(so.simpleStyles)
                // nestedStyles 肯定是空的，这里就不用管了
            }
        })
        // 内容 id 的「形态翻转」清理：上一轮某个条目挂着内容 id，这一轮它消失了、改走行内、
        //  或退回了 rolling 路径——摘掉 class、释放引用，否则旧表里的嵌套规则永远生效。
        if (contentIds) {
            for (let i = 0; i < contentIds.length; i++) {
                const id = contentIds[i]
                if (id !== undefined && splitStyleObjects[i]?.contentId === undefined) {
                    el.classList.remove(id)
                    contentIds[i] = undefined
                    this.release(owner, id)
                }
            }
        }
        const rollingFrames = this.elToRollingStyleFrames.get(el)
        if (rollingFrames) {
            if (rollingFrames.active) {
                const trackedIds = this.elToStyleClassIds.get(el)!
                for (const id of rollingFrames.active) {
                    el.classList.remove(id)
                    trackedIds.delete(id)
                }
                shouldUpdateItor = true
            }
            if (rollingFrames.previous) {
                for (const id of rollingFrames.previous) this.release(owner, id)
            }
            rollingFrames.previous = rollingFrames.active
            rollingFrames.active = activeRollingClassIds
            if (!rollingFrames.active && !rollingFrames.previous) this.elToRollingStyleFrames.delete(el)
        } else if (activeRollingClassIds) {
            this.elToRollingStyleFrames.set(el, {active: activeRollingClassIds, previous: undefined})
        }
        if (shouldUpdateItor) {
            this.elToStyleIdItorNum.set(el, styleItorNum + 1)
            if (__DEV__) {
              // DEV: 把 styleItorNum 打到 DOM 节点上方便调试
              el.setAttribute('data-axii-style-itor-num', String(styleItorNum + 1))
            }
        }
        // CAUTION 响应式 style 重算后，新值可能不再包含上一次写过的某些 key
        //  （条件样式 () => cond() && {...} 翻转为 falsy、或对象换了一批 key）。
        //  inline style 是按 key 赋值的，必须显式清掉本次不再出现的 key，否则旧样式残留。
        //  字符串条目只写它声明的属性（#79，见 DOM.applyStyleText）：按共用的拆分器记下它声明的属性名（CSS 写法），
        //  下一次更新时先全部删掉，再由 setAttribute 按条目顺序重写全部条目——前面条目写下的其余属性不动。
        //  不能只删「这次不再声明的」：字符串的值一变成浏览器不接受的（'color: notacolor'、`width: ${w}px` 里
        //  w 为 undefined），setProperty 忽略它，上一次的值就残留了；用同样的值重新渲染是没有这个属性的。
        //  对象条目照旧只删本次不再出现的 key（对象条目是热路径，不多删多写）。
        //  拆不准的字符串（见 splitInlineDeclarations）不知道写过哪些属性：记 null，下一次更新时整体清空行内样式再重写。
        const previousInlineKeys = this.elToInlineStyleKeys.get(el)
        const previousStringNames = this.elToInlineStringNames.get(el)
        const nextInlineKeys = new Set<string>()
        let nextStringNames: string[] | null | undefined
        for (const patch of stylePatches) {
            if (typeof patch === 'string') {
                if (nextStringNames === null) continue
                const declarations = splitInlineDeclarations(patch)
                if (declarations === null) nextStringNames = null
                else for (const declaration of declarations) (nextStringNames ??= []).push(declaration[0])
            } else if (patch && typeof patch === 'object') {
                for (const k in patch) nextInlineKeys.add(k)
            }
        }
        if (previousStringNames === null) {
            el.style.cssText = ''
        } else {
            if (previousStringNames) for (const name of previousStringNames) el.style.removeProperty(name)
            if (previousInlineKeys) {
                for (const k of previousInlineKeys) {
                    if (nextInlineKeys.has(k)) continue
                    // 带 "-" 的是 CSS 写法的名字（自定义属性、对象里写成 'margin-top' 的 key），removeProperty 认得；
                    //  驼峰 key 只能按 el.style[k] = '' 删除
                    if (k.indexOf('-') >= 0) {
                        el.style.removeProperty(k)
                    } else {
                        // @ts-ignore
                        el.style[k] = ''
                    }
                }
            }
        }
        if (previousInlineKeys || nextInlineKeys.size) {
            this.elToInlineStyleKeys.set(el, nextInlineKeys)
        }
        if (nextStringNames !== undefined) this.elToInlineStringNames.set(el, nextStringNames)
        else if (previousStringNames !== undefined) this.elToInlineStringNames.delete(el)
        setAttribute(el, 'style', stylePatches, el instanceof SVGElement)
        // CAUTION 已连通的元素不能等批次结束：批次内的用户代码（组件函数体、函数节点）可能马上读它的
        //  computed style。排队的表只允许属于还没连入文档的元素（见 beginBatch 的不变量 4）。
        if (this.pendingInserts !== undefined && el.isConnected) this.flushStyleSheetWrites()
    }
    isNestedStyleObject(key: string, styleObject: any): boolean {
        return isNestedStyleObjectShared(key, styleObject)
    }
    splitStyleObject(styleObject: StyleObject): { simpleStyles: StyleObject, nestedStyles: StyleObject } {
        return splitStyleObjectShared(styleObject) as { simpleStyles: StyleObject, nestedStyles: StyleObject }
    }
    stringifyStyleObject(styleObject: StyleObject): string {
        return stringifyStyleObjectShared(styleObject)
    }
    stringifyKeyFrameObject(keyframeObject: StyleObject): string {
        return stringifyKeyFrameObjectShared(keyframeObject)
    }
    generateInlineAnimationContent(selector: string, styleObject: StyleObject): string[] {
        return generateInlineAnimationContentShared(selector, styleObject)
    }
    generateStyleContent(selector: string, styleObject: StyleObject): string[] {
        return generateStyleContentShared(selector, styleObject)
    }
}

type StyleObject = { [k: string]: any }

function hasInlineDeclarations(simpleStyles: StyleObject | string): boolean {
    if (typeof simpleStyles === 'string') return true
    for (const _ in simpleStyles) return true
    return false
}

// 静态（非 dynamic、值里没有函数/atom）的 stylesheet 条目对象 → 它的让位 patch（null 表示无需让位）。
//  bindProps 的样式对象被一个组件的所有实例共用：列表里每行每次更新都不必重新求值、分配。
const staticYieldPatches = new WeakMap<object, StyleObject | null>()

// stylesheet 条目把它顶层声明的属性从前面的行内样式里删掉（见 StyleManager.update 的 CAUTION）
function inlineYieldPatchOf(styleObject: StyleObject, entryIsDynamic: boolean): StyleObject | undefined {
    if (!styleObject || typeof styleObject !== 'object') return undefined
    const cacheable = !entryIsDynamic && !hasFunctionValue(styleObject)
    if (cacheable) {
        const cached = staticYieldPatches.get(styleObject)
        if (cached !== undefined) return cached ?? undefined
    }
    const keys = sheetDeclaredKeys(styleObject)
    let patch: StyleObject | undefined
    if (keys) {
        patch = {}
        for (const key of keys) patch[key] = ''
    }
    if (cacheable) staticYieldPatches.set(styleObject, patch ?? null)
    return patch
}

function hasFunctionValue(styleObject: StyleObject): boolean {
    for (const key in styleObject) {
        const value = styleObject[key]
        if (typeof value === 'function') return true
        if (Array.isArray(value)) {
            for (const item of value) if (typeof item === 'function') return true
        }
    }
    return false
}

// 添加全局配置对象
export const StaticHostConfig = {
    autoGenerateTestId: false
}

// 开发期：已被消费过响应式元数据（unhandledChildren/unhandledAttr/refHandles/detachStyle）
//  的元素。axii 的 JSX 元素是真实 DOM，元数据在第一次渲染时被一次性取走——
//  同一个元素实例再次渲染（组件里缓存元素跨条件分支复用、同一元素写在两个位置）时
//  绑定已经不存在，文本/属性永远停在旧值且没有任何报错。开发期给出明确警告。
//  纯静态元素（本来就没有元数据）不受影响，不进这个集合。
//  CAUTION fragment 无条件登记：fragment 的内容节点在第一次渲染时被整体搬进文档，
//  fragment 自身从此变空——纯静态元素的复用碰巧可用（元素被搬移），
//  纯静态 fragment 的复用一定渲染成空白，是更隐蔽的静默错误。
const consumedReactiveElements = new WeakSet<object>()
function warnIfRenderingConsumedElement(source: object) {
    if (consumedReactiveElements.has(source)) {
        /* eslint-disable no-console */
        console.error(
            isFragmentNode(source) ?
                '[axii] This fragment has already been rendered once: its child nodes were moved ' +
                'into the document by the previous render, so rendering it again produces NOTHING. ' +
                'Create a fresh fragment each time (e.g. build JSX inside the function child), ' +
                'or use reusable() from RenderContext to move a subtree.' :
                '[axii] This element has already been rendered once: its reactive bindings ' +
                '(function/atom children, reactive attributes, refs) were consumed by the previous ' +
                'render and will NOT work here. Create a fresh element each time (e.g. build JSX inside ' +
                'the function child), or use reusable() from RenderContext to move a subtree.'
        )
        /* eslint-enable no-console */
        return
    }
    const el = source as ExtendedElement
    if (isFragmentNode(source) ||
        el.unhandledChildren || el.unhandledAttr || el.refHandles || el.detachStyledChildren) {
        consumedReactiveElements.add(source)
    }
}

const EMPTY_PATH: number[] = []

/**
 * #55 新模型：按文档顺序收集描述子树里的动态 child（≡ CSR createElement 提升后 StaticHost 根元素上的 unhandledChildren：
 * 顺序、path、source 逐项相同）。分类与 DOM.hydrateDescriptionChildren 的遍历逐项一致：null / undefined 与文本单元跳过，
 * 子描述递归（Fragment 也多一级 path），现成的 DOM 节点留给遍历显式抛错，其余是动态 child（函数含 atom 用 TEXT_SLOT）。
 * 唯一的文本 child（非 Fragment）是 CSR 的 textContent 快速路径，没有动态 child；内容是原始标记的元素不消费 children。
 * source：最近的带 JSX source 的祖先或自身（≡ liftElementMetadata 的继承规则）。
 */
// 一次收集里已经走过的描述与现成节点。同一个描述（或现成节点）在同一棵静态子树里出现两次时，CSR 的 child 循环只在第一次提升
//  它的动态 child（之后它的元数据已被消费），这里也只收集一次；遍历时第二次出现按现成节点处理、不取子 Host
//  （DOM.hydrateExistingChild）。否则后面兄弟的子 Host 会错位（#55 B4 独立审查）。收集不重入（嵌套的 StaticHost 在遍历中才收集），
//  所以用一个模块级的 Set，每次收集前清空。
const collectedOnce = new Set<object>()

function collectTopDownDynamicChildren(desc: HydrationElement, path: number[], inheritedSource: AxiiSource | undefined, out: UnhandledChildInfo[]) {
    const rawProps = desc.rawProps
    const isFragment = desc.tag === Fragment
    if (!isFragment && rawProps && innerHTMLOf(rawProps.dangerouslySetInnerHTML) != null) return
    const children = desc.rawChildren!
    const childrenLength = children.length
    if (!isFragment && childrenLength === 1) {
        const t = typeof children[0]
        if (t === 'string' || t === 'number' || t === 'bigint') return
    }
    const source = (rawProps ? rawProps.__source as AxiiSource | undefined : undefined) ?? inheritedSource
    for (let index = 0; index < childrenLength; index++) {
        const child = children[index]
        if (child == null) continue
        const childType = typeof child
        if (childType === 'string' || childType === 'number' || childType === 'bigint') continue
        if (isHydrationElement(child)) {
            // 已认领的描述（同一个描述出现第二次，C6）按它的 node 处理，元数据在第一次已被提升走（DOM.hydrateExistingChild）
            if (child.node === null && !collectedOnce.has(child)) {
                collectedOnce.add(child)
                collectTopDownDynamicChildren(child, path.concat(index), source, out)
            }
        } else if (isDomNode(child)) {
            if (collectedOnce.has(child)) continue
            collectedOnce.add(child)
            // 现成的节点（§2.6.8）：CSR 的 child 循环把它的 unhandledChildren（带真实 placeholder 的动态 child）提升到父级，
            //  ≡ liftElementMetadata 的 path 与 source 规则。它们由 createTopDownInnerHost 按 CSR 构造、遍历到它时按 CSR 渲染
            const dynamic = (child as ExtendedElement).unhandledChildren
            if (dynamic?.length) {
                const childSource = (child as ExtendedElement).__axiiSource ?? source
                for (const info of dynamic) {
                    out.push({placeholder: info.placeholder, child: info.child, path: path.concat(index, info.path), source: info.source ?? childSource})
                }
            }
        } else {
            out.push({
                placeholder: (childType === 'function' ? TEXT_SLOT : UNHANDLED_CHILD_SLOT) as unknown as UnhandledPlaceholder,
                child,
                path: path.concat(index),
                source,
            })
        }
    }
}

// CAUTION 小 elementPath 驻留池：同一模板位置在长列表的每一行都会产生一个内容
//  相同的 path 数组（如每行文本绑定的 [0]），驻留后全列表共享一份（每行省一个
//  数组 ~28B）。驻留的数组语义上是 frozen 的：所有消费方（样式 id、诊断、
//  StyleManager）都只读。上限防御动态生成的超宽模板把池撑爆——超限后退回
//  独享数组，只是少省内存，不影响正确性。
const INTERNED_PATH_LIMIT = 4096
const internedPaths = new Map<string, number[]>()
function internElementPath(path: number[]): number[] {
    if (path.length > 3) return path
    const key = path.join(',')
    let interned = internedPaths.get(key)
    if (interned === undefined) {
        if (internedPaths.size >= INTERNED_PATH_LIMIT) return path
        internedPaths.set(key, interned = path)
    }
    return interned
}

/**
 * @internal
 *
 * 响应式属性绑定 effect。用带字段的子类而不是「LightBindingEffect + 构造器闭包」：
 * 闭包要捕获 el/key/value/path/isSVG/host 等 6 个变量（一个闭包对象 + 一个 Context），
 * 子类把它们放进实例槽位，每个属性绑定省 ~50B 常驻内存，触发路径还少一层间接调用。
 */
class ReactiveAttributeEffect extends LightBindingEffect {
    // 开发期 JSX source，只在有值时赋（见 declare 说明）
    declare debugSource?: AxiiSource
    constructor(
        public host: StaticHost,
        public el: ExtendedElement,
        public key: string,
        public value: any,
        public path: number[],
        public isSVG: boolean,
    ) {
        super()
        // CAUTION 属性绑定由元素 host 的 destroyAttrEffects 显式销毁，不能被创建时恰好打开的
        //  collect frame / 父 effect 接管（归属不变量见 detachEffectFromCreationContext）。
        this.detachFromCreationContext()
    }
    update() {
        // CAUTION 属性更新（含初始求值）抛错：如果外部通过 root.on('error') 注册了处理器，
        //  则报告错误并跳过本次更新（effect 保持活跃，依赖恢复后可继续更新），
        //  否则保持向上抛出的行为。与 ComponentHost/FunctionHost 的错误钩子语义一致。
        const host = this.host
        try {
            // CAUTION 诊断关闭（生产环境）时不分配 trace frame 对象，属性更新是热路径
            if (isAxiiDiagnosticsEnabled()) {
                withReactiveTrace({
                    type: 'static-attr',
                    operation: 'update-attr',
                    hostType: 'StaticHost',
                    elementPath: this.path,
                    source: this.debugSource ?? host.pathContext.debugSource,
                    attrName: this.key,
                }, () => {
                    host.updateAttribute(this.el, this.key, this.value, this.path, this.isSVG)
                })
            } else {
                host.updateAttribute(this.el, this.key, this.value, this.path, this.isSVG)
            }
        } catch (e) {
            if (!host.pathContext.root.dispatch('error', e)) throw e
        }
    }
}

/**
 * @internal
 */
export class StaticHost implements Host {
    static styleManager = new StyleManager()
    // CAUTION 下面这些可选字段都不带初始化器：StaticHost/CompactElementHost 是数量最大的
    //  host（长列表每行一个），不用的能力不占实例槽位（useDefineForClassFields=false 下
    //  无初始化器的字段不产生构造期赋值）。
    // CAUTION getter 而不是字段：
    //  1. 有 detachStyledChildren（离场动画）时必须自己处理 DOM；
    //  2. fragment 源的响应式子区间是本区间的「顶层」节点（元素源的子区间嵌在根元素内部，
    //     不受整段删除影响），子树声明的 forceHandleElement（reusable 内容保留、
    //     离场动画）必须向上传播——否则父级的整段删除（removeNodesBetween/Range）会把
    //     这些子区间的节点逐个拆散：reusable 内容的兄弟链断裂，下一次挂载直接崩溃。
    //  该 getter 只在销毁决策点（列表 bulk delete 候选、父区间销毁）被读取，不在渲染热路径上。
    get forceHandleElement(): boolean {
        if (this.detachStyledChildren?.length) return true
        if (isFragmentNode(this.source)) {
            const hosts = this.reactiveHosts
            if (!hosts) return false
            if (Array.isArray(hosts)) {
                for (const host of hosts) {
                    if (host.forceHandleElement) return true
                }
                return false
            }
            return !!hosts.forceHandleElement
        }
        return false
    }
    // CAUTION 单个时直接存对象而不是包一层数组：一个元素恰好一个响应式 child/attr
    //  是长列表行的典型形态，每行省一个数组（16B 头 + elements store）。
    //  这两个字段在构造器里显式预置 undefined（与上面的 declare 策略相反）：
    //  它们是渲染期最常写入的两个字段，构造期不预留的话 V8 slack tracking 会把
    //  in-object 槽位收缩到构造器字段数，渲染期再写就会退到 PropertyArray
    //  （带绑定的每行 host 平白多一个 ~20B 的堆对象）。
    reactiveHosts?: Host[] | Host
    attrEffects?: LightBindingEffect[] | LightBindingEffect
    // 是否有 style 类型的响应式属性，只有这种情况才需要 StyleManager 的 mount/unmount 记账
    usesStyleManager?: boolean
    refHandles?: RefHandleInfo[]
    detachStyledChildren?: DetachStyledInfo[]
    removeAttachListener?: () => void
    constructor(public source: HTMLElement | SVGElement | DocumentFragment, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        this.reactiveHosts = undefined
        this.attrEffects = undefined
    }
    element: HTMLElement | Comment | SVGElement = this.placeholder
    render(): void {
        assert(this.element === this.placeholder, 'should never rerender')
        if (isAxiiDiagnosticsEnabled()) warnIfRenderingConsumedElement(this.source)

        const hydrating = isHydrating()
        // CAUTION source 是不是 fragment 按 nodeType 判断：createHost 收下的元素 / 片段可能来自另一个
        //  realm（见 nodeType.ts，#58）。只判断一次，下面三处共用。
        const isFragment = isFragmentNode(this.source)
        // CAUTION 如果是 fragment，我们用一个 comment 节点来作为第一个元素，这样后面  destroy 的时候就能一次性 remove 掉。
        // Hydrate：认领已有 <!--fragment start-->（§3.2.4 FTS / G3-Fr），禁止新建。
        if (isFragment) {
            this.element = hydrating
                ? claimFragmentStartBefore(this.placeholder)
                : document.createComment('fragment start')
            if (hydrating) {
                // Rematerialize main-root deferred element children, then claim placeholders
                // in the fragment region (createElement left stubs under §3.3.d force-defer).
                rematerializeDeferredFragmentChildren(this.source as DocumentFragment)
                reconcileFragmentHydrateChildren(this.source as DocumentFragment, this.element, this.placeholder)
                // Leftover static axii:t / axii:0 (no unhandledChildren path)
                stripAxiiTextBoundariesBetween(this.element, this.placeholder)
            }
        } else {
            this.element = this.source as HTMLElement | SVGElement
        }

        // CAUTION 子树里每个带嵌套样式的元素（响应式属性、列表行、子组件）都可能新建 stylesheet，
        //  合并成一次 document.adoptedStyleSheets 写入（见 StyleManager.beginBatch）。写入发生在
        //  下面把自己插入文档之前，随后的 ref/layoutEffect 读到的样式与逐张写入时完全一样。
        //  纯静态元素（没有任何响应式元数据）与 hydrate 不打开批次，路径与原来相同。
        const sourceMeta = this.source as ExtendedElement
        if (!hydrating && (sourceMeta.unhandledAttr !== undefined || sourceMeta.unhandledChildren !== undefined)) {
            const styleManager = StaticHost.styleManager
            const root = this.pathContext.root
            const outerRoot = styleManager.beginBatch(root)
            try {
                this.collectAndRenderInner()
            } finally {
                styleManager.endBatch(root, outerRoot)
            }
        } else {
            this.collectAndRenderInner()
        }

        if (!hydrating) {
            insertBefore(this.element, this.placeholder)
            // 如果是 fragment，那么还要插入真实内容
            if (isFragment) {
                insertBefore(this.source, this.placeholder)
            }
        } else if (!isFragment) {
            // 元素已在 placeholder 前；校正顺序（已正确时 insertBefore 为无操作）
            insertBefore(this.element, this.placeholder)
        }
        // hydrating Fragment：内容已在 fragment start 与 placeholder 之间，DocumentFragment 为空

        this.setupRefHandles()
        // mount/unmount 记账只服务于 StyleManager 的 stylesheet 引用计数，
        //  没有响应式 style 属性的元素（绝大多数）完全不需要参与。
        if (this.usesStyleManager) {
            StaticHost.styleManager.mount(this)
        }
        // 自己插入完成后，内层（reactiveHosts 渲染期间登记的）layoutEffect/ref 可能已经连通，
        //  在同一个同步任务内立刻执行。
        // CAUTION 自己都还没连通（整体在更外层 fragment 里，如列表行）时必须跳过：
        //  此时自己内部登记的条目必然也未连通，flush 纯属无效重扫——批量插入 N 个
        //  带 layoutEffect/ref 的行时会退化成 O(N^2)。留给最外层完成插入的那次 flush 统一处理。
        if (this.placeholder.isConnected) {
            this.pathContext.root.flushAttachQueue()
        }
    }
    /**
     * #55 新模型（设计 §2.4、§2.5 StaticHost 行、§2.6.1）：source 是元素或 Fragment 的描述。
     *  1. 先按文档顺序构造静态子树里的全部子 Host（≡ collectInnerHost：构造只需要 source 与 slot；ComponentHost 的构造器
     *     分配组件类型 id，首次出现的组件类型因此按与 CSR 相同的顺序拿到 id，样式类名一致）；
     *  2. 认领：元素描述按位置认领元素并递归，Fragment 描述先认领 `fragment start`、在同一层消费子节点；
     *     遍历到动态 child 时依次取出第 1 步的 Host，hydrate(slot)（DOM.hydrateElementDescription）；
     *  3. 认领自己的 slot；
     *  4. 与 render 相同地收集响应式属性、ref、detachStyle（元数据由认领步骤按 CSR 的规则提升到 source 上）；
     *  5. 静态子树里失配新建的元素（§4.2 R1，含 source 自己）这时才连入文档：≡ CSR 在插入之前绑定响应式属性（#73）。
     * 与 CSR 的差别只在先后（§2.9，D5 已接受）：后代子 Host 的激活先于祖先元素的响应式属性绑定。
     * 认领后 source 换成认领到的元素（Fragment 换成一个空的 DocumentFragment，destroy / forceHandleElement 按它判断 fragment）。
     */
    hydrate(slot: HydrationSlot): void {
        const source = this.source as unknown
        if (!isHydrationElement(source) || source.node !== null) {
            this.hydrateExistingSource(slot)
            return
        }
        const freshMark = markTopDownFreshElements()
        this.hydrateSource()
        // 3. 自己的 slot
        this.placeholder = claimTopDownComment(slot)
        // 4. ≡ collectAndRenderInner 里除 collectInnerHost / renderReactiveHosts 之外的部分
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        // 5. 失配新建的元素在响应式属性绑定之后连入文档（#73）
        insertTopDownFreshElements(freshMark, insertBefore)
        // ≡ render 的尾部
        this.setupRefHandles()
        if (this.usesStyleManager) {
            StaticHost.styleManager.mount(this)
        }
        if (this.placeholder.isConnected) {
            this.pathContext.root.flushAttachQueue()
        }
    }
    /**
     * source 是现成的节点（激活之外创建的元素 / 片段，§2.6.8），或者这次激活里已经认领过的描述（同一个描述第二次作为 Host 的
     * source：[s, s]、同一行两次，C6，用它的 node）。服务端不可能产出它（或者已经为它的第一次出现写过一份），内容是仅客户端的：
     * 游标处是它的对应物（同标签元素）就删除，按 R3 认领 slot（服务端在 slot 前写下的其余内容由 R3 删除并报告），
     * 再以这个 slot 为 placeholder 在激活上下文之外按 CSR 渲染——≡ CSR 的 createHost(节点) + render，C6 与 CSR 重复渲染同一个
     * 元素对象相同（元数据已被消费，warnIfRenderingConsumedElement 照旧提示）。
     */
    hydrateExistingSource(slot: HydrationSlot): void {
        const source = this.source as unknown
        let node: HTMLElement | SVGElement | DocumentFragment
        if (isHydrationElement(source)) {
            node = source.node as HTMLElement | SVGElement | DocumentFragment
            markTopDownHostPlaced(source)
        } else {
            node = source as HTMLElement | SVGElement | DocumentFragment
            reportTopDownLiveNode(node)
            markTopDownHostPlaced(node)
        }
        removeTopDownCounterpart(node)
        this.source = node
        this.element = this.placeholder = claimTopDownComment(slot)
        runOutsideHydration(() => this.render())
    }
    /**
     * hydrate 的第 1、2 步（StaticHost.hydrate 与 CompactElementHost.hydrate 共用）：按文档顺序构造静态子树里的子 Host，
     * 再认领 source 描述（Fragment 先认领 `fragment start`），认领后 source 换成节点、element 换成元素。
     * 调用方保证 source 是还没有认领的描述（已认领的、现成的节点见 hydrateExistingSource）。
     */
    hydrateSource(): void {
        const desc = this.source as unknown as HydrationElement
        const isFragment = desc.tag === Fragment
        // 1. 构造子 Host（≡ collectInnerHost）
        const infos: UnhandledChildInfo[] = []
        collectedOnce.clear()
        collectedOnce.add(desc)
        collectTopDownDynamicChildren(desc, EMPTY_PATH, desc.rawProps?.__source, infos)
        collectedOnce.clear()
        let innerHosts: TopDownInnerHosts | undefined
        if (infos.length === 1) {
            const host = this.createTopDownInnerHost(infos[0])
            this.reactiveHosts = host
            innerHosts = {hosts: [host], next: 0}
        } else if (infos.length) {
            // 所有（非函数）子 host 共享同一个 hostPath 节点（≡ collectInnerHost）
            let hostPath: LinkedNode<Host>|undefined
            const hosts = infos.map(info => this.createTopDownInnerHost(info, typeof info.child === 'function' ?
                undefined :
                (hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath))))
            this.reactiveHosts = hosts
            innerHosts = {hosts, next: 0}
        }
        // 2. 认领
        if (isFragment) this.element = claimTopDownComment('fragment start')
        const node = hydrateElementDescription(desc, innerHosts)
        if (!isFragment) this.element = node as HTMLElement | SVGElement
        this.source = node
        markTopDownHostPlaced(desc)
    }
    // ≡ createInnerHost，分派换成 createHydrateHost，placeholder 是 slot。CAUTION 两处的 context / position 规则一起改。
    createTopDownInnerHost(info: UnhandledChildInfo, sharedHostPath?: LinkedNode<Host>) {
        const { placeholder, child, path, source } = info
        // 现成节点的动态 child（collectTopDownDynamicChildren）：placeholder 是 CSR 建好的真实节点，按 CSR 构造（≡ collectInnerHost）
        if (!isHydrationSlot(placeholder)) return this.createInnerHost(info, sharedHostPath)
        const slot = placeholder as unknown as HydrationSlot
        if (typeof child === 'function') {
            return createHydrateHost(child, slot, this.pathContext, {
                owner: this,
                elementPath: internElementPath(path),
                debugSource: source,
            })
        }
        return createHydrateHost(child, slot, {
            ...this.pathContext,
            hostPath: sharedHostPath ?? createLinkedNode<Host>(this, this.pathContext.hostPath),
            elementPath: internElementPath(path),
            debugSource: source ?? (isHydrationElement(child) ? child.rawProps?.__source : child?.__axiiSource) ?? this.pathContext.debugSource,
        })
    }
    // render 的「收集元数据 + 渲染内层 host」部分，批次内外共用同一份（见 render 里的说明）
    collectAndRenderInner() {
        this.collectInnerHost()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        this.renderReactiveHosts()
    }
    setupRefHandles() {
        if (this.refHandles?.length) {
            const root = this.pathContext.root
            if (root.attached) {
                // CAUTION 元素可能正被渲染在脱离文档的 fragment 里（列表新行等），
                //  ref 的挂载（以及依赖 ref 的 RxDOMSize 等 DOM 测量）要等真正插入文档后执行。
                if (this.element.isConnected) {
                    this.attachRefs()
                } else {
                    this.removeAttachListener = root.deferUntilAttached(this.element, () => this.attachRefs())
                }
            } else {
                // CAUTION 一定要保存退订函数，元素如果在 root attach 之前被销毁，
                //  必须退订，否则 attach 时会把已销毁的元素重新附加到 ref 上。
                this.removeAttachListener = root.onAttachForRender(() => this.attachRefs())
            }
        }
    }
    // 遍历 reactiveHosts（单个/数组两种形态）
    renderReactiveHosts() {
        const hosts = this.reactiveHosts
        if (!hosts) return
        if (Array.isArray(hosts)) {
            for (const host of hosts) host.render()
        } else {
            hosts.render()
        }
    }
    destroyReactiveHosts() {
        const hosts = this.reactiveHosts
        if (!hosts) return
        // CAUTION fragment 源的子区间节点就是本区间的顶层节点：声明了 forceHandleElement 的
        //  子树（reusable 内容必须搬出保留、离场动画子树）必须以 destroy(false) 自己处理 DOM，
        //  否则本区间的整段删除会把它们的节点逐个拆散——reusable 内容的兄弟链断裂，
        //  下一次挂载直接崩溃。子树的自我移除都是「连续子区间删除/搬移」，不会打断剩余
        //  节点的兄弟链，随后的 removeNodesBetween 仍然可以安全清理剩余部分。
        //  元素源的子区间嵌在根元素内部，整段删除只移除根元素本身，维持廉价的 destroy(true)。
        const isFragment = isFragmentNode(this.source)
        if (Array.isArray(hosts)) {
            for (const host of hosts) host.destroy(!(isFragment && host.forceHandleElement))
        } else {
            hosts.destroy(!(isFragment && hosts.forceHandleElement))
        }
    }
    destroyAttrEffects() {
        const effects = this.attrEffects
        if (!effects) return
        if (Array.isArray(effects)) {
            for (const effect of effects) {
                trackLightBindingDestroyed(effect)
                effect.destroy()
            }
        } else {
            trackLightBindingDestroyed(effects)
            effects.destroy()
        }
    }
    // CAUTION atom/函数 child（最常见：每行的响应式文本）不克隆 pathContext：
    //  它们的文本快速路径从不消费 hostPath，位置信息以一个 3 字段的 position
    //  对象传入（诊断/结构渲染按需读取），比「克隆 context + LinkedNode」
    //  少一半以上的每绑定常驻内存。
    // CAUTION 新激活模型的 createTopDownInnerHost 是它的另一份（分派换成 createHydrateHost），context / position 规则一起改（#55 B1）
    createInnerHost({ placeholder, child, path, source }: UnhandledChildInfo, sharedHostPath?: LinkedNode<Host>) {
        if (typeof child === 'function') {
            // debugSource 只存 child 自己的（host 使用处会回退到 pathContext.debugSource）
            return createHost(child, placeholder, this.pathContext, {
                owner: this,
                elementPath: internElementPath(path),
                debugSource: source,
            })
        }
        return createHost(child, placeholder, {
            ...this.pathContext,
            hostPath: sharedHostPath ?? createLinkedNode<Host>(this, this.pathContext.hostPath),
            elementPath: internElementPath(path),
            debugSource: source ?? child?.__axiiSource ?? this.pathContext.debugSource,
        })
    }
    collectInnerHost() {
        const result = this.source as ExtendedElement

        const { unhandledChildren } = result

        if (unhandledChildren) {
            if (unhandledChildren.length === 1) {
                // 单 child（长列表行的典型形态）直接存 host，省一层数组
                this.reactiveHosts = this.createInnerHost(unhandledChildren[0])
            } else {
                // 所有（非函数）子 host 共享同一个 hostPath 节点，避免每个子节点都分配一个 LinkedNode。
                // 惰性创建：全是 atom/函数 child 时一个都不分配。
                let hostPath: LinkedNode<Host>|undefined
                this.reactiveHosts = unhandledChildren.map(info =>
                    this.createInnerHost(info, typeof info.child === 'function' ?
                        undefined :
                        (hostPath ??= createLinkedNode<Host>(this, this.pathContext.hostPath)))
                )
            }

            result.unhandledChildren = undefined
        }
    }
    collectReactiveAttr() {
        const result = this.source as ExtendedElement

        const { unhandledAttr } = result

        if(unhandledAttr) {
            for (const { el, key, value, path, source } of unhandledAttr) {
                // CAUTION isSVG 必须按属性所属的元素判断，而不是按整个静态子树的根：
                //  HTML 子树里可以嵌套 SVG 元素（反之亦然），按根判断会让嵌套侧的
                //  驼峰属性转换/namespace 处理全部失效。
                const isSVG = el instanceof SVGElement
                // 基于一个推测：拥有 unhandledAttr 的元素，更有可能被测到
                if (StaticHostConfig.autoGenerateTestId && !el.hasAttribute('data-testid')) {
                    this.generateTestId(el, path)
                }
                // CAUTION prop:/$ 前缀是 Component configuration 约定的配置 key，不是真实 DOM 属性；
                //  其余带 ':' 的 key（如 xlink:href / xmlns:*）是合法属性，不能一并跳过。
                if (!(key[0] === '$' || key.startsWith('prop:'))) {
                    if (key === 'style') {
                        this.usesStyleManager = true
                    }
                    const effect = new ReactiveAttributeEffect(this, el, key, value, internElementPath(path), isSVG)
                    if (source) effect.debugSource = source
                    trackLightBindingCreated(effect, 'ReactiveAttributeBinding')
                    // CAUTION 先登记再 run：初始求值抛错（无 error 钩子）时 effect 已在
                    //  attrEffects 里，host 销毁仍能退订它的依赖。单个时直接存 effect 本身。
                    const current = this.attrEffects
                    if (current === undefined) {
                        this.attrEffects = effect
                    } else if (Array.isArray(current)) {
                        current.push(effect)
                    } else {
                        this.attrEffects = [current, effect]
                    }
                    effect.run()
                }
            }
            result.unhandledAttr = undefined
        }
    }
    updateAttribute(el: ExtendedElement, key: string, value: any, path: number[], isSVG: boolean) {

        if (key === 'style' ) {
            return StaticHost.styleManager.update(this, this.pathContext.hostPath, path, value, el)
        } else {
            const final = Array.isArray(value) ?
                value.map(evaluateReactiveItem) :
                isAtomLike(value) ? value() : value
            if (key === 'className' || key === 'class') {
                // CAUTION className 更新是整体覆写 class attribute，
                //  必须把 StyleManager 挂上去的 stylesheet class 补回来，否则嵌套样式/boundProps 样式静默丢失。
                setAttribute(el, key, final, isSVG)
                StaticHost.styleManager.reapplyStyleClasses(el)
            } else {
                // CAUTION data-* 与其他属性走同一条 setAttribute 路径，不再经 dataset 赋值：
                //  dataset 的名字转换只认「'-' + 小写字母」，而这里曾用通用的 camelize（连 '_'、
                //  '-数字' 也折叠）来算 dataset key——data-item_id={atom} 实际写出的是 data-item-id、
                //  data-level-1 写出的是 data-level1，同一个 JSX 属性一旦变成响应式，属性名就变了
                //  （选择器、test id、埋点钩子静默失效）。静态路径本来就是按字面属性名写的，
                //  两条路径共用一份实现才不会再分叉：null/undefined 移除、false 写字面 "false"、
                //  数组整体字符串化，都由 setAttribute 统一处理。
                setAttribute(el, key, final, isSVG)
            }
        }
    }
    collectRefHandles() {
        // CAUTION 只在真的有 refHandles 时才写实例属性：无条件赋 undefined 会让每个
        //  元素 host 多出超出 in-object 容量的属性槽位（V8 退到 PropertyArray），
        //  长列表里每行 ~20B 的纯浪费。detachStyledChildren 同理。
        const refHandles = (this.source as ExtendedElement).refHandles
        if (refHandles) this.refHandles = refHandles
    }
    collectDetachStyledChildren() {
        const detachStyledChildren = (this.source as ExtendedElement).detachStyledChildren
        if (detachStyledChildren) this.detachStyledChildren = detachStyledChildren
    }
    generateTestId(el: ExtendedElement, elementPath: number[]) {
        // 增加全局开关控制
        if (!StaticHostConfig.autoGenerateTestId) return
        
        const testId = generateGlobalElementStaticId(this.pathContext.hostPath, elementPath)
        setAttribute(el, 'data-testid', testId)
    }
    // ref 回调是用户代码：单个 ref 抛错不能中断兄弟 ref（含数组形态：用户 ref 数组、
    //  AOP 合并出的 ref 数组）与框架后续流程，错误交给 root error 钩子（I43/I51）。
    runRefWithErrorHook(fn: () => void) {
        try {
            fn()
        } catch (e) {
            if (!this.pathContext.root.dispatch('error', e)) throw e
        }
    }
    // CAUTION 原型方法而不是实例箭头函数：每个元素 host 都有这个字段的话，长列表每行多一个闭包。
    //  需要脱离 this 使用的注册点（root.onAttachForRender）自己包一层箭头函数，只有带 ref 的元素才分配。
    //  attach 抛错不能中断同元素的兄弟 ref 与后续渲染流程
    //  （flush 队列路径已逐条隔离，这里的同步连通路径必须对齐），错误语义与 detach 一致。
    attachRefs() {
        this.refHandles?.forEach(({ handle, el }: RefHandleInfo) => {
            if (Array.isArray(handle)) {
                for (const item of handle) this.runRefWithErrorHook(() => createElement.attachRef(el, item))
            } else {
                this.runRefWithErrorHook(() => createElement.attachRef(el, handle))
            }
        })
    }
    // ref 回调是用户代码：detach（ref(null)）抛错不能中断兄弟 ref 和后续的 DOM 拆除，
    //  否则一个抛错的 ref 会让整段区间泄漏在文档里。错误语义与 ComponentHost 的 cleanup 一致。
    detachRefsWithErrorHook() {
        this.refHandles?.forEach(({ handle }: RefHandleInfo) => {
            if (Array.isArray(handle)) {
                for (const item of handle) this.runRefWithErrorHook(() => createElement.detachRef(item))
            } else {
                this.runRefWithErrorHook(() => createElement.detachRef(handle))
            }
        })
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        this.destroyAttrEffects()

        this.removeAttachListener?.()

        this.destroyReactiveHosts()

        this.detachRefsWithErrorHook()

        // CAUTION removeElements 只有在等待离场动画时才是异步的。
        //  同步路径（绝大多数）直接内联处理，避免每个元素销毁都分配 Promise/微任务；
        //  同步路径的 DOM boundary 错误必须同步向上抛（async 函数会把它变成 unhandled rejection）；
        //  异步路径的错误无法向上抛，交给 reportAxiiError 收敛。
        //  无论哪条路径、成功还是失败，样式引用计数都必须释放。
        if (!this.detachStyledChildren?.length) {
            try {
                // CAUTION 整段区间已脱离 DOM / 父节点失配，说明区间已被外部整体清理，
                //  这是被容忍的合法状态；「同父但兄弟链断了」的破坏交给 removeNodesBetween 的诊断抛出。
                const parent = this.placeholder.parentNode
                if (!parentHandle &&
                    parent &&
                    this.element.parentNode === parent) {
                    removeNodesBetween(this.element!, this.placeholder, true, {
                        ownerHost: this,
                        operation: 'destroy',
                    })
                    // 移除的可能是被选中的 option/optgroup，select 要按存值重放
                    restoreSelectValueAfterRemoval(parent)
                }
            } finally {
                if (this.usesStyleManager) {
                    StaticHost.styleManager.unmount(this)
                }
            }
            return
        }

        const unmountStyle = () => {
            if (this.usesStyleManager) {
                StaticHost.styleManager.unmount(this)
            }
        }

        try {
            const removeResult = this.removeElements(parentHandle)
            if (removeResult instanceof Promise) {
                removeResult.catch(reportAxiiError).finally(unmountStyle)
            } else {
                unmountStyle()
            }
        } catch (error) {
            unmountStyle()
            throw error
        }
    }
    removeElements(parentHandle?: boolean): void | Promise<void> {
        if (parentHandle) return

        if (this.detachStyledChildren?.length) {
            const transformingElements = new Set<HTMLElement>()
            const animatingElements = new Set<HTMLElement>()

            // TODO 提升计算效率
            // CAUTION 监听所有的 animationrun 和 transitionrun 事件。不能用 animationstart 和 transitionstart，因为不是立刻触发的
            this.detachStyledChildren?.forEach(({ el, style: value }) => {
                const transitionProperties = getComputedStyle(el).transitionProperty.split(',').map(p => p.trim())
                // CAUTION 注意这里的计算规则和 updateAttribute 里的不太一样，这里只要找 key 就行了
                // CAUTION 先求值再判断数组：detachStyle 是函数/atom 时可以返回数组，
                //  先判数组的话函数返回的数组会被当成对象、styleKeys 变成数组下标。
                // CAUTION 条件离场动画（detachStyle={() => cond() ? {...} : null}，
                //  prefers-reduced-motion 开关是自然写法）的 falsy 求值结果按「无离场样式」
                //  处理（F55）：Object.keys(null) 直接 TypeError——destroy 被中断，
                //  节点**永久残留在文档里**（诊断开关都一样）。静态 falsy 在注册时就被
                //  guard 掉了，函数/atom 的 falsy 求值结果是唯一会走到这里的形态。
                const evaluated = isAtomLike(value) ? value() : value
                // 数组可以嵌套（转发进来的 detachStyle 数组），先逐项求值再摊平，否则 styleKeys 变成数组下标
                const finalStyle: StyleObject = Array.isArray(evaluated) ?
                    Object.assign({}, ...evaluated.map(evaluateReactiveItem).flat(Infinity)) :
                    (evaluated && typeof evaluated === 'object' ? evaluated : {})

                const styleKeys = Object.keys(finalStyle)
                const hasTransition = transitionProperties.includes('all') || styleKeys.some(key => transitionProperties.includes(key))
                if (hasTransition) {
                    transformingElements.add(el)
                }
                if (finalStyle.animation) {
                    animatingElements.add(el)
                }
            })


            const transformingElementsArray = Array.from(transformingElements)
            const animatingElementsArray = Array.from(animatingElements)
            // CAUTION end 事件必须同时接受 cancel（transition 被打断/元素被隐藏时只会派发 cancel），
            //  否则等待永远不会结束。
            const promises = [
                ...transformingElementsArray.map(el => eventToPromise(el, ['transitionrun'])),
                ...transformingElementsArray.map(el => eventToPromise(el, ['transitionend', 'transitioncancel'])),
                ...animatingElementsArray.map(el => eventToPromise(el, ['animationrun'])),
                ...animatingElementsArray.map(el => eventToPromise(el, ['animationend', 'animationcancel'])),
            ]

            // 出发 transition 和 animation
            this.detachStyledChildren?.forEach(({ el, style: value, path }) => {
                const final = Array.isArray(value) ?
                    value.map(evaluateReactiveItem) :
                    isAtomLike(value) ? value() : value
                // falsy 求值结果（条件离场动画未启用，F55）：什么都不应用。
                //  不能把 falsy 交给 setAttribute 的 style 分支——那是「清空 inline style」
                //  语义，会把元素移除前一帧的样式整体抹掉。
                if (final == null || typeof final === 'boolean') return
                setAttribute(el, 'style', final, el instanceof SVGElement)
            })

            // CAUTION 兜底超时：transition/animation 可能实际不会发生（离场样式与当前值相同、
            //  元素 display:none、prefers-reduced-motion 等场景下 run/end 事件永不触发），
            //  没有超时的话节点会永远留在 DOM。上限取各元素声明的最长动画时长 + buffer。
            const deadline = computeExitDeadlineMs(transformingElementsArray, animatingElementsArray)

            return Promise.race([
                Promise.all(promises),
                new Promise(resolve => setTimeout(resolve, deadline)),
            ]).then(() => {
                // CAUTION 等待离场动画期间，DOM 可能已被其他路径整体清理（例如外部直接清空了父节点），
                //  整段区间脱离/父节点失配是这个场景下被容忍的合法状态，直接跳过删除。
                //  其余更细的区间破坏（同父但链断了）仍会被 removeNodesBetween 的诊断捕获并 report。
                const parent = this.placeholder.parentNode
                if (!parent || this.element.parentNode !== parent) return
                removeNodesBetween(this.element!, this.placeholder, true, {
                    ownerHost: this,
                    operation: 'destroy',
                })
                // CAUTION 与同步移除路径一致（#58）：离场动画播完才移除的可能是被选中的 option /
                //  optgroup，select 要按存值重放。移除发生在之后的任务里，批量入口的合并
                //  （suspendSelectReplay）已经结束，每个离场的元素各自重放一次。
                restoreSelectValueAfterRemoval(parent)
            })
        }
        // CAUTION 整段区间已脱离 DOM / 父节点失配，说明区间已被外部整体清理（例如 root 容器被直接清空），
        //  这是被容忍的合法状态，无需也无法再按区间删除。真正危险的是「同父但兄弟链断了」——
        //  盲删会误删别人的节点，这种情况交给 removeNodesBetween 的诊断同步抛出 AxiiError。
        if (!this.placeholder.parentNode || this.element.parentNode !== this.placeholder.parentNode) return
        removeNodesBetween(this.element!, this.placeholder, true, {
            ownerHost: this,
            operation: 'destroy',
        })
    }
}


// 所有 CompactElementHost 共享的占位符，永远不会插入文档，
//  只是为了满足 Host 接口的 placeholder 字段。
// CAUTION 延迟创建：模块顶层不能碰 document，否则 node 环境 import 直接崩（SSR/工具链场景）。
let COMPACT_SHARED_PLACEHOLDER: Comment|undefined

/**
 * @internal
 *
 * RxListHost 专用的紧凑行 host：行内容是单个元素时，不需要给每一行分配
 * 一个 comment 占位符（占位符的插入/删除和常驻 DOM 节点在长列表里开销可观）。
 * 元素本身的定位（插入/搬移/删除）完全由 RxListHost 负责。
 */
export class CompactElementHost extends StaticHost {
    constructor(source: HTMLElement | SVGElement, pathContext: PathContext) {
        super(source, COMPACT_SHARED_PLACEHOLDER ??= document.createComment('compact host shared placeholder'), pathContext)
        this.element = source
    }
    render(): void {
        if (isAxiiDiagnosticsEnabled()) warnIfRenderingConsumedElement(this.source)
        this.collectInnerHost()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        this.renderReactiveHosts()
        // CAUTION 自己的插入由 RxListHost 完成，这里不做，
        //  layoutEffect/ref 的 flush 也由 RxListHost 在插入后统一触发。

        this.setupRefHandles()
        if (this.usesStyleManager) {
            StaticHost.styleManager.mount(this)
        }
    }
    /**
     * #55 新模型（设计 §2.5 RxListHost 行、§2.6.4）：RxListHost.hydrate 按 #68 的判定构造的 Compact 行，构造时 source 是
     * 行的元素描述。≡ render：在游标处认领行元素（与 StaticHost.hydrate 共用 hydrateSource，子 Host 先构造再认领），
     * 然后收集响应式属性、ref、detachStyle。Compact 行没有行级 Comment（服务端也不写，ssr.serializeRxListRow），
     * slot 不认领；placeholder 仍是共享的 COMPACT_SHARED_PLACEHOLDER。layoutEffect / ref 的 flush 由 RxListHost 统一触发。
     * 失配新建的行元素（§4.2 R1）与 StaticHost.hydrate 一样在响应式属性绑定之后才连入文档（#73）。
     */
    hydrate(_slot?: HydrationSlot): void {
        const source = this.source as unknown
        if (!isHydrationElement(source) || source.node !== null) {
            // 现成的行元素（§2.6.8），或者这次激活里已经认领过的描述（同一行两次，C6）：≡ StaticHost.hydrateExistingSource，
            //  Compact 行没有 slot，元素直接放到游标处（删除它在服务端的对应物），在激活上下文之外按 CSR 渲染
            let node: HTMLElement | SVGElement
            if (isHydrationElement(source)) {
                node = source.node as HTMLElement | SVGElement
                markTopDownHostPlaced(source)
            } else {
                node = source as HTMLElement | SVGElement
                reportTopDownLiveNode(node)
                markTopDownHostPlaced(node)
            }
            placeTopDownExistingNode(node)
            this.source = this.element = node
            runOutsideHydration(() => this.render())
            return
        }
        const freshMark = markTopDownFreshElements()
        this.hydrateSource()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        insertTopDownFreshElements(freshMark, insertBefore)
        this.setupRefHandles()
        if (this.usesStyleManager) {
            StaticHost.styleManager.mount(this)
        }
    }
    destroy(parentHandle?: boolean) {
        // CAUTION 先减 compact 计数再登记 destroyed，顺序反了会被去重逻辑跳过
        trackCompactHostDestroyed(this)
        trackHostDestroyed(this)
        this.destroyAttrEffects()
        this.removeAttachListener?.()
        this.destroyReactiveHosts()
        this.detachRefsWithErrorHook()
        if (!parentHandle) {
            const parent = this.element.parentNode
            ;(this.element as HTMLElement).remove()
            // 移除的可能是被选中的 option 行，select 要按存值重放
            restoreSelectValueAfterRemoval(parent)
        }
        if (this.usesStyleManager) {
            StaticHost.styleManager.unmount(this)
        }
    }
}

function eventToPromise(el: HTMLElement, events: string[]) {
    return new Promise(resolve => {
        const abortController = new AbortController()
        for (const event of events) {
            el.addEventListener(event, () => {
                abortController.abort()
                resolve(true)
            }, { once: true, signal: abortController.signal })
        }
    })
}

// 离场动画兜底等待的余量与绝对上限
const EXIT_ANIMATION_BUFFER_MS = 100
const EXIT_ANIMATION_MAX_WAIT_MS = 10_000

// 解析 computed style 的时长列表（如 "0.3s, 1s"），返回最大值（毫秒）
function maxDurationMs(list: string) {
    let max = 0
    for (const part of list.split(',')) {
        const seconds = parseFloat(part) || 0
        if (seconds * 1000 > max) max = seconds * 1000
    }
    return max
}

function computeExitDeadlineMs(transitioning: HTMLElement[], animating: HTMLElement[]) {
    let max = 0
    for (const el of transitioning) {
        const style = getComputedStyle(el)
        const total = maxDurationMs(style.transitionDuration) + maxDurationMs(style.transitionDelay)
        if (total > max) max = total
    }
    for (const el of animating) {
        const style = getComputedStyle(el)
        let iterationCount = 1
        for (const part of style.animationIterationCount.split(',')) {
            const count = part.trim() === 'infinite' ? Infinity : (parseFloat(part) || 1)
            if (count > iterationCount) iterationCount = count
        }
        const total = maxDurationMs(style.animationDuration) * iterationCount + maxDurationMs(style.animationDelay)
        if (total > max) max = total
    }
    /* v8 ignore next */
    if (!Number.isFinite(max)) max = EXIT_ANIMATION_MAX_WAIT_MS
    return Math.min(max + EXIT_ANIMATION_BUFFER_MS, EXIT_ANIMATION_MAX_WAIT_MS)
}
