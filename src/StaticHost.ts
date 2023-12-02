import {containerToUnhandled, containerToUnhandledAttr, setAttribute, UnhandledPlaceholder, insertBefore} from "./DOM";
import {Context, Host} from "./Host";
import {computed, destroyComputed, isAtom, isReactive} from "data0";
import {createHost} from "./createHost";
import {removeNodesBetween} from "./util";

// FIXME 不应该出现 reactive，因为 createElement 的时候会直接读，造成泄露？
function isReactiveValue(v:any) {
    return isReactive(v) || isAtom(v) || typeof v === 'function'
}

function isAtomLike(v:any) {
    return isAtom(v) || typeof v === 'function'
}


function renderReactiveChildAndAttr(result: HTMLElement|ChildNode|DocumentFragment|SVGElement, context: Context) {
    if (!(result instanceof HTMLElement || result instanceof DocumentFragment || result instanceof SVGElement)) return

    const isSVG = result instanceof SVGElement

    const unhandledChild = containerToUnhandled.get(result)

    const reactiveHosts:  Host[]=
        unhandledChild ?
            unhandledChild.map(({ placeholder, child}) => createHost(child, placeholder, context)) :
            []

    const attrComputeds: ReturnType<typeof computed>[] = []
    const unhandledAttr = containerToUnhandledAttr.get(result)
    unhandledAttr?.forEach(({ el, key, value}) => {

        // 增加一些类型判断
        if (__DEV__) {
            if (Array.isArray(value)) {
                if (!value.every(isReactiveValue)) throw new Error(`unknown attr array type: ${key}`)
            } else {
                if (!isReactiveValue(value)) throw new Error(`unknown attr type: ${key}`)
            }
        }

        // CAUTION 这里只有 style 和 className 的合并是特殊情况，其他都是字符串，直接覆盖。
        if(key === 'style' || key === 'className') {
            attrComputeds.push(computed(() => {
                // 肯定是有不能识别的 style
                const final = Array.isArray(value) ? value.map(v => isAtomLike(v) ? v() : v) : value()
                setAttribute(el, key, final)
            }))
        } else {
            const last = Array.isArray(value) ? value.at(-1) : value
            if (isReactiveValue(last)) {
                attrComputeds.push(computed(() => {
                    setAttribute(el, key, isAtomLike(last) ? last() : last,  isSVG)
                }))
            } else {
                setAttribute(el, key, last,  isSVG)
            }
        }
    })

    return {
        reactiveHosts,
        attrComputeds,
        renderHosts: () => reactiveHosts.forEach(host => host.render())
    }
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
        if (this.element === this.placeholder) {
            this.element = this.source instanceof DocumentFragment ? new Comment('fragment start') : this.source
            insertBefore(this.source, this.placeholder)
            const { reactiveHosts, attrComputeds, renderHosts } = renderReactiveChildAndAttr(this.source, this.context)!
            this.reactiveHosts = reactiveHosts
            this.attrComputeds = attrComputeds
            renderHosts()
        } else {
            throw new Error('should never rerender')
        }
    }
    destroy(parentHandle?:boolean) {
        this.attrComputeds!.forEach(attrComputed => destroyComputed(attrComputed))
        this.reactiveHosts!.forEach(host => host.destroy(true))
        if (!parentHandle) {
            removeNodesBetween(this.element!, this.placeholder, true)
        }
    }
}