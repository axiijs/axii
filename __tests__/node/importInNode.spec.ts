/**
 * BUG 7 复现：reactiveDOMState.ts 在模块加载（类定义）时就执行
 * `new ResizeObserver(...)`（RxDOMSize.globalResizeObserver 静态属性），
 * 而 index.ts 会导出 reactiveDOMState，因此在 Node / SSR / 非浏览器测试环境中
 * `import 'axii'` 在 import 阶段直接抛 ReferenceError。
 *
 * CAUTION 测试断言的是【当前的错误行为】，测试通过 = bug 确实存在。
 * 正确行为：import 不应有浏览器 API 副作用（应惰性初始化），本测试应改为 resolves。
 *
 * 本文件需要在 node 环境运行（框架的默认测试环境是真实浏览器，那里 ResizeObserver 存在，
 * 无法暴露此问题）：npx vitest run --config vitest.node.config.ts
 */
import {describe, expect, test} from "vitest";

describe('BUG 7: importing axii outside a browser', () => {
    test('import of the framework entry crashes with ReferenceError: ResizeObserver is not defined', async () => {
        (globalThis as any).__DEV__ = true
        await expect(import('../../src/index.js')).rejects.toThrow(/ResizeObserver is not defined/)
    })
})
