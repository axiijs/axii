import {Atom, isReactive, ManualCleanup, ReactiveEffect} from "data0";
import {
    AttributesArg,
    createElement,
    createSVGElement,
    ExtendedElement,
    Fragment,
    insertBefore,
    JSXElementType,
    RefFn,
    RefObject,
    UnhandledPlaceholder
} from "./DOM";
import {Host, PathContext} from "./Host";
import {createHost} from "./createHost";
import {Component, ComponentNode, EffectHandle, Props, RenderContext} from "./types";
import {assert} from "./util";
import {Portal} from "./Portal.js";
import {createRef, createRxRef} from "./ref.js";
import {createLinkedNode, LinkedNode} from "./LinkedList";
import {markDynamicProp, isDynamicProp, markBoundProp, isBoundProp, markAopProp} from "./StaticHost";


function ensureArray(o: any) {
    return o ? (Array.isArray(o) ? o : [o]) : []
}
/**
 * @category Common Utility
 */
export function mergeProps(origin:{[k:string]: any}, newProps: {[k:string]: any}) {
    const output = {...origin}
    for(const key in newProps) {
        const value = newProps[key]
        output[key] = mergeProp(key, origin[key], value)
    }
    return output
}
/**
 * @category Common Utility
 */
export function mergeProp(key:string, originValue:any, value: any) {
    if(originValue && (key.startsWith('on') || key === 'ref'|| key==='style' || key==='classname' || key==='class')) {
        // CAUTION 事件一定要把 value 放前面，这样在事件中外部的 configure 还可以通过 preventDefault 来阻止默认行为。
        //  style 一定要放后面，才能覆写
        if(key === 'style') {
            return ensureArray(originValue).concat(value)
        } else {
            return ensureArray(value).concat(originValue)
        }

    } else {
        return value
    }
}


export type StateTransformer<T> = (target:any, value:Atom<T|null>) => ((() => void)|undefined)
export type StateFromRef<T> = Atom<T|null> & { ref:(target:any) => any }

const INNER_CONFIG_PROP = '__config__'
/**
 * @internal
 */
export class ComponentHost implements Host{
    static typeIds = new Map<Function, number>()
    static reusedNodes = new Map<any, ComponentHost>()
    type: Component
    public innerHost?: Host
    innerReusedHosts: ReusableHost[] = []
    props: Props
    public layoutEffects = new Set<EffectHandle>()
    public effects = new Set<EffectHandle>()
    public destroyCallback = new Set<Exclude<ReturnType<EffectHandle>, void>>()
    public layoutEffectDestroyHandles = new Set<Exclude<ReturnType<EffectHandle>, void>>()
    public refs: {[k:string]: any} = {}
    public itemConfig : {[k:string]:ConfigItem} = {}
    public children: any
    public frame?: ManualCleanup[] = []
    public name: string
    public exposed: {[k:string]:any} = {}
    public renderContext?: RenderContext
    public refProp?: RefObject|RefFn
    public thisProp?: RefObject|RefFn
    public inputProps: Props
    deleteLayoutEffectCallback?: () => void
    constructor({ type, props: inputProps = {}, children }: ComponentNode, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        if (!ComponentHost.typeIds.has(type)) {
            ComponentHost.typeIds.set(type, ComponentHost.typeIds.size)
        }

        this.name = type.name
        this.type = type
        this.props = {}
        this.refProp = inputProps.ref
        this.thisProp = inputProps.__this
        this.inputProps = inputProps
        this.children = children
    }

    parseItemConfigFromProp(itemConfig: any, key:string, value:any, props: Props) {
        if (key[0] === '$') {
            const [itemName, itemProp] = key.slice(1).split(':')
            if (!itemConfig[itemName]) itemConfig[itemName] = {}

            if (itemProp === '_eventTarget')  {
                // 支持 $eventTarget 来转发事件
                itemConfig[itemName].eventTarget = ensureArray(itemConfig[itemName].eventTarget).concat(value)
            } else if (itemProp=== '_use'){
                // 支持 $use 来覆盖整个 element。有多个 _use 的时候，直接用最后一个覆盖
                itemConfig[itemName].use = value
            } else if (itemProp=== '_props') {
                // 用户自定义函数合并 props
                itemConfig[itemName].propsMergeHandle = ensureArray(itemConfig[itemName].propsMergeHandle).concat(value)
            } else if (itemProp=== '_children') {
                // 用户自定义函数合并 props。有多个 _children 的时候，直接用最后一个覆盖
                itemConfig[itemName].children = value
            }else if (itemProp=== undefined || itemProp==='') {
                // 穿透到子组件的 config，支持多个
                itemConfig[itemName].configProps = ensureArray(itemConfig[itemName].configProps).concat(value)
            } else if(itemProp?.[0] === '_'){
                // 不支持的配置项
                assert(false, `unsupported config item: ${itemName}`)
            } else if( itemProp.endsWith('_') ) {
                // 支持 $xxx:[prop]_ 来让用户使用函数自定义 merge props
                if (!itemConfig[itemName].propMergeHandles) itemConfig[itemName].propMergeHandles = {}
                const propName = itemProp.slice(0, -1)
                itemConfig[itemName].propMergeHandles![propName] = ensureArray(itemConfig[itemName].propMergeHandles![propName]).concat(value)
            } else {
                // 支持 $xxx:[prop] 来覆盖 props
                if (!itemConfig[itemName].props) itemConfig[itemName].props = {}
                // style 要特殊标记一下，用去表示是外部覆盖的
                if (itemProp === 'style') {
                    markAopProp(value)
                    // 传递一下来自 AOP 的标记
                    if (isDynamicProp(props)) markDynamicProp(value)
                    if (isBoundProp(props)) markBoundProp(value)
                }
                itemConfig[itemName].props![itemProp] = mergeProp(itemProp, itemConfig[itemName].props![itemProp], value)
            }
        }
        return itemConfig
    }
    get typeId() {
        return ComponentHost.typeIds.get(this.type)!
    }
    // CAUTION innerHost 可能是动态的，所以 element 也可能会变，因此每次都要实时去读
    get element() : HTMLElement|Comment|SVGElement|Text {
        return this.innerHost?.element || this.placeholder
    }

    separateProps(rawProps: AttributesArg) {
        const props: Props = {}
        const componentProps: Props = {}
        const selfMergeProps: Props = {}
        for(const key in rawProps) {
            if (key.startsWith('prop:')) {
                componentProps[key.slice(5)] = rawProps[key]
            } else if (key.startsWith('$self:')) {
                // 支持自己 props 的 merge，这是因为有的组件包装了其他组件，想 merge props 而不是替换。
                // 写成 $self 的形式默认就是 merge，不用再手动使用 mergeProps 了，可读性也更强。
                selfMergeProps[key.slice(6)] = rawProps[key]
            } else {
                props[key] = rawProps[key]
            }
        }

        // merge props and selfMergeProps
        this.parseAndMergeProps({props, itemConfig:{}, componentProp: componentProps}, selfMergeProps)
        return {props, componentProps}
    }
    createHTMLOrSVGElement = (isSVG: boolean, type: JSXElementType, rawProps : AttributesArg, ...children: any[]) : ReturnType<typeof createElement> => {
        const isComponent = typeof type === 'function'
        if(__DEV__) {
            if (!isComponent && rawProps)
                Object.entries(rawProps).forEach(([key, value]) => {
                    assert(!isReactive(value), `don't use reactive or computed for attr: ${key}, simply use function or atom`)
                })
        }

        const name = rawProps?.['as']
        // 为了性能，直接操作了 rawProps
        delete rawProps?.['as']
        assert(name !=='self', '"self" is reserved, please use another element name.')

        // 支持 use 里面直接传入 HTMLElement 覆写整个节点
        if (name && this.itemConfig[name]?.use && this.itemConfig[name]?.use instanceof Element) {
            return this.itemConfig[name]!.use as HTMLElement
        }


        let finalChildren = children

        let {props: finalProps, componentProps} = this.separateProps(rawProps)

        const thisItemConfig = this.itemConfig[name]
        if (name && thisItemConfig) {
            // 为了性能，又直接操作了 rawProps
            // 1. 使用 :[prop] 语法  对当前节点的 props 调整
            if (thisItemConfig.props) {
                // CAUTION 普通节点，这里默认适合原来的 props 合并，除非用户想要自己的处理
                if (isComponent) {
                    finalProps = {...rawProps, ...thisItemConfig.props}
                } else {
                    finalProps = mergeProps(rawProps, thisItemConfig.props)
                }
            }

            // 2. 使用 :[prop_] 语法可以针对某个 prop 单独进行重写
            if(thisItemConfig.propMergeHandles) {
                Object.entries(thisItemConfig.propMergeHandles).forEach(([key, handles]) => {
                    // TODO 这里的 componentProps 需不要 N_ATTR?
                    finalProps[key] = handles.reduce((acc, handle) => handle(acc, componentProps), finalProps[key])
                })
            }

            // 3. 使用:_props 可以正对 props 进行整体重写
            if (thisItemConfig.propsMergeHandle) {
                // TODO 这里的 componentProps 需不要 N_ATTR?
                finalProps = thisItemConfig.propsMergeHandle.reduce((acc, handle) => handle(acc, componentProps), finalProps)
            }

            // 4. 支持对 children 进行重写
            if (thisItemConfig.children) {
                finalChildren = thisItemConfig.children
            }
        }

        const finalType = (this.itemConfig[name]?.use || type) as Component|string


        // CAUTION 如果是用 Component 重写了普通的 element 那么组件的 props 就是用 prop:xxx 标记的属性
        if (typeof finalType === 'function' && !isComponent) {
            componentProps[N_ATTR] = finalProps
            finalProps = componentProps
        }
        // 5. 如果 finalType 是函数，支持继续对组件继续透传 config
        //  CAUTION 注意这里使用 finalType 判断的，因为可能用 Component 重写了普通 element
        if (typeof finalType === 'function' && thisItemConfig?.configProps?.length) {
            // 透传了
            Object.assign(finalProps, { [INNER_CONFIG_PROP]: thisItemConfig.configProps })
        }

        // 收集 component ref
        if (name) {
            finalProps.ref = ensureArray(finalProps.ref).concat((item: any) => this.refs[name] = item)
            finalProps['data-as'] = name
        }

        const node = isSVG ?
            createSVGElement(finalType as string, finalProps, ...finalChildren) :
            createElement(finalType, finalProps, ...finalChildren)

        if (!(typeof finalType === 'function')) {
            // const contextComponentProps = this.pathContext.hostPath
            //     .filter(h => h instanceof ComponentHost)
            //     .map(h => (h as ComponentHost).props).reverse();

            const contextComponentProps: any[] = []
            let start: LinkedNode<Host>|null = this.pathContext.hostPath
            while(start){
                if (start instanceof ComponentHost) {
                    contextComponentProps.push(start.props)
                }
                start = start.prev
            }

            (node as ExtendedElement).listenerBoundArgs = [contextComponentProps, componentProps]
        }

        return node
    }
    createElement = this.createHTMLOrSVGElement.bind(this, false)
    createSVGElement = this.createHTMLOrSVGElement.bind(this, true)
    createPortal = (content: JSX.Element|ComponentNode|Function, container: HTMLElement) => {
        return createElement(Portal, {container, content})
    }
    reusable = (reusableNode: any) => {
        const reusedHost = new ReusableHost(reusableNode, new Comment('reusable'), this.pathContext)
        this.innerReusedHosts.push(reusedHost)
        return reusedHost
    }
    // 处理视图相关的 effect
    useLayoutEffect = (callback: EffectHandle) => {
        this.layoutEffects.add(callback)
    }
    // 处理纯业务相关的 effect，例如建立长连接等
    useEffect = (callback: EffectHandle) => {
        this.effects.add(callback)
    }
    createRef = createRef
    createRxRef = createRxRef
    normalizePropsByPropTypes(propTypes: NonNullable<Component["propTypes"]>, props: Props) {
        const finalProps: Props = {...props}
        // TODO dev 模式下类型检查
        Object.entries(propTypes).forEach(([key, type]) => {
           if (props[key] !== undefined) {
               // coerce
               finalProps[key] = type.coerce?.(props[key]) || props[key]
           } else {
               // create defaultValue
               finalProps[key] = type.defaultValue
           }
        })
        return finalProps
    }
    normalizePropsWithCoerceValue(propTypes: NonNullable<Component["propTypes"]>, props: Props) {
        const finalProps: Props = {...props}
        Object.entries(propTypes).forEach(([key, type]) => {
            if (props[key] !== undefined) {
                finalProps[key] = type.coerce?.(props[key]) || props[key]
            }
        })
        return finalProps
    }
    attachRef(ref: RefObject|RefFn) {
        const refValue = {
            ...this.exposed,
            refs: this.refs
        }

        if (typeof ref === 'function') {
            ref(refValue)
        } else {
            ref.current = refValue
        }
    }
    /* v8 ignore next 7 */
    attachThis(ref: RefObject|RefFn) {
        if (typeof ref === 'function') {
            ref(this)
        } else {
            ref.current = this
        }
    }
    detachRef(ref: RefObject|RefFn) {
       if(typeof ref === 'function') {
           ref(null)
       } else {
          ref.current = null
       }
    }
    expose = (value:any, name?: string) => {
        if (typeof value === 'object' && name === undefined) {
            // kv 形式的 expose
            Object.assign(this.exposed, value)
        } else if( typeof name === 'string'){
            // 单个 expose
            this.exposed[name] = value
        }

        return value
    }
    onCleanup = (callback: () => any) => {
        this.destroyCallback.add(callback)
    }
    evaluateBoundProps(inputProps:Props, renderContext:RenderContext) {
        return (this.type.boundProps || []).map(b => {
            if (typeof b === 'function') {
                // 由于在这里提前展开了函数，在 StyleManager#update 里拿到的已经是 object
                // 故而 StyleManager 不知道这个东西是不是 dynamic 的，应该在这里标记一下
                return markDynamicProp(markBoundProp(b(inputProps, renderContext!)))
            }
            return markBoundProp(b)
        })
    }
    parseAndMergeProps(last: {props:Props, itemConfig: ConfigItem, componentProp: Props}, current: Props) {
        // CAUTION 为了性能直接 assign，外部调用时要自己保证 last 是一个新的对象
        Object.entries(current).forEach(([key, value]) => {
            if( key === INNER_CONFIG_PROP) {
                // 透传过来的 config 这里不处理，外部已经处理了
            } else if (key[0] === '$')  {
                last.itemConfig = this.parseItemConfigFromProp(last.itemConfig, key, value, current)
            } else {
                last.props[key] = mergeProp(key, last.props[key], value)
            }
        })

        return last
    }
    getFinalPropsAndItemConfig() {
        const inputPropsWithDefaultValue = this.type.propTypes ? this.normalizePropsByPropTypes(this.type.propTypes, this.inputProps) : this.inputProps
        const evaluatedProps = this.evaluateBoundProps(inputPropsWithDefaultValue, this.renderContext!)

        // CAUTION boundProps 的优先级是低于 inputProps，但这里 boundProps 还是可以拿到 inputProps 的值是因为
        //  它需要和 inputProps 里面通用的引用，例如 form 状态。
        //  boundProps 优先级最低，inputProps 第二高，configProps 最高，是最上层穿透过来的。
        const allProps = evaluatedProps.concat(inputPropsWithDefaultValue, ...(this.inputProps[INNER_CONFIG_PROP]||[]))
        return allProps.reduce((acc, props) => this.parseAndMergeProps(acc, props), { props: {}, itemConfig: {}, componentProp: {}})
    }
    render(): void {
        if (this.element !== this.placeholder) {
            // CAUTION 因为现在没有 diff，所以不可能出现 Component rerender
            assert(false, 'should never rerender')
        }

        // CAUTION 注意这里 children 的写法，没有children 就不要传，免得后面 props 继续往下透传的时候出问题。
        this.renderContext = {
            Fragment,
            createElement: this.createElement,
            createSVGElement: this.createSVGElement,
            refs: this.refs,
            useLayoutEffect: this.useLayoutEffect,
            useEffect: this.useEffect,
            pathContext: this.pathContext,
            context: new DataContext(this.pathContext.hostPath),
            createPortal: this.createPortal,
            createRef: this.createRef,
            createRxRef: this.createRxRef,
            onCleanup: this.onCleanup,
            expose: this.expose,
            reusable: this.reusable,
        }

        // CAUTION collect effects start
        const getFrame = ReactiveEffect.collectEffect()

        const { props: componentProps, itemConfig } = this.getFinalPropsAndItemConfig()
        this.itemConfig = itemConfig
        this.props = componentProps
        // 这里要再 coerce props，因为 boundProps 可能 return fixed value
        const normalizedProps = this.type.propTypes ? this.normalizePropsWithCoerceValue(this.type.propTypes, componentProps) : componentProps

        normalizedProps.children = this.children
        this.props = normalizedProps

        const node = this.type(normalizedProps, this.renderContext)
        this.frame = getFrame()
        // CAUTION collect effects end
        // 就用当前 component 的 placeholder
        this.innerHost = createHost(node, this.placeholder, {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
        this.innerHost.render()


        // for test use
        /* v8 ignore next 3 */
        if (this.thisProp) {
            this.attachThis(this.thisProp)
        }

        this.effects.forEach(effect => {
            const handle = effect()
            // 也支持 async function return promise，只不过不做处理
            if (typeof handle === 'function') this.destroyCallback.add(handle)
        })

        // 已经 root attach 了，动态生成的节点，需要手动触发 layoutEffect。因为没有 attach 事件了。
        if (this.pathContext.root.attached) {
            this.runLayoutEffect()
        } else {
            this.pathContext.root.on('attach', this.runLayoutEffect, {once: true})
        }
    }
    runLayoutEffect = () => {
        // CAUTION 一定是渲染之后才调用 ref，这样才能获得 dom 信息。
        if (this.refProp) {
            this.attachRef(this.refProp)
        }

        this.layoutEffects.forEach(layoutEffect => {
            const handle = layoutEffect()
            if (typeof handle === 'function') this.layoutEffectDestroyHandles.add(handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (this.refProp) {
            this.detachRef(this.refProp)
        }

        if (!parentHandleComputed) {
            // 如果上层是 computed rerun，那么也会清理掉我们产生的 computed。但不能确定，所以这里还是自己清理一下。
            this.frame?.forEach(manualCleanupObject =>
                manualCleanupObject.destroy()
            )
        }
        // CAUTION 注意这里， ComponentHost 自己是不处理 dom 的。
        this.innerHost!.destroy(parentHandle, parentHandleComputed)
        this.layoutEffectDestroyHandles.forEach(handle => handle())
        this.destroyCallback.forEach(callback => callback())

        this.innerReusedHosts.forEach(host => host.destroyReusable())

        // 删除 dom
        if (!parentHandle) {
            this.placeholder.remove()
        }

        this.deleteLayoutEffectCallback?.()
    }
}



type FunctionProp = (arg:any, props: Props) => object
type EventTarget = (arg: (e:Event) => any) => void

type ConfigItem = {
    // 穿透给组件的
    config?: { [k:string]: ConfigItem},
    configProps?: Props[],
    // 支持覆写 element
    use?: Component|JSX.Element,
    // 将事件转发到另一个节点上
    eventTarget?: EventTarget[],
    // 手动调整内部组件的 props
    props?: {[k:string]: any},
    // 函数手动 merge prop
    propMergeHandles?: {[k:string]: ((last:any, props:Props) => any)[]},

    propsMergeHandle?: FunctionProp[],
    // children
    children?: any
}

export class DataContext{
    public valueByType: Map<any, any>
    constructor(public hostPath: LinkedNode<Host>) {
        this.valueByType = new Map<any, any>()
    }
    get(contextType:any) {
        // 找到最近具有 contextType 的 host
        let start: LinkedNode<Host>|null = this.hostPath
        while(start) {
            if (start.node instanceof ComponentHost) {
                if (start.node.renderContext!.context.valueByType.has(contextType)) {
                    return start.node.renderContext!.context.valueByType.get(contextType)
                }
            }
            start = start.prev
        }
        // for (let i = this.hostPath.length - 1; i >= 0; i--) {
        //     const host = this.hostPath[i]
        //     if (host instanceof ComponentHost) {
        //         if (host.renderContext!.context.valueByType.has(contextType)) {
        //             return host.renderContext!.context.valueByType.get(contextType)
        //         }
        //     }
        // }
    }
    set(contextType: any, value: any) {
        this.valueByType.set(contextType, value)
    }
}

export const N_ATTR = '__nativeAttrs'

export function bindProps(Component: Component, props: Props,) {
    const ComponentWithProps = Component.bind(null)
    ComponentWithProps.propTypes = Component.propTypes
    ComponentWithProps.boundProps = ensureArray(ComponentWithProps.boundProps).concat(props)
    return ComponentWithProps
}

export class ReusableHost implements Host{
    public innerHost: Host
    reusePlaceholder?: Comment
    constructor(public source: any, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        this.innerHost = createHost(source, placeholder, pathContext)
    }
    element:HTMLElement|Comment|Text|SVGElement = this.placeholder
    rendered = false
    render() {
        // 第一次渲染
        if (!this.rendered) {
            insertBefore(this.placeholder, this.reusePlaceholder!)
            // debugger
            this.innerHost.render()
            this.rendered = true
        } else {
            const frag = document.createDocumentFragment()
            let start = this.innerHost.element
            while(start !== this.innerHost.placeholder) {
                const next = start.nextSibling as HTMLElement|Comment|Text|SVGElement
                frag.appendChild(start)
                start = next
            }
            frag.appendChild(this.innerHost.placeholder)
            insertBefore(frag, this.reusePlaceholder!)
        }
    }
    moveTo(reusePlaceholder: Comment) {
        this.reusePlaceholder = reusePlaceholder
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        // do nothing
        if (!parentHandle) {
            const frag = document.createDocumentFragment()
            let start = this.innerHost.element
            while(start !== this.innerHost.placeholder) {
                const next = start.nextSibling as HTMLElement|Comment|Text|SVGElement
                frag.appendChild(start)
                start = next
            }
            frag.appendChild(this.innerHost.placeholder)
            // 这个reusePlaceholder不要了，如果再被渲染，会有新的 placeholder
            if (this.reusePlaceholder) {
                this.reusePlaceholder.remove()
            }
        }
    }
    destroyReusable() {
        // 可能没有真正被渲染过
        if (this.element === this.placeholder) {
            this.element.remove()
        } else {
            this.innerHost.destroy(false, false)
        }
        if (this.reusePlaceholder) {
            this.reusePlaceholder.remove()
        }
    }
}
