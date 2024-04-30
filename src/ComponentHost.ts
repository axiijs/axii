import {atom, Atom, isReactive, ManualCleanup, reactive, ReactiveEffect} from "data0";
import {
    AttributesArg,
    createElement,
    createSVGElement,
    Fragment,
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


function ensureArray(o: any) {
    return o ? (Array.isArray(o) ? o : [o]) : []
}

// CAUTION 为了性能，直接 assign。
//  只有事件监听和 ref 被认为是外层需要 merge，其他都是否该
export function mergeProps(origin:{[k:string]: any}, newProps: {[k:string]: any}) {
    Object.entries(newProps).forEach(([key, value]) => {
        const originValue = origin[key]
        if(originValue && (key.startsWith('on') || key === 'ref'|| key==='style')) {
            // CAUTION 事件一定要把 value 放前面，这样在事件中外部的 configure 还可以通过 preventDefault 来阻止默认行为。
            //  style 一定要放后面，才能覆写
            if(key === 'style') {
                origin[key] = ensureArray(originValue).concat(value)
            } else {
                origin[key] = ensureArray(value).concat(originValue)
            }

        } else {
            origin[key] = value
        }
    })
    return origin
}

export type StateTransformer<T> = (target:any, value:Atom<T|null>, options: any) => (() => any)|undefined
export type StateFromRef<T> = Atom<T|null> & { ref:(target:any) => any }

const INNER_CONFIG_PROP = '$$config'

export class ComponentHost implements Host{
    static typeIds = new Map<Function, number>()
    type: Component
    innerHost?: Host
    props: Props
    public layoutEffects = new Set<EffectHandle>()
    public effects = new Set<EffectHandle>()
    public destroyCallback = new Set<Exclude<ReturnType<EffectHandle>, void>>()
    public layoutEffectDestroyHandles = new Set<Exclude<ReturnType<EffectHandle>, void>>()
    public refs: {[k:string]: any} = reactive({})
    public itemConfig : {[k:string]:ConfigItem} = {}
    public children: any
    public frame?: ManualCleanup[] = []
    public name: string
    public exposed: {[k:string]:any} = {}
    public renderContext?: RenderContext
    deleteLayoutEffectCallback: () => void
    constructor({ type, props = {}, children }: ComponentNode, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        if (!ComponentHost.typeIds.has(type)) {
            ComponentHost.typeIds.set(type, ComponentHost.typeIds.size)
        }

        this.name = type.name
        this.type = type
        this.props = {}

        Object.entries(props).forEach(([key, value]) => {
            if (key === INNER_CONFIG_PROP) {
                this.itemConfig = value
            } else if (key[0] === '$') {
                const [itemName, itemProp] = key.slice(1).split(':')
                if (!this.itemConfig[itemName]) this.itemConfig[itemName] = {}

                if (itemProp === '_eventTarget')  {
                    // 支持 $eventTarget 来转发事件
                    this.itemConfig[itemName].eventTarget = ensureArray(value)
                } else if (itemProp=== '_use'){
                    // 支持 $use 来覆盖整个 element
                    this.itemConfig[itemName].use = value
                } else if (itemProp=== '_props') {
                    // 用户自定义函数合并 props
                    this.itemConfig[itemName].propsMergeHandle = value
                } else if (itemProp=== '_children') {
                    // 用户自定义函数合并 props
                    this.itemConfig[itemName].children = value
                }else if (itemProp=== undefined || itemProp==='') {
                    // 穿透到子组件的 config
                    this.itemConfig[itemName].config = value
                } else if(itemProp?.[0] === '_'){
                    // 不支持的配置项
                    assert(false, `unsupported config item: ${itemName}`)
                } else if( itemProp.endsWith('_') ) {
                    // 支持 $xxx:[prop]_ 来让用户使用函数自定义 merge props
                    if (!this.itemConfig[itemName].propMergeHandles) this.itemConfig[itemName].propMergeHandles = {}
                    this.itemConfig[itemName].propMergeHandles![itemProp.slice(0, -1)] = value

                } else {
                    // 支持 $xxx:[prop] 来覆盖 props
                    if (!this.itemConfig[itemName].props) this.itemConfig[itemName].props = {}
                    this.itemConfig[itemName].props![itemProp] = value
                }

            } else {
                this.props[key] = value
            }
        })
        this.children = children

        this.deleteLayoutEffectCallback = pathContext.root.on('attach', this.runLayoutEffect)
    }
    get typeId() {
        return ComponentHost.typeIds.get(this.type)!
    }
    get parentElement() {
        return this.placeholder.parentElement
    }
    // CAUTION innerHost 可能是动态的，所以 element 也可能会变，因此每次都要实时去读
    get element() : HTMLElement|Comment|SVGElement|Text {
        return this.innerHost?.element || this.placeholder
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

        const selfMergeProps:{[k:string|symbol]:any} = {}

        let finalChildren = children

        // 整理 props
        for(const key in rawProps) {
            if (key.startsWith('$self:')) {
                // 支持自己 props 的 merge，这是因为有的组件包装了其他组件，想 merge props 而不是替换。
                // 写成 $self 的形式默认就是 merge，不用再手动使用 mergeProps 了，可读性也更强。
                selfMergeProps[key.slice(6)] = rawProps[key]
                delete rawProps[key]
            }
        }

        // 支持自己 props 的 merge
        let finalProps:{[k:string|symbol]:any} = mergeProps(rawProps, selfMergeProps)

        const thisItemConfig = this.itemConfig[name]
        if (name && thisItemConfig) {
            // 为了性能，又直接操作了 rawProps
            // 1. 支持正对当前节点的 props 调整
            if (thisItemConfig.props) {
                // CAUTION 普通节点，这里默认适合原来的 props 合并，除非用户想要自己的处理
                if (isComponent) {
                    finalProps = {...rawProps, ...thisItemConfig.props}
                } else {
                    finalProps = mergeProps(rawProps, thisItemConfig.props)
                }
            }
            // 2. 可以针对某个 prop 单独进行重写
            if(thisItemConfig.propMergeHandles) {
                Object.entries(thisItemConfig.propMergeHandles).forEach(([key, handle]) => {
                    finalProps[key] = handle(finalProps[key], finalProps)
                })
            }

            // 3. 可以正对 props 进行整体重写
            if (thisItemConfig.propsMergeHandle) {
                finalProps = thisItemConfig.propsMergeHandle(finalProps)
            }

            // 4. 支持对 children 进行重写
            if (thisItemConfig.children) {
                finalChildren = thisItemConfig.children
            }

            // 5. 支持继续对组件继续透传 config
            if (isComponent && thisItemConfig.config) {
                finalProps = {...finalProps, ...thisItemConfig.config}
            }
        }

        const finalType = (this.itemConfig[name]?.use || type) as Component|string

        // 如果是用 Component 重写了普通的 element，要把 element 上原本用 prop:xxx 标记的属性，转移到 props 上
        //  而原来的 attribute 要转移到 N_ATTR 上，这样组件在内部还能重新利用起来。因为上面可能有 ref 等属性，不用起来会影响原来的功能。
        if(!isComponent && typeof finalType === "function") {
            const propKeys = Object.keys(finalProps || {})

            const componentProps:{[k:string]:any} = {}
            propKeys.forEach(key => {
                if (key.startsWith('prop:')) {
                    componentProps[key.slice(5)] = finalProps[key]
                    delete finalProps[key]
                }
            })

            componentProps[N_ATTR] = finalProps
            finalProps = componentProps
        }

        // 收集 component ref
        if (name && isComponent) {
            finalProps.ref = ensureArray(finalProps.ref).concat((host: Host) => this.refs[name] = host)
        }

        const el = isSVG ? createSVGElement(finalType as string, finalProps, ...finalChildren) : createElement(finalType, finalProps, ...finalChildren)

        // 收集普通  element 的 ref
        if (name && !isComponent) {
            this.refs[name] = el
        }

        return el
    }
    createElement = this.createHTMLOrSVGElement.bind(this, false)
    createSVGElement = this.createHTMLOrSVGElement.bind(this, true)
    createPortal = (content: JSX.Element|ComponentNode|Function, container: HTMLElement) => {
        return createElement(Portal, {container, content})
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
    handleProps(propTypes: NonNullable<Component["propTypes"]>, props: Props) {
        const finalProps: Props = {}
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
    cleanupsOfExternalTarget = new Set<() => void>()
    createStateFromRef = <T>(transform:StateTransformer<T>, options?: any, externalTarget?: any):StateFromRef<T> =>  {
        let lastCleanup: (() => void)|undefined = undefined

        const ref = (target:any) => {
            if (externalTarget && lastCleanup) {
                this.cleanupsOfExternalTarget.delete(lastCleanup)
            }

            lastCleanup?.()

            if (target !== null) {
                lastCleanup = transform(target, stateValue, options)

                if (externalTarget && lastCleanup) {
                    this.cleanupsOfExternalTarget.add(lastCleanup)
                }

            } else {
                // target 为 Null，表示清理
                lastCleanup = undefined
                stateValue(null)
            }
        }

        const stateValue:StateFromRef<T> = new Proxy(atom<T|null>(null), {
            get: (target, key) => {
                if(key === 'ref') {
                    return ref
                }
                return target[key as keyof typeof target]
            }
        }) as StateFromRef<T>


        if (externalTarget) {
            stateValue.ref(externalTarget)
        }

        return stateValue
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
            createStateFromRef: this.createStateFromRef,
            onCleanup: this.onCleanup,
            expose: this.expose
        }

        const {ref: refProp, ...componentProps} = this.props

        const getFrame = ReactiveEffect.collectEffect()
        const finalComponentProps = {
            ...(this.type.boundProps || {}),
            ...(this.type.propTypes ? this.handleProps(this.type.propTypes, componentProps) : componentProps),
            children: this.children
        }

        const node = this.type(finalComponentProps, this.renderContext)
        this.frame = getFrame()

        // 就用当前 component 的 placeholder
        this.innerHost = createHost(node, this.placeholder, {...this.pathContext, hostPath: [...this.pathContext.hostPath, this]})
        this.innerHost.render()

        // CAUTION 一定是渲染之后才调用 ref，这样才能获得 dom 信息。
        if (this.props.ref) {
            this.attachRef(this.props.ref)
        }
        // for test use
        if (this.props.__this) {
            this.attachThis(this.props.__this)
        }

        this.effects.forEach(effect => {
            const handle = effect()
            // 也支持 async function return promise，只不过不做处理
            if (typeof handle === 'function') this.destroyCallback.add(handle)
        })

        // 已经 root attach 了，动态生成的节点，需要手动触发 layoutEffect。因为没有 attach 事件了。
        if (this.pathContext.root.attached) {
            this.runLayoutEffect()
        }
    }
    runLayoutEffect = () => {
        this.layoutEffects.forEach(layoutEffect => {
            const handle = layoutEffect()
            if (typeof handle === 'function') this.layoutEffectDestroyHandles.add(handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (this.props.ref) {
            this.detachRef(this.props.ref)
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

        this.cleanupsOfExternalTarget.forEach(cleanup => cleanup())
        this.cleanupsOfExternalTarget.clear()

        // 删除 dom
        if (!parentHandle) {
            this.placeholder.remove()
        }

        this.deleteLayoutEffectCallback()
    }
}



type FunctionProp = (arg:any) => object
type EventTarget = (arg: (e:Event) => any) => void

type ConfigItem = {
    // 穿透给组件的
    config?: { [k:string]: ConfigItem},
    // 支持覆写 element
    use?: Component|JSX.Element,
    // 将事件转发到另一个节点上
    eventTarget?: EventTarget[],
    // 手动调整内部组件的 props
    props?: {[k:string]: any},
    // 函数手动 merge prop
    propMergeHandles?: {[k:string]: any},

    propsMergeHandle?: FunctionProp,
    // children
    children?: any
}

export class DataContext{
    public valueByType: Map<any, any>
    constructor(public hostPath: Host[]) {
        this.valueByType = new Map<any, any>()
    }
    get(contextType:any) {
        // 找到最近具有 contextType 的 host
        for (let i = this.hostPath.length - 1; i >= 0; i--) {
            const host = this.hostPath[i]
            if (host instanceof ComponentHost) {
                if (host.renderContext!.context.valueByType.has(contextType)) {
                    return host.renderContext!.context.valueByType.get(contextType)
                }
            }
        }
    }
    set(contextType: any, value: any) {
        this.valueByType.set(contextType, value)
    }
}

export const N_ATTR = '__nativeAttrs'

export function bindProps(Component: Component, props: Props,) {
    const ComponentWithProps = Component.bind(null)
    ComponentWithProps.boundProps = {
        ...(ComponentWithProps.boundProps||{}),
        ...props
    }
    return ComponentWithProps
}