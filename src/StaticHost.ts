import {
    createElement,
    DetachStyledInfo,
    ExtendedElement,
    InlineFunctionChildInfo,
    insertBefore,
    RefHandleInfo,
    setAttribute,
    stringifyStyleValue,
    UnhandledPlaceholder
} from "./DOM";
import {createChildPathContext, getHostPath, Host, PathContext} from "./Host";
import {autorun, isAtom, Notifier, ReactiveEffect} from "data0";
import {createHost} from "./createHost";
import {assert, camelize, isPlainObject, removeNodesBetween} from "./util";
import {ComponentHost} from "./ComponentHost.js";
import {LinkedNode} from "./LinkedList";
import {FunctionHost} from "./FunctionHost";
import {isAxiiDiagnosticsEnabled, reportAxiiError, withReactiveTrace} from "./diagnostics";
import {LightReactiveBindingEffect, ProbeReactiveEffect, ReactiveDep} from "./LightReactiveBinding";
import {
    trackRetainedHostStyleStateCreated,
    trackRetainedHostStyleStateDestroyed,
    trackRetainedStyleIdCreated,
    trackRetainedStyleIdDestroyed
} from "./retainedDiagnostics";

// CAUTION 覆盖原来的判断，避免读取 atom/function 动态属性时把依赖泄漏到上层 computed。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function (name: string, value: any) {
    if (name.startsWith('on')) return true

    if (Array.isArray(value) && value.some(isDynamicAttributeValue)) {
        return false
    } else if (isDynamicAttributeValue(value)) {
        return false
    }
    return originalIsValidAttribute(name, value)
}

function isDynamicAttributeValue(v: any) {
    return isAtom(v) || typeof v === 'function'
}

function isAtomLike(v: any) {
    return isAtom(v) || typeof v === 'function'
}


function generateGlobalElementStaticId(hostPath: LinkedNode<Host>, elementPath: number[]) {
    const hosts: Host[] = []
    let current: LinkedNode<Host>|null = hostPath
    while (current) {
        hosts.unshift(current.node)
        current = current.prev
    }
    return `${hosts.map(host => host.pathContext.elementPath.join('_')).join('-')}-${elementPath.join('_')}`
}

function GetPathToLastComponent(hostPath: LinkedNode<Host>) {
    const pathToGenerateId: Host[] = []
    let current: LinkedNode<Host>|null = hostPath
    while (current) {
        pathToGenerateId.unshift(current.node)
        if (current.node instanceof ComponentHost) {
            break
        }
        current = current.prev
    }
    return pathToGenerateId
}

function generateComponentElementStaticId(path: Host[], elementPath: number[]) {
    const [lastComponentHost, ...pathToGenerateId] = path as [ComponentHost, ...Host[]]
    // CAUTION 一定要有个字母开始 id，不然 typeId 可能是数字，不能作为 class 开头
    // CAUTION 压缩工具可能使得 name 以 $ 开头
    const componentName = lastComponentHost?.type.name.toString().replace(/(\s|\$)/g, '_') ?? 'GLOBAL'
    return `${componentName}${lastComponentHost?.typeId ??''}P${pathToGenerateId.map(host => host.pathContext.elementPath.join('_')).concat(elementPath.join('_')).join('-')}`
}

export function markBoundProp(obj: object) {
    Object.defineProperty(obj, '__bound', {
        value: true,
        enumerable: false
    })
    return obj
}

export function markAopProp(obj: object) {
    Object.defineProperty(obj, '__aop', {
        value: true,
        enumerable: false
    })
    return obj
}

export function markDynamicProp(obj: object) {
    Object.defineProperty(obj, '__dynamic', {
        value: true,
        enumerable: false
    })
    return obj
}

export function isBoundProp(obj: any) {
    return !!obj['__bound']
}

export function isAopProp(obj: any) {
    return !!obj['__aop']
}

export function isDynamicProp(obj: any) {
    return !!obj['__dynamic']
}

// class name 中的字母含义
// P path
// R random chars
// F fragment
// I iterator count

class StyleManager {
    public styleScripts = new Map<string, CSSStyleSheet>()
    public elToStyleId = new WeakMap<HTMLElement, string>()
    public elToStyleIdItorNum = new WeakMap<HTMLElement, number>()
    public hostToStyleIds = new WeakMap<Host, Set<string>>()
    public hostMountCount = new WeakMap<Host, number>()
    public idToRefCount = new Map<string, number>()
    getStyleSheetId(hostPath: LinkedNode<Host>, elementPath: number[], el: ExtendedElement | null) {
        const pathToLastComponent = GetPathToLastComponent(hostPath)
        // 有 el 说明是动态的，每个 el 独享 id。否则的话用 path 去生成，每个相同 path 的 el 都会共享一个 styleId
        const staticId = generateComponentElementStaticId(pathToLastComponent, elementPath)
        const hasFunctionHostInPathToLastComponent = pathToLastComponent.some(host => host instanceof FunctionHost)

        if (el || hasFunctionHostInPathToLastComponent) {
            const styleId = el  ? this.elToStyleId.get(el) : null
            if (!styleId) {
                const newStyleId = `${staticId}R${Math.random().toString(36).slice(2)}`
                if (el) this.elToStyleId.set(el, newStyleId)
                return newStyleId
            } else {
                return styleId
            }
        } else {
            return staticId
        }
    }
    stringifyStyleObject(styleObject: { [k: string]: any }): string {
        return Object.entries(styleObject).map(([key, value]) => {

            const property = key.replace(/([A-Z])/g, '-$1').toLowerCase()
            // value 是数字类型的 attr，自动加上 单位
            return `${property}:${stringifyStyleValue(key, value)};`
        }).join('\n')
    }
    public createStyleSheet(id:string, styleObject:StyleObject) {
        const styleSheet = new CSSStyleSheet()
        styleSheet.replaceSync(this.generateStyleContent(`.${id}`, styleObject).join('\n'))
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];
        trackRetainedStyleIdCreated()
        return styleSheet
    }
    deleteStyleSheet(id: string): CSSStyleSheet | null {
        const styleSheet = this.styleScripts.get(id)
        if (styleSheet) {
            const index = document.adoptedStyleSheets.indexOf(styleSheet)
            document.adoptedStyleSheets.splice(index, 1)
            this.styleScripts.delete(id)
            trackRetainedStyleIdDestroyed()
            return styleSheet
        }
        return null
    }
    collect(hostPath: LinkedNode<Host>, id: string) {
        const host = hostPath.node
        const hadHostStyleState = this.hostToStyleIds.has(host)
        const ids = this.hostToStyleIds.get(host) ?? new Set()
        ids.add(id)
        this.hostToStyleIds.set(host, ids)
        if (!hadHostStyleState) trackRetainedHostStyleStateCreated()
        this.updateRefCount(id, +1)
    }
    mount(hostPath: LinkedNode<Host>|null) {
        if (!hostPath) return // robustness for ReusableHost
        const host = hostPath.node
        const count = ((this.hostMountCount.get(host) ?? 0) + 1)
        this.hostMountCount.set(host, count)
        return count
    }
    hasHostState(hostPath: LinkedNode<Host>|null) {
        if (!hostPath) return false // robustness for ReusableHost
        const host = hostPath.node
        return this.hostMountCount.has(host) || this.hostToStyleIds.has(host)
    }
    unmount(hostPath: LinkedNode<Host>|null) {
        if (!hostPath) return // robustness for ReusableHost
        const host = hostPath.node
        const count = ((this.hostMountCount.get(host) ?? 0) - 1)
        if (count > 0) {
            this.hostMountCount.set(host, count)
            return count
        }

        this.cleanup(hostPath)
        this.hostMountCount.delete(host)
    }
    cleanup(hostPath: LinkedNode<Host>|null) {
        if (!hostPath) return
        const host = hostPath.node
        const ids = Array.from(this.hostToStyleIds.get(host) ?? new Set<string>())
        const styleSheetsToDelete = new Set<CSSStyleSheet>()
        ids.forEach(id => {
            const count = this.updateRefCount(id, -1)
            if (count <= 0) {
                const styleSheet = this.styleScripts.get(id)
                if (styleSheet) {
                    styleSheetsToDelete.add(styleSheet)
                }
                this.styleScripts.delete(id);
                trackRetainedStyleIdDestroyed()
            }
        })
        if (this.hostToStyleIds.delete(host)) trackRetainedHostStyleStateDestroyed()
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => {
            return !styleSheetsToDelete.has(sheet);
        });
    }
    updateRefCount(id: string, delta: number): number {
        const count = (this.idToRefCount.get(id) ?? 0) + delta
        if (count <= 0) {
            this.idToRefCount.delete(id)
        } else {
            this.idToRefCount.set(id, count)
        }
        return count
    }
    update(hostPath: LinkedNode<Host>, elementPath: number[], styleObject: StyleObject | StyleObject[], el: ExtendedElement) {
        // style 中有嵌套写法/animation/at-rules 等原生不能识别的，都会当做 unhandledAttr 走到这里。当然也包括 atom 和 function
        const styleObjects = Array.isArray(styleObject) ? styleObject : [styleObject]

        const styleItorNum = this.elToStyleIdItorNum.get(el) ?? 0
        const splitStyleObjects = styleObjects.map((styleObject, index) => {
            const isDynamic = typeof styleObject === 'function' || isDynamicProp(styleObject)
            const isBound = isBoundProp(styleObject)
            const styleSheetId = this.getStyleSheetId(hostPath, elementPath, isDynamic ? el : null)
            const styleSheetIdWithIndex = `${styleSheetId}F${index}`
            const styleSheetIdWithItorNum = `${styleSheetIdWithIndex}I${styleItorNum}`
            const evaluatedStyleObject: StyleObject = typeof styleObject === 'function' ? styleObject() : styleObject
            // 分离普通和嵌套样式
            const { simpleStyles, nestedStyles } = this.splitStyleObject(evaluatedStyleObject)
            return {
              index,
              isDynamic,
              isBound,
              styleSheetId,
              styleSheetIdWithIndex,
              styleSheetIdWithItorNum,
              evaluatedStyleObject,
              simpleStyles,
              nestedStyles
            }
        })
        // 是否应该更新 itor？
        // 如果使用了 itor-based style id，就要更新
        let shouldUpdateItor = false
        const stylePatches: StyleObject[] = []
        splitStyleObjects.forEach(so => {
            // 如果是 boundProps，优先使用 stylesheet，因为 boundProps 通常是组件级别的基础样式
            // 如果包含 nested style，只能使用 stylesheet，因为依赖于 CSS selector
            const shouldUseStyleSheet = so.isBound || Object.keys(so.nestedStyles).length > 0;
            if (shouldUseStyleSheet) {
                // 如果样式是动态的，则使用 itor 滚动 classname
                // 这里「动态」意味着它可能是
                // - Atom 或者 function
                // - 来自 boundProps 并且是通过 function evaluate 获得
                const shouldUseRollingStyleId = so.isDynamic
                const finalStyleSheetId = shouldUseRollingStyleId ? so.styleSheetIdWithItorNum : so.styleSheetIdWithIndex
                if (styleItorNum === 0 || shouldUseRollingStyleId) {
                    shouldUpdateItor = true

                    // 如果是第一次应用样式，或者需要滚动生成样式，则生成 stylesheet
                    const styleSheet = this.styleScripts.get(finalStyleSheetId) ?? this.createStyleSheet(finalStyleSheetId, so.evaluatedStyleObject)
                    el.classList.add(finalStyleSheetId)
                    // 保存 stylesheet，更新引用计数
                    this.styleScripts.set(finalStyleSheetId, styleSheet)
                    this.collect(hostPath, finalStyleSheetId)
                    if (shouldUseRollingStyleId) {
                        const lastStyleSheetId = `${so.styleSheetIdWithIndex}I${styleItorNum - 1}`
                        // 如果是滚动生成样式，则移除上一个 classname
                        el.classList.remove(lastStyleSheetId)
                        // 更新引用计数，但归零时并不会立即清除 stylesheet，因为它可能还被 cloneNode 用到
                        // 如果现在清除，cloneNode 的样式会瞬间失效
                        // TODO: 如果一个组件一直不 destroy，这里就会一直不清除 stylesheet
                        // 后面可以考虑加上一个长度为 2 的 buffer
                        this.updateRefCount(lastStyleSheetId, -1)
                    }
                }
            } else {
                // 收集普通样式，最后统一赋值
                stylePatches.push(so.simpleStyles)
                // nestedStyles 肯定是空的，这里就不用管了
            }
        })
        if (shouldUpdateItor) {
            this.elToStyleIdItorNum.set(el, styleItorNum + 1)
            if (__DEV__) {
              // DEV: 把 styleItorNum 打到 DOM 节点上方便调试
              el.setAttribute('data-axii-style-itor-num', String(styleItorNum + 1))
            }
        }
        setAttribute(el, 'style', stylePatches, el instanceof SVGElement)
    }
    isNestedStyleObject(key: string, styleObject: any): boolean {
        // TODO 使用这种方式来判断是不是嵌套的，未来可能有问题
        return key !== '@keyframes' && isPlainObject(styleObject)
    }
    splitStyleObject(styleObject: StyleObject): { simpleStyles: StyleObject, nestedStyles: StyleObject } {
        if (typeof styleObject === 'string') {
          return { simpleStyles: styleObject, nestedStyles: {} }
        }
        // Falsy style values clear inline styles instead of leaving stale rules behind.
        if (styleObject === null || styleObject === undefined) {
          return { simpleStyles: '' as any, nestedStyles: {} }
        }

        const simpleStyles: StyleObject = {}
        const nestedStyles: StyleObject = {}
        for (const key in styleObject) {
            // 除了值是 PlainObject 的情况，@keyframes 和 animation 也是依赖 CSS selector 的
            // 因此也被按照 nested style 处理
            if (key === '@keyframes' || key === 'animation' || this.isNestedStyleObject(key, styleObject[key])) {
                nestedStyles[key] = styleObject[key]
            } else {
                simpleStyles[key] = styleObject[key]
            }
        }
        
        return { simpleStyles, nestedStyles }
    }
    stringifyKeyFrameObject(keyframeObject: StyleObject): string {
        return Object.entries(keyframeObject).map(([key, value]) => {
            return `${key} {
                ${this.stringifyStyleObject(value)}
            }`
        }).join('\n')
    }
    generateInlineAnimationContent(selector: string, styleObject: StyleObject) {
        const animationContent: string[] = []
        let animationName = ''
        animationName = `animation-${Math.random().toString(36).slice(2)}`
        if (styleObject['@keyframes']) {
            const keyframeContent = `@keyframes ${animationName} {
${this.stringifyKeyFrameObject(styleObject['@keyframes'])}
}`
            animationContent.push(keyframeContent)
        }

        if (styleObject.animation) {
            const animationValue = (Array.isArray(styleObject.animation) ? styleObject.animation.join(' ') : styleObject.animation)!.replace(/@self/, animationName)
            animationContent.push(`
${selector} {
    animation: ${animationValue};
}
`)
        }

        return animationContent
    }
    generateStyleContent(selector: string, styleObject: StyleObject): string[] {

        const valueStyleObject = { ...styleObject }
        const nestedStyleEntries: [string, any][] = []
        const keyframeObj: StyleObject = {}

        for (const key in valueStyleObject) {
            if (key === '@keyframes' || key === 'animation') {
                keyframeObj[key] = valueStyleObject[key]
                delete valueStyleObject[key]
            } else if (this.isNestedStyleObject(key, valueStyleObject[key])) {
                nestedStyleEntries.push([key, valueStyleObject[key]])
                delete valueStyleObject[key]
            } else if(valueStyleObject[key] === null|| valueStyleObject[key] === undefined) {
                delete valueStyleObject[key]
            }
        }

        const contents: string[] = [`${selector} {
${this.stringifyStyleObject(valueStyleObject)}
}`]

        const animateContent = this.generateInlineAnimationContent(selector, keyframeObj)
        contents.push(...animateContent)

        return nestedStyleEntries.reduce((acc, [key, nestedObject]: [string, any]) => {
            // 支持 at-rules for media/container query
            if (key.startsWith('@')) {
                return acc.concat(`${key} {
    ${this.generateStyleContent(selector, nestedObject)}
}`)
            }

            const nestedClassName = /^(\s?)+&/.test(key) ? key.replace('&', selector) : `${selector} ${key}`
            return acc.concat(this.generateStyleContent(nestedClassName, nestedObject))
        }, contents)

    }
}

type StyleObject = { [k: string]: any }

type FunctionNodeContext = {
    onCleanup: (cleanup:()=> any) => void
}
type FunctionNode = (context:FunctionNodeContext) => ChildNode|DocumentFragment|string|number|null|boolean|undefined

class ScheduledReactiveEffect extends ReactiveEffect {
    private hasRun = false
    private scheduled = false

    callGetter(): any {
        return this.getter?.()
    }

    run(...args: any[]): any {
        if (!this.hasRun) {
            this.hasRun = true
            return super.run(...args)
        }

        if (this.scheduled) return
        this.scheduled = true
        queueMicrotask(() => {
            this.scheduled = false
            if (this.active) super.run()
        })
    }
}

class ImmediateReactiveEffect extends ReactiveEffect {
    callGetter(): any {
        return this.getter?.()
    }
}

function withFunctionNodeTrace<T>(
    operation: 'render' | 'recompute',
    pathContext: PathContext,
    fn: () => T,
): T {
    if (!isAxiiDiagnosticsEnabled()) return fn()
    return withReactiveTrace({
        type: operation === 'render' ? 'function-node' : 'function-node-recompute',
        operation,
        hostType: 'StaticHost',
        elementPath: pathContext.elementPath,
        source: pathContext.debugSource,
    }, fn)
}

class InlineFunctionTextBinding extends LightReactiveBindingEffect {
    stopAutoRender?: () => any
    textNode: Text|null = null
    innerHost: Host|null = null
    container: ParentNode|null
    protected retainedDiagnosticType = 'InlineFunctionTextBinding'
    private childPathContext?: PathContext
    private lightScheduled = false

    constructor(
        public source: FunctionNode,
        public placeholder: Comment | null,
        public ownerHost: Host,
        container?: ParentNode,
        private path: number[] = ownerHost.pathContext.elementPath,
        private sourceInfo?: InlineFunctionChildInfo['source'],
    ) {
        super()
        this.container = placeholder?.parentNode ?? container ?? null
    }

    private getPathContext() {
        return this.childPathContext ?? (this.childPathContext = createChildPathContext(
            this.ownerHost.pathContext,
            this.ownerHost,
            this.path,
            this.sourceInfo ?? this.ownerHost.pathContext.debugSource,
        ))
    }

    render() {
        if (this.source.length === 0) {
            this.renderZeroArgPrimitive()
            return
        }
        this.renderGeneric()
    }

    private renderZeroArgPrimitive() {
        let firstNode: ReturnType<FunctionNode>
        const effect = new ScheduledReactiveEffect(() => {
            firstNode = this.source(undefined as unknown as FunctionNodeContext)
            this.renderNode(firstNode, pauseCurrentEffectChildCollection, resumeCurrentEffectChildCollection)
        })
        effect.run()

        if (isLightTextBindingNode(firstNode!) && effect.deps.length === 1) {
            const dep = effect.deps[0]!
            effect.destroy()
            this.renderLightAtomPrimitive(dep)
            return
        }

        this.stopAutoRender = () => effect.destroy()
    }

    private renderLightAtomPrimitive(dep: ReactiveDep) {
        this.startLightBinding(dep)
    }

    run() {
        if (!this.lightActive || this.lightScheduled) return
        this.lightScheduled = true
        queueMicrotask(() => {
            this.lightScheduled = false
            if (!this.lightActive) return

            let node: ReturnType<FunctionNode>
            const probeEffect = new ProbeReactiveEffect(() => {
                node = this.source(undefined as unknown as FunctionNodeContext)
            })
            probeEffect.run()
            const canStayLight = isLightTextBindingNode(node!) &&
                probeEffect.deps.length === 1 &&
                probeEffect.deps[0] === this.lightDep
            probeEffect.destroy()

            if (!canStayLight) {
                this.stopLightBinding()
                this.renderZeroArgPrimitive()
                return
            }

            this.renderNode(node!, pauseCurrentEffectChildCollection, resumeCurrentEffectChildCollection)
        })
    }

    private renderGeneric() {
        let scheduleRecompute = false

        this.stopAutoRender = autorun(({ onCleanup, pauseCollectChild, resumeCollectChild }) => {
            withFunctionNodeTrace('render', this.getPathContext(), () => {
                let cleanup: (() => any) | undefined
                const node = this.source({onCleanup: (fn) => cleanup = fn})
                this.renderNode(node, pauseCollectChild, resumeCollectChild)
                onCleanup(() => cleanup?.())
            })
        }, (recompute) => {
            if (scheduleRecompute) return
            scheduleRecompute = true
            queueMicrotask(() => {
                withFunctionNodeTrace('recompute', this.getPathContext(), recompute)
                scheduleRecompute = false
            })
        })
    }

    destroy(parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            if (this.lightActive) {
                this.stopLightBinding()
            } else {
                this.stopAutoRender?.()
            }
            this.cleanupRendered()
        }
        this.placeholder?.remove()
    }

    private renderNode(node: ReturnType<FunctionNode>, pauseCollectChild: () => void, resumeCollectChild: () => void) {
        if (node === null || node === undefined) {
            const hadInnerHost = this.cleanupRendered()
            if (!hadInnerHost) this.placeholder?.remove()
            return
        }

        if (isPrimitiveText(node)) {
            const text = node.toString()
            const hadInnerHost = this.cleanupInnerHost()
            if (this.textNode) {
                this.textNode.data = text
            } else {
                this.textNode = document.createTextNode(text)
                this.insertStandaloneNode(this.textNode)
            }
            if (!hadInnerHost) this.placeholder?.remove()
            return
        }

        this.cleanupRendered()
        const placeholder = this.getPlaceholder()
        this.insertStandaloneNode(placeholder)
        const host = createHost(node, placeholder, this.getPathContext())
        Notifier.instance.pauseTracking()
        pauseCollectChild()
        host.render()
        resumeCollectChild()
        Notifier.instance.resetTracking()
        this.innerHost = host
    }

    private insertStandaloneNode(node: ChildNode) {
        if (this.placeholder?.parentNode) {
            this.placeholder.parentNode.insertBefore(node, this.placeholder)
            return
        }

        this.container?.appendChild(node)
    }

    private cleanupRendered() {
        const hadInnerHost = this.cleanupInnerHost()
        if (this.textNode) {
            this.textNode.remove()
            this.textNode = null
        }
        return hadInnerHost
    }

    private cleanupInnerHost() {
        if (this.innerHost) {
            this.innerHost.destroy(false, false)
            this.innerHost = null
            return true
        }
        return false
    }

    private getPlaceholder() {
        if (!this.placeholder) {
            this.placeholder = document.createComment('unhandledChild')
        }
        return this.placeholder
    }
}

function isLightAttributeValue(value: unknown) {
    return value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
}

type AttributeBindingHost = Pick<StaticHost, 'pathContext' | 'resolveAttributeValue' | 'applyResolvedAttribute' | 'updateAttribute'>

class LightReactiveAttributeBinding extends LightReactiveBindingEffect {
    private stopAutoRender?: () => void
    private lightRunning = false
    protected retainedDiagnosticType = 'LightReactiveAttributeBinding'

    constructor(
        private host: AttributeBindingHost,
        private el: ExtendedElement,
        private key: string,
        private value: any,
        private path: number[],
        private isSVG: boolean,
        private source?: InlineFunctionChildInfo['source'],
    ) {
        super()
    }

    render() {
        if (this.key === 'style') {
            this.renderFull()
            return
        }

        let firstValue: unknown
        const effect = new ImmediateReactiveEffect(() => {
            firstValue = this.host.resolveAttributeValue(this.value)
            this.updateResolvedAttribute(firstValue)
        })
        effect.run()

        if (this.canUseLightBinding(firstValue, effect.deps)) {
            const dep = effect.deps[0]!
            effect.destroy()
            this.renderLight(dep)
            return
        }

        this.stopAutoRender = () => effect.destroy()
    }

    private renderFull() {
        const effect = new ImmediateReactiveEffect(() => {
            this.updateRawAttribute()
        })
        effect.run()
        this.stopAutoRender = () => effect.destroy()
    }

    destroy() {
        if (this.lightActive) {
            this.stopLightBinding()
            return
        }
        this.stopAutoRender?.()
    }

    private canUseLightBinding(value: unknown, deps: ReactiveEffect['deps']) {
        return this.key !== 'style' &&
            !Array.isArray(this.value) &&
            isLightAttributeValue(value) &&
            deps.length === 1
    }

    private renderLight(dep: ReactiveDep) {
        this.startLightBinding(dep)
    }

    run() {
        if (!this.lightActive || this.lightRunning) return
        this.lightRunning = true
        try {
            if (isAtom(this.value)) {
                this.updateResolvedAttribute(this.host.resolveAttributeValue(this.value))
                return
            }

            let nextValue: unknown
            const probeEffect = new ProbeReactiveEffect(() => {
                nextValue = this.host.resolveAttributeValue(this.value)
            })
            probeEffect.run()
            const canStayLight = this.canUseLightBinding(nextValue, probeEffect.deps) &&
                probeEffect.deps[0] === this.lightDep
            probeEffect.destroy()

            if (!canStayLight) {
                this.stopLightBinding()
                this.render()
                return
            }

            this.updateResolvedAttribute(nextValue)
        } finally {
            this.lightRunning = false
        }
    }

    private updateResolvedAttribute(value: unknown) {
        withReactiveTrace({
            type: 'static-attr',
            operation: 'update-attr',
            hostType: 'StaticHost',
            elementPath: this.path,
            source: this.source ?? this.host.pathContext.debugSource,
            attrName: this.key,
        }, () => {
            this.host.applyResolvedAttribute(this.el, this.key, value, this.isSVG)
        })
    }

    private updateRawAttribute() {
        withReactiveTrace({
            type: 'static-attr',
            operation: 'update-attr',
            hostType: 'StaticHost',
            elementPath: this.path,
            source: this.source ?? this.host.pathContext.debugSource,
            attrName: this.key,
        }, () => {
            this.host.updateAttribute(this.el, this.key, this.value, this.path, this.isSVG)
        })
    }
}

function isPrimitiveText(node: ReturnType<FunctionNode>): node is string | number | boolean {
    return typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean'
}

function isLightTextBindingNode(node: ReturnType<FunctionNode>): node is string | number | boolean | null | undefined {
    return node === null || node === undefined || isPrimitiveText(node)
}

function canInlineFunctionTextBinding(child: unknown, placeholder?: Comment, container?: ParentNode): child is FunctionNode {
    return typeof child === 'function' &&
        !isAtom(child) &&
        (
            placeholder?.parentNode instanceof Element && placeholder.parentNode.childNodes.length === 1 ||
            !placeholder?.parentNode && container instanceof Element && container.childNodes.length === 0
        )
}

function isSimpleInlineFunctionChild(
    source: ExtendedElement,
    inlineFunctionChild: InlineFunctionChildInfo | undefined,
    inlineFunctionChildren: InlineFunctionChildInfo[] | undefined,
) {
    if (inlineFunctionChild) {
        return !inlineFunctionChildren?.length &&
            inlineFunctionChild.container === source &&
            inlineFunctionChild.path.length === 1 &&
            inlineFunctionChild.path[0] === 0 &&
            canInlineFunctionTextBinding(inlineFunctionChild.child, undefined, source)
    }

    return !inlineFunctionChildren ||
        inlineFunctionChildren.length === 1 &&
        inlineFunctionChildren[0]!.container === source &&
        inlineFunctionChildren[0]!.path.length === 1 &&
        inlineFunctionChildren[0]!.path[0] === 0 &&
        canInlineFunctionTextBinding(inlineFunctionChildren[0]!.child, undefined, source)
}

function isSimpleRootDynamicAttr(source: ExtendedElement) {
    const { unhandledAttr } = source
    if (!unhandledAttr?.length) return true
    if (StaticHostConfig.autoGenerateTestId) return false
    if (unhandledAttr.length !== 1) return false

    const attr = unhandledAttr[0]!
    return attr.el === source &&
        attr.path.length === 0 &&
        attr.key !== 'style' &&
        !attr.key.includes(':')
}

function isSimpleElementHostShape(source: HTMLElement | SVGElement | DocumentFragment) {
    if (source instanceof DocumentFragment) return false
    const element = source as ExtendedElement
    return !element.unhandledChildren?.length &&
        isSimpleRootDynamicAttr(element) &&
        !element.refHandles?.length &&
        !element.detachStyledChildren?.length &&
        isSimpleInlineFunctionChild(element, element.inlineFunctionChild, element.inlineFunctionChildren)
}

/**
 * @internal
 */
export class SimpleElementHost implements Host {
    public element: HTMLElement | SVGElement | Comment = this.placeholder
    private textBinding?: InlineFunctionTextBinding
    private attrBinding?: LightReactiveAttributeBinding

    constructor(public source: HTMLElement | SVGElement, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
    }

    render(): void {
        assert(this.element === this.placeholder, 'should never rerender')
        this.element = this.source

        const element = this.source as ExtendedElement
        const inlineFunctionChild = element.inlineFunctionChild ?? element.inlineFunctionChildren?.[0]
        if (inlineFunctionChild) {
            this.textBinding = new InlineFunctionTextBinding(
                inlineFunctionChild.child,
                null,
                this,
                this.source,
                inlineFunctionChild.path,
                inlineFunctionChild.source,
            )
            this.textBinding.render()
            element.inlineFunctionChild = undefined
            element.inlineFunctionChildren = undefined
        }

        const dynamicAttr = element.unhandledAttr?.[0]
        if (dynamicAttr) {
            this.attrBinding = new LightReactiveAttributeBinding(
                this,
                dynamicAttr.el,
                dynamicAttr.key,
                dynamicAttr.value,
                dynamicAttr.path,
                this.source instanceof SVGElement,
                dynamicAttr.source,
            )
            this.attrBinding.render()
            element.unhandledAttr = undefined
        }

        insertBefore(this.element, this.placeholder)
    }

    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.attrBinding?.destroy()
        }
        this.textBinding?.destroy(parentHandleComputed)
        this.attrBinding = undefined
        this.textBinding = undefined

        const source = this.source as ExtendedElement
        source.inlineFunctionChild = undefined
        source.inlineFunctionChildren = undefined
        source.unhandledAttr = undefined

        if (!parentHandle) {
            removeNodesBetween(this.element, this.placeholder, true, {
                ownerHost: this,
                operation: 'destroy',
            })
        }
    }

    resolveAttributeValue(value: any) {
        return Array.isArray(value) ?
            value.map(v => isAtomLike(v) ? v() : v) :
            isAtomLike(value) ? value() : value
    }

    applyResolvedAttribute(el: ExtendedElement, key: string, value: any, isSVG: boolean) {
        if (/^data-/.test(key)) {
            el.dataset[camelize(key.slice(5))] = value
        } else {
            setAttribute(el, key, value, isSVG)
        }
    }

    updateAttribute(el: ExtendedElement, key: string, value: any, path: number[], isSVG: boolean) {
        const final = this.resolveAttributeValue(value)
        this.applyResolvedAttribute(el, key, final, isSVG)
    }
}

/**
 * @internal
 */
export function createStaticHost(source: HTMLElement | SVGElement | DocumentFragment, placeholder: UnhandledPlaceholder, pathContext: PathContext): Host {
    if (isSimpleElementHostShape(source)) {
        return new SimpleElementHost(source as HTMLElement | SVGElement, placeholder, pathContext)
    }
    return new StaticHost(source, placeholder, pathContext)
}

function pauseCurrentEffectChildCollection() {
    ReactiveEffect.activeScopes.at(-1)?.pauseCollectChild()
}

function resumeCurrentEffectChildCollection() {
    ReactiveEffect.activeScopes.at(-1)?.resumeCollectChild()
}

// 添加全局配置对象
export const StaticHostConfig = {
    autoGenerateTestId: false
}

/**
 * @internal
 */
export class StaticHost implements Host {
    static styleManager = new StyleManager()
    // 如果有 detachStyledChildren，会设为 true
    public forceHandleElement: boolean = false
    // CAUTION Component 只因为 props 的引用变化而重新 render。
    //  只有有 diff 算发以后才会出现引用变化的情况，现在我们还没有实现。所以现在其实永远不会重 render
    computed = undefined
    reactiveHosts?: Host[]
    inlineFunctionTextBindings?: InlineFunctionTextBinding[]
    attrBindings?: LightReactiveAttributeBinding | LightReactiveAttributeBinding[]
    refHandles?: RefHandleInfo[]
    detachStyledChildren?: DetachStyledInfo[]
    parentElement: HTMLElement
    removeAttachListener?: () => void
    constructor(public source: HTMLElement | SVGElement | DocumentFragment, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
        this.parentElement = placeholder.parentElement!
    }
    // get parentElement() {
    //     return this.placeholder.parentElement
    // }
    element: HTMLElement | Comment | SVGElement = this.placeholder
    render(): void {
        assert(this.element === this.placeholder, 'should never rerender')

        // CAUTION 如果是 fragment，我们用一个 comment 节点来作为第一个元素，这样后面  destroy 的时候就能一次性 remove 掉。
        this.element = this.source instanceof DocumentFragment ? document.createComment('fragment start') : this.source

        // FIXME 应该要先 render 完所有的里面的 host。再插入自己才对。不然里面的 host render 会触发 layout.
        // insertBefore(this.element, this.placeholder)
        //
        // // 如果是 fragment，那么还要插入真实内容
        // if (this.source instanceof DocumentFragment) {
        //     insertBefore(this.source, this.placeholder)
        // }

        this.collectInnerHost()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.collectDetachStyledChildren()
        if (this.detachStyledChildren?.length) {
            this.forceHandleElement = true
        }
        this.inlineFunctionTextBindings?.forEach(binding => binding.render())
        this.reactiveHosts?.forEach(host => host.render())
        //
        insertBefore(this.element, this.placeholder)
        // 如果是 fragment，那么还要插入真实内容
        if (this.source instanceof DocumentFragment) {
            insertBefore(this.source, this.placeholder)
        }

        if (this.refHandles?.length) {
            if (this.pathContext.root.attached) {
                this.attachRefs()
            } else {
                this.pathContext.root.on('attach', this.attachRefs, {once: true})
            }
        }
        const hostPath = this.pathContext.hostPath ?? null
        if (StaticHost.styleManager.hasHostState(hostPath)) {
            StaticHost.styleManager.mount(hostPath)
        }
    }
    collectInnerHost() {
        const result = this.source as ExtendedElement

        const { unhandledChildren, inlineFunctionChild, inlineFunctionChildren } = result

        if (unhandledChildren || inlineFunctionChild || inlineFunctionChildren) {
            const reactiveHosts: Host[] = []
            const inlineFunctionTextBindings: InlineFunctionTextBinding[] = []

            const collectChild = ({ placeholder, child, path, source, container }: {
                placeholder?: Comment,
                child: unknown,
                path: number[],
                source?: InlineFunctionChildInfo['source'],
                container?: InlineFunctionChildInfo['container'],
            }, lazyPlaceholder?: boolean) => {
                if (canInlineFunctionTextBinding(child, placeholder, container)) {
                    inlineFunctionTextBindings.push(new InlineFunctionTextBinding(child, placeholder ?? null, this, container, path, source ?? (child as any).__axiiSource))
                    return
                }

                if (lazyPlaceholder) {
                    placeholder = document.createComment('unhandledChild')
                    container!.appendChild(placeholder)
                }
                const childPathContext = createChildPathContext(
                    this.pathContext,
                    this,
                    path,
                    source ?? (child as any).__axiiSource ?? this.pathContext.debugSource,
                )
                reactiveHosts.push(createHost(child, placeholder!, childPathContext))
            }

            unhandledChildren?.forEach(childInfo => collectChild(childInfo));
            if (inlineFunctionChild) collectChild(inlineFunctionChild, true)
            inlineFunctionChildren?.forEach(childInfo => collectChild(childInfo, true));

            if (reactiveHosts.length) this.reactiveHosts = reactiveHosts
            if (inlineFunctionTextBindings.length) this.inlineFunctionTextBindings = inlineFunctionTextBindings

            result.unhandledChildren = undefined
            result.inlineFunctionChild = undefined
            result.inlineFunctionChildren = undefined
        }
    }
    collectReactiveAttr() {
        const result = this.source as ExtendedElement

        const isSVG = result instanceof SVGElement

        const { unhandledAttr } = result

        if(unhandledAttr) {
            unhandledAttr.forEach(({ el, key, value, path, source }) => {
                // 基于一个推测：拥有 unhandledAttr 的元素，更有可能被测到
                if (!el.hasAttribute('data-testid')) {
                    this.generateTestId(el, path)
                }
                // FIXME  这里和 Component  configuration 约定的传递 prop 的key 耦合了
                if (!key.includes(':')) {
                    const binding = new LightReactiveAttributeBinding(this, el, key, value, path, isSVG, source)
                    binding.render()
                    this.addAttrBinding(binding)
                }
            })
            result.unhandledAttr = undefined
        }
    }
    private addAttrBinding(binding: LightReactiveAttributeBinding) {
        const attrBindings = this.attrBindings
        if (!attrBindings) {
            this.attrBindings = binding
        } else if (Array.isArray(attrBindings)) {
            attrBindings.push(binding)
        } else {
            this.attrBindings = [attrBindings, binding]
        }
    }
    updateAttribute(el: ExtendedElement, key: string, value: any, path: number[], isSVG: boolean) {

        if (key === 'style' ) {
            return StaticHost.styleManager.update(getHostPath(this.pathContext)!, path, value, el)
        } else {
            const final = this.resolveAttributeValue(value)
            this.applyResolvedAttribute(el, key, final, isSVG)
        }
    }
    resolveAttributeValue(value: any) {
        return Array.isArray(value) ?
            value.map(v => isAtomLike(v) ? v() : v) :
            isAtomLike(value) ? value() : value
    }
    applyResolvedAttribute(el: ExtendedElement, key: string, value: any, isSVG: boolean) {
            if (/^data-/.test(key)) {
                // 使用 dataset 的时候 key 要进行驼峰化
                // ref: https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLElement/dataset#%E5%90%8D%E7%A7%B0%E8%BD%AC%E6%8D%A2
                el.dataset[camelize(key.slice(5))] = value
            } else {
                setAttribute(el, key, value, isSVG)
            }
    }
    collectRefHandles() {
        this.refHandles = (this.source as ExtendedElement).refHandles
    }
    collectDetachStyledChildren() {
        this.detachStyledChildren = (this.source as ExtendedElement).detachStyledChildren
    }
    generateTestId(el: ExtendedElement, elementPath: number[]) {
        // 增加全局开关控制
        if (!StaticHostConfig.autoGenerateTestId) return
        
        const testId = generateGlobalElementStaticId(getHostPath(this.pathContext)!, elementPath)
        setAttribute(el, 'data-testid', testId)
    }
    attachRefs = () => {
        this.refHandles?.forEach(({ handle, el }: RefHandleInfo) => {
            createElement.attachRef(el, handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.destroyAttrBindings()
        }

        this.removeAttachListener?.()

        this.inlineFunctionTextBindings?.forEach(binding => binding.destroy(parentHandleComputed))
        this.reactiveHosts?.forEach(host => host.destroy(true, parentHandleComputed))

        this.refHandles?.forEach(({ handle }: RefHandleInfo) => {
            createElement.detachRef(handle)
        })

        const unmountStyle = () => {
            const hostPath = this.pathContext.hostPath ?? null
            if (StaticHost.styleManager.hasHostState(hostPath)) {
                StaticHost.styleManager.unmount(hostPath)
            }
        }

        const finishDestroy = () => {
            unmountStyle()
            this.releaseReferences()
        }

        try {
            const removeResult = this.removeElements(parentHandle)
            if (removeResult instanceof Promise) {
                removeResult.catch(reportAxiiError).finally(finishDestroy)
            } else {
                finishDestroy()
            }
        } catch (error) {
            finishDestroy()
            throw error
        }
    }

    private releaseReferences() {
        this.reactiveHosts = undefined
        this.inlineFunctionTextBindings = undefined
        this.attrBindings = undefined
        this.refHandles = undefined
        this.detachStyledChildren = undefined
        this.removeAttachListener = undefined

        const source = this.source as ExtendedElement
        source.unhandledChildren = undefined
        source.inlineFunctionChild = undefined
        source.inlineFunctionChildren = undefined
        source.unhandledAttr = undefined
        source.refHandles = undefined
        source.detachStyledChildren = undefined
    }

    private destroyAttrBindings() {
        const attrBindings = this.attrBindings
        if (!attrBindings) return
        if (Array.isArray(attrBindings)) {
            attrBindings.forEach(binding => binding.destroy())
        } else {
            attrBindings.destroy()
        }
    }

    removeElements(parentHandle?: boolean): void | Promise<void> {
        if (parentHandle) return

        if (this.detachStyledChildren?.length) {
            const transformingElements = new Set<HTMLElement>()
            const animatingElements = new Set<HTMLElement>()

            // TODO 提升计算效率
            // CAUTION 监听所有的 animationrun 和 transitionrun 事件。不能用 animationstart 和 transitionstart，因为不是立刻触发的
            this.detachStyledChildren?.forEach(({ el, style: value }) => {
                const transitionProperties = getComputedStyle(el).transitionProperty.split(',').map(p => p.trim())
                // CAUTION 注意这里的计算规则和 updateAttribute 里的不太一样，这里只要找 key 就行了
                const finalStyle: StyleObject = Array.isArray(value) ?
                    Object.assign({}, ...value.map(v => isAtomLike(v) ? v() : v)) :
                    isAtomLike(value) ? value() : value

                const styleKeys = Object.keys(finalStyle)
                const hasTransition = transitionProperties.includes('all') || styleKeys.some(key => transitionProperties.includes(key))
                if (hasTransition) {
                    transformingElements.add(el)
                }
                if (finalStyle.animation) {
                    animatingElements.add(el)
                }
            })


            const transformingElementsArray = Array.from(transformingElements)
            const animatingElementsArray = Array.from(animatingElements)
            const promises = [
                ...transformingElementsArray.map(el => eventToPromise(el, 'transitionrun')),
                ...transformingElementsArray.map(el => eventToPromise(el, 'transitionend')),
                ...animatingElementsArray.map(el => eventToPromise(el, 'animationrun')),
                ...animatingElementsArray.map(el => eventToPromise(el, 'animationend')),
            ]

            // 出发 transition 和 animation
            this.detachStyledChildren?.forEach(({ el, style: value, path }) => {
                const final = Array.isArray(value) ?
                    value.map(v => isAtomLike(v) ? v() : v) :
                    isAtomLike(value) ? value() : value
                setAttribute(el, 'style', final, el instanceof SVGElement)
            })

            return Promise.all(promises).then(() => {
                removeNodesBetween(this.element!, this.placeholder, true, {
                    ownerHost: this,
                    operation: 'destroy',
                })
            })
        }
        removeNodesBetween(this.element!, this.placeholder, true, {
            ownerHost: this,
            operation: 'destroy',
        })
    }
}


function eventToPromise(el: HTMLElement, event: string) {
    return new Promise(resolve => {
        el.addEventListener(event, () => {
            resolve(true)
        }, { once: true })
    })
}
