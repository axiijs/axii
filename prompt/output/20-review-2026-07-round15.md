# 20 深度 review 第十五轮（2026-07，已全部修复）

本轮 review 在前十四轮之后的 `main`（v4.4.4，data0 2.4.0）上进行，再次通读 `src/`
全部源码，并对照 data0 的 computed/atom/effect/RxList 实现核对跨层假设。本轮重点扫描：

- **框架内「用户回调聚合点」的错误隔离是否闭环**（I43/I51 已经逐个隔离了 ref/cleanup/
  effect/layoutEffect/属性更新/文本更新/flush 队列——事件回调是最后一个没有覆盖的
  聚合点，而事件恰恰是同一个事件名下会聚合多个相互独立来源的地方）；
- **`boundProps`/`bindProps` 的合并链对每一个 prop 是否一致**（round-11 F41 处理了默认值/
  幽灵 undefined，round-9 I37 处理了 ref——`children` 是否是唯一被特殊覆盖而失效的 prop）；
- **stylesheet 路径（字符串拼接 replaceSync）对样式值是否会被 `}` 越界注入全局规则**
  （inline 路径走 CSSOM 由浏览器拒绝非法值，stylesheet 路径直接拼字符串）；
- **静态属性路径 vs 响应式属性路径的产出一致性**（round-14 I54 的 aria-/data- false 之后，
  `data-camelCase` 属性名在 setAttribute 与 dataset 两条路径下是否分叉）。

对每个疑点先写运行时复现测试（真实 Chromium）确认；证实的逐项修复，每个测试都先在
未修复代码上确认失败再转为回归测试（本轮探针覆盖 30+ 组合场景，最终 3 个改进项落地，
各自的回归测试在未修复代码上确认失败）。另有若干疑点复现后判定为设计边界（见文末）。

本轮**未发现新的致命问题**：前十四轮对输入形态角落、跨层假设、销毁/错误恢复生命周期的
排查已经相当彻底，本轮所有「崩溃候选」探针（组件/函数节点返回 Text、atom 持有元素、
RxList fragment 行 splice、reusable 嵌在列表里 reorder、Portal 内 render 抛错冒泡、
事件回调里同步改动同一列表、嵌套 RxList、FunctionHost 结构↔文本反复切换、多 handler
里删除自身元素等）均正确工作或落在既有的错误钩子/dev 警告语义内。

回归测试：改进项在 `__tests__/improvements15.spec.tsx`（I55-I57），编号与下表一致。

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I55 | **事件回调是框架里最后一个没有做「兄弟回调错误隔离」的用户回调聚合点**：`invokeEventEntries` 把同一个事件名下的所有 handler 依次调用，一个 handler 抛错会**静默跳过其余 handler**。而同一个事件名下恰恰会聚合多个**相互独立**的来源：① handler 数组（`onClick={[a, b]}`）；② `onChange` 被别名成 `input` 事件后，与用户显式写的 `onInput` 落到同一个事件名下。这两个 handler 在源码里是完全独立的声明，一个抛错跳过另一个既违反直觉，也和浏览器「每个 `addEventListener` 相互独立」的语义不一致（这是 I43/I51 错误隔离体系里唯一的剩余缺口） | `invokeEventEntries` 逐个 handler try/catch 隔离（数组项展开）：兄弟 handler 一定都执行；首个错误在批次全部执行完后重新抛出，保持「抛错可观测」（与 `flushAttachQueue` 的错误语义一致）；其余错误经 `reportAxiiError` 结构化上报。单个 handler 抛错的行为不变（仍向上抛）。无抛错时（绝大多数）try/catch 在 V8 上零成本，返回值收集逻辑不变（`src/DOM.ts`） |
| I56 | **`children` 是 `boundProps`/`bindProps` 里唯一被静默覆盖而失效的 prop**：`render()` 里 `normalizedProps.children = this.children` **无条件**用构造期捕获的 JSX children 覆盖 props 合并链的结果。`bindProps(Comp, {children: [...]})`（给组件预设内容是自然的 HOC 写法）提供的 children，即使 JSX 使用点没写任何 children，也会被空数组 `[]` 覆盖——bound children 静默丢失、区域渲染成空。round-11 F41（默认值）、round-9 I37（ref）都把「boundProps 提供的值被静默覆盖」当作 bug 修过，`children` 是同一类的最后一个残留 | JSX 使用点提供 children 时仍然优先（覆盖 bound children，语义不变）；使用点没写 children（`this.children` 为空数组）时保留 props 合并链里的 children（可能来自 boundProps）；两者都没有时用 `this.children`（`[]`）兜底，保证组件解构 `children` 不为 undefined（`src/ComponentHost.ts`） |
| I57 | **stylesheet 路径的样式值能用 `}` 越界注入全局 CSS 规则**：嵌套样式/boundProps/keyframes 走 stylesheet 路径，值经 `stringifyStyleObject` 直接字符串拼接进整段规则文本再 `replaceSync`。`style={{'&:hover': {width: evil}}}`、`evil = '100px; } body { background: green } .z {'` 会闭合当前规则、把后面的 `body {...}` 当成新的**全局规则**注入（实测 body 背景被改）。inline 路径（`el.style[k]=v`，走 CSSOM）由浏览器拒绝非法值、绝不会越界，两条路径存在行为分叉——一个值在 inline 样式里安全，在嵌套样式里却能污染全局。虽然通常样式值可信，但这是一个真实的越界面（哪怕只是一个含 `}` 的畸形值也会破坏规则结构） | `createStyleSheet` 由「把所有规则 `join('\n')` 成一个字符串 `replaceSync`」改为**逐条 `insertRule`**：`insertRule` 只接受单条规则，「一个字符串里多条规则」（注入企图产生的形态）被浏览器判为语法错误整条拒绝，注入无法越界成全局样式。`generateStyleContent` 早已把内容拆成「每个元素恰好一条规则 / 一个 @-rule 块」，逐条插入与之前 `join` 语义一致；合法的带引号值（`content: "a}b{c"`，引号内的 `}` 不闭合规则）照常保留；被拒绝的规则跳过而非让整个 stylesheet 崩溃，开发期给出可见提示（`src/StaticHost.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| I55 的「用户回调聚合点错误隔离」全库排查：ComponentHost 的 effect/layoutEffect/cleanup/ref（`runWithErrorHook`，I43）✓、FunctionHost cleanups（F43）✓、StaticHost 的 attachRefs/detachRefs（I43/I51）✓、属性更新/文本更新（`ReactiveAttributeEffect`/`AtomHost`，O1）✓、`flushAttachQueue`（I43）✓、`root.dispatch` 监听器（I43）✓、RxList patch（O1）✓——`invokeEventEntries`（事件回调）是唯一漏网的聚合点 | 已修复（I55） |
| I56 的「boundProps 提供的值被静默覆盖」全库排查：默认值/幽灵 undefined（F41）✓、ref（I37）✓、普通 prop（`parseAndMergeProps` 的 mergeProp）✓——`children` 是 render 里唯一被无条件覆盖的 prop | 已修复（I56） |
| I57 的「样式值字符串拼接进 stylesheet」全库排查：`createStyleSheet`（本轮改 insertRule）是唯一把整段规则文本喂给 `replaceSync` 的地方；inline 路径（`setAttribute` 的 `el.style[k]=v` / `setProperty`）走 CSSOM 天然安全；`data-axii-style-itor-num` 等调试属性是常量字符串 | 已修复（I57） |

## 复现后判定为设计边界 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O44 | **`data-camelCase` 属性名静态路径与响应式路径分叉**：`data-fooBar`（静态）→ `setAttribute` 后浏览器小写化为 `data-foobar`；`data-fooBar={atom}`（响应式）→ 走 `el.dataset[camelize('fooBar')]` 产出 `data-foo-bar`——同一个书写在两条路径下产出不同的属性名 | **设计边界（低优先级）**：仅在 `data-` 属性用 **camelCase** 书写（本就不规范）时出现，规范的 kebab-case（`data-foo-bar`）两条路径产出一致。深入求证后确认**无法干净统一**：两条路径存在**两个方向相反**的分叉——① 属性名：静态（小写，与 React 的 setAttribute 透传一致）更「对」，响应式（dataset camel↔kebab）分叉；② 数组值：`data-arr={[1,2,3]}` 响应式经 dataset 字符串化成 `"1,2,3"`（与 React 一致），静态经 setAttribute 的数组覆盖语义取 `.at(-1)`=`"3"` 分叉。让响应式改走 setAttribute 会破坏已被测试固定的数组逗号拼接（`staticHost.spec.tsx`「update array attribute」）与 dataset 的 nullish delete（I17）；让静态改走 dataset 又会破坏 React 兼容的属性名透传。任一方向都是「修一个分叉、制造另一个」。建议文档层面要求 data- 属性统一用 kebab-case（此时两条路径完全一致） |
| O45 | 事件 handler 在事件分发中同步 remove 自身元素后，同一 proxy 的后续 handler 仍执行 | 正确行为：DOM 事件分发已经进行，proxy 内的多个 handler 在同一 JS 栈里执行，remove 只影响后续的 DOM 状态、不影响已排定的 handler 调用——与浏览器语义一致，无需处理 |

## 性能验证

- I55：`invokeEventEntries` 从 `listener.map(l => l(e, ...args))` 改为逐个 try/catch 的显式循环，
  **无新增闭包分配**（原 map 的箭头函数被显式 for 循环替代），try/catch 在 V8 上无抛出时
  零成本；返回值收集分支完全不变。事件分发不在渲染/属性/文本/patch 热路径上。
- I56：`render()` 里多一次 `this.children.length`（有 children 时）或 `normalizedProps.children === undefined`
  的廉价判断，绝大多数组件（JSX children 或无 children）行为与分支走向不变，无新增分配。
- I57：`createStyleSheet` 只在**首次创建 / 滚动重建 stylesheet** 时执行（不在属性/文本/patch
  热路径上），逐条 `insertRule` 与原来一次性 `replaceSync` 的总解析工作量相当；样式挂载后的
  更新仍走各自的 inline/rolling-class 路径，不受影响。

`__tests__/matrix.spec.tsx` 的时间敏感用例全部通过；全量 browser tests + node tests 通过；
`npm run build` 产物正常。
