import {Atom} from "data0";
import {shallowEqual, assert} from "./util.js";

/**
 * @category Common Utility
 */
export const ModalContext = Symbol('ModalContext')
/**
 * @category Reactive State Utility
 */
export type PositionObject = {
    top: number
    left: number
    right: number
    bottom: number
}


type PositionRecalculateEvent = {
    target: HTMLElement,
    event: string
}

type PositionRecalculateInterval = {
    type: 'interval',
    duration: number
}

type ReactivePositionOptions = 'requestAnimationFrame' | 'requestIdleCallback' | 'manual' | PositionRecalculateInterval |PositionRecalculateEvent[]

/**
 * @category Reactive State Utility
 */
export function createReactivePosition(options: ReactivePositionOptions) {
    return (elOrWindow: HTMLElement|Window, value: Atom<PositionObject|null>, ) => {
        if (elOrWindow === window) {
            const assignRect = () => {
                const rect = {
                    right: window.innerWidth,
                    bottom: window.innerHeight,
                    width: window.innerWidth,
                    height: window.innerHeight
                }
                if(!shallowEqual(rect, value())) {
                    value(rect)
                }
                return rect
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
            }
            if(!shallowEqual(rect, value())) {
                value(rect)
            }
            return rect
        }

        if (Array.isArray(options)) {
            const unlisten:Array<() => any>= []
            options.forEach(event => {
                const listener = () => assignRect()
                event.target.addEventListener(event.event, listener)
                unlisten.push(() => event.target.removeEventListener(event.event, listener))
            })

            return () => {
                unlisten.forEach(fn => fn())
            }

        } else if (options === 'requestAnimationFrame') {
            const id = window.requestAnimationFrame(assignRect)
            return () => {
                window.cancelAnimationFrame(id)
            }
        } else if (options === 'requestIdleCallback') {
            const id = window.requestIdleCallback(assignRect)
            return () => {
                window.cancelIdleCallback(id)
            }
        } else if((options as PositionRecalculateInterval).type === 'interval') {
            const id = window.setInterval(assignRect, (options as PositionRecalculateInterval).duration || 1000)
            return () => {
                window.clearInterval(id)
            }
        } else {
            assert(false, 'invalid options.position')
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
const resizeTargetToState = new WeakMap<HTMLElement, Atom<SizeObject|null>>()
const globalResizeObserver = new ResizeObserver(entries => {
    entries.forEach(entry => {
        const target = entry.target as HTMLElement
        const state = resizeTargetToState.get(target)
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

/**
 * @category Reactive State Utility
 */
export function reactiveSize(target: HTMLElement|Window, value: Atom<SizeObject|null>) {
    if (target === window) {
        const assignRect = () => {
            const rect = {
                width: window.innerWidth,
                height: window.innerHeight
            }
            if(!shallowEqual(rect, value())) {
                value(rect)
            }
            return rect
        }

        window.addEventListener('resize', assignRect)
        assignRect()
        return () => {
            value(null)
            window.removeEventListener('resize', assignRect)
        }

    } else {
        globalResizeObserver.observe(target as HTMLElement)
        resizeTargetToState.set(target as HTMLElement, value)
        // observe 的时候就会不会触发一次，所以这里手动触发一次
        const rect = (target as HTMLElement).getBoundingClientRect()
        value({
            width: rect.width,
            height: rect.height
        })

        return () => {
            globalResizeObserver.unobserve(target as HTMLElement)
            resizeTargetToState.delete(target as HTMLElement)
            value(null)
        }
    }
}
/**
 * @category Reactive State Utility
 */
export function reactiveFocused(target:HTMLElement, value:Atom<boolean|null>) {
    const setToTrue = () => {
        value(true)
    }
    const setToFalse = () => {
        value(false)
    }
    target.addEventListener('focusin', setToTrue)
    target.addEventListener('focusout', setToFalse)
    return () => {
        target.removeEventListener('focusin', setToTrue)
        target.removeEventListener('focusout', setToFalse)
    }
}



export const DEFAULT_DRAG_MOVE_EVENT = 'dragmove'
export type DragMoveOptions = {
    container?: HTMLElement
    customEventName?: string
}
/**
 * @category Reactive State Utility
 */
export type DragMoveDetail = {
    clientX: number
    clientY: number
    deltaX: number
    deltaY: number
}

/**
 * @category Reactive State Utility
 */
export function createOnDragMove(options?: DragMoveOptions) {
    const container = options?.container || document.body
    const customEventName = options?.customEventName || DEFAULT_DRAG_MOVE_EVENT

    return function attachRef(ref: HTMLElement) {
        const mouseDownListener = (e: MouseEvent) => {
            const mouseStartX = e.clientX
            const mouseStartY = e.clientY
            let lastX = mouseStartX
            let lastY = mouseStartY

            const mouseMoveListener = (e: MouseEvent) => {
                const detail = {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    deltaXFromStart: e.clientX - mouseStartX,
                    deltaYFromStart: e.clientY - mouseStartY,
                    deltaX: e.clientX - lastX,
                    deltaY: e.clientY - lastY,
                }
                ref.dispatchEvent(new CustomEvent(customEventName, {detail}))
            }

            container.addEventListener('mousemove', mouseMoveListener)

            container.addEventListener('mouseup', () => {
                container.removeEventListener('mousemove', mouseMoveListener)
            }, {once: true})
        }

        ref.addEventListener('mousedown', mouseDownListener)

        return () => {
            ref.removeEventListener('mousedown', mouseDownListener)
        }
    }
}


/**
 * @category Reactive State Utility
 */
export type DragPosition = {
    clientX: number
    clientY: number,
    // x 偏移量
    offsetX: number,
    // y 偏移量
    offsetY: number
}
/**
 * @category Reactive State Utility
 */
export function createReactiveDragPosition(shouldRecord: Atom<any>) {
    return function reactiveDragPosition(ref: HTMLElement, position: Atom<DragPosition|null>) {
        const mouseDownListener = (mouseDownEvent: MouseEvent) => {
            if (!shouldRecord()) {
                return
            }

            const startPosition: DragPosition = {clientX: mouseDownEvent.clientX, offsetX:0, clientY: mouseDownEvent.clientY, offsetY: 0}

            const mouseMoveListener = (e: MouseEvent) => {
                position({
                    clientX: e.clientX,
                    clientY: e.clientY,
                    offsetX: e.clientX - startPosition.clientX,
                    offsetY: e.clientY - startPosition.clientY
                })
            }

            ref.addEventListener('mousemove', mouseMoveListener)

            document.addEventListener('mouseup', () => {
                position(null)
                ref.removeEventListener('mousemove', mouseMoveListener)
            }, {once: true})
        }

        ref.addEventListener('mousedown', mouseDownListener)

        return () => {
            ref.removeEventListener('mousedown', mouseDownListener)
        }
    }
}

/**
 * @category Reactive State Utility
 */
export function createReactiveDragTarget(getSnapshot: (ref: HTMLElement,) => any) {
    return function reactiveDragTarget(ref: HTMLElement, value: Atom<any>) {
        const mouseDownListener = (mouseDownEvent: MouseEvent) => {
            value(getSnapshot(ref))

            document.addEventListener('mouseup', () => {
                value(null)
            }, {once: true})
        }

        ref.addEventListener('mousedown', mouseDownListener)

        return () => {
            ref.removeEventListener('mousedown', mouseDownListener)
        }
    }
}

/**
 * @category Reactive State Utility
 */
export function reactiveMouseIn(ref: HTMLElement, value: Atom<boolean|null>) {
    const mouseEnterListener = () => {
        value(true)
    }
    const mouseLeaveListener = () => {
        value(false)
    }

    ref.addEventListener('mouseenter', mouseEnterListener)
    ref.addEventListener('mouseleave', mouseLeaveListener)

    return () => {
        ref.removeEventListener('mouseenter', mouseEnterListener)
        ref.removeEventListener('mouseleave', mouseLeaveListener)
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
export function reactiveScrollPosition(ref: HTMLElement, position: Atom<ScrollPosition|null>) {
    const scrollListener = () => {
        position({
            scrollTop: ref.scrollTop,
            scrollLeft: ref.scrollLeft,
            scrollWidth: ref.scrollWidth,
            scrollHeight: ref.scrollHeight
        })
    }
    ref.addEventListener('scroll', scrollListener)

    return () => {
        ref.removeEventListener('scroll', scrollListener)
    }
}
