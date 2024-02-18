import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {Context, Host} from "./Host";


type EventCallback = (e: any) => void

export type Root = ReturnType<typeof createRoot>

export function createRoot(element: HTMLElement) {
    const eventCallbacks = new Map<string, Set<EventCallback>>()

    const context: Context = {} as unknown as Context
    const root = {
        element,
        context,
        host: undefined as Host|undefined,
        render(componentOrEl: JSX.Element|ComponentNode|Function) {
            const placeholder = new Comment('root')
            element.appendChild(placeholder)
            root.host = createHost(componentOrEl, placeholder, context)
            root.host.render()
            // CAUTION 如果是之后再 attach 到 DOM 上的，需要手动触发 attach 事件
            if(document.body.contains(element)) {
                root.dispatch('attach')
            }
            return root.host
        },
        dispose() {
            eventCallbacks.clear()
            element.innerHTML = ''
            root.dispatch('detach')
            root.host?.destroy()
        },
        on(event: string, callback: EventCallback) {
            let callbacks = eventCallbacks.get(event)
            if (!callbacks) {
                eventCallbacks.set(event, (callbacks = new Set()))
            }
            callbacks.add(callback)
            return () => {
                callbacks!.delete(callback)
            }
        },
        dispatch(event: string, arg?: any) {
            eventCallbacks.get(event)?.forEach(callback => callback(arg))
        }
    }

    context.root = root

    return root
}







