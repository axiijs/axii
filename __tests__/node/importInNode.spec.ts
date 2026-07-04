/**
 * BUG 7 回归测试：reactiveDOMState.ts 曾在模块加载（类定义）时就执行
 * `new ResizeObserver(...)`（RxDOMSize.globalResizeObserver 静态属性），
 * 而 index.ts 会导出 reactiveDOMState，因此在 Node / SSR / 非浏览器测试环境中
 * `import 'axii'` 在 import 阶段直接抛 ReferenceError。
 *
 * 修复后 ResizeObserver 改为惰性初始化（首次访问 globalResizeObserver 时创建），
 * 正确行为：import 框架入口不应有浏览器 API 副作用。
 *
 * 本文件需要在 node 环境运行（框架的默认测试环境是真实浏览器，那里 ResizeObserver 存在，
 * 无法暴露此问题）：npx vitest run --config vitest.node.config.ts
 */
import {describe, expect, test} from "vitest";

describe('BUG 7: importing axii outside a browser', () => {
    test('import of the framework entry succeeds in node environment', async () => {
        (globalThis as any).__DEV__ = true
        const exported = await import('../../src/index.js')
        expect(exported.createElement).toBeTypeOf('function')
        expect(exported.createRoot).toBeTypeOf('function')
        expect(exported.RxDOMSize).toBeTypeOf('function')
    })

    test('ResizeObserver is only created lazily on first access', async () => {
        (globalThis as any).__DEV__ = true
        const {RxDOMSize} = await import('../../src/index.js')
        // 模块加载不应创建 ResizeObserver
        expect((RxDOMSize as any)._globalResizeObserver).toBeUndefined()
        // node 环境没有 ResizeObserver，首次访问时才应该报错
        expect(() => (RxDOMSize as any).globalResizeObserver).toThrow(/ResizeObserver is not defined/)
    })
})
