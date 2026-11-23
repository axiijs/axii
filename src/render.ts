import {Notifier, ReactiveEffect} from "data0";
import {createHost} from "./createHost";
import {ComponentNode} from "./types";
import {PathContext, Host} from "./Host";
import {assert} from "./util";
import {reportAxiiError} from "./diagnostics";
import {
    beginHydration,
    endHydration,
    findRootComment,
    isHydrateDeferredElement,
    pushHydrateRoot,
    popHydrateRoot,
    removeHydrateContainerOrphans,
    takeHydrateDeferredPayload,
} from "./hydration";
import {migrateSsrStyleTags} from "./StaticHost";
import {createElement, rematerializeDeferredFragmentChildren} from "./DOM";


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
 * root 是归属边界：root.render() / root.destroy() 里执行的代码（组件函数体、useEffect 回调与清理、
 * ref、各层 host 的创建与销毁）不属于恰好正在运行的 effect。
 *
 * CAUTION 在用户 effect 里调用这两个方法是常见写法（按一个 atom 打开 / 关闭弹层）。不隔离的话：
 *  - 里面读到的 atom 成为那个 effect 的依赖，之后写它就把整个 root 重新渲染或再销毁一次；
 *  - 里面创建的绑定 effect 被收集成那个 effect 的子 effect，它下一次重跑就把它们销毁——
 *    DOM 还在，绑定却不再更新，而 root 并没有被销毁。
 *  内容的生命周期只由 root.destroy() 决定。只暂停「正在运行的 effect」的追踪和子 effect 收集，
 *  不动 ManualCleanup 的收集帧：Portal 在组件函数体里渲染内层 root，内容仍随 Portal 组件销毁。
 *  没有正在运行的 effect（绝大多数调用）时直接执行。
 */
function runOutsideRunningEffect<T>(run: () => T): T {
    const scopes = ReactiveEffect.activeScopes
    if (!scopes.length) return run()
    const running = scopes[scopes.length - 1]
    const collectChild = running.shouldCollectChild
    running.shouldCollectChild = false
    Notifier.instance.pauseTracking()
    try {
        return run()
    } finally {
        Notifier.instance.resetTracking()
        running.shouldCollectChild = collectChild
    }
}

function createRootInternal(element: HTMLElement, parentContext?:PathContext, hydratePlaceholder?: Comment): Root {
    const eventCallbacks = new Map<string, Set<EventCallback>>()
    let attachQueue: AttachQueueEntry[] = []
    // 第一次 render 还在调用栈上的那棵树（见 render / destroy 的重入说明）
    let renderingHost: Host|undefined
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
            return runOutsideRunningEffect(() => {
                const placeholder = hydratePlaceholder ?? document.createComment('root')
                let host: Host
                // Hydrate：认领已有 <!--root-->，不新建、不整树重建（没有 fragment）
                const frag = hydratePlaceholder ? undefined : document.createDocumentFragment()
                frag?.appendChild(placeholder)
                root.host = host = createHost(componentOrEl, placeholder, pathContext)
                // CAUTION 重入销毁：树渲染到一半时 root.destroy() 被同步调用——最常见的是 error
                //  监听器把出错的 root 销毁掉、再渲染一个错误提示（同一个 root 或另一个 root）。
                //  那一刻树只建了一半：立刻销毁的话，渲染栈退出时剩下的组件照常渲染、跑 effect，
                //  fragment 照常挂进容器、照常派发 attach——容器里留下一棵已经「销毁」的树
                //  （监听器渲染的错误提示旁边多出半棵旧树），那些 effect 的清理函数永不执行。
                //  所以 destroy() 遇到还在渲染的树只做登记（root.host 换掉 / 置空），
                //  由这里在渲染栈退出、树已完整之后销毁恰好一次，并且绝不挂进容器。
                const outerRenderingHost = renderingHost
                renderingHost = host
                try {
                    host.render()
                } catch (error) {
                    // 树已经被销毁：它马上整体丢弃，监听器也已清空，后续错误没有归属
                    //  （与组件销毁后 async effect 的 rejection 不再上报同一语义）。
                    //  没有被销毁时保持向上抛出（root.host 仍被占用，由调用方 destroy）。
                    if (root.host === host) throw error
                } finally {
                    renderingHost = outerRenderingHost
                }
                if (root.host !== host) {
                    host.destroy()
                    return host
                }
                if (frag) element.appendChild(frag)
                // CAUTION 如果是之后再 attach 到 DOM 上的，需要手动触发 attach 事件
                if(element.isConnected) {
                    root.dispatch('attach')
                    root.attached = true
                }
                return host
            })
        },
        destroy() {
            runOutsideRunningEffect(() => {
                // CAUTION 一定要先派发 detach 再清空监听器，否则 detach 监听器永远不会被调用。
                root.dispatch('detach')
                // CAUTION 还在渲染的树不在这里销毁，见 render 的重入说明
                if (root.host !== renderingHost) root.host?.destroy()
            })
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
            // CAUTION 监听器是注册者的代码，却跑在派发点的 effect 帧里：绑定更新抛错时，error 就在
            //  出错绑定自己的 update 里派发。不暂停追踪的话监听器读的 atom 会成为该绑定的依赖，
            //  监听器读错误列表、再异步追加错误列表就是无限重算。派发方只关心有没有人消费事件，
            //  监听器的读取不可能是它的依赖，所以对所有事件统一暂停。
            //  attach 补执行的 layoutEffect/ref 有监听和 deferred 队列两条路径，必须在同一个暂停区间内。
            Notifier.instance.pauseTracking()
            try {
                if (consumed) {
                    const notify = () => callbacks!.forEach(callback => {
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
                    // CAUTION error 由出错的绑定/组件触发，监听器创建的 effect（错误提示的绑定等）不属于它：
                    //  被收集成绑定的子 effect 会在下一次更新时销毁，被收集进组件的 collect frame 会随
                    //  失败的 render 立即销毁。其余事件是调用方主动派发的，归属不变——Portal 内容的
                    //  layoutEffect 创建的 effect 仍由 Portal 组件收集并随它销毁。
                    if (event === 'error') {
                        ReactiveEffect.createDetached(notify)
                    } else {
                        notify()
                    }
                }
                // CAUTION 手动 dispatch('attach')（容器脱离文档后重新连通是公开用法）也必须
                //  flush deferred-attach 队列：root.attached 为 true 期间动态创建、但插入时
                //  仍未连通的组件/元素登记在这里，没有任何外层插入动作会再替它们 flush，
                //  不 flush 的话它们的 layoutEffect/ref 永不执行。
                if (event === 'attach') {
                    root.flushAttachQueue()
                }
            } finally {
                Notifier.instance.resetTracking()
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

/**
 * @category Basic
 */
export function createRoot(element: HTMLElement, parentContext?:PathContext): Root {
    return createRootInternal(element, parentContext)
}

/**
 * Activate a server-rendered DOM tree in-place (claim existing nodes; do not rebuild).
 * Container children must include `renderToString` output ending with `<!--root-->`.
 * @category Basic
 */
export function hydrateRoot(
    container: HTMLElement,
    source: JSX.Element|ComponentNode|Function|null|undefined,
    options?: { portals?: Record<string, HTMLElement> },
): Root {
    const placeholder = findRootComment(container)
    beginHydration(container, options?.portals)
    try {
        const root = createRootInternal(container, undefined, placeholder)
        root.render(source as any)
        // Adopted stylesheets are live; drop SSR <style data-axii-ssr> without FOUC.
        migrateSsrStyleTags(container)
        // §3.7 / D11: container-level orphans (before/after <!--root-->) are outside
        // element-child cursor cleanup — clear so DOM ≡ CSR createRoot shape.
        if (root.host) removeHydrateContainerOrphans(container, root.host)
        return root
    } finally {
        endHydration()
    }
}

/**
 * Hydrate a Portal content tree into an already-filled portal container (§3.3.d).
 * Switches the claim root for the duration of render; caller must already be inside hydrateRoot.
 * @internal
 */
export function hydratePortalContent(
    container: HTMLElement,
    content: JSX.Element|ComponentNode|Function,
    parentContext: PathContext,
): Root {
    const placeholder = findRootComment(container)
    pushHydrateRoot(container)
    try {
        // Eager HTML Portal content was deferred under the main tree (§3.3.d); claim here.
        let resolved: any = content
        if (isHydrateDeferredElement(content)) {
            const {type, rawProps, rawChildren} = takeHydrateDeferredPayload(content as Element)
            // Portal root is pushed — claiming is against portals[k], not main tree.
            resolved = createElement(type, rawProps, ...rawChildren)
        } else if (content instanceof DocumentFragment) {
            rematerializeDeferredFragmentChildren(content)
        }
        const root = createRootInternal(container, parentContext, placeholder)
        root.render(resolved)
        migrateSsrStyleTags(container)
        // Same container-orphan contract as hydrateRoot (§3.3.d / D11).
        if (root.host) removeHydrateContainerOrphans(container, root.host)
        return root
    } finally {
        popHydrateRoot()
    }
}
