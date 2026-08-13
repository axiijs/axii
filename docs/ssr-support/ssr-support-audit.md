# SSR Support — 实现审计（M-06）

## Convergence Note

### Remaining closure map

| 领域 | 当前失败证据 |
|---|---|
| （无） | k28 Closure gates 全绿；对抗 SCRIPT/LINK/G4-F/PrimitiveHost/portal leading STYLE 绿；验证加强入验收（mismatch 33）。`hydration-mismatch-rebuild` 本轮闭合。 |

### Root cause and scope

（闭合）前轮 D12/D13 根因已由 k28 修复：`claimTextBeforeCommentPlaceholder(expected)` + `reconcileCommentPhText`；`removeHydrateContainerOrphans` migrate 后不再 skip STYLE/SCRIPT/LINK。本轮无新实现缺陷。

### Next implementation batch

（无 — 里程碑关闭）

### Closure gates

| 应红（未修前） | 应绿（修后） | 不得退化 |
|---|---|---|
| （历史）D12/D13 | mismatch **33** 全绿；全量 **833**；node **78**；fuzz **2**；build | D1–D13；portal trailing/leading；matched Comment-ph identity；retained |

---

**审计轮次**：k=28 对应审计  
**结论**：通过（无实现缺陷；验证缺口已加强并复验）  
**里程碑**：M-06 `待审` → `已完成`  
**reopen**：本轮不计（未退回）；历史 `reopen-count: 7`，`reopen-domains: {hydration-mismatch-rebuild: 7}` 保留  
**convergence-mode**：`milestone-review` → 随里程碑关闭（任务终止）

---

## 1. 验收复验

| 命令 | 结果 |
|---|---|
| `npx vitest run __tests__/ssrHydrate.mismatch.spec.tsx` | **33 passed**（原 27 + 验证加强 6：matched Comment-ph / G4-F / PrimitiveHost / SCRIPT / LINK / portal leading STYLE） |
| 缺陷注入 D12（`reconcileCommentPhText` 忽略 expected） | Comment-ph atom / G4-F / PrimitiveHost **3 红**；还原后绿 |
| 缺陷注入 D13（leading 再 skip STYLE/SCRIPT/LINK） | STYLE / SCRIPT / LINK / portal leading STYLE **4 红**；还原后绿 |
| smoke+attrs+lists+styles+lifecycle+fuzz | **117 passed** |
| `npx vitest run --config vitest.node.config.ts` | **78 passed** |
| `npm run build` | **通过**（`dist/ssr.{js,cjs,d.ts}`；`hydrateRoot` in `axii.d.ts`；`exports['./ssr']`） |
| `AXII_DATA0_FORCE_NPM=1 npx vitest run` | **66 files / 833 passed** |
| `npx vitest run __tests__/rxListFuzz.spec.tsx` | **2 passed**（含于 117） |

## 2. 实现缺陷

无。k28 对 Convergence Note D12/D13 批次产品行为符合 §3.7 / Task 3–4：

- Comment-ph 值漂移：`HydrationMismatchError` + Text identity 重建（AtomHost / FunctionHost G4-F / PrimitiveHost 同类路径）
- 容器 leading 非 SSR STYLE/SCRIPT/LINK：migrate 后清除；Portal 容器同形

## 3. 验证缺口

已加强并入 `__tests__/ssrHydrate.mismatch.spec.tsx`（不退回实现）：

| 加强项 | 目的 |
|---|---|
| matched Comment-ph identity | 正确匹配禁止重建 |
| G4-F Function→string 漂移 | 与 AtomHost 同 `claimTextBeforeCommentPlaceholder` |
| PrimitiveHost 字符串行漂移 | createHost Comment-ph 同类 |
| leading SCRIPT / LINK | D13 同 skip 分支一次列全 |
| portal leading STYLE | Portal `removeHydrateContainerOrphans` 对称 |

对抗旁注（非缺陷）：`class` 属性漂移由属性重写纠正且无 mismatch 报告——与既有「属性通道重写」口径一致，未锁失败。

## 4. 状态更新

- M-06 → **已完成**；`next-action: 无`
- 全部里程碑 M-01..M-06 **已完成** → 最终核验通过 → `status: 已完成`
- 不启动新 chat
