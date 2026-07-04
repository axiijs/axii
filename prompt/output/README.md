# Axii 框架深度 Review 文档

本目录是对 axii 框架（v3.9.2，commit `4249ef9`）进行深度 code review 的产出文档。

## 目录

| 文档 | 内容 |
| --- | --- |
| [01-overview.md](./01-overview.md) | 架构概览与总体评价 |
| [02-fatal-issues.md](./02-fatal-issues.md) | 致命问题（8 项，全部经测试验证确实存在） |
| [03-improvements.md](./03-improvements.md) | 显著值得改进的地方（正确性 / 健壮性 / 设计 / 可维护性） |
| [04-reproduction-report.md](./04-reproduction-report.md) | 致命问题的测试复现报告（验证方法、结果、运行方式） |

## 结论摘要

- **架构方向没有致命缺陷**：无 VDOM、组件函数只执行一次、Host 树 + Comment placeholder 锚点、基于 data0 的增量更新，这套设计是自洽且清晰的。
- **实现层面存在 8 个致命问题**，会在真实场景中直接崩溃或产生错误行为，其中多个是"清理句柄声明了但从未赋值"、"ASI 分号陷阱"这类可以一两行修掉的疏漏。
- 全部 8 个致命问题都已在 `__tests__/fatalBugs.spec.tsx` 和 `__tests__/node/importInNode.spec.ts` 中复现验证（BUG 6 由测试环境搭建过程本身证实），**没有误报**。

## 建议的处理顺序

1. **一两行即可修复**：BUG 1（两处退订赋值）、BUG 2（destroy 顺序）、BUG 3（Form 加分号）、`mergeProp` 的 `'classname'` 拼写。
2. **影响真实用户的行为错误**：BUG 4（reorder 锚点）、BUG 5（事件别名冲突）、BUG 8（stylesheet 累积）。
3. **工程基础**：BUG 6（data0 依赖，让仓库可独立测试，本 review 分支已附带修复）、BUG 7（浏览器 API 惰性初始化）。
