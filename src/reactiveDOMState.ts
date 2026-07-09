import {atom, Atom, autorun, ManualCleanup} from "data0";
import {assert, shallowEqual} from "./util";
import {RefObject} from "./DOM";


/**
 * @category Reactive State Utility
 */
export class RxDOMState<T, U> extends ManualCleanup{
    public abort?: (originEl:T|null) => void
    public element: T|null = null
    constructor(public value: Atom<U|null> = atom(null)) {
        super();
    }
    /* v8 ignore next 3 */
    listen() {
        assert(false,'should overwrite listen method')
    }
    unlisten(originEl: T|null) {
        this.abort?.(originEl)
        this.abort = undefined
    }
    ref = (el: T|null) => {
        const originEl = this.element
        this.element = el
        if (this.element) {
            // CAUTION ref 直接从一个元素切到另一个元素（中间没有 null）时，
            //  必须先解绑旧元素：否则旧的 abort 被新的 listen 覆盖，
            //  旧元素上的监听/observer 永久泄漏（RxDOMSize 还会继续把旧元素的
            //  尺寸变化写进同一个 value atom）。
            if (originEl && originEl !== this.element) {
                this.unlisten(originEl)
            }
            this.listen()
        } else {
            this.unlisten(originEl)
        }
    }
    destroy() {
        super.destroy();
        this.unlisten(this.element)
    }
}

/**
 * @category Reactive State Utility
 */
export type RectObject = {
    top: number,
    left: number,
    right: number,
    bottom: number,
    width: number,
    height: number,
    x: number,
    y:number
}

/**
 * @category Reactive State Utility
 */
type PositionRecalculateEvent = {
    target: RefObject,
    event: string
}

/**
 * @category Reactive State Utility
 */
type PositionRecalculateInterval = {
    type: 'interval',
    duration: number
}

/**
 * @category Reactive State Utility
 */
type PositionRecalculateSignal = {
    type: 'signal',
    signal: Atom<any>
}

/**
 * @category Reactive State Utility
 */
type ReactivePositionOptions = 'requestAnimationFrame' | 'requestIdleCallback' | 'manual' | PositionRecalculateInterval |PositionRecalculateEvent[] | PositionRecalculateSignal

/**
 * @category Reactive State Utility
 */
export class RxDOMRect extends RxDOMState<HTMLElement|Window, RectObject>{
    constructor(public value: Atom<RectObject|null>, public options: ReactivePositionOptions) {
        super(value);
    }
    listen() {
        if (this.element instanceof Window) {
            const assignRect = () => {
                // CAUTION 保持与 RectObject 类型一致的完整形状（viewport 的 top/left/x/y 恒为 0），
                //  否则消费方读 rect.top 会拿到 undefined
                const rect = {
                    top: 0,
                    left: 0,
                    x: 0,
                    y: 0,
                    right: window.innerWidth,
                    bottom: window.innerHeight,
                    width: window.innerWidth,
                    height: window.innerHeight
                }
                if(!shallowEqual(rect, this.value())) {
                    this.value(rect)
                }
                return rect
            }

            window.addEventListener('resize', assignRect)
            this.abort = () => {
                this.value(null)
                window.removeEventListener('resize', assignRect)
            }

            assignRect()
        } else {
            const element = this.element as HTMLElement|null
            const assignRect = () => {
                const boundingRect = element?.getBoundingClientRect()
                const rect = {
                    top: boundingRect?.top,
                    left: boundingRect?.left,
                    right: boundingRect?.right,
                    bottom: boundingRect?.bottom,
                    width: boundingRect?.width,
                    height: boundingRect?.height,
                    x: boundingRect?.x,
                    y: boundingRect?.y
                }
                if(!shallowEqual(rect, this.value())) {
                    this.value(rect)
                }
                return rect
            }

            assignRect()

            if (Array.isArray(this.options)) {
                const abortController = new AbortController()
                const listener = () => assignRect()
                this.options.forEach(event => {
                    // CAUTION 重算目标（滚动容器等）的 ref 此刻可能还没挂上：refs 按文档顺序
                    //  attach，目标元素排在被测元素之后是自然写法。直接读 current 会 TypeError，
                    //  整个渲染崩溃。ref 的附加在同一个同步任务内完成（flushAttachQueue），
                    //  延迟到微任务再绑定即可；届时仍未挂载（目标从未渲染）就没有可监听的对象，跳过。
                    const target = event.target.current
                    if (target) {
                        target.addEventListener(event.event, listener, {signal: abortController.signal})
                    } else {
                        queueMicrotask(() => {
                            if (abortController.signal.aborted) return
                            event.target.current?.addEventListener(event.event, listener, {signal: abortController.signal})
                        })
                    }
                })

                this.abort = () => {
                    this.value(null)
                    abortController.abort()
                }
            } else if (this.options === 'requestAnimationFrame') {
                // CAUTION 必须在回调里重新调度形成循环，只调度一次的话位置只会更新一帧就停止跟踪
                let stopped = false
                let id: number
                const loop = () => {
                    assignRect()
                    if (!stopped) id = window.requestAnimationFrame(loop)
                }
                id = window.requestAnimationFrame(loop)
                this.abort = () => {
                    stopped = true
                    this.value(null)
                    window.cancelAnimationFrame(id)
                }
            /* v8 ignore next 15 */
            } else if (this.options === 'requestIdleCallback') {
                let stopped = false
                let id: number
                const loop = () => {
                    assignRect()
                    if (!stopped) id = window.requestIdleCallback(loop)
                }
                id = window.requestIdleCallback(loop)
                this.abort = () => {
                    stopped = true
                    this.value(null)
                    window.cancelIdleCallback(id)
                }
            } else if((this.options as PositionRecalculateInterval).type === 'interval') {
                const id = window.setInterval(assignRect, (this.options as PositionRecalculateInterval).duration || 1000)
                this.abort = () => {
                    this.value(null)
                    window.clearInterval(id)
                }
            }else if((this.options as PositionRecalculateSignal).type === 'signal') {

                const stop = autorun(() => {
                    const shouldrun = (this.options as PositionRecalculateSignal).signal()
                    if (shouldrun) {
                        assignRect()
                    }
                })
                this.abort = () => {
                    this.value(null)
                    stop()
                }
            } else if (this.options === 'manual') {
                // 只取一次初始值（上面的 assignRect() 已执行），由外部自行决定何时重算
                this.abort = () => {
                    this.value(null)
                }
            /* v8 ignore next 3 */
            } else {
                assert(false, `invalid options.position, ${this.options}`)
            }
        }
    }
}
/**
 * @category Reactive State Utility
 */
export type SizeObject = {
    width: number
    height: number,
    borderBoxWidth: number,
    borderBoxHeight: number,
    contentBoxWidth: number,
    contentBoxHeight: number,
}
/**
 * @category Reactive State Utility
 */
export class RxDOMSize extends RxDOMState<HTMLElement|Window, SizeObject>{
    // CAUTION 同一个元素上可能同时存在多个 RxDOMSize（不同组件各自观察），
    //  必须是集合而不是单值槽，否则后注册的覆盖先注册的、任一注销会打死其余的。
    static resizeTargetToStates = new WeakMap<HTMLElement, Set<Atom<SizeObject|null>>>()
    // CAUTION ResizeObserver 是浏览器 API，必须惰性初始化。
    //  如果在类定义（模块加载）时就 new，Node/SSR 等非浏览器环境 import 框架入口会直接崩溃。
    static _globalResizeObserver?: ResizeObserver
    static get globalResizeObserver(): ResizeObserver {
        if (!RxDOMSize._globalResizeObserver) {
            RxDOMSize._globalResizeObserver = new ResizeObserver(entries => {
                entries.forEach(entry => {
                    const target = entry.target as HTMLElement
                    const states = RxDOMSize.resizeTargetToStates.get(target)
                    if (states) {
                        // 覆盖了 position 信息
                        const newSizeObject = {
                            width: entry.contentRect.width,
                            height: entry.contentRect.height,
                            borderBoxWidth: entry.borderBoxSize[0].inlineSize,
                            borderBoxHeight: entry.borderBoxSize[0].blockSize,
                            contentBoxWidth: entry.contentBoxSize[0].inlineSize,
                            contentBoxHeight: entry.contentBoxSize[0].blockSize,

                        }

                        states.forEach(state => {
                            if(!shallowEqual(newSizeObject, state())) {
                                state( newSizeObject)
                            }
                        })
                    }
                })
            })
        }
        return RxDOMSize._globalResizeObserver
    }
    listen() {
        if (this.element === window) {
            const assignRect = () => {
                // viewport 没有 border/padding，各 box 尺寸相同；保持 SizeObject 的完整形状
                const rect = {
                    width: window.innerWidth,
                    height: window.innerHeight,
                    borderBoxWidth: window.innerWidth,
                    borderBoxHeight: window.innerHeight,
                    contentBoxWidth: window.innerWidth,
                    contentBoxHeight: window.innerHeight
                }
                if(!shallowEqual(rect, this.value.raw)) {
                    this.value(rect)
                }
                return rect
            }

            window.addEventListener('resize', assignRect)
            assignRect()
            this.abort = () => {
                this.value(null)
                window.removeEventListener('resize', assignRect)
            }

        } else {
            const element = this.element as HTMLElement
            let states = RxDOMSize.resizeTargetToStates.get(element)
            if (!states) {
                states = new Set()
                RxDOMSize.resizeTargetToStates.set(element, states)
                RxDOMSize.globalResizeObserver.observe(element)
            }
            states.add(this.value)
            // CAUTION ResizeObserver 对 observe 的首次回调是异步的，这里同步给出一份
            //  与 SizeObject 类型形状一致的初始值（含 borderBox/contentBox 字段）。
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            const horizontalExtra = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0) +
                (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
            const verticalExtra = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0) +
                (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
            const contentBoxWidth = Math.max(0, rect.width - horizontalExtra)
            const contentBoxHeight = Math.max(0, rect.height - verticalExtra)
            this.value({
                // 与 ResizeObserver 的 contentRect 语义一致：width/height 是 content box
                width: contentBoxWidth,
                height: contentBoxHeight,
                borderBoxWidth: rect.width,
                borderBoxHeight: rect.height,
                contentBoxWidth,
                contentBoxHeight
            })

            this.abort =  (originEl) => {
                const el = originEl as HTMLElement
                const elStates = RxDOMSize.resizeTargetToStates.get(el)
                if (elStates) {
                    elStates.delete(this.value)
                    if (!elStates.size) {
                        RxDOMSize.globalResizeObserver.unobserve(el)
                        RxDOMSize.resizeTargetToStates.delete(el)
                    }
                }
                this.value(null)
            }
        }
    }
}


/**
 * @category Reactive State Utility
 */
export class RxDOMFocused extends RxDOMState<HTMLElement, boolean>{
    constructor(public value: Atom<boolean> = atom(false)) {
        super();
    }
    listen() {
        const abortController = new AbortController()

        if (document.activeElement === this.element || this.element!.contains(document.activeElement)) {
            this.value(true)
        }

        this.element!.addEventListener('focusin', () => this.value(true), {signal: abortController.signal})
        this.element!.addEventListener('focusout', () => this.value(false), {signal: abortController.signal})
        this.abort = () => {
            this.value(null)
            abortController.abort()
        }
    }
}
/**
 * @category Reactive State Utility
 */
export class RxDOMHovered extends RxDOMState<HTMLElement, boolean>{
    constructor() {
        super();
    }
    listen() {
        const abortController = new AbortController()

        if (this.element?.matches(':hover')) {
            this.value(true)
        }

        this.element?.addEventListener('mouseenter', () => this.value(true), {signal: abortController.signal})
        this.element?.addEventListener('mouseleave', () => this.value(false), {signal: abortController.signal})
        this.abort = () => {
            this.value(null)
            abortController.abort()
        }
    }
}

/**
 * @category Reactive State Utility
 */
export type ScrollPosition = {
    scrollTop: number
    scrollLeft: number
    scrollWidth: number
    scrollHeight: number
}
/**
 * @category Reactive State Utility
 */
export class RxDOMScrollPosition extends RxDOMState<HTMLElement, ScrollPosition>{
    listen() {
        const element = this.element as HTMLElement
        const assignRect = () => {
            const rect = {
                scrollTop: element.scrollTop,
                scrollLeft: element.scrollLeft,
                scrollWidth: element.scrollWidth,
                scrollHeight: element.scrollHeight
            }
            if(!shallowEqual(rect, this.value())) {
                this.value(rect)
            }
            return rect
        }
        const abortController = new AbortController()
        element.addEventListener('scroll', assignRect, {signal: abortController.signal})
        this.abort = () => {
            this.value(null)
            abortController.abort()
        }

        assignRect()
    }
}



type ListenerTarget<T> = {
    addEventListener: (type: string, listener: (event: T) => void, options?: AddEventListenerOptions) => void
    removeEventListener: (type: string, listener: (event: T) => void, options?: EventListenerOptions) => void
}

/**
 * @category Reactive State Utility
 */
export type DragState = {
    containerRect?: DOMRect,
    startX: number,
    startY: number,
    clientX: number,
    clientY: number,
    mouseDownEvent: MouseEvent,
    mouseMoveEvent: MouseEvent
}


export type DragOptions = {
    container?: RefObject,
    boundary?: RefObject,
}

/**
 * @category Reactive State Utility
 */
export class RxDOMDragState extends RxDOMState<HTMLElement, DragState>{
    public container: RefObject | undefined;
    public boundary: RefObject;
    public eventBus = (new Comment('bus')) as unknown as ListenerTarget<CustomEvent<DragState>> & {dispatchEvent: (event: Event) => void}
    public addEventListener = this.eventBus.addEventListener.bind(this.eventBus)
    public removeEventListener = this.eventBus.removeEventListener.bind(this.eventBus)
    /* v8 ignore next 43 */
    constructor(public value: Atom<DragState|null> = atom(null), public options: DragOptions = {}) {
        super();
        this.container = options.container
        this.boundary = options.boundary || {current: document.body}
    }
    listen() {
        const abortController = new AbortController()
        this.element!.addEventListener('mousedown', (mouseDownEvent:MouseEvent) => {
            const containerRect = this.container?.current?.getBoundingClientRect()
            const targetRect = this.element!.getBoundingClientRect()

            const innerAbortController = new AbortController()

            let started = false

            this.boundary.current.addEventListener('mousemove', (mouseMoveEvent: MouseEvent) => {
                this.value({
                    containerRect,
                    startX: mouseDownEvent.clientX - targetRect.left,
                    startY: mouseDownEvent.clientY - targetRect.top,
                    clientX: mouseMoveEvent.clientX,
                    clientY: mouseMoveEvent.clientY,
                    mouseDownEvent,
                    mouseMoveEvent
                })

                if (!started) {
                    started = true
                    this.eventBus.dispatchEvent(new CustomEvent('dragstart', {detail: this.value.raw}))
                }
            }, {signal: innerAbortController.signal})

            const dragEnd = () => {
                const lastState = this.value()!
                this.value(null)
                innerAbortController!.abort()
                this.eventBus.dispatchEvent(new CustomEvent('dragend', {detail: lastState}))
            }

            this.boundary.current.addEventListener('mouseup', dragEnd, {signal: innerAbortController.signal})

            this.boundary.current.addEventListener('mouseleave', dragEnd, { signal: innerAbortController.signal})

            window.addEventListener('blur', dragEnd, { signal: innerAbortController.signal})

        }, {signal: abortController.signal})

        this.abort = () => {
            this.value(null)
            abortController.abort()
        }
    }
}


export class RxDOMEventListener<T> extends ManualCleanup {
    constructor(public target: ListenerTarget<T>, public event: string, public listener: (event: T) => void, public options?: AddEventListenerOptions) {
        super();
        this.target.addEventListener(event, listener, options)
    }
    destroy() {
        this.target.removeEventListener(this.event, this.listener, this.options)
    }
}


/**
 * @category Common Utility
 */
export const ModalContext = Symbol('ModalContext')
