import {UnhandledPlaceholder, insertBefore} from './DOM'
import {computed, destroyComputed, TrackOpTypes, TriggerOpTypes} from "data0";
import {Context, Host} from "./Host";
import {createHost} from "./createHost";

function getSpliceRemoveLength(argv: any[], length: number) : number {
    // CAUTION 按照 mdn 的定义，splice 第二个参数如果是 undefined 但是后面又有其他参数，就会被转成 0。
    const argv1NotUndefined = argv![1] === undefined ? ( argv!.length < 2 ? Infinity : 0 ) : (argv![1] as number)
    const argv1 = argv1NotUndefined < 0 ? 0 : argv1NotUndefined
    return argv1 !== Infinity ? argv1: (length - (argv![0] as number))
}

export class ReactiveArrayHost implements Host{
    hostsComputed?: Host[]
    placeholderAndItemComputed?: [any, Comment][]

    constructor(public source: ReturnType<typeof computed>, public placeholder:UnhandledPlaceholder, public context: Context) {
    }
    createPlaceholder(item: any): [any, Comment] {
        return [item, new Comment('frag item host')]
    }
    createHost = ([item, placeholder] : [any, UnhandledPlaceholder]) : Host => {
        return createHost(item, placeholder, this.context)
    }

    isOnlyChildrenOfParent() {
        const parent = this.placeholder.parentElement
        return parent?.lastChild === this.placeholder && ((parent.firstChild as HTMLElement) === this.element)
    }

    get element(): HTMLElement|Comment|SVGElement|Text  {
        return this.hostsComputed?.[0]?.element || this.placeholder
    }

    render(): void {
        this.placeholderAndItemComputed = computed(
            (trackOnce) => {

                trackOnce!(this.source, TrackOpTypes.METHOD, TriggerOpTypes.METHOD);
                trackOnce!(this.source, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE);

                // CAUTION 应该不支持重算，这里理论上覆盖了所有的 patch 场景。
                if (this.hostsComputed) {
                    throw new Error('should never recompute reactiveArray')
                }

                return this.source.map(this.createPlaceholder)
            },
            (placeholderAndItems, triggerInfos) => {
                // CAUTION 特别注意，下面必须先处理 element 再处理数据，因为数据的处理会连环触发下面的  computed 也重新就散。
                triggerInfos.forEach(({method, argv, result}) => {
                    if (method === 'push') {
                        const newPlaceholderAndItems = argv!.map(this.createPlaceholder)
                        placeholderAndItems.push(...newPlaceholderAndItems)
                    } else if (method === 'pop') {
                        // placeholders 里面已经处理
                        placeholderAndItems.pop()
                        // CAUTION 不需要处理 placeholder，因为下面的 computed 里的 Host 会处理。
                    } else if (method === 'shift') {
                        placeholderAndItems.shift()
                        // CAUTION 不需要处理 placeholder，因为下面的 computed 里的 Host 会处理。
                    } else if (method === 'unshift') {
                        const newPlaceholderAndItems = argv!.map(this.createPlaceholder)
                        placeholderAndItems.unshift(...newPlaceholderAndItems)
                    } else if (method === 'splice') {
                        const newPlaceholderAndItems = argv!.slice(2)!.map(this.createPlaceholder)
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
                            placeholderAndItems[key] = this.createPlaceholder(newValue)
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

        this.hostsComputed = computed(
            (trackOnce) => {
                // CAUTION 不支持重算，这里理论上支持了所有变化场景
                if (this.hostsComputed?.length) throw new Error('hostsComputed should not recompute')


                trackOnce!(this.placeholderAndItemComputed!, TrackOpTypes.METHOD, TriggerOpTypes.METHOD);
                trackOnce!(this.placeholderAndItemComputed!, TrackOpTypes.EXPLICIT_KEY_CHANGE, TriggerOpTypes.EXPLICIT_KEY_CHANGE);
                const hosts = this.placeholderAndItemComputed!.map(([item, placeholder]) => createHost(item, placeholder, this.context))
                const frag = document.createDocumentFragment()
                hosts.forEach(host => {
                    frag.appendChild(host.placeholder)
                    host.render()
                })
                insertBefore(frag, this.placeholder)
                return hosts
            },
            (hosts, triggerInfos) => {
                triggerInfos.forEach(({method, argv, result}) => {
                    if (method === 'push') {
                        const newHosts = argv!.map(this.createHost)
                        const frag = document.createDocumentFragment()
                        newHosts.forEach(host => {
                            frag.appendChild(host.placeholder)
                            host.render()
                        })
                        insertBefore(frag, this.placeholder)
                        hosts.push(...newHosts)
                    } else if (method === 'pop') {
                        const last = hosts.pop()
                        last.destroy()
                    } else if (method === 'shift') {
                        const first = hosts.shift()
                        first.destroy()
                    } else if (method === 'unshift') {
                        const newHosts = argv!.map(this.createHost)
                        const frag = document.createDocumentFragment()
                        newHosts.forEach(host => {
                            frag.appendChild(host.placeholder)
                            host.render()
                        })
                        insertBefore(frag, this.element)
                        hosts.unshift(...newHosts)
                    } else if (method === 'splice') {
                        const frag = document.createDocumentFragment()
                        const newHosts = argv!.slice(2)!.map(this.createHost)
                        newHosts.forEach(host => {
                            frag.appendChild(host.placeholder)
                            host.render()
                        })

                        if (argv![0] === 0 && argv![1] >= hosts.length && this.isOnlyChildrenOfParent()) {
                            // CAUTION 如果完全就是某个子 children，那么这里一次性 replaceChildren 可以提升性能。
                            const parent = this.placeholder.parentNode!
                            if (!newHosts.length && parent instanceof HTMLElement) {
                                (parent as HTMLElement).innerHTML = ''
                                parent.appendChild(frag)
                            } else {
                                parent.replaceChildren(frag)
                            }
                            // CAUTION 一定记得把自己 placeholder 重新 append 进去。
                            parent.appendChild(this.placeholder)

                            hosts.forEach((host: Host) => host.destroy(true))
                            hosts.splice(0, Infinity, ...newHosts)
                        } else {
                            const removeLength = getSpliceRemoveLength(argv!, hosts.length)
                            insertBefore(frag, hosts[argv![0] + removeLength]?.element || this.placeholder)

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
                            hosts[key] = this.createHost(newValue)
                            // CAUTION 特别注意这里的 key 是 string
                            insertBefore(hosts[key].placeholder, hosts[parseInt(key, 10)+1]?.element || this.placeholder)
                            hosts[key].render()
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
