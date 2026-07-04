# 01 架构概览与总体评价

Review 对象：axii v3.9.2（commit `4249ef9`），`src/` 下 23 个文件、约 4300 行。

## 核心设计

axii 是一个"增量更新"的响应式前端框架，核心特点：

- **无 Virtual DOM**：JSX 直接产出真实 DOM（`createElement` 返回 `HTMLElement`/`DocumentFragment`），组件函数只执行一次，永不 rerender（代码中多处 `assert(..., 'should never rerender')` 明确了这一约束）。
- **Host 树**：渲染由一棵 Host 树驱动，`createHost`（`src/createHost.ts`）按 source 类型分派：
  - `StaticHost` — 静态元素/Fragment，收集其中的 `unhandledChildren` / `unhandledAttr`（响应式属性走 `autorun`）；
  - `ComponentHost` — 组件节点，负责 props 合并、AOP 配置（`$xxx:prop` DSL）、effect/layoutEffect 生命周期；
  - `AtomHost` / `FunctionHost` — 原子值与函数子节点，分别用 `computed` / `autorun`（微任务批处理）做局部更新；
  - `RxListHost` — 响应式列表，通过 data0 的 `manualTrack` 拿到 splice/reorder/explicit key change 的 patch 信息做增量 DOM 操作；
  - `StaticArrayHost` / `PrimitiveHost` / `EmptyHost` — 数组、原始值、空节点。
- **Placeholder 锚点**：每个 Host 用一个 `Comment` 节点作为在父 DOM 中的定位锚点，动态内容的插入/删除都相对 placeholder 进行。
- **样式系统**（`StaticHost.ts` 中的 `StyleManager`）：静态样式按组件路径生成共享 class + `CSSStyleSheet`（`document.adoptedStyleSheets`）；动态样式（atom/函数）用滚动 style id；嵌套 selector、`@keyframes`、at-rules 也走 stylesheet。
- **组件 AOP**：通过 `as` 命名内部元素、`$name:prop` / `$name:prop_` / `$name:_use` / `$name:_props` / `$name:_children` / `prop:` / `$self:` 等字符串 DSL，外部可以覆写/合并组件内部任意命名元素的 props 甚至整个元素，配合 `boundProps` / `postBoundProps` 实现样式-逻辑分离。
- **响应式 DOM 状态**（`reactiveDOMState.ts`）：`RxDOMRect` / `RxDOMSize` / `RxDOMFocused` / `RxDOMDragState` 等把 DOM 位置、尺寸、焦点、拖拽包装成响应式数据。

## 总体评价

**方向性判断：架构自洽、没有致命的设计缺陷。**

- "组件只执行一次 + 响应式数据绑定 DOM"的心智模型简单，且实现忠实于这个模型（没有 diff、没有隐藏的 rerender 路径）。
- 增量更新路径（`RxListHost` 的 splice patch、`AtomHost` 的文本节点复用、`StaticHost` 的属性级 autorun）确实做到了理论最小 DOM 变更。
- Host 抽象的职责边界清楚，`parentHandle` / `parentHandleComputed` 两个 destroy 参数是为了让父级批量清理时避免子级重复操作，设计合理（尽管透传有遗漏，见改进项）。

**但实现层面的问题密度偏高**：8 个致命问题里有 5 个（BUG 1/2/3/4/5）属于"写了但没接上"或"两行代码顺序反了"这类低级疏漏，而且都落在测试盲区里（`Form.tsx` 被排除在 coverage 之外、reorder 无任何用例、detached root 场景无用例）。这说明测试策略比代码本身更需要补强——覆盖率数字（README 徽章）因为 exclude 配置而虚高。

详见：

- [02-fatal-issues.md](./02-fatal-issues.md) — 致命问题详述
- [03-improvements.md](./03-improvements.md) — 显著改进项
- [04-reproduction-report.md](./04-reproduction-report.md) — 复现验证报告
