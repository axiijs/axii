import {insertBefore, UnhandledPlaceholder} from './DOM'
import {computed, destroyComputed, RxList, TrackOpTypes, TriggerOpTypes, Computed} from "data0";
import {PathContext, Host} from "./Host";
import {createHost} from "./createHost";

export class RxListHost implements Host{
    hosts?: RxList<any>
    placeholderAndItemComputed?: [any, Comment][]
    hostRenderComputed?:  ReturnType<typeof computed>
    constructor(public source: RxList<any>, public placeholder:UnhandledPlaceholder, public pathContext: PathContext) {
    }
    createPlaceholder(item: any): [any, Comment] {
        return [item, document.createComment('frag item host')]
    }

    isOnlyChildrenOfParent() {
        const parent = this.placeholder.parentElement
        return parent?.lastChild === this.placeholder && ((parent.firstChild as HTMLElement) === this.element)
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hosts?.at(0)?.element || this.placeholder
    }

    renderNewHosts(hosts: Host[]|RxList<Host>) {
        const frag = document.createDocumentFragment()
        hosts.forEach(host => {
            frag.appendChild(host.placeholder)
            host.render()
        })
        return frag
    }

    render(): void {
        const host = this

        this.hosts = this.source.map((item) => {
            return createHost(item, document.createComment('rx list item'), {...this.pathContext, hostPath: [...this.pathContext.hostPath, this]})
        })

        this.hostRenderComputed = computed(
            function computation(this:Computed) {
                this.manualTrack(host.hosts!, TrackOpTypes.METHOD, TriggerOpTypes.METHOD)
                this.manualTrack(host.hosts!, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE)
                insertBefore(host.renderNewHosts(host.hosts!), host.placeholder)
                return null
            },
            function applyPatch(_, triggerInfos) {
                triggerInfos.forEach(({method, argv, result, key, newValue, methodResult},  index) => {
                    if (method === 'splice') {
                        // 这里的 this.hosts 是已经修改好的。
                        // CAUTION 因为 hosts 中的元素可能也是一个一个插进来的。例如 groupBy 中的 patch。
                        //  我们的下一个元素可能也是新的还没渲染，所以要一直往后找到第一个已经渲染过的元素。
                        const insertBeforeHost = host.hosts!.data.slice(argv![0] + argv!.slice(2)!.length).find(host => host.element.parentNode)

                        const newHosts = argv!.slice(2)!
                        if (newHosts.length) {
                            const newHostsFrag =  host.renderNewHosts(newHosts)
                            insertBefore(newHostsFrag, insertBeforeHost?.element || host.placeholder)
                        }


                        // FIXME 当所有节点删除时，host.isOnlyChildrenOfParent() 判断出错了，里面使用 firstChild 来和 hosts.at(0).element 来判断的。
                        //  但此时原本的 hosts.at(0)可能已经被删除了，不是原来的了。
                        // const isOnlyChildrenOfParent = host.isOnlyChildrenOfParent()
                        const deletedHosts = methodResult as Host[]

                        // CAUTION 如果是删除所有节点，并且自己就是 parent 的唯一 child，并且没有子节点要强制自己清理。那么直接清空 parent，这样比较快。
                        // const removeAllElementByParent = host.hosts!.data.length===0 && isOnlyChildrenOfParent && deletedHosts.every(inner => !inner.forceHandleElement)
                        // if (removeAllElementByParent) {
                        //     debugger
                        //     const parent = host.placeholder.parentNode!
                        //     if (parent instanceof HTMLElement) {
                        //         (parent as HTMLElement).innerHTML = ''
                        //     }
                        //     // CAUTION 一定记得把自己 placeholder 重新 append 进去。
                        //     parent.appendChild(host.placeholder)
                        //     // destroy host 但是不用处理 element 了。
                        //     deletedHosts.forEach((host: Host) => host.destroy(true))
                        // } else {
                            deletedHosts.forEach((host: Host) => host.destroy())
                        // }

                    } else if(method === undefined && key !== undefined){
                        // explicit key change
                        const oldHost = methodResult as Host
                        oldHost?.destroy()

                        // 会回收之前 placeholder，完全重新执行
                        const index = key as number
                        insertBefore(host.hosts!.at(index)!.placeholder, host.hosts!.at(index+1)?.element || host.placeholder)
                        host.hosts!.at(index)!.render()
                    } else {
                        throw new Error('unknown trigger info')
                    }
                })
            },
            true
        )
    }
    destroy(fromParentDestroy?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.hosts?.destroy()
            destroyComputed(this.hostRenderComputed)
        }
        // 理论上我们只需要处理自己的 placeholder 就行了，下面的 host 会处理各自的元素
        this.hosts!.forEach(host => host.destroy(fromParentDestroy))
        if (!fromParentDestroy) this.placeholder.remove()
    }
}
