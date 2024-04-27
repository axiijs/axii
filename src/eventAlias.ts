export function eventAlias<T extends Event>(match: (e:T)=>boolean) {
    return (handle: (e:T) => any) => {
        return (e: T) => {
            if (match(e)) {
                return handle(e)
            }
        }
    }
}

export const onUpKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowUp')
export const onDownKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowDown')
export const onLeftKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowLeft')
export const onRightKey = eventAlias((e: KeyboardEvent) => e.key === 'ArrowRight')
export const onEnterKey = eventAlias((e: KeyboardEvent) => e.key === 'Enter')
export const onTabKey = eventAlias((e: KeyboardEvent) => e.key === 'Tab')
export const onESCKey = eventAlias((e: KeyboardEvent) => e.key === 'Escape')
export const onBackspaceKey = eventAlias((e: KeyboardEvent) => e.key === 'Backspace')
export const onSpaceKey = eventAlias((e: KeyboardEvent) => e.key === 'Space')
export const onLeftMouseDown = eventAlias((e: MouseEvent) => e.button === 0)
export const onRightMouseDown = eventAlias((e: MouseEvent) => e.button === 2)
export const onMiddleMouseDown = eventAlias((e: MouseEvent) => e.button === 1)


export type onKeyConfig = {
    meta?: boolean,
    ctrl?: boolean,
    alt?: boolean,
    shift?: boolean
}
export const onKey = (key:string, config?: onKeyConfig) => eventAlias((e: KeyboardEvent) => {
    if (config?.meta && !e.metaKey) return false
    if (config?.ctrl && !e.ctrlKey) return false
    if (config?.alt && !e.altKey) return false
    if (config?.shift && !e.shiftKey) return false
    return e.key === key
})

export const onSelf = eventAlias(e => e.target === e.currentTarget)


export function createEventTransfer(transform?: (e: Event) => Event|null|undefined ){
    let targetRef: HTMLElement|undefined
    function target(el: HTMLElement) {
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
        } else {
            console.warn('target is not ready')
        }
    }

    return {
        source,
        target
    }
}

export function withCurrentRange<T extends Event>(handle: (e: T, range: Range|undefined) => any) {
    return (e: T) => {
        const range = (document.getSelection() && document.getSelection()!.rangeCount > 0) ? document.getSelection()?.getRangeAt(0) : undefined
        handle(e, range)
    }
}

export function withPreventDefault<T extends Event>(handle: (e: T) => any) {
    return (e: T) => {
        e.preventDefault()
        handle(e)
    }
}

export function withStopPropagation<T extends Event>(handle: (e: T) => any) {
    return (e: T) => {
        e.stopPropagation()
        handle(e)
    }
}
