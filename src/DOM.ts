/// <reference lib="dom" />
import {assert, each, isPlainObject} from './util'
import {Component, ComponentNode} from "./types";

export const AUTO_ADD_UNIT_ATTR = /^(width|height|top|left|right|bottom|margin|padding|border|fontSize|maxWidth|maxHeight|minHeight|minWidth|gap|flexBasis|columnGap|rowGap)/
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
    if (v === undefined) {
        return ''
    }
    if(Array.isArray(v)) {
        // CAUTION 这里的 v 都加上了 v.toString()，因为有可能是 StyleSize
        if (COMMA_MULTI_VALUE_ATTR.test(k)) {
            // attr like box-shadow
            // 这里不可能是 StyleSize 所以不用 toString
            return v.join(',')
        } else {
            // padding/margin/transform|translate|scale|rotate|skew
            return v.map((i:any) => stringifyStyleValue(k, i)).join(' ')
        }
    }
    // number/string/StyleSize
    return typeof v === 'number' && AUTO_ADD_UNIT_ATTR.test(k) ? autoUnit(v) : v.toString()
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
    return Array.isArray(listener) ? listener.forEach(l => l?.(e, ...(this.listenerBoundArgs||[]))) : listener?.(e, ...(this.listenerBoundArgs||[]))
}

function captureEventProxy(this: ExtendedElement, e: Event) {
    const listener = this._captureListeners![e.type]
    return Array.isArray(listener) ? listener.forEach(l => l?.(e, ...(this.listenerBoundArgs||[]))) : listener?.(e, ...(this.listenerBoundArgs||[]))
}

export type UnhandledPlaceholder = Comment

const selectValueTmp = new WeakMap<ExtendedElement, any>()


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
            node.addEventListener(eventName, proxy, useCapture)
        } else {
            node.removeEventListener(eventName, proxy, useCapture)
        }

        const listeners = useCapture ?
            (node._captureListeners || (node._captureListeners = {})) :
            (node._listeners || (node._listeners = {}))

        assert(listeners?.[eventName] === undefined, `${name} already listened`);
        listeners[eventName] = value

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
                    // @ts-ignore
                    node.style[k] = stringifyStyleValue(k, v)
                })
            } else {
                assert(false, 'style can only be string or object.')
            }
        })
        return
    }

    if (name === 'className') {
        const classNames = Array.isArray(value) ? value : [value]
        let classNameValue = ''
        classNames.forEach((className) => {
            if (typeof className === 'object') {
                Object.entries(className).forEach(([name, shouldShow]) => {
                    if (shouldShow) classNameValue = `${classNameValue} ${name}`
                })
            } else if (typeof className === 'string') {
                // 只能是 string
                classNameValue = `${classNameValue} ${className}`
            } else {
                assert(false, 'className can only be string or {[k:string]:boolean}')
            }
        })

        node.setAttribute('class', classNameValue)
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
            selectValueTmp.set(node, value)
        } else if (node.tagName === 'OPTION') {
            // 当 option 的 value 发生变化的时候也要 reset 一下，因为可能这个时候与 select value 相等的 option 才出现
            resetOptionParentSelectValue(node)
        } else if (node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'checkbox') {
            // checkbox 也支持用 value ，这样容易统一 api
            if (value) {
                node.setAttribute('checked', 'true')
            } else {
                node.removeAttribute('checked')
            }
        } else if (node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'text' && value === undefined) {
            // 特殊处理一下 input value 为 undefined 的情况
            (node as HTMLDataElement).value = ''
        }
    } else if (name === 'checked' && node.tagName === 'INPUT' && (node as HTMLObjectElement).type === 'checkbox') {
        // checkbox 的 checked 支持用 boolean 表示
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
        if (value) node.innerHTML = value || ''
    } else if (name !== 'list' && name !== 'type' && !isSvg && name in node) {
        setProperty(node, name, value === null ? '' : value)
        if (value === null || value === undefined) node.removeAttribute(name)
    } else {
        const ns = isSvg && (name !== (name = name.replace(/^xlink\:?/, '')))
        if (value == null || value === false) {
            if (ns) {
                node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase())
            } else if (name.toLowerCase() === 'contenteditable' && value === false) {
                node.setAttribute(name, 'false')
            } else {
                node.removeAttribute(name)
            }
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

// 这里的返回类型要和 global.d.ts 中的 JSX.Element 类型一致
export function createElement(type: JSXElementType, rawProps: AttributesArg, ...rawChildren: any[]): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    const {_isSVG, ...props} = rawProps || {}

    let container: HTMLElement | DocumentFragment | SVGElement

    const children: any[] = rawChildren.length ? rawChildren: (props.children || [])

    if (type === Fragment) {
        container = document.createDocumentFragment()
    } else if (typeof type === 'string') {
        container = _isSVG ? document.createElementNS('http://www.w3.org/2000/svg', type) : document.createElement(type)
    } else {
        return {type, props, children} as ComponentNode
    }

    const unhandledAttr: UnhandledAttrInfo[] = []
    const unhandledChildren: UnhandledChildInfo[] = []
    const refHandles: RefHandleInfo[] = []
    const detachStyledChildren: DetachStyledInfo[] =[]

    children?.forEach((child, index) => {
        if (child === undefined || child === null) return

        if (typeof child === 'string' || typeof child === 'number') {
            container.appendChild(document.createTextNode(child.toString()))
        } else if (child instanceof HTMLElement || child instanceof DocumentFragment || child instanceof SVGElement) {
            container.appendChild(child)

            // 往上传递 unhandledChild unhandledAttr ，直到没有 parent 了为止
            const childElement = child as ExtendedElement
            const childUnhandledChildren = childElement.unhandledChildren || []
            unhandledChildren.push(...childUnhandledChildren.map(c => ({...c, path: [index, ...c.path]})))

            const childUnhandledAttr = childElement.unhandledAttr || []
            unhandledAttr.push(...childUnhandledAttr.map(c => ({...c, path: [index, ...c.path]})))

            const childRefHandles = childElement.refHandles || []
            refHandles.push(...childRefHandles.map(c => ({...c, path: [index, ...c.path]})))

            const childDetachStyledChildren = childElement.detachStyledChildren || []
            detachStyledChildren.push(...childDetachStyledChildren.map(c => ({...c, path: [index, ...c.path]})))


            delete childElement.unhandledChildren
            delete childElement.unhandledAttr
            delete childElement.refHandles
            delete childElement.detachStyledChildren

        } else {
            const placeholder: UnhandledPlaceholder = document.createComment('unhandledChild')
            container.appendChild(placeholder)
            unhandledChildren.push({placeholder, child, path: [index]})
        }
    })

    // CAUTION 注意这里一定要先处理往 children 再处理自身的 prop，因为像 Select 这样的元素只有在渲染完 option 之后再设置 value 才有效。
    //  否则会出现  Select value 自动变成 option 第一个的情况。
    if (props) {
        if (props.ref) {
            // createElement.attachRef(container as HTMLElement, props.ref)
            refHandles.push({handle: props.ref, path: [], el: container as HTMLElement})
            delete props.ref
        }

        if (props.detachStyle) {
            detachStyledChildren.push({el: container as HTMLElement, style: props.detachStyle, path: []})
            delete props.detachStyle
        }

        Object.entries(props).forEach(([key, value]) => {
            // 注意这里好像写得很绕，但逻辑判断是最少的
            if (!createElement.isValidAttribute(key, value)) {
                unhandledAttr.push({el: container as ExtendedElement, key, value, path: []})
            } else {
                setAttribute(container as ExtendedElement, key, value, _isSVG)
            }
        })
    }

    // 把 unhandled child/attr 全部收集到顶层的  container 上，等外部处理，这样就不用外部去遍历 jsx 的结果了
    // CAUTION refHandles 也要向上传递是因为在 DOM 中没有监听 detach 的方法，我们只能依赖外部框架的生命周期来处理。
    const containerElement = container as ExtendedElement
    if (unhandledChildren.length) containerElement.unhandledChildren = unhandledChildren
    if (unhandledAttr) containerElement.unhandledAttr = unhandledAttr
    if (refHandles.length) containerElement.refHandles = refHandles
    if (detachStyledChildren.length) containerElement.detachStyledChildren = detachStyledChildren

    return container
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

    if (typeof value !== 'object' && typeof value !== 'function') return true
    // 事件 允许是函数
    if ((name[0] === 'o' && name[1] === 'n') && typeof value === 'function') return true
    if ((isSimpleStyleObject(value) || typeof value === 'string') && name === 'style') return true
    // 默认支持 className 的对象形式
    if (isPlainObject(value) && name === 'className') return true

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
    } else {
        assert(false, 'ref should be function or object with current property')
    }
}

/**
 * @category Basic
 */
export function Fragment() {
}

function resetOptionParentSelectValue(targetOption: HTMLElement) {
    const target = targetOption.parentElement
    if (selectValueTmp.has(target as ExtendedElement)) {
        (target as HTMLDataElement).value = selectValueTmp.get(target as ExtendedElement)
    }
}
/**
 * @internal
 */
export function insertBefore(newEl: Comment | HTMLElement | DocumentFragment | SVGElement | Text, refEl: HTMLElement | Comment | Text | SVGElement) {
    // CAUTION 这里用 parentNode.insertBefore ，因为 parent 可能是 DocumentFragment，只能用 parentNode 读
    const result = refEl.parentNode!.insertBefore!(newEl, refEl)
    if ((newEl as Element).tagName === 'OPTION') {
        resetOptionParentSelectValue(newEl as HTMLElement)
    }

    return result
}

export function createElementNS(type: string, props: AttributesArg, ...children: any[]) {
    return createElement(type, {_isSVG: true, ...(props || {})}, children)
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
    constructor(public value: number|string, public unit: Unit|'mixed' = 'px') {
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
    return createElement(type, rawProps, children)
}

export function jsx(type: JSXElementType, {children, ...rawProps}: AttributesArg): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    return createElement(type, rawProps, [children])
}