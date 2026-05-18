# `prompt/error-task-1.md` 致命问题 Review

## 结论

当前版本未发现致命问题，可以作为后续实现错误诊断系统的设计基础。

文档已经抓住 Task 1 的核心：`can not find nextSibling` 不是一个单纯需要改文案的异常，而是 Host 逻辑边界和真实 DOM 状态失配后暴露出来的底层错误。因此方案把错误码、组件栈、Host 栈、响应式更新链路、DOM 快照、源码定位、Vite overlay、DevTools hook、Sentry/OpenTelemetry 接入放在同一套诊断体系里，方向是成立的。

我重点复核了是否存在会导致方案无法落地、误导实现或在正常页面中大量误报的设计问题。当前文档没有这类致命缺陷。

## 已修正的关键风险

最容易成为致命问题的是 DOM 边界模型。如果把所有 Host 都统一看成 `host.element ... host.placeholder` 的连续区间，Axii 会在合法状态下误报。

当前文档已经避免了这个问题。它明确指出不能把所有 Host 都统一建模成连续区间，并把边界策略拆成：

```ts
type HostBoundaryKind =
  | 'range'
  | 'single-node'
  | 'delegated'
  | 'list'
  | 'empty'
  | 'reusable-range'
```

这和当前实现是匹配的：

- `AtomHost` 首次渲染会用 Text 节点替换 placeholder，placeholder 脱离 DOM 是合法状态，所以归为 `single-node` 是正确的。
- `ComponentHost` 和 `FunctionHost` 的 `element` 都委托给 `innerHost`，所以归为 `delegated` 是正确的。
- `RxListHost` 的整体 placeholder 是列表尾锚点，真实风险在 child host 的 splice/reorder 过程中，所以归为 `list` 是正确的。
- `ReusableHost` 会把 `innerHost.element ... innerHost.placeholder` 合法搬进 `DocumentFragment`，所以需要 `reusable-range`，不能按普通 range 简化。
- `StaticHost`、`StaticArrayHost`、`PrimitiveHost` 才是主要适合 `element -> placeholder` reachability 检查的类型。

这说明文档的第一阶段落地前提是稳的：先定义每种 Host 的合法 DOM 表示，再在 `removeNodesBetween()`、`insertBefore()`、`insertAfter()`、`RxListHost.applyPatch`、`ReusableHost.render/destroy` 这些高风险点包装诊断。

## 非致命问题

下面这些点不会推翻方案，但实现前建议补充清楚。

1. `jsxDEV` 的 source 传递需要更具体。

   文档说 Axii 已经导出 `jsxDEV`，并建议接收 React 风格的 `source/self`。当前 `jsxDEV(type, { children, ...rawProps })` 还没有接收第三、第四个参数，也没有把 source 写入 `ComponentNode`、`ExtendedElement`、`UnhandledChildInfo`、`UnhandledAttrInfo`。这不是致命问题，因为源码定位属于第二阶段，但实现时需要把 JSX runtime 签名和元数据传递路径写清楚。

2. `createHost(source, placeholder, context)` 中的 `source` 表达容易混淆。

   这里的 `source` 参数在当前代码里是待渲染节点或数据源，不是源码位置。文档说“把 source 信息写入 `HostDebugInfo`”容易让实现者混淆。建议把源码位置命名为 `AxiiSource` 或 `debugSource`，并明确它来自节点元数据或父级继承，而不是 `createHost` 的第一个参数本身。

3. 外部 DOM mutation 证据需要区分“已观测”和“推测”。

   文档已经提醒如果没有 `MutationObserver` 或 owner 标记，就不能把第三方 DOM mutation 当作确定证据。实现时还需要保持这个边界：错误 hint 可以提示“可能原因”，但错误报告中的 evidence 只能来自真实记录。

4. 第一阶段的异常捕获边界还可以更明确。

   文档说“所有框架内部抛出的错误都应该转换为 `AxiiError`”，但第一阶段主要覆盖 DOM 高风险点。实现时应优先保证 `removeNodesBetween()`、移动循环、list patch、动态函数 cleanup 这几条路径不会漏掉原始错误；其他 `assert()` 和 effect 错误可以分阶段补齐。

## Review 建议

保留当前方案，不需要因为致命问题返工。

后续进入实现前，建议只做小幅补充：把 JSX DEV source 的真实函数签名、`debugSource` 的数据流、外部 mutation 证据来源、第一阶段 try/catch 包装边界写得更精确。这样文档既能保持现在的现代调试体验方向，也能直接指导代码落地。
