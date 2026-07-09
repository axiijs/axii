# 11 契约、不变量与 fuzz：从「逐轮找 bug」到「压缩 bug 供给」（2026-07）

六轮 review（[05](./05-review-2026-07.md)–[10](./10-review-2026-07-round6.md)）之后的复盘结论是：
「逐轮阅读 + 定点测试」永远能找到下一个致命 bug，因为——

1. **bug 空间是输入形态空间，不是代码行空间**：行覆盖率 90%+ 时形态覆盖仍远未饱和，
   六轮的致命 bug 几乎全部落在输入形态边界（负数 splice、字符串 AOP style、atom 嵌在
   className 对象里、逗号 selector 列表）。
2. **跨层协议是隐式的**：F22 的根源是对 data0 patch 协议的无文档假设，逐文件读 `src/`
   五遍也读不到这个契约。
3. **修复是局部的，错误假设是全局的**：`startsWith('on')` 第一轮在 `mergeProp` 修掉，
   同一假设在 `DOM.ts` 又活了五轮（I28）；F19 修了 style 对象里的 atom，同构的 F24
   （className 对象里的 atom）又活了两轮。
4. **幸存者偏差**：活到后期的 bug 全是静默错误（DOM 静默错位、样式静默丢弃、
   layoutEffect 静默不执行），不触发任何报错，只有精确断言具体效果的测试才能暴露。

本篇按上述结论落地四类结构性对策（不是第七轮定点 review）：

## 1. 显式契约：data0 → axii 的 patch 协议（`__tests__/data0Contract.spec.tsx`）

用与 `RxListHost.render` 完全相同的订阅方式（manualTrack METHOD + EXPLICIT_KEY_CHANGE）
捕获 axii 实际收到的 triggerInfo，把 `RxListHost.applyTriggerInfo` 依赖的全部输入形态
固化成 7 条契约测试：

| 条款 | 内容 |
| --- | --- |
| 1 | splice 的 argv 是**用户原始参数**：start 可以是负数/越界（Array#splice 语义），消费方必须自行归一化；methodResult 是真实删除的元素数组 |
| 2 | push/pop/shift/unshift 一律以 splice patch 到达，argv 已换算成索引 |
| 3 | set(index, v) 以 EXPLICIT_KEY_CHANGE 到达，key 是数字 index；越界 set 产生稀疏数组，属契约外用法（由列表不变量兜底报错） |
| 4 | reorder/swap/reposition/sortSelf 全部收敛为一个 reorder patch（pairs 语义 `data[to] = old[from]`）+ reorderInfo |
| 5 | 派生列表（map）收到的 patch 形态与源一致 |
| 6 | clear 型 splice 快速路径同样交付原始 argv |

data0 升级后任何一条形态变化都会先在这里报警，而不是在渲染层以「DOM 静默错位」暴露。

## 2. 性质测试（fuzz）：随机操作序列 × 镜像数组 oracle（`__tests__/rxListFuzz.spec.tsx`）

确定性 PRNG（mulberry32，seed 固化，失败信息带 `seed/step/op` 可精确复现），
对 RxList 的全部列表操作（splice 含负数/越界 start、push/pop/shift/unshift、set、
swap/reposition/sortSelf）做随机序列，普通数组为镜像 oracle，**每步断言
「DOM 文本序列 === 镜像」**。行 host 类型混跑（CompactElementHost / FunctionHost /
ComponentHost / fragment StaticHost，由 item id 决定、随移动稳定）。

有效性验证：把 `src/RxListHost.ts` 回退到 F22 修复前，fuzz 在 **seed=1 step=12**
（compact 行）与 **seed=11 step=28**（混合行）当场命中负数 splice 错位——
证明这类 bug 对随机序列而言是「分钟级发现」，对手写用例而言是「第六轮才发现」。

## 3. 开发期运行时不变量：AXII_LIST_ORDER_BROKEN（`src/RxListHost.ts` / `src/diagnostics.ts`）

诊断开启（默认跟随 `__DEV__`）时，每个 patch 批次结束后校验：

1. hosts 数量 === `list.data` 数量（契约外的稀疏 set 等会破坏）；
2. 已渲染行的 DOM 区间按数组顺序排列、且都在列表 placeholder 之前
   （外部代码搬动/删除行节点会破坏；跨树节点跳过比较避免误报）。

破坏时抛出/上报结构化的 `AXII_LIST_ORDER_BROKEN`（复用 AxiiError 基建：Host 栈、
组件栈、reactive trace、DOM 快照），把「静默错位」变成当场可见的错误。
生产环境（诊断关闭）只有一次布尔检查的成本。全量测试套件（516 个测试）
在不变量激活状态下零误报。回归测试：`__tests__/listInvariant.spec.tsx`。

## 4. 同类假设猎杀（sibling sweep）与谓词收敛

对已修 bug 的错误假设做全库搜索，本次收获：

| 发现 | 处理 |
| --- | --- |
| F17 修了「对原始值 defineProperty」，但 **frozen/sealed 对象**（`Object.freeze` 的静态 boundProps/样式常量是自然写法）defineProperty 新属性同样 TypeError，初次渲染即崩溃 | `canMarkProp` 增加 `Object.isExtensible` 判断：标记只是优化用元数据，丢标记的代价远小于渲染期崩溃（`src/StaticHost.ts`；回归测试 `__tests__/hardening.spec.tsx`，修复前 3 例全崩） |
| `isReactiveValue` 与 `isAtomLike` 是**语义完全相同的两份副本**——同一判定存在两份，未来行为分叉时就是新的 bug 面（I28 的教训） | 合并为单一实现（`src/StaticHost.ts`） |
| `ComponentHost.hasEventProps` 的宽松 `on` 前缀 | 维持（O13：只影响 `listenerBoundArgs` 缓存的过近似分配，无害） |

## 过程纪律（已写入 AGENTS.md）

- **修 bug 先修类再修实例**：假设被证伪时，全库搜索共享该假设的所有位置再收工。
- **跨层依赖先写契约测试**：对依赖内部行为（而非公开文档）的边界，先把假设固化成
  契约测试再消费。
- **新增列表/区间类逻辑跑 fuzz**：`npx vitest run __tests__/rxListFuzz.spec.tsx`。

运行方式：

```bash
npx vitest run __tests__/data0Contract.spec.tsx __tests__/rxListFuzz.spec.tsx \
  __tests__/listInvariant.spec.tsx __tests__/hardening.spec.tsx --coverage.enabled=false
```
