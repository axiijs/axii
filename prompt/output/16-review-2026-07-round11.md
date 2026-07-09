# 16 深度 review 第十一轮（2026-07，已全部修复）

本轮 review 在前十轮（见 [05](./05-review-2026-07.md)–[15](./15-review-2026-07-round10.md)）与
契约/fuzz/不变量建设（见 [11](./11-contracts-and-invariants.md)）之后的 `main`（v4.3.1）上进行，
再次通读 `src/` 全部源码。本轮重点扫描的输入形态角落与跨层假设：
**表单控件 prop 的应用顺序**（JSX 属性书写顺序 vs value/checked 对 type/multiple/min/max 的依赖）、
**propTypes 与 boundProps 的合并优先级**（默认值/幽灵 undefined 对 bindProps 值的覆盖、coerce 的执行次数）、
以及 **reactiveDOMState 对 ref 挂载时序的假设**（RxDOMRect 事件重算目标）。

对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试（本轮 14 个新测试，
未修复代码上 12 失败 / 2 为对照通过项）。

回归测试：致命问题在 `__tests__/fatalBugs12.spec.tsx`（F39-F41），改进项在
`__tests__/improvements12.spec.tsx`（I42），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F39 | **value/checked 的语义依赖同元素其他 prop 已经就位，而 prop 按 JSX 书写顺序应用**：`<select value={['a','c']} multiple>`（value 写在 multiple 前）时数组 value 在单选语义下逐个 selected 互相顶掉，只剩最后一项；`<input value={true} type="checkbox"/>` 的 value 落在 text 语义上，勾选丢失；`<input value={150} type="range" max={200}/>` 被默认 max=100 截断成 100；`<select multiple><option selected>…` 的多个 selected 在 multiple 生效前插入同样只剩一个。全部**静默错误状态，没有任何报错**。响应式形态同样中招：`multiple={cond}` / `type={cond ? 'text' : 'checkbox'}` 翻转后存值不会按新语义重放 | ① `createElement` 把 `value`/`checked` 统一延后到其余 prop 全部应用之后再处理（含响应式的 unhandledAttr 登记顺序，保证 LightBindingEffect 初始求值也在 type/multiple 之后）；② select 的静态真值 `multiple` 提前到 option children 之前预应用（props 循环里重复设置同值无害）；③ `setAttribute` 新增 SELECT `multiple` 分支：翻转后经 `resetOptionParentSelectValue` 重放存值；④ INPUT 的 value 存入 `__axiiInputValue__`，`type` 翻转到 checkbox/radio/range（会重新解释 value 的目标 type）时重放；text/password 互切（密码可见性）不重放，避免覆盖用户已输入内容（`src/DOM.ts`） |
| F40 | `RxDOMRect` 的事件重算选项（`[{target: scrollerRef, event: 'scroll'}]`）在 `listen` 里直接读 `target.current.addEventListener`——refs 按文档顺序 attach，目标元素（滚动容器等）写在被测元素之后是自然写法，此时 current 还是 null，**TypeError 让整个渲染崩溃** | 目标未挂载时延迟到微任务再绑定（ref 附加与渲染同属一个同步任务，微任务时已就绪）；届时仍未挂载（目标从未渲染）说明没有可监听对象，跳过。监听器共享一个闭包，abort 后不再补绑（`src/reactiveDOMState.ts`） |
| F41 | propTypes 声明的 prop 在没有输入时被写成**显式 undefined 幽灵 key**，或按「输入」优先级填充默认值——合并顺序是 bound 在前、input 在后按覆盖合并，两种形态都会把 `bindProps(Comp, {size:'large'})` 提供的值静默覆盖成 undefined / 默认值，组件拿到错误值且没有任何报错 | ① `normalizePropsByPropTypes` 不再写入没有默认值的幽灵 undefined key；② 默认值填充的 key 拆出为独立的最低优先级合并源（优先级改为 postBoundProps > configProps > inputProps > boundProps > propTypes 默认值）；boundProps 求值函数仍收到含默认值的完整 inputProps（引用同一批默认值实例，行为不变）（`src/ComponentHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I42 | propTypes 的 `coerce` 被执行两次（`normalizePropsByPropTypes` 一次、render 里 `normalizePropsWithCoerceValue` 再一次）。coerce 不一定幂等（`coerce: v => [v]` 的包装写法是自然写法），双重执行产出双层包装的静默错误值；快速路径（无 boundProps 的绝大多数组件）还白付一次对象 spread + 遍历 | `getFinalPropsAndItemConfig` 返回 `precoerced`（已 coerce 的输入 props）：快速路径下与 props 同引用，render 里整体跳过第二次 normalize（少一次每组件的对象分配）；慢速路径按 key 引用比对，原样保留的输入值跳过、只 coerce boundProps/AOP 合并出的新值（bound 固定值仍会被 coerce，语义不变）（`src/ComponentHost.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| F39 的「prop 应用顺序依赖」全库排查：`value` ← type/multiple/min/max（已延后+重放）；`checked` ← type（已延后；checked property 本身跨 type 保留）；option 的 `selected` ← select.multiple（children 先于 props 处理，multiple 预应用覆盖）；radio 的 `checked` 走通用 property 路径，无顺序依赖 | value/checked 延后 + multiple 预应用 + multiple/type 重放已覆盖全部形态 |
| F40 的「listen 期即读 ref.current」全库排查：`RxDOMDragState` 的 boundary/container 读取都发生在 mousedown 之后（用户交互时 refs 必已挂载），且 container 有可选链；其余 RxDOM* 不接受目标 ref | 无需修改 |
| F41 的「幽灵 undefined key」同类排查：`normalizePropsWithCoerceValue` 只覆写已定义的 key，不产生幽灵 key；`mergeProps`/`parseAndMergeProps` 只搬运调用方给的 key | 无需修改 |
| I42 的「coerce 调用点」全库排查：只有 `normalizePropsByPropTypes` 与 `normalizePropsWithCoerceValue` 两处，均已收敛为「每个 prop 恰好一次」 | 已修复 |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O30 | atom 值为 DOM 节点/JSX 时 `AtomHost` 按文本渲染出 `[object HTMLElement]` | 「atom child 即文本」是框架的既定语义（动态结构用函数 child），改成检测 Node 会在最热的文本路径上加分支；维持现状 |
| O31 | `<input type={t}/>` 在 text/password 之外与 checkbox/radio/range 互切时用户已输入内容可能被初始 value 重放覆盖 | 重放只对「会重新解释 value」的目标 type（checkbox/radio/range）生效，text 系互切绝不重放；这已是两种错误代价里较小的一侧 |
| O32 | `RxDOMRect` 事件目标 ref 后续再指向新元素（RxRef 场景）时监听器不迁移 | 与既有的「listen 时一次性绑定」语义一致，迁移需要订阅 ref 变化，超出本轮范围且无自然写法触发 |

## 性能验证

改动涉及的热路径：`createElement` 每个 prop 多两次字符串比较（value/checked 判断），
仅当存在 value/checked 时才有第二次 key 扫描；select 预应用只对静态 multiple 的 select 生效；
`setAttribute` 的 value 分支对 INPUT 多一次 tagName 比较 + 一个 expando 写；
组件快速路径反而**少**一次每组件的 `{...props}` 分配与 propTypes 遍历（第二次 coerce 整体跳过）。

用 sibling `benchmark` 重跑 real-browser 基准（基线一轮、修复后两轮，同机对比）：
全部场景差异在轮间噪声内（`create-1000` 2.7 / 2.5 / 2.7ms；`create-5000` 10.5 / 10.2 / 10.1ms；
`axii-update-text-1000-repeat-100` 37.9 / 38.7 / 38.6ms；`axii-dynamic-attr-create-1000`
3.5 / 3.6 / 3.6ms；`axii-create-clear-method-1000-repeat-50` 129.7 / 133.9 / 133.0ms，
与第十轮记录的轮间波动幅度一致）。memory 基准的 afterClear 残留与存档同级
（axii 1000 行 afterClear 残留 5.4KB，与第十轮持平）。
`__tests__/matrix.spec.tsx` 的时间敏感用例全部通过。

运行方式：

```bash
npx vitest run __tests__/fatalBugs12.spec.tsx __tests__/improvements12.spec.tsx --coverage.enabled=false
```
