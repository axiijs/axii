# `prompt/error-task-1.md` 追加任务2实施记录

## 实施范围

已落地第一阶段 DOM boundary 诊断：

- 新增 `src/diagnostics.ts`，提供 `AxiiError`、`AXII_DOM_BOUNDARY_BROKEN`、Host 栈、组件栈、DOM 快照和修复建议。
- `removeNodesBetween()` 在真实删除 DOM 前先校验 `start -> placeholder` 的 `nextSibling` 可达性，避免半删除后才暴露底层错误。
- `StaticHost`、`StaticArrayHost` 调用删除区间时传入 owner host 和操作阶段。
- `ReusableHost` 在复用区间移动和销毁前使用 `reusable-range` 策略校验 DOM 区间。
- 从 `src/index.ts` 导出诊断类型，方便应用和测试断言结构化错误。

已继续落地第二阶段源码定位数据链路：

- `jsxDEV(type, props, key, isStaticChildren, source, self)` 现在接收 React 风格 source 参数。
- `ComponentNode`、`ExtendedElement`、`UnhandledChildInfo`、`UnhandledAttrInfo` 增加 `AxiiSource` 元数据。
- `createHost()` 会把节点 source 写入 `PathContext.debugSource`，动态 child 会从 `UnhandledChildInfo.source` 继承 source。
- `AxiiError.hostStack` 和 `AxiiError.componentStack` 的 frame 现在包含 `source`，开发者可以从 DOM boundary 错误回到 TSX 文件、行列号。
- 新增 `createAxiiOverlayPayload()`，并保留手动 `showAxiiDevOverlay()` / `dismissAxiiDevOverlay()` 调试 API。
- 新增 `axiiDevtools()` Vite 插件入口，用于开启 JSX dev/source metadata。
- `axiiDevtools()` 现在会注入 `__AXII_CODE_FRAME_ENDPOINT__`，并提供 `/__axii/code-frame` middleware；`reportAxiiError()` 会自动按 source 拉取 code frame 并输出到 console。
- 新增 `createCodeFrame()` 和 `createCodeFrameMiddleware()`，用于 Vite 插件和测试覆盖 source map/code frame 基础能力。
- 默认错误报告改为 console group，不再自动创建页面 overlay；页面 DOM 保持出错现场，方便线上现象和本地复现对比。

追加 review 后已修正前两阶段里的简化点：

- 恢复 `style(null/undefined)` 清理 inline style 的行为，避免错误处理改动引入样式回归。
- `StaticHost.destroy()` 的无动画删除路径现在同步抛出 `AxiiError`；动画删除路径中的异步错误会进入 `reportAxiiError()`，避免未处理 Promise rejection。
- 增加 `configureDiagnostics({ enabled })`，生产环境或特定测试可以关闭结构化 DOM boundary 诊断，保留原始低成本错误路径。
- `ReusableHost` 移动到新 placeholder 时会更新自身 `pathContext/debugSource`，避免错误归因到旧位置。
- 测试里的错误断言改为显式捕获，避免 `try/catch` 没有抛错时空跑通过。

已落地第三阶段响应式链路追踪：

- 新增 `ReactiveTraceFrame`、`recordReactiveTrace()`、`withReactiveTrace()`、`getRecentReactiveTrace()`、`clearReactiveTrace()`。
- `AxiiError` 和 overlay payload 增加 `reactiveTrace`。
- `ComponentHost.render()` 记录组件初次 render。
- `FunctionHost` 记录动态函数 render 和 recompute。
- `StaticHost.collectReactiveAttr()` 记录动态属性 autorun。
- `AtomHost.render()` 记录 atom 文本更新。
- `RxListHost.applyPatch()` 记录 splice/reorder/explicit key change 的方法名、参数摘要、新增/删除数量，并在 patch 错误时走 `reportAxiiError()`，避免响应式更新里的 unhandled rejection。

## 真实浏览器验证

新增 `playground/error-demo.html` 和 `playground/error-demo.tsx`，并在 `playground/vite.config.ts` 接入 `axiiDevtools()`。

真实 Chromium 验证流程：

1. 打开 `http://127.0.0.1:5173/error-demo.html`。
2. 点击 `Trigger DOM boundary error`。
3. 页面先模拟第三方 DOM mutation，把第一个 `RxList` item placeholder 移到错误位置。
4. 随后执行 `items.splice(0, 1)`，触发 `RxListHost.applyPatch()` 和 `StaticHost.destroy()`。

浏览器验证结果：

```text
overlayCount: 0
hasConsoleBoundaryTitle: true
hasConsoleBoundaryMessage: true
hasConsoleSource: true
hasConsoleCodeFrame: true
hasConsoleReactiveUpdate: true
hasConsoleRxListTrace: true
codeFrameResponse: 200
pageErrorCount: 1
pageStillShowsDemo: true
```

实际 console 中包含：

```text
[Axii] AXII_DOM_BOUNDARY_BROKEN during destroy
Source: /Users/camus/Work/axii/axii/playground/error-demo.tsx:11:5
Reactive update:
1. RxListHost.apply-patch (method=splice key=Symbol(iterate) args=0,1 created=0 deleted=1)
```

这说明当前实现不只是单元测试通过，也能在真实浏览器里把原来的 DOM 底层错误还原为可定位的框架语义错误，并且不会覆盖页面上的错误现场。

Release review 后又做了两项发布修正：

- `RxListHost.applyPatch()` 现在会先 `reportAxiiError()`，再继续抛出原错误，避免把响应式 patch 失败吞掉。真实浏览器验证中 overlay 仍能出现，同时浏览器也会收到一次 `AxiiError` page error。
- `axiiDevtools()` 从主 runtime 入口拆出，改为 `./vite-plugin` 子路径导出；`dist/axii.js` / `dist/axii.cjs` 不再包含 `node:fs/promises` 或 Vite 插件 API，Node-only 代码只存在于 `dist/vite-plugin.js` / `dist/vite-plugin.cjs`。

## 测试覆盖

新增 `__tests__/errorHandling.spec.tsx`，覆盖：

- 根级数组 Host 的 DOM boundary 被破坏时抛出 `AxiiError`，而不是裸 `can not find nextSibling`。
- `code`、`phase`、`hostStack`、`componentStack`、`domSnapshot`、`hints`、`docsUrl` 和 `cause`。
- JSX DEV source 到组件 frame、Host frame、DOM 节点、动态 child、动态 attr 的传递。
- overlay payload 的 source 选择、无 source 情况、hints 展示和 overlay 关闭。
- Vite 插件入口会返回 `esbuild.jsxDev: true`。
- Vite 插件注入 code-frame endpoint。
- code-frame middleware 的成功、参数错误和读取失败路径。
- `reportAxiiError()` 在无 source、无 endpoint、fetch 失败、fetch 成功时的 console 行为。
- 关闭诊断时回退到原始错误。
- `ReusableHost` 复用后的 `pathContext/debugSource` 更新。
- `StaticHost.destroy()` 同步错误传播。
- RxList splice 触发 DOM boundary 错误时，错误对象和 overlay 包含 `Reactive update`。
- atom、function node、动态 attr 更新会写入最近 reactive trace 历史。
- trace 历史有上限，关闭诊断时不会记录。
- `range` 与 `reusable-range` 两种边界策略。
- parent mismatch、nextSibling 不可达、可达区间、`start === end`、detached start、Element/Text/Comment/DocumentFragment 快照。

覆盖率结果：

```text
diagnostics.ts    100% statements, 100% branches, 100% functions, 100% lines
```

## 验证结果

通过：

```text
npx vitest run __tests__/errorHandling.spec.tsx --coverage
```

当前结果：

```text
__tests__/errorHandling.spec.tsx: 13 passed
diagnostics.ts: 100% statements, 100% branches, 100% functions, 100% lines
vitePlugin.ts: 100% statements, 100% branches, 100% functions, 100% lines
```

完整测试套件已通过：

```text
npx vitest run
14 passed, 123 passed
```

发布构建和导出验证：

```text
npm run build
dist/axii.js
dist/axii.cjs
dist/vite-plugin.js
dist/vite-plugin.cjs
```

已 smoke test：

```text
ESM dist/axii.js exports createRoot and does not export axiiDevtools.
CJS dist/axii.cjs exports createRoot and does not export axiiDevtools.
ESM/CJS vite-plugin subpath exports axiiDevtools.
```

`npx tsc --noEmit` 仍被仓库既有问题阻塞，包括 typespec 未使用变量、Portal children 类型、happy-dom 类型冲突以及 playground 中缺失导出等；本次新增 `src/diagnostics.ts` 的类型问题已修正。
