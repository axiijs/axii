import {insertBefore, UnhandledPlaceholder} from './DOM'
import {arrayComputed, Computed, destroyComputed, TrackOpTypes, TriggerOpTypes, UnwrapReactive} from "data0";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";

function getSpliceRemoveLength(argv: any[], length: number) : number {
    // CAUTION 按照 mdn 的定义，splice 第二个参数如果是 undefined 但是后面又有其他参数，就会被转成 0。
    const argv1NotUndefined = argv![1] === undefined ? ( argv!.length < 2 ? Infinity : 0 ) : (argv![1] as number)
    const argv1 = argv1NotUndefined < 0 ? 0 : argv1NotUndefined
    return argv1 !== Infinity ? argv1: (length - (argv![0] as number))
}
/**
 * @internal
 */
export class ReactiveArrayHost implements Host{
    hostsComputed?: Host[]
    placeholderAndItemComputed?: UnwrapReactive<[any, Comment][]>

    constructor(public source: any[], public placeholder:UnhandledPlaceholder, public pathContext: PathContext) {
    }
    createPlaceholder(item: any): [any, Comment] {
        return [item, document.createComment('frag item host')]
    }
    createHost = ([item, placeholder] : [any, UnhandledPlaceholder]) : Host => {
        return createHost(item, placeholder, {...this.pathContext, hostPath: [...this.pathContext.hostPath, this]})
    }

    isOnlyChildrenOfParent() {
        const parent = this.placeholder.parentElement
        return parent?.lastChild === this.placeholder && ((parent.firstChild as HTMLElement) === this.element)
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hostsComputed?.[0]?.element || this.placeholder
    }

    render(): void {
        const host = this
        this.placeholderAndItemComputed = arrayComputed<[any, Comment]>(
            function computation(this: Computed) {

                this.manualTrack(host.source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD);
                this.manualTrack(host.source, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE);

                // CAUTION 应该不支持重算，这里理论上覆盖了所有的 patch 场景。
                if (host.hostsComputed) {
                    throw new Error('should never recompute reactiveArray')
                }

                return host.source.map(host.createPlaceholder)
            },
            function applyPatch(placeholderAndItems, triggerInfos) {
                // CAUTION 特别注意，下面必须先处理 element 再处理数据，因为数据的处理会连环触发下面的  computed 也重新就散。
                triggerInfos.forEach(({method, argv, result}) => {
                    if (method === 'push') {
                        const newPlaceholderAndItems = argv!.map(host.createPlaceholder)
                        placeholderAndItems.push(...newPlaceholderAndItems)
                    } else if (method === 'pop') {
                        // placeholders 里面已经处理
                        placeholderAndItems.pop()
                        // CAUTION 不需要处理 placeholder，因为下面的 computed 里的 Host 会处理。
                    } else if (method === 'shift') {
                        placeholderAndItems.shift()
                        // CAUTION 不需要处理 placeholder，因为下面的 computed 里的 Host 会处理。
                    } else if (method === 'unshift') {
                        const newPlaceholderAndItems = argv!.map(host.createPlaceholder)
                        placeholderAndItems.unshift(...newPlaceholderAndItems)
                    } else if (method === 'splice') {
                        const newPlaceholderAndItems = argv!.slice(2)!.map(host.createPlaceholder)
                        placeholderAndItems.splice(argv![0], argv![1], ...newPlaceholderAndItems)
                        // CAUTION 不需要处理 placeholder，因为下面的 computed 里的 Host 会处理。
                    } else if(!method && result){
                        // 没有 method 说明是 explicit_key_change 变化
                        result.add?.forEach(({ }) => {
                            // TODO 也许未来能支持，和 splice 一样，但这意味着可能中间会掺入很多 undefined，这不是常见的场景
                            throw new Error('can not use obj[key] = value to add item to reactive array, use push instead.')
                        })

                        result.remove?.forEach(({  }) => {
                            // TODO delete 会变成 undefined，也是意料之外的场景
                            throw new Error('can not use delete obj[key] to delete item, use splice instead.')
                        })

                        result.update?.forEach(({ key, newValue }) => {
                            placeholderAndItems[key] = host.createPlaceholder(newValue)
                        })
                    } else {
                        throw new Error('unknown trigger info')
                    }
                })
            },
            function onDirty(recompute) {
                recompute()
            }
        )

        this.hostsComputed = arrayComputed<Host>(
            function computation(this: Computed) {
                // CAUTION 不支持重算，这里理论上支持了所有变化场景
                if (host.hostsComputed?.length) throw new Error('hostsComputed should not recompute')

                this.manualTrack(host.placeholderAndItemComputed!, TrackOpTypes.METHOD, TriggerOpTypes.METHOD);
                this.manualTrack(host.placeholderAndItemComputed!, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE);
                const hosts = host.placeholderAndItemComputed!.map(([item, placeholder]) => createHost(item, placeholder, {...host.pathContext, hostPath: [...host.pathContext.hostPath, host]}))
                const frag = document.createDocumentFragment()
                hosts.forEach(itemHost => {
                    frag.appendChild(itemHost.placeholder)
                    itemHost.render()
                })
                insertBefore(frag, host.placeholder)
                return hosts
            },
            function applyPatch(hosts, triggerInfos) {
                triggerInfos.forEach(({method, argv, result}) => {
                    if (method === 'push') {
                        const newHosts = argv!.map(host.createHost)
                        const frag = document.createDocumentFragment()
                        newHosts.forEach(host => {
                            frag.appendChild(host.placeholder)
                            host.render()
                        })
                        insertBefore(frag, host.placeholder)
                        hosts.push(...newHosts)
                    } else if (method === 'pop') {
                        const last = hosts.pop()
                        last.destroy()
                    } else if (method === 'shift') {
                        const first = hosts.shift()
                        first.destroy()
                    } else if (method === 'unshift') {
                        const newHosts = argv!.map(host.createHost)
                        const frag = document.createDocumentFragment()
                        newHosts.forEach(newHost => {
                            frag.appendChild(newHost.placeholder)
                            newHost.render()
                        })
                        insertBefore(frag, host.element)
                        hosts.unshift(...newHosts)
                    } else if (method === 'splice') {
                        const frag = document.createDocumentFragment()
                        const newHosts = argv!.slice(2)!.map(host.createHost)
                        newHosts.forEach(newHost => {
                            frag.appendChild(newHost.placeholder)
                            newHost.render()
                        })

                        if (argv![0] === 0 && argv![1] >= hosts.length && host.isOnlyChildrenOfParent()) {
                            // CAUTION 如果完全就是某个子 children，那么这里一次性 replaceChildren 可以提升性能。
                            const parent = host.placeholder.parentNode!
                            if (!newHosts.length && parent instanceof HTMLElement) {
                                (parent as HTMLElement).innerHTML = ''
                                parent.appendChild(frag)
                            } else {
                                parent.replaceChildren(frag)
                            }
                            // CAUTION 一定记得把自己 placeholder 重新 append 进去。
                            parent.appendChild(host.placeholder)

                            hosts.forEach((host: Host) => host.destroy(true))
                            hosts.splice(0, Infinity, ...newHosts)
                        } else {
                            const removeLength = getSpliceRemoveLength(argv!, hosts.length)
                            insertBefore(frag, hosts[argv![0] + removeLength]?.element || host.placeholder)
                            const removed = hosts.splice(argv![0], removeLength, ...newHosts)
                            removed.forEach((host: Host) => host.destroy())
                        }
                    } else if(!method && result){
                        // explicit update
                        // 没有 method 说明是 explicit_key_change 变化
                        result.add?.forEach(({ }) => {
                            throw new Error('should never occur')
                        })

                        result.remove?.forEach(({  }) => {
                            throw new Error('should never occur')
                        })

                        result.update?.forEach(({ key, newValue }) => {
                            // 会回收之前 placeholder，完全重新执行
                            hosts[key].destroy()
                            hosts[key] = host.createHost(newValue)
                            // CAUTION 特别注意这里的 key 是 string
                            insertBefore(hosts[key].placeholder, hosts[parseInt(key, 10)+1]?.element || host.placeholder)
                            hosts[key].render()
                        })
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
            destroyComputed(this.hostsComputed)
            destroyComputed(this.placeholderAndItemComputed)
        }
        // 理论上我们只需要处理自己的 placeholder 就行了，下面的 host 会处理各自的元素
        this.hostsComputed!.forEach(host => host.destroy(fromParentDestroy))
        if (!fromParentDestroy) this.placeholder.remove()
    }
}
