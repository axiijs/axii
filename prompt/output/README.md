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
| [11-contracts-and-invariants.md](./11-contracts-and-invariants.md) | 契约测试（data0 patch 协议）、RxList fuzz、开发期列表不变量（AXII_LIST_ORDER_BROKEN）、同类假设猎杀 |
| [12-review-2026-07-round7.md](./12-review-2026-07-round7.md) | 2026-07 深度 review 第七轮（F25-F28 / I31-I33，**已全部修复**）：StyleManager 样式形态空间 + attach 生命周期 |
| [13-review-2026-07-round8.md](./13-review-2026-07-round8.md) | 2026-07 深度 review 第八轮（F29-F32 / I34-I35，**已全部修复**）：无组件祖先路径、StyleManager 跨实例共享假设、FunctionHost 结构重建、Form 全链路 |
| [14-review-2026-07-round9.md](./14-review-2026-07-round9.md) | 2026-07 深度 review 第九轮（F33-F34 / I36-I38，**已全部修复**）：select/optgroup 与 form 关联的 DOM 协议、property/attribute 双路径、RxList 初始渲染错误出口、事件谓词与 ref 形态的同类猎杀 |
| [15-review-2026-07-round10.md](./15-review-2026-07-round10.md) | 2026-07 深度 review 第十轮（F35-F38 / I39-I41，**已全部修复**）：multiple select 数组 value、boolean style 值残留、option 文本即 value、AOP 配置函数输入形态、清理函数与 DOM 拆除顺序 |
| [16-review-2026-07-round11.md](./16-review-2026-07-round11.md) | 2026-07 深度 review 第十一轮（F39-F41 / I42，**已全部修复**）：表单控件 prop 应用顺序（value/checked vs type/multiple/min/max）、propTypes 默认值/幽灵 undefined 覆盖 bindProps 值、coerce 双重执行、RxDOMRect 事件目标 ref 时序 |
| [17-review-2026-07-round12.md](./17-review-2026-07-round12.md) | 2026-07 深度 review 第十二轮（F42-F48，**已全部修复**，补记索引）：SVG runtime namespace、错误恢复生命周期（render 失败不提交 effects、非法输出、cleanup/async effect 错误边界）、range 约束重放、稀疏 RxList.set 契约错误 |
| [18-review-2026-07-round13.md](./18-review-2026-07-round13.md) | 2026-07 深度 review 第十三轮（F49-F51 / I43-I49，**已全部修复**）：value 的 null/undefined × 元素种类（progress/meter 崩溃、option/button 字面量）、reusable 子树的 context 可见性、SVG 路由跨编译入口统一、用户回调（error 监听器/ref）错误隔离、style 字面形态（[number, keyword]、animation 数组、空字符串）、已消费元素重复渲染的 dev 警告、Form 缺省 values |
| [19-review-2026-07-round14.md](./19-review-2026-07-round14.md) | 2026-07 深度 review 第十四轮（F52-F53 / I50-I54，**已全部修复**）：fragment 整段删除 vs forceHandleElement 子树自理（reusable 内容拆散崩溃）、RxListHost 行 forceHandleElement 透传、render 期 computed 用户 cleanup 抛错中断销毁、fragment 复用静默空白的 dev 警告、元素 ref attach 同步路径错误隔离、外部清空区间下 reusable 销毁容忍、$self: 直达组件的 merge 语义、aria-/data- 的 false 字面化 |
| [20-review-2026-07-round15.md](./20-review-2026-07-round15.md) | 2026-07 深度 review 第十五轮（I55-I57，**已全部修复**；本轮未发现新致命问题）：事件回调的兄弟错误隔离（`invokeEventEntries` 是 I43/I51 错误隔离体系的最后一个缺口，onChange 别名到 input 后与 onInput 相互影响）、`children` 是 boundProps/bindProps 里唯一被静默覆盖失效的 prop、stylesheet 路径样式值经 `}` 越界注入全局 CSS（改逐条 insertRule）；data-camelCase 静态/响应式属性名分叉判定为无法干净统一的设计边界 |
| [21-review-2026-07-round16.md](./21-review-2026-07-round16.md) | 2026-07 深度 review 第十六轮（F54-F55 / I58-I66，**已全部修复**）：组件名（JS 任意字符串）流进 CSS class 命名空间（`.`/匿名名字让 stylesheet 静默丢失或整张被拒）、条件离场动画 falsy 求值让节点永久残留、FunctionHost 是最后一条没有错误钩子语义的绑定更新路径、事件/ref 数组的 falsy 条件项崩溃、bigint child 按入口分叉、progress/meter 的非数字 value 崩溃渲染（F49 最后残留）、lazy 缺省 fallback、`is`（customized built-in）静默不生效、atom 误绑事件 handler 被写入事件对象、dangerouslySetInnerHTML 与 children 并存静默抹掉 children |

## 结论摘要

- **架构方向没有致命缺陷**：无 VDOM、组件函数只执行一次、Host 树 + Comment placeholder 锚点、基于 data0 的增量更新，这套设计是自洽且清晰的。
- **第十六轮（v4.4.5）发现并修复 2 个新致命问题（F54-F55）**：都属于「用户可控输入流进受限命名空间/形态空间」这一类——组件名（JS 任意字符串）作为 CSS class 使得注册表/匿名组件的 stylesheet 静默丢失；条件离场动画的 falsy 求值结果中断销毁使节点永久残留。另落地 9 个改进项（I58-I66），主要是把既有的一致性语义（数组条件项跳过、绑定更新路径错误钩子、bigint 文本形态、setProperty 容错）推广到最后的残留点。
- **第十五轮（v4.4.4）复查未发现新的致命问题**：前十四轮对输入形态角落、跨层假设、销毁/错误恢复生命周期的排查已相当彻底，本轮所有崩溃候选探针均正确工作或落在既有的错误钩子/dev 警告语义内；只落地了 2 个一致性改进（I55/I56）。
- review 曾发现 **8 个致命问题**（会在真实场景中直接崩溃或产生错误行为），全部经测试复现确认后**已全部修复**；对应的复现测试已反转为回归测试（`__tests__/fatalBugs.spec.tsx`、`__tests__/node/importInNode.spec.ts`、`__tests__/node/packageJson.spec.ts`）。
- review 还列出 **15 项显著改进点**，全部经过真实求证后逐项处理完毕（个别子项经评估后有意不改，理由见 [03-improvements.md](./03-improvements.md)）；回归测试在 `__tests__/improvements.spec.tsx`、`__tests__/form.spec.tsx`。
- coverage 配置已去掉运行时代码的 exclude，覆盖率徽章数据（`coverage-summary.json`）按真实口径重新生成。
