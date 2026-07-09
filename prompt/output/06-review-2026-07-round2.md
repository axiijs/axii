# 06 深度 review 第二轮（2026-07，已全部修复）

本轮 review 在第一轮（见 [05-review-2026-07.md](./05-review-2026-07.md)）修复完成后的 `main` 上进行，
再次通读 `src/` 全部源码。对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
证伪的直接排除。核心渲染引擎（Host 树、RxListHost 的 splice/reorder/LIS、错误诊断系统）依然稳固；
本轮问题集中在 **JSX 属性/children 的 falsy 值语义** 和 **组件组合 API** 上。

复现后被证伪（未修复，行为正确）的疑点：行级动态嵌套 stylesheet 的引用计数（churn 场景实测无泄漏）、
`reusable` 节点在 root.destroy 后的 effect 泄漏（实测正确清理）、`each(null)` 崩溃（for-in 对 null 安全）。

回归测试：致命问题在 `__tests__/fatalBugs3.spec.tsx`（F7-F10），改进项在 `__tests__/improvements3.spec.tsx`（I16-I18），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F7 | `style={cond && {...}}` / `style={undefined}` / 数组中的 falsy 项直接命中 assert 抛 "style can only be string or object."，最常见的条件样式写法初次渲染即崩溃；响应式写法在翻转为 falsy 的一瞬间抛错。顺带发现：响应式 style 换 key 后旧 inline key 残留 | falsy style 语义为清空/跳过；`StyleManager.update` 记录上一次写入的 inline key，本次不再出现的显式清除（`src/DOM.ts` / `src/StaticHost.ts`） |
| F8 | `className={cond && 'x'}` 的 falsy 结果抛 "className can only be string or {[k:string]:boolean}"，静态写法崩在首渲，响应式写法崩在 atom 写入瞬间（打断整条响应式更新链） | falsy className 跳过（单值 falsy 时清空 class）；错误类型（如数字）仍保留 assert（`src/DOM.ts`） |
| F9 | 没有 `value` prop 的 select（非受控）+ 动态渲染 option 时，`resetOptionParentSelectValue` 把 `dataset` 里不存在的值（undefined）字符串化成 `"undefined"` 赋给 `select.value`，浏览器默认选中被清掉（selectedIndex 变 -1） | 只有显式设置过 value prop（dataset 有存值）才重置；受控 select 存 `value ?? ''`，null 不再被字符串化成可能误匹配的 `"null"`（`src/DOM.ts`） |
| F10 | `Function.prototype.bind` 不继承静态属性，`bindProps` 从 bind 结果上读 `boundProps`（恒 undefined）：嵌套 `bindProps` 静默丢掉前一层绑定的 props，原组件的 `postBoundProps` 也整体丢失 | 从原 Component 上读取并复制 `boundProps`/`postBoundProps`（`src/ComponentHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I16 | boolean child 渲染出字面 `"false"`/`"true"`：`{cond && <el/>}`、`{() => cond() && <el/>}`、`atom(boolean)`、RxList 布尔行全部中招 | `FunctionHost` 文本快速路径 / `PrimitiveHost` / `AtomHost.stringValue` 对 boolean 渲染空文本，与 I7（null/undefined 渲染空）语义一致（`src/FunctionHost.ts` / `src/createHost.ts` / `src/AtomHost.ts`） |
| I17 | 响应式 `data-*` 属性值变为 null/undefined 时，dataset 赋值把它字符串化成字面 `"undefined"`/`"null"` | nullish 时 `delete el.dataset[key]` 移除属性（`src/StaticHost.ts`） |
| I18 | 动态 `boundProps` 函数返回 falsy（`cond ? {...} : undefined`）时 `markBoundProp` 对 undefined 做 `Object.defineProperty` 抛 TypeError | falsy 返回值视为空 props（`src/ComponentHost.ts`） |

运行方式：

```bash
npx vitest run __tests__/fatalBugs3.spec.tsx __tests__/improvements3.spec.tsx --coverage.enabled=false
```
