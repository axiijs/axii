import {Atom, ManualCleanup, ReactiveEffect} from "data0";
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
import {
    Component,
    ComponentNode,
    CreateElementFn,
    CreateSVGElementFn,
    EffectHandle,
    ExposeFn,
    OnCleanupFn,
    Props,
    RenderContext,
    ReuseFn,
    UseEffectFn,
    UseLayoutEffectFn,
} from "./types";
import {assert} from "./util";
import {Portal} from "./Portal.js";
import {createRef, createRxRef} from "./ref.js";
import {createLinkedNode, LinkedNode} from "./LinkedList";
import {markDynamicProp, isDynamicProp, markBoundProp, isBoundProp, markAopProp} from "./StaticHost";
import {trackHostDestroyed} from "./retainedObjectDiagnostics.js";
import {assertRangeReachable, isAxiiDiagnosticsEnabled, withReactiveTrace} from "./diagnostics";


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
    // CAUTION 事件必须用 /^on[A-Z]/ 判断，startsWith('on') 会误伤 once/onlyIcon 这类普通 prop；
    //  JSX 中的 className 是驼峰写法，小写 'classname' 永远匹配不上。
    if(originValue && (/^on[A-Z]/.test(key) || key === 'ref'|| key==='style' || key==='className' || key==='class')) {
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

interface PropsWithConfig {
  props: Props,
  itemConfig: Record<string, ConfigItem>,
  componentProp: Props,
}

const INNER_CONFIG_PROP = '__config__'

// 无 AOP 配置的组件共享同一个空 itemConfig，避免每个组件实例保留一个空对象
const EMPTY_ITEM_CONFIG: Record<string, ConfigItem> = {}
const EMPTY_COMPONENT_PROP: Props = {}

// createPortal 不依赖组件实例，所有组件共享同一个函数
function createPortalShared(content: JSX.Element|ComponentNode|Function, container: HTMLElement) {
    return createElement(Portal, {container, content})
}
/**
 * @internal
 */
export class ComponentHost implements Host{
    // CAUTION WeakMap + 计数器而不是 Map + size：bindProps/lazy/HOC 每次调用都会产生新的
    //  组件函数，普通 Map 会把这些函数永久 pin 住（样式 id 注册表无上限增长）。
    static typeIds = new WeakMap<Function, number>()
    static nextTypeId = 0
    type: Component
    public innerHost?: Host
    // CAUTION 以下所有容器/闭包字段全部惰性分配：一个典型的小组件（不用
    //  effect/ref/expose/context/reusable）不应该为这些"可能用到的能力"付常驻内存。
    innerReusedHosts?: ReusableHost[]
    props!: Props
    public layoutEffects?: Set<EffectHandle>
    public effects?: Set<EffectHandle>
    public destroyCallback?: Set<Exclude<ReturnType<EffectHandle>, void>>
    public layoutEffectDestroyHandles?: Set<Exclude<ReturnType<EffectHandle>, void>>
    _refs?: {[k:string]: any}
    public itemConfig!: {[k:string]:ConfigItem}
    public children: any
    public frame?: ManualCleanup[]
    public name: string
    _exposed?: {[k:string]:any}
    public renderContext?: RenderContext
    // context.set 的存储，只有真正用到 context 的组件才会分配（见 ensureDataContext）
    dataContext?: DataContext
    public refProp?: RefObject|RefFn
    public thisProp?: RefObject|RefFn
    public inputProps: Props
    deleteLayoutEffectCallback?: () => void
    // 惰性缓存的 renderContext 闭包（只有组件解构对应能力时才分配）
    _createElement?: CreateElementFn
    _createSVGElement?: CreateSVGElementFn
    _useLayoutEffect?: UseLayoutEffectFn
    _useEffect?: UseEffectFn
    _onCleanup?: OnCleanupFn
    _expose?: ExposeFn
    _reusable?: ReuseFn
    constructor({ type, props: inputProps = {}, children }: ComponentNode, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        if (!ComponentHost.typeIds.has(type)) {
            ComponentHost.typeIds.set(type, ComponentHost.nextTypeId++)
        }

        this.name = type.name
        this.type = type
        this.refProp = inputProps.ref
        this.thisProp = inputProps.__this
        this.inputProps = inputProps
        this.children = children
    }
    get refs(): {[k:string]: any} {
        return this._refs ??= {}
    }
    get exposed(): {[k:string]: any} {
        return this._exposed ??= {}
    }
    ensureDataContext(): DataContext {
        return this.dataContext ??= new DataContext(this.pathContext.hostPath)
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
                // 不支持的配置项，报错信息要指出非法的配置项名（itemProp），而不是元素名
                assert(false, `unsupported config item "${itemProp}" of "${itemName}"`)
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
    // CAUTION 必须把内层的 forceHandleElement（离场动画等）透传出来，
    //  否则 RxListHost 的整段快速删除会跳过包在组件里的离场动画。
    get forceHandleElement(): boolean {
        return !!this.innerHost?.forceHandleElement
    }

    separateProps(rawProps: AttributesArg) {
        const props: Props = {}
        const componentProps: Props = {}
        const selfMergeProps: Props = {}
        let hasSelfMergeProps = false
        for(const key in rawProps) {
            if (key.startsWith('prop:')) {
                componentProps[key.slice(5)] = rawProps[key]
            } else if (key.startsWith('$self:')) {
                // 支持自己 props 的 merge，这是因为有的组件包装了其他组件，想 merge props 而不是替换。
                // 写成 $self 的形式默认就是 merge，不用再手动使用 mergeProps 了，可读性也更强。
                selfMergeProps[key.slice(6)] = rawProps[key]
                hasSelfMergeProps = true
            } else {
                props[key] = rawProps[key]
            }
        }

        // merge props and selfMergeProps
        if (hasSelfMergeProps) {
            this.parseAndMergeProps({props, itemConfig:{}, componentProp: componentProps}, selfMergeProps)
        }
        return {props, componentProps}
    }
    // 判断 rawProps 中是否有需要 separateProps 处理的前缀 key（prop: / $self:）
    static hasPrefixedProps(rawProps: AttributesArg) {
        for (const key in rawProps) {
            const first = key.charCodeAt(0)
            // 'p' === 112, '$' === 36，先做单字符判断避免大量 startsWith
            if ((first === 112 && key.startsWith('prop:')) || (first === 36 && key.startsWith('$self:'))) return true
        }
        return false
    }
    static hasEventProps(rawProps: AttributesArg) {
        for (const key in rawProps) {
            if (key[0] === 'o' && key[1] === 'n') return true
        }
        return false
    }
    // 缓存当前组件路径上的所有组件 props，事件绑定参数用。同一个组件内所有元素相同。
    cachedContextComponentProps?: any[]
    getContextComponentProps() {
        if (!this.cachedContextComponentProps) {
            const contextComponentProps: any[] = []
            let start: LinkedNode<Host>|null = this.pathContext.hostPath
            while(start){
                if (start.node instanceof ComponentHost) {
                    contextComponentProps.push((start.node as ComponentHost).props)
                }
                start = start.prev
            }
            this.cachedContextComponentProps = contextComponentProps
        }
        return this.cachedContextComponentProps
    }
    createHTMLOrSVGElement(isSVG: boolean, type: JSXElementType, rawProps : AttributesArg, ...children: any[]) : ReturnType<typeof createElement> {
        const isComponent = typeof type === 'function'

        const name = rawProps ? rawProps['as'] : undefined

        // 快速路径：没有 as 名称、不是组件、也没有 prop:/$self: 前缀 key 的普通元素，
        //  不需要 separateProps/itemConfig/AOP 的任何处理。
        if (!name && !isComponent) {
            if (!rawProps || !ComponentHost.hasPrefixedProps(rawProps)) {
                const node = isSVG ?
                    createSVGElement(type as string, rawProps, ...children) :
                    createElement(type, rawProps, ...children)
                // 事件参数只在存在事件监听时才需要
                if (rawProps && ComponentHost.hasEventProps(rawProps)) {
                    (node as ExtendedElement).listenerBoundArgs = [this.getContextComponentProps(), {}]
                }
                return node
            }
        }

        // 为了性能，直接操作了 rawProps
        if (name !== undefined) delete rawProps['as']
        assert(name !=='self', '"self" is reserved, please use another element name.')

        // 支持 use 里面直接传入 HTMLElement 覆写整个节点
        if (name && this.itemConfig[name]?.use && this.itemConfig[name]?.use instanceof Element) {
            return this.itemConfig[name]!.use as HTMLElement
        }


        let finalChildren = children

        let {props: finalProps, componentProps} = this.separateProps(rawProps)

        const thisItemConfig = this.itemConfig[name]
        if (name && thisItemConfig) {
            // 1. 使用 :[prop] 语法  对当前节点的 props 调整
            if (thisItemConfig.props) {
                // CAUTION 这里必须基于 separateProps 处理过的 finalProps 合并，
                //  不能用 rawProps，否则 prop:/$self: 前缀的 key 会以原始形态混回 props。
                if (isComponent) {
                    finalProps = {...finalProps, ...thisItemConfig.props}
                } else {
                    finalProps = mergeProps(finalProps, thisItemConfig.props)
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
            (node as ExtendedElement).listenerBoundArgs = [this.getContextComponentProps(), componentProps]
        }

        return node
    }
    // CAUTION 下面这些都是惰性分配的 renderContext 能力闭包：只在组件真正解构/使用时创建
    get createElement(): CreateElementFn {
        return this._createElement ??= this.createHTMLOrSVGElement.bind(this, false)
    }
    get createSVGElement(): CreateSVGElementFn {
        return this._createSVGElement ??= this.createHTMLOrSVGElement.bind(this, true) as CreateSVGElementFn
    }
    get createPortal() {
        return createPortalShared
    }
    get reusable(): ReuseFn {
        return this._reusable ??= (reusableNode: any) => {
            const reusedHost = new ReusableHost(reusableNode, new Comment('reusable'), this.pathContext)
            ;(this.innerReusedHosts ??= []).push(reusedHost)
            return reusedHost
        }
    }
    // 处理视图相关的 effect
    get useLayoutEffect(): UseLayoutEffectFn {
        return this._useLayoutEffect ??= (callback: EffectHandle) => {
            (this.layoutEffects ??= new Set()).add(callback)
        }
    }
    // 处理纯业务相关的 effect，例如建立长连接等
    get useEffect(): UseEffectFn {
        return this._useEffect ??= (callback: EffectHandle) => {
            (this.effects ??= new Set()).add(callback)
        }
    }
    get createRef() {
        return createRef
    }
    get createRxRef() {
        return createRxRef
    }
    normalizePropsByPropTypes(propTypes: NonNullable<Component["propTypes"]>, props: Props) {
        const finalProps: Props = {...props}
        // TODO dev 模式下类型检查
        Object.entries(propTypes).forEach(([key, type]) => {
           if (props[key] !== undefined) {
               // coerce
               // CAUTION 不能写成 coerce(v) || v，coerce 返回合法的 falsy 值（0/''/false）会被吞掉
               finalProps[key] = type.coerce ? type.coerce(props[key]) : props[key]
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
                // CAUTION 不能写成 coerce(v) || v，coerce 返回合法的 falsy 值（0/''/false）会被吞掉
                finalProps[key] = type.coerce ? type.coerce(props[key]) : props[key]
            }
        })
        return finalProps
    }
    attachRef(ref: RefObject|RefFn) {
        const refValue = {
            ...this._exposed,
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
    get expose(): ExposeFn {
        return this._expose ??= ((value:any, name?: string) => {
            if (typeof value === 'object' && name === undefined) {
                // kv 形式的 expose
                Object.assign(this.exposed, value)
            } else if( typeof name === 'string'){
                // 单个 expose
                this.exposed[name] = value
            }

            return value
        }) as ExposeFn
    }
    get onCleanup(): OnCleanupFn {
        return this._onCleanup ??= (callback: () => any) => {
            (this.destroyCallback ??= new Set()).add(callback)
        }
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
    evaluatePostBoundProps(inputProps:Props, renderContext:RenderContext) {
        return (this.type.postBoundProps || []).map(b => {
            if (typeof b === 'function') {
                return markDynamicProp(markBoundProp(b(inputProps, renderContext!)))
            }
            return markBoundProp(b)
        })
    }
    parseAndMergeProps(last: PropsWithConfig, current: Props): PropsWithConfig {
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
    // 判断 props 中是否有 $ 前缀的 AOP 配置 key
    static hasConfigProps(props: Props) {
        for (const key in props) {
            if (key.charCodeAt(0) === 36) return true // '$'
        }
        return false
    }
    getFinalPropsAndItemConfig(): PropsWithConfig {
        // 快速路径：没有 boundProps/postBoundProps/透传 config/$ 前缀 key 的普通组件（绝大多数），
        //  不需要 evaluate/concat/reduce 的整套合并流程，itemConfig 直接共享空对象。
        const type = this.type
        if (!type.boundProps && !type.postBoundProps &&
            !this.inputProps[INNER_CONFIG_PROP] &&
            !ComponentHost.hasConfigProps(this.inputProps)) {
            const props = type.propTypes ?
                this.normalizePropsByPropTypes(type.propTypes, this.inputProps) :
                {...this.inputProps}
            return { props, itemConfig: EMPTY_ITEM_CONFIG, componentProp: EMPTY_COMPONENT_PROP }
        }

        const inputPropsWithDefaultValue = this.type.propTypes ? this.normalizePropsByPropTypes(this.type.propTypes, this.inputProps) : this.inputProps
        const evaluatedBoundProps = this.evaluateBoundProps(inputPropsWithDefaultValue, this.renderContext!)

        // CAUTION boundProps 的优先级是低于 inputProps，但这里 boundProps 还是可以拿到 inputProps 的值是因为
        //  它需要和 inputProps 里面通用的引用，例如 form 状态。
        // 优先级：postBoundProps > configProps(AOP props) > boundProps > inputProps
        const allPropsBeforePostBound = evaluatedBoundProps.concat(inputPropsWithDefaultValue, ...(this.inputProps[INNER_CONFIG_PROP]||[]))
        const resultBeforePostBound = allPropsBeforePostBound.reduce<PropsWithConfig>((acc, props) => this.parseAndMergeProps(acc, props), { props: {}, itemConfig: {}, componentProp: {} })
        
        // 在 AOP props 之后，再评估和应用 postBoundProps
        // CAUTION postBoundProps 的函数参数应该能拿到 AOP 之后的 props，所以传入 resultBeforePostBound.props
        const propsAfterAOP = resultBeforePostBound.props
        const evaluatedPostBoundProps = this.evaluatePostBoundProps(propsAfterAOP, this.renderContext!)
        return evaluatedPostBoundProps.reduce<PropsWithConfig>((acc, props) => this.parseAndMergeProps(acc, props), resultBeforePostBound)
    }
    render(): void {
        if (this.element !== this.placeholder) {
            // CAUTION 因为现在没有 diff，所以不可能出现 Component rerender
            assert(false, 'should never rerender')
        }

        // CAUTION renderContext 是一个全 getter 的轻量包装：组件只为它真正解构的能力付费
        //  （闭包/refs 对象/DataContext 都在第一次访问时才分配）。
        this.renderContext = new ComponentRenderContext(this)

        withReactiveTrace({
            type: 'component-render',
            operation: 'render',
            hostType: 'ComponentHost',
            elementPath: this.pathContext.elementPath,
            source: this.pathContext.debugSource,
        }, () => {
            // CAUTION collect effects start
            const getFrame = ReactiveEffect.collectEffect()
            let node: ReturnType<Component>|null = null
            try {
                const { props: componentProps, itemConfig } = this.getFinalPropsAndItemConfig()
                this.itemConfig = itemConfig
                // 这里要再 coerce props，因为 boundProps 可能 return fixed value
                const normalizedProps = this.type.propTypes ? this.normalizePropsWithCoerceValue(this.type.propTypes, componentProps) : componentProps

                normalizedProps.children = this.children
                this.props = normalizedProps

                node = this.type(normalizedProps, this.renderContext!)
            } catch (e) {
                // 组件 render 抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并把该区域渲染为空，
                // 否则保持向上抛出的行为。
                if (!this.pathContext.root.dispatch('error', e)) throw e
            } finally {
                // CAUTION 无论组件是否抛错，都必须弹出 collect frame，
                //  否则 collect frame 栈会错位，后续渲染收集的 effect 会泄漏到错误的 frame 里。
                //  空 frame 不保留（多数组件 render 中不创建 computed），省一个常驻数组。
                const frame = getFrame()
                if (frame.length) this.frame = frame
            }
            // CAUTION collect effects end
            // 就用当前 component 的 placeholder
            this.innerHost = createHost(node, this.placeholder, {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)})
            this.innerHost.render()
        })


        // for test use
        /* v8 ignore next 3 */
        if (this.thisProp) {
            this.attachThis(this.thisProp)
        }

        this.effects?.forEach(effect => {
            const handle = effect()
            // 也支持 async function return promise，只不过不做处理
            if (typeof handle === 'function') (this.destroyCallback ??= new Set()).add(handle)
        })

        // 没有 layoutEffect 也没有 ref 的组件（绝大多数）完全不需要参与 attach 流程
        if (this.layoutEffects || this.refProp) {
            // 已经 root attach 了，动态生成的节点，需要手动触发 layoutEffect。因为没有 attach 事件了。
            if (this.pathContext.root.attached) {
                this.runLayoutEffect()
            } else {
                // CAUTION 一定要保存退订函数，组件如果在 root attach 之前被销毁，
                //  必须退订，否则 attach 时会对已销毁的组件执行 layoutEffect/ref。
                this.deleteLayoutEffectCallback = this.pathContext.root.on('attach', () => this.runLayoutEffect(), {once: true})
            }
        }
    }
    runLayoutEffect() {
        // CAUTION 一定是渲染之后才调用 ref，这样才能获得 dom 信息。
        if (this.refProp) {
            this.attachRef(this.refProp)
        }

        this.layoutEffects?.forEach(layoutEffect => {
            const handle = layoutEffect()
            if (typeof handle === 'function') (this.layoutEffectDestroyHandles ??= new Set()).add(handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        trackHostDestroyed(this)
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
        // innerHost 可能不存在（render 抛错被中断的场景）
        this.innerHost?.destroy(parentHandle, parentHandleComputed)
        this.layoutEffectDestroyHandles?.forEach(handle => handle())
        this.destroyCallback?.forEach(callback => callback())

        this.innerReusedHosts?.forEach(host => host.destroyReusable())

        // 删除 dom
        // CAUTION placeholder 与 innerHost 共享，innerHost 自己会负责移除
        //  （有离场动画时是异步移除），这里不能提前移除，否则异步移除时区间已不完整。
        //  只有 render 抛错导致 innerHost 不存在时才需要自己清理。
        if (!parentHandle && !this.innerHost) {
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
    // CAUTION 惰性创建：只有真正 set 过 context 的组件（Provider）才分配 Map
    _valueByType?: Map<any, any>
    constructor(public hostPath: LinkedNode<Host>) {
    }
    get valueByType(): Map<any, any> {
        return this._valueByType ??= new Map<any, any>()
    }
    get(contextType:any) {
        // 找到最近具有 contextType 的 host
        // CAUTION 直接读 ComponentHost.dataContext 而不是 renderContext.context：
        //  后者是惰性 getter，读取会给沿途每个祖先组件分配 DataContext
        let start: LinkedNode<Host>|null = this.hostPath
        while(start) {
            if (start.node instanceof ComponentHost) {
                const valueByType = start.node.dataContext?._valueByType
                if (valueByType?.has(contextType)) {
                    return valueByType.get(contextType)
                }
            }
            start = start.prev
        }
    }
    set(contextType: any, value: any) {
        this.valueByType.set(contextType, value)
    }
}

/**
 * @internal
 *
 * 传给组件函数的第二个参数。全部成员都是 getter：组件解构哪个能力，才为哪个能力分配
 * 闭包/对象。典型的小组件只解构 createElement，整个 context 的常驻成本就是这一个
 * wrapper 对象 + 一个 bind 闭包。
 */
export class ComponentRenderContext implements RenderContext {
    constructor(public host: ComponentHost) {}
    get Fragment() {
        return Fragment
    }
    get createElement(): CreateElementFn {
        return this.host.createElement
    }
    get createSVGElement(): CreateSVGElementFn {
        return this.host.createSVGElement
    }
    get refs() {
        return this.host.refs
    }
    get useLayoutEffect(): UseLayoutEffectFn {
        return this.host.useLayoutEffect
    }
    get useEffect(): UseEffectFn {
        return this.host.useEffect
    }
    get pathContext() {
        return this.host.pathContext
    }
    get context(): DataContext {
        return this.host.ensureDataContext()
    }
    get createPortal() {
        return this.host.createPortal
    }
    get createRef() {
        return createRef
    }
    get createRxRef() {
        return createRxRef
    }
    get onCleanup(): OnCleanupFn {
        return this.host.onCleanup
    }
    get expose(): ExposeFn {
        return this.host.expose
    }
    get reusable(): ReuseFn {
        return this.host.reusable
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
            // CAUTION 手写 nextSibling 循环在区间被外部破坏时会 appendChild(null) 直接 TypeError，
            //  开发期先做可达性校验，把它变成可解释的 AxiiError。
            if (isAxiiDiagnosticsEnabled()) {
                assertRangeReachable({
                    ownerHost: this,
                    start: this.innerHost.element,
                    end: this.innerHost.placeholder,
                    boundaryKind: 'reusable-range',
                    operation: 'move',
                })
            }
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
            if (isAxiiDiagnosticsEnabled()) {
                assertRangeReachable({
                    ownerHost: this,
                    start: this.innerHost.element,
                    end: this.innerHost.placeholder,
                    boundaryKind: 'reusable-range',
                    operation: 'destroy',
                })
            }
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
