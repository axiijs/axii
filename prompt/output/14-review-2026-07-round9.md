# 14 深度 review 第九轮（2026-07，已全部修复）

本轮 review 在前八轮（见 [05](./05-review-2026-07.md)–[13](./13-review-2026-07-round8.md)）与
契约/fuzz/不变量建设（见 [11](./11-contracts-and-invariants.md)）之后的 `main` 上进行，
再次通读 `src/` 全部源码。按第 13 篇结束时的覆盖地图，本轮重点扫描前几轮相对欠扫的区域：
**表单原生元素的 DOM 协议**（select/option 的 value 恢复、控件与 form 的关联）、
**属性写入的 property/attribute 双路径**、**错误出口的 data0 computed 形态**
（初始渲染 vs patch 的不对称），以及对 F18（ref 数组形态）、I28（事件谓词）两类
既往错误假设的同类猎杀。

对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试。

回归测试：致命问题在 `__tests__/fatalBugs10.spec.tsx`（F33-F34），改进项在
`__tests__/improvements10.spec.tsx`（I36-I38），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F33 | select 的 value 恢复机制（value 先存 dataset、option 渲染后 reset）只识别「option/插入锚点的**直接父级**是 select」的形态：options 包在 `<optgroup>` 里（合法且常见的 HTML）时，RxList/函数节点动态渲染的 option、响应式 option value 都不触发恢复——**选中值静默丢失**（浏览器回落到默认选中第一个 option），没有任何报错 | 新增 `findOwnerSelect`：直接父级是 select，或父级是 optgroup 且其父级是 select（HTML 里 optgroup 只能出现在 select 下一层）。`insertBefore`/`insertAfter` 的插入后恢复与 `setAttribute` 的 OPTION value 分支统一走它；热路径上最常见的 select 判断仍在第一位（`src/DOM.ts`） |
| F34 | `form` 是合法的 HTML attribute（把控件关联到**非祖先** form，提交/校验依赖它），但 `HTMLInputElement.form` 等是只读 accessor：`name in node` 分支对它做 property 赋值在严格模式下 TypeError（被 setProperty 吞掉打日志），**attribute 永远设不上去**，控件与 form 的关联静默失效。`list`/`type` 早已排除，`form` 是同一个类的幸存实例 | ① `form` 加入显式排除表，走 attribute 路径（null/undefined 的移除语义随之正确）；② 修「类」不只修实例：`setProperty` 赋值抛错时回退 `setAttribute`，覆盖自定义元素上与只读 property 同名 attribute 的同类形态（回归测试 F34c 用自定义元素钉住）（`src/DOM.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I36 | RxList 的**初始**行渲染发生在 data0 computed 的 computation 里，而 `fullRecompute` 是 async 函数：行渲染抛错（如非法行内容）向上抛只会变成 **unhandled rejection**——root error 钩子拿不到错误（patch 路径早在 O1 就接好了钩子，初始渲染是不对称的遗漏）；且 `hostRenderComputed`/部分创建的行停留在未初始化状态，后续销毁（函数节点重算换掉该区域、root.destroy）对 undefined 调 `destroyComputed` **二次崩溃**，区域永远无法恢复 | computation 的行创建/插入包进 try/catch，与 applyPatch 的错误出口对齐：已创建的行全部回收（DOM 还在脱离文档的 fragment 里，直接丢弃）、区域渲染为空，错误交给 root error 钩子，未消费时 reportAxiiError 后继续抛出保持可观测；`destroy` 对未初始化的 computed/hosts 容忍（`src/RxListHost.ts`） |
| I37 | `ComponentHost` 构造期只从 inputProps 捕获 ref，`bindProps`（HOC）通过 boundProps 提供的 ref 在 props 合并后被静默丢弃——attachRef 从未被调用（F18 修了 ref 数组的附加，这里是「数组根本没被采用」的兄弟实例） | render 时用合并后的最终 `props.ref` 回写 `refProp`（attachRef/detachRef 本来就支持数组，用户 ref 与 bound ref 都会被附加）（`src/ComponentHost.ts`） |
| I38 | `onDoubleClick`（React 拼法）对应的 DOM 事件是 `dblclick`：不别名的话监听器挂在不存在的 `doubleclick` 事件上，**永远不触发且没有任何报错**（onChange→input 的别名早已建立，这是同一个「React 体验对齐」类里的遗漏） | 事件别名表增加 `doubleclick → dblclick`（`onDblClick` 原拼法不受影响，两者按来源分槽互不干扰）（`src/DOM.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| `mergeProp` 里还有一份手写的 `/^on[A-Z]/` 事件判定——I28 已把 `DOM.ts`/`StaticHost` 收敛到 `isEventName`，这里是最后一份副本（行为一致，但同一谓词存在两份就是未来的分叉点） | 收敛到 `isEventName`（`src/ComponentHost.ts`） |
| F33 的「直接父级」假设全库排查：`AtomHost.parentElement`（非 select 语义）、`StaticHost.destroy` 的 parentNode 比较（区间完整性语义）均不属同类 | 无需修改 |
| I36 的「computed computation 里跑用户逻辑」全库排查：RxListHost 是唯一的 computed；FunctionHost/AtomHost/LightBindingEffect 是同步 ReactiveEffect，初始 run 的错误同步传播且各自已有错误钩子出口 | 无需修改 |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O23 | `handleReorder` 的锚点 `hosts[maxChanged+1].element` 假设受影响区间之后的行已渲染 | 代码层面不可达：同一批 patch 逐个同步应用，每个 splice/explicit key change 结束时所有行都已渲染；fuzz 的混跑序列长期覆盖 reorder 形态 |
| O24 | `<link as="preload">` 这类**原生 `as` 属性**与框架的命名子元素 API（`as=xxx`）冲突，`as` 值会被当成 AOP 名称摘走 | API 设计边界：`as` 是框架的既定保留字（与 `self` 一样），改判定会破坏所有现有组件；需要原生 `as` 属性时可用 `prop:as` 之外的 escape（如 ref 回调里 setAttribute）。属文档层面的已知限制 |
| O25 | StyleManager.update 里 stylePatches 为空数组时 `cssText=''` 会清掉用户通过 ref 手写的 inline style | 有意不改：带响应式 style prop 的元素，inline style 的所有权就在框架侧（elToInlineStyleKeys 的 diff 语义已确立）；混写形态应使用独立元素或 CSS class |
| O26 | `FunctionHost` 对声明了默认参数的 source（`(ctx = {}) => ...`，length 为 0）不分配 context，用户拿不到 onCleanup | 有意不改：`({onCleanup}) => ...` 解构写法 length 为 1、正常分配；默认参数写法本身就表达了「不需要 context」 |

## 性能验证

改动涉及两处热路径：`insertBefore`/`insertAfter` 的 select 判断从一次 instanceof 变为
`findOwnerSelect`（非 select 父级付两次 instanceof），`setAttribute` 属性分支多一次
`name !== 'form'` 字符串比较；`mergeProp` 的正则换成 `isEventName`（更便宜）；
RxListHost 初始渲染多一层 try（无异常时零成本）。

用 sibling `benchmark` 重跑 real-browser 与 memory 基准（修复前后各两轮，同机对比）：
全部场景差异在轮间噪声内（例如 `axii-create-clear-1000-repeat-50` 基线 127.0/124.8ms、
修复后 144.0/126.0ms，第二轮完全回到基线；`create-5000` 11.2/13.8 → 11.9/11.9）；
memory 基准的 afterClear 残留与长跑增长与 2026-07-05 存档同级（axii 1000 行 afterClear
残留 ~2.5KB，长跑 30x create/clear 增长 21.2KB）。

运行方式：

```bash
npx vitest run __tests__/fatalBugs10.spec.tsx __tests__/improvements10.spec.tsx --coverage.enabled=false
```
