import {isReactive, reactive, ReactiveEffect} from "data0";
import {AttributesArg, createElement, createSVGElement, Fragment, JSXElementType, UnhandledPlaceholder} from "./DOM";
import {Context, Host} from "./Host";
import {createHost} from "./createHost";
import {Component, ComponentNode, EffectHandle, Props, RenderContext} from "./types";
import {assert} from "./util";



function ensureArray(o: any) {
    return o ? (Array.isArray(o) ? o : [o]) : []
}

// CAUTION 为了性能，直接 assign。
//  只有事件监听和 ref 被认为是外层需要 merge，其他都是否该
function combineProps(origin:{[k:string]: any}, newProps: {[k:string]: any}) {
    Object.entries(newProps).forEach(([key, value]) => {
        const originValue = origin[key]
        if(key.startsWith('on') || key === 'ref') {
            origin[key] = ensureArray(originValue).concat(value)
        } else {
            origin[key] = value
        }
    })
    return origin
}

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
    public config? : Config
    public children: any
    public frame?: ReactiveEffect[] = []
    public name: string
    deleteLayoutEffectCallback: () => void
    constructor({ type, props, children }: ComponentNode, public placeholder: UnhandledPlaceholder, public context: Context) {
        if (!ComponentHost.typeIds.has(type)) {
            ComponentHost.typeIds.set(type, ComponentHost.typeIds.size)
        }

        this.name = type.name
        this.type = type
        this.props = props
        if(children[0] instanceof Config) {
            this.config = children[0]
        } else {
            this.children = children
        }

        this.deleteLayoutEffectCallback = context.root.on('attach', this.runLayoutEffect)
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

    createElement = (type: JSXElementType, rawProps : AttributesArg, ...children: any[]) : ReturnType<typeof createElement> => {
        const isComponent = typeof type === 'function'
        if(__DEV__) {
            if (!isComponent && rawProps)
                Object.entries(rawProps).forEach(([key, value]) => {
                    assert(!isReactive(value), `don't use reactive or computed for attr: ${key}, simply use function or atom`)
                })
        }

        let name = ''
        if (rawProps) {
            Object.keys(rawProps).some(key => {
                if (key[0] === '$') {
                    name = key.slice(1, Infinity)
                    // 为了性能，直接使用了 delete
                    delete rawProps[key]
                    return true
                } else  if (key === 'as') {
                    name = rawProps[key]
                    delete rawProps[key]
                    return true
                }
            })
        }

        assert(!(name && this.refs[name]), `ref name ${name} already exists`)

        let finalProps = rawProps
        let finalChildren = children
        if (name && this.config?.items[name]) {

            // 为了性能，又直接操作了 rawProps
            const thisItemConfig = this.config!.items[name]
            // 1. 支持正对当前节点的 props 调整
            if (thisItemConfig.props) {
                // CAUTION 普通节点，这里默认适合原来的 props 合并，除非用户想要自己的处理
                if (typeof thisItemConfig.props === 'function') {
                    finalProps = thisItemConfig.props(rawProps)
                } else if(typeof thisItemConfig.props === 'object') {
                    if (isComponent) {
                        finalProps = {...rawProps, ...thisItemConfig.props}
                    } else {
                        finalProps = combineProps(rawProps, thisItemConfig.props)
                    }
                } else {
                    assert(false, 'props should be object or function')
                }
            }

            // 2. 支持 children 和 configure 同时存在
            if (thisItemConfig.children) {
                if (isComponent) {
                    // 支持对 InnerComponent 的穿透 configure
                    finalChildren = [configure(thisItemConfig.children)]
                } else {
                    finalChildren = thisItemConfig.children
                }
            }
        }

        if (name && isComponent) {
            finalProps.ref = (host: Host) => this.refs[name] = host
        }
        const el = createElement(type, finalProps, ...finalChildren)

        if (name && !isComponent) {
            this.refs[name] = el
        }

        return el
    }
    createSVGElement = createSVGElement
    // 处理视图相关的 effect
    useLayoutEffect = (callback: EffectHandle) => {
        this.layoutEffects.add(callback)
    }
    // 处理纯业务相关的 effect，例如建立长连接等
    useEffect = (callback: EffectHandle) => {
        this.effects.add(callback)
    }

    render(): void {
        if (this.element !== this.placeholder) {
            // CAUTION 因为现在没有 diff，所以不可能出现 Component rerender
            assert(false, 'should never rerender')
        }

        // CAUTION 注意这里 children 的写法，没有children 就不要传，免得后面 props 继续往下透传的时候出问题。
        const renderContext: RenderContext = {
            Fragment,
            createElement: this.createElement,
            createSVGElement: this.createSVGElement,
            refs: this.refs,
            useLayoutEffect: this.useLayoutEffect,
            useEffect: this.useEffect,
            context: this.context
        }
        const getFrame = ReactiveEffect.collectEffect()
        const node = this.type({...this.props, children: this.children}, renderContext)
        this.frame = getFrame()

        // 就用当前 component 的 placeholder
        this.innerHost = createHost(node, this.placeholder, {...this.context, hostPath: [...this.context.hostPath, this]})
        this.innerHost.render()

        // CAUTION 一定是渲染之后才调用 ref，这样才能获得 dom 信息。
        if (this.props.ref) {
            assert(typeof this.props.ref === 'function', `ref on component should be a function after parent component handled`)
            this.props.ref(this)
        }
        this.effects.forEach(effect => {
            const handle = effect()
            // 也支持 async function return promise，只不过不做处理
            if (typeof handle === 'function') this.destroyCallback.add(handle)
        })
    }
    runLayoutEffect = () => {
        this.layoutEffects.forEach(layoutEffect => {
            const handle = layoutEffect()
            if (typeof handle === 'function') this.layoutEffectDestroyHandles.add(handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            // 如果上层是 computed rerun，那么也会清理掉我们产生的 computed。但不能确定，所以这里还是自己清理一下。
            this.frame?.forEach(effect =>
                ReactiveEffect.destroy(effect)
            )
        }
        // CAUTION 注意这里， ComponentHost 自己是不处理 dom 的。
        this.innerHost!.destroy(parentHandle, parentHandleComputed)
        this.layoutEffectDestroyHandles.forEach(handle => handle())
        this.destroyCallback.forEach(callback => callback())
        if (!parentHandle) {
            this.placeholder.remove()
        }

        if (this.props.ref) {
            assert(typeof this.props.ref === 'function', `ref on component should be a function after parent component handled`)
            this.props.ref(null)
        }

        this.deleteLayoutEffectCallback()
    }
}

type FunctionProp = (arg:any) => object
type EventTarget = (arg: (e:Event) => any) => void

type ConfigItem = {
    // 将事件转发到另一个节点上
    eventTarget?: EventTarget[],
    // 手动调整内部组件的 props
    props?: object|FunctionProp,
    // children
    children?: any
}

class Config {
    constructor(public items: {[k:string]:ConfigItem}) {}
}

export function configure(items: {[k:string]:ConfigItem}) {
    return new Config(items)
}