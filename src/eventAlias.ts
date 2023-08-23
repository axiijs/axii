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

export const onSelf = eventAlias(e => e.target === e.currentTarget)

type Trigger = (e: Event) => any

export function createEventTransfer() {
    let triggerTargetEvent: Trigger|undefined
    function target(trigger: Trigger) {
        if (triggerTargetEvent !== undefined) {
            debugger
            throw new Error('event transfer can only have one target')
        }
        triggerTargetEvent = trigger
    }

    function source(e: Event) {
        if (triggerTargetEvent) {
            triggerTargetEvent(e)
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