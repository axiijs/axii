# 07 深度 review 第三轮（2026-07，已全部修复）

本轮 review 在前两轮（见 [05-review-2026-07.md](./05-review-2026-07.md)、
[06-review-2026-07-round2.md](./06-review-2026-07-round2.md)）修复完成后的 `main` 上进行，
再次通读 `src/` 全部源码。对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复。
本轮问题集中在 **StyleManager 的记账与 class 管理**、**ReusableHost 的 Host 契约** 和
**root attach 生命周期** 上。

回归测试：致命问题在 `__tests__/fatalBugs4.spec.tsx`（F11-F15），改进项在
`__tests__/improvements4.spec.tsx`（I19-I20），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F11 | 响应式 `className` 更新整体覆写 class attribute，把 StyleManager 通过 `classList.add` 挂上的 stylesheet class（嵌套样式/boundProps 样式）一并抹掉，样式静默永久丢失 | StyleManager 用 `elToStyleClassIds` 跟踪每个元素当前挂载的 stylesheet class（滚动淘汰的同步移除）；`updateAttribute` 的 className/class 分支写完后调用 `reapplyStyleClasses` 补回（`src/StaticHost.ts`） |
| F12 | 长期存活列表稳态 churn（始终非空）下，行级动态样式的 stylesheet mount/unmount 记账按共享 hostPath 的父级（RxListHost）计数，计数永远到不了 0：被销毁行的 stylesheet 引用计数从不释放，`document.adoptedStyleSheets` 随删除行数无上限增长 | 记账 key 改为拥有样式的元素 host 自身（StaticHost/CompactElementHost，每个恰好 render/destroy 一次），行销毁即释放自己收集的全部 style id；共享的静态 id 依旧靠全局 `idToRefCount` 计数（`src/StaticHost.ts`） |
| F13 | `reusable` 节点作为 RxList 行：对外的 `placeholder` 是 innerHost 的 placeholder 而非挂载点（moveTo 传入的 reusePlaceholder），列表插入后 render 直接 TypeError（unhandled rejection）；`element` 是构造时固定的字段（指向区间末尾），在它前面插入新行会取错锚点、新行落进 reusable 区间内部 | `placeholder`/`element` 改为实时 getter（挂载点 / 区间第一个节点）；`forceHandleElement` 恒为 true，列表整段 Range 删除不会把待复用内容物理删掉，行移除时内容照常搬进 fragment 供复用（`src/ComponentHost.ts`） |
| F14 | render 到 detached 容器、随后手动 `root.dispatch('attach')`（公开用法）后 `root.attached` 仍是 false：之后动态创建的组件/元素重新注册 once 的 attach 监听，永远等不到下一次 attach，layoutEffect/ref 永不执行 | `dispatch('attach'/'detach')` 同步维护 `root.attached` 标记（`src/render.ts`） |
| F15 | root 级（不在任何组件内）元素带嵌套样式时，`StyleManager.collect` 对 null hostPath 读 `.node` 直接 TypeError，初次渲染即崩溃 | F12 的按 owner host 记账天然消除了对 `hostPath.node` 的依赖；id 生成路径对 null hostPath 本就安全（`GLOBAL` 前缀）（`src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I19 | 响应式的带 namespace 属性（`xlink:href` / `xmlns:*`）因 key 含 `:` 被 `collectReactiveAttr` 一刀切跳过（连初值都不设置）；同时 isSVG 按静态子树的根判断，HTML 子树里嵌套的 SVG 元素拿不到 namespace / 驼峰属性转换 | 只跳过真正的配置 key（`prop:` / `$` 前缀），其余带 `:` 的合法属性正常建立响应式绑定；isSVG 改为按属性所属元素（`el instanceof SVGElement`）判断（`src/StaticHost.ts`） |
| I20 | `$name:_eventTarget`（AOP 事件转发）只有解析端，消费端在历史重构（d07c3d8）中丢失，静默不生效 | 恢复消费端：传入的函数收到一个 dispatch 回调，事件克隆后直接走目标元素的 eventProxy 派发（keydown 等事件无法用 `node.dispatchEvent` 真实模拟）（`src/ComponentHost.ts`） |

## 代码审查观察项（未修复，记录备查）

| # | 观察 | 说明 |
| --- | --- | --- |
| O4 | `DataContext.get` 从父链开始查找，组件自己 `context.set` 后自己 `context.get` 拿不到 | Provider 模式（父设子取）不受影响；是否支持自读属语义决策，未改动 |
| O5 | `separateProps` 处理 `$self:` 时若值里再嵌套 `$xxx:` 配置 key，会落进被丢弃的临时 itemConfig | 极端嵌套写法，未见真实使用场景 |
| O6 | `Form` 多值 unregister 里 `RxList.findIndex` 创建的 computed 未显式销毁 | 泄漏量极小（每次 unregister 一个），可与 Form 的 TODO 一起重构 |

运行方式：

```bash
npx vitest run __tests__/fatalBugs4.spec.tsx __tests__/improvements4.spec.tsx --coverage.enabled=false
```
