# hydration 自顶向下认领 — 设计（#55）

- 实现进度：PR-A（#75）、B1 已合入；B1 与上文的差别记在 §7.6。
- 状态：设计稿，按第一轮审阅（PR #67「设计审阅（第一轮）」）修订：补了被捕获描述的生命周期（§3.1.1）与迁移面（§3.1.2）、诊断开关两遍验收（§3.4）、`createHydrateHost` 防分叉机制（§2.4.1），按「内部入口分步落地、最后切换」重写了实现拆分（§7），§12 改为已定。本文只定方案，不含实现。
- 关联：#55（本设计）、#54（实验性标注与低成本缓解，PR #62 已合入）、#68（服务端 Compact 判定，排在实现 PR 之前修）；相邻但不归本设计：#50（`dangerouslySetInnerHTML` 的 `{__html}` 形式，已合入）、#52（复选框 value / checked，已合入）、#56（table 隐含 tbody、`<svg>` 内的同名标签、`<textarea>` / `<title>` 的函数子节点）。
- 上位文档：[`ssr-support.md`](./ssr-support.md)。本文改变的是它的 §3.1「客户端」一段与 §3.7 的修复粒度；§3.2 的服务端标记契约**不变**。
- 基线：origin/main `36e540c`（含 #62 / #63 / #64，#65 / #66 合入的 #50、#52，以及 #70 合入的 #51）。现状复现与原型在 `4712285` 上完成；#50 / #52 只改了原始标记的取值和复选框的勾选通道，#51 把 SSR / CSR 的属性规则收成一份，都不影响 §1 的失败机制，三者对本设计的接口见 §2.6.1、§2.6.2。§7.1 引用的行号按 `36e540c`。

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
- 失配由「游标处期望什么、实际是什么」的局部规则处理。在「位置对齐」的不变量之下，任何重同步选择得到的节点结构、文本和客户端写下的属性都等于 CSR 结果，选择只影响能复用多少节点（§4.1；服务端独有属性的边界也在 §4.1）。F4a–F4d 因此可以报告并修复；逐条走查过的现有失配用例，其节点复用断言预计全部保留（§4.5）。

**代价（契约变化）。** 激活期间 JSX 的返回值不是 DOM 节点，而且**这个值之后也不会变成节点**：
- 在组件函数体里拿 JSX 结果当节点用（调方法、写属性、测量）会失败，迁移方式是改用 `ref`。
- 被闭包捕获的描述在激活结束后仍是描述。事件处理器里的 `input.focus()` 要到用户操作时才抛 TypeError，读属性在生产环境静默得到 `undefined`；描述不转发到真实节点。生命周期与每种操作的表现见 §3.1.1。
- `RxList.map` 与普通数组里的行在激活期间是描述，由 Host 认领后**写回**为真实节点，激活完成后与 CSR 一致。
- 开发期用 Proxy 在访问时报告误用（带 JSX 位置）；生产环境下，调用方法、把描述当节点传给 DOM API 会抛 TypeError，在严格模式下写属性也会抛 TypeError。
- `README`（中英）与 `site/` 的示例里没有这种写法（§3.1.2）。

**零开销。** 切换完成后，非激活的 `createElement` 只剩函数开头一次全局读，比现在少：组件分支的那次读取和循环里约 10 处 `hydrating &&` 都去掉了。
- `createHost`、`RxListHost.createChildHost`、`AtomHost`、`StaticHost` 等的 CSR 路径去掉现有的 `isHydrating()` 读取。
- Host 不新增字段，还去掉了现在挂在 Host、数组、`RxList`、`DocumentFragment` 上的激活用临时字段。
- 原型测量（同页 A/B，带 A/A 对照）的差异在 A/A 噪声与计时分辨率以内（§5.3）。
- 切换之前的过渡期，`createElement` 的 CSR 路径多一次整数比较，其余热路径不变（§7.3）。

**实现拆分（§7）：** 新模型先经一个**不导出的内部入口**分步落地，公开的 `hydrateRoot` 在此期间仍走旧模型；最后一个 PR 切换 `hydrateRoot` 并删除旧模型。
- **PR-A：** 「应用 props」与元数据路径规则各收成一个函数（CSR 与新模型共用），钉住 data0 写回契约。不改行为。
- **B1–B4：** 新模型按「核心认领协议 → 列表与数组 → 失配规则 → 其余形态与开发期检测」分四步进 main，每步门禁全绿。激活用例同时对内部入口再跑一遍，11 条在 B1、B3 对内部入口转为通过。
- **S：** `hydrateRoot` 切到新模型，删除旧模型，11 条 `test.fails` 改为 `test`。
- **D：** README（中英）、站点文档与迁移说明，去掉「实验性」标注。

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

服务端 HTML 是 `renderToString` 的输出，表中省略了尾部的 `<!--root-->`。「当前结果」一列是实测输出与报告；「机制」一列由实测输出对照源码推断，其中 F1f 的「挪出 main」与 F4a 的「延迟桩未插入」两步是从输出形态和代码路径推出的，没有单步跟踪。

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
| F1i 生成器可以扩展成验收 fuzz | 属实。原型生成器去掉了对组件、函数子节点、Fragment、含自身标签的原始标记的排除，300 棵全部通过（§10）；B2 采用，B3 在它上面加漂移注入 |

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
    rawProps: AttributesArg | null    // 原样（as / AOP 已由 ComponentHost 处理完）
    rawChildren: any[]                // 原样；嵌套的描述、atom、函数、组件、RxList……
    isSVG: boolean                    // 创建时与 CSR 同一规则：_isSVG ?? svgOnlyElementNames.has(tag)；
                                      //  认领时再按 #56 的父元素规则补一条（见下面「isSVG」）
    node: Element | DocumentFragment | null       // 认领或新建后的真实节点
    listenerBoundArgs: any[] | undefined          // ComponentHost 写入，认领时转交给 node
}
export function isHydrationElement(v: unknown): v is HydrationElement   // 判定只在这里定义
```

- **何时产生：** 新模型激活期间，对字符串标签与 `Fragment` 调用 `createElement` 和 `createSVGElement` 时。组件仍然返回 `ComponentNode`，不变。
- **不碰 DOM：** 不创建元素，不认领，不应用 props，不提升元数据。`unhandledChildren`、`unhandledAttr`、`refHandles`、`detachStyledChildren` 都由消费它的 Host 在认领时按 CSR 的同一规则建立（§2.4）。
- **字段预置：** 全部字段在构造器里预置，然后 `Object.preventExtensions`。这样形状单态，用户写入未知属性在严格模式下抛错（§3.4）。只在激活路径上分配。
- **isSVG（B1 按 #56 落地）：** 创建时按 CSR 的规则（显式 `_isSVG`，否则 SVG 专有标签）。HTML / SVG 同名的标签（`a` / `title` / `style` / `script`）的命名空间要看父元素，`createElement` 时还不知道父元素，所以在认领时补：父描述是 SVG 元素、且不是 HTML integration point 时，它的静态子描述（含 Fragment 展开的）按 SVG 认领、按 SVG 的规则写属性，≡ CSR 的 `adoptSvgChildren`。Host 稍后渲染的内容不在其列（CSR 同样是 HTML 元素，与解析器不同时按 R1 处理，§2.6.7）。
- **字段命名规则：** 预置字段名不得出现在任何元素接口上，否则用户读 `el.<名字>` 拿到的是描述的内部数据，开发期也不会报告（§3.4 的规则跳过预置字段）。第一版草稿里的 `children` 与 `Element.children` 重名，已改为 `rawChildren`，`props` 一并改为 `rawProps`。在 chromium 上对 `window` 上全部 145 个 `*Element.prototype`（含 `Element`）检查过：`tag`、`rawProps`、`rawChildren`、`isSVG`、`node`、`listenerBoundArgs` 都不在其中，旧名里只有 `children` 命中。B1 用一条用例钉住：遍历预置字段名，断言它们不在 `window` 上任何 `*Element.prototype` 里。
- **两种对象：** 开发期返回包着描述的 Proxy，生产返回描述本身（§3.4）。用哪一种在 `beginHydration` 时按 `isAxiiDiagnosticsEnabled()` 定一次，同一次激活内不变。
- **消费后瘦身：** 被认领或新建后，`rawProps` 和 `rawChildren` 置为 `undefined`，只保留 `node`。仍被引用的描述只是一个小壳（§3.3、§5.2）。瘦身不会把描述变成节点：被闭包捕获的描述永远是描述（§3.1.1）。
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

- **谁创建 Host：** 激活期间由 `createHydrateHost(source, slot, context)` 创建，它是只在激活路径使用的分派函数，类型判定顺序与 `createHost` 相同。构造时传入的 placeholder 就是 slot 常量，它不是 DOM 节点：在认领之前误用 placeholder 会立刻 TypeError，问题不会被静默放过。CSR 的 `createHost` 保留 `placeholder instanceof Comment | Text` 断言，不受影响。`createHydrateHost` 与 `createHost` 是同一条分派链的两份，防止分叉的办法见 §2.4.1。
- **组件边界：** `ComponentHost.hydrate(slot)` 调用组件函数，用 `createHydrateHost(node, slot)` 创建 `innerHost`，然后 `innerHost.hydrate(slot)`。完成后 `this.placeholder = innerHost.placeholder`。组件与它的 innerHost 共享 placeholder，这是现有语义，组件嵌套组件也一样，所以不新增标记。
- **父级只做一件事：** 对每个动态 child，按 child 的种类选 slot，创建 Host，调用 `hydrate(slot)`。返回时游标已经在该 child 区域之后。父级从不搜索 placeholder。
- **构造顺序与 CSR 相同：** `StaticHost.hydrate` 先按文档顺序构造整棵描述子树里的全部子 Host（≡ `collectInnerHost`，构造只需要 source 与 slot 常量），再走认领遍历、逐个 `hydrate`。`ComponentHost` 的构造器会分配组件类型 id（`getComponentTypeId`），首次出现的组件类型因此按与 CSR 相同的顺序拿到 id，样式类名里的类型 id 与 CSR 一致。
- **effect 型 Host：** `FunctionHost`、`RxListHost` 第一次运行发生在 `hydrate()` 里：
  - `FunctionHost` 的 effect 回调在首次运行时读一次 `isHydrating()` 来分流，放在 `if (this.textNode)` 文本更新快速返回**之后**，文本更新热路径上没有新增检查；
  - `RxListHost` 的 computed 首次运行只建立追踪，与现在的 `hydrateSkipInitial` 相同。

#### 2.4.1 `createHydrateHost` 与 `createHost` 不分叉

`createHost` 是热路径，为了「判定只定义一处」把它改成先算种类、再按种类分派，会给每次调用加一层间接，本设计不这样做。两份分派链并存，靠下面三件事保持一致：

1. **同一张种类表：** `createHydrateHost` 写在 `createHost.ts` 里紧挨 `createHost` 的位置，两者用同一个 `HOST_TYPE_NAMES` 下标登记 `trackHostCreated`，两处各有一条 CAUTION 注释指向对方。新增一种 source，必须同时改两处和这张表。
2. **逐棵树的种类计数相等（验收）：** 扩展后的 F1i 生成器（B2）对每棵树开启 `retainedObjectDiagnostics`，分别记下 CSR 渲染与激活创建的 `createdByType`，断言两份计数逐类相等。`createdByType` 已经按 Host 类型计数，其中 `CompactElementHost` 由 `RxListHost.createChildHost` 单独登记，也在比较范围内。任何一种 source 在两条链上落到不同的 Host，计数就不相等。
3. **覆盖每一种 source（验收）：** 300 棵树合计，`HOST_TYPE_NAMES` 的每一项和 `CompactElementHost` 在两边都至少出现一次。以后有人往 `createHost` 加了新的 Host 类型而生成器没有跟上，这条就失败。生成器按 `createHost` 的分派顺序逐类产生 source：函数、atom、元素描述、Fragment 描述、字符串 / 数字 / boolean / bigint、数组、`null` / `undefined`、`RxList`、`reusable()`、组件、现成的 `Comment` / `Text`。其中现成节点只可能是客户端内容（§2.6.8），这种树断言 DOM ≡ CSR，并且恰好得到一条 `AXII_HYDRATION_LIVE_NODE` 提示。`reusable()` 与现成节点在 B4 落地，所以 B2、B3 的这条验收只要求已落地的种类，B4 起要求全部（§7.4）。

### 2.5 各种单元的消费规则（与 `createElement` 的 child 规则和 `createHost` 的分派一一对应）

这张表也是原型 walker 的实现依据（§10）。「认领 X」指游标处必须是 X，否则进入 §4.2 的失配规则。

**元素描述的子节点**（≡ `DOM.ts` `createElement` 的 child 循环；Fragment 的子节点用同一规则，只是没有单 child 文本快速路径）：

| child | 消费 |
|---|---|
| `null` / `undefined` | 无 |
| 唯一的字符串 / 数字 / bigint（ElementChildText 单 child） | 非空：认领文本单元（`axii:t` 包边或裸 Text）；空：无 |
| 多 child 中的字符串 / 数字 / bigint | 非空：认领文本单元；空：认领 `axii:0`，插入 `Text('')`。例外：它是 `null` / `undefined` 之外唯一的 child 时服务端不写哨兵（`ssr.serializeChildren` 的 soleChild，元素与 Fragment 的 children 各自判定），这时只插入 `Text('')`；按这条规则决定，不能见到 `axii:0` 就拿（它可能属于后面的 atom / 函数单元） |
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
| NodeHost（source 是现成的 `Comment` / `Text`） | 服务端不可能产出客户端的现成节点，按 §2.6.8 当作仅客户端的内容：把 source 插在游标处，然后按 R3 认领 slot（服务端在 slot 前为它写下的内容由 R3 删除） |
| 根 | `createHydrateHost(source, 'root')`；结束时游标必须到达容器末尾（之后的 `STYLE` / `SCRIPT` / `LINK` 交给迁移和清扫） |

### 2.6 特殊形态

#### 2.6.1 认领元素时做的事

现在分散在 `createElement` 激活分支里的元素级处理，原样移到「认领元素」这一步：
1. 比较标签（SVG 按原始大小写，HTML 按大写，同 `tryClaimElement` 的 CAUTION），并按 R1 处理 id；
2. 处理 `data-axii-ssr` 样式类，记下滚动样式基名（现 `createElement` 激活分支里读 `SSR_STYLE_CLASSES_ATTRIBUTE` 的那一段）；
3. 有 `value` 或 `defaultValue` prop 的 `<textarea>`：清空子文本（现 `createElement` 激活分支里 `type === 'textarea'` 的那一段，判定用 #51 引入的 `textareaContentProp`，不另写）；
4. table 的隐含 tbody：游标下沉到 tbody；
5. 递归消费子节点；
6. **子节点之后**再应用 props。这与 `createElement` 的「props 在 children 之后」一致，select / option 的语义需要这个顺序：
   - `select multiple` 的预应用照旧跳过；
   - 已认领元素上的 `dangerouslySetInnerHTML` 不重新赋值；
   - 静态 props 照旧经 `setAttribute` 写一遍，与现状相同；
   - 响应式属性、ref、`detachStyle` 按 CSR 的路径规则记入所属 StaticHost 的收集表；
7. 把 `listenerBoundArgs` 从描述转交给元素，然后写 `desc.node`。

元数据的路径（`path`）与 CSR `createElement` 提升时的规则相同，样式 id 依赖这些路径，必须逐位一致。PR-A 把路径的拼接规则收成一个函数，CSR 与激活共用。

「应用 props」同样只有一份：PR-A 把 `createElement` 里「props 在 children 之后、`value` / `checked` 延后」的那段抽成函数，CSR 与认领步骤共用。这样下面三处已合入的规则在激活路径上自动一致，不另写一遍：
- #52：元素同时带 `value` 与 `checked` 时记下 `__axiiInputHasCheckedProp__`；
- #50：`dangerouslySetInnerHTML` 经 `innerHTMLOf` 解包，`{__html}` 形式走静态路径。
- #51：客户端的属性写入仍在 `DOM.setAttribute`，写入规则与别名表在 `markupNames`，由客户端与服务端共用（服务端另有只供它用的 `htmlPropertyTypes`）。认领步骤照旧经 `setAttribute` 写静态 props，自动一致；`<textarea>` 的 `defaultValue` 见上面第 3 步。

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

**服务端、激活共用这个判定。** 现在 `ssr.ts` `serializeRxListRow` 只看行元素自己的 `detachStyle`，后代元素带 `detachStyle` 时服务端少写一个 `<!--rx list item-->`。#68（OPEN，排在实现 PR 之前修）的决定是把这个判定收到一个 Node 安全的模块里，由 `ssr.ts` 与 `RxListHost` 共用。B2 的激活路径直接用 #68 落地的判定，不另写一份。

**B2 依赖 #68：** B2 开工前 #68 必须已合入；它落地的判定要能以 `HydrationElement` 为输入（读 `tag`、`rawProps`、`rawChildren`），或者接受取标签、props、children 的访问器。#68 若只接受 `SsrElement`，B2 先在 #68 的模块里把输入放宽，不另写一份判定。

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

服务端在字符数据里也写不出结构注释：boolean child 被服务端跳过，CSR 却为它建 PrimitiveHost，在字符数据父节点里留下 `Text('')` 与 `<!--unhandledChild-->`（`<title>{cond && 'x'}</title>`、`<style>{dark && css}</style>` 的 false 分支）。B1 在字符数据模式下对结构注释同样插入而不认领，得到与 CSR 相同的 DOM（旧模型在这里抛错）。

#### 2.6.7 table、SVG

- **table：** `impliedTableBody` 的两头判定照旧（客户端 children 里没有显式分区元素，且 DOM 里 table 唯一的子节点是 TBODY），只是客户端一侧改为看描述的 `tag`。组件返回 `<tbody>` 的情况（#56）不受影响：这时 table 下还有 `<!--unhandledChild-->`，不满足「唯一子节点」。
  - B1 的实现（`DOM.resolveTopDownChildParent`）在客户端一侧也进入 Fragment 描述找分区元素：Fragment 在 table 这一层展开，服务端（`ssr.serializeTableContent` 的 `atTableLevel`）也把其中的分区元素算作 table 层。旧模型只看直接子元素，`<table><><tbody/></></table>` 会误判为隐含 tbody。
- **SVG：** 描述的 `isSVG` 与 CSR 同一规则（§2.2「isSVG」），认领比较标签与命名空间。#56 已定为「CSR 跟随解析器」，只针对 SVG 元素的静态子元素（`adoptSvgChildren`）。函数 / 组件 / 列表稍后渲染的同名标签在 CSR 里仍是 HTML 元素，与解析器不同；新模型会在认领处看到标签或命名空间不符，按 R1 报告并新建，得到与 CSR 相同的 DOM（B3）。

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
- **差异：** 只在「祖先元素的响应式属性绑定」与「后代子 Host 的渲染」之间的先后。子 Host 的**构造**顺序与 CSR 相同（§2.4），组件类型 id 的分配顺序不变；滚动样式 id 在激活时从服务端写出的类上回收（`getHydrateRollingStyleBase` / `reclaimRollingStyleId`），不按调用顺序分配。
  - 服务端已经把响应式属性的当前值写进了 HTML（X3），所以子组件的 `useEffect` 在 DOM 上读到的值与 CSR 相同。
  - 能观察到的只有 effect 的创建先后，最终 DOM 与更新结果不受影响。
  - 这一条是按源码推断的，没有在原型里验证。调用 `hydrateRoot` 的 15 个 spec 文件（含 `ssrStyles`、`styleContent*`、`ssrHydrate.lifecycle`）从 B1 起对内部入口再跑一遍（§7.2），B4 结束时全部通过，这就是对它的确认。
- **不变：** ref 的挂载、`useLayoutEffect` 的 attach 时机，以及 `useEffect` 在激活上下文之外执行，都不变（`ssrHydrate.lifecycle.spec.tsx` 覆盖）。select / option 的「props 在 children 之后」不变。

---

## 3. 受影响的契约与迁移

### 3.1 契约变化（对使用者）

| # | 写法 | 新模型下 | 迁移 |
|---|---|---|---|
| C1 | 组件函数体里持有 JSX 结果并调用 DOM 方法：`const input = <input/>; input.addEventListener(…)`、`.focus()`、`.appendChild()` | 是 `HydrationElement`，没有这些方法：生产环境 TypeError，开发期报告。这个值被闭包捕获时，激活结束后仍是描述（§3.1.1） | 改用 `ref`（`ref={el => …}` 或 `createRef`），在 ref 回调或 `useLayoutEffect` 里操作节点；事件用 JSX 的 `on*` props |
| C2 | 写属性：`el.className = 'x'`、`el.dataset.k = …`、`el.style.color = …` | 描述不可扩展：严格模式（ES module、TS 编译的 class）下 TypeError；非严格模式静默丢失；开发期报告 | 写成 JSX props 或响应式 atom |
| C3 | 读属性 / 测量：`el.textContent`、`el.getBoundingClientRect()` | 读到 `undefined` 或 TypeError；开发期报告 | ref + `useLayoutEffect` |
| C4 | `instanceof HTMLElement` 判断 JSX 结果（如检查 children 的形态） | 激活期间为 `false`，分支与 CSR 不同；运行时无法检测 | 不要按节点类型检查 JSX 结果；需要时用 `isHydrationElement`（导出）同时判断 |
| C5 | `RxList.map` 返回的行、普通数组里的元素 | 激活期间是描述；行被认领后，RxListHost / StaticArrayHost 把真实节点**写回**到 `list.data[i]` / `array[i]`（§3.3），激活完成后与 CSR 相同 | 只在激活期间（组件函数体、map 回调里）拿行当节点用时需要迁移，同 C1 |
| C6 | 在激活期间把 JSX 存起来，之后再渲染（`const panel = <div/>; () => open() ? panel : null`） | 第一次在激活中被认领；之后再渲染时用 `desc.node`，与 CSR 重复渲染同一个元素对象相同（元数据已被消费，`warnIfRenderingConsumedElement` 照旧提示） | 无 |
| C7 | 激活之外创建的现成节点作为 child | 按 CSR 插入，替换服务端对应位置的节点；开发期提示没有复用（§2.6.8） | 想复用服务端节点就在 JSX 里写 |
| C8 | `$name:_use` 传现成元素覆写 | 节点或描述都接受（判定统一） | 无 |
| C9 | Portal content、ref 时机、`useEffect` / `useLayoutEffect`、在用户回调里 `createElement` / `createRoot().render()` | 不变（用户回调里仍然退出激活上下文，得到真实节点） | 无 |
| C10 | 激活期间建好、但激活中**没有被渲染**的 JSX，激活结束后才第一次渲染。例如组件体里 `const rows = items.map(i => <li/>)` 只在关着的标签页里用，或 `const panel = <div/>` 只在 `() => open() ? panel : null` 的真分支里用 | 它们是没被消费的描述。之后经 CSR 路径渲染时，在 `createHost` 链尾的描述分支里按 CSR 物化，功能与 CSR 相同；但 DOM 形状多一个结构 Comment（作为元素 child 时多 `<!--unhandledChild-->`，作为列表行时按非 Compact 行多 `<!--rx list item-->`，作为数组项时多 `<!--array item-->`）。列表和数组里留下的是瘦身后的描述壳，每项一个小对象。开发期报告 `AXII_HYDRATION_ELEMENT_LATE_RENDER` | 把 JSX 的创建放进真正渲染它的函数子节点里（`() => open() ? <div/> : null`），激活之后才创建的 JSX 都是真实节点 |

描述只在 `hydrateRoot` 期间**创建**。被闭包、数据结构或模块变量持有的描述，在激活结束后仍是描述，它的影响可以晚到任何时候才出现（§3.1.1）。`createRoot().render()` 的 CSR 语义完全不变。

#### 3.1.1 被捕获的描述：生命周期与表现

这是本次契约变化里最容易到线上才暴露的形态。例如：

```tsx
function Search({}, {createElement}: RenderContext) {
    const input = <input/>                       // 激活期间：描述
    return <div>
        {input}
        <button onClick={() => input.focus()}>搜索</button>   // 用户点击时才执行
    </div>
}
```

CSR 下 `input` 是元素，这段代码正常；新模型激活时 `input` 是描述，`{input}` 能被正常认领并渲染，按钮也能点，但点击时 `input.focus()` 抛 TypeError。

**生命周期。**
1. 激活期间的 `createElement` 创建描述，`node` 为 `null`。
2. 所属 Host 消费到它的位置时认领服务端节点（或失配时新建），写入 `node`，瘦身为只剩 `node` 的小壳。
3. 框架释放自己对它的全部引用：`StaticHost.source` 换成元素，列表和数组写回节点（§3.3）。
4. 用户代码还持有它时，它就以这个小壳的形态一直存在，**永远不会变成节点**。激活中没有被渲染的描述（C10）停在第 1 步，直到激活之后第一次被渲染、按 CSR 物化时才写入 `node`；它本身同样仍是描述。

**各阶段的表现。** 同一个被捕获的描述，在哪个阶段被当作节点用，决定问题什么时候出现：

| 阶段 | 描述此时的状态 | 问题出现的时间 |
|---|---|---|
| 组件函数体（返回 JSX 之前） | 未认领，`node` 为 `null` | 激活期间，同步出现 |
| `useEffect`（组件的内层 Host 认领完之后同步执行，见 `ComponentHost.render` 先 `innerHost.render()` 再跑 effects） | 已认领，`node` 已写入，但仍是描述 | 激活期间，同步出现；未注册 `root.on('error')` 时 TypeError 会使 `hydrateRoot` 抛出 |
| ref 回调 / `useLayoutEffect` | 已认领；ref 回调拿到的参数是真实节点，只有闭包里另外捕获的描述有问题 | 激活期间（容器已在文档中，attach 在 `hydrateRoot` 返回前同步派发） |
| 激活之后的事件处理器、定时器、异步 effect、订阅回调 | 已认领的小壳 | **用户操作或异步回调执行时**，可能只在线上出现 |
| 激活中从未渲染（C10） | 未认领，`node` 为 `null` | 同上 |

**各种操作的表现。** 开发期（诊断开启）与生产只差「是否先报告」：

| 操作 | 例子 | 生产 | 开发期 |
|---|---|---|---|
| 读元素属性 | `input.value`、`el.textContent`、`if (box.checked)` | **静默**得到 `undefined`；后续的 `.trim()` 之类再抛 TypeError | 先报告 `AXII_HYDRATION_ELEMENT_ACCESS`（属性名、JSX 位置、迁移提示），再得到 `undefined` |
| 写属性 | `el.className = 'x'`、`el.dataset.k = …` | 严格模式（ES module、TS 编译产物）TypeError；非严格脚本**静默**丢失 | 先报告，再与生产相同（§3.4） |
| 调方法 | `input.focus()`、`el.addEventListener(…)` | TypeError：`… is not a function` | 先报告，再 TypeError |
| 当作节点传给 DOM API | `parent.appendChild(el)`、`observer.observe(el)`、`getComputedStyle(el)`、`a.contains(el)` | TypeError：参数不是 `Node` / `Element` | 同生产。DOM API 检查的是对象的内部槽，不经过 Proxy 的 get，开发期无法先报告 |
| 比较身份、判断类型 | `el === ref.current`、`set.has(el)`、`el instanceof HTMLElement` | **静默**得到 `false` | 同生产。框架自己的分派链也用 `instanceof` 判断描述，不能在这里报告 |

生产环境里静默的只有三种：读属性、非严格模式写属性、身份与类型比较。前两种在开发期都会被报告。第三种开发期也检测不到，只能靠文档与迁移说明（§3.1.2、D）。

**不转发到 `node`。** 考虑过让认领后的描述把属性和方法转发到 `node`，不采用：
- **认领之前没有可转发的对象：** 组件函数体里、C10 的描述 `node` 都是 `null`，转发救不了这两种。
- **转发只能救一半：** DOM API 的参数检查看内部槽，`appendChild(el)`、`observer.observe(el)` 照样 TypeError；`el === ref.current`、`instanceof` 照样是 `false`。`el.focus()` 能用而 `observer.observe(el)` 不能用，失败与否取决于调用写法，比统一失败更难排查。
- **生产也要 Proxy：** 转发必须拦截任意属性名，生产环境也得为每个元素分配 Proxy，框架读描述字段时都要经过 trap，激活变慢；DOM 方法以 Proxy 为 `this` 会抛 Illegal invocation，转发方法还要每次访问分配一个绑定函数，`el.focus !== el.focus`。
- **只在开发期转发更糟：** 开发期能用、生产 TypeError，问题只会在线上出现。

所以描述在两种环境里行为一致：不是节点，任何节点用法都失败；开发期在失败之前先报告并给出 JSX 位置。

**仍有的风险与缓解。** 用户操作才触发的那一行在开发期也要真的被执行才会报告，单靠开发期测试不能保证覆盖。缓解：
- 迁移说明（D）把「在组件函数体里把 JSX 结果存进变量，再在回调里当节点用」列为第一条要改的写法，并给出 ref 写法；
- `hydrateRoot` 在 D 之前保持「实验性」标注。

TypeScript 类型不能代劳：`JSX.Element` 要同时描述 CSR 的返回值（真实节点，契约不变），把它改成不透明类型会让 CSR 用户的合法代码编译失败，本设计不改类型。

#### 3.1.2 迁移面：README 与 `site/` 示例

在 `README.md`、`README-zh_CN.md`、`site/README.md` 与 `site/src` 的 40 个 `.ts` / `.tsx` 文件（`docs/snippets` 14 个、`examples` 12 个、`docs/docSections.ts`、页面与组件 13 个），共 43 个文件里搜索了下面两类写法，两类都覆盖全部 43 个文件：
- **JSX 结果赋给变量：** `(const|let|var) x(: T)? = (<Tag`，用脚本跨行匹配，再查该变量是否有成员访问或被当作参数。命中 0 处。
- **DOM API 的使用：** `appendChild`、`insertBefore`、`observe(`、`.focus(`、`instanceof …Element`、`as HTML*Element`、`getBoundingClientRect`、`addEventListener`、`.textContent`、`.style.`、`.classList`、`dispatchEvent`、`replaceWith`、`getComputedStyle`、`.contains(`。命中 13 行，逐行看过，没有一处作用在 JSX 结果上（见下）。

**结果：0 处需要迁移。**
- 示例里所有对节点的访问都经由 `ref` 或事件对象：
  - `site/src/docs/snippets/form.ts:15` 的 `ref={(el) => …}`；
  - `site/src/docs/snippets/rxdom-state.ts:23` 与 `RxDOMSizeExample`、`RxDOMRectExample`、`RxDOMScrollPositionExample` 的 `ref={x.ref}`；
  - `ComputedExample`（3 处）、`RxListExample`、`FormExample`、`AtomTwoWay` 的 `e.target as HTMLInputElement`。
- 最接近的写法是 `README.md:101` / `README-zh_CN.md:95` 的 `{items.map(item => <li>{item}</li>)}`：行直接作为 JSX child 渲染，没有被当作节点用，属于 C5，激活后写回为节点，不受影响。
- 其余命中都不是 JSX 结果：
  - `site/src/examples/PortalExample.tsx:19` 的 `appendChild(portalRoot)`、`site/src/components/CodeBlock.tsx:34–36` 的 `ta.style` / `appendChild(ta)` 操作的是 `document.createElement(…)` 的结果；
  - `site/src/router.tsx:35` 是 `window.addEventListener`；
  - `README.md:192`、`README-zh_CN.md:187`、`AtomTwoWay.tsx:10` 是正文或注释里提到 `addEventListener`。
- 调用 `hydrateRoot` 的 15 个 spec 文件里同样没有这种写法（同一个脚本只命中一处泛型参数 `<T>`，是误报）。

**搜不到的形态：** 把 JSX 放进对象或数组字面量再取出（`const refs = {input: <input/>}`）、写到 `this.x` 或外部模块变量、由 helper 函数返回后在别处使用。这些需要读调用链，脚本给不出结论；它们在示例里也没有出现。

**对 D 的影响：** 不需要改写任何现有示例。文档工作是新增「hydration 的契约变化」一节（README 中英各一节、站点 `ssr` 一节）：C1–C10 与 §3.1.1，给出一个 ref 改写的前后对照，并说明开发期报告的格式。

### 3.2 框架内部把 JSX 结果当节点用的地方（修一类）

下列调用点在新模型下都会拿到描述，判定统一用 `isHydrationElement`。组件路径上的几处在 B1 改（核心协议要用到），其余在 B4 改；B4 完成前 grep `createElement(` 的返回值在 `src/` 里的所有用法，补齐遗漏的。表中的改动都是**在旧判定之后追加**，CSR 下旧判定先命中，不增加 CSR 路径上的检查。

| 位置 | 现在 | 新模型 | PR |
|---|---|---|---|
| `ComponentHost.createHTMLOrSVGElement` | `node.listenerBoundArgs = …` 写在返回值上 | 写在描述的预置字段上，认领时转交 | B1 |
| 同上，`$name:_use` | `use instanceof Element` | `use instanceof Element \|\| isHydrationElement(use)` | B1 |
| 同上，`$name:_eventTarget` | 闭包捕获 `node` 并 `dispatchEvent(node, …)` | 派发时取 `isHydrationElement(node) ? node.node : node` | B1 |
| `reusable()` / `ReusableHost` 构造 | `createHost(source)` 在调用时执行 | 命中 `createHost` 末尾的描述分支；激活期间不物化（§2.6.9） | B4 |
| `impliedTableBody` | `c instanceof Element && TABLE_SECTION_TAGS.has(c.tagName)` | 认领步骤里看描述的 `tag`，表格分区标签集合共用 | B1 |
| `RxListHost.createChildHost` 的 Compact 判定 | `item instanceof HTMLElement && !detachStyledChildren` | 激活路径（`RxListHost.hydrate`）用 #68 落地的唯一判定；CSR 路径不变。激活中渲染过的行已写回为节点；只有 C10 的情形（激活中没渲染过）会以描述进入 CSR 路径，落到非 Compact 分支 | B2 |
| `StaticArrayHost` 的元素项判定 | `instanceof HTMLElement / DocumentFragment` | 激活路径看描述；CSR 路径不变 | B2 |
| `createHost` 的 ComponentNode 判定 | `typeof source?.type === 'function'` | 描述没有 `type` 字段（§2.2），不会命中；描述分支放在链尾 | B4 |
| `DOM.ts` `createElement` 组件分支的 Portal 预处理 | `isHydrating() && type.__axiiPortal` | 旧模型专用，过渡期不动，S 删除（§2.6.5） | S |
| `Form.tsx` 等内置组件 | 需逐一检查是否在渲染期把 JSX 结果当节点用 | 有则改为 ref | B4 |

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

- **对象种类：** 激活开始时（`beginHydration`）按 `isAxiiDiagnosticsEnabled()` 定一次：开启时 `createElement` 返回 `Proxy(desc)`，关闭时返回 `desc` 本身。同一次激活内不变。Proxy 只在开发期分配。
- **开发期 Proxy 的 trap：** 每个 trap 先判断要不要报告，然后把操作原样交给目标（`Reflect.get` / `Reflect.set`），所以开发期与生产的行为相同，只多一条报告。
  - **读：** 满足下面全部条件时报告 `AXII_HYDRATION_ELEMENT_ACCESS`：
    - 属性名是字符串，不是 §2.2 的预置字段，不属于 `Object.prototype`；
    - 属性名属于**这个标签**的元素接口：取 `document.createElement(tag)`（SVG 用 `createElementNS`）的原型，按命名空间和标签缓存；
    - 属性名不在框架探测名表里。这张表目前只有 `type`：`createHost` 用 `typeof source?.type === 'function'` 判定 ComponentNode，C10 的描述走到 `createHost` 时会读它，而 `type` 又是 `<input>`、`<button>` 的元素接口名。代价是开发期不报告用户读 `el.type`，这次读的结果仍是 `undefined`。

    报告内容包括属性名、JSX source（开发期有 `__source`）和迁移提示（「激活期间 JSX 返回的是描述，用 ref 拿节点」），同一个 JSX 位置和属性名只报告一次。
  - **为什么必须按标签：** 第一版草稿的规则是 `key in HTMLElement.prototype || key in SVGElement.prototype`。在 chromium 上核对过，`value`、`checked`、`href`、`type`、`src`、`disabled`、`selectionStart` 都不在这两个原型上，只在 `HTMLInputElement`、`HTMLAnchorElement` 等具体接口上，旧规则会漏报最常见的读法。`focus`、`textContent`、`dataset`、`style`、`getBoundingClientRect` 在两种规则下都能报告。
  - **语言与框架的探测不误报：** Promise 解析读 `then`、`JSON.stringify` 读 `toJSON`、测试读 `constructor`、`createHost` 读 `__axiiSource`，以及 symbol，都不是元素接口名。
  - **写：** 预置字段以外的任何写入都报告，然后 `Reflect.set` 到同一个不可扩展的目标并返回它的结果。目标拒绝写入时 trap 返回 `false`，严格模式下调用方得到与生产相同的 TypeError，非严格模式下同样静默丢失。框架代码都是 ES module，属于严格模式：框架内部要是往描述上写了预置字段以外的名字，开发期与生产都会抛错，不会出现「开发期只报告、生产才抛错」。
  - **调方法：** 读到 `undefined`（先报告），调用时 TypeError。
- **生产：**
  - 调方法抛 TypeError；
  - 严格模式下写未知属性抛 TypeError（`preventExtensions`），非严格模式静默丢失；
  - 读属性静默得到 `undefined`。

  各阶段、各操作的完整表现见 §3.1.1。
- **用例环境与两遍验收：**
  - **现状：** `vitest.config.ts` 定义了 `__DEV__: true`，`isAxiiDiagnosticsEnabled()` 在没有显式配置 `enabled` 时跟随 `__DEV__`，所以用例里诊断**默认开启**。但各文件的配置不同：
    - `auditSsrHydrate.spec.tsx`（含 11 条与 F1i）在顶层 `beforeEach` 里 `configureDiagnostics({enabled: false, …})`，走的是**生产**的裸对象；
    - `ssrHydrate.attrs-components / lifecycle / lists / smoke` 不配置，走 Proxy；
    - `ssrHydrate.mismatch` 有 31 处显式 `enabled: true`，走 Proxy；
    - 其余 8 个调用 `hydrateRoot` 的文件（`ssrStyles`、`styleContent*` 等），调用 `hydrateRoot` 的用例都在默认配置下运行，走 Proxy。`auditStylesFormsState`、`auditSsrCsrAttributeParity` 里的 `enabled: false` 只出现在不调用 `hydrateRoot` 的诊断用例里。

    所以现在的全量门禁不是「只覆盖 Proxy」，而是两组文件各只覆盖一种对象。
  - **验收（B4 起，S 之后保留）：** 调用 `hydrateRoot` 的 15 个 spec 文件在诊断开启、关闭下各跑一遍，两遍都全部通过。
    - **机制：** 测试辅助函数包住激活入口：调用期间把 `enabled` 设为这一遍的值，`onError` 等其余配置照旧，返回后恢复。描述的种类在 `beginHydration` 时定，所以这样就决定了这一遍拿到 Proxy 还是裸对象。文件里不经过激活的诊断断言不受影响，例如 `auditStylesFormsState` 的「the warning is diagnostics-only」。`configureDiagnostics` 只能整体替换配置，没有读取接口，所以这些文件的 `configureDiagnostics` 也改从测试辅助模块导入，由它记下最近一次配置以便恢复。
    - **怎样跑两遍：** 用 Vitest 3.2 的 `test.projects` 在 `vitest.config.ts` 里加一个只含这 15 个文件的项目，用 `define` 给出「这一遍」的常量。`npx vitest run` 一次跑完两遍，不新增门禁命令。
    - **为什么可行：** `reportAxiiError` 无论 `enabled` 与否都调用 `onError`（`diagnostics.ts` 的 CAUTION），`HydrationMismatchError` 的收集不受开关影响。
    - **例外：** 只在开发期出现的报告（`AXII_HYDRATION_ELEMENT_ACCESS` / `_LATE_RENDER` / `_LIVE_NODE` / `_ATTRIBUTE_RESIDUE` / `AXII_HYDRATION_INVARIANT`），断言按这一遍区分。
    - 不改 `src/`，不加运行时开关。过渡期（B1–B4）这个辅助函数同时决定调用旧入口还是内部入口（§7.2）。
- **文档：** README（中英）与站点 SSR 一节写明 C1–C10 与 §3.1.1，并给出 ref 迁移示例（D，范围见 §3.1.2）。

---

## 4. 失配时的报告与修复

### 4.1 不变量：位置对齐 ⇒ DOM ≡ CSR

激活过程中维持三条：
1. **按位置认领：** 每个被认领的节点，都位于 CSR 会放置对应节点的那个位置。游标只前进，认领只取游标处或游标之后的节点，并删除两者之间的节点。
2. **递归对齐：** 被认领的元素递归对齐子节点；被认领的 Text 按值比对，漂移时替换；被认领的 Comment 按 data 匹配。
3. **清扫：** 每个父节点消费结束时，剩余的未认领节点全部删除。

由这三条可以推出：**无论失配时选择怎样重同步，最终 DOM 的节点结构（类型、标签、命名空间、顺序）、文本、结构 Comment，以及客户端 props 写下的属性，都等于 CSR 结果**。选择只影响有多少服务端节点被复用，不影响正确性。这让恢复规则可以偏向「保留 identity」而不冒错误绑定的风险。

**属性的边界。** 被认领元素上服务端**独有**的属性（客户端 props 不写的名字）不在上面的保证里。这是现在 M-06 以来的行为：认领时只按客户端 props 写一遍，不删多出来的。新模型的处理：
- **失配路径上的认领清掉独有属性：** R1 的近似认领（id 漂移、向前查找后认领），以及同一父节点里已经报告过失配之后的认领，都是在应用 props **之前**就知道「这次认领可能跨了角色」的情形。这时先清空该元素的全部属性（先读走 `data-axii-ssr` 样式类），再按客户端 props 应用，结果与 CSR 新建相同。只在失配路径上发生，匹配路径零成本。
- **干净认领不清理：** 失配在稍后才暴露的情形里，独有属性可能残留。例如客户端 `[span a, span b]`、服务端只有 `[span b′]`：`span a` 干净地认领了 `b′`，`span b` 到末尾才失配。
- **开发期报告：** 诊断开启时，每次认领比较服务端属性名与客户端 props 会写的属性名，报告独有属性（`AXII_HYDRATION_ATTRIBUTE_RESIDUE`），残留不会静默。
- B3 漂移 fuzz 的判定与这条边界一致（§7.4）。

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

- **属性：** R1 的近似认领，以及父节点已报告失配之后的认领，先清空属性再应用 props（§4.1「属性的边界」）。
- **R1–R3 的向前查找只在同一个父节点内**，最坏是 O(该父节点剩余节点数)，而且只在失配时发生。
- **可选的重同步启发式：** 例如 F4c 里跳过服务端结构态函数的 `…computed node, axii:0` 以保住后面兄弟的 identity。按 §4.1 它们不影响正确性，但必须在漂移 fuzz（B3）落地之后才能加。本设计不要求。

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

逐条读过 `ssrHydrate.mismatch.spec.tsx` 的断言并按 R1–R5 走查过的用例：wrong-tag child（带 id / 不带 id）、interstitial extra element、multiple interstitial junk、swapped sibling tags、middle wrong-tag、same-tag interstitial wrong-id、swapped same-tag ids、multiple same-tag interstitial junk、trailing junk 五条（含 after RxList）、hydrate-root 前后杂节点、容器前导 STYLE / SCRIPT / LINK、portal 容器前后杂节点、tampered ElementChildText、tampered atom Text-ph、missing axii:0、Comment-ph 漂移三条（atom、G4-F、PrimitiveHost）。其中元素级用例都通过 R1 / R5 保持原断言：
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

- **上表的「新模型」一列是 S 合入后的状态。** 过渡期（B1–B4）旧模型的检查都还在，另外 `createElement` 多一次整数比较，逐个 PR 的 CSR 代价见 §7.3。
- **Host 不新增字段。** 原型方法 `hydrate` 不占实例空间。`__axiiHydrated`、`__axiiHydrating` 等挂在实例上的临时字段一并删除，减少了隐藏类分叉。
- **元素不新增字段。** 描述是独立对象，不挂在元素上。

### 5.2 内存

- 描述只在激活期间存在：
  - 消费后瘦身；
  - `StaticHost.source` 换成认领的元素；
  - 列表和数组写回（§3.3）。
- 激活完成后的常驻对象与 CSR 渲染同一棵树相同。
- 验收：`retainedObjectDiagnostics` 的「hydrate + destroy 后所有计数归零」照旧；B2 新增一条，确认激活 N 行列表后 `list.data` 里没有描述。
- **C10 的量化（D2，B4 验收）：** 激活中没有渲染过的列表（标签页、折叠区），之后第一次渲染时每行都是非 Compact 行，外加一个描述壳。B4 用 `retainedObjectDiagnostics` 对同一个 N 行列表比较两种情形：CSR 首次渲染，与「激活中建好、激活后才渲染」。给出每行多保留的对象数，按类型列出：Host（`StaticHost` 取代 `CompactElementHost`）、placeholder Comment、描述壳。数字写回本文。数字不可接受时，再考虑在 `createChildHost` 的非 Compact 分支上加一次描述判定，那是 CSR 列表新行路径上的一次常驻检查。

### 5.3 测量方法与原型数据

**测量方法（PR-A、B1、S 的验收都用它，见 §7.3）：**
1. **构建：** 生产构建 `npm run build`，三份放在同一页面：A 是 origin/main，A′ 是 A 的逐字节副本（A/A 对照），B 是改动后的构建。**每份构建各一份负载模块**：内容逐字相同、URL 不同，各自导入自己那份构建。三份构建共用一个负载函数的话，调用点在三份构建之间多态、反复去优化（PR-A 的一次 10 轮预热 + 10 轮的追踪里去优化 67 次），噪声比要测的差别还大。
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
- **结论：** 在这台高负载机器上，低于约 1% 的差别分辨不出来，原型数据只能说明「没有可见回归」。PR-A、B1、S 必须按上面的方法（单次 ≥ 100 ms、低负载）重测，作为验收。

---

## 6. 11 条 `test.fails` 的映射

两列 PR 的含义（§7）：「内部入口上通过」是这条用例对不导出的内部入口那一遍（§7.2）开始通过的 PR；「`test.fails` → `test`」是公开的 `hydrateRoot` 切到新模型、把它改成 `test` 的 PR。

| 用例 | 现在的失败机制（§1.2） | 新模型下为什么通过 | 内部入口上通过 | `test.fails` → `test` |
|---|---|---|---|---|
| F1b | 父级的 `<p>` 先于子组件认领，按后序拿走子组件的 `<p>` | App 的 `<div>` 先认领；`<Header/>` 在自己的位置渲染、消费 `<header>…</header>`，再认领 `unhandledChild`；然后 `<main>` 认领 main，`<p>` 认领 main 里的 `<p>` | B1 | S |
| F1f | 同上，组件输出比后面兄弟里的同标签元素浅 | 同上；不存在跨位置认领，也不会 `insertBefore` 挪动节点 | B1 | S |
| F1g | 同上，函数子节点 | FunctionHost 在自己的位置求值，消费 `<p>f</p>`，再认领 `computed node`、`axii:0` | B1 | S |
| F1h | 同上，抛错 | 同 F1b | B1 | S |
| F1j | 原始元素认领自己时搜到自己标记里的同标签节点 | 原始元素在游标处按位置认领，内容不透明（§2.6.2） | B1 | S |
| F3a | 文本态函数向前搜索，拿到结构态函数的锚点 | 每个函数先消费自己的内容，再在游标处认领自己的锚点；不向前搜索 | B1 | S |
| F3b | 外层函数拿到内层函数的锚点 | 内层的内容与锚点先被消费；外层在内层之后认领自己的 `computed node` 与 `axii:0` | B1 | S |
| F4a | 多出的客户端行静默缺失 | R1：插入新行并报告（§4.3） | B3 | S |
| F4b | 多出的服务端行静默留下 | R3：向前找到列表锚点，删除多余行并报告 | B3 | S |
| F4c | 文本插在 FTS 尾部，服务端元素静默留下 | R2 + R1 + R5：替换、插入、清扫并报告 | B3 | S |
| F4d | 抛错 | R1 + R3 + R4：新建 `<b>`、插入 `computed node` 和 `Text('')`，并报告 | B3 | S |

**为什么分在 B1 和 B3：** F1b–F3b 只要求匹配路径上的认领协议，B1 就够。F4a–F4d 是失配用例，要等 B3 的 R1–R5。B1、B2 的内部入口遇到失配会报告 `HydrationMismatchError` 并抛出，不做修复；内部入口不公开，这样做没有影响。F4a、F4b 还用到列表，B2 之后才具备条件。

**`hydrateKnownDefect` 的连带：** `test.fails` 的守卫要求失败形态是「断言失败」，或者是「抛出匹配 reason 的错误」。这个守卫只用在旧入口那一遍。内部入口那一遍里，这 11 条是普通的 `test`，在上表「内部入口上通过」的 PR 之前标为待实现（§7.2）。S 删除旧入口那一遍，把 `test.fails` 改为 `test`，断言正文不改。

---

## 7. 实现 PR 拆分

第一版把切换、认领协议和 R1–R5 放进一个原子的 PR-B。理由是：`createElement` 一旦返回描述，所有消费它的地方都必须同时改。这个前提只对**公开的** `hydrateRoot` 成立。如果新模型只在一个不导出的内部入口下启用，`createElement` 只在这个入口激活时返回描述，消费描述的各个 Host 就可以分几次实现。必须原子的只剩「把 `hydrateRoot` 切过去」这一步。本节按这个思路重新评估并改写拆分。

### 7.1 评估：新模型经内部入口分步落地

**结论：可行。** 依据是读 `DOM.ts` 的 `createElement`、`hydration.ts`、`render.ts` 和各 Host 的激活路径得到的下面五点。

**1. 新模型的代码是新增的，不改旧模型的代码。**
- 描述、新游标、认领步骤、`createHydrateHost`、各 Host 的 `hydrate(slot)` 原型方法、R1–R5 都是新的函数和方法。
- 旧模型的激活逻辑都在 `createElement` 的循环和各 Host 的 `render()` 里，由 `isHydrating()` 守卫。
- 新模型激活期间不调用任何 Host 的 `render()`：
  - Host 由 `createHydrateHost` 创建，由父级调用 `hydrate(slot)`；
  - 失配新建在 `runOutsideHydration` 里按 CSR 渲染，此时模式为「无」；
  - 激活结束后的更新走 CSR。
- 所以只要新模型激活时 `isHydrating()` 为假，旧分支一条都走不到，也不用改。
- 旧模型还有一些状态不经过 `isHydrating()`，逐个核对过（grep `__axiiHydrat`、`isHydrateOnMainRoot`、`isElementChildCursorActive`、`getChildCursor`、`isHydrateDeferredElement`，`hydration.ts` 之外）：
  - `ReusableHost.render` 的 `isHydrating() || this.__axiiHydrating`（`ComponentHost.ts:1079`）：这个字段只由 `StaticArrayHost.ts:180`、`RxListHost.ts:154` 写入，两处都在 `isHydrating()` 守卫的旧分支里；
  - `__axiiHydrated`、`__axiiHydrateListParent` / `__axiiHydrateListStart`、`__axiiHydrateDirectNodes`、`__axiiHydrateItemHosts`、`__axiiFragmentHydrateChildren`：只在 `createElement` 的 `hydrating &&` 分支和 `StaticArrayHost` / `RxListHost` 的旧分支里读写；
  - `isHydrateOnMainRoot`、`isElementChildCursorActive`、`getChildCursor`、`isHydrateDeferredElement`：只在 `createElement` 的旧分支和旧模型的函数里调用（`ensureHydrateDeferredPortalContent`、`rematerializeDeferredFragmentChildren`、`materializeHydrateDeferred`、`shouldMarkHydrateReclaim`、`hydratePortalContent`）。

  新模型激活时这些字段不会被写、这些函数不会被调用，它们同样走不到。

**2. 状态：一个模式变量。** `hydration.ts` 的布尔量 `hydrating` 换成 `hydrationMode`，取值为「无 / 旧 / 新」：
- `isHydrating()` 继续表示「旧模型激活中」，旧模型的调用点一行不改；
- 新增 `isAnyHydrating()`，表示「任一模型激活中」；
- `runOutsideHydration` 保存并恢复两个模型的状态，执行回调期间把模式置为「无」；
- S 删除旧模型后，`hydrationMode` 退回布尔量，`isAnyHydrating()` 改名回 `isHydrating()`。

**3. 现有 20 个 `isHydrating()` 调用点（`hydration.ts` 之外）逐个归类：**

| 类别 | 调用点 | 过渡期 | S 之后 |
|---|---|---|---|
| 旧模型专用（13 处） | `DOM.ts`：`ensureHydrateDeferredPortalContent`（:754）、组件分支的 Portal 预处理（:988）；`createHost.ts`：`EmptyHost.render`（:26）、`PrimitiveHost.render`（:58）、元素分支两处（:154、:156）；`AtomHost.render`（:97）；`StaticArrayHost`（:71）；`RxListHost` 三处（:107、:118、:242）；`StaticHost.render`（:1011）；`ReusableHost.render`（`ComponentHost.ts:1079`） | 不动。新模型激活时 `isHydrating()` 为假，这些分支都不会被走到 | 随旧模型删除 |
| 两个模型共用的语义（3 处） | `ComponentHost.ts:817`（`useEffect` 退出激活上下文）、`render.ts:311`（`root.dispatch` 退出激活上下文）、`StaticHost.ts:361`（滚动样式 id 从服务端类回收） | 改为 `isAnyHydrating()`。仍是一次全局读加一次比较，成本不变 | 保留，名字改回 `isHydrating()` |
| 需要按模式分流（4 处） | `DOM.ts:1006` `createElement` 开头；`FunctionHost.ts` effect 回调里文本快速返回之后的两处：Comment-ph 文本（:201）与结构路径（:232）；`Portal.tsx:90` | `createElement`：读一次模式，为「新」时返回描述（7.3）。`FunctionHost`：effect 回调在 `if (this.textNode)` 快速返回之后读一次模式，按「旧 / 新 / 无」三路分流，新模型的首次运行在这里认领；文本更新的快速路径不受影响。`Portal`：B4 加新模型分支，之前在新模型下显式抛错 | 只剩新模型的分支 |

只有 `createElement` 那一处在热路径上，代价见 7.3。

**4. 公开入口走不到新模型。**
- 内部入口放在自己的模块里，`src/index.ts` 与 `ssr.ts` 都不导出它，`src/` 里也没有别的地方导入它。
- 构建时它会被 tree-shaking 去掉，公开产物里没有任何代码把模式置为「新」。留在产物里的新模型代码（描述类、Host 的 `hydrate` 原型方法、`createHydrateHost`、R1–R5）都执行不到。
- 这一点不靠推断，作为每个 B PR 的验收来检查：`npm run build` 后，`dist/axii.js` 与 `dist/axii.cjs` 里找不到内部入口独有的字符串（例如它自己的报错文本；构建会改写标识符，但保留字符串字面量）。每个 PR 同时报告产物大小的变化。

**5. 不是 §9 否决的运行时开关。**
- 使用者无法选择模型：内部入口不导出，产物里也没有它。
- 旧模型在 S 删除。两套模型只在 B1 到 S 之间同在 main 上，并且只有旧模型可达。
- 第一个实现 PR（B1）就在真实 Host 上落地认领协议：`StaticHost`、`ComponentHost` 与 innerHost 共享 placeholder、`FunctionHost`、`AtomHost`。§9 列出的最大风险因此最先得到验证。所有用例的根都是组件，B1 必须包含这几种 Host。

### 7.2 测试怎样先对内部入口跑

- **激活入口的辅助函数：** 调用 `hydrateRoot` 的 spec 文件在 B1 改为调用测试辅助函数 `hydrate(container, source, options?)`（`__tests__/helpers/hydrate.ts`）。替换是机械的。辅助函数按「这一遍」调用 `hydrateRoot` 或内部入口；B4 起还按这一遍设置诊断开关（§3.4）。
  - 设计时（`36e540c`）是 15 个文件、208 处；B1 落地时（`473b3a5`，其间 #56、#68、#73 等新增了激活用例）是 19 个文件、223 处，全部改为经辅助函数激活。`vitest.config.ts` 的 `TOP_DOWN_HYDRATE_SPECS` 列出这 19 个文件；新增调用激活的 spec 文件时加进这张表。
  - 注意：在调用激活之前求值的 JSX 元素（`hydrate(el, <p/>)`、`hydrate(el, createElement('span', null))`）是激活之外创建的现成节点，内部入口上走 §2.6.8 的路径（B4），不是元素描述；根是组件、函数、原始值时不受影响。
- **两遍：** `vitest.config.ts` 用 Vitest 3.2 的 `test.projects`：
  - 现有项目照旧跑全部用例，走 `hydrateRoot`（旧模型）；
  - 新增一个只含这 15 个文件的项目，用 `define` 指定走内部入口。

  `npx vitest run` 一次跑完，三道门禁的命令不变。
- **待实现标记：** 内部入口那一遍里，用到尚未实现的形态的用例，用一个辅助函数 `pendingTopDown('B2')` 标出：这一遍跳过，旧入口那一遍照常运行。写法是 `test.skipIf(pendingTopDown('B2'))(…)`；按表生成的用例把条件写进 skipIf（例如只跳过激活的那些行）。只标两种失败：内部入口显式抛出的「not implemented yet」，与对故意改动过的服务端 HTML 报告并抛出的 `HydrationMismatchError`（修复在 B3）；未改动的 `renderToString` 输出在内部入口上失配是实现缺陷，不能用标记盖住。每个 PR 关掉标记跑一遍内部入口，确认被标记的用例都按上面两种方式失败。
  - 未实现的形态在内部入口下显式抛错（「top-down entry: <kind> not implemented yet」），不回退到旧模型，也不静默。
  - 每个 PR 的验收写明内部入口那一遍「通过 / 待实现」的用例数，以及它去掉了哪些标记。
  - B4 要求标记数为 0。
- **11 条：** 旧入口那一遍仍是 `test.fails` 加 `hydrateKnownDefect` 守卫；内部入口那一遍是普通 `test`，在 §6「内部入口上通过」的 PR 之前标为待实现。
- **F1i：**
  - 现有的 F1i 生成器含列表行，在内部入口那一遍从 B2 起运行；
  - 扩展后的生成器（去掉对组件、函数子节点、Fragment、含自身标签的原始标记的排除）在 B2 加入，S 之前只在内部入口那一遍运行，因为旧模型不支持它新增的形态；
  - S 用扩展后的生成器取代现有的，只扩大覆盖，不放宽断言。
- **白盒用例：**
  - `ssrHydrate.claimCorners.spec.tsx` 直接调用旧模型的内部函数，只在旧入口那一遍运行；
  - 其中「hydrateRoot end-to-end claim corners」一组改用辅助函数，两遍都跑；
  - 新游标 API 的白盒用例随代码进来（B1：文本单元、`axii:0`、字符数据父节点；B3：R1–R5）；
  - 旧的白盒用例留到 S 删除，S 的报告逐条给出对应关系（§8，D3）。

### 7.3 逐个 PR 的 CSR 代价

| PR | CSR 热路径上的变化 | 测量 |
|---|---|---|
| PR-A | `createElement` 的「应用 props」与元数据路径拼接改为调用共用函数，做的事不变 | §5.3 的 A/B/A′，`createElement` 与 `render` 两组负载 |
| B1 | `createElement` 开头：现在读一次 `hydrating`；改为读一次 `hydrationMode`，多一次整数比较（为「新」时返回描述），之后的 `hydrating` 由同一次读得出。其余热路径不变：共用语义的 3 处成本不变；`FunctionHost` 在文本快速返回之后仍是一次读；§3.2 的 `_use` / `_eventTarget` 追加在旧判定之后 | §5.3 的 A/B/A′，`createElement` 负载 |
| B2 | 无。新增的是 `RxListHost.hydrate` / `StaticArrayHost.hydrate`，`createChildHost` 不动 | 不需要；照常跑 `rxListFuzz` |
| B3 | 无 | 不需要 |
| B4 | `createHost` 链尾的描述分支：常见类型在它之前就返回，到不了；`Portal` 渲染多一次比较，不在热路径上 | 不需要 |
| S | 去掉旧模型的全部检查，得到 §5.1「新模型」一列 | §5.3 的 A/B/A′，三组负载，基线是 PR-A 之前的 main |

### 7.4 PR 列表

| PR | 内容 | 内部入口上转为通过 | 验收 |
|---|---|---|---|
| **PR-A：共用函数与契约（不改行为）** | 把 `createElement` 里「props 在 children 之后、`value` / `checked` 延后」的应用 props 与元数据路径拼接各收成一个函数（§2.6.1）。CSR 与旧模型的激活分支同在 `createElement` 里，都改用这两个函数；B1 的认领步骤再复用。`data0Contract.spec.tsx` 加入 §3.3 的写回契约。不碰任何旧模型专用的代码 | 无 | 三道门禁全绿；A/B/A′（7.3）；新契约用例 |
| **B1：核心认领协议（匹配路径）** | `hydrationMode` 与 7.1 的三类调用点处理；`HydrationElement`、`isHydrationElement`、预置字段名用例（§2.2）；`createElement` 的新模型分支；节点指针游标（只给新模型用）；认领元素的步骤（§2.6.1，含原始标记、textarea、隐含 tbody、字符数据父节点、SVG）；`createHydrateHost`；根、`StaticHost`（元素与 Fragment）、`ComponentHost`、`FunctionHost`、`AtomHost`、`PrimitiveHost`、`EmptyHost` 的 `hydrate(slot)`；§3.2 里标为 B1 的调用点；开发期不变量（§4.4）；内部入口；7.2 的辅助函数与内部入口那一遍；新游标的白盒用例。失配时报告并抛出；列表、数组、Portal、`reusable`、`lazy`、现成节点显式抛错 | F1b、F1f、F1g、F1h、F1j、F3a、F3b | 三道门禁全绿（旧入口那一遍不变，11 条仍按预期失败）；内部入口那一遍全绿，列出通过 / 待实现数；A/B/A′；产物检查（7.1 第 4 点）与产物大小 |
| **B2：列表与数组** | 前提：#68 已合入（§2.6.4）。`RxListHost.hydrate`：Compact 用 #68 的判定，含嵌套 RxList 与写回；`StaticArrayHost.hydrate`：DirectNodes 与写回；扩展后的 F1i 生成器与 §2.4.1 的种类计数比较（已落地的种类） | 无新的 `test.fails`；现有 F1i、`ssrHydrate.lists` 在内部入口那一遍通过 | 三道门禁全绿；`rxListFuzz`；扩展后的 F1i（300 棵：DOM ≡ CSR、无报告、服务端节点全部保留、监听器在自己的位置）；种类计数逐树相等；F1d 增长倍数接近 4 倍（线性，内部入口）；激活后 `list.data` 里没有描述（§5.2）；产物检查 |
| **B3：失配规则** | R1–R5（§4.2）；属性的边界（§4.1）；失配新建的元数据并入所属 StaticHost；R1–R5 的白盒用例；漂移 fuzz：在扩展后的 F1i 树上随机注入行增减、元素 ↔ 文本、标签替换、插入杂节点、删除标记、文本篡改，断言节点结构、文本、客户端 props 写下的属性与 CSR 相同，至少一条报告，从不静默，服务端独有属性只出现在已有报告的树里 | F4a、F4b、F4c、F4d；`ssrHydrate.mismatch` 在内部入口那一遍通过，§4.5 的断言保持 | 三道门禁全绿；漂移 fuzz 300 棵 × 多种注入；产物检查 |
| **B4：其余形态与开发期检测** | Portal / `createPortal`（新游标栈）；`reusable()` 与 `createHost` 链尾的描述分支（C6、C10）；`lazy`；现成节点与 NodeHost（§2.6.8）；§3.2 里标为 B4 的调用点（含 `Form.tsx`）；开发期 Proxy 与各条开发期报告（§3.4）；诊断开、关两遍（§3.4）；C10 的量化（§5.2） | 剩下的待实现标记全部去掉 | 三道门禁全绿；内部入口那一遍 15 个文件、待实现 0、诊断开关两遍都全绿；种类计数要求覆盖全部种类（§2.4.1）；C10 每行多保留的对象数写回 §5.2；内部入口激活加销毁后 `retainedObjectDiagnostics` 计数归零；产物检查 |
| **S：切换** | `hydrateRoot` 改用新模型（内部入口的实现就是它）；删除旧模型：§2.8 的代码、7.1 表里旧模型专用的 13 处、按模式分流处的旧分支与 `createElement` 循环里的旧分支、旧的 `hydratePortalContent`；`hydrationMode` 退回布尔量；删除旧入口那一遍与辅助函数里的入口切换（保留诊断开关两遍）；11 条 `test.fails` 改为 `test`；删除旧的 `claimCorners` 白盒用例并逐条给出对应（§8）；更新 `auditSsrHydrate` 的文件头注释、F1 的 describe 标题与 #54 留下的「已知局限」注释；`ssr-support.md` §3.1 / §3.7 的正文 | 11 条在公开的 `hydrateRoot` 上通过 | 三道门禁全绿（含诊断开关两遍）；`rxListFuzz`；A/B/A′（基线为 PR-A 之前的 main）；开发期不变量在全量用例下不报告；除接线外没有新逻辑，diff 以删除为主 |
| **D：文档** | README（中英）、站点 `ssr` 一节：新增「hydration 的契约变化」，内容是 C1–C10、§3.1.1 与 ref 改写的前后对照（范围见 §3.1.2）；去掉「实验性」标注与 #54 的已知局限；CHANGELOG 条目交给 #61 汇总 | — | 站点检查脚本（`check-doc-coverage`、`check-exports`）；门禁全绿 |

每个 PR 都单独满足「门禁全绿、可以合入 main」。哪一个中途停下，main 上留下的都是一份完整、不可达、有用例覆盖的新模型子集，不是一条合不进去的分支。

### 7.5 发布

- 建议在 B1 合入到 D 合入之间不发版。
- 必须发版时：公开行为不变（7.1 第 4 点），只是包体积变大；数字见各 PR 报告的产物大小。
- S 与 D 之间发版，会发出改了契约却没有迁移说明的版本，所以 D 应紧跟 S 合入。

### 7.6 B1 落地记录（与上文不同或上文没有写到的）

- **模块：** 描述、slot 常量与「待实现」错误在 `src/hydrationElement.ts`；节点指针游标在 `src/hydrationCursor.ts`；认领步骤是 `DOM.hydrateElementDescription`；分派是 `createHost.createHydrateHost`；各 Host 的 `hydrate(slot)` 是原型方法；根由 `render.createRootInternal` 的 `topDown` 参数走 `createHydrateHost(source, 'root')`；内部入口是 `src/hydrateTopDown.ts`。模式变量与 `beginTopDownHydration` / `endTopDownHydration` 在 `hydration.ts`，后两者只有内部入口调用，随它一起被 tree-shaking 去掉。
- **导出面：** 认领步骤要调用 `applyElementProps` / `liftElementMetadata`（PR-A 交接：挪模块会循环导入），所以写在 `DOM.ts` 里，以 `@internal` 导出给 `StaticHost`。`src/index.ts` 是 `export * from './DOM'`，它因此在包的导出面上可见，与已有的 `materializeHydrateDeferred` 等旧模型内部函数同类。`isHydrationElement` 还没有从 `src/index.ts` 导出（C4 说它导出），留给改变契约的 S / D。
- **元数据提升：** 认领步骤按 CSR `createElement` 循环的同一段规则提升 `unhandledAttr` / `refHandles` / `detachStyledChildren`（`liftElementMetadata`，ref / detachStyle 的项不继承 source）。PR-A 交接建议把「四类各调一次」收成一个共用函数；没有收：CSR 那一段在热路径上，共用函数要返回三个累加值，只能分配或者借模块状态，而旧模型的 `materializeHydrateDeferred` 会在循环中途重入 `createElement`。两处各有 CAUTION 互相指向，`hydrateTopDown.spec` 断言激活后的路径、顺序、元素位置与 CSR 逐项相同。`unhandledChildren` 不提升：子 Host 由 `StaticHost.hydrate` 预先构造。
- **子 Host 的预先构造：** `StaticHost.hydrate` 先按文档顺序收集描述子树里的动态 child（`collectTopDownDynamicChildren`，path、source 与 CSR 提升后的 `unhandledChildren` 相同），像 `collectInnerHost` 一样构造（单个直接存、多个共享 hostPath 节点），认领遍历走到动态 child 时依次取出、`hydrate(slot)`。`createTopDownInnerHost` 是 `createInnerHost` 的另一份，两处互相指向。
- **原始标记元素的 JSX children：** 不消费，也不为它们构造 Host（§2.6.2）。CSR 会为它们构造 Host、渲染进被 innerHTML 摘掉的 placeholder；这是开发期警告过的误用（I66），DOM 两边相同。
- **激活中止：** B1 / B2 的失配用 `reportHydrationMismatch` 报告，抛出同一个错误。激活期间 `root.dispatch('error')` 把失配与「待实现」错误（`isTopDownAbort`）当作未消费，组件在激活中注册的 `root.on('error')` 不会吞掉它们；`FunctionHost` 结构态在新模型里不「渲染为空」，向上抛出。
- **容器：** 容器这一层的 STYLE / SCRIPT / LINK 在认领时跳过（期望的正是同标签元素时不跳；服务端样式 `data-axii-ssr` 永远跳过）。根认领 `<!--root-->` 之后，容器上只能剩下这三种；迁移服务端样式之后，激活区间之外还有节点是失配（B1 报告并抛出，清扫是 B3 的 R5 / D13）。
- **根：** 内部入口创建的 root 只有第一次 `render` 走激活；之后 `root.destroy()` 再 `render`（包括激活中 error 监听器销毁 root、渲染错误提示）都是 CSR。激活中 root 被替换时（`root.render` 的重入说明），激活的树整体丢弃，入口不再对它做容器检查与不变量检查；其中已报告过的失配不重复报告。
- **同一个描述出现两次：** 一次激活里同一个 JSX 元素被渲染第二次（`const s = <span/>; <div>{s}{s}</div>`，或激活中存下的 JSX 再次渲染，C6）时，描述已经认领、瘦身，显式抛「待实现」错误（B4 的「已有 `node` 就当作那个元素」分支），不再在空的 `rawChildren` 上 TypeError。
- **lazy、reusable：** `lazy()` 的包装组件带 `__axiiLazy` 标记，`ComponentHost.hydrate` 见到它显式抛错（B4）。`reusable(x)` 在组件函数体里用 CSR 的 `createHost` 构造 innerHost，x 是描述时在 `createHost` 链尾（§2.2「事后渲染」的位置）显式抛错（B4）；`ReusableHost` 作为 source 进入 `createHydrateHost` 同样抛错。
- **开发期不变量（§4.4）：** 在内部入口里检查，违反时以 `HydrationInvariantError`（`code: 'AXII_HYDRATION_INVARIANT'`）经 `reportAxiiError` 报告，不抛出。S 把内部入口变成 `hydrateRoot` 的实现时随之进入公开路径。

---

## 8. 既有用例的预期变化（逐条）

**`__tests__/auditSsrHydrate.spec.tsx`：**
- S：11 条 `test.fails` 改为 `test`，断言正文不改。
- S：文件头注释、F1 的 describe 标题与 #54 留下的「已知局限」注释同步更新。
- B2 加入、S 取代现有生成器：F1i 生成器去掉对组件、函数子节点、Fragment、含自身标签的原始标记的排除，覆盖面扩大，不放宽任何断言（§7.2）。

**`__tests__/ssrHydrate.claimCorners.spec.tsx`（白盒，直接调用 `src/hydration.ts` 的内部函数）。** 以下用例针对的函数在新模型中删除，由同一行为在新游标 API 上的用例替换。
- 替换用例随新模型的代码进来：文本单元在 B1，R1–R5 在 B3。
- 旧用例在 S 删除。
- S 的报告逐条列出「删除的用例 → 有名字的替换用例或黑盒用例」（D3）。凡是写「由 fuzz 覆盖」的，必须指出是生成器里的哪种形态，下表已按这个要求写。

| describe | 用例 | 处理 |
|---|---|---|
| `claimTextUnit / claimEmptyTextPh corners` | 全部 8 条 | 行为保留（R2 / R4）；改调新游标上的同名函数 |
| `cursor comment claiming corners` | `advanceCursorUntilComment` 抛错、`claimComputedNodeBefore` 抛错、`claimFragmentStartBefore` 两条、`claimEmptyHostCommentBefore` 抛错、`claimEmptyHostComment` 扫描根 | 函数删除；以 R3（结构 Comment 认领、向前查找、插入）的用例替换 |
| | `claimCommentAtCursor` 抛错 | 改为 R3 的「找不到 → 插入并报告」。**这是行为变化：现在抛错，新模型报告并修复**，与 §3.7「生产不整页失败」一致 |
| `claimTextBeforeCommentPlaceholder corners` | 3 条 | 函数删除（Comment-ph 在游标处认领文本）；以 Comment-ph 的游标用例替换。其中「元素紧挨在 placeholder 前面时抛错」变为 R2 的替换并报告 |
| `stripAxiiTextBoundariesBetween` | 1 条 | 函数删除；Fragment 内容在同一遍消费中去掉包边。黑盒：N2 系列（`auditSsrHydrate`「N2 Fragment with an element that has its own dynamic child, followed by a dynamic sibling」）；fuzz：扩展后 F1i 生成器的「Fragment 描述作为元素 child，子节点含静态文本与 atom」形态 |
| `element claim cursor paths (§3.7 D-series at cursor)` | 7 条 | 行为保留（R1）；改调新 API。「same-tag empty-id defers claiming」与「same-tag without id rejected when children do not fit」两条服务于 Portal 提前认领与 EmptyHost 布局壳的推断，在新模型中没有对应情形，删除，由 k15–k19 黑盒用例覆盖 |
| `element claim deep-walk candidate fits` | 5 条 | 深度遍历与候选适配推断删除；对应的黑盒用例（`ssrHydrate.lifecycle` 的 Portal 系列）保留 |
| `claim helpers error contracts` | `createElementForHydrateMismatch` 两条 | 改为 R1 新建的用例（含 SVG 命名空间） |
| | `claimElement` 两条 | 函数删除 |
| | `findRootComment` | 保留 |
| `trailing cleanup at element cursor (D10/D11)` | 「host-structure markers ahead guard」 | 防护删除（父元素结束时子 Host 已消费完）；以「有 Host 时尾部杂节点照样清扫」替换 |
| | 「cleanup skips …」 | 保留（R5） |
| `Fragment reconcile walk branches` | 全部 10 条 | 函数删除。黑盒：N1a / N1b（数组含 `null` / boolean 项，元素 child 与 Fragment 根两种）、N2 系列、F2c（Fragment 根与数组 DirectNodes 的文本）、F3b（函数 → Fragment → 函数）；fuzz：扩展后 F1i 生成器的「Fragment 作为组件根」「Fragment 作为函数结构态的值」「Fragment 作为列表行」三种形态。S 的报告把 10 条逐条对到其中一个 |
| `hydrateRoot end-to-end claim corners` | 全部 | 保留 |

**其余文件：** 预计不改断言。下面写明每个文件的确认程度；B1–B4 在内部入口那一遍逐步确认，S 以全量门禁最终确认。
- `ssrHydrate.mismatch.spec.tsx`：断言预计全部保留，逐条走查的范围见 §4.5；「matched path」与 retained 计数两条没有失配，未单独走查。
- `ssrHydrate.lifecycle.spec.tsx`：读过用例标题与 Portal 系列断言（「不得认领主树的同标签兄弟」、content identity），预计保留；只更新注释里的 `claimElement` 字样。
- `ssrHydrate.lists`、`attrs-components`、`smoke`：读过其中检查 Host 内部形态的断言。这些断言检查的是：
  - Compact 行是 `CompactElementHost`；
  - 非 Compact 行的 Host 类型（FunctionHost / EmptyHost / RxListHost / StaticArrayHost）与 `rx list item` placeholder；
  - `textNode === placeholder`；
  - 认领节点的 identity。
  
  新模型产生同样的 Host 类型和 placeholder 种类（`createHydrateHost` 与 `createHost` 同序分派，Compact 判定与 CSR 等价），预计保留；其余黑盒断言没有逐条走查。
- `ssrAdjudication*`、`ssrReview*`：不调用 `hydrateRoot`，不受影响。
- `ssrStyles`、`styleContent*`、`contentAddressedStyles`、`auditStylesFormsState`、`auditSsrCsrAttributeParity`：只有黑盒断言（不读 Host 内部字段），预计保留；依赖 §2.9 的样式 id 推断，没有逐条走查。

> 已定（D3）：白盒用例按上表迁移。AGENTS.md 要求不删既有用例，但被测函数本身在新模型中不存在；按上面的要求逐条给出对应。

---

## 9. 风险与回退

| 风险 | 说明 | 缓解 |
|---|---|---|
| **Host 认领协议未在真实 Host 上原型验证**（最大的未验证点） | 原型验证的是遍历语法与位置对齐（§10）。真实 Host 还会在认领前读 `this.placeholder`，例如 `parentElement` getter、错误路径的 `placeholder.remove()`、`resetOptionOwnerSelect`、`isConnected`，以及 ComponentHost 与 innerHost 共享 placeholder | B1 就在真实的 `StaticHost`、`ComponentHost`（含与 innerHost 共享 placeholder）、`FunctionHost`、`AtomHost` 上落地协议，最先验证这一点（§7.1 第 5 点）；每个 B PR 审计所实现的 Host 在认领前对 placeholder 的读取；slot 常量不是节点，误用立即 TypeError；开发期不变量（§4.4）；内部入口那一遍的全量激活用例与扩展后的 F1i |
| 使用者依赖「激活期间 JSX 是节点」 | 公开契约变化（§3.1） | 开发期 Proxy 报告；生产 TypeError（方法、严格模式写入）；README 与站点迁移说明（D）；`hydrateRoot` 在 D 之前仍标实验性 |
| **被闭包捕获的描述**（最容易到线上才暴露） | 激活结束后仍是描述，问题在用户操作时才出现；生产环境读属性静默得到 `undefined`，身份比较静默为 `false`（§3.1.1） | 不转发，开发期与生产行为一致；开发期在访问时报告并给出 JSX 位置（同一个 JSX 位置和属性名报告一次）；迁移说明把这种写法列为第一条；示例里没有这种写法（§3.1.2）。身份与类型比较在开发期也检测不到，只能靠文档 |
| 过渡期两个模型同在 main 上 | B1 到 S 之间，旧模型与不可达的新模型代码并存 | 内部入口不导出、产物里没有它（每个 B PR 检查）；B1 到 D 之间不发版（§7.5）；S 删除旧模型 |
| 副作用顺序与 CSR 不同（§2.9） | 祖先响应式属性的绑定晚于后代子 Host 的渲染 | 服务端已写入属性初值，DOM 观察一致；lifecycle 用例覆盖 attach 时机 |
| 依赖 data0 的 `RxList.data` 写回 | 非文档行为 | `data0Contract.spec.tsx` 钉住；契约失效时退回「瘦身不写回」 |
| 失配重同步丢失 identity | 双重失配时复用的节点变少 | 不变量保证正确性（§4.1）；漂移 fuzz（B3） |
| 激活自身的分配 | 每个元素多一个描述对象 | 线性遍历取代二次搜索，总时间预期下降（F1d）；B2 在内部入口上记录激活耗时，S 记录切换前后的数字 |
| 激活中没被渲染的描述（C10） | 激活结束后第一次渲染时 DOM 多一个结构 Comment；列表 / 数组里留描述壳 | 功能与 CSR 相同；开发期报告；迁移写法见 C10。D2 已定：接受多一个结构 Comment，B4 用 `retainedObjectDiagnostics` 量化每行多保留的对象并写回 §5.2。数字不可接受时，再考虑在 `createChildHost` 的非 Compact 分支上加一次描述判定（CSR 列表新行路径上的常驻检查） |
| 服务端独有属性残留 | 干净认领、失配稍后暴露时（§4.1） | 失配路径上清理；开发期报告；与现状相同，不比现在差 |
| 与 #50 / #52 / #56 的交叉 | 都动 `DOM.ts` / `hydration.ts` | 本设计只依赖「原始标记不透明」「表单 props 在子节点之后应用」「命名空间由描述决定」这三个接口；冲突按合入顺序合并 |

**回退：**
- PR-A、B1–B4 不改公开行为：B1–B4 的新代码只有内部入口可达。其中任何一个出问题，回退它本身即可，使用者感知不到。
- S 是唯一改变公开行为的 PR。回退 S 即恢复现在的认领模型：S 删除的旧模型代码随回退恢复，B1–B4 的代码留在 main 上，仍然不可达。
- 服务端格式不变，回退不涉及服务端发版，也不需要兼容分支。
- 不向使用者提供「旧认领模型」的运行时开关：两套认领模型一起发布，会把 §2.8 的全部启发式留在包里，也违反「不加兼容分支」。过渡期的内部入口不是这种开关（§7.1 第 5 点）：它不导出，产物里没有它，S 之后旧模型不复存在。

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
- 真实 Host 上的认领协议（§9 第一行），由 B1 最先验证；
- 失配修复后的 DOM ≡ CSR：walker 只检测失配位置，不做修复。修复的正确性由 §4.1 的不变量论证，留给 B3 的用例与漂移 fuzz；
- 新旧模型经内部入口并存（§7.1）：由读源码得出，没有写原型；B1 的产物检查与全量门禁是它的验证；
- §3.4 / §7.2 的「两遍用 `test.projects`、不新增门禁命令」：本轮用一个不提交的探针配置验证过——两个继承 `vitest.config.ts` 的浏览器项目各带不同的 `define`，在同一个 `--browser.api.port` 下由一条 `npx vitest run` 跑完，各自读到自己的常量（Vitest 3.2.4，chromium）。真实的 15 个文件没有这样跑过；
- `RxList.data` 按下标写回不触发：只读了 data0 2.16.0 的 `map` 实现，没有运行，留给 PR-A 的契约用例；
- §5.3 的 B 组「激活分支被常量折叠」：只确认了 B 的产物里有描述分支，没有逐行检查折叠结果（原型产物已删除）；
- §2.9 的副作用顺序与样式 id 结论：按源码推断，没有运行；
- §1.2 中 F1f「挪出 main」与 F4a「延迟桩未插入」的内部步骤：由输出与代码推断，没有单步跟踪。

---

## 11. 范围外发现（只列出，未修）

- **函数结构态的值又是函数（B1 发现，服务端缺陷）。** `{() => () => x}`：CSR 里内层 FunctionHost 的 placeholder 是外层的 `<!--computed node-->`（Comment-ph），服务端 `ssr.serializeStructureResult` 却经 `serializeChild` 按 Text-ph 写内层，多出一个 `<!--axii:0-->`（内层结构态时在内层的 `computed node` 之后）。旧模型激活后，x 为空时留下这个 `axii:0`，x 是元素时抛错；新模型在认领处报告并抛出（B3 的 R3 会删除它并报告）。根治在服务端：函数结果按 Comment-ph 写（`serializeFunctionHost(result, out, 'comment')`）。`hydrateTopDown.spec` 里有一条 `test.fails` 钉住它。atom 结果不受影响（服务端按 Comment-ph 写）。

- **服务端 Compact 判定与 CSR 不一致（已在 chromium 复现）。** `serializeRxListRow` 只看行元素自己的 `detachStyle`，CSR 的 `detachStyledChildren` 还包括后代提升上来的。
  - 写法：`list.map(i => <li><span detachStyle={…}>{i}</span></li>)`；
  - CSR：`<li><span>1</span></li><!--rx list item--><!--unhandledChild-->`；
  - 服务端：`<li><span>1</span></li><!--unhandledChild-->`（缺行级 Comment）。
  
  激活时这一行的结构对不上。按 §2.6.4，两边应共用一个判定。协调者已单独开 #68，排在实现 PR 之前修；B2 直接使用 #68 落地的判定。
- **#54 报告的疑点不再存在。** 疑点是 `createElementForHydrateMismatch` 新建的元素没有登记为已认领，之后的无游标认领可能拿到它。新模型没有无游标认领，S 之后不再成立，无需单独处理。

---

## 12. 取舍：已定

第一轮审阅时由协调者按维护者授权决定。下表「结论」一列是协调者的决定，「落实位置」是本文据此改动或要求的地方。

| # | 取舍 | 结论 | 落实位置 |
|---|---|---|---|
| D1 | 列表 / 数组在认领后写回真实节点（§3.3），依赖 `RxList.data` 可按下标写而不触发 | 采用写回，先在 PR-A 用 `data0Contract.spec.tsx` 钉住契约 | §3.3；§7.4 PR-A、B2 |
| D2 | C10（激活中没渲染过的描述）多一个结构 Comment，还是在 CSR 非元素分支加判定求严格同形 | 接受多一个结构 Comment，但要量化：激活时没渲染的列表（标签页、折叠区）之后每行都是非 Compact 行，外加一个描述壳。用 `retainedObjectDiagnostics` 给出每行多保留多少，写进本文；数字不可接受时，再考虑非 Compact 分支上的那次判定 | §5.2「C10 的量化」；§7.4 B4 的验收；§9 |
| D3 | `claimCorners` 白盒用例按 §8 迁移（被测函数在新模型中不存在） | 同意迁移。报告要逐条给出「删除的用例 → 有名字的黑盒用例」；只写「由 fuzz 覆盖」的，要指出是生成器里的哪种形态 | §8（已按此要求写出 Fragment 两组的对应）；§7.2；§7.4 S |
| D4 | 属性边界（§4.1）：干净认领不清理服务端独有属性 | 接受。#55 验收里的「修复为 CSR 结果」因此限定为**节点结构、文本和客户端 props 写下的属性**，这个口径由协调者写到 #55 上 | §4.1；§7.4 B3 漂移 fuzz 的判定 |
| D5 | 副作用顺序（§2.9）：祖先响应式属性的绑定晚于后代子 Host 的渲染 | 接受 | §2.9 |
| D6 | PR 拆分（§7） | 不按第一版的「原子 PR-B」接受，按「内部入口分步落地、最后切换」评估。评估结论为可行，§7 已据此改写 | §7 |
| D7 | 服务端 Compact 判定的缺陷（§11） | 已单独开 #68，排在实现 PR 之前修；本设计引用 #68 | §2.6.4；§3.2；§11 |

**仍需协调者确认的事**（本轮新出现的，各附建议）：
- **过渡期不发版（§7.5）：** 建议 B1 合入到 D 合入之间不发版，D 紧跟 S 合入。
- **Proxy 读探测的排除表（§3.4）：** 建议接受「目前只排除 `type`」。代价是开发期不报告用户读 `el.type`；为了报告它，要把 `createHost` 的描述分支挪到 ComponentNode 判定之前，那会给每次组件的 `createHost` 加一次检查。
- **诊断开、关两遍在 S 之后长期保留（§3.4）：** 建议保留，开发期与生产拿到的是两种对象。代价是 15 个激活相关文件多跑一遍，不新增门禁命令。
