/**
 * @category Event Utility
 */
export function eventAlias<T extends Event>(match: (e:T)=>boolean) {
    return (handle: (e:T) => any) => {
        return (e: T) => {
            if (match(e)) {
                return handle(e)
            }
        }
    }
}

/**
 * @category Event Utility
 */
export const onUpKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowUp')
/**
 * @category Event Utility
 */
export const onDownKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowDown')
/**
 * @category Event Utility
 */
export const onLeftKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowLeft')
/**
 * @category Event Utility
 */
export const onRightKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowRight')
/**
 * @category Event Utility
 */
export const onEnterKey = eventAlias((e: KeyboardEvent) => e.key === 'Enter')
/**
 * @category Event Utility
 */
export const onTabKey = eventAlias((e: KeyboardEvent) => e.key === 'Tab')
/**
 * @category Event Utility
 */
export const onESCKey = eventAlias((e: KeyboardEvent) => e.key === 'Escape')
/**
 * @category Event Utility
 */
export const onBackspaceKey = eventAlias((e: KeyboardEvent) => e.key === 'Backspace')
/**
 * @category Event Utility
 */
export const onSpaceKey = eventAlias((e: KeyboardEvent) => e.key === 'Space')
/**
 * @category Event Utility
 */
export const onLeftMouseDown = eventAlias((e: MouseEvent) => e.button === 0)
/**
 * @category Event Utility
 */
export const onRightMouseDown = eventAlias((e: MouseEvent) => e.button === 2)
/**
 * @category Event Utility
 */
export const onMiddleMouseDown = eventAlias((e: MouseEvent) => e.button === 1)

/**
 * @category Event Utility
 */
export type onKeyConfig = {
    meta?: boolean,
    ctrl?: boolean,
    alt?: boolean,
    shift?: boolean
}
/**
 * @category Event Utility
 */
export const onKey = (key:string, config?: onKeyConfig) => eventAlias((e: KeyboardEvent) => {
    if (config?.meta && !e.metaKey) return false
    if (config?.ctrl && !e.ctrlKey) return false
    if (config?.alt && !e.altKey) return false
    if (config?.shift && !e.shiftKey) return false
    return e.key === key
})
/**
 * @category Event Utility
 */
export const onSelf = eventAlias(e => e.target === e.currentTarget)

/**
 * @category Event Utility
 */
export function createEventTransfer(transform?: (e: Event) => Event|null|undefined ){
    let targetRef: HTMLElement|undefined
    function target(el: HTMLElement) {
        /* v8 ignore next 3 */
        if (targetRef !== undefined) {
            throw new Error('event transfer can only have one target')
        }
        targetRef = el
    }

    function source(sourceEvent: Event) {
        if (targetRef) {

            let targetEvent = transform ? transform(sourceEvent) : sourceEvent
            if (targetEvent === sourceEvent) {
                // TODO 如何 clone 各种不同的 event ? 这里的暴力方式是否ok
                const EventConstructor = sourceEvent.constructor as typeof Event
                targetEvent = new EventConstructor(sourceEvent.type, sourceEvent)
            }

            if (targetEvent) targetRef.dispatchEvent(targetEvent)
            /* v8 ignore next 3 */
        } else {
            console.warn('target is not ready')
        }
    }

    return {
        source,
        target
    }
}
/**
 * @category Event Utility
 */
export function withCurrentRange<T extends Event>(handle: (e: T, range: Range|undefined) => any) {
    return (e: T) => {
        const range = (document.getSelection() && document.getSelection()!.rangeCount > 0) ? document.getSelection()?.getRangeAt(0) : undefined
        handle(e, range)
    }
}
/**
 * @category Event Utility
 */
export function withPreventDefault<T extends Event>(handle: (e: T) => any) {
    return (e: T) => {
        e.preventDefault()
        handle(e)
    }
}
/**
 * @category Event Utility
 */
export function withStopPropagation<T extends Event>(handle: (e: T) => any) {
    return (e: T) => {
        e.stopPropagation()
        handle(e)
    }
}
