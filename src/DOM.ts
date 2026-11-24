/// <reference lib="dom" />
import {isAtom, RxList} from "data0";
import {assert, each, isPlainObject} from './util'
import {isDomNode, isElementNode, isFragmentNode} from './nodeType'
import {Component, ComponentNode} from "./types";
import {isAxiiDiagnosticsEnabled, reportAxiiError, warnInvalidOnProp} from "./diagnostics";
import type {AxiiSource} from "./diagnostics";
import {SSR_STYLE_CLASSES_ATTRIBUTE, autoUnit, getAutoUnitType, setAutoUnitType} from './styleSerialize'
import {
    REMOVE_ATTRIBUTE,
    WRITE_EMPTY,
    WRITE_NULL,
    attributeNameOfProperty,
    emptyOrBooleanWrite,
    hasOnPrefix,
    innerHTMLOf,
    isEventName,
    isInnerHTMLObject,
    isRawWriteProperty,
    isSvgHtmlIntegrationPoint,
    svgHtmlSharedElementNames,
    svgOnlyElementNames,
    svgPresentationAttributeNames,
    textareaContentProp,
} from './markupNames'
import {
    advanceCursorUntilComment,
    advanceCursorUntilRxListHostPlaceholder,
    advancePastNode,
    claimAtomTextPlaceholder,
    claimCommentAtCursor,
    claimDirectNodeText,
    claimFunctionTextPlaceholder,
    claimTextUnit,
    createElementForHydrateMismatch,
    createHydrateDeferredElement,
    enterElementChildCursor,
    exitElementChildCursor,
    getChildCursor,
    insertHydrateMismatchElement,
    isElementChildCursorActive,
    isHydrateDeferredElement,
    isHydrateOnMainRoot,
    isClaimStoppedAtSvgCounterpart,
    isHydrating,
    markHydrateReclaimPayload,
    peekAxii0,
    peekHydrateDeferredPayload,
    reconcileFlattenedFragmentHydrateChildren,
    resolveHydrateChildParent,
    rememberHydrateRollingStyleBase,
    takeHydrateDeferredPayload,
    takeHydrateReclaimPayload,
    tryClaimElement,
    unclaimHydrateElement,
} from "./hydration";

export const AUTO_ADD_UNIT_ATTR = /^(width|height|top|left|right|bottom|margin|marginTop|marginRight|marginBottom|marginLeft|padding|paddingTop|paddingRight|paddingBottom|paddingLeft|borderWidth|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|outlineWidth|borderRadius|fontSize|letterSpacing|wordSpacing|textIndent|maxWidth|maxHeight|minHeight|minWidth|gap|flexBasis|columnGap|rowGap|columnWidth)$/
// CAUTION 单位状态与 autoUnit 的实现只在 styleSerialize 里有一份（stylesheet / SSR 与行内样式共用），
//  这里只是保持原有的对外导出。
export {setAutoUnitType, autoUnit}

export const COMMA_MULTI_VALUE_ATTR = /^(boxShadow|textShadow|transition|animation|backgroundImage)/

// [number, string] 简写（[12, 'px'] => '12px'）只对真正的 CSS 单位生效：
// margin: [0, 'auto'] 这类「数字 + 关键字」的空格简写是自然写法，误判成单位会拼出
// "0auto" 这种非法值，浏览器静默拒绝整条声明（样式无效且没有任何报错）。
const CSS_UNIT_VALUE = /^(px|em|rem|%|vw|vh|vmin|vmax|pt|pc|in|cm|mm|q|ex|ch|ic|cap|lh|rlh|fr|s|ms|deg|rad|grad|turn|dpi|dpcm|dppx|cqw|cqh|cqi|cqb|cqmin|cqmax|svw|svh|lvw|lvh|dvw|dvh)$/i

export function stringifyStyleValue(k:string, v: any): string {
    // CAUTION style 对象的值可以是 atom/函数（style={{color: colorAtom}} 是自然写法），
    //  这里统一求值。调用点都在响应式绑定（LightBindingEffect / StyleManager.update）内，
    //  读取会正确建立依赖。不求值的话函数源码会被字符串化成非法 CSS，且没有任何响应性。
    if (typeof v === 'function') v = v()
    // 当值是 falsy 的时候 设置 style[k] 为 ''，用来清除 inline style
    // CAUTION boolean 必须和 null/undefined 一样按「清除」处理：{fontWeight: cond && 'bold'} 的
    //  条件写法翻转为 false 时，'false' 是非法 CSS 值，浏览器会静默拒绝这次赋值——
    //  旧值（'bold'）不会被清除，样式永久残留（F36）。
    if (v === undefined || v === null || typeof v === 'boolean') return ''
    if(Array.isArray(v)) {
        // CAUTION [数字, 单位] 简写必须先于逗号列表判断：接受时间单位的属性（transitionDuration /
        //  transitionDelay / animationDuration / animationDelay）全部命中 COMMA_MULTI_VALUE_ATTR，
        //  先走逗号分支的话 [300, 'ms'] 被拼成 "300,ms"——非法值，浏览器静默拒绝整条声明，
        //  CSS_UNIT_VALUE 里的 s/ms 永远用不上。「数字 + 单位名」本身不可能是合法的逗号列表。
        if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            // [12, 'px'] => 12px
            return `${v[0]}${v[1]}`
        }
        // CAUTION 这里的 v 都加上了 v.toString()，因为有可能是 StyleSize
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            // attr like box-shadow
            // 这里不可能是 StyleSize 所以不用 toString；数组项同样支持 atom/函数值。
            // CAUTION 条件项（cond && '0 0 2px blue'）的 falsy 结果必须过滤掉：
            //  'false' 混进逗号列表会让整条声明非法，浏览器静默丢弃 => 旧值永远残留（F36）。
            const parts: string[] = []
            for (let i of v) {
                if (typeof i === 'function') i = i()
                if (i === undefined || i === null || typeof i === 'boolean' || i === '') continue
                parts.push(i)
            }
            return parts.join(',')
        } else {
            // padding/margin/transform|translate|scale|rotate|skew
            // 支持 undefined 值自动 fallback 到 0 值
            return v.map((i:any) => stringifyStyleValue(k, i ?? 0)).join(' ')
        }
    }
    // number/string/StyleSize
    // CAUTION 空字符串的语义是「清除该 key」（与 React 一致），绝不能被 `v||0` 塞成 "0px"：
    //  {width: cond ? 100 : ''} 的条件写法翻转后宽度会静默变成 0 而不是恢复默认。
    //  到达这里的 v 不可能是 null/undefined（开头已 return），无需 fallback。
    if (v === '') return ''
    return (!(v instanceof StyleSize) && AUTO_ADD_UNIT_ATTR.test(k)) ? autoUnit(v) : v.toString()
}


// type WritablePropertyName = Exclude<keyof HTMLElement, keyof Readonly<HTMLElement> >
/** Attempt to set a DOM property to the given value.
 *  IE & FF throw for certain property-value combinations.
 */
function setProperty(node: HTMLElement, name: string, value: any) {
    try {
        // name value 的类型不会写
        // @ts-ignore
        node[name] = value
    } catch (e) {
        // CAUTION 与只读 property 同名的 name 仍可能是合法的 HTML attribute（form 这类
        //  常见项已在 setAttribute 显式排除，这里兜底自定义元素等未知的同类形态）：
        //  严格模式下对只读 accessor 赋值直接 TypeError，静默丢弃会让属性永远设不上去，
        //  回退到 attribute 写入。
        try {
            node.setAttribute(name, value)
            /* v8 ignore next 5 */
        } catch {
            /* eslint-disable no-console */
            console.error(e)
            /* eslint-enable no-console */
        }
    }
}

/**
 * 通用 property 分支里 null / undefined / boolean 值的写入（静态与响应式属性共用，唯一一份）。
 *
 * 规则本身（按 property 类型决定写什么、要不要移除 attribute）在 markupNames.emptyOrBooleanWrite，
 *  property 名对应的真实 attribute 名在 markupNames.attributeNameOfProperty（#51）：axii/ssr 用同一条规则、
 *  按静态类型表推出同一个 attribute，两端不再各有一份。这里只负责取「property 类型」——typeof node[name]，
 *  只在这个慢路径里读一次——并执行写入码。
 *
 *  null 不读 property（与修改前一样便宜）：先写 ''，只有 object 类型的 setter 会拒绝 ''，
 *  在异常分支里才读类型、改写 null（见 clearProperty）；随后按真实 attribute 名移除。
 *
 *  原样写入的例外（不读 property）：自定义元素（tagName 带 '-'，property 的语义由组件自己定义），
 *  以及 markupNames.isRawWriteProperty 的名字（contentEditable / writingSuggestions / aria* / hidden）。
 *  value / checked（表单控件）不走这里，各有专门的分支。
 */
function setEmptyOrBooleanProperty(node: HTMLElement, name: string, value: null | undefined | boolean) {
    if (value === null) {
        clearProperty(node, name)
        node.removeAttribute(attributeNameOfProperty(name))
        return
    }
    const code = emptyOrBooleanWrite(
        node.tagName.indexOf('-') === -1 && !isRawWriteProperty(name) ? (node as any)[name] : undefined,
        value,
    )
    setProperty(node, name, code & WRITE_EMPTY ? '' : code & WRITE_NULL ? null : value)
    if (code & REMOVE_ATTRIBUTE) node.removeAttribute(attributeNameOfProperty(name))
}

// null 的写入（见 markupNames.emptyOrBooleanWrite 的表）：'' 对 string / number / boolean property 都是「空」。
function clearProperty(node: HTMLElement, name: string) {
    try {
        (node as any)[name] = ''
    } catch {
        // object 类型的可空 property（srcObject / valueAsDate / popoverTargetElement）拒绝 ''，它们的「空」是 null。
        //  其余拒绝 '' 的 setter（contentEditable、自定义元素）照旧交给 setProperty 的 attribute 兜底。
        setProperty(node, name, typeof (node as any)[name] === 'object' ? null : '')
    }
}

// CAUTION 数组形态的 prop（style / className / 事件 handler）可以被转发进另一个数组：
//  组件写 style={[base, props.style]}，调用方自己又传数组，就得到嵌套数组。children、ref、
//  响应式 style（evaluateStyleEntries）都支持嵌套，这三处曾只处理一层——内层数组掉进
//  「对象」分支：style 按下标给 CSSStyleDeclaration 赋值直接 TypeError（渲染崩溃），
//  className 把下标 "0 2" 当 class 名写出，事件分发时把数组当函数调用（TypeError，
//  其余 handler 被跳过）。
//  没有嵌套数组（绝大多数）时只多一次 some 扫描：Array.isArray 是内建函数引用，
//  不产生闭包，也不分配新数组。
function flattenNestedArray(value: any[]): any[] {
    return value.some(Array.isArray) ? value.flat(Infinity) : value
}

type EventListenerValue = ((e: Event, ...args: any[]) => any) | ((e: Event, ...args: any[]) => any)[]

// CAUTION 以事件名为一级 key、来源 prop（别名前的事件名，如 change/input）为二级 key：
//  onChange 会被别名成 input 事件，与用户同时写的 onInput 落到同一个事件名下，
//  二级 key 让解绑（传 falsy）只影响自己来源的监听，不会把别人的一起删掉。
type EventListenerEntries = {
    [sourceKey: string]: EventListenerValue
}

export interface ExtendedElement extends HTMLElement {
    _listeners?: {
        [k: string]: EventListenerEntries
    },
    _captureListeners?: {
        [k: string]: EventListenerEntries
    }
    listenerBoundArgs?: any[]
    unhandledChildren?: UnhandledChildInfo[]
    unhandledAttr?: UnhandledAttrInfo[]
    refHandles?: RefHandleInfo[]
    detachStyledChildren?: DetachStyledInfo[]
    // 开发期 JSX source（文件/行/列），由 jsxDEV 写入
    __axiiSource?: AxiiSource
}

function invokeEventEntries(el: ExtendedElement, entries: EventListenerEntries|undefined, e: Event) {
    if (!entries) return
    const args = el.listenerBoundArgs || []
    // CAUTION 保留每个 handler 的返回值：单个 handler 返回其值，多个（数组或多来源）返回值数组
    let firstResult: any
    let hasFirst = false
    let results: any[] | undefined
    // CAUTION 事件回调是用户代码，且同一个事件名下会聚合多个相互独立的来源：
    //  数组形态（onClick={[a, b]}）、以及 onChange 别名成 input 后与用户显式 onInput
    //  落到同一事件名下。一个 handler 抛错绝不能静默跳过其余兄弟——这既违反直觉，也和
    //  浏览器「每个 addEventListener 相互独立」的语义不一致（这是框架里最后一个没做
    //  兄弟错误隔离的用户回调聚合点，与 ref/cleanup/effect/flush 的 I43/I51 语义对齐）。
    //  逐个隔离执行，首个错误批末重新抛出保持可观测，其余经 reportAxiiError 结构化上报。
    //  无抛错时（绝大多数）try/catch 在 V8 上零成本，返回值收集逻辑不变。
    let firstError: unknown
    let hasError = false
    for (const key in entries) {
        const listener = entries[key]
        let value: any
        if (Array.isArray(listener)) {
            const arrayResult = new Array(listener.length)
            for (let i = 0; i < listener.length; i++) {
                // CAUTION 数组中的 falsy 条件项（onClick={[a, cond && b]}）按「条件不满足」跳过：
                //  style/className 数组的 falsy 项、单个 falsy handler（解绑）都是这个语义，
                //  唯独这里曾对 false 直接调用（false 不是 nullish，?. 拦不住）——每次事件
                //  触发都 TypeError。对应返回值槽位保持 undefined。
                const item = listener[i]
                if (item == null || typeof item === 'boolean') continue
                try {
                    arrayResult[i] = item(e, ...args)
                } catch (err) {
                    if (!hasError) { hasError = true; firstError = err } else reportAxiiError(err)
                }
            }
            value = arrayResult
        } else {
            try {
                value = listener?.(e, ...args)
            } catch (err) {
                if (!hasError) { hasError = true; firstError = err } else reportAxiiError(err)
            }
        }
        if (!hasFirst) {
            hasFirst = true
            if (Array.isArray(listener)) {
                results = value as any[]
            } else {
                firstResult = value
            }
        } else {
            if (results === undefined) results = [firstResult]
            if (Array.isArray(value)) {
                results.push(...value)
            } else {
                results.push(value)
            }
        }
    }
    if (hasError) throw firstError
    return results ?? firstResult
}

function eventProxy(this: ExtendedElement, e: Event) {
    return invokeEventEntries(this, this._listeners?.[e.type], e)
}

function captureEventProxy(this: ExtendedElement, e: Event) {
    return invokeEventEntries(this, this._captureListeners?.[e.type], e)
}

// CAUTION 大多数占位符是 Comment。函数/atom 类型的 child 用 Text 节点做占位符（乐观策略）：
//  它们绝大多数渲染为文本，此时占位符自身就能当 Text 节点用，省一次节点创建和插入。
export type UnhandledPlaceholder = Comment | Text


// 事件名判定（on + 大写字母）与「以 on 开头、不区分大小写」的判定都只在 markupNames.ts 定义一份：
//  axii/ssr 与 diagnostics 也要用，而它们不能 import 本模块。这里原样导出 isEventName（定义处的 @internal
//  标记保证它和原来一样不进入发布的类型声明），运行时导出不变。
export {isEventName}


// svgPresentationAttributeNames / svgOnlyElementNames 在 markupNames.ts：CSR 与 axii/ssr 共用同一份名称表。
// CAUTION svg-only 标签的 namespace 判断必须在 createElement 内部做（而不是只在 jsx/jsxs/jsxDEV runtime 路由）：
//  classic pragma（/* @jsx createElement */）和组件 renderContext 的 createElement 都不经过
//  runtime factory，只在 runtime 路由的话这两条链路里 <svg> 会被创建成 HTMLUnknownElement，
//  整个图形静默不显示——同一个 JSX 在两种编译模式下行为分叉。

/**
 * @internal
 */
export function setAttribute(node: ExtendedElement, name: string, value: any, isSvg?: boolean): void {
    // CAUTION class 与 className 语义完全一致（mergeProp 也对两者做同样的合并），
    //  统一成 className 处理：否则 AOP 合并出的 class 数组会掉进「取最后一个」的覆盖分支，
    //  合并语义被静默破坏（外部覆盖值丢失）。
    if (name === 'class') name = 'className'
    // CAUTION multiple select 的 value 天然就是数组（HTML 多选的用户本意），不能落进
    //  「数组取最后一个」的覆盖语义——mergeProp 从不会把 value 合并成数组，
    //  所以 select 上的数组 value 一定来自用户，必须按多选语义整体应用。
    // CAUTION data-* 的数组同样来自用户（mergeProp 不会把它合并成数组），整体字符串化写入
    //  （data-ids={[1, 2]} => "1,2"）。响应式路径一直是这个语义（曾经走 dataset 赋值），
    //  静态路径不能把它塌成最后一项，否则同一个属性静态/响应式写出的值不同。
    if (Array.isArray(value) && name !== 'style' && name !== 'className' && !isEventName(name) &&
        !(name === 'value' && node.tagName === 'SELECT') &&
        !(name.charCodeAt(0) === 100 && name.startsWith('data-'))) {
        // 全都是覆盖模式，只处理最后一个
        return setAttribute(node, name, value.at(-1), isSvg)
    }

    // uuid
    if (name === 'uuid') {
        // CAUTION nullish 表示没有 uuid，setAttribute 会写出字面 "undefined"/"null"
        if (value == null) {
            node.removeAttribute('data-uuid')
        } else {
            node.setAttribute('data-uuid', value)
        }
        return
    }

    // 事件，以及其余所有以 on 开头（不区分大小写）的名字
    // CAUTION 这里原来只判断 isEventName：ONCLICK / oNclick / OnClick 落进下面的 attribute 回退分支，
    //  setAttribute 后被 HTML 转成小写的 onclick，成了可执行的事件处理器；小写 onclick 在 SVG 上
    //  同样走 attribute 分支，在 HTML 元素上走 property 分支（函数值会成为生效的 handler）。
    //  名字以 on 开头、但不是事件名的 prop 一律不写（#49，与 React 一致；见 markupNames.hasOnPrefix）。
    //  热路径：hasOnPrefix 替换了原来的 isEventName 分发判断，首字符不是 o/O 的名字只读一次 charCode，
    //  普通属性写入不多付代价；只有以 on 开头的名字才多一次 isEventName。
    if (hasOnPrefix(name)) {
        if (!isEventName(name)) {
            warnInvalidOnProp(name, value)
            return
        }
        // 书写时的 prop 名（剥掉 Capture 之前），开发期警告按它去重；只是引用，不分配
        const propName = name
        // CAUTION Capture 后缀表示捕获阶段，但 gotpointercapture / lostpointercapture 是事件名本身：
        //  无条件剥掉后缀的话 onGotPointerCapture 会在不存在的 gotpointer 事件上挂一个捕获监听，
        //  永远不触发且没有任何报错。它们的捕获形态是 onGotPointerCaptureCapture（与 React 一致）。
        //  只在绑定时执行一次，不在分发路径上。
        let useCapture = false
        if (name.endsWith('Capture') && name !== 'onGotPointerCapture' && name !== 'onLostPointerCapture') {
            useCapture = true
            name = name.slice(0, -7)
        }
        // sourceKey 是别名前的事件名（如 change），用于区分监听的来源
        const sourceKey = name.toLowerCase().substring(2)
        // CAUTION 体验改成和 react 的一致：onChange -> input。
        //  onDoubleClick（React 拼法）对应的 DOM 事件是 dblclick，不别名的话监听器
        //  会挂在不存在的 doubleclick 事件上，永远不触发且没有任何报错。
        const eventName = sourceKey === 'change' ? 'input' :
            sourceKey === 'doubleclick' ? 'dblclick' : sourceKey
        const proxy = useCapture ? captureEventProxy : eventProxy

        const listeners = useCapture ?
            (node._captureListeners || (node._captureListeners = {})) :
            (node._listeners || (node._listeners = {}))

        if (value) {
            // 转发进来的嵌套 handler 数组在绑定时摊平一次（见 flattenNestedArray），分发路径不变
            if (Array.isArray(value)) value = flattenNestedArray(value)
            // CAUTION 开发期警告（I65）：atom 本身是 function，被直接绑成事件 handler 时
            //  事件分发会以「写入」形态调用它（atom(event)）——事件对象被静默写进 atom，
            //  handler 不执行且状态损坏，没有任何报错。事件按设计是非响应式的（绑定一次），
            //  正确写法是 onClick={(e) => handlerAtom()(e)}。绑定只在元素创建时发生一次，
            //  诊断关闭（生产）时只付一个布尔检查。
            if (isAxiiDiagnosticsEnabled()) {
                if (Array.isArray(value) ? value.some(isAtom) : isAtom(value)) {
                    /* eslint-disable no-console */
                    console.error(`[axii] "${name}" received an atom as its event handler. ` +
                        'Dispatching the event would WRITE the event object into the atom instead of calling the stored handler ' +
                        '(events are bound once and are not reactive). Use a wrapper like onClick={(e) => handlerAtom()(e)}.')
                    /* eslint-enable no-console */
                } else {
                    // 事件名配非函数值（onClick="alert(1)"）不是合法的事件处理器（#49）：从不写成 attribute，
                    //  仍按原样绑定（事件触发时抛错，行为不变），开发期按 prop 名警告一次。
                    warnInvalidOnProp(propName, value)
                }
            }
            // CAUTION 同一个 proxy 重复 addEventListener 会被 DOM 自动去重，这里无需判断
            node.addEventListener(eventName, proxy, useCapture)
            // CAUTION onChange 会被别名成 input 事件，与用户同时写的 onInput 落到同一个事件名下，
            //  按来源分槽存储：两者都会被触发，且互不影响对方的绑定/解绑。
            //  同一来源重复设置是覆盖语义（重绑）。
            const entries = listeners[eventName] || (listeners[eventName] = {})
            entries[sourceKey] = value
        } else {
            // 传入 falsy 值表示解绑：只解绑自己来源的监听，
            // 该事件名下已无任何来源时才移除 proxy
            const entries = listeners[eventName]
            if (entries) {
                delete entries[sourceKey]
                let empty = true
                // eslint-disable-next-line no-unreachable-loop
                for (const _ in entries) {
                    empty = false
                    break
                }
                if (empty) {
                    delete listeners[eventName]
                    node.removeEventListener(eventName, proxy, useCapture)
                }
            } else {
                node.removeEventListener(eventName, proxy, useCapture)
            }
        }

        return
    }

    // style
    if (name === 'style') {
        // CAUTION falsy 值（false/null/undefined，来自 style={cond && {...}} 的条件写法）
        //  语义是清空 inline style，必须 return，否则会掉进下面的类型 assert。
        if (!value || (Array.isArray(value) && !value.length)) {
            node.style.cssText = ''
            return
        }
        const styles = Array.isArray(value) ? flattenNestedArray(value) : [value]
        styles.forEach(style => {
            // 数组中的条件项 [base, cond && {...}]，falsy 直接跳过
            if (style == null || typeof style === 'boolean') return
            if (typeof style === 'string') {
                node.style.cssText = style
            } else  if (typeof style === 'object') {
                each(style, (v, k) => {
                    if (k[0] === '-' && k[1] === '-') {
                        // CSS 自定义属性同样支持 atom/函数值
                        // CAUTION 条件值（cond && val）的 falsy 结果按移除处理，
                        //  否则 setProperty 会把 false 字符串化成 "false" 写进变量（F36 同类）。
                        const evaluated = typeof v === 'function' ? v() : v
                        if (evaluated === undefined || evaluated === null || typeof evaluated === 'boolean') {
                            node.style.removeProperty(k)
                        } else {
                            node.style.setProperty(k, evaluated)
                        }
                    }else {
                        // @ts-ignore
                        node.style[k] = stringifyStyleValue(k, v)
                    }
                })
            } else {
                assert(false, 'style can only be string or object.')
            }
        })
        return
    }

    if (name === 'className') {
        // 快速路径：纯字符串 className（最常见）
        if (typeof value === 'string') {
            if (isSvg) {
                node.setAttribute('class', value)
            } else {
                node.className = value
            }
            return
        }
        const classNameOptions = Array.isArray(value) ? flattenNestedArray(value) : [value]
        const classNames:string[] = []
        classNameOptions.forEach((className) => {
            // CAUTION 条件写法 className={cond && 'x'} 的 falsy 结果（false/null/undefined）跳过，
            //  单值 falsy 时落到下面的 join('') 清空 class，与「条件不满足」的语义一致。
            if (className == null || typeof className === 'boolean') return
            if (typeof className === 'object') {
                for(const name in className) {
                    // CAUTION 对象形式的 value 支持 atom/函数（className={{active: isActive}}），
                    //  这里统一求值。调用点在响应式绑定内时读取会建立依赖；
                    //  不求值的话 atom（本身是 function，恒 truthy）会让 class 永远挂在元素上。
                    const value = className[name]
                    if (typeof value === 'function' ? value() : value) {
                        classNames.push(name)
                    }
                }
            } else if (typeof className === 'string') {
                // 只能是 string
                classNames.push(className)
            } else {
                assert(false, 'className can only be string or {[k:string]:boolean}')
            }
        })
        node.setAttribute('class', classNames.join(' '))
        return
    }

    // 剩下的都是 primitive value 的情况了
    if (name === 'key' || name === 'ref') {
        // ignore
    } else if (name === 'value') {
        if (node.tagName === 'SELECT') {
            // CAUTION 因为 select 如果 option 还没有渲染（比如 computed 的情况），那么设置 value 就没用，
            //  我们这里先存着，等 append option children 的时候再 set value 一下。
            //  null/undefined 存空字符串（清空选中）。数组（multiple select 的多选值）原样保存，
            //  应用/恢复统一走 applySelectValue。
            const storedValue = value ?? ''
            ;(node as SelectWithAxiiValue).__axiiSelectValue__ = storedValue
            controlledSelectSeen = true
            applySelectValue(node as unknown as HTMLSelectElement, storedValue)
            return
        }
        // CAUTION null/undefined 的语义是「清除 value」，但这个分支绕过了 setProperty 的
        //  try/catch，直接 property 赋值对不同元素的 value 类型并不安全：
        //  - PROGRESS/METER 的 value 是 WebIDL double，undefined（NaN）赋值直接 TypeError
        //    崩溃渲染（value={cond ? n : undefined} 是自然写法），null 会静默变成 0；
        //  - OPTION/BUTTON/DATA/OUTPUT 等的 value property 反射 attribute，null/undefined
        //    会字符串化成字面 "null"/"undefined"——option 的 value 从此永远匹配不上
        //    select 的存值，选中静默丢失。
        //  除 INPUT/TEXTAREA（受控输入用 '' 表示清空，见下）外统一移除 attribute。
        if (value == null && node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA') {
            node.removeAttribute('value')
            if (node.tagName === 'OPTION') {
                // 移除 value attr 后 option 的 value 回退为文本，此刻可能才与 select 存值匹配
                const ownerSelect = findOwnerSelect(node.parentElement)
                if (ownerSelect) {
                    resetOptionParentSelectValue(ownerSelect)
                }
            }
            return
        }
        // CAUTION 所有 input 类型（不只 type=text）和 textarea：value 为 undefined/null 时
        //  显示空字符串，否则会渲染出字面 "undefined"/"null"（checkbox 的 value property
        //  同样不能残留 "null"，它是表单提交值）。
        // CAUTION 经 setProperty 而不是裸赋值（I62，F49 同类残留）：PROGRESS/METER 的 value
        //  是 WebIDL double，非数字字符串（来自后端的垃圾数据）直接赋值会 TypeError 崩溃
        //  整棵渲染树——同元素的 max/min（通用分支）对同样的垃圾值走 setProperty 的
        //  try/catch 优雅降级（回退 setAttribute，浏览器按 0 处理），value 必须一致。
        //  INPUT/TEXTAREA/OPTION 等 DOMString 类 value 的赋值永不抛错，行为不变。
        setProperty(node, 'value', value == null ? '' : value)

        if (node.tagName === 'INPUT') {
            // CAUTION input 的 value 解释依赖 type（checkbox 的 value 即 checked、range 会按
            //  min/max 截断）。type 可以是响应式的（type={visible ? 'text' : 'password'} 是
            //  自然写法），翻转后必须能按新 type 重放 value——这里存下原始值。
            const input = node as InputWithAxiiValue
            input.__axiiInputValue__ = value
            // range 约束更新时只在 DOM 仍等于框架最后一次写入值时重放；
            // 用户拖动或外部脚本改过 value 后必须保留当前交互值。
            if ((node as HTMLInputElement).type === 'range') {
                input.__axiiInputAppliedValue__ = (node as HTMLInputElement).value
            }
        }

        if (node.tagName === 'OPTION') {
            // 当 option 的 value 发生变化的时候也要 reset 一下，因为可能这个时候与 select value 相等的 option 才出现
            // CAUTION option 可能包在 optgroup 里（合法且常见的 HTML），不能只认直接父级是 select 的形态
            const ownerSelect = findOwnerSelect(node.parentElement)
            if (ownerSelect) {
                resetOptionParentSelectValue(ownerSelect)
            }
        } else if (node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'checkbox') {
            // checkbox 也支持用 value ，这样容易统一 api
            // CAUTION 只有 boolean 的 value 才是「勾选状态」（旧的勾选通道），而且只在元素没有 checked prop 时生效
            //  （ssr.ts serializeAttrs 的 CB 通道用同一条规则，§3.6.2）：
            //  - string/number 是 checkbox 的表单提交值（<input type="checkbox" name="color" value="red" checked={isRed}/>
            //    是标准的 checkbox 组写法），按 truthy 当成勾选的话，带提交值的 checkbox 一律渲染成勾选（#48）。
            //  - null/undefined 表示「没有 value」，不触碰勾选状态（#52）：转发组件 Check({checked, value}) 里
            //    调用方不传的 value 就是 undefined，按「未勾选」处理会清掉显式的 checked={true}；
            //    响应式提交值变成 undefined 也会取消勾选。
            //  - 显式的 checked 永远决定勾选状态，与书写顺序无关（#52）：value 与 checked 的首次应用按 rawProps 键序
            //    （静态的 null 值还会落进 unhandledAttr、排到静态属性之后），响应式 value 之后的每次更新、
            //    type 翻转后的重放也都只经过这里——不能靠应用顺序，只能看元素有没有 checked prop。
            //    这个事实由 createElement 在元素同时带 value 和 checked 时记下（只有这类元素多一个字段）。
            if (typeof value === 'boolean' && !(node as InputWithAxiiValue).__axiiInputHasCheckedProp__) {
                (node as HTMLInputElement).checked = value
                if (value) {
                    node.setAttribute('checked', 'true')
                } else {
                    node.removeAttribute('checked')
                }
            }
        }
    } else if (name === 'checked' && node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'checkbox') {
        // checkbox 的 checked 支持用 boolean 表示
        // CAUTION 必须同时写 property 和 attribute：用户交互过后（dirty state），
        //  attribute 不再影响显示，只有 property 能真正控制勾选状态。
        (node as HTMLInputElement).checked = !!value
        if (value) {
            node.setAttribute('checked', 'true')
        } else {
            node.removeAttribute('checked')
        }

    } else if (name === 'disabled') {
        if (value) {
            node.setAttribute('disabled', 'true')
        } else {
            node.removeAttribute('disabled')
        }

    } else if (name === 'multiple' && node.tagName === 'SELECT') {
        (node as unknown as HTMLSelectElement).multiple = !!value
        // CAUTION multiple 翻转会改变 value 的应用语义（数组 value 只有多选才能整体生效）：
        //  存过 value 的 select 必须重放一次，否则 multiple={cond} 翻转为 true 后
        //  之前被单选语义塌掉的数组选中永远恢复不了。
        resetOptionParentSelectValue(node as unknown as HTMLSelectElement)
    } else if (name === 'type' && node.tagName === 'INPUT') {
        if (value == null || value === false) {
            node.removeAttribute('type')
        } else {
            node.setAttribute('type', value)
        }
        // CAUTION 目标 type 会改变 value 的解释（checkbox 的 boolean value 是勾选通道、
        //  range 按 min/max 截断）时，存过 value 的 input 按新 type 重放一次。
        //  text/password 这类翻转（密码可见性切换是自然写法）不重放，
        //  否则用户已输入的内容会被初始 value 覆盖。
        if (value === 'checkbox' || value === 'radio' || value === 'range') {
            const storedValue = (node as InputWithAxiiValue).__axiiInputValue__
            if (storedValue !== undefined) {
                setAttribute(node, 'value', storedValue, isSvg)
            }
        }
    } else if (name === 'dangerouslySetInnerHTML') {
        // CAUTION nullish 表示清空：innerHTML 的 IDL 对 null 走 LegacyNullToEmptyString，
        //  但 undefined 会被字符串化成字面 "undefined" 渲染到页面上
        //  （dangerouslySetInnerHTML={() => maybeHtml()} 的条件写法会产出 undefined）。
        // CAUTION React 形状的 {__html} 在这里解包（#50）：曾经原样赋给 innerHTML，渲染成字面
        //  "[object Object]"，而 axii/ssr 一直解包——激活时服务端的标记被静默替换。静态值与
        //  函数 / atom 求值得到的值都经过这里；{__html: nullish} 与 nullish 一样清空。
        node.innerHTML = innerHTMLOf(value) ?? ''
    // CAUTION list/type/form 是「与只读（或行为特殊的）DOM property 同名的合法 HTML attribute」：
    //  input.list / select.type / *.form 都是 readonly accessor，走 property 赋值在严格模式下
    //  直接 TypeError（sloppy 模式下静默无效），属性永远设不上去——
    //  form="xxx"（控件关联非祖先 form）会静默失效。这类 name 必须走 attribute 路径。
    } else if (name !== 'list' && name !== 'type' && name !== 'form' && !isSvg && name in node) {
        let replayRangeValue = false
        if ((name === 'min' || name === 'max' || name === 'step') &&
            node.tagName === 'INPUT' &&
            (node as HTMLInputElement).type === 'range') {
            const input = node as InputWithAxiiValue
            replayRangeValue = input.__axiiInputAppliedValue__ !== undefined &&
                (node as HTMLInputElement).value === input.__axiiInputAppliedValue__
        }
        // CAUTION 热路径（string/number 值）不读 property、不做类型判断，
        //  只有 null/undefined/boolean 才进入按 property 类型决定写法的慢路径。
        if (value === null || value === undefined || value === true || value === false) {
            setEmptyOrBooleanProperty(node, name, value)
        } else if (typeof value === 'string' && (name === 'draggable' || name === 'spellcheck' || name === 'translate')) {
            // CAUTION 这三个是「enumerated attribute + boolean IDL property」：字符串值是 HTML 关键字
            //  （draggable="false" / translate="no"），赋给 boolean property 会按 truthy 转成 true，
            //  写出与作者相反的 draggable="true" / translate="yes"。字符串原样写成 attribute。
            node.setAttribute(name, value)
        } else {
            setProperty(node, name, value)
        }
        // range 会在 min/max/step 约束变化时就地 sanitize 当前 value。这里必须重放
        // 框架保存的声明值，否则约束之后放宽，DOM 仍永久停留在旧的截断值。
        // 属性更新热路径只增加常量字符串/标签判断，不产生额外分配。
        if (replayRangeValue) {
            const storedValue = (node as InputWithAxiiValue).__axiiInputValue__
            if (storedValue !== undefined) {
                setAttribute(node, 'value', storedValue, isSvg)
            }
        }
    } else {
        /* v8 ignore next 4 */
        const ns = isSvg && (name !== (name = name.replace(/^xlink\:?/, '')))
        // CAUTION xlink 前缀在上面的 hasOnPrefix 分发之后才剥掉：xlinkOnclick / xlink:onclick 剥完就是 on* 名字，
        //  函数值会走下面不带 namespace 的 setAttribute('onclick', fn)，写出可执行的 onclick。同样丢弃（#49，
        //  ssr.ts serializeAttrs 用同一条规则）。只有 SVG 上带 xlink 前缀的名字才多这一次判断。
        if (ns && hasOnPrefix(name)) {
            warnInvalidOnProp(`xlink:${name}`, value)
            return
        }
        // svg 的 presentation attribute 要从驼峰转换成连字符风格（见 svgPresentationAttributeNames）。
        // CAUTION 写入和移除必须用同一个名字：移除曾用驼峰原名（removeAttribute('strokeWidth')
        //  是空操作），响应式值变成 null/undefined/false 后 stroke-width 永久残留。
        const attrName = isSvg ? (svgPresentationAttributeNames[name] ?? name) : name
        if (value == null || value === false) {
            if (ns) {
                node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase())
            } else if (value === false &&
                // spellCheck 是 React 的写法，不是 DOM property 名（property 是 spellcheck），所以落在
                //  attribute 分支：false 被移除的话拼写检查仍然开着（缺省值是 true）。
                (name.toLowerCase() === 'contenteditable' || name.toLowerCase() === 'spellcheck' ||
                    ((name[0] === 'a' || name[0] === 'd') && (/^aria-/.test(name) || /^data-/.test(name))))) {
                // CAUTION aria-*/data-* 的 false 是有语义的值，不是「移除」：
                //  aria-expanded/aria-checked 等状态属性缺席与 "false" 对屏幕阅读器完全不同
                //  （缺席 = 不可展开/不是开关，"false" = 收起/未选中）。React 同样字面化渲染。
                //  data-* 的响应式路径（dataset 赋值）本来就产出 "false"，静态路径必须一致。
                //  null/undefined 仍然是移除语义（条件属性的自然写法）。
                node.setAttribute(name, 'false')
            } else {
                node.removeAttribute(attrName)
            }
            /* v8 ignore next 4 */
        } else if (typeof value !== 'function' && ns) {
            // xlink:href 元素，有 namespace 的
            node.setAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase(), value)
        } else {
            node.setAttribute(attrName, value)
        }
    }
}

export type AttributesArg = {
    [k: string]: any
}


export type JSXElementType = string | typeof Fragment | Component

export type UnhandledChildInfo = {
    placeholder: UnhandledPlaceholder,
    child: any,
    path: number[]
    source?: AxiiSource
}

export type UnhandledAttrInfo = {
    el: ExtendedElement,
    key: string,
    value: any,
    path: number[]
    source?: AxiiSource
}

export type RefHandleInfo = {
    el: any,
    // 数组形态来自用户的 ref 数组与 AOP 的 ref 合并（mergeProp）
    handle: RefFn | RefObject | (RefFn | RefObject)[],
    path: number[]
}

export type DetachStyledInfo = {
    el: any,
    style: any,
    path: number[]
}

const EMPTY_CHILDREN: any[] = []

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

/**
 * Rematerialize a main-root deferred stub with claiming enabled.
 * svgParent：stub 是一个 SVG 元素（不是 HTML integration point）的静态子元素。HTML / SVG 同名的标签按 SVG 认领与创建，
 *  ≡ CSR 里 SVG 父元素对同一个子元素做的改建（adoptSvgChildren，#56）。
 */
export function materializeHydrateDeferred(el: Element, svgParent = false): Node {
    const payload = takeHydrateDeferredPayload(el)
    let rawProps = payload.rawProps
    if (svgParent && svgHtmlSharedElementNames.has(payload.type) && rawProps?._isSVG !== true) {
        rawProps = {...rawProps, _isSVG: true}
    }
    return createElement(payload.type, rawProps, ...payload.rawChildren) as Node
}

function isSharedNameHtmlElement(value: unknown): value is ExtendedElement {
    return isElementNode(value) && value.namespaceURI === XHTML_NAMESPACE && svgHtmlSharedElementNames.has(value.localName)
}

// HTML 元素上的 attribute 名都被转成了小写：SVG 里大小写敏感、或要转成连字符的名字按 setAttribute 的 SVG 规则还原。
//  只在改建时（极少）惰性建表。
let svgAttributeNamesByLowercase: {[lowercase: string]: string} | undefined
function svgAttributeNameOfLowercase(name: string): string {
    if (svgAttributeNamesByLowercase === undefined) {
        const names: {[lowercase: string]: string} = Object.create(null)
        for (const camelCase in svgPresentationAttributeNames) {
            names[camelCase.toLowerCase()] = svgPresentationAttributeNames[camelCase]
        }
        // <a> 上的条件处理属性
        names.requiredextensions = 'requiredExtensions'
        names.systemlanguage = 'systemLanguage'
        svgAttributeNamesByLowercase = names
    }
    return svgAttributeNamesByLowercase[name] ?? name
}

/**
 * CAUTION HTML / SVG 同名的标签（a / title / style / script，见 svgHtmlSharedElementNames）在 SVG 父元素下必须是 SVG 元素（#56）：
 *  HTML 解析器这样处理服务端写出的标记；客户端建成 HTML 元素的话，<a> 里的图形整个不渲染、<title> 不是图形的提示，
 *  激活时每个都报告失配并重建。JSX 先求值子节点，子元素创建时不知道父元素，所以由 SVG 父元素在这里把它的静态子元素
 *  （元素 child、数组项、Fragment 的子元素）改建到 SVG 命名空间：attribute 按 SVG 的写法搬过去（见 svgAttributeNameOfLowercase），子节点整体移过去，
 *  axii 写在元素上的字段（事件表、未处理的子节点 / 响应式属性 / ref / detachStyle 元数据、JSX source）原样转交，
 *  事件代理重新挂上；元数据里指向旧元素的 el 改指新元素（remapRecreatedElements）。响应式属性稍后由 StaticHost
 *  按新元素（SVG）的规则写入。激活时由 materializeHydrateDeferred 在同一个位置按 SVG 认领，服务端按 SVG 的规则写属性。
 *  只在 SVG 元素的创建路径上执行：HTML 元素的创建不多任何检查。
 *  已知限制：
 *   - 改建换掉了元素：在父元素创建之前拿到的子元素引用（const t = <title/>; <svg>{t}</svg>）指向被丢弃的 HTML 元素，
 *     之前直接 addEventListener 的监听器也不会带过去（ref 在之后执行，拿到的是新元素）；
 *   - 静态 attribute 是 HTML 元素按 HTML 规则写出后再搬过来的：HTML 上按 property 写的名字与值（tabIndex 写成 tabindex、
 *     download={true} 写成 ""）与 createSVGElement 的写法（tabIndex、"true"）不同；
 *   - 函数、组件、列表渲染出来的同名标签由 Host 稍后插入，不经过这里，仍是 HTML 元素；它们的激活结果与 CSR 不一致是
 *     子先于父认领模型的既有缺陷（#55，见 ssrHydrate.shapes.spec 的 test.fails）。要在这些位置得到 SVG 元素，用 createSVGElement。
 */
function adoptSvgChildren(children: any[]): void {
    let recreated: Map<Element, Element> | undefined
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isSharedNameHtmlElement(child)) {
            const svg = recreateInSvgNamespace(child, recreated ??= new Map())
            remapRecreatedElements(svg, recreated)
            children[i] = svg
        } else if (Array.isArray(child)) {
            for (let j = 0; j < child.length; j++) {
                if (isSharedNameHtmlElement(child[j])) {
                    const svg = recreateInSvgNamespace(child[j], recreated ??= new Map())
                    remapRecreatedElements(svg, recreated)
                    child[j] = svg
                }
            }
        } else if (isFragmentNode(child)) {
            // Fragment 子元素的元数据已经提升到 DocumentFragment 上
            let node = child.firstChild
            let fragmentRecreated = false
            while (node) {
                const next = node.nextSibling
                if (isSharedNameHtmlElement(node)) {
                    child.replaceChild(recreateInSvgNamespace(node, recreated ??= new Map()), node)
                    fragmentRecreated = true
                }
                node = next
            }
            if (fragmentRecreated) remapRecreatedElements(child as unknown as ExtendedElement, recreated!)
        }
    }
}

function recreateInSvgNamespace(el: ExtendedElement, recreated: Map<Element, Element>): ExtendedElement {
    const svg = document.createElementNS(SVG_NAMESPACE, el.localName) as unknown as ExtendedElement
    const attributes = el.attributes
    for (let i = 0; i < attributes.length; i++) {
        const {namespaceURI, name, value} = attributes[i]
        if (namespaceURI !== null) {
            svg.setAttributeNS(namespaceURI, name, value)
            continue
        }
        // xlinkHref / xlink:href 在 HTML 元素上是普通 attribute，按 SVG 的写法放进 xlink namespace（≡ setAttribute 的 SVG 分支，
        //  其中 on 开头的名字丢弃，#49）
        if (name.charCodeAt(0) === 120 && name.startsWith('xlink')) {
            const localName = name.replace(/^xlink:?/, '')
            if (hasOnPrefix(localName)) continue
            if (localName) {
                svg.setAttributeNS(XLINK_NAMESPACE, localName, value)
                continue
            }
        }
        svg.setAttribute(svgAttributeNameOfLowercase(name), value)
    }
    // title 是 HTML integration point，子内容按 HTML 解析
    const keepHtmlChildren = isSvgHtmlIntegrationPoint(el.localName)
    let child = el.firstChild
    while (child) {
        const next = child.nextSibling
        svg.appendChild(!keepHtmlChildren && isSharedNameHtmlElement(child) ? recreateInSvgNamespace(child, recreated) : child)
        child = next
    }
    const keys = Object.keys(el)
    for (let i = 0; i < keys.length; i++) {
        (svg as any)[keys[i]] = (el as any)[keys[i]]
    }
    if (el._listeners) for (const eventName in el._listeners) svg.addEventListener(eventName, eventProxy)
    if (el._captureListeners) for (const eventName in el._captureListeners) svg.addEventListener(eventName, captureEventProxy, true)
    recreated.set(el, svg)
    return svg
}

function remapRecreatedElements(holder: ExtendedElement, recreated: Map<Element, Element>): void {
    const lists: ({el: any}[] | undefined)[] = [holder.unhandledAttr, holder.refHandles, holder.detachStyledChildren]
    for (const list of lists) {
        if (!list) continue
        for (const info of list) {
            const replacement = recreated.get(info.el)
            if (replacement) info.el = replacement
        }
    }
}

/**
 * Eager Portal HTML content may have already claimed under the main hydrate root
 * (arg eval before pushHydrateRoot). Convert to a deferred stub so hydratePortalContent
 * rematerializes against options.portals (§3.3.d / portal-static-content-hydrate).
 */
export function ensureHydrateDeferredPortalContent(content: any): any {
    if (!isHydrating() || content == null || typeof content === 'function') return content
    if (typeof content === 'object' && typeof (content as any).type === 'function') return content

    // Deferred stub (no claim under main): still walk rawChildren — nested Fragment may
    // hold Elements that claimed main siblings (element portal + nested F; k19-audit D2).
    if (isHydrateDeferredElement(content)) {
        const payload = peekHydrateDeferredPayload(content as Element)
        if (payload?.rawChildren?.length) {
            for (let i = 0; i < payload.rawChildren.length; i++) {
                payload.rawChildren[i] = ensureHydrateDeferredPortalContent(payload.rawChildren[i])
            }
        }
        return content
    }

    // Array / Fragment children may hold Elements claimed under main — recurse first.
    if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) {
            content[i] = ensureHydrateDeferredPortalContent(content[i])
        }
        return content
    }
    if (isFragmentNode(content)) {
        const fragKids = (content as any).__axiiFragmentHydrateChildren as any[] | undefined
        if (fragKids?.length) {
            for (let i = 0; i < fragKids.length; i++) {
                fragKids[i] = ensureHydrateDeferredPortalContent(fragKids[i])
            }
        }
        // createElement(Fragment) may have lifted unhandledChildren from wrongly claimed
        // main-tree Nodes (atom Text placeholders). Drop them — rematerialize under the
        // portal root recreates host metadata against options.portals.
        // DocumentFragment carries the same axii metadata bag as ExtendedElement (see createElement).
        const fragExt = content as unknown as ExtendedElement
        fragExt.unhandledChildren = undefined
        fragExt.unhandledAttr = undefined
        fragExt.refHandles = undefined
        fragExt.detachStyledChildren = undefined
        return content
    }

    if (!isElementNode(content)) return content

    const el = content as Element
    const payload = takeHydrateReclaimPayload(el)
    if (!payload) {
        // Claimed without reclaim mark (e.g. empty element) — still must not keep main claim.
        // Must be unreachable for non-empty kids (shouldMarkHydrateReclaim covers Array /
        // ComponentNode / RxList / text / Node); silent [] would drop portal children.
        unclaimHydrateElement(el)
        const tag = el.tagName.toLowerCase()
        return createHydrateDeferredElement(tag, null, [])
    }
    // Drop metadata from the wrongly claimed main-tree node; hosts are not created yet.
    const ext = el as ExtendedElement
    ext.unhandledChildren = undefined
    ext.unhandledAttr = undefined
    ext.refHandles = undefined
    ext.detachStyledChildren = undefined
    unclaimHydrateElement(el)
    const kids = payload.rawChildren.map((c: any) => ensureHydrateDeferredPortalContent(c))
    return createHydrateDeferredElement(payload.type, payload.rawProps, kids)
}

/**
 * Replace deferred stubs in Fragment hydrate child lists and lift their
 * unhandledChildren onto the Fragment (createElement skipped claim under main root).
 *
 * Portal roots: ensureHydrateDeferredPortalContent clears Fragment unhandledChildren
 * (main-tree false lift). After rematerialize under the portal claim root we must
 * restore the same unhandledChildren shape createElement(Fragment) would have built —
 * Array / ComponentNode / RxList / function / boolean slots, plus lifts from
 * rematerialized Elements and nested DocumentFragments (reconcile walks nested kids
 * against the outer Fragment's unhandled list; nested DF is not its own StaticHost).
 *
 * Idempotent: hydratePortalContent / createHost / StaticHost.render may each call this.
 * Structural slots use hasUnhandledFor(child); nested DF must NOT push-then-lift onto
 * the nested first (cleared after lift → 2nd pass duplicates detached placeholders).
 */
export function rematerializeDeferredFragmentChildren(frag: DocumentFragment, svgParent = false): void {
    const children = (frag as any).__axiiFragmentHydrateChildren as any[] | undefined
    if (!children?.length) return

    // Same metadata bag as createElement(Fragment) attaches via `as ExtendedElement`.
    const fragEl = frag as unknown as ExtendedElement
    let fragUnhandled = fragEl.unhandledChildren
    let fragUnhandledAttr = fragEl.unhandledAttr
    let fragRefs = fragEl.refHandles
    let fragDetach = fragEl.detachStyledChildren

    const hasUnhandledFor = (child: any): boolean => {
        if (!fragUnhandled) return false
        for (let k = 0; k < fragUnhandled.length; k++) {
            if (fragUnhandled[k].child === child) return true
        }
        return false
    }

    const pushStructuralUnhandled = (child: any, path: number[]) => {
        if (hasUnhandledFor(child)) return
        const placeholder: UnhandledPlaceholder = typeof child === 'function'
            ? document.createTextNode('')
            : document.createComment('unhandledChild')
        const info: UnhandledChildInfo = {placeholder, child, path}
        if (fragUnhandled) fragUnhandled.push(info)
        else fragUnhandled = [info]
    }

    const prependPath = (path: number[], target: {path: number[]}[]) => {
        for (const u of target) {
            for (let p = path.length - 1; p >= 0; p--) u.path.unshift(path[p])
        }
    }

    const liftChildMeta = (el: ExtendedElement, path: number[]) => {
        const childUnhandled = el.unhandledChildren
        if (childUnhandled?.length) {
            prependPath(path, childUnhandled)
            if (fragUnhandled) fragUnhandled.push(...childUnhandled)
            else fragUnhandled = childUnhandled
            el.unhandledChildren = undefined
        }
        const childAttr = el.unhandledAttr
        if (childAttr?.length) {
            prependPath(path, childAttr)
            if (fragUnhandledAttr) fragUnhandledAttr.push(...childAttr)
            else fragUnhandledAttr = childAttr
            el.unhandledAttr = undefined
        }
        const childRefs = el.refHandles
        if (childRefs?.length) {
            prependPath(path, childRefs)
            if (fragRefs) fragRefs.push(...childRefs)
            else fragRefs = childRefs
            el.refHandles = undefined
        }
        const childDetach = el.detachStyledChildren
        if (childDetach?.length) {
            prependPath(path, childDetach)
            if (fragDetach) fragDetach.push(...childDetach)
            else fragDetach = childDetach
            el.detachStyledChildren = undefined
        }
    }

    /** Materialize deferred / nested structure onto THIS frag (never push onto nested DF). */
    const processKids = (kids: any[], pathPrefix: number[]) => {
        for (let i = 0; i < kids.length; i++) {
            const c = kids[i]
            const path = pathPrefix.length ? pathPrefix.concat(i) : [i]
            if (isHydrateDeferredElement(c)) {
                const el = materializeHydrateDeferred(c as Element, svgParent) as ExtendedElement
                kids[i] = el
                liftChildMeta(el, path)
            } else if (isFragmentNode(c)) {
                const nestedKids = (c as any).__axiiFragmentHydrateChildren as any[] | undefined
                if (nestedKids?.length) {
                    processKids(nestedKids, path)
                }
                // Leftover meta on nested DF (should be empty after processKids)
                liftChildMeta(c as unknown as ExtendedElement, path)
            } else if (Array.isArray(c)) {
                for (let j = 0; j < c.length; j++) {
                    if (isHydrateDeferredElement(c[j])) {
                        // Item Element keeps its own unhandledChildren for StaticArrayHost.
                        c[j] = materializeHydrateDeferred(c[j] as Element)
                    } else if (isFragmentNode(c[j])) {
                        rematerializeDeferredFragmentChildren(c[j])
                    }
                }
                pushStructuralUnhandled(c, path)
            } else if (c instanceof RxList) {
                pushStructuralUnhandled(c, path)
            } else if (typeof c === 'function') {
                pushStructuralUnhandled(c, path)
            } else if (typeof c === 'boolean') {
                pushStructuralUnhandled(c, path)
            } else if (c != null && typeof c === 'object' && typeof (c as any).type === 'function') {
                pushStructuralUnhandled(c, path)
            } else if (isElementNode(c)) {
                liftChildMeta(c as ExtendedElement, path)
            }
        }
    }

    processKids(children, [])

    if (fragUnhandled) fragEl.unhandledChildren = fragUnhandled
    if (fragUnhandledAttr) fragEl.unhandledAttr = fragUnhandledAttr
    if (fragRefs) fragEl.refHandles = fragRefs
    if (fragDetach) fragEl.detachStyledChildren = fragDetach
}

/**
 * Eager Portal HTML content is evaluated as createElement args under the main hydrate
 * root before pushHydrateRoot. Those claims store a reclaim payload; createPortal / Portal
 * convert them to deferred stubs via ensureHydrateDeferredPortalContent (§3.3.d).
 *
 * Must cover every child kind that can appear under an eager Portal root element —
 * text/function/Node **and** Array / ComponentNode / RxList / DocumentFragment — so
 * reclaim→deferred preserves rawChildren (k17-audit D1).
 */
function shouldMarkHydrateReclaim(children: any[]): boolean {
    if (!isHydrateOnMainRoot()) return false
    for (let i = 0; i < children.length; i++) {
        const c = children[i]
        if (c == null || typeof c === 'boolean') continue
        if (isHydrateDeferredElement(c)) continue
        const t = typeof c
        if (t === 'string' || t === 'number' || t === 'bigint' || t === 'function') return true
        if (Array.isArray(c) || c instanceof RxList) return true
        if (isDomNode(c)) return true
        // ComponentNode (and other host descriptors with a callable type)
        if (typeof c === 'object' && typeof (c as any).type === 'function') return true
    }
    return false
}

// 这里的返回类型要和 global.d.ts 中的 JSX.Element 类型一致
export function createElement(type: JSXElementType, rawProps: AttributesArg, ...rawChildren: any[]): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    // CAUTION __source/__self 既可能来自 jsxDEV，也可能来自 Babel classic dev transform，
    //  两条链路都在这里收敛，绝不能作为普通 attr 落到 DOM/组件 props 上。
    const debugSource = rawProps ? rawProps.__source as AxiiSource | undefined : undefined

    // Early return for component nodes
    if (typeof type !== 'string' && type !== Fragment) {
        const children: any[] = rawChildren.length ? rawChildren : (rawProps?.children || [])
        let props = rawProps || {}
        if (debugSource || (rawProps && '__self' in rawProps)) {
            props = {...rawProps}
            delete props.__source
            delete props.__self
        }
        // Portal content={<el/>} / createPortal(el): el may have claimed under main — defer.
        if (isHydrating() && (type as any).__axiiPortal && props.content != null) {
            props = {...props, content: ensureHydrateDeferredPortalContent(props.content)}
        }
        return {type, props, children, __axiiSource: debugSource} as ComponentNode
    }

    // CAUTION svg-only 标签（circle/path/svg 等）无论从哪个入口进来都必须落在 SVG namespace，
    //  见 svgOnlyElementNames 的说明。显式 _isSVG（createSVGElement 传入）优先，
    //  未显式指定时按标签名兜底；每个元素只多一次 Set 查找（原 jsx runtime 路由的同款成本）。
    const _isSVG = (rawProps ? rawProps._isSVG : undefined) ??
        (type !== Fragment && svgOnlyElementNames.has(type as string))

    // Create container with proper type assertion
    // CAUTION is（customized built-in element）必须在 createElement 时以选项传入（I64）：
    //  元素升级只发生在创建时刻，事后 setAttribute('is') 不会触发升级——元素静默缺少
    //  自定义行为。attribute 本身仍由下面的 props 循环写上（序列化/CSS 选择器语义）。
    //  热路径成本：仅在 rawProps 存在时多一次属性读。
    // Hydrate：认领已有元素（§3.1）；CSR 稳态只多一次 isHydrating 布尔读。
    const hydrating = isHydrating()
    // Children list early: hydrate claim rejects EmptyHost false-positives for eager Portal
    // content evaluated under the main tree (§3.3.d).
    const children: any[] = rawChildren.length ? rawChildren : (rawProps?.children || EMPTY_CHILDREN)

    let container: HTMLElement | DocumentFragment | SVGElement
    // 激活时元素是认领来的（服务端节点）还是失配后就地新建的
    let hydrateClaimed = false
    // 失配后新建：脱离文档建好，props 应用完再插到游标处（#73，见 createElementForHydrateMismatch）
    let hydrateRebuilt = false
    if (type === Fragment) {
        container = document.createDocumentFragment()
    } else if (hydrating) {
        const claimed = tryClaimElement(type as string, rawProps, children, _isSVG)
        if (!claimed) {
            // Element-child cursor: §3.7 claim-miss → local CSR rebuild (wrong tag / no candidate).
            // No parent cursor: Portal content under main root — defer until hydratePortalContent.
            // List/array setChildCursor alone must not rebuild (would delete row placeholders).
            if (isElementChildCursorActive()) {
                container = createElementForHydrateMismatch(
                    type as string,
                    _isSVG,
                    rawProps && typeof rawProps.is === 'string' ? rawProps.is : undefined,
                ) as HTMLElement
                hydrateRebuilt = true
            } else if (!getChildCursor().parent || isClaimStoppedAtSvgCounterpart()) {
                // HTML / SVG 同名的标签遇到了它的 SVG 对应物：交给 SVG 父元素按 SVG 认领（#56，见 isClaimStoppedAtSvgCounterpart）
                return createHydrateDeferredElement(type as string, rawProps, children)
            } else {
                throw new Error(`[axii] hydrate mismatch: no unmatched <${type as string}> to claim`)
            }
        } else {
            // Portal content args claim under main before createPortal wraps them — mark reclaim.
            if (shouldMarkHydrateReclaim(children)) {
                markHydrateReclaimPayload(claimed, type as string, rawProps, children)
            }
            hydrateClaimed = true
            container = claimed as HTMLElement
        }
    } else if (_isSVG) {
        container = document.createElementNS(SVG_NAMESPACE, type as string) as SVGElement
        // HTML / SVG 同名的子元素改建到 SVG 命名空间（#56，见 adoptSvgChildren）
        if (children.length && !isSvgHtmlIntegrationPoint(type as string)) adoptSvgChildren(children)
    } else {
        container = (rawProps && typeof rawProps.is === 'string'
            ? document.createElement(type as string, {is: rawProps.is})
            : document.createElement(type as string)) as HTMLElement
    }

    // CAUTION 元数据数组按需分配，绝大多数元素一个都不需要
    let unhandledAttr: UnhandledAttrInfo[] | undefined
    let unhandledChildren: UnhandledChildInfo[] | undefined
    let refHandles: RefHandleInfo[] | undefined
    let detachStyledChildren: DetachStyledInfo[] | undefined

    // CAUTION select 的 multiple 必须先于 option children 应用：多个带 selected 的 option
    //  在单选语义的 select 里插入时会互相顶掉，只剩最后一个被选中。静态真值在这里预应用；
    //  响应式 multiple（函数/atom）由 setAttribute 的 multiple 分支在翻转时重放存值。
    //  下面的 props 循环会再次应用 multiple，重复设置同值无害。
    // Hydrate：认领来的元素已带属性，跳过预应用（避免覆盖 SSR 结果）；仍登记响应式 attr。
    //  失配后新建的元素与 CSR 相同，要预应用：它的 option 在下面的 children 处理中逐个新建、插入（#73）。
    if (!hydrateClaimed && type === 'select' && rawProps?.multiple && typeof rawProps.multiple !== 'function') {
        setAttribute(container as ExtendedElement, 'multiple', rawProps.multiple, _isSVG)
    }

    if (hydrating && type !== Fragment) {
        // CAUTION textarea 的 value 在 HTML 里只能写成子文本（§3.6.2 TA 通道），CSR 则是纯 IDL 赋值、
        //  没有子节点。这段子文本是 value 的编码，不是哪个 child 单元的节点：在这里直接拿掉
        //  （value 由下面延后处理的 value prop 写回），否则它会被当成「尾部孤儿」报一条假的失配。
        //  defaultValue 同理（#51）：服务端把它写成子文本，下面的 props 循环再把它赋给 defaultValue。
        if (type === 'textarea' && textareaContentProp(rawProps) !== undefined) {
            container.textContent = ''
        }
        enterElementChildCursor(resolveHydrateChildParent(container as Element, children))
    }

    // Process children in a single pass
    // CAUTION 文本 child 的判定包含 bigint（后端 bigint id 直接渲染是自然输入，I61）：
    //  atom 入口（stringValue 走 toString）本来就支持 bigint，静态/数组/函数/列表行
    //  的入口必须一致，否则同一个值换个入口就崩溃（unknown child type）。
    const childrenLength = children.length
    const firstChildType = childrenLength === 1 ? typeof children[0] : undefined
    if (type !== Fragment && childrenLength === 1 && (firstChildType === 'string' || firstChildType === 'number' || firstChildType === 'bigint')) {
        if (hydrating) {
            const text = children[0].toString()
            if (text !== '') {
                // ElementChildText 单 child 非空：认领（可能带 axii:t）
                claimTextUnit(text)
            }
            // 单 child 空串：CSR 0 节点，无哨兵（EE0）
        } else {
            (container as HTMLElement).textContent = children[0].toString()
        }
    } else if (childrenLength) {
        // CAUTION container 此时还没有插入文档，直接 append 不会触发布局，无需中转 fragment
        for (let index = 0; index < childrenLength; index++) {
            const child = children[index]
            if (child == null) continue // Handles both undefined and null

            const childType = typeof child
            if (childType === 'string' || childType === 'number' || childType === 'bigint') {
                if (hydrating) {
                    // Fragment: never claim via parent cursor — content belongs to
                    // StaticHost(DocumentFragment) (claimFragmentStartBefore + strip axii:t).
                    // Eager Fragment/array args may also run before enterElementChildCursor
                    // (no cursor → same leave-for-StaticHost semantics).
                    // Under active StaticArray/RxList cursor, claiming here would look past
                    // <!--array item--> / <!--rx list item--> instead of fragment content.
                    if (type === Fragment || !getChildCursor().parent) {
                        continue
                    }
                    const text = child.toString()
                    if (text === '') {
                        if (peekAxii0()) {
                            // 兄弟间空：插入 Text 留在元素子节点（非 Host）
                            claimAtomTextPlaceholder('')
                        }
                    } else {
                        claimTextUnit(text)
                    }
                } else {
                    container.appendChild(document.createTextNode(child.toString()))
                }
            } else if (isDomNode(child)) { // Covers Element (HTML / SVG / MathML), DocumentFragment, Text, Comment
                // CAUTION 按 nodeType 判断（见 nodeType.ts）：JSX child 可以是另一个 realm（同源 iframe）的节点，
                //  instanceof Node 恒为 false，会落进下面「函数 / 其他值」的分支，多出一个占位注释（#58）。
                let nodeChild: Node = child
                // Fragment: leave deferred stubs for rematerialize under fragment/portal root.
                // Non-Fragment: rematerialize now (parent cursor / claim-allowed is active).
                if (hydrating && isHydrateDeferredElement(nodeChild) && type !== Fragment) {
                    nodeChild = materializeHydrateDeferred(nodeChild as Element, _isSVG && !isSvgHtmlIntegrationPoint(type as string))
                    children[index] = nodeChild
                }
                if (hydrating) {
                    // Fragment Node children: claim during rematerializeDeferredFragmentChildren
                    // (not via parent list/array cursor).
                    if (type !== Fragment) {
                        if (isFragmentNode(nodeChild)) {
                            // Element-child Fragment: SSR flatten (no fragment start).
                            rematerializeDeferredFragmentChildren(nodeChild, _isSVG && !isSvgHtmlIntegrationPoint(type as string))
                            reconcileFlattenedFragmentHydrateChildren(nodeChild)
                        } else {
                            advancePastNode(nodeChild)
                        }
                    }
                } else {
                    container.appendChild(nodeChild)
                }

                // Deferred Fragment children have no metadata until rematerialize.
                if (hydrating && type === Fragment && isHydrateDeferredElement(child)) {
                    continue
                }

                // Handle extended element properties
                // CAUTION 这些元数据数组的所有权是唯一的（由子元素的 createElement 创建，
                //  在这里被提升一次并清空引用），所以可以直接原地改写 path、直接接管数组。
                const childElement = nodeChild as ExtendedElement
                // 动态节点自身没有 JSX source 时，继承最近的父元素 source
                const inheritedSource = childElement.__axiiSource ?? debugSource
                const childUnhandledChildren = childElement.unhandledChildren
                if (childUnhandledChildren?.length) {
                    for (const c of childUnhandledChildren) {
                        c.path.unshift(index)
                        if (inheritedSource && !c.source) c.source = inheritedSource
                    }
                    if (unhandledChildren) {
                        unhandledChildren.push(...childUnhandledChildren)
                    } else {
                        unhandledChildren = childUnhandledChildren
                    }
                    childElement.unhandledChildren = undefined
                }
                const childUnhandledAttr = childElement.unhandledAttr
                if (childUnhandledAttr?.length) {
                    for (const c of childUnhandledAttr) {
                        c.path.unshift(index)
                        if (inheritedSource && !c.source) c.source = inheritedSource
                    }
                    if (unhandledAttr) {
                        unhandledAttr.push(...childUnhandledAttr)
                    } else {
                        unhandledAttr = childUnhandledAttr
                    }
                    childElement.unhandledAttr = undefined
                }
                const childRefHandles = childElement.refHandles
                if (childRefHandles?.length) {
                    for (const c of childRefHandles) c.path.unshift(index)
                    if (refHandles) {
                        refHandles.push(...childRefHandles)
                    } else {
                        refHandles = childRefHandles
                    }
                    childElement.refHandles = undefined
                }
                const childDetachStyled = childElement.detachStyledChildren
                if (childDetachStyled?.length) {
                    for (const c of childDetachStyled) c.path.unshift(index)
                    if (detachStyledChildren) {
                        detachStyledChildren.push(...childDetachStyled)
                    } else {
                        detachStyledChildren = childDetachStyled
                    }
                    childElement.detachStyledChildren = undefined
                }
            } else {
                // 函数/atom child 大概率渲染为文本，直接用 Text 节点当占位符
                let placeholder: UnhandledPlaceholder
                if (hydrating && type === Fragment) {
                    // Defer cursor claims to StaticHost after claimFragmentStartBefore
                    // (parent list/array cursor — or no cursor — is the wrong region).
                    placeholder = typeof child === 'function'
                        ? document.createTextNode('')
                        : document.createComment('unhandledChild')
                } else if (hydrating && typeof child === 'function') {
                    // Text-ph：atom 按快照认领；普通函数按 FTS/H1（§3.2.4）认领尾锚
                    if (isAtom(child)) {
                        const snapshot = child()
                        const text = (snapshot === undefined || snapshot === null || typeof snapshot === 'boolean')
                            ? ''
                            : String((snapshot as any)?.toString ? (snapshot as any).toString() : snapshot)
                        placeholder = claimAtomTextPlaceholder(text)
                    } else {
                        placeholder = claimFunctionTextPlaceholder(child)
                    }
                } else if (hydrating && Array.isArray(child)) {
                    // StaticArrayHost DirectNodes / items — claim texts then <!--unhandledChild-->
                    const hydrateDirectNodes: Text[] = []
                    for (let itemIndex = 0; itemIndex < child.length; itemIndex++) {
                        const item = child[itemIndex]
                        const it = typeof item
                        if (it === 'string' || it === 'number' || it === 'bigint') {
                            hydrateDirectNodes.push(claimDirectNodeText())
                        } else if (typeof item === 'function') {
                            // FCS array item: skip content+computed (claimed by FunctionHost), then array item
                            advanceCursorUntilComment('array item')
                            const itemPh = claimCommentAtCursor('array item')
                            ;((child as any).__axiiHydrateItemHosts ||= []).push({
                                placeholder: itemPh,
                                child: item,
                                path: [index],
                                source: debugSource,
                            } as UnhandledChildInfo)
                        } else if (isDomNode(item)) {
                            // Element items: rematerialize main-root deferred stubs, then advance.
                            // DocumentFragment: content is under parent (fragment start…), not on the DF
                            let nodeItem: Node = item
                            if (isHydrateDeferredElement(nodeItem)) {
                                nodeItem = materializeHydrateDeferred(nodeItem as Element, _isSVG && !isSvgHtmlIntegrationPoint(type as string))
                                child[itemIndex] = nodeItem
                            }
                            if (isFragmentNode(nodeItem)) {
                                rematerializeDeferredFragmentChildren(nodeItem)
                                advanceCursorUntilComment('array item')
                            } else {
                                advancePastNode(nodeItem)
                            }
                            const itemPh = claimCommentAtCursor('array item')
                            ;((child as any).__axiiHydrateItemHosts ||= []).push({
                                placeholder: itemPh,
                                child: nodeItem,
                                path: [index],
                                source: debugSource,
                            } as UnhandledChildInfo)
                        } else if (item instanceof RxList) {
                            const cursor = getChildCursor()
                            ;(item as any).__axiiHydrateListParent = cursor.parent
                            ;(item as any).__axiiHydrateListStart = cursor.index
                            advanceCursorUntilComment('array item')
                            const itemPh = claimCommentAtCursor('array item')
                            ;((child as any).__axiiHydrateItemHosts ||= []).push({
                                placeholder: itemPh,
                                child: item,
                                path: [index],
                                source: debugSource,
                            } as UnhandledChildInfo)
                        } else if (item == null || typeof item === 'boolean' || typeof item === 'object') {
                            // ComponentNode / nested Array — content already in DOM before <!--array item-->
                            // CAUTION null/undefined（EmptyHost：<!--empty--><!--array item-->）和 boolean
                            //  （PrimitiveHost 空文本：只有 <!--array item-->）也是「内容在前、array item 在后」，
                            //  SSR 与 StaticArrayHost 自己的认领路径都支持。`list.map(i => cond ? <li/> : null)`、
                            //  `[cond && <b/>, 'x']` 是最常见的数组写法，这里漏掉会让整个 hydrateRoot 抛错。
                            advanceCursorUntilComment('array item')
                            const itemPh = claimCommentAtCursor('array item')
                            ;((child as any).__axiiHydrateItemHosts ||= []).push({
                                placeholder: itemPh,
                                child: item,
                                path: [index],
                                source: debugSource,
                            } as UnhandledChildInfo)
                        } else {
                            throw new Error('[axii] hydrate array item type not supported in M-02')
                        }
                    }
                    ;(child as any).__axiiHydrateDirectNodes = hydrateDirectNodes
                    placeholder = claimCommentAtCursor('unhandledChild')
                } else if (hydrating && child instanceof RxList) {
                    // RxListHost: save cursor at list content start, then claim list placeholder
                    // (skip inner <!--unhandledChild--> from Fragment boolean / PrimitiveHost)
                    const cursor = getChildCursor()
                    ;(child as any).__axiiHydrateListParent = cursor.parent
                    ;(child as any).__axiiHydrateListStart = cursor.index
                    advanceCursorUntilRxListHostPlaceholder()
                    placeholder = claimCommentAtCursor('unhandledChild')
                } else if (hydrating) {
                    // ComponentNode / other object children — content already serialized before <!--unhandledChild-->
                    advanceCursorUntilComment('unhandledChild')
                    placeholder = claimCommentAtCursor('unhandledChild')
                } else {
                    placeholder = typeof child === 'function' ?
                        document.createTextNode('') :
                        document.createComment('unhandledChild')
                    container.appendChild(placeholder)
                }
                const info: UnhandledChildInfo = {placeholder, child, path: [index], source: debugSource}
                if (unhandledChildren) {
                    unhandledChildren.push(info)
                } else {
                    unhandledChildren = [info]
                }
            }
        }
    }

    // Fragment hydrate: StaticHost reconciles placeholders inside [fragment start, placeholder)
    if (hydrating && type === Fragment && childrenLength) {
        ;(container as any).__axiiFragmentHydrateChildren = children
    }

    if (hydrating && type !== Fragment) {
        // CAUTION dangerouslySetInnerHTML 的内容由服务端原样写出，客户端 children 里没有对应单元。
        //  按「尾部孤儿」清理的话会报一条假的失配并把这段标记删掉；而下面的 props 循环在激活时
        //  又跳过 innerHTML 赋值（保留服务端节点），结果元素永久为空。
        //  「内容是原始标记」按解包后的值判定（#50）：{__html: null} 与 null 一样不是原始标记。
        exitElementChildCursor(!!rawProps && innerHTMLOf(rawProps.dangerouslySetInnerHTML) != null)
        const el = container as Element
        const ssrStyleClasses = el.getAttribute(SSR_STYLE_CLASSES_ATTRIBUTE)
        if (ssrStyleClasses !== null) {
            // Clear generated classes before installing client props, which may include an
            // authored copy. Remember the server base for the later rolling style binding.
            if (ssrStyleClasses) {
                const classes = ssrStyleClasses.split(' ')
                let ownedClassCount = 0
                let rollingBase: string | undefined
                for (const id of classes) {
                    if (id[0] === '!') continue // Pending CSS tokens are not classes.
                    const authored = id[0] === '+'
                    if (!rollingBase && id.endsWith('I0')) {
                        rollingBase = id.slice(authored ? 1 : 0, id.lastIndexOf('F'))
                    }
                    if (!authored) classes[ownedClassCount++] = id
                }
                if (rollingBase) rememberHydrateRollingStyleBase(el, rollingBase)
                classes.length = ownedClassCount
                if (ownedClassCount) el.classList.remove(...classes)
                if (el.classList.length === 0) el.removeAttribute('class')
            }
            el.removeAttribute(SSR_STYLE_CLASSES_ATTRIBUTE)
        }
    }

    // Process props after children for proper Select/Option behavior
    if (rawProps) {
        // CAUTION 开发期警告（I66）：dangerouslySetInnerHTML 与 children 并存时，
        //  innerHTML 赋值会把刚 append 的 children（含响应式 child 的占位符）整体抹掉——
        //  静态内容消失，atom/函数 child 从此写进脱离文档的占位符，「更新不生效」且没有
        //  任何报错。React 对这个组合直接抛错；这里保持渲染语义不变（innerHTML 胜出），
        //  开发期给出明确警告。诊断关闭（生产）时只付一个布尔检查。
        if (childrenLength && isAxiiDiagnosticsEnabled() && rawProps.dangerouslySetInnerHTML !== undefined) {
            /* eslint-disable no-console */
            console.error('[axii] an element received both "dangerouslySetInnerHTML" and children. ' +
                'innerHTML overwrites the children (including reactive child placeholders), so the children ' +
                'will not render and reactive children will silently stop updating. Provide only one of them.')
            /* eslint-enable no-console */
        }
        // CAUTION value/checked 的语义依赖同元素的其他 prop 已经就位：
        //  select 的数组 value 依赖 multiple（单选 select 上逐个 selected 会互相顶掉），
        //  input 的 value/checked 解释依赖 type（value={true} type="checkbox" 是 checked 语义），
        //  range 的 value 会被 min/max 截断。JSX 属性顺序是用户的书写顺序，不能要求用户
        //  把 value 写在最后——这两个 key 统一延后到其余 prop 全部应用之后再处理。
        //  value 与 checked 之间的先后不决定勾选状态（#52）：见下面的 __axiiInputHasCheckedProp__。
        // 1：有 value，2：有 checked
        let deferredFormProps = 0
        for (const key in rawProps) {
            // key 目前不参与运行时逻辑（保留给未来的 diff），直接跳过；
            // __source/__self 是开发期元数据，绝不能作为普通 attr 落到 DOM 上
            if (key === '_isSVG' || key === 'children' || key === 'key' || key === '__source' || key === '__self') continue
            if (key === 'value') {
                deferredFormProps |= 1
                continue
            }
            if (key === 'checked') {
                deferredFormProps |= 2
                continue
            }
            const value = rawProps[key]
            if (key === 'ref') {
                // ref handles should be attached before children
                if (value) {
                    const ownRef: RefHandleInfo = {handle: value, path: [], el: container as HTMLElement}
                    if (refHandles) {
                        refHandles.unshift(ownRef)
                    } else {
                        refHandles = [ownRef]
                    }
                }
                continue
            }
            if (key === 'detachStyle') {
                if (value) {
                    (detachStyledChildren ||= []).push({el: container as HTMLElement, style: value, path: []})
                }
                continue
            }
            if (!createElement.isValidAttribute(key, value)) {
                (unhandledAttr ||= []).push({el: container as ExtendedElement, key, value, path: [], source: debugSource})
            } else if (hydrateClaimed && key === 'dangerouslySetInnerHTML') {
                // SSR HTML already has markup; re-assigning innerHTML would destroy claimed nodes
                // （失配后新建的元素里没有这段标记，照常赋值）
            } else {
                setAttribute(container as ExtendedElement, key, value, _isSVG)
            }
        }
        if (deferredFormProps) {
            // CAUTION 显式的 checked 永远决定勾选状态，与书写顺序无关（#52，规则见 setAttribute 的 checkbox 分支）：
            //  同时带 value 和 checked 的 input 在应用这两个 key 之前记下这个事实，之后每一次 value 写入
            //  （首帧按键序或经 unhandledAttr 延后、响应式更新、type 翻转后的重放）都只读这一个标记。
            //  只带其中一个 key 的元素（列表行里常见的 <input type="checkbox" checked={done}/>）不多字段。
            if (deferredFormProps === 3 && (container as HTMLElement).tagName === 'INPUT') {
                (container as InputWithAxiiValue).__axiiInputHasCheckedProp__ = true
            }
            for (const key in rawProps) {
                if (key !== 'value' && key !== 'checked') continue
                const value = rawProps[key]
                // 响应式 value/checked 同样延后登记，保证 LightBindingEffect 的初始求值
                // 也发生在 type/multiple 等（可能也是响应式的）属性之后
                if (!createElement.isValidAttribute(key, value)) {
                    (unhandledAttr ||= []).push({el: container as ExtendedElement, key, value, path: [], source: debugSource})
                } else {
                    setAttribute(container as ExtendedElement, key, value, _isSVG)
                }
            }
        }
    }

    // 失配后新建的元素此时子节点和 props 都已应用，才插入文档（#73）。游标已由 exitElementChildCursor 恢复到父节点。
    if (hydrateRebuilt) insertHydrateMismatchElement(container as Element)

    // Attach metadata to container only if necessary
    const containerElement = container as ExtendedElement
    if (debugSource) containerElement.__axiiSource = debugSource
    if (unhandledChildren) containerElement.unhandledChildren = unhandledChildren
    if (unhandledAttr) containerElement.unhandledAttr = unhandledAttr
    if (refHandles) containerElement.refHandles = refHandles
    if (detachStyledChildren) containerElement.detachStyledChildren = detachStyledChildren

    return container as (HTMLElement | DocumentFragment | SVGElement)
}


function isStyleValue(value: any) {
    return typeof value === 'string' || typeof value === 'number' || value instanceof StyleSize
}

function isSimpleStyleObject(value: any) {
    // 排除了带 & 的 style, 让外部处理。
    return isPlainObject(value) &&
        Object.entries(value).every(([k, v]) =>
            /[a-zA-Z\-]+/.test(k) && isStyleValue(v) || (Array.isArray(v) && v.every(isStyleValue))
        )
}

// CAUTION 写到 createElement 上就是为了给外面根据自己需要覆盖的
/**
 * style 支持对象和字符串形式，但是嵌套的对象形式不支持。
 * 事件 支持函数或者函数数组
 * className 支持对象
 */
createElement.isValidAttribute = function (name: string, value: any): boolean {
    if (Array.isArray(value)) {
        return value.every(v => createElement.isValidAttribute(name, v))
    }

    const valueType = typeof value as any

    if (valueType !== 'object' && valueType !== 'function') return true
    // 事件 允许是函数
    // CAUTION 以 on 开头（不区分大小写）的名字一律交给 setAttribute：事件在那里绑定，其余在那里丢弃（#49）。
    //  不能判成响应式属性——ONCLICK={fn} / onclick={atom} 会被 ReactiveAttributeEffect 求值（渲染时调用 fn）
    //  并把结果写成 attribute。
    if (hasOnPrefix(name)) return true
    if (name === 'style' && (isSimpleStyleObject(value) || valueType === 'string')) return true
    // 默认支持 className/class 的对象形式
    if ((name === 'className' || name === 'class') && isPlainObject(value)) return true
    // CAUTION dangerouslySetInnerHTML 的 {__html} 是静态值（#50），不能落进响应式属性路径：
    //  激活时那条路径会重新赋值 innerHTML，替换掉已认领的服务端标记（静态路径在已认领元素上跳过赋值）。
    //  先比较名字：其余属性只多一次常量字符串比较，而且只有走到这里的对象值（随后就要建立响应式绑定）才付。
    if (name === 'dangerouslySetInnerHTML' && isInnerHTMLObject(value)) return true

    return false
}

export type RefFn = (el: any) => void
export type RefObject = { current: any }
// 附加在 createElement 上，
// CAUTION 数组中的 falsy 条件项（ref={[r, cond && r2]}）按「条件不满足」跳过（I60）：
//  与 style/className/事件数组的条件项语义一致。单个 falsy ref 在登记时（RefHandleInfo
//  的 if (value) 守卫）就被跳过，数组项是唯一会走到这里的 falsy 形态。
createElement.attachRef = function (el: HTMLElement, ref: (RefFn | RefObject) | (RefFn | RefObject)[]) {
    if (Array.isArray(ref)) {
        ref.forEach(r => createElement.attachRef(el, r))
        return
    }
    if (ref == null || typeof ref === 'boolean') return

    if (typeof ref === 'function') {
        ref(el)
    } else if (typeof ref === 'object') {
        ref.current = el
    } else {
        assert(false, 'ref should be function or object with current property')
    }
}

// 在 axii 中，任何元素都是直接属于 StaticHost，由它在 destroy 中调用 detachRef。
createElement.detachRef = function (ref: (RefFn | RefObject) | (RefFn | RefObject)[]) {
    if (Array.isArray(ref)) {
        ref.forEach(r => createElement.detachRef(r))
        return
    }
    if (ref == null || typeof ref === 'boolean') return

    if (typeof ref === 'function') {
        ref(null)
    } else if (typeof ref === 'object') {
        ref.current = null
        /* v8 ignore next 3 */
    } else {
        assert(false, 'ref should be function or object with current property')
    }
}

/**
 * Fragment component for JSX
 * This function doesn't actually get called directly with props during runtime.
 * Its presence enables TypeScript to recognize the Fragment syntax.
 * 
 * @category Basic
 */
export function Fragment(props: any = {}): DocumentFragment {
    // During actual JSX transformation, the fragment special case is handled by createElement
    return document.createDocumentFragment();
}

/**
 * option/占位符所属的 select。
 * CAUTION option 的父级不一定是 select：optgroup 是合法且常见的 HTML 结构，
 *  只认「直接父级是 select」会让 optgroup 里动态渲染的 option 不触发 select 的 value 恢复，
 *  选中值静默丢失。热路径上先做最常见的 select 判断，再做一层 optgroup 判断。
 */
// CAUTION 只有存过值的 select（写过 value prop）才需要在 option 增删后重放。这个模块级标志在
//  第一次存值时置位、之后不再清除：在那之前，页面上不可能有需要重放的 select，每次节点插入 /
//  移除都不必对父节点做两次 instanceof（这是每个元素的插入、每个顶层元素的移除都会走的路径）。
let controlledSelectSeen = false
function findOwnerSelect(parent: Element | null): HTMLSelectElement | null {
    if (!controlledSelectSeen) return null
    if (parent instanceof HTMLSelectElement) return parent
    if (parent instanceof HTMLOptGroupElement && parent.parentElement instanceof HTMLSelectElement) {
        return parent.parentElement
    }
    return null
}

type SelectWithAxiiValue = HTMLElement & { __axiiSelectValue__?: string | any[] }
// input 的原始 value（type 翻转时按新 type 重放用），见 setAttribute 的 value/type 分支
type InputWithAxiiValue = HTMLElement & {
    __axiiInputValue__?: any
    __axiiInputAppliedValue__?: string
    // 同时带 value 和 checked prop（createElement 设置）：checkbox 的 boolean value 不再碰勾选状态（#52）
    __axiiInputHasCheckedProp__?: true
}

/**
 * 把 value 应用到 select 上。
 * CAUTION multiple select 的 value 是数组（HTML 多选的用户本意）：
 *  直接赋给 select.value 会被字符串化成 "a,b"，没有任何 option 匹配，选中被整体清空。
 *  必须逐个 option 按包含关系设置 selected。单值路径维持原生赋值。
 */
function applySelectValue(select: HTMLSelectElement, value: string | any[]) {
    if (Array.isArray(value)) {
        for (const option of Array.from(select.options)) {
            // option.value 恒为字符串，数组里的数字值（[1, 2] 是自然写法）按字符串化比较
            option.selected = value.some(v => String(v) === option.value)
        }
    } else {
        select.value = value
    }
}

/**
 * @internal
 * option 的文本内容变化（atom/函数 text child 原地更新 nodeValue）时，没有 value attr 的
 * option 的 value 就是它的文本——此刻可能才出现与 select 存值匹配的 option，必须触发恢复。
 * CAUTION 这是 atom/函数文本更新的热路径，只做两次属性读 + 一次 tagName 比较，
 *  非 option 场景零额外分配。
 */
export function resetOptionOwnerSelect(node: Text | Comment) {
    const parent = node.parentElement
    if (parent && parent.tagName === 'OPTION') {
        const ownerSelect = findOwnerSelect(parent.parentElement)
        if (ownerSelect) {
            resetOptionParentSelectValue(ownerSelect)
        }
    }
}

function resetOptionParentSelectValue(select: HTMLSelectElement) {
    // CAUTION 只有显式设置过 value prop 的 select 才需要重置（存过值才恢复）。
    //  没有 value prop 的 select（非受控）在动态渲染 option 时也会走到这里，
    //  盲目赋值会把 undefined 字符串化成 "undefined" 写给 select.value，
    //  没有任何 option 匹配，浏览器的默认选中（第一个 option）被清掉。
    const storedValue = (select as SelectWithAxiiValue).__axiiSelectValue__
    if (storedValue !== undefined) {
        applySelectValue(select, storedValue)
    }
}

// StyleManager（StaticHost.ts）在有「已创建但还没写进 document.adoptedStyleSheets」的 stylesheet 时
//  登记它的 flush，写入后清空（见 StyleManager.beginBatch）。DOM.ts 不能反向 import StaticHost
//  （循环依赖），所以用登记的方式；没有待写入的表时插入路径只多一次 undefined 判断。
let flushPendingStyleSheets: (() => void) | undefined
/**
 * @internal
 */
export function setPendingStyleSheetFlush(flush: (() => void) | undefined) {
    flushPendingStyleSheets = flush
}

/**
 * @internal
 * option（或 optgroup）被框架移除之后调用，parent 是移除之前它所在的父节点。
 * CAUTION select 存值的恢复曾只挂在「出现」路径上（insertBefore/insertAfter、option 的
 *  value/文本变化）：被选中的 option 被移除时，浏览器按 reset 算法自动选中第一个 option，
 *  而存值此时没有任何 option 匹配——同样的终态全新渲染出来是「无选中」（selectedIndex -1），
 *  两者不一致，之后任何一次无关的插入又会把它变回无选中。移除后按存值重放一次，
 *  与全新渲染、与之后的插入路径保持一致。没有 value prop 的 select（非受控）不受影响，
 *  见 resetOptionParentSelectValue。
 *  成本与 insertBefore 的同款判断相同：对 parent 做两次 instanceof，非 select 场景不做任何写入。
 */
export function restoreSelectValueAfterRemoval(parent: Node | null) {
    const ownerSelect = findOwnerSelect(parent as Element | null)
    if (ownerSelect) {
        if (selectReplaySuspended !== 0) {
            (selectsToReplay ??= new Set()).add(ownerSelect)
        } else {
            resetOptionParentSelectValue(ownerSelect)
        }
    }
}

// CAUTION 批量移除（列表整体销毁、一次 patch 逐行删除、数组内容逐项销毁）时，每一行自己的
//  移除路径都会按存值重放一次 select，而 select.value 赋值要扫描剩下的全部 option：
//  销毁 N 个 option 行是 O(N²)（4000 行 176 ms）。批量入口用 suspend/resume 包住，期间只记下
//  涉及的 select，最外层 resume 时每个 select 重放一次。没有受控 select 时（findOwnerSelect
//  直接返回 null）只多一次计数增减，不分配。
let selectReplaySuspended = 0
let selectsToReplay: Set<HTMLSelectElement> | undefined
/**
 * @internal
 * 必须与 resumeSelectReplay 成对出现在 try/finally 里。
 */
export function suspendSelectReplay() {
    selectReplaySuspended++
}
/**
 * @internal
 */
export function resumeSelectReplay() {
    if (--selectReplaySuspended !== 0) return
    const selects = selectsToReplay
    if (selects === undefined) return
    selectsToReplay = undefined
    selects.forEach(resetOptionParentSelectValue)
}

/**
 * @internal
 * If endEl is provided, insert all elements from newEl to endEl
 */
export function insertBefore(newEl: Comment | HTMLElement | DocumentFragment | SVGElement | Text, refEl: HTMLElement | Comment | Text | SVGElement, endEl?: HTMLElement | Comment | Text | SVGElement) {
    // CAUTION 节点即将连入文档：它们依赖的 stylesheet 必须先生效，之后同步执行的 ref/layoutEffect、
    //  自定义元素的 connectedCallback 才能读到正确的样式（见 StyleManager.beginBatch）。
    if (flushPendingStyleSheets !== undefined && refEl.isConnected) flushPendingStyleSheets()
    // CAUTION 必须用循环而不是递归实现，递归深度等于节点数，长区间搬移时会栈溢出。
    let result: Node
    let current: Node|null = newEl
    do {
        // 有 endEl 就一定是个已经存在的序列。先取 next 再移动，移动之后 nextSibling 就变了。
        const next: Node|null = (endEl && current !== endEl) ? current.nextSibling : null
        // CAUTION 这里用 parentNode.insertBefore ，因为 parent 可能是 DocumentFragment，只能用 parentNode 读
        const inserted = refEl.parentNode!.insertBefore!(current, refEl)
        if (current === newEl) result = inserted
        current = next
    } while (current)

    // CAUTION option 可能包在 optgroup 里，owner select 的判断见 findOwnerSelect
    const ownerSelect = findOwnerSelect(refEl.parentElement)
    if (ownerSelect) {
        resetOptionParentSelectValue(ownerSelect)
    }

    return result!
}


/**
 * @internal
 */
export function insertAfter(newEl: Comment | HTMLElement | DocumentFragment | SVGElement | Text, refEl: HTMLElement | Comment | Text | SVGElement) {
    // 同 insertBefore：连入文档之前先让待写入的 stylesheet 生效
    if (flushPendingStyleSheets !== undefined && refEl.isConnected) flushPendingStyleSheets()
    // CAUTION 这里用 parentNode.insertBefore ，因为 parent 可能是 DocumentFragment，只能用 parentNode 读
    const result = refEl.parentNode!.insertBefore!(newEl, refEl.nextSibling)
    const ownerSelect = findOwnerSelect(refEl.parentElement)
    if (ownerSelect) {
        resetOptionParentSelectValue(ownerSelect)
    }

    return result
}

export function createSVGElement(type: string, props: AttributesArg, ...children: any[]) {
    return createElement(type, {_isSVG: true, ...(props || {})}, ...children)
}

/**
 * @internal
 */
export function dispatchEvent(target: ExtendedElement, event: Event) {
    return eventProxy.call(target, event)
}


type Unit = 'px' | 'rem' | 'em' | '%'
// CAUTION StyleSize 的 add/sub 传入不带单位的数字时用自己的单位；但自己已经是 calc 表达式
//  （unit 为 'mixed'）时没有「自己的单位」，直接拼会得到 "2mixed" 这种非法 CSS，整个 calc 被
//  浏览器丢弃。这时与 new StyleSize(2) 一样取全局的自动单位。
function numberUnitOf(unit: Unit|'mixed') {
    return unit === 'mixed' ? getAutoUnitType() : unit
}
/**
 * @category Common Utility
 */
export class StyleSize {
    constructor(public value: number|string, public unit: Unit|'mixed' = getAutoUnitType()) {
        if (typeof value === 'string') {
            this.unit = 'mixed'
        }
    }
    toString(): string {
        if(this.unit !== 'mixed'){
            return `${this.value}${this.unit}`
        } else {
            // 由 calc 函数来算
            return `calc(${this.value})`
        }
    }
    clone() {
        return new StyleSize(this.value, this.unit)
    }
    valueOf() {
        return this.toString()
    }
    mul(value: number) {
        if (typeof this.value === 'number') {
            this.value = this.value  * value
        } else {
            this.value = `(${this.value}) * ${value}`
            this.unit = 'mixed'
        }
        return this
    }
    div(value: number) {
        if (typeof this.value === 'number') {
            this.value = this.value  / value
        } else {
            this.value = `(${this.value}) / ${value}`
            this.unit = 'mixed'
        }
        return this
    }
    add(value: number|StyleSize, unit?: Unit) {
        if (typeof this.value === 'number' && typeof value === 'number' && (!unit || unit === this.unit)) {
            this.value = this.value + value
        } else if(typeof this.value === 'number' && value instanceof StyleSize && this.unit === value.unit) {
            this.value = this.value + (value.value as number)
        } else {
            const originStr = typeof this.value === 'number' ? `${this.value}${this.unit}` : `(${this.value})`
            const valueStr = typeof value === 'number' ? `${value}${unit||numberUnitOf(this.unit)}` : (value.unit=== 'mixed' ? `(${value.value})` : value.toString())
            this.value = `${originStr} + ${valueStr}`
            this.unit = 'mixed'
        }
        return this
    }
    sub(value: number|StyleSize, unit?: Unit) {
        if (typeof this.value === 'number' && typeof value === 'number' && (!unit || unit === this.unit)) {
            this.value = this.value - value
        } else if(typeof this.value === 'number' && value instanceof StyleSize && this.unit === value.unit) {
            this.value = this.value - (value.value as number)
        } else {
            const originStr = typeof this.value === 'number' ? `${this.value}${this.unit}` : `(${this.value})`
            const valueStr = typeof value === 'number' ? `${value}${unit||numberUnitOf(this.unit)}` : (value.unit=== 'mixed' ? `(${value.value})` : value.toString())
            this.value = `${originStr} - ${valueStr}`
            this.unit = 'mixed'
        }
        return this
    }
}

// for jsx-dev-runtime
// CAUTION svg-only 标签的 namespace 路由统一在 createElement 内部完成（见 svgOnlyElementNames），
//  runtime 这里不再做二次路由，避免同一次创建查两遍 Set。
export function jsxs(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    return createElement(type, rawProps, ...children)
}
export function jsx(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    // CAUTION 无 children 时不能把 undefined 当作一个实参传下去，否则组件拿到的是 [undefined] 而不是 []
    return children === undefined ? createElement(type, rawProps) : createElement(type, rawProps, children)
}
// React automatic dev runtime 签名：jsxDEV(type, props, key, isStaticChildren, source, self)
export function jsxDEV(
    type: JSXElementType,
    {children, ...rawProps}: AttributesArg,
    _key?: string,
    _isStaticChildren?: boolean,
    source?: AxiiSource,
    self?: unknown
): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    const props = source || self ? {...rawProps, __source: source, __self: self} : rawProps
    if (Array.isArray(children)) return createElement(type, props, ...children)
    // CAUTION 同 jsx：无 children 时不能传 undefined 占位
    return children === undefined ? createElement(type, props) : createElement(type, props, children)
}
