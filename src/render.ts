import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {Context} from "./Host";


type EventCallback = (e: any) => void

export type Root = ReturnType<typeof createRoot>

export function createRoot(element: HTMLElement) {
    const eventCallbacks = new Map<string, Set<EventCallback>>()

    const context: Context = {}

    const root = {
        element,
        context,
        render(componentOrEl: HTMLElement|ComponentNode|Function) {
            const placeholder = new Comment('root')
            element.appendChild(placeholder)
            const host = createHost(componentOrEl, placeholder, context)
            host.render()
            return host
        },
        dispose() {
          // TODO
            eventCallbacks.clear()
            element.innerHTML = ''
        },
        on(event: string, callback: EventCallback) {
            let callbacks = eventCallbacks.get(event)
            if (!callbacks) {
                eventCallbacks.set(event, (callbacks = new Set()))
            }
            callbacks.add(callback)
        },
        dispatch(event: string, arg: any) {
            eventCallbacks.get(event)?.forEach(callback => callback(arg))
        }
    }

    context.root = root

    return root
}







