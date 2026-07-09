/** @jsx createElement */
/**
 * 2026-07 深度 review 第八轮的改进项回归测试（I34-I35）。
 * 详见 prompt/output/13-review-2026-07-round8.md。
 */
import {createElement, createRoot, Form, FormContext, RenderContext} from "@framework";
import {atom, RxList, RxMap} from "data0";
import {beforeEach, describe, expect, test} from "vitest";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('improvements regression (2026-07 round-8 review)', () => {
    let rootEl: HTMLElement
    beforeEach(() => {
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
    })

    /**
     * I34: 函数节点重算的「结构重建」阶段抛错（unknown child type 断言等）之前不经过
     * root error 钩子：重算发生在微任务里，错误直接变成 uncaught error；
     * 更严重的是 pauseTracking/pauseCollectChild 没有 finally 恢复，
     * 一次抛错后全局 Notifier 停止追踪，整个应用的响应式全部失效。
     */
    test('I34: structure rebuild error goes to the error hook, region renders empty and can recover', async () => {
        const mode = atom<'ok' | 'bad' | 'ok2'>('ok')
        const other = atom('other-initial')
        function App({}: any, {createElement}: RenderContext) {
            return <div>
                <span id="i34">{() => mode() === 'bad' ? ({} as any) : mode()}</span>
                <span id="i34-other">{other}</span>
            </div>
        }
        const root = createRoot(rootEl)
        const errors: any[] = []
        root.on('error', e => errors.push(e))
        root.render(<App/>)
        expect(document.getElementById('i34')!.textContent).toBe('ok')

        mode('bad')
        await sleep(20)
        expect(errors.length).toBe(1)
        expect(String(errors[0])).toContain('unknown child type')
        // 出错区域渲染为空
        expect(document.getElementById('i34')!.textContent).toBe('')
        // 全局响应式没有被抛错破坏（pauseTracking 已恢复）：其他绑定照常更新
        other('other-updated')
        await sleep(20)
        expect(document.getElementById('i34-other')!.textContent).toBe('other-updated')
        // 依赖恢复后该区域能恢复渲染
        mode('ok2')
        await sleep(20)
        expect(document.getElementById('i34')!.textContent).toBe('ok2')
        root.destroy()
    })

    /**
     * I35: Form 的 multiple 字段允许用户在 values 里用普通数组提供初始值
     * （values: new RxMap({tags: ['preset']})）。register 之前不做收敛：
     * push 进普通数组没有响应性，unregister 读 .data 直接 TypeError。
     */
    test('I35: multiple field with plain-array initial values is coerced to RxList', () => {
        let capturedContext: any
        function Item({}: any, {createElement, context}: RenderContext) {
            capturedContext = context.get(FormContext)
            return <span>item</span>
        }
        const values = new RxMap<string, any>([['tags', ['preset']]])
        const root = createRoot(rootEl)
        root.render(<Form name="f" values={values}><Item/></Form>)

        const value = atom('a')
        const instance = {value, reset: () => {}, clear: () => {}}
        capturedContext.register('tags', instance, true)
        const list = values.get('tags') as RxList<any>
        // 收敛成 RxList 且保留初始项
        expect(list instanceof RxList).toBe(true)
        expect(list.data.length).toBe(2)
        expect(list.data[0]).toBe('preset')
        expect(list.data[1]).toBe(value)

        capturedContext.unregister('tags', instance, true)
        expect(list.data.length).toBe(1)
        expect(list.data[0]).toBe('preset')
        root.destroy()
    })
})
