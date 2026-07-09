# 08 深度 review 第四轮（2026-07，已全部修复）

本轮 review 在前三轮（见 [05](./05-review-2026-07.md)、[06](./06-review-2026-07-round2.md)、
[07](./07-review-2026-07-round3.md)）修复完成后的 `main` 上进行，再次通读 `src/` 全部源码。
对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试。
本轮问题集中在 **layoutEffect/ref 与 DOM 插入时机**、**组件 AOP 的边角解析** 和
**style 对象中的 atom 值** 上。

回归测试：致命问题在 `__tests__/fatalBugs5.spec.tsx`（F16-F19），改进项在
`__tests__/improvements5.spec.tsx`（I24-I25），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F16 | root attach 之后动态创建的组件/元素（列表新行、函数节点重算出的静态子树、数组 child）是先在脱离文档的 fragment 里渲染再整体插入的，但 layoutEffect/ref 在渲染时就立即执行：此刻 `isConnected` 为 false，`getBoundingClientRect` 等测量全部拿 0，依赖 ref 的 `RxDOMSize`/`RxDOMRect` 初值全错 | root 增加内部的 deferred-attach 队列：`root.attached` 但挂载点尚未连通时登记回调（销毁前可退订），由外层完成「fragment → 文档」插入的位置（`RxListHost` 初始渲染/splice/explicit key change、`StaticArrayHost.render`、`StaticHost.render`）同步 flush；仍未连通的（自己只是被插进了更外层 fragment）留给更外层的 flush。整个过程在同一个同步任务内完成，ref/layoutEffect 的执行时序对用户仍然是同步的（`src/render.ts` / `src/ComponentHost.ts` / `src/StaticHost.ts` / `src/RxListHost.ts` / `src/StaticArrayHost.ts`） |
| F17 | `$name:style` 传入字符串（style 的合法形态之一）时，`markAopProp` 对原始值 `Object.defineProperty` 直接 TypeError，初次渲染即崩溃 | `markBoundProp`/`markAopProp`/`markDynamicProp` 只对 object/function 打标记，原始值原样返回（字符串 style 本就不需要 bound/dynamic 语义）（`src/StaticHost.ts`） |
| F18 | 命名子组件（`as=xxx`）的 ref 会被合并成数组（用户 ref + 内部收集 `refs[name]` 的回调），但 `ComponentHost.attachRef/detachRef` 不处理数组：把 refValue 赋到数组对象的 `.current` 上——用户 ref 永远拿不到 exposed 值，父组件的 `refs[name]` 也永远不会被填充 | `attachRef`/`detachRef` 递归展开数组，逐个附加/解除（`src/ComponentHost.ts`） |
| F19 | style 对象的值为 atom/函数（`style={{color: colorAtom}}` 是自然写法）时，inline 路径把函数源码字符串化成非法 CSS（样式静默丢失）且 atom 从未被读取（没有任何响应性）；嵌套样式（stylesheet 路径）同样中招，且静态 stylesheet 不随 atom 变化重建、依赖在下一次重算时丢失 | `stringifyStyleValue` 统一求值 function/atom（调用点都在响应式绑定内，读取即建立依赖），CSS 自定义属性与逗号多值数组同样求值；嵌套样式中含 atom/函数值时按动态样式处理（滚动重建 stylesheet）（`src/DOM.ts` / `src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I24 | AOP key 用 `split(':')` 一刀切，第二个 `:` 之后的部分被静默丢弃：`$a:$b:prop` 扁平写法的嵌套 AOP key（应作为 prop `'$b:prop'` 传给子组件自己解析）与 `$icon:xlink:href` 这类带 namespace 的属性名全部失效 | 只在第一个 `:` 处切分；`$` 开头的 itemProp（嵌套 AOP key）不在本层按 `_` 后缀解析，作为普通 prop 传给目标子组件（`src/ComponentHost.ts`） |
| I25 | `mergeProp` 对 `class`（与 `className` 同义）合并成数组，但 `setAttribute` 的数组分支把 `class` 当「取最后一个」的覆盖属性：AOP 的 `$name:class` 覆盖值被静默丢弃（原值永远获胜）；`class` 也不支持对象形式 | `setAttribute` 把 `class` 统一归一化成 `className` 处理（数组合并、对象形式、SVG 分支全部对齐），`isValidAttribute` 同步接受 `class` 的对象形式（`src/DOM.ts`） |

运行方式：

```bash
npx vitest run __tests__/fatalBugs5.spec.tsx __tests__/improvements5.spec.tsx --coverage.enabled=false
```
