# 13 深度 review 第八轮（2026-07，已全部修复）

本轮 review 在前七轮（见 [05](./05-review-2026-07.md)–[12](./12-review-2026-07-round7.md)）与
契约/fuzz/不变量建设（见 [11](./11-contracts-and-invariants.md)）之后的 `main` 上进行，
再次通读 `src/` 全部源码。按第 12 篇结束时的覆盖地图，本轮重点扫描前几轮相对欠扫的区域：
**「无组件祖先」的宿主路径形态**（root.render 直接渲染元素/函数节点/列表）、
**StyleManager 的跨实例共享假设**、**FunctionHost 结构重建路径**、**Form 全链路**，
以及对 F22/F25 两类既往错误假设（「splice argv 已归一化」「先判形状再求值」）的同类猎杀。

对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试。

回归测试：致命问题在 `__tests__/fatalBugs9.spec.tsx`（F29-F32），改进项在
`__tests__/improvements9.spec.tsx`（I34-I35），编号与下表一致。
data0 契约测试新增小数/NaN splice argv 条款（`data0Contract.spec.tsx` 1a-2），
fuzz 的 splice 操作扩展了小数 start 形态（`rxListFuzz.spec.tsx`）。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F29 | 元素的 hostPath 上没有任何 ComponentHost（`root.render(<div>{() => ...}</div>)`、root 下直接渲染 RxList 行都是自然写法）时，`generateComponentElementStaticId` 无条件把 `path[0]` 当 ComponentHost 读 `.type.name`——任何响应式/嵌套 style **初始渲染直接 TypeError**，函数节点重算路径下则变成 unhandled rejection、样式区域永久失效。F15 只修了 `hostPath === null` 的根级形态，这是它的兄弟实例 | `path[0]` 先做 `instanceof ComponentHost` 判断，非组件路径与空路径统一用 `GLOBAL` 前缀、全部 host 参与 path id（`src/StaticHost.ts`） |
| F30 | 静态嵌套样式的 stylesheet id 按「元素 path」跨实例共享，但「相同 path ⇒ 相同样式内容」只是猜测：静态样式对象可以携带每实例数据（`style={{'& b': {color: item.color}}}` 的列表行、prop 参数化样式的同类型兄弟组件），所有实例**静默塌缩成第一个实例的样式**，没有任何报错 | 第一个实例按 `styleSheetIdWithIndex` 登记内容签名（`JSON.stringify` + WeakMap 缓存，boundProps 等共享引用零成本命中）；后续实例签名不一致（或签名算不出来）时退化为该元素独享的 rolling id。内容相同的实例仍共享一张 stylesheet（回归测试 F30c 钉住性能设计不回退）；签名随 stylesheet 引用计数归零一起清理（`src/StaticHost.ts`） |
| F31 | stylesheet 路径（嵌套样式/boundProps）的动态性扫描只扫 `nestedStyles`：atom 出现在 **simple 部分**（`{color: colorAtom, '&:hover': {...}}` 是自然写法）时整个对象被当静态 stylesheet 处理，**第一次生效后样式永远不再更新**（F19 修了值的求值，但没修「该不该滚动重建」的判定） | 判定为 stylesheet 路径（嵌套或 bound）的条目改为扫描**整个对象**；纯 inline 条目跳过扫描（它每次 update 都整体重新赋值，反而比之前少一次空对象遍历）（`src/StaticHost.ts`） |
| F32 | `Array#splice` 对 start 做 ToIntegerOrInfinity（`1.5` 截断成 `1`、NaN 归 0），data0 透传原始 argv；F22 只归一化了负数，**小数 start** 让「往后找插入锚点」的扫描读 `hosts[2.5]` 得到 undefined 直接 TypeError，且 DOM 与数据永久错位 | `Math.trunc(argv[0]) || 0` 与 hosts.splice/Array#splice 语义对齐；契约测试新增 1a-2 条款钉住 data0 的原始 argv 形态；fuzz 的 splice 操作以 25% 概率发射小数 start（`src/RxListHost.ts`、`__tests__/data0Contract.spec.tsx`、`__tests__/rxListFuzz.spec.tsx`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I34 | 函数节点重算的**结构重建**阶段抛错（`unknown child type` 断言等）不经过 root error 钩子：重算在微任务里，错误直接变成 uncaught error。更严重的是 `pauseTracking`/`pauseCollectChild` 没有 finally 恢复——一次抛错后**全局 Notifier 停止追踪，整个应用的响应式全部失效**（错误钩子只覆盖了 `source()` 求值，这是 I26/O 系列错误出口建设的遗漏区） | createHost/render 包进 try/catch/finally：错误交给 root error 钩子（未消费则继续向上抛），区域渲染为空且可随依赖恢复；tracking/collect 状态在 finally 里无条件恢复；createHost 抛错时回收已插入的 placeholder（`src/FunctionHost.ts`） |
| I35 | Form 的 multiple 字段配**普通数组初始值**（`values: new RxMap({tags: ['preset']})` 是自然写法）时：register 只判断 truthy 不判断类型，push 进普通数组没有响应性，unregister 读 `.data` 直接 TypeError | register 时把非 RxList 的既有值收敛成 `new RxList(existing)`（保留初始项）（`src/Form.tsx`） |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O17 | `ReusableHost` 内容在所属 StaticHost 子树被销毁时是否会被物理删除（`destroy(true)` 什么都不做 + 父级 removeNodesBetween） | 证伪：removeNodesBetween 删除的是「元素节点本身」，reusable 内容仍在被摘除的父元素**内部**、子树保持完整，再渲染时按区间搬移正常复用 |
| O18 | `handleSplice` 的 `replaceChildren` 快速清空路径在列表不独占父元素时是否会误删兄弟节点 | 证伪：`!placeholder.nextSibling && !firstNode.previousSibling` 的双向哨兵保证列表确实是父元素唯一内容；函数节点/组件包裹时占位符链必然让哨兵失败、走 Range 路径 |
| O19 | 静态样式条目在「函数返回数组长度变化」时 rolling class 是否残留（O15 的姊妹） | 证伪：字面量数组条目的 index 在元素生命周期内稳定；函数返回的数组条目一律 `entryIsDynamic`（F25），由 F27 差集清理覆盖 |
| O20 | `ComponentHost.destroy` 里 layoutEffect 清理函数在 innerHost 销毁**之后**执行，清理函数里已拿不到 DOM | 有意不改：调整顺序会让清理函数与「区间可能异步删除（离场动画）」的时序更难解释，现有语义（清理只做逆向登记，不做 DOM 测量）已被现有测试钉住 |
| O21 | `data-*` 响应式属性值为 `false` 时渲染字面 `"false"` | 有意不改：data 属性没有布尔语义，`"false"` 是合法且常见的值；null/undefined 的移除语义已由 I17 建立 |
| O22 | `$name:_use` 传入 HTMLElement 覆写整个节点时，原节点的 props/children/ref 全部静默丢弃 | 有意不改：这是「整体覆写」的文档语义，合并行为应该用 `$name:_props`/`$name:_children` 表达 |

## 性能验证

StyleManager 的修改把路径计算从每条目一次提升为每次 update 一次（净减少），签名计算只发生在
「共享静态 stylesheet」条目（冷路径）且有 WeakMap 缓存；`handleSplice` 只增加一次 `Math.trunc`。
用 sibling `benchmark` 重跑 real-browser 与 memory 基准，与修改前（2026-07-05 存档）对比：
全部场景差异在噪声内（例如 `axii-static-row-create-clear-1000-repeat-50` 81.5ms → 75.6ms、
`create-1000` 2.60ms → 2.95ms 互有涨跌），泄漏断言（afterClear/长跑增长）与修改前同级。

运行方式：

```bash
npx vitest run __tests__/fatalBugs9.spec.tsx __tests__/improvements9.spec.tsx --coverage.enabled=false
```
