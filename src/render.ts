import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {PathContext, Host} from "./Host";


type EventCallback = (e: any) => void

export type Root = {
    element: HTMLElement,
    pathContext: PathContext,
    host: Host|undefined,
    render: (componentOrEl: JSX.Element|ComponentNode|Function) => Host,
    destroy: () => void,
    on: (event: string, callback: EventCallback) => () => void,
    dispatch: (event: string, arg?: any) => void
}

export function createRoot(element: HTMLElement, parentContext?:PathContext): Root {
    const eventCallbacks = new Map<string, Set<EventCallback>>()

    const pathContext: PathContext = parentContext || {
        hostPath: [],
        elementPath: [],
    } as unknown as PathContext

    const root = {
        element,
        pathContext,
        host: undefined as Host|undefined,
        render(componentOrEl: JSX.Element|ComponentNode|Function) {
            const placeholder = document.createComment('root')
            element.appendChild(placeholder)
            root.host = createHost(componentOrEl, placeholder, pathContext)
            root.host.render()
            // CAUTION 如果是之后再 attach 到 DOM 上的，需要手动触发 attach 事件
            if(document.body.contains(element)) {
                root.dispatch('attach')
            }
            return root.host
        },
        destroy() {
            eventCallbacks.clear()
            root.dispatch('detach')
            root.host?.destroy()
        },
        // ComponentHost 里面的 layoutEffect 是用这个监听 attach 事件实现的。
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

    pathContext.root = root

    return root as Root
}







