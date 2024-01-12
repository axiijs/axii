import {
    setAttribute,
    UnhandledPlaceholder,
    insertBefore,
    ExtendedElement
} from "./DOM";
import {Context, Host} from "./Host";
import {computed, destroyComputed, isAtom, isReactive} from "data0";
import {createHost} from "./createHost";
import {removeNodesBetween, assert} from "./util";
// patch isValidAttribute 用来处理自定义  reactive 属性
import {createElement} from "./DOM.js";

// CAUTION 覆盖原来的判断，增加关于 isReactiveValue 的判断。这样就不会触发 reactive 的读属性行为了，不会泄漏到上层的 computed。
const originalIsValidAttribute = createElement.isValidAttribute
createElement.isValidAttribute = function(name:string, value:any) {
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

export class StaticHost implements Host{
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
        const context =  this.context
        if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return

        const isSVG = result instanceof SVGElement

        const { unhandledChildren, unhandledAttr } = result as ExtendedElement

        this.reactiveHosts =
            unhandledChildren ?
                unhandledChildren.map(({ placeholder, child}) => createHost(child, placeholder, context)) :
                []

        this.attrComputeds = []
        unhandledAttr?.forEach(({ el, key, value}) => {

            this.attrComputeds!.push(computed(() => {
                // 肯定是有不能识别的 style
                const final = Array.isArray(value) ?
                    value.map(v => isAtomLike(v) ? v() : v) :
                    isAtomLike(value) ? value() : value
                setAttribute(el, key, final, isSVG)
            }))

        })

    }
    destroy(parentHandle?:boolean) {
        this.attrComputeds!.forEach(attrComputed => destroyComputed(attrComputed))
        this.reactiveHosts!.forEach(host => host.destroy(true))
        if (!parentHandle) {
            removeNodesBetween(this.element!, this.placeholder, true)
        }
    }
}