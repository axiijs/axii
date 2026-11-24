# SSR Support — 设计评审

**结论：通过**

- 评审对象：`docs/ssr-support/ssr-support.md`（`design-round: 14/15`，`status: 设计中`）
- 评审角色：独立设计评审（Task 1 additional task 1）
- 形成结论前未读取旧版 `ssr-support-review.md`
- 证据：源码对照 + `npx vitest run --config vitest.node.config.ts`（6 passed）+ `__tests__/ssrAdjudicationD13CreateHost.spec.tsx` / `ssrAdjudicationD14FnTextStructure.spec.tsx`（passed）+ `__tests__/ssrReviewD15Facts.spec.tsx` → `experiments/review-d15-facts.json`

## 六类复审条件逐项

| # | 条件 | 结果 |
|---|---|---|
| 1 | 关键事实错误 | 未发现 |
| 2 | 内部逻辑矛盾 | 未发现 |
| 3 | 违反项目原则 | 未发现 |
| 4 | 违反任务目标 | 未发现 |
| 5 | 里程碑不可执行 | 未发现 |
| 6 | 必须提前验证的重大风险 | 未发现 |

## 需要复审的问题

无。

## 核查摘要（证据）

### 源码对齐

- **§3.2.0** `isFunctionHostTextSnapshot` 与 `src/FunctionHost.ts` ~144–145 文本快路径逐字同构；结构态为该谓词补集 ∩ `createHost` 可接受集；未知 → SSR 抛错。d14 实验矩阵（含 Function→atom FTS、G3-F/G4-F）复验通过。
- **§3.2.3** 行分派与 `RxListHost.createChildHost` Compact 门闩 + `src/createHost.ts` 全部分支一一对应（含 G3-RL / G3-RU）；d13 复验通过。
- **§3.2.4 / §3.2.5 / §3.2.6**：H1–H4 引用 §3.2.0，未见残留「元素/Fragment」操作闭集；EmptyHost / FCS / FTS / G4-F 互斥表与源码一致。
- **§3.6.2 CB**：`value={true}` CSR outer 含 `value="true" checked="true"`（review-d15），与有限契约一致。
- **开放点 a–d**、API（`renderToString` / `hydrateRoot` / Portal duck）、M-01..M-06 与 Task 要求 1–11 对应；M-02 已显式要求 Text-ph FTS Function→atom。
- **要求 8**：SSR 独立 `axii/ssr`；hydrate 短生命周期布尔；CSR 热路径不常驻 SSR 分支——与 `AGENTS.md` 性能约束一致。

### 本轮探针（非阻塞；契约已覆盖）

| 探针 | 结果 | 设计落点 |
|---|---|---|
| `createElement(..., false)` | `<!--unhandledChild-->`（Comment-ph），非 ElementChildText、非 skip | 发出表 PrimitiveHost+Comment；§5.3 |
| Function→`reusable` Text-ph | `…<!--reusable--><!--computed node-->` + 尾空 Text | FTS 递归 + G3-RU 非列表注 |
| Function→ComponentNode Text-ph | 含 `computed` + 尾空 Text | §3.2.0 H2 |
| 嵌套 Function→atom | 双重 `computed` + 尾空 Text | FTS 递归 |
| RxList `false`/`true` 原始行 | 仅 `rx list item`，无 `empty` | G4′ |
| Function→Fragment 相邻静态文本 | HTML `helloworld` 合并 | A2 包边（§5.3 已列） |
| Text-ph vs Comment-ph 空 atom | `html==''` vs 仅结构 Comment | A1 / A1c |

## 实现注意事项

（不构成复审问题；不延长设计循环）

1. **SSR 不得执行** `Portal.tsx` / `lazy.ts` 客户端路径：Portal 模块级 `WeakSet`、lazy 无条件 `startLoad()` 会跨请求污染；须按 §3.3 旁路字符串序列化（M-05）。
2. **`createElement` 子节点分派**：`null`/`undefined` skip；`string|number|bigint` → ElementChildText；`function`/atom → Text-ph/FTS；其余（含 `boolean`、ComponentNode、Array）→ `Comment('unhandledChild')` + `createHost`。勿把 `false` 当成 ElementChildText 或空串快路径。
3. **Fragment 内 / 扁平进父的相邻 ElementChildText** 仍走 A2 `axii:t` 包边；Function→Fragment 另保留 `fragment start` + FTS 尾 `axii:0`。
4. **Function→ReusableHost（Text-ph）**：内容序列含 `<!--reusable-->`，位于 `computed node` 之前；外层再加 FTS `axii:0`。
5. **嵌套 Function 结构**：每层一个 `computed node`；仅最外层 Text-ph FunctionHost 发尾 `axii:0`。
6. CSS 门闩纯函数算法、Portal 旁路是否统一 `<!--root-->`、发出「始终包 vs 按需包」等见设计 §5.3。

## 结论

设计在 d14 将 FunctionHost 文本态/结构态钉死为与源码同构的 §3.2.0 有限契约，并与 §3.2.3 createHost 闭合表、FTS/FCS/EmptyHost、表单 CB、里程碑验收一致。本轮独立核查未发现符合六类复审条件的阻塞问题。

**结论：通过**
