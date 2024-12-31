import {
    createElement,
    DetachStyledInfo,
    ExtendedElement,
    insertBefore,
    RefHandleInfo,
    setAttribute,
    stringifyStyleValue,
    UnhandledPlaceholder
} from "./DOM";
import { Host, PathContext } from "./Host";
import { autorun, isAtom, isReactive } from "data0";
import { createHost } from "./createHost";
import { assert, isPlainObject, nextFrames, removeNodesBetween } from "./util";
import { ComponentHost } from "./ComponentHost.js";
import {createLinkedNode, LinkedNode} from "./LinkedList";

// CAUTION 覆盖原来的判断，增加关于 isReactiveValue 的判断。这样就不会触发 reactive 的读属性行为了，不会泄漏到上层的 computed。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function (name: string, value: any) {
    if (name.startsWith('on')) return true

    if (Array.isArray(value) && value.some(isReactiveValue)) {
        return false
    } else if (isReactiveValue(value)) {
        return false
    }
    return originalIsValidAttribute(name, value)
}

function isReactiveValue(v: any) {
    return isReactive(v) || isAtom(v) || typeof v === 'function'
}

function isAtomLike(v: any) {
    return isAtom(v) || typeof v === 'function'
}


function hasPsuedoClassOrNestedStyle(styleObject: StyleObject | StyleObject[]) {
    if (Array.isArray(styleObject)) {
        return styleObject.some(hasPsuedoClassOrNestedStyle)
    }
    for(const key in styleObject) {
        if (key.startsWith(':') || isPlainObject(styleObject[key])) {
            return true
        }
    }
    return false
}

function hasTransition(styleObject: StyleObject | StyleObject[]) {
    if (Array.isArray(styleObject)) {
        return styleObject.some(hasTransition)
    }
    return styleObject.transition || styleObject.transitionProperty
}

function hasVariable(styleObject: StyleObject | StyleObject[]) {
    if (Array.isArray(styleObject)) {
        return styleObject.some(hasVariable)
    }
    for(const key in styleObject) {
        if (key.startsWith('--')) {
            return true
        }
    }
    return false
}

function findTransitionProperties(styleObject: StyleObject | StyleObject[]): string[] {
    if (Array.isArray(styleObject)) {
        return styleObject.flatMap(findTransitionProperties)
    }
    return styleObject.transitionProperty?.split(',').map((p: string) => p.trim()) ??
        styleObject.transition?.split(',').map((p: string) => p.split(/\s+/)[0]) ?? []
}

function hasInlineAnimation(styleObject: StyleObject | StyleObject[]) {
    if (Array.isArray(styleObject)) {
        return styleObject.some(hasInlineAnimation)
    }
    return styleObject['@keyframes'] !== undefined
}

function forceReflow(el: HTMLElement) {
    // CAUTION 通过读取 offsetHeight 来触发 reflow
    el.offsetHeight
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

function generateComponentElementStaticId(hostPath: LinkedNode<Host>, elementPath: number[]) {
    let lastComponentHost:ComponentHost|undefined = undefined
    const pathToGenerateId: Host[] = []
    let current: LinkedNode<Host>|null = hostPath
    while (current) {
        if (current.node instanceof ComponentHost) {
            lastComponentHost = current.node
            break
        }
        pathToGenerateId.unshift(current.node)
        current = current.prev
    }

    // const lastComponentHostIndex = hostPath.findLastIndex(host => host instanceof ComponentHost)
    // const lastComponentHost = lastComponentHostIndex === -1 ? undefined : hostPath[lastComponentHostIndex] as ComponentHost
    // const pathToGenerateId = lastComponentHostIndex === -1 ? hostPath : hostPath.slice(lastComponentHostIndex + 1)
    // // CAUTION 一定要有个字母开始 id，不然 typeId 可能是数字，不能作为 class 开头
    return `gen-${lastComponentHost?.typeId ?? 'global'}-${pathToGenerateId.map(host => host.pathContext.elementPath.join('_')).join('-')}-${elementPath.join('_')}`
}

class StyleManager {
    public styleScripts = new Map<string, CSSStyleSheet>()
    public elToStyleId = new WeakMap<HTMLElement, string>()
    getStyleSheetId(hostPath: LinkedNode<Host>, elementPath: number[], el: ExtendedElement | null) {
        // 有 el 说明是动态的，每个 el 独享 id。否则的话用 path 去生成，每个相同 path 的 el 都会共享一个 styleId
        if (el) {
            const styleId = this.elToStyleId.get(el)
            if (!styleId) {
                const newStyleId = `gen-${Math.random().toString(36).slice(2)}`
                this.elToStyleId.set(el, newStyleId)
                return newStyleId
            } else {
                return styleId
            }
        }

        return generateComponentElementStaticId(hostPath, elementPath)
    }
    stringifyStyleObject(styleObject: { [k: string]: any }): string {
        return Object.entries(styleObject).map(([key, value]) => {

            const property = key.replace(/([A-Z])/g, '-$1').toLowerCase()
            // value 是数字类型的 attr，自动加上 单位
            return `${property}:${stringifyStyleValue(key, value)};`
        }).join('\n')
    }
    update(hostPath: LinkedNode<Host>, elementPath: number[], styleObject: StyleObject | StyleObject[], el: ExtendedElement, isStatic: boolean = false) {
        // 使用这个更新的 style 都是有伪类或者有嵌套的，一定需要生成 class 的。
        const styleSheetId = this.getStyleSheetId(hostPath, elementPath, isStatic ? null : el)
        let styleSheet = this.styleScripts.get(styleSheetId)
        if (!styleSheet) {
            styleSheet = new CSSStyleSheet()
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];
            this.styleScripts.set(styleSheetId, styleSheet)
        }

        el.classList.add(styleSheetId)
        const styleObjects = Array.isArray(styleObject) ? styleObject : [styleObject]

        // CAUTION 多个 styleObjects 的更新要用异步任务，这样 transition 中的效果才能生效
        // 1. replaceSync 会立即生效，不会有 transition 效果
        // nextFrames(styleObjects.map((one, index) => () => {
        //     // styleScript!.innerHTML += this.generateStyleContent(`.${styleSheetId}`, one)
        //     const lastObjects = styleObjects.slice(0, index+1)
        //     const newContent = lastObjects.map(one => this.generateStyleContent(`.${styleSheetId}`, one).join('\n')).join('\n')
        //     console.log(newContent)
        //     styleSheet!.replaceSync(newContent)
        // }))

        // 2. promise chain 对于先 display none 再显示的节点也不能触发 transition
        // TODO 用 insertRule 和 replace/innerHTML 相比性能如何
        // sequencePromises(styleObjects.map((one, index) => () => {
        //     const lastObjects = styleObjects.slice(0, index+1)
        //     const newContent = lastObjects.map(one => this.generateStyleContent(`.${styleSheetId}`, one).join('\n')).join('\n')
        //     return styleSheet!.replace(newContent)
        // }))

        // 3. 对于先 display none 再显示的节点也不能触发 transition
        // styleSheet!.replaceSync(this.generateStyleContent(`.${styleSheetId}`, styleObjects[0]).join('\n'))
        // styleObjects.slice(1).forEach((one, index)=> {
        //     this.generateStyleContent(`.${styleSheetId}`, one).forEach(rule => {
        //         styleSheet!.insertRule(rule, styleSheet!.cssRules.length)
        //     })
        // })

        // styleSheet!.replace(this.generateStyleContent(`.${styleSheetId}`, styleObjects[0]).join('\n')).then(() => {
        //     nextFrames(styleObjects.slice(1).map((one, ) => () => {
        //         // CAUTION 在 chrome 中有时更新 class 可能不能触发 transition。所以这里把 valueStyle 拿出来直接用 setAttribute 更新。
        //         //  但如果 transition 写在了 nestedStyleObject 中，仍然可能出现不能触发的情况！
        //         const [valueStyleObject, nestedStyleObject] = this.separateStyleObject(one)
        //         this.generateStyleContent(`.${styleSheetId}`, nestedStyleObject).forEach(rule => {
        //             styleSheet!.insertRule(rule, styleSheet!.cssRules.length)
        //         })
        //         // valueStyleObject 使用 setAttribute 更新是为了能尽量触发 transition
        //         setAttribute(el, 'style', valueStyleObject)
        //     }))
        // })

        // 对一开始的就有 transition 的节点，要使用这种方式才能触发 transition，不能写到下面的 nextFrames 中。
        // if (hasInlineAnimation(styleObjects[0])) {
        //     console.log(this.generateStyleContent(`.${styleSheetId}`, styleObjects[0]).join('\n'))
        // }
        styleSheet!.replaceSync(this.generateStyleContent(`.${styleSheetId}`, styleObjects[0]).join('\n'))
        const transitionPropertyNames = findTransitionProperties(styleObjects[0])
        if (transitionPropertyNames.length) {
            forceReflow(el)
        }
        return nextFrames(styleObjects.slice(1).map((one,) => () => {
            // CAUTION 在 chrome 中有时更新 class 可能不能触发 transition。所以这里把 valueStyle 拿出来直接用 setAttribute 更新。
            //  但如果 transition 写在了 nestedStyleObject 中，仍然可能出现不能触发的情况！
            const [pureValueStyleObject, otherStyleObject, transitionProperties] = this.separateStyleObject(one, transitionPropertyNames)
            if (otherStyleObject) {
                this.generateStyleContent(`.${styleSheetId}`, otherStyleObject).forEach(rule => {
                    styleSheet!.insertRule(rule, styleSheet!.cssRules.length)
                })
            }
            // FIXME 是不是可以和上面合并
            if (pureValueStyleObject) {
                const newTransitionProperties = findTransitionProperties(pureValueStyleObject)
                transitionPropertyNames.push(...newTransitionProperties)
                this.generateStyleContent(`.${styleSheetId}`, pureValueStyleObject).forEach(rule => {
                    styleSheet!.insertRule(rule, styleSheet!.cssRules.length)
                })
            }
            // FIXME 可能还是会出现直接 style 里面的属性覆盖了 Hover 里面属性导致失效的问题。
            if (transitionProperties) {
                // valueStyleObject 使用 setAttribute 更新是为了能尽量触发 transition
                setAttribute(el, 'style', transitionProperties)
            }

            // CAUTION 如果自己上面有 transition，一定要触发 reflow，后面的 transition 属性变化才会生效
            if (hasTransition(one)) {
                forceReflow(el)
            }
        }))
    }
    isNestedStyleObject(key: string, styleObject: any): boolean {
        // TODO 使用这种方式来判断是不是嵌套的，未来可能有问题
        return key !== '@keyframes' && isPlainObject(styleObject)
    }
    separateStyleObject(styleObject: StyleObject, transitionPropertyNames: string[]): [StyleObject?, StyleObject?, StyleObject?] {
        // 把 value 不是 plainObject 的属性分离出来
        let pureValueStyleObject: StyleObject | undefined = undefined
        let otherStyleObject: StyleObject | undefined = undefined
        let transitionStyleObject: StyleObject | undefined = undefined
        for (const key in styleObject) {
            if (this.isNestedStyleObject(key, styleObject[key]) || (key === 'animation' && styleObject['keyframes'])) {
                if (!otherStyleObject) otherStyleObject = {}
                otherStyleObject[key] = styleObject[key]
            } else if (transitionPropertyNames.includes(key)) {
                if (!transitionStyleObject) transitionStyleObject = {}
                transitionStyleObject[key] = styleObject[key]
            } else {
                if (!pureValueStyleObject) pureValueStyleObject = {}
                pureValueStyleObject[key] = styleObject[key]
            }
        }
        return [pureValueStyleObject, otherStyleObject, transitionStyleObject]
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

// @ts-ignore 待修复
function isStaticStyleObject(styleObject: StyleObject | StyleObject[]): boolean {
    if (Array.isArray(styleObject)) {
        return styleObject.every(isStaticStyleObject)
    }
    return typeof styleObject === 'object'
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
    attrAutoruns?: (() => void)[]
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
                this.removeAttachListener = this.pathContext.root.on('attach', this.attachRefs)
            }
        }
    }
    collectInnerHost() {
        const result = this.source as ExtendedElement

        const { unhandledChildren } = result

        if (unhandledChildren) {
            this.reactiveHosts = unhandledChildren.map(({ placeholder, child, path }) =>
                createHost(child, placeholder, {
                    ...this.pathContext,
                    hostPath: createLinkedNode<Host>(this, this.pathContext.hostPath),
                    elementPath: path
                })
            );

            result.unhandledChildren = undefined
        }
    }
    collectReactiveAttr() {
        const result = this.source as ExtendedElement

        const isSVG = result instanceof SVGElement

        const { unhandledAttr } = result

        if(unhandledAttr) {
            this.attrAutoruns = []
            unhandledAttr.forEach(({ el, key, value, path }) => {
                // 基于一个推测：拥有 unhandledAttr 的元素，更有可能被测到
                if (!el.hasAttribute('data-testid')) {
                    this.generateTestId(el, path)
                }
                // FIXME  这里和 Component  configuration 约定的传递 prop 的key 耦合了
                if (!key.includes(':')) {
                    this.attrAutoruns!.push(autorun(() => {
                        this.updateAttribute(el, key, value, path, isSVG)
                    }, true))
                }
            })
            result.unhandledAttr = undefined
        }
    }
    updateAttribute(el: ExtendedElement, key: string, value: any, path: number[], isSVG: boolean) {
        const final = Array.isArray(value) ?
            value.map(v => isAtomLike(v) ? v() : v) :
            isAtomLike(value) ? value() : value

        if (key === 'style' && (hasPsuedoClassOrNestedStyle(final) || hasTransition(final) || hasInlineAnimation(final) || hasVariable(final))) {
            // FIXME 即使 value 是静态，也有可能是从 configuration 里面传入的，每个组件不同。所以这里不能从值去判断。
            //  例外要判断是不是 configuration 还要考虑是运行传入还是通过 boundProps 传入的。
            //  修复之前只能让 isStatic === false
            // const isStatic = isStaticStyleObject(value)
            const isStatic = false
            return StaticHost.styleManager.update(this.pathContext.hostPath, path, final, el, isStatic)
        } else {
            setAttribute(el, key, final, isSVG)
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
        
        const testId = generateGlobalElementStaticId(this.pathContext.hostPath, elementPath)
        setAttribute(el, 'data-testid', testId)
    }
    attachRefs = () => {
        this.refHandles?.forEach(({ handle, el }: RefHandleInfo) => {
            createElement.attachRef(el, handle)
        })
    }
    destroy(parentHandle?: boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.attrAutoruns?.forEach(stopAutorun => stopAutorun())
        }

        this.removeAttachListener?.()

        this.reactiveHosts?.forEach(host => host.destroy(true, parentHandleComputed))

        this.refHandles?.forEach(({ handle }: RefHandleInfo) => {
            createElement.detachRef(handle)
        })

        this.removeElements(parentHandle)
    }
    async removeElements(parentHandle?: boolean) {
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
            // 执行完了所有的 update style 任务，这里用 await 是因为修改该 style 用到了 nextFrame 等异步行为
            await Promise.all(this.detachStyledChildren?.map(({ el, style: value, path }) => {
                return this.updateAttribute(el, 'style', value, path, el instanceof SVGElement)
            }) || [])

            const transformingElementsArray = Array.from(transformingElements)
            const animatingElementsArray = Array.from(animatingElements)
            await Promise.all([
                ...transformingElementsArray.map(el => eventToPromise(el, 'transitionrun')),
                ...transformingElementsArray.map(el => eventToPromise(el, 'transitionend')),
                ...animatingElementsArray.map(el => eventToPromise(el, 'animationrun')),
                ...animatingElementsArray.map(el => eventToPromise(el, 'animationend')),
            ])
        }
        removeNodesBetween(this.element!, this.placeholder, true)
    }
}


function eventToPromise(el: HTMLElement, event: string) {
    return new Promise(resolve => {
        el.addEventListener(event, resolve, { once: true })
    })
}