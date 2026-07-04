# 03 显著值得改进的地方（已处理）

原文档在 commit `4249ef9`（v3.9.2）上记录了 15 项显著改进点。**所有条目都经过真实求证后逐项处理**，原始的问题描述已从本文档删除，防止误导后续工作；如需查看，请查阅本文件删除前的 git 历史。

回归测试统一在 `__tests__/improvements.spec.tsx`（测试编号与条目编号一致），Form 相关补充测试在 `__tests__/form.spec.tsx`，package.json 元数据在 `__tests__/node/packageJson.spec.ts`。

## 处理索引

| # | 条目 | 求证结论 | 处理 |
| --- | --- | --- | --- |
| 1 | `mergeProp` 的 `'classname'` 拼写 + `startsWith('on')` 误伤 | 确认存在 | 改为 `/^on[A-Z]/` 与 `className`（`src/ComponentHost.ts`） |
| 2 | `style={null}` 崩溃 | 确认存在（`isDynamicProp(null)` 抛 TypeError） | `isBoundProp`/`isAopProp`/`isDynamicProp` 对 null 安全（`src/StaticHost.ts`） |
| 3 | `checked` 只写 attribute 不写 property | 确认存在（dirty state 后失灵） | 同时写 property + attribute（`src/DOM.ts`） |
| 4 | `FunctionHost` 销毁与微任务重算竞态 | **部分成立**：实测当前 data0 的 `recompute` 有 `active` 检查，销毁后重算是 no-op，不会崩；但确实依赖 data0 内部实现 | 防御性修复：微任务回调显式检查 `destroyed` 标志（`src/FunctionHost.ts`） |
| 5 | `removeElements` 无错误兜底；离场动画标记不透传 | 两点都确认存在 | ① 异步删除前检查区间完整性，DOM 已被外部清理时跳过；② `ComponentHost`/`FunctionHost`/`StaticArrayHost` 透传 `forceHandleElement`；③ 顺带修复：`ComponentHost.destroy` 不再提前移除与 innerHost 共享的 placeholder（否则异步离场动画的删除区间被破坏） |
| 6 | itemConfig 合并用 `rawProps` 而不是 `finalProps` | 确认存在（`$self:` 合并结果被丢弃、`prop:` 键混回 props） | 改为基于 `separateProps` 结果合并（`src/ComponentHost.ts`） |
| 7 | `createRoot` 原地改写传入 context 的 `root` 字段 | 确认存在（Portal 组件的 ref/layoutEffect 被错误注册到内层 root） | `createRoot` clone parentContext（`src/render.ts`） |
| 8 | `Root.render` 可重入无保护 | 确认存在 | 加 assert；`destroy` 重置 `root.host` 后可再次 render |
| 9 | 没有任何错误处理机制 | 确认存在；且组件抛错会让 effect collect frame 栈错位（泄漏） | 新增 `root.on('error')` 全局钩子：注册后组件 render / 函数节点重算抛错会被报告、该区域渲染为空且可恢复；未注册时保持原有抛出行为。collect frame 改为 try/finally 必定弹出。`dispatch` 现在返回是否有监听器消费 |
| 10 | AOP DSL 拼错静默失效；assert 报错用错变量 | assert 变量问题确认存在；"未命中 `as` 名称告警"经评估**不实现**：元素在函数节点/条件分支里是懒渲染的，无法在渲染期可靠判定"未命中"，会产生误报 | 修正报错信息为非法的 `itemProp` |
| 11 | 死代码 | 确认存在 | 删除 `src/common.ts` 整个文件（未被导出、与 reactiveDOMState 重复）；删除 `ComponentHost.reusedNodes`、`StaticHost.parentElement`、`StaticArrayHost.parentElement`、`ComponentHost.render` 中重复的 `this.props` 赋值 |
| 12 | propTypes 半成品 | 确认存在 | `shapeOf.check` 实现真实校验；`arrayOf`/`shapeOf` 的 stringify/parse 用 JSON 实现（parse 后校验）；`coerce?.(v) \|\| v` 改为三元，不再吞掉合法 falsy 返回值；propTypes.ts 纳入 coverage |
| 13 | `insertBefore` 区间搬移逐节点递归 | 确认存在（5 万节点实测栈溢出风险） | 改为循环；顺带修复了递归版 `newEl === endEl` 时会越过 endEl 继续搬移的边界 bug |
| 14 | 测试盲区 | 确认存在 | coverage exclude 只保留纯类型文件（`Host.ts`/`types.ts`）；`Form.tsx`/`propTypes.ts`/`util.ts` 计入覆盖率并补测试（`form.spec.tsx` 等）；`coverage-summary.json` 已按真实口径重新生成（lines 92.44%） |
| 15 | 其他小项 | 见下 | 见下 |

## 条目 15 各小项

| 小项 | 求证结论 | 处理 |
| --- | --- | --- |
| `lazy.ts` 的 `LazyComonent` 拼写 | 确认 | 已改名 `LazyComponent`；"atom 存组件函数"经测试确认 data0 语义正确（新增 lazy 测试，覆盖率从 11.76% 到 100%） |
| `eventProxy` 数组 listener 用 `forEach` 吞返回值 | 确认 | 改为 `map`，返回各 handler 的返回值数组 |
| `assert` 报错字符串在生产 bundle 保留 | 确认存在，**评估后不改**：错误信息对生产环境定位问题有价值，短码方案需要额外的解码文档且降低可用性；当前全量字符串对 bundle 体积影响很小（umd gzip 约 14KB） | 维持现状 |
| `package.json` 缺 `sideEffects`/`repository`/`description` | 确认 | 已补齐 |
| 动态事件绑定不可能（设计限制） | 确认（`isValidAttribute` 对 `on*` 恒真，事件不走 autorun） | 已在 README.md / README-zh_CN.md 增加 "Design notes / limitations" 说明 |
