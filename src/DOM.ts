/// <reference lib="dom" />
import {assert, each, isPlainObject, shallowEqual} from './util'
import {Component, ComponentNode} from "./types";

export const AUTO_ADD_PX_STYLE = /^(width|height|top|left|right|bottom|margin|padding|border|fontSize|maxWidth|maxHeight|minHeight|minWidth|gap)/

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
        [k: string]: (e: Event) => any
    },
    _captureListeners?: {
        [k: string]: (e: Event) => any
    }
    unhandledChildren?: UnhandledChildInfo[]
    unhandledAttr?: UnhandledAttrInfo[]
    refHandles?: RefHandleInfo[]
    rectRefHandles?: RectRefHandleInfo[]
}

function eventProxy(this: ExtendedElement, e: Event) {
    const listener = this._listeners![e.type]
    return Array.isArray(listener) ? listener.forEach(l => l?.(e)) : listener?.(e)
}

function captureEventProxy(this: ExtendedElement, e: Event) {
    const listener = this._captureListeners![e.type]
    return Array.isArray(listener) ? listener.forEach(l => l?.(e)) : listener?.(e)
}

export type UnhandledPlaceholder = Comment

const selectValueTmp = new WeakMap<ExtendedElement, any>()


function isEventName(name: string) {
    return name[0] === 'o' && name[1] === 'n'
}


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
            if (typeof style !== 'object') assert(false, 'style can only be object, string style is deprecated')
            each(style, (v, k) => {
                if (v === undefined) {
                    // @ts-ignore
                    node.style[k] = ''
                } else {
                    // @ts-ignore
                    node.style[k] = typeof v === 'number' && AUTO_ADD_PX_STYLE.test(k) ? (`${v}px`) : v
                }
            })
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
            node.setAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase(), value)

        } else {
            node.setAttribute(name, value)
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
    handle: RefFn | RefObject,
    path: number[]
}

type PositionRecalculateEvent = {
    target: HTMLElement,
    event: string
}

type PositionRecalculateInterval = {
    type: 'interval',
    duration: number
}

export type RectRefObject = {
    current: null | RectInfo,
    options: {
        size?: boolean,
        position?: 'requestAnimationFrame' | 'requestIdleCallback' | 'manual' | PositionRecalculateInterval |PositionRecalculateEvent[],
    }
    sync?: () => void
}

export type RectRefHandleInfo = {
    element: HTMLElement
    handle: RectRefObject,
    path: number[]
}

export type RectInfo = {
    top: number,
    left: number,
    right: number,
    bottom: number,
    width: number,
    height: number
}

// 这里的返回类型要和 global.d.ts 中的 JSX.Element 类型一致
export function createElement(type: JSXElementType, rawProps: AttributesArg, ...children: any[]): ComponentNode | HTMLElement | DocumentFragment | SVGElement {
    const {_isSVG, ...props} = rawProps || {}

    let container: HTMLElement | DocumentFragment | SVGElement

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
    const rectRefHandles: RectRefHandleInfo[] = []

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

            const childRectRefHandles = childElement.rectRefHandles || []
            rectRefHandles.push(...childRectRefHandles.map(c => ({...c, path: [index, ...c.path]})))

            delete childElement.unhandledChildren
            delete childElement.unhandledAttr
            delete childElement.refHandles
            delete childElement.rectRefHandles

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
            createElement.attachRef(container as HTMLElement, props.ref)
            refHandles.push({handle: props.ref, path: []})
            delete props.ref
        }

        if (props.rectRef) {
            // TODO 应该移到外部去？？？只有在 attach 之后才能 attachRectRef，不然是没有 rect 的。
            createElement.attachRectRef(container as HTMLElement, props.rectRef)
            rectRefHandles.push({element: container as HTMLElement, handle: props.rectRef, path: []})
            delete props.rectRef
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
    if (rectRefHandles.length) containerElement.rectRefHandles = rectRefHandles

    return container
}


function isSimpleStyleObject(value: any) {
    return isPlainObject(value) && Object.entries(value).every(([k, v]) => /[a-zA-Z\-]+/.test(k) && typeof v === 'string' || typeof v === 'number')
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
    // 事件
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
    } else if (typeof ref === 'object' && ref.hasOwnProperty('current')) {
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
    } else if (typeof ref === 'object' && ref.hasOwnProperty('current')) {
        ref.current = null
    }
}


const resizeTargetToRectRef = new WeakMap<HTMLElement, RectRefObject>()
const globalResizeObserver = new ResizeObserver(entries => {
    entries.forEach(entry => {
        const target = entry.target as HTMLElement
        const rectRef = resizeTargetToRectRef.get(target)
        if (rectRef) {
            // 覆盖了 position 信息
            const originLeft = rectRef.current?.left || 0
            const originTop = rectRef.current?.top || 0
            const newRect = {
                top: originTop,
                left: originLeft,
                right: originLeft + entry.contentRect.width,
                bottom: originTop + entry.contentRect.height,
                width: entry.contentRect.width,
                height: entry.contentRect.height
            }

            if(!shallowEqual(newRect, rectRef.current)) {
                rectRef.current = newRect
            }
        }
    })
})


const positionRecalculateEventTargetToListener = new WeakMap<HTMLElement, (e: Event) => any>()
const positionRecalculateRequestAnimationFrameRefToIds = new WeakMap<HTMLElement, number>()
const positionRecalculateRequestIdleCallbackRefToIds = new WeakMap<HTMLElement, number>()
const positionRecalculateIntervalRefToIds = new WeakMap<HTMLElement, number>()
const windowResizeRefToListener = new WeakMap<RectRefObject, () => any>()
createElement.attachRectRef = function (elOrWindow: HTMLElement|Window, ref: RectRefObject) {
    if (elOrWindow === window) {
        // TODO window 的 resizeObserver
        const assignRect = () => {
            const rect = {
                top: 0,
                left: 0,
                right: window.innerWidth,
                bottom: window.innerHeight,
                width: window.innerWidth,
                height: window.innerHeight
            }
            if(!shallowEqual(rect, ref.current)) {
                ref.current = rect
            }
            return rect
        }
        if (ref.options.size) {
            const listener = () => assignRect()
            windowResizeRefToListener.set(ref, listener)
            window.addEventListener('resize', listener)
        }
        // position 永远不会变
        if (ref.options.position) {
            ref.sync = assignRect
        }

        assignRect()
        return
    }

    const el = elOrWindow as HTMLElement

    const assignRect = () => {
        const boundingRect = el.getBoundingClientRect()
        const rect = {
            top: boundingRect.top,
            left: boundingRect.left,
            right: boundingRect.right,
            bottom: boundingRect.bottom,
            width: boundingRect.width,
            height: boundingRect.height
        }
        if(!shallowEqual(rect, ref.current)) {
            ref.current = rect
        }
        return rect
    }

    if (ref.options.size) {
        globalResizeObserver.observe(el)
        resizeTargetToRectRef.set(el, ref)
    }

    if (ref.options.position) {
        if (Array.isArray(ref.options.position)) {
            ref.options.position.forEach(event => {
                const listener = () => assignRect()
                event.target.addEventListener(event.event, listener)
                positionRecalculateEventTargetToListener.set(event.target, listener)
            })
        } else if (ref.options.position === 'requestAnimationFrame') {
            const id = window.requestAnimationFrame(assignRect)
            positionRecalculateRequestAnimationFrameRefToIds.set(el, id)
        } else if (ref.options.position === 'requestIdleCallback') {
            const id = window.requestIdleCallback(assignRect)
            positionRecalculateRequestIdleCallbackRefToIds.set(el, id)
        } else if((ref.options.position as PositionRecalculateInterval).type === 'interval') {
            const id = window.setInterval(assignRect, (ref.options.position as PositionRecalculateInterval).duration || 1000)
            positionRecalculateIntervalRefToIds.set(el, id)
        } else {
            // 手动同步
            ref.sync = assignRect
        }
    }

    assignRect()
}

createElement.detachRectRef = function (el: HTMLElement, rectRef: RectRefObject) {
    if (rectRef.options.size) {
        globalResizeObserver.unobserve(el)
        resizeTargetToRectRef.delete(el)
    }

    if (rectRef.options.position) {
        if (Array.isArray(rectRef.options.position)) {
            rectRef.options.position.forEach(event => {
                event.target.removeEventListener(event.event, positionRecalculateEventTargetToListener.get(event.target)!)
            })
        } else if (rectRef.options.position === 'requestAnimationFrame') {
            window.cancelAnimationFrame(positionRecalculateRequestAnimationFrameRefToIds.get(el)!)
        } else if (rectRef.options.position === 'requestIdleCallback') {
            window.cancelIdleCallback(positionRecalculateRequestIdleCallbackRefToIds.get(el)!)
        } else if((rectRef.options.position as PositionRecalculateInterval).type === 'interval'){
            window.clearInterval(positionRecalculateIntervalRefToIds.get(el)!)
        } else {
            delete rectRef.sync
        }
    }

    rectRef.current = null
}

createElement.isElementRectObserved = function (el: HTMLElement) {
    return resizeTargetToRectRef.has(el) || positionRecalculateEventTargetToListener.has(el) || positionRecalculateRequestAnimationFrameRefToIds.has(el) || positionRecalculateRequestIdleCallbackRefToIds.has(el)
}


export function Fragment() {
}

function resetOptionParentSelectValue(targetOption: HTMLElement) {
    const target = targetOption.parentElement
    if (selectValueTmp.has(target as ExtendedElement)) {
        (target as HTMLDataElement).value = selectValueTmp.get(target as ExtendedElement)
    }
}

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

export function dispatchEvent(target: ExtendedElement, event: Event) {
    return eventProxy.call(target, event)
}