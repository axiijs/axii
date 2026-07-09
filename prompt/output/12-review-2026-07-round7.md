# 12 深度 review 第七轮（2026-07，已全部修复）

本轮 review 在前六轮（见 [05](./05-review-2026-07.md)–[10](./10-review-2026-07-round6.md)）与
契约/fuzz/不变量建设（见 [11](./11-contracts-and-invariants.md)）之后的 `main` 上进行，
再次通读 `src/` 全部源码。按第 11 篇的结论，本轮重点扫描**输入形态边界**中尚未被覆盖的组合，
特别是 StyleManager 的「样式形态」空间：同一个 style prop 在
函数/数组/字符串/null/嵌套对象之间的所有转换路径。
对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试。

本轮问题全部集中在 **StyleManager 的形态处理**与 **attach 生命周期**上，
核心渲染引擎（Host 树、RxListHost）未发现新问题。

回归测试：致命问题在 `__tests__/fatalBugs8.spec.tsx`（F25-F28），改进项在
`__tests__/improvements8.spec.tsx`（I31-I33），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F25 | 响应式 style 函数返回数组（`style={() => [base, extra]}` 是自然写法，静态数组 `style={[a,b]}` 一直支持）时，`StyleManager.update` 先判数组再求值：函数返回的数组被 `splitStyleObject` 当成 `{0: {...}, 1: {...}}` 的嵌套样式，生成 `.cls 0 {...}` 这类非法 selector——**整个样式静默失效**，且没有任何报错 | `update` 先对每个条目求值再展开数组（数组项自身还可以是函数/atom，同样求值），展开出的条目全部按动态样式处理（`src/StaticHost.ts`） |
| F26 | style 数组中的条件项翻转为 null（`style={[base, () => cond() ? {...} : null]}`）时，`splitStyleObject` 对 null 返回**空字符串**，patch 阶段 `cssText=''` 把数组里其他 style 对象刚写入的值**一起清掉** | `splitStyleObject` 对 null/undefined 返回空对象；上一轮残留 key 的清除本来就由 `elToInlineStyleKeys` 的 diff 逻辑负责，不需要 `''` 兜底（`src/StaticHost.ts`） |
| F27 | 响应式 style 从「嵌套样式（stylesheet 路径）」翻转为纯 inline/null 时（`() => cond() ? {'&:hover':{...}} : {...}` 是自然写法），rolling class 的移除只发生在 stylesheet 分支内部——本轮不走 stylesheet 路径就没人摘旧 class：**旧 stylesheet 里的嵌套规则（:hover、属性/子元素选择器）永久生效** | `update` 末尾做「形态翻转清理」：以元素独享的 rolling id 前缀（`elToStyleId`，含随机段，静态/共享 id 不受影响）扫 `elToStyleClassIds`，本轮不再有效的 rolling class 全部摘除并释放引用计数；itor 推进保证翻回 stylesheet 路径时用新 id、退役的 stylesheet 能被滚动清理删除（20 次形态翻转后 `adoptedStyleSheets` 保持 O(1)）（`src/StaticHost.ts`） |
| F28 | stylesheet 路径（嵌套样式/boundProps/keyframes）的 `stringifyStyleObject` 把所有 key 做驼峰转连字符 + 小写化：CSS 自定义属性 `--mainColor` 变成 `--maincolor`。**自定义属性大小写敏感**，`var(--mainColor)` 永远读不到值；inline 路径（`setProperty`）本来就保留原样，两条路径行为不一致 | `--` 开头的 key 原样输出，不做任何转换（`src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I31 | 响应式 style 从字符串形态（`() => cond() ? 'color:red;font-size:20px' : {...}`）翻转为对象/null 形态时，字符串里写过哪些 key 无从得知：旧值**永久残留**在 inline style 上 | `elToInlineStyleKeys` 用哨兵 key 记录「上一轮是字符串 cssText 整体覆写」，翻转到非字符串形态时先整体清除 `cssText` 再按 patch 赋值（`src/StaticHost.ts`） |
| I32 | `detachStyle` 是函数/atom 且返回数组时，`removeElements` 先判数组再求值（与 F25 同一个错误假设的兄弟实例）：函数返回的数组被当成对象、styleKeys 变成数组下标——transition 检测失效，**离场动画被直接跳过**（节点瞬间删除） | 先求值再判数组（`src/StaticHost.ts`） |
| I33 | 容器脱离文档（`root.attached` 仍为 true）期间动态创建的组件/元素登记在 deferred-attach 队列里（F16 机制）；容器重新连通后手动 `root.dispatch('attach')`（公开用法，F14 已确立）**不 flush 该队列**——没有任何外层插入动作会再替它们 flush，layoutEffect/ref 永不执行 | `dispatch('attach')` 在派发监听后 flush deferred-attach 队列（仍未连通的条目继续留队），Portal 的 attach 桥接同样受益（`src/render.ts`） |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O14 | `StaticHost.destroy` 对 reactiveHosts 无条件 `destroy(true)`：静态子树内的**动态** child（函数节点）当前渲染着带 `detachStyle` 的元素时，父元素整体移除会跳过该离场动画（`StaticArrayHost` 在 F4 中改成了尊重子 host 的 `forceHandleElement`） | 有意不改：与 StaticArrayHost 不同，这里的动态 child 位于**被移除的父元素内部**，父元素移除必然带走子元素，无法在移除父元素的同时让子元素的离场动画继续播放；语义上「区间整体消失」时内部动画本就无法成立 |
| O15 | 함数 style 返回的数组长度在两轮之间变化（`[a,b]` → `[a]`）时，消失条目的 rolling class 是否残留 | F27 的清理是按「本轮有效集合」做差集的，消失条目的 rolling class 同样会被摘除，无需单独处理（`fatalBugs8` 的 F27 系列覆盖同一路径） |
| O16 | `updateAttribute` 的 `Array.isArray(value)` 也是「先判数组再求值」的形态（F25/I32 的同类假设猎杀） | 无害：函数值求值后的数组会交给 `setAttribute` 的数组分支正常处理（className 合并/覆盖取最后一个），不存在「数组被当成对象」的错误路径 |

运行方式：

```bash
npx vitest run __tests__/fatalBugs8.spec.tsx __tests__/improvements8.spec.tsx --coverage.enabled=false
```
