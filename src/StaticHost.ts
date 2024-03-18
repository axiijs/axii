import {
    setAttribute,
    UnhandledPlaceholder,
    insertBefore,
    ExtendedElement,
    createElement, AUTO_ADD_PX_STYLE
} from "./DOM";
import {Context, Host} from "./Host";
import {computed, destroyComputed, isAtom, isReactive} from "data0";
import {createHost} from "./createHost";
import {removeNodesBetween, assert} from "./util";
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

function hasPsuedoClassOrNestedStyle(styleObject: {[k:string]:any}) {
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
        return `gen-${lastComponentHost?.typeId??'global'}-${pathToGenerateId.map(host => host.context.elementPath.join('.')).join('-')}-${elementPath.join('.')}`
    }
    stringifyStyleObject(styleObject: {[k:string]:any}): string {
        return Object.entries(styleObject).map(([key, value]) => {
            // value 是对象，说明是嵌套的，继续递归
            if (typeof value === 'object' && value !== null) {
                return `${key} {
${this.stringifyStyleObject(value)}}
`
            } else {
                // value 是数字类型的 attr，自动加上 px
                if (typeof value === 'number' && AUTO_ADD_PX_STYLE.test(key)) {
                    return `${key}:${value}px;`
                } else {
                    return `${key}:${value};`
                }
            }
        }).join('\n')
    }
    update(hostPath: Host[], elementPath: number[], styleObject: {[k:string]:any}, el: ExtendedElement, isStatic: boolean = false) {
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

            const nestedClassName = /^(\s?)+&/.test(key) ? key.replace('&', selector) : `${selector} ${key}`
            return this.generateStyleContent(nestedClassName, styleObject[key])
        }).join('\n')

        return valueStyleContent + nestedStyleContent
    }
}

type StyleObject = {[k:string]:any}

export class StaticHost implements Host{
    static styleManager = new StyleManager()
    // CAUTION Component 只因为 props 的引用变化而重新 render。
    //  只有有 diff 算发以后才会出现引用变化的情况，现在我们还没有实现。所以现在其实永远不会重 render
    computed = undefined
    reactiveHosts?: Host[]
    attrComputeds?: ReturnType<typeof computed>[]
    constructor(public source: HTMLElement|SVGElement|DocumentFragment, public placeholder: UnhandledPlaceholder, public context: Context) {
    }
    get parentElement() {
        return this.placeholder.parentElement
    }
    element: HTMLElement|Comment|SVGElement = this.placeholder
    render(): void {
        assert(this.element === this.placeholder, 'should never rerender')

        this.element = this.source instanceof DocumentFragment ? new Comment('fragment start') : this.source
        insertBefore(this.source, this.placeholder)
        this.collectInnerHostAndAttr()
        this.reactiveHosts!.forEach(host => host.render())
    }
    collectInnerHostAndAttr() {
        const result = this.source
        if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return

        const isSVG = result instanceof SVGElement

        const { unhandledChildren, unhandledAttr } = result as ExtendedElement

        this.reactiveHosts =
            unhandledChildren ?
                unhandledChildren.map(({ placeholder, child, path}) =>
                    createHost(child, placeholder, {
                        ...this.context,
                        hostPath: [...this.context.hostPath, this],
                        elementPath: path
                    })
                ) :
                []

        this.attrComputeds = []
        unhandledAttr?.forEach(({ el, key, value, path}) => {
            this.attrComputeds!.push(computed(() => {

                const final = Array.isArray(value) ?
                    value.map(v => isAtomLike(v) ? v() : v) :
                    isAtomLike(value) ? value() : value

                if (key === 'style' && (hasPsuedoClassOrNestedStyle(final))) {
                    const isStatic = typeof value === 'object'
                    // StaticHost.styleManage.update(this.context.hostPath, path, final, isStatic ? null : el)
                    StaticHost.styleManager.update(this.context.hostPath, path, final, el, isStatic )
                } else {
                    setAttribute(el, key, final, isSVG)
                }
            }))
        })

    }
    destroy(parentHandle?:boolean, parentHandleComputed?: boolean) {
        if (!parentHandleComputed) {
            this.attrComputeds?.forEach(attrComputed => destroyComputed(attrComputed))
        }

        this.reactiveHosts?.forEach(host => host.destroy(true, parentHandleComputed))

        if (!parentHandle) {
            removeNodesBetween(this.element!, this.placeholder, true)
        }
    }
}