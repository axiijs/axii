import {RxList, RxMap} from "data0";
import {createContext} from "./ContextProvider.js";
import {RenderContext} from "./types.js";
import PropTypes from "./propTypes.js";

export type FormProps = {
    name: string,
    // delegate 所有的 onChange 的 item
    onChange?: (values: any) => void
    onSubmit?: (values: any) => void
    onClear?: () => void
    onReset?: () => void
    values: RxMap<string, any>;
    children: any
};

export type FormContextValue = {
    name: string
    register: (name: string, instance: FormItemInstance, multiple?: boolean) => void
    unregister: (name: string, instance: FormItemInstance, multiple?: boolean) => void
    onChange: FormProps['onChange'],
    submit: () => void
    clear: () => void,
    reset: () => void
}

export const FormContext = createContext<FormContextValue>('Form')

export type FormItemInstance = {
    reset: () => void
    clear: () => void
    value: any
}

// TODO 如何支持 multiple form
// TODO 如何支持 item 多 value
// TODO  如何只是 dirty/touched/untouched 等状态，和 error/waring 等自定义状态
export function Form({name, children, onChange, onSubmit, onClear, onReset, values}: FormProps, {
    createElement,
    context
}: RenderContext) {

    const instances: { [k: string]: FormItemInstance | FormItemInstance[] } = {}
    // 非 multiple 的同名字段：被后注册者顶替、但自己还没注销的实例（按注册顺序）。
    //  只有真的出现同名字段时才分配。
    const shadowed: { [k: string]: FormItemInstance[] } = {}

    const register = (name: string, instance: FormItemInstance, multiple?: boolean) => {
        if (multiple) {
            // CAUTION 用户可以在 values 里用普通数组给 multiple 字段提供初始值
            //  （values: new RxMap({tags: ['preset']})），必须收敛成 RxList（保留初始项），
            //  否则 unregister 读 .data 直接 TypeError，push 进普通数组也没有响应性。
            const existing = values.get(name)
            if (!(existing instanceof RxList)) {
                values.set(name, new RxList(Array.isArray(existing) ? existing : []))
            }
            if (!instances[name]) {
                instances[name] = []
            }
            // CAUTION 不要把下面两行合并成以 `(` 开头的写法，会触发 ASI 陷阱：
            //  上一行 push(...) 的返回值会被当成函数调用而抛 TypeError。
            const instanceList = instances[name] as Array<FormItemInstance>;
            (values.get(name) as RxList<any>).push(instance.value)
            instanceList.push(instance)

        } else {
            const previous = instances[name]
            if (previous && previous !== instance && !Array.isArray(previous)) {
                (shadowed[name] ||= []).push(previous)
            }
            values.set(name, instance.value)
            instances[name] = instance
        }
    }

    const unregister = (name: string, instance: FormItemInstance, multiple?: boolean) => {
        if (multiple) {
            const valuesList = values.get(name) as RxList<any>
            // CAUTION 不能用 RxList.findIndex：它每次调用都会创建一个长驻的响应式 computed，
            //  这里只需要一次性的位置查询，直接查 raw data，unregister 不留任何订阅。
            const valueIndex = valuesList.data.indexOf(instance.value)
            if (valueIndex > -1) {
                valuesList.splice(valueIndex, 1)
            }

            const index = (instances[name] as Array<FormItemInstance>).findIndex(i => i === instance)
            if (index > -1) {
                (instances[name] as Array<FormItemInstance>).splice(index, 1)
            }
        } else if (instances[name] === instance) {
            // 当前登记的就是它：还有被它顶替、仍然挂载着的同名字段时交还给最近的那个，否则才删除
            const previous = shadowed[name]?.pop()
            if (previous) {
                values.set(name, previous.value)
                instances[name] = previous
            } else {
                values.delete(name)
                delete instances[name]
            }
        } else {
            // CAUTION 必须核对 instance：同名字段是自然写法（一组 radio、条件切换的两个输入、
            //  列表行被 splice 替换时新行先注册旧行后注销），不核对的话旧字段的注销会把
            //  **仍然挂载着**的字段的值从 values 里删掉，表单状态与界面静默分叉。
            //  这里注销的是已被顶替的实例，只把它从待交还列表里拿掉。
            const list = shadowed[name]
            if (list) {
                const index = list.indexOf(instance)
                if (index > -1) list.splice(index, 1)
            }
        }
    }

    const submit = () => {
        onSubmit?.(values)
    }

    const reset = () => {
        Object.values(instances).forEach((instance: FormItemInstance | FormItemInstance[]) => {
            if (Array.isArray(instance)) {
                instance.forEach(i => i.reset())
            } else {
                instance.reset()
            }
        })
        onReset?.()
    }

    const clear = () => {
        Object.values(instances).forEach((instance: FormItemInstance | FormItemInstance[]) => {
            if (Array.isArray(instance)) {
                instance.forEach(i => i.clear())
            } else {
                instance.clear()
            }
        })

        onClear?.()
    }

    const formOnChange = () => {
        onChange?.(values)
    }

    context.set(FormContext, {name, register, unregister, onChange:formOnChange, submit, reset, clear} as FormContextValue)
    return children
}

Form.propTypes = {
    name: PropTypes.string.isRequired,
    // CAUTION 必须有默认值：不传 values 时 register 里的 values.set 会直接 TypeError
    //  崩掉整棵渲染树（Form 只是想托管状态、外部不消费 values 是自然用法）。
    values: PropTypes.rxMap<string, any>().default(() => new RxMap<string, any>({})),
    children: PropTypes.any.isRequired,
    onChange: PropTypes.function,
    onSubmit: PropTypes.function,
    onClear: PropTypes.function,
    onReset: PropTypes.function,
}