import {
    createElement,
    DetachStyledInfo,
    ExtendedElement,
    insertBefore,
    isEventName,
    RefHandleInfo,
    setAttribute,
    stringifyStyleValue,
    UnhandledChildInfo,
    UnhandledPlaceholder
} from "./DOM";
import {Host, PathContext} from "./Host";
import {isAtom} from "data0";
import {LightBindingEffect} from "./LightBindingEffect.js";
import {trackLightBindingCreated, trackLightBindingDestroyed} from "./retainedObjectDiagnostics.js";
import {createHost} from "./createHost";
import {assert, camelize, isPlainObject, removeNodesBetween} from "./util";
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

// CAUTION 覆盖原来的判断，增加关于 isReactiveValue 的判断。这样就不会触发响应式值的读行为，不会泄漏到上层的 computed。
// data0 2.0 移除了 reactive() 深层代理，响应式值只剩 atom 和 function 两种形态。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function (name: string, value: any) {
    // CAUTION 只有真正的事件（on + 大写字母）直接放行；once/online 这类普通 on* prop
    //  要继续走 isReactiveValue 判断，atom/函数值才能建立响应式属性绑定。
    if (isEventName(name)) return true

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

function generateComponentElementStaticId(path: Host[], elementPath: number[]) {
    // CAUTION path[0] 只有在 GetPathToLastComponent 真的找到组件时才是 ComponentHost：
    //  整棵子树都不在任何组件里（root.render 直接渲染元素/函数节点/列表）时，
    //  path[0] 是普通 host（StaticHost/RxListHost 等）甚至路径为空（F15），
    //  绝不能对它读 .type/.typeId——普通 host 没有 type 字段，直接 TypeError。
    const lastComponentHost = path[0] instanceof ComponentHost ? path[0] as ComponentHost : undefined
    const pathToGenerateId = lastComponentHost ? path.slice(1) : path
    // CAUTION 一定要有个字母开始 id，不然 typeId 可能是数字，不能作为 class 开头
    // CAUTION 压缩工具可能使得 name 以 $ 开头
    const componentName = lastComponentHost ? lastComponentHost.type.name.toString().replace(/(\s|\$)/g, '_') : 'GLOBAL'
    return `${componentName}${lastComponentHost?.typeId ??''}P${pathToGenerateId.map(host => host.pathContext.elementPath.join('_')).concat(elementPath.join('_')).join('-')}`
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
export function isBoundProp(obj: any) {
    return !!(obj && obj['__bound'])
}

export function isAopProp(obj: any) {
    return !!(obj && obj['__aop'])
}

export function isDynamicProp(obj: any) {
    return !!(obj && obj['__dynamic'])
}

// F30：静态样式对象 -> 内容签名 的缓存。boundProps 等跨实例共享的对象引用直接命中；
//  JSX 字面量对象随元素同生共死，WeakMap 不延长其生命周期。
//  key 顺序不同的等价对象会得到不同签名——代价只是退化为元素独享 stylesheet，语义仍然正确。
const styleSignatureCache = new WeakMap<object, string>()
function computeStyleSignature(styleObject: any): string | undefined {
    if (typeof styleObject !== 'object' || styleObject === null) return undefined
    const cached = styleSignatureCache.get(styleObject)
    if (cached !== undefined) return cached
    let signature: string | undefined
    try {
        signature = JSON.stringify(styleObject)
        /* v8 ignore next 3 */
    } catch {
        signature = undefined
    }
    if (signature !== undefined) styleSignatureCache.set(styleObject, signature)
    return signature
}

// 深度扫描 style 对象中是否有 atom/函数值（style={{color: colorAtom}} / 嵌套样式中的 atom）
function containsReactiveStyleValue(styleObject: any): boolean {
    for (const key in styleObject) {
        const value = styleObject[key]
        if (typeof value === 'function') return true
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'function') return true
            }
        } else if (isPlainObject(value) && containsReactiveStyleValue(value)) {
            return true
        }
    }
    return false
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
    // 当前挂在元素 class 上的 stylesheet class id：响应式 className 整体覆写 class attribute 后，
    //  必须能把这些框架管理的 class 补回去，否则 stylesheet 样式静默丢失。
    public elToStyleClassIds = new WeakMap<HTMLElement, Set<string>>()
    // CAUTION 记账 key 是「拥有这些样式的元素 host」（StaticHost/CompactElementHost 自身），
    //  而不是 hostPath 上的父级 host：列表行共享同一个 hostPath 节点（RxListHost），
    //  按父级记账时稳态 churn（列表始终非空）的行永远等不到计数归零，
    //  被销毁行的 stylesheet 引用计数不释放，adoptedStyleSheets 无上限增长。
    public hostToStyleIds = new WeakMap<Host, Set<string>>()
    public hostMountCount = new WeakMap<Host, number>()
    public idToRefCount = new Map<string, number>()
    // 共享静态 stylesheet id -> 内容签名。「相同 path ⇒ 相同样式内容」只是猜测：
    //  静态样式对象可以携带每实例不同的数据（style={{'& b': {color: item.color}}}），
    //  签名不一致时该实例必须退化为元素独享的 rolling id，否则所有实例都套用第一个实例的样式。
    public idToStaticStyleSignature = new Map<string, string>()
    getStyleSheetId(hostPath: LinkedNode<Host>, elementPath: number[], el: ExtendedElement | null) {
        const pathToLastComponent = GetPathToLastComponent(hostPath)
        // 有 el 说明是动态的，每个 el 独享 id。否则的话用 path 去生成，每个相同 path 的 el 都会共享一个 styleId
        const staticId = generateComponentElementStaticId(pathToLastComponent, elementPath)
        const hasFunctionHostInPathToLastComponent = pathToLastComponent.some(host => host instanceof FunctionHost)

        if (el || hasFunctionHostInPathToLastComponent) {
            const styleId = el  ? this.elToStyleId.get(el) : null
            if (!styleId) {
                const newStyleId = `${staticId}R${Math.random().toString(36).slice(2)}`
                if (el) this.elToStyleId.set(el, newStyleId)
                return newStyleId
            } else {
                return styleId
            }
        } else {
            return staticId
        }
    }
    stringifyStyleObject(styleObject: { [k: string]: any }): string {
        return Object.entries(styleObject).map(([key, value]) => {
            // CAUTION CSS 自定义属性（--main-color / --mainColor）大小写敏感，
            //  绝不能做驼峰转连字符/小写化，否则 var(--mainColor) 永远读不到值。
            //  inline 路径（setAttribute 的 setProperty 分支）本来就保留原样，这里必须对齐。
            const property = (key[0] === '-' && key[1] === '-') ?
                key :
                key.replace(/([A-Z])/g, '-$1').toLowerCase()
            // value 是数字类型的 attr，自动加上 单位
            return `${property}:${stringifyStyleValue(key, value)};`
        }).join('\n')
    }
    public createStyleSheet(id:string, styleObject:StyleObject) {
        const styleSheet = new CSSStyleSheet()
        styleSheet.replaceSync(this.generateStyleContent(`.${id}`, styleObject).join('\n'))
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];
        return styleSheet
    }
    deleteStyleSheet(id: string): CSSStyleSheet | null {
        const styleSheet = this.styleScripts.get(id)
        if (styleSheet) {
            const index = document.adoptedStyleSheets.indexOf(styleSheet)
            if (index > -1) {
                document.adoptedStyleSheets.splice(index, 1)
            }
            this.styleScripts.delete(id)
            return styleSheet
        }
        return null
    }
    collect(host: Host, id: string) {
        let ids = this.hostToStyleIds.get(host)
        if (!ids) {
            ids = new Set()
            this.hostToStyleIds.set(host, ids)
            trackStyleHostStateCreated()
        }
        ids.add(id)
        this.updateRefCount(id, +1)
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
        if (this.hostToStyleIds.has(host)) {
            trackStyleHostStateDestroyed()
        }
        const ids = Array.from(this.hostToStyleIds.get(host) ?? new Set<string>())
        const styleSheetsToDelete = new Set<CSSStyleSheet>()
        ids.forEach(id => {
            const count = this.updateRefCount(id, -1)
            if (count <= 0) {
                const styleSheet = this.styleScripts.get(id)
                if (styleSheet) {
                    styleSheetsToDelete.add(styleSheet)
                }
                this.styleScripts.delete(id);
                // 共享静态 id 的内容签名随 stylesheet 一起退役（rolling id 不在签名表里，delete 无害）
                this.idToStaticStyleSignature.delete(id)
            }
        })
        this.hostToStyleIds.delete(host)
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => {
            return !styleSheetsToDelete.has(sheet);
        });
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
    trackStyleClassRemoved(el: ExtendedElement, id: string) {
        this.elToStyleClassIds.get(el)?.delete(id)
    }
    // 响应式 className/class 更新整体覆写了 class attribute 之后，
    //  把 StyleManager 管理的 stylesheet class 补回去。
    reapplyStyleClasses(el: ExtendedElement) {
        const ids = this.elToStyleClassIds.get(el)
        if (ids) {
            for (const id of ids) el.classList.add(id)
        }
    }
    update(owner: Host, hostPath: LinkedNode<Host>, elementPath: number[], styleObject: StyleObject | StyleObject[], el: ExtendedElement) {
        // style 中有嵌套写法/animation/at-rules 等原生不能识别的，都会当做 unhandledAttr 走到这里。当然也包括 atom 和 function
        const rawStyleObjects = Array.isArray(styleObject) ? styleObject : [styleObject]
        // CAUTION 先求值再展开：响应式 style 函数可以返回数组（() => [base, extra] 是自然写法）。
        //  不展开的话数组会被 splitStyleObject 当成 {0: {...}, 1: {...}} 的嵌套样式，
        //  生成 `.cls 0 {...}` 这类非法 selector，整个样式静默失效。
        const evaluatedEntries: {value: any, entryIsDynamic: boolean, isBound: boolean}[] = []
        for (const raw of rawStyleObjects) {
            const isBound = isBoundProp(raw)
            const entryIsDynamic = typeof raw === 'function' || isDynamicProp(raw)
            const evaluated = typeof raw === 'function' ? raw() : raw
            if (Array.isArray(evaluated)) {
                for (const item of evaluated) {
                    // 函数返回的数组项自身也可能是函数/atom
                    const evaluatedItem = typeof item === 'function' ? item() : item
                    evaluatedEntries.push({value: evaluatedItem, entryIsDynamic: true, isBound: isBound || isBoundProp(item)})
                }
            } else {
                evaluatedEntries.push({value: evaluated, entryIsDynamic, isBound})
            }
        }

        const styleItorNum = this.elToStyleIdItorNum.get(el) ?? 0
        // 路径信息对所有条目相同，只算一次（之前每个条目都重新走一遍 hostPath）
        const pathToLastComponent = GetPathToLastComponent(hostPath)
        const hasFunctionHostInPath = pathToLastComponent.some(host => host instanceof FunctionHost)
        // 跨元素共享的静态 id 基础（路径含 FunctionHost 时不共享，见 getStyleSheetId）
        const sharedStaticBaseId = hasFunctionHostInPath ? null : generateComponentElementStaticId(pathToLastComponent, elementPath)
        const splitStyleObjects = evaluatedEntries.map(({value: evaluatedStyleObject, entryIsDynamic, isBound}, index) => {
            // 分离普通和嵌套样式
            const { simpleStyles, nestedStyles } = this.splitStyleObject(evaluatedStyleObject)
            const usesStyleSheet = isBound || Object.keys(nestedStyles).length > 0
            // CAUTION stylesheet 路径（嵌套样式/boundProps）里出现 atom/函数值时必须按动态样式处理
            //  （滚动重建 stylesheet）：stylesheet 只有第一次/滚动时才重建。必须扫描整个对象而不是
            //  只扫 nestedStyles——atom 出现在 simple 部分（{color: colorAtom, '&:hover': {...}}）时
            //  同样会进 stylesheet，按静态处理的话第一次生效后就永远不再更新（F31）。
            //  普通（inline）样式不需要扫：它每次 update 都整体重新赋值。
            let isDynamic = entryIsDynamic || (usesStyleSheet && containsReactiveStyleValue(evaluatedStyleObject))
            // CAUTION 共享静态 stylesheet id 的内容一致性校验（F30）：「相同 path ⇒ 相同样式内容」
            //  对携带实例数据的静态样式（style={{'& b': {color: item.color}}} 的列表行/同类型兄弟组件）
            //  不成立。第一个实例登记内容签名，后续实例签名不一致时退化为元素独享的 rolling id，
            //  否则它们会静默套用第一个实例的 stylesheet。签名算不出来（循环引用等）时同样退化，保证正确性。
            if (usesStyleSheet && !isDynamic && sharedStaticBaseId) {
                const sharedIdWithIndex = `${sharedStaticBaseId}F${index}`
                const signature = computeStyleSignature(evaluatedStyleObject)
                const existingSignature = this.idToStaticStyleSignature.get(sharedIdWithIndex)
                if (signature === undefined || (existingSignature !== undefined && existingSignature !== signature)) {
                    isDynamic = true
                } else if (existingSignature === undefined) {
                    this.idToStaticStyleSignature.set(sharedIdWithIndex, signature)
                }
            }
            const styleSheetId = isDynamic ?
                this.getStyleSheetId(hostPath, elementPath, el) :
                (sharedStaticBaseId ?? this.getStyleSheetId(hostPath, elementPath, null))
            const styleSheetIdWithIndex = `${styleSheetId}F${index}`
            const styleSheetIdWithItorNum = `${styleSheetIdWithIndex}I${styleItorNum}`
            return {
              index,
              isDynamic,
              isBound,
              styleSheetId,
              styleSheetIdWithIndex,
              styleSheetIdWithItorNum,
              evaluatedStyleObject,
              simpleStyles,
              nestedStyles
            }
        })
        // 是否应该更新 itor？
        // 如果使用了 itor-based style id，就要更新
        let shouldUpdateItor = false
        const stylePatches: StyleObject[] = []
        // 本轮仍然有效的 rolling stylesheet class（形态翻转清理时用来判断哪些是残留）
        let activeRollingClassIds: Set<string>|undefined
        splitStyleObjects.forEach(so => {
            // 如果是 boundProps，优先使用 stylesheet，因为 boundProps 通常是组件级别的基础样式
            // 如果包含 nested style，只能使用 stylesheet，因为依赖于 CSS selector
            const shouldUseStyleSheet = so.isBound || Object.keys(so.nestedStyles).length > 0;
            if (shouldUseStyleSheet) {
                // 如果样式是动态的，则使用 itor 滚动 classname
                // 这里「动态」意味着它可能是
                // - Atom 或者 function
                // - 来自 boundProps 并且是通过 function evaluate 获得
                const shouldUseRollingStyleId = so.isDynamic
                const finalStyleSheetId = shouldUseRollingStyleId ? so.styleSheetIdWithItorNum : so.styleSheetIdWithIndex
                if (shouldUseRollingStyleId) {
                    (activeRollingClassIds ??= new Set()).add(finalStyleSheetId)
                }
                if (styleItorNum === 0 || shouldUseRollingStyleId) {
                    shouldUpdateItor = true

                    // 如果是第一次应用样式，或者需要滚动生成样式，则生成 stylesheet
                    const styleSheet = this.styleScripts.get(finalStyleSheetId) ?? this.createStyleSheet(finalStyleSheetId, so.evaluatedStyleObject)
                    el.classList.add(finalStyleSheetId)
                    this.trackStyleClassAdded(el, finalStyleSheetId)
                    // 保存 stylesheet，更新引用计数
                    this.styleScripts.set(finalStyleSheetId, styleSheet)
                    this.collect(owner, finalStyleSheetId)
                    if (shouldUseRollingStyleId) {
                        const lastStyleSheetId = `${so.styleSheetIdWithIndex}I${styleItorNum - 1}`
                        // 如果是滚动生成样式，则移除上一个 classname
                        el.classList.remove(lastStyleSheetId)
                        this.trackStyleClassRemoved(el, lastStyleSheetId)
                        // 更新引用计数，但归零时并不会立即清除 stylesheet，因为它可能还被 cloneNode 用到
                        // 如果现在清除，cloneNode 的样式会瞬间失效
                        this.updateRefCount(lastStyleSheetId, -1)
                        // CAUTION 长度为 2 的滚动 buffer：上一个 stylesheet 留给 cloneNode 用，
                        //  更早的（已无引用的）立即清除，否则长期存活、样式高频变化的组件
                        //  会让 document.adoptedStyleSheets 无上限累积。
                        if (styleItorNum >= 2) {
                            const expiredStyleSheetId = `${so.styleSheetIdWithIndex}I${styleItorNum - 2}`
                            if ((this.idToRefCount.get(expiredStyleSheetId) ?? 0) <= 0) {
                                this.deleteStyleSheet(expiredStyleSheetId)
                                this.hostToStyleIds.get(owner)?.delete(expiredStyleSheetId)
                            }
                        }
                    }
                }
            } else {
                // 收集普通样式，最后统一赋值
                stylePatches.push(so.simpleStyles)
                // nestedStyles 肯定是空的，这里就不用管了
            }
        })
        // CAUTION 响应式 style 的「形态翻转」清理：上一轮走了 stylesheet 路径（rolling class
        //  挂在元素上），这一轮同一个条目变成了纯 inline / null / 条目消失时，必须把残留的
        //  rolling class 摘掉，否则旧 stylesheet 里的嵌套规则（:hover、子元素选择器等）永远生效。
        //  rolling class 一定以本元素独享的 elToStyleId（含随机段）为前缀，
        //  静态/跨元素共享的 stylesheet class 不受影响。
        const rollingBase = this.elToStyleId.get(el)
        if (rollingBase) {
            const trackedIds = this.elToStyleClassIds.get(el)
            if (trackedIds) {
                for (const id of trackedIds) {
                    if (id.startsWith(rollingBase) && !activeRollingClassIds?.has(id)) {
                        el.classList.remove(id)
                        trackedIds.delete(id)
                        this.updateRefCount(id, -1)
                        // 推进 itor：翻回 stylesheet 路径时用新的 id，
                        //  且下一次滚动的 expired 清理（itor-2）能删掉这里退役的 stylesheet
                        shouldUpdateItor = true
                    }
                }
            }
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
        const previousInlineKeys = this.elToInlineStyleKeys.get(el)
        const nextInlineKeys = new Set<string>()
        for (const patch of stylePatches) {
            if (typeof patch === 'string') {
                // 字符串 patch 会整体覆写 cssText，之前收集的 key 全部失效；
                // 用哨兵记录「当前样式来自字符串」，翻转回对象/null 时要整体清掉 cssText
                nextInlineKeys.clear()
                nextInlineKeys.add(CSS_TEXT_SENTINEL)
            } else if (patch && typeof patch === 'object') {
                for (const k in patch) nextInlineKeys.add(k)
            }
        }
        if (previousInlineKeys) {
            for (const k of previousInlineKeys) {
                if (!nextInlineKeys.has(k)) {
                    if (k === CSS_TEXT_SENTINEL) {
                        // 上一轮写的是字符串 cssText，这一轮不是：整体清除后再按 patch 赋值
                        el.style.cssText = ''
                    } else if (k[0] === '-' && k[1] === '-') {
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
        setAttribute(el, 'style', stylePatches, el instanceof SVGElement)
    }
    isNestedStyleObject(key: string, styleObject: any): boolean {
        // TODO 使用这种方式来判断是不是嵌套的，未来可能有问题
        return key !== '@keyframes' && isPlainObject(styleObject)
    }
    splitStyleObject(styleObject: StyleObject): { simpleStyles: StyleObject, nestedStyles: StyleObject } {
        if (typeof styleObject === 'string') {
          return { simpleStyles: styleObject, nestedStyles: {} }
        }
        // CAUTION null/undefined 返回空对象而不是空字符串：'' 作为 patch 会在 setAttribute
        //  里整体覆写 cssText，把数组里其他 style 对象刚写入的值一起清掉
        //  （style={[base, () => cond() ? {...} : null]} 是自然写法）。
        //  上一轮残留 key 的清除由 elToInlineStyleKeys 的 diff 逻辑负责，不需要 '' 兜底。
        if (styleObject === null || styleObject === undefined) {
          return { simpleStyles: {}, nestedStyles: {} }
        }

        const simpleStyles: StyleObject = {}
        const nestedStyles: StyleObject = {}
        for (const key in styleObject) {
            // 除了值是 PlainObject 的情况，@keyframes 和 animation 也是依赖 CSS selector 的
            // 因此也被按照 nested style 处理
            if (key === '@keyframes' || key === 'animation' || this.isNestedStyleObject(key, styleObject[key])) {
                nestedStyles[key] = styleObject[key]
            } else {
                simpleStyles[key] = styleObject[key]
            }
        }
        
        return { simpleStyles, nestedStyles }
    }
    stringifyKeyFrameObject(keyframeObject: StyleObject): string {
        return Object.entries(keyframeObject).map(([key, value]) => {
            return `${key} {
                ${this.stringifyStyleObject(value)}
            }`
        }).join('\n')
    }
    generateInlineAnimationContent(selector: string, styleObject: StyleObject) {
        const animationContent: string[] = []
        let animationName = ''
        animationName = `animation-${Math.random().toString(36).slice(2)}`
        if (styleObject['@keyframes']) {
            const keyframeContent = `@keyframes ${animationName} {
${this.stringifyKeyFrameObject(styleObject['@keyframes'])}
}`
            animationContent.push(keyframeContent)
        }

        if (styleObject.animation) {
            // CAUTION 多个动画的分隔符是逗号（与 CSS animation 简写语法一致），空格连接会让
            //  整条声明非法、被浏览器静默丢弃；@self 用 /g 全部替换，数组里每一项都可能引用它。
            const animationValue = (Array.isArray(styleObject.animation) ? styleObject.animation.join(', ') : styleObject.animation)!.replace(/@self/g, animationName)
            animationContent.push(`
${selector} {
    animation: ${animationValue};
}
`)
        }

        return animationContent
    }
    generateStyleContent(selector: string, styleObject: StyleObject): string[] {

        const valueStyleObject = { ...styleObject }
        const nestedStyleEntries: [string, any][] = []
        const keyframeObj: StyleObject = {}

        for (const key in valueStyleObject) {
            if (key === '@keyframes' || key === 'animation') {
                keyframeObj[key] = valueStyleObject[key]
                delete valueStyleObject[key]
            } else if (this.isNestedStyleObject(key, valueStyleObject[key])) {
                nestedStyleEntries.push([key, valueStyleObject[key]])
                delete valueStyleObject[key]
            } else if(valueStyleObject[key] === null|| valueStyleObject[key] === undefined || typeof valueStyleObject[key] === 'boolean') {
                // boolean 来自 {fontWeight: cond && 'bold'} 的条件写法，语义同 null（F36 同类）
                delete valueStyleObject[key]
            }
        }

        const contents: string[] = [`${selector} {
${this.stringifyStyleObject(valueStyleObject)}
}`]

        const animateContent = this.generateInlineAnimationContent(selector, keyframeObj)
        contents.push(...animateContent)

        return nestedStyleEntries.reduce((acc, [key, nestedObject]: [string, any]) => {
            // 支持 at-rules for media/container query
            if (key.startsWith('@')) {
                // CAUTION 递归结果是 string[]，必须显式 join('\n')：
                //  直接内插进模板字符串会按 ',' 连接，at-rule 里第一条之后的所有规则
                //  （嵌套 selector、@keyframes/animation）都会变成非法 CSS 被浏览器静默丢弃。
                return acc.concat(`${key} {
    ${this.generateStyleContent(selector, nestedObject).join('\n')}
}`)
            }

            return acc.concat(this.generateStyleContent(scopeNestedSelector(selector, key), nestedObject))
        }, contents)

    }
}

/**
 * 把嵌套样式 key 作用域化到 selector 下。
 * CAUTION 必须逐个处理逗号分隔的 selector，且 '&' 要全部替换：
 *  - 'X, Y' 的每个部分都要被作用域化，否则第一个之后的 selector 要么带着残留的
 *    顶层 '&' 永不匹配，要么（不含 & 时）变成未作用域的全局 selector 污染组件外元素；
 *  - 残留在顶层 stylesheet 里的 '&' 还会让整条规则的匹配在 Chromium 下不稳定。
 *  逗号切分要跳过括号/方括号/引号内部（:is(.a, .b)、[data-x="1,2"] 里的逗号不是分隔符）。
 */
function scopeNestedSelector(selector: string, key: string): string {
    return splitSelectorList(key).map(part => {
        const trimmed = part.trim()
        return trimmed.includes('&') ? trimmed.replaceAll('&', selector) : `${selector} ${trimmed}`
    }).join(', ')
}

// 按顶层逗号切分 selector 列表（忽略 () / [] / 引号内部的逗号）
function splitSelectorList(input: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote: string | null = null
    let start = 0
    for (let i = 0; i < input.length; i++) {
        const ch = input[i]
        if (quote) {
            if (ch === quote && input[i - 1] !== '\\') quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === '(' || ch === '[') {
            depth++
        } else if (ch === ')' || ch === ']') {
            depth--
        } else if (ch === ',' && depth === 0) {
            parts.push(input.slice(start, i))
            start = i + 1
        }
    }
    parts.push(input.slice(start))
    return parts
}

type StyleObject = { [k: string]: any }

// elToInlineStyleKeys 里的哨兵 key：标记「上一轮 inline 样式是字符串 cssText 整体覆写」，
//  翻转回对象/null 形态时必须整体清除 cssText（字符串里写过哪些 key 无从得知）。
const CSS_TEXT_SENTINEL = '__cssText__'

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
            source instanceof DocumentFragment ?
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
    if (source instanceof DocumentFragment ||
        el.unhandledChildren || el.unhandledAttr || el.refHandles || el.detachStyledChildren) {
        consumedReactiveElements.add(source)
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
        if (this.source instanceof DocumentFragment) {
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

        // CAUTION 如果是 fragment，我们用一个 comment 节点来作为第一个元素，这样后面  destroy 的时候就能一次性 remove 掉。
        this.element = this.source instanceof DocumentFragment ? document.createComment('fragment start') : this.source

        // FIXME 应该要先 render 完所有的里面的 host。再插入自己才对。不然里面的 host render 会触发 layout.
        // insertBefore(this.element, this.placeholder)
        //
        // // 如果是 fragment，那么还要插入真实内容
        // if (this.source instanceof DocumentFragment) {
        //     insertBefore(this.source, this.placeholder)
        // }

        this.collectInnerHost()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        this.renderReactiveHosts()
        //
        insertBefore(this.element, this.placeholder)
        // 如果是 fragment，那么还要插入真实内容
        if (this.source instanceof DocumentFragment) {
            insertBefore(this.source, this.placeholder)
        }

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
                this.removeAttachListener = root.on('attach', () => this.attachRefs(), {once: true})
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
        const isFragment = this.source instanceof DocumentFragment
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
                value.map(v => isAtomLike(v) ? v() : v) :
                isAtomLike(value) ? value() : value
            if (key === 'className' || key === 'class') {
                // CAUTION className 更新是整体覆写 class attribute，
                //  必须把 StyleManager 挂上去的 stylesheet class 补回来，否则嵌套样式/boundProps 样式静默丢失。
                setAttribute(el, key, final, isSVG)
                StaticHost.styleManager.reapplyStyleClasses(el)
            } else if (/^data-/.test(key)) {
                // 使用 dataset 的时候 key 要进行驼峰化
                // ref: https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLElement/dataset#%E5%90%8D%E7%A7%B0%E8%BD%AC%E6%8D%A2
                // CAUTION null/undefined 表示移除属性，dataset 赋值会把它们字符串化成
                //  字面 "null"/"undefined"，必须用 delete。
                if (final == null) {
                    delete el.dataset[camelize(key.slice(5))]
                } else {
                    el.dataset[camelize(key.slice(5))] = final
                }
            } else {
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
    //  需要脱离 this 使用的注册点（root.on('attach')）自己包一层箭头函数，只有带 ref 的元素才分配。
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
                if (!parentHandle &&
                    this.placeholder.parentNode &&
                    this.element.parentNode === this.placeholder.parentNode) {
                    removeNodesBetween(this.element!, this.placeholder, true, {
                        ownerHost: this,
                        operation: 'destroy',
                    })
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
                const evaluated = isAtomLike(value) ? value() : value
                const finalStyle: StyleObject = Array.isArray(evaluated) ?
                    Object.assign({}, ...evaluated.map(v => isAtomLike(v) ? v() : v)) :
                    evaluated

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
                    value.map(v => isAtomLike(v) ? v() : v) :
                    isAtomLike(value) ? value() : value
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
                if (!this.placeholder.parentNode || this.element.parentNode !== this.placeholder.parentNode) return
                removeNodesBetween(this.element!, this.placeholder, true, {
                    ownerHost: this,
                    operation: 'destroy',
                })
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
    destroy(parentHandle?: boolean) {
        // CAUTION 先减 compact 计数再登记 destroyed，顺序反了会被去重逻辑跳过
        trackCompactHostDestroyed(this)
        trackHostDestroyed(this)
        this.destroyAttrEffects()
        this.removeAttachListener?.()
        this.destroyReactiveHosts()
        this.detachRefsWithErrorHook()
        if (!parentHandle) {
            (this.element as HTMLElement).remove()
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
