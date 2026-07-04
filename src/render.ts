import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {PathContext, Host} from "./Host";
import {assert} from "./util";


type EventCallback = (e: any) => void
type EventOptions = {once?: boolean}
/**
 * @category Basic
 */
export type Root = {
    element: HTMLElement,
    pathContext: PathContext,
    host: Host|undefined,
    attached: boolean
    render: (componentOrEl: JSX.Element|ComponentNode|Function) => Host,
    destroy: () => void,
    on: (event: string, callback: EventCallback, options?: EventOptions) => () => void,
    // 返回是否有监听器消费了该事件
    dispatch: (event: string, arg?: any) => boolean
}

/**
 * @category Basic
 */
export function createRoot(element: HTMLElement, parentContext?:PathContext): Root {
    const eventCallbacks = new Map<string, Set<EventCallback>>()

    // CAUTION parentContext 是外部（如 Portal 所在组件）自己的 pathContext，
    //  这里必须 clone，不能原地改写它的 root 字段，否则外部组件的 pathContext.root 会指向内层 root。
    const pathContext: PathContext = parentContext ? {...parentContext} : {
        hostPath: null,
        elementPath: [],
    } as unknown as PathContext

    const root = {
        element,
        pathContext,
        host: undefined as Host|undefined,
        attached: false,
        render(componentOrEl: JSX.Element|ComponentNode|Function) {
            // CAUTION render 不可重入，否则会往容器里追加多棵树
            assert(!root.host, 'root can only render once, destroy the root before rendering again')
            const placeholder = document.createComment('root')
            const frag = document.createDocumentFragment()
            frag.appendChild(placeholder)
            root.host = createHost(componentOrEl, placeholder, pathContext)
            root.host.render()
            element.appendChild(frag)
            // CAUTION 如果是之后再 attach 到 DOM 上的，需要手动触发 attach 事件
            if(element.isConnected) {
                root.dispatch('attach')
                root.attached = true
            }
            return root.host
        },
        destroy() {
            // CAUTION 一定要先派发 detach 再清空监听器，否则 detach 监听器永远不会被调用。
            root.dispatch('detach')
            root.host?.destroy()
            eventCallbacks.clear()
            root.host = undefined
            root.attached = false
        },
        // ComponentHost 里面的 layoutEffect 是用这个监听 attach 事件实现的。
        on(event: string, callback: EventCallback, options?: EventOptions) {
            let callbacks = eventCallbacks.get(event)
            if (!callbacks) {
                eventCallbacks.set(event, (callbacks = new Set()))
            }
            const savedCallback = options?.once ? (arg: any) => {
                callback(arg)
                callbacks!.delete(savedCallback)
            }: callback

            callbacks.add(savedCallback)
            return () => {
                callbacks!.delete(savedCallback)
            }
        },
        dispatch(event: string, arg?: any) {
            const callbacks = eventCallbacks.get(event)
            if (!callbacks?.size) return false
            callbacks.forEach(callback => callback(arg))
            return true
        }
    }

    pathContext.root = root

    return root as Root
}







