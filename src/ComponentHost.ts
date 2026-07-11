import {Atom, ManualCleanup, ReactiveEffect} from "data0";
import {
    AttributesArg,
    createElement,
    createSVGElement,
    dispatchEvent,
    ExtendedElement,
    Fragment,
    insertBefore,
    isEventName,
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
    // CAUTION 事件判定统一用 isEventName（on + 大写字母），startsWith('on') 会误伤
    //  once/onlyIcon 这类普通 prop；同一分类谓词只保留一份，行为分叉就是新的 bug 面。
    //  JSX 中的 className 是驼峰写法，小写 'classname' 永远匹配不上。
    if(originValue && (isEventName(key) || key === 'ref'|| key==='style' || key==='className' || key==='class')) {
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
  // 已经被 normalizePropsByPropTypes coerce 过的输入 props（render 里第二次 coerce 时
  //  用来跳过原样保留的输入值，避免非幂等 coerce 被执行两次）
  precoerced?: Props,
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
    // getter 而不是构造期拷贝的字段：只有诊断/调试读它，不值得每实例占一个槽位
    public get name(): string {
        return this.type.name
    }
    _exposed?: {[k:string]:any}
    public renderContext?: RenderContext
    // context.set 的存储，只有真正用到 context 的组件才会分配（见 ensureDataContext）
    dataContext?: DataContext
    // CAUTION 命名子组件（as=xxx）的 ref 会被合并成数组（用户 ref + 内部 refs[name] 收集回调）
    //  declare + 构造器条件赋值：绝大多数组件没有 ref/__this，不为它们付实例槽位
    declare public refProp?: RefObject|RefFn|(RefObject|RefFn)[]
    declare public thisProp?: RefObject|RefFn
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
    // 仅 async effect 实例按需分配；组件销毁后使尚未 settle 的 Promise 静默失活。
    asyncEffectState?: {active: boolean}
    constructor({ type, props: inputProps = {}, children }: ComponentNode, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        if (!ComponentHost.typeIds.has(type)) {
            ComponentHost.typeIds.set(type, ComponentHost.nextTypeId++)
        }

        this.type = type
        if (inputProps.ref) this.refProp = inputProps.ref
        if (inputProps.__this) this.thisProp = inputProps.__this
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
            // CAUTION 只在第一个 ':' 处切分，itemProp 自身可能还含 ':'：
            //  - $a:$b:prop 这类嵌套 AOP key（itemProp = '$b:prop'，由目标子组件自己解析）
            //  - $icon:xlink:href 这类带 namespace 的属性名（itemProp = 'xlink:href'）
            //  用 split(':') 一刀切会静默丢掉第二个 ':' 之后的部分。
            const separatorIndex = key.indexOf(':')
            const itemName = separatorIndex === -1 ? key.slice(1) : key.slice(1, separatorIndex)
            const itemProp = separatorIndex === -1 ? undefined : key.slice(separatorIndex + 1)
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
            } else if( itemProp[0] !== '$' && itemProp.endsWith('_') ) {
                // 支持 $xxx:[prop]_ 来让用户使用函数自定义 merge props
                // CAUTION 嵌套 AOP key（$a:$b:xxx_）不在这一层解析，
                //  作为普通 prop 落到下面的分支，由目标子组件自己解析。
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
            // CAUTION 不能复用 parseAndMergeProps：它会把 $ 前缀的 key 解析进（这里被丢弃的）
            //  临时 itemConfig。$self:$inner:xxx 这类嵌套 AOP 配置应该作为普通 prop 合并进 props，
            //  由目标（子组件）自己去解析。
            for (const key in selfMergeProps) {
                props[key] = mergeProp(key, props[key], selfMergeProps[key])
            }
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
                    // CAUTION 就地修改 origin、不 return 也是 merge 函数的自然写法，
                    //  返回 undefined 时回退到累积值（要显式清掉 prop 用 () => null）。
                    finalProps[key] = handles.reduce((acc, handle) => handle(acc, componentProps) ?? acc, finalProps[key])
                })
            }

            // 3. 使用:_props 可以正对 props 进行整体重写
            if (thisItemConfig.propsMergeHandle) {
                // TODO 这里的 componentProps 需不要 N_ATTR?
                // CAUTION 就地修改 props、不 return 是 merge 函数的自然写法（(props) => { props.x = 1 }），
                //  返回 undefined 时必须回退到累积值，否则后续对 finalProps 的所有读取直接 TypeError。
                finalProps = thisItemConfig.propsMergeHandle.reduce((acc, handle) => handle(acc, componentProps) ?? acc, finalProps)
            }

            // 4. 支持对 children 进行重写
            if (thisItemConfig.children) {
                // CAUTION children 会被展开传入 createElement（...finalChildren），
                //  用户传单个节点（$name:_children={<b/>} 是自然写法）时必须包成数组，
                //  否则展开非 iterable 直接 TypeError。
                finalChildren = ensureArray(thisItemConfig.children)
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

            // 6. 支持 $name:_eventTarget 把外部事件转发到该元素：
            //  用户拿到的 dispatch 回调会克隆事件（原事件可能已完成派发，不能直接重派），
            //  并直接走元素的 eventProxy（keydown 等事件无法用 node.dispatchEvent 真实模拟）。
            if (thisItemConfig?.eventTarget?.length) {
                const targetNode = node as ExtendedElement
                thisItemConfig.eventTarget.forEach(receiveDispatch => receiveDispatch((sourceEvent: Event) => {
                    const EventConstructor = sourceEvent.constructor as typeof Event
                    return dispatchEvent(targetNode, new EventConstructor(sourceEvent.type, sourceEvent))
                }))
            }
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
            // CAUTION 子树的 pathContext 必须像普通 innerHost 一样包含本组件自身：
            //  reusable 内容语义上属于本组件，组件 set 的 context（Form/ContextProvider 场景）
            //  对它必须可见。直接用 this.pathContext（父级路径）会让 DataContext.get
            //  沿 hostPath 静默跳过本组件，reusable 里的子组件拿不到 context 且没有任何报错。
            const childContext: PathContext = {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)}
            const reusedHost = new ReusableHost(reusableNode, new Comment('reusable'), childContext)
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
               // CAUTION 没有声明默认值时不能写入显式的 undefined key：这个幽灵 key 会在
               //  boundProps 合并（bound 在前、input 在后按覆盖合并）时把 bindProps 提供的值
               //  覆盖成 undefined，组件拿不到 bound 值且没有任何报错。
               const defaultValue = type.defaultValue
               if (defaultValue !== undefined) finalProps[key] = defaultValue
           }
        })
        return finalProps
    }
    normalizePropsWithCoerceValue(propTypes: NonNullable<Component["propTypes"]>, props: Props, precoerced?: Props) {
        const finalProps: Props = {...props}
        Object.entries(propTypes).forEach(([key, type]) => {
            if (props[key] !== undefined) {
                // CAUTION 输入值在 normalizePropsByPropTypes 里已经 coerce 过一次，原样保留到
                //  这里的（=== precoerced 的同 key 值）绝不能再 coerce：coerce 不一定幂等
                //  （coerce: v => [v] 这类包装写法会变成双层包装，值静默错误）。
                //  这里只需要 coerce boundProps/AOP 合并出来的新值。
                if (precoerced && props[key] === precoerced[key]) return
                // CAUTION 不能写成 coerce(v) || v，coerce 返回合法的 falsy 值（0/''/false）会被吞掉
                finalProps[key] = type.coerce ? type.coerce(props[key]) : props[key]
            }
        })
        return finalProps
    }
    attachRef(ref: RefObject|RefFn|(RefObject|RefFn)[]) {
        // CAUTION 命名子组件（as=xxx）的 ref 会被 createHTMLOrSVGElement 合并成数组
        //  （用户 ref + 内部收集 refs[name] 的回调），必须逐个附加，
        //  否则用户 ref 拿不到值、父组件的 refs[name] 也不会被填充。
        if (Array.isArray(ref)) {
            ref.forEach(r => this.attachRef(r))
            return
        }
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
    detachRef(ref: RefObject|RefFn|(RefObject|RefFn)[]) {
       if (Array.isArray(ref)) {
           ref.forEach(r => this.detachRef(r))
           return
       }
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
                // CAUTION 函数返回 falsy（cond ? {...} : undefined 的条件写法）视为空 props，
                //  不能直接对 undefined/false 做 defineProperty（TypeError）。
                return markDynamicProp(markBoundProp(b(inputProps, renderContext!) || {}))
            }
            return markBoundProp(b)
        })
    }
    evaluatePostBoundProps(inputProps:Props, renderContext:RenderContext) {
        return (this.type.postBoundProps || []).map(b => {
            if (typeof b === 'function') {
                return markDynamicProp(markBoundProp(b(inputProps, renderContext!) || {}))
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
                // CAUTION $self: 在组件 renderContext 的 createElement（separateProps）里已被消费；
                //  classic pragma / automatic runtime 等不经过组件包装的入口（root.render 的顶层
                //  JSX）会把它原样送进 inputProps。语义必须与组件内一致：merge 进自身 props——
                //  否则它会落进 itemConfig['self']（'self' 是保留名，永远不会被应用），静默丢失。
                //  嵌套形态 $self:$inner:xxx 与包装路径一致：作为自身的 AOP 配置继续解析。
                if (key.startsWith('$self:')) {
                    const selfKey = key.slice(6)
                    if (selfKey[0] === '$') {
                        last.itemConfig = this.parseItemConfigFromProp(last.itemConfig, selfKey, value, current)
                    } else {
                        last.props[selfKey] = mergeProp(selfKey, last.props[selfKey], value)
                    }
                } else {
                    last.itemConfig = this.parseItemConfigFromProp(last.itemConfig, key, value, current)
                }
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
            // 快速路径下 props 全部来自（已 coerce 的）输入，render 里不需要第二次 coerce
            return { props, itemConfig: EMPTY_ITEM_CONFIG, componentProp: EMPTY_COMPONENT_PROP, precoerced: props }
        }

        const inputPropsWithDefaultValue = this.type.propTypes ? this.normalizePropsByPropTypes(this.type.propTypes, this.inputProps) : this.inputProps
        const evaluatedBoundProps = this.evaluateBoundProps(inputPropsWithDefaultValue, this.renderContext!)

        // CAUTION propTypes 默认值必须是最低优先级：它只是「谁都没提供时的兜底」，
        //  不是用户输入。默认值混在 inputProps 里按输入合并的话，bindProps 提供的值会被
        //  声明的默认值静默覆盖（bindProps(Comp, {size:'large'}) + default 'medium' 得到
        //  'medium'）。这里把默认值填充的 key 拆出来放到合并序列最前面。
        //  boundProps 的求值函数仍然收到含默认值的完整 inputProps（引用同一批默认值实例）。
        let defaultsOnlyProps: Props | undefined
        let realInputProps = inputPropsWithDefaultValue
        if (this.type.propTypes) {
            for (const key in this.type.propTypes) {
                if (this.inputProps[key] === undefined && inputPropsWithDefaultValue[key] !== undefined) {
                    if (!defaultsOnlyProps) {
                        defaultsOnlyProps = {}
                        realInputProps = {...inputPropsWithDefaultValue}
                    }
                    defaultsOnlyProps[key] = inputPropsWithDefaultValue[key]
                    delete realInputProps[key]
                }
            }
        }

        // CAUTION boundProps 的优先级是低于 inputProps，但这里 boundProps 还是可以拿到 inputProps 的值是因为
        //  它需要和 inputProps 里面通用的引用，例如 form 状态。
        // 优先级：postBoundProps > configProps(AOP props) > inputProps > boundProps > propTypes 默认值
        const allPropsBeforePostBound = (defaultsOnlyProps ? [defaultsOnlyProps] : [] as Props[])
            .concat(evaluatedBoundProps, realInputProps, ...(this.inputProps[INNER_CONFIG_PROP]||[]))
        const resultBeforePostBound = allPropsBeforePostBound.reduce<PropsWithConfig>((acc, props) => this.parseAndMergeProps(acc, props), { props: {}, itemConfig: {}, componentProp: {} })
        
        // 在 AOP props 之后，再评估和应用 postBoundProps
        // CAUTION postBoundProps 的函数参数应该能拿到 AOP 之后的 props，所以传入 resultBeforePostBound.props
        const propsAfterAOP = resultBeforePostBound.props
        const evaluatedPostBoundProps = this.evaluatePostBoundProps(propsAfterAOP, this.renderContext!)
        const result = evaluatedPostBoundProps.reduce<PropsWithConfig>((acc, props) => this.parseAndMergeProps(acc, props), resultBeforePostBound)
        // 原样保留的输入值（已 coerce）在 render 的第二次 coerce 中按引用跳过
        result.precoerced = inputPropsWithDefaultValue
        return result
    }
    render(): void {
        if (this.element !== this.placeholder) {
            // CAUTION 因为现在没有 diff，所以不可能出现 Component rerender
            assert(false, 'should never rerender')
        }

        // CAUTION renderContext 是一个全 getter 的轻量包装：组件只为它真正解构的能力付费
        //  （闭包/refs 对象/DataContext 都在第一次访问时才分配）。
        this.renderContext = new ComponentRenderContext(this)

        let renderFailed = false
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
                const { props: componentProps, itemConfig, precoerced } = this.getFinalPropsAndItemConfig()
                this.itemConfig = itemConfig
                // 这里要再 coerce props，因为 boundProps/AOP 可能 return fixed value；
                // 已在 normalizePropsByPropTypes 里 coerce 过的输入值按引用跳过（coerce 不一定幂等）
                const normalizedProps = (this.type.propTypes && componentProps !== precoerced) ?
                    this.normalizePropsWithCoerceValue(this.type.propTypes, componentProps, precoerced) :
                    componentProps

                // CAUTION JSX 使用点提供的 children 优先级最高；使用点没写 children 时
                //  （this.children 是空数组），保留 props 合并链里已有的 children——它可能
                //  来自 boundProps（bindProps(Comp, {children:[...]}) 预设内容是自然的 HOC 写法）。
                //  过去无条件用 this.children 覆盖，会让 children 成为 boundProps 里唯一静默失效的
                //  prop。两者都没有时仍用 this.children（[]）兜底，保证组件解构 children 不为 undefined。
                if ((this.children && this.children.length) || normalizedProps.children === undefined) {
                    normalizedProps.children = this.children
                }
                this.props = normalizedProps
                // CAUTION 组件永不 rerender，inputProps 只在上面的 props 合并里消费。
                //  及时换成共享空对象，让 JSX 调用点的 props 对象（以及只被它引用的值）
                //  可以被回收，每个组件实例少保留一个对象
                this.inputProps = EMPTY_COMPONENT_PROP

                // CAUTION ref 不只来自 inputProps：boundProps（bindProps 包装的 HOC）也可以
                //  提供 ref，mergeProp 会把两者合并成数组。构造期只捕获了 inputProps.ref，
                //  这里必须用合并后的最终值回写，否则 boundProps 提供的 ref 被静默丢弃
                //  （attachRef/detachRef 本来就支持数组形态）。
                if (normalizedProps.ref) this.refProp = normalizedProps.ref

                node = this.type(normalizedProps, this.renderContext!)
            } catch (e) {
                // 组件 render 抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并把该区域渲染为空，
                // 否则保持向上抛出的行为。
                if (!this.pathContext.root.dispatch('error', e)) throw e
                renderFailed = true
            } finally {
                // CAUTION 无论组件是否抛错，都必须弹出 collect frame，
                //  否则 collect frame 栈会错位，后续渲染收集的 effect 会泄漏到错误的 frame 里。
                //  空 frame 不保留（多数组件 render 中不创建 computed），省一个常驻数组。
                const frame = getFrame()
                if (frame.length) this.frame = frame
            }
            // CAUTION collect effects end
            // 就用当前 component 的 placeholder
            const childContext = {...this.pathContext, hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath)}
            try {
                this.innerHost = createHost(node, this.placeholder, childContext)
            } catch (e) {
                // 组件函数成功返回、但返回值不是合法 child 时，错误同样属于本组件的
                // render 阶段。错误钩子消费后用 EmptyHost 保持区域可销毁，而不是让
                // root.render 同步击穿并留下一个已占用的 root.host。
                if (!this.pathContext.root.dispatch('error', e)) throw e
                renderFailed = true
                this.innerHost = createHost(null, this.placeholder, childContext)
            }
            this.innerHost.render()
        })

        if (renderFailed) {
            // render 未提交：useEffect/layoutEffect/ref 不得执行。render 期间已经创建的
            // cleanup/computed/reusable 资源要立即释放，否则空 UI 后面仍会保留订阅。
            this.destroyCallback?.forEach(callback => this.runWithErrorHook(callback))
            this.destroyCallback = undefined
            this.frame?.forEach(manualCleanupObject => this.runWithErrorHook(() => manualCleanupObject.destroy()))
            this.frame = undefined
            this.innerReusedHosts?.forEach(host => host.destroyReusable())
            this.innerReusedHosts = undefined
            this.effects = undefined
            this.layoutEffects = undefined
            return
        }

        // for test use
        /* v8 ignore next 3 */
        if (this.thisProp) {
            this.attachThis(this.thisProp)
        }

        this.effects?.forEach(effect => {
            // CAUTION effect 抛错：如果外部通过 root.on('error') 注册了处理器，则报告错误并
            //  继续执行其余 effect（否则一个抛错的 effect 会让 root.render 中断，
            //  已渲染好的树永远挂不上容器）；未注册时保持向上抛出的行为。
            const handle = this.runWithErrorHook(effect)
            if (typeof handle === 'function') {
                (this.destroyCallback ??= new Set()).add(handle)
            } else {
                this.observeAsyncEffect(handle)
            }
        })

        // 没有 layoutEffect 也没有 ref 的组件（绝大多数）完全不需要参与 attach 流程
        if (this.layoutEffects || this.refProp) {
            const root = this.pathContext.root
            // 已经 root attach 了，动态生成的节点，需要手动触发 layoutEffect。因为没有 attach 事件了。
            if (root.attached) {
                // CAUTION 动态生成的组件可能正被渲染在脱离文档的 fragment 里
                //  （列表新行、动态重建的静态子树等）。layoutEffect/ref 的语义是「可以测量 DOM」，
                //  必须等外层把子树真正插入文档后再执行（同一个同步任务内，由外层 flush 触发）。
                if (this.placeholder.isConnected) {
                    this.runLayoutEffect()
                } else {
                    this.deleteLayoutEffectCallback = root.deferUntilAttached(this.placeholder, () => this.runLayoutEffect())
                }
            } else {
                // CAUTION 一定要保存退订函数，组件如果在 root attach 之前被销毁，
                //  必须退订，否则 attach 时会对已销毁的组件执行 layoutEffect/ref。
                this.deleteLayoutEffectCallback = root.on('attach', () => this.runLayoutEffect(), {once: true})
            }
        }
    }
    // 生命周期回调（effect/layoutEffect/cleanup）的统一错误出口：
    //  注册了 root error 钩子时交给钩子（兄弟回调照常执行），否则保持向上抛出。
    runWithErrorHook(fn: () => any): any {
        try {
            return fn()
        } catch (e) {
            if (!this.pathContext.root.dispatch('error', e)) throw e
        }
    }
    observeAsyncEffect(handle: any) {
        if (!handle || typeof handle.then !== 'function') return
        const state = this.asyncEffectState ??= {active: true}
        const root = this.pathContext.root
        void Promise.resolve(handle).catch(error => {
            // Promise rejection 发生在同步 runWithErrorHook 之外，必须显式桥接到
            // root error 钩子。组件已经销毁时 effect 生命周期也已结束，不能再向
            // 已清空监听器的 root 泄漏 unhandled rejection。
            if (!state.active) return
            // 未注册钩子时重新 reject，保留原先的 unhandled-rejection 可观测语义。
            if (!root.dispatch('error', error)) throw error
        })
    }
    runLayoutEffect() {
        // CAUTION 一定是渲染之后才调用 ref，这样才能获得 dom 信息。
        //  ref 回调是用户代码：抛错走 error 钩子，否则会把同组件的 layoutEffects 一并跳过。
        if (this.refProp) {
            this.runWithErrorHook(() => this.attachRef(this.refProp!))
        }

        this.layoutEffects?.forEach(layoutEffect => {
            // CAUTION layoutEffect 抛错走 error 钩子，否则会打断同批其他 layoutEffect/ref
            const handle = this.runWithErrorHook(layoutEffect)
            if (typeof handle === 'function') {
                (this.layoutEffectDestroyHandles ??= new Set()).add(handle)
            } else {
                this.observeAsyncEffect(handle)
            }
        })
    }
    destroy(parentHandle?: boolean) {
        trackHostDestroyed(this)
        if (this.asyncEffectState) this.asyncEffectState.active = false
        // CAUTION 清理函数（layoutEffect 返回值 / useEffect 返回值 / onCleanup）必须在
        //  DOM 拆除、ref 置空、render 期 computed 销毁**之前**执行：
        //  onCleanup(() => observer.unobserve(ref.current)) 是最自然的写法，
        //  拆完 DOM 再跑清理时 ref.current 已是 null，直接 TypeError 或静默漏清理（I39）。
        //  清理函数抛错走 error 钩子：否则一个抛错的 cleanup 会中断
        //  兄弟清理函数与剩余销毁流程（reusable 销毁、placeholder 移除），造成泄漏。
        this.layoutEffectDestroyHandles?.forEach(handle => this.runWithErrorHook(handle))
        this.destroyCallback?.forEach(callback => this.runWithErrorHook(callback))

        // ref 回调是用户代码：detach（ref(null)）抛错不能中断剩余销毁流程（frame/innerHost），
        //  否则一个抛错的 ref 会让整棵子树泄漏。与 cleanup 的错误语义一致（I39/I43）。
        if (this.refProp) {
            this.runWithErrorHook(() => this.detachRef(this.refProp!))
        }

        // render 期间收集到的 computed 等由自己清理。
        // CAUTION computed 的 destroy 会执行用户注册的 onCleanup/onDestroy（用户代码）：
        //  抛错必须走 error 钩子，否则一个抛错的 cleanup 会中断兄弟 computed 的销毁、
        //  innerHost 的 DOM 拆除（区域残留旧内容），错误还会沿函数节点重算路径变成
        //  uncaught error。与 renderFailed 分支及 destroyCallback 的错误语义一致（I43 同类）。
        this.frame?.forEach(manualCleanupObject =>
            this.runWithErrorHook(() => manualCleanupObject.destroy())
        )
        // CAUTION 注意这里， ComponentHost 自己是不处理 dom 的。
        // innerHost 可能不存在（render 抛错被中断的场景）
        this.innerHost?.destroy(parentHandle)

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
        // CAUTION 先查自己：hostPath 是「父级路径」，不包含当前组件，
        //  组件 set 过的 context 自己也应该能 get 到（与 Provider 覆盖子树含自身的语义一致）。
        if (this._valueByType?.has(contextType)) {
            return this._valueByType.get(contextType)
        }
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
    // CAUTION Function.prototype.bind 产生的新函数不会继承原函数上的静态属性
    //  （propTypes/boundProps/postBoundProps），必须显式从原 Component 上复制。
    //  boundProps 尤其要从原组件读取再 concat，否则嵌套 bindProps 会静默丢掉前一层绑定的 props。
    const ComponentWithProps = Component.bind(null) as Component
    ComponentWithProps.propTypes = Component.propTypes
    ComponentWithProps.boundProps = ensureArray(Component.boundProps).concat(props)
    if (Component.postBoundProps) ComponentWithProps.postBoundProps = Component.postBoundProps
    return ComponentWithProps
}

export class ReusableHost implements Host{
    public innerHost: Host
    reusePlaceholder?: Comment
    constructor(public source: any, public innerPlaceholder: UnhandledPlaceholder, public pathContext: PathContext) {
        this.innerHost = createHost(source, innerPlaceholder, pathContext)
    }
    // CAUTION Host 契约中的 placeholder 是「当前挂载点」（moveTo 传入的 reusePlaceholder），
    //  而不是 innerHost 的 placeholder：RxListHost 等父级用它插入/定位/判断是否已渲染。
    get placeholder(): UnhandledPlaceholder {
        return (this.reusePlaceholder ?? this.innerPlaceholder)
    }
    // CAUTION element 必须是实时 getter（区间第一个节点），不能是构造时固定的字段：
    //  固定字段永远指向区间末尾的 innerPlaceholder，父级（列表插入锚点/区间搬移）
    //  以它为区间起点时会漏掉全部实际内容。
    get element(): HTMLElement|Comment|Text|SVGElement {
        return this.rendered ? this.innerHost.element : this.placeholder
    }
    // CAUTION 内容必须由自己搬移保留（destroy 时挪进 fragment 以便复用），
    //  绝不允许父级（RxListHost 整段 Range 删除等）连内容一起物理删除。
    get forceHandleElement(): boolean {
        return true
    }
    rendered = false
    render() {
        // 第一次渲染
        if (!this.rendered) {
            insertBefore(this.innerPlaceholder, this.reusePlaceholder!)
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
    destroy(parentHandle?: boolean) {
        // do nothing
        if (!parentHandle) {
            // CAUTION 整段区间已脱离 DOM / 父节点失配，说明区间已被外部整体清理
            //  （例如 root 容器被直接清空），内容已无法搬出保留，跳过搬移。
            //  与 StaticHost 对外部清理的容忍语义一致；「同父但兄弟链断了」的破坏
            //  仍交给下面的 assertRangeReachable 诊断。
            const rangeStart = this.innerHost.element
            const rangeEnd = this.innerHost.placeholder
            if (!rangeEnd.parentNode || rangeStart.parentNode !== rangeEnd.parentNode) {
                this.reusePlaceholder?.remove()
                return
            }
            const frag = document.createDocumentFragment()
            if (isAxiiDiagnosticsEnabled()) {
                assertRangeReachable({
                    ownerHost: this,
                    start: rangeStart,
                    end: rangeEnd,
                    boundaryKind: 'reusable-range',
                    operation: 'destroy',
                })
            }
            let start = rangeStart
            while(start !== rangeEnd) {
                const next = start.nextSibling as HTMLElement|Comment|Text|SVGElement
                frag.appendChild(start)
                start = next
            }
            frag.appendChild(rangeEnd)
            // 这个reusePlaceholder不要了，如果再被渲染，会有新的 placeholder
            if (this.reusePlaceholder) {
                this.reusePlaceholder.remove()
            }
        }
    }
    destroyReusable() {
        // 可能没有真正被渲染过
        if (!this.rendered) {
            this.innerPlaceholder.remove()
        } else {
            this.innerHost.destroy(false)
        }
        if (this.reusePlaceholder) {
            this.reusePlaceholder.remove()
        }
    }
}
