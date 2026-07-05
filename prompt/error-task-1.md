# Axii 开发者友好的错误处理方案

## 背景

Axii 是一个不依赖 Virtual DOM 的增量响应式前端框架。组件函数只执行一次，随后由 `Host` 树、响应式数据结构和真实 DOM 锚点共同维护页面更新。

这带来了很好的性能，但也让错误定位更困难。当前开发中经常看到类似：

```text
nextSibling is undefined
```

这类错误说明真实 DOM 边界已经失配，但它没有告诉开发者：

- 是哪个组件触发的更新。
- 是哪个响应式数据变化引起的。
- 是哪个 Host 正在移动、销毁或插入节点。
- 对应 JSX/TSX 源码位置在哪里。
- DOM 结构在出错前后发生了什么。

因此，Axii 需要的不是简单替换错误文案，而是一套面向开发阶段的诊断系统。它应该像 React 组件栈、Next/Vite 错误覆盖层、Vue Devtools、Solid signals 调试和 Sentry/OpenTelemetry 链路追踪一样，把运行时错误还原成“业务代码可理解”的信息。

## 设计目标

1. **把 DOM 底层错误翻译成 Axii 语义错误**：例如把 `nextSibling is undefined` 解释为“Host 的起点和 placeholder 不在同一个连续 DOM 区间内”。
2. **给出组件栈和响应式更新链路**：不仅知道当前调用栈，还要知道哪个组件、哪个动态节点、哪个 atom/RxList/computed 触发了更新。
3. **定位源码**：结合 JSX DEV 信息和 source map，显示组件文件、行列号、表达式路径。
4. **提供现场快照**：记录 Host 树、DOM 锚点、elementPath、相关节点的简化 DOM 片段和响应式 trigger 信息。
5. **开发环境强诊断，生产环境低成本**：诊断逻辑只在 `__DEV__` 或显式开启时运行，生产环境只保留稳定错误码和必要上下文。
6. **可接入现代工具链**：默认支持 Vite overlay、浏览器 console 分组、DevTools hook，并可接入 Sentry/OpenTelemetry。

## 当前架构中的错误来源

Axii 的渲染更新主要由以下几类 Host 负责：

- `ComponentHost`：执行组件函数，创建内部 Host，并维护组件 props、refs、effects、context。
- `StaticHost`：管理真实 DOM、未处理的动态 children、动态属性 autorun、ref、detach 动画样式。
- `FunctionHost`：用 `autorun` 包裹动态函数节点，变化时销毁旧 Host 并渲染新 Host。
- `AtomHost`：把 atom 值更新为 Text 节点内容。
- `RxListHost`：把 `RxList` 的 splice、reorder、explicit key change 映射为增量 DOM 操作。
- `StaticArrayHost`：渲染静态数组，并用 placeholder 管理数组边界。

`nextSibling is undefined` 这类问题通常出现在真实 DOM 边界操作中：

- `removeNodesBetween(start, end)` 找不到从 `start` 到 `end` 的连续兄弟节点。
- `ReusableHost` 或 `RxListHost` 移动一个 Host 的 `element ... placeholder` 区间时，区间已经被外部 DOM 操作破坏。
- `FunctionHost` 重算时，上一次 Host 的 destroy 清理了不该清理的节点。
- `detachStyle` 异步移除期间，节点已被另一个更新路径移动或删除。
- 用户直接操作框架托管的 DOM，导致 Host 记录的 `element` / `placeholder` 与真实 DOM 不一致。

这些错误的本质是：**框架内部还能看到某个 Host 的逻辑边界，但真实 DOM 已经不满足这个边界的结构不变量。**

## 总体方案

引入一个开发期诊断层：`AxiiErrorRuntime`。

它不改变 Axii 的响应式更新模型，只在关键边界处记录上下文、校验不变量，并把原始错误包装成结构化错误。

核心模块：

- `AxiiError`：统一错误对象，包含错误码、用户可读消息、原始 cause、组件栈、Host 栈、响应式链路、DOM 快照。
- `DiagnosticContext`：当前渲染、更新、销毁动作的上下文栈，类似 React current owner 和 Chrome async stack tagging。
- `HostDebugInfo`：每个 Host 的调试元数据，包括 Host 类型、组件名、elementPath、source location、创建原因。
- `ReactiveTrace`：记录 atom/computed/RxList 的 track/trigger 信息，标记是哪次响应式变化引发更新。
- `DomBoundaryGuard`：在插入、移动、删除前检查 DOM 边界不变量，并在失败时生成可解释错误。
- `AxiiDevOverlay`：开发环境错误覆盖层，集成 Vite HMR overlay 或提供独立 overlay。
- `AxiiDevtoolsHook`：暴露 Host 树、组件栈、响应式依赖图，供浏览器扩展或自定义面板使用。

## 错误对象设计

开发环境中，所有框架内部抛出的错误都应该转换为 `AxiiError`：

```ts
type AxiiErrorCode =
  | 'AXII_DOM_BOUNDARY_BROKEN'
  | 'AXII_HOST_RERENDER_UNSUPPORTED'
  | 'AXII_UNKNOWN_CHILD_TYPE'
  | 'AXII_INVALID_ATTRIBUTE'
  | 'AXII_EFFECT_ERROR'
  | 'AXII_REACTIVE_UPDATE_ERROR'

type AxiiError = Error & {
  code: AxiiErrorCode
  phase: 'create' | 'render' | 'update-attr' | 'insert' | 'move' | 'destroy' | 'effect'
  cause?: unknown
  componentStack?: ComponentFrame[]
  hostStack?: HostFrame[]
  reactiveTrace?: ReactiveFrame[]
  domSnapshot?: DomSnapshot
  hints?: string[]
  docsUrl?: string
}
```

示例输出：

```text
Axii DOM boundary is broken (AXII_DOM_BOUNDARY_BROKEN)

Axii tried to remove nodes owned by <TodoList>, but the start node can no longer reach its placeholder through nextSibling.

Component stack:
  at TodoItem (src/features/todo/TodoItem.tsx:42:12)
  at TodoList (src/features/todo/TodoList.tsx:18:8)
  at App (src/App.tsx:9:4)

Reactive update:
  RxList.splice() on props.items
  triggered RxListHost.applyPatch(splice)

Host:
  RxListHost elementPath=[0,2]
  child StaticHost elementPath=[0,2,1]

DOM boundary:
  start: <li data-as="item" data-axii-id="h12">
  end: <!-- rx list item -->
  parent mismatch: start.parentNode=<ul>, end.parentNode=null

Possible causes:
  1. Do not remove or move DOM nodes managed by Axii manually.
  2. Check whether a ref callback, useLayoutEffect, or third-party library mutates children inside this list.
  3. Check whether detachStyle is still running while the list item is removed.
```

## 组件栈和源码定位

现代主流框架的关键经验是：错误必须回到组件和源码，而不是停在框架内部调用栈。

Axii 可以通过两层信息实现：

### 1. JSX DEV 元数据

React 的 `jsxDEV` 会在开发模式下接收 `source` 和 `self` 信息。Axii 已经导出了 `jsxDEV`，应调整开发期 JSX runtime，使每个 JSX 节点携带：

```ts
type AxiiSource = {
  fileName: string
  lineNumber: number
  columnNumber: number
}
```

对于组件节点，信息存入 `ComponentNode.__source`；对于普通 DOM 节点，信息挂到 `ExtendedElement.__axiiSource`；对于 unhandled child/attr，把 source 继续传入 `UnhandledChildInfo` / `UnhandledAttrInfo`。

### 2. Host 创建时继承 source

`createHost(source, placeholder, context)` 创建 Host 时，把 source 信息写入 `HostDebugInfo`。如果某个动态节点本身没有 source，就继承最近的父组件 source，同时保留 `elementPath`。

这样即使错误发生在 `StaticHost.destroy()` 或 `RxListHost.applyPatch()`，也能回溯到创建这个 Host 的 JSX 表达式。

## Host 栈设计

当前 `PathContext.hostPath` 已经是一条 `LinkedNode<Host>` 链，适合直接生成 Host 栈。

开发期为每个 Host 增加只读调试信息：

```ts
type HostDebugInfo = {
  id: number
  type:
    | 'ComponentHost'
    | 'StaticHost'
    | 'FunctionHost'
    | 'AtomHost'
    | 'RxListHost'
    | 'StaticArrayHost'
    | 'PrimitiveHost'
    | 'EmptyHost'
    | 'ReusableHost'
  componentName?: string
  elementPath: number[]
  source?: AxiiSource
  createdBy?: 'root' | 'component' | 'unhandled-child' | 'atom' | 'function' | 'rx-list' | 'array'
}
```

错误发生时，沿 `hostPath` 生成：

- `Component stack`：只展示 `ComponentHost`，给业务开发者看。
- `Host stack`：展示所有 Host，给框架开发者看。

这种双栈模式类似 React 的 component stack + JS stack，但更适合 Axii，因为 Axii 的错误常常发生在组件函数执行之后。

## 响应式更新链路

Axii 的很多错误发生在响应式变化之后，而不是用户同步调用中。仅靠 JS stack 无法解释“为什么现在更新”。

方案是在开发期为响应式执行包一层 trace：

- `FunctionHost.render()` 中的 `autorun`：记录当前动态函数节点、依赖、重算原因。
- `StaticHost.collectReactiveAttr()` 中的 `autorun`：记录当前属性名、元素路径、依赖和新旧值摘要。
- `AtomHost.render()` 中的 `computed`：记录 atom 文本节点更新。
- `RxListHost.render()` 中的 `computed.applyPatch`：记录 `splice`、`reorder`、`explicit_key_change` 的参数、删除 Host 和新增 Host。
- `ComponentHost.render()`：记录组件初次渲染、props 合并、boundProps 求值。

如果 `data0` 暴露 track/trigger hook，Axii 直接接入；如果暂时没有，就先在 Axii 自己创建 `autorun/computed` 的地方记录 action frame。

错误报告中应展示：

```text
Reactive update:
  1. click event on <button data-as="remove">
  2. items.splice(2, 1)
  3. RxListHost.applyPatch(splice)
  4. StaticHost.destroy()
  5. removeNodesBetween() failed
```

这比普通调用栈更接近开发者心智。

## DOM 边界不变量

Axii 应在开发期明确声明并检查 DOM 边界不变量，但不能把所有 Host 都统一建模成 `host.element ... host.placeholder` 的连续区间。当前实现里，`AtomHost` 会用 Text 节点直接替换掉 placeholder，`ComponentHost` 和 `FunctionHost` 把真实 DOM 委托给 `innerHost`，`RxListHost` 的整体 placeholder 是列表尾锚点，`ReusableHost` 又存在合法的 `DocumentFragment` 搬移阶段。

因此 `DomBoundaryGuard` 的核心不是“全局 reachability 检查”，而是按 Host 类型声明边界策略：

```ts
type HostBoundaryKind =
  | 'range'
  | 'single-node'
  | 'delegated'
  | 'list'
  | 'empty'
  | 'reusable-range'

type HostBoundaryDescriptor = {
  kind: HostBoundaryKind
  ownerHost: Host
  element?: Node
  placeholder?: Comment
  parent?: Node
  operation: 'render' | 'destroy' | 'insert' | 'move' | 'splice' | 'reorder'
}
```

当前 Host 的边界策略应按真实 DOM 表示定义：

1. `StaticHost`：`range`。普通元素以元素本身为起点，`DocumentFragment` 以人工创建的 `fragment start` comment 为起点，`destroy()` 时可用 `element -> placeholder` reachability 检查。
2. `StaticArrayHost`：`range`。起点是第一个静态节点或第一个 child Host 的 `element`，终点是自己的 `placeholder`。
3. `PrimitiveHost`：`range`。Text 节点和 placeholder 都存在，销毁时应分别移除。
4. `AtomHost`：`single-node`。首次 render 后 placeholder 被 Text 节点替换并脱离 DOM 是合法状态；检查重点是 Text 节点是否仍在预期 parent 下，以及 owner/lifecycle 是否一致。
5. `EmptyHost`：`empty`。真实 DOM 表示是空 comment，不能按普通 range 检查。
6. `ComponentHost`：`delegated`。它自己不处理 DOM，边界检查应先 resolve 到当前 `innerHost`。
7. `FunctionHost`：`delegated`。每次 `autorun` 都会创建新的 `innerHost`，错误归因应落到当前动态节点和其 `innerHost`。
8. `RxListHost`：`list`。整体 `element` 是第一个 child host 的 `element` 或列表尾 placeholder；splice、reorder、explicit key change 必须记录 patch 上下文，并逐个检查 child host 边界是否连续、互不交叉。
9. `ReusableHost`：`reusable-range`。允许区间被合法搬到 `DocumentFragment`，但手写 `nextSibling` 循环仍要检查能否从 `innerHost.element` 到达 `innerHost.placeholder`。

`DomBoundaryGuard.assertReachable()` 只能用于 `range` 和 `reusable-range` 的具体 DOM 区间：

```ts
DomBoundaryGuard.assertRangeReachable({
  ownerHost,
  start: rangeStart,
  end: rangeEnd,
  operation: 'destroy',
})
```

对于 `single-node`、`delegated`、`list` 和 `empty`，应使用专门入口：

```ts
DomBoundaryGuard.assertSingleNode({ ownerHost, node, operation })
DomBoundaryGuard.assertDelegated({ ownerHost, innerHost, operation })
DomBoundaryGuard.assertListPatch({ ownerHost, patch, childHosts, operation })
DomBoundaryGuard.assertEmpty({ ownerHost, node, operation })
```

失败时抛出 `AXII_DOM_BOUNDARY_BROKEN`，并附带：

- Host 边界类型和当前 operation。
- start/end 或 single node 节点摘要。
- parentNode 对比。
- 从 start 开始最多 N 个 sibling 的快照。
- 最近一次操作该 Host 的 trace。
- 如果开启了开发期 `MutationObserver` 或 owner 标记，再附带可能破坏它的外部 DOM mutation 证据；否则只能作为可能原因提示，不能伪装成确定证据。

## DOM 现场快照

错误发生时不应 dump 整个页面，而是生成小而有用的快照：

```ts
type DomSnapshot = {
  ownerHostId: number
  operation: string
  start?: NodeSummary
  end?: NodeSummary
  parent?: NodeSummary
  siblingsBefore?: NodeSummary[]
  siblingsAfter?: NodeSummary[]
  managedRange?: NodeSummary[]
}
```

`NodeSummary` 包含：

- nodeType。
- tagName / text / comment。
- `data-as`、`data-testid`、`data-axii-host-id`。
- className。
- 是否有 `__axiiOwnerHostId`。

开发期可给框架托管节点打上非枚举属性或 `data-axii-host-id`：

- 非枚举属性用于内部判断。
- `data-*` 只在开启 debug DOM 标记时写入，方便浏览器 Elements 面板查看。

## 错误覆盖层

现代开发体验应对齐 Vite、Next.js、React Refresh 的错误覆盖层。

Axii 可以提供三种输出：

1. **Console group**：默认可用，结构化打印错误、组件栈、Host 栈、DOM 快照。
2. **Vite overlay 集成**：在 Vite 项目中，把 `AxiiError` 转成 overlay payload，显示源码位置、代码帧和组件栈。
3. **Axii Dev Overlay**：非 Vite 环境也可显示一个轻量 overlay，支持：
   - 错误摘要。
   - 组件栈。
   - 响应式链路。
   - DOM 快照。
   - 可能原因和修复建议。
   - 点击跳转源码链接。

Vite 集成可以通过插件实现：

```ts
export default defineConfig({
  plugins: [
    axiiDevtools(),
  ],
})
```

插件负责：

- 开启 JSX DEV source。
- 注入 `__AXII_DEVTOOLS_GLOBAL_HOOK__`。
- 接收 runtime error payload。
- 利用 source map 生成 code frame。

## DevTools Hook

参考 React DevTools 和 Vue Devtools，Axii 可以在开发环境暴露全局 hook：

```ts
window.__AXII_DEVTOOLS_GLOBAL_HOOK__ = {
  roots: Map<Root, Host>,
  onHostCreated(info),
  onHostRendered(info),
  onHostDestroyed(info),
  onReactiveTrack(info),
  onReactiveTrigger(info),
  onError(error),
}
```

这不要求第一阶段就做浏览器扩展，但可以先为未来扩展留好协议。

DevTools 可视化方向：

- Host 树。
- Component 树。
- 某个 DOM 节点对应哪个 Host。
- 某个 atom/RxList 影响哪些 DOM 节点。
- 最近 N 次响应式更新。

## 与生产环境的关系

生产环境不应该承担完整诊断成本，但仍应保留可观测性。

建议策略：

- 开发环境：完整 `AxiiError`、DOM 快照、overlay、source location。
- 测试环境：完整错误对象，但默认不显示 overlay，方便 Vitest/Playwright 断言。
- 生产环境：只保留错误码、phase、组件名、host 类型、cause，并允许接入 Sentry。

生产错误可以长这样：

```text
AXII_DOM_BOUNDARY_BROKEN: DOM boundary is broken during destroy in TodoItem.
See https://axii.dev/errors/AXII_DOM_BOUNDARY_BROKEN
```

同时通过 `Error.cause` 保留原始异常，符合现代 JavaScript 错误链标准。

## 可观测性接入

Axii 可以提供：

```ts
configureDiagnostics({
  onError(error) {
    Sentry.captureException(error, {
      tags: {
        axiiCode: error.code,
        phase: error.phase,
      },
      contexts: {
        axii: serializeAxiiError(error),
      },
    })
  },
})
```

对于大型应用，可以同时输出 OpenTelemetry event：

- `axii.render`
- `axii.reactive.update`
- `axii.dom.patch`
- `axii.error`

这让框架错误能进入现代前端监控链路，而不是只停留在浏览器控制台。

## 开发者修复建议系统

每个错误码都应该有专门的 hint 生成器。以 `AXII_DOM_BOUNDARY_BROKEN` 为例：

触发条件：

- `range` / `reusable-range` Host 的 `start.parentNode !== end.parentNode`。
- `range` / `reusable-range` Host 无法从 `start` 通过 `nextSibling` 走到 `end`。
- `single-node` Host 的唯一 DOM 节点已经不在预期 parent 下，或 owner/lifecycle 标记不一致。
- `delegated` Host 没有可解析的 `innerHost`，或错误被错误地归因到 wrapper Host。
- `list` Host 的 child host 区间交叉、缺失、patch 上下文与 DOM 现状不一致。
- 节点 ownerHostId 不匹配。

建议：

- 如果 DOM 节点被手动删除：提示不要在 ref/useLayoutEffect 中直接删除 Axii 管理的节点。
- 如果是第三方库接管 DOM：提示给第三方库一个独立容器，不要让它修改 Axii 管理区间的兄弟节点。
- 如果发生在 `RxListHost`：提示检查 list item 的 key/复用逻辑、`reusable()`、splice/reorder 组合。
- 如果发生在 `detachStyle`：提示检查删除动画期间是否又触发了列表移动。
- 如果发生在 `FunctionHost`：提示动态函数返回的结构是否在外部被复用或移动。

错误文档页面应按错误码组织，包含：

- 错误含义。
- 常见原因。
- 如何最小复现。
- 如何修复。
- 框架内部诊断字段解释。

## 分阶段落地计划

### 第一阶段：把错误变可读

目标是最快解决“看不懂 nextSibling”的问题。

- 新增 `AxiiError` 和 `createAxiiError()`。
- 先为每种 Host 定义 `HostBoundaryKind`，避免把所有 Host 误判成 `element -> placeholder` range。
- 在 `removeNodesBetween`、`insertBefore`、`insertAfter`、`RxListHost.applyPatch`、`ReusableHost.render/destroy` 周围包诊断。
- 只对 `range` 和 `reusable-range` 的具体 DOM 区间做 reachability 校验；`AtomHost`、`ComponentHost`、`FunctionHost`、`RxListHost`、`EmptyHost` 使用专门诊断策略。
- 为 `PathContext.hostPath` 生成组件栈和 Host 栈。
- 为 DOM 边界错误生成 start/end/parent 快照。
- console 使用 `console.groupCollapsed` 打印结构化报告。

### 第二阶段：接入 JSX source 和 overlay

目标是从错误跳到源码。

- 调整 `jsxDEV`，接收并传递 source 信息。
- 为 `ComponentNode`、`ExtendedElement`、`UnhandledChildInfo`、`UnhandledAttrInfo` 增加 dev source。
- 增加 Vite 插件，开启源码定位和 code frame。
- 提供 Axii Dev Overlay。

### 第三阶段：响应式链路追踪

目标是解释“为什么触发这次更新”。

- 给 Axii 内部 `autorun/computed` 包装 trace frame。
- 如果 `data0` 支持 dev hook，则记录 track/trigger。
- `RxListHost` 记录方法名、参数、删除/新增 Host。
- 错误报告展示最近一次相关 reactive trace。

### 第四阶段：DevTools 和远程监控

目标是把一次性错误报告扩展成持续调试能力。

- 暴露 `__AXII_DEVTOOLS_GLOBAL_HOOK__`。
- 提供 Host/Component 树检查。
- 提供 Sentry/OpenTelemetry adapter。
- 建立 `https://axii.dev/errors/{code}` 错误文档。

## 推荐的代码切入点

优先改这些地方，收益最大：

- `util.ts`
  - `removeNodesBetween()` 是当前 `nextSibling` 类错误最直接的出口。
  - 这里应该接收调用方传入的 `HostBoundaryDescriptor`，只在真实 range 操作中抛出 `AXII_DOM_BOUNDARY_BROKEN`，而不是普通 `Error`。

- `DOM.ts`
  - `insertBefore()` / `insertAfter()` 是所有 DOM 移动和插入的关键路径。
  - `jsxDEV()` 是 source location 的入口。
  - `ExtendedElement` 可承载 dev owner/source 信息。

- `createHost.ts`
  - Host 类型分发集中在这里，适合统一创建 `HostDebugInfo` 和 `HostBoundaryKind`。

- `ComponentHost.ts`
  - 组件名、props、source、context、effects 都在这里，适合生成 component frame。

- `StaticHost.ts`
  - 动态 attr、unhandled child、detachStyle 都在这里收敛，是开发期诊断重点。

- `FunctionHost.ts`
  - 动态函数节点的重算需要 trace。

- `RxListHost.ts`
  - 列表 splice/reorder 是 DOM 边界失配的高风险区域，必须记录 patch 信息。

## 最小 API 设计

```ts
configureDiagnostics({
  enabled: true,
  overlay: true,
  domMarkers: false,
  maxDomSnapshotSiblings: 8,
  onError(error) {
    console.error(error)
  },
})
```

默认行为：

- `__DEV__` 下自动开启基础诊断和 console report。
- Vite 插件存在时开启 overlay。
- `domMarkers` 默认关闭，避免污染 DOM；需要排查时手动开启。
- 生产环境默认关闭完整快照，只保留错误码和 `Error.cause`。

## 成功标准

当再次出现 `nextSibling is undefined` 类问题时，开发者应该看到：

1. 一个稳定错误码：`AXII_DOM_BOUNDARY_BROKEN`。
2. 一句框架语义解释：哪个 Host 的哪一种边界策略在什么操作中失败了。
3. 组件栈：业务组件从 App 到具体出错组件。
4. 响应式链路：哪个 atom/RxList/computed 触发更新。
5. DOM 快照：start、placeholder、parent、附近 siblings。
6. 源码位置：具体 TSX 文件和代码帧。
7. 修复建议：最可能的三类原因。

这套方案的关键不是捕获更多异常，而是让 Axii 把自己的运行时模型暴露给开发者：组件、Host、响应式依赖和真实 DOM 边界。只要这些信息能在一个错误报告里汇合，`nextSibling is undefined` 就会从一个浏览器底层异常，变成可以快速定位和修复的业务错误。
