/** @jsx createElement */
/**
 * Form 组件此前被排除在 coverage 之外且几乎没有测试（multiple 注册路径的 ASI bug 因此漏网）。
 * 本文件补齐 Form 的单值注册/注销、submit/reset/clear、onChange 委托等路径。
 * multiple 注册路径的回归测试见 fatalBugs.spec.tsx（BUG 3）。
 */
import {createElement, createRoot, Form, FormContext, FormItemInstance, RenderContext} from "@framework";
import {atom, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

describe('Form', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    function makeInstance(initial: any) {
        const value = atom(initial)
        return {
            value,
            resetCalls: 0,
            clearCalls: 0,
            reset() { this.resetCalls++ },
            clear() { this.clearCalls++ },
        }
    }

    function renderForm(props: Partial<{onChange: any, onSubmit: any, onClear: any, onReset: any}> = {}) {
        const values = new RxMap<string, any>({})
        let formContext: any = null

        function Item({}: any, {createElement, context}: RenderContext) {
            formContext = context.get(FormContext)
            return <div>item</div>
        }

        const root = createRoot(rootEl)
        root.render(<Form name="test" values={values} {...props}><Item/></Form>)
        return {root, values, getFormContext: () => formContext}
    }

    test('single register puts value into values, unregister removes it', () => {
        const {root, values, getFormContext} = renderForm()
        const instance = makeInstance(1)

        getFormContext().register('field', instance)
        expect(values.get('field')).toBe(instance.value)

        getFormContext().unregister('field', instance)
        expect(values.get('field')).toBeUndefined()
        root.destroy()
    })

    test('submit calls onSubmit with values', () => {
        const submitted: any[] = []
        const {root, values, getFormContext} = renderForm({onSubmit: (v: any) => submitted.push(v)})

        getFormContext().submit()
        expect(submitted.length).toBe(1)
        expect(submitted[0]).toBe(values)
        root.destroy()
    })

    test('reset calls reset on all instances (single and multiple) and onReset', () => {
        let resetCalled = 0
        const {root, getFormContext} = renderForm({onReset: () => resetCalled++})
        const single = makeInstance(1)
        const multi1 = makeInstance(2)
        const multi2 = makeInstance(3)

        getFormContext().register('single', single)
        getFormContext().register('multi', multi1 as unknown as FormItemInstance, true)
        getFormContext().register('multi', multi2 as unknown as FormItemInstance, true)

        getFormContext().reset()
        expect(single.resetCalls).toBe(1)
        expect(multi1.resetCalls).toBe(1)
        expect(multi2.resetCalls).toBe(1)
        expect(resetCalled).toBe(1)
        root.destroy()
    })

    test('clear calls clear on all instances (single and multiple) and onClear', () => {
        let clearCalled = 0
        const {root, getFormContext} = renderForm({onClear: () => clearCalled++})
        const single = makeInstance(1)
        const multi = makeInstance(2)

        getFormContext().register('single', single)
        getFormContext().register('multi', multi as unknown as FormItemInstance, true)

        getFormContext().clear()
        expect(single.clearCalls).toBe(1)
        expect(multi.clearCalls).toBe(1)
        expect(clearCalled).toBe(1)
        root.destroy()
    })

    test('onChange delegate forwards values to the form onChange', () => {
        const changed: any[] = []
        const {root, values, getFormContext} = renderForm({onChange: (v: any) => changed.push(v)})

        getFormContext().onChange()
        expect(changed.length).toBe(1)
        expect(changed[0]).toBe(values)
        root.destroy()
    })
})
