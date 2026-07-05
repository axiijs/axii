# Error Handling 响应式链路增强专项

## 背景

当前 Task 1 追加任务 2 已完成前三阶段的核心闭环：

- DOM boundary 错误会转换为 `AxiiError`。
- 错误包含 Host 栈、组件栈、DOM 快照、source、code frame。
- Axii 内部关键 `autorun/computed` 已记录 `ReactiveTraceFrame`。
- Overlay 能展示 `Reactive update`。
- 真实浏览器已验证 `RxList.splice()` 触发 DOM boundary 错误时，overlay 能展示 `RxListHost.apply-patch`。

但当前第三阶段使用的是 Axii 侧 fallback：只在 Axii 自己创建 `autorun/computed` 的地方记录 action frame。它能解释“这次更新走到了哪个 Host 更新路径”，但还不能完整解释“具体哪个响应式数据源触发了这条链路”。

下面这些增强项建议作为后续专项推进。

## 增强项 1：接入 data0 全局 track/trigger dev hook

难度：中高。

目标：

- 在 `data0` 的 `Notifier` / `Computed` 层暴露开发期 hook。
- 记录响应式依赖的 track 和 trigger 事件。
- Axii 错误报告能展示触发源，例如某个 atom、computed、RxList method。

建议实现：

- 在 `data0` 增加 `configureReactiveDebugHooks()` 或类似 API。
- hook 至少包含：
  - `onTrack(effect, target, type, key)`
  - `onTrigger(effect, target, type, key, info)`
  - `onComputedRun(computed)`
  - `onComputedDispose(computed)`
- 只在 dev 或显式开启时执行 hook，生产默认零成本。
- Axii 侧将 data0 hook 转换为 `ReactiveTraceFrame` 或新的 `ReactiveDependencyFrame`。

主要风险：

- 改动跨仓库，必须避免破坏 data0 的性能和订阅语义。
- hook 中不能强引用大量 target/effect，否则可能导致内存泄漏。
- 需要处理 computed 清理和 dependency 重新收集。

验收标准：

- atom 变化触发 DOM 更新时，错误报告能显示具体 trigger 来源。
- RxList `splice/reorder/explicit key change` 能展示 trigger info 和 patch path。
- 关闭诊断时无额外 hook 成本。

## 增强项 2：显示具体 atom/computed/RxList 名称

难度：中。

目标：

- 当响应式数据源有 name/debugName 时，错误报告展示可读名称。
- 没有名称时展示类型和安全摘要。

建议实现：

- 优先复用 data0 已有的 `name` 参数或 debug metadata。
- 给 Axii 自己创建的 computed/autorun 设置默认 debug label：
  - `StaticHost.attr:title`
  - `AtomHost.text`
  - `FunctionHost.recompute`
  - `RxListHost.patch`
- 引入安全摘要函数，避免把大型对象或敏感数据完整 dump 到错误报告。

主要风险：

- 命名不稳定会让测试和用户认知变差。
- 对象摘要过深会带来性能和隐私风险。

验收标准：

- overlay 中能看到类似 `items.splice(0, 1)`、`titleAtom -> StaticHost.attr:title`。
- 未命名数据源不会显示 `[object Object]` 这类低质量信息。

## 增强项 3：完整依赖图和 track-trigger 边

难度：高。

目标：

- 不只展示最近 action frame，而是展示响应式依赖图。
- 支持从一个 DOM 节点/Host 反查它依赖的 atom/computed/RxList。
- 支持从一个 atom/RxList 反查它影响的 Host/DOM 节点。

建议实现：

- 作为第四阶段 DevTools 能力推进，而不是继续塞进错误对象。
- 设计独立的 dev graph store：
  - reactive target id
  - computed/effect id
  - host id
  - dependency edges
  - trigger history
- 错误对象只引用最近 N 条相关边，完整图给 DevTools 使用。

主要风险：

- 高内存占用。
- effect 重新收集后边需要及时清理。
- 如果 owner/host 生命周期处理不严谨，会出现错误归因或 stale edge。

验收标准：

- DevTools 或 debug API 能查询 Host -> dependencies。
- DevTools 或 debug API 能查询 reactive source -> affected hosts。
- 销毁 Host 后依赖边能释放。

## 增强项 4：`reactiveDOMState.ts` 接入 trace

难度：低到中。

目标：

- 将 DOM state 相关 autorun 纳入统一 trace 系统。
- 例如 hover/focus/rect/scroll/size 等状态变化触发更新时，能看到来源。

建议实现：

- 给 `reactiveDOMState.ts` 中的 autorun 包 `withReactiveTrace()`。
- 增加新的 trace type，例如：
  - `dom-state`
  - `dom-event-state`
  - `layout-state`
- 只记录对错误定位有帮助的状态，不把高频 scroll/resize 全量塞进 overlay。

主要风险：

- scroll/resize/hover 可能非常高频，容易制造噪音。
- 需要节流或只记录最近一次相关状态。

验收标准：

- DOM state 引起的更新能在 `getRecentReactiveTrace()` 中看到。
- 高频状态不会让 trace history 被无意义事件淹没。

## 增强项 5：更精确的 JSX child/attr source

难度：中高。

目标：

- 当前 runtime 只能拿到 JSX element 级 source。
- 未来希望定位到具体 child expression 或 attribute expression。

示例：

```tsx
<div title={() => title()}>
  {items.map(...)}
</div>
```

理想情况下，动态 attr 错误应定位到 `title={() => title()}`，动态 child 错误应定位到 `{items.map(...)}`，而不是只定位到 `<div>`。

建议实现：

- 在 Vite/Babel/TS transform 层给动态 attr/child 注入额外 source metadata。
- runtime 的 `UnhandledChildInfo` / `UnhandledAttrInfo` 已预留 `source` 字段，可以直接承接。

主要风险：

- 需要写 transform，和 JSX runtime 紧耦合。
- 需要兼容 classic JSX、automatic JSX、jsxDEV 等多种编译模式。
- source map/code frame 需要和 transform 后代码保持对应。

验收标准：

- 动态 attr 的错误 source 指向 attribute expression。
- 动态 child 的错误 source 指向 child expression。
- code frame 能显示具体表达式行列号。

## 建议推进顺序

1. 先做 `reactiveDOMState.ts` trace，成本最低，能快速补齐遗漏。
2. 再做响应式对象名称和安全摘要，提升当前 trace 可读性。
3. 然后推进 data0 最小 dev hook，补齐 trigger 来源。
4. 最后做完整依赖图和 DevTools 查询能力。
5. JSX child/attr 精确 source 可与 Vite 插件专项并行推进。

## 非目标

本专项不建议重新设计当前已完成的 `AxiiError`、DOM boundary guard、code frame 或 overlay 基础能力。

当前实现已经可以服务开发者定位核心 DOM boundary 错误。后续增强应围绕“更准确解释响应式触发源”和“更精确源码定位”展开。
