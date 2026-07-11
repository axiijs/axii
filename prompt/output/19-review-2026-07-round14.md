# 19 深度 review 第十四轮（2026-07，已全部修复）

本轮 review 在前十三轮之后的 `main`（v4.4.3，data0 2.4.0）上进行，再次通读 `src/`
全部源码与 data0 的 computed/atom/effect 契约实现。本轮重点扫描的跨层假设：

- **「父级一次性整段删除区间」与「子树必须自己处理 DOM」两种销毁协议的边界**
  （`forceHandleElement` 的传播链路是否完整、fragment 源的子区间与元素源的子区间
  在整段删除下的本质区别）；
- **destroy 路径上所有会执行用户代码的点**（I43 之后的残留：render 期 computed 的
  onCleanup/onDestroy）；
- **「消费一次」的输入源**（I48 之后的残留：fragment 的内容搬移语义）；
- **同一份 prop 在不同入口下的行为一致性**（`$self:` 经组件包装路径 vs 直达
  ComponentHost 的 classic pragma/automatic runtime 路径；aria-/data- 的 false 在
  静态 setAttribute 路径 vs 响应式 dataset 路径）。

对每个疑点先写运行时复现测试（真实 Chromium）确认；证实的逐项修复，每个测试都先在
未修复代码上确认失败再转为回归测试（本轮 11 个新测试，未修复代码上 8 失败 /
3 为对照通过项）。另有两个疑点复现后被证伪（见文末）。

回归测试：致命问题在 `__tests__/fatalBugs15.spec.tsx`（F52-F53），改进项在
`__tests__/improvements14.spec.tsx`（I50-I54），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F52 | **fragment 源 StaticHost 的整段删除会把 `forceHandleElement` 子树的节点逐个拆散**：fragment 的响应式子区间就是本区间的**顶层**节点（元素源的子区间嵌在根元素内部、不受整段删除影响），而 `destroyReactiveHosts` 一律 `destroy(true)`、随后 `removeNodesBetween` 逐节点删除。reusable 内容挂在 fragment 分支里（`() => cond() ? <>{moved}<b/></> : <>{moved}<i/></>` 是 reusable 的自然用法）时，分支翻转销毁旧 fragment → 内容节点被逐个 detach、兄弟链断裂 → 再次挂载时搬移循环**直接崩溃**（诊断开是 AxiiError，关是原生 TypeError），内容永久丢失。RxListHost 还完全**不透传**行的 forceHandleElement（ComponentHost/FunctionHost/StaticArrayHost 都透传），列表挂在 fragment 里时整个列表的行都会被拆散 | ① fragment 源的 `destroyReactiveHosts` 对声明了 forceHandleElement 的子树改用 `destroy(false)`（自己搬出/自己处理 DOM；子树的自我移除都是连续子区间操作，不会打断剩余节点的兄弟链，随后的 removeNodesBetween 仍安全）；② `StaticHost.forceHandleElement` 从字段改为 getter：detachStyledChildren 之外，fragment 源还要向上传播子区间的声明（元素源维持 false，子区间嵌在根元素内不受影响）；③ RxListHost 补上行 forceHandleElement 的向上传播，与其他容器 host 对齐（`src/StaticHost.ts`、`src/RxListHost.ts`） |
| F53 | **render 期 computed 的用户 cleanup 抛错会中断组件销毁**：`ComponentHost.destroy` 里 frame（render 期收集的 computed 等）的销毁没有走 error 钩子——computed 的 destroy 会执行用户注册的 `onCleanup`/`onDestroy`，抛错会跳过兄弟 computed 的销毁与 `innerHost.destroy`（**旧 DOM 残留、新分支永远渲染不出来**），错误还会沿函数节点重算路径变成 uncaught error。I43 修了 effects/cleanup/refs，renderFailed 分支的 frame 销毁也已包裹（`runWithErrorHook`），唯独正常销毁路径的 frame 漏了——同一类假设的最后一个残留 | 正常销毁路径的 frame 销毁同样走 `runWithErrorHook`，与 renderFailed 分支、destroyCallback 的语义一致（`src/ComponentHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I50 | **缓存 fragment 跨渲染复用是更隐蔽的静默空白**：fragment 的内容节点在第一次渲染时被整体搬进文档，fragment 自身从此变空。I48 的开发期警告只登记「有响应式元数据的元素」，纯静态 fragment（`const cached = <><b>x</b></>` 条件分支间复用）复用时**一定渲染成空白**且无任何报错（纯静态元素的复用反而碰巧可用） | fragment 无条件进入 consumed 登记（不管有没有响应式元数据），再次渲染时给出针对 fragment 的专属警告文案；诊断关闭（生产）时零开销（`src/StaticHost.ts`） |
| I51 | **元素 ref 的 attach 在同步连通路径上没有错误隔离**：flush 队列路径（I43）已逐条隔离，但元素渲染时已连通的同步路径（`setupRefHandles` → `attachRefs`）一个抛错的 ref 会中断同元素的兄弟 ref、StyleManager mount 与后续渲染流程；数组形态的 ref（用户数组、AOP 合并）在两条路径上都是整组中断 | `attachRefs`/`detachRefsWithErrorHook` 逐个 handle（含数组项展开）走 error 钩子，attach/detach/flush 三条路径语义一致（`src/StaticHost.ts`、`src/DOM.ts` 的 RefHandleInfo 类型对齐） |
| I52 | **reusable 挂载区间被外部整体清空后 root.destroy 崩溃**：ReusableHost.destroy 的搬移循环对「区间已脱离 DOM」（`container.innerHTML = ''` 等外部清理）没有容忍——诊断开是 AxiiError、关是 `null.nextSibling` TypeError，中断整棵 root 的销毁。StaticHost 对同类情况有明确的容忍语义（区间已脱离则跳过删除） | 搬移前检查区间起止的 parentNode（失配/脱离即跳过搬移，仅移除 reusePlaceholder），与 StaticHost 的容忍语义对齐；「同父但链断」仍交给 assertRangeReachable 诊断（`src/ComponentHost.ts`） |
| I53 | **`$self:` 直达 ComponentHost 时 merge 语义静默丢失**：`$self:` 在组件 renderContext 的 createElement（separateProps）里被消费，但 classic pragma / automatic runtime 的顶层 JSX（`root.render(<Bound $self:className="x"/>)`）不经过组件包装，`$self:xxx` 原样进入 inputProps → `parseAndMergeProps` 把它解析进 `itemConfig['self']`——而 `'self'` 是保留名**永远不会被应用**：同一份 JSX 挂在组件里和挂在 root 顶层行为分叉 | `parseAndMergeProps` 识别 `$self:` 前缀：普通 key 按 mergeProp 合入自身 props（与包装路径一致），嵌套 `$self:$inner:xxx` 继续作为自身 AOP 配置解析（`src/ComponentHost.ts`） |
| I54 | **aria-/data- 属性的 `false` 被静态路径按「移除」处理**：`aria-expanded`/`aria-checked` 等状态属性**缺席与 "false" 对屏幕阅读器完全不同**（缺席 = 不可展开/不是开关，"false" = 收起/未选中，React 同样字面化渲染）；且响应式 data-（dataset 赋值）本来就产出 `"false"`，静态与响应式行为分叉 | 通用属性分支对 `false` 的 aria-/data- 字面化为 `"false"`（contenteditable 的既有特例并入同一分支）；null/undefined 维持移除语义（条件属性写法）；首字符守卫避免热路径正则（`src/DOM.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| F52 的「整段删除 vs 子树自理」全库排查：StaticHost sync/async 路径（destroyReactiveHosts 共用，已修复）；StaticArrayHost 有 forceHandle 分支 ✓；RxListHost bulk delete 检查 forceHandleElement ✓（行的声明经本轮修复后才真正可见）；`removeAllElementByParent`（replaceChildren）与 bulk 同一守卫 ✓；RxListHost 初始渲染错误回收（`created.destroy(true)`，内容在被丢弃的 fragment 里、兄弟链完整，后续仍可挂载）✓ | fragment 源是唯一缺口，已修复 |
| forceHandleElement 的传播链路盘点：ComponentHost ✓、FunctionHost ✓、StaticArrayHost ✓、ReusableHost（恒 true）✓、StaticHost（本轮补 fragment 传播）、RxListHost（本轮补行传播）、AtomHost/EmptyHost/PrimitiveHost（无子树，正确为 false）✓ | 已闭环 |
| F53 的「destroy 路径执行用户代码」全库排查：ComponentHost 的 layoutEffect 句柄/destroyCallback/refProp ✓（I43）、frame（本轮）；FunctionHost cleanups ✓（F43）；元素 ref detach ✓（I43）；detachStyle 求值抛错在 destroy 同步路径向上抛（round-13 判定为可观测语义，保持）；LightBindingEffect 销毁不含用户回调 ✓ | frame 是最后一个残留，已修复 |
| I50 的「消费一次」输入源盘点：元素 ✓（I48）、fragment（本轮）、Portal 静态内容 ✓（既有 WeakSet）、ComponentNode 复用（其 children 元素被首次渲染消费，I48 的元素警告间接覆盖） | 已闭环 |
| I54 的「false 有字面语义」属性家族排查：contenteditable ✓（既有特例，并入同分支）；draggable/spellcheck/autofocus 走 property 赋值路径（false 语义正确）✓；SVG 属性无 false 有义项；xlink 移除路径不受影响 | 仅 aria-/data- 中招，已修复 |
| I53 的「前缀 key 直达 ComponentHost」同类：`prop:` 前缀 key 在顶层组件 JSX 中会以字面 key 混进组件 props（无功能损失，仅噪音；`prop:` 的语义本就只在「组件重写元素」时存在） | 记录观察，不改 |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O39 | RxListHost 初始行渲染发生在 data0 computed 的 computation 里，若组件 setup 中的裸 atom 读取被列表 computed 追踪，任何此类 atom 变化都会导致整个列表重建/行重复 | **证伪**：patch 型 computed（manualTracking）在 computation 期间 `pauseTracking`，setup 裸读不建立依赖；已用运行时探针确认（atom 翻转后 setup 不重跑、行不重复） |
| O40 | propTypes 的 `defaultValue` 不经过 coerce（`PropTypes.atom().default(() => false)` 会让组件拿到裸 false 而不是 atom） | 默认值由组件作者声明，作者可控（`default(() => atom(false))` 是正确写法）；对默认值强制 coerce 会执行到非幂等 coerce 的同类风险，维持现状 |
| O41 | ComponentHost 二次 destroy 会重复执行 destroyCallback（无幂等守卫） | 正常路径（root.destroy/父级销毁）不会二次 destroy；手动持有 host 又重复调用属于契约外用法，不为其加常驻字段 |
| O42 | 跨函数边界的 detachStyle 子树（`<div>{() => <span detachStyle/>}</div>`）在祖先元素被销毁时不等待离场动画 | 祖先元素整体移除时子孙动画在视觉上本就不可见（节点随祖先一起消失）；同一 JSX 树内的 detachStyle 经元数据提升已有等待语义，维持现状 |

## 性能验证

改动涉及的路径盘点：`StaticHost.forceHandleElement` 由字段改为 getter——读取点只在销毁
决策（列表 bulk delete 候选、父区间销毁、数组 host 销毁分支），不在渲染/属性更新/文本
更新热路径；CompactElementHost（列表行主体）上该 getter 是两次廉价判断（detachStyledChildren
undefined 检查 + 一次 instanceof）。`destroyReactiveHosts` 每个子 host 多一次布尔组合。
`attachRefs`/`detachRefs` 的 try/catch 只在**带 ref 的元素**上出现（V8 无抛出时零成本）。
aria-/data- 的 false 字面化有首字符守卫，正则只在通用分支的 falsy 值上执行。
I50 的 fragment 登记只在诊断开启时执行 WeakSet 操作。每实例内存：StaticHost 少一个
潜在的 forceHandleElement 实例槽位（detach 样式场景），其余无新增字段。

`__tests__/matrix.spec.tsx` 的时间敏感用例全部通过；全量 636 browser tests + 6 node
tests 通过；`npm run build` 产物正常；coverage 徽章数据已按新口径刷新。

## 运行方式

```bash
npx vitest run __tests__/fatalBugs15.spec.tsx __tests__/improvements14.spec.tsx --coverage.enabled=false
```
