# hydration 自顶向下认领 — 设计（#55）

- 状态：设计稿，待审阅。本文只定方案，不含实现。
- 关联：#55（本设计）、#54（实验性标注与低成本缓解，PR #62 已合入）；相邻但不归本设计：#50（`dangerouslySetInnerHTML` 的 `{__html}` 形式，已合入）、#52（复选框 value / checked，已合入）、#56（table 隐含 tbody、`<svg>` 内的同名标签、`<textarea>` / `<title>` 的函数子节点）。
- 上位文档：[`ssr-support.md`](./ssr-support.md)。本文改变的是它的 §3.1「客户端」一段与 §3.7 的修复粒度；§3.2 的服务端标记契约**不变**。
- 基线：origin/main `9d2a93c`（含 #62 / #63 / #64，以及 #65 / #66 合入的 #50、#52）。现状复现与原型在 `4712285` 上完成；#50 / #52 只改了原始标记的取值和复选框的勾选通道，不影响 §1 的失败机制，二者对本设计的接口见 §2.6.1、§2.6.2。

---

## 0. 摘要

**问题。** 现在激活期间的 `createElement` 一被调用就去认领服务端节点。JSX 先求值参数、后调用父元素的 `createElement`，所以认领发生在父元素认领之前，没有父游标，只能在整个激活根里按「子先于父」的顺序搜索同标签元素（#54）。组件、函数子节点、列表行的内容由 Host 在父级 JSX 求值**之后**才渲染，父级排在后面的同标签元素会先拿走它们的节点。函数子节点的锚点也要在内容渲染之前向前搜索 `computed node + axii:0` 来找。11 条 `test.fails` 都出自这两点，或者出自没有位置信息就无法判断的失配。

**方案（维护者已定的方向）。** 激活期间 `createElement` 不碰 DOM，返回一个**延迟描述** `HydrationElement`。各 Host 按文档顺序、自顶向下逐个消费自己的服务端节点：
1. 每个 DOM 父节点上有一个节点指针游标；
2. Host 先消费自己的内容，**再**在游标处认领自己的 placeholder；
3. 父级永远不搜索、不向前看，子级的区域在哪里结束由子级自己决定。

激活因此成了 `ssr.ts` `serialize` 的逆过程：服务端按什么顺序写出节点，客户端就按什么顺序读回。

**结论（有原型数据，见 §10）：**
- 不需要给服务端新增起点标记，现有的末尾标记已经足够。现有的服务端 HTML 原样兼容，服务端和客户端不需要同步发版。
- 不再有组件区域的判断问题。F1b、F1f–F1h、F1j、F3a、F3b 按构造就是对的。
- 每个服务端节点只访问一次，激活是线性的。
- 失配由「游标处期望什么、实际是什么」的局部规则处理。在「位置对齐」的不变量之下，任何重同步选择得到的 DOM 都等于 CSR 结果，选择只影响能复用多少节点（§4.1）。F4a–F4d 因此可以报告并修复，现有失配用例的节点复用断言也全部保留。

**代价（契约变化）。** 激活期间 JSX 的返回值不是 DOM 节点：
- 在组件函数体里拿 JSX 结果当节点用（调方法、写属性、测量）会失败，迁移方式是改用 `ref`。
- `RxList.map` 与普通数组里的行在激活期间是描述，由 Host 认领后**写回**为真实节点，激活完成后与 CSR 一致。
- 开发期用 Proxy 报告误用；生产环境下，调用方法会抛 TypeError，在严格模式下写属性也会抛 TypeError。

**零开销。** 非激活的 `createElement` 只剩函数开头一次布尔读，比现在少：组件分支的那次读取和循环里约 10 处 `hydrating &&` 都去掉了。
- `createHost`、`RxListHost.createChildHost`、`AtomHost`、`StaticHost` 等的 CSR 路径去掉现有的 `isHydrating()` 读取。
- Host 不新增字段，还去掉了现在挂在 Host、数组、`RxList`、`DocumentFragment` 上的激活用临时字段。
- 原型测量（同页 A/B，带 A/A 对照）的差异在 A/A 噪声与计时分辨率以内（§5.3）。

**实现拆分：**
- **PR-A：** 把激活路径与 CSR 路径分开，不改行为。
- **PR-B：** 切换到延迟描述与自顶向下认领。切换是原子的，11 条 `test.fails` 全部转为 `test`。
- **PR-C：** 加入漂移 fuzz，并去掉「实验性」标注。

---

## 1. 现状：失败机制（实测）

### 1.1 结构性根因

1. **求值顺序与认领顺序相反。** 以 `<div><Comp/><main><p/></main></div>` 为例：
   - `createElement('p')`、`createElement('main')`、`createElement('div')` 依次发生，都在 App 的 JSX 求值期间；
   - `Comp` 的 `<p>` 要等 `div` 的 `StaticHost.render` 渲染内层 Host 时才创建；
   - App 的 `<p>` 认领时没有父游标，按后序取第一个未认领的 `<p>`，拿到的正是 `Comp` 的那个。

   服务端只在组件、函数子节点内容的**末尾**写标记（`<!--unhandledChild-->`、`<!--computed node-->`），没有起点标记。所以父级在不渲染子级的情况下无法知道子级区域从哪里开始（#54 交接要点 1）。
2. **锚点先于内容认领。** 函数子节点（Text-ph）的 placeholder 由父元素的 `createElement` 在函数求值**之前**认领：`claimFunctionTextPlaceholder` 向前搜索第一个 `computed node + axii:0`。同一层有多个函数子节点，或者函数套函数时，就会拿到别人的锚点。
3. **没有位置信息就无法修复。** 失配时不知道「这个位置本该是什么」，只能抛错或者什么都不做。

### 1.2 逐条复现（`4712285`，真实 chromium）

服务端 HTML 是 `renderToString` 的输出，表中省略了尾部的 `<!--root-->`。

| 用例 | 写法 | 当前结果 | 机制 |
|---|---|---|---|
| F1b | `<div><Header/><main><p>hello</p></main></div>`，Header 渲染 `<header><nav><p>deep</p></nav></header>` | `main` 被清空；4 条报告 | App 的 `<p>` 在 App 的 JSX 求值期间认领，后序里第一个 `<p>` 是 Header 的 `deep`（文本漂移，被替换）；Header 渲染时它的 `<p>` 已被占用 |
| F1f | `<div><Comp/><main><p>x</p></main></div>`，Comp 渲染 `<p>c</p>` | `<p>x</p><p></p><!--unhandledChild--><main></main>`；2 条报告 | 同上；`Comp` 的 `<p>` 随后认领了 main 里的 `<p>`，`StaticHost.render` 的 `insertBefore` 把它**挪出了 main** |
| F1g | `<div>{() => <p>f</p>}<main><p>x</p></main></div>` | 同 F1f 形态；2 条报告 | 同上，函数子节点 |
| F1h | `<div><Comp/><main><div>x</div></main></div>`，Comp 渲染 `<header><div>logo</div></header>` | 抛错 `<!--unhandledChild--> not found from cursor` | App 的 `<div>x</div>` 拿走 Comp 的 `<div>`，之后 Comp 的 `<header>` 与游标对不上 |
| F1j | `<section><div dangerouslySetInnerHTML="<div><b>raw</b></div>"/><b>sibling</b></section>` | 原始元素连同标记被删除；3 条报告 | 原始元素认领**自己**时，后序里第一个 `<div>` 是它标记里的那个；登记「不往里找」发生在认领之后 |
| F3a | `<h1>{() => title()}{() => <b>badge</b>}</h1>` | 抛错 `expected text unit` | 第一个函数（文本态）向前搜索锚点，拿到了第二个函数的 `computed node + axii:0` |
| F3b | `<div>{() => <>{() => <b>x</b>}</>}</div>` | 静默：`fragment start, computed, b, computed` | 外层函数向前搜索时拿到**内层**函数的锚点；内层随后拿到外层的；`<b>` 被 `insertBefore` 挪到错误的位置 |
| F4a | 服务端 2 行、客户端 3 行 | 静默：第 3 行缺失 | 第 3 行 `<li>` 认领时没有游标、没有候选，返回脱离文档的延迟桩，CompactElementHost 不插入它 |
| F4b | 服务端 3 行、客户端 2 行 | 静默：多余的 `<li>3</li>` 留在 DOM 里 | 列表的 placeholder 由 `ul` 的 `createElement` 向前搜索 `<!--unhandledChild-->` 认领，跳过了 `<li>3</li>`；行认领结束后没有检查「最后一行与 placeholder 之间」还剩什么，尾部清理只看 placeholder 之后 |
| F4c | 服务端是元素、客户端是文本：`{() => el ? <b/> : 'text'}` | 静默：`<b>`、`computed node` 留下，文本插在 `axii:0` 处 | 文本态函数向前搜索时把 FTS 尾部的 `axii:0` 当成自己的锚点 |
| F4d | 服务端是文本、客户端是元素 | 抛错 `expected <!--computed node--> before FunctionHost placeholder` | 结构态找不到 `computed node`；没有局部修复路径 |

附带确认的同类写法（不在 `test.fails` 里，新模型一并解决）：
- Fragment 行里含组件、后面跟静态 `<p>`：抛错 `no unmatched <p>`，`<p>after</p>` 被挪进行内。
- 组件包组件、函数返回组件，后面跟同标签元素：内容错位。

### 1.3 #54 交接要点复核

| 要点 | 复核结论 |
|---|---|
| 服务端对组件 / 函数子节点只写末尾标记；立即求值的 RxList 行末尾也是 `<!--unhandledChild-->` | 属实。在新模型里这不再是问题：父级不需要知道子级从哪里开始，子级从游标处开始消费即可（§2.4）。原型证明只靠末尾标记就能完整读回（§10） |
| 后序第一个合格候选是正确的基础，只要能跳过还没渲染的 Host 区域 | 在静态树内成立。新模型不再搜索：文档顺序的消费就是逐个按位置认领，不存在「跳过」的问题 |
| 原始标记没有任何服务端标记，F1j 只能靠按位置认领 | 属实。新模型先按位置认领原始元素本身，再把它的内容整体视为不透明，F1j 按构造就是对的 |
| 无游标认领从根遍历，整体二次复杂度；自顶向下可以线性 | 属实。原型中每个服务端节点恰好访问 1 次（2400 行列表：9603 个节点、9603 步） |
| F1i 生成器可以扩展成验收 fuzz | 属实。原型生成器去掉了对组件、函数子节点、Fragment、含自身标签的原始标记的排除，300 棵全部通过（§10）；PR-B / PR-C 直接采用 |

---

## 2. 新的认领模型

### 2.1 总体：激活是 `serialize` 的逆过程

`ssr.ts` 已经是自顶向下的：
- `createSsrElement` 返回描述（`SsrElement`），`serialize` 按文档顺序递归；
- 遇到组件就调用组件，遇到函数子节点就求值，遇到列表就逐行写，每个 Host 的末尾标记在自己的内容之后写出。

激活采用**完全相同的遍历**：
- 客户端用激活期间的 `createElement` 得到描述树；
- Host 在自己的位置被渲染时，从游标处逐个读回服务端节点。

两边共用的只有一条规则：每个 child 单元对应的节点形态，由 `createElement` 的 child 规则和 `createHost` 的分派决定（§3.2.0–§3.2.6 的契约，原样保留）。

### 2.2 延迟描述 `HydrationElement`

```ts
// 唯一定义处：src/hydration.ts（或拆出的 src/hydrationElement.ts）
export class HydrationElement {
    tag: string | typeof Fragment     // 不叫 type：Fragment 是函数，叫 type 会被 createHost 的
                                      //  ComponentNode 判定（typeof source.type === 'function'）误认
    props: AttributesArg | null       // rawProps，原样（as / AOP 已由 ComponentHost 处理完）
    children: any[]                   // rawChildren，原样；嵌套的描述、atom、函数、组件、RxList……
    isSVG: boolean                    // 与 CSR 同一规则：_isSVG ?? svgOnlyElementNames.has(tag)
    node: Element | DocumentFragment | null       // 认领或新建后的真实节点
    listenerBoundArgs: any[] | undefined          // ComponentHost 写入，认领时转交给 node
}
export function isHydrationElement(v: unknown): v is HydrationElement   // 判定只在这里定义
```

- **何时产生：** 激活期间（`isHydrating()`），对字符串标签与 `Fragment` 调用 `createElement` 和 `createSVGElement` 时。组件仍然返回 `ComponentNode`，不变。
- **不碰 DOM：** 不创建元素，不认领，不应用 props，不提升元数据。`unhandledChildren`、`unhandledAttr`、`refHandles`、`detachStyledChildren` 都由消费它的 Host 在认领时按 CSR 的同一规则建立（§2.4）。
- **字段预置：** 全部字段在构造器里预置，然后 `Object.preventExtensions`。这样形状单态，用户写入未知属性在严格模式下抛错（§3.4）。只在激活路径上分配。
- **消费后瘦身：** 被认领或新建后，`props` 和 `children` 置为 `undefined`，只保留 `node`。仍被引用的描述只是一个小壳（§3.3、§5.2）。
- **事后渲染：** 激活结束后，CSR 路径还可能遇到描述（例如在激活期间存下的 JSX，之后由函数子节点再次渲染）。`createHost` 在分派链**末尾**（所有常见类型之后、`assert(false)` 之前）判定描述：
  - 已有 `node` 就当作那个元素，与 CSR 重复渲染同一个元素对象的语义相同，元数据已被消费；
  - 否则按 CSR 物化（重放 `createElement`）。

### 2.3 游标

- **结构：** 每个 DOM 父节点一个游标 `{parent, next}`，`next` 是下一个未消费的服务端子节点。用节点指针，不用下标，这样在游标前插入或删除节点时游标不会漂移，现有代码里的下标修正都不再需要。
- **栈：** 进入一个被认领的元素时压栈，离开时检查剩余节点（§4.2 R5）再弹栈。Portal 容器推入一个新的游标栈（取代 `pushHydrateRoot`）。
- **三种操作：**
  - *消费*：`next = next.nextSibling`；
  - *新建插入*：`parent.insertBefore(fresh, next)`，`next` 不动；
  - *删除*：先记下 `next.nextSibling`，再 `remove()`。
- **根容器：** 游标从 `container.firstChild` 开始；容器层的 `STYLE` / `SCRIPT` / `LINK` 跳过，留给 `migrateSsrStyleTags` 和之后的容器清扫，与现状相同。

### 2.4 Host 的认领协议：先内容，后 placeholder

CSR 里 placeholder 由父级先建好，再交给子 Host；服务端输出里 placeholder 却在子 Host 内容的**后面**。新协议把 placeholder 的认领交给子 Host 自己，在它消费完内容之后进行：

```ts
interface Host {
    render(): void                 // CSR，不变，且不再含任何激活分支
    hydrate(slot: Slot): void      // 新增的原型方法：从当前游标消费 [内容…, placeholder]，
                                   //  认领后写入 this.placeholder / this.element
}
// slot = placeholder 的种类，按种类共享的常量，不分配：
//  TEXT_SLOT（Text-ph） | 'unhandledChild' | 'rx list item' | 'array item' | 'computed node'
//  | 'reusable' | 'root'
```

- **谁创建 Host：** 激活期间由 `createHydrateHost(source, slot, context)` 创建，它是只在激活路径使用的分派函数，类型判定顺序与 `createHost` 相同。构造时传入的 placeholder 就是 slot 常量，它不是 DOM 节点：在认领之前误用 placeholder 会立刻 TypeError，问题不会被静默放过。CSR 的 `createHost` 保留 `placeholder instanceof Comment | Text` 断言，不受影响。
- **组件边界：** `ComponentHost.hydrate(slot)` 调用组件函数，用 `createHydrateHost(node, slot)` 创建 `innerHost`，然后 `innerHost.hydrate(slot)`。完成后 `this.placeholder = innerHost.placeholder`。组件与它的 innerHost 共享 placeholder，这是现有语义，组件嵌套组件也一样，所以不新增标记。
- **父级只做一件事：** 对每个动态 child，按 child 的种类选 slot，创建 Host，调用 `hydrate(slot)`。返回时游标已经在该 child 区域之后。父级从不搜索 placeholder。
- **effect 型 Host：** `FunctionHost`、`RxListHost` 第一次运行发生在 `hydrate()` 里：
  - `FunctionHost` 的 effect 回调在首次运行时读一次 `isHydrating()` 来分流，放在 `if (this.textNode)` 文本更新快速返回**之后**，文本更新热路径上没有新增检查；
  - `RxListHost` 的 computed 首次运行只建立追踪，与现在的 `hydrateSkipInitial` 相同。

### 2.5 各种单元的消费规则（与 `createElement` 的 child 规则和 `createHost` 的分派一一对应）

这张表也是原型 walker 的实现依据（§10）。「认领 X」指游标处必须是 X，否则进入 §4.2 的失配规则。

**元素描述的子节点**（≡ `DOM.ts` `createElement` 的 child 循环；Fragment 的子节点用同一规则，只是没有单 child 文本快速路径）：

| child | 消费 |
|---|---|
| `null` / `undefined` | 无 |
| 唯一的字符串 / 数字 / bigint（ElementChildText 单 child） | 非空：认领文本单元（`axii:t` 包边或裸 Text）；空：无 |
| 多 child 中的字符串 / 数字 / bigint | 非空：认领文本单元；空：认领 `axii:0`，插入 `Text('')` |
| 元素描述 | 认领元素（§2.6.1），递归其子节点 |
| Fragment 描述 | 在同一层展开，没有 `fragment start` |
| atom | AtomHost，`TEXT_SLOT` |
| 函数 | FunctionHost，`TEXT_SLOT` |
| boolean、数组、RxList、ComponentNode、ReusableHost | 对应的 Host，`'unhandledChild'` |
| 现成的 DOM 节点（激活之外创建） | §2.6.8 |

**Host 区域**（`hydrate(slot)`；`slot` 是 Comment 种类时最后都要认领该 Comment）：

| Host / source | 区域 |
|---|---|
| AtomHost，`TEXT_SLOT` | 文本单元（空：`axii:0`）；这个 Text 同时是 element 和 placeholder |
| AtomHost，Comment slot | 非空时认领文本单元，然后认领 slot（Comment-ph；空单元只有 slot） |
| FunctionHost | 求值。文本态：同 AtomHost。结构态：`createHydrateHost(值, 'computed node').hydrate()`；然后 `TEXT_SLOT` 认领 `axii:0`，插入 `Text('')`（FTS），Comment slot 认领 slot（FCS） |
| StaticHost（元素描述） | 认领元素，递归，然后认领 slot |
| StaticHost（Fragment 描述） | 认领 `fragment start`，在同一层消费子节点，然后认领 slot |
| PrimitiveHost | 非空时认领文本单元，然后认领 slot |
| EmptyHost | 认领 `empty`，然后认领 slot |
| StaticArrayHost | 逐项：字符串 / 数字 / bigint 按 DirectNodes 认领文本单元（空：`axii:0`）；其余 `createHydrateHost(项, 'array item')`。然后认领 slot |
| RxListHost | 逐行：按 Compact 判定（§2.6.4）直接认领元素，否则 `createHydrateHost(行, 'rx list item')`；嵌套 RxList 消费内层各行后认领 `rx list item`。然后认领 slot |
| ComponentHost | 调用组件；`createHydrateHost(结果, 同一个 slot)` |
| ReusableHost | innerHost 以 `'reusable'` 认领，然后认领外层 slot |
| 根 | `createHydrateHost(source, 'root')`；结束时游标必须到达容器末尾（之后的 `STYLE` / `SCRIPT` / `LINK` 交给迁移和清扫） |

### 2.6 特殊形态

#### 2.6.1 认领元素时做的事

现在分散在 `createElement` 激活分支里的元素级处理，原样移到「认领元素」这一步：
1. 比较标签（SVG 按原始大小写，HTML 按大写，同 `tryClaimElement` 的 CAUTION），并按 R1 处理 id；
2. 处理 `data-axii-ssr` 样式类，记下滚动样式基名（现 `createElement` 激活分支里读 `SSR_STYLE_CLASSES_ATTRIBUTE` 的那一段）；
3. 有 `value` prop 的 `<textarea>`：清空子文本（现 `createElement` 激活分支里 `type === 'textarea'` 的那一段）；
4. table 的隐含 tbody：游标下沉到 tbody；
5. 递归消费子节点；
6. **子节点之后**再应用 props。这与 `createElement` 的「props 在 children 之后」一致，select / option 的语义需要这个顺序：
   - `select multiple` 的预应用照旧跳过；
   - 已认领元素上的 `dangerouslySetInnerHTML` 不重新赋值；
   - 静态 props 照旧经 `setAttribute` 写一遍，与现状相同；
   - 响应式属性、ref、`detachStyle` 按 CSR 的路径规则记入所属 StaticHost 的收集表；
7. 把 `listenerBoundArgs` 从描述转交给元素，然后写 `desc.node`。

元数据的路径（`path`）与 CSR `createElement` 提升时的规则相同，样式 id 依赖这些路径，必须逐位一致。PR-B 把路径的拼接规则收成一个函数，CSR 与激活共用。

「应用 props」同样只有一份：PR-A 把 `createElement` 里「props 在 children 之后、`value` / `checked` 延后」的那段抽成函数，CSR 与认领步骤共用。这样下面两处已合入的规则在激活路径上自动一致，不另写一遍：
- #52：元素同时带 `value` 与 `checked` 时记下 `__axiiInputHasCheckedProp__`；
- #50：`dangerouslySetInnerHTML` 经 `innerHTMLOf` 解包，`{__html}` 形式走静态路径。

#### 2.6.2 原始标记（`dangerouslySetInnerHTML`）

元素本身按位置认领，内容整体视为不透明：不进入、不清扫、不参与任何认领。F1j 按构造解决。`rawContentParents` 删除。

「内容是原始标记」的判定沿用 #50 合入后的唯一写法：`innerHTMLOf(props.dangerouslySetInnerHTML) != null`（`markupNames.ts`；`{__html: null}` 与 `null` 一样不是原始标记）。本设计只依赖这个判定，不依赖 `{__html}` 的解包细节。

#### 2.6.3 Fragment

- 作为元素 child：在同一层展开。
- 作为 Host 的 source（组件根、函数结构态、列表行）：认领 `fragment start`，在同一层消费子节点，然后认领 slot。
- 下列为了「Fragment 子节点先于游标创建」而存在的补救全部删除：`reconcileFragmentHydrateChildren`、`reconcileFlattenedFragmentHydrateChildren`、`stripAxiiTextBoundariesBetween`、`__axiiFragmentHydrateChildren`、`rematerializeDeferredFragmentChildren`，以及按 path 回填 `unhandledChildren` 的逻辑。
- F3b 和 N2 的各种形态由同一个顺序覆盖。

#### 2.6.4 RxList 行与 Compact 判定

`list.map(i => <li/>)` 在组件函数体里立即求值，行是描述。

**Compact 判定定义在一处：** 行是元素描述（不是 Fragment），并且它的**静态子树**（不进入 Host child）里没有任何 `detachStyle`。这等价于 CSR 里 `createElement` 提升后 `detachStyledChildren` 为空。

**服务端必须共用这个判定。** 现在 `ssr.ts` `serializeRxListRow` 只看行元素自己的 `detachStyle`。后代元素带 `detachStyle` 时，服务端少写一个 `<!--rx list item-->`，CSR 和服务端已经不一致（§11，范围外，已复现）。

认领后行的写回见 §3.3。

#### 2.6.5 Portal

`Portal` / `createPortal` 的 content 是描述或组件，在主树里不会被认领，所以天然是延迟的。`Portal` 在自己的位置为容器推入新的游标栈，`hydrate(content, 'root')`，然后弹栈。

为「content 已在主树被提前认领」而存在的整套机制全部删除：
- `AXII_HYDRATE_DEFERRED` / `AXII_HYDRATE_RECLAIM`
- `createHydrateDeferredElement`、`markHydrateReclaimPayload`、`ensureHydrateDeferredPortalContent`、`materializeHydrateDeferred`、`shouldMarkHydrateReclaim`
- `candidateFitsChildren`、`hasPortalDeferContent`、`isComponentNodeOnlyChildren`、`isPortalOnlyComponentChildren`

`ssrHydrate.lifecycle.spec.tsx` 的 k15–k19 系列是黑盒行为（「不得认领主树的同标签兄弟」），在新模型下按构造成立，继续保留。

#### 2.6.6 RCDATA / RAWTEXT 父节点（`<textarea>`、`<title>`、`<style>`、`<script>`…）

父节点是字符数据父节点时，子游标进入「字符数据模式」：
- 各文本单元依次从同一个 Text 上 `splitText` 切出自己的前缀；
- 空单元插入 `Text('')`；
- 不认领任何 `axii:*`。

这就是现在 `isCharacterDataParent` 的逻辑，只是挪到游标上。函数子节点在文本态时就是一个文本单元；结构态服务端会抛错（§3.2.1 R3），不变。#56 若要支持 `<textarea>` / `<title>` 的函数子节点，只需在 SSR 侧按文本态求值，激活侧不用再改。

#### 2.6.7 table、SVG

- **table：** `impliedTableBody` 的两头判定照旧（客户端 children 里没有显式分区元素，且 DOM 里 table 唯一的子节点是 TBODY），只是客户端一侧改为看描述的 `tag`。组件返回 `<tbody>` 的情况（#56）不受影响：这时 table 下还有 `<!--unhandledChild-->`，不满足「唯一子节点」。
- **SVG：** 描述的 `isSVG` 与 CSR 同一规则，认领比较标签与命名空间。#56 里 `<svg>` 内 `<title>` / `<a>` / `<style>` / `<script>` 的命名空间若与解析器不同，新模型会在认领处看到标签或命名空间不符，按 R1 报告并新建，得到与 CSR 相同的 DOM。是否让 CSR 跟随解析器的命名空间规则，由 #56 决定。

#### 2.6.8 现成的 DOM 节点作为 child

激活之外创建的节点也可能出现在 child 里，例如：
- `runOutsideHydration` 里创建的节点；
- 在 `hydrateRoot` 之前、在浏览器端由模块代码创建的节点。

服务端在 Node 里没有 DOM，不可能产出它们，所以它们是**仅客户端**的内容。规则如下：
- 按 CSR 语义在游标处插入；
- 游标处若是同标签的未认领元素，就把它当作服务端的对应物删除；
- 其余剩余节点按 R5 清扫。

诊断开启时报告一条提示（`AXII_HYDRATION_LIVE_NODE`）：这个位置的服务端节点没有被复用。

#### 2.6.9 `reusable()`、`lazy`、Context

- **`reusable(x)`：** 在组件函数体里调用，构造时用 CSR 的 `createHost` 创建 innerHost。x 是描述时，命中 `createHost` 末尾的描述分支；激活期间不物化，留给 `ReusableHost.hydrate` 消费。
- **`lazy`：** 服务端写 fallback，客户端按 fallback 激活，之后按 CSR 替换，不变。
- **Context：** 随组件调用传递，不变。

### 2.7 服务端标记：不新增

原型证明：只用现有的末尾标记，客户端驱动的自顶向下消费就能把服务端输出**逐个、恰好一次**地读回（§10）。

**这件事成立的原因：**
- 父级从不需要知道子级区域从哪里开始。子级从游标处开始，消费到自己的 placeholder 为止。
- 末尾标记的歧义（嵌套内容里也有同名标记）只在「父级向前搜索」时才存在，新模型里没有向前搜索。

**兼容性：**
- 服务端格式不变：任何版本 `renderToString` 的输出都能被新客户端激活；新旧客户端也都能激活同一份 HTML。
- 服务端和客户端不需要同步发版。回退客户端（§9）也不涉及服务端。

**否决的备选：**

| 备选 | 否决理由 |
|---|---|
| 服务端为每个 Host 区域补起点 / 终点标记（`<!--[-->…<!--]-->`），父级按括号匹配跳过子区域 | 原型证明不需要。代价是每个动态 child 多 2 个注释，HTML 变大；激活时每个动态 child 多 2 次删除；服务端格式变化，要求服务端和客户端同步发版，旧 HTML 需要兼容分支 |
| 按元素写激活键（`data-hk`），保持「JSX 返回真实节点」 | 与维护者已定的方向不同；`ssr-support.md` §3.2 已否决 `data-hk`。还要求服务端和客户端的 `createElement` 计数在条件渲染、helper 调用下严格同步，并且要在激活时删掉每个元素上的这个属性 |
| 激活时先在脱离文档的树上 CSR 渲染，再与服务端 DOM 对齐 | 绑定都指向新建节点，无法复用服务端节点；违反「正确匹配路径禁止重建」 |

### 2.8 删除的启发式

全部只为「先于父元素认领」或「向前搜索锚点」而存在，在新模型下删除：

| 类别 | 删除的代码 |
|---|---|
| 后序全根搜索 | `tryClaimElement` 的无游标分支（`walk` / `walkChildren`、`blockedExact`、`wrongIdMiss`）、`isClaimBlockingSibling`、`hasSameTagWrongIdEarlierSibling`、`removeEarlierSameTagWrongIdSiblings`、`hasConflictingUnclaimedSibling`、`claimedElements` |
| 「这段内容属于谁」的推断 | `ownedTexts`（Comment-ph 在游标处认领自己的文本，不再看 `previousSibling`）、`rawContentParents`、`hasHostStructureAfterCursor`（D10 防护：父元素结束时子 Host 都已消费完） |
| 向前搜索锚点 | `claimFunctionTextPlaceholder`、`advanceCursorUntilComment`、`advanceCursorUntilRxListHostPlaceholder`、`claimComputedNodeBefore`、`claimFragmentStartBefore`、`claimEmptyHostComment(Before)`、`claimTextBeforeCommentPlaceholder` |
| Portal 提前认领与回收 | §2.6.5 列出的整套机制 |
| 挂在对象上的临时字段 | `__axiiHydrateListParent` / `__axiiHydrateListStart`（RxList）、`__axiiHydrateDirectNodes` / `__axiiHydrateItemHosts`（数组）、`__axiiFragmentHydrateChildren`（DocumentFragment）、`__axiiHydrated` / `__axiiHydrating`（Host） |

保留并移到游标上的：
- 文本单元认领（`axii:t` / 裸 Text / `axii:0`）与值漂移替换；
- 字符数据父节点的 `splitText`；
- 隐含 tbody；
- 样式类回收；
- 游标处的元素 D 系列规则（R1）；
- 尾部孤儿清扫（R5）、容器清扫；
- `runOutsideHydration`。

### 2.9 副作用顺序

- **CSR 的顺序：** `createElement` 全部完成后，`StaticHost.render` 依次执行：
  1. 构造子 Host；
  2. 绑定整棵静态子树的响应式属性；
  3. 收集 ref；
  4. 按文档顺序渲染子 Host（子组件的函数体与 `useEffect` 在这里同步执行）。
- **激活的顺序：** 子 Host 必须在父级继续消费之前完成消费，否则后面的兄弟找不到位置。因此按文档顺序交错进行：一个元素的子节点（包括其中子 Host 的激活）先于它自己的 props 和响应式属性绑定。
- **差异：** 只在「祖先元素的响应式属性绑定」与「后代子 Host 的渲染」之间的先后。
  - 服务端已经把响应式属性的当前值写进了 HTML（X3），所以子组件的 `useEffect` 在 DOM 上读到的值与 CSR 相同。
  - 能观察到的只有 effect 的创建先后，最终 DOM 与更新结果不受影响。
- **不变：** ref 的挂载、`useLayoutEffect` 的 attach 时机，以及 `useEffect` 在激活上下文之外执行，都不变（`ssrHydrate.lifecycle.spec.tsx` 覆盖）。select / option 的「props 在 children 之后」不变。

---

## 3. 受影响的契约与迁移

### 3.1 契约变化（对使用者）

| # | 写法 | 新模型下 | 迁移 |
|---|---|---|---|
| C1 | 组件函数体里持有 JSX 结果并调用 DOM 方法：`const input = <input/>; input.addEventListener(…)`、`.focus()`、`.appendChild()` | 激活期间是 `HydrationElement`，没有这些方法：生产环境 TypeError，开发期报告 | 改用 `ref`（`ref={el => …}` 或 `createRef`），在 ref 回调或 `useLayoutEffect` 里操作节点；事件用 JSX 的 `on*` props |
| C2 | 写属性：`el.className = 'x'`、`el.dataset.k = …`、`el.style.color = …` | 描述不可扩展：严格模式（ES module、TS 编译的 class）下 TypeError；非严格模式静默丢失；开发期报告 | 写成 JSX props 或响应式 atom |
| C3 | 读属性 / 测量：`el.textContent`、`el.getBoundingClientRect()` | 读到 `undefined` 或 TypeError；开发期报告 | ref + `useLayoutEffect` |
| C4 | `instanceof HTMLElement` 判断 JSX 结果（如检查 children 的形态） | 激活期间为 `false`，分支与 CSR 不同；运行时无法检测 | 不要按节点类型检查 JSX 结果；需要时用 `isHydrationElement`（导出）同时判断 |
| C5 | `RxList.map` 返回的行、普通数组里的元素 | 激活期间是描述；行被认领后，RxListHost / StaticArrayHost 把真实节点**写回**到 `list.data[i]` / `array[i]`（§3.3），激活完成后与 CSR 相同 | 只在激活期间（组件函数体、map 回调里）拿行当节点用时需要迁移，同 C1 |
| C6 | 在激活期间把 JSX 存起来，之后再渲染（`const panel = <div/>; () => open() ? panel : null`） | 第一次在激活中被认领；之后再渲染时用 `desc.node`，与 CSR 重复渲染同一个元素对象相同（元数据已被消费，`warnIfRenderingConsumedElement` 照旧提示） | 无 |
| C7 | 激活之外创建的现成节点作为 child | 按 CSR 插入，替换服务端对应位置的节点；开发期提示没有复用（§2.6.8） | 想复用服务端节点就在 JSX 里写 |
| C8 | `$name:_use` 传现成元素覆写 | 节点或描述都接受（判定统一） | 无 |
| C9 | Portal content、ref 时机、`useEffect` / `useLayoutEffect`、在用户回调里 `createElement` / `createRoot().render()` | 不变（用户回调里仍然退出激活上下文，得到真实节点） | 无 |

所有变化只发生在 `hydrateRoot` 期间；`createRoot().render()` 的 CSR 语义完全不变。

### 3.2 框架内部把 JSX 结果当节点用的地方（修一类）

PR-B 必须逐一改掉下列调用点，判定统一用 `isHydrationElement`。完成前 grep `createElement(` 的返回值在 `src/` 里的所有用法，补齐遗漏的。

| 位置 | 现在 | 新模型 |
|---|---|---|
| `ComponentHost.createHTMLOrSVGElement` | `node.listenerBoundArgs = …` 写在返回值上 | 写在描述的预置字段上，认领时转交 |
| 同上，`$name:_use` | `use instanceof Element` | `use instanceof Element \|\| isHydrationElement(use)` |
| 同上，`$name:_eventTarget` | 闭包捕获 `node` 并 `dispatchEvent(node, …)` | 派发时取 `desc.node ?? node` |
| `reusable()` / `ReusableHost` 构造 | `createHost(source)` 在调用时执行 | 命中 `createHost` 末尾的描述分支；激活期间不物化（§2.6.9） |
| `impliedTableBody` | `c instanceof Element && TABLE_SECTION_TAGS.has(c.tagName)` | 看描述的 `tag` |
| `RxListHost.createChildHost` 的 Compact 判定 | `item instanceof HTMLElement && !detachStyledChildren` | 激活路径用 §2.6.4 的唯一判定；CSR 路径不变（写回后不会再见到描述） |
| `StaticArrayHost` 的元素项判定 | `instanceof HTMLElement / DocumentFragment` | 激活路径看描述；CSR 路径不变 |
| `createHost` 的 ComponentNode 判定 | `typeof source?.type === 'function'` | 描述没有 `type` 字段（§2.2），不会命中；描述分支放在链尾 |
| `DOM.ts` `createElement` 组件分支的 Portal 预处理 | `isHydrating() && type.__axiiPortal` | 删除（§2.6.5） |
| `Form.tsx` 等内置组件 | 需逐一检查是否在渲染期把 JSX 结果当节点用 | 有则改为 ref |

### 3.3 RxList 与数组：认领后写回

**问题。** 行描述一直留在 `RxList.data` 里的话，每行会在列表的整个生命周期里多保留 3 个对象（描述、props、children 数组）。长列表是设计中心，按 AGENTS.md 这算内存回归。用户在激活完成后读 `list.data[i]` 也会拿到描述，与 CSR 不同。

**决定。**
- `RxListHost.hydrate` 每认领一行，如果 `source.data[i] === desc`，就写回 `source.data[i] = desc.node`，用普通下标赋值，不触发。
- `StaticArrayHost.hydrate` 对 `source[i]` 同样处理。
- 描述随后瘦身（§2.2），没有其他引用时被回收。激活完成后，数据里保存的与 CSR 相同，都是元素对象。

**依赖 data0 的行为，必须先钉住。** 在 `__tests__/data0Contract.spec.tsx` 加一条（PR-A）：
1. `RxList.data` 是普通数组，按下标直接赋值不触发任何 effect，不改变 `length`；
2. `map` 派生的增量 patch 和 `effectFramesArray` 按下标平行维护，不按 item 身份缓存（原型阶段读了 npm 安装的 `data0` 2.16.0 的 `map` 实现，与此一致）；
3. 之后的 `splice`、`set`、重排都以 `data` 为准。

**备选（契约失效时）。** 不写回，只靠瘦身，每行常驻一个小壳。这仍是回归，需要维护者另行接受。

### 3.4 误用的检测

- **开发期（`isAxiiDiagnosticsEnabled()`）：** 激活期间的 `createElement` 返回 `Proxy(desc)`。
  - 读写 §2.2 预置字段以外的属性时，报告 `AXII_HYDRATION_ELEMENT_ACCESS`，内容包括属性名、JSX source（开发期有 `__source`）和迁移提示（「激活期间 JSX 返回的是描述，用 ref 拿节点」）。
  - 方法调用照常抛 TypeError，报告先于 TypeError 出现。
  - 框架内部只访问预置字段和 `instanceof`，不会触发报告。
  - Proxy 只在开发期分配。
- **生产：**
  - 调方法抛 TypeError；
  - 严格模式下写未知属性抛 TypeError（`preventExtensions`）；
  - 读属性静默得到 `undefined`。
  
  文档写明这一点。
- **文档：** README（中英）与站点 SSR 一节写明 C1–C9，并给出 ref 迁移示例（PR-C）。

---

## 4. 失配时的报告与修复

### 4.1 不变量：位置对齐 ⇒ DOM ≡ CSR

激活过程中维持三条：
1. **按位置认领：** 每个被认领的节点，都位于 CSR 会放置对应节点的那个位置。游标只前进，认领只取游标处或游标之后的节点，并删除两者之间的节点。
2. **递归对齐：** 被认领的元素递归对齐子节点；被认领的 Text 按值比对，漂移时替换；被认领的 Comment 按 data 匹配。
3. **清扫：** 每个父节点消费结束时，剩余的未认领节点全部删除。

由这三条可以推出：**无论失配时选择怎样重同步，最终 DOM 都等于 CSR 结果**。选择只影响有多少服务端节点被复用，不影响正确性。这让恢复规则可以偏向「保留 identity」而不冒错误绑定的风险。

现在最危险的形态（监听器绑到另一个位置的元素上、内容被挪进别的元素）在新模型下不可能出现：不存在跨位置的认领。

### 4.2 局部规则（按「游标处期望什么」分类）

每条偏离都通过 `reportHydrationMismatch(expected, actual)` 报告。新建的节点在 CSR 模式下创建（`runOutsideHydration` + 物化描述），插在游标处，再把新建子树的元数据并入所属 StaticHost 的收集表（§2.6.1）。

| 规则 | 期望 | 游标处 | 处理 |
|---|---|---|---|
| R1 | 元素 `<T>`（可带静态 id） | 同标签，id 相符或客户端没有静态 id | 认领 |
| | | 同标签，id 不符 | 前方（同一父节点）有 id 相符的同标签元素：删除两者之间的节点，认领它（D8）；没有：按属性漂移认领，重写 id（D2 / D9） |
| | | 不同标签的元素 | 它带着期望的 id：替换（D4）；客户端有静态 id 且前方有 id 相符的同标签元素：删除之间的节点，认领它（D6）；否则替换这一个单元（D5） |
| | | 文本单元（`axii:t` 对 / 裸 Text / `axii:0`） | 替换这一个单元 |
| | | 结构 Comment 或 eof | 新建，**插入**到它前面。不消费锚点，因为它可能是后面某个 Host 的 placeholder |
| R2 | 文本单元（值 v） | `axii:t` 对 / 裸 Text | 认领；值不符时替换 Text（现状） |
| | | `axii:0` 且 v 非空，或元素 | 替换这一个单元（现状，`claimCorners` 已覆盖） |
| | | 结构 Comment 或 eof | 插入新 Text |
| R3 | 结构 Comment X：Host 的 slot、`fragment start`、`empty`、`computed node` | Comment X | 认领 |
| | | 其他 | 在同一父节点向前找第一个 Comment X：找到就删除两者之间的节点并认领；找不到就新建 Comment X 插入 |
| R4 | `axii:0`（空 Text-ph，FTS 尾） | `axii:0` | 插入 `Text('')`，删除哨兵 |
| | | 其他 | 插入 `Text('')`，不向前找：向前找会偷走后面单元的哨兵 |
| R5 | 父节点结束 | 还有剩余节点 | 全部删除（每个父节点报告一次）。根容器的 `STYLE` / `SCRIPT` / `LINK` 先留给样式迁移，再由容器清扫删除（D13，现状） |

- **R1–R3 的向前查找只在同一个父节点内**，最坏是 O(该父节点剩余节点数)，而且只在失配时发生。
- **可选的重同步启发式：** 例如 F4c 里跳过服务端结构态函数的 `…computed node, axii:0` 以保住后面兄弟的 identity。按 §4.1 它们不影响正确性，但必须进入漂移 fuzz（PR-C）后才能加。本设计不要求。

### 4.3 F4a–F4d 走查

| 用例 | 第一个偏离 | 处理 | 结果 |
|---|---|---|---|
| F4a 客户端多一行 | 第 3 行期望 `<li>`，游标处是 `<!--unhandledChild-->` | R1：新建 `<li>3</li>`，插在它前面；列表 slot 随后在游标处认领 | ≡ CSR；1 条报告；第 1、2 行与列表锚点保持 identity |
| F4b 客户端少一行 | 列表 slot 期望 `<!--unhandledChild-->`，游标处是 `<li>3</li>` | R3：向前找到它，删除 `<li>3</li>` | ≡ CSR；1 条报告 |
| F4c 服务端元素 / 客户端文本 | 文本态 Text-ph 期望文本单元，游标处是 `<b>` | R2：替换 `<b>`；`<i>` 期望元素，游标处是 `computed node`：R1 插入新 `<i>`；结束时 R5 清扫 `computed node`、`axii:0`、旧 `<i>` | ≡ CSR；报告；`<i>` 的 identity 丢失（加 §4.2 的可选启发式可保住） |
| F4d 服务端文本 / 客户端元素 | 结构态内层期望 `<b>`，游标处是 `axii:t` 对 | R1：替换为新 `<b>el</b>`；`computed node`：R3 找不到，插入；`axii:0`：R4 插入 `Text('')`；`<i>` 在游标处认领 | ≡ CSR；报告；`<i>` 保持 identity |

原型（§10）确认四个用例的第一个偏离点与上表一致：
- F4a：期望 `<li>`，得到 `Comment(unhandledChild)`；
- F4b：期望 `Comment(unhandledChild)`，得到 `<li>`；
- F4c：期望 `Text("text")`，得到 `<b>`；
- F4d：期望 `<b>`，得到 `Comment(axii:t)`。

### 4.4 报告与开发期不变量

- **报告：** 沿用 `HydrationMismatchError`（`code: 'AXII_HYDRATION_MISMATCH'`，带 `expected` / `actual`）与 `reportAxiiError`：
  - 无论诊断是否开启都交给 `onError`；
  - 诊断开启时输出结构化的 console 信息；
  - 生产环境照常修复，不中断页面。
- **开发期不变量（只在 `isAxiiDiagnosticsEnabled()` 下运行，O(n)）：** 激活结束后检查：
  1. 每个 Host 的 `[element … placeholder]` 区间可达且在文档中（复用 `assertRangeReachable`）；
  2. 每个 placeholder 都是真实节点，不是 slot 常量；
  3. 没有残留的 `axii:*` 标记；
  4. 违反时报告 `AXII_HYDRATION_INVARIANT`。
- **结构化：** 失配报告附带父元素路径（JSX source / elementPath），便于定位。

### 4.5 现有失配用例的保持

`ssrHydrate.mismatch.spec.tsx` 的元素级用例都通过 R1 / R5 保持原断言：
- 后续匹配兄弟的 identity：`#b` toBe `bBefore`、「rebuild middle only」；
- 插入的杂节点被删除；
- 同标签 id 对调；
- 尾部杂节点与根容器前后的杂节点。

对应的规则就是现在 `tryClaimElementAtCursor` 的游标规则，原样移植，唯一的细化是「不消费结构 Comment」。

文本 / Comment-ph 漂移用例由 R2 覆盖。`hydrate+destroy` 保留计数归零的用例不变。

---

## 5. 非 hydration 路径零开销

### 5.1 每条热路径的检查数（现在 → 新模型）

| 路径 | 现在 | 新模型 |
|---|---|---|
| `createElement`，元素 / Fragment | 1 次 `isHydrating()` + 循环里约 10 处 `hydrating &&` 短路 | 函数开头 1 次 `isHydrating()`（为真即返回描述）；CSR 函数体里没有激活分支 |
| `createElement`，组件 | 1 次 `isHydrating()`（Portal 预处理） | 0 |
| `createHost` | 元素分支 2 次 `isHydrating()` | 0；描述分支在链尾，常见类型永远到不了 |
| `RxListHost.createChildHost`（patch 新行） | 每行 1 次 `isHydrating()`（Compact 与非 Compact 分支各有一处） | 0；激活的行走 `hydrate()` |
| `RxListHost.render` / `StaticArrayHost` / `EmptyHost` / `PrimitiveHost` / `ReusableHost` 的 render | 各 1 次 | 0 |
| `AtomHost.render` | 1 次；`AtomHost.update`（文本更新）0 次 | 0；`update` 不变 |
| `FunctionHost` 重算 | 文本路径在 `textNode` 快速返回之后有 1 处；结构路径 1 次 | 不变：读取都在 `textNode` 快速返回之后，结构路径 1 次（用于首次运行分流） |
| `StaticHost.render` | 1 次 + 3 处分支；`getStyleSheetId` 1 处 | 0 |
| `ComponentHost.render` | 每个 `useEffect` 1 次 | `render()` 与 `hydrate()` 共用一个带布尔参数的私有方法；0 次全局读取 |
| `LightBindingEffect` 属性更新 | 0 | 0 |

- **Host 不新增字段。** 原型方法 `hydrate` 不占实例空间。`__axiiHydrated`、`__axiiHydrating` 等挂在实例上的临时字段一并删除，减少了隐藏类分叉。
- **元素不新增字段。** 描述是独立对象，不挂在元素上。

### 5.2 内存

- 描述只在激活期间存在：
  - 消费后瘦身；
  - `StaticHost.source` 换成认领的元素；
  - 列表和数组写回（§3.3）。
- 激活完成后的常驻对象与 CSR 渲染同一棵树相同。
- 验收：`retainedObjectDiagnostics` 的「hydrate + destroy 后所有计数归零」照旧；PR-B 新增一条，确认激活 N 行列表后 `list.data` 里没有描述。

### 5.3 测量方法与原型数据

**测量方法（PR-A、PR-B 的验收都用它）：**
1. **构建：** 生产构建 `npm run build`，三份放在同一页面：A 是 origin/main，A′ 是 A 的逐字节副本（A/A 对照），B 是改动后的构建。
2. **预热：** 每份 30 轮。
3. **轮次：** 每轮随机打乱 A、A′、B 的顺序，至少 60 轮。
4. **工作量：** 每轮工作量要让单次计时远大于计时分辨率，单次 ≥ 100 ms。浏览器 `performance.now()` 的分辨率约 0.1 ms。
5. **工作负载：**
   - 纯 `createElement`：3000 行 × 4 个元素；
   - `createRoot().render` 1000 行静态行，覆盖 `createHost` / `StaticHost`；
   - RxList push / splice 1000 行，覆盖 `createChildHost`。
6. **统计：** 报告各组中位数，以及按轮配对的比值中位数 A′/A 与 B/A。
7. **判定：** |B/A − 1| 不大于 max(|A′/A − 1|, 1%)。
8. **环境：** 在 load1 较低时运行。不用跨进程跑 sibling `benchmark` 仓库，那样的噪声可达 ±45%。

**原型数据**（不是验收数据；原型代码未提交）：
- **B 的构造：** 把 `createElement` 的激活分支提到开头（激活时立即返回描述），CSR 函数体里的激活分支全部去掉（`hydrating` 恒为 `false`，构建时被常量折叠），并删除组件分支的 Portal 预处理。
- **环境：** 同一页面三份生产构建，load1 约 25–27，每份 60 轮。
- **结果：**

| 运行 | 负载 | A 中位数 | A′ 中位数 | B 中位数 | 配对 A′/A | 配对 B/A |
|---|---|---|---|---|---|---|
| 1 | `createElement` 5×3000 行 | 14.1 ms | 13.6 ms | 13.6 ms | 0.993 | 1.007 |
| 2 | 同上 | 13.3 ms | 13.5 ms | 14.1 ms | 1.000 | 1.008 |
| 1 | `render` 3×1000 行 | 2.1 ms | 2.1 ms | 2.1 ms | 1.000 | 1.000 |
| 2 | 同上 | 2.1 ms | 2.0 ms | 2.1 ms | 1.000 | 0.952 |

- **解读：** 两次运行里 B 与 A 的差别都没有超出 A/A 的差别。
  - 未配对中位数：A′/A 为 0.96–1.015，B/A 为 0.96–1.06；
  - 配对 B/A 为 1.007–1.008，恰好是一个计时刻度（0.1 ms / 13.3 ms ≈ 0.75%）；
  - `render` 一组每轮只有约 2 ms，分辨率约 5%，基本没有区分力。
- **结论：** 在这台高负载机器上，低于约 1% 的差别分辨不出来，原型数据只能说明「没有可见回归」。PR-A / PR-B 必须按上面的方法（单次 ≥ 100 ms、低负载）重测，作为验收。

---

## 6. 11 条 `test.fails` 的映射

| 用例 | 现在的失败机制（§1.2） | 新模型下为什么通过 | 转为通过的 PR |
|---|---|---|---|
| F1b | 父级的 `<p>` 先于子组件认领，按后序拿走子组件的 `<p>` | App 的 `<div>` 先认领；`<Header/>` 在自己的位置渲染、消费 `<header>…</header>`，再认领 `unhandledChild`；然后 `<main>` 认领 main，`<p>` 认领 main 里的 `<p>` | PR-B |
| F1f | 同上，组件输出比后面兄弟里的同标签元素浅 | 同上；不存在跨位置认领，也不会 `insertBefore` 挪动节点 | PR-B |
| F1g | 同上，函数子节点 | FunctionHost 在自己的位置求值，消费 `<p>f</p>`，再认领 `computed node`、`axii:0` | PR-B |
| F1h | 同上，抛错 | 同 F1b | PR-B |
| F1j | 原始元素认领自己时搜到自己标记里的同标签节点 | 原始元素在游标处按位置认领，内容不透明（§2.6.2） | PR-B |
| F3a | 文本态函数向前搜索，拿到结构态函数的锚点 | 每个函数先消费自己的内容，再在游标处认领自己的锚点；不向前搜索 | PR-B |
| F3b | 外层函数拿到内层函数的锚点 | 内层的内容与锚点先被消费；外层在内层之后认领自己的 `computed node` 与 `axii:0` | PR-B |
| F4a | 多出的客户端行静默缺失 | R1：插入新行并报告（§4.3） | PR-B |
| F4b | 多出的服务端行静默留下 | R3：向前找到列表锚点，删除多余行并报告 | PR-B |
| F4c | 文本插在 FTS 尾部，服务端元素静默留下 | R2 + R1 + R5：替换、插入、清扫并报告 | PR-B |
| F4d | 抛错 | R1 + R3 + R4：新建 `<b>`、插入 `computed node` 和 `Text('')`，并报告 | PR-B |

**为什么都在 PR-B：** 一旦 `createElement` 返回描述，每个 Host 都必须消费描述，每种「期望的单元」也都必须有失配处理。否则失配时只能抛错，比现在更糟。所以切换、认领协议和 R1–R5 是同一个原子变更，见 §7。

**`hydrateKnownDefect` 的连带：** `test.fails` 的守卫要求失败形态是「断言失败」，或者是「抛出匹配 reason 的错误」。PR-B 完成后这 11 条都会通过，按约定把 `test.fails` 改为 `test`，断言正文不改。

---

## 7. 实现 PR 拆分

| PR | 内容 | 转为通过 | 验收 |
|---|---|---|---|
| **PR-A：激活路径与 CSR 路径分离（不改行为）** | 各 Host 新增 `hydrate()`，把现有的 `if (isHydrating())` 分支从 `render()` 搬进去，父级在激活时调用 `hydrate()`。认领仍用现在的模型。下标游标换成节点指针游标。`data0Contract.spec.tsx` 加入 §3.3 的写回契约。元数据路径拼接规则与「应用 props」各收成一个函数（§2.6.1） | 无（`test.fails` 不变） | 三道门禁全绿；`rxListFuzz`；§5.3 的 A/B/A′ 测量（预期 ≤ 噪声或略快）；`retainedObjectDiagnostics` 归零用例 |
| **PR-B：切换到延迟描述与自顶向下认领（原子）** | `HydrationElement` 与唯一判定；`createHydrateHost`；所有 Host 的 `hydrate(slot)` 按 §2.5 消费；§2.6 的各种特殊形态；R1–R5；§3.3 写回；§3.4 的开发期 Proxy 与生产 `preventExtensions`；§3.2 的内部调用点；删除 §2.8 的代码；`ssr.ts` 的 Compact 判定改用共享谓词（若 §11 的范围外问题尚未单独修复，在此一并处理）；`claimCorners` 白盒用例迁移（§8）；F1i 生成器去掉排除项（组件、函数子节点、Fragment、F1j 写法，采用原型生成器） | F1b、F1f、F1g、F1h、F1j、F3a、F3b、F4a、F4b、F4c、F4d | 三道门禁全绿；`rxListFuzz`；扩展后的 F1i（300 棵，DOM ≡ CSR、无报告、服务端节点全部保留、监听器在自己的位置）；`ssrHydrate.*` 全部原断言；F1d 增长倍数接近 4 倍（线性）；§5.3 测量；开发期不变量（§4.4）在全量用例下不报告 |
| **PR-C：漂移 fuzz 与文档收尾** | 漂移 fuzz：在 F1i 生成的树上随机注入行增减、元素 ↔ 文本、标签替换、插入杂节点、删除标记、文本篡改，断言 DOM ≡ CSR、至少一条报告、从不静默；README（中英）、站点 SSR 一节、`ssr-support.md` 去掉「实验性」标注与已知局限，加入 §3.1 迁移说明；CHANGELOG 条目交给 #61 汇总 | （无新的 `test.fails`） | 门禁全绿；漂移 fuzz 300 棵 × 多种注入；文档检查脚本（`check-doc-coverage`、`check-exports`） |

**为什么 PR-B 不能再拆：** 只要激活期间 `createElement` 返回的不是节点，所有消费它的地方就都必须同时改：
- 静态元素、组件、函数、Fragment、列表行、数组项、Portal content、reusable；
- 每一种期望的单元都需要失配处理。

缩小 PR-B 的办法是把一切不改行为的准备放进 PR-A：游标、`hydrate()` 方法的骨架、路径规则和契约钉。

---

## 8. 既有用例的预期变化（逐条）

**`__tests__/auditSsrHydrate.spec.tsx`：**
- 11 条 `test.fails` 改为 `test`，断言正文不改。
- 文件头注释、F1 的 describe 标题与 #54 留下的「已知局限」注释同步更新。
- F1i 生成器去掉对组件、函数子节点、Fragment、含自身标签的原始标记的排除，覆盖面扩大，不放宽任何断言。

**`__tests__/ssrHydrate.claimCorners.spec.tsx`（白盒，直接调用 `src/hydration.ts` 的内部函数）。** 以下用例针对的函数在新模型中删除，由同一行为在新游标 API 上的用例替换。PR-B 在报告里逐条列出新旧对应：

| describe | 用例 | 处理 |
|---|---|---|
| `claimTextUnit / claimEmptyTextPh corners` | 全部 8 条 | 行为保留（R2 / R4）；改调新游标上的同名函数 |
| `cursor comment claiming corners` | `advanceCursorUntilComment` 抛错、`claimComputedNodeBefore` 抛错、`claimFragmentStartBefore` 两条、`claimEmptyHostCommentBefore` 抛错、`claimEmptyHostComment` 扫描根 | 函数删除；以 R3（结构 Comment 认领、向前查找、插入）的用例替换 |
| | `claimCommentAtCursor` 抛错 | 改为 R3 的「找不到 → 插入并报告」。**这是行为变化：现在抛错，新模型报告并修复**，与 §3.7「生产不整页失败」一致 |
| `claimTextBeforeCommentPlaceholder corners` | 3 条 | 函数删除（Comment-ph 在游标处认领文本）；以 Comment-ph 的游标用例替换。其中「元素紧挨在 placeholder 前面时抛错」变为 R2 的替换并报告 |
| `stripAxiiTextBoundariesBetween` | 1 条 | 函数删除；Fragment 内容在同一遍消费中去掉包边，由 N2 系列与 fuzz 覆盖 |
| `element claim cursor paths (§3.7 D-series at cursor)` | 7 条 | 行为保留（R1）；改调新 API。「same-tag empty-id defers claiming」与「same-tag without id rejected when children do not fit」两条服务于 Portal 提前认领与 EmptyHost 布局壳的推断，在新模型中没有对应情形，删除，由 k15–k19 黑盒用例覆盖 |
| `element claim deep-walk candidate fits` | 5 条 | 深度遍历与候选适配推断删除；对应的黑盒用例（`ssrHydrate.lifecycle` 的 Portal 系列）保留 |
| `claim helpers error contracts` | `createElementForHydrateMismatch` 两条 | 改为 R1 新建的用例（含 SVG 命名空间） |
| | `claimElement` 两条 | 函数删除 |
| | `findRootComment` | 保留 |
| `trailing cleanup at element cursor (D10/D11)` | 「host-structure markers ahead guard」 | 防护删除（父元素结束时子 Host 已消费完）；以「有 Host 时尾部杂节点照样清扫」替换 |
| | 「cleanup skips …」 | 保留（R5） |
| `Fragment reconcile walk branches` | 全部 10 条 | 函数删除；黑盒等价覆盖见 N1、N2、F2c 与 fuzz |
| `hydrateRoot end-to-end claim corners` | 全部 | 保留 |

**其余文件：** 只删除白盒用例，不改黑盒断言。
- `ssrHydrate.mismatch.spec.tsx`：断言全部保留（§4.5）。
- `ssrHydrate.lifecycle.spec.tsx`：断言全部保留，只更新注释里的 `claimElement` 字样。
- `ssrHydrate.lists`、`smoke`、`attrs-components`、`ssrAdjudication*`、`ssrReview*`、`ssrStyles`、`styleContent*`：断言全部保留。

> 待协调者确认：白盒用例按上表迁移。AGENTS.md 要求不删既有用例，但被测函数本身在新模型中不存在。

---

## 9. 风险与回退

| 风险 | 说明 | 缓解 |
|---|---|---|
| **Host 认领协议未在真实 Host 上原型验证**（最大的未验证点） | 原型验证的是遍历语法与位置对齐（§10）。真实 Host 还会在认领前读 `this.placeholder`，例如 `parentElement` getter、错误路径的 `placeholder.remove()`、`resetOptionOwnerSelect`、`isConnected`，以及 ComponentHost 与 innerHost 共享 placeholder | PR-B 逐个 Host 审计认领前对 placeholder 的读取；slot 常量不是节点，误用立即 TypeError；开发期不变量（§4.4）；扩展后的 F1i 与全量用例 |
| 使用者依赖「激活期间 JSX 是节点」 | 公开契约变化（§3.1） | 开发期 Proxy 报告；生产 TypeError（方法、严格模式写入）；README 与站点迁移说明；`hydrateRoot` 在 PR-C 之前仍标实验性 |
| 副作用顺序与 CSR 不同（§2.9） | 祖先响应式属性的绑定晚于后代子 Host 的渲染 | 服务端已写入属性初值，DOM 观察一致；lifecycle 用例覆盖 attach 时机 |
| 依赖 data0 的 `RxList.data` 写回 | 非文档行为 | `data0Contract.spec.tsx` 钉住；契约失效时退回「瘦身不写回」 |
| 失配重同步丢失 identity | 双重失配时复用的节点变少 | 不变量保证正确性（§4.1）；漂移 fuzz（PR-C） |
| 激活自身的分配 | 每个元素多一个描述对象 | 线性遍历取代二次搜索，总时间预期下降（F1d）；PR-B 记录激活耗时前后数字 |
| 与 #50 / #52 / #56 的交叉 | 都动 `DOM.ts` / `hydration.ts` | 本设计只依赖「原始标记不透明」「表单 props 在子节点之后应用」「命名空间由描述决定」这三个接口；冲突按合入顺序合并 |

**回退：**
- PR-B 是唯一改变行为的 PR，回退 PR-B 即恢复现在的认领模型。PR-A 不改行为，可以保留。
- 服务端格式不变，回退不涉及服务端发版，也不需要兼容分支。
- 不提供「旧认领模型」的运行时开关：两套认领模型并存会把 §2.8 的全部启发式留在包里，也违反「不加兼容分支」。

---

## 10. 原型验证记录（原型数据；原型代码未提交）

**目的：** 回答两个可行性问题：
1. 只靠现有的服务端末尾标记，能否按位置、自顶向下、不向前看地读回服务端输出？
2. 延迟描述在组件边界怎样交接？

**做法：**
- 在 worktree 里写了一个未提交的浏览器用例：
  - 用描述版 `createElement` 驱动一个 walker，规则**取自客户端语义**：`DOM.ts` 的 child 循环、`createHost` 分派、`RxListHost.createChildHost` 的 Compact 判定、`StaticArrayHost` 的项规则，不照抄 `serialize`；
  - 组件在 walker 走到它的位置时才调用，返回的描述原地继续消费（即组件边界的交接）。
- 输入是 `renderToString` 的输出经真实 chromium 解析后的 DOM。
- 断言：
  1. 每个服务端节点恰好被消费一次（`dangerouslySetInnerHTML` 的内容整体计入原始元素）；
  2. 消费结束时游标到达每个父节点的末尾；
  3. 只认领游标处的节点，从不向前看。

**结果：**

| 项目 | 结果 |
|---|---|
| 11 条 `test.fails` 中的 7 种形态（F1b、F1f、F1g、F1h、F1j、F3a、F3b） | 全部完整读回（例：F1b 14/14 个节点，F3b 11/11） |
| 附加形态：Fragment 行含组件后跟静态兄弟、组件包组件 / 函数返回组件、组件行、嵌套 RxList、函数返回 atom、`null` / boolean / 数组混合、table 行（隐含 tbody）、`<textarea>` 多文本单元 | 全部完整读回 |
| F4a–F4d | 都在第一个偏离位置被发现（§4.3 列出了四条期望 / 实际） |
| F1i 生成器扩展版：300 棵，含组件 205、文本态函数 86、结构态函数 130、Fragment 136、RxList 78、数组 197、atom 148、**含自身标签的原始标记 50** | 0 失败；每个节点的消费步数最大为 1.00 |
| 线性：150 / 600 / 2400 行列表 | 消费步数 603 / 2403 / 9603，等于节点数 |

`createElement` 零开销的原型测量见 §5.3。

**没有验证的：**
- 真实 Host 上的认领协议（§9 第一行）；
- 失配修复后的 DOM ≡ CSR：walker 只检测失配位置，不做修复。修复的正确性由 §4.1 的不变量论证，留给 PR-B 的用例与 PR-C 的漂移 fuzz。

---

## 11. 范围外发现（只列出，未修）

- **服务端 Compact 判定与 CSR 不一致（已在 chromium 复现）。** `serializeRxListRow` 只看行元素自己的 `detachStyle`，CSR 的 `detachStyledChildren` 还包括后代提升上来的。
  - 写法：`list.map(i => <li><span detachStyle={…}>{i}</span></li>)`；
  - CSR：`<li><span>1</span></li><!--rx list item--><!--unhandledChild-->`；
  - 服务端：`<li><span>1</span></li><!--unhandledChild-->`（缺行级 Comment）。
  
  激活时这一行的结构对不上。按 §2.6.4，两边应共用一个判定。建议单独开 issue；若 PR-B 之前未修，PR-B 一并处理。
- **#54 报告的疑点不再存在。** 疑点是 `createElementForHydrateMismatch` 新建的元素没有登记为已认领，之后的无游标认领可能拿到它。新模型没有无游标认领，PR-B 之后不再成立，无需单独处理。
