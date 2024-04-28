import {RxList, RxMap} from "data0";
import {createContext} from "./ContextProvider.js";
import {RenderContext} from "./types.js";
import PropTypes from "./propTypes.js";

type FormProps = {
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
export function Form({name, children, onChange, onSubmit, onClear, onReset, values}: FormProps, {
    createElement,
    context
}: RenderContext) {

    const instances: { [k: string]: FormItemInstance | FormItemInstance[] } = {}

    const register = (name: string, instance: FormItemInstance, multiple?: boolean) => {
        if (multiple) {
            if (!values.get(name)) {
                values.set(name, new RxList([]))
            }
            if (!instances[name]) {
                instances[name] = []
            }
            values.get(name).push(instance.value)
            (instances[name] as Array<FormItemInstance>).push(instance)

        } else {
            values.set(name, instance.value)
            instances[name] = instance
        }
    }

    const unregister = (name: string, instance: FormItemInstance, multiple?: boolean) => {
        if (multiple) {
            const valuesList = values.get(name) as RxList<any>
            const valueIndex = valuesList.findIndex(v => v === instance.value)
            if (valueIndex() > -1) {
                valuesList.splice(valueIndex(), 1)
            }

            const index = (instances[name] as Array<FormItemInstance>).findIndex(i => i === instance)
            if (index > -1) {
                (instances[name] as Array<FormItemInstance>).splice(index, 1)
            }
        } else {
            values.delete(name)
            delete instances[name]
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

    context.set(FormContext, {name, register, unregister, onChange, submit, reset, clear} as FormContextValue)
    return children
}

Form.propTypes = {
    name: PropTypes.string.isRequired,
    values: PropTypes.rxMap<string, any>(),
    children: PropTypes.any.isRequired,
    onChange: PropTypes.function,
    onSubmit: PropTypes.function,
    onClear: PropTypes.function,
    onReset: PropTypes.function,
}