# 10 深度 review 第六轮（2026-07，已全部修复）

本轮 review 在前五轮（见 [05](./05-review-2026-07.md)、[06](./06-review-2026-07-round2.md)、
[07](./07-review-2026-07-round3.md)、[08](./08-review-2026-07-round4.md)、
[09](./09-review-2026-07-round5.md)）修复完成后的 `main` 上进行，再次通读 `src/` 全部源码，
并重点核对了 axii 与 data0 之间的 patch 协议（直接阅读 `node_modules/data0/dist` 的
splice/set/reorder 实现，确认透传给 `RxListHost` 的 triggerInfo 原始形态）。
对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，证伪的直接排除；
每个测试都先在未修复代码上确认失败再转为回归测试。
本轮问题集中在 **RxList patch 参数的边界形态**、**Portal 的 attach 时机** 和
**DOM 属性层遗留的宽松 `on*` 判断 / className 对象形式的响应性** 上。

回归测试：致命问题在 `__tests__/fatalBugs7.spec.tsx`（F22-F24），改进项在
`__tests__/improvements7.spec.tsx`（I28-I30），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F22 | `RxListHost.handleSplice` 直接用 data0 透传的原始 splice 参数（`argv[0]`）扫插入锚点。负数 start 是 `Array#splice` 的合法用法（data0 的 `RxList.splice` 原样透传，数据侧按标准语义归一化），但 axii 侧的锚点扫描不归一化：`splice(-1, 0, x)`（在最后一个之前插入）会从 index 0 开始找锚点，新行插到 DOM 的**开头**——数据与 DOM 永久错位；`|start|` 超过列表长度的负数还会读到 `undefined` host，在 computed patch 里抛 TypeError（异步路径下变成 unhandled rejection，新行完全不渲染） | `handleSplice` 先按 `Array#splice` 语义归一化 start（负数加 length 并 clamp 到 `[0, hosts.length]`）再做 hosts 数组更新与锚点扫描（`src/RxListHost.ts`） |
| F23 | Portal 渲染时 `container` 还没连入文档时（最常见：container 本身就是外层组件树的一部分，随外层一起插入；或外层 root 尚未 attach），内层 root 永远等不到 attach 事件：portal 内容里的 layoutEffect/ref **永不执行**，依赖 DOM 测量的逻辑（弹层定位等正是 Portal 的典型场景）全部失效 | Portal 在 container 未连通时桥接外层 root 的 attach 时机：外层已 attach 时用 `deferUntilAttached(container, ...)` 登记（外层完成 fragment→文档插入后 flush），未 attach 时监听外层 root 的一次性 attach 事件；触发时 container 确实连通才向内层 root 转发 `dispatch('attach')`。container 挂在组件树之外、由用户稍后手动 append 的场景维持原语义（用户自行 dispatch）。组件销毁时退订（`src/Portal.tsx`） |
| F24 | `className` 对象形式的 value 是 atom/函数（`className={{active: isActive}}` 是自然写法）时，`isValidAttribute` 把整个对象判为静态属性：atom 从未被读取（**没有任何响应性**），且 atom 本身是 function（恒 truthy），class 从第一次渲染起就**永远挂在元素上** | ① `setAttribute` 的 className 对象分支对 function/atom 值统一求值（调用点在响应式绑定内时读取即建立依赖）；② `StaticHost` 的 `isValidAttribute` 覆盖层新增 `isClassNameWithReactiveValue` 判断：对象（含数组中的对象）value 里有 atom/函数时按响应式属性处理，走 `LightBindingEffect`（`src/DOM.ts` / `src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I28 | DOM 层的事件判断是宽松的「以 `on` 开头」：`once`/`online` 这类普通 prop 会被吞进事件分支——属性永远设不到 DOM 上，还会挂上一个永不触发的假监听器（`addEventListener('ce', ...)`）。`mergeProp` 早在第一轮就按 `/^on[A-Z]/` 约定修复过（改进项 1），但 `DOM.ts` 的 `setAttribute`/`isValidAttribute` 与 `StaticHost` 的覆盖层一直没有对齐 | 新增导出的 `isEventName`（`on` + 大写字母，覆盖 `onClick`/`onClickCapture`），三处判断统一收敛到它；普通 `on*` prop 回归属性路径，atom/函数值还能建立响应式属性绑定（`src/DOM.ts` / `src/StaticHost.ts`） |
| I29 | `PropTypes.any` 的 `check` 直接抛错（`type any can not check`）：`oneOfType`/`arrayOf`/`shapeOf` 的 check 会组合调用成员类型的 check，`shapeOf({x: any})`、`oneOfType([string, any])` 是自然写法，一调用即崩溃 | 删掉 anyDef 里抛错的 check，回落到 `createNormalType` 的默认实现（`() => true`，恒真）；`stringify`/`parse` 维持抛错（any 确实不可序列化）（`src/propTypes.ts`） |
| I30 | `RxDOMState.ref` 从一个元素直接切换到另一个元素（中间没有 null 回调）时，旧元素的 `abort` 被新 `listen` 覆盖：旧监听/ResizeObserver 观察**永久泄漏**，旧元素的变化还会继续写进同一个 value atom。框架内部的 detach 流程总是先回调 null，但 `RxDOMSize` 等类是公开 API，用户手动把 `.ref` 换绑到新元素是合法用法 | `ref` 在新旧元素都非空且不同时，先 `unlisten(originEl)` 再 `listen()`（`src/reactiveDOMState.ts`） |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O11 | `RxListHost.hostRenderComputed` 的 applyPatch 返回 `false` 会让 data0 回退 full recompute，computation 里 `hosts.push(...)` 会把已渲染的行重复渲染一遍 | **证伪**（代码层面）：applyPatch 永远返回 `undefined`（不是 `false`），fallback 分支不可达；抛错路径也不触发 fallback（向上抛，由 error 钩子或 unhandled rejection 收敛） |
| O12 | 函数 child 返回原生 `Text` 节点（`() => document.createTextNode('t')`）时 `createHost` 抛 `unknown child type` | 实测确认会抛错，但属 API 设计边界：函数 child 的文本内容应直接返回 string/number（走文本快速路径），结构内容返回元素/fragment。给最热的 createHost 分派加 Text 分支得不偿失，不改 |
| O13 | `ComponentHost.hasEventProps` 用宽松的 `on` 前缀判断（`once` 也会命中） | 它只决定是否给元素挂 `listenerBoundArgs`（事件参数的缓存数组），过近似完全无害，改成严格判断反而在热路径多一次字符判断。不改 |

运行方式：

```bash
npx vitest run __tests__/fatalBugs7.spec.tsx __tests__/improvements7.spec.tsx --coverage.enabled=false
```
