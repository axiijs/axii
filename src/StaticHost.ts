import {
    AUTO_ADD_PX_STYLE,
    createElement,
    ExtendedElement,
    insertBefore,
    RefHandleInfo,
    setAttribute,
    UnhandledPlaceholder
} from "./DOM";
import {Host, PathContext} from "./Host";
import {computed, destroyComputed, isAtom, isReactive} from "data0";
import {createHost} from "./createHost";
import {assert, removeNodesBetween} from "./util";
import {ComponentHost} from "./ComponentHost.js";

// CAUTION 覆盖原来的判断，增加关于 isReactiveValue 的判断。这样就不会触发 reactive 的读属性行为了，不会泄漏到上层的 computed。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function(name:string, value:any) {
    if (name.startsWith('on')) return true

    if (Array.isArray(value) && value.some(isReactiveValue)) {
        return false
    } else if (isReactiveValue(value)){
        return false
    }
    return originalIsValidAttribute(name, value)
}

function isReactiveValue(v:any) {
    return isReactive(v) || isAtom(v) || typeof v === 'function'
}

function isAtomLike(v:any) {
    return isAtom(v) || typeof v === 'function'
}


function hasPsuedoClassOrNestedStyle(styleObject: StyleObject|StyleObject[]) {
    if (Array.isArray(styleObject)) {
        return styleObject.some(hasPsuedoClassOrNestedStyle)
    }
    return Object.entries(styleObject).some(([key, value]) => key.startsWith(':') || (typeof value === 'object' && value !== null))
}


class StyleManager {
    public styleScripts = new Map<string, HTMLStyleElement>()
    public elToStyleId = new WeakMap<HTMLElement, string>()
    getStyleSheetId(hostPath: Host[], elementPath: number[], el: ExtendedElement|null) {
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

        const lastComponentHostIndex = hostPath.findLastIndex(host => host instanceof ComponentHost)
        const lastComponentHost = lastComponentHostIndex === -1 ? undefined : hostPath[lastComponentHostIndex] as ComponentHost
        const pathToGenerateId = lastComponentHostIndex === -1 ? hostPath : hostPath.slice(lastComponentHostIndex + 1)
        // CAUTION 一定要有个字母开始 id，不然 typeId 可能是数字，不能作为 class 开头
        return `gen-${lastComponentHost?.typeId??'global'}-${pathToGenerateId.map(host => host.pathContext.elementPath.join('_')).join('-')}-${elementPath.join('_')}`
    }
    stringifyStyleObject(styleObject: {[k:string]:any}): string {
        return Object.entries(styleObject).map(([key, value]) => {

            const property = key.replace(/([A-Z])/g, '-$1').toLowerCase()

            // value 是数字类型的 attr，自动加上 px
            if (typeof value === 'number' && AUTO_ADD_PX_STYLE.test(key)) {
                return `${property}:${value}px;`
            } else {
                return `${property}:${value};`
            }
        }).join('\n')
    }
    update(hostPath: Host[], elementPath: number[], styleObject: StyleObject, el: ExtendedElement, isStatic: boolean = false) {
        // 使用这个更新的 style 都是有伪类或者有嵌套的，一定需要生成 class 的。
        const styleSheetId = this.getStyleSheetId(hostPath, elementPath, isStatic ? null : el)
        let styleScript = this.styleScripts.get(styleSheetId)
        if (!styleScript) {
            styleScript = document.createElement("style");
            document.head.appendChild(styleScript)
            this.styleScripts.set(styleSheetId, styleScript)
        }

        styleScript!.innerHTML = this.generateStyleContent(`.${styleSheetId}`, styleObject)
        el.classList.add(styleSheetId)
    }
    generateStyleContent(selector:string, styleObject: StyleObject) {
        const valueKeys = Object.keys(styleObject).filter(key => typeof styleObject[key] !== 'object')
        const nestedKeys = Object.keys(styleObject).filter(key => typeof styleObject[key] === 'object')
        const valueStyleObject = Object.fromEntries(valueKeys.map(key => [key, styleObject[key]]))

        const valueStyleContent = `${selector} {
${this.stringifyStyleObject(valueStyleObject)}
}
`

        const nestedStyleContent: string = nestedKeys.map(key => {
            // 支持 at-rules for media/container query
            if (key.startsWith('@')) {
                return `${key} {
    ${this.generateStyleContent(selector, styleObject[key])}
}`
            }

            const nestedClassName = /^(\s?)+&/.test(key) ? key.replace('&', selector) : `${selector} ${key}`
            return this.generateStyleContent(nestedClassName, styleObject[key])
        }).join('\n')

        return valueStyleContent + nestedStyleContent
    }
}

type StyleObject = {[k:string]:any}

function isStaticStyleObject(styleObject: StyleObject|StyleObject[]): boolean {
    if (Array.isArray(styleObject)) {
        return styleObject.every(isStaticStyleObject)
    }
    return typeof styleObject === 'object'
}

export class StaticHost implements Host{
    static styleManager = new StyleManager()
    // CAUTION Component 只因为 props 的引用变化而重新 render。
    //  只有有 diff 算发以后才会出现引用变化的情况，现在我们还没有实现。所以现在其实永远不会重 render
    computed = undefined
    reactiveHosts?: Host[]
    attrComputeds?: ReturnType<typeof computed>[]
    refHandles?: RefHandleInfo[]
    constructor(public source: HTMLElement|SVGElement|DocumentFragment, public placeholder: UnhandledPlaceholder, public pathContext: PathContext) {
    }
    get parentElement() {
        return this.placeholder.parentElement
    }
    element: HTMLElement|Comment|SVGElement = this.placeholder
    render(): void {
        assert(this.element === this.placeholder, 'should never rerender')

        this.element = this.source instanceof DocumentFragment ? document.createComment('fragment start') : this.source
        insertBefore(this.source, this.placeholder)
        this.collectInnerHost()
        this.collectReactiveAttr()
        this.collectReactiveAttr()
        this.collectRefHandles()
        this.reactiveHosts!.forEach(host => host.render())
    }
    collectInnerHost() {
        const result = this.source
        if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return

        const { unhandledChildren } = result as ExtendedElement

        this.reactiveHosts =
            unhandledChildren ?
                unhandledChildren.map(({ placeholder, child, path}) =>
                    createHost(child, placeholder, {
                        ...this.pathContext,
                        hostPath: [...this.pathContext.hostPath, this],
                        elementPath: path
                    })
                ) :
                []

    }
    collectReactiveAttr() {
        const result = this.source
        if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return

        const isSVG = result instanceof SVGElement

        const {  unhandledAttr } = result as ExtendedElement

        this.attrComputeds = []
        unhandledAttr?.forEach(({ el, key, value, path}) => {
            this.attrComputeds!.push(computed(() => {

                const final = Array.isArray(value) ?
                    value.map(v => isAtomLike(v) ? v() : v) :
                    isAtomLike(value) ? value() : value

                if (key === 'style' && (hasPsuedoClassOrNestedStyle(final))) {
                    const isStatic = isStaticStyleObject(value)
                    const finalStyleObject = Array.isArray(final) ? Object.assign({}, ...final) : final
                    StaticHost.styleManager.update(this.pathContext.hostPath, path, finalStyleObject, el, isStatic )
                } else {
                    setAttribute(el, key, final, isSVG)
                }
            }))
        })
    }
    collectRefHandles() {
        const result = this.source
        if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return
        const {  refHandles } = result as ExtendedElement
        this.refHandles = refHandles
    }
    destroy(parentHandle?:boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.attrComputeds?.forEach(attrComputed => destroyComputed(attrComputed))
        }

        this.reactiveHosts?.forEach(host => host.destroy(true, parentHandleComputed))

        this.refHandles?.forEach(({ handle }: RefHandleInfo) => {
            createElement.detachRef(handle)
        })


        if (!parentHandle) {
            removeNodesBetween(this.element!, this.placeholder, true)
        }
    }
}