/** @jsx createElement */
import {
    createElement,
    createRoot,
    Form,
    FormContext,
    lazy,
    PropTypes,
    RenderContext,
} from "@framework";
import {atom, isAtom, RxList, RxMap, RxSet} from "data0";
import {beforeEach, describe, expect, test, vi} from "vitest";

function wait(time = 1) {
    return new Promise(resolve => {
        setTimeout(resolve, time)
    })
}

describe('release readiness gaps', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('lazy renders fallback, resolves component, and passes props', async () => {
        let resolveLoad!: (component: Function) => void
        const load = vi.fn(() => new Promise<Function>(resolve => {
            resolveLoad = resolve
        }))
        const fallback = vi.fn(() => <span>loading</span>)
        const LazyChild = lazy(load, fallback)

        function Loaded({label}: { label: string }) {
            return <strong>{label}</strong>
        }

        root.render(<LazyChild label="ready"/>)

        expect(load).toHaveBeenCalledTimes(1)
        expect(fallback).toHaveBeenCalledTimes(1)
        expect(rootEl.textContent).toBe('loading')

        resolveLoad(Loaded)
        await wait()

        expect(rootEl.textContent).toBe('ready')
    })

    test('Form registers fields, delegates commands, and unregisters on destroy', () => {
        let values!: RxMap<string, any>
        const onChange = vi.fn()
        const onSubmit = vi.fn()
        const onClear = vi.fn()
        const onReset = vi.fn()
        const singleReset = vi.fn()
        const singleClear = vi.fn()
        const tagReset = vi.fn()
        const tagClear = vi.fn()
        let formApi: any

        function Field({name, value, multiple = false, reset, clear}: any, {context, useEffect}: RenderContext) {
            const form = context.get(FormContext)
            const instance = {value, reset, clear}
            useEffect(() => {
                formApi = form
                form.register(name, instance, multiple)
                return () => form.unregister(name, instance, multiple)
            })
            return <span>{name}</span>
        }

        function App() {
            values = new RxMap<string, any>()
            return <Form
                name="profile"
                values={values}
                onChange={onChange}
                onSubmit={onSubmit}
                onClear={onClear}
                onReset={onReset}
            >
                <Field name="title" value="Engineer" reset={singleReset} clear={singleClear}/>
                <Field name="tags" value="frontend" multiple={true} reset={tagReset} clear={tagClear}/>
                <Field name="tags" value="runtime" multiple={true} reset={tagReset} clear={tagClear}/>
            </Form>
        }

        root.render(<App/>)

        expect(values.get('title')).toBe('Engineer')
        expect(values.get('tags')).toBeInstanceOf(RxList)
        expect(values.get('tags').toArray()).toEqual(['frontend', 'runtime'])

        formApi.onChange()
        formApi.submit()
        formApi.reset()
        formApi.clear()

        expect(onChange.mock.calls[0]![0]).toBe(values)
        expect(onSubmit.mock.calls[0]![0]).toBe(values)
        expect(onReset).toHaveBeenCalledTimes(1)
        expect(onClear).toHaveBeenCalledTimes(1)
        expect(singleReset).toHaveBeenCalledTimes(1)
        expect(singleClear).toHaveBeenCalledTimes(1)
        expect(tagReset).toHaveBeenCalledTimes(2)
        expect(tagClear).toHaveBeenCalledTimes(2)

        root.destroy()

        expect(values.get('title')).toBeUndefined()
        expect(values.get('tags').toArray()).toEqual([])
    })

    test('PropTypes runtime helpers check, default, and coerce data0@2 structures', () => {
        const numberWithDefault = PropTypes.number.default(() => 42)
        expect(numberWithDefault.defaultValue).toBe(42)
        expect(PropTypes.number.check(1)).toBe(true)
        expect(PropTypes.number('x')).toBeInstanceOf(Error)
        expect(PropTypes.number.stringify(12)).toBe('12')
        expect(PropTypes.number.parse('12.5')).toBe(12.5)
        expect(PropTypes.oneOf(['a', 'b']).check('b')).toBe(true)
        expect(PropTypes.oneOfType([PropTypes.number, PropTypes.string]).parse('12')).toBe(12)

        const atomValue = PropTypes.atom<string>().coerce!('name')
        expect(isAtom(atomValue)).toBe(true)
        expect(atomValue()).toBe('name')

        const sourceAtom = atom('existing')
        expect(PropTypes.atom<string>().coerce!(sourceAtom)).toBe(sourceAtom)

        const rxList = PropTypes.rxList<number>().coerce!([1, 2])
        expect(rxList).toBeInstanceOf(RxList)
        expect(rxList.toArray()).toEqual([1, 2])

        const rxSet = PropTypes.rxSet<string>().coerce!(['a', 'b'])
        expect(rxSet).toBeInstanceOf(RxSet)
        expect(rxSet.toArray()).toEqual(['a', 'b'])

        const rxMap = PropTypes.rxMap<string, number>().coerce!({a: 1})
        expect(rxMap).toBeInstanceOf(RxMap)
        expect(rxMap.get('a')).toBe(1)
    })

    test('public exports do not include legacy data0 reactive helpers', async () => {
        const framework = await import("@framework")
        expect('isReactive' in framework).toBe(false)
        expect('reactive' in framework).toBe(false)
    })
})
