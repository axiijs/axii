# `prompt/output/error-task-1-review.md` 逐条处理结果

## 结论

`prompt/output/error-task-1-review.md` 的核心意见正确，已经修正 `prompt/error-task-1.md`。

原方案最大问题是把 Axii 的 DOM 边界模型过度统一成 `host.element ... host.placeholder` 的连续区间。深入代码后可以确认，这不是所有 Host 的合法状态，因此必须改成按 Host 类型声明边界策略。

## 意见 1：DOM 边界不变量不成立

判断：正确。

代码依据：

- `AtomHost.replace()` 首次 render 会用 Text 节点替换掉 placeholder，之后 placeholder 脱离 DOM 是正常状态。
- `AtomHost.parentElement` 使用 `this.placeholder.parentNode || this.element.parentElement`，说明实现本身就承认 placeholder 可能不在 DOM 中。
- `ComponentHost.destroy()` 明确注释“ComponentHost 自己是不处理 dom 的”，真实 DOM 操作由 `innerHost` 负责。
- `FunctionHost` 的 `element` 也是转发到 `innerHost?.element || this.placeholder`，每次 `autorun` 会创建新的 inner host。
- `RxListHost` 的整体 `element` 是第一个 child host 的 `element` 或列表尾 placeholder，splice/reorder 的真实边界在 child host 上。
- `ReusableHost.render()` / `destroy()` 会把 `innerHost.element ... innerHost.placeholder` 搬入 `DocumentFragment`，这是合法临时状态。

处理：已修正。

`prompt/error-task-1.md` 的“DOM 边界不变量”已改为 `HostBoundaryKind` 方案：

- `range`
- `single-node`
- `delegated`
- `list`
- `empty`
- `reusable-range`

并明确 `DomBoundaryGuard.assertReachable()` 只能用于 `range` 和 `reusable-range` 的具体 DOM 区间。

## 意见 2：影响范围不只 AtomHost

判断：正确。

代码依据：

- `ComponentHost` 是 delegated wrapper。
- `FunctionHost` 是动态 delegated wrapper。
- `ReusableHost` 有合法搬移到 `DocumentFragment` 的阶段。
- `RxListHost` 是列表 patch 模型，不是普通 range 模型。
- `StaticHost`、`StaticArrayHost`、`PrimitiveHost` 才更接近普通 range 模型。

处理：已修正。

原文档现在逐个声明当前 Host 的边界策略，并说明每种策略应该检查什么。

## 意见 3：这是致命问题

判断：正确。

原因是 Task 1 的目标不是捕获更多异常，而是让错误归因更准确。如果诊断系统建立在错误不变量上，会出现：

1. 正常状态误报，例如 `AtomHost` 的 placeholder 脱离。
2. wrapper Host 误归因，例如 `ComponentHost` / `FunctionHost`。
3. DOM 快照、hint、组件栈虽然更丰富，但会围绕错误 owner 展开，反而更误导开发者。

处理：已修正。

原文档第一阶段落地计划已加入“先为每种 Host 定义 `HostBoundaryKind`”，并强调只对真实 range 做 reachability 校验。

## 意见 4：必须改为按 Host 类型声明边界策略

判断：正确。

处理：已修正。

原文档新增 `HostBoundaryDescriptor` 和专门诊断入口：

- `assertRangeReachable()`
- `assertSingleNode()`
- `assertDelegated()`
- `assertListPatch()`
- `assertEmpty()`

这样可以保留原方案对 `removeNodesBetween()`、`insertBefore()`、`insertAfter()`、`RxListHost.applyPatch()`、`ReusableHost` 的诊断价值，同时避免把所有 Host 都套进同一个不变量。

## 意见 5：第三方 DOM mutation 证据来源不明确

判断：正确。

原文档直接写“可能破坏它的第三方 DOM mutation 记录”，但没有说明这些记录从哪里来。没有 `MutationObserver` 或 owner 标记时，这只能是推断，不能当成证据。

处理：已修正。

原文档现在明确：只有开启开发期 `MutationObserver` 或 owner 标记时，才附带外部 DOM mutation 证据；否则只能作为可能原因提示。

## 意见 6：JSX DEV 参数和 source 传递还需明确

判断：正确，但不是致命问题。

原方案已经提出：

- 调整 `jsxDEV` 接收并传递 source 信息。
- 为 `ComponentNode`、`ExtendedElement`、`UnhandledChildInfo`、`UnhandledAttrInfo` 增加 dev source。
- 第二阶段通过 Vite 插件和 source map 生成 code frame。

这部分方向正确，但实现时还需要继续对齐当前 `jsxDEV` / `createElement` 的真实签名。它不影响第一阶段先把 `nextSibling` 类错误包装成可读错误。

处理：暂不展开修改。

## 最终处理

已修正 `prompt/error-task-1.md` 中这些位置：

- “DOM 边界不变量”整节。
- `AXII_DOM_BOUNDARY_BROKEN` 的触发条件。
- 第一阶段落地计划。
- 推荐代码切入点。
- 成功标准。

修正后的方案保留原来的现代错误处理方向，但把第一阶段的基础模型从“统一 range”改成“按 Host 类型诊断”，可以避免正常状态误报和错误归因偏移。
