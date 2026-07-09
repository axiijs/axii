# Axii 框架深度 Review 文档

本目录是对 axii 框架（v3.9.2，commit `4249ef9`）进行深度 code review 的产出文档。

## 目录

| 文档 | 内容 |
| --- | --- |
| [01-overview.md](./01-overview.md) | 架构概览与总体评价 |
| [02-fatal-issues.md](./02-fatal-issues.md) | 致命问题（8 项，**已全部修复**，现为修复索引） |
| [03-improvements.md](./03-improvements.md) | 显著改进项（15 项，**已逐项求证并处理**，现为处理索引） |
| [04-reproduction-report.md](./04-reproduction-report.md) | 致命问题复现报告（已归档，复现测试已反转为回归测试） |
| [05-review-2026-07.md](./05-review-2026-07.md) | 2026-07 深度 review 第一轮（F1-F6 / I7-I15 / O1-O3，**已全部修复**） |
| [06-review-2026-07-round2.md](./06-review-2026-07-round2.md) | 2026-07 深度 review 第二轮（F7-F10 / I16-I18，**已全部修复**） |
| [07-review-2026-07-round3.md](./07-review-2026-07-round3.md) | 2026-07 深度 review 第三轮（F11-F15 / I19-I23，**已全部修复**） |
| [08-review-2026-07-round4.md](./08-review-2026-07-round4.md) | 2026-07 深度 review 第四轮（F16-F19 / I24-I25，**已全部修复**） |
| [09-review-2026-07-round5.md](./09-review-2026-07-round5.md) | 2026-07 深度 review 第五轮（F20-F21 / I26-I27，**已全部修复**） |
| [10-review-2026-07-round6.md](./10-review-2026-07-round6.md) | 2026-07 深度 review 第六轮（F22-F24 / I28-I30，**已全部修复**） |

## 结论摘要

- **架构方向没有致命缺陷**：无 VDOM、组件函数只执行一次、Host 树 + Comment placeholder 锚点、基于 data0 的增量更新，这套设计是自洽且清晰的。
- review 曾发现 **8 个致命问题**（会在真实场景中直接崩溃或产生错误行为），全部经测试复现确认后**已全部修复**；对应的复现测试已反转为回归测试（`__tests__/fatalBugs.spec.tsx`、`__tests__/node/importInNode.spec.ts`、`__tests__/node/packageJson.spec.ts`）。
- review 还列出 **15 项显著改进点**，全部经过真实求证后逐项处理完毕（个别子项经评估后有意不改，理由见 [03-improvements.md](./03-improvements.md)）；回归测试在 `__tests__/improvements.spec.tsx`、`__tests__/form.spec.tsx`。
- coverage 配置已去掉运行时代码的 exclude，覆盖率徽章数据（`coverage-summary.json`）按真实口径重新生成。
