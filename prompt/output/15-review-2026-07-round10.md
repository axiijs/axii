# 15 深度 review 第十轮（2026-07，已全部修复）

本轮 review 在前九轮（见 [05](./05-review-2026-07.md)–[14](./14-review-2026-07-round9.md)）与
契约/fuzz/不变量建设（见 [11](./11-contracts-and-invariants.md)）之后的 `main`（v4.3.0）上进行，
再次通读 `src/` 全部源码。按第 14 篇结束时的覆盖地图，本轮重点扫描仍然欠扫的区域：
**复杂表单控件的值形态**（multiple select 的数组 value、option 文本即 value 的 DOM 协议）、
**style 值的 boolean 形态**（条件写法 `cond && value` 的翻转路径）、
**AOP 配置函数的输入形态**（`_children` 单节点、merge 函数就地修改不返回），
以及**组件销毁时清理函数与 DOM 拆除的顺序**。

对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试（本轮 19 个新测试，
未修复代码上 17 失败 / 2 为对照通过项）。

回归测试：致命问题在 `__tests__/fatalBugs11.spec.tsx`（F35-F38），改进项在
`__tests__/improvements11.spec.tsx`（I39-I41），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F35 | `<select multiple value={['a','c']}>` 的数组 value（HTML 多选的用户本意）撞上 `setAttribute` 的「数组取最后一个」覆盖语义，被塌成单值；存值恢复路径又把数组经 `dataset` 字符串化成 `"a,c"`，没有任何 option 匹配——动态渲染 option 后**选中被整体清空**，没有任何报错 | ① 数组 flatten 分支显式排除 `select` 的 `value`（mergeProp 从不会把 value 合并成数组，select 上的数组 value 一定来自用户）；② 存值从 `dataset['__value__']`（只能存字符串）改为元素 expando `__axiiSelectValue__`（保留原始形态）；③ 新增 `applySelectValue`：数组值逐个 option 按 `String(v) === option.value` 设置 `selected`（数字值 `[1,3]` 是自然写法），单值路径维持原生赋值；设置与恢复（`resetOptionParentSelectValue`）统一走它（`src/DOM.ts`） |
| F36 | 条件 style 值 `{fontWeight: cond && 'bold'}`（配合 atom/函数是最自然的响应式写法）翻转为 `false` 时被字符串化成 `'false'`——非法 CSS 值，浏览器**静默拒绝这次赋值，旧值永久残留**（elToInlineStyleKeys 的 diff 也清不掉：key 还在，只是值错了）。逗号列表（boxShadow 等）里混入 `'false'` 会让**整条声明**非法，同样旧值残留；CSS 自定义属性路径会把 `false` 写成字面 `"false"` | `stringifyStyleValue` 把 boolean 与 null/undefined 一样按「清除」（返回 `''`）处理；逗号列表路径过滤 falsy 条件项（`cond && '0 0 2px blue'`）；`setAttribute` 的 CSS 自定义属性分支对求值后的 nullish/boolean 走 `removeProperty`；`generateStyleContent`（stylesheet 路径）同步删除 boolean 值的 key（`src/DOM.ts`、`src/StaticHost.ts`） |
| F37 | 没有 value attr 的 option 以**文本**为 value，但 atom/函数 text child 的更新是原地改 `nodeValue`（不走 `insertBefore`），不触发 select 的 value 恢复——存值匹配的 option 此刻才出现时**选中静默丢失**（F33 修了 optgroup 的插入路径，这里是「文本即 value」的兄弟路径） | 新增 `resetOptionOwnerSelect`（`src/DOM.ts`）：直接父级是 OPTION 时经 `findOwnerSelect` 触发恢复（optgroup 包裹一并覆盖）。`AtomHost.replace` 与 `FunctionHost` 文本快速路径（原地更新、占位符复用、新建 Text 三个出口）统一调用；热路径成本只有两次属性读 + 一次 tagName 比较，零分配（`src/AtomHost.ts`、`src/FunctionHost.ts`） |
| F38 | `$name:_children` 的值会被展开传入 `createElement`（`...finalChildren`），传**单个节点**（`$wrap:_children={<b/>}` 是自然写法）时展开非 iterable 直接 **TypeError，整个组件渲染崩溃** | `ensureArray(thisItemConfig.children)` 后再展开；同类排查：`configProps`/`eventTarget`/`propsMergeHandle`/`propMergeHandles` 在 `parseItemConfigFromProp` 里早已 ensureArray（`src/ComponentHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I39 | `ComponentHost.destroy` 先拆 DOM（innerHost.destroy）、置空 ref、销毁 render 期 computed，**之后**才跑清理函数（onCleanup / useEffect / useLayoutEffect 返回值）——`onCleanup(() => observer.unobserve(ref.current))` 是最自然的写法，此时 `ref.current` 已是 null，直接 TypeError 或静默漏清理（泄漏）。React 的清理语义也是「先 cleanup 再卸载 DOM」；FunctionHost 的 cleanups 本来就先于 DOM 拆除执行，ComponentHost 是不一致的那个 | 销毁顺序调整为：layoutEffect 清理 → effect/onCleanup 清理 → detachRef → frame computed 销毁 → innerHost（DOM）销毁；错误钩子语义不变（抛错的 cleanup 不中断兄弟与后续流程）（`src/ComponentHost.ts`） |
| I40 | `$name:_props` / `$name:prop_` 的 merge 函数「就地修改 props、不 return」是自然写法（`(props) => { props.x = 1 }`），返回 undefined 时 `reduce` 把累积值直接换成 undefined——`_props` 路径后续读 `finalProps.ref` 立刻 TypeError（**组件渲染崩溃**），`prop_` 路径 prop 被静默清掉 | 两处 reduce 均改为 `handle(...) ?? acc`：返回值优先，undefined 回退累积值；要显式清掉 prop 用 `() => null`（`src/ComponentHost.ts`） |
| I41 | `dangerouslySetInnerHTML` 值为 undefined 时（`() => maybeHtml()` 的条件写法）被字符串化成字面 `"undefined"` 渲染到页面（innerHTML 的 IDL 对 null 走 LegacyNullToEmptyString，undefined 没有这个待遇） | nullish 统一按清空处理：`node.innerHTML = value ?? ''`（`src/DOM.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| F36 的「style 值字符串化」全库排查：`stringifyStyleValue`（整值 + 逗号列表项 + `[12,'px']` + 位置数组）、`setAttribute` 的 CSS 自定义属性分支、`StyleManager.stringifyStyleObject`（经 stringifyStyleValue）、`generateStyleContent` 的 null 清理 | 前三处已修；`generateStyleContent` 增加 boolean 删除；位置数组（`padding: [4, cond && 8]`）中的 boolean 非自然写法（条件整值才是），经 `i ?? 0` 兜底后不再处理 |
| F37 的「原地 nodeValue 更新」全库排查：`AtomHost.replace` 三个分支、`FunctionHost` 文本路径三个出口是仅有的原地文本更新点（PrimitiveHost/StaticArrayHost 的 Text 是静态创建、经 `insertBefore` 插入，F33 已覆盖） | 全部接入 `resetOptionOwnerSelect` |
| F35 的「dataset 只能存字符串」同类排查：`data-uuid`、`data-as`、`data-axii-style-itor-num` 均为纯字符串语义 | 无需修改 |
| F38 的「用户值被展开/迭代」同类排查：`parseItemConfigFromProp` 里 `configProps`/`eventTarget`/`propsMergeHandle`/`propMergeHandles` 均已 ensureArray | 无需修改 |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O27 | `jsxDEV` 忽略 `isStaticChildren` 参数，数组 children 一律展开：`<div>{arr}</div>` 在 dev（展开为多个静态 child）与 prod（`jsx` 传单个数组 child，走 StaticArrayHost）走不同路径 | 两条路径对同样的 item 集合语义等价（字符串→Text、节点→append、函数/atom→占位符），渲染结果一致；不值得为对齐引入行为变更 |
| O28 | RxListHost 的 bulk Range 删除可能截断相邻「正在离场动画」行的 DOM（animating 行的节点位于被删区间内） | 动画行的异步删除对「placeholder 已脱离 DOM」是被容忍的合法状态（直接跳过），无崩溃、无泄漏；动画被提前截断是相邻行整段删除下的合理表现 |
| O29 | 非 multiple 的 select 收到数组 value | 维持「数组取最后一个」的覆盖语义（AOP 合并产物的既定协议），multiple 才有数组本意 |

## 性能验证

改动涉及的热路径：`AtomHost.replace` / `FunctionHost` 文本更新每次多两次属性读
（`parentElement` + `tagName` 比较，零分配）；`stringifyStyleValue` 多一次 `typeof` 检查；
`setAttribute` 的数组 flatten 分支多一个短路条件（仅数组值时求值）；
`ComponentHost.destroy` 只调整顺序，无新增分配。

用 sibling `benchmark` 重跑 real-browser 基准（基线一轮、修复后两轮，同机对比）：
全部场景差异在轮间噪声内（`axii-update-text-1000-repeat-100`——文本更新热路径——
38.8 / 38.3 / 38.7ms；`axii-create-clear-method-1000-repeat-50` 129.4 / 138.0 / 129.6ms，
第二轮完全回到基线；`create-5000` 10.0 / 10.2ms）。memory 基准的 afterClear 残留
与存档同级（axii 1000 行 afterClear 残留 5.4KB）。
`__tests__/matrix.spec.tsx` 的时间敏感用例全部通过。

运行方式：

```bash
npx vitest run __tests__/fatalBugs11.spec.tsx __tests__/improvements11.spec.tsx --coverage.enabled=false
```
