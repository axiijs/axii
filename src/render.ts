import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {PathContext, Host} from "./Host";
import {assert} from "./util";
import {reportAxiiError} from "./diagnostics";


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
    /**
     * @internal
     * root 已 attach、但组件/元素此刻仍渲染在脱离文档的 fragment 里
     * （列表新行、动态重建的静态子树等）时，layoutEffect/ref 不能立即执行——
     * 它们的语义是「可以测量 DOM」。登记到这里，等外层把子树真正插入文档后
     * 由 flushAttachQueue 同步执行。返回取消函数（host 在插入前被销毁时调用）。
     */
    deferUntilAttached: (node: Node, run: () => void) => () => void
    /**
     * @internal
     * 完成一次「detached fragment -> 文档」插入后调用：执行队列中已经连通的回调，
     * 仍未连通的（自己只是被插进了更外层的 fragment）留给更外层的 flush。
     */
    flushAttachQueue: () => void
}

type AttachQueueEntry = {node: Node, run: () => void, cancelled: boolean}

/**
 * @category Basic
 */
export function createRoot(element: HTMLElement, parentContext?:PathContext): Root {
    const eventCallbacks = new Map<string, Set<EventCallback>>()
    let attachQueue: AttachQueueEntry[] = []
    // Portal 场景：内层 root 由框架私有创建，用户无法在它上面注册监听，
    //  未被消费的 error 事件必须冒泡到父 root，否则 portal 内容的错误
    //  永远到不了用户的 root.on('error') 钩子（异步路径下直接变成 unhandled rejection）。
    const parentRoot = parentContext?.root

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
            attachQueue = []
            root.host = undefined
            root.attached = false
        },
        deferUntilAttached(node: Node, run: () => void) {
            const entry: AttachQueueEntry = {node, run, cancelled: false}
            attachQueue.push(entry)
            return () => { entry.cancelled = true }
        },
        flushAttachQueue() {
            if (!attachQueue.length) return
            // CAUTION 先取快照再执行：回调（layoutEffect）可能同步触发新的渲染/登记，
            //  新条目直接落进新的队列，由本轮循环外的下一次 flush 处理。
            const entries = attachQueue
            attachQueue = []
            // CAUTION 一个条目（某个组件的 layoutEffect/ref）抛错不能中断同批其他条目：
            //  队列快照已经取走，中断意味着剩余组件的 layoutEffect/ref 永久丢失。
            //  错误交给 root error 钩子；未注册钩子时保留第一个错误，批次完成后向上抛
            //  （与其余错误出口「无钩子保持可观测」的语义一致）。
            let firstError: unknown
            let hasError = false
            for (const entry of entries) {
                if (entry.cancelled) continue
                if (entry.node.isConnected) {
                    try {
                        entry.run()
                    } catch (e) {
                        if (!root.dispatch('error', e)) {
                            if (!hasError) {
                                hasError = true
                                firstError = e
                            } else {
                                reportAxiiError(e)
                            }
                        }
                    }
                } else {
                    // 仍在更外层的 fragment 里，等外层插入后的 flush
                    attachQueue.push(entry)
                }
            }
            if (hasError) throw firstError
        },
        // ComponentHost 里面的 layoutEffect 是用这个监听 attach 事件实现的。
        on(event: string, callback: EventCallback, options?: EventOptions) {
            let callbacks = eventCallbacks.get(event)
            if (!callbacks) {
                eventCallbacks.set(event, (callbacks = new Set()))
            }
            // CAUTION once 的退订必须放 finally：callback 抛错时不退订的话，
            //  下一次事件会再次触发本应只执行一次的回调（layoutEffect 重复执行）。
            const savedCallback = options?.once ? (arg: any) => {
                try {
                    callback(arg)
                } finally {
                    callbacks!.delete(savedCallback)
                }
            }: callback

            callbacks.add(savedCallback)
            return () => {
                callbacks!.delete(savedCallback)
            }
        },
        dispatch(event: string, arg?: any) {
            // CAUTION render 到 detached 容器、之后手动 dispatch('attach') 是公开用法。
            //  必须同步更新 attached 标记，否则之后动态创建的组件/元素会重新注册
            //  once 的 attach 监听，永远等不到下一次 attach，layoutEffect/ref 永不执行。
            if (event === 'attach') {
                root.attached = true
            } else if (event === 'detach') {
                root.attached = false
            }
            const callbacks = eventCallbacks.get(event)
            const consumed = !!callbacks?.size
            if (consumed) {
                callbacks!.forEach(callback => {
                    // CAUTION 一个监听器抛错不能中断兄弟监听器，更不能把新错误传播回框架的
                    //  错误恢复路径——dispatch('error') 的调用点都在 catch 块里，向上抛会
                    //  覆盖原始错误、把 fail-stop 变成二次崩溃。监听器自身的错误收敛到
                    //  reportAxiiError（结构化打印 + onError 回调），保持可观测。
                    try {
                        callback(arg)
                    } catch (handlerError) {
                        reportAxiiError(handlerError)
                    }
                })
            }
            // CAUTION 手动 dispatch('attach')（容器脱离文档后重新连通是公开用法）也必须
            //  flush deferred-attach 队列：root.attached 为 true 期间动态创建、但插入时
            //  仍未连通的组件/元素登记在这里，没有任何外层插入动作会再替它们 flush，
            //  不 flush 的话它们的 layoutEffect/ref 永不执行。
            if (event === 'attach') {
                root.flushAttachQueue()
            }
            if (consumed) return true
            // CAUTION 只冒泡 error：attach/detach 是每个 root 自己的生命周期事件，不能转发
            if (event === 'error' && parentRoot) {
                return parentRoot.dispatch(event, arg)
            }
            return false
        }
    }

    pathContext.root = root

    return root as Root
}







