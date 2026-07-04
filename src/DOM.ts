/// <reference lib="dom" />
import {assert, each, isPlainObject} from './util'
import {Component, ComponentNode} from "./types";

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

export function stringifyStyleValue(k:string, v: any): string {
    // 当值是 falsy 的时候 设置 style[k] 为 ''，用来清除 inline style
    if (v === undefined || v === null) return ''
    if(Array.isArray(v)) {
        // CAUTION 这里的 v 都加上了 v.toString()，因为有可能是 StyleSize
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            // attr like box-shadow
            // 这里不可能是 StyleSize 所以不用 toString
            return v.join(',')

        } else if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string') {
            // [12, 'px'] => 12px
            return `${v[0]}${v[1]}`
        } else {
            // padding/margin/transform|translate|scale|rotate|skew
            // 支持 undefined 值自动 fallback 到 0 值
            return v.map((i:any) => stringifyStyleValue(k, i ?? 0)).join(' ')
        }
    }
    // number/string/StyleSize
    return (!(v instanceof StyleSize) && AUTO_ADD_UNIT_ATTR.test(k)) ? autoUnit(v||0) : v.toString()
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
        /* v8 ignore next 5 */
    } catch (e) {
        /* eslint-disable no-console */
        console.error(e)
        /* eslint-enable no-console */
    }
}

export interface ExtendedElement extends HTMLElement {
    _listeners?: {
        [k: string]: (e: Event, ...args: any[]) => any
    },
    _captureListeners?: {
        [k: string]: (e: Event, ...args: any[]) => any
    }
    listenerBoundArgs?: any[]
    unhandledChildren?: UnhandledChildInfo[]
    unhandledAttr?: UnhandledAttrInfo[]
    refHandles?: RefHandleInfo[]
    detachStyledChildren?: DetachStyledInfo[]
}

function eventProxy(this: ExtendedElement, e: Event) {
    const listener = this._listeners![e.type]
    // CAUTION 数组 listener 用 map 而不是 forEach，保留每个 handler 的返回值
    return Array.isArray(listener) ? listener.map(l => l?.(e, ...(this.listenerBoundArgs||[]))) : listener?.(e, ...(this.listenerBoundArgs||[]))
}

function captureEventProxy(this: ExtendedElement, e: Event) {
    const listener = this._captureListeners![e.type]
    // CAUTION 数组 listener 用 map 而不是 forEach，保留每个 handler 的返回值
    return Array.isArray(listener) ? listener.map(l => l?.(e, ...(this.listenerBoundArgs||[]))) : listener?.(e, ...(this.listenerBoundArgs||[]))
}

// CAUTION 大多数占位符是 Comment。函数/atom 类型的 child 用 Text 节点做占位符（乐观策略）：
//  它们绝大多数渲染为文本，此时占位符自身就能当 Text 节点用，省一次节点创建和插入。
export type UnhandledPlaceholder = Comment | Text


function isEventName(name: string) {
    return name[0] === 'o' && name[1] === 'n'
}


const svgForceDashStyleAttributes = /^(strokeWidth|strokeLinecap|strokeLinejoin|strokeMiterlimit|strokeDashoffset|strokeDasharray|strokeOpacity|fillOpacity|stopOpacity)/
/**
 * @internal
 */
export function setAttribute(node: ExtendedElement, name: string, value: any, isSvg?: boolean): void {
    if (Array.isArray(value) && name !== 'style' && name !== 'className' && !isEventName(name)) {
        // 全都是覆盖模式，只处理最后一个
        return setAttribute(node, name, value.at(-1), isSvg)
    }

    // uuid
    if (name === 'uuid') {
        node.setAttribute('data-uuid', value)
        return
    }

    // 事件
    if (name[0] === 'o' && name[1] === 'n') {
        const useCapture = name !== (name = name.replace(/Capture$/, ''))
        let eventName = name.toLowerCase().substring(2)
        // CAUTION 体验改成和 react 的一致
        if (eventName === 'change') eventName = 'input'
        const proxy = useCapture ? captureEventProxy : eventProxy
        if (value) {
            // CAUTION 同一个 proxy 重复 addEventListener 会被 DOM 自动去重，这里无需判断
            node.addEventListener(eventName, proxy, useCapture)
        } else {
            node.removeEventListener(eventName, proxy, useCapture)
        }

        const listeners = useCapture ?
            (node._captureListeners || (node._captureListeners = {})) :
            (node._listeners || (node._listeners = {}))

        if (value) {
            // CAUTION onChange 会被别名成 input 事件，可能和用户同时写的 onInput 撞 key，
            //  这里要合并成数组而不是断言唯一，否则会直接崩溃。
            const existing = listeners[eventName]
            listeners[eventName] = existing === undefined ?
                value :
                (Array.isArray(existing) ? existing : [existing]).concat(value)
        } else {
            // 传入 falsy 值表示解绑
            delete listeners[eventName]
        }

        return
    }

    // style
    if (name === 'style') {
        if (!value || (Array.isArray(value) && !value.length)) {
            node.style.cssText = value || ''
        }
        const styles = Array.isArray(value) ? value : [value]
        styles.forEach(style => {
            if (typeof style === 'string') {
                node.style.cssText = style
            } else  if (typeof style === 'object') {
                each(style, (v, k) => {
                    if (k[0] === '-' && k[1] === '-') {
                        node.style.setProperty(k, v)
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
            if (typeof className === 'object') {
                for(const name in className) {
                    if (className[name]) {
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
    } else if (name === 'class' && !isSvg) {
        node.className = value || ''
    } else if (name === 'value') {
        (node as HTMLDataElement).value = value

        // CAUTION 因为 select 如果 option 还没有渲染（比如 computed 的情况），那么设置 value 就没用，我们这里先存着，
        //  等 append option children 的时候再 set value 一下
        if (node.tagName === 'SELECT') {
            node.dataset['__value__'] = value
        } else if (node.tagName === 'OPTION') {
            // 当 option 的 value 发生变化的时候也要 reset 一下，因为可能这个时候与 select value 相等的 option 才出现
            if (node.parentElement instanceof HTMLSelectElement) {
                resetOptionParentSelectValue(node.parentElement)
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
        } else if (node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'text' && value === undefined) {
            // 特殊处理一下 input value 为 undefined 的情况
            (node as HTMLDataElement).value = ''
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

    } else if (name === 'dangerouslySetInnerHTML') {
        // console.warn(value)
        node.innerHTML = value
    } else if (name !== 'list' && name !== 'type' && !isSvg && name in node) {
        setProperty(node, name, value === null ? '' : value)
        if (value === null || value === undefined) node.removeAttribute(name)
    } else {
        /* v8 ignore next 4 */
        const ns = isSvg && (name !== (name = name.replace(/^xlink\:?/, '')))
        if (value == null || value === false) {
            if (ns) {
                node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase())
            } else if (name.toLowerCase() === 'contenteditable' && value === false) {
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

type UnhandledChildInfo = {
    placeholder: UnhandledPlaceholder,
    child: any,
    path: number[]
}

type UnhandledAttrInfo = {
    el: ExtendedElement,
    key: string,
    value: any,
    path: number[]

}

export type RefHandleInfo = {
    el: any,
    handle: RefFn | RefObject,
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
    // Early return for component nodes
    if (typeof type !== 'string' && type !== Fragment) {
        const children: any[] = rawChildren.length ? rawChildren : (rawProps?.children || [])
        return {type, props: rawProps||{}, children} as ComponentNode
    }

    const _isSVG = rawProps ? rawProps._isSVG : undefined

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
                const childUnhandledChildren = childElement.unhandledChildren
                if (childUnhandledChildren?.length) {
                    for (const c of childUnhandledChildren) c.path.unshift(index)
                    if (unhandledChildren) {
                        unhandledChildren.push(...childUnhandledChildren)
                    } else {
                        unhandledChildren = childUnhandledChildren
                    }
                    childElement.unhandledChildren = undefined
                }
                const childUnhandledAttr = childElement.unhandledAttr
                if (childUnhandledAttr?.length) {
                    for (const c of childUnhandledAttr) c.path.unshift(index)
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
                if (unhandledChildren) {
                    unhandledChildren.push({placeholder, child, path: [index]})
                } else {
                    unhandledChildren = [{placeholder, child, path: [index]}]
                }
            }
        }
    }

    // Process props after children for proper Select/Option behavior
    if (rawProps) {
        for (const key in rawProps) {
            // key 目前不参与运行时逻辑（保留给未来的 diff），直接跳过
            if (key === '_isSVG' || key === 'children' || key === 'key') continue
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
                (unhandledAttr ||= []).push({el: container as ExtendedElement, key, value, path: []})
            } else {
                setAttribute(container as ExtendedElement, key, value, _isSVG)
            }
        }
    }


    // Attach metadata to container only if necessary
    const containerElement = container as ExtendedElement
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
    if ((name[0] === 'o' && name[1] === 'n') && valueType === 'function') return true
    if (name === 'style' && (isSimpleStyleObject(value) || valueType === 'string')) return true
    // 默认支持 className 的对象形式
    if (name === 'className' && isPlainObject(value)) return true

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

function resetOptionParentSelectValue(select: HTMLSelectElement) {
    select.value = select.dataset['__value__']!
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

    if (refEl.parentElement instanceof HTMLSelectElement) {
        resetOptionParentSelectValue(refEl.parentElement)
    }

    return result!
}


/**
 * @internal
 */
export function insertAfter(newEl: Comment | HTMLElement | DocumentFragment | SVGElement | Text, refEl: HTMLElement | Comment | Text | SVGElement) {
    // CAUTION 这里用 parentNode.insertBefore ，因为 parent 可能是 DocumentFragment，只能用 parentNode 读
    const result = refEl.parentNode!.insertBefore!(newEl, refEl.nextSibling)
    if (refEl.parentElement instanceof HTMLSelectElement) {
        resetOptionParentSelectValue(refEl.parentElement)
    }

    return result
}

export function createSVGElement(type: string, props: AttributesArg, ...children: any[]) {
    return createElement(type, {_isSVG: true, ...(props || {})}, children)
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
export function jsxs(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    return createElement(type, rawProps, ...children)
}
export function jsx(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    return createElement(type, rawProps, children)
}
export function jsxDEV(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    return Array.isArray(children) ? createElement(type, rawProps, ...children) : createElement(type, rawProps, children)
}
