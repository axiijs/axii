# 04 致命问题测试复现报告

本报告记录 [02-fatal-issues.md](./02-fatal-issues.md) 中 8 个致命问题的验证方法与结果。

**结论：8 个致命问题全部确认存在，没有误报。**

## 验证方法

复现测试在分支 `cursor/reproduce-fatal-bugs-0b0a` 上（PR [axiijs/axii#11](https://github.com/axiijs/axii/pull/11)），文件：

- `__tests__/fatalBugs.spec.tsx` — 浏览器环境（vitest browser mode + Playwright chromium），复现 BUG 1a/1b、2、3、4a/4b、5、8，共 8 个测试；
- `__tests__/node/importInNode.spec.ts` + `vitest.node.config.ts` — node 环境，复现 BUG 7（默认测试环境是真实浏览器，`ResizeObserver` 存在，暴露不了这个问题）；
- BUG 6 由测试环境搭建过程本身证实（见下）。

**约定**：每个测试断言的是【当前的错误行为】，测试通过 = bug 确实存在。每个测试的注释中写明了正确行为应该是什么；修复对应 bug 后，断言应当反转，测试即转为回归测试。

## 运行方式

```bash
npm install
npx playwright install chromium

# 浏览器环境复现（BUG 1/2/3/4/5/8）
npx vitest run __tests__/fatalBugs.spec.tsx --coverage.enabled=false

# node 环境复现（BUG 7）
npx vitest run --config vitest.node.config.ts

# 全量回归（确认没有破坏既有测试）
npx vitest run --coverage.enabled=false
```

## 逐项结果

| Bug | 测试 | 观测到的错误行为 | 结果 |
| --- | --- | --- | --- |
| 1a | `layoutEffect of a destroyed component still runs when root attaches later` | detached 容器中组件销毁后，`root.dispatch('attach')` 仍执行了它的 layoutEffect（`layoutEffectRuns === 1`，应为 0） | ✅ 复现 |
| 1b | `ref of a destroyed element is re-attached when root attaches later` | 元素销毁时 ref 已收到 `null`，attach 后 ref 又被赋值为已脱离文档的元素（`isConnected === false`） | ✅ 复现 |
| 2 | `detach event is never dispatched on root.destroy()` | `root.on('detach', spy)` 后 `destroy()`，spy 未被调用 | ✅ 复现 |
| 3 | `Form register with multiple=true throws TypeError (ASI hazard)` | `register('field', instance, true)` 抛 `TypeError: ... is not a function` | ✅ 复现 |
| 4a | `sorting an RxList that has a preceding sibling moves items before the sibling` | `<div><h1/>{list}</div>` 结构下 `list.sortSelf()` 后子元素顺序变为 `['SPAN','SPAN','SPAN','H1']`（应为 `['H1','SPAN','SPAN','SPAN']`） | ✅ 复现 |
| 4b | `list.set(0, ...) with a preceding sibling inserts the new item before the sibling` | `list.set(0, 9)` 后新元素出现在 `<h1>` 之前 | ✅ 复现 |
| 5 | `element with both onChange and onInput throws "already listened"` | `createElement('input', {onChange, onInput})` 直接抛 `already listened` | ✅ 复现 |
| 6 | （环境搭建过程证实，非 spec） | 全新环境无 `../data0` 兄弟目录时，`npm install && npm test` 无法运行：`data0` 被硬编码 alias 到不存在的路径，且不在 devDependencies | ✅ 证实 |
| 7 | `import of the framework entry crashes with ReferenceError` (node env) | node 环境 `import 'src/index'` 在 import 阶段 reject：`ReferenceError: ResizeObserver is not defined` | ✅ 复现 |
| 8 | `dynamic style with nested selector leaks one stylesheet per update` | 动态嵌套样式更新 20 次，`document.adoptedStyleSheets.length` 恰好增长 20 | ✅ 复现 |

## 环境修复说明（BUG 6 的附带处理）

为了让复现测试能在独立 clone 上运行，本分支做了两处最小改动：

1. `package.json`：`devDependencies` 增加 `data0@1.13.0`（在 peerDependencies `^1.10.0` 范围内）；
2. `vitest.config.ts`：`data0` alias 改为"`../data0` 兄弟目录存在则使用其源码（保持原作者的开发方式），否则回退到 npm 安装的 data0"。

`package.json` 的 `"main": "index.js"` 指向不存在文件的问题**未**在本分支修复，留给维护者决策。

## 回归确认

全量测试套件在改动后全部通过：

```
Test Files  14 passed (14)
     Tests  121 passed (121)   # 113 个既有测试 + 8 个新增复现测试
```

node 环境套件：1 passed (1)。
