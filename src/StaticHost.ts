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
import {Host, PathContext} from "./Host";
import {autorun, isAtom, isReactive} from "data0";
import {createHost} from "./createHost";
import {assert, camelize, isPlainObject, removeNodesBetween} from "./util";
import {ComponentHost} from "./ComponentHost.js";
import {createLinkedNode, LinkedNode} from "./LinkedList";
import {FunctionHost} from "./FunctionHost";

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

export function markOverwrite(obj:object) {
    Object.defineProperty(obj, '__overwrite', {
        value: true,
        enumerable: false
    })
    return obj
}

export function isOverwrite(obj:any) {
    return obj['__overwrite']
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
        return styleSheet
    }
    update(hostPath: LinkedNode<Host>, elementPath: number[], styleObject: StyleObject | StyleObject[], el: ExtendedElement) {
        // style 中有嵌套写法/animation/at-rules 等原生不能识别的，都会当做 unhandledAttr 走到这里。当然也包括 atom 和 function
        const styleObjects = Array.isArray(styleObject) ? styleObject : [styleObject]

        const styleItorNum = this.elToStyleIdItorNum.get(el) ?? 0
        // 1. 如果是第一次，就全部生成
        // 2. 如果是第二次，只对动态的部分重新生成
        //  2.1. 动态生成的时候是先 add 一个新的，然后删除老的。
        let allStatic = true
        styleObjects.forEach((styleObject, index) => {
            const isStatic = (typeof styleObject !== 'function') && !isOverwrite(styleObject)
            allStatic = allStatic && isStatic
            const styleSheetId = this.getStyleSheetId(hostPath, elementPath, isStatic ? null : el)

            const styleSheetIdWithItorNum = `${styleSheetId}F${index}I${styleItorNum}`
            let styleSheet:any
            if( styleItorNum === 0) {
                // const content = this.generateStyleContent(`.${styleSheetIdWithItorNum}`, typeof styleObject === 'function' ? styleObject() : styleObject)
                styleSheet = this.styleScripts.get(styleSheetIdWithItorNum) || this.createStyleSheet(styleSheetIdWithItorNum, typeof styleObject === 'function' ? styleObject() : styleObject)
                el.classList.add(styleSheetIdWithItorNum)
            } else {
                if (typeof styleObject === 'function') {
                    const evaluatedStyleObject = styleObject()
                    styleSheet = this.createStyleSheet(styleSheetIdWithItorNum, evaluatedStyleObject)
                    el.classList.add(styleSheetIdWithItorNum)

                    // 移除之前的
                    // TODO 如何防止 css 爆炸？应该从 document 上也移除？
                    const lastId = `${styleSheetId}F${index}I${styleItorNum-1}`
                    document.adoptedStyleSheets.splice(document.adoptedStyleSheets.indexOf(this.styleScripts.get(lastId)!), 1)
                    el.classList.remove(lastId)
                }
            }

            this.styleScripts.set(styleSheetIdWithItorNum, styleSheet)
        })

        if (!allStatic) {
            this.elToStyleIdItorNum.set(el, styleItorNum + 1)
        }
    }
    isNestedStyleObject(key: string, styleObject: any): boolean {
        // TODO 使用这种方式来判断是不是嵌套的，未来可能有问题
        return key !== '@keyframes' && isPlainObject(styleObject)
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
                this.pathContext.root.on('attach', this.attachRefs, {once: true})
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

        if (key === 'style' ) {
            return StaticHost.styleManager.update(this.pathContext.hostPath, path, value, el)
        } else {
            const final = Array.isArray(value) ?
                value.map(v => isAtomLike(v) ? v() : v) :
                isAtomLike(value) ? value() : value
            if (/^data-/.test(key)) {
                // 使用 dataset 的时候 key 要进行驼峰化
                // ref: https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLElement/dataset#%E5%90%8D%E7%A7%B0%E8%BD%AC%E6%8D%A2
                el.dataset[camelize(key.slice(5))] = final
            } else {
                setAttribute(el, key, final, isSVG)
            }
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

            await Promise.all(promises)
        }
        removeNodesBetween(this.element!, this.placeholder, true)
    }
}


function eventToPromise(el: HTMLElement, event: string) {
    return new Promise(resolve => {
        el.addEventListener(event, () => {
            resolve(true)
        }, { once: true })
    })
}
