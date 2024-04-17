import {Atom} from "data0";
import {shallowEqual, assert} from "./util.js";

export const ModalContext = Symbol('ModalContext')


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

export function reactivePosition(elOrWindow: HTMLElement|Window, value: Atom<PositionObject|null>, options: ReactivePositionOptions ) {
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




export type SizeObject = {
    width: number
    height: number
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
                height: entry.contentRect.height
            }

            if(!shallowEqual(newSizeObject, state())) {
                state( newSizeObject)
            }
        }
    })
})


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

