/// <reference lib="dom" />
import {assert, each, isPlainObject} from './util'
import {Component, ComponentNode} from "./types";
import {reportAxiiError} from "./diagnostics";
import type {AxiiSource} from "./diagnostics";

export const AUTO_ADD_UNIT_ATTR = /^(width|height|top|left|right|bottom|margin|marginTop|marginRight|marginBottom|marginLeft|padding|paddingTop|paddingRight|paddingBottom|paddingLeft|borderWidth|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|outlineWidth|borderRadius|fontSize|letterSpacing|wordSpacing|textIndent|maxWidth|maxHeight|minHeight|minWidth|gap|flexBasis|columnGap|rowGap|columnWidth)$/
let autoUnitType: 'px' | 'rem' | 'em' = 'px'
export function setAutoUnitType(type: 'px' | 'rem' | 'em') {
    autoUnitType = type
}

export function autoUnit(num: number|string) {
    if (typeof num === 'string') {
        return num
    }
    return `${num}${autoUnitType}`
}

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
        } else if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' && CSS_UNIT_VALUE.test(v[1])) {
            // [12, 'px'] => 12px
            return `${v[0]}${v[1]}`
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
                try {
                    arrayResult[i] = listener[i]?.(e, ...args)
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


/**
 * @internal
 * CAUTION 事件必须是 on + 大写字母（onClick/onChangeCapture），与 mergeProp 的约定一致：
 *  宽松的 startsWith('on') 会把 once/online 这类普通 prop 吞进事件分支——
 *  属性永远设不到 DOM 上，还会挂上一个永不触发的假监听器。
 */
export function isEventName(name: string) {
    if (name[0] !== 'o' || name[1] !== 'n') return false
    const third = name.charCodeAt(2)
    return third >= 65 && third <= 90
}


const svgForceDashStyleAttributes = /^(strokeWidth|strokeLinecap|strokeLinejoin|strokeMiterlimit|strokeDashoffset|strokeDasharray|strokeOpacity|fillOpacity|stopOpacity)/
// JSX evaluates children before their parent, so the runtime cannot infer an SVG namespace
// from ancestry the way a VDOM renderer can. Create tags that only exist in SVG in the
// correct namespace immediately. Ambiguous HTML/SVG tags (a/script/style/title) deliberately
// stay on the HTML path; inside SVG they should use the explicit createSVGElement factory.
// CAUTION 这个判断必须在 createElement 内部做（而不是只在 jsx/jsxs/jsxDEV runtime 路由）：
//  classic pragma（/* @jsx createElement */）和组件 renderContext 的 createElement 都不经过
//  runtime factory，只在 runtime 路由的话这两条链路里 <svg> 会被创建成 HTMLUnknownElement，
//  整个图形静默不显示——同一个 JSX 在两种编译模式下行为分叉。
const svgOnlyElementNames = new Set([
    'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc',
    'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
    'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
    'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
    'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
    'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
    'filter', 'foreignObject', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask',
    'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient',
    'rect', 'set', 'stop', 'svg', 'switch', 'symbol', 'text', 'textPath', 'tspan',
    'use', 'view',
])

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
    if (Array.isArray(value) && name !== 'style' && name !== 'className' && !isEventName(name) &&
        !(name === 'value' && node.tagName === 'SELECT')) {
        // 全都是覆盖模式，只处理最后一个
        return setAttribute(node, name, value.at(-1), isSvg)
    }

    // uuid
    if (name === 'uuid') {
        node.setAttribute('data-uuid', value)
        return
    }

    // 事件
    if (isEventName(name)) {
        const useCapture = name !== (name = name.replace(/Capture$/, ''))
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
        const styles = Array.isArray(value) ? value : [value]
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
        const classNameOptions = Array.isArray(value) ? value : [value]
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
        (node as HTMLDataElement).value = value == null ? '' : value

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
            if (value) {
                (node as HTMLInputElement).checked = true
                node.setAttribute('checked', 'true')
            } else {
                (node as HTMLInputElement).checked = false
                node.removeAttribute('checked')
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
        // CAUTION 目标 type 会改变 value 的解释（checkbox/radio 的 value 即 checked 语义、
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
        node.innerHTML = value ?? ''
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
        setProperty(node, name, value === null ? '' : value)
        if (value === null || value === undefined) node.removeAttribute(name)
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
        if (value == null || value === false) {
            if (ns) {
                node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase())
            } else if (value === false &&
                (name.toLowerCase() === 'contenteditable' ||
                    ((name[0] === 'a' || name[0] === 'd') && (/^aria-/.test(name) || /^data-/.test(name))))) {
                // CAUTION aria-*/data-* 的 false 是有语义的值，不是「移除」：
                //  aria-expanded/aria-checked 等状态属性缺席与 "false" 对屏幕阅读器完全不同
                //  （缺席 = 不可展开/不是开关，"false" = 收起/未选中）。React 同样字面化渲染。
                //  data-* 的响应式路径（dataset 赋值）本来就产出 "false"，静态路径必须一致。
                //  null/undefined 仍然是移除语义（条件属性的自然写法）。
                node.setAttribute(name, 'false')
            } else {
                node.removeAttribute(name)
            }
            /* v8 ignore next 4 */
        } else if (typeof value !== 'function' && ns) {
            // xlink:href 元素，有 namespace 的
            node.setAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase(), value)
        } else {
            // svg 的 attrName 要从驼峰转换成连字符风格
            const attrName = (isSvg && svgForceDashStyleAttributes.test(name)) ? name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() : name
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
        return {type, props, children, __axiiSource: debugSource} as ComponentNode
    }

    // CAUTION svg-only 标签（circle/path/svg 等）无论从哪个入口进来都必须落在 SVG namespace，
    //  见 svgOnlyElementNames 的说明。显式 _isSVG（createSVGElement 传入）优先，
    //  未显式指定时按标签名兜底；每个元素只多一次 Set 查找（原 jsx runtime 路由的同款成本）。
    const _isSVG = (rawProps ? rawProps._isSVG : undefined) ??
        (type !== Fragment && svgOnlyElementNames.has(type as string))

    // Create container with proper type assertion
    const container = type === Fragment
        ? document.createDocumentFragment()
        : (_isSVG 
            ? document.createElementNS('http://www.w3.org/2000/svg', type as string) as SVGElement
            : document.createElement(type as string)) as HTMLElement

    // CAUTION 元数据数组按需分配，绝大多数元素一个都不需要
    let unhandledAttr: UnhandledAttrInfo[] | undefined
    let unhandledChildren: UnhandledChildInfo[] | undefined
    let refHandles: RefHandleInfo[] | undefined
    let detachStyledChildren: DetachStyledInfo[] | undefined

    // CAUTION select 的 multiple 必须先于 option children 应用：多个带 selected 的 option
    //  在单选语义的 select 里插入时会互相顶掉，只剩最后一个被选中。静态真值在这里预应用；
    //  响应式 multiple（函数/atom）由 setAttribute 的 multiple 分支在翻转时重放存值。
    //  下面的 props 循环会再次应用 multiple，重复设置同值无害。
    if (type === 'select' && rawProps?.multiple && typeof rawProps.multiple !== 'function') {
        setAttribute(container as ExtendedElement, 'multiple', rawProps.multiple, _isSVG)
    }

    // Process children in a single pass
    const children: any[] = rawChildren.length ? rawChildren : (rawProps?.children || EMPTY_CHILDREN)
    const childrenLength = children.length
    if (type !== Fragment && childrenLength === 1 && (typeof children[0] === 'string' || typeof children[0]  === 'number')) {
        (container as HTMLElement).textContent = children[0].toString()
    } else if (childrenLength) {
        // CAUTION container 此时还没有插入文档，直接 append 不会触发布局，无需中转 fragment
        for (let index = 0; index < childrenLength; index++) {
            const child = children[index]
            if (child == null) continue // Handles both undefined and null

            if (typeof child === 'string' || typeof child === 'number') {
                container.appendChild(document.createTextNode(child.toString()))
            } else if (child instanceof Node) { // Covers HTMLElement, DocumentFragment, SVGElement
                container.appendChild(child)

                // Handle extended element properties
                // CAUTION 这些元数据数组的所有权是唯一的（由子元素的 createElement 创建，
                //  在这里被提升一次并清空引用），所以可以直接原地改写 path、直接接管数组。
                const childElement = child as ExtendedElement
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
                const placeholder: UnhandledPlaceholder = typeof child === 'function' ?
                    document.createTextNode('') :
                    document.createComment('unhandledChild')
                container.appendChild(placeholder)
                const info: UnhandledChildInfo = {placeholder, child, path: [index], source: debugSource}
                if (unhandledChildren) {
                    unhandledChildren.push(info)
                } else {
                    unhandledChildren = [info]
                }
            }
        }
    }

    // Process props after children for proper Select/Option behavior
    if (rawProps) {
        // CAUTION value/checked 的语义依赖同元素的其他 prop 已经就位：
        //  select 的数组 value 依赖 multiple（单选 select 上逐个 selected 会互相顶掉），
        //  input 的 value/checked 解释依赖 type（value={true} type="checkbox" 是 checked 语义），
        //  range 的 value 会被 min/max 截断。JSX 属性顺序是用户的书写顺序，不能要求用户
        //  把 value 写在最后——这两个 key 统一延后到其余 prop 全部应用之后再处理。
        let hasDeferredFormProps = false
        for (const key in rawProps) {
            // key 目前不参与运行时逻辑（保留给未来的 diff），直接跳过；
            // __source/__self 是开发期元数据，绝不能作为普通 attr 落到 DOM 上
            if (key === '_isSVG' || key === 'children' || key === 'key' || key === '__source' || key === '__self') continue
            if (key === 'value' || key === 'checked') {
                hasDeferredFormProps = true
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
            } else {
                setAttribute(container as ExtendedElement, key, value, _isSVG)
            }
        }
        if (hasDeferredFormProps) {
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
    if (isEventName(name) && valueType === 'function') return true
    if (name === 'style' && (isSimpleStyleObject(value) || valueType === 'string')) return true
    // 默认支持 className/class 的对象形式
    if ((name === 'className' || name === 'class') && isPlainObject(value)) return true

    return false
}

export type RefFn = (el: any) => void
export type RefObject = { current: any }
// 附加在 createElement 上，
createElement.attachRef = function (el: HTMLElement, ref: (RefFn | RefObject) | (RefFn | RefObject)[]) {
    if (Array.isArray(ref)) {
        ref.forEach(r => createElement.attachRef(el, r))
        return
    }

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
function findOwnerSelect(parent: Element | null): HTMLSelectElement | null {
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

/**
 * @internal
 * If endEl is provided, insert all elements from newEl to endEl
 */
export function insertBefore(newEl: Comment | HTMLElement | DocumentFragment | SVGElement | Text, refEl: HTMLElement | Comment | Text | SVGElement, endEl?: HTMLElement | Comment | Text | SVGElement) {
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
/**
 * @category Common Utility
 */
export class StyleSize {
    constructor(public value: number|string, public unit: Unit|'mixed' = autoUnitType) {
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
            const valueStr = typeof value === 'number' ? `${value}${unit||this.unit}` : (value.unit=== 'mixed' ? `(${value.value})` : value.toString())
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
            const valueStr = typeof value === 'number' ? `${value}${unit||this.unit}` : (value.unit=== 'mixed' ? `(${value.value})` : value.toString())
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
