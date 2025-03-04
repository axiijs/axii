import {atom, Atom, ManualCleanup} from "data0";
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
type ReactivePositionOptions = 'requestAnimationFrame' | 'requestIdleCallback' | 'manual' | PositionRecalculateInterval |PositionRecalculateEvent[]

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
                const rect = {
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
                this.options.forEach(event => {
                    const listener = () => assignRect()
                    event.target.current.addEventListener(event.event, listener, {signal: abortController.signal})
                })

                this.abort = () => {
                    this.value(null)
                    abortController.abort()
                }
            /* v8 ignore next 16 */
            } else if (this.options === 'requestAnimationFrame') {
                const id = window.requestAnimationFrame(assignRect)
                this.abort = () => {
                    this.value(null)
                    window.cancelAnimationFrame(id)
                }
            } else if (this.options === 'requestIdleCallback') {
                const id = window.requestIdleCallback(assignRect)
                this.abort = () => {
                    this.value(null)
                    window.cancelIdleCallback(id)
                }
            } else if((this.options as PositionRecalculateInterval).type === 'interval') {
                const id = window.setInterval(assignRect, (this.options as PositionRecalculateInterval).duration || 1000)
                this.abort = () => {
                    this.value(null)
                    window.clearInterval(id)
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
    static resizeTargetToState= new WeakMap<HTMLElement, Atom<SizeObject|null>>()
    static globalResizeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
            const target = entry.target as HTMLElement
            const state = RxDOMSize.resizeTargetToState.get(target)
            if (state) {
                // 覆盖了 position 信息
                const newSizeObject = {
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                    borderBoxWidth: entry.borderBoxSize[0].inlineSize,
                    borderBoxHeight: entry.borderBoxSize[0].blockSize,
                    contentBoxWidth: entry.contentBoxSize[0].inlineSize,
                    contentBoxHeight: entry.contentBoxSize[0].blockSize,

                }

                if(!shallowEqual(newSizeObject, state())) {
                    state( newSizeObject)
                }
            }
        })
    })
    listen() {
        if (this.element === window) {
            const assignRect = () => {
                const rect = {
                    width: window.innerWidth,
                    height: window.innerHeight
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
            RxDOMSize.globalResizeObserver.observe(this.element as HTMLElement)
            RxDOMSize.resizeTargetToState.set(this.element as HTMLElement, this.value)
            // observe 的时候就会不会触发一次，所以这里手动触发一次
            const rect = (this.element as HTMLElement).getBoundingClientRect()
            this.value({
                width: rect.width,
                height: rect.height
            })

            this.abort =  (element) => {
                RxDOMSize.globalResizeObserver.unobserve(element as HTMLElement)
                RxDOMSize.resizeTargetToState.delete(element as HTMLElement)
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



type ListenerTarget = Pick<HTMLElement, 'addEventListener' | 'removeEventListener'|'dispatchEvent'>

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
    public eventBus: ListenerTarget;
    public addEventListener: ListenerTarget['addEventListener']
    public removeEventListener: ListenerTarget['removeEventListener']
    /* v8 ignore next 43 */
    constructor(public value: Atom<DragState|null> = atom(null), public options: DragOptions = {}) {
        super();
        this.container = options.container
        this.boundary = options.boundary || {current: document.body}
        this.eventBus = new Comment('bus')
        this.addEventListener = this.eventBus.addEventListener.bind(this.eventBus)
        this.removeEventListener = this.eventBus.removeEventListener.bind(this.eventBus)
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


export class RxDOMEventListener extends ManualCleanup {
    constructor(public target: ListenerTarget, public event: string, public listener: EventListener, public options?: AddEventListenerOptions) {
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
